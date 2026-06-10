/**
 * Marketplace Stock Reconcile Cron — Netlify Scheduled Function (p1_293).
 *
 * Pushes POS stock → Shopee + TikTok on a schedule so every channel stays in
 * sync regardless of WHERE the stock changed (counter sale, online order on a
 * different channel, GRN/stock receive, manual adjustment, stocktake).
 *
 * This replaces EasyStore's old role as the central cross-channel stock hub —
 * required for the full Shopee/TikTok cutover (EasyStore out of the loop).
 * POS inventory_batches is the single source of truth; marketplaces follow.
 *
 * Per-sale pushes (tiktok-stock-push / shopee-stock-push) give instant updates;
 * this cron is the safety net that catches everything else + heals drift.
 *
 * Each underlying function only WRITES diffs (POS != marketplace), so writes
 * stay minimal even though it reconciles the full mapped catalog each run.
 */

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://asehjdnfzoypbwfeazra.supabase.co';
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY || '';
const SITE_URL     = process.env.URL || 'https://www.10camp.com';

async function logRun(table, row) {
    try {
        await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
            method: 'POST',
            headers: {
                apikey: SERVICE_KEY,
                Authorization: `Bearer ${SERVICE_KEY}`,
                'Content-Type': 'application/json',
                Prefer: 'return=minimal'
            },
            body: JSON.stringify(row)
        });
    } catch (e) { /* silent */ }
}

async function reconcile(name, url) {
    const startMs = Date.now();
    try {
        const res = await fetch(url);
        const json = await res.json();
        return {
            name, ok: !json.error,
            pushed: json.pushed || 0,
            failed: json.failed || 0,
            error: json.error || null,
            next_offset: (json.next_offset === undefined ? null : json.next_offset),
            total_items: json.total_items,
            duration_ms: Date.now() - startMs
        };
    } catch (e) {
        return { name, ok: false, error: String(e).slice(0, 300), duration_ms: Date.now() - startMs };
    }
}

// p1_523 — baca cursor offset Shopee terakhir dari log supaya cron PUSING seluruh katalog
// (370 item / 100 setiap run = 4 run sepusing). next_offset null = dah habis → mula balik 0.
async function lastShopeeOffset() {
    try {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/shopee_sync_log?source=eq.stock-cron&order=ran_at.desc&limit=1&select=raw_response`, {
            headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` }
        });
        const rows = await res.json();
        const no = rows && rows[0] && rows[0].raw_response && rows[0].raw_response.next_offset;
        return (typeof no === 'number' && no > 0) ? no : 0;
    } catch (e) { return 0; }
}

exports.handler = async () => {
    const ranAt = new Date().toISOString();

    const offset = await lastShopeeOffset();

    // Run both reconciles. Shopee paginates with ?limit + ?offset (cursor di log); TikTok pulls all.
    // p1_528 — limit 100 TIMEOUT (40s, 0 push, offset stuck). 40 selamat (terbukti ~siap dlm had).
    // 370 item / 40 = ~10 run sepusing (every 20 min ≈ 3.3 jam) — ok utk heal drift.
    const [shopee, tiktok] = await Promise.all([
        reconcile('shopee', `${SITE_URL}/api/shopee-stock-sync?mode=push&limit=40&offset=${offset}`),
        reconcile('tiktok', `${SITE_URL}/api/tiktok-stock-sync?mode=push`)
    ]);

    // p1_576 (#18) — kalau Shopee GAGAL/timeout, KEKALKAN offset (retry page sama next run).
    // Dulu next_offset jadi null bila error → lastShopeeOffset baca null → reset ke 0 → hilang
    // semua progress paging (re-push 40 item pertama selama-lamanya, page lain tak pernah sync).
    const persistOffset = shopee.ok ? shopee.next_offset : offset;
    await logRun('shopee_sync_log', {
        source: 'stock-cron', mode: 'push', ran_at: ranAt,
        error_message: shopee.error ? String(shopee.error).slice(0, 500) : null,
        duration_ms: shopee.duration_ms,
        raw_response: { pushed: shopee.pushed, failed: shopee.failed, offset_used: offset, next_offset: persistOffset, total_items: shopee.total_items }
    });
    await logRun('tiktok_sync_log', {
        source: 'stock-cron', mode: 'push', ran_at: ranAt,
        error_message: tiktok.error ? String(tiktok.error).slice(0, 500) : null,
        duration_ms: tiktok.duration_ms,
        raw_response: { pushed: tiktok.pushed, failed: tiktok.failed }
    });

    return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ran_at: ranAt, shopee, tiktok })
    };
};
