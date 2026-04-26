from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase

from .models import CatalogEntry, Color, Document, Type

User = get_user_model()


class DocumentApiTests(APITestCase):
    def setUp(self):
        self.alice = User.objects.create_user(username='alice', password='pw-test-1!')
        self.bob = User.objects.create_user(username='bob', password='pw-test-2!')
        self.alice_doc = Document.objects.create(
            owner=self.alice,
            slug='alphabet',
            type_id='foundation',
            badge='FOUNDATION',
            color_class='alphacolor',
            title='Alpha doc',
            url='#',
            role='Test role',
            desc='Test desc',
            links=[{'text': 'foo', 'url': '#'}],
        )

    def test_anonymous_list_is_unauthorized(self):
        resp = self.client.get('/api/documents/')
        self.assertEqual(resp.status_code, 401)

    def test_anonymous_detail_is_unauthorized(self):
        resp = self.client.get(f'/api/documents/{self.alice_doc.slug}/')
        self.assertEqual(resp.status_code, 401)

    def test_owner_can_list_their_docs_only(self):
        Document.objects.create(owner=self.bob, slug='bobdoc', title='Bob doc')
        self.client.force_login(self.alice)
        resp = self.client.get('/api/documents/')
        self.assertEqual(resp.status_code, 200)
        slugs = [d['id'] for d in resp.json()]
        self.assertEqual(slugs, ['alphabet'])

    def test_owner_sees_camelcase_keys(self):
        self.client.force_login(self.alice)
        resp = self.client.get('/api/documents/')
        body = resp.json()[0]
        self.assertEqual(body['id'], 'alphabet')
        self.assertEqual(body['typeId'], 'foundation')
        self.assertEqual(body['colorClass'], 'alphacolor')
        self.assertEqual(body['links'], [{'text': 'foo', 'url': '#'}])

    def test_other_user_get_returns_404_not_403(self):
        self.client.force_login(self.bob)
        resp = self.client.get(f'/api/documents/{self.alice_doc.slug}/')
        self.assertEqual(resp.status_code, 404)

    def test_other_user_patch_returns_404(self):
        self.client.force_login(self.bob)
        resp = self.client.patch(
            f'/api/documents/{self.alice_doc.slug}/',
            {'title': 'hijacked'},
            format='json',
        )
        self.assertEqual(resp.status_code, 404)
        self.alice_doc.refresh_from_db()
        self.assertEqual(self.alice_doc.title, 'Alpha doc')

    def test_other_user_delete_returns_404(self):
        self.client.force_login(self.bob)
        resp = self.client.delete(f'/api/documents/{self.alice_doc.slug}/')
        self.assertEqual(resp.status_code, 404)
        self.assertTrue(Document.objects.filter(pk=self.alice_doc.pk).exists())

    def test_create_assigns_owner_from_request_user(self):
        self.client.force_login(self.alice)
        resp = self.client.post(
            '/api/documents/',
            {
                'title': 'New Doc',
                'typeId': 'default',
                'badge': 'DEFAULT',
                'colorClass': 'color1',
                'role': 'role',
                'desc': 'desc',
                'url': '#',
                'links': [],
            },
            format='json',
        )
        self.assertEqual(resp.status_code, 201, resp.content)
        body = resp.json()
        self.assertEqual(body['id'], 'newdoc')
        self.assertEqual(body['title'], 'New Doc')
        doc = Document.objects.get(slug='newdoc', owner=self.alice)
        self.assertEqual(doc.owner_id, self.alice.id)

    def test_create_auto_uniquifies_duplicate_slug(self):
        self.client.force_login(self.alice)
        # First create -> slug "alphabet" already taken (from setUp)
        resp = self.client.post(
            '/api/documents/',
            {'title': 'Alphabet', 'links': []},
            format='json',
        )
        self.assertEqual(resp.status_code, 201, resp.content)
        self.assertEqual(resp.json()['id'], 'alphabet-2')

    def test_update_does_not_allow_slug_change(self):
        self.client.force_login(self.alice)
        resp = self.client.patch(
            f'/api/documents/{self.alice_doc.slug}/',
            {'id': 'renamed', 'title': 'Renamed'},
            format='json',
        )
        self.assertEqual(resp.status_code, 200, resp.content)
        body = resp.json()
        self.assertEqual(body['id'], 'alphabet')
        self.assertEqual(body['title'], 'Renamed')


class TypeApiTests(APITestCase):
    def setUp(self):
        self.alice = User.objects.create_user(username='alice', password='pw-test-1!')
        self.bob = User.objects.create_user(username='bob', password='pw-test-2!')
        self.alice_type = Type.objects.create(
            owner=self.alice, slug='foundation', label='FOUNDATION', color_id='colasqr',
        )

    def test_anonymous_list_is_unauthorized(self):
        self.assertEqual(self.client.get('/api/types/').status_code, 401)

    def test_owner_lists_their_types_only(self):
        Type.objects.create(owner=self.bob, slug='other', label='OTHER')
        self.client.force_login(self.alice)
        body = self.client.get('/api/types/').json()
        self.assertEqual([t['id'] for t in body], ['foundation'])

    def test_camelcase_color_id_serialized(self):
        self.client.force_login(self.alice)
        body = self.client.get('/api/types/').json()[0]
        self.assertEqual(body, {'id': 'foundation', 'label': 'FOUNDATION', 'colorId': 'colasqr'})

    def test_other_user_get_returns_404(self):
        self.client.force_login(self.bob)
        self.assertEqual(self.client.get('/api/types/foundation/').status_code, 404)

    def test_create_assigns_owner_and_slug_from_label(self):
        self.client.force_login(self.alice)
        resp = self.client.post(
            '/api/types/', {'label': 'Custom Type', 'colorId': 'color1'}, format='json',
        )
        self.assertEqual(resp.status_code, 201, resp.content)
        self.assertEqual(resp.json()['id'], 'customtype')
        self.assertTrue(Type.objects.filter(owner=self.alice, slug='customtype').exists())

    def test_delete_removes_type(self):
        self.client.force_login(self.alice)
        resp = self.client.delete('/api/types/foundation/')
        self.assertEqual(resp.status_code, 204)
        self.assertFalse(Type.objects.filter(slug='foundation', owner=self.alice).exists())


