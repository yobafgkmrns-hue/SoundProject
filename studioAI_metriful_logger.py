# /home/obafgk/SoundProject/studioAI_metriful_logger.py

import time, datetime, mysql.connector, config, os, re, sys
import sensor_package.sensor_functions as sensor, sensor_package.sensor_constants as const, RPi.GPIO as GPIO
import sounddevice as sd
from scipy.io.wavfile import write as write_wav
from collections import deque
import numpy as np

cycle_period = const.CYCLE_PERIOD_3_S
print_data_as_columns = False

AUDIO_RECORD_DURATION = 5
AUDIO_SAMPLE_RATE = 44100
AUDIO_CHANNELS = 1
AUDIO_DEVICE_ID = None
AUDIO_SAVE_PATH = "/home/obafgk/SoundProject/audio_events/"

TEMP_CHANGE_THRESHOLD = 0.3
HUMID_CHANGE_THRESHOLD = 1.0
SOUND_CHANGE_THRESHOLD = 2.0
CO2_CHANGE_THRESHOLD = 5.0
CONFIDENCE_THRESHOLD = 3

WINDOW_ANALYSIS_BUFFER_SIZE = 20
WINDOW_EVENT_COOLDOWN_S = 300
NEW_EVENT_SIGNAL_FILE = "/home/obafgk/SoundProject/metriful_web/new_event.signal"

def check_permissions():
    print("--- Vérification des prérequis ---")
    if not os.path.isdir(AUDIO_SAVE_PATH):
        try: os.makedirs(AUDIO_SAVE_PATH); print(f"✅ Dossier audio créé : {AUDIO_SAVE_PATH}")
        except OSError as e: print(f"🟥 ERREUR : {e}"); return False
    if not os.access(AUDIO_SAVE_PATH, os.W_OK):
        print(f"🟥 ERREUR : Pas de permission d'écriture : {AUDIO_SAVE_PATH}"); return False
    return True

# === MODIFICATION : Fonction pour obtenir une connexion fraîche ===
def get_new_db_connection():
    try: return mysql.connector.connect(**config.DB_CONFIG)
    except mysql.connector.Error as err: print(f"Erreur connexion DB: {err}"); return None

# === MODIFICATION : Connexion locale ===
def log_sensor_data(air_data, air_quality_data, light_data, sound_data):
    conn = get_new_db_connection() # On ouvre
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
        conn.commit() # On valide
        cursor.close()
        print(f"[{datetime.datetime.now().strftime('%H:%M:%S')}] Données d'ambiance enregistrées.")
    except Exception as e: print(f"Erreur écriture sensor_data: {e}"); conn.rollback()
    finally: conn.close() # On ferme immédiatement

def record_audio_event(start_time_obj, event_type):
    try:
        print(f"🎙️  Enregistrement audio '{event_type}'...")
        filename_timestamp = start_time_obj.strftime("%Y%m%d_%H%M%S")
        safe_event_type = re.sub(r'[^\x00-\x7F]+', '', event_type.replace(' ', '_').replace('/', '-'))
        filename = f"{filename_timestamp}_{safe_event_type}.wav"
        filepath = os.path.join(AUDIO_SAVE_PATH, filename)
        
        recording = sd.rec(int(AUDIO_RECORD_DURATION * AUDIO_SAMPLE_RATE), samplerate=AUDIO_SAMPLE_RATE, channels=AUDIO_CHANNELS, device=AUDIO_DEVICE_ID, dtype='int16')
        sd.wait()
        write_wav(filepath, AUDIO_SAMPLE_RATE, recording)
        print(f"✅ Audio sauvegardé : {filepath}")
        return filepath
    except Exception as e:
        print(f"🟥 Erreur audio : {e}"); return None

