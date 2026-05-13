#!/usr/bin/env python3
"""
EasyStore → POS DB full migration sync.

Pulls:
  - All products (~385) → diff by SKU → insert new as draft
  - All customers (~1,768) → dedup by phone/email → upsert
  - All orders (~432) → idempotent insert keyed on easystore_order_id

Idempotent — re-runnable. Already-imported orders skipped via
metadata.easystore_order_id check.

Run:
   source ~/.claude/.env
   python3 scripts/easystore_sync.py [--dry-run] [--orders-only] [--products-only] [--customers-only]
"""
from __future__ import annotations
import argparse, json, os, sys, time, urllib.request, urllib.error
from datetime import datetime
from pathlib import Path
from collections import defaultdict

# -----------------------------------------------------------------
# CONFIG
# -----------------------------------------------------------------
EASYSTORE_BASE   = "https://www.10camp.com/api/3.0"
EASYSTORE_TOKEN  = os.environ.get("EASYSTORE_TOKEN")
SUPABASE_REF     = "asehjdnfzoypbwfeazra"
SUPABASE_TOKEN   = os.environ.get("SUPABASE_ACCESS_TOKEN")
SUPABASE_API     = f"https://api.supabase.com/v1/projects/{SUPABASE_REF}/database/query"
PAGE_LIMIT       = 50

if not EASYSTORE_TOKEN: sys.exit("EASYSTORE_TOKEN not set; source ~/.claude/.env first")
if not SUPABASE_TOKEN:  sys.exit("SUPABASE_ACCESS_TOKEN not set; source ~/.claude/.env first")


# -----------------------------------------------------------------
# HTTP HELPERS
# -----------------------------------------------------------------
def es_get(path):
    """GET from EasyStore API."""
    req = urllib.request.Request(
        f"{EASYSTORE_BASE}{path}",
        headers={"EasyStore-Access-Token": EASYSTORE_TOKEN, "Content-Type": "application/json"}
    )
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read())


def es_paginate(endpoint, key):
    """Iterate through all pages for an EasyStore list endpoint."""
    page = 1
    total = None
    while True:
        try:
            data = es_get(f"{endpoint}?page={page}&limit={PAGE_LIMIT}")
        except urllib.error.HTTPError as e:
            if e.code == 429:
                print(f"  [rate-limited, waiting 5s...]")
                time.sleep(5)
                continue
            raise
        items = data.get(key, [])
        if total is None:
            total = data.get('total_count', 0)
            print(f"  Total {key}: {total} ({data.get('page_count')} pages)")
        for item in items: yield item
        if not items or page >= data.get('page_count', 0):
            break
        page += 1
        time.sleep(0.4)   # gentle rate limiting


def sb_sql(sql):
    """Run raw SQL on Supabase via Management API."""
    req = urllib.request.Request(
        SUPABASE_API,
        data=json.dumps({"query": sql}).encode(),
        headers={"Authorization": f"Bearer {SUPABASE_TOKEN}",
                 "Content-Type": "application/json",
                 "User-Agent": "10camp-easystore-sync/1.0"},
        method="POST"
    )
    with urllib.request.urlopen(req, timeout=180) as r:
        return json.loads(r.read())


# -----------------------------------------------------------------
# UTILS
# -----------------------------------------------------------------
def norm_phone(raw):
    if not raw: return None
    digits = ''.join(c for c in str(raw) if c.isdigit())
    if len(digits) < 9: return None
    if digits.startswith('60'): return digits
    if digits.startswith('0'):  return '60' + digits[1:]
    return digits


def js(s):
    """Escape single quotes in SQL string literals."""
    return str(s).replace("'", "''")


def chunked(lst, n):
    for i in range(0, len(lst), n):
        yield lst[i:i+n]


# -----------------------------------------------------------------
# DATA FETCHING
# -----------------------------------------------------------------
def fetch_easystore_products():
    print("Fetching EasyStore products...")
    products = list(es_paginate("/products.json", "products"))
    print(f"  → {len(products)} products fetched")
    return products


def fetch_easystore_customers():
    print("Fetching EasyStore customers...")
    custs = list(es_paginate("/customers.json", "customers"))
    print(f"  → {len(custs)} customers fetched")
    return custs


def fetch_easystore_orders():
    print("Fetching EasyStore orders...")
    orders = list(es_paginate("/orders.json", "orders"))
    print(f"  → {len(orders)} orders fetched")
    return orders


