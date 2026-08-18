# Node.js + TypeScript + Fastify + RabbitMQ — Order System

A compact but extensible event-driven system built around an order placement
flow. It demonstrates how a Fastify REST API, a PostgreSQL database and three
RabbitMQ-backed services cooperate to process orders asynchronously — with
retry, dead-lettering, automatic reconnection, **transactional outbox**,
**idempotent consumers**, **JWT auth**, **OpenTelemetry** tracing and
**Prometheus** metrics.

## Architecture

```
                          ┌─────────────────────────────────────────────────────────┐
                          │                       RabbitMQ                           │
  Client                  │  exchange: orders (topic)                                │
    │  POST /orders       │                                                         │
    │ (Bearer token)      │  order.created ─▶ [inventory.reserve] ─▶ Inventory Worker
    ▼                     │                                 │  reserves stock         │
  ┌──────────┐   HTTP     │                                 ├─ inventory.reserved     │
  │ Fastify  │◀───────────┼──▶ PostgreSQL ─▶ Outbox ─┐     └─ inventory.reservation. │
  │   API    │            │        ▲               │ │           failed              │
  │ (JWT +   │            │        │               │ │             │                 │
  │  /metrics│)           │   Outbox Relay ───────┘ │             ▼                   │
  └──────────┘            │                         │      [order.processing] ─▶ Order Worker
                          │                         │             │        │          │
                          │                      orders.dlx       │   retries          │
                          │                         │             ▼      ▼            │
                          │                 order.processing.dlq   order.confirmed / order.failed
                          │                                         │      │           │
                          │                                         ▼      ▼           │
                          │                              order.notifications ─▶ Notification Worker
                          └──────────────────────────────────────────────────────────┘
```

### The journey of an order

This is a **choreographed saga**: each service reacts to events and emits the
next one. The order is only `CONFIRMED` after stock has actually been reserved.

1. `POST /orders` — the API validates the payload (zod), calculates the total
   and saves the order as `PENDING` in PostgreSQL **and** inserts an
   `order.created` row into the **Outbox** in a single database transaction.
   The request requires a JWT bearer token.
2. The **outbox relay** polls the Outbox for unpublished rows, publishes
   `order.created` to the `orders` topic exchange, then marks the row
   published. This is the **transactional outbox** pattern: the event is never
   lost even if the broker is down at write time.
3. The **inventory worker** consumes `order.created` from `inventory.reserve`,
   reserves the requested stock (`FOR UPDATE` row locks, idempotent), and
   publishes `inventory.reserved` or — if anything is out of stock —
   `inventory.reservation.failed`.
4. The **order worker** consumes the inventory outcome from `order.processing`
   (one message at a time via prefetch). On `inventory.reserved` it simulates
   processing and applies the business rule: totals above 10,000 are `FAILED`,
   everything else is `CONFIRMED`. It deduplicates redeliveries via a
   `processed_messages` table (**idempotent consumer**).
5. The worker publishes `order.confirmed` or `order.failed`. If the business
   rule rejects an order whose stock was already reserved, it first publishes
   `inventory.release` so the inventory worker returns the stock
   (saga compensation).
6. The **notification worker** consumes `order.confirmed`/`order.failed` and
   sends a simulated customer email.
7. Clients poll `GET /orders/{id}` to observe the status transition.

### Services

| Service          | Port           | Description                                           |
| ---------------- | -------------- | ----------------------------------------------------- |
| **api**          | 3000 (8080 dev)| Fastify REST API — create/query orders, JWT, metrics   |
| **worker**       | —              | Consumer — react to inventory events, update status    |
| **inventory**    | —              | Consumer — reserve/release stock (saga step)           |
| **notification** | —              | Consumer — react to processed orders                   |
| **relay**        | —              | Outbox → RabbitMQ publisher                           |
| **postgres**     | 5432 (5433 dev)| Order database + Outbox + Inventory (Prisma)          |
| **rabbitmq**     | 5672 / 15672   | Message broker + Management UI (guest/guest)          |

> **Standard ports.** The canonical ports are **API 3000**, **RabbitMQ 5672**
> (AMQP) / **15672** (Management UI) and **PostgreSQL 5432** (also common:
> 8080 / 8000 for HTTP services). The local `docker-compose.override.yml`
> shifts the **host** ports (API → 8080, Postgres → 5433, RabbitMQ → 5673 /
> 15673) so this stack doesn't collide with other projects already using the
> standard ports. Container-internal traffic always uses the standard ports,
> so `DATABASE_URL` / `RABBITMQ_URL` stay unchanged.

## RabbitMQ topology

