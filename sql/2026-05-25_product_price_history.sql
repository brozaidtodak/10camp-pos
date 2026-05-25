-- p1_111 — Product price history tracking via Postgres trigger.
-- Auto-logs every price change on products_master.

CREATE TABLE IF NOT EXISTS public.product_price_history (
    id              BIGSERIAL PRIMARY KEY,
    sku             TEXT        NOT NULL,
    product_name    TEXT,
    old_price       NUMERIC(10, 2),
    new_price       NUMERIC(10, 2) NOT NULL,
    delta           NUMERIC(10, 2),
    delta_pct       NUMERIC(7, 2),
    old_cost        NUMERIC(10, 2),
    new_cost        NUMERIC(10, 2),
    changed_by      TEXT,
    changed_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    change_source   TEXT        -- 'manual' | 'bulk_edit' | 'sync' | 'trigger'
);

COMMENT ON TABLE public.product_price_history IS
    'Auto-log price changes pada products_master. Trigger fires on UPDATE bila price atau cost_price berubah.';

ALTER TABLE public.product_price_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_all" ON public.product_price_history;
CREATE POLICY "service_role_all" ON public.product_price_history
    FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "auth_read" ON public.product_price_history;
CREATE POLICY "auth_read" ON public.product_price_history
    FOR SELECT TO authenticated USING (true);

CREATE INDEX IF NOT EXISTS price_history_sku_idx
    ON public.product_price_history (sku, changed_at DESC);

CREATE INDEX IF NOT EXISTS price_history_changed_at_idx
    ON public.product_price_history (changed_at DESC);

-- Trigger function: auto-log price changes
CREATE OR REPLACE FUNCTION public.log_product_price_change()
RETURNS TRIGGER AS $$
DECLARE
    actor_name TEXT;
BEGIN
    -- Skip if neither price nor cost_price changed
    IF COALESCE(OLD.price, 0) = COALESCE(NEW.price, 0)
       AND COALESCE(OLD.cost_price, 0) = COALESCE(NEW.cost_price, 0) THEN
        RETURN NEW;
    END IF;

    -- Try to capture actor from session variable (set by app); fallback to 'system'
    BEGIN
        actor_name := current_setting('app.current_user', true);
        IF actor_name IS NULL OR actor_name = '' THEN
            actor_name := 'system';
        END IF;
    EXCEPTION WHEN OTHERS THEN
        actor_name := 'system';
    END;

    INSERT INTO public.product_price_history (
        sku, product_name,
        old_price, new_price, delta, delta_pct,
        old_cost, new_cost,
        changed_by, change_source
    ) VALUES (
        NEW.sku, NEW.name,
        OLD.price, NEW.price,
        COALESCE(NEW.price, 0) - COALESCE(OLD.price, 0),
        CASE WHEN COALESCE(OLD.price, 0) > 0
            THEN ROUND((((NEW.price - OLD.price) / OLD.price) * 100)::NUMERIC, 2)
            ELSE NULL
        END,
        OLD.cost_price, NEW.cost_price,
        actor_name,
        'trigger'
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS log_product_price_change_trg ON public.products_master;
CREATE TRIGGER log_product_price_change_trg
    AFTER UPDATE OF price, cost_price ON public.products_master
    FOR EACH ROW
    EXECUTE FUNCTION public.log_product_price_change();
