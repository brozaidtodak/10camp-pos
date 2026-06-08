/**
 * TikTok Shop sync — Netlify Function (p3_9 direct integration, Phase 2).
 *
 * Pulls TikTok Shop orders directly (no EasyStore) into sales_history.
 *
 * Query modes:
 *   ?mode=dryrun  (default) — fetch + map orders, return summary + samples,
 *                             NO database write.
 *   ?mode=import            — insert new orders into sales_history, deduped
 *                             on metadata.tiktok_order_id.
 *   ?since=YYYY-MM-DD        — only orders created on/after this date
 *                             (default: 2 days ago).
 *
 * Public URL: https://www.10camp.com/api/tiktok-sync
 *
 * TRANSITION NOTE: TikTok orders also still arrive via EasyStore Channels.
 * To avoid double-counting, disconnect the TikTok channel in EasyStore and
 * run imports only from that cutoff date forward.
 *
 * Signature (TikTok Shop Open API 202309), verified vs EcomPHP/tiktokshop-php:
 *   sign = HMAC-SHA256(app_secret + path + sortedParams + body + app_secret,
 *                      key = app_secret) → lowercase hex.
 */

const crypto = require('crypto');
const { deductStockForItems, isVoidStatus } = require('./_inventory');

const API_BASE   = 'https://open-api.tiktokglobalshop.com';
const TOKEN_BASE = 'https://auth.tiktok-shops.com/api/v2/token';
const VERSION    = '202309';

const APP_KEY      = process.env.TIKTOK_APP_KEY || '';
const APP_SECRET   = process.env.TIKTOK_APP_SECRET || '';
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://asehjdnfzoypbwfeazra.supabase.co';
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY || '';

function json(statusCode, obj) {
    return {
        statusCode,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify(obj, null, 2)
    };
}

// ---- Supabase (service-role) ----
async function sb(method, path, body, extraHeaders) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
        method,
        headers: Object.assign({
            apikey: SERVICE_KEY,
            Authorization: `Bearer ${SERVICE_KEY}`,
            'Content-Type': 'application/json'
        }, extraHeaders || {}),
        body: body ? JSON.stringify(body) : undefined
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`Supabase ${res.status}: ${text.slice(0, 300)}`);
    return text ? JSON.parse(text) : null;
}

// ---- TikTok signature + signed call ----
function signRequest(path, query, bodyStr, isGet) {
    const keys = Object.keys(query)
        .filter(k => k !== 'sign' && k !== 'access_token' && k !== 'x-tts-access-token')
        .sort();
    let s = '';
    for (const k of keys) {
        if (Array.isArray(query[k])) continue;
        s += `${k}${query[k]}`;
    }
    s = path + s;
    if (!isGet && bodyStr) s += bodyStr;
    s = APP_SECRET + s + APP_SECRET;
    return crypto.createHmac('sha256', APP_SECRET).update(s).digest('hex');
}

async function ttRequest(method, path, { query = {}, body = null, accessToken, shopCipher } = {}) {
    const isGet = method.toUpperCase() === 'GET';
    const q = Object.assign({}, query, {
        app_key: APP_KEY,
        timestamp: Math.floor(Date.now() / 1000).toString()
    });
    const noCipher = /^\/(authorization|seller)\/\d{6}\//.test(path);
    if (shopCipher && !noCipher) q.shop_cipher = shopCipher;

    const bodyStr = (!isGet && body != null) ? JSON.stringify(body) : '';
    q.sign = signRequest(path, q, bodyStr, isGet);

    const qs = Object.entries(q)
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
        .join('&');

    const res = await fetch(`${API_BASE}${path}?${qs}`, {
        method,
        headers: { 'x-tts-access-token': accessToken, 'content-type': 'application/json' },
        body: bodyStr || undefined
    });
    return res.json();
}

