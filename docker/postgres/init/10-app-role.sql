-- Least-privilege application role. Runs once, on first volume initialization
-- (Postgres executes every *.sql in /docker-entrypoint-initdb.d only when the
-- data directory is empty). The app connects as orders_app instead of the
-- superuser; it owns its schema and can run migrations, but cannot administer
-- the server.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'orders_app') THEN
    CREATE ROLE orders_app WITH LOGIN PASSWORD 'orders_app';
  END IF;
END
$$;

GRANT ALL PRIVILEGES ON DATABASE orders TO orders_app;
GRANT ALL ON SCHEMA public TO orders_app;
ALTER SCHEMA public OWNER TO orders_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO orders_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO orders_app;
