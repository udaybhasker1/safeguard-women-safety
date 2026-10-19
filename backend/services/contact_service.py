"""Emergency contacts, stored per user in SQLite."""
import re
import secrets
import sqlite3
import uuid

from services.db import db

PHONE_PATTERN = re.compile(r"^\+\d{8,15}$")
MAX_CONTACTS = 10


def list_contacts(user_id):
    """Full rows (including Telegram link data) for internal use."""
    with db() as conn:
        rows = conn.execute(
            "SELECT id, name, phone, relation, link_token, telegram_chat_id "
            "FROM contacts WHERE user_id = ? ORDER BY rowid",
            (user_id,),
        ).fetchall()

        contacts = [dict(row) for row in rows]

        # contacts saved before Telegram support get a token now
        for contact in contacts:
            if not contact["link_token"]:
                contact["link_token"] = secrets.token_urlsafe(8)

                conn.execute(
                    "UPDATE contacts SET link_token = ? WHERE id = ?",
                    (contact["link_token"], contact["id"]),
                )

    return contacts


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
        "link_token": secrets.token_urlsafe(8),
        "telegram_chat_id": None,
    }

    try:
        with db() as conn:
            conn.execute(
                "INSERT INTO contacts "
                "(id, user_id, name, phone, relation, link_token) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                (
                    contact["id"],
                    user_id,
                    name,
                    phone,
                    relation,
                    contact["link_token"],
                ),
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


def link_telegram(link_token, chat_id):
    """Links a Telegram chat to the contact that owns this token.

    A contact that is already linked to a different chat is left alone, so a
    forwarded invite link cannot take over an existing link.
    Returns the name of the account owner, or None.
    """
    with db() as conn:
        row = conn.execute(
            "SELECT c.id AS id, u.name AS owner FROM contacts c "
            "JOIN users u ON u.id = c.user_id "
            "WHERE c.link_token = ? "
            "AND (c.telegram_chat_id IS NULL OR c.telegram_chat_id = ?)",
            (link_token, chat_id),
        ).fetchone()

        if row is None:
            return None

        conn.execute(
            "UPDATE contacts SET telegram_chat_id = ? WHERE id = ?",
            (chat_id, row["id"]),
        )

    return row["owner"]