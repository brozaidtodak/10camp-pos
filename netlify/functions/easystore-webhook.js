/**
 * EasyStore webhook receiver — Netlify Function.
 *
 * Receives POST from EasyStore on order events:
 *   - orders/create
 *   - orders/updated
 *   - orders/cancelled
 *   - orders/paid
 *   - orders/fulfilled
 *
 * Verifies HMAC-SHA256 signature using EASYSTORE_APP_SECRET.
 * Idempotent: skips orders already in DB (matched by metadata.easystore_order_id).
 *
 * Public URL: https://pos-system-test.netlify.app/.netlify/functions/easystore-webhook
 * Friendly:   https://pos-system-test.netlify.app/api/easystore-webhook
 */

const crypto = require('crypto');
const { deductStockForItems } = require('./_inventory');

// ===== ENV (set via Netlify dashboard or CLI) =====
const SUPABASE_URL    = process.env.SUPABASE_URL    || 'https://asehjdnfzoypbwfeazra.supabase.co';
const SUPABASE_KEY    = process.env.SUPABASE_KEY    || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFzZWhqZG5mem95cGJ3ZmVhenJhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU2MjE2NjMsImV4cCI6MjA5MTE5NzY2M30.34nAhmcNO_xN73OdsyxayKl_jipIk-M8DIBgibAOdaI';
const APP_SECRET      = process.env.EASYSTORE_APP_SECRET || '';

// ===== UTILS =====
function normalizePhone(raw) {
    if (!raw) return null;
    const digits = String(raw).replace(/\D/g, '');
    if (digits.length < 9) return null;
    if (digits.startsWith('60')) return digits;
    if (digits.startsWith('0'))  return '60' + digits.slice(1);
    return digits;
}

