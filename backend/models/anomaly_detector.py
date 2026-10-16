import json
from pathlib import Path

import numpy as np

MODEL_PATH = Path(__file__).with_name("safety_model.json")


class AnomalyDetector:

    def __init__(self):
        self.params = None

        if MODEL_PATH.exists():
            raw = json.loads(MODEL_PATH.read_text())

            self.params = {
                "mean": np.array(raw["mean"]),
                "std": np.array(raw["std"]),
                "W1": np.array(raw["W1"]),
                "b1": np.array(raw["b1"]),
                "W2": np.array(raw["W2"]),
                "b2": np.array(raw["b2"]),
            }

            print("Loaded ML model:", MODEL_PATH.name)
        else:
            print(
                "WARNING: safety_model.json not found - using a rule-based "
                "fallback. Run ml/train_model.py first."
            )

    def probability(self, heart_rate, acceleration, movement, speed):
        """Probability (0-1) that the reading is an anomaly."""
        if self.params is None:
            score = (
                (heart_rate > 130)
                + (acceleration > 2)
                + (movement > 2)
                + (speed > 20)
            )
            return 0.9 if score >= 2 else 0.1

        p = self.params

        x = np.array([heart_rate, acceleration, movement, speed], dtype=float)
        x = (x - p["mean"]) / p["std"]

        hidden = np.tanh(x @ p["W1"] + p["b1"])
        logit = float((hidden @ p["W2"] + p["b2"])[0])

        return float(1 / (1 + np.exp(-logit)))

    def detect(self, heart_rate, acceleration, movement, speed):
        return self.probability(heart_rate, acceleration, movement, speed) >= 0.5
