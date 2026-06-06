-- p1_389 — Safe SKU rename (cascade across all sku-bearing tables).
-- Context: SKU is products_master PK. Two FKs (inventory_batches, inventory_transactions)
-- referenced it with ON DELETE CASCADE but NO ACTION on update, which BLOCKS renaming a
-- SKU that has stock rows. We add ON UPDATE CASCADE so the parent rename auto-moves those
-- child rows, then a function moves the remaining (non-FK) tables in one atomic transaction.
-- sales_history intentionally NOT touched: it stores line items as a JSON snapshot of what
-- was sold at the time, so it correctly keeps the old SKU.

-- 1. Add ON UPDATE CASCADE (keep existing ON DELETE CASCADE)
alter table inventory_batches drop constraint inventory_batches_sku_fkey,
  add constraint inventory_batches_sku_fkey
  foreign key (sku) references products_master(sku) on update cascade on delete cascade;

alter table inventory_transactions drop constraint inventory_transactions_sku_fkey,
  add constraint inventory_transactions_sku_fkey
  foreign key (sku) references products_master(sku) on update cascade on delete cascade;

-- 2. Atomic cascade rename
create or replace function public.rename_sku(p_old text, p_new text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total bigint := 0;
  n bigint;
  detail jsonb := '{}'::jsonb;
begin
  p_old := trim(p_old);
  p_new := trim(p_new);

  if p_new is null or p_new = '' then raise exception 'SKU baru kosong'; end if;
  if p_old = p_new then
    return jsonb_build_object('ok', true, 'old', p_old, 'new', p_new, 'rows', 0, 'detail', 'no change');
  end if;
  if not exists (select 1 from products_master where sku = p_old) then
    raise exception 'SKU lama % tak wujud', p_old;
  end if;
  if exists (select 1 from products_master where sku = p_new) then
    raise exception 'SKU baru % dah wujud', p_new;
  end if;

  -- Parent row. FK ON UPDATE CASCADE auto-updates inventory_batches + inventory_transactions.
  update products_master set sku = p_new where sku = p_old;

  -- Non-FK tables that carry a sku column.
  update product_price_history    set sku = p_new where sku = p_old; get diagnostics n = row_count; if n > 0 then detail := detail || jsonb_build_object('product_price_history', n);    v_total := v_total + n; end if;
  update purchase_order_items     set sku = p_new where sku = p_old; get diagnostics n = row_count; if n > 0 then detail := detail || jsonb_build_object('purchase_order_items', n);     v_total := v_total + n; end if;
  update returns_log              set sku = p_new where sku = p_old; get diagnostics n = row_count; if n > 0 then detail := detail || jsonb_build_object('returns_log', n);              v_total := v_total + n; end if;
  update stock_check_session_items set sku = p_new where sku = p_old; get diagnostics n = row_count; if n > 0 then detail := detail || jsonb_build_object('stock_check_session_items', n); v_total := v_total + n; end if;
  update stock_reservations       set sku = p_new where sku = p_old; get diagnostics n = row_count; if n > 0 then detail := detail || jsonb_build_object('stock_reservations', n);        v_total := v_total + n; end if;
  update products_master_desc_backup set sku = p_new where sku = p_old; get diagnostics n = row_count; if n > 0 then detail := detail || jsonb_build_object('desc_backup', n);          v_total := v_total + n; end if;

  -- Variant children whose parent pointer was the renamed product.
  update products_master set parent_sku = p_new where parent_sku = p_old; get diagnostics n = row_count; if n > 0 then detail := detail || jsonb_build_object('parent_sku_children', n); v_total := v_total + n; end if;

  return jsonb_build_object('ok', true, 'old', p_old, 'new', p_new, 'rows', v_total, 'detail', detail);
end;
$$;

grant execute on function public.rename_sku(text, text) to anon, authenticated, service_role;
