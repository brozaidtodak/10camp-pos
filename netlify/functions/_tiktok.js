/**
 * _tiktok.js — shared TikTok Shop API helpers.
 *
 * Files prefixed with "_" are ignored by Netlify's function scanner, so this is
 * a private module, not a deployed endpoint. Extracted from tiktok-stock-sync.js
 * so both the full reconcile (tiktok-stock-sync) and the targeted per-sale push
 * (tiktok-stock-push, Lubang B) share ONE copy of the signing / token / product
 * logic instead of duplicating it.
 *
 * Signature: HMAC-SHA256(app_secret + path + sortedParams + body + app_secret),
 * lowercase hex (same formula as tiktok-sync.js).
 */

const crypto = require('crypto');

const API_BASE   = 'https://open-api.tiktokglobalshop.com';
const TOKEN_BASE = 'https://auth.tiktok-shops.com/api/v2/token';
const VERSION    = '202309';

const APP_KEY      = process.env.TIKTOK_APP_KEY || '';
const APP_SECRET   = process.env.TIKTOK_APP_SECRET || '';
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://asehjdnfzoypbwfeazra.supabase.co';
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY || '';

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

// POS stock = SUM(inventory_batches.qty_remaining) per sku.
// Optional `skus` array → only fetch those SKUs (targeted push efficiency).
async function getPosStock(skus) {
    let path = '/inventory_batches?select=sku,qty_remaining';
    if (Array.isArray(skus) && skus.length) {
        // p1_789 (M5) — escape + URL-encode each value so a SKU with special chars can't break in.()
        const list = skus.map(s => encodeURIComponent('"' + String(s || '').toUpperCase().replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"')).join(',');
        path += `&sku=in.(${list})`;
    }
    const rows = await sb('GET', path);
    const map = {};
    for (const r of (rows || [])) {
        const sku = (r.sku || '').toUpperCase();
        if (!sku) continue;
        map[sku] = (map[sku] || 0) + (parseInt(r.qty_remaining, 10) || 0);
    }
    return map;
}

// Pull all ACTIVATE TikTok products + their SKUs (paginated).
async function getTiktokProducts(accessToken, shopCipher) {
    const products = [];
    let pageToken = '';
    let guard = 0;
    do {
        const q = { page_size: 50 };
        if (pageToken) q.page_token = pageToken;
        const res = await ttRequest('POST', `/product/${VERSION}/products/search`, {
            query: q, body: { status: 'ACTIVATE' },
            accessToken, shopCipher
        });
        if (res.code !== 0) throw new Error(`products/search failed: ${res.message} (code ${res.code})`);
        for (const p of ((res.data && res.data.products) || [])) products.push(p);
        pageToken = (res.data && res.data.next_page_token) || '';
    } while (pageToken && ++guard < 60);
    return products;
}

// Push a list of diffs to TikTok via inventory/update, grouped per product.
//   diffs: [{ seller_sku, product_id, sku_id, warehouse_id, pos_qty }]
// Returns { pushed, failed, errors }.
async function pushInventoryDiffs(tok, shopCipher, diffs) {
    let pushed = 0, failed = 0;
    const errors = [];
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
    return { pushed, failed, errors };
}

// SKUs (uppercase) whose POS product has metadata.tiktok_sync_enabled === false.
// Stock pushes (full reconcile + per-sale) must SKIP these so a manually-managed
// listing isn't overwritten. Fails OPEN (empty set) on read error — never blocks sync.
async function getSyncDisabledSet() {
    const set = new Set();
    try {
        const rows = await sb('GET', "/products_master?select=sku&metadata->>tiktok_sync_enabled=eq.false");
        for (const r of (rows || [])) { const s = (r.sku || '').toUpperCase(); if (s) set.add(s); }
    } catch (e) { /* fail open */ }
    return set;
}

module.exports = {
    VERSION, APP_KEY, APP_SECRET, SERVICE_KEY,
    sb, signRequest, ttRequest, getValidToken, ensureShopCipher,
    getPosStock, getTiktokProducts, pushInventoryDiffs, getSyncDisabledSet
};
