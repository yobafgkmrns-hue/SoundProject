# /home/obafgk/SoundProject/metriful_web/app.py

from flask import Flask, render_template, request, jsonify, send_from_directory, Response, stream_with_context
import time
import os
import sys

# Import de votre module de données
from data_processor import get_dashboard_data

app = Flask(__name__)

# --- CHEMINS (Absolus pour éviter les erreurs) ---
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(BASE_DIR)
AUDIO_EVENTS_PATH = os.path.join(PROJECT_ROOT, 'audio_events')

# Fichiers de communication entre le Logger et le Serveur Web
NEW_EVENT_SIGNAL_FILE = "/home/obafgk/SoundProject/new_event.signal"
NEW_SENSOR_SIGNAL_FILE = "/home/obafgk/SoundProject/new_sensor.signal"

print(f"--- SERVEUR WEB ACTIF ---")
print(f"Signal Événement: {NEW_EVENT_SIGNAL_FILE}")
print(f"Signal Capteur:   {NEW_SENSOR_SIGNAL_FILE}")

@app.route('/api/stream_events')
def stream_events():
    @stream_with_context
    def event_stream():
        print(f"[{time.strftime('%H:%M:%S')}] SSE: Nouveau client connecté.")
        
        # Lecture des états initiaux pour les deux fichiers pour éviter les fausses alertes au démarrage
        last_event_token = ""
        last_sensor_token = ""
        
        try:
            if os.path.exists(NEW_EVENT_SIGNAL_FILE):
                with open(NEW_EVENT_SIGNAL_FILE, 'r') as f: last_event_token = f.read().strip()
            if os.path.exists(NEW_SENSOR_SIGNAL_FILE):
                with open(NEW_SENSOR_SIGNAL_FILE, 'r') as f: last_sensor_token = f.read().strip()
        except Exception as e:
            print(f"Erreur lecture état initial des signaux: {e}")

        # Boucle de surveillance
        while True:
            try:
                # 1. Vérification Événements Sonores
                if os.path.exists(NEW_EVENT_SIGNAL_FILE):
                    with open(NEW_EVENT_SIGNAL_FILE, 'r') as f: current_event_token = f.read().strip()
                    if current_event_token != last_event_token and current_event_token != "":
                        last_event_token = current_event_token
                        print(f"🔔 SSE: Événement sonore détecté -> Envoi 'new_event'.")
                        yield f"data: new_event\n\n"

                # 2. Vérification Données Capteurs (KPIs)
                if os.path.exists(NEW_SENSOR_SIGNAL_FILE):
                    with open(NEW_SENSOR_SIGNAL_FILE, 'r') as f: current_sensor_token = f.read().strip()
                    if current_sensor_token != last_sensor_token and current_sensor_token != "":
                        last_sensor_token = current_sensor_token
                        print(f"🌡️ SSE: Données capteurs détectées -> Envoi 'new_sensor'.")
                        yield f"data: new_sensor\n\n"
                
                # 3. Heartbeat (toutes les secondes pour garder la connexion active)
                yield ": keep-alive\n\n"
                
                time.sleep(1)
                
            except GeneratorExit:
                print(f"[{time.strftime('%H:%M:%S')}] SSE: Client déconnecté.")
                break
            except Exception as e:
                print(f"SSE Erreur critique: {e}")
                time.sleep(1)

    # Headers pour forcer le streaming et empêcher le cache
    response = Response(event_stream(), mimetype="text/event-stream")
    response.headers["Cache-Control"] = "no-cache"
    response.headers["X-Accel-Buffering"] = "no"
    return response

# --- ROUTES STANDARD ---
@app.route('/')
def index():
    dashboard_data = get_dashboard_data('24h')
    return render_template('index.html', **dashboard_data)

@app.route('/v2')
def dashboard_v2():
    dashboard_data = get_dashboard_data('24h')
    return render_template('dashboard_v2.html', **dashboard_data)

@app.route('/api/data')
def api_data():
    period = request.args.get('period', '24h')
    ref_date = request.args.get('ref_date', None)
    dashboard_data = get_dashboard_data(period, ref_date)
    return jsonify(dashboard_data)

@app.route('/audio_files/<path:filename>')
def serve_audio_file(filename):
    return send_from_directory(AUDIO_EVENTS_PATH, filename)

@app.route('/labeling')
def labeling_page(): return render_template('labeling.html', detected_events=[], manual_labels=[]) 

@app.route('/audio_review')
def audio_review_page(): return render_template('audio_review.html', sound_events=[], sound_types=[])

if __name__ == '__main__':
    # Initialisation des fichiers signaux au démarrage
    for signal_file in [NEW_EVENT_SIGNAL_FILE, NEW_SENSOR_SIGNAL_FILE]:
        if not os.path.exists(signal_file):
            with open(signal_file, 'w') as f: f.write("")
            try: os.chmod(signal_file, 0o666)
            except Exception as e: print(f"Impossible de changer les permissions de {signal_file}: {e}")

    if not os.path.exists(AUDIO_EVENTS_PATH): os.makedirs(AUDIO_EVENTS_PATH)
    
    # Lancement du serveur en mode multithread (essentiel pour SSE)
    app.run(host='0.0.0.0', port=5000, debug=True, use_reloader=False, threaded=True)