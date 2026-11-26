from pydantic import BaseModel, Field


class CatalogCandidate(BaseModel):
    sku_code: str
    name: str
    category: str
    price: float
    popularity: float = 0.85


class RecommendationRequest(BaseModel):
    user_id: str | None = None
    viewed_categories: list[str] = Field(default_factory=list)
    purchased_skus: list[str] = Field(default_factory=list)
    catalog: list[CatalogCandidate] | None = None
    limit: int = Field(default=4, ge=1, le=20)


class RecommendedItem(BaseModel):
    sku_code: str
    name: str
    category: str
    price: float
    score: float
    reason: str


class RecommendationResponse(BaseModel):
    strategy: str
    items: list[RecommendedItem]


SYNTHETIC_CATALOG = [
    {
        "sku_code": "KIRAN-MOUSE-001",
        "name": "Wireless Mouse Pro",
        "category": "Electronics",
        "price": 1499.0,
        "popularity": 0.95,
    },
    {
        "sku_code": "MEERA-MUG-001",
        "name": "Ceramic Mug Set",
        "category": "Home",
        "price": 799.0,
        "popularity": 0.88,
    },
    {
        "sku_code": "KIRAN-KB-002",
        "name": "Mechanical Keyboard",
        "category": "Electronics",
        "price": 3499.0,
        "popularity": 0.82,
    },
    {
        "sku_code": "MEERA-LAMP-002",
        "name": "Warm Desk Lamp",
        "category": "Home",
        "price": 1299.0,
        "popularity": 0.79,
    },
]


def recommend_products(req: RecommendationRequest) -> RecommendationResponse:
    viewed = {c.strip().lower() for c in req.viewed_categories if c.strip()}
    purchased = {s.strip().upper() for s in req.purchased_skus if s.strip()}

    has_history = bool(viewed or purchased)
    strategy = "personalized" if has_history else "cold_start_popularity"

    source_catalog = (
        [c.model_dump() for c in req.catalog]
        if req.catalog
        else SYNTHETIC_CATALOG
    )

    scored: list[RecommendedItem] = []
    for item in source_catalog:
        if item["sku_code"] in purchased:
            continue
        score = float(item["popularity"])
        reason = "Popular marketplace item (cold-start fallback)"
        if has_history and item["category"].lower() in viewed:
            score += 0.5
            reason = f"Matches your interest in {item['category']}"
        scored.append(
            RecommendedItem(
                sku_code=str(item["sku_code"]),
                name=str(item["name"]),
                category=str(item["category"]),
                price=float(item["price"]),
                score=round(score, 3),
                reason=reason,
            )
        )

    scored.sort(key=lambda x: x.score, reverse=True)
    return RecommendationResponse(strategy=strategy, items=scored[: req.limit])
