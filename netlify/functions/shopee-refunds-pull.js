/**
 * shopee-refunds-pull.js — sedut order Shopee DIBATALKAN (CANCELLED, biasanya refunded)
 * ke returns_log sebagai entri type='cancel' (p1_529).
 *
 * Kenapa: Shopee get_return_list (returns RMA) balas KOSONG untuk 10 CAMP — 91 "Return/Refund/Cancel"
 * di Seller Centre majoriti CANCELLATION (order batal + refund oleh Shopee), bukan return fizikal.
 * Cancellation hidup dalam ORDER API (order_status=CANCELLED), bukan returns API. Fungsi ni tarik
 * order cancelled → returns_log supaya data refund/cancel masuk Returns page (Zaid pilih).
 *
 * Satu WINDOW (<=15 hari) per panggilan (elak timeout) — orchestrate loop dari luar.
 * Query:
 *   ?mode=dryrun (default) — fetch + map, NO write, pulang summary + sample.
 *   ?mode=import           — insert baris baru (dedup ikut external_id `shopee_cancel:${order_sn}:${sku}`).
 *   ?from=YYYY-MM-DD&to=YYYY-MM-DD — window create_time (default 15 hari lalu → sekarang).
 *
 * Public URL: https://www.10camp.com/api/shopee-refunds-pull
 */

const crypto = require('crypto');

const PARTNER_ID   = process.env.SHOPEE_PARTNER_ID || '';
const PARTNER_KEY  = process.env.SHOPEE_PARTNER_KEY || '';
const ENV          = (process.env.SHOPEE_ENV || 'sandbox').toLowerCase();
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://asehjdnfzoypbwfeazra.supabase.co';
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY || '';
const HOST = ENV === 'live' ? 'https://partner.shopeemobile.com' : 'https://openplatform.sandbox.test-stable.shopee.sg';

function json(s, o) { return { statusCode: s, headers: { 'Content-Type': 'application/json; charset=utf-8' }, body: JSON.stringify(o, null, 2) }; }
async function sb(method, path, body, extra) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
        method, headers: Object.assign({ apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' }, extra || {}),
        body: body ? JSON.stringify(body) : undefined
    });
    const t = await res.text();
    if (!res.ok) throw new Error(`Supabase ${res.status}: ${t.slice(0, 200)}`);
    return t ? JSON.parse(t) : null;
}
function signShop(path, ts, token, shopId) { return crypto.createHmac('sha256', PARTNER_KEY).update(`${PARTNER_ID}${path}${ts}${token}${shopId}`).digest('hex'); }
function signPublic(path, ts) { return crypto.createHmac('sha256', PARTNER_KEY).update(`${PARTNER_ID}${path}${ts}`).digest('hex'); }
async function shopeeGet(path, q, token, shopId) {
    const ts = Math.floor(Date.now() / 1000);
    const all = Object.assign({ partner_id: PARTNER_ID, timestamp: ts, access_token: token, shop_id: shopId, sign: signShop(path, ts, token, shopId) }, q || {});
    const qs = Object.entries(all).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
    return (await fetch(`${HOST}${path}?${qs}`, { method: 'GET' })).json();
}
async function getValidToken() {
    const rows = await sb('GET', `/shopee_tokens?environment=eq.${ENV}&order=created_at.desc&limit=1`);
    if (!rows || !rows.length) throw new Error(`No Shopee token for ${ENV}`);
    let tok = rows[0];
    if (new Date(tok.access_token_expire_at).getTime() - Date.now() < 60 * 60 * 1000) {
        const path = '/api/v2/auth/access_token/get'; const ts = Math.floor(Date.now() / 1000);
        const url = `${HOST}${path}?partner_id=${PARTNER_ID}&timestamp=${ts}&sign=${signPublic(path, ts)}`;
        const j = await (await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh_token: tok.refresh_token, shop_id: Number(tok.shop_id), partner_id: Number(PARTNER_ID) }) })).json();
        if (j.error || !j.access_token) throw new Error(`Token refresh failed: ${j.message || j.error}`);
        const patch = { access_token: j.access_token, access_token_expire_at: new Date(Date.now() + (Number(j.expire_in || 14400) * 1000)).toISOString(), refresh_token: j.refresh_token || tok.refresh_token, updated_at: new Date().toISOString() };
        await sb('PATCH', `/shopee_tokens?shop_id=eq.${tok.shop_id}`, patch, { Prefer: 'return=minimal' });
        tok = Object.assign(tok, patch);
    }
    return tok;
}
function chunk(a, n) { const o = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; }

