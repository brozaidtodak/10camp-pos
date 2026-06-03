/**
 * Shopee Open Platform STOCK sync — Netlify Function (p1_98 Fasa 2C).
 *
 * Pushes POS inventory stock → Shopee shop. Matches SKU between POS
 * masterProducts/inventory_batches and Shopee items/models, compares
 * stock levels, optionally updates Shopee inventory.
 *
 * Query modes:
 *   ?mode=peek    (default) — list all Shopee items + match status, no compare
 *   ?mode=dryrun            — compare POS vs Shopee stock, list diffs (no write)
 *   ?mode=push              — actually push stock updates to Shopee
 *   ?limit=N                — limit items processed (default 50, max 100)
 *
 * Public URL: https://www.10camp.com/api/shopee-stock-sync
 */

const crypto = require('crypto');

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

function signShop(path, timestamp, accessToken, shopId) {
    const base = `${PARTNER_ID}${path}${timestamp}${accessToken}${shopId}`;
    return crypto.createHmac('sha256', PARTNER_KEY).update(base).digest('hex');
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

async function shopeePost(path, extraQuery, bodyObj, accessToken, shopId) {
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
    const res = await fetch(`${HOST}${path}?${qs}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bodyObj || {})
    });
    return res.json();
}

async function getValidToken() {
    const rows = await sb('GET', `/shopee_tokens?environment=eq.${ENV}&order=created_at.desc&limit=1`);
    if (!rows || !rows.length) throw new Error(`No Shopee token for ${ENV} — run the authorize flow first.`);
    return rows[0]; // refresh logic lives in shopee-sync.js; this assumes recent connect
}

// Load POS stock from inventory_batches (latest snapshot per SKU)
async function loadPosStock() {
    // sum stock per SKU from inventory_batches table
    const rows = await sb('GET', '/inventory_batches?select=sku,current_qty&limit=10000');
    const bySku = {};
    for (const r of (rows || [])) {
        const sku = (r.sku || '').toUpperCase().trim();
        if (!sku) continue;
        bySku[sku] = (bySku[sku] || 0) + Number(r.current_qty || 0);
    }
    return bySku;
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
    const mode = ['peek','dryrun','push'].includes(params.mode) ? params.mode : 'peek';
    const limit = Math.min(parseInt(params.limit || '50', 10) || 50, 100);

    const out = { mode, env: ENV, limit };

    try {
        const tok = await getValidToken();
        out.shop_id = tok.shop_id;

        // 1. List Shopee items
        const itemIds = [];
        let offset = 0;
        let guard = 0;
        do {
            const r = await shopeeGet('/api/v2/product/get_item_list', {
                offset,
                page_size: 100,
                item_status: 'NORMAL'
            }, tok.access_token, tok.shop_id);
            if (r.error) { out.error = `get_item_list: ${r.message || r.error}`; return json(502, out); }
            const list = (r.response && r.response.item) || [];
            for (const it of list) itemIds.push(it.item_id);
            if (!(r.response && r.response.has_next_page)) break;
            offset += 100;
        } while (++guard < 20 && itemIds.length < limit);

        out.shopee_items_total = itemIds.length;
        const cappedIds = itemIds.slice(0, limit);

        if (!cappedIds.length) {
            out.note = 'Shopee shop tiada items (NORMAL status). Tambah products dalam Shopee Seller Centre dulu.';
            return json(200, out);
        }

        // 2. Get item base info — batches of 50
        const items = [];
        for (const batch of chunk(cappedIds, 50)) {
            const r = await shopeeGet('/api/v2/product/get_item_base_info', {
                item_id_list: batch.join(',')
            }, tok.access_token, tok.shop_id);
            if (r.error) { out.error = `get_item_base_info: ${r.message || r.error}`; return json(502, out); }
            for (const it of ((r.response && r.response.item_list) || [])) items.push(it);
        }

        if (mode === 'peek') {
            out.items_sample = items.slice(0, 5).map(i => ({
                item_id: i.item_id,
                item_sku: i.item_sku,
                item_name: i.item_name,
                has_model: !!i.has_model
            }));
            out.note = 'PEEK mode — list items only. Use ?mode=dryrun untuk compare stock POS vs Shopee.';
            return json(200, out);
        }

        // 3. dryrun + push — compare stock POS vs Shopee
        const posStock = await loadPosStock();
        out.pos_skus_total = Object.keys(posStock).length;

        const diffs = []; // { item_id, model_id, item_sku, model_sku, pos_qty, shopee_qty, diff }

        for (const it of items) {
            const itemSku = (it.item_sku || '').toUpperCase().trim();

            if (it.has_model) {
                // Need to fetch models for variants
                const r = await shopeeGet('/api/v2/product/get_model_list', {
                    item_id: it.item_id
                }, tok.access_token, tok.shop_id);
                if (r.error) continue;
                const models = (r.response && r.response.model) || [];
                for (const m of models) {
                    const modelSku = (m.model_sku || '').toUpperCase().trim();
                    if (!modelSku) continue;
                    if (!(modelSku in posStock)) continue;
                    const posQty = posStock[modelSku] || 0;
                    const shopeeQty = (m.stock_info_v2 && m.stock_info_v2.summary_info && m.stock_info_v2.summary_info.total_available_stock) || 0;
                    const diff = posQty - shopeeQty;
                    if (diff !== 0) diffs.push({
                        item_id: it.item_id,
                        model_id: m.model_id,
                        item_sku: itemSku,
                        model_sku: modelSku,
                        pos_qty: posQty,
                        shopee_qty: shopeeQty,
                        diff
                    });
                }
            } else {
                if (!itemSku) continue;
                if (!(itemSku in posStock)) continue;
                const posQty = posStock[itemSku] || 0;
                const shopeeQty = (it.stock_info_v2 && it.stock_info_v2.summary_info && it.stock_info_v2.summary_info.total_available_stock) || 0;
                const diff = posQty - shopeeQty;
                if (diff !== 0) diffs.push({
                    item_id: it.item_id,
                    model_id: 0,
                    item_sku: itemSku,
                    pos_qty: posQty,
                    shopee_qty: shopeeQty,
                    diff
                });
            }
        }

        out.matched = diffs.length;
        out.diffs_sample = diffs.slice(0, 10);

        if (mode === 'dryrun') {
            out.note = 'DRYRUN — listed up to 10 diffs above. Use ?mode=push to actually update Shopee stock.';
            return json(200, out);
        }

        // 4. push — update_stock per item
        let pushed = 0;
        const errors = [];
        // Group by item_id
        const byItem = {};
        for (const d of diffs) {
            if (!byItem[d.item_id]) byItem[d.item_id] = [];
            byItem[d.item_id].push(d);
        }
        for (const [itemId, list] of Object.entries(byItem)) {
            const stockList = list.map(d => ({
                model_id: d.model_id,
                seller_stock: [{ stock: d.pos_qty }]
            }));
            const r = await shopeePost('/api/v2/product/update_stock', {}, {
                item_id: Number(itemId),
                stock_list: stockList
            }, tok.access_token, tok.shop_id);
            if (r.error) {
                errors.push({ item_id: itemId, error: r.error, message: r.message });
            } else {
                pushed += list.length;
            }
        }
        out.pushed = pushed;
        if (errors.length) out.errors = errors;
        out.ok = errors.length === 0;
        return json(200, out);

    } catch (err) {
        out.error = String(err);
        return json(500, out);
    }
};
