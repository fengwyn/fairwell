import re

from rest_framework import serializers

from .models import Color, Document, Type


_SLUG_STRIP = re.compile(r'[^a-z0-9]+')


def _slugify(text: str, fallback: str) -> str:
    s = _SLUG_STRIP.sub('', (text or '').lower())[:64]
    return s or fallback


def _uniquify(model, owner, base):
    slug = base
    n = 2
    while model.objects.filter(owner=owner, slug=slug).exists():
        slug = f'{base}-{n}'
        n += 1
    return slug


class _OwnedSlugSerializer(serializers.ModelSerializer):
    """Shared create/update behavior: owner from request, slug auto-uniquified, slug sticky."""

    _slug_source_field = 'label'  # subclasses can override (e.g. 'title' for Document)
    _slug_fallback = 'item'

    def create(self, validated_data):
        owner = self.context['request'].user
        base = (
            validated_data.get('slug')
            or _slugify(validated_data.get(self._slug_source_field, ''), self._slug_fallback)
        )
        validated_data['slug'] = _uniquify(self.Meta.model, owner, base)
        validated_data['owner'] = owner
        return super().create(validated_data)

    def update(self, instance, validated_data):
        validated_data.pop('slug', None)
        return super().update(instance, validated_data)


class ColorSerializer(_OwnedSlugSerializer):
    id = serializers.CharField(source='slug', required=False, allow_blank=True)
    _slug_fallback = 'color'

    class Meta:
        model = Color
        fields = ['id', 'label', 'hex']


class TypeSerializer(_OwnedSlugSerializer):
    id = serializers.CharField(source='slug', required=False, allow_blank=True)
    colorId = serializers.CharField(source='color_id', required=False, allow_blank=True)
    _slug_fallback = 'type'

    class Meta:
        model = Type
        fields = ['id', 'label', 'colorId']


class DocumentSerializer(_OwnedSlugSerializer):
    id = serializers.CharField(source='slug', required=False, allow_blank=True)
    typeId = serializers.CharField(source='type_id', required=False, allow_blank=True)
    colorClass = serializers.CharField(source='color_class', required=False, allow_blank=True)
    badge = serializers.CharField(required=False, allow_blank=True)
    url = serializers.CharField(required=False, allow_blank=True)
    role = serializers.CharField(required=False, allow_blank=True)
    desc = serializers.CharField(required=False, allow_blank=True)
    links = serializers.JSONField(required=False)
    _slug_source_field = 'title'
    _slug_fallback = 'doc'

    class Meta:
        model = Document
        fields = ['id', 'typeId', 'badge', 'colorClass', 'title', 'url', 'role', 'desc', 'links']
