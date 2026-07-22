/**
 * marketplace-payouts-cron.js — LEJAR PAYOUT PER-ORDER (p1_1182, Fasa 2 Laporan TODAK).
 * Tarik duit-masuk sebenar setiap order dari:
 *   TikTok : /api/tiktok-finance?mode=rows (statement lines — SUM ikut order_id,
 *            sebab refund/adjustment = line berasingan atas order sama)
 *   Shopee : /api/shopee-sync?mode=escrow (per-order; API had 15 hari/panggilan —
 *            loop tetingkap 15 hari)
 * Upsert ke marketplace_payouts (order_sn PK) — Laporan TODAK guna utk remarks
 * "Tiktok RM <payout>, SHORT/EXTRA RM <beza>" tanpa Aliff kira manual.
 * BACKGROUND function (suffix -background = had 15 minit; sync function timeout
 * pada 90 hari — Shopee escrow per-order lambat; HTTP invoke pulang 202 serta-merta,
 * verify hasil via count marketplace_payouts). Cron harian 02:45 UTC (10:45 MYT).
 * ?days=N (7-90, default 21) · ?dry=1 preview (berguna hanya utk invoke terus).
 */
const { requireAuth, internalHeaders } = require('./_auth');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://asehjdnfzoypbwfeazra.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || '';
const SITE_URL = process.env.URL || 'https://www.10camp.com';

const ymd = (ms) => new Date(ms).toISOString().slice(0, 10);
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

async function sb(method, path, body, extraHeaders) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
        method,
        headers: Object.assign({ apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' }, extraHeaders || {}),
        body: body ? JSON.stringify(body) : undefined
    });
    const t = await res.text();
    if (!res.ok) throw new Error(`Supabase ${res.status}: ${t.slice(0, 200)}`);
    return t ? JSON.parse(t) : null;
}
async function fetchJson(url) {
    const res = await fetch(url, { headers: internalHeaders() });
    const t = await res.text();
    try { return JSON.parse(t); } catch (_) { throw new Error(`non-JSON from ${url.split('?')[0]} (HTTP ${res.status})`); }
}

exports.handler = async (event) => {
    const a = await requireAuth(event); if (!a.ok) return a.response;
    if (!SERVICE_KEY) return { statusCode: 500, body: 'SUPABASE_SERVICE_KEY not set' };
    const p = (event && event.queryStringParameters) || {};
    const dry = !!p.dry;
    const days = Math.min(Math.max(parseInt(p.days || '21', 10) || 21, 7), 90);
    const sinceMs = Date.now() - days * 24 * 3600e3;
    const out = { dry, days, tiktok: { lines: 0, orders: 0, err: null }, shopee: { orders: 0, windows: 0, err: null }, upserted: 0 };
    const ledger = {}; // order_sn -> { channel, gross, net_payout, order_date }

    // 1) TikTok — bulk statement lines, SUM per order_id
    try {
        const j = await fetchJson(`${SITE_URL}/api/tiktok-finance?mode=rows&from=${ymd(sinceMs)}&to=${ymd(Date.now() + 24 * 3600e3)}`);
        for (const r of (j.rows || [])) {
            const oid = String(r.order_id || '').trim();
            if (!oid) continue;
            out.tiktok.lines++;
            const slot = ledger[oid] = ledger[oid] || { channel: 'TikTok', gross: 0, net_payout: 0, order_date: r.order_date || null };
            slot.gross = round2(slot.gross + (Number(r.gross) || 0));
            slot.net_payout = round2(slot.net_payout + (Number(r.net_payout) || 0));
            if (r.order_date && (!slot.order_date || r.order_date < slot.order_date)) slot.order_date = r.order_date;
        }
        out.tiktok.orders = Object.keys(ledger).length;
    } catch (e) { out.tiktok.err = String(e.message || e).slice(0, 150); }

    // 2) Shopee — escrow per-order, tetingkap 15 hari
    try {
        let cursor = sinceMs;
        while (cursor < Date.now()) {
            const to = Math.min(cursor + 15 * 24 * 3600e3, Date.now());
            out.shopee.windows++;
            const j = await fetchJson(`${SITE_URL}/api/shopee-sync?mode=escrow&from=${ymd(cursor)}&to=${ymd(to)}`);
            for (const r of (j.rows || [])) {
                if (!r.order_sn || r.error) continue;
                out.shopee.orders++;
                ledger[String(r.order_sn)] = {
                    channel: 'Shopee',
                    gross: round2(r.gross),
                    net_payout: round2(r.net_payout),
                    order_date: r.order_date || null
                };
            }
            cursor = to;
            if (out.shopee.windows >= 7) break; // pagar keselamatan
        }
    } catch (e) { out.shopee.err = String(e.message || e).slice(0, 150); }

    const rows = Object.keys(ledger).map(sn => Object.assign({ order_sn: sn, updated_at: new Date().toISOString() }, ledger[sn]));
    out.total_orders = rows.length;
    if (dry) return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(out) };

    // 3) Upsert berkelompok 200
    for (let i = 0; i < rows.length; i += 200) {
        await sb('POST', '/marketplace_payouts?on_conflict=order_sn', rows.slice(i, i + 200),
            { Prefer: 'resolution=merge-duplicates,return=minimal' });
        out.upserted += Math.min(200, rows.length - i);
    }
    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(out) };
};
