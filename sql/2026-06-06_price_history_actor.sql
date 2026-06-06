-- p1_390 — Price History shows the real person who changed the price.
-- Problem: the log trigger read current_setting('app.current_user'), which the app can't
-- set reliably over PostgREST (each REST call is a fresh pooled connection), so every row
-- logged 'system'. Fix: add a last_modified_by column the app stamps on each price/cost
-- update, and have the trigger prefer it.

alter table products_master add column if not exists last_modified_by text;

create or replace function public.log_product_price_change()
returns trigger
language plpgsql
security definer
as $function$
  declare actor_name text;
  begin
    if coalesce(old.price, 0) = coalesce(new.price, 0)
       and coalesce(old.cost_price, 0) = coalesce(new.cost_price, 0) then
       return new;
    end if;
    begin
      actor_name := coalesce(
        nullif(new.last_modified_by, ''),
        nullif(current_setting('app.current_user', true), ''),
        'system'
      );
    exception when others then actor_name := coalesce(nullif(new.last_modified_by, ''), 'system');
    end;
    insert into public.product_price_history (
      sku, product_name, old_price, new_price, delta, delta_pct,
      old_cost, new_cost, changed_by, change_source
    ) values (
      new.sku, new.name, old.price, new.price,
      coalesce(new.price, 0) - coalesce(old.price, 0),
      case when coalesce(old.price, 0) > 0
        then round((((new.price - old.price) / old.price) * 100)::numeric, 2)
        else null end,
      old.cost_price, new.cost_price, actor_name, 'trigger'
    );
    return new;
  end;
$function$;

-- App stamps last_modified_by in these flows (app.js): bulkSaveEdits, bulk price modal,
-- __fpSave (floor), savePdpData. Historical rows stay 'system' (shown as "Sistem (auto)").
