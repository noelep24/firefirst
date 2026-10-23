from django.contrib import admin

from .models import Item, StockLevel, StockTransaction, StorageLocation


@admin.register(Item)
class ItemAdmin(admin.ModelAdmin):
    list_display = ["name", "category", "unit", "sku", "is_active", "department"]
    list_filter = ["department", "category", "is_active"]
    search_fields = ["name", "sku", "barcode"]


@admin.register(StorageLocation)
class StorageLocationAdmin(admin.ModelAdmin):
    list_display = ["__str__", "station", "apparatus", "department"]
    list_filter = ["department"]


@admin.register(StockLevel)
class StockLevelAdmin(admin.ModelAdmin):
    list_display = ["item", "location", "quantity", "par_level", "expires_on"]
    list_filter = ["department", "item__category"]
    # Quantity changes go through StockLevel.adjust so they're logged.
    readonly_fields = ["quantity"]


@admin.register(StockTransaction)
class StockTransactionAdmin(admin.ModelAdmin):
    list_display = ["stock", "change", "reason", "performed_by", "created_at"]
    list_filter = ["department", "reason"]

    def has_change_permission(self, request, obj=None):
        return False
