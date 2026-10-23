from datetime import timedelta

from django.core.exceptions import ValidationError as DjangoValidationError
from django.db.models import F
from django.utils import timezone
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import OpenApiParameter, extend_schema, extend_schema_view, inline_serializer
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response

from apps.core.permissions import IsDepartmentMember, IsOfficerOrReadOnly
from apps.core.tenancy import TenantViewSet, scope_queryset

from .models import Item, StockLevel, StockTransaction, StorageLocation
from .serializers import (
    ItemSerializer,
    StockAdjustmentSerializer,
    StockLevelSerializer,
    StockTransactionSerializer,
    StorageLocationSerializer,
)


class ItemViewSet(TenantViewSet):
    queryset = Item.objects.all()
    serializer_class = ItemSerializer
    permission_classes = [IsOfficerOrReadOnly]
    filterset_fields = ["category", "is_active", "barcode"]
    search_fields = ["name", "sku", "barcode"]


class StorageLocationViewSet(TenantViewSet):
    queryset = StorageLocation.objects.select_related("station", "apparatus")
    serializer_class = StorageLocationSerializer
    permission_classes = [IsOfficerOrReadOnly]
    filterset_fields = ["station", "apparatus"]


@extend_schema_view(
    list=extend_schema(
        parameters=[OpenApiParameter("below_par", OpenApiTypes.BOOL, description="Only stock below its par level")]
    )
)
class StockLevelViewSet(TenantViewSet):
    queryset = StockLevel.objects.select_related("item", "location__station", "location__apparatus")
    serializer_class = StockLevelSerializer
    permission_classes = [IsOfficerOrReadOnly]
    filterset_fields = ["item", "location", "location__station", "location__apparatus", "item__category"]
    search_fields = ["item__name", "item__barcode", "item__sku"]

    def get_queryset(self):
        qs = super().get_queryset()
        if self.request.query_params.get("below_par") in ("1", "true"):
            qs = qs.filter(quantity__lt=F("par_level"))
        return qs

    def perform_create(self, serializer):
        quantity = serializer.validated_data.pop("quantity", 0)
        stock = serializer.save(department=self.request.user.department, quantity=0)
        if quantity:
            stock.adjust(quantity, StockTransaction.Reason.COUNT, self.request.user, "Initial count")

    @extend_schema(
        parameters=[OpenApiParameter("days", OpenApiTypes.INT, description="Window in days (default 30)")],
        responses=StockLevelSerializer(many=True),
    )
    @action(detail=False, methods=["get"], pagination_class=None)
    def expiring(self, request):
        """Stock expiring within ``?days=`` (default 30), including already expired."""
        days = int(request.query_params.get("days", 30))
        cutoff = timezone.localdate() + timedelta(days=days)
        qs = self.filter_queryset(self.get_queryset()).filter(expires_on__lte=cutoff, quantity__gt=0)
        return Response(self.get_serializer(qs.order_by("expires_on"), many=True).data)

    @extend_schema(
        request=StockAdjustmentSerializer,
        responses={
            201: inline_serializer(
                "StockAdjustmentResult",
                {"stock": StockLevelSerializer(), "transaction": StockTransactionSerializer()},
            )
        },
    )
    @action(
        detail=True,
        methods=["post"],
        permission_classes=[IsDepartmentMember],
        serializer_class=StockAdjustmentSerializer,
    )
    def adjust(self, request, pk=None):
        """Record usage, restocking, disposal or a count correction. Any member can do this."""
        stock = self.get_object()
        serializer = StockAdjustmentSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            txn = stock.adjust(user=request.user, **serializer.validated_data)
        except DjangoValidationError as exc:
            raise ValidationError({"change": exc.messages}) from exc
        return Response(
            {
                "stock": StockLevelSerializer(stock, context={"request": request}).data,
                "transaction": StockTransactionSerializer(txn).data,
            },
            status=status.HTTP_201_CREATED,
        )


class StockTransactionViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    """Read-only audit trail of stock movements."""

    queryset = StockTransaction.objects.select_related("stock__item", "stock__location")
    serializer_class = StockTransactionSerializer
    permission_classes = [IsDepartmentMember]
    filterset_fields = ["stock", "stock__item", "stock__location", "reason", "performed_by"]

    def get_queryset(self):
        return scope_queryset(super().get_queryset(), self.request.user.department)
