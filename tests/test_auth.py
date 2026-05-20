from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException
from jose import jwt

from app.config import settings
from app.services.auth import (
    create_access_token,
    decode_access_token,
    hash_password,
    verify_password,
)


def test_hash_password_never_returns_plaintext():
    hashed = hash_password("mysecret")
    assert hashed != "mysecret"


def test_verify_password_correct():
    hashed = hash_password("correcthorsebattery")
    assert verify_password("correcthorsebattery", hashed) is True


def test_verify_password_wrong():
    hashed = hash_password("correcthorsebattery")
    assert verify_password("wrongpassword", hashed) is False


def test_create_access_token_is_decodable():
    token = create_access_token(user_id=1, username="testuser")
    payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.JWT_ALGORITHM])
    assert payload["sub"] == "1"
    assert payload["username"] == "testuser"


def test_decode_expired_token_raises_401():
    expired_payload = {
        "sub": "1",
        "username": "testuser",
        "exp": datetime.now(timezone.utc) - timedelta(minutes=1),
    }
    token = jwt.encode(expired_payload, settings.SECRET_KEY, algorithm=settings.JWT_ALGORITHM)
    with pytest.raises(HTTPException) as exc_info:
        decode_access_token(token)
    assert exc_info.value.status_code == 401


def test_decode_tampered_token_raises_401():
    with pytest.raises(HTTPException) as exc_info:
        decode_access_token("tampered.invalid.token")
    assert exc_info.value.status_code == 401


def test_login_valid_credentials(client, seeded_user):
    res = client.post("/api/auth/login", json={"username": "testuser", "password": "testpass"})
    assert res.status_code == 200
    data = res.json()
    assert "access_token" in data
    assert data["token_type"] == "bearer"


def test_login_wrong_password(client, seeded_user):
    res = client.post("/api/auth/login", json={"username": "testuser", "password": "wrong"})
    assert res.status_code == 401


def test_protected_endpoint_no_token(client):
    res = client.get("/api/auth/me")
    assert res.status_code == 401
