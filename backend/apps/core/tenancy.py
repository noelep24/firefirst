"""Department (tenant) scoping for the API.

Every department-owned resource goes through :class:`TenantViewSet` and
:class:`TenantSerializer`. Together they guarantee that:

* list/detail queries only ever return the requesting user's department rows;
* new rows are stamped with the requesting user's department; and
* foreign keys in request bodies can only point at rows in that same
  department, so one department can't attach data to another's records.
"""

from rest_framework import serializers, viewsets

from .models import User


def department_field_for(model):
    """Return the lookup that scopes ``model`` to a department, or None."""
    if model is User:
        return "department"
    field_names = {f.name for f in model._meta.get_fields()}
    return "department" if "department" in field_names else None


def scope_queryset(queryset, department):
    lookup = department_field_for(queryset.model)
    if lookup is None:
        return queryset
    return queryset.filter(**{lookup: department})


class TenantScopedFieldsMixin:
    """Restricts every related-field choice to the requesting user's department."""

    def get_fields(self):
        fields = super().get_fields()
        request = self.context.get("request")
        department = getattr(getattr(request, "user", None), "department", None)
        for field in fields.values():
            target = getattr(field, "child_relation", field)
            queryset = getattr(target, "queryset", None)
            if queryset is None:
                continue
            if department is None:
                # Fail closed: no department, no choices.
                target.queryset = queryset.none()
            else:
                target.queryset = scope_queryset(queryset, department)
        return fields


class TenantSerializer(TenantScopedFieldsMixin, serializers.ModelSerializer):
    pass


class TenantViewSet(viewsets.ModelViewSet):
    """ModelViewSet scoped to ``request.user.department``."""

    def get_queryset(self):
        return scope_queryset(super().get_queryset(), self.request.user.department)

    def perform_create(self, serializer):
        serializer.save(department=self.request.user.department)
