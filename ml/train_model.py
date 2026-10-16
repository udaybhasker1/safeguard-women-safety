"""Trains a small neural network (4 -> 16 -> 1) using only NumPy and pandas.

No scikit-learn or SciPy is needed, so it also works on PCs where Windows
Application Control blocks SciPy's DLL files. The trained weights are saved
as JSON in backend/models/safety_model.json.
"""
import json
from pathlib import Path

import numpy as np
import pandas as pd

BASE = Path(__file__).resolve().parent.parent / "backend"
DATA = BASE / "data" / "sensor_data_large.csv"
OUT = BASE / "models" / "safety_model.json"

FEATURES = ["heart_rate", "acceleration", "movement", "speed"]

rng = np.random.default_rng(42)

# ------------------------------------------------
# LOAD + STRATIFIED 80/20 SPLIT
# ------------------------------------------------

data = pd.read_csv(DATA)
X = data[FEATURES].to_numpy(dtype=float)
y = data["label"].to_numpy(dtype=float)

train_idx, test_idx = [], []
for label in (0, 1):
    idx = rng.permutation(np.where(y == label)[0])
    cut = int(len(idx) * 0.8)
    train_idx.extend(idx[:cut])
    test_idx.extend(idx[cut:])

train_idx = rng.permutation(train_idx)
test_idx = np.array(test_idx)

X_train, y_train = X[train_idx], y[train_idx]
X_test, y_test = X[test_idx], y[test_idx]

mean = X_train.mean(axis=0)
std = X_train.std(axis=0) + 1e-8

Xs_train = (X_train - mean) / std
Xs_test = (X_test - mean) / std

# ------------------------------------------------
# MODEL
# ------------------------------------------------

HIDDEN = 16

W1 = rng.normal(0, 0.5, (4, HIDDEN))
b1 = np.zeros(HIDDEN)
W2 = rng.normal(0, 0.5, (HIDDEN, 1))
b2 = np.zeros(1)


def forward(inputs):
    hidden = np.tanh(inputs @ W1 + b1)
    logits = hidden @ W2 + b2
    return hidden, 1 / (1 + np.exp(-logits[:, 0]))


# class weights so the smaller "anomaly" class is not ignored
weights = np.where(y_train == 1, len(y_train) / (2 * y_train.sum()),
                   len(y_train) / (2 * (len(y_train) - y_train.sum())))

# Adam optimiser state
params = [W1, b1, W2, b2]
m = [np.zeros_like(p) for p in params]
v = [np.zeros_like(p) for p in params]
lr, beta1, beta2, eps = 0.01, 0.9, 0.999, 1e-8

EPOCHS = 1500

for epoch in range(1, EPOCHS + 1):
    hidden, prob = forward(Xs_train)

    error = (prob - y_train) * weights / len(y_train)

    grad_W2 = hidden.T @ error[:, None]
    grad_b2 = np.array([error.sum()])
    grad_hidden = error[:, None] @ W2.T * (1 - hidden ** 2)
    grad_W1 = Xs_train.T @ grad_hidden
    grad_b1 = grad_hidden.sum(axis=0)

    grads = [grad_W1, grad_b1, grad_W2, grad_b2]

    for i, (p, g) in enumerate(zip(params, grads)):
        m[i] = beta1 * m[i] + (1 - beta1) * g
        v[i] = beta2 * v[i] + (1 - beta2) * g ** 2
        m_hat = m[i] / (1 - beta1 ** epoch)
        v_hat = v[i] / (1 - beta2 ** epoch)
        p -= lr * m_hat / (np.sqrt(v_hat) + eps)

    if epoch % 300 == 0:
        loss = -np.mean(
            y_train * np.log(prob + 1e-9) + (1 - y_train) * np.log(1 - prob + 1e-9)
        )
        print(f"epoch {epoch:4d}  loss {loss:.4f}")

# ------------------------------------------------
# EVALUATION
# ------------------------------------------------

_, test_prob = forward(Xs_test)
pred = (test_prob >= 0.5).astype(int)

tp = int(((pred == 1) & (y_test == 1)).sum())
tn = int(((pred == 0) & (y_test == 0)).sum())
fp = int(((pred == 1) & (y_test == 0)).sum())
fn = int(((pred == 0) & (y_test == 1)).sum())

accuracy = (tp + tn) / len(y_test)
precision = tp / (tp + fp) if tp + fp else 0.0
recall = tp / (tp + fn) if tp + fn else 0.0
f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0

print()
print(f"Rows: {len(data)} | train: {len(y_train)} | test: {len(y_test)}")
print(f"Accuracy : {accuracy:.3f}")
print(f"Precision: {precision:.3f}  (flagged anomalies that were real)")
print(f"Recall   : {recall:.3f}  (real anomalies that were caught)")
print(f"F1 score : {f1:.3f}")
print()
print("Confusion matrix (rows = actual, columns = predicted):")
print("              normal  anomaly")
print(f"  normal      {tn:6d}  {fp:7d}")
print(f"  anomaly     {fn:6d}  {tp:7d}")

# permutation importance: how much accuracy drops when a feature is shuffled
print()
print("Feature importance (accuracy drop when shuffled):")
importance = []
for i, name in enumerate(FEATURES):
    shuffled = Xs_test.copy()
    shuffled[:, i] = rng.permutation(shuffled[:, i])
    _, p = forward(shuffled)
    drop = accuracy - ((p >= 0.5).astype(int) == y_test).mean()
    importance.append((name, drop))
for name, drop in sorted(importance, key=lambda item: -item[1]):
    print(f"  {name:13s} {drop:.3f}")

# ------------------------------------------------
# SAVE
# ------------------------------------------------

OUT.parent.mkdir(parents=True, exist_ok=True)

(OUT.parent / "model_metrics.json").write_text(json.dumps({
    "model": "Neural network (4-16-1), NumPy",
    "data": "Synthetic, generated",
    "rows": int(len(data)),
    "train_rows": int(len(y_train)),
    "test_rows": int(len(y_test)),
    "accuracy": round(float(accuracy), 3),
    "precision": round(float(precision), 3),
    "recall": round(float(recall), 3),
    "f1": round(float(f1), 3),
    "confusion": {"tn": tn, "fp": fp, "fn": fn, "tp": tp},
}, indent=2))

OUT.write_text(json.dumps({
    "features": FEATURES,
    "mean": mean.tolist(),
    "std": std.tolist(),
    "W1": W1.tolist(),
    "b1": b1.tolist(),
    "W2": W2.tolist(),
    "b2": b2.tolist(),
}))
print("\nModel saved to", OUT)
