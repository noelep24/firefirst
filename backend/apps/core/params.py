import datetime

from rest_framework.exceptions import ValidationError


def parse_date(value, name):
    """Parse a YYYY-MM-DD query parameter, or raise a 400 naming the parameter."""
    try:
        return datetime.date.fromisoformat(value)
    except (TypeError, ValueError):
        raise ValidationError({name: "Use YYYY-MM-DD."}) from None
