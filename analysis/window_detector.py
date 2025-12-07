# /home/obafgk/SoundProject/analysis/window_detector.py

import datetime
import numpy as np

# Paramètres de détection (utilisés par le logger et les outils de calibration)
TEMP_CHANGE_THRESHOLD = 0.3
HUMID_CHANGE_THRESHOLD = 1.0
SOUND_CHANGE_THRESHOLD = 2.0
CO2_CHANGE_THRESHOLD = 5.0
CONFIDENCE_THRESHOLD = 3
CONSECUTIVE_CYCLES_FOR_EVENT = 3

def log_window_event(conn, status, changes, score):
    if conn is None: return
    sql = "INSERT INTO window_events (timestamp, status, temp_change, humidity_change, sound_change, co2_change, confidence_score) VALUES (%s, %s, %s, %s, %s, %s, %s)"
    try:
        cursor = conn.cursor()
        cursor.execute(sql, (datetime.datetime.utcnow(), status, changes['temp'], changes['humid'], changes['sound'], changes['co2'], score))
        conn.commit()
        cursor.close()
        print(f"🪟  CHANGEMENT D'ÉTAT FENÊTRE DÉTECTÉ : Le nouvel état est probablement {status}. Score: {score}")
    except Exception as e:
        print(f"Erreur écriture window_events: {e}"); conn.rollback()

def analyze_for_window_event(conn, buffer, last_known_status, consecutive_trigger_count, last_potential_status):
    WINDOW_ANALYSIS_BUFFER_SIZE = 20
    
    # Retourner les compteurs si pas assez de données pour l'analyse
    current_state_memory = {'count': consecutive_trigger_count, 'status': last_potential_status}
    if len(buffer) < WINDOW_ANALYSIS_BUFFER_SIZE:
        return False, current_state_memory

    data = np.array([list(d.values()) for d in buffer if all(v is not None for v in d.values())])
    if len(data) < WINDOW_ANALYSIS_BUFFER_SIZE:
        return False, current_state_memory
    
    keys = list(buffer[0].keys())
    half_size = WINDOW_ANALYSIS_BUFFER_SIZE // 2
    avg_old = dict(zip(keys, np.mean(data[:half_size], axis=0)))
    avg_new = dict(zip(keys, np.mean(data[half_size:], axis=0)))
    
    confidence_score = 0
    current_potential_status = None
    
    try:
        temp_change = avg_new['T_C'] - avg_old['T_C']; humid_change = avg_new['H_pc'] - avg_old['H_pc']
        sound_change = avg_new['SPL_dBA'] - avg_old['SPL_dBA']; co2_change = avg_new['CO2e'] - avg_old['CO2e']
        
        confidence_score = ((abs(temp_change) > TEMP_CHANGE_THRESHOLD) * 2 + (abs(humid_change) > HUMID_CHANGE_THRESHOLD) * 1 +
                            (abs(sound_change) > SOUND_CHANGE_THRESHOLD) * 1 + (abs(co2_change) > CO2_CHANGE_THRESHOLD) * 5)

        if confidence_score >= CONFIDENCE_THRESHOLD:
            open_score = ((co2_change < -CO2_CHANGE_THRESHOLD) * 5 + (temp_change < -TEMP_CHANGE_THRESHOLD) * 2)
            close_score = ((co2_change > CO2_CHANGE_THRESHOLD) * 5 + (temp_change > TEMP_CHANGE_THRESHOLD) * 2)
            if open_score > 0 or close_score > 0:
                current_potential_status = 'ouverte' if open_score > close_score else 'fermee'
    except (TypeError, KeyError):
        return False, current_state_memory

    if current_potential_status is not None and current_potential_status == last_potential_status:
        consecutive_trigger_count += 1
    else:
        consecutive_trigger_count = 1
        last_potential_status = current_potential_status
        
    current_state_memory = {'count': consecutive_trigger_count, 'status': last_potential_status}

    if (consecutive_trigger_count >= CONSECUTIVE_CYCLES_FOR_EVENT and 
        last_potential_status is not None and
        last_potential_status != last_known_status):
        
        print(f"VALIDATION D'ÉTAT : '{last_potential_status}' détecté pendant {consecutive_trigger_count} cycles.")
        changes = {'temp': temp_change, 'humid': humid_change, 'sound': sound_change, 'co2': co2_change}
        log_window_event(conn, last_potential_status, changes, confidence_score)
        return True, last_potential_status # Signale un événement et retourne le NOUVEL état

    return False, current_state_memory
