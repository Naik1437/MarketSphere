# MarketSphere Architecture & Diagrams

## System Architecture
```mermaid
flowchart LR
  User["Browser / Client"] -->|"HTTPS :443"| Nginx["Nginx Reverse Proxy"]
  Nginx -->|"frontend_net"| Web["Next.js Web :3000"]
  Nginx -->|"backend_net"| API["Express API :4000"]
  Nginx -->|"backend_net"| Py["FastAPI Engine :8000"]
  API -->|"data_net (internal)"| PG["PostgreSQL 16"]
  API -->|"data_net (internal)"| Redis["Redis 7"]
  Worker["BullMQ Worker"] -->|"data_net (internal)"| PG
  Worker -->|"data_net (internal)"| Redis
```

## Entity-Relationship Overview
```mermaid
erDiagram
  User ||--o| Seller : owns
  User ||--o{ Order : places
  Seller ||--o{ Product : lists
  Product ||--o{ Sku : has
  Sku ||--o{ Inventory : stocked_in
  Warehouse ||--o{ Inventory : stores
  Inventory ||--o{ StockLedger : records
  Order ||--o{ OrderItem : contains
  Order ||--o{ Reservation : reserves
  Order ||--o{ Payment : paid_by
  Order ||--o{ Shipment : fulfilled_by
  Payment ||--o{ Refund : refunded_by
```

## Checkout Data Flow
```mermaid
sequenceDiagram
  participant C as Customer UI
  participant A as Express API
  participant DB as PostgreSQL
  participant Q as BullMQ/Redis
  C->>A: POST /api/v1/orders/checkout (idempotencyKey)
  A->>DB: BEGIN TX + SELECT Inventory FOR UPDATE
  DB-->>A: Stock locked & decremented
  A->>DB: Create Order, OrderItems, Reservation, Payment
  A->>Q: Enqueue expire-reservation (15m delay)
  A-->>C: 201 Created (Order CONFIRMED)
```

## Known Limitations
- Payment, shipping, email, and object storage adapters run in **Local Simulation** mode (₹0 strict budget; no paid external sandboxes).
- Live cloud VM deployment and GitHub remote branch protection require external hosting/GitHub repository configuration.
