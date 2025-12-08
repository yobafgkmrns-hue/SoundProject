# /home/obafgk/SoundProject/studioAI_metriful_logger.py

import time, datetime, mysql.connector, config, os, re, sys
import sensor_package.sensor_functions as sensor, sensor_package.sensor_constants as const, RPi.GPIO as GPIO
import sounddevice as sd
from scipy.io.wavfile import write as write_wav
from collections import deque
import numpy as np

# === CONFIGURATION ===
cycle_period = const.CYCLE_PERIOD_3_S
ENV_LOG_INTERVAL_S = 60  # Enregistrement T°/Humidité toutes les 60s

# --- PARAMÈTRES AUDIO ---
AUDIO_RECORD_DURATION = 5
AUDIO_SAMPLE_RATE = 44100
AUDIO_CHANNELS = 1
AUDIO_DEVICE_ID = None
AUDIO_SAVE_PATH = "/home/obafgk/SoundProject/audio_events/"

# Au début du fichier
NEW_EVENT_SIGNAL_FILE = "/home/obafgk/SoundProject/new_event.signal"
NEW_SENSOR_SIGNAL_FILE = "/home/obafgk/SoundProject/new_sensor.signal" # NOUVEAU

# --- SEUILS ---
WINDOW_ANALYSIS_BUFFER_SIZE = 20

def check_permissions():
    print("--- Vérification des prérequis ---")
    if not os.path.isdir(AUDIO_SAVE_PATH):
        try: os.makedirs(AUDIO_SAVE_PATH); print(f"✅ Dossier audio créé : {AUDIO_SAVE_PATH}")
        except OSError as e: print(f"🟥 ERREUR : {e}"); return False
    return True

def get_new_db_connection():
    try: return mysql.connector.connect(**config.DB_CONFIG)
    except mysql.connector.Error as err: print(f"Erreur connexion DB: {err}"); return None

def log_sensor_data(air_data, air_quality_data, light_data, sound_data):
    conn = get_new_db_connection()
    if conn is None: return
    sql = "INSERT INTO sensor_data (timestamp, temperature_c, pressure_pa, humidity_pct, gas_resistance_ohm, aqi, bsec_co2_ppm, light_lux, sound_spl_dba, freq_band_1, freq_band_2, freq_band_3, freq_band_4, freq_band_5, freq_band_6) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)"
    try:
        cursor = conn.cursor()
        spl_bands_raw = sound_data.get('SPL_bands_dB')
        spl_bands = spl_bands_raw if spl_bands_raw and len(spl_bands_raw) == 6 else [None]*6
        data_tuple = (
            datetime.datetime.utcnow(), air_data.get('T_C'), air_data.get('P_Pa'), air_data.get('H_pc'), 
            air_quality_data.get('gas_resistance_ohm'), air_quality_data.get('AQI'), air_quality_data.get('CO2e'), 
            light_data.get('illum_lux'), sound_data.get('SPL_dBA'), 
            spl_bands[0], spl_bands[1], spl_bands[2], spl_bands[3], spl_bands[4], spl_bands[5]
        )
        cursor.execute(sql, data_tuple)
        conn.commit()
        cursor.close()
        print(f"[{datetime.datetime.now().strftime('%H:%M:%S')}] 🌡️ Données capteurs enregistrées.")
        with open(NEW_SENSOR_SIGNAL_FILE, "w") as f:
            f.write(str(time.time()))
        os.chmod(NEW_SENSOR_SIGNAL_FILE, 0o666)

    except Exception as e: print(f"Erreur écriture sensor_data: {e}"); conn.rollback()
    finally: conn.close()

def record_audio_event(start_time_obj, event_type):
    try:
        print(f"🎙️  Enregistrement audio en cours ({AUDIO_RECORD_DURATION}s)...")
        filename_timestamp = start_time_obj.strftime("%Y%m%d_%H%M%S")
        safe_event_type = re.sub(r'[^\x00-\x7F]+', '', event_type.replace(' ', '_').replace('/', '-'))
        filename = f"{filename_timestamp}_{safe_event_type}.wav"
        filepath = os.path.join(AUDIO_SAVE_PATH, filename)
        
        recording = sd.rec(int(AUDIO_RECORD_DURATION * AUDIO_SAMPLE_RATE), samplerate=AUDIO_SAMPLE_RATE, channels=AUDIO_CHANNELS, device=AUDIO_DEVICE_ID, dtype='int16')
        sd.wait()
        write_wav(filepath, AUDIO_SAMPLE_RATE, recording)
        print(f"✅ Audio sauvegardé : {filename}")
        return filepath
    except Exception as e:
        print(f"🟥 Erreur audio : {e}"); return None