// p3_1: map EasyStore order.source_name → human channel label.
// Observed values: tiktok-shop, shopee-malaysia, pos, sf, online_store.
// Unknown sources get a title-cased fallback so new channels stay readable.
function mapChannel(sourceName) {
    const s = (sourceName || '').toLowerCase().trim();
    if (!s) return 'Web EasyStore';
    if (s.includes('tiktok'))  return 'TikTok Shop';
    if (s.includes('shopee'))  return 'Shopee';
    if (s.includes('lazada'))  return 'Lazada';
    if (s === 'pos')           return 'Walk-in Kedai';
    if (s === 'sf' || s === 'online_store' || s.includes('store')) return 'Web EasyStore';
    return s.replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function verifyHmac(rawBody, signature) {
    if (!APP_SECRET || !signature) return false;
    const expected = crypto.createHmac('sha256', APP_SECRET).update(rawBody).digest('base64');
    try {
        const a = Buffer.from(signature);
        const b = Buffer.from(expected);
        if (a.length !== b.length) return false;
        return crypto.timingSafeEqual(a, b);
    } catch (e) { return false; }
}

async function sb(method, path, body) {
    const url = `${SUPABASE_URL}/rest/v1${path}`;
    const opts = {
        method,
        headers: {
            apikey: SUPABASE_KEY,
            Authorization: `Bearer ${SUPABASE_KEY}`,
            'Content-Type': 'application/json',
            Prefer: method === 'POST' ? 'return=representation' : 'return=minimal'
        }
    };
    if (body) opts.body = typeof body === 'string' ? body : JSON.stringify(body);
    const r = await fetch(url, opts);
    const text = await r.text();
    if (!r.ok) {
        const err = new Error(`Supabase ${r.status}: ${text.slice(0, 300)}`);
        err.status = r.status; err.body = text;
        throw err;
    }
    return text ? JSON.parse(text) : null;
}

// ===== MAP EasyStore order → sales_history payload =====
function buildSalesPayload(order) {
    const cust = order.customer || {};
    const items = (order.line_items || []).map(li => ({
        sku: (li.sku || '').toUpperCase(),
        name: li.product_name || li.variant_name || '(unnamed)',
        qty: parseInt(li.quantity) || 1,
        price: parseFloat(li.price) || 0,
        discount: parseFloat(li.total_discount) || 0
    }));

    const total = parseFloat(order.total_price || order.total_amount) || 0;
    const fin = (order.financial_status || '').toLowerCase();
    const ful = (order.fulfillment_status || '').toLowerCase();

    const statusMap = {
        paid: 'Completed',
        pending: 'Pending',
        refunded: 'Refunded',
        partially_refunded: 'Partially Refunded',
        voided: 'Voided',
        cancelled: 'Voided'
    };

    // p3_1: channel from order.source_name (tiktok-shop / shopee-malaysia / pos / sf).
    // Falls back to customer.creation_source only when the order omits source_name.
    const channel = mapChannel(order.source_name || order.source_type || cust.creation_source);

    const customerName = cust.name
        || `${cust.first_name || ''} ${cust.last_name || ''}`.trim()
        || 'Walk-In';

    return {
        customer_name: customerName.slice(0, 200),
        customer_phone: normalizePhone(cust.phone),
        payment_method: (order.gateway_names && order.gateway_names.length)
            ? order.gateway_names.join(', ')
            : (order.payment_method || 'Unknown'),
        total,
        total_amount: total,
        items,
        created_at: order.processed_at || order.created_at || new Date().toISOString(),
        channel,
        status: statusMap[fin] || 'Completed',
        staff_name: null,
        metadata: {
            easystore_order_id: String(order.id),
            easystore_order_number: order.order_number,
            easystore_token: order.token,
            easystore_processed_at: order.processed_at,
            easystore_currency: order.currency_code,
            easystore_customer_id: cust.id ? String(cust.id) : null,
            easystore_source_name: order.source_name || order.source_type || null,
            subtotal: parseFloat(order.subtotal_price) || 0,
            shipping: parseFloat(order.total_shipping_fee || order.total_shipping) || 0,
            discount: parseFloat(order.total_discount) || 0,
            tax: parseFloat(order.total_tax) || 0,
            gateway_names: order.gateway_names || [],
            fulfillment_status: ful || null,
            migrated_from: 'easystore_webhook',
            received_at: new Date().toISOString()
        }
    };
}

// ===== MAIN HANDLER =====
exports.handler = async function (event) {
    const startTs = Date.now();

    // Health-check endpoint (browser visit)
    if (event.httpMethod === 'GET') {
        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                ok: true,
                service: 'easystore-webhook',
                ts: new Date().toISOString(),
                hmac_configured: !!APP_SECRET,
                supabase_configured: !!SUPABASE_KEY
            })
        };
    }

    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method not allowed' };
    }

    const rawBody = event.body || '';
    const headers = event.headers || {};

    // EasyStore HMAC header (case-insensitive)
    const sig = headers['x-easystore-hmac-sha256']
             || headers['X-EasyStore-Hmac-Sha256']
             || headers['x-easystore-hmac']
             || '';

    // Verify signature (skip if APP_SECRET not configured — for first-time testing)
    if (APP_SECRET && !verifyHmac(rawBody, sig)) {
        return {
            statusCode: 401,
            body: JSON.stringify({ ok: false, error: 'invalid_hmac', got_sig: sig.slice(0, 20) })
        };
    }

    // Parse topic header (e.g. "orders/create", "orders/updated")
    const topic = (headers['x-easystore-topic'] || headers['X-EasyStore-Topic'] || 'unknown').toLowerCase();

    let order;
    try { order = JSON.parse(rawBody); }
    catch (e) {
        return { statusCode: 400, body: JSON.stringify({ ok: false, error: 'bad_json' }) };
    }

    // Only process order topics for now
    if (!topic.startsWith('orders/')) {
        return {
            statusCode: 200,
            body: JSON.stringify({ ok: true, ignored: true, topic })
        };
    }

    const orderId = String(order.id || '');
    if (!orderId) {
        return { statusCode: 400, body: JSON.stringify({ ok: false, error: 'no_order_id' }) };
    }

    // Idempotency: check if already in DB
    try {
        const existing = await sb('GET', `/sales_history?metadata->>easystore_order_id=eq.${orderId}&select=id,status&limit=1`);
        if (existing && existing.length > 0) {
            // Update existing if topic is updated/cancelled/fulfilled
            if (topic === 'orders/cancelled' || topic === 'orders/voided') {
                await sb('PATCH', `/sales_history?id=eq.${existing[0].id}`, { status: 'Voided' });
                return {
                    statusCode: 200,
                    body: JSON.stringify({ ok: true, action: 'updated_to_voided', id: existing[0].id, topic })
                };
            }
            // Already imported — no-op
            return {
                statusCode: 200,
                body: JSON.stringify({
                    ok: true, action: 'already_exists',
                    id: existing[0].id, easystore_order_id: orderId, topic,
                    duration_ms: Date.now() - startTs
                })
            };
        }
    } catch (e) {
        // If lookup fails, log and try insert anyway
        console.error('lookup error:', e.message);
    }

    // Insert new sale
    const payload = buildSalesPayload(order);
    let insertedSale = null;
    try {
        const inserted = await sb('POST', '/sales_history', payload);
        insertedSale = inserted && inserted[0];
    } catch (e) {
        return {
            statusCode: 500,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                ok: false, error: 'db_insert_failed',
                detail: (e.message || '').slice(0, 200),
                topic, easystore_order_id: orderId
            })
        };
    }

    // Deduct inventory_batches for each line item — now via shared _inventory
    // helper so EasyStore, Shopee + TikTok all deduct identically (FIFO oldest
    // batch first, matching the cashier counter, + OUTBOUND_SALE audit ledger).
    // Skip if order is voided/cancelled (never consumed stock).
    let inventoryResult = { skus_processed: 0, total_deducted: 0, shortfalls: [], errors: [] };
    const fin = (order.financial_status || '').toLowerCase();
    if (fin !== 'voided' && fin !== 'cancelled' && payload.items && payload.items.length) {
        inventoryResult = await deductStockForItems(sb, payload.items, { txnType: 'OUTBOUND_SALE' });
    }

    return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            ok: true,
            action: 'inserted',
            topic,
            easystore_order_id: orderId,
            easystore_order_number: order.order_number,
            inserted_id: insertedSale && insertedSale.id,
            total: payload.total,
            inventory: inventoryResult,
            duration_ms: Date.now() - startTs
        })
    };
};
