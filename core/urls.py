from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import ColorViewSet, DocumentViewSet, TypeViewSet

router = DefaultRouter()
router.register('colors', ColorViewSet, basename='color')
router.register('types', TypeViewSet, basename='type')
router.register('documents', DocumentViewSet, basename='document')

urlpatterns = [
    path('', include(router.urls)),
]
