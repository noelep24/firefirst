from rest_framework import serializers

from apps.core.tenancy import TenantSerializer

from .models import Item, StockLevel, StockTransaction, StorageLocation


class ItemSerializer(TenantSerializer):
    class Meta:
        model = Item
        fields = ["id", "name", "category", "unit", "sku", "barcode", "description", "tracks_expiration", "is_active"]


class StorageLocationSerializer(TenantSerializer):
    label = serializers.CharField(source="__str__", read_only=True)

    class Meta:
        model = StorageLocation
        fields = ["id", "name", "station", "apparatus", "label"]

    def validate(self, attrs):
        station = attrs.get("station", getattr(self.instance, "station", None))
        apparatus = attrs.get("apparatus", getattr(self.instance, "apparatus", None))
        if bool(station) == bool(apparatus):
            raise serializers.ValidationError("A location belongs to exactly one station or apparatus.")
        return attrs


class StockLevelSerializer(TenantSerializer):
    item_name = serializers.CharField(source="item.name", read_only=True)
    unit = serializers.CharField(source="item.unit", read_only=True)
    location_label = serializers.CharField(source="location.__str__", read_only=True)
    below_par = serializers.BooleanField(read_only=True)

    class Meta:
        model = StockLevel
        fields = [
            "id",
            "item",
            "item_name",
            "unit",
            "location",
            "location_label",
            "quantity",
            "par_level",
            "below_par",
            "expires_on",
        ]
        # Quantity is set once on creation, then only changes through /adjust/
        # so every movement lands in the transaction log.
        extra_kwargs = {"quantity": {"required": False}}

    def update(self, instance, validated_data):
        validated_data.pop("quantity", None)
        return super().update(instance, validated_data)


class StockAdjustmentSerializer(serializers.Serializer):
    change = serializers.IntegerField()
    reason = serializers.ChoiceField(choices=StockTransaction.Reason.choices)
    note = serializers.CharField(max_length=255, required=False, allow_blank=True)

    def validate_change(self, value):
        if value == 0:
            raise serializers.ValidationError("Change can't be zero.")
        return value


class StockTransactionSerializer(serializers.ModelSerializer):
    item_name = serializers.CharField(source="stock.item.name", read_only=True)
    location_label = serializers.CharField(source="stock.location.__str__", read_only=True)

    class Meta:
        model = StockTransaction
        fields = [
            "id",
            "stock",
            "item_name",
            "location_label",
            "change",
            "reason",
            "note",
            "performed_by",
            "created_at",
        ]
