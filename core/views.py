from rest_framework import status, viewsets
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import CatalogEntry, Color, Document, Type
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


class CatalogView(APIView):
    """GET returns the full per-user catalog; PATCH upserts the kinds in the body.

    Body shape mirrors the legacy `appData` blob (subset of):
        { "hierarchy": [...], "decisionFlow": [...], "descriptions": {...}, ... }
    """

    def get(self, request):
        entries = CatalogEntry.objects.filter(owner=request.user)
        return Response({e.kind: e.data for e in entries})

    def patch(self, request):
        body = request.data
        if not isinstance(body, dict):
            return Response({'detail': 'expected JSON object'}, status=status.HTTP_400_BAD_REQUEST)
        unknown = set(body) - CatalogEntry.VALID_KINDS
        if unknown:
            return Response(
                {'detail': f'unknown kinds: {sorted(unknown)}'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        for kind, data in body.items():
            CatalogEntry.objects.update_or_create(
                owner=request.user, kind=kind,
                defaults={'data': data},
            )
        entries = CatalogEntry.objects.filter(owner=request.user)
        return Response({e.kind: e.data for e in entries})
