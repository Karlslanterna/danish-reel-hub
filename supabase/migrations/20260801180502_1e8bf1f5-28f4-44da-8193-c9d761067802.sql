CREATE SCHEMA IF NOT EXISTS extensions;
DO $$
BEGIN
  BEGIN
    ALTER EXTENSION pg_net SET SCHEMA extensions;
  EXCEPTION WHEN others THEN
    RAISE NOTICE 'pg_net relocation skipped: %', SQLERRM;
  END;
  BEGIN
    ALTER EXTENSION pg_cron SET SCHEMA extensions;
  EXCEPTION WHEN others THEN
    RAISE NOTICE 'pg_cron relocation skipped: %', SQLERRM;
  END;
END $$;