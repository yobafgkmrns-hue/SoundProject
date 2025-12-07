#!/bin/bash

# ===================================================================
# == Script de Lancement de l'Environnement de Développement pour SoundProject ==
# ===================================================================

# --- Configuration ---
# Chemin vers le script d'activation de votre environnement virtuel
VENV_PATH="SoundProject2/bin/activate"

# --- Fonctions ---
print_info() {
    echo -e "\033[1;34m[INFO]\033[0m $1"
}

print_warning() {
    echo -e "\033[1;33m[WARN]\033[0m $1"
}

print_error() {
    echo -e "\033[1;31m[ERROR]\033[0m $1"
}

# Variable pour stocker le PID (Process ID) du logger
LOGGER_PID=""

# Fonction de nettoyage, appelée à la sortie du script (Ctrl+C)
cleanup() {
    print_info "\nArrêt des processus de développement..."
    # Tuer le processus logger qui tourne en arrière-plan
    if [ -n "$LOGGER_PID" ] && kill -0 "$LOGGER_PID" 2>/dev/null; then
        kill "$LOGGER_PID"
        wait "$LOGGER_PID" 2>/dev/null
        print_info "Logger (PID: $LOGGER_PID) arrêté."
    fi
    
    # Proposer de relancer les services de production
    read -p "Voulez-vous relancer les services systemd (production) ? (o/n) " -n 1 -r
    echo ""
    if [[ $REPLY =~ ^[Oo]$ ]]; then
        print_info "Redémarrage des services systemd..."
        sudo systemctl start metriful-logger.service
        sudo systemctl start metriful-web.service
        print_info "Services de production relancés."
    fi
    
    exit 0
}

# --- Début du Script ---

# Intercepter le signal de sortie (Ctrl+C) pour lancer la fonction de nettoyage
trap cleanup SIGINT

# 1. Vérifier la branche Git
print_info "Vérification de la branche Git..."
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [ "$CURRENT_BRANCH" != "develop" ]; then
    print_error "Vous n'êtes pas sur la branche 'develop' (branche actuelle: '$CURRENT_BRANCH')."
    print_error "Veuillez faire 'git checkout develop' avant de lancer ce script."
    exit 1
fi
print_info "Vous êtes bien sur la branche 'develop'."

# 2. Arrêter les services de production
print_info "Arrêt des services systemd pour éviter les conflits..."
sudo systemctl stop metriful-logger.service
sudo systemctl stop metriful-web.service
sleep 1

# 3. Activer l'environnement virtuel
if [ -f "$VENV_PATH" ]; then
    print_info "Activation de l'environnement virtuel..."
    source "$VENV_PATH"
else
    print_error "Environnement virtuel non trouvé à '$VENV_PATH'. Veuillez vérifier le chemin."
    cleanup # Appeler cleanup pour proposer de relancer les services
    exit 1
fi

# 4. Lancer les applications de développement
print_info "Lancement du logger en arrière-plan..."
# Utilise le nouveau nom du script : logger.py
python logger.py &
LOGGER_PID=$!

print_info "Lancement du serveur web Flask en avant-plan (utilisez Ctrl+C pour arrêter)..."
python metriful_web/app.py

# Si le serveur web s'arrête pour une raison autre que Ctrl+C, on nettoie quand même
cleanup
