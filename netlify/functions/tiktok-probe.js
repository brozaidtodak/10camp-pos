/**
 * tiktok-probe.js — TEMPORARY read-only discovery probe for Cara B (auto-create
 * product on TikTok Seller Centre). Calls only GET / category-recommend endpoints;
 * creates / edits NOTHING. Gated by TIKTOK_PROBE_KEY (Netlify env, not in repo).
 *
 * Usage:
 *   /.netlify/functions/tiktok-probe?key=XXX
 *   /.netlify/functions/tiktok-probe?key=XXX&title=Chanodug%20Tent&category_id=601226
 *
 * Delete after Cara B discovery is done.
 */
const tt = require('./_tiktok');
const V = tt.VERSION;

exports.handler = async (event) => {
    const p = (event.queryStringParameters) || {};
    if (!process.env.TIKTOK_PROBE_KEY || p.key !== process.env.TIKTOK_PROBE_KEY) {
        return { statusCode: 403, body: 'forbidden' };
    }
    const out = {};
    const safe = async (label, fn) => {
        try { out[label] = await fn(); }
        catch (e) { out[label] = { __error: String((e && e.message) || e) }; }
    };

    let tok, cipher;
    try {
        tok = await tt.getValidToken();
        cipher = await tt.ensureShopCipher(tok);
        out.shop = { shop_id: tok.shop_id, has_cipher: !!cipher };
    } catch (e) {
        return { statusCode: 500, body: 'auth failed: ' + String((e && e.message) || e) };
    }
    const at = tok.access_token;

    // 1) Warehouses — need a warehouse_id for inventory on create
    await safe('warehouses', () =>
        tt.ttRequest('GET', `/logistics/${V}/warehouses`, { accessToken: at, shopCipher: cipher }));

    // 2) Brands (first page) — is brand required? what shape?
    await safe('brands', () =>
        tt.ttRequest('GET', `/product/${V}/brands`, { query: { page_size: 5 }, accessToken: at, shopCipher: cipher }));

    // 3) Category recommendation by product title — the auto-mapping engine for Cara B
    const title = p.title || 'Chanodug Outdoor Camping Tent 4 Person Waterproof';
    await safe('category_recommend', () =>
        tt.ttRequest('POST', `/product/${V}/categories/recommend`, {
            body: { product_title: title }, accessToken: at, shopCipher: cipher }));

    // 4) Full category tree size check (don't dump all — just count + sample leaves)
    await safe('categories_meta', async () => {
        const r = await tt.ttRequest('GET', `/product/${V}/categories`, {
            query: { category_version: 'v1' }, accessToken: at, shopCipher: cipher });
        const cats = (r.data && r.data.categories) || [];
        const leaves = cats.filter(c => c.is_leaf);
        return { code: r.code, message: r.message, total: cats.length, leaf_count: leaves.length,
                 sample_leaves: leaves.slice(0, 5) };
    });

    // 5) If a category_id is supplied, fetch its required attributes + rules (certs?)
    if (p.category_id) {
        await safe('attributes', () =>
            tt.ttRequest('GET', `/product/${V}/categories/${encodeURIComponent(p.category_id)}/attributes`, {
                query: { category_version: 'v1' }, accessToken: at, shopCipher: cipher }));
        await safe('rules', () =>
            tt.ttRequest('GET', `/product/${V}/categories/${encodeURIComponent(p.category_id)}/rules`, {
                query: { category_version: 'v1' }, accessToken: at, shopCipher: cipher }));
    }

    return { statusCode: 200, headers: { 'content-type': 'application/json' },
             body: JSON.stringify(out, null, 2) };
};
