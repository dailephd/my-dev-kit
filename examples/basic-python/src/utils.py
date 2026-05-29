"""Shared utilities for the basic-python example."""

MAX_RETRIES = 3
DEFAULT_TIMEOUT = 30


def format_name(first: str, last: str) -> str:
    """Return a formatted full name."""
    return f"{first} {last}"


def _internal_helper(value: str) -> str:
    """Private helper not included in public API."""
    return value.strip().lower()


class Formatter:
    """Formats values for display."""

    def __init__(self, prefix: str = "") -> None:
        self.prefix = prefix

    def format(self, value: str) -> str:
        return f"{self.prefix}{value}" if self.prefix else value
