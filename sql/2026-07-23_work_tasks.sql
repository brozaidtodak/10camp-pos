-- 2026-07-23 — Papan Kerja (aliran kerja 10 CAMP) dipindah dari 10cc ke POS back office. p1_1188
-- Peta operasi: 7 stage main flow (kitaran sourcing→analytics) + 3 backbone (finance/hr/it).
-- Data disalin dari tencc.work_tasks (10cc-cc); table asal dikekalkan sbg arkib, tak dipakai lagi.
-- Papan = Bos sahaja (gate isBoss client-side, corak body.is-boss-user sama mcm Tugasan Staf).
-- Model akses = sama macam staff_tasks: policy role `public`, grant authenticated (login POS).

CREATE TABLE IF NOT EXISTS public.work_tasks (
    id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    title      TEXT NOT NULL,
    notes      TEXT,
    status     TEXT NOT NULL DEFAULT 'sourcing',  -- kunci stage (sourcing/receiving/marketing/sales/fulfilment/customer_service/analytics/finance/hr/it)
    priority   TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal','high')),
    position   INTEGER NOT NULL DEFAULT 0,
    assignee   TEXT,
    category   TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.work_tasks IS
    'Papan Kerja — kad kerja per stage aliran operasi 10 CAMP (pindah dari tencc.work_tasks 10cc).';

ALTER TABLE public.work_tasks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_all_work_tasks" ON public.work_tasks;
CREATE POLICY "service_role_all_work_tasks" ON public.work_tasks
    FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "public_read_work_tasks" ON public.work_tasks;
CREATE POLICY "public_read_work_tasks" ON public.work_tasks
    FOR SELECT TO public USING (true);

DROP POLICY IF EXISTS "public_insert_work_tasks" ON public.work_tasks;
CREATE POLICY "public_insert_work_tasks" ON public.work_tasks
    FOR INSERT TO public WITH CHECK (true);

DROP POLICY IF EXISTS "public_update_work_tasks" ON public.work_tasks;
CREATE POLICY "public_update_work_tasks" ON public.work_tasks
    FOR UPDATE TO public USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "public_delete_work_tasks" ON public.work_tasks;
CREATE POLICY "public_delete_work_tasks" ON public.work_tasks
    FOR DELETE TO public USING (true);

CREATE INDEX IF NOT EXISTS work_tasks_status_idx ON public.work_tasks (status);

-- Rollback:
-- DROP TABLE IF EXISTS public.work_tasks;
