# /home/obafgk/SoundProject/analysis/sound_classifier.py

import numpy as np

# Seuil (en dBA) pour la bande de 63Hz. Si le niveau moyen de cette bande 
# pendant l'événement est en dessous, on considère qu'il n'y a pas de bruit de fond extérieur.
# A ajuster si nécessaire. 50.0 est un bon point de départ.
LOW_FREQ_FLOOR_DB = 50.0

def advanced_classify(spectral_history):
    """
    Analyse un historique de données spectrales pour classifier un événement sonore complet.
    """
    if not spectral_history or len(spectral_history) < 2:
        return "Autre"
        
    history = np.array([s for s in spectral_history if s is not None and all(v is not None for v in s)])
    if history.shape[0] < 2:
        return "Autre"

    # --- 1. Calcul des caractéristiques ---
    mean_spectrum = np.mean(history, axis=0)
    std_spectrum = np.std(history, axis=0)
    peak_indices = np.argmax(history, axis=1)
    peak_jumps = np.sum(peak_indices[:-1] != peak_indices[1:])
    
    total_energy = np.sum(mean_spectrum)
    if total_energy == 0: return "Autre"
    
    low_energy_ratio = (mean_spectrum[0] + mean_spectrum[1]) / total_energy
    mid_energy_ratio = (mean_spectrum[2] + mean_spectrum[3]) / total_energy
    high_energy_ratio = (mean_spectrum[4] + mean_spectrum[5]) / total_energy
    total_std = np.mean(std_spectrum)

    print(f"DEBUG CLASSIFY: Durée={len(history)}c, VarTot={total_std:.1f}, "
          f"SautsPic={peak_jumps}, RatioBasses={low_energy_ratio:.2f}, "
          f"RatioMids={mid_energy_ratio:.2f}, "
          f"NiveauBasses={mean_spectrum[0]:.1f}dBA")

    # --- 2. Arbre de décision ---

    # ====================================================================
    # == DÉBUT MODIFICATION : Ajout de la règle pour les sons intérieurs  ==
    # ====================================================================
    # Règle pour les sons INTÉRIEURS : son très variable mais SANS le bruit de fond des basses fréquences.
    # Cette règle doit être testée EN PREMIER.
    if total_std > 12.0 and mean_spectrum[0] < LOW_FREQ_FLOOR_DB:
        return "Intérieur"
    # ====================================================================
    # == FIN MODIFICATION                                               ==
    # ====================================================================

    # Règle pour les SIRÈNES : son très variable ET beaucoup de sauts de pic de fréquence
    if peak_jumps >= len(history) * 0.4 and mid_energy_ratio + high_energy_ratio > 0.6:
        return "Sirène"

    # Règle pour les MOTEURS : son très stable (faible variabilité) ET énergie concentrée dans les basses
    if total_std < 10.0 and low_energy_ratio > 0.6:
        return "Moteur"

    # Règle pour la MUSIQUE : son très variable mais sans les sauts de pic d'une sirène
    if total_std > 15.0 and peak_jumps < len(history) * 0.3:
        return "Musique"

    # Règle pour la VOIX : énergie concentrée dans les médiums et variabilité modérée
    if mid_energy_ratio > 0.5 and 10.0 < total_std < 20.0:
        return "Voix"

    return "Autre"
