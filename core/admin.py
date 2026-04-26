from django.contrib import admin

from .models import Color, Document, Type


@admin.register(Color)
class ColorAdmin(admin.ModelAdmin):
    list_display = ('slug', 'label', 'hex', 'owner', 'created_at')
    list_filter = ('owner',)
    search_fields = ('slug', 'label')


@admin.register(Type)
class TypeAdmin(admin.ModelAdmin):
    list_display = ('slug', 'label', 'color_id', 'owner', 'created_at')
    list_filter = ('owner',)
    search_fields = ('slug', 'label')


@admin.register(Document)
class DocumentAdmin(admin.ModelAdmin):
    list_display = ('slug', 'title', 'owner', 'type_id', 'created_at')
    list_filter = ('owner', 'type_id')
    search_fields = ('slug', 'title', 'desc')
