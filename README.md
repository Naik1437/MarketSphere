# MarketSphere

Multi-Vendor Commerce, Inventory & Order Platform.

> **Status**: Integrated project foundation initialized (assessments A01–A15 not yet implemented).

## Architecture Overview

| Service | Stack | Port | Network |
| --- | --- | --- | --- |
| `web` | Next.js App Router, TypeScript, Tailwind CSS, TanStack Query | `3000` | `frontend_net`, `backend_net` |
| `api` | Express, TypeScript, Prisma, Zod, BullMQ | `4000` | `backend_net`, `data_net` |
| `worker` | BullMQ worker (`apps/api/dist/worker.js`) | — | `data_net` |
| `python-engine` | Python 3.11, FastAPI, Pydantic, pytest | `8000` | `backend_net` |
| `postgres` | PostgreSQL 16 (`postgres:16-alpine`) | internal (`5432`) | `data_net` (internal) |
| `redis` | Redis 7 (`redis:7-alpine`) | internal (`6379`) | `data_net` (internal) |

## Prerequisites

- Node.js `22+`
- Python `3.11+`
- Docker & Docker Compose

## Quick Start (Docker Compose)

1. Copy the example environment file:
   ```bash
   cp .env.example .env
   ```
2. Validate and start all services:
   ```bash
   docker compose config -q
   docker compose up -d --build
   ```
3. Verify health endpoints:
   - Frontend: `http://localhost:3000/api/health`
   - Express API (includes DB + Redis checks): `http://localhost:4000/health`
   - Python FastAPI Engine: `http://localhost:8000/health`

## Local Development Checks

- **Web**: `cd apps/web && npm install && npm run typecheck && npm run build`
- **API**: `cd apps/api && npm install && npx prisma generate && npm run typecheck && npm run build`
- **Python Engine**: `cd services/python-engine && pip install -r requirements.txt && pytest`

## Final assessment verification

Run the isolated verification batch from PowerShell. It uses a separate Compose project and leaves the existing demonstration project untouched:

```powershell
.\deploy\scripts\final-assessment-verify.ps1
```

Use `-Cleanup` only for the isolated project created by that command. The script captures API incident tests, Playwright workflows, service logs, health samples, database state, and a PostgreSQL backup under `docs/evidence/runtime-*`.

For a deployed host, publish the GHCR images, set `IMAGE_OWNER` and `IMAGE_TAG`, then run `deploy/scripts/deploy.sh <tag>`. Configure the `staging` and `production` GitHub environments with SSH secrets and required reviewers; these external credentials are not stored in this repository.

## Security & Secrets

- Never commit `.env` or real credentials.
- PostgreSQL and Redis are attached only to the internal `data_net` bridge network and are not published to host ports.

## Local Demo Accounts & Password Initialization

The idempotent seed script (`apps/api/prisma/seed.ts`) initializes 7 demo accounts across all 5 roles:

| Role | Email(s) |
| --- | --- |
| `CUSTOMER` | `customer1@marketsphere.local`, `customer2@marketsphere.local` |
| `SELLER` | `seller1@marketsphere.local`, `seller2@marketsphere.local` |
| `WAREHOUSE_OPERATOR` | `warehouse@marketsphere.local` |
| `SUPPORT_AGENT` | `support@marketsphere.local` |
| `ADMIN` | `admin@marketsphere.local` |

- Set `DEMO_SEED_PASSWORD` in your local `.env` (see `.env.example` for the local-only placeholder `DemoPass!2026`), then run:
  ```bash
  docker compose exec -T api npx prisma db seed
  ```

## Auth & Scope API Routes (`/api/v1/auth`)

- `POST /api/v1/auth/login`
- `POST /api/v1/auth/refresh` (with token rotation & reuse detection)
- `POST /api/v1/auth/logout`
- `GET /api/v1/auth/me`
- `GET /api/v1/auth/admin-check`, `GET /api/v1/auth/warehouse-check`, `GET /api/v1/auth/support-check`
- `GET /api/v1/auth/sellers/:sellerId/scope`, `GET /api/v1/auth/customers/:customerId/scope`
