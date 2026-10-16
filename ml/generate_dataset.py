"""Creates a larger labelled dataset (synthetic) for training.

Includes hard cases on purpose: running or exercising has a high heart rate
and speed but is NOT an emergency (label 0), and a "freeze" (high heart rate,
almost no movement) IS suspicious (label 1).
"""
from pathlib import Path

import numpy as np
import pandas as pd

rng = np.random.default_rng(42)
OUT = Path(__file__).resolve().parent.parent / "backend" / "data" / "sensor_data_large.csv"


def make(n, hr, acc, mov, spd, label):
    df = pd.DataFrame({
        "heart_rate": rng.normal(*hr, n),
        "acceleration": rng.normal(*acc, n),
        "movement": rng.normal(*mov, n),
        "speed": rng.normal(*spd, n),
    })
    df["label"] = label
    return df


parts = [
    make(1200, (75, 8), (1.0, 0.3), (1.0, 0.3), (3, 2), 0),        # resting
    make(600, (90, 10), (1.3, 0.3), (1.5, 0.4), (5, 1.5), 0),      # walking
    make(300, (135, 12), (2.2, 0.5), (2.4, 0.5), (11, 2.5), 0),    # running / exercise
    make(900, (150, 15), (3.8, 0.8), (3.8, 0.8), (18, 6), 1),      # distress / struggle
    make(200, (145, 12), (0.3, 0.15), (0.2, 0.1), (0.5, 0.5), 1),  # freeze / fall
]

data = pd.concat(parts, ignore_index=True)
data[["acceleration", "movement", "speed"]] = data[["acceleration", "movement", "speed"]].clip(lower=0)
data["heart_rate"] = data["heart_rate"].clip(40, 210).round().astype(int)
data[["acceleration", "movement", "speed"]] = data[["acceleration", "movement", "speed"]].round(2)
data = data.sample(frac=1, random_state=42).reset_index(drop=True)

OUT.parent.mkdir(parents=True, exist_ok=True)
data.to_csv(OUT, index=False)
print(f"Saved {len(data)} rows to {OUT}")
print(data["label"].value_counts().rename({0: "normal", 1: "anomaly"}))
