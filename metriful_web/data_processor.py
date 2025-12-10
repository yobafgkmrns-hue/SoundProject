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
    if df.empty: return []
    df = df.sort_values(by='start_time')
    df['delta'] = df['start_time'].diff()
    def format_delta(x):
        if pd.isnull(x): return "-"
        total_seconds = int(x.total_seconds())
        if total_seconds < 60: return f"{total_seconds}s"
        minutes = total_seconds // 60
        if minutes < 60: return f"{minutes}m"
        hours = minutes // 60; minutes = minutes % 60
        return f"{hours}h{minutes:02d}"
    df['duration_since_prev'] = df['delta'].apply(format_delta)
    df['start_time_iso'] = df['start_time'].apply(lambda x: x.isoformat() + 'Z' if pd.notnull(x) else None)
    df = df.sort_values(by='start_time', ascending=False)
    if len(df) > limit: df = df.head(limit)
    def get_basename(path):
        if path and isinstance(path, str): return os.path.basename(path)
        return None
    df['audio_filename'] = df['audio_filepath'].apply(get_basename)
    df = df.drop(columns=['delta', 'start_time'], errors='ignore')
    return df.to_dict(orient='records')

def get_dashboard_data(period_str='24h', ref_date_str=None):
    conn = get_db_connection()
    if not conn: 
        return { "kpis": {}, "stats": {}, "history_data": [], "events_period": [], "top_events": [], "window_status": None, "manual_labels": [] }
        
    cursor = conn.cursor(dictionary=True)

    # 1. KPI Actuel
    cursor.execute("SELECT * FROM sensor_data ORDER BY id DESC LIMIT 1")
    kpis_now = cursor.fetchone()
    if not kpis_now: kpis_now = {}

    # 2. KPIs Passés pour la tendance
    now = datetime.utcnow()
    past_timestamps = {
        '24h': now - timedelta(hours=24),
        '7d': now - timedelta(days=7),
        '30d': now - timedelta(days=30)
    }
    
    kpis_past = {}
    for period, ts in past_timestamps.items():
        cursor.execute("SELECT * FROM sensor_data WHERE timestamp <= %s ORDER BY timestamp DESC LIMIT 1", (ts,))
        kpis_past[period] = cursor.fetchone()

    # 3. Formatage KPI
    kpis_formatted = {}
    trend_keys = ['temperature_c', 'humidity_pct', 'pressure_pa', 'aqi', 'bsec_co2_ppm', 'light_lux', 'sound_spl_dba']
    
    for key in trend_keys:
        current_value = kpis_now.get(key)
        kpis_formatted[key] = {"value": current_value, "delta_24h": None, "delta_7d": None, "delta_30d": None}
        
        if current_value is not None:
            for period, past_data in kpis_past.items():
                if past_data and past_data.get(key) is not None:
                    delta = current_value - past_data[key]
                    kpis_formatted[key][f'delta_{period}'] = delta
    
    kpis_formatted['humidex'] = {'value': calculate_humidex(kpis_now.get('temperature_c'), kpis_now.get('humidity_pct'))}
    kpis_formatted['timestamp'] = {'value': kpis_now.get('timestamp').isoformat() + 'Z' if kpis_now.get('timestamp') else None}

    # 4. Historique Capteurs
    period_delta = timedelta(hours={'1h': 1, '24h': 24, '7d': 168, '30d': 720}.get(period_str, 24))
    reference_date = datetime.fromisoformat(ref_date_str.replace('Z','')) if ref_date_str else datetime.utcnow()
    time_threshold = reference_date - period_delta

    time_cond = "timestamp >= %s AND timestamp <= %s" if ref_date_str else "timestamp >= %s"
    sound_cond = "start_time >= %s AND start_time <= %s" if ref_date_str else "start_time >= %s"
    params = (time_threshold, reference_date) if ref_date_str else (time_threshold,)

    cursor.execute("SELECT status FROM window_labels ORDER BY timestamp DESC LIMIT 1")
    window_status = cursor.fetchone()
    
    cursor.execute(f"SELECT timestamp, status FROM window_labels WHERE {time_cond} ORDER BY timestamp ASC", params)
    manual_labels = [{'timestamp_iso': l['timestamp'].isoformat() + 'Z', 'status': l['status']} for l in cursor.fetchall()]

    cursor.execute(f"SELECT * FROM sensor_data WHERE {time_cond} ORDER BY timestamp ASC", params)
    history_data_raw = cursor.fetchall()
    
    stats, history_data = {}, []
    
    # --- CALCUL DE LA TENDANCE ---
    if history_data_raw:
        df = pd.DataFrame(history_data_raw)
        
        # PARAMÈTRE DE LISSAGE (5 minutes)
        TREND_WINDOW_SIZE = 20 
        
        data_cols = ['temperature_c','humidity_pct','pressure_pa','aqi','bsec_co2_ppm','light_lux','sound_spl_dba']
        for col in data_cols:
            if col in df.columns:
                df[col] = pd.to_numeric(df[col], errors='coerce')
                if not df[col].isnull().all():
                    if len(df[col].dropna()) >= 1: 
                        df[f'{col}_rolling_mean'] = df[col].rolling(window=TREND_WINDOW_SIZE, min_periods=1, center=True).mean()
                    else: 
                        df[f'{col}_rolling_mean'] = pd.NA
                    stats[col] = {'mean':df[col].mean(),'median':df[col].median(),'std_dev':df[col].std(),'min':df[col].min(),'max':df[col].max()}
        
        if 'temperature_c' in df.columns and 'humidity_pct' in df.columns:
            df['humidex'] = calculate_humidex(df['temperature_c'], df['humidity_pct'])
            if 'humidex' in df.columns and not df['humidex'].isnull().all():
                 df['humidex_rolling_mean'] = df['humidex'].rolling(window=TREND_WINDOW_SIZE, min_periods=1, center=True).mean()
            else:
                 df['humidex_rolling_mean'] = pd.NA

        if 'timestamp' in df.columns: df['timestamp'] = df['timestamp'].apply(lambda dt: dt.isoformat() + 'Z' if pd.notnull(dt) else None)
        df = df.astype(object).where(pd.notna(df), None)
        history_data = df.to_dict('records')

    # 5. Événements Sonores
    cursor.execute(f"SELECT id, start_time, duration_s, sound_type, peak_spl_dba, audio_filepath FROM sound_events WHERE {sound_cond} ORDER BY start_time DESC LIMIT 1000", params)
    events_raw = cursor.fetchall()
    if events_raw:
        df_ev = pd.DataFrame(events_raw)
        sound_events_period = process_events_dataframe(df_ev, 1000) 
        for event in sound_events_period:
            if event.get('start_time_iso'):
                 ts = datetime.fromisoformat(event['start_time_iso'].replace('Z', ''))
                 cursor.execute("SELECT freq_band_1, freq_band_2, freq_band_3, freq_band_4, freq_band_5, freq_band_6 FROM sensor_data WHERE timestamp >= %s ORDER BY timestamp ASC LIMIT 1", (ts,))
                 spectral_data = cursor.fetchone()
                 if spectral_data: event['spectral_bands'] = [v for v in spectral_data.values() if v is not None]
    else:
        sound_events_period = []

    # Top Événements
    cursor.execute("SELECT id, start_time, duration_s, sound_type, peak_spl_dba, audio_filepath FROM sound_events ORDER BY peak_spl_dba DESC, id DESC LIMIT 20")
    top_events_raw = cursor.fetchall()
    top_events = []
    if top_events_raw:
        df_top = pd.DataFrame(top_events_raw)
        df_top['start_time_iso'] = df_top['start_time'].apply(lambda x: x.isoformat() + 'Z' if pd.notnull(x) else None)
        def get_basename(path):
            if path and isinstance(path, str): return os.path.basename(path)
            return None
        df_top['audio_filename'] = df_top['audio_filepath'].apply(get_basename)
        top_events = df_top.to_dict(orient='records')
        for event in top_events:
            if event.get('start_time_iso'):
                 ts = datetime.fromisoformat(event['start_time_iso'].replace('Z', ''))
                 cursor.execute("SELECT freq_band_1, freq_band_2, freq_band_3, freq_band_4, freq_band_5, freq_band_6 FROM sensor_data WHERE timestamp >= %s ORDER BY timestamp ASC LIMIT 1", (ts,))
                 spectral_data = cursor.fetchone()
                 if spectral_data: event['spectral_bands'] = [v for v in spectral_data.values() if v is not None]
    
    cursor.close()
    conn.close()
    
    return { "kpis": kpis_formatted, "stats": stats, "history_data": history_data, "events_period": sound_events_period, "top_events": top_events, "window_status": window_status, "manual_labels": manual_labels }