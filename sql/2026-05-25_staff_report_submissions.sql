-- p1_114 — Staff report submissions for Bos inbox.
-- Stores manual notes + bizdev pipeline data submitted by staff.

CREATE TABLE IF NOT EXISTS public.staff_report_submissions (
    id              BIGSERIAL PRIMARY KEY,
    staff_id        TEXT        NOT NULL,
    staff_name      TEXT        NOT NULL,
    submission_type TEXT        NOT NULL,  -- 'manual_notes' | 'bizdev_pipeline' | 'commission_draft'
    period_key      TEXT        NOT NULL,  -- 'mtd' | 'lastmonth' | '30d' | 'ytd'
    payload         JSONB       NOT NULL,
    submitted_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    bos_read_at     TIMESTAMPTZ,
    bos_action      TEXT,                  -- 'acknowledged' | 'flagged' | etc

    UNIQUE (staff_id, submission_type, period_key)
);

COMMENT ON TABLE public.staff_report_submissions IS
    'Staff manual notes + bizdev pipeline data, sync from localStorage saves. Bos inbox baca dari sini.';

ALTER TABLE public.staff_report_submissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_all" ON public.staff_report_submissions;
CREATE POLICY "service_role_all" ON public.staff_report_submissions
    FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "auth_read" ON public.staff_report_submissions;
CREATE POLICY "auth_read" ON public.staff_report_submissions
    FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "auth_upsert" ON public.staff_report_submissions;
CREATE POLICY "auth_upsert" ON public.staff_report_submissions
    FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "auth_update" ON public.staff_report_submissions;
CREATE POLICY "auth_update" ON public.staff_report_submissions
    FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS staff_report_submissions_recent_idx
    ON public.staff_report_submissions (submitted_at DESC);

CREATE INDEX IF NOT EXISTS staff_report_submissions_unread_idx
    ON public.staff_report_submissions (bos_read_at)
    WHERE bos_read_at IS NULL;

CREATE OR REPLACE FUNCTION public.staff_report_submissions_touch()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS staff_report_submissions_touch_trg ON public.staff_report_submissions;
CREATE TRIGGER staff_report_submissions_touch_trg
    BEFORE UPDATE ON public.staff_report_submissions
    FOR EACH ROW
    EXECUTE FUNCTION public.staff_report_submissions_touch();
