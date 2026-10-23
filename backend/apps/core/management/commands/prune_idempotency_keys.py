from datetime import timedelta

from django.core.management.base import BaseCommand
from django.utils import timezone

from apps.core.models import IdempotencyKey


class Command(BaseCommand):
    help = "Delete stored idempotent responses older than --days (default 14). Run daily."

    def add_arguments(self, parser):
        parser.add_argument("--days", type=int, default=14)

    def handle(self, days, **options):
        deleted, _ = IdempotencyKey.objects.filter(created_at__lt=timezone.now() - timedelta(days=days)).delete()
        self.stdout.write(f"Deleted {deleted} keys.")
