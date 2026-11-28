# MarketSphere Incident Simulation Runbook (A15)

| Incident | Root Cause | Fix & Prevention | Verification |
| --- | --- | --- | --- |
| **1. Overselling (Last Item)** | Concurrent checkouts reading stale `available` count without row locking. | `SELECT ... FOR UPDATE` on `Inventory` inside PostgreSQL transaction (`inventory.service.ts`). | `commerce.test.ts` concurrent checkout: 1 succeeds (`201`), 1 fails (`409`), `available=0`. |
| **2. Stale Stock (Abandoned Checkout)** | Reserved stock not released after checkout timeout. | BullMQ `reservation-expiry` job + idempotent `expireReservationById` (`expire:<id>`). | `commerce.test.ts` expiry test: stock restored, duplicate expiry skipped. |
| **3. Payment / Order Mismatch** | Duplicate payment webhook events or retries. | HMAC-SHA256 verification + Redis `SET NX` event deduplication + `Order.idempotencyKey`. | `webhooks.test.ts`: second signed event returns `deduplicated: true`. |
| **4. Slow Search** | Unindexed catalog queries. | Composite index `@@index([category, status])` on `Product` + pagination (`limit <= 50`). | `GET /api/v1/products` paginated response. |
| **5. Failed Shipping Callback** | Invalid signature or transient carrier failure. | `verifySignature` rejects forged payloads (`401`); `ShipmentStatus.FAILED` recorded safely. | `webhooks.test.ts` invalid signature test (`401`). |
| **6. Duplicate Refunds** | Support agent or retry submitting same refund twice. | `Refund.idempotencyKey` unique constraint + captured-amount guard. | `commerce.test.ts`: duplicate refund returns `200 deduplicated: true`. |

## Evidence boundary

The verification column identifies automated regression coverage committed in the repository. It is not a claim that a production incident was replayed. Runtime replay of all six scenarios, including logs, database snapshots, recovery commands, and post-recovery checks, was not possible on 2026-11-27 because Docker and the PostgreSQL/Redis runtime were unavailable. See `docs/evidence/a15-simulation-status.md`.
