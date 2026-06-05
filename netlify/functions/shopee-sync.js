/**
 * Shopee Open Platform sync — Netlify Function (p1_98 Fasa 2).
 *
 * Pulls Shopee orders directly into POS sales_history (channel "Shopee").
 *
 * Query modes:
 *   ?mode=dryrun  (default) — fetch + map orders, return summary + samples,
 *                             NO database write.
 *   ?mode=import            — insert new orders into sales_history, deduped
 *                             on metadata.shopee_order_sn.
 *   ?since=YYYY-MM-DD       — only orders created on/after this date
 *                             (default: 7 days ago). Max 15 day window per call.
 *
 * Public URL: https://www.10camp.com/api/shopee-sync
 *
 * Sign formula (shop-scoped):
 *   base = partner_id + path + timestamp + access_token + shop_id
 *   sign = HMAC-SHA256(base, partner_key) → lowercase hex
 */

const crypto = require('crypto');
const { deductStockForItems, isVoidStatus } = require('./_inventory');

const PARTNER_ID   = process.env.SHOPEE_PARTNER_ID || '';
const PARTNER_KEY  = process.env.SHOPEE_PARTNER_KEY || '';
const ENV          = (process.env.SHOPEE_ENV || 'sandbox').toLowerCase();
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://asehjdnfzoypbwfeazra.supabase.co';
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY || '';

const HOST = ENV === 'live'
    ? 'https://partner.shopeemobile.com'
    : 'https://openplatform.sandbox.test-stable.shopee.sg';

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

// ---- Shopee signature ----
function signShop(path, timestamp, accessToken, shopId) {
    const base = `${PARTNER_ID}${path}${timestamp}${accessToken}${shopId}`;
    return crypto.createHmac('sha256', PARTNER_KEY).update(base).digest('hex');
}
function signPublic(path, timestamp) {
    const base = `${PARTNER_ID}${path}${timestamp}`;
    return crypto.createHmac('sha256', PARTNER_KEY).update(base).digest('hex');
}

// ---- Shopee GET request (shop-scoped) ----
async function shopeeGet(path, extraQuery, accessToken, shopId) {
    const timestamp = Math.floor(Date.now() / 1000);
    const sign = signShop(path, timestamp, accessToken, shopId);
    const q = Object.assign({
        partner_id: PARTNER_ID,
        timestamp,
        access_token: accessToken,
        shop_id: shopId,
        sign
    }, extraQuery || {});
    const qs = Object.entries(q).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
    const res = await fetch(`${HOST}${path}?${qs}`, { method: 'GET' });
    return res.json();
}

// ---- Token: load + refresh if near expiry (within 1 hour) ----
async function getValidToken() {
    const rows = await sb('GET', `/shopee_tokens?environment=eq.${ENV}&order=created_at.desc&limit=1`);
    if (!rows || !rows.length) throw new Error(`No Shopee token for ${ENV} — run the authorize flow first.`);
    let tok = rows[0];

    const expiresInMs = new Date(tok.access_token_expire_at).getTime() - Date.now();
    if (expiresInMs < 60 * 60 * 1000) {
        // Refresh via /api/v2/auth/access_token/get
        const path = '/api/v2/auth/access_token/get';
        const timestamp = Math.floor(Date.now() / 1000);
        const sign = signPublic(path, timestamp);
        const url = `${HOST}${path}?partner_id=${PARTNER_ID}&timestamp=${timestamp}&sign=${sign}`;
        const r = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                refresh_token: tok.refresh_token,
                shop_id: Number(tok.shop_id),
                partner_id: Number(PARTNER_ID)
            })
        });
        const j = await r.json();
        if (j.error || !j.access_token) {
            throw new Error(`Token refresh failed: ${j.message || j.error || 'unknown'}`);
        }
        const nowMs = Date.now();
        const patch = {
            access_token: j.access_token,
            access_token_expire_at: new Date(nowMs + (Number(j.expire_in || 14400) * 1000)).toISOString(),
            refresh_token: j.refresh_token || tok.refresh_token,
            refresh_token_expire_at: new Date(nowMs + (30 * 24 * 3600 * 1000)).toISOString(),
            updated_at: new Date().toISOString()
        };
        await sb('PATCH', `/shopee_tokens?shop_id=eq.${tok.shop_id}`, patch, { Prefer: 'return=minimal' });
        tok = Object.assign(tok, patch);
    }
    return tok;
}

