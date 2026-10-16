"""Emergency contacts, stored per user in SQLite."""
import re
import sqlite3
import uuid

from services.db import db

PHONE_PATTERN = re.compile(r"^\+\d{8,15}$")
MAX_CONTACTS = 10


def list_contacts(user_id):
    with db() as conn:
        rows = conn.execute(
            "SELECT id, name, phone, relation FROM contacts "
            "WHERE user_id = ? ORDER BY rowid",
            (user_id,),
        ).fetchall()

    return [dict(row) for row in rows]


def add_contact(user_id, name, phone, relation=""):
    name = name.strip()
    relation = relation.strip()
    phone = re.sub(r"[\s\-()]", "", phone)

    if not name:
        raise ValueError("Name is required.")

    if not PHONE_PATTERN.match(phone):
        raise ValueError(
            "Phone must include the country code, e.g. +919876543210."
        )

    if len(list_contacts(user_id)) >= MAX_CONTACTS:
        raise ValueError(f"You can save up to {MAX_CONTACTS} contacts.")

    contact = {
        "id": uuid.uuid4().hex[:8],
        "name": name,
        "phone": phone,
        "relation": relation,
    }

    try:
        with db() as conn:
            conn.execute(
                "INSERT INTO contacts (id, user_id, name, phone, relation) "
                "VALUES (?, ?, ?, ?, ?)",
                (contact["id"], user_id, name, phone, relation),
            )
    except sqlite3.IntegrityError:
        raise ValueError("That phone number is already saved.")

    return contact


def delete_contact(user_id, contact_id):
    with db() as conn:
        cursor = conn.execute(
            "DELETE FROM contacts WHERE id = ? AND user_id = ?",
            (contact_id, user_id),
        )

    return cursor.rowcount > 0
