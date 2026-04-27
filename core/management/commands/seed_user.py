from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError

from ...seeders import seed_user


class Command(BaseCommand):
    help = "Seed an existing user's account with the contents of data.json (idempotent)."

    def add_arguments(self, parser):
        parser.add_argument('username')

    def handle(self, *args, **options):
        User = get_user_model()
        try:
            user = User.objects.get(username=options['username'])
        except User.DoesNotExist as e:
            raise CommandError(f"User not found: {options['username']!r}") from e
        counts = seed_user(user)
        self.stdout.write(self.style.SUCCESS(f'seeded {counts}'))