// ---- Token: load + refresh if expiring ----
async function getValidToken() {
    const rows = await sb('GET', '/tiktok_tokens?order=created_at.desc&limit=1');
    if (!rows || !rows.length) throw new Error('No TikTok token — run the authorize flow first.');
    let tok = rows[0];

    if (new Date(tok.access_token_expire_at).getTime() - Date.now() < 60 * 60 * 1000) {
        const url = `${TOKEN_BASE}/refresh?app_key=${encodeURIComponent(APP_KEY)}`
            + `&app_secret=${encodeURIComponent(APP_SECRET)}`
            + `&refresh_token=${encodeURIComponent(tok.refresh_token)}&grant_type=refresh_token`;
        const j = await (await fetch(url)).json();
        if (j.code !== 0 || !j.data || !j.data.access_token) {
            throw new Error(`Token refresh failed: ${j.message || 'unknown'} (code ${j.code})`);
        }
        const d = j.data;
        const patch = {
            access_token: d.access_token,
            access_token_expire_at: new Date((d.access_token_expire_in || 0) * 1000).toISOString(),
            refresh_token: d.refresh_token || tok.refresh_token,
            refresh_token_expire_at: d.refresh_token_expire_in
                ? new Date(d.refresh_token_expire_in * 1000).toISOString()
                : tok.refresh_token_expire_at,
            updated_at: new Date().toISOString()
        };
        await sb('PATCH', `/tiktok_tokens?open_id=eq.${encodeURIComponent(tok.open_id)}`, patch,
            { Prefer: 'return=minimal' });
        tok = Object.assign(tok, patch);
    }
    return tok;
}

async function ensureShopCipher(tok) {
    if (tok.shop_cipher && tok.shop_id) return { cipher: tok.shop_cipher, id: tok.shop_id };
    const res = await ttRequest('GET', `/authorization/${VERSION}/shops`, { accessToken: tok.access_token });
    if (res.code !== 0) throw new Error(`Get shops failed: ${res.message} (code ${res.code})`);
    const shop = ((res.data && res.data.shops) || [])[0];
    if (!shop) throw new Error('No authorized shop found.');
    await sb('PATCH', `/tiktok_tokens?open_id=eq.${encodeURIComponent(tok.open_id)}`,
        { shop_cipher: shop.cipher, shop_id: String(shop.id), updated_at: new Date().toISOString() },
        { Prefer: 'return=minimal' });
    return { cipher: shop.cipher, id: String(shop.id) };
}

// ---- TikTok order status → sales_history status ----
const STATUS_MAP = {
    UNPAID: 'Pending',
    ON_HOLD: 'Pending',
    AWAITING_SHIPMENT: 'To Fulfil',
    AWAITING_COLLECTION: 'To Fulfil',
    PARTIALLY_SHIPPING: 'Processing',
    IN_TRANSIT: 'Processing',
    DELIVERED: 'Completed',
    COMPLETED: 'Completed',
    CANCELLED: 'Voided'
};

// ---- Map a TikTok order → sales_history row ----
function mapOrder(o) {
    const pay = o.payment || {};
    const addr = o.recipient_address || {};
    const total = parseFloat(pay.total_amount || 0) || 0;

    // line_items: each entry is one unit — group by sku_id
    const bySku = {};
    for (const li of (o.line_items || [])) {
        const key = li.sku_id || li.seller_sku || li.id;
        if (!bySku[key]) {
            bySku[key] = {
                sku: (li.seller_sku || '').toUpperCase(),
                name: li.product_name || li.sku_name || '(unnamed)',
                qty: 0,
                price: parseFloat(li.sale_price || 0) || 0,
                sku_name: li.sku_name || null
            };
        }
        bySku[key].qty += 1;
    }

    return {
        customer_name: (addr.name || 'TikTok Buyer').slice(0, 200),
        customer_phone: addr.phone_number || null,
        payment_method: o.payment_method_name || 'TikTok',
        total,
        total_amount: total,
        items: Object.values(bySku),
        created_at: new Date((o.create_time || 0) * 1000).toISOString(),
        channel: 'TikTok Shop',
        status: STATUS_MAP[o.status] || 'Completed',
        staff_name: null,
        metadata: {
            tiktok_order_id: String(o.id),
            tiktok_user_id: o.user_id ? String(o.user_id) : null,
            buyer_email: o.buyer_email || null,
            shipping_provider: o.shipping_provider || null,
            payment_method_name: o.payment_method_name || null,
            currency: pay.currency || 'MYR',
            subtotal: parseFloat(pay.sub_total || 0) || 0,
            shipping: parseFloat(pay.shipping_fee || 0) || 0,
            platform_discount: parseFloat(pay.platform_discount || 0) || 0,
            seller_discount: parseFloat(pay.seller_discount || 0) || 0,
            tax: parseFloat(pay.tax || 0) || 0,
            tiktok_status: o.status,
            source: 'tiktok_direct',
            synced_at: new Date().toISOString()
        }
    };
}

