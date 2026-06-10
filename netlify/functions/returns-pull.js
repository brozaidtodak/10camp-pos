/**
 * returns-pull.js — sedut returns/refunds dari Shopee + TikTok ke returns_log (p1_504).
 *
 * Returns page (renderReturnsLog) sebelum ni manual-log sahaja. Ni auto-pull
 * customer returns/refunds dari dua marketplace yang LIVE (Shopee + TikTok).
 * EasyStore DILANGKAU — API dah mati (404, domain serve site kita) + dah cutover keluar.
 *
 * Dedup: setiap baris returns_log dapat (source, external_id) di mana
 *   external_id = `${return_id}:${sku}`. Partial unique index uq_returns_source_ext
 *   pastikan pull berulang takkan double. Manual entries (external_id NULL) tak terkesan.
 *
 * Query:
 *   ?mode=dryrun (default) — fetch + map, NO write, pulangkan summary + sample + raw_sample.
 *   ?mode=import           — insert baris baru sahaja (deduped).
 *   ?since=YYYY-MM-DD      — returns dicipta on/after tarikh ni (default 15 hari lalu).
 *   ?channel=shopee|tiktok — hadkan ke satu channel (default kedua-dua).
 *
 * Public URL: https://www.10camp.com/api/returns-pull
 */

const crypto = require('crypto');

// ---- env ----
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://asehjdnfzoypbwfeazra.supabase.co';
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY || '';
// Shopee
const SP_PARTNER_ID  = process.env.SHOPEE_PARTNER_ID || '';
const SP_PARTNER_KEY = process.env.SHOPEE_PARTNER_KEY || '';
const SP_ENV         = (process.env.SHOPEE_ENV || 'sandbox').toLowerCase();
const SP_HOST = SP_ENV === 'live'
    ? 'https://partner.shopeemobile.com'
    : 'https://openplatform.sandbox.test-stable.shopee.sg';
// TikTok
const TT_APP_KEY    = process.env.TIKTOK_APP_KEY || '';
const TT_APP_SECRET = process.env.TIKTOK_APP_SECRET || '';
const TT_API_BASE   = 'https://open-api.tiktokglobalshop.com';
const TT_TOKEN_BASE = 'https://auth.tiktok-shops.com/api/v2/token';
const TT_VERSION    = '202309';

function json(statusCode, obj) {
    return { statusCode, headers: { 'Content-Type': 'application/json; charset=utf-8' }, body: JSON.stringify(obj, null, 2) };
}

// ---- Supabase (service-role) ----
async function sb(method, path, body, extraHeaders) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
        method,
        headers: Object.assign({
            apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json'
        }, extraHeaders || {}),
        body: body ? JSON.stringify(body) : undefined
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`Supabase ${res.status}: ${text.slice(0, 300)}`);
    return text ? JSON.parse(text) : null;
}

function chunk(arr, n) { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; }

