# /home/obafgk/SoundProject/evaluate_and_tune.py

import mysql.connector
import pandas as pd
import numpy as np
import config
from datetime import timedelta
from itertools import product
from tqdm import tqdm

# --- PARAMÈTRES D'ÉVALUATION ---
MATCHING_WINDOW_MINUTES = 10 # Fenêtre de temps élargie pour associer une détection à un label
ANALYSIS_WINDOW_AROUND_LABEL = 15 # Extraire 15 minutes de données autour de chaque label
RANDOM_SAMPLE_PERCENTAGE = 0.1 # 0.1% de données "calmes" pour le test

def get_db_connection():
    try:
        db_config_utc = config.DB_CONFIG.copy()
        db_config_utc['time_zone'] = '+00:00'
        return mysql.connector.connect(**db_config_utc)
    except mysql.connector.Error as err:
        print(f"Erreur de connexion DB : {err}"); return None

def fetch_data(conn):
    print("1. Récupération des données...")
    try:
        labels_df = pd.read_sql("SELECT timestamp, status FROM window_labels WHERE source='manuel' ORDER BY timestamp", conn, index_col='timestamp')
        sensor_data_df = pd.read_sql("SELECT timestamp, temperature_c, humidity_pct, sound_spl_dba, bsec_co2_ppm as co2e FROM sensor_data ORDER BY timestamp", conn, index_col='timestamp')
        sensor_data_df.dropna(inplace=True)
        print(f"   -> {len(labels_df)} labels manuels trouvés.")
        print(f"   -> {len(sensor_data_df)} points de données capteur trouvés.")
        return labels_df, sensor_data_df
    except Exception as e:
        print(f"Erreur lors de la récupération des données : {e}"); return None, None

def create_analysis_sample(labels_df, sensor_data_df):
    print("   -> Création d'un échantillon de données pour l'analyse rapide...")
    if labels_df.empty: return None
    data_slices = []
    labeled_indices = pd.DatetimeIndex([])
    for label_time in labels_df.index:
        start_slice = label_time - timedelta(minutes=ANALYSIS_WINDOW_AROUND_LABEL)
        end_slice = label_time + timedelta(minutes=ANALYSIS_WINDOW_AROUND_LABEL)
        slice_df = sensor_data_df.loc[start_slice:end_slice]
        data_slices.append(slice_df)
        labeled_indices = labeled_indices.union(slice_df.index)
    labeled_data = pd.concat(data_slices).drop_duplicates()
    other_data_indices = sensor_data_df.index.difference(labeled_indices)
    sample_size = int(len(other_data_indices) * (RANDOM_SAMPLE_PERCENTAGE / 100.0))
    if sample_size > 0:
        random_sample_indices = np.random.choice(other_data_indices, sample_size, replace=False)
        random_sample_data = sensor_data_df.loc[random_sample_indices]
        analysis_df = pd.concat([labeled_data, random_sample_data]).sort_index()
    else:
        analysis_df = labeled_data
    print(f"   -> Échantillon créé : {len(analysis_df)} lignes.")
    return analysis_df

def evaluate_performance(labels_df, detections_df):
    if labels_df.empty: return 0.0
    correct_detections = 0
    # Compter les détections qui correspondent à un label
    for label_time, label_row in labels_df.iterrows():
        start_window = label_time - timedelta(minutes=MATCHING_WINDOW_MINUTES)
        end_window = label_time + timedelta(minutes=MATCHING_WINDOW_MINUTES)
        nearby_detections = detections_df.loc[start_window:end_window]
        if not nearby_detections.empty and label_row['status'] in nearby_detections['status'].values:
            correct_detections += 1
    
    # Calcul d'un score F1 pour équilibrer précision et rappel
    true_positives = correct_detections
    false_positives = len(detections_df) - true_positives
    false_negatives = len(labels_df) - true_positives
    
    precision = true_positives / (true_positives + false_positives) if (true_positives + false_positives) > 0 else 0
    recall = true_positives / len(labels_df) if len(labels_df) > 0 else 0
    
    f1_score = 2 * (precision * recall) / (precision + recall) if (precision + recall) > 0 else 0
    return f1_score * 100

