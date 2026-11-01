"""Controlled source-audit fixture for explicit __all__ handling."""
import os
from . import sibling
from .pkg.mod import thing as renamed, other
from .. import parent_pkg

__all__ = ["public_function", "PublicClass", "MISSING_NAME"]


def public_function():
    return os.getcwd()


def hidden_function():
    return 1


class PublicClass:
    def method(self):
        return renamed