// ============================ SHOPEE ============================
function spSignShop(path, ts, token, shopId) {
    return crypto.createHmac('sha256', SP_PARTNER_KEY).update(`${SP_PARTNER_ID}${path}${ts}${token}${shopId}`).digest('hex');
}
function spSignPublic(path, ts) {
    return crypto.createHmac('sha256', SP_PARTNER_KEY).update(`${SP_PARTNER_ID}${path}${ts}`).digest('hex');
}
async function spGet(path, extraQuery, token, shopId) {
    const ts = Math.floor(Date.now() / 1000);
    const q = Object.assign({ partner_id: SP_PARTNER_ID, timestamp: ts, access_token: token, shop_id: shopId, sign: spSignShop(path, ts, token, shopId) }, extraQuery || {});
    const qs = Object.entries(q).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
    const res = await fetch(`${SP_HOST}${path}?${qs}`, { method: 'GET' });
    return res.json();
}
async function spGetValidToken() {
    const rows = await sb('GET', `/shopee_tokens?environment=eq.${SP_ENV}&order=created_at.desc&limit=1`);
    if (!rows || !rows.length) throw new Error(`No Shopee token for ${SP_ENV}`);
    let tok = rows[0];
    if (new Date(tok.access_token_expire_at).getTime() - Date.now() < 60 * 60 * 1000) {
        const path = '/api/v2/auth/access_token/get';
        const ts = Math.floor(Date.now() / 1000);
        const url = `${SP_HOST}${path}?partner_id=${SP_PARTNER_ID}&timestamp=${ts}&sign=${spSignPublic(path, ts)}`;
        const j = await (await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh_token: tok.refresh_token, shop_id: Number(tok.shop_id), partner_id: Number(SP_PARTNER_ID) }) })).json();
        if (j.error || !j.access_token) throw new Error(`Shopee token refresh failed: ${j.message || j.error || 'unknown'}`);
        const nowMs = Date.now();
        const patch = {
            access_token: j.access_token,
            access_token_expire_at: new Date(nowMs + (Number(j.expire_in || 14400) * 1000)).toISOString(),
            refresh_token: j.refresh_token || tok.refresh_token,
            updated_at: new Date().toISOString()
        };
        await sb('PATCH', `/shopee_tokens?shop_id=eq.${tok.shop_id}`, patch, { Prefer: 'return=minimal' });
        tok = Object.assign(tok, patch);
    }
    return tok;
}
// status return SELESAI (barang betul-betul dipulangkan/refund) — Zaid: simpan COMPLETE sahaja.
const SP_DONE = ['CLOSED', 'REFUND_PAID', 'COMPLETED'];
function isDoneReturn(source, status) {
    const st = String(status || '').toUpperCase();
    if (source === 'tiktok') return st === 'RETURN_OR_REFUND_REQUEST_COMPLETE';
    return SP_DONE.includes(st); // shopee
}

// Pull Shopee returns in 15-day windows (API cap). Returns { rows, raw, count }.
async function spPullReturns(fromSec, toSec, onlyDone) {
    const tok = await spGetValidToken();
    const raw = [];
    const rows = [];
    const WIN = 15 * 24 * 3600;
    for (let winFrom = fromSec; winFrom < toSec; winFrom += WIN) {
        const winTo = Math.min(winFrom + WIN, toSec);
        let pageNo = 1, guard = 0;
        do {
            const r = await spGet('/api/v2/returns/get_return_list', {
                page_no: pageNo, page_size: 100, create_time_from: winFrom, create_time_to: winTo
            }, tok.access_token, tok.shop_id);
            if (r.error) throw new Error(`Shopee get_return_list: ${r.message || r.error}`);
            const list = (r.response && r.response.return) || [];
            for (const ret of list) {
                if (raw.length < 2) raw.push(ret);
                if (onlyDone && !isDoneReturn('shopee', ret.status)) continue; // skip yang belum selesai / batal
                const spExtra = ret.refund_amount ? ('refund RM' + ret.refund_amount) : '';
                const items = ret.item || ret.item_list || [];
                if (items.length) {
                    items.forEach((it, it_i) => {
                        const sku = String(it.model_sku || it.item_sku || '').toUpperCase().trim();
                        rows.push(mkRow('shopee', 'Shopee', ret.return_sn, sku, it.name || it.item_name,
                            Number(it.amount || it.quantity_purchased || 1) || 1,
                            ret.text_reason || ret.reason || 'return',
                            ret.order_sn, ret.status, ret.create_time, it.item_id || it_i, spExtra));
                    });
                } else {
                    rows.push(mkRow('shopee', 'Shopee', ret.return_sn, '', '(no item detail)', 1,
                        ret.text_reason || ret.reason || 'return', ret.order_sn, ret.status, ret.create_time, 0, spExtra));
                }
            }
            if (!(r.response && r.response.more)) break;
            pageNo++;
        } while (++guard < 50);
    }
    return { rows, raw, count: rows.length };
}

