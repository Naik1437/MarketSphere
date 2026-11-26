from datetime import datetime, timezone
from fastapi import FastAPI
from pydantic import BaseModel

app = FastAPI(title="MarketSphere Python Engine", version="0.1.0")


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
