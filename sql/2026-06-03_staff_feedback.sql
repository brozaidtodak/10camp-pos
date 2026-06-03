-- p1_145 — Staff feedback / aduan / cadangan workflow.
CREATE TABLE IF NOT EXISTS public.staff_feedback (
    id              BIGSERIAL PRIMARY KEY,
    staff_id        TEXT NOT NULL,
    staff_name      TEXT NOT NULL,
    category        TEXT NOT NULL DEFAULT 'improvement',
    severity        TEXT NOT NULL DEFAULT 'medium',
    title           TEXT NOT NULL,
    body            TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'new',
    bos_reply       TEXT,
    bos_action      TEXT,
    posted_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    triaged_at      TIMESTAMPTZ,
    resolved_at     TIMESTAMPTZ
);

COMMENT ON TABLE public.staff_feedback IS
    'Staff aduan/cadangan workflow. Status: new → triaged → in_progress → resolved/wontfix. Severity: low/medium/high/critical. Category: bug/improvement/training/hardware/other.';

ALTER TABLE public.staff_feedback ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_all_sf" ON public.staff_feedback;
CREATE POLICY "service_role_all_sf" ON public.staff_feedback FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "auth_read_sf" ON public.staff_feedback;
CREATE POLICY "auth_read_sf" ON public.staff_feedback FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "auth_insert_sf" ON public.staff_feedback;
CREATE POLICY "auth_insert_sf" ON public.staff_feedback FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "auth_update_sf" ON public.staff_feedback;
CREATE POLICY "auth_update_sf" ON public.staff_feedback FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS sf_status_posted_idx ON public.staff_feedback (status, posted_at DESC);
CREATE INDEX IF NOT EXISTS sf_staff_idx ON public.staff_feedback (staff_id, posted_at DESC);
CREATE INDEX IF NOT EXISTS sf_severity_idx ON public.staff_feedback (severity, status);
CREATE INDEX IF NOT EXISTS sf_unread_idx ON public.staff_feedback (bos_reply, posted_at) WHERE bos_reply IS NULL;
