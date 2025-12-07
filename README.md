# SoundProject - Système de Surveillance Environnementale et Acoustique


*(Note : Pensez à remplacer le lien ci-dessus par une capture d'écran de votre tableau de bord !)*

**SoundProject** est un système complet de surveillance et d'analyse de l'environnement, conçu pour fonctionner en continu sur un Raspberry Pi 4. Il collecte des données via un capteur Metriful MS430 et un microphone USB, les stocke dans une base de données MariaDB, et les présente sur une interface web interactive développée avec Flask et Chart.js.

## Fonctionnalités Principales

- **Tableau de Bord Complet :** Visualisation en temps réel et historique des données de température, humidité, pression, luminosité, qualité de l'air (AQI), et CO₂ équivalent.
- **Détection d'Événements Sonores :** Déclenche des enregistrements audio lorsque le niveau sonore dépasse un seuil configurable.
- **Classification Sonore Intelligente :** Analyse la signature spectrale des événements sonores pour les classifier en catégories : **Sirène, Moteur, Voix, Musique, Intérieur, et Autre**.
- **Détection de l'État de la Fenêtre :** Un algorithme heuristique analyse les variations conjointes des capteurs pour déduire si une fenêtre à proximité est **ouverte** ou **fermée**.
- **Outils de Calibration Manuelle :** Des pages web dédiées permettent à l'utilisateur d'annoter ("labelliser") les événements (état de la fenêtre, type de son) pour améliorer la précision des algorithmes.
- **Architecture Robuste :** Le système est découpé en modules (logger, analyse, web) et utilise des services `systemd` pour un fonctionnement autonome et un redémarrage automatique.

## Architecture Technique

Le projet est articulé autour de plusieurs composants clés qui communiquent via une base de données centrale :

- **Matériel :**
  - Raspberry Pi 4
  - Capteur Metriful MS430 (connecté en I2C)
  - Microphone USB (Samson Go Mic)
- **Collecte & Analyse (`logger.py`, `analysis/`) :**
  - Un service Python continu qui lit les données du capteur toutes les 3 secondes.
  - Applique les algorithmes de détection et de classification.
  - Enregistre les données brutes et les événements dans la base de données.
- **Stockage :**
  - Base de données **MariaDB (MySQL)** avec des tables pour les données de capteurs, les événements sonores, et les annotations manuelles.
- **Serveur Web (`metriful_web/`) :**
  - Un backend léger basé sur **Flask**.
  - Un module de traitement de données (`data_processor.py`) qui utilise **Pandas** et **NumPy** pour agréger et préparer les données.
  - Une API RESTful qui expose les données au format JSON.
- **Interface Utilisateur (`templates/`, `static/`) :**
  - Une interface web dynamique construite en HTML, CSS, et JavaScript.
  - Utilise **Chart.js** pour la visualisation des graphiques.

## Installation

### 1. Prérequis Système
- Un Raspberry Pi 4 avec Raspberry Pi OS (Debian 12 "Bookworm" ou plus récent).
- `git`, `python3-venv`, `mariadb-server`, `i2c-tools`, `alsa-utils`.

### 2. Configuration Matérielle
- Activer l'interface I2C via `sudo raspi-config`.
- Brancher le capteur Metriful MS430 en respectant le schéma de câblage (3.3V, GND, SDA, SCL, RDY).
- Brancher le microphone USB.

### 3. Base de Données
- Sécuriser l'installation de MariaDB (`sudo mysql_secure_installation`).
- Créer la base de données, un utilisateur et accorder les privilèges.
- Créer les tables en utilisant un script SQL (fourni dans la documentation du projet).

### 4. Application
1.  Cloner le dépôt Git.
2.  Créer et activer un environnement virtuel Python :
    ```bash
    python3 -m venv venv
    source venv/bin/activate
    ```
3.  Installer les dépendances :
    ```bash
    pip install -r requirements.txt
    ```
4.  Copier `config.py.example` en `config.py` et y insérer les identifiants de la base de données.
5.  Configurer les services `systemd` (`metriful-logger.service`, `metriful-web.service`) pour un lancement automatique.

## Utilisation

- **Logger :** Le script `logger.py` est lancé en tant que service `systemd` et ne nécessite pas d'interaction.
- **Tableau de Bord :** Accessible via `http://<IP_DU_RASPBERRY_PI>:5000`.
- **Développement :** Utiliser le script `./start_dev.sh` sur la branche `develop` pour lancer les applications manuellement et voir les logs en direct.
- **Calibration :**
  - `/labeling` : Pour annoter les ouvertures/fermetures de la fenêtre.
  - `/audio_review` : Pour écouter les enregistrements et corriger la classification des sons.
  - `evaluate_and_tune.py` : Script à lancer pour optimiser les algorithmes de détection en se basant sur les annotations manuelles.

## Structure des Fichiers Clés

- **`logger.py`**: Boucle principale de collecte des données.
- **`analysis/`**: Contient les modules de logique "intelligente" (classification sonore, détection de fenêtre).
- **`metriful_web/app.py`**: Gère les routes du serveur web.
- **`metriful_web/data_processor.py`**: Prépare toutes les données pour l'affichage.
- **`metriful_web/static/`**: Fichiers CSS et JavaScript.
- **`metriful_web/templates/`**: Fichiers HTML.
- **`config.py`**: Configuration centralisée (DB, seuils).
