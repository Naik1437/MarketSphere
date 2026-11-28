# Final Submission Checklist

## Internal evidence

- A04: `apps/api/tests/auth-and-db.test.ts` covers five-role authentication, RBAC, ownership isolation, refresh rotation and database uniqueness.
- A05/A06: `services/python-engine/tests/` and API checkout/recommendation integration evidence cover deterministic pricing, normalization and recommendation fallback/history inputs.
- A07: `apps/api/tests/commerce.test.ts` and `regression.test.ts` cover last-item locking, expiry, inventory validation and shipment transitions.
- A12: CI artifacts must include API, Python, frontend and Playwright results.
- A13: OpenAPI/Postman parity is enforced by `apps/api/tests/contract-parity.test.ts`.
- A15: `deploy/scripts/final-assessment-verify.ps1` produces six scenario logs and backup/restore fingerprints; only CI artifacts count as runtime evidence.

## External configuration checklist

Required environment variables: `STRIPE_SECRET_KEY` (`sk_test_`), `SHIPPING_PROVIDER_URL`, `SHIPPING_PROVIDER_TOKEN`, `RESEND_API_KEY`, `EMAIL_FROM`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_STORAGE_BUCKET`, `STAGING_SSH_HOST`, `STAGING_SSH_USER`, `STAGING_SSH_KEY`, `PROD_SSH_HOST`, `PROD_SSH_USER`, `PROD_SSH_KEY`, `STAGING_SSH_KNOWN_HOSTS`, and `PROD_SSH_KNOWN_HOSTS`.

Deployment requires HTTPS certificates and DNS, private PostgreSQL and Redis, the worker process, health/metrics monitoring, persistent backup storage, verified restore access, and rollback approval. These require user-owned infrastructure or evaluator approval and are not claimed complete at ₹0.

## Demonstration sequence

1. Show CI checks and seeded five-role login.
2. Demonstrate seller product/SKU creation and admin seller approval.
3. Demonstrate customer cart, checkout idempotency and warehouse shipment transition.
4. Show webhook signature rejection, duplicate event handling and refund idempotency.
5. Run the six A15 scenarios and open their logs plus backup/restore comparison.
6. Explain local simulations, unavailable external credentials and deployment blockers.
