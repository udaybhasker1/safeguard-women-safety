try:  # loads backend/.env if python-dotenv is installed
    from importlib import import_module

    import_module("dotenv").load_dotenv()
except ImportError:
    pass

import json
import os
from pathlib import Path
from typing import Literal, Optional

from fastapi import (  # type: ignore
    APIRouter,
    BackgroundTasks,
    Depends,
    FastAPI,
    HTTPException,
    Query,
)
from fastapi.middleware.cors import CORSMiddleware  # type: ignore
from fastapi.responses import FileResponse  # type: ignore
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer  # type: ignore
from fastapi.staticfiles import StaticFiles  # type: ignore
from pydantic import BaseModel, Field  # type: ignore

from services import alert_service, auth_service, contact_service, telegram_service
from services.db import init_db
from services.safety_manager import SafetyManager
from services.sensor_simulator import (
    generate_normal_data,
    generate_anomaly_data,
)

IS_PRODUCTION = auth_service.IS_PRODUCTION

app = FastAPI(
    title="SafeGuard Women Safety API",
    version="2.0",
    docs_url=None if IS_PRODUCTION else "/docs",
    redoc_url=None,
    openapi_url=None if IS_PRODUCTION else "/openapi.json",
)

# ------------------------------------------------
# CORS
# In the normal setup the frontend and API share one origin (the Vite
# proxy in development, one server in production), so CORS is not needed.
# Set ALLOWED_ORIGINS only if the frontend is hosted on a different domain.
# ------------------------------------------------

allowed_origins = [
    origin.strip()
    for origin in os.getenv("ALLOWED_ORIGINS", "").split(",")
    if origin.strip()
]

if allowed_origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=allowed_origins,
        allow_methods=["GET", "POST", "DELETE"],
        allow_headers=["Authorization", "Content-Type"],
    )
elif not IS_PRODUCTION:
    app.add_middleware(
        CORSMiddleware,
        allow_origin_regex=r"http://(localhost|127\.0\.0\.1):5173",
        allow_methods=["GET", "POST", "DELETE"],
        allow_headers=["Authorization", "Content-Type"],
    )

init_db()

safety_manager = SafetyManager()

METRICS_FILE = Path(__file__).resolve().parent / "models" / "model_metrics.json"

bearer = HTTPBearer(auto_error=False)
router = APIRouter(prefix="/api")


# ------------------------------------------------
# MODELS + AUTH DEPENDENCY
# ------------------------------------------------

class RegisterIn(BaseModel):
    name: str = Field(max_length=80)
    email: str = Field(max_length=120)
    password: str = Field(max_length=200)


class LoginIn(BaseModel):
    email: str = Field(max_length=120)
    password: str = Field(max_length=200)


class ContactIn(BaseModel):
    name: str = Field(max_length=80)
    phone: str = Field(max_length=30)
    relation: str = Field(default="", max_length=40)


def current_user(
    credentials: HTTPAuthorizationCredentials = Depends(bearer),
):
    user = (
        auth_service.user_from_token(credentials.credentials)
        if credentials
        else None
    )

    if user is None:
        raise HTTPException(status_code=401, detail="Please log in again.")

    return user


def location_line(lat, lng):
    if lat is None or lng is None:
        return "Location unavailable."

    return f"Location: https://www.google.com/maps?q={lat:.6f},{lng:.6f}"


# ------------------------------------------------
# PUBLIC
# ------------------------------------------------

@router.get("/health")
def health():
    return {"status": "healthy"}


@router.get("/model-info")
def model_info():
    """Training results saved by ml/train_model.py."""
    if not METRICS_FILE.exists():
        return {"available": False}

    info = json.loads(METRICS_FILE.read_text(encoding="utf-8"))
    info["available"] = True
    return info


# ------------------------------------------------
# ACCOUNTS
# ------------------------------------------------

@router.post("/auth/register")
def register(data: RegisterIn):
    try:
        user = auth_service.register_user(data.name, data.email, data.password)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error))

    return {"token": auth_service.create_token(user["id"]), "user": user}


@router.post("/auth/login")
def login(data: LoginIn):
    try:
        user = auth_service.authenticate(data.email, data.password)
    except auth_service.RateLimited:
        raise HTTPException(
            status_code=429,
            detail="Too many failed attempts. Try again in 10 minutes.",
        )

    if user is None:
        raise HTTPException(status_code=401, detail="Wrong email or password.")

    return {"token": auth_service.create_token(user["id"]), "user": user}


@router.get("/auth/me")
def me(user: dict = Depends(current_user)):
    return user


# ------------------------------------------------
# SENSORS + AI DETECTION
# ------------------------------------------------

@router.get("/sensor/normal")
def normal_sensor(user: dict = Depends(current_user)):
    data = generate_normal_data()
    return {
        "sensor_data": data,
        "analysis": safety_manager.analyze(data, user["id"]),
    }


@router.get("/sensor/anomaly")
def anomaly_sensor(user: dict = Depends(current_user)):
    data = generate_anomaly_data()
    return {
        "sensor_data": data,
        "analysis": safety_manager.analyze(data, user["id"]),
    }


@router.get("/predict")
def predict(
    heart_rate: float = Query(ge=20, le=250),
    acceleration: float = Query(ge=0, le=20),
    movement: float = Query(ge=0, le=20),
    speed: float = Query(ge=0, le=300),
    user: dict = Depends(current_user),
):
    """Run the trained model on readings from the demo panel or real sensors."""
    data = {
        "heart_rate": heart_rate,
        "acceleration": acceleration,
        "movement": movement,
        "speed": speed,
    }
    return {
        "sensor_data": data,
        "analysis": safety_manager.analyze(data, user["id"]),
    }


