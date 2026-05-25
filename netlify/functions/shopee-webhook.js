/**
 * Shopee Webhook listener — Netlify Function (p1_98 Fasa 3A).
 *
 * Receives push notifications from Shopee Open Platform when orders
 * change status. Fetches the specific order detail + upserts to
 * sales_history for instant sync (no waiting for 15-min cron).
 *
 * Public URL: https://pos.10camp.com/api/shopee-webhook
 *
 * Setup steps (Zaid kena buat dalam Shopee Open Platform console):
 *   1. Buka app "10 CAMP POS Sync"
 *   2. Cari section "Push Notification" atau "Webhook URL"
 *   3. Set URL: https://pos.10camp.com/api/shopee-webhook
 *   4. Subscribe events: Order Status Update (code 3)
 *
 * Signature verification:
 *   Header: Authorization = HMAC-SHA256(url + "|" + request_body, partner_key)
 *   Compare with locally computed sign — reject if mismatch.
 *
 * Event types handled:
 *   code 3 — Order Status Update (NEW + status changes)
 *   Others: logged but no action.
 */

const crypto = require('crypto');

const PARTNER_ID   = process.env.SHOPEE_PARTNER_ID || '';
const PARTNER_KEY  = process.env.SHOPEE_PARTNER_KEY || '';
const PUSH_KEY     = process.env.SHOPEE_PUSH_KEY || ''; // Test/Live Push Partner Key — webhook signing
const ENV          = (process.env.SHOPEE_ENV || 'sandbox').toLowerCase();
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://asehjdnfzoypbwfeazra.supabase.co';
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY || '';
const WEBHOOK_URL  = 'https://pos.10camp.com/api/shopee-webhook';

const HOST = ENV === 'live'
    ? 'https://partner.shopeemobile.com'
    : 'https://openplatform.sandbox.test-stable.shopee.sg';

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
    if (!res.ok) throw new Error(`Supabase ${res.status}: ${text.slice(0, 200)}`);
    return text ? JSON.parse(text) : null;
}

async function logEvent(row) {
    try { await sb('POST', '/shopee_sync_log', row, { Prefer: 'return=minimal' }); } catch(e) {}
}

function signShop(path, timestamp, accessToken, shopId) {
    const base = `${PARTNER_ID}${path}${timestamp}${accessToken}${shopId}`;
    return crypto.createHmac('sha256', PARTNER_KEY).update(base).digest('hex');
}

// Webhook sign uses Push Partner Key (separate from OAuth partner_key).
// If SHOPEE_PUSH_KEY not set, skip verification (dev/initial-setup mode).
function verifyWebhookSign(url, body, authHeader) {
    if (!PUSH_KEY) return { ok: true, skipped: true, reason: 'PUSH_KEY not set — skipping verify' };
    const computed = crypto.createHmac('sha256', PUSH_KEY)
        .update(`${url}|${body}`)
        .digest('hex');
    const matched = computed === (authHeader || '').trim();
    return { ok: matched, skipped: false };
}

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

// Reuse order mapper (mirror shopee-sync.js)
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
            source: 'shopee_webhook',
            synced_at: new Date().toISOString()
        }
    };
}

