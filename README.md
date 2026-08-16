# Node.js + TypeScript + Fastify + RabbitMQ — Order System

A compact but extensible event-driven system built around an order placement
flow. It demonstrates how a Fastify REST API, a PostgreSQL database and three
RabbitMQ-backed services cooperate to process orders asynchronously — with
retry, dead-lettering and automatic reconnection built in from the start.

## Architecture

```
                          ┌─────────────────────────────────────────────┐
                          │                 RabbitMQ                    │
   Client                 │                                             |
     │                    │  exchange: orders (topic)                   │
     ▼                    │    order.created ──▶ order.processing       │
 ┌──────────┐   HTTP      │                       │        │            │
 │ Fastify  │◀────────────┼──▶ PostgreSQL ──┐      │   retries exhausted │
 │   API    │             │                 │      ▼            ▼      │
 └──────────┘             │    order.processing.retry (TTL)  orders.dlx │
                          │                       │                     │
                          │    order.confirmed ──▶┐   order.processing.dlq
                          │    order.failed   ──▶ ├──────────────┐      │
                          │                       ▼              ▼      │
                          │              order.notifications          │
                          └─────────────────────────────────────────────┘
                                   ▲                ▲          ▲
                                   │                │          │
                     ┌─────────────┴──┐   ┌─────────┴───┐  ┌───┴──────────┐
                     │  Order Worker  │   │ Notification │  │  (inspect    │
                     │  (consumer)    │   │ Worker       │  │   DLQ here)  │
                     │  updates order │   │ sends mail   │  └──────────────┘
                     │  status        │   │ (simulated)  │
                     └───────┬────────┘   └──────────────┘
                             │
                             ▼
                        PostgreSQL
```

### The journey of an order

1. `POST /orders` — the API validates the payload (zod), calculates the
   total and saves the order as `PENDING` in PostgreSQL.