class ColorApiTests(APITestCase):
    def setUp(self):
        self.alice = User.objects.create_user(username='alice', password='pw-test-1!')
        self.alice_color = Color.objects.create(
            owner=self.alice, slug='colasqr', label='COL-ASQR', hex='#8b5cf6',
        )

    def test_anonymous_list_is_unauthorized(self):
        self.assertEqual(self.client.get('/api/colors/').status_code, 401)

    def test_owner_lists_their_colors(self):
        self.client.force_login(self.alice)
        body = self.client.get('/api/colors/').json()
        self.assertEqual(body, [{'id': 'colasqr', 'label': 'COL-ASQR', 'hex': '#8b5cf6'}])

    def test_create_color(self):
        self.client.force_login(self.alice)
        resp = self.client.post(
            '/api/colors/', {'label': 'Custom Blue', 'hex': '#123456'}, format='json',
        )
        self.assertEqual(resp.status_code, 201, resp.content)
        self.assertEqual(resp.json()['id'], 'customblue')


class CatalogApiTests(APITestCase):
    def setUp(self):
        self.alice = User.objects.create_user(username='alice', password='pw-test-1!')
        self.bob = User.objects.create_user(username='bob', password='pw-test-2!')
        CatalogEntry.objects.create(
            owner=self.alice, kind='hierarchy', data=[{'level': 'top', 'cards': []}],
        )
        CatalogEntry.objects.create(
            owner=self.alice, kind='descriptions', data={'home': 'Alice home desc'},
        )

    def test_anonymous_get_is_unauthorized(self):
        self.assertEqual(self.client.get('/api/catalog/').status_code, 401)

    def test_owner_gets_their_catalog(self):
        self.client.force_login(self.alice)
        body = self.client.get('/api/catalog/').json()
        self.assertEqual(set(body), {'hierarchy', 'descriptions'})
        self.assertEqual(body['hierarchy'], [{'level': 'top', 'cards': []}])
        self.assertEqual(body['descriptions'], {'home': 'Alice home desc'})

    def test_other_user_does_not_see_alice_data(self):
        self.client.force_login(self.bob)
        body = self.client.get('/api/catalog/').json()
        self.assertEqual(body, {})

    def test_patch_upserts_new_kind(self):
        self.client.force_login(self.alice)
        resp = self.client.patch(
            '/api/catalog/', {'specialChars': ['§', '→']}, format='json',
        )
        self.assertEqual(resp.status_code, 200, resp.content)
        body = resp.json()
        self.assertEqual(body['specialChars'], ['§', '→'])
        # existing kinds preserved
        self.assertEqual(body['hierarchy'], [{'level': 'top', 'cards': []}])

    def test_patch_updates_existing_kind(self):
        self.client.force_login(self.alice)
        resp = self.client.patch(
            '/api/catalog/', {'hierarchy': [{'level': 'replaced'}]}, format='json',
        )
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(resp.json()['hierarchy'], [{'level': 'replaced'}])

    def test_patch_rejects_unknown_kind(self):
        self.client.force_login(self.alice)
        resp = self.client.patch(
            '/api/catalog/', {'malicious': 'value'}, format='json',
        )
        self.assertEqual(resp.status_code, 400)
        self.assertIn('malicious', resp.json()['detail'])

    def test_patch_rejects_non_dict_body(self):
        self.client.force_login(self.alice)
        resp = self.client.patch('/api/catalog/', ['not', 'a', 'dict'], format='json')
        self.assertEqual(resp.status_code, 400)

    def test_patch_does_not_leak_to_other_user(self):
        self.client.force_login(self.bob)
        self.client.patch('/api/catalog/', {'hierarchy': ['bob-only']}, format='json')
        self.assertEqual(
            CatalogEntry.objects.get(owner=self.alice, kind='hierarchy').data,
            [{'level': 'top', 'cards': []}],
        )


class SeederTests(APITestCase):
    def test_seed_user_is_idempotent_across_categories(self):
        from .seeders import seed_user
        user = User.objects.create_user(username='seed', password='pw-test-3!')
        first = seed_user(user)
        second = seed_user(user)
        for key in ('colors', 'types', 'documents', 'catalog'):
            self.assertIn(key, first)
            self.assertEqual(second[key], 0, f'{key} reseed should add zero')
        if first['documents']:
            self.assertGreater(Document.objects.filter(owner=user).count(), 0)
            self.assertGreater(Type.objects.filter(owner=user).count(), 0)
            self.assertGreater(Color.objects.filter(owner=user).count(), 0)
        if first['catalog']:
            self.assertGreater(CatalogEntry.objects.filter(owner=user).count(), 0)
