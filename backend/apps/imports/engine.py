"""Spreadsheet import engine: read CSV/XLSX, match headers, preview, commit.

Importers declare their columns (with the many names departments use for
them: "Unit #", "Unit Number", "Apparatus"...) and implement ``check`` (parse
and validate one row without writing) and ``apply`` (write it). ``run``
does a dry-run preview by default; with ``commit`` it applies every valid row
in one transaction.
"""

import csv
import datetime
import io
import re
from dataclasses import dataclass, field
from decimal import Decimal, InvalidOperation

from django.db import transaction

MAX_BYTES = 5 * 1024 * 1024
MAX_ROWS = 5000


class ImportFileError(Exception):
    """The file itself can't be read (wrong type, empty, too big…)."""


@dataclass
class Column:
    key: str
    label: str
    aliases: tuple[str, ...] = ()
    required: bool = False
    help: str = ""
    example: str = ""


@dataclass
class RowResult:
    line: int
    action: str = "create"  # create | update | skip | error
    label: str = ""
    errors: list[str] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)
    data: dict = field(default_factory=dict)

    def error(self, message):
        self.errors.append(message)
        self.action = "error"


def normalize(text):
    return re.sub(r"[^a-z0-9]+", " ", str(text).lower()).strip()


# ---------- Reading files ----------


def _cell_to_str(value):
    if value is None:
        return ""
    if isinstance(value, datetime.datetime):
        return value.date().isoformat() if value.time() == datetime.time() else value.isoformat()
    if isinstance(value, datetime.date):
        return value.isoformat()
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value).strip()


def read_table(upload):
    """Return (headers, rows) from an uploaded CSV or Excel file. Blank rows are dropped."""
    if upload.size > MAX_BYTES:
        raise ImportFileError("File is larger than 5 MB. Split it into smaller files.")
    name = (upload.name or "").lower()
    if name.endswith((".xlsx", ".xlsm")):
        rows = _read_xlsx(upload)
    elif name.endswith((".csv", ".txt", ".tsv")) or not name:
        rows = _read_csv(upload.read())
    elif name.endswith(".xls"):
        raise ImportFileError("Old .xls files aren't supported. In Excel, use Save As → .xlsx or .csv.")
    else:
        raise ImportFileError("Upload a .csv or .xlsx file.")
    rows = [r for r in rows if any(cell.strip() for cell in r)]
    if not rows:
        raise ImportFileError("The file is empty.")
    headers, body = rows[0], rows[1:]
    if len(body) > MAX_ROWS:
        raise ImportFileError(f"The file has {len(body)} rows; the limit is {MAX_ROWS}.")
    return [h.strip() for h in headers], body


def _read_csv(raw):
    for encoding in ("utf-8-sig", "cp1252"):
        try:
            text = raw.decode(encoding)
            break
        except UnicodeDecodeError:
            continue
    else:  # pragma: no cover - cp1252 decodes nearly anything
        raise ImportFileError("Can't read the file's text encoding. Save it as UTF-8 CSV.")
    try:
        dialect = csv.Sniffer().sniff(text[:4096], delimiters=",;\t")
    except csv.Error:
        dialect = csv.excel
    return [[cell.strip() for cell in row] for row in csv.reader(io.StringIO(text), dialect)]


def _read_xlsx(upload):
    from openpyxl import load_workbook

    try:
        workbook = load_workbook(upload, read_only=True, data_only=True)
    except Exception as exc:
        raise ImportFileError("Can't open the Excel file. Is it a valid .xlsx?") from exc
    sheet = workbook.worksheets[0]
    return [[_cell_to_str(v) for v in row] for row in sheet.iter_rows(values_only=True)]


# ---------- Parsing values ----------


def parse_int(value, name):
    cleaned = str(value).replace(",", "").strip()
    try:
        number = Decimal(cleaned)
    except InvalidOperation:
        raise ValueError(f"{name} must be a whole number (got “{value}”).") from None
    if number != number.to_integral_value() or number < 0:
        raise ValueError(f"{name} must be a whole number (got “{value}”).")
    return int(number)


