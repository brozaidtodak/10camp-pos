/**
 * EasyStore push (POS → EasyStore inventory sync) — p1_29.
 *
 * Receives POST from POS browser when a sale is confirmed, updates
 * EasyStore variant inventory_quantity to match POS-deducted stock.
 *
 * Flow:
 *   1. POS confirms sale → cart items submitted as { items: [{sku, qty}, ...] }
 *   2. For each item, look up products_master.metadata.easystore_variant_id
 *   3. GET current inventory_quantity from EasyStore
 *   4. PUT new value = current - qty_sold (or +qty for refunds)
 *   5. Return per-SKU result
 *
 * Token (EASYSTORE_TOKEN) lives in Netlify env, never exposed to browser.
 *
 * Public URL:    https://pos-system-test.netlify.app/api/easystore-push
 * Internal:      https://pos-system-test.netlify.app/.netlify/functions/easystore-push
 *
 * Body: { items: [{sku, qty}], delta: 'subtract' | 'add' (default 'subtract') }
 */

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://asehjdnfzoypbwfeazra.supabase.co';
// p1_785 (C3) — env-only, no committed credential. Prefer the service key (anon is RLS-locked since
// p1_649, so writes need service); matches the convention used by shopee-sync/tiktok-sync/etc.
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY || '';
const ES_TOKEN     = process.env.EASYSTORE_TOKEN || '';
const ES_BASE      = 'https://www.10camp.com/api/3.0';

async function sb(method, path) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
        method,
        headers: {
            apikey: SUPABASE_KEY,
            Authorization: `Bearer ${SUPABASE_KEY}`,
            'Content-Type': 'application/json',
            Prefer: 'return=representation'
        }
    });
    const text = await r.text();
    if (!r.ok) {
        const err = new Error(`Supabase ${r.status}: ${text.slice(0, 200)}`);
        err.status = r.status;
        throw err;
    }
    return text ? JSON.parse(text) : null;
}

async function esGet(path) {
    const r = await fetch(`${ES_BASE}${path}`, {
        headers: { 'EasyStore-Access-Token': ES_TOKEN, 'Content-Type': 'application/json' }
    });
    if (!r.ok) {
        const t = await r.text();
        throw new Error(`ES GET ${r.status}: ${t.slice(0, 200)}`);
    }
    return r.json();
}

async function esPut(path, body) {
    const r = await fetch(`${ES_BASE}${path}`, {
        method: 'PUT',
        headers: { 'EasyStore-Access-Token': ES_TOKEN, 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
    if (!r.ok) {
        const t = await r.text();
        throw new Error(`ES PUT ${r.status}: ${t.slice(0, 200)}`);
    }
    return r.json();
}

exports.handler = async function (event) {
    const startTs = Date.now();

    // Health check
    if (event.httpMethod === 'GET') {
        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                ok: true,
                service: 'easystore-push',
                ts: new Date().toISOString(),
                supabase: !!SUPABASE_KEY,
                easystore_token: !!ES_TOKEN
            })
        };
    }

    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method not allowed' };
    }

    if (!ES_TOKEN || !SUPABASE_KEY) {
        return {
            statusCode: 500,
            body: JSON.stringify({ ok: false, error: 'env_missing', es: !!ES_TOKEN, sb: !!SUPABASE_KEY })
        };
    }

    let body;
    try { body = JSON.parse(event.body || '{}'); }
    catch { return { statusCode: 400, body: JSON.stringify({ ok: false, error: 'bad_json' }) }; }

    const items = Array.isArray(body.items) ? body.items : [];
    const delta = body.delta === 'add' ? 'add' : 'subtract';
    if (!items.length) {
        return { statusCode: 400, body: JSON.stringify({ ok: false, error: 'no_items' }) };
    }

    const results = [];
    for (const it of items) {
        const sku = String(it.sku || '').toUpperCase().trim();
        const qty = parseInt(it.qty) || 0;
        if (!sku || qty <= 0) {
            results.push({ sku, ok: false, reason: 'invalid_input' });
            continue;
        }
        try {
            // Look up easystore IDs from products_master
            const prods = await sb('GET',
                `/products_master?sku=eq.${encodeURIComponent(sku)}` +
                `&select=sku,metadata&limit=1`
            );
            if (!prods || !prods.length) {
                results.push({ sku, ok: false, reason: 'sku_not_in_pos_db' });
                continue;
            }
            const meta = prods[0].metadata || {};
            const variantId = meta.easystore_variant_id;
            const productId = meta.easystore_product_id;
            if (!variantId || !productId) {
                results.push({ sku, ok: false, reason: 'no_easystore_mapping' });
                continue;
            }

            // GET current EasyStore variant inventory_quantity
            const esResp = await esGet(`/products/${productId}/variants/${variantId}.json`);
            const variant = esResp.variant || esResp;
            const currentQty = parseInt(variant.inventory_quantity) || 0;
            const newQty = delta === 'add' ? currentQty + qty : Math.max(0, currentQty - qty);

            // PUT new inventory_quantity
            await esPut(`/products/${productId}/variants/${variantId}.json`, {
                variant: { id: variantId, inventory_quantity: newQty }
            });

            results.push({ sku, ok: true, before: currentQty, after: newQty, delta_applied: newQty - currentQty });
        } catch (e) {
            results.push({ sku, ok: false, reason: 'api_error', detail: (e.message || '').slice(0, 150) });
        }
    }

    const okCount = results.filter(r => r.ok).length;
    return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            ok: okCount > 0,
            processed: results.length,
            succeeded: okCount,
            failed: results.length - okCount,
            results,
            duration_ms: Date.now() - startTs
        })
    };
};