def trigger_web_notification():
    """Fonction dédiée pour prévenir le site web"""
    try:
        # On écrit le timestamp actuel dans le fichier
        with open(NEW_EVENT_SIGNAL_FILE, "w") as f:
            f.write(str(time.time()))
        
        # On force les permissions pour que le serveur web (www-data ou autre) puisse le lire
        os.chmod(NEW_EVENT_SIGNAL_FILE, 0o666)
        
        print(f"📡 SIGNAL ENVOYÉ AU DASHBOARD -> {NEW_EVENT_SIGNAL_FILE}")
    except Exception as e:
        print(f"🟥 ERREUR ENVOI SIGNAL : {e}")

def log_sound_event(start_time_obj, duration_s, sound_type, peak_spl):
    audio_path = record_audio_event(start_time_obj, sound_type)
    
    conn = get_new_db_connection()
    if conn is None: return

    sql = "INSERT INTO sound_events (start_time, duration_s, sound_type, peak_spl_dba, audio_filepath) VALUES (%s, %s, %s, %s, %s)"
    try:
        cursor = conn.cursor()
        cursor.execute(sql, (start_time_obj, duration_s, sound_type, peak_spl, audio_path))
        conn.commit()
        cursor.close()
        print(f"💿 ÉVÉNEMENT {sound_type} ENREGISTRÉ EN DB.")
        
        # C'est ICI qu'on déclenche la notification
        trigger_web_notification()
        
    except Exception as e: 
        print(f"Erreur écriture sound_events: {e}"); conn.rollback()
    finally: conn.close()

def advanced_classify(spectral_history):
    # Classification simplifiée (Placeholder)
    if not spectral_history: return "Bruit"
    return "Autre" # Vous pouvez remettre votre logique ici

if __name__ == "__main__":
    if not check_permissions(): sys.exit(1)
    (GPIO_module, I2C_bus) = sensor.SensorHardwareSetup()
    
    I2C_bus.write_i2c_block_data(sensor.i2c_7bit_address, const.CYCLE_TIME_PERIOD_REG, [cycle_period])
    I2C_bus.write_byte(sensor.i2c_7bit_address, const.CYCLE_MODE_CMD)
    
    is_event = False
    start_time_event_obj = None
    count = 0
    peak_spl_event = 0.0
    spectral_event_history = []
    
    last_env_log_time = time.time() - ENV_LOG_INTERVAL_S
    sensor_data_buffer = deque(maxlen=WINDOW_ANALYSIS_BUFFER_SIZE)

    print(f"Logger démarré. Seuil détection: {config.SOUND_THRESHOLD_DBA} dBA")

    try:
        while True:
            while not GPIO.event_detected(sensor.READY_pin): time.sleep(0.05)
            
            # Lecture Capteurs
            air_d = sensor.get_air_data(I2C_bus); aq_d = sensor.get_air_quality_data(I2C_bus)
            light_d = sensor.get_light_data(I2C_bus); sound_d = sensor.get_sound_data(I2C_bus)
            current_time = time.time()
            
            # Log Environnement (1 min)
            if current_time - last_env_log_time >= ENV_LOG_INTERVAL_S:
                log_sensor_data(air_d, aq_d, light_d, sound_d)
                last_env_log_time = current_time

            # Logique Audio
            current_spl_dba = sound_d.get('SPL_dBA')
            spectral_bands = sound_d.get('SPL_bands_dB')
            max_spectral = max(spectral_bands) if spectral_bands else 0
            current_max = max(current_spl_dba if current_spl_dba else 0, max_spectral)
            
            if current_max > config.SOUND_THRESHOLD_DBA:
                if not is_event: 
                    is_event, start_time_event_obj, count, peak_spl_event = True, datetime.datetime.utcnow(), 0, current_max
                    spectral_event_history = []
                    print(f"🔊 DÉTECTION EN COURS ({current_max:.1f} dBA)...")
                count += 1
                if current_max > peak_spl_event: peak_spl_event = current_max
                spectral_event_history.append(spectral_bands)
            elif is_event:
                if count >= config.EVENT_MIN_CYCLES:
                    print("-> Fin événement. Analyse et Enregistrement...")
                    final_type = advanced_classify(spectral_event_history)
                    log_sound_event(start_time_event_obj, count*3, final_type, peak_spl_event)
                else:
                    print(f"-> Ignoré (Trop court: {count*3}s)")
                is_event = False
            
    except KeyboardInterrupt: print("\nArrêt.")
    finally: GPIO.cleanup()