// ============================ TIKTOK ============================
function ttSign(path, query, bodyStr, isGet) {
    const keys = Object.keys(query).filter(k => k !== 'sign' && k !== 'access_token' && k !== 'x-tts-access-token').sort();
    let s = '';
    for (const k of keys) { if (Array.isArray(query[k])) continue; s += `${k}${query[k]}`; }
    s = path + s;
    if (!isGet && bodyStr) s += bodyStr;
    s = TT_APP_SECRET + s + TT_APP_SECRET;
    return crypto.createHmac('sha256', TT_APP_SECRET).update(s).digest('hex');
}
async function ttRequest(method, path, { query = {}, body = null, accessToken, shopCipher } = {}) {
    const isGet = method.toUpperCase() === 'GET';
    const q = Object.assign({}, query, { app_key: TT_APP_KEY, timestamp: Math.floor(Date.now() / 1000).toString() });
    const noCipher = /^\/(authorization|seller)\/\d{6}\//.test(path);
    if (shopCipher && !noCipher) q.shop_cipher = shopCipher;
    const bodyStr = (!isGet && body != null) ? JSON.stringify(body) : '';
    q.sign = ttSign(path, q, bodyStr, isGet);
    const qs = Object.entries(q).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
    const res = await fetch(`${TT_API_BASE}${path}?${qs}`, {
        method, headers: { 'x-tts-access-token': accessToken, 'content-type': 'application/json' }, body: bodyStr || undefined
    });
    return res.json();
}
async function ttGetValidToken() {
    const rows = await sb('GET', '/tiktok_tokens?order=created_at.desc&limit=1');
    if (!rows || !rows.length) throw new Error('No TikTok token');
    let tok = rows[0];
    if (new Date(tok.access_token_expire_at).getTime() - Date.now() < 60 * 60 * 1000) {
        const url = `${TT_TOKEN_BASE}/refresh?app_key=${encodeURIComponent(TT_APP_KEY)}&app_secret=${encodeURIComponent(TT_APP_SECRET)}&refresh_token=${encodeURIComponent(tok.refresh_token)}&grant_type=refresh_token`;
        const j = await (await fetch(url)).json();
        if (j.code !== 0 || !j.data || !j.data.access_token) throw new Error(`TikTok token refresh failed: ${j.message || 'unknown'}`);
        const d = j.data;
        const patch = {
            access_token: d.access_token,
            access_token_expire_at: new Date((d.access_token_expire_in || 0) * 1000).toISOString(),
            refresh_token: d.refresh_token || tok.refresh_token,
            updated_at: new Date().toISOString()
        };
        await sb('PATCH', `/tiktok_tokens?open_id=eq.${encodeURIComponent(tok.open_id)}`, patch, { Prefer: 'return=minimal' });
        tok = Object.assign(tok, patch);
    }
    return tok;
}
async function ttEnsureCipher(tok) {
    if (tok.shop_cipher && tok.shop_id) return { cipher: tok.shop_cipher, id: tok.shop_id };
    const res = await ttRequest('GET', `/authorization/${TT_VERSION}/shops`, { accessToken: tok.access_token });
    if (res.code !== 0) throw new Error(`TikTok get shops: ${res.message}`);
    const shop = ((res.data && res.data.shops) || [])[0];
    if (!shop) throw new Error('No authorized TikTok shop');
    return { cipher: shop.cipher, id: String(shop.id) };
}
async function ttPullReturns(fromSec, onlyDone) {
    const tok = await ttGetValidToken();
    const shop = await ttEnsureCipher(tok);
    const raw = [];
    const rows = [];
    let pageToken = '', guard = 0;
    do {
        const q = { page_size: 50 };
        if (pageToken) q.page_token = pageToken;
        const res = await ttRequest('POST', `/return_refund/${TT_VERSION}/returns/search`, {
            query: q, body: { create_time_ge: fromSec },
            accessToken: tok.access_token, shopCipher: shop.cipher
        });
        if (res.code !== 0) throw new Error(`TikTok returns search: ${res.message} (code ${res.code})`);
        const list = (res.data && (res.data.return_orders || res.data.returns || res.data.return_list)) || [];
        for (const ret of list) {
            if (raw.length < 2) raw.push(ret);
            const rid = String(ret.return_id || ret.return_order_id || ret.id || '');
            const reason = ret.return_reason_text || ret.return_reason || 'return';
            const orderId = ret.order_id || '';
            const status = ret.return_status || ret.status || '';
            if (onlyDone && !isDoneReturn('tiktok', status)) continue; // skip belum selesai / batal
            const cAt = ret.create_time || ret.created_time || 0;
            // return_type: REFUND (duit pulang tanpa barang) vs RETURN_AND_REFUND (barang + duit)
            const rtype = ret.return_type || '';
            const rtotal = ret.refund_amount && (ret.refund_amount.refund_total || ret.refund_amount.total);
            const extra = `${rtype || 'RETURN'}${rtotal ? ' · refund RM' + rtotal : ''}`;
            const lis = ret.return_line_items || ret.line_items || [];
            if (lis.length) {
                lis.forEach((li, li_i) => {
                    const sku = String(li.seller_sku || li.sku || '').toUpperCase().trim();
                    const lineKey = li.return_line_item_id || li.order_line_item_id || li_i;
                    rows.push(mkRow('tiktok', 'TikTok Shop', rid, sku, li.product_name || li.sku_name,
                        Number(li.quantity || 1) || 1, reason, orderId, status, cAt, lineKey, extra));
                });
            } else {
                rows.push(mkRow('tiktok', 'TikTok Shop', rid, '', '(no item detail)', 1, reason, orderId, status, cAt, 0, extra));
            }
        }
        pageToken = (res.data && res.data.next_page_token) || '';
    } while (pageToken && ++guard < 50);
    return { rows, raw, count: rows.length };
}

