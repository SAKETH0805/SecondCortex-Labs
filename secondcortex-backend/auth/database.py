"""
SQLite-backed user database for SecondCortex authentication.
Uses persistent storage on Azure (/home/auth.db).
"""

from __future__ import annotations

import hashlib
import hmac
import logging
import os
import sqlite3
import uuid
from pathlib import Path

from config import settings

logger = logging.getLogger("secondcortex.auth.database")


def _get_db_path() -> str:
    """Use the same persistent storage root as ChromaDB."""
    base = settings.chroma_db_path  # /home/chroma_db on Azure, ./chroma_db locally
    db_dir = str(Path(base).parent)  # /home on Azure, . locally
    os.makedirs(db_dir, exist_ok=True)
    return os.path.join(db_dir, "auth.db")


def _hash_password(password: str, salt: str | None = None) -> tuple[str, str]:
    """Hash password with PBKDF2-SHA256. Returns (hash_hex, salt_hex)."""
    if salt is None:
        salt = os.urandom(32).hex()
    pw_hash = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        bytes.fromhex(salt),
        iterations=100_000,
    )
    return pw_hash.hex(), salt


def _verify_password(password: str, stored_hash: str, salt: str) -> bool:
    """Verify a password against stored hash."""
    computed_hash, _ = _hash_password(password, salt)
    return hmac.compare_digest(computed_hash, stored_hash)


class UserDB:
    """Manages user accounts in SQLite."""

    def __init__(self) -> None:
        self.db_path = _get_db_path()
        self._init_db()
        logger.info("Auth database initialized at: %s", self.db_path)

    def _init_db(self) -> None:
        with sqlite3.connect(self.db_path) as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS users (
                    id TEXT PRIMARY KEY,
                    email TEXT UNIQUE NOT NULL,
                    password_hash TEXT NOT NULL,
                    password_salt TEXT NOT NULL,
                    display_name TEXT NOT NULL DEFAULT '',
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS chat_sessions (
                    id TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL,
                    title TEXT NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (user_id) REFERENCES users (id)
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS chat_messages (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id TEXT NOT NULL,
                    session_id TEXT,
                    role TEXT NOT NULL,
                    content TEXT NOT NULL,
                    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (user_id) REFERENCES users (id),
                    FOREIGN KEY (session_id) REFERENCES chat_sessions (id)
                )
            """)
            conn.commit()

    def create_chat_session(self, user_id: str, title: str = "New Chat") -> str:
        """Create a new chat session and return its ID."""
        session_id = str(uuid.uuid4())
        with sqlite3.connect(self.db_path) as conn:
            conn.execute(
                "INSERT INTO chat_sessions (id, user_id, title) VALUES (?, ?, ?)",
                (session_id, user_id, title),
            )
            conn.commit()
        return session_id

    def get_chat_sessions(self, user_id: str) -> list[dict]:
        """List all chat sessions for a user."""
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.execute(
                "SELECT id, title, created_at FROM chat_sessions WHERE user_id = ? ORDER BY created_at DESC",
                (user_id,),
            )
            rows = cursor.fetchall()
            return [{"id": r[0], "title": r[1], "created_at": r[2]} for r in rows]

    def save_chat_message(self, user_id: str, role: str, content: str, session_id: str | None = None) -> None:
        """Save a chat message to a specific session."""
        with sqlite3.connect(self.db_path) as conn:
            conn.execute(
                "INSERT INTO chat_messages (user_id, session_id, role, content) VALUES (?, ?, ?, ?)",
                (user_id, session_id, role, content),
            )
            conn.commit()

    def get_chat_history(self, user_id: str, session_id: str | None = None, limit: int = 50) -> list[dict]:
        """Retrieve chat history, optionally filtered by session."""
        query = "SELECT role, content, timestamp FROM chat_messages WHERE user_id = ?"
        params = [user_id]
        if session_id:
            query += " AND session_id = ?"
            params.append(session_id)
        else:
            query += " AND session_id IS NULL"
        
        query += " ORDER BY id DESC LIMIT ?"
        params.append(limit)

        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.execute(query, tuple(params))
            rows = cursor.fetchall()
            return [{"role": r[0], "content": r[1], "timestamp": r[2]} for r in reversed(rows)]

    def delete_chat_history(self, user_id: str, session_id: str | None = None) -> None:
        """Clear chat history (single session or all if none specified)."""
        with sqlite3.connect(self.db_path) as conn:
            if session_id:
                conn.execute("DELETE FROM chat_messages WHERE user_id = ? AND session_id = ?", (user_id, session_id))
                conn.execute("DELETE FROM chat_sessions WHERE user_id = ? AND id = ?", (user_id, session_id))
            else:
                conn.execute("DELETE FROM chat_messages WHERE user_id = ?", (user_id,))
                conn.execute("DELETE FROM chat_sessions WHERE user_id = ?", (user_id,))
            conn.commit()


    def create_user(self, email: str, password: str, display_name: str = "") -> dict | None:
        """Create a new user. Returns user dict or None if email already exists."""
        email = email.lower().strip()
        user_id = str(uuid.uuid4())[:8]  # Short user ID for collection namespacing
        pw_hash, salt = _hash_password(password)

        try:
            with sqlite3.connect(self.db_path) as conn:
                conn.execute(
                    "INSERT INTO users (id, email, password_hash, password_salt, display_name) VALUES (?, ?, ?, ?, ?)",
                    (user_id, email, pw_hash, salt, display_name or email.split("@")[0]),
                )
                conn.commit()
            logger.info("Created user: %s (%s)", user_id, email)
            return {"id": user_id, "email": email, "display_name": display_name or email.split("@")[0]}
        except sqlite3.IntegrityError:
            logger.warning("User already exists: %s", email)
            return None

    def authenticate(self, email: str, password: str) -> dict | None:
        """Verify credentials. Returns user dict or None."""
        email = email.lower().strip()
        with sqlite3.connect(self.db_path) as conn:
            row = conn.execute(
                "SELECT id, email, password_hash, password_salt, display_name FROM users WHERE email = ?",
                (email,),
            ).fetchone()

        if row is None:
            return None

        user_id, user_email, stored_hash, salt, display_name = row
        if _verify_password(password, stored_hash, salt):
            return {"id": user_id, "email": user_email, "display_name": display_name}
        return None

    def get_user_by_id(self, user_id: str) -> dict | None:
        """Lookup a user by ID."""
        with sqlite3.connect(self.db_path) as conn:
            row = conn.execute(
                "SELECT id, email, display_name FROM users WHERE id = ?",
                (user_id,),
            ).fetchone()
        if row:
            return {"id": row[0], "email": row[1], "display_name": row[2]}
        return None
