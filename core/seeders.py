"""Per-user seeders: clone data.json contents into a fresh account."""

import json
from pathlib import Path

from django.conf import settings

from .models import CatalogEntry, Color, Document, Type


def _load_seed():
    seed_path = Path(settings.BASE_DIR) / 'data.json'
    if not seed_path.exists():
        return None
    with seed_path.open('r', encoding='utf-8') as f:
        return json.load(f)


def seed_colors(user, data=None) -> int:
    data = data if data is not None else _load_seed()
    if not data:
        return 0
    items = data.get('colors') or []
    existing = set(Color.objects.filter(owner=user).values_list('slug', flat=True))
    created = 0
    for c in items:
        slug = c.get('id') or ''
        if not slug or slug in existing:
            continue
        Color.objects.create(
            owner=user,
            slug=slug,
            label=c.get('label') or slug,
            hex=c.get('hex') or '',
        )
        existing.add(slug)
        created += 1
    return created


def seed_types(user, data=None) -> int:
    data = data if data is not None else _load_seed()
    if not data:
        return 0
    items = data.get('types') or []
    existing = set(Type.objects.filter(owner=user).values_list('slug', flat=True))
    created = 0
    for t in items:
        slug = t.get('id') or ''
        if not slug or slug in existing:
            continue
        Type.objects.create(
            owner=user,
            slug=slug,
            label=t.get('label') or slug,
            color_id=t.get('colorId') or '',
        )
        existing.add(slug)
        created += 1
    return created


def seed_documents(user, data=None) -> int:
    data = data if data is not None else _load_seed()
    if not data:
        return 0
    items = data.get('documents') or []
    existing = set(Document.objects.filter(owner=user).values_list('slug', flat=True))
    created = 0
    for d in items:
        slug = d.get('id') or ''
        if not slug or slug in existing:
            continue
        Document.objects.create(
            owner=user,
            slug=slug,
            type_id=d.get('typeId') or '',
            badge=d.get('badge') or '',
            color_class=d.get('colorClass') or '',
            title=d.get('title') or '',
            url=d.get('url') or '#',
            role=d.get('role') or '',
            desc=d.get('desc') or '',
            links=d.get('links') or [],
        )
        existing.add(slug)
        created += 1
    return created


def seed_catalog(user, data=None) -> int:
    """Seed CatalogEntry rows for any catalog kind present in data.json.

    Idempotent: skips kinds already saved for this user.
    """
    data = data if data is not None else _load_seed()
    if not data:
        return 0
    existing = set(CatalogEntry.objects.filter(owner=user).values_list('kind', flat=True))
    created = 0
    for kind in CatalogEntry.VALID_KINDS:
        if kind in existing or kind not in data:
            continue
        CatalogEntry.objects.create(owner=user, kind=kind, data=data[kind])
        created += 1
    return created


def seed_user(user) -> dict:
    """Seed everything we have a model for. Returns counts per category."""
    data = _load_seed()
    return {
        'colors': seed_colors(user, data),
        'types': seed_types(user, data),
        'documents': seed_documents(user, data),
        'catalog': seed_catalog(user, data),
    }
