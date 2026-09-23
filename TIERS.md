# Tiers

This repository demonstrates the same order-placement system at three levels of
maturity. Each tier is a separate branch and is tagged as a milestone:

| Tier     | Branch     | Tag      | What it teaches                                      |
| -------- | ---------- | -------- | ---------------------------------------------------- |
| Beginner | `beginner` | `v0.1.0` | The basic flow, one process, in-memory store         |
| Mid      | `mid`      | `v0.2.0` | Redis store, split processes, full RabbitMQ topology |
| Hero     | `main`     | `v0.3.0` | Postgres + transactional outbox, JWT, OTel, metrics  |

Read them in order: each builds on the previous one. `main` is the most complete
version and is where new production-grade work happens.

## Capability comparison

| Aspect               | Beginner (`v0.1.0`)     | Mid (`v0.2.0`)                            | Hero (`v0.3.0`)                                              |
| -------------------- | ----------------------- | ----------------------------------------- | ------------------------------------------------------------ |
| Storage              | In-memory               | Redis adapter                             | PostgreSQL (Prisma) + transactional Outbox                   |
| Processes            | 1 (`src/server.ts`)     | 3 (api / worker / notification)           | 4+ (api / worker / notification / **relay**)                 |
| Order persistence    | Memory only             | Redis                                     | PostgreSQL (durable, migrated)                               |
| Event publishing     | Direct publish on write | Direct publish on write                   | **Outbox relay** (at-least-once, broker-safe)                |
| Consumer idempotency | —                       | —                                         | **Yes** (`processed_messages` dedupe)                        |
| RabbitMQ topology    | exchange + queue        | + retry queue + DLQ + DLX + notifications | Same as mid                                                  |
| Retries / DLQ        | —                       | Yes (3 retries, 5s delay)                 | Yes                                                          |
| Reconnect            | Basic                   | amqplib `recovery: true`                  | amqplib `recovery: true`                                     |
| Auth                 | —                       | —                                         | **JWT** (`/auth/token` + `authenticate`)                     |
| Tracing              | —                       | —                                         | **OpenTelemetry** (opt-in via `OTEL_EXPORTER_OTLP_ENDPOINT`) |
| Metrics              | —                       | —                                         | **Prometheus** at `GET /metrics`                             |
| Tests                | 18 Vitest unit tests    | 18 Vitest unit tests                      | 18 Vitest unit tests                                         |

## Running a specific tier

Each tier has its own `docker-compose` files describing the infrastructure it
needs. The hero tier's files live on `main`.

```bash
# Beginner (single process, no external infra needed for unit tests)
git checkout beginner
npm install && npm run build && npm test

# Mid (redis-backed, three processes)
git checkout mid
docker compose up -d            # postgres + rabbitmq + redis
npm run build && npm test

# Hero (postgres + outbox relay + auth + observability)
git checkout main
docker compose up -d --build    # full stack on shifted dev ports (8080/5433/5673)
```

## How to choose a starting point

- **Learning the basics** of Fastify + RabbitMQ → start at `beginner`.
- **Understanding process separation and real messaging topology** → `mid`.
- **Production-grade patterns** (durability, exactly-once-ish delivery,
  security, observability) → `main` (hero).

The architecture diagram and full API reference for the hero tier are in
[README.md](./README.md).