| Object                   | Type/Args                                | Purpose                                |
| ------------------------ | ---------------------------------------- | -------------------------------------- |
| `orders`                 | topic exchange, durable                  | All order lifecycle events             |
| `orders.dlx`             | direct exchange, durable                 | Dead letter exchange                   |
| `inventory.reserve`      | queue bound to `order.created`           | Triggers stock reservation             |
| `inventory.release`      | queue bound to `inventory.release`       | Releases stock (compensation)          |
| `order.processing`       | queue, dead-letters to `orders.dlx`      | Main processing queue (inventory outcome) |
| `order.processing.retry` | queue, TTL 5s, dead-letters back to main | Delayed redelivery for failed messages |
| `order.processing.dlq`   | queue bound to `orders.dlx`              | Messages that exhausted 3 retries      |
| `order.notifications`    | queue bound to `order.confirmed/failed`  | Notifications fan-out                  |

## Reliability & correctness

- **Transactional outbox:** the order and its event are written together. The
  relay guarantees at-least-once delivery; duplicate deliveries are absorbed
  downstream by consumer idempotency.
- **Idempotent consumers:** the worker records every processed `messageId` in a
  `processed_messages` table and skips duplicates — safe against broker
  redeliveries and relay retries.
- **Bounded retries:** a failing message is republished to the retry queue
  with an incremented `x-retry-count` header (5s delay per attempt). After
  3 attempts it is rejected and lands in the DLQ for inspection.
- **Prefetch(1):** the worker acknowledges one message at a time, so a poison
  message cannot flood the process.
- **Reconnect:** amqplib's built-in `recovery: true` re-establishes consumers
  and publishers automatically after a broker outage.
- **Observability:** Prometheus metrics are exposed at `GET /metrics`; optional
  OpenTelemetry tracing activates when `OTEL_EXPORTER_OTLP_ENDPOINT` is set.

## Scaling the relay horizontally

The outbox relay is the only component that publishes to RabbitMQ, and it is
designed to run as **multiple replicas** safely:

- Each poll runs `SELECT ... FROM "Outbox" WHERE published = false ... FOR UPDATE
  SKIP LOCKED` inside a single transaction. `SKIP LOCKED` lets concurrent
  replicas each claim a **disjoint** batch of rows, so no two replicas ever
  publish the same event.
- An event is marked `published = true` in the **same transaction** that
  publishes it. If a replica dies after publishing but before committing, the
  row stays unpublished and is retried — delivery is **at-least-once**.
- Downstream consumers are **idempotent** (they dedupe on `messageId` via the
  `processed_messages` table), so the occasional duplicate from a retry is
  absorbed without side effects.

Run more than one relay with Compose:

```bash
docker compose up -d --scale relay=3
```

In a Swarm / orchestrator deployment, set a replica count on the `relay`
service (`deploy.replicas`, shown in `docker-compose.prod.yml`).

Tuning knobs: the poll interval and the `LIMIT` in the relay query (batch size
per poll), plus `prefetch` on the consumers. Because claim + publish + mark are
atomic per batch, raising the replica count increases throughput linearly
without risking double-publishes.

## Quick start (Docker)

### Local development (shifted ports, no conflicts)

```bash
docker compose up -d --build        # base + docker-compose.override.yml (dev ports)
docker compose logs -f api worker inventory notification relay
```

- API: http://localhost:8080  (standard port is 3000 — see above)
- RabbitMQ Management UI: http://localhost:15673 (guest / guest)

### Standard ports (production-like)

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

- API: http://localhost:3000
- RabbitMQ Management UI: http://localhost:15672 (guest / guest)

> On Windows the bind-mounted dev services do not hot-reload on host file
> changes; run `docker compose restart api worker notification relay` after
> editing source files.

## API usage

### Health check & metrics

```bash
curl http://localhost:8080/health
curl http://localhost:8080/metrics        # Prometheus scrape endpoint
```

### Get a token

```bash
curl -X POST http://localhost:8080/auth/token \
  -H "Content-Type: application/json" \
  -d '{"username":"demo"}'
# => { "token": "<jwt>" }
```

In this demo the token issuer is open; in production it would exchange real
credentials. Requests to `POST /orders` must carry the token:

```bash
curl -X POST http://localhost:8080/orders \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <jwt>" \
  -d '{
    "customerName": "John Doe",
    "items": [
      { "productId": "prod-1", "name": "Laptop", "quantity": 1, "unitPrice": 250 }
    ]
  }'
```

Returns `201 Created` with the `PENDING` order plus an `eventStored: true`
flag (the event is now safely in the outbox, the relay publishes it shortly
after). Within a few seconds the worker sets the status to `CONFIRMED` — or
`FAILED` when `totalAmount > 10000`.

