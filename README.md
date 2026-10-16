# SafeGuard - AI-Based Women Safety Emergency Response System

A full-stack prototype that watches sensor readings, uses a machine-learning
model to detect unusual activity, asks "Are you safe?", and if there is no
confirmation escalates to emergency contacts by SMS and WhatsApp with a live
location link.

> **Prototype only.** The model is trained on synthetic data and the phone-motion
> mapping is a simple heuristic. This is not a certified emergency service and
> must not be relied on in a real emergency.

## Features

- Phone-style web app (React) with Home, Activity, Alerts, Contacts and Profile
- **Accounts:** register/login (password hashing, signed tokens, login rate limit)
- **AI detection:** small neural network (4-16-1) written in NumPy; anomaly
  probability becomes LOW / MEDIUM / HIGH risk
- **Safety check:** 10-second countdown with graduated escalation
- **Alerts:** SMS + WhatsApp to every contact via Twilio, with per-contact
  delivery status, history stored in SQLite
- **Real location:** browser Geolocation, sent as a Google Maps link in alerts
- **Real sensors (optional):** phone accelerometer, GPS speed, Bluetooth
  heart-rate band (Web Bluetooth)
- **Live demo panel** (Resting / Running / Distress and sliders) and a model
  card with accuracy, precision and recall
- Emergency contacts per user, test-alert button, SOS button

## Architecture

```
Browser (React)  --/api, JSON, Bearer token-->  FastAPI
                                                  |
                    auth_service   contact_service   alert_service --> Twilio REST API
                          \             |                |
                           +------ SQLite (users, contacts, alerts)
                    safety_manager --> anomaly_detector --> models/safety_model.json
```

In development Vite proxies `/api` to the backend. In production the backend
serves the built frontend, so everything is one origin over HTTPS.

## Tech stack

| Layer | Tools |
|---|---|
| Frontend | React, Vite, Geolocation / DeviceMotion / Web Bluetooth APIs |
| Backend | Python, FastAPI, Uvicorn, Pydantic, PyJWT, SQLite |
| AI / ML | NumPy, pandas - neural network trained from scratch |
| Messaging | Twilio REST API (SMS, WhatsApp) |
| DevOps | Docker, Render, HTTPS tunnels (ngrok / Cloudflare) |

## Project structure

```
women_safety/
├── ml/            generate_dataset.py, train_model.py
├── backend/
│   ├── main.py    API + serves the built frontend
│   ├── data/      sensor_data.csv (SQLite file is created here)
│   ├── models/    anomaly_detector.py, safety_model.json, model_metrics.json
│   └── services/  auth, contacts, alerts, safety_manager, db, sensor_simulator
├── frontend/      index.html, vite.config.js, src/ (App, AuthScreen, api, main)
├── docs/SETUP_GUIDE.md
├── Dockerfile, render.yaml
└── README.md
```

## Run locally

```bash
# 1. backend
cd backend
python -m venv venv
venv\Scripts\activate            # Mac/Linux: source venv/bin/activate
pip install -r requirements.txt
copy .env.example .env           # optional: add Twilio values
uvicorn main:app --reload

# 2. frontend (second terminal)
cd frontend
npm install
npm install -D @vitejs/plugin-react
npm run dev -- --host
```

Open `http://localhost:5173`, create an account, add a contact (with country
code), and try the Live demo. Without Twilio keys alerts are marked
"simulated". See `docs/SETUP_GUIDE.md` for Twilio, GPS/sensor testing over
HTTPS, and deployment.

Retrain the model (optional): `cd ml && pip install -r requirements.txt && python generate_dataset.py && python train_model.py`

## Model results

Synthetic dataset, 80/20 split, 640 unseen rows: accuracy 99.2%, precision
99.5%, recall 98.2%. Because the data is generated, real-world performance
needs real wearable recordings.

## Limitations and future work

- Evaluate on real wearable datasets (e.g. WESAD, PAMAP2) and compare baselines
- Phone motion to model-feature mapping is heuristic, not learned
- Production WhatsApp needs Meta approval; trial Twilio SMS has country limits
- JSON-free but single-node SQLite; PostgreSQL for multi-instance deployments
- Add email verification, password reset and a privacy policy before real users

## Author

Your Name - add your LinkedIn link here
