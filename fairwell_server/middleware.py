from django.conf import settings

# gunicorn
class NoCacheStaticMiddleware:
    """Sends `Cache-Control: no-store` for /static/* responses.

    Dev-only. Stops browsers from serving stale JS/CSS after edits, which
    otherwise causes phantom bugs that only repro when DevTools is closed.
    """

    def __init__(self, get_response):
        self.get_response = get_response
        prefix = settings.STATIC_URL or 'static/'
        self._prefix = '/' + prefix.lstrip('/')

    def __call__(self, request):
        response = self.get_response(request)
        if request.path.startswith(self._prefix):
            response['Cache-Control'] = 'no-store, must-revalidate'
            response['Pragma'] = 'no-cache'
        return response
