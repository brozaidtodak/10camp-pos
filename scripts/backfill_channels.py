#!/usr/bin/env python3
"""
One-off backfill — re-tag sales_history.channel from EasyStore order.source_name.

Before p3_1 the sync collapsed every online order into "EasyStore Online".
This script walks every EasyStore order, maps source_name → proper channel
label (TikTok Shop / Shopee / POS Cashier / Web EasyStore), and UPDATEs the
matching sales_history rows (keyed on metadata.easystore_order_id).

Usage:
   source ~/.claude/.env
   python3 scripts/backfill_channels.py [--dry-run]

Idempotent — safe to re-run.
"""
import os, sys, json, time, urllib.request, urllib.error

DRY_RUN = '--dry-run' in sys.argv

EASYSTORE_BASE  = "https://www.10camp.com/api/3.0"
EASYSTORE_TOKEN = os.environ.get("EASYSTORE_TOKEN")
SUPABASE_REF    = "asehjdnfzoypbwfeazra"
SUPABASE_TOKEN  = os.environ.get("SUPABASE_ACCESS_TOKEN")
SUPABASE_API    = f"https://api.supabase.com/v1/projects/{SUPABASE_REF}/database/query"
PAGE_LIMIT      = 50

if not EASYSTORE_TOKEN: sys.exit("EASYSTORE_TOKEN not set; source ~/.claude/.env first")
if not SUPABASE_TOKEN:  sys.exit("SUPABASE_ACCESS_TOKEN not set; source ~/.claude/.env first")


def map_channel(source_name):
    """EasyStore order.source_name → human channel label (matches easystore_sync.py)."""
    s = (source_name or '').lower().strip()
    if not s:
        return 'Web EasyStore'
    if 'tiktok' in s: return 'TikTok Shop'
    if 'shopee' in s: return 'Shopee'
    if 'lazada' in s: return 'Lazada'
    if s == 'pos':    return 'POS Cashier'
    if s in ('sf', 'online_store') or 'store' in s: return 'Web EasyStore'
    return s.replace('-', ' ').replace('_', ' ').title()


def es_get(path):
    req = urllib.request.Request(
        f"{EASYSTORE_BASE}{path}",
        headers={"EasyStore-Access-Token": EASYSTORE_TOKEN, "Content-Type": "application/json"}
    )
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read())


def sb_sql(sql):
    req = urllib.request.Request(
        SUPABASE_API,
        data=json.dumps({"query": sql}).encode(),
        headers={"Authorization": f"Bearer {SUPABASE_TOKEN}",
                 "Content-Type": "application/json",
                 "User-Agent": "10camp-channel-backfill/1.0"},
        method="POST"
    )
    with urllib.request.urlopen(req, timeout=180) as r:
        return json.loads(r.read())


def js(s):
    return str(s).replace("'", "''")


def chunked(lst, n):
    for i in range(0, len(lst), n):
        yield lst[i:i+n]


def main():
    print("Fetching EasyStore orders...")
    pairs = []          # (easystore_order_id, channel_label)
    page = 1
    page_count = None
    # NOTE: EasyStore API clamps pages beyond the last — it repeats the final
    # page instead of returning []. Must terminate on response.page_count,
    # never on "empty page" (that condition never triggers).
    while True:
        try:
            data = es_get(f"/orders.json?page={page}&limit={PAGE_LIMIT}")
        except urllib.error.HTTPError as e:
            if e.code == 429:
                print("  [rate-limited, waiting 5s...]"); time.sleep(5); continue
            print(f"  page {page} HTTP {e.code} — stopping"); break
        orders = data.get("orders", [])
        if page_count is None:
            page_count = data.get("page_count", 0)
            print(f"  Total orders: {data.get('total_count', '?')} ({page_count} pages)")
        for o in orders:
            oid = str(o.get("id"))
            ch = map_channel(o.get("source_name") or o.get("source_type"))
            pairs.append((oid, ch))
        if not orders or page >= page_count:
            break
        page += 1
        time.sleep(0.4)
    print(f"  -> {len(pairs)} orders fetched")

    # Summary by channel
    tally = {}
    for _, ch in pairs:
        tally[ch] = tally.get(ch, 0) + 1
    print("  Channel breakdown:")
    for ch, c in sorted(tally.items(), key=lambda x: -x[1]):
        print(f"    {c:5d}  {ch}")

    if DRY_RUN:
        print(f"\n[dry-run] would UPDATE channel on up to {len(pairs)} sales_history rows")
        return

    print("\nUpdating sales_history.channel...")
    total_changed = 0
    for chunk in chunked(pairs, 200):
        values = ", ".join(f"('{js(oid)}', '{js(ch)}')" for oid, ch in chunk)
        sql = (
            "UPDATE public.sales_history s SET channel = v.ch "
            f"FROM (VALUES {values}) AS v(oid, ch) "
            "WHERE s.metadata->>'easystore_order_id' = v.oid "
            "AND s.channel IS DISTINCT FROM v.ch;"
        )
        res = sb_sql(sql)
        # Management API returns [] for UPDATE; count via follow-up not needed
        time.sleep(0.3)
    # Verify final state
    check = sb_sql(
        "SELECT channel, count(*) AS n FROM public.sales_history "
        "WHERE metadata ? 'easystore_order_id' GROUP BY channel ORDER BY n DESC;"
    )
    print("  Post-backfill channel distribution (EasyStore-origin rows):")
    for row in check:
        print(f"    {row['n']:5d}  {row['channel']}")
    print("\nDone.")


if __name__ == "__main__":
    main()
