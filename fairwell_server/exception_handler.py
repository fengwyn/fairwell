from rest_framework.exceptions import NotAuthenticated
from rest_framework.views import exception_handler


def custom_exception_handler(exc, context):
    """Force 401 for unauthenticated DRF requests.

    DRF's default coerces 401→403 when no auth class advertises a
    WWW-Authenticate header (which session auth does not). For our same-origin
    SPA, anonymous requests are conceptually NotAuthenticated, not Forbidden.
    """
    response = exception_handler(exc, context)
    if response is not None and isinstance(exc, NotAuthenticated):
        response.status_code = 401
    return response
