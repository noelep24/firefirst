from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models, transaction
from django.db.models import F

from apps.apparatus.models import Apparatus
from apps.core.models import Station, TenantModel


class Item(TenantModel):
    """A catalog entry: something the department stocks."""

    class Category(models.TextChoices):
        # The sections of the Supplies area.
        UNIFORMS = "uniforms", "Station uniforms"
        FIRE_GEAR = "fire_gear", "Structure fire & tech rescue gear"
        MEDICAL = "medical", "Medical supplies"
        EQUIPMENT = "equipment", "Apparatus equipment"
        OTHER = "other", "Station & other supplies"

    name = models.CharField(max_length=200)
    category = models.CharField(max_length=20, choices=Category.choices, default=Category.OTHER)
    unit = models.CharField(max_length=30, default="each", help_text="each, box, case, bottle…")
    sku = models.CharField("SKU / part number", max_length=60, blank=True)
    barcode = models.CharField(max_length=80, blank=True, db_index=True)
    description = models.TextField(blank=True)
    tracks_expiration = models.BooleanField(default=False)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name


class StorageLocation(TenantModel):
    """Where stock lives: a supply room, an EMS cabinet, or a compartment on a rig."""

    name = models.CharField(max_length=120)
    station = models.ForeignKey(
        Station, null=True, blank=True, on_delete=models.CASCADE, related_name="storage_locations"
    )
    apparatus = models.ForeignKey(
        Apparatus, null=True, blank=True, on_delete=models.CASCADE, related_name="storage_locations"
    )

    class Meta:
        ordering = ["name"]

    def __str__(self):
        owner = self.apparatus or self.station
        return f"{owner} – {self.name}" if owner else self.name


class StockLevel(TenantModel):
    item = models.ForeignKey(Item, on_delete=models.CASCADE, related_name="stock_levels")
    location = models.ForeignKey(StorageLocation, on_delete=models.CASCADE, related_name="stock_levels")
    quantity = models.PositiveIntegerField(default=0)
    par_level = models.PositiveIntegerField(default=0, help_text="Restock when quantity falls below this")
    expires_on = models.DateField(null=True, blank=True, help_text="Earliest expiration date on hand")

    class Meta:
        ordering = ["item__name"]
        constraints = [
            models.UniqueConstraint(fields=["item", "location"], name="unique_item_per_location"),
        ]

    def __str__(self):
        return f"{self.item} @ {self.location}: {self.quantity}"

    @property
    def below_par(self):
        return self.quantity < self.par_level

    def adjust(self, change, reason, user, note=""):
        """Apply a stock movement and record it. Raises ValidationError if it would go negative."""
        with transaction.atomic():
            locked = StockLevel.objects.select_for_update().get(pk=self.pk)
            if locked.quantity + change < 0:
                raise ValidationError(f"Only {locked.quantity} {self.item.unit} on hand.")
            StockLevel.objects.filter(pk=self.pk).update(quantity=F("quantity") + change)
            txn = StockTransaction.objects.create(
                department_id=self.department_id,
                stock=self,
                change=change,
                reason=reason,
                note=note,
                performed_by=user,
            )
        self.refresh_from_db(fields=["quantity"])
        return txn


class StockTransaction(TenantModel):
    """An immutable log of every stock movement."""

    class Reason(models.TextChoices):
        RESTOCK = "restock", "Restock / received"
        USED = "used", "Used"
        EXPIRED = "expired", "Expired / disposed"
        DAMAGED = "damaged", "Damaged / lost"
        TRANSFER_IN = "transfer_in", "Transfer in"
        TRANSFER_OUT = "transfer_out", "Transfer out"
        COUNT = "count", "Count correction"

    stock = models.ForeignKey(StockLevel, on_delete=models.CASCADE, related_name="transactions")
    change = models.IntegerField()
    reason = models.CharField(max_length=20, choices=Reason.choices)
    note = models.CharField(max_length=255, blank=True)
    performed_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+")

    class Meta:
        ordering = ["-created_at", "-id"]

    def __str__(self):
        return f"{self.change:+d} {self.stock.item} ({self.get_reason_display()})"
