# /home/obafgk/SoundProject/metriful_web/data_processor.py

import mysql.connector
import pandas as pd
from datetime import datetime, timedelta
import numpy as np
import config
import os

HUMIDEX_DISPLAY_THRESHOLD_C = 28.0

def get_db_connection():
    try:
        return mysql.connector.connect(**config.DB_CONFIG)
    except mysql.connector.Error as err:
        print(f"ERREUR DB: {err}")
        return None

def calculate_humidex(T, RH):
    if T is None or RH is None: return None
    condition = (T >= HUMIDEX_DISPLAY_THRESHOLD_C)
    if isinstance(T, pd.Series):
        humidex = pd.Series(np.nan, index=T.index)
        T_valid = T[condition]
        RH_valid = RH[condition]
        if not T_valid.empty:
            e = (RH_valid / 100.0) * 6.112 * np.exp((17.67 * T_valid) / (T_valid + 243.5))
            humidex.loc[condition] = T_valid + 0.5555 * (e - 10.0)
        return humidex
    else:
        if condition:
            e = (RH / 100.0) * 6.112 * np.exp((17.67 * T) / (T + 243.5))
            return T + 0.5555 * (e - 10.0)
        else:
            return None

def get_dashboard_data(period_str='24h', ref_date_str=None):
    period_map = { '1h': timedelta(hours=1), '24h': timedelta(hours=24), '7d': timedelta(days=7), '30d': timedelta(days=30) }
    period_delta = period_map.get(period_str, timedelta(hours=24))
    
    # --- GESTION DES DATES ---
    if ref_date_str and len(ref_date_str) > 10:
        try:
            # On nettoie la date reçue du JS pour la remettre en UTC naïf pour la DB
            clean_date = ref_date_str.replace('Z', '').split('+')[0]
            reference_date = datetime.fromisoformat(clean_date)
        except ValueError:
            reference_date = datetime.utcnow()
    else:
        reference_date = datetime.utcnow()

    time_threshold = reference_date - period_delta
    is_historical = (ref_date_str is not None and ref_date_str != '')
    
    if is_historical:
        time_cond = "timestamp >= %s AND timestamp <= %s"
        sound_cond = "start_time >= %s AND start_time <= %s"
        params = (time_threshold, reference_date)
    else:
        time_cond = "timestamp >= %s"
        sound_cond = "start_time >= %s"
        params = (time_threshold,)

    conn = get_db_connection()
    if not conn: 
        return { "kpis": None, "stats": {}, "history_data": [], "events_period": [], "top_events": [], "window_status": None, "manual_labels": [] }
        
    cursor = conn.cursor(dictionary=True)
    
    # KPI
    if is_historical:
        cursor.execute("SELECT * FROM sensor_data WHERE timestamp <= %s ORDER BY timestamp DESC LIMIT 1", (reference_date,))
    else:
        cursor.execute("SELECT * FROM sensor_data ORDER BY id DESC LIMIT 1")
    kpis = cursor.fetchone()
    
    if kpis:
        kpis['humidex'] = calculate_humidex(kpis.get('temperature_c'), kpis.get('humidity_pct'))
        # AJOUT DU 'Z' ICI
        if kpis.get('timestamp'): kpis['timestamp'] = kpis['timestamp'].isoformat() + 'Z'

    # Fenêtre
    cursor.execute("SELECT status FROM window_labels ORDER BY timestamp DESC LIMIT 1")
    window_status_raw = cursor.fetchone()
    window_status = window_status_raw if window_status_raw else None
    
    # Labels
    cursor.execute(f"SELECT timestamp, status FROM window_labels WHERE {time_cond} ORDER BY timestamp ASC", params)
    # AJOUT DU 'Z' ICI
    manual_labels = [{'timestamp_iso': l['timestamp'].isoformat() + 'Z', 'status': l['status']} for l in cursor.fetchall()]

    # Historique
    cursor.execute(f"SELECT * FROM sensor_data WHERE {time_cond} ORDER BY timestamp ASC", params)
    history_data_raw = cursor.fetchall()
    
    stats, history_data = {}, []
    if history_data_raw:
        df = pd.DataFrame(history_data_raw)
        data_cols = ['temperature_c','humidity_pct','pressure_pa','aqi','bsec_co2_ppm','light_lux','sound_spl_dba']
        for col in data_cols:
            if col in df.columns:
                df[col] = pd.to_numeric(df[col], errors='coerce')
                if not df[col].isnull().all():
                    if len(df[col].dropna()) >= (config.ROLLING_WINDOW / 2 if config.ROLLING_WINDOW else 1):
                        df[f'{col}_rolling_mean'] = df[col].rolling(window=config.ROLLING_WINDOW, min_periods=1, center=True).mean()
                    else: 
                        df[f'{col}_rolling_mean'] = pd.NA
                    stats[col] = {'mean':df[col].mean(),'median':df[col].median(),'std_dev':df[col].std(),'min':df[col].min(),'max':df[col].max()}
        
        if 'temperature_c' in df.columns and 'humidity_pct' in df.columns:
            df['humidex'] = calculate_humidex(df['temperature_c'], df['humidity_pct'])
            if 'humidex' in df.columns and not df['humidex'].isnull().all() and len(df['humidex'].dropna()) >= (config.ROLLING_WINDOW / 2 if config.ROLLING_WINDOW else 1):
                 df['humidex_rolling_mean'] = df['humidex'].rolling(window=config.ROLLING_WINDOW, min_periods=1, center=True).mean()
            else:
                 df['humidex_rolling_mean'] = pd.NA

        if 'timestamp' in df.columns:
            # AJOUT DU 'Z' ICI
            df['timestamp'] = df['timestamp'].apply(lambda dt: dt.isoformat() + 'Z' if pd.notnull(dt) else None)
        
        df = df.astype(object).where(pd.notna(df), None)
        history_data = df.to_dict('records')

    # Événements Sonores
    cursor.execute(f"SELECT id, start_time, duration_s, sound_type, peak_spl_dba, audio_filepath FROM sound_events WHERE {sound_cond} ORDER BY id DESC LIMIT 50", params)
    sound_events_period_raw = cursor.fetchall()
    sound_events_period = []
    
    for event_raw in sound_events_period_raw:
        event = dict(event_raw)
        if event.get('start_time'): 
            # AJOUT DU 'Z' ICI
            event['start_time_iso'] = event['start_time'].isoformat() + 'Z'
            # Spectre
            cursor.execute("SELECT freq_band_1, freq_band_2, freq_band_3, freq_band_4, freq_band_5, freq_band_6 FROM sensor_data WHERE timestamp >= %s ORDER BY timestamp ASC LIMIT 1", (event['start_time'],))
            spectral_data = cursor.fetchone()
            if spectral_data: 
                event['spectral_bands'] = [v for v in spectral_data.values() if v is not None]
        
        path = event.get('audio_filepath')
        if path and isinstance(path, str) and len(path) > 0:
            event['audio_filename'] = os.path.basename(path)
        else:
            event['audio_filename'] = None
            
        sound_events_period.append(event)
    
    # Top Événements
    cursor.execute("SELECT id, start_time, duration_s, sound_type, peak_spl_dba, audio_filepath FROM sound_events ORDER BY peak_spl_dba DESC, id DESC LIMIT 20")
    top_events_raw = cursor.fetchall()
    top_events = []
    for event_raw in top_events_raw:
        event = dict(event_raw)
        if event.get('start_time'): 
            # AJOUT DU 'Z' ICI
            event['start_time_iso'] = event['start_time'].isoformat() + 'Z'
            cursor.execute("SELECT freq_band_1, freq_band_2, freq_band_3, freq_band_4, freq_band_5, freq_band_6 FROM sensor_data WHERE timestamp >= %s ORDER BY timestamp ASC LIMIT 1", (event['start_time'],))
            spectral_data = cursor.fetchone()
            if spectral_data: 
                event['spectral_bands'] = [v for v in spectral_data.values() if v is not None]
        path = event.get('audio_filepath')
        if path and isinstance(path, str) and len(path) > 0:
            event['audio_filename'] = os.path.basename(path)
        else:
            event['audio_filename'] = None
        top_events.append(event)
    
    cursor.close()
    conn.close()
    
    return { "kpis": kpis, "stats": stats, "history_data": history_data, "events_period": sound_events_period, "top_events": top_events, "window_status": window_status, "manual_labels": manual_labels }
