# /home/obafgk/SoundProject/metriful_web/app.py

from flask import Flask, render_template, request, jsonify, send_from_directory, Response
import time
from datetime import datetime, timedelta, timezone
import mysql.connector
import os

from data_processor import get_dashboard_data, get_db_connection

app = Flask(__name__)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(BASE_DIR)
AUDIO_EVENTS_PATH = os.path.join(PROJECT_ROOT, 'audio_events')
NEW_EVENT_SIGNAL_FILE = os.path.join(BASE_DIR, "new_event.signal")

@app.route('/api/stream_events')
def stream_events():
    def event_stream():
        # Initialisation : on lit l'état actuel du fichier pour ne pas déclencher tout de suite
        last_token = ""
        if os.path.exists(NEW_EVENT_SIGNAL_FILE):
            with open(NEW_EVENT_SIGNAL_FILE, 'r') as f:
                last_token = f.read()

        while True:
            try:
                if os.path.exists(NEW_EVENT_SIGNAL_FILE):
                    with open(NEW_EVENT_SIGNAL_FILE, 'r') as f:
                        current_token = f.read()
                    
                    # Si le contenu du fichier a changé (nouveau timestamp écrit par le logger)
                    if current_token != last_token and current_token.strip() != "":
                        last_token = current_token
                        print(f"SSE: Signal détecté (Token: {current_token}) -> Notification client.")
                        yield 'data: new_event\n\n'
                        
                time.sleep(1) # Vérification chaque seconde
            except GeneratorExit:
                print("SSE: Client déconnecté.")
                break
            except Exception as e:
                print(f"SSE Erreur: {e}")
                time.sleep(5) # Pause en cas d'erreur
    
    return Response(event_stream(), mimetype="text/event-stream")

@app.route('/')
def index():
    dashboard_data = get_dashboard_data('24h')
    return render_template('index.html', **dashboard_data)


# === DEBUT DE L'AJOUT ===
@app.route('/v2')
def dashboard_v2():
    # Utilise exactement les mêmes données que la vue principale
    dashboard_data = get_dashboard_data('24h')
    return render_template('dashboard_v2.html', **dashboard_data)
# === FIN DE L'AJOUT ===


@app.route('/api/data')
def api_data():
    period = request.args.get('period', '24h')
    ref_date = request.args.get('ref_date', None)
    dashboard_data = get_dashboard_data(period, ref_date)
    return jsonify(dashboard_data)

@app.route('/audio_files/<filename>')
def serve_audio_file(filename):
    if '..' in filename or filename.startswith('/'): return "Invalide", 400
    try: return send_from_directory(AUDIO_EVENTS_PATH, filename, as_attachment=False)
    except FileNotFoundError: return "Non trouvé", 404

# ... (Les autres routes /labeling, /api/labels, etc. restent identiques) ...
@app.route('/labeling')
def labeling_page():
    # (Code inchangé)
    conn = get_db_connection()
    if not conn: return "Erreur DB", 500
    # ... (rest of function)
    return render_template('labeling.html', detected_events=[], manual_labels=[]) # Simplifié pour l'exemple

@app.route('/api/labels', methods=['POST'])
def add_label():
    # (Code inchangé)
    return jsonify({'success': True})

@app.route('/audio_review')
def audio_review_page():
    # (Code inchangé)
    return render_template('audio_review.html', sound_events=[], sound_types=[])

@app.route('/api/review_sound', methods=['POST'])
def update_sound_review():
    # (Code inchangé)
    return jsonify({'success': True})

if __name__ == '__main__':
    if not os.path.exists(AUDIO_EVENTS_PATH): os.makedirs(AUDIO_EVENTS_PATH)
    # Threaded=True est important pour gérer SSE et les requêtes en même temps
    app.run(host='0.0.0.0', port=5000, debug=True, use_reloader=False, threaded=True)
