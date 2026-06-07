/**
 * Marketplace image import — Netlify Function (p1_425).
 *
 * Fetches a product's images from Shopee and/or TikTok (using the persisted
 * mapping in products_master.metadata) and RETURNS the image URLs. Read-only:
 * it does NOT write to products_master — the client adds the URLs to the editor
 * gallery so the user reviews and clicks Save. Keeps full control with staff.
 *
 *   GET ?sku=BD040[&channel=shopee|tiktok|both]   (default both)
 *
 * Shopee: GET /api/v2/product/get_item_base_info -> item_list[].image.image_url_list
 * TikTok: GET /product/202309/products/{id}      -> data.main_images[].urls[]
 */

const shopee = require('./_shopee');
const tiktok = require('./_tiktok');

function json(statusCode, obj) {
    return {
        statusCode,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify(obj, null, 2)
    };
}

async function importShopee(meta, out) {
    const itemId = meta.shopee_item_id;
    if (!itemId) { out.shopee = { mapped: false }; return []; }
    try {
        const tok = await shopee.getValidToken();
        const r = await shopee.shopeeGet('/api/v2/product/get_item_base_info',
            { item_id_list: String(itemId) }, tok.access_token, tok.shop_id);
        if (r.error) { out.shopee = { mapped: true, error: r.error, message: r.message }; return []; }
        const item = ((r.response && r.response.item_list) || [])[0] || {};
        const urls = (item.image && item.image.image_url_list) || [];
        out.shopee = { mapped: true, found: urls.length };
        return urls;
    } catch (e) { out.shopee = { mapped: true, error: String(e) }; return []; }
}

async function importTiktok(meta, out) {
    const productId = meta.tiktok_product_id;
    if (!productId) { out.tiktok = { mapped: false }; return []; }
    try {
        const tok = await tiktok.getValidToken();
        const cipher = await tiktok.ensureShopCipher(tok);
        const r = await tiktok.ttRequest('GET', `/product/${tiktok.VERSION}/products/${productId}`,
            { accessToken: tok.access_token, shopCipher: cipher });
        if (r.code !== 0) { out.tiktok = { mapped: true, error: r.message, code: r.code }; return []; }
        const imgs = (r.data && r.data.main_images) || [];
        const urls = imgs.map(i => (i.urls && i.urls[0]) || '').filter(Boolean);
        out.tiktok = { mapped: true, found: urls.length };
        return urls;
    } catch (e) { out.tiktok = { mapped: true, error: String(e) }; return []; }
}

exports.handler = async (event) => {
    const q = event.queryStringParameters || {};
    const sku = (q.sku || '').trim().toUpperCase();
    const channel = (q.channel || 'both').toLowerCase();
    const out = { sku, images: [] };

    if (!sku) return json(400, { error: 'sku required (e.g. ?sku=BD040)' });
    if (!shopee.SERVICE_KEY) return json(500, { error: 'SUPABASE_SERVICE_KEY not set' });

    try {
        const rows = await shopee.sb('GET', `/products_master?select=sku,metadata&sku=eq.${encodeURIComponent(sku)}`);
        if (!rows || !rows.length) return json(404, { error: `SKU ${sku} not found in products_master` });
        const meta = (rows[0].metadata && typeof rows[0].metadata === 'object') ? rows[0].metadata : {};

        if (q.debug === 'tt' && meta.tiktok_product_id) {
            const tok = await tiktok.getValidToken();
            const cipher = await tiktok.ensureShopCipher(tok);
            const r = await tiktok.ttRequest('GET', `/product/${tiktok.VERSION}/products/${meta.tiktok_product_id}`,
                { accessToken: tok.access_token, shopCipher: cipher });
            return json(200, {
                code: r.code, message: r.message,
                skus: ((r.data && r.data.skus) || []).map(s => ({
                    id: s.id, seller_sku: s.seller_sku,
                    sku_img_url: (s.sku_img && s.sku_img.urls && s.sku_img.urls[0]) || (((s.sales_attributes || []).find(a => a.sku_img) || {}).sku_img || {}).urls && (((s.sales_attributes || []).find(a => a.sku_img) || {}).sku_img.urls[0]) || null
                }))
            });
        }

        const all = [];
        if (channel === 'both' || channel === 'shopee') all.push(...await importShopee(meta, out));
        if (channel === 'both' || channel === 'tiktok') all.push(...await importTiktok(meta, out));

        // de-dup + keep order
        const seen = new Set();
        out.images = all.filter(u => u && !seen.has(u) && seen.add(u));
        out.count = out.images.length;
        out.ok = true;
        if (!out.count) out.note = 'No images found (product may be unmapped on both channels, or the API returned none).';
        return json(200, out);
    } catch (err) {
        out.ok = false;
        out.error = String(err);
        return json(500, out);
    }
};
