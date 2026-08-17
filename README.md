# Node.js + TypeScript + Fastify + RabbitMQ — Sipariş Sistemi (beginner)

Bu dal **temel seviyenin (beginner)** çalışan hâlidir. Tek bir node sürecinde
Fastify API + RabbitMQ consumer bir arada; veritabanı yok, veri **hafızada
(in‑memory)** tutulur. RabbitMQu göstermek için yeter.

> ⚠️ Daha gelişmiş seviyeler: `mid` dalı (redis + retry/DLQ + notification),
> `hero`/`main` dalı (postgres + outbox + idempotency + auth + otel).
> `git checkout mid` / `git checkout main`.

## Ne işe yarıyor? (sipariş akışı)

```
       ┌────────┐  POST /orders   ┌──────────┐  order.created
       │  Sen   │ ──────────────▶ │ Fastify  │ ───────────▶ RabbitMQ
       │(curl)  │                 │  API     │               │
       └────────┘                 └──────────┘               │
                                                               ▼
                                                       ┌────────────┐
                                                       │  Worker    │  (aynı süreç)
                                                       │  (consumer)│
                                                       └─────┬──────┘
                                                             │
                                                order.confirmed | order.failed
                                                             ▼
                                                          (kuyrukta)
       GET /orders/:id  ◀──  API hâlâ hafızada tutuyor
```

1. `POST /orders` → sipariş `PENDING`, `order.created` mesajı gönderilir.
2. **Worker** (aynı süreç) mesajı okur → 1.5s simülasyon → toplam 10.000 TL
   altı `CONFIRMED`, üstü `FAILED`, `order.confirmed`/`order.failed` yayınlar.
3. `GET /orders/:id` ile durumu takip ederiz (hafızadaki sipariş güncellenir).

## Başlangıç (5 adım)

```bash
docker compose up -d        # sadece RabbitMQ (5672 + yönetim 15672)
npm install
npm run dev                 # tek süreç: Fastify + worker
```

> İlk `npm run dev` birkaç saniye RabbitMQ bağlanmaya çalışır.

### Canlı deneme

```bash
# sağlık
curl http://localhost:3000/health

# sipariş oluştur (toplam 250 → CONFIRMED)
curl -X POST http://localhost:3000/orders \
  -H "Content-Type: application/json" \
  -d '{"customerName":"Ayşe","items":[{"productId":"p-1","name":"Mouse","quantity":1,"unitPrice":250}]}'

# siparişi sorgula (PENDING → ~2s sonra CONFIRMED)
curl http://localhost:3000/orders
```

## Kavramlar (kısa)

| Kavram | Ne işe yarar |
|---|---|
| **Exchange (topic)** | `orders` adında; mesajı *routing key* e göre kuyruğa yönlendirir. |
| **Queue (`order.processing`)** | Worker'ın okuduğu kuyruk. |
| **Routing key (`order.created`)** | Mesajın hangi kuyruğa gittiğini belirler. |
| **ack / nack** | Consumer mesajı işledikten sonra `ack` eder (silinir). Hata olursa `nack(requeue=true)` → tekrar kuyruğa. |

## Geliştirme / Katkı

```bash
npm test          # Vitest (domain + rota)
npm run lint
npm run build
```

## Seviye ilerleme kılavuzu

| Seviye | Dal | STORE | Topoloji | Servis sayısı |
|---|---|---|---|---|
| beginner | `beginner` | in‑memory | basic | 1 (tek süreç) |
| mid | `mid` | redis | full (DLX/retry/DLQ) | 3 (api+worker+notification) |
| hero | `main` | postgres | full + outbox | 3 + otel/auth/metrics |

## Lisans

MIT
