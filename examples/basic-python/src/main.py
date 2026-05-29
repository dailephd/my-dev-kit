"""Main module for the basic-python example."""

import os
from utils import format_name, Formatter

__all__ = ["greet", "UserService"]

APP_NAME = "BasicPython"


def greet(name: str) -> str:
    """Return a greeting string for the given name."""
    return f"Hello, {name}!"


async def fetch_user(user_id: int) -> dict:
    """Async function to fetch a user by ID (stub)."""
    return {"id": user_id, "name": "Alice"}


def _build_message(template: str, **kwargs) -> str:
    """Private builder — not in __all__."""
    return template.format(**kwargs)


class UserService:
    """Service for managing users."""

    def __init__(self, base_url: str) -> None:
        self.base_url = base_url
        self._formatter = Formatter(prefix="[user] ")

    def describe(self, first: str, last: str) -> str:
        full = format_name(first, last)
        return self._formatter.format(full)

    def get_env(self) -> str:
        return os.environ.get("APP_ENV", "development")