def find_best_parameters(labels_df, analysis_df):
    if labels_df.empty: return None
    print("\n2. Lancement de l'optimisation des paramètres...")
    param_grid = {
        'temp_threshold': [0.2, 0.4, 0.6, 0.8], 'humid_threshold': [0.5, 1.0, 2.0],
        'sound_threshold': [1.0, 2.0, 4.0], 'co2_threshold': [2.0, 4.0, 6.0, 8.0],
        'confidence_threshold': [3, 4, 5], 'stability_cycles': [2, 3, 4, 5]
    }
    keys, values = zip(*param_grid.items())
    combinations = [dict(zip(keys, v)) for v in product(*values)]
    best_f1_score = -1
    best_params = None

    analysis_df['temp_change'] = analysis_df['temperature_c'].diff(periods=20)
    analysis_df['humid_change'] = analysis_df['humidity_pct'].diff(periods=20)
    analysis_df['sound_change'] = analysis_df['sound_spl_dba'].diff(periods=20)
    analysis_df['co2_change'] = analysis_df['co2e'].diff(periods=20)
    analysis_df.dropna(inplace=True)

    for params in tqdm(combinations, desc="Test des combinaisons"):
        df = analysis_df.copy()
        df['confidence_score'] = ((df['temp_change'].abs() > params['temp_threshold']) * 2 + (df['humid_change'].abs() > params['humid_threshold']) * 1 + (df['sound_change'].abs() > params['sound_threshold']) * 1 + (df['co2_change'].abs() > params['co2_threshold']) * 5)
        potential_events = df[df['confidence_score'] >= params['confidence_threshold']].copy()
        if potential_events.empty: continue
            
        potential_events['open_score'] = ((potential_events['co2_change'] < -params['co2_threshold']) * 5 + (potential_events['temp_change'] < -params['temp_threshold']) * 2)
        potential_events['close_score'] = ((potential_events['co2_change'] > params['co2_threshold']) * 5 + (potential_events['temp_change'] > params['temp_threshold']) * 2)
        potential_events['status'] = np.where(potential_events['open_score'] > potential_events['close_score'], 'ouverte', 'fermee')
        
        potential_events['block'] = (potential_events['status'] != potential_events['status'].shift()).cumsum()
        block_sizes = potential_events.groupby('block').size()
        stable_blocks = block_sizes[block_sizes >= params['stability_cycles']].index
        stable_events = potential_events[potential_events['block'].isin(stable_blocks)]
        if stable_events.empty: continue
            
        final_events_df = stable_events.drop_duplicates(subset=['block'], keep='first')
        final_events_df['final_block'] = (final_events_df['status'] != final_events_df['status'].shift()).cumsum()
        final_events_df = final_events_df.drop_duplicates(subset=['final_block'], keep='first')
        
        f1_score = evaluate_performance(labels_df, final_events_df)
        if f1_score > best_f1_score:
            best_f1_score = f1_score
            best_params = params
            best_params['f1_score'] = best_f1_score
    return best_params

if __name__ == "__main__":
    conn = get_db_connection()
    if conn:
        labels, sensor_data = fetch_data(conn)
        if labels is not None and not labels.empty:
            analysis_sample = create_analysis_sample(labels, sensor_data)
            if analysis_sample is not None and not analysis_sample.empty:
                best_config = find_best_parameters(labels, analysis_sample)
                print("\n" + "="*60); print("                RAPPORT DE CALIBRATION FINAL"); print("="*60)
                if best_config:
                    print(f"🏆 Meilleure configuration trouvée avec un F1-Score de {best_config.pop('f1_score'):.1f}% !")
                    print("   (Le F1-Score équilibre la détection des vrais événements et l'évitement des faux positifs)")
                    print("\nCopiez ces valeurs dans 'studioAI_metriful_logger.py' et 'historical_window_analyzer.py':\n")
                    print(f"TEMP_CHANGE_THRESHOLD = {best_config['temp_threshold']}")
                    print(f"HUMID_CHANGE_THRESHOLD = {best_config['humid_threshold']}")
                    print(f"SOUND_CHANGE_THRESHOLD = {best_config['sound_threshold']}")
                    print(f"CO2_CHANGE_THRESHOLD = {best_config['co2_threshold']}")
                    print(f"CONFIDENCE_THRESHOLD = {best_config['confidence_threshold']}")
                    print(f"CONSECUTIVE_CYCLES_FOR_EVENT = {best_config['stability_cycles']}")
                    print("\nN'oubliez pas de redémarrer le service 'metriful-logger.service' après modification.")
                else:
                    print("❌ Impossible de trouver une configuration optimale. Essayez d'ajouter plus de labels manuels.")
                print("="*60)
        else:
            print("\nPas assez de labels manuels pour lancer l'évaluation. Veuillez en ajouter via la page de labeling.")
        conn.close()