def parse_decimal(value, name):
    try:
        number = Decimal(str(value).replace(",", "").strip())
    except InvalidOperation:
        raise ValueError(f"{name} must be a number (got “{value}”).") from None
    if number < 0:
        raise ValueError(f"{name} can't be negative.")
    return number


DATE_FORMATS = ("%Y-%m-%d", "%m/%d/%Y", "%m/%d/%y", "%m-%d-%Y", "%Y/%m/%d", "%d-%b-%Y", "%b %d, %Y")


def parse_date(value, name):
    text = str(value).strip()
    if "T" in text:
        text = text.split("T")[0]
    for fmt in DATE_FORMATS:
        try:
            return datetime.datetime.strptime(text, fmt).date()
        except ValueError:
            continue
    raise ValueError(f"{name}: can't read “{value}” as a date (use YYYY-MM-DD or MM/DD/YYYY).")


def match_choice(value, choices, keywords=(), name="Value"):
    """Map free text onto a choice: exact value or label first, then keyword rules in order."""
    text = normalize(value)
    for choice_value, choice_label in choices:
        if text in (normalize(choice_value), normalize(choice_label)):
            return choice_value
    words = set(text.split())
    for needles, result in keywords:
        for needle in needles:
            if (" " in needle and needle in text) or needle in words:
                return result
    allowed = ", ".join(label for _, label in choices)
    raise ValueError(f"{name}: don't know “{value}”. Use one of: {allowed}.")


# ---------- Running an import ----------


class Importer:
    kind = ""
    title = ""
    description = ""
    columns: list[Column] = []

    def __init__(self, department, actor):
        self.department = department
        self.actor = actor

    # Subclasses implement these.
    def prepare(self):
        """Load lookups (existing records) before checking rows."""

    def check(self, values: dict, result: RowResult):
        raise NotImplementedError

    def apply(self, result: RowResult):
        raise NotImplementedError

    # Shared machinery.
    def map_headers(self, headers):
        lookup = {}
        for column in self.columns:
            for alias in (column.key, column.label, *column.aliases):
                lookup.setdefault(normalize(alias), column.key)
        mapping, ignored, used = {}, [], set()
        for index, header in enumerate(headers):
            key = lookup.get(normalize(header))
            if key and key not in used:
                mapping[index] = key
                used.add(key)
            elif header:
                ignored.append(header)
        return mapping, ignored

    def run(self, upload, commit=False, skip_errors=False):
        headers, rows = read_table(upload)
        mapping, ignored = self.map_headers(headers)
        present = set(mapping.values())
        missing = [c.label for c in self.columns if c.required and c.key not in present]
        report = {
            "kind": self.kind,
            "recognized": {headers[i]: next(c.label for c in self.columns if c.key == k) for i, k in mapping.items()},
            "ignored": ignored,
            "missing": missing,
            "rows": [],
            "summary": {"create": 0, "update": 0, "skip": 0, "error": 0},
            "committed": False,
        }
        if missing:
            return report

        self.prepare()
        results = []
        for offset, row in enumerate(rows):
            values = {key: (row[i].strip() if i < len(row) else "") for i, key in mapping.items()}
            result = RowResult(line=offset + 2)  # 1-based, after the header row
            try:
                self.check(values, result)
            except ValueError as exc:
                result.error(str(exc))
            results.append(result)

        for r in results:
            report["summary"][r.action] += 1
        report["rows"] = [
            {"line": r.line, "action": r.action, "label": r.label, "errors": r.errors, "notes": r.notes}
            for r in results
        ]

        has_errors = report["summary"]["error"] > 0
        if commit and (not has_errors or skip_errors):
            with transaction.atomic():
                for r in results:
                    if r.action in ("create", "update"):
                        self.apply(r)
            report["committed"] = True
        return report

    def template_rows(self):
        return [[c.label for c in self.columns], [c.example for c in self.columns]]
