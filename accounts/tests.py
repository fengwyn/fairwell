from django.test import TestCase

from .models import User


class AuthGateTests(TestCase):
    def test_anonymous_home_redirects_to_login(self):
        resp = self.client.get('/')
        self.assertEqual(resp.status_code, 302)
        self.assertIn('/login/', resp.url)

    def test_authenticated_home_renders(self):
        User.objects.create_user(username='alice', password='pw-test-123!')
        self.client.login(username='alice', password='pw-test-123!')
        resp = self.client.get('/')
        self.assertEqual(resp.status_code, 200)
        self.assertIn(b'FAIR', resp.content)

    def test_login_page_accessible_anonymously(self):
        resp = self.client.get('/login/')
        self.assertEqual(resp.status_code, 200)

    def test_signup_page_accessible_anonymously(self):
        resp = self.client.get('/signup/')
        self.assertEqual(resp.status_code, 200)

    def test_signup_creates_user_and_logs_in(self):
        resp = self.client.post('/signup/', {
            'username': 'bob',
            'email': 'bob@example.com',
            'password1': 'aPassword12345!',
            'password2': 'aPassword12345!',
        })
        self.assertEqual(resp.status_code, 302)
        self.assertEqual(resp.url, '/')
        self.assertTrue(User.objects.filter(username='bob').exists())
        home = self.client.get('/')
        self.assertEqual(home.status_code, 200)

    def test_logout_post_redirects_to_login(self):
        User.objects.create_user(username='carol', password='pw-test-123!')
        self.client.login(username='carol', password='pw-test-123!')
        resp = self.client.post('/logout/')
        self.assertEqual(resp.status_code, 302)
        self.assertIn('/login/', resp.url)
