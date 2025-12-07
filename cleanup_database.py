import mysql.connector
import config
from datetime import timedelta
from tqdm import tqdm

# --- PARAMÈTRES DE NETTOYAGE ---
# Fenêtre de temps autour d'un événement sonore à conserver
TIME_WINDOW_BEFORE_EVENT = timedelta(minutes=2)
TIME_WINDOW_AFTER_EVENT = timedelta(minutes=5)

def get_db_connection():
    """Se connecte à la base de données."""
    try:
        return mysql.connector.connect(**config.DB_CONFIG)
    except mysql.connector.Error as err:
        print(f"Erreur de connexion à la base de données : {err}")
        return None

def cleanup_sensor_data(conn):
    """Identifie les enregistrements à conserver et supprime les autres."""
    cursor = conn.cursor()
    ids_to_keep = set()

    # --- ÉTAPE 1: Identifier les enregistrements proches des événements sonores ---
    print("1. Identification des données proches des événements sonores...")
    cursor.execute("SELECT start_time FROM sound_events")
    sound_events = cursor.fetchall()

    if not sound_events:
        print("   -> Aucun événement sonore trouvé.")
    else:
        print(f"   -> Traitement de {len(sound_events)} événements sonores...")
        for (start_time,) in tqdm(sound_events, desc="Analyse des événements"):
            start_bound = start_time - TIME_WINDOW_BEFORE_EVENT
            end_bound = start_time + TIME_WINDOW_AFTER_EVENT
            
            cursor.execute("SELECT id FROM sensor_data WHERE timestamp BETWEEN %s AND %s", (start_bound, end_bound))
            event_ids = {row[0] for row in cursor.fetchall()}
            ids_to_keep.update(event_ids)
        print(f"   -> {len(ids_to_keep)} enregistrements à conserver autour des événements.")

    # --- ÉTAPE 2: Sous-échantillonner le reste des données (1 enregistrement/minute) ---
    print("\n2. Sous-échantillonnage des données générales (1 point par minute)...")
    # Cette requête regroupe par minute et garde l'ID le plus ancien de chaque minute
    query = """
        SELECT MIN(id) 
        FROM sensor_data 
        GROUP BY DATE_FORMAT(timestamp, '%Y-%m-%d %H:%i')
    """
    cursor.execute(query)
    downsampled_ids = {row[0] for row in cursor.fetchall()}
    
    original_size = len(ids_to_keep)
    ids_to_keep.update(downsampled_ids)
    print(f"   -> {len(downsampled_ids)} enregistrements conservés (un par minute).")
    print(f"   -> Total d'enregistrements uniques à conserver : {len(ids_to_keep)}")

    # --- ÉTAPE 3: Confirmation et Suppression ---
    cursor.execute("SELECT COUNT(*) FROM sensor_data")
    total_rows = cursor.fetchone()[0]
    rows_to_delete = total_rows - len(ids_to_keep)

    if rows_to_delete <= 0:
        print("\nNettoyage terminé. Aucune ligne à supprimer.")
        return

    print("\n" + "="*50)
    print("                      RÉSUMÉ AVANT SUPPRESSION")
    print("="*50)
    print(f"Nombre total d'enregistrements actuel : {total_rows}")
    print(f"Nombre d'enregistrements à conserver : {len(ids_to_keep)}")
    print(f"Nombre d'enregistrements à SUPPRIMER : {rows_to_delete}")
    print("="*50)

    confirm = input("Voulez-vous vraiment procéder à la suppression ? Cette action est irréversible. (oui/non): ").lower()

    if confirm != 'oui':
        print("Opération annulée par l'utilisateur.")
        return

    # Utilisation d'une table temporaire pour une suppression sûre et performante
    print("\n3. Suppression des enregistrements inutiles (cela peut prendre un certain temps)...")
    try:
        print("   -> Création d'une table temporaire pour les IDs à conserver...")
        cursor.execute("CREATE TEMPORARY TABLE ids_to_keep_temp (id INT PRIMARY KEY)")

        # Insérer les IDs par lots pour éviter les problèmes de mémoire
        id_list = list(ids_to_keep)
        chunk_size = 10000
        for i in tqdm(range(0, len(id_list), chunk_size), desc="Insertion des IDs"):
            chunk = id_list[i:i + chunk_size]
            # Le formatage doit être fait manuellement pour executemany avec une liste simple
            placeholders = ','.join(['(%s)'] * len(chunk))
            sql = f"INSERT INTO ids_to_keep_temp (id) VALUES {placeholders}"
            cursor.execute(sql, chunk)

        print("   -> Suppression des enregistrements qui ne sont pas dans la table temporaire...")
        delete_query = """
            DELETE s
            FROM sensor_data s
            LEFT JOIN ids_to_keep_temp t ON s.id = t.id
            WHERE t.id IS NULL
        """
        cursor.execute(delete_query)
        
        conn.commit()
        print(f"\n✅ Succès ! {cursor.rowcount} enregistrements ont été supprimés.")
        
    except mysql.connector.Error as err:
        print(f"\n🟥 Erreur lors de la suppression : {err}")
        conn.rollback()
    finally:
        # La table temporaire est automatiquement supprimée à la fin de la session
        cursor.close()

if __name__ == "__main__":
    connection = get_db_connection()
    if connection:
        cleanup_sensor_data(connection)
        connection.close()
    print("\nScript terminé.")
