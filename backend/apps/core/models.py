from django.contrib.auth.models import AbstractUser
from django.db import models


class Department(models.Model):
    """A fire department: the tenant boundary for all data."""

    name = models.CharField(max_length=200)
    slug = models.SlugField(unique=True)
    timezone = models.CharField(max_length=64, default="America/Chicago")
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name


class TenantModel(models.Model):
    """Base for every record that belongs to a department."""

    department = models.ForeignKey(Department, on_delete=models.CASCADE, related_name="+")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True


class Station(TenantModel):
    number = models.CharField(max_length=20)
    name = models.CharField(max_length=200, blank=True)
    address = models.CharField(max_length=300, blank=True)
    phone = models.CharField(max_length=40, blank=True)

    class Meta:
        ordering = ["number"]
        constraints = [
            models.UniqueConstraint(fields=["department", "number"], name="unique_station_number"),
        ]

    def __str__(self):
        return f"Station {self.number}" + (f" – {self.name}" if self.name else "")


class User(AbstractUser):
    class Role(models.TextChoices):
        ADMIN = "admin", "Department admin"
        OFFICER = "officer", "Officer"
        MEMBER = "member", "Member"

    # Null only for platform staff (superusers) who don't belong to a department.
    department = models.ForeignKey(Department, null=True, blank=True, on_delete=models.CASCADE, related_name="users")
    role = models.CharField(max_length=20, choices=Role.choices, default=Role.MEMBER)
    employee_id = models.CharField(max_length=40, blank=True)
    rank = models.CharField(max_length=60, blank=True)
    phone = models.CharField(max_length=40, blank=True)
    home_station = models.ForeignKey(Station, null=True, blank=True, on_delete=models.SET_NULL, related_name="members")

    @property
    def is_officer(self):
        return self.role in (self.Role.ADMIN, self.Role.OFFICER)

    @property
    def is_department_admin(self):
        return self.role == self.Role.ADMIN

    def __str__(self):
        full = self.get_full_name()
        return f"{self.rank} {full}".strip() if full else self.username


class IdempotencyKey(models.Model):
    """Remembers the response to a POST sent with an ``Idempotency-Key`` header, so retries don't repeat it."""

    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="+")
    key = models.CharField(max_length=100)
    path = models.CharField(max_length=300)
    # Null while the first request is still being processed.
    status_code = models.PositiveSmallIntegerField(null=True)
    body = models.JSONField(null=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["user", "key"], name="unique_idempotency_key")]
