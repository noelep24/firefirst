from django.core.management.base import BaseCommand

from apps.scheduling.offers import process_due


class Command(BaseCommand):
    help = "Close volunteering on overtime vacancies whose answer time has passed. Run every few minutes."

    def handle(self, *args, **options):
        process_due()
