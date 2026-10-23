"""Record every change to department data in the audit log.

A middleware remembers the current request in a context variable; model
signals read the acting user from it. DRF sets the authenticated user (JWT or
session) on the underlying Django request, so this works for API calls, the
admin, and changes models make as a side effect of a request (for example a
work order putting a rig out of service).
"""

import contextvars
import json

from django.core.serializers.json import DjangoJSONEncoder
from django.db.models.signals import post_delete, post_save, pre_delete, pre_save

from apps.core.models import Department, TenantModel, User

from .models import AuditEntry

_request = contextvars.ContextVar("audit_request", default=None)
# Departments being deleted right now: their rows cascade away and must not log against them.
_departments_being_deleted: set[int] = set()

# Never copy these into the log.
IGNORED_FIELDS = {"created_at", "updated_at", "password", "last_login"}
# Already an immutable log of their own.
SKIPPED_MODELS = {"inventory.StockTransaction", "audit.AuditEntry"}


class AuditMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        token = _request.set(request)
        try:
            return self.get_response(request)
        finally:
            _request.reset(token)


def current_actor():
    request = _request.get()
    user = getattr(request, "user", None)
    return user if user is not None and user.is_authenticated else None


def _label(model):
    return f"{model._meta.app_label}.{model.__name__}"


def _is_audited(model):
    if _label(model) in SKIPPED_MODELS:
        return False
    return issubclass(model, (TenantModel, User))


def _department_id(instance):
    return getattr(instance, "department_id", None)


def _snapshot(instance):
    """Field values as Python objects, normalized so an in-memory 0 equals a loaded Decimal("0.0")."""
    return {
        field.name: field.to_python(field.value_from_object(instance))
        for field in instance._meta.concrete_fields
        if field.name not in IGNORED_FIELDS
    }


def _json(data):
    # Round-trip through JSON so dates, decimals and UUIDs are stored as strings.
    return json.loads(json.dumps(data, cls=DjangoJSONEncoder))


def _record(instance, action, changes):
    department_id = _department_id(instance)
    if department_id is None or department_id in _departments_being_deleted:
        return  # Department-less rows (platform staff) aren't tenant data.
    AuditEntry.objects.create(
        department_id=department_id,
        actor=current_actor(),
        action=action,
        model=_label(type(instance)),
        object_id=str(instance.pk),
        object_repr=str(instance)[:200],
        changes=_json(changes),
    )


def _before_save(sender, instance, raw=False, **kwargs):
    if raw or not _is_audited(sender) or instance.pk is None:
        return
    previous = sender._base_manager.filter(pk=instance.pk).first()
    instance._audit_before = _snapshot(previous) if previous is not None else None


def _after_save(sender, instance, created, raw=False, **kwargs):
    if raw or not _is_audited(sender):
        return
    after = _snapshot(instance)
    before = getattr(instance, "_audit_before", None)
    instance._audit_before = None
    if created or before is None:
        _record(instance, AuditEntry.Action.CREATE, after)
        return
    diff = {name: [before.get(name), value] for name, value in after.items() if before.get(name) != value}
    if diff:
        _record(instance, AuditEntry.Action.UPDATE, diff)


def _after_delete(sender, instance, **kwargs):
    if not _is_audited(sender):
        return
    _record(instance, AuditEntry.Action.DELETE, _snapshot(instance))


def _department_deleting(sender, instance, **kwargs):
    # Django sends every pre_delete in a cascade before any row is deleted.
    _departments_being_deleted.add(instance.pk)


def _department_deleted(sender, instance, **kwargs):
    # The department row goes last, after everything that depends on it, so the cascade is over.
    # Forget the id: some databases (SQLite) reuse ids, and a new department must be logged.
    _departments_being_deleted.discard(instance.pk)


def connect():
    pre_delete.connect(_department_deleting, sender=Department, dispatch_uid="audit_department_deleting")
    post_delete.connect(_department_deleted, sender=Department, dispatch_uid="audit_department_deleted")
    pre_save.connect(_before_save, dispatch_uid="audit_pre_save")
    post_save.connect(_after_save, dispatch_uid="audit_post_save")
    post_delete.connect(_after_delete, dispatch_uid="audit_post_delete")