// ---- baris returns_log dikongsi (cost_impact + supplier diisi kemudian) ----
function mkRow(source, channel, returnId, sku, name, qty, reason, orderRef, status, createTimeSec, lineKey, extraNote) {
    return {
        sku: sku || '',
        product_name: (name || '').slice(0, 200),
        qty: Number(qty) || 1,
        type: 'return',
        reason: String(reason || 'return').slice(0, 120),
        notes: `Auto ${channel} · order ${orderRef || '-'} · status ${status || '-'}${extraNote ? ' · ' + extraNote : ''}`,
        channel,
        supplier: '',
        cost_impact: 0,
        order_ref: orderRef ? String(orderRef) : null,
        reported_by_id: 'system',
        reported_by_name: 'Auto-Sedut',
        reported_at: createTimeSec ? new Date(Number(createTimeSec) * 1000).toISOString() : new Date().toISOString(),
        source,
        // sertakan line key supaya return berbilang line-item (SKU sama) tak collapse jadi 1
        external_id: `${returnId}:${sku || 'x'}:${lineKey != null ? lineKey : 0}`
    };
}

exports.handler = async (event) => {
    if (!SERVICE_KEY) return json(500, { error: 'SUPABASE_SERVICE_KEY not set' });
    // p1_576 (#16) — invokasi berjadual (cron) tiada queryStringParameters → auto IMPORT (default 15 hari lalu).
    const isScheduled = !event.queryStringParameters;
    const params = event.queryStringParameters || {};
    const mode = isScheduled ? 'import' : (params.mode === 'import' ? 'import' : 'dryrun');
    const channel = (params.channel || '').toLowerCase(); // '' = both
    const onlyDone = params.status !== 'all'; // default: return SELESAI sahaja (Zaid). ?status=all = semua.
    const sinceMs = params.since ? Date.parse(params.since) : Date.now() - 15 * 24 * 60 * 60 * 1000;
    if (isNaN(sinceMs)) return json(400, { error: 'invalid ?since date (YYYY-MM-DD)' });
    const fromSec = Math.floor(sinceMs / 1000);
    const toSec = Math.floor(Date.now() / 1000);

    // ?debug=shopee — pulang response MENTAH Shopee get_return_list (1 window) utk diagnose
    if (params.debug === 'shopee') {
        try {
            const tok = await spGetValidToken();
            const wFrom = fromSec, wTo = Math.min(fromSec + 15 * 24 * 3600, toSec);
            const r = await spGet('/api/v2/returns/get_return_list', {
                page_no: 1, page_size: 20, create_time_from: wFrom, create_time_to: wTo
            }, tok.access_token, tok.shop_id);
            return json(200, { debug: 'shopee', shop_id: tok.shop_id, window: [new Date(wFrom * 1000).toISOString(), new Date(wTo * 1000).toISOString()], raw: r });
        } catch (e) { return json(200, { debug: 'shopee', error: String(e.message || e) }); }
    }

    const out = { mode, since: new Date(sinceMs).toISOString(), only_completed: onlyDone, channels: {} };
    let rows = [];
    const raw = {};

    // ---- Shopee ----
    if (channel !== 'tiktok') {
        if (!SP_PARTNER_ID || !SP_PARTNER_KEY) { out.channels.shopee = { skipped: 'creds not set' }; }
        else {
            try { const r = await spPullReturns(fromSec, toSec, onlyDone); rows = rows.concat(r.rows); raw.shopee = r.raw; out.channels.shopee = { found: r.count }; }
            catch (e) { out.channels.shopee = { error: String(e.message || e) }; }
        }
    }
    // ---- TikTok ----
    if (channel !== 'shopee') {
        if (!TT_APP_KEY || !TT_APP_SECRET) { out.channels.tiktok = { skipped: 'creds not set' }; }
        else {
            try { const r = await ttPullReturns(fromSec, onlyDone); rows = rows.concat(r.rows); raw.tiktok = r.raw; out.channels.tiktok = { found: r.count }; }
            catch (e) { out.channels.tiktok = { error: String(e.message || e) }; }
        }
    }

    out.total_found = rows.length;
    if (!rows.length) { out.note = 'Tiada returns dalam window ni.'; out.raw_sample = raw; return json(200, out); }

    // ---- isi cost_impact + supplier dari products_master ----
    try {
        const skus = [...new Set(rows.map(r => r.sku).filter(Boolean))];
        if (skus.length) {
            const costMap = {};
            for (const batch of chunk(skus, 100)) {
                const list = batch.map(s => `"${s.replace(/"/g, '')}"`).join(',');
                // products_master takde kolum supplier name (cuma preferred_supplier_id) — ambil cost_price je
                const pm = await sb('GET', `/products_master?select=sku,cost_price&sku=in.(${list})`);
                (pm || []).forEach(p => { costMap[(p.sku || '').toUpperCase()] = Number(p.cost_price || 0); });
            }
            rows.forEach(r => { if (costMap[r.sku] != null) r.cost_impact = costMap[r.sku]; });
        }
    } catch (e) { out.cost_lookup_error = String(e.message || e); }

    // ---- dedup ikut (source, external_id) — selaras unique constraint uq_returns_source_ext (#31) ----
    const extIds = rows.map(r => r.external_id);
    const seen = new Set();
    for (const batch of chunk(extIds, 150)) {
        const list = batch.map(s => `"${s.replace(/"/g, '')}"`).join(',');
        const ex = await sb('GET', `/returns_log?select=source,external_id&external_id=in.(${list})`);
        (ex || []).forEach(r => { if (r.external_id) seen.add((r.source || '') + '|' + r.external_id); });
    }
    // de-dup dalam batch sendiri juga (return_sn+sku sama dua kali)
    const localSeen = new Set();
    const fresh = rows.filter(r => {
        const k = (r.source || '') + '|' + r.external_id;
        if (seen.has(k) || localSeen.has(k)) return false;
        localSeen.add(k); return true;
    });

    out.mapped = rows.length;
    out.already_logged = rows.length - fresh.length;
    out.new = fresh.length;

    if (mode === 'dryrun') {
        out.sample = fresh.slice(0, 5);
        out.raw_sample = raw;
        out.note = 'DRY RUN — tiada apa ditulis. Tambah ?mode=import untuk simpan.';
        return json(200, out);
    }

    // ---- import: insert baris baru (skip 23505 duplicate dari race) ----
    let inserted = 0, dupes = 0;
    for (const row of fresh) {
        try { await sb('POST', '/returns_log', row, { Prefer: 'return=minimal' }); inserted++; }
        catch (e) {
            const msg = String(e.message || e);
            if (msg.includes('23505') || msg.includes('duplicate') || msg.includes('409')) { dupes++; continue; }
            (out.errors = out.errors || []).push({ external_id: row.external_id, err: msg.slice(0, 120) });
        }
    }
    out.inserted = inserted;
    out.dupes_skipped = dupes;
    out.ok = true;
    return json(200, out);
};
