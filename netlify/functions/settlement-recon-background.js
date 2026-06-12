/**
 * settlement-recon-background.js — Integration hardening #8 (p1_681).
 *
 * Reconciles POS marketplace orders against the marketplace's actual settlement
 * (payout) data, so we catch orders we SOLD but were never PAID for.
 *
 * Data reality (2026-06-12): only recent direct-API-synced orders carry the
 * marketplace order id in sales_history.metadata (shopee_order_sn / tiktok_order_id).
 * Older EasyStore-migrated orders have none, so they CANNOT be matched — we report
 * how many were skipped (no silent coverage gaps).
 *
 * Settlement sources (existing endpoints, reused via internal fetch):
 *   Shopee : /api/shopee-sync?mode=escrow   → rows[{order_sn, gross, net_payout, ...}]
 *   TikTok : /api/tiktok-finance?mode=rows   → rows[{order_id, gross, net_payout, ...}]
 *            (grouped by order_id: refund/adjustment lines summed → net per order)
 *
 * Flags (high-signal only; amount-compare dropped — POS total ≠ settlement revenue
 * by definition due to platform discounts/shipping):
 *   belum_settle — order completed > GRACE_DAYS ago, has id, NO settlement = maybe unpaid
 *   rugi         — settled but net_payout <= 0 (fees/refunds ate the whole order)
 *
 * Modes: ?mode=peek (compute + return, NO write) · ?mode=sync (replace settlement_recon).
 * ?days=N window (default 45). Cron-triggered daily.
 */

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://asehjdnfzoypbwfeazra.supabase.co';
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY || '';
const SITE_URL     = process.env.URL || 'https://www.10camp.com';

const GRACE_DAYS = 14;          // settlements take ~7–14 days; only flag older unsettled orders
const COMPLETED  = new Set(['Completed', 'Processing', 'To Fulfil']); // states that should eventually settle

function json(code, obj) {
    return { statusCode: code, headers: { 'Content-Type': 'application/json; charset=utf-8' }, body: JSON.stringify(obj, null, 2) };
}
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
    const res = await fetch(url);
    const t = await res.text();
    try { return JSON.parse(t); } catch (_) { throw new Error(`non-JSON from ${url.split('?')[0]} (HTTP ${res.status})`); }
}
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const ymd = (d) => new Date(d).toISOString().slice(0, 10);

