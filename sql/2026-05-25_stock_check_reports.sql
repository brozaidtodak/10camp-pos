-- p1_110 — Stock Check Reports workflow table.
-- Flow: Kael (Chief Inventory) submit → Zack (System Mgr) review → Bos final view.

CREATE TABLE IF NOT EXISTS public.stock_check_reports (
    id              BIGSERIAL PRIMARY KEY,
    period_start    DATE        NOT NULL,
    period_end      DATE        NOT NULL,

    -- Submitter (Kael / Chief Inventory)
    submitted_by_id   TEXT      NOT NULL,
    submitted_by_name TEXT      NOT NULL,
    submitted_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- Body content
    summary_text    TEXT,                    -- High-level summary written by submitter
    items_json      JSONB,                   -- Optional: structured items {sku, expected, actual, variance}
    attachments     JSONB,                   -- Optional: file URLs (Drive links)

    -- Counts (denormalized for quick display)
    items_checked   INT         DEFAULT 0,
    items_variance  INT         DEFAULT 0,
    rm_variance     NUMERIC(12, 2) DEFAULT 0,

    -- Status workflow
    status          TEXT        NOT NULL DEFAULT 'submitted',  -- submitted | reviewed | approved | rejected
    reviewer_id     TEXT,
    reviewer_name   TEXT,
    reviewed_at     TIMESTAMPTZ,
    review_notes    TEXT,

    bos_seen_at     TIMESTAMPTZ,
    bos_action      TEXT,                    -- acknowledged | flagged | etc

    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.stock_check_reports IS
    'Stock check workflow: Kael submit, Zack review, Bos final. Audit trail untuk setiap stock take session.';

ALTER TABLE public.stock_check_reports ENABLE ROW LEVEL SECURITY;

-- service_role full access (Netlify functions)
DROP POLICY IF EXISTS "service_role_all" ON public.stock_check_reports;
CREATE POLICY "service_role_all" ON public.stock_check_reports
    FOR ALL TO service_role
    USING (true) WITH CHECK (true);

-- authenticated users can read (sebab POS app authenticated via Supabase Auth)
DROP POLICY IF EXISTS "auth_read" ON public.stock_check_reports;
CREATE POLICY "auth_read" ON public.stock_check_reports
    FOR SELECT TO authenticated
    USING (true);

-- authenticated users can INSERT own submission
DROP POLICY IF EXISTS "auth_insert" ON public.stock_check_reports;
CREATE POLICY "auth_insert" ON public.stock_check_reports
    FOR INSERT TO authenticated
    WITH CHECK (true);

-- authenticated users can UPDATE (for review workflow)
DROP POLICY IF EXISTS "auth_update" ON public.stock_check_reports;
CREATE POLICY "auth_update" ON public.stock_check_reports
    FOR UPDATE TO authenticated
    USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS stock_check_reports_status_idx
    ON public.stock_check_reports (status, submitted_at DESC);

CREATE INDEX IF NOT EXISTS stock_check_reports_submitter_idx
    ON public.stock_check_reports (submitted_by_id);

-- Trigger touch updated_at
CREATE OR REPLACE FUNCTION public.stock_check_reports_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS stock_check_reports_touch_updated_at_trg ON public.stock_check_reports;
CREATE TRIGGER stock_check_reports_touch_updated_at_trg
    BEFORE UPDATE ON public.stock_check_reports
    FOR EACH ROW
    EXECUTE FUNCTION public.stock_check_reports_touch_updated_at();
