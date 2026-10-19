"""Telegram bot: invite links, linking contacts, sending alerts.

Standard library only. A contact opens https://t.me/<bot>?start=<token> and
presses Start; sync_links() reads those /start messages and stores the
contact's chat id so alerts can be delivered to them.
"""
import json
import os
import re
import threading
import urllib.error
import urllib.request

from services import contact_service

API_BASE = os.getenv("TELEGRAM_API_BASE", "https://api.telegram.org")
START_PATTERN = re.compile(r"^/start(?:@\w+)?\s+([A-Za-z0-9_-]{4,64})\s*$")

_lock = threading.Lock()
_offset = None


def is_configured():
    return bool(os.getenv("TELEGRAM_BOT_TOKEN"))


def invite_link(link_token):
    username = (os.getenv("TELEGRAM_BOT_USERNAME") or "").lstrip("@")

    if not username or not link_token:
        return None

    return f"https://t.me/{username}?start={link_token}"


def _call(method, payload):
    token = os.environ["TELEGRAM_BOT_TOKEN"]

    request = urllib.request.Request(
        f"{API_BASE}/bot{token}/{method}",
        data=json.dumps(payload).encode(),
        method="POST",
    )
    request.add_header("Content-Type", "application/json")

    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            body = json.loads(response.read().decode())
    except urllib.error.HTTPError as error:
        try:
            detail = json.loads(error.read().decode()).get("description", "")
        except Exception:
            detail = ""
        raise RuntimeError(detail or f"HTTP {error.code}")
    except urllib.error.URLError as error:
        raise RuntimeError(str(error.reason))

    if not body.get("ok"):
        raise RuntimeError(body.get("description", "Telegram error"))

    return body["result"]


def send_message(chat_id, text):
    _call("sendMessage", {"chat_id": chat_id, "text": text})


def sync_links():
    """Reads new /start messages and links contacts. Returns how many linked."""
    global _offset

    if not is_configured():
        return 0

    linked = 0

    with _lock:
        params = {"timeout": 0, "allowed_updates": ["message"]}

        if _offset is not None:
            params["offset"] = _offset

        updates = _call("getUpdates", params)

        for update in updates:
            _offset = max(_offset or 0, update["update_id"] + 1)

            message = update.get("message") or {}
            chat = message.get("chat") or {}
            match = START_PATTERN.match((message.get("text") or "").strip())

            if not match or "id" not in chat:
                continue

            if chat.get("type", "private") != "private":
                continue

            owner = contact_service.link_telegram(
                match.group(1), str(chat["id"])
            )

            if not owner:
                continue

            linked += 1

            try:
                send_message(
                    chat["id"],
                    f"You are now linked. You will receive SafeGuard safety "
                    f"alerts about {owner} here.",
                )
            except RuntimeError:
                pass

    return linked