function chunk(arr, n) {
    const out = [];
    for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
    return out;
}

exports.handler = async (event) => {
    if (!APP_KEY || !APP_SECRET) return json(500, { error: 'TIKTOK_APP_KEY / TIKTOK_APP_SECRET not set' });
    if (!SERVICE_KEY) return json(500, { error: 'SUPABASE_SERVICE_KEY not set' });

    const params = event.queryStringParameters || {};
    const mode = params.mode === 'import' ? 'import' : 'dryrun';
    // p1_343 — default lookback 7 hari (dulu 2) supaya re-sync status tangkap perubahan lebih lama
    // (cth order dibatalkan 3-5 hari selepas dibuat masih auto-betul di POS).
    const sinceMs = params.since
        ? Date.parse(params.since)
        : Date.now() - 7 * 24 * 60 * 60 * 1000;
    if (isNaN(sinceMs)) return json(400, { error: 'invalid ?since date (use YYYY-MM-DD or ISO datetime)' });

    const out = { mode };

    try {
        const tok = await getValidToken();
        const shop = await ensureShopCipher(tok);

        // Cutover floor — never import orders created before the EasyStore→direct
        // cutover, otherwise they double-up with EasyStore-sourced TikTok orders.
        const cutoverMs = tok.direct_sync_cutover ? Date.parse(tok.direct_sync_cutover) : 0;
        // p1_104 safety guard — refuse import bila cutover belum di-set.
        // Otherwise cron + EasyStore akan double-pull orders. Force ke dryrun mode.
        if (mode === 'import' && !cutoverMs) {
            out.refused = true;
            out.note = 'Import refused — direct_sync_cutover belum di-set dalam tiktok_tokens. Orders TikTok sekarang sync via EasyStore. Set cutover dulu untuk activate direct-API import.';
            return json(200, out);
        }
        const effectiveSinceMs = Math.max(sinceMs, cutoverMs || 0);
        const createGe = Math.floor(effectiveSinceMs / 1000);
        out.since = new Date(effectiveSinceMs).toISOString();
        out.cutover = tok.direct_sync_cutover || null;

        // 1. Pull all order IDs since cutoff (paginated)
        const ids = [];
        let pageToken = '';
        let guard = 0;
        do {
            const q = { page_size: 50, sort_field: 'create_time', sort_order: 'DESC' };
            if (pageToken) q.page_token = pageToken;
            const res = await ttRequest('POST', `/order/${VERSION}/orders/search`, {
                query: q, body: { create_time_ge: createGe },
                accessToken: tok.access_token, shopCipher: shop.cipher
            });
            if (res.code !== 0) { out.error = `order search failed: ${res.message} (code ${res.code})`; return json(502, out); }
            for (const o of ((res.data && res.data.orders) || [])) ids.push(o.id);
            pageToken = (res.data && res.data.next_page_token) || '';
        } while (pageToken && ++guard < 40);
        out.orders_found = ids.length;

        if (!ids.length) { out.note = 'No TikTok orders in this window.'; return json(200, out); }

        // 2. Fetch order details in batches
        const orders = [];
        for (const batch of chunk(ids, 50)) {
            const res = await ttRequest('GET', `/order/${VERSION}/orders`, {
                query: { ids: batch.join(',') },
                accessToken: tok.access_token, shopCipher: shop.cipher
            });
            if (res.code !== 0) { out.error = `order detail failed: ${res.message} (code ${res.code})`; return json(502, out); }
            for (const o of ((res.data && res.data.orders) || [])) orders.push(o);
        }

        // 3. Map
        const rows = orders.map(mapOrder);

        // 4. Dedup against already-imported TikTok-direct orders (+ capture id/status untuk re-sync)
        const idList = rows.map(r => r.metadata.tiktok_order_id);
        const existing = await sb('GET',
            `/sales_history?select=id,status,payment_method,tid:metadata->>tiktok_order_id&metadata->>tiktok_order_id=in.(${idList.join(',')})`);
        const existMap = {};
        (existing || []).forEach(r => { if (r.tid) existMap[r.tid] = { id: r.id, status: r.status, payment_method: r.payment_method }; });
        const seen = new Set(Object.keys(existMap));
        const fresh = rows.filter(r => !seen.has(r.metadata.tiktok_order_id));

        out.mapped = rows.length;
        out.already_imported = rows.length - fresh.length;
        out.new = fresh.length;

        if (mode === 'dryrun') {
            out.sample = fresh.slice(0, 3);
            out.note = 'DRY RUN — nothing written. Add ?mode=import to insert.';
            return json(200, out);
        }

        // 5. Import — insert new rows
        let inserted = 0;
        for (const batch of chunk(fresh, 50)) {
            if (!batch.length) continue;
            await sb('POST', '/sales_history', batch, { Prefer: 'return=minimal' });
            inserted += batch.length;
        }
        out.inserted = inserted;

        // 5b. Re-sync STATUS + PAYMENT METHOD untuk order yang DAH WUJUD.
        //     Status di TikTok mungkin dah berubah (UNPAID→CANCELLED, AWAITING_SHIPMENT→COMPLETED, dll).
        //     Payment method pula = TikTok source of truth; kalau POS pernah drift (cth tersilap edit jadi
        //     "Cash" sedangkan TikTok = PayLater — order #4992 2026-06-07), cron auto-betulkan balik.
        //     Hanya betulkan bila API pulang payment_method_name SEBENAR (elak timpa dgn fallback 'TikTok').
        let statusUpdated = 0, paymentFixed = 0;
        for (const r of rows) {
            const ex = existMap[r.metadata.tiktok_order_id];
            if (!ex) continue;
            const patch = {};
            if (ex.status !== r.status) patch.status = r.status;
            const realPm = r.metadata.payment_method_name; // null kalau API tak bagi (jangan timpa)
            if (realPm && ex.payment_method !== realPm) patch.payment_method = realPm;
            if (Object.keys(patch).length) {
                try {
                    await sb('PATCH', `/sales_history?id=eq.${ex.id}`, patch, { Prefer: 'return=minimal' });
                    if (patch.status) statusUpdated++;
                    if (patch.payment_method) paymentFixed++;
                } catch (e) { /* best-effort */ }
            }
        }
        out.status_updated = statusUpdated;
        out.payment_fixed = paymentFixed;

        // 6. Lubang A — deduct POS stock for each NEWLY-imported order (FIFO).
        // Only `fresh` orders reach here (already deduped), so each deducts once.
        const stock = { orders: 0, total_deducted: 0, shortfalls: [], errors: [] };
        for (const order of fresh) {
            if (isVoidStatus(order.status)) continue;
            const r = await deductStockForItems(sb, order.items, { txnType: 'OUTBOUND_SALE' });
            stock.orders++;
            stock.total_deducted += r.total_deducted;
            for (const s of r.shortfalls) stock.shortfalls.push({ tiktok_order_id: order.metadata.tiktok_order_id, ...s });
            for (const e of r.errors) stock.errors.push({ tiktok_order_id: order.metadata.tiktok_order_id, ...e });
        }
        out.stock = stock;
        out.ok = true;
        return json(200, out);

    } catch (err) {
        out.error = String(err);
        return json(500, out);
    }
};
