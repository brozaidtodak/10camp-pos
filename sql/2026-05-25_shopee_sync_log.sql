-- p1_98 Fasa 2D — Shopee cron sync log table.
-- Tracks every scheduled run for monitoring + debugging.

CREATE TABLE IF NOT EXISTS public.shopee_sync_log (
    id              BIGSERIAL PRIMARY KEY,
    ran_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    source          TEXT        NOT NULL,  -- 'cron' atau 'manual'
    mode            TEXT        NOT NULL,  -- 'import', 'dryrun', 'push'
    environment     TEXT        NOT NULL DEFAULT 'sandbox',
    orders_found    INT         DEFAULT 0,
    orders_new      INT         DEFAULT 0,
    orders_inserted INT         DEFAULT 0,
    error_message   TEXT,
    duration_ms     INT,
    raw_response    JSONB
);

COMMENT ON TABLE public.shopee_sync_log IS
    'Audit trail untuk Shopee sync runs (cron + manual). Lookup latest run: ORDER BY ran_at DESC LIMIT 1.';

ALTER TABLE public.shopee_sync_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_only" ON public.shopee_sync_log;
CREATE POLICY "service_role_only" ON public.shopee_sync_log
    FOR ALL
    TO service_role
    USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS shopee_sync_log_ran_at_idx
    ON public.shopee_sync_log (ran_at DESC);
