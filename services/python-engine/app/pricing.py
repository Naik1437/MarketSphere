from decimal import Decimal, ROUND_HALF_UP
import re
from typing import Literal, Optional
from pydantic import BaseModel, Field


class PricingLineItem(BaseModel):
    sku_code: str = Field(min_length=1)
    unit_price: Decimal = Field(gt=0)
    quantity: int = Field(gt=0, le=1000)
    commission_rate: Decimal = Field(ge=0, le=50, default=Decimal("10.00"))


class PromotionRule(BaseModel):
    code: str
    discount_type: Literal["PERCENTAGE", "FIXED_AMOUNT"]
    discount_value: Decimal = Field(gt=0)
    min_order_total: Decimal = Field(ge=0, default=Decimal("0.00"))


class PricingRequest(BaseModel):
    items: list[PricingLineItem] = Field(min_length=1)
    promotion: Optional[PromotionRule] = None


class PricingLineResult(BaseModel):
    sku_code: str
    line_total: Decimal
    commission_amount: Decimal
    net_seller_amount: Decimal


class PricingResponse(BaseModel):
    subtotal: Decimal
    discount_amount: Decimal
    total_amount: Decimal
    total_commission: Decimal
    lines: list[PricingLineResult]


def _q2(val: Decimal) -> Decimal:
    return val.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def calculate_pricing(req: PricingRequest) -> PricingResponse:
    subtotal = Decimal("0.00")
    total_commission = Decimal("0.00")
    lines: list[PricingLineResult] = []

    for item in req.items:
        line_total = _q2(item.unit_price * item.quantity)
        commission = _q2((line_total * item.commission_rate) / Decimal("100"))
        net_seller = _q2(line_total - commission)
        subtotal += line_total
        total_commission += commission
        lines.append(
            PricingLineResult(
                sku_code=item.sku_code,
                line_total=line_total,
                commission_amount=commission,
                net_seller_amount=net_seller,
            )
        )

    discount = Decimal("0.00")
    if req.promotion and subtotal >= req.promotion.min_order_total:
        if req.promotion.discount_type == "PERCENTAGE":
            discount = _q2((subtotal * req.promotion.discount_value) / Decimal("100"))
        else:
            discount = _q2(req.promotion.discount_value)
        discount = min(subtotal, max(Decimal("0.00"), discount))

    total_amount = _q2(max(Decimal("0.00"), subtotal - discount))
    return PricingResponse(
        subtotal=_q2(subtotal),
        discount_amount=discount,
        total_amount=total_amount,
        total_commission=_q2(total_commission),
        lines=lines,
    )


class RawCatalogRow(BaseModel):
    sku_code: str
    name: str
    category: str
    price: Decimal = Field(gt=0)
    currency: str = "INR"


class NormalizedCatalogRow(BaseModel):
    sku_code: str
    name: str
    slug: str
    category: str
    price: Decimal
    currency: str


class BulkNormalizeRequest(BaseModel):
    rows: list[RawCatalogRow] = Field(min_length=1, max_length=5000)


class BulkNormalizeResponse(BaseModel):
    normalized: list[NormalizedCatalogRow]
    count: int


def normalize_catalog(req: BulkNormalizeRequest) -> BulkNormalizeResponse:
    out: list[NormalizedCatalogRow] = []
    for row in req.rows:
        clean_name = " ".join(row.name.strip().split())
        slug = re.sub(r"[^a-z0-9]+", "-", clean_name.lower()).strip("-")
        out.append(
            NormalizedCatalogRow(
                sku_code=row.sku_code.strip().upper(),
                name=clean_name,
                slug=slug or "item",
                category=row.category.strip().title(),
                price=_q2(row.price),
                currency=row.currency.strip().upper(),
            )
        )
    return BulkNormalizeResponse(normalized=out, count=len(out))
