"""Sends SMS + WhatsApp alerts to a user's emergency contacts through the
Twilio REST API (standard library only) and logs every alert in SQLite.

If Twilio is not configured, messages are marked "simulated" and printed,
so the whole flow can still be demonstrated.
"""
import base64
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from datetime import datetime

from services.contact_service import list_contacts
from services.db import db

TWILIO_API_BASE = os.getenv("TWILIO_API_BASE", "https://api.twilio.com")


def _configured():
    return bool(os.getenv("TWILIO_ACCOUNT_SID") and os.getenv("TWILIO_AUTH_TOKEN"))


def _post_message(to, from_, body):
    sid = os.environ["TWILIO_ACCOUNT_SID"]
    token = os.environ["TWILIO_AUTH_TOKEN"]

    url = f"{TWILIO_API_BASE}/2010-04-01/Accounts/{sid}/Messages.json"
    data = urllib.parse.urlencode({"To": to, "From": from_, "Body": body}).encode()

    request = urllib.request.Request(url, data=data, method="POST")
    credentials = base64.b64encode(f"{sid}:{token}".encode()).decode()
    request.add_header("Authorization", f"Basic {credentials}")
    request.add_header("Content-Type", "application/x-www-form-urlencoded")

    try:
        with urllib.request.urlopen(request, timeout=15):
            return
    except urllib.error.HTTPError as error:
        try:
            detail = json.loads(error.read().decode()).get("message", "")
        except Exception:
            detail = ""
        raise RuntimeError(detail or f"HTTP {error.code}")
    except urllib.error.URLError as error:
        raise RuntimeError(str(error.reason))


def _attempt(to, from_, body):
    if not from_:
        return "failed: sender number is not configured"

    try:
        _post_message(to, from_, body)
        return "sent"
    except Exception as error:
        return f"failed: {str(error)[:90]}"


def _send_one(phone, message):
    if not _configured():
        print(f"[SIMULATED ALERT to {phone}] {message}")
        return "simulated", "simulated"

    sms = _attempt(phone, os.getenv("TWILIO_PHONE"), message)

    whatsapp = _attempt(
        f"whatsapp:{phone}",
        os.getenv("TWILIO_WHATSAPP_FROM", "whatsapp:+14155238886"),
        message,
    )

    return sms, whatsapp


def send_emergency_alert(user_id, message, kind="Alert"):
    contacts = list_contacts(user_id)

    results = []

    for contact in contacts:
        sms, whatsapp = _send_one(contact["phone"], message)

        results.append({
            "name": contact["name"],
            "phone": contact["phone"],
            "sms": sms,
            "whatsapp": whatsapp,
        })

    entry = {
        "id": uuid.uuid4().hex[:8],
        "time": datetime.now().strftime("%d %b %Y, %H:%M:%S"),
        "type": kind,
        "status": (
            f"{len(contacts)} contact(s) notified"
            if contacts
            else "No emergency contacts saved"
        ),
        "message": message,
        "results": results,
    }

    with db() as conn:
        conn.execute(
            "INSERT INTO alerts "
            "(id, user_id, created_at, time, type, status, message, results) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (
                entry["id"],
                user_id,
                time.time(),
                entry["time"],
                kind,
                entry["status"],
                message,
                json.dumps(results),
            ),
        )

    return entry


def list_alerts(user_id, limit=50):
    with db() as conn:
        rows = conn.execute(
            "SELECT id, time, type, status, message, results FROM alerts "
            "WHERE user_id = ? ORDER BY created_at DESC LIMIT ?",
            (user_id, limit),
        ).fetchall()

    alerts = []

    for row in rows:
        item = dict(row)
        item["results"] = json.loads(item["results"])
        alerts.append(item)

    return alerts
