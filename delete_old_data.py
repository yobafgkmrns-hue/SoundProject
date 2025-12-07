# /home/obafgk/SoundProject/delete_old_data.py

import mysql.connector
import config
import sys

# Date limite de suppression (Format YYYY-MM-DD HH:MM:SS)
CUTOFF_DATE = "2025-11-01 00:00:00"

# Configuration des tables et de leur colonne de date respective
TABLES_CONFIG = {
    'sensor_data': 'timestamp',
    'window_events': 'timestamp',
    'window_labels': 'timestamp',
    'sound_events': 'start_time'  # Attention : colonne nommée start_time ici
}

def get_db_connection():
    try:
        return mysql.connector.connect(**config.DB_CONFIG)
    except mysql.connector.Error as err:
        print(f"Erreur de connexion DB : {err}")
        return None

def clean_database():
    conn = get_db_connection()
    if not conn:
        return

    cursor = conn.cursor()
    total_deleted = 0

    print("=" * 60)
    print(f"NETTOYAGE DE LA BASE DE DONNÉES (Avant le {CUTOFF_DATE})")
    print("=" * 60)

    # 1. Estimation du volume à supprimer
    print("\n--- Analyse des données à supprimer ---")
    rows_to_delete = {}
    has_data = False

    for table, date_col in TABLES_CONFIG.items():
        try:
            # Compter les lignes concernées
            sql_count = f"SELECT COUNT(*) FROM {table} WHERE {date_col} < %s"
            cursor.execute(sql_count, (CUTOFF_DATE,))
            count = cursor.fetchone()[0]
            rows_to_delete[table] = count
            print(f" - Table '{table}' : {count} lignes trouvées.")
            if count > 0:
                has_data = True
        except mysql.connector.Error as err:
            print(f"Erreur analyse table {table}: {err}")

    if not has_data:
        print("\n✅ Aucune donnée ancienne trouvée. Tout est propre.")
        conn.close()
        return

    # 2. Demande de confirmation
    print("\n⚠️  ATTENTION : Cette action est IRREVERSIBLE.")
    confirm = input(f"Voulez-vous supprimer définitivement ces enregistrements ? (oui/non) : ").lower()

    if confirm not in ['oui', 'o', 'yes', 'y']:
        print("Opération annulée.")
        conn.close()
        return

    # 3. Suppression
    print("\n--- Suppression en cours ---")
    for table, count in rows_to_delete.items():
        if count > 0:
            date_col = TABLES_CONFIG[table]
            print(f"Nettoyage de '{table}'...", end=" ", flush=True)
            try:
                sql_delete = f"DELETE FROM {table} WHERE {date_col} < %s"
                cursor.execute(sql_delete, (CUTOFF_DATE,))
                conn.commit()
                print(f"✅ {cursor.rowcount} lignes supprimées.")
                total_deleted += cursor.rowcount
            except mysql.connector.Error as err:
                print(f"🟥 Erreur : {err}")
                conn.rollback()

    # 4. Optimisation (pour libérer l'espace disque)
    print("\n--- Optimisation des tables (récupération espace disque) ---")
    for table in TABLES_CONFIG.keys():
        print(f"Optimisation de '{table}'...", end=" ", flush=True)
        try:
            cursor.execute(f"OPTIMIZE TABLE {table}")
            # OPTIMIZE TABLE ne retourne pas de rowcount standard, on ignore le résultat
            # Mais on doit lire le résultat pour vider le buffer
            cursor.fetchall() 
            print("✅")
        except mysql.connector.Error as err:
            print(f"⚠️ Erreur (non critique) : {err}")

    cursor.close()
    conn.close()
    print("=" * 60)
    print("TERMINE.")

if __name__ == "__main__":
    clean_database()
