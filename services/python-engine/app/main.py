from datetime import datetime, timezone
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from app.pricing import (
    BulkNormalizeRequest,
    BulkNormalizeResponse,
    PricingRequest,
    PricingResponse,
    calculate_pricing,
    normalize_catalog,
)
from app.recommendations import (
    RecommendationRequest,
    RecommendationResponse,
    recommend_products,
)

app = FastAPI(title="MarketSphere Python Engine", version="0.2.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class HealthResponse(BaseModel):
    status: str
    service: str
    timestamp: str


@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    return HealthResponse(
        status="ok",
        service="marketsphere-python-engine",
        timestamp=datetime.now(timezone.utc).isoformat(),
    )


@app.post("/api/v1/pricing/calculate", response_model=PricingResponse)
def pricing_calculate(req: PricingRequest) -> PricingResponse:
    return calculate_pricing(req)


@app.post("/api/v1/catalog/normalize", response_model=BulkNormalizeResponse)
def catalog_normalize(req: BulkNormalizeRequest) -> BulkNormalizeResponse:
    return normalize_catalog(req)


@app.post("/api/v1/recommendations", response_model=RecommendationResponse)
def recommendations_post(req: RecommendationRequest) -> RecommendationResponse:
    return recommend_products(req)


@app.get("/api/v1/recommendations", response_model=RecommendationResponse)
def recommendations_get(limit: int = 4) -> RecommendationResponse:
    return recommend_products(RecommendationRequest(limit=limit))
