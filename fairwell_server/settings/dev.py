"""Development settings: DEBUG on, SQLite, permissive hosts."""

from .base import *  # noqa: F401,F403

DEBUG = True

ALLOWED_HOSTS = ['localhost', '127.0.0.1', 'gentoo', '192.168.0.241', '*']

CORS_ALLOW_ALL_ORIGINS = True
