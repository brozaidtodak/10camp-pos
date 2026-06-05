/**
 * _shopee.js — shared Shopee Open Platform API helpers.
 *
 * Files prefixed with "_" are ignored by Netlify's function scanner, so this is
 * a private module, not a deployed endpoint. Used by the targeted per-sale stock
 * push (shopee-stock-push.js, Lubang B Shopee). Mirrors the helper set that lives
 * inline in shopee-stock-sync.js / shopee-sync.js.
 *
 * Sign formula (shop-scoped):
 *   base = partner_id + path + timestamp + access_token + shop_id
 *   sign = HMAC-SHA256(base, partner_key) → lowercase hex
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

async function shopeePost(path, extraQuery, bodyObj, accessToken, shopId) {
    const timestamp = Math.floor(Date.now() / 1000);
    const sign = signShop(path, timestamp, accessToken, shopId);
    const q = Object.assign({
        partner_id: PARTNER_ID, timestamp, access_token: accessToken, shop_id: shopId, sign
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
    return rows[0]; // refresh logic lives in shopee-sync.js; the 15-min cron keeps it fresh
}

// POS stock = SUM(inventory_batches.qty_remaining) per sku.
// Optional `skus` array → only fetch those SKUs (targeted push efficiency).
async function loadPosStock(skus) {
    let path = '/inventory_batches?select=sku,qty_remaining';
    if (Array.isArray(skus) && skus.length) {
        const list = skus.map(s => `"${(s || '').toUpperCase()}"`).join(',');
        path += `&sku=in.(${list})`;
    } else {
        path += '&limit=10000';
    }
    const rows = await sb('GET', path);
    const bySku = {};
    for (const r of (rows || [])) {
        const sku = (r.sku || '').toUpperCase().trim();
        if (!sku) continue;
        bySku[sku] = (bySku[sku] || 0) + Number(r.qty_remaining || 0);
    }
    return bySku;
}

module.exports = {
    PARTNER_ID, PARTNER_KEY, ENV, HOST, SERVICE_KEY,
    sb, signShop, shopeePost, getValidToken, loadPosStock
};