2. The API publishes an `order.created` event to the `orders` topic
   exchange. If the broker is unreachable the request still succeeds with
   `eventPublished: false` (see [Reliability](#reliability)).
3. The **order worker** consumes the event from `order.processing`
   (one message at a time via prefetch), simulates processing and applies
   the business rule: totals above 10,000 are `FAILED`, everything else is
   `CONFIRMED`.
4. The worker publishes `order.confirmed` or `order.failed`.
5. The **notification worker** consumes those events and sends a simulated
   customer email.
6. Clients poll `GET /orders/{id}` to observe the status transition.

### Services

| Service          | Port         | Description                                  |
| ---------------- | ------------ | -------------------------------------------- |
| **api**          | 3000         | Fastify REST API — create and query orders   |
| **worker**       | —            | Consumer — process orders, update status     |
| **notification** | —            | Consumer — react to processed orders         |
| **postgres**     | 5432         | Order database (Prisma)                      |
| **rabbitmq**     | 5672 / 15672 | Message broker + Management UI (guest/guest) |

## RabbitMQ topology

| Object                   | Type/Args                                | Purpose                                |
| ------------------------ | ---------------------------------------- | -------------------------------------- |
| `orders`                 | topic exchange, durable                  | All order lifecycle events             |
| `orders.dlx`             | direct exchange, durable                 | Dead letter exchange                   |
| `order.processing`       | queue, dead-letters to `orders.dlx`      | Main processing queue                  |
| `order.processing.retry` | queue, TTL 5s, dead-letters back to main | Delayed redelivery for failed messages |
| `order.processing.dlq`   | queue bound to `orders.dlx`              | Messages that exhausted 3 retries      |
| `order.notifications`    | queue bound to `order.confirmed/failed`  | Notifications fan-out                  |

### Reliability

- **Bounded retries:** a failing message is republished to the retry queue
  with an incremented `x-retry-count` header (5s delay per attempt). After
  3 attempts it is rejected and lands in the DLQ for inspection.
- **Prefetch(1):** the worker acknowledges one message at a time, so a
  poison message cannot flood the process.
- **Reconnect:** both workers re-establish their consumers automatically
  after a broker outage (exponential backoff).
- **Broker outage on write:** `POST /orders` persists first, then publishes.
  If publishing fails, the response carries `eventPublished: false` and the
  order stays `PENDING` — a deliberate trade-off; the transactional outbox
  pattern is on the roadmap.

## Quick start (Docker)

```bash
docker compose up -d          # infra + api + worker + notification (dev mode)
docker compose logs -f api worker notification
```

Once the services are healthy:

- API: http://localhost:3000
- RabbitMQ Management UI: http://localhost:15672 (guest / guest)

> On Windows the bind-mounted dev services do not hot-reload on host file
> changes; run `docker compose restart api worker notification` after
> editing source files.

## API usage

### Health check

```bash
curl http://localhost:3000/health
```

### Create an order

```bash
curl -X POST http://localhost:3000/orders \
  -H "Content-Type: application/json" \
  -d '{
    "customerName": "John Doe",
    "items": [
      { "productId": "prod-1", "name": "Laptop", "quantity": 1, "unitPrice": 250 }
    ]
  }'
```

Returns `201 Created` with the `PENDING` order plus an `eventPublished`
flag. Within a few seconds the worker sets the status to `CONFIRMED` — or
`FAILED` when `totalAmount > 10000`.

### Query orders

```bash
curl http://localhost:3000/orders          # list all
curl http://localhost:3000/orders/{id}     # single order (404 if unknown)
```

## Local development (without full Docker)

Start only the infrastructure, then run the services on your host:

```bash
docker compose up -d postgres rabbitmq
cp .env.example .env        # switch hosts to localhost (see file comments)
npm install
npx prisma generate
npx prisma migrate dev

npm run dev:api             # terminal 1
npm run dev:worker          # terminal 2
npm run dev:notification    # terminal 3
```

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

The production overlay runs the compiled `dist/` output from the
multi-stage Dockerfile without source bind mounts. Migrations are applied
by the image entrypoint on boot.

## Project structure

```
src/
├── api/                  # Fastify REST API (app, entrypoint, routes)
├── worker/               # Order processing consumer
├── notification-worker/  # Notification consumer
└── shared/
    ├── config/           # zod-validated environment
    ├── db/               # Prisma client singleton
    ├── domain/           # Pure business logic (order math/status rules)
    ├── messaging/        # Connection, topology, publisher, constants
    ├── repositories/     # Database access
    └── types/            # zod schemas + event contracts
tests/                    # Vitest tests mirroring src/
prisma/                   # Schema and migrations
docker/                   # Entrypoint scripts
```

## Roadmap

Done in the current version:

- [x] Event-driven core: API → worker → notification
- [x] Retry queue + dead letter queue + DLX
- [x] Consumer prefetch and automatic reconnection
- [x] Graceful publish-failure handling on writes
- [x] Unit tests, lint, CI

Next steps (roughly in order):

- [ ] Transactional outbox so `order.created` is never lost when the
      broker is down at write time
- [ ] Idempotent consumers (dedupe on `orderId`) for safe redeliveries
- [ ] Inventory service reserving stock on `order.created`
- [ ] OpenTelemetry tracing across API and workers
- [ ] JWT authentication on the API
- [ ] Real email provider behind the notification worker

## Scripts

| Script                     | Description                           |
| -------------------------- | ------------------------------------- |
| `npm run dev:api`          | API in watch mode                     |
| `npm run dev:worker`       | Order worker in watch mode            |
| `npm run dev:notification` | Notification worker in watch mode     |
| `npm test`                 | Run unit tests                        |
| `npm run lint`             | ESLint                                |
| `npm run build`            | Compile TypeScript                    |
| `npm run db:migrate:dev`   | Create/apply migrations (development) |
| `npm run docker:up`        | Start all Docker services             |
| `npm run docker:down`      | Stop all Docker services              |

## License

MIT
