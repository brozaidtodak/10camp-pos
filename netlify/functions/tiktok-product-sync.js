/**
 * TikTok Shop product compare — Netlify Function (p3_9 direct integration, Phase 4).
 *
 * READ-ONLY. POS does NOT push price or title to TikTok — decided 2026-05-18:
 * TikTok listings carry an intentional channel markup (~25% over POS price)
 * managed on the TikTok side. Pushing POS price/title would wipe the markup
 * and overwrite TikTok's SEO titles. This function only pulls TikTok product
 * data and compares it against POS, as a reference view.
 *
 * Query modes:
 *   ?mode=peek    (default) — products/search page 1, raw product shape.
 *   ?mode=compare           — build mapping, compare POS price/name vs TikTok
 *                             price/title, return the diff list. No write.
 *
 * Public URL: https://www.10camp.com/api/tiktok-product-sync
 * Signature: same HMAC-SHA256 scheme as the other tiktok-* functions.
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

// POS products: sku → { price, name }
async function getPosProducts() {
    const rows = await sb('GET', '/products_master?select=sku,name,price');
    const map = {};
    for (const r of (rows || [])) {
        const sku = (r.sku || '').toUpperCase();
        if (sku) map[sku] = { price: parseFloat(r.price) || 0, name: r.name || '' };
    }
    return map;
}

async function getTiktokProducts(accessToken, shopCipher) {
    const products = [];
    let pageToken = '';
    let guard = 0;
    do {
        const q = { page_size: 50 };
        if (pageToken) q.page_token = pageToken;
        const res = await ttRequest('POST', `/product/${VERSION}/products/search`, {
            query: q, body: { status: 'ACTIVATE' }, accessToken, shopCipher
        });
        if (res.code !== 0) throw new Error(`products/search failed: ${res.message} (code ${res.code})`);
        for (const p of ((res.data && res.data.products) || [])) products.push(p);
        pageToken = (res.data && res.data.next_page_token) || '';
    } while (pageToken && ++guard < 60);
    return products;
}

// Pull a price number out of a TikTok sku.price object (shape varies by API ver)
function ttSkuPrice(sku) {
    const p = sku.price || {};
    const v = p.sale_price || p.tax_exclusive_price || p.original_price || p.amount || p.list_price;
    return parseFloat(v) || 0;
}

exports.handler = async (event) => {
    if (!APP_KEY || !APP_SECRET) return json(500, { error: 'TIKTOK_APP_KEY / TIKTOK_APP_SECRET not set' });
    if (!SERVICE_KEY) return json(500, { error: 'SUPABASE_SERVICE_KEY not set' });

    const params = event.queryStringParameters || {};
    const mode = params.mode === 'compare' ? 'compare' : 'peek';
    const out = { mode };

    try {
        const tok = await getValidToken();
        const shopCipher = await ensureShopCipher(tok);

        if (mode === 'peek') {
            const res = await ttRequest('POST', `/product/${VERSION}/products/search`, {
                query: { page_size: 3 }, body: { status: 'ACTIVATE' },
                accessToken: tok.access_token, shopCipher
            });
            if (res.code !== 0) { out.error = `${res.message} (code ${res.code})`; return json(502, out); }
            out.raw_first_product = ((res.data && res.data.products) || [])[0] || null;
            return json(200, out);
        }

        const products = await getTiktokProducts(tok.access_token, shopCipher);
        const pos = await getPosProducts();
        out.tiktok_products = products.length;
        out.pos_products = Object.keys(pos).length;

        const priceDiffs = [];   // { product_id, sku_id, seller_sku, tiktok_price, pos_price }
        const titleDiffs = [];   // { product_id, seller_sku, tiktok_title, pos_title }
        let mapped = 0;

        for (const p of products) {
            let productMatched = false;
            for (const sku of (p.skus || [])) {
                const sellerSku = (sku.seller_sku || '').toUpperCase();
                if (!sellerSku || !(sellerSku in pos)) continue;
                mapped++;
                productMatched = true;
                const posP = pos[sellerSku];
                const ttPrice = ttSkuPrice(sku);
                if (posP.price > 0 && Math.abs(posP.price - ttPrice) >= 0.01) {
                    priceDiffs.push({
                        product_id: String(p.id), sku_id: String(sku.id), seller_sku: sellerSku,
                        tiktok_price: ttPrice, pos_price: posP.price
                    });
                }
            }
            // title compared once per product, using the first matched sku's POS name
            if (productMatched) {
                const firstSku = (p.skus || []).find(s => (s.seller_sku || '').toUpperCase() in pos);
                if (firstSku) {
                    const posName = pos[(firstSku.seller_sku || '').toUpperCase()].name;
                    if (posName && posName.trim() && posName.trim() !== (p.title || '').trim()) {
                        titleDiffs.push({
                            product_id: String(p.id),
                            seller_sku: (firstSku.seller_sku || '').toUpperCase(),
                            tiktok_title: p.title || '', pos_title: posName.trim()
                        });
                    }
                }
            }
        }
        out.mapped_skus = mapped;
        out.price_diffs = priceDiffs.length;
        out.title_diffs = titleDiffs.length;
        out.sample_price_diffs = priceDiffs.slice(0, 12);
        out.sample_title_diffs = titleDiffs.slice(0, 6);
        out.note = 'READ-ONLY compare. POS does NOT push price/title to TikTok — '
            + 'TikTok prices carry an intentional channel markup managed on TikTok.';
        return json(200, out);

    } catch (err) {
        out.error = String(err);
        return json(500, out);
    }
};