# ------------------------------------------------
# SAFETY RESPONSE + ALERTS
# ------------------------------------------------

@router.post("/safety-response")
def safety_response(
    response: Literal["yes", "no", "timeout"],
    background_tasks: BackgroundTasks,
    lat: Optional[float] = Query(default=None, ge=-90, le=90),
    lng: Optional[float] = Query(default=None, ge=-180, le=180),
    user: dict = Depends(current_user),
):
    result = safety_manager.process_response(response, user["id"])
    name = user["name"]

    if response == "yes":
        kind = "Safety confirmed"
        text = f"SafeGuard: {name} confirmed they are safe."

    elif result["status"] == "emergency":
        kind = "Emergency escalation"
        reason = (
            "asked for help"
            if response == "no"
            else "did not respond to the safety check"
        )
        text = (
            f"SafeGuard EMERGENCY: {name} {reason}. "
            f"Please contact them immediately. {location_line(lat, lng)}"
        )

    else:
        kind = "Help requested" if response == "no" else "No response"
        reason = (
            "asked for help"
            if response == "no"
            else "has not responded to a safety check"
        )
        text = (
            f"SafeGuard WARNING: {name} {reason}. Checking again. "
            f"{location_line(lat, lng)}"
        )

    background_tasks.add_task(
        alert_service.send_emergency_alert, user["id"], text, kind
    )

    return result


@router.post("/sos")
def sos(
    background_tasks: BackgroundTasks,
    lat: Optional[float] = Query(default=None, ge=-90, le=90),
    lng: Optional[float] = Query(default=None, ge=-180, le=180),
    user: dict = Depends(current_user),
):
    safety_manager.levels[user["id"]] = 2

    background_tasks.add_task(
        alert_service.send_emergency_alert,
        user["id"],
        f"SafeGuard SOS: {user['name']} pressed the SOS button and needs "
        f"immediate help. {location_line(lat, lng)}",
        "SOS button",
    )

    return {"status": "emergency", "level": 2, "message": "SOS alert sent."}


@router.get("/alerts")
def alerts(user: dict = Depends(current_user)):
    return alert_service.list_alerts(user["id"])


# ------------------------------------------------
# EMERGENCY CONTACTS
# ------------------------------------------------

def public_contact(contact):
    """What the browser may see (never the token or the chat id)."""
    return {
        "id": contact["id"],
        "name": contact["name"],
        "phone": contact["phone"],
        "relation": contact["relation"],
        "telegram_linked": bool(contact.get("telegram_chat_id")),
        "invite_link": telegram_service.invite_link(contact.get("link_token")),
    }


@router.get("/contacts")
def get_contacts(user: dict = Depends(current_user)):
    return [
        public_contact(contact)
        for contact in contact_service.list_contacts(user["id"])
    ]


@router.post("/contacts")
def create_contact(contact: ContactIn, user: dict = Depends(current_user)):
    try:
        created = contact_service.add_contact(
            user["id"], contact.name, contact.phone, contact.relation
        )
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error))

    return public_contact(created)


@router.post("/contacts/sync-telegram")
def sync_telegram(user: dict = Depends(current_user)):
    """Checks which contacts have pressed Start in the Telegram bot."""
    if not telegram_service.is_configured():
        raise HTTPException(
            status_code=400,
            detail="The Telegram bot is not configured on the server.",
        )

    try:
        linked = telegram_service.sync_links()
    except RuntimeError as error:
        raise HTTPException(status_code=502, detail=f"Telegram error: {error}")

    return {"linked": linked}


@router.post("/contacts/test")
def test_alert(
    background_tasks: BackgroundTasks,
    user: dict = Depends(current_user),
):
    """Sends a harmless test message to every saved contact."""
    background_tasks.add_task(
        alert_service.send_emergency_alert,
        user["id"],
        f"SafeGuard test: this is a test message from {user['name']}. "
        "No action is needed.",
        "Test alert",
    )

    return {"status": "sending"}


@router.delete("/contacts/{contact_id}")
def remove_contact(contact_id: str, user: dict = Depends(current_user)):
    if not contact_service.delete_contact(user["id"], contact_id):
        raise HTTPException(status_code=404, detail="Contact not found.")

    return {"deleted": contact_id}


@router.get("/status")
def system_status(user: dict = Depends(current_user)):
    return {
        "monitoring": True,
        "current_level": safety_manager.level_for(user["id"]),
        "contacts": len(contact_service.list_contacts(user["id"])),
        "telegram": telegram_service.is_configured(),
    }


app.include_router(router)


# ------------------------------------------------
# SERVE THE BUILT FRONTEND (production / single-server deployment)
# ------------------------------------------------

def _find_static_dir():
    here = Path(__file__).resolve().parent

    candidates = [
        os.getenv("STATIC_DIR"),
        here.parent / "frontend_dist",
        here.parent / "frontend" / "dist",
    ]

    for candidate in candidates:
        if candidate and (Path(candidate) / "index.html").exists():
            return Path(candidate).resolve()

    return None


STATIC_DIR = _find_static_dir()

if STATIC_DIR:
    if (STATIC_DIR / "assets").is_dir():
        app.mount(
            "/assets",
            StaticFiles(directory=STATIC_DIR / "assets"),
            name="assets",
        )

    @app.get("/{full_path:path}", include_in_schema=False)
    def frontend(full_path: str):
        if full_path.startswith("api/"):
            raise HTTPException(status_code=404, detail="Not found.")

        requested = (STATIC_DIR / full_path).resolve()

        if (
            full_path
            and requested.is_file()
            and STATIC_DIR in requested.parents
        ):
            return FileResponse(requested)

        return FileResponse(STATIC_DIR / "index.html")