# -----------------------------------------------------------------
# PRODUCT MIGRATION
# -----------------------------------------------------------------
def migrate_products(products, dry_run=False):
    print("\n━━━ MIGRATING PRODUCTS ━━━")

    # Existing SKUs
    existing_skus = {r['sku'].upper() for r in sb_sql("SELECT sku FROM products_master")}
    print(f"  POS DB has {len(existing_skus)} products")

    # Flatten variants — each variant becomes a POS DB row
    rows = []
    skipped_no_sku = 0
    for p in products:
        brand = p.get('vendors') or p.get('brands') or None
        category = None
        if p.get('collections'):
            # Use first collection that's not "Feature on homepage"
            for c in p['collections']:
                nm = c.get('name', '')
                if nm and 'feature' not in nm.lower():
                    category = nm
                    break
        first_image = p.get('images', [{}])[0].get('url') if p.get('images') else None
        all_images = [i.get('url') for i in p.get('images', []) if i.get('url')]

        variants = p.get('variants') or []
        if not variants:
            # No variants — create a single row from product
            sku = p.get('handle', '').upper()[:64] or f"ES-{p.get('id')}"
            rows.append({
                'sku': sku,
                'name': p.get('title') or p.get('name') or '(unnamed)',
                'brand': brand, 'category': category,
                'price': float(p.get('min_price') or 0),
                'cost_price': None,
                'unit': 'pcs',
                'description': f"[EASYSTORE-ID:{p.get('id')}] {p.get('body_html') or p.get('description') or ''}",
                'images': all_images or None,
                'is_published': bool(p.get('published_at') or p.get('is_published_in_selected_channel')),
                'easystore_product_id': str(p.get('id'))
            })
            continue

        for v in variants:
            sku = (v.get('sku') or '').strip().upper()
            if not sku:
                skipped_no_sku += 1
                continue
            sku = sku[:64]
            v_image = None
            for im in p.get('images', []):
                if im.get('id') == v.get('image_id'):
                    v_image = im.get('url')
                    break
            v_images = [v_image] if v_image else all_images
            opt = ' / '.join(filter(None, [v.get('option1'), v.get('option2'), v.get('option3')]))
            row = {
                'sku': sku,
                'name': (p.get('title') or '') + (f' — {opt}' if opt else ''),
                'brand': brand, 'category': category,
                'price': float(v.get('price') or 0),
                'cost_price': float(v.get('cost') or 0) if v.get('cost') else None,
                'unit': 'pcs',
                'erp_barcode': v.get('barcode') or None,
                'weight_kg': float(v.get('weight_in_kg') or v.get('weight') or 0) / 1000 if (v.get('weight_unit') == 'g') else float(v.get('weight') or 0) or None,
                'variant_size': v.get('option1') if (p.get('options') and any('size' in (o.get('name','').lower() if isinstance(o, dict) else '') for o in p.get('options', []))) else None,
                'images': v_images or None,
                'is_published': bool(p.get('published_at') or p.get('is_published_in_selected_channel')),
                'description': f"[EASYSTORE-ID:{p.get('id')}-V{v.get('id')}] {p.get('body_html') or p.get('description') or ''}",
                'easystore_product_id': str(p.get('id')),
                'easystore_variant_id': str(v.get('id')),
                'easystore_qty': int(v.get('inventory_quantity') or 0)
            }
            # Strip None
            rows.append({k: val for k, val in row.items() if val not in (None, '', 0) or k in ('cost_price','price','easystore_qty')})

    new_rows = [r for r in rows if r['sku'] not in existing_skus]
    existing_rows = [r for r in rows if r['sku'] in existing_skus]
    print(f"  Variants total: {len(rows)} (skipped {skipped_no_sku} without SKU)")
    print(f"    Already in POS DB: {len(existing_rows)}")
    print(f"    NEW from EasyStore: {len(new_rows)}")

    if dry_run:
        print(f"  [dry-run] would insert {len(new_rows)} new + UPDATE {len(existing_rows)} existing (price/images/is_published/easystore_qty)")
        if new_rows[:3]:
            print("  Sample of new:")
            for r in new_rows[:3]: print(f"    {r['sku']:<25} {r.get('name','')[:50]} · {r.get('brand','-')}")
        return

    # === UPDATE EXISTING (p1_24+, enhanced p1_29): refresh price/images/is_published + IDs ===
    # EasyStore is source of truth for online catalogue. Don't touch cost_price/batch.
    # p1_29: store easystore_variant_id + easystore_product_id in metadata so POS can push
    # inventory deductions back to EasyStore on sale.
    if existing_rows:
        print(f"  Updating {len(existing_rows)} existing products from EasyStore...")
        updated = 0
        for chunk in chunked(existing_rows, 50):
            vals = []
            for r in chunk:
                sku = js(r['sku'])
                price = float(r.get('price') or 0)
                images_json = json.dumps(r.get('images') or [], ensure_ascii=False).replace("'", "''")
                is_pub = 'true' if r.get('is_published') else 'false'
                es_qty = int(r.get('easystore_qty') or 0)
                es_variant_id = js(r.get('easystore_variant_id') or '')
                es_product_id = js(r.get('easystore_product_id') or '')
                # p1_53: refresh description too so existing rows get full EasyStore body (truncation removed)
                desc = js(r.get('description') or '')
                vals.append(f"('{sku}', {price}, '{images_json}'::jsonb, {is_pub}, {es_qty}, '{es_variant_id}', '{es_product_id}', '{desc}')")
            values_sql = ",".join(vals)
            sql = f"""
            UPDATE public.products_master pm
            SET price = u.price,
                images = CASE WHEN jsonb_array_length(u.images) > 0 THEN u.images ELSE pm.images END,
                is_published = u.is_published,
                description = CASE WHEN length(u.description) > 0 THEN u.description ELSE pm.description END,
                metadata = COALESCE(pm.metadata, '{{}}'::jsonb) || jsonb_build_object(
                    'easystore_qty', u.es_qty,
                    'easystore_variant_id', NULLIF(u.es_variant_id, ''),
                    'easystore_product_id', NULLIF(u.es_product_id, ''),
                    'easystore_synced_at', '{datetime.utcnow().isoformat()}'
                )
            FROM (VALUES {values_sql}) AS u(sku, price, images, is_published, es_qty, es_variant_id, es_product_id, description)
            WHERE upper(pm.sku) = upper(u.sku);
            """
            try:
                sb_sql(sql)
                updated += len(chunk)
            except Exception as e:
                print(f"  update chunk failed: {e}")
        print(f"  Updated {updated} existing products.")

    if not new_rows:
        print("  No new products to insert.")
        return 0

    # Insert in chunks. Strip the easystore_* fields (not in schema).
    cols_def = "sku text, name text, brand text, category text, price numeric, cost_price numeric, unit text, erp_barcode text, weight_kg numeric, variant_size text, images jsonb, is_published boolean, description text"
    col_names = "sku, name, brand, category, price, cost_price, unit, erp_barcode, weight_kg, variant_size, images, is_published, description"

    inserted = 0
    for chunk in chunked(new_rows, 50):
        clean = []
        for r in chunk:
            c = {k: v for k, v in r.items() if k not in ('easystore_product_id','easystore_variant_id','easystore_qty')}
            clean.append(c)
        payload = json.dumps(clean, ensure_ascii=False, default=str).replace("'", "''")
        sql = (
            f"INSERT INTO public.products_master ({col_names}) "
            f"SELECT {col_names} FROM jsonb_to_recordset('{payload}'::jsonb) "
            f"AS x({cols_def}) "
            f"ON CONFLICT (sku) DO NOTHING;"
        )
        try:
            sb_sql(sql)
            inserted += len(chunk)
        except Exception as e:
            print(f"  chunk failed: {e}")

    print(f"  Inserted {inserted} new products.")
    return inserted


