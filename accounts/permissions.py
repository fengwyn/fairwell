from rest_framework.permissions import IsAuthenticated


class IsAuthenticatedAndSubscribed(IsAuthenticated):
    """Stub. Phase 3 will add `request.user.subscription.status == 'active'`."""
    pass
