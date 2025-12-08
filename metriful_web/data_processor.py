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

def process_events_dataframe(df, limit):
    """Calcule le délai entre événements et formate pour l'API"""
    if df.empty:
        return []

    # 1. Tri chronologique pour le calcul diff()
    df = df.sort_values(by='start_time')
    
    # 2. Calcul du temps écoulé (Crée un objet Timedelta)
    df['delta'] = df['start_time'].diff()

    def format_delta(x):
        if pd.isnull(x): return "-"
        total_seconds = int(x.total_seconds())
        if total_seconds < 60: return f"{total_seconds}s"
        minutes = total_seconds // 60
        if minutes < 60: return f"{minutes}m"
        hours = minutes // 60
        minutes = minutes % 60
        return f"{hours}h{minutes:02d}"

    # Crée la version TEXTE (lisible par JSON)
    df['duration_since_prev'] = df['delta'].apply(format_delta)

    # 3. Formatage ISO des dates
    if 'start_time' in df.columns:
        df['start_time_iso'] = df['start_time'].apply(lambda x: x.isoformat() + 'Z' if pd.notnull(x) else None)

    # 4. Tri décroissant pour l'affichage
    df = df.sort_values(by='start_time', ascending=False)
    
    # 5. Application de la limite
    if len(df) > limit:
        df = df.head(limit)
        
    # 6. Gestion filename
    def get_basename(path):
        if path and isinstance(path, str) and len(path) > 0:
            return os.path.basename(path)
        return None
    
    df['audio_filename'] = df['audio_filepath'].apply(get_basename)

    # === CORRECTION CRITIQUE ICI ===
    # On supprime la colonne 'delta' (Timedelta) car JSON ne sait pas la lire.
    # On supprime aussi 'start_time' (Datetime) car on utilise 'start_time_iso'
    cols_to_drop = ['delta']
    if 'start_time' in df.columns:
        cols_to_drop.append('start_time')
        
    df = df.drop(columns=cols_to_drop, errors='ignore')
    # ===============================

    return df.to_dict(orient='records')


def get_dashboard_data(period_str='24h', ref_date_str=None):
    period_map = { '1h': timedelta(hours=1), '24h': timedelta(hours=24), '7d': timedelta(days=7), '30d': timedelta(days=30) }
    period_delta = period_map.get(period_str, timedelta(hours=24))
    
    if ref_date_str and len(ref_date_str) > 10:
        try:
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
        if kpis.get('timestamp'): kpis['timestamp'] = kpis['timestamp'].isoformat() + 'Z'

    # Fenêtre
    cursor.execute("SELECT status FROM window_labels ORDER BY timestamp DESC LIMIT 1")
    window_status_raw = cursor.fetchone()
    window_status = window_status_raw if window_status_raw else None
    
    # Labels
    cursor.execute(f"SELECT timestamp, status FROM window_labels WHERE {time_cond} ORDER BY timestamp ASC", params)
    manual_labels = [{'timestamp_iso': l['timestamp'].isoformat() + 'Z', 'status': l['status']} for l in cursor.fetchall()]

    # Historique Capteurs
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
            df['timestamp'] = df['timestamp'].apply(lambda dt: dt.isoformat() + 'Z' if pd.notnull(dt) else None)
        
        df = df.astype(object).where(pd.notna(df), None)
        history_data = df.to_dict('records')

    # Événements Sonores
    cursor.execute(f"SELECT id, start_time, duration_s, sound_type, peak_spl_dba, audio_filepath FROM sound_events WHERE {sound_cond} ORDER BY start_time DESC LIMIT 1000", params)
    events_raw = cursor.fetchall()
    
    if events_raw:
        df_ev = pd.DataFrame(events_raw)
        sound_events_period = process_events_dataframe(df_ev, 1000)
        
        # Ajout manuel des données spectrales
        for event in sound_events_period:
            if event.get('start_time_iso'):
                 ts = datetime.fromisoformat(event['start_time_iso'].replace('Z', ''))
                 cursor.execute("SELECT freq_band_1, freq_band_2, freq_band_3, freq_band_4, freq_band_5, freq_band_6 FROM sensor_data WHERE timestamp >= %s ORDER BY timestamp ASC LIMIT 1", (ts,))
                 spectral_data = cursor.fetchone()
                 if spectral_data: 
                    event['spectral_bands'] = [v for v in spectral_data.values() if v is not None]
    else:
        sound_events_period = []

    
    # Top Événements
    cursor.execute("SELECT id, start_time, duration_s, sound_type, peak_spl_dba, audio_filepath FROM sound_events ORDER BY peak_spl_dba DESC, id DESC LIMIT 20")
    top_events_raw = cursor.fetchall()
    
    if top_events_raw:
        df_top = pd.DataFrame(top_events_raw)
        top_events = process_events_dataframe(df_top, 20)
        
        for event in top_events:
            if event.get('start_time_iso'):
                 ts = datetime.fromisoformat(event['start_time_iso'].replace('Z', ''))
                 cursor.execute("SELECT freq_band_1, freq_band_2, freq_band_3, freq_band_4, freq_band_5, freq_band_6 FROM sensor_data WHERE timestamp >= %s ORDER BY timestamp ASC LIMIT 1", (ts,))
                 spectral_data = cursor.fetchone()
                 if spectral_data: 
                    event['spectral_bands'] = [v for v in spectral_data.values() if v is not None]
    else:
        top_events = []

    cursor.close()
    conn.close()
    
    return { "kpis": kpis, "stats": stats, "history_data": history_data, "events_period": sound_events_period, "top_events": top_events, "window_status": window_status, "manual_labels": manual_labels }