# -----------------------------------------------------------------
# CUSTOMER MIGRATION
# -----------------------------------------------------------------
def migrate_customers(customers, dry_run=False):
    print("\n━━━ MIGRATING CUSTOMERS ━━━")

    # Existing customers indexed by phone
    existing = sb_sql("SELECT id, phone, email, easystore_customer_id FROM customers")
    by_phone = {c['phone']: c for c in existing if c['phone']}
    by_email = {c['email']: c for c in existing if c['email']}
    by_es_id = {c['easystore_customer_id']: c for c in existing if c['easystore_customer_id']}
    print(f"  POS DB has {len(existing)} customers ({len(by_phone)} unique phone, {len(by_email)} unique email)")

    new_inserts = []
    updates = []  # (id, easystore_customer_id, total_spent, total_orders) — backfill + refresh
    refresh_only = []  # (es_id, total_spent, total_orders) — already linked, just refresh totals
    skipped = 0

    for c in customers:
        es_id = str(c.get('id'))
        c_total_spent = float(c.get('total_spent') or 0)
        c_total_orders = int(c.get('total_order') or c.get('orders_count') or 0)
        if es_id in by_es_id:
            # Already linked — refresh totals (GREATEST)
            refresh_only.append((es_id, c_total_spent, c_total_orders))
            skipped += 1
            continue

        phone = norm_phone(c.get('phone'))
        email = (c.get('email') or '').strip().lower() or None
        name = c.get('name') or f"{c.get('first_name','')} {c.get('last_name','')}".strip() or '(unnamed)'

        # Check existing
        match = (by_phone.get(phone) if phone else None) or (by_email.get(email) if email else None)
        if match:
            updates.append((match['id'], es_id, c_total_spent, c_total_orders))
            continue

        # New customer
        addr = None
        if c.get('address1') or c.get('city'):
            addr = {k: v for k, v in {
                'address1': c.get('address1'),
                'address2': c.get('address2'),
                'city': c.get('city'),
                'state': c.get('province') or c.get('province_code'),
                'zip': c.get('zip'),
                'country': c.get('country') or c.get('country_code'),
                'company': c.get('company')
            }.items() if v}

        new_inserts.append({
            'name': name[:200],
            'phone': phone,
            'email': email,
            'easystore_customer_id': es_id,
            'accepts_email_marketing': bool(c.get('accepts_marketing')),
            'accepts_sms_marketing': False,  # EasyStore doesn't expose this
            'total_spent': float(c.get('total_spent') or 0),
            'total_orders': int(c.get('total_order') or c.get('orders_count') or 0),
            'address': addr,
            'is_member': int(c.get('total_order') or 0) >= 3,
            'points': int(float(c.get('total_spent') or 0) / 10),
        })

    print(f"  Already linked to EasyStore: {skipped} (totals will refresh)")
    print(f"  Match existing (will update with easystore_id + totals): {len(updates)}")
    print(f"  Brand new from EasyStore: {len(new_inserts)}")

    if dry_run:
        print(f"  [dry-run] would insert {len(new_inserts)}, link {len(updates)}, refresh totals on {len(refresh_only)}")
        return

    # Bulk update easystore_customer_id for matched + set totals
    if updates:
        vals = ",".join(f"({uid}, '{js(esid)}', {ts}, {to})" for uid, esid, ts, to in updates)
        sql = f"""
        UPDATE customers
        SET easystore_customer_id = u.es_id,
            total_spent = GREATEST(COALESCE(customers.total_spent,0), u.ts),
            total_orders = GREATEST(COALESCE(customers.total_orders,0), u.to_),
            is_member = CASE WHEN GREATEST(COALESCE(customers.total_orders,0), u.to_) >= 3 THEN true ELSE COALESCE(customers.is_member,false) END
        FROM (VALUES {vals}) AS u(cust_id, es_id, ts, to_)
        WHERE customers.id = u.cust_id;
        """
        try: sb_sql(sql); print(f"  Linked + refreshed {len(updates)} existing customers.")
        except Exception as e: print(f"  Link update failed: {e}")

    # Refresh totals for already-linked customers (chunked to avoid huge SQL)
    if refresh_only:
        print(f"  Refreshing totals for {len(refresh_only)} already-linked customers...")
        refreshed = 0
        for chunk in chunked(refresh_only, 200):
            vals = ",".join(f"('{js(esid)}', {ts}, {to})" for esid, ts, to in chunk)
            sql = f"""
            UPDATE customers
            SET total_spent = GREATEST(COALESCE(customers.total_spent,0), u.ts),
                total_orders = GREATEST(COALESCE(customers.total_orders,0), u.to_),
                is_member = CASE WHEN GREATEST(COALESCE(customers.total_orders,0), u.to_) >= 3 THEN true ELSE COALESCE(customers.is_member,false) END
            FROM (VALUES {vals}) AS u(es_id, ts, to_)
            WHERE customers.easystore_customer_id = u.es_id;
            """
            try:
                sb_sql(sql)
                refreshed += len(chunk)
            except Exception as e:
                print(f"  refresh chunk failed: {e}")
        print(f"  Refreshed {refreshed} customers' totals.")

    # Insert new
    if new_inserts:
        cols_def = "name text, phone text, email text, easystore_customer_id text, accepts_email_marketing boolean, accepts_sms_marketing boolean, total_spent numeric, total_orders integer, address jsonb, is_member boolean, points integer"
        col_names = "name, phone, email, easystore_customer_id, accepts_email_marketing, accepts_sms_marketing, total_spent, total_orders, address, is_member, points"
        inserted = 0
        for chunk in chunked(new_inserts, 100):
            payload = json.dumps(chunk, ensure_ascii=False, default=str).replace("'", "''")
            sql = (
                f"INSERT INTO public.customers ({col_names}) "
                f"SELECT {col_names} FROM jsonb_to_recordset('{payload}'::jsonb) "
                f"AS x({cols_def}) "
                f"ON CONFLICT (phone) DO UPDATE SET "
                f"  easystore_customer_id = COALESCE(excluded.easystore_customer_id, customers.easystore_customer_id), "
                f"  total_spent = GREATEST(customers.total_spent, excluded.total_spent), "
                f"  total_orders = GREATEST(customers.total_orders, excluded.total_orders);"
            )
            try:
                sb_sql(sql)
                inserted += len(chunk)
            except Exception as e:
                print(f"  insert chunk failed: {e}")
        print(f"  Inserted {inserted} new customers.")


