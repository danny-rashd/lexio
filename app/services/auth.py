from datetime import datetime, timedelta, timezone

from fastapi import HTTPException, status
from jose import JWTError, jwt
from passlib.context import CryptContext

from app.config import settings

_pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def hash_password(plain: str) -> str:
    """
    Hash a plaintext password using bcrypt.

    Args:
        plain (str): Raw password string from user input.

    Returns:
        str: Bcrypt hash safe to store in the database.

    Notes:
        Never store or log the plain value after this call.
    """
    return _pwd_context.hash(plain)


def verify_password(plain: str, hashed: str) -> bool:
    """
    Compare a plaintext password against a stored bcrypt hash.

    Args:
        plain (str): Raw input from login form.
        hashed (str): Value stored in users.hashed_password.

    Returns:
        bool: True if the password matches, False otherwise.
    """
    return _pwd_context.verify(plain, hashed)


def create_access_token(user_id: int, username: str) -> str:
    """
    Issue a signed JWT access token.

    Args:
        user_id (int): Primary key of the authenticated user.
        username (str): Stored in token payload for convenience.

    Returns:
        str: Encoded JWT. Expires after JWT_EXPIRE_MINUTES.

    Notes:
        Signs with SECRET_KEY from environment. Never hard-code the key.
    """
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.JWT_EXPIRE_MINUTES)
    payload = {"sub": str(user_id), "username": username, "exp": expire}
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=settings.JWT_ALGORITHM)


def decode_access_token(token: str) -> dict:
    """
    Verify and decode a JWT token.

    Args:
        token (str): Raw Bearer token from Authorization header.

    Returns:
        dict: Payload with 'sub' (user_id as str) and 'username'.

    Notes:
        Raises HTTP 401 if the token is expired, malformed, or has an
        invalid signature.
    """
    try:
        return jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.JWT_ALGORITHM])
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        )
