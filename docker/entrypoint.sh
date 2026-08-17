#!/bin/sh
set -e

# postgres dışındaki store'lar (in-memory, redis) veritabanı migration gerektirmez.
if [ "$STORE" = "postgres" ]; then
  echo "Running database migrations..."
  npx prisma generate
  npx prisma migrate deploy
fi

exec "$@"