exports.handler = async (event) => {
    const p = (event && event.queryStringParameters) || {};
    const mode = p.mode === 'peek' ? 'peek' : 'sync';  // cron (no param) → sync/write; peek = explicit test
    const days = Math.min(Math.max(parseInt(p.days || '45', 10) || 45, 7), 120);
    const sinceMs = Date.now() - days * 24 * 60 * 60 * 1000;
    const sinceIso = new Date(sinceMs).toISOString();
    const sinceYmd = ymd(sinceMs);
    const cutoffMs = Date.now() - GRACE_DAYS * 24 * 60 * 60 * 1000;
    const out = { mode, days, since: sinceYmd };

    // 1. POS marketplace orders in window
    let posRows = [];
    try {
        posRows = await sb('GET', `/sales_history?select=total_amount,created_at,channel,status,metadata&created_at=gte.${encodeURIComponent(sinceIso)}&channel=in.(Shopee,TikTok%20Shop,TikTok)&limit=10000`) || [];
    } catch (e) { return json(500, Object.assign(out, { error: 'pos load: ' + e.message })); }

    // index POS orders by channel + marketplace id; count those with no id (unmatchable)
    const pos = { Shopee: {}, TikTok: {} };
    const skipNoId = { Shopee: 0, TikTok: 0 };
    const posCount = { Shopee: 0, TikTok: 0 };
    for (const r of posRows) {
        const md = r.metadata || {};
        const isTT = /tiktok/i.test(r.channel);
        const ch = isTT ? 'TikTok' : 'Shopee';
        posCount[ch]++;
        const oid = isTT ? (md.tiktok_order_id || '') : (md.shopee_order_sn || '');
        if (!oid) { skipNoId[ch]++; continue; }
        pos[ch][String(oid)] = { gross: round2(r.total_amount), date: r.created_at, status: r.status };
    }

    // 2. Settlements (best-effort per channel — one failing must not kill the other)
    const settle = { Shopee: {}, TikTok: {} };
    const settleMeta = { Shopee: { ok: false }, TikTok: { ok: false } };
    try {
        const j = await fetchJson(`${SITE_URL}/api/shopee-sync?mode=escrow&since=${sinceYmd}`);
        for (const row of (j.rows || [])) {
            if (!row.order_sn) continue;
            settle.Shopee[String(row.order_sn)] = { gross: round2(row.gross), net: round2(row.net_payout), date: row.order_date };
        }
        settleMeta.Shopee = { ok: true, count: Object.keys(settle.Shopee).length };
    } catch (e) { settleMeta.Shopee = { ok: false, error: e.message }; }
    try {
        const j = await fetchJson(`${SITE_URL}/api/tiktok-finance?mode=rows&from=${sinceYmd}&to=${ymd(Date.now())}`);
        // group transaction rows by order_id (sale + refund lines net out)
        for (const row of (j.rows || [])) {
            const oid = String(row.order_id || '');
            if (!oid) continue;
            const g = settle.TikTok[oid] || (settle.TikTok[oid] = { gross: 0, net: 0, date: row.order_date });
            g.gross = round2(g.gross + (Number(row.gross) || 0));
            g.net = round2(g.net + (Number(row.net_payout) || 0));
            if (row.order_date && (!g.date || row.order_date < g.date)) g.date = row.order_date;
        }
        settleMeta.TikTok = { ok: true, count: Object.keys(settle.TikTok).length };
    } catch (e) { settleMeta.TikTok = { ok: false, error: e.message }; }

    // 3. Reconcile (POS-order driven; only orders that carry an id)
    const findings = [];
    const summary = {};
    for (const ch of ['Shopee', 'TikTok']) {
        let matched = 0, belum = 0, rugi = 0;
        // skip flagging "unpaid" if we couldn't load that channel's settlements at all (avoid false alarms)
        const haveSettle = settleMeta[ch].ok;
        for (const [oid, o] of Object.entries(pos[ch])) {
            const s = settle[ch][oid];
            if (s) {
                matched++;
                if (s.net <= 0) {
                    rugi++;
                    findings.push({ order_sn: oid, channel: ch, flag: 'rugi', pos_gross: o.gross, settle_gross: s.gross, net_payout: s.net, order_date: s.date || ymd(o.date), detail: `Net payout RM${s.net} (≤0) — yuran/refund makan habis jualan RM${o.gross}` });
                }
            } else if (haveSettle && COMPLETED.has(o.status) && new Date(o.date).getTime() < cutoffMs) {
                belum++;
                findings.push({ order_sn: oid, channel: ch, flag: 'belum_settle', pos_gross: o.gross, settle_gross: null, net_payout: null, order_date: ymd(o.date), detail: `Order ${o.status} ${ymd(o.date)} (>${GRACE_DAYS} hari) tapi TIADA settlement — kemungkinan belum/tak dibayar` });
            }
        }
        summary[ch] = { pos_orders: posCount[ch], with_id: Object.keys(pos[ch]).length, skipped_no_id: skipNoId[ch], settlements: settleMeta[ch].ok ? settleMeta[ch].count : 'load_failed', matched, belum_settle: belum, rugi };
    }
    out.summary = summary;
    out.findings_count = findings.length;

    if (mode === 'peek') {
        out.sample = findings.slice(0, 25);
        out.note = 'PEEK — no DB write. skipped_no_id = orders without a marketplace id (EasyStore-migrated; unmatchable).';
        return json(200, out);
    }

    // 4. sync — replace the table
    try {
        await sb('DELETE', '/settlement_recon?id=gt.0', null, { Prefer: 'return=minimal' });
        const now = new Date().toISOString();
        const rows = findings.map(f => Object.assign({}, f, { checked_at: now }));
        for (let i = 0; i < rows.length; i += 200) {
            await sb('POST', '/settlement_recon', rows.slice(i, i + 200), { Prefer: 'return=minimal' });
        }
        out.written = rows.length;
        out.checked_at = now;
    } catch (e) { out.write_error = e.message; }
    return json(200, out);
};
