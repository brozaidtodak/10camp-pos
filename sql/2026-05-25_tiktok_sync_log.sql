-- p1_104 — TikTok sync log table (mirror shopee_sync_log).
-- Run dalam Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS public.tiktok_sync_log (
    id              BIGSERIAL PRIMARY KEY,
    ran_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    source          TEXT        NOT NULL,  -- 'cron' atau 'manual'
    mode            TEXT        NOT NULL,  -- 'import', 'dryrun', 'push'
    orders_found    INT         DEFAULT 0,
    orders_new      INT         DEFAULT 0,
    orders_inserted INT         DEFAULT 0,
    error_message   TEXT,
    duration_ms     INT,
    raw_response    JSONB
);

COMMENT ON TABLE public.tiktok_sync_log IS
    'Audit trail untuk TikTok sync runs (cron + manual). ORDER BY ran_at DESC LIMIT 1 untuk latest.';

ALTER TABLE public.tiktok_sync_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_only" ON public.tiktok_sync_log;
CREATE POLICY "service_role_only" ON public.tiktok_sync_log
    FOR ALL
    TO service_role
    USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS tiktok_sync_log_ran_at_idx
    ON public.tiktok_sync_log (ran_at DESC);