# -----------------------------------------------------------------
# ORDER MIGRATION
# -----------------------------------------------------------------
def migrate_orders(orders, dry_run=False):
    print("\n━━━ MIGRATING ORDERS ━━━")

    # Already-imported EasyStore orders
    existing = sb_sql("SELECT metadata->>'easystore_order_id' AS es_id FROM sales_history WHERE metadata->>'easystore_order_id' IS NOT NULL")
    existing_ids = {e['es_id'] for e in existing if e.get('es_id')}
    print(f"  Already imported {len(existing_ids)} EasyStore orders previously")

    payloads = []
    refund_payloads = []
    skipped = 0
    voided = 0

    status_map = {
        'paid': 'Completed',
        'pending': 'Pending',
        'refunded': 'Refunded',
        'partially_refunded': 'Partially Refunded',
        'voided': 'Voided',
        'cancelled': 'Voided',
    }

    for o in orders:
        es_id = str(o.get('id'))
        if es_id in existing_ids:
            skipped += 1
            continue

        cust = o.get('customer') or {}
        cust_phone = norm_phone(cust.get('phone'))
        cust_name = cust.get('name') or f"{cust.get('first_name','')} {cust.get('last_name','')}".strip() or 'Walk-In'

        # Build items array
        items = []
        for li in o.get('line_items', []):
            items.append({
                'sku': (li.get('sku') or '').upper(),
                'name': li.get('product_name') or li.get('variant_name') or '(unnamed)',
                'qty': int(li.get('quantity') or 1),
                'price': float(li.get('price') or 0),
                'discount': float(li.get('total_discount') or 0)
            })

        total = float(o.get('total_price') or o.get('total_amount') or 0)
        fin = (o.get('financial_status') or '').lower()
        ful = (o.get('fulfillment_status') or '').lower()

        if fin == 'voided' or fin == 'cancelled':
            voided += 1

        # Payment method
        gateways = o.get('gateway_names') or []
        payment_method = ', '.join(gateways) if gateways else (o.get('payment_method') or 'Unknown')

        # Channel — EasyStore is a unified system; if creation_source='pos' → in-store, else web
        creation_source = (cust.get('creation_source') or '').lower()
        channel_name = 'EasyStore POS' if creation_source == 'pos' else 'EasyStore Online'

        # Staff — from order user_id or order metadata
        staff_name = None  # unknown — backfill later

        metadata = {
            'easystore_order_id': es_id,
            'easystore_order_number': o.get('order_number'),
            'easystore_token': o.get('token'),
            'easystore_processed_at': o.get('processed_at'),
            'easystore_currency': o.get('currency_code'),
            'easystore_customer_id': str(cust.get('id')) if cust.get('id') else None,
            'subtotal': float(o.get('subtotal_price') or 0),
            'shipping': float(o.get('total_shipping_fee') or o.get('total_shipping') or 0),
            'discount': float(o.get('total_discount') or 0),
            'tax': float(o.get('total_tax') or 0),
            'gateway_names': gateways,
            'fulfillment_status': ful,
            'migrated_from': 'easystore',
            'migrated_at': datetime.utcnow().isoformat()
        }
        metadata = {k: v for k, v in metadata.items() if v not in (None, '')}

        sale = {
            'customer_name': cust_name,
            'customer_phone': cust_phone,
            'payment_method': payment_method,
            'total': total,
            'total_amount': total,
            'items': items,
            'created_at': o.get('processed_at') or o.get('created_at'),
            'channel': channel_name,
            'status': status_map.get(fin, 'Completed'),
            'staff_name': staff_name,
            'metadata': metadata
        }
        sale = {k: v for k, v in sale.items() if v is not None}
        payloads.append(sale)

        # Refunds — if refunded, add a separate negative-total row
        refund_amt = float(o.get('total_refund_amount') or 0)
        if refund_amt > 0:
            refund_meta = {
                'easystore_order_id': es_id,
                'easystore_order_number': o.get('order_number'),
                'original_order_id': es_id,
                'refund_amount': refund_amt,
                'migrated_from': 'easystore',
                'migrated_at': datetime.utcnow().isoformat()
            }
            refund_payloads.append({
                'customer_name': cust_name,
                'customer_phone': cust_phone,
                'payment_method': payment_method,
                'total': -refund_amt,
                'total_amount': -refund_amt,
                'items': items,
                'created_at': o.get('processed_at'),
                'channel': channel_name,
                'status': 'Refund',
                'metadata': refund_meta
            })

    print(f"  Already imported (skipped): {skipped}")
    print(f"  New orders to insert: {len(payloads)} (incl {voided} voided/cancelled)")
    print(f"  Refund rows to add: {len(refund_payloads)}")

    if dry_run:
        print("  [dry-run] would insert", len(payloads) + len(refund_payloads), "rows")
        return

    cols_def = "customer_name text, customer_phone text, payment_method text, total numeric, total_amount numeric, items jsonb, created_at timestamptz, channel text, status text, staff_name text, metadata jsonb"
    col_names = "customer_name, customer_phone, payment_method, total, total_amount, items, created_at, channel, status, staff_name, metadata"

    def insert_batch(rows, label):
        if not rows: return 0
        ok = 0
        for chunk in chunked(rows, 50):
            payload = json.dumps(chunk, ensure_ascii=False, default=str).replace("'", "''")
            sql = (
                f"INSERT INTO public.sales_history ({col_names}) "
                f"SELECT {col_names} FROM jsonb_to_recordset('{payload}'::jsonb) "
                f"AS x({cols_def});"
            )
            try:
                sb_sql(sql)
                ok += len(chunk)
            except Exception as e:
                print(f"  {label} chunk failed: {e}")
        return ok

    inserted = insert_batch(payloads, "orders")
    refunds_inserted = insert_batch(refund_payloads, "refunds")
    print(f"  Inserted {inserted} orders + {refunds_inserted} refunds.")


