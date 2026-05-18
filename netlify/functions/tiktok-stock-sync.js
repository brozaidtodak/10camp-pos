/**
 * TikTok Shop stock sync — Netlify Function (p3_9 direct integration, Phase 3).
 *
 * Pushes POS stock levels OUT to TikTok Shop so the marketplace never oversells.
 *
 * Query modes:
 *   ?mode=peek    (default) — searchProducts page 1, return raw product shape.
 *   ?mode=dryrun            — build full seller_sku↔TikTok mapping, compare POS
 *                             stock vs TikTok stock, return the diff plan. No push.
 *   ?mode=push              — apply the diffs via updateInventory.
 *
 * Public URL: https://pos.10camp.com/api/tiktok-stock-sync
 *
 * POS stock = SUM(inventory_batches.qty_remaining) per sku.
 * TikTok mapping: seller_sku → { product_id, sku_id, warehouse_id, qty }
 * from POST /product/202309/products/search.
 *
 * PARKED until EasyStore cutover — EasyStore also manages TikTok stock; running
 * push before cutover would fight EasyStore's inventory sync.
 *
 * Signature: HMAC-SHA256(app_secret + path + sortedParams + body + app_secret),
 * lowercase hex (same as tiktok-sync.js).
 */

const crypto = require('crypto');

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
    if (tok.shop_cipher) return tok.shop_cipher;
    const res = await ttRequest('GET', `/authorization/${VERSION}/shops`, { accessToken: tok.access_token });
    if (res.code !== 0) throw new Error(`Get shops failed: ${res.message} (code ${res.code})`);
    const shop = ((res.data && res.data.shops) || [])[0];
    if (!shop) throw new Error('No authorized shop found.');
    await sb('PATCH', `/tiktok_tokens?open_id=eq.${encodeURIComponent(tok.open_id)}`,
        { shop_cipher: shop.cipher, shop_id: String(shop.id), updated_at: new Date().toISOString() },
        { Prefer: 'return=minimal' });
    return shop.cipher;
}

// ---- POS stock: SUM(qty_remaining) per sku ----
async function getPosStock() {
    const rows = await sb('GET', '/inventory_batches?select=sku,qty_remaining');
    const map = {};
    for (const r of (rows || [])) {
        const sku = (r.sku || '').toUpperCase();
        if (!sku) continue;
        map[sku] = (map[sku] || 0) + (parseInt(r.qty_remaining, 10) || 0);
    }
    return map;
}

// ---- Pull all TikTok products + their SKUs (paginated) ----
async function getTiktokProducts(accessToken, shopCipher) {
    const products = [];
    let pageToken = '';
    let guard = 0;
    do {
        const q = { page_size: 50 };
        if (pageToken) q.page_token = pageToken;
        const res = await ttRequest('POST', `/product/${VERSION}/products/search`, {
            query: q, body: { status: 'ACTIVE' },
            accessToken, shopCipher
        });
        if (res.code !== 0) throw new Error(`products/search failed: ${res.message} (code ${res.code})`);
        for (const p of ((res.data && res.data.products) || [])) products.push(p);
        pageToken = (res.data && res.data.next_page_token) || '';
    } while (pageToken && ++guard < 60);
    return products;
}

exports.handler = async (event) => {
    if (!APP_KEY || !APP_SECRET) return json(500, { error: 'TIKTOK_APP_KEY / TIKTOK_APP_SECRET not set' });
    if (!SERVICE_KEY) return json(500, { error: 'SUPABASE_SERVICE_KEY not set' });

    const params = event.queryStringParameters || {};
    const mode = ['dryrun', 'push'].includes(params.mode) ? params.mode : 'peek';
    const out = { mode };

    try {
        const tok = await getValidToken();
        const shopCipher = await ensureShopCipher(tok);

        // PEEK — one page, return raw shape so we can confirm the SKU structure
        if (mode === 'peek') {
            const res = await ttRequest('POST', `/product/${VERSION}/products/search`, {
                query: { page_size: 5 }, body: { status: 'ACTIVE' },
                accessToken: tok.access_token, shopCipher
            });
            if (res.code !== 0) { out.error = `${res.message} (code ${res.code})`; return json(502, out); }
            const products = (res.data && res.data.products) || [];
            out.total_count = res.data && res.data.total_count;
            out.products_in_page = products.length;
            out.raw_first_product = products[0] || null;
            return json(200, out);
        }

        // DRYRUN / PUSH — build mapping + compare stock
        const products = await getTiktokProducts(tok.access_token, shopCipher);
        out.tiktok_products = products.length;

        const posStock = await getPosStock();
        out.pos_skus_with_stock = Object.keys(posStock).length;

        // Map seller_sku → {product_id, sku_id, warehouse_id, tiktok_qty}
        const diffs = [];
        let mapped = 0, unmatched = 0;
        for (const p of products) {
            for (const sku of (p.skus || [])) {
                const sellerSku = (sku.seller_sku || '').toUpperCase();
                if (!sellerSku) { unmatched++; continue; }
                const inv = (sku.inventory || [])[0] || {};
                const ttQty = parseInt(inv.quantity, 10) || 0;
                const warehouseId = inv.warehouse_id || null;
                if (!(sellerSku in posStock)) { unmatched++; continue; }
                mapped++;
                const posQty = posStock[sellerSku];
                if (posQty !== ttQty) {
                    diffs.push({
                        seller_sku: sellerSku,
                        product_id: String(p.id),
                        sku_id: String(sku.id),
                        warehouse_id: warehouseId,
                        tiktok_qty: ttQty,
                        pos_qty: posQty
                    });
                }
            }
        }
        out.mapped_skus = mapped;
        out.unmatched_skus = unmatched;
        out.diffs = diffs.length;

        if (mode === 'dryrun') {
            out.sample_diffs = diffs.slice(0, 15);
            out.note = 'DRY RUN — nothing pushed. Add ?mode=push to apply.';
            return json(200, out);
        }

        // PUSH — updateInventory per product
        let pushed = 0, failed = 0;
        const errors = [];
        // group diffs by product_id
        const byProduct = {};
        for (const d of diffs) {
            if (!d.warehouse_id) { failed++; errors.push(`${d.seller_sku}: no warehouse_id`); continue; }
            (byProduct[d.product_id] = byProduct[d.product_id] || []).push(d);
        }
        for (const [productId, list] of Object.entries(byProduct)) {
            const body = {
                skus: list.map(d => ({
                    id: d.sku_id,
                    inventory: [{ warehouse_id: d.warehouse_id, quantity: d.pos_qty }]
                }))
            };
            const res = await ttRequest('POST', `/product/${VERSION}/products/${productId}/inventory/update`, {
                body, accessToken: tok.access_token, shopCipher
            });
            if (res.code === 0) pushed += list.length;
            else { failed += list.length; errors.push(`product ${productId}: ${res.message} (code ${res.code})`); }
        }
        out.pushed = pushed;
        out.failed = failed;
        if (errors.length) out.errors = errors.slice(0, 20);
        out.ok = failed === 0;
        return json(200, out);

    } catch (err) {
        out.error = String(err);
        return json(500, out);
    }
};
