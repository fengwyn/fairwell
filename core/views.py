from rest_framework import viewsets

from .models import Color, Document, Type
from .serializers import ColorSerializer, DocumentSerializer, TypeSerializer


class _OwnerScopedViewSet(viewsets.ModelViewSet):
    lookup_field = 'slug'
    pagination_class = None

    def get_queryset(self):
        return self.queryset.filter(owner=self.request.user)


class ColorViewSet(_OwnerScopedViewSet):
    queryset = Color.objects.all()
    serializer_class = ColorSerializer


class TypeViewSet(_OwnerScopedViewSet):
    queryset = Type.objects.all()
    serializer_class = TypeSerializer


class DocumentViewSet(_OwnerScopedViewSet):
    queryset = Document.objects.all()
    serializer_class = DocumentSerializer
