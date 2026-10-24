from django.core.management.base import BaseCommand

from apps.notifications.reminders import certification_reminders


class Command(BaseCommand):
    help = "Send the day's reminders (certifications expiring in 60, 30 and 7 days). Run once a day."

    def handle(self, *args, **options):
        certification_reminders()
