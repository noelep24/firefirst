from django.contrib import admin

from .models import Certification, CertificationType


@admin.register(CertificationType)
class CertificationTypeAdmin(admin.ModelAdmin):
    list_display = ["name", "code", "renewal_months", "required_for_all", "department"]
    list_filter = ["department"]


@admin.register(Certification)
class CertificationAdmin(admin.ModelAdmin):
    list_display = ["user", "certification_type", "issued_on", "expires_on", "department"]
    list_filter = ["department", "certification_type"]
