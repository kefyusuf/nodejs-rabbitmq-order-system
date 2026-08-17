# nodejs-rabbitmq — Order Placement API (mid tier)

Fastify + RabbitMQ order API. This is the **mid** tier: a pluggable storage
adapter, a **Redis** store, a **full RabbitMQ topology** (retries / dead-letter /
notifications) and **split processes** (API, worker, notification).

| Tier | Branch / tag | Storage | Topology | Processes |
| ---- | ------------ | ------- | -------- | --------- |
| beginner | `git checkout beginner` (`v0.1.0`) | in-memory | basic | 1 (api+worker) |
| **mid (you are here)** | `git checkout mid` (`v0.2.0`) | in-memory / redis | full | 3 (api, worker, notification) |
| hero | `main` (`v0.3.0`) | in-memory / redis / postgres + outbox | full | 3 + auth + observability |

## What changed vs beginner

- **Redis adapter** (`src/shared/storage/redis.ts`) behind the same `OrderStore`
  interface. The API and worker are now separate processes that share state
  through Redis instead of an in-process Map.
- **Full topology** (`TOPOLOGY=full`): `order.created` is consumed by the
  worker; on failure the message is retried (delayed queue) and then dead-lettered
  to `orders.dlx` → DLQ. Processed orders are fanned out via `order.confirmed` /
  `order.failed` to a **notification** worker.
- **Reconnect**: the worker/notification consumers re-register after a broker
  reconnect (`onMessagingReconnected`).

## Prerequisites

- Node.js 22+
- Docker + Docker Compose (recommended)
- Redis (only if running locally without Docker)

## Run with Docker (recommended)

```bash
docker compose up -d --build
docker compose logs -f api worker notification
```

This starts `rabbitmq`, `redis`, `api`, `worker`, `notification`.

## Run locally

```bash
cp .env.example .env          # STORE=redis, REDIS_URL, TOPOLOGY=full
npm install
# terminal 1 — API
npm run dev:api
# terminal 2 — worker
npm run dev:worker
# terminal 3 — notification worker
npm run dev:notification
```

When `STORE=in-memory` the three processes each get their own Map, so the flow
only works correctly with a shared store (redis/postgres). Use `redis` for mid.

## Try it

```bash
curl -X POST http://localhost:3000/orders \
  -H 'Content-Type: application/json' \
  -d '{"customerName":"Ali","items":[{"productId":"p-1","name":"Klavye","quantity":1,"unitPrice":250}]}'
# -> 201, status PENDING, eventPublished: true

curl http://localhost:3000/orders/:id
# -> status CONFIRMED after ~1.5s; notification worker logs an email
```

- `totalAmount > 10000` → `FAILED` (rejected business rule).
- `GET /health` → `{ "status": "ok", "service": "order-api" }`.

## Tests / lint / build

```bash
npm test          # vitest (unit + integration, in-memory store)
npm run lint
npm run build
```

## Roadmap (hero)

`git checkout main` adds: Postgres adapter + **transactional outbox**
(`FOR UPDATE SKIP LOCKED`), consumer **idempotency**, `@fastify/jwt` auth,
OpenTelemetry tracing and Prometheus metrics, and a real multi-stage production
Dockerfile.

See `.planning/PLAN.md` for the full tier roadmap.
