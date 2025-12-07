# /home/obafgk/SoundProject/logger.py

import time, datetime, mysql.connector, config, os
import sensor_package.sensor_functions as sensor, sensor_package.sensor_constants as const, RPi.GPIO as GPIO
import sounddevice as sd
from scipy.io.wavfile import write as write_wav
from collections import deque
import numpy as np

# Import des nouveaux modules d'analyse
from analysis.sound_classifier import advanced_classify
from analysis.window_detector import analyze_for_window_event, CONSECUTIVE_CYCLES_FOR_EVENT

cycle_period = const.CYCLE_PERIOD_3_S

# --- PARAMÈTRES AUDIO ---
AUDIO_RECORD_DURATION = 5
AUDIO_SAMPLE_RATE = 44100
AUDIO_CHANNELS = 1
AUDIO_DEVICE_ID = None
AUDIO_SAVE_PATH = "/home/obafgk/SoundProject/audio_events/"

# --- PARAMÈTRES DÉTECTION FENÊTRE ---
WINDOW_ANALYSIS_BUFFER_SIZE = 20
WINDOW_EVENT_COOLDOWN_S = 300

def get_db_connection():
    try: return mysql.connector.connect(**config.DB_CONFIG)
    except mysql.connector.Error as err: print(f"Erreur DB: {err}"); return None

def log_sensor_data(conn, air_data, air_quality_data, light_data, sound_data):
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
    except Exception as e: print(f"Erreur écriture sensor_data: {e}"); conn.rollback()

def record_audio_event(start_time_obj, event_type):
    try:
        print(f"🎙️  Enregistrement audio pour '{event_type}'...")
        filename_timestamp = start_time_obj.strftime("%Y%m%d_%H%M%S")
        filename = f"{filename_timestamp}_{event_type.replace(' ', '_').replace('/', '-')}.wav"
        filepath = os.path.join(AUDIO_SAVE_PATH, filename)
        recording = sd.rec(int(AUDIO_RECORD_DURATION * AUDIO_SAMPLE_RATE), samplerate=AUDIO_SAMPLE_RATE, channels=AUDIO_CHANNELS, device=AUDIO_DEVICE_ID, dtype='int16')
        sd.wait()
        write_wav(filepath, AUDIO_SAMPLE_RATE, recording)
        print(f"✅ Fichier audio sauvegardé : {filepath}")
        return filepath
    except Exception as e:
        print(f"🟥 Erreur enregistrement audio : {e}")
        return None

def log_sound_event(conn, start_time_obj, duration_s, sound_type, peak_spl):
    if conn is None: return
    audio_path = record_audio_event(start_time_obj, sound_type)
    sql = "INSERT INTO sound_events (start_time, duration_s, sound_type, peak_spl_dba, audio_filepath) VALUES (%s, %s, %s, %s, %s)"
    try:
        cursor = conn.cursor()
        cursor.execute(sql, (start_time_obj, duration_s, sound_type, peak_spl, audio_path))
        conn.commit()
        cursor.close()
        print(f"💿 ÉVÉNEMENT SONORE (DB): Type={sound_type}, Durée={duration_s}s, Pic={peak_spl:.1f}dBA")
    except Exception as e: 
        print(f"Erreur écriture sound_events: {e}"); conn.rollback()

if __name__ == "__main__":
    if not os.path.exists(AUDIO_SAVE_PATH): os.makedirs(AUDIO_SAVE_PATH)
    
    (GPIO_module, I2C_bus) = sensor.SensorHardwareSetup()
    I2C_bus.write_i2c_block_data(sensor.i2c_7bit_address, const.CYCLE_TIME_PERIOD_REG, [cycle_period])
    I2C_bus.write_byte(sensor.i2c_7bit_address, const.CYCLE_MODE_CMD)
    
    db_connection = get_db_connection()
    if db_connection is None: GPIO.cleanup(); exit(1)
    
    print("Logger démarré (v3 - Refactorisé)...")
    is_event, start_time_event_obj, count, peak_spl_event = False, None, 0, 0.0
    spectral_event_history = []
    sensor_data_buffer = deque(maxlen=WINDOW_ANALYSIS_BUFFER_SIZE)
    last_window_event_time = 0
    
    cursor = db_connection.cursor()
    cursor.execute("SELECT status FROM window_events ORDER BY timestamp DESC LIMIT 1")
    last_row = cursor.fetchone()
    last_detected_window_state = last_row[0] if last_row else 'fermee'
    cursor.close()
    print(f"État initial fenêtre: '{last_detected_window_state}'")

    consecutive_trigger_count = 0
    last_potential_status = None

    try:
        while True:
            while not GPIO.event_detected(sensor.READY_pin): time.sleep(0.05)
            
            air_d = sensor.get_air_data(I2C_bus); aq_d = sensor.get_air_quality_data(I2C_bus); light_d = sensor.get_light_data(I2C_bus); sound_d = sensor.get_sound_data(I2C_bus)
            
            log_sensor_data(db_connection, air_d, aq_d, light_d, sound_d)

            current_data_point = {'T_C': air_d.get('T_C'), 'H_pc': air_d.get('H_pc'), 'SPL_dBA': sound_d.get('SPL_dBA'), 'CO2e': aq_d.get('CO2e')}
            if all(v is not None for v in current_data_point.values()):
                sensor_data_buffer.append(current_data_point)
            
            current_time = time.time()
            if current_time - last_window_event_time > WINDOW_EVENT_COOLDOWN_S:
                event_detected, new_state_or_memory = analyze_for_window_event(db_connection, sensor_data_buffer, last_detected_window_state, consecutive_trigger_count, last_potential_status)
                
                if event_detected:
                    last_detected_window_state = new_state_or_memory
                    last_window_event_time = current_time
                    consecutive_trigger_count = 0
                    last_potential_status = None
                else:
                    consecutive_trigger_count = new_state_or_memory.get('count', 0)
                    last_potential_status = new_state_or_memory.get('status', None)

            current_spl_dba = sound_d.get('SPL_dBA'); current_effective_spl = current_spl_dba if current_spl_dba is not None else 0
            spectral_bands = sound_d.get('SPL_bands_dB'); max_spectral_band_value = 0
            if spectral_bands and all(b is not None for b in spectral_bands): max_spectral_band_value = max(spectral_bands)
            current_max_sound_level = max(current_effective_spl, max_spectral_band_value)

            if current_max_sound_level > config.SOUND_THRESHOLD_DBA:
                if not is_event: 
                    is_event, start_time_event_obj, count, peak_spl_event = True, datetime.datetime.utcnow(), 0, current_max_sound_level
                    spectral_event_history = []; print(f"🔊 Début d'un événement sonore potentiel à {current_max_sound_level:.1f} dBA...")
                count += 1
                if current_max_sound_level > peak_spl_event: peak_spl_event = current_max_sound_level
                spectral_event_history.append(spectral_bands)
            elif is_event:
                if count >= config.EVENT_MIN_CYCLES:
                    final_type = advanced_classify(spectral_event_history)
                    print(f"-> Événement terminé. Classification: {final_type}")
                    if final_type != "Bruit de fond":
                        log_sound_event(db_connection, start_time_event_obj, count*3, final_type, peak_spl_event)
                    else:
                        print(f"Événement ignoré (classifié comme '{final_type}').")





                elif count < config.EVENT_MIN_CYCLES: print(f"Événement sonore trop court ({count} cycles), ignoré.")
                is_event = False
            
    except KeyboardInterrupt: print("\nArrêt.")
    finally:
        if db_connection and db_connection.is_connected(): db_connection.close()
        GPIO.cleanup()