// ---- Shopee order status → POS sales_history status ----
const STATUS_MAP = {
    UNPAID: 'Pending',
    READY_TO_SHIP: 'To Fulfil',
    PROCESSED: 'To Fulfil',
    RETRY_SHIP: 'To Fulfil',
    SHIPPED: 'Processing',
    TO_CONFIRM_RECEIVE: 'Processing',
    IN_CANCEL: 'Pending',
    CANCELLED: 'Voided',
    INVOICE_PENDING: 'Pending',
    COMPLETED: 'Completed'
};

// ---- Map one Shopee order detail → sales_history row ----
function mapOrder(o) {
    const items = (o.item_list || []).map(li => ({
        sku: (li.model_sku || li.item_sku || '').toUpperCase(),
        name: li.item_name || '(unnamed)',
        qty: Number(li.model_quantity_purchased || li.quantity_purchased || 0),
        price: Number(li.model_discounted_price || li.model_original_price || 0),
        sku_name: li.model_name || null
    }));

    const total = Number(o.total_amount || 0);
    const addr = o.recipient_address || {};

    return {
        customer_name: (o.buyer_username || addr.name || 'Shopee Buyer').slice(0, 200),
        customer_phone: addr.phone || null,
        payment_method: o.payment_method || 'Shopee',
        total,
        total_amount: total,
        items,
        created_at: new Date((o.create_time || 0) * 1000).toISOString(),
        channel: 'Shopee',
        status: STATUS_MAP[o.order_status] || 'Completed',
        staff_name: null,
        metadata: {
            shopee_order_sn: o.order_sn,
            shopee_shop_id: o.shop_id ? String(o.shop_id) : null,
            buyer_user_id: o.buyer_user_id ? String(o.buyer_user_id) : null,
            currency: o.currency || 'MYR',
            shipping_carrier: o.shipping_carrier || null,
            order_status: o.order_status || null,
            payment_method_raw: o.payment_method || null,
            source: 'shopee_direct',
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
    if (!PARTNER_ID || !PARTNER_KEY) return json(500, { error: 'SHOPEE_PARTNER_ID / SHOPEE_PARTNER_KEY not set' });
    if (!SERVICE_KEY) return json(500, { error: 'SUPABASE_SERVICE_KEY not set' });

    const params = event.queryStringParameters || {};
    const mode = params.mode === 'import' ? 'import' : 'dryrun';
    const sinceMs = params.since
        ? Date.parse(params.since)
        : Date.now() - 7 * 24 * 60 * 60 * 1000;
    if (isNaN(sinceMs)) return json(400, { error: 'invalid ?since date (use YYYY-MM-DD or ISO datetime)' });

    // Shopee max 15-day window per call
    const nowSec = Math.floor(Date.now() / 1000);
    const fromSec = Math.floor(sinceMs / 1000);
    const maxWindow = 15 * 24 * 3600;
    if (nowSec - fromSec > maxWindow) {
        return json(400, { error: 'Shopee API max 15-day window per call. Use ?since within 15 days.' });
    }

    const out = { mode, env: ENV, since: new Date(sinceMs).toISOString() };

    try {
        const tok = await getValidToken();
        out.shop_id = tok.shop_id;

        // 1. Pull order_sn list (paginated via cursor)
        const orderSns = [];
        let cursor = '';
        let guard = 0;
        do {
            const q = {
                time_range_field: 'create_time',
                time_from: fromSec,
                time_to: nowSec,
                page_size: 100,
                response_optional_fields: 'order_status'
            };
            if (cursor) q.cursor = cursor;
            const r = await shopeeGet('/api/v2/order/get_order_list', q, tok.access_token, tok.shop_id);
            if (r.error) { out.error = `get_order_list: ${r.message || r.error}`; return json(502, out); }
            const list = (r.response && r.response.order_list) || [];
            for (const o of list) orderSns.push(o.order_sn);
            cursor = (r.response && r.response.next_cursor) || '';
            if (!(r.response && r.response.more)) break;
        } while (cursor && ++guard < 40);

        out.orders_found = orderSns.length;
        if (!orderSns.length) { out.note = 'No Shopee orders dalam window ni.'; return json(200, out); }

        // 2. Fetch order detail batches (max 50 per call)
        const detailFields = 'buyer_user_id,buyer_username,recipient_address,item_list,total_amount,currency,order_status,payment_method,shipping_carrier,create_time,update_time';
        const orders = [];
        for (const batch of chunk(orderSns, 50)) {
            const r = await shopeeGet('/api/v2/order/get_order_detail', {
                order_sn_list: batch.join(','),
                response_optional_fields: detailFields
            }, tok.access_token, tok.shop_id);
            if (r.error) { out.error = `get_order_detail: ${r.message || r.error}`; return json(502, out); }
            for (const o of ((r.response && r.response.order_list) || [])) orders.push(o);
        }

        // 3. Map to sales_history schema
        const rows = orders.map(mapOrder);

        // 4. Dedup
        const snList = rows.map(r => r.metadata.shopee_order_sn).filter(Boolean);
        let seen = new Set();
        if (snList.length) {
            const existing = await sb('GET',
                `/sales_history?select=sn:metadata->>shopee_order_sn&metadata->>shopee_order_sn=in.(${snList.map(s => `"${s}"`).join(',')})`);
            seen = new Set((existing || []).map(r => r.sn).filter(Boolean));
        }
        const fresh = rows.filter(r => !seen.has(r.metadata.shopee_order_sn));

        out.mapped = rows.length;
        out.already_imported = rows.length - fresh.length;
        out.new = fresh.length;

        if (mode === 'dryrun') {
            out.sample = fresh.slice(0, 3);
            out.note = 'DRY RUN — nothing written. Add ?mode=import to insert.';
            return json(200, out);
        }

        // 5+6. Import PER-ORDER + deduct only on a real insert.
        // The unique index uq_sales_shopee_order_sn makes a racing duplicate
        // insert fail with 23505; we skip those, so stock is deducted exactly
        // once per order even if the webhook + cron process it concurrently.
        let inserted = 0, dupes = 0;
        const stock = { orders: 0, total_deducted: 0, shortfalls: [], errors: [] };
        for (const order of fresh) {
            try {
                await sb('POST', '/sales_history', order, { Prefer: 'return=minimal' });
                inserted++;
            } catch (e) {
                const msg = String(e.message || e);
                if (msg.includes('23505') || msg.includes('duplicate key') || msg.includes('Supabase 409')) { dupes++; continue; }
                stock.errors.push({ order_sn: order.metadata.shopee_order_sn, err: msg.slice(0, 120) });
                continue;
            }
            if (isVoidStatus(order.status)) continue;
            const r = await deductStockForItems(sb, order.items, { txnType: 'OUTBOUND_SALE' });
            stock.orders++;
            stock.total_deducted += r.total_deducted;
            for (const s of r.shortfalls) stock.shortfalls.push({ order_sn: order.metadata.shopee_order_sn, ...s });
            for (const e of r.errors) stock.errors.push({ order_sn: order.metadata.shopee_order_sn, ...e });
        }
        out.inserted = inserted;
        out.dupes_skipped = dupes;
        out.stock = stock;
        out.ok = true;
        return json(200, out);

    } catch (err) {
        out.error = String(err);
        return json(500, out);
    }
};
