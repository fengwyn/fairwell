from django.conf import settings
from django.db import models


class Color(models.Model):
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='colors',
    )
    slug = models.CharField(max_length=64)
    label = models.CharField(max_length=64)
    hex = models.CharField(max_length=9)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=['owner', 'slug'], name='uniq_color_owner_slug'),
        ]
        ordering = ['created_at', 'id']

    def __str__(self):
        return f'{self.owner_id}/{self.slug}'


class Type(models.Model):
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='types',
    )
    slug = models.CharField(max_length=64)
    label = models.CharField(max_length=64)
    color_id = models.CharField(max_length=64, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=['owner', 'slug'], name='uniq_type_owner_slug'),
        ]
        ordering = ['created_at', 'id']

    def __str__(self):
        return f'{self.owner_id}/{self.slug}'


class Document(models.Model):
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='documents',
    )
    slug = models.CharField(max_length=64)
    type_id = models.CharField(max_length=64, blank=True)
    badge = models.CharField(max_length=64, blank=True)
    color_class = models.CharField(max_length=64, blank=True)
    title = models.CharField(max_length=256)
    url = models.CharField(max_length=512, blank=True, default='#')
    role = models.CharField(max_length=512, blank=True)
    desc = models.TextField(blank=True)
    links = models.JSONField(default=list)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=['owner', 'slug'], name='uniq_document_owner_slug'),
        ]
        ordering = ['created_at', 'id']

    def __str__(self):
        return f'{self.owner_id}/{self.slug or self.title}'
