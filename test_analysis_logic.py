import sys
import os
import numpy as np
from collections import deque

# Add project root to sys.path
sys.path.append(os.getcwd())

from analysis.window_detector import analyze_for_window_event
from analysis.sound_classifier import advanced_classify

def test_window_detector():
    print("--- Testing Window Detector ---")

    # Mock database connection
    mock_conn = None

    # 1. Test "Stay closed"
    buffer = deque(maxlen=20)
    for _ in range(20):
        buffer.append({'T_C': 20.0, 'H_pc': 50.0, 'SPL_dBA': 45.0, 'CO2e': 400.0})

    detected, result = analyze_for_window_event(mock_conn, buffer, 'fermee', 0, None)
    print(f"Result (Stable Closed): detected={detected}, result={result}")
    assert detected == False

    # 2. Test "Opening Window" (Drop in CO2 and Temp)
    # First 10: High CO2, High Temp
    # Last 10: Low CO2, Low Temp
    opening_buffer = deque(maxlen=20)
    for _ in range(10):
        opening_buffer.append({'T_C': 22.0, 'H_pc': 50.0, 'SPL_dBA': 45.0, 'CO2e': 800.0})
    for _ in range(10):
        opening_buffer.append({'T_C': 20.0, 'H_pc': 50.0, 'SPL_dBA': 50.0, 'CO2e': 400.0})

    # We need to simulate 3 consecutive cycles for validation as per logic
    count = 0
    potential_status = None
    for i in range(3):
        detected, res = analyze_for_window_event(mock_conn, opening_buffer, 'fermee', count, potential_status)
        if not detected:
            count = res['count']
            potential_status = res['status']
        print(f"Cycle {i+1} (Opening): detected={detected}, res={res}")

    assert detected == True
    assert res == 'ouverte'
    print("✅ Window Opening detection passed.")

def test_sound_classifier():
    print("\n--- Testing Sound Classifier ---")

    # 1. Test Siren (Frequency jumps)
    # 6 bands. Bands 2,3,4 are mids/highs.
    siren_history = [
        [40, 40, 70, 40, 40, 40],
        [40, 40, 40, 70, 40, 40],
        [40, 40, 70, 40, 40, 40],
        [40, 40, 40, 70, 40, 40],
        [40, 40, 70, 40, 40, 40]
    ]
    result = advanced_classify(siren_history)
    print(f"Result (Siren): {result}")
    assert result == "Sirène"

    # 2. Test Motor (Stable Low Freq, High energy in low bands)
    motor_history = [
        [80, 70, 10, 10, 10, 10],
        [81, 71, 11, 9, 10, 11],
        [80, 70, 10, 10, 10, 10],
        [81, 71, 11, 9, 10, 11]
    ]
    result = advanced_classify(motor_history)
    print(f"Result (Motor): {result}")
    assert result == "Moteur"

    # 3. Test Interior (Very Variable, Low Bass)
    interior_history = [
        [30, 30, 90, 10, 10, 10],
        [30, 30, 10, 10, 90, 10],
        [30, 30, 90, 10, 10, 10],
        [30, 30, 10, 10, 90, 10],
        [30, 30, 90, 10, 10, 10]
    ]
    result = advanced_classify(interior_history)
    print(f"Result (Intérieur): {result}")
    assert result == "Intérieur"

    print("✅ Sound Classification tests passed.")

if __name__ == "__main__":
    try:
        test_window_detector()
        test_sound_classifier()
        print("\nAll verification tests passed successfully!")
    except AssertionError as e:
        print(f"\n❌ Verification failed!")
        sys.exit(1)
    except Exception as e:
        print(f"\n🟥 Unexpected error: {e}")
        sys.exit(1)
