import mysql.connector
import config
import sys

# FACTEUR DE RÉDUCTION
# 20 signifie : on garde 1 ligne, on en supprime 19.
# Cela transforme des données toutes les 3s en données toutes les 60s (approx).
KEEP_ONE_EVERY = 20

def get_db_connection():
    try:
        return mysql.connector.connect(**config.DB_CONFIG)
    except mysql.connector.Error as err:
        print(f"Erreur de connexion à la base de données : {err}")
        return None

def clean_history():
    conn = get_db_connection()
    if not conn:
        return

    cursor = conn.cursor()

    print("--- NETTOYAGE DE L'HISTORIQUE SENSOR_DATA ---")
    print(f"Objectif : Ne garder qu'une mesure sur {KEEP_ONE_EVERY} pour alléger la base.")
    print("La table 'sound_events' (les alertes audio) NE SERA PAS touchée.")
    
    # 1. Récupérer tous les IDs triés par date
    print("Récupération des IDs existants... (Cela peut prendre quelques secondes)")
    cursor.execute("SELECT id FROM sensor_data ORDER BY timestamp ASC")
    all_ids = [row[0] for row in cursor.fetchall()]
    
    total_rows = len(all_ids)
    if total_rows == 0:
        print("La table est vide. Rien à faire.")
        conn.close()
        return

    # 2. Identifier les IDs à supprimer
    ids_to_keep = []
    ids_to_delete = []

    for index, row_id in enumerate(all_ids):
        # On garde le premier (index 0), le 20ème (index 19), etc.
        if index % KEEP_ONE_EVERY == 0:
            ids_to_keep.append(row_id)
        else:
            ids_to_delete.append(row_id)

    count_delete = len(ids_to_delete)
    count_keep = len(ids_to_keep)

    print(f"\n--- RAPPORT D'ANALYSE ---")
    print(f"Total actuel     : {total_rows} lignes")
    print(f"Lignes à garder  : {count_keep}")
    print(f"Lignes à EFFACER : {count_delete}")
    print(f"Taux de réduction: {count_delete / total_rows * 100:.1f}%")
    print("-------------------------")

    if count_delete == 0:
        print("La base est déjà optimisée ou trop petite.")
        conn.close()
        return

    # 3. Demande de confirmation
    confirm = input("⚠️  Êtes-vous SÛR de vouloir supprimer ces lignes définitivement ? (oui/non) : ")
    
    if confirm.lower() != "oui":
        print("Annulation. Aucune donnée n'a été supprimée.")
        conn.close()
        return

    # 4. Suppression par lots (pour ne pas bloquer la DB)
    print("Suppression en cours...")
    batch_size = 1000
    total_deleted = 0

    # On transforme la liste en liste de tuples pour l'execute many ou string pour IN
    # Pour être plus efficace avec DELETE WHERE id IN (...)
    
    # On procède par tranches de 1000
    for i in range(0, len(ids_to_delete), batch_size):
        batch = ids_to_delete[i:i + batch_size]
        # Création de la chaine "ID, ID, ID"
        format_strings = ','.join(['%s'] * len(batch))
        delete_query = f"DELETE FROM sensor_data WHERE id IN ({format_strings})"
        
        try:
            cursor.execute(delete_query, tuple(batch))
            conn.commit()
            total_deleted += cursor.rowcount
            sys.stdout.write(f"\rProgression : {total_deleted} / {count_delete} lignes supprimées...")
            sys.stdout.flush()
        except Exception as e:
            print(f"\nErreur lors de la suppression : {e}")
            conn.rollback()
            break

    print("\n\n✅ Nettoyage terminé avec succès !")
    
    # Optimisation de la table pour libérer l'espace disque réel
    print("Optimisation de la table (OPTIMIZE TABLE)...")
    cursor.execute("OPTIMIZE TABLE sensor_data")
    conn.close()

if __name__ == "__main__":
    clean_history()
