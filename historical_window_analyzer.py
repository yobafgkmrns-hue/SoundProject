# /home/obafgk/SoundProject/historical_window_analyzer.py

import mysql.connector
import pandas as pd
import numpy as np
import config
from tqdm import tqdm

# --- Paramètres de détection (ajustés pour les moyennes sur 5 minutes) ---
TEMP_CHANGE_THRESHOLD = 0.2
HUMID_CHANGE_THRESHOLD = 0.5
SOUND_CHANGE_THRESHOLD = 1.0
CO2_CHANGE_THRESHOLD = 8.0
CONFIDENCE_THRESHOLD = 3
CONSECUTIVE_CYCLES_FOR_EVENTS = 5

def get_db_connection():
    try:
        db_config_utc = config.DB_CONFIG.copy(); db_config_utc['time_zone'] = '+00:00'
        return mysql.connector.connect(**db_config_utc)
    except mysql.connector.Error as err:
        print(f"Erreur de connexion DB : {err}"); return None

def analyze_historical_data(conn, df):
    print("2. Ré-échantillonnage des données par intervalles de 5 minutes...")
    df_resampled = df.resample('5min').mean()
    df_resampled.dropna(inplace=True)

    if len(df_resampled) < 2:
        print("Pas assez de données pour l'analyse par intervalles de 5 minutes.")
        return

    print(f"   -> Données agrégées en {len(df_resampled)} intervalles de 5 minutes.")
    print("3. Calcul des changements entre les intervalles...")
    
    df_resampled['temp_change'] = df_resampled['temperature_c'].diff()
    df_resampled['humid_change'] = df_resampled['humidity_pct'].diff()
    df_resampled['sound_change'] = df_resampled['sound_spl_dba'].diff()
    df_resampled['co2_change'] = df_resampled['co2e'].diff()
    df_resampled.dropna(inplace=True)

    df_resampled['confidence_score'] = ((df_resampled['temp_change'].abs() > TEMP_CHANGE_THRESHOLD) * 2 +
                                      (df_resampled['humid_change'].abs() > HUMID_CHANGE_THRESHOLD) * 1 +
                                      (df_resampled['sound_change'].abs() > SOUND_CHANGE_THRESHOLD) * 1 +
                                      (df_resampled['co2_change'].abs() > CO2_CHANGE_THRESHOLD) * 5)

    potential_events = df_resampled[df_resampled['confidence_score'] >= CONFIDENCE_THRESHOLD].copy()

    if potential_events.empty:
        print("Aucun changement d'état significatif détecté.")
        return

    potential_events['open_score'] = ((potential_events['co2_change'] < -CO2_CHANGE_THRESHOLD) * 5 + (potential_events['temp_change'] < -TEMP_CHANGE_THRESHOLD) * 2)
    potential_events['close_score'] = ((potential_events['co2_change'] > CO2_CHANGE_THRESHOLD) * 5 + (potential_events['temp_change'] > TEMP_CHANGE_THRESHOLD) * 2)
    potential_events['status'] = np.where(potential_events['open_score'] > potential_events['close_score'], 'ouverte', 'fermee')

    potential_events['block'] = (potential_events['status'] != potential_events['status'].shift()).cumsum()
    final_events_df = potential_events.drop_duplicates(subset=['block'], keep='first')

    print(f"   -> {len(final_events_df)} changements d'état stables identifiés.")
    if final_events_df.empty:
        print("Aucun événement final à insérer.")
        return

    print("4. Insertion des événements détectés...")
    
    # ====================================================================
    # == DÉBUT DE LA CORRECTION : Construction explicite des enregistrements ==
    # ====================================================================
    records_to_insert = []
    for timestamp, row in final_events_df.iterrows():
        record = {
            'timestamp': timestamp.to_pydatetime(),
            'status': row.get('status'),
            'temp_change': row.get('temp_change'),
            'humidity_change': row.get('humid_change'), # Correction de la faute de frappe
            'sound_change': row.get('sound_change'),
            'co2_change': row.get('co2_change'),
            'confidence_score': int(row.get('confidence_score', 0))
        }
        records_to_insert.append(record)
    # ====================================================================
    # == FIN DE LA CORRECTION                                           ==
    # ====================================================================

    cursor = conn.cursor()
    sql = "INSERT INTO window_events (timestamp, status, temp_change, humidity_change, sound_change, co2_change, confidence_score) VALUES (%(timestamp)s, %(status)s, %(temp_change)s, %(humidity_change)s, %(sound_change)s, %(co2_change)s, %(confidence_score)s)"
    try:
        cursor.executemany(sql, records_to_insert)
        conn.commit(); print(f"\n   -> Succès ! {cursor.rowcount} événements insérés.")
    except Exception as e:
        print(f"Erreur lors de l'insertion : {e}"); conn.rollback()
    finally:
        cursor.close()

if __name__ == "__main__":
    conn = get_db_connection()
    if conn:
        print("="*50); print("   Analyseur d'historique (v5.1 - Resampling stable)"); print("="*50)
        choice = input("Vider la table 'window_events' et recalculer l'historique ? (oui/non): ").lower()
        if choice in ['oui', 'o']:
            try:
                print("1. Récupération des données...")
                query = "SELECT timestamp, temperature_c, humidity_pct, sound_spl_dba, bsec_co2_ppm as co2e FROM sensor_data ORDER BY timestamp ASC"
                sensor_data = pd.read_sql(query, conn, index_col='timestamp')
                print(f"   -> {len(sensor_data)} lignes de données récupérées.")
            except Exception as e:
                sensor_data = None; print(f"Erreur critique: {e}")
            if sensor_data is not None and not sensor_data.empty:
                cursor = conn.cursor(); print("\nNettoyage de la table 'window_events'..."); cursor.execute("TRUNCATE TABLE window_events"); conn.commit(); cursor.close(); print("Table nettoyée.")
                analyze_historical_data(conn, sensor_data)
        else:
            print("Opération annulée.")
        conn.close()
        print("\nAnalyse terminée.")