exports.handler = async (event) => {
    if (!PARTNER_ID || !PARTNER_KEY) return json(500, { error: 'SHOPEE creds not set' });
    if (!SERVICE_KEY) return json(500, { error: 'SUPABASE_SERVICE_KEY not set' });
    // Scheduled invocation (cron harian) tiada queryStringParameters → auto import 15 hari lalu.
    const isScheduled = !event.queryStringParameters;
    const p = event.queryStringParameters || {};
    const mode = isScheduled ? 'import' : (p.mode === 'import' ? 'import' : 'dryrun');
    const toSec = p.to ? Math.floor(Date.parse(p.to) / 1000) : Math.floor(Date.now() / 1000);
    const fromSec = p.from ? Math.floor(Date.parse(p.from) / 1000) : (toSec - 15 * 24 * 3600);
    if (isNaN(fromSec) || isNaN(toSec)) return json(400, { error: 'invalid from/to (YYYY-MM-DD)' });
    if (toSec - fromSec > 15 * 24 * 3600 + 60) return json(400, { error: 'window max 15 hari per panggilan (Shopee cap)' });

    const out = { mode, from: new Date(fromSec * 1000).toISOString(), to: new Date(toSec * 1000).toISOString() };
    try {
        const tok = await getValidToken();
        out.shop_id = tok.shop_id;

        // 1. List CANCELLED order sns dalam window
        const sns = []; let cursor = '', guard = 0;
        do {
            const q = { time_range_field: 'create_time', time_from: fromSec, time_to: toSec, page_size: 100, order_status: 'CANCELLED' };
            if (cursor) q.cursor = cursor;
            const r = await shopeeGet('/api/v2/order/get_order_list', q, tok.access_token, tok.shop_id);
            if (r.error) { out.error = `get_order_list: ${r.message || r.error}`; return json(502, out); }
            for (const o of ((r.response && r.response.order_list) || [])) sns.push(o.order_sn);
            cursor = (r.response && r.response.next_cursor) || '';
            if (!(r.response && r.response.more)) break;
        } while (cursor && ++guard < 30);
        out.cancelled_orders = sns.length;
        if (!sns.length) { out.note = 'Tiada order cancelled dalam window ni.'; return json(200, out); }

        // 2. Order detail batches
        const fields = 'item_list,total_amount,currency,order_status,create_time,update_time,cancel_reason,buyer_username,pay_time';
        const orders = [];
        for (const b of chunk(sns, 50)) {
            const r = await shopeeGet('/api/v2/order/get_order_detail', { order_sn_list: b.join(','), response_optional_fields: fields }, tok.access_token, tok.shop_id);
            if (r.error) { out.error = `get_order_detail: ${r.message || r.error}`; return json(502, out); }
            for (const o of ((r.response && r.response.order_list) || [])) orders.push(o);
        }

        // 3. Map → returns_log rows (satu baris per item)
        const rows = [];
        let skippedUnpaid = 0;
        for (const o of orders) {
            // p1_576 (#17) — banyak order CANCELLED dibatal SEBELUM bayar (buyer cancel / auto-cancel unpaid).
            // Itu bukan refund (takde duit, takde stok bergerak) — jangan kira sebagai loss.
            if (!o.pay_time || Number(o.pay_time) <= 0) { skippedUnpaid++; continue; }
            const total = Number(o.total_amount || 0);
            const reason = (o.cancel_reason || 'Cancelled / refund').toString().slice(0, 100);
            const items = o.item_list || [];
            if (items.length) {
                items.forEach((it, i) => {
                    const sku = String(it.model_sku || it.item_sku || '').toUpperCase().trim();
                    rows.push({
                        sku, product_name: (it.item_name || '').slice(0, 200),
                        qty: Number(it.model_quantity_purchased || it.quantity_purchased || 1) || 1,
                        type: 'cancel', reason,
                        notes: `Auto Shopee · order ${o.order_sn} · CANCELLED · refund order RM${total.toFixed(2)}`,
                        channel: 'Shopee', supplier: '', cost_impact: 0,
                        order_ref: String(o.order_sn),
                        reported_by_id: 'system', reported_by_name: 'Auto-Sedut',
                        reported_at: o.create_time ? new Date(Number(o.create_time) * 1000).toISOString() : new Date().toISOString(),
                        source: 'shopee', external_id: `shopee_cancel:${o.order_sn}:${sku || ('idx' + i)}`
                    });
                });
            }
        }
        out.mapped = rows.length;
        out.skipped_unpaid = skippedUnpaid;
        if (!rows.length) { out.note = 'Tiada cancel BERBAYAR (semua belum-bayar atau tiada item).'; return json(200, out); }

        // 4. Isi cost_impact dari products_master
        try {
            const skus = [...new Set(rows.map(r => r.sku).filter(Boolean))];
            const costMap = {};
            for (const b of chunk(skus, 100)) {
                const list = b.map(s => `"${s.replace(/"/g, '')}"`).join(',');
                const pm = await sb('GET', `/products_master?select=sku,cost_price&sku=in.(${list})`);
                (pm || []).forEach(x => { costMap[(x.sku || '').toUpperCase()] = Number(x.cost_price || 0); });
            }
            rows.forEach(r => { if (costMap[r.sku] != null) r.cost_impact = costMap[r.sku]; });
        } catch (e) { out.cost_lookup_error = String(e.message || e); }

        // 5. Dedup ikut (source, external_id) — selaras dengan unique constraint uq_returns_source_ext (#31)
        const extIds = rows.map(r => r.external_id);
        const seen = new Set();
        for (const b of chunk(extIds, 150)) {
            const list = b.map(s => `"${s.replace(/"/g, '')}"`).join(',');
            const ex = await sb('GET', `/returns_log?select=source,external_id&external_id=in.(${list})`);
            (ex || []).forEach(r => { if (r.external_id) seen.add((r.source || '') + '|' + r.external_id); });
        }
        const local = new Set();
        const fresh = rows.filter(r => { const k = (r.source || '') + '|' + r.external_id; if (seen.has(k) || local.has(k)) return false; local.add(k); return true; });
        out.already_logged = rows.length - fresh.length;
        out.new = fresh.length;

        if (mode === 'dryrun') { out.sample = fresh.slice(0, 5); out.note = 'DRYRUN — tambah ?mode=import untuk simpan.'; return json(200, out); }

        let inserted = 0;
        for (const b of chunk(fresh, 100)) {
            if (!b.length) continue;
            // p1_576 (#5) — on_conflict + ignore-duplicates: 1 baris duplikat TAK abort seluruh batch (dulu boleh buang ~99 baris elok)
            try { await sb('POST', '/returns_log?on_conflict=source,external_id', b, { Prefer: 'return=minimal,resolution=ignore-duplicates' }); inserted += b.length; }
            catch (e) { (out.errors = out.errors || []).push(String(e.message || e).slice(0, 120)); }
        }
        out.inserted = inserted; out.ok = true;
        return json(200, out);
    } catch (err) { out.error = String(err); return json(500, out); }
};
