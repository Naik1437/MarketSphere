import time
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)


def test_pricing_and_commission_calculation() -> None:
    res = client.post(
        "/api/v1/pricing/calculate",
        json={
            "items": [
                {
                    "sku_code": "KIRAN-MOUSE-001",
                    "unit_price": "1500.00",
                    "quantity": 2,
                    "commission_rate": "10.00",
                }
            ],
            "promotion": {
                "code": "SAVE10",
                "discount_type": "PERCENTAGE",
                "discount_value": "10.00",
                "min_order_total": "1000.00",
            },
        },
    )
    assert res.status_code == 200
    body = res.json()
    assert body["subtotal"] == "3000.00"
    assert body["discount_amount"] == "300.00"
    assert body["total_amount"] == "2700.00"
    assert body["total_commission"] == "300.00"
    assert body["lines"][0]["net_seller_amount"] == "2700.00"


def test_catalog_bulk_normalization_and_benchmark() -> None:
    rows = [
        {
            "sku_code": f" sku-{i} ",
            "name": f"  Wireless   Item {i} ",
            "category": " electronics ",
            "price": "199.995",
            "currency": " inr ",
        }
        for i in range(1000)
    ]
    t0 = time.perf_counter()
    res = client.post("/api/v1/catalog/normalize", json={"rows": rows})
    elapsed_ms = (time.perf_counter() - t0) * 1000
    assert res.status_code == 200
    body = res.json()
    assert body["count"] == 1000
    assert body["normalized"][0]["sku_code"] == "SKU-0"
    assert body["normalized"][0]["slug"] == "wireless-item-0"
    assert body["normalized"][0]["price"] == "200.00"
    assert elapsed_ms < 2000
    print(f"[benchmark] 1000-row catalog normalize: {elapsed_ms:.2f}ms")


def test_recommendations_cold_start_and_personalized() -> None:
    cold = client.post("/api/v1/recommendations", json={"limit": 3})
    assert cold.status_code == 200
    assert cold.json()["strategy"] == "cold_start_popularity"
    assert len(cold.json()["items"]) == 3

    pers = client.post(
        "/api/v1/recommendations",
        json={
            "viewed_categories": ["Home"],
            "purchased_skus": ["KIRAN-MOUSE-001"],
            "limit": 3,
        },
    )
    assert pers.status_code == 200
    body = pers.json()
    assert body["strategy"] == "personalized"
    assert all(i["sku_code"] != "KIRAN-MOUSE-001" for i in body["items"])
    assert body["items"][0]["category"] == "Home"
