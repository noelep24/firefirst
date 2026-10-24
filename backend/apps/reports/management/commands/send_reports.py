from django.core.management.base import BaseCommand

from apps.reports.scheduled import send_due


class Command(BaseCommand):
    help = "Email the scheduled reports that are due (morning briefing, weekly summary). Run every 15 minutes."

    def handle(self, *args, **options):
        send_due()