exports.handler = async (event) => {
    // Shopee may probe with GET — respond 200 to confirm endpoint alive.
    if (event.httpMethod === 'GET') {
        return { statusCode: 200, body: 'shopee-webhook alive' };
    }
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'method not allowed' };
    }

    const startMs = Date.now();
    const rawBody = event.body || '';
    const authHeader = (event.headers && (event.headers.authorization || event.headers.Authorization)) || '';

    // 1. Verify signature (uses SHOPEE_PUSH_KEY; skips check if env not set)
    const verifyResult = verifyWebhookSign(WEBHOOK_URL, rawBody, authHeader);
    if (!verifyResult.ok) {
        await logEvent({
            source: 'webhook', mode: 'import', environment: ENV,
            error_message: 'sign mismatch',
            duration_ms: Date.now() - startMs,
            raw_response: { auth: (authHeader || '').slice(0, 32), body_first: rawBody.slice(0, 200) }
        });
        return { statusCode: 401, body: 'invalid signature' };
    }
    if (verifyResult.skipped) {
        // Log warning but accept — dev/setup mode without SHOPEE_PUSH_KEY env var.
        await logEvent({
            source: 'webhook', mode: 'import', environment: ENV,
            error_message: 'WARNING: SHOPEE_PUSH_KEY not set, sign check skipped',
            duration_ms: 0,
            raw_response: { note: 'set SHOPEE_PUSH_KEY in Netlify env for production' }
        });
    }

    // 2. Parse payload
    let payload;
    try { payload = JSON.parse(rawBody); }
    catch(e) { return { statusCode: 400, body: 'invalid json' }; }

    const code = payload.code;
    const shopId = payload.shop_id;
    const orderSn = payload.data && payload.data.ordersn;

    // 3. Only handle Order Status Update (code 3)
    if (code !== 3 || !shopId || !orderSn) {
        await logEvent({
            source: 'webhook', mode: 'import', environment: ENV,
            raw_response: { code, shop_id: shopId, note: 'event ignored (not order-status)' },
            duration_ms: Date.now() - startMs
        });
        return { statusCode: 200, body: 'event ignored' };
    }

    try {
        // 4. Load token for this shop_id
        const tokenRows = await sb('GET', `/shopee_tokens?shop_id=eq.${shopId}&limit=1`);
        if (!tokenRows || !tokenRows.length) {
            // Most common reason: Shopee "Push Test Data" sandbox button uses fake shop_id
            // for delivery testing. Not a real error — sign verified ok, just no matching shop.
            await logEvent({
                source: 'webhook', mode: 'import', environment: ENV,
                raw_response: { note: `Shopee test push or unauthorized shop_id ${shopId} — skipped`, code }
            });
            return { statusCode: 200, body: 'no token, ack' };
        }
        let tok = tokenRows[0];

        // p1_104 — Check token expiry; refresh if <1 hour remaining.
        // Webhook can fire any time, so token might be stale even if cron just ran.
        const expiresInMs = new Date(tok.access_token_expire_at).getTime() - Date.now();
        if (expiresInMs < 60 * 60 * 1000) {
            try {
                const path = '/api/v2/auth/access_token/get';
                const ts = Math.floor(Date.now() / 1000);
                const refreshSign = crypto.createHmac('sha256', PARTNER_KEY).update(`${PARTNER_ID}${path}${ts}`).digest('hex');
                const refreshUrl = `${HOST}${path}?partner_id=${PARTNER_ID}&timestamp=${ts}&sign=${refreshSign}`;
                const rRes = await fetch(refreshUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        refresh_token: tok.refresh_token,
                        shop_id: Number(tok.shop_id),
                        partner_id: Number(PARTNER_ID)
                    })
                });
                const rJson = await rRes.json();
                if (rJson.access_token) {
                    const nowMs = Date.now();
                    const patch = {
                        access_token: rJson.access_token,
                        access_token_expire_at: new Date(nowMs + (Number(rJson.expire_in || 14400) * 1000)).toISOString(),
                        refresh_token: rJson.refresh_token || tok.refresh_token,
                        refresh_token_expire_at: new Date(nowMs + (30 * 24 * 3600 * 1000)).toISOString(),
                        updated_at: new Date().toISOString()
                    };
                    await sb('PATCH', `/shopee_tokens?shop_id=eq.${tok.shop_id}`, patch, { Prefer: 'return=minimal' });
                    tok = Object.assign(tok, patch);
                }
            } catch (e) { /* if refresh fails, still try with current token */ }
        }

        // 5. Fetch order detail
        const detailFields = 'buyer_user_id,buyer_username,recipient_address,item_list,total_amount,currency,order_status,payment_method,shipping_carrier,create_time,update_time';
        const r = await shopeeGet('/api/v2/order/get_order_detail', {
            order_sn_list: orderSn,
            response_optional_fields: detailFields
        }, tok.access_token, shopId);

        if (r.error) {
            await logEvent({
                source: 'webhook', mode: 'import', environment: ENV,
                error_message: `get_order_detail: ${r.message || r.error}`,
                duration_ms: Date.now() - startMs
            });
            return { statusCode: 200, body: 'detail fetch failed, ack' };
        }

        const orderList = (r.response && r.response.order_list) || [];
        if (!orderList.length) {
            await logEvent({
                source: 'webhook', mode: 'import', environment: ENV,
                raw_response: { note: 'detail returned no order', order_sn: orderSn },
                duration_ms: Date.now() - startMs
            });
            return { statusCode: 200, body: 'no detail, ack' };
        }

        const row = mapOrder(orderList[0]);

        // 6. Upsert to sales_history — try insert, fallback to update if exists
        const existing = await sb('GET',
            `/sales_history?select=id&metadata->>shopee_order_sn=eq.${encodeURIComponent(orderSn)}&limit=1`);

        if (existing && existing.length) {
            // Update existing row (status may have changed)
            await sb('PATCH',
                `/sales_history?metadata->>shopee_order_sn=eq.${encodeURIComponent(orderSn)}`,
                { status: row.status, total: row.total, total_amount: row.total, items: row.items, metadata: row.metadata },
                { Prefer: 'return=minimal' });
        } else {
            await sb('POST', '/sales_history', row, { Prefer: 'return=minimal' });
        }

        await logEvent({
            source: 'webhook', mode: 'import', environment: ENV,
            orders_found: 1,
            orders_new: existing && existing.length ? 0 : 1,
            orders_inserted: existing && existing.length ? 0 : 1,
            raw_response: { order_sn: orderSn, status: row.status, action: existing && existing.length ? 'update' : 'insert' },
            duration_ms: Date.now() - startMs
        });

        return { statusCode: 200, body: 'ok' };

    } catch (err) {
        await logEvent({
            source: 'webhook', mode: 'import', environment: ENV,
            error_message: String(err).slice(0, 500),
            duration_ms: Date.now() - startMs
        });
        return { statusCode: 200, body: 'error logged, ack' };
    }
};