### Query orders

```bash
curl http://localhost:8080/orders          # list all
curl http://localhost:8080/orders/{id}     # single order (404 if unknown)
```

## Local development (without full Docker)

Start only the infrastructure, then run the services on your host. Use the
shifted host ports (or change them back to standard) as needed.

```bash
docker compose up -d postgres rabbitmq
cp .env.example .env        # switch hosts to localhost (see file comments)
npm install
npx prisma generate
npx prisma migrate dev

npm run dev:api             # terminal 1
npm run dev:inventory       # terminal 2
npm run dev:worker          # terminal 3
npm run dev:notification    # terminal 4
npm run dev:relay           # terminal 5 (outbox -> RabbitMQ)
```

Set `JWT_SECRET` in `.env` (any non-empty value; the app defaults to
`dev-insecure-change-me`). For tracing, set `OTEL_EXPORTER_OTLP_ENDPOINT`.
The notification worker sends email via Nodemailer: `MAIL_MODE` is `console`
(logs only, default) and can be switched to `smtp` or `resend` with the
relevant credentials — see `.env.example`.

## Testing, linting, building

```bash
npm test            # Vitest unit tests (domain, schemas, handler, routes)
npm run lint        # ESLint
npm run format:check
npm run build       # TypeScript -> dist/
```

## Production build

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

The production overlay runs the compiled `dist/` output from the multi-stage
Dockerfile without source bind mounts, and adds the `relay` service. Migrations
are applied by the image entrypoint on boot. **Change `JWT_SECRET`** before any
non-local deployment.

## Project structure

```
src/
├── api/                  # Fastify REST API (app, entrypoint, routes, auth plugin)
├── worker/               # Order processing consumer (idempotent, reacts to inventory events)
├── inventory-worker/     # Inventory consumer (reserve/release stock — saga step)
├── notification-worker/  # Notification consumer
├── outbox-relay/         # Polls Outbox, publishes to RabbitMQ
├── types/                # fastify module augmentation
└── shared/
    ├── config/           # zod-validated environment
    ├── db/               # Prisma client singleton
    ├── domain/           # Pure business logic (order math/status rules)
    ├── messaging/        # Connection, topology, publisher, constants
    ├── observability/    # OpenTelemetry tracing + Prometheus metrics
    ├── repositories/     # Database access (OrderStore adapter)
    ├── storage/          # OrderStore implementations (in-memory/redis/postgres)
    └── types/            # zod schemas + event contracts
tests/                    # Vitest tests mirroring src/
prisma/                   # Schema and migrations
docker/                   # Entrypoint scripts
```

## Roadmap

Done in this version (hero tier):

- [x] Event-driven core: API → relay → worker → notification
- [x] Retry queue + dead letter queue + DLX
- [x] Consumer prefetch and automatic reconnection (`recovery: true`)
- [x] **Transactional outbox** — `order.created` is never lost when the broker is down
- [x] **Idempotent consumers** — dedupe on `messageId`
- [x] **JWT authentication** on the API (`/auth/token` issuer + `authenticate` decorator)
- [x] **OpenTelemetry** tracing (opt-in via `OTEL_EXPORTER_OTLP_ENDPOINT`)
- [x] **Prometheus** metrics (`/metrics`)
- [x] Unit tests, lint, CI
- [x] **Inventory saga** — stock is reserved before an order is confirmed; a
      rejection releases the stock again (choreographed saga + compensation)
- [x] **Real email delivery** — the notification worker sends through Nodemailer
      (`console` / `smtp` / `resend` modes), logging by default, real SMTP or
      Resend when configured
- [x] **Relay horizontal scaling** — multiple relay replicas via `SKIP LOCKED`,
      documented in [Scaling the relay horizontally](#scaling-the-relay-horizontally)

Next steps (roughly in order):

- [ ] Add an order `inventory` read model / API endpoint
- [ ] End-to-end tests against a real broker + database

## Scripts

| Script                     | Description                           |
| -------------------------- | ------------------------------------- |
| `npm run dev:api`          | API in watch mode                     |
| `npm run dev:inventory`    | Inventory worker in watch mode        |
| `npm run dev:worker`       | Order worker in watch mode            |
| `npm run dev:notification` | Notification worker in watch mode     |
| `npm run dev:relay`        | Outbox relay in watch mode            |
| `npm test`                 | Run unit tests                        |
| `npm run lint`             | ESLint                                |
| `npm run build`            | Compile TypeScript                    |
| `npm run db:migrate:dev`   | Create/apply migrations (development) |
| `npm run docker:up`        | Start all Docker services             |
| `npm run docker:down`      | Stop all Docker services              |

## License

MIT
