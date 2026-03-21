"""
JWT token creation and verification for SecondCortex.
"""

from __future__ import annotations

import logging
import time

import jwt

from config import settings

logger = logging.getLogger("secondcortex.auth.jwt")

ALGORITHM = "HS256"
TOKEN_EXPIRY_SECONDS = 7 * 24 * 3600  # 7 days


def _get_secret() -> str:
    """Get JWT secret from settings."""
    secret = settings.jwt_secret
    if not secret:
        raise RuntimeError("JWT_SECRET is not set. Add it to your .env file.")
    return secret


def create_token(user_id: str, email: str) -> str:
    """Create a signed JWT token."""
    payload = {
        "sub": user_id,
        "email": email,
        "iat": int(time.time()),
        "exp": int(time.time()) + TOKEN_EXPIRY_SECONDS,
    }
    return jwt.encode(payload, _get_secret(), algorithm=ALGORITHM)


def create_pm_guest_token(team_id: str, display_name: str | None = None) -> str:
    """Create a restricted PM guest token with read/chat-only scope."""
    now = int(time.time())
    payload = {
        "sub": f"pm_guest:{team_id}",
        "email": settings.pm_guest_email,
        "display_name": display_name or settings.pm_guest_display_name,
        "role": "pm_guest",
        "team_id": team_id,
        "scopes": ["pm:read", "pm:chat"],
        "iat": now,
        "exp": now + max(300, int(settings.pm_guest_token_expiry_seconds)),
    }
    return jwt.encode(payload, _get_secret(), algorithm=ALGORITHM)


def verify_token(token: str) -> dict | None:
    """Verify and decode a JWT token. Returns payload or None."""
    try:
        payload = jwt.decode(token, _get_secret(), algorithms=[ALGORITHM])
        return payload
    except jwt.ExpiredSignatureError:
        logger.warning("Token expired.")
        return None
    except jwt.InvalidTokenError as e:
        logger.warning("Invalid token: %s", e)
        return None

from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

bearer_scheme = HTTPBearer(auto_error=False)


async def get_current_principal(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
) -> dict:
    """
    Validates Bearer JWT and returns the decoded payload.
    Supports both normal user tokens and restricted PM guest tokens.
    """
    if credentials is None:
        raise HTTPException(status_code=401, detail="Missing Authorization header. Please log in.")

    payload = verify_token(credentials.credentials)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid or expired token. Please log in again.")

    return payload

async def get_current_user(
    principal: dict = Depends(get_current_principal),
) -> str:
    """
    Validates the Bearer JWT token and returns the user_id.
    Rejects restricted PM guest tokens for standard user-only endpoints.
    """
    role = str(principal.get("role") or "user")
    if role == "pm_guest":
        raise HTTPException(status_code=403, detail="PM guest token is restricted for this endpoint.")

    user_id = principal.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid token payload.")

    return str(user_id)
