# MarketSphere Incident Simulation Runbook (A15)

| Incident | Root Cause | Fix & Prevention | Verification |
| --- | --- | --- | --- |
| **1. Overselling (Last Item)** | Concurrent checkouts reading stale `available` count without row locking. | `SELECT ... FOR UPDATE` on `Inventory` inside PostgreSQL transaction (`inventory.service.ts`). | `commerce.test.ts` concurrent checkout: 1 succeeds (`201`), 1 fails (`409`), `available=0`. |
| **2. Stale Stock (Abandoned Checkout)** | Reserved stock not released after checkout timeout. | BullMQ `reservation-expiry` job + idempotent `expireReservationById` (`expire:<id>`). | `commerce.test.ts` expiry test: stock restored, duplicate expiry skipped. |
| **3. Payment / Order Mismatch** | Duplicate payment webhook events or retries. | HMAC-SHA256 verification + Redis `SET NX` event deduplication + `Order.idempotencyKey`. | `webhooks.test.ts`: second signed event returns `deduplicated: true`. |
| **4. Slow Search** | Unindexed catalog queries. | Composite index `@@index([category, status])` on `Product` + pagination (`limit <= 50`). | `performance-shipping.test.ts` — `records a catalog slow-search benchmark`; runtime evidence: `04-slow-search.log`. |
| **5. Failed Shipping Callback** | Invalid signature or transient carrier failure. | `verifySignature` rejects forged payloads (`401`); failed webhook state retries after shipment availability. | `performance-shipping.test.ts` — `retries a failed shipping callback after the shipment is available`; runtime evidence: `05-shipping-callback-recovery.log`. |
| **6. Duplicate Refunds** | Support agent or retry submitting same refund twice. | `Refund.idempotencyKey` unique constraint + captured-amount guard. | `commerce.test.ts`: duplicate refund returns `200 deduplicated: true`. |

## Evidence boundary

The verification column identifies the exact automated scenario and the evidence filename produced by `deploy/scripts/final-assessment-verify.ps1`. Runtime output is only claimable when the isolated CI artifact `assessment-runtime-evidence` exists; repository mappings alone are not runtime results. Backup evidence is recorded in `backup-restore.txt` with source/restored fingerprints.