# === MODIFICATION : Connexion locale ===
def log_sound_event(start_time_obj, duration_s, sound_type, peak_spl):
    audio_path = record_audio_event(start_time_obj, sound_type)
    
    conn = get_new_db_connection() # On ouvre
    if conn is None: return

    sql = "INSERT INTO sound_events (start_time, duration_s, sound_type, peak_spl_dba, audio_filepath) VALUES (%s, %s, %s, %s, %s)"
    try:
        cursor = conn.cursor()
        cursor.execute(sql, (start_time_obj, duration_s, sound_type, peak_spl, audio_path))
        conn.commit() # On valide
        cursor.close()
        print(f"💿 ÉVÉNEMENT DB OK: {sound_type}, Audio={audio_path}")
        
        # Ecriture du signal seulement après succès DB
        if audio_path:
            with open(NEW_EVENT_SIGNAL_FILE, "w") as f:
                f.write(str(datetime.datetime.utcnow().timestamp()))
    except Exception as e: 
        print(f"Erreur écriture sound_events: {e}"); conn.rollback()
    finally: conn.close() # On ferme

# Fonctions placeholders
def log_window_event(conn, status, changes, score): pass
def analyze_for_window_event(conn, buffer): pass

def advanced_classify(spectral_history):
    if not spectral_history or len(spectral_history) < 2: return "Autre"
    # ... Votre logique de classification ici ...
    return "Autre"

if __name__ == "__main__":
    if not check_permissions(): sys.exit(1)
    (GPIO_module, I2C_bus) = sensor.SensorHardwareSetup()
    I2C_bus.write_i2c_block_data(sensor.i2c_7bit_address, const.CYCLE_TIME_PERIOD_REG, [cycle_period])
    I2C_bus.write_byte(sensor.i2c_7bit_address, const.CYCLE_MODE_CMD)
    
    # PLUS de connexion globale ici !
    
    is_event, start_time_event_obj, count, peak_spl_event = False, None, 0, 0.0
    spectral_event_history = []
    last_general_log_time = time.time() - config.GENERAL_LOG_INTERVAL_SECONDS
    sensor_data_buffer = deque(maxlen=WINDOW_ANALYSIS_BUFFER_SIZE)

    print("Logger démarré (Mode Robustesse DB)...")

    try:
        while True:
            while not GPIO.event_detected(sensor.READY_pin): time.sleep(0.05)
            
            air_d = sensor.get_air_data(I2C_bus); aq_d = sensor.get_air_quality_data(I2C_bus)
            light_d = sensor.get_light_data(I2C_bus); sound_d = sensor.get_sound_data(I2C_bus)
            current_time = time.time()
            
            if current_time - last_general_log_time >= config.GENERAL_LOG_INTERVAL_SECONDS:
                log_sensor_data(air_d, aq_d, light_d, sound_d) # On ne passe plus 'conn'
                last_general_log_time = current_time

            current_data_point = {**air_d, **aq_d, **sound_d}
            if all(k in current_data_point and current_data_point[k] is not None for k in ['T_C', 'H_pc', 'SPL_dBA', 'CO2e']):
                sensor_data_buffer.append(current_data_point)

            current_spl_dba = sound_d.get('SPL_dBA')
            spectral_bands = sound_d.get('SPL_bands_dB')
            max_spectral = max(spectral_bands) if spectral_bands else 0
            current_max = max(current_spl_dba if current_spl_dba else 0, max_spectral)
            
            print(f"DEBUG: {current_max:.1f} dBA / Seuil {config.SOUND_THRESHOLD_DBA}")

            if current_max > config.SOUND_THRESHOLD_DBA:
                if not is_event: 
                    is_event, start_time_event_obj, count, peak_spl_event = True, datetime.datetime.utcnow(), 0, current_max
                    spectral_event_history = []
                count += 1
                if current_max > peak_spl_event: peak_spl_event = current_max
                spectral_event_history.append(spectral_bands)
            elif is_event:
                if count >= config.EVENT_MIN_CYCLES:
                    final_type = advanced_classify(spectral_event_history)
                    # On ne passe plus 'db_connection'
                    log_sound_event(start_time_event_obj, count*3, final_type, peak_spl_event)
                is_event = False
            
    except KeyboardInterrupt: print("\nArrêt.")
    finally: GPIO.cleanup()
