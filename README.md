# Node.js + TypeScript + Fastify + RabbitMQ — Order System

A basic but extensible project that teaches event-driven architecture through the order placement domain, running entirely with Docker.

## Architecture

```
Client → Fastify API → PostgreSQL (PENDING)
              ↓
         RabbitMQ (order.created)
              ↓
         Worker → PostgreSQL (CONFIRMED / FAILED)
              ↓
         RabbitMQ (order.confirmed / order.failed)
```

### Services

| Service | Port | Description |
|---------|------|-------------|
| **api** | 3000 | REST API — create and query orders |
| **worker** | — | RabbitMQ consumer — process orders |
| **postgres** | 5432 | Order database |
| **rabbitmq** | 5672 / 15672 | Message broker + Management UI |

### RabbitMQ Topology

- **Exchange:** `orders` (topic)
- **Queue:** `order.processing`
- **Routing keys:** `order.created`, `order.confirmed`, `order.failed`

## Quick Start (Docker)

```bash
# Start all services
docker compose up -d

# Follow logs
docker compose logs -f api worker
```

Once services are ready:

- API: http://localhost:3000
- RabbitMQ Management: http://localhost:15672 (guest / guest)

## API Usage

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
      {
        "productId": "prod-1",
        "name": "Laptop",
        "quantity": 1,
        "unitPrice": 250
      }
    ]
  }'
```

Returns `201 Created` with the order saved as `PENDING`. The worker updates the status to `CONFIRMED` or `FAILED` within a few seconds.

> **Note:** Orders with `totalAmount > 10000` are marked as `FAILED` by business rule.

### Get an order

```bash
curl http://localhost:3000/orders/{order-id}
```

### List all orders

```bash
curl http://localhost:3000/orders
```

## Local Development (without Docker)

```bash
cp .env.example .env
npm install
npx prisma generate
npx prisma migrate dev

# In separate terminals
npm run dev:api
npm run dev:worker
```

PostgreSQL and RabbitMQ must be running locally.

## Production Build

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

## Project Structure

```
src/
├── api/           # Fastify REST API
├── worker/        # RabbitMQ consumer
└── shared/        # Shared modules (config, db, messaging, types)
prisma/            # Database schema and migrations
docker/            # Docker entrypoint scripts
```

## Extension Ideas

- Add a notification service listening to `order.confirmed` events
- Inventory service for stock validation
- Dead letter queue (DLQ) for failed message handling
- OpenTelemetry for observability
- JWT-based authentication

## Scripts

| Script | Description |
|--------|-------------|
| `npm run dev:api` | API development mode (tsx watch) |
| `npm run dev:worker` | Worker development mode |
| `npm run build` | Compile TypeScript |
| `npm run docker:up` | Start Docker services |
| `npm run docker:down` | Stop Docker services |
| `npm run db:migrate` | Apply migrations |
