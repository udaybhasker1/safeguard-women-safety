"""Sends alerts to a user's emergency contacts through the Telegram bot and
logs every alert in SQLite.

If the bot is not configured, messages are marked "simulated" and printed, so
the whole flow can still be demonstrated.
"""
import json
import time
import uuid
from datetime import datetime

from services import telegram_service
from services.contact_service import list_contacts
from services.db import db


def _send_one(contact, message):
    if not telegram_service.is_configured():
        print(f"[SIMULATED ALERT to {contact['name']}] {message}")
        return {"telegram": "simulated"}

    chat_id = contact.get("telegram_chat_id")

    if not chat_id:
        return {"telegram": "not linked yet"}

    try:
        telegram_service.send_message(chat_id, message)
        return {"telegram": "sent"}
    except Exception as error:
        return {"telegram": f"failed: {str(error)[:90]}"}


def send_emergency_alert(user_id, message, kind="Alert"):
    # pick up contacts who pressed Start in Telegram since the last check
    try:
        telegram_service.sync_links()
    except Exception as error:
        print("Telegram sync failed:", error)

    contacts = list_contacts(user_id)

    results = []

    for contact in contacts:
        results.append({
            "name": contact["name"],
            "phone": contact["phone"],
            "channels": _send_one(contact, message),
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