# -----------------------------------------------------------------
# MAIN
# -----------------------------------------------------------------
def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--dry-run', action='store_true')
    parser.add_argument('--orders-only', action='store_true')
    parser.add_argument('--products-only', action='store_true')
    parser.add_argument('--customers-only', action='store_true')
    args = parser.parse_args()

    print(f"=== EasyStore → POS Sync · {'DRY-RUN' if args.dry_run else 'LIVE'} ===\n")
    t0 = time.time()

    do_all = not (args.orders_only or args.products_only or args.customers_only)

    if do_all or args.products_only:
        prods = fetch_easystore_products()
        migrate_products(prods, dry_run=args.dry_run)

    if do_all or args.customers_only:
        custs = fetch_easystore_customers()
        migrate_customers(custs, dry_run=args.dry_run)

    if do_all or args.orders_only:
        orders = fetch_easystore_orders()
        migrate_orders(orders, dry_run=args.dry_run)

    # Final summary
    print(f"\n=== Done in {time.time()-t0:.1f}s ===")
    if not args.dry_run:
        print("\n━━━ FINAL POS DB STATE ━━━")
        for q, label in [
            ("SELECT count(*)::int n FROM products_master", "products_master"),
            ("SELECT count(*)::int n FROM customers", "customers"),
            ("SELECT count(*)::int n FROM customers WHERE easystore_customer_id IS NOT NULL", "  with easystore_id"),
            ("SELECT count(*)::int n FROM sales_history", "sales_history"),
            ("SELECT count(*)::int n FROM sales_history WHERE metadata->>'migrated_from' = 'easystore'", "  from easystore"),
            ("SELECT count(*)::int n FROM sales_history WHERE total > 0 AND metadata->>'migrated_from' = 'easystore'", "  easystore sales (positive)"),
            ("SELECT round(sum(total)::numeric, 2) AS n FROM sales_history WHERE total > 0 AND metadata->>'migrated_from' = 'easystore'", "  easystore revenue"),
        ]:
            r = sb_sql(q)[0]['n']
            print(f"  {label:<35} {r}")


if __name__ == "__main__":
    main()
