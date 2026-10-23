"""Import a spreadsheet for a department from the command line (onboarding).

python manage.py import_data riverside apparatus fleet.xlsx            # preview
python manage.py import_data riverside apparatus fleet.xlsx --commit
"""

from pathlib import Path

from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.management.base import BaseCommand, CommandError

from apps.core.models import Department

from ...engine import ImportFileError
from ...importers import IMPORTERS


class Command(BaseCommand):
    help = "Preview or import people, apparatus or inventory from a CSV/XLSX file."

    def add_arguments(self, parser):
        parser.add_argument("department", help="Department slug")
        parser.add_argument("kind", choices=sorted(IMPORTERS))
        parser.add_argument("path")
        parser.add_argument("--commit", action="store_true", help="Save the rows (default is a dry run)")
        parser.add_argument("--skip-errors", action="store_true", help="Save valid rows even if some have errors")

    def handle(self, department, kind, path, commit, skip_errors, **options):
        try:
            dept = Department.objects.get(slug=department)
        except Department.DoesNotExist:
            raise CommandError(f"No department '{department}'.") from None
        file = Path(path)
        if not file.exists():
            raise CommandError(f"No file at {path}.")
        upload = SimpleUploadedFile(file.name, file.read_bytes())
        try:
            report = IMPORTERS[kind](dept, actor=None).run(upload, commit=commit, skip_errors=skip_errors)
        except ImportFileError as exc:
            raise CommandError(str(exc)) from exc

        if report["missing"]:
            raise CommandError(f"Missing required columns: {', '.join(report['missing'])}")
        for row in report["rows"]:
            if row["errors"] or row["notes"]:
                detail = "; ".join(row["errors"] + row["notes"])
                self.stdout.write(f"  row {row['line']:>4} {row['action']:<6} {row['label']}: {detail}")
        s = report["summary"]
        self.stdout.write(f"{s['create']} new, {s['update']} updates, {s['error']} errors")
        if report["committed"]:
            self.stdout.write(self.style.SUCCESS("Saved."))
        elif commit:
            raise CommandError("Not saved: fix the errors or pass --skip-errors.")
        else:
            self.stdout.write("Dry run. Pass --commit to save.")
