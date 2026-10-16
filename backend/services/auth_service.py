"""Accounts, password hashing and login tokens."""
import hashlib
import hmac
import os
import re
import secrets
import sqlite3
import time
from datetime import datetime, timedelta, timezone

import jwt  # PyJWT (pure Python)

from services.db import db

IS_PRODUCTION = os.getenv("APP_ENV", "development").lower() == "production"
SECRET_KEY = os.getenv("SECRET_KEY")

if not SECRET_KEY:
    if IS_PRODUCTION:
        raise RuntimeError("SECRET_KEY must be set when APP_ENV=production.")

    SECRET_KEY = secrets.token_hex(32)
    print("WARNING: SECRET_KEY not set - using a temporary key (logins reset on restart).")

TOKEN_DAYS = 7
PBKDF2_ITERATIONS = 600_000
EMAIL_PATTERN = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

MAX_FAILURES = 5
WINDOW_SECONDS = 600

_failures = {}
_dummy_hash = None


class RateLimited(Exception):
    pass


# ------------------------------------------------
# PASSWORDS
# ------------------------------------------------

def hash_password(password):
    salt = os.urandom(16)

    digest = hashlib.pbkdf2_hmac(
        "sha256", password.encode(), salt, PBKDF2_ITERATIONS
    )

    return f"pbkdf2${PBKDF2_ITERATIONS}${salt.hex()}${digest.hex()}"


def verify_password(password, stored):
    try:
        _, iterations, salt, expected = stored.split("$")

        digest = hashlib.pbkdf2_hmac(
            "sha256", password.encode(), bytes.fromhex(salt), int(iterations)
        )

        return hmac.compare_digest(digest.hex(), expected)
    except (ValueError, TypeError):
        return False


# ------------------------------------------------
# ACCOUNTS
# ------------------------------------------------

def register_user(name, email, password):
    name = name.strip()
    email = email.strip().lower()

    if not name:
        raise ValueError("Name is required.")

    if not EMAIL_PATTERN.match(email):
        raise ValueError("Enter a valid email address.")

    if len(password) < 8:
        raise ValueError("Password must be at least 8 characters.")

    try:
        with db() as conn:
            cursor = conn.execute(
                "INSERT INTO users (name, email, password_hash, created_at) "
                "VALUES (?, ?, ?, ?)",
                (
                    name,
                    email,
                    hash_password(password),
                    datetime.now(timezone.utc).isoformat(),
                ),
            )
            user_id = cursor.lastrowid
    except sqlite3.IntegrityError:
        raise ValueError("An account with that email already exists.")

    return {"id": user_id, "name": name, "email": email}


def _recent_failures(email):
    now = time.time()
    recent = [t for t in _failures.get(email, []) if now - t < WINDOW_SECONDS]
    _failures[email] = recent
    return len(recent)


def authenticate(email, password):
    global _dummy_hash

    email = email.strip().lower()

    if _recent_failures(email) >= MAX_FAILURES:
        raise RateLimited()

    with db() as conn:
        row = conn.execute(
            "SELECT id, name, email, password_hash FROM users WHERE email = ?",
            (email,),
        ).fetchone()

    if row is None:
        # spend the same time as a real check so timing does not reveal accounts
        if _dummy_hash is None:
            _dummy_hash = hash_password("dummy-password")

        verify_password(password, _dummy_hash)
        ok = False
    else:
        ok = verify_password(password, row["password_hash"])

    if not ok:
        _failures.setdefault(email, []).append(time.time())
        return None

    _failures.pop(email, None)

    return {"id": row["id"], "name": row["name"], "email": row["email"]}


# ------------------------------------------------
# TOKENS
# ------------------------------------------------

def create_token(user_id):
    payload = {
        "sub": str(user_id),
        "exp": datetime.now(timezone.utc) + timedelta(days=TOKEN_DAYS),
    }

    return jwt.encode(payload, SECRET_KEY, algorithm="HS256")


def user_from_token(token):
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=["HS256"])
        user_id = int(payload["sub"])
    except (jwt.PyJWTError, KeyError, ValueError):
        return None

    with db() as conn:
        row = conn.execute(
            "SELECT id, name, email FROM users WHERE id = ?", (user_id,)
        ).fetchone()

    return dict(row) if row else None
