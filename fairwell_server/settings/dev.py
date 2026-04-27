"""Development settings: DEBUG on, SQLite, permissive hosts."""

from decouple import config

from .base import *  # noqa: F401,F403

DEBUG = True

ALLOWED_HOSTS = ['localhost', '127.0.0.1', 'gentoo', '192.168.0.241', '*']

CORS_ALLOW_ALL_ORIGINS = True

# Have WhiteNoise serve static files in dev too, with no caching, so JS/CSS
# edits show up on the next request without manual hard-refresh.
WHITENOISE_USE_FINDERS = True
WHITENOISE_AUTOREFRESH = True
WHITENOISE_MAX_AGE = 0

# Set DEV_DB_PATH in .env to point at an external SSD; on the gentoo Pi this
# avoids hammering the boot SD card with SQLite writes.
DATABASES['default']['NAME'] = config(
    'DEV_DB_PATH',
    default=str(BASE_DIR / 'db.sqlite3'),
)
