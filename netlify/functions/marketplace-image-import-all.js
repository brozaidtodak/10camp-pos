/**
 * Bulk marketplace image import — Netlify Function (p1_430).
 *
 * Fills products_master.images from TikTok for every mapped product whose
 * gallery is thin (<= 1 image). Groups by tiktok_product_id so it fetches the
 * product gallery ONCE and applies it to all variants in the group — efficient.
 *
 * Batched to stay under Netlify's time limit: each call processes up to `limit`
 * product groups (default 15). Call repeatedly until remaining_before = 0.
 *
 *   GET ?limit=15        — process up to 15 groups that still need images
 *
 * Returns { remaining_before, processed, filled_groups, variants_filled, more }.
 */

const shopee = require('./_shopee');
const tiktok = require('./_tiktok');

function json(statusCode, obj) {
    return { statusCode, headers: { 'Content-Type': 'application/json; charset=utf-8' }, body: JSON.stringify(obj, null, 2) };
}

function imgCount(images) {
    if (Array.isArray(images)) return images.length;
    if (typeof images === 'string') { try { const a = JSON.parse(images); return Array.isArray(a) ? a.length : 0; } catch (_) { return images ? 1 : 0; } }
    return 0;
}

exports.handler = async (event) => {
    const q = event.queryStringParameters || {};
    const limit = Math.min(parseInt(q.limit, 10) || 15, 40);
    const out = { limit };
    if (!shopee.SERVICE_KEY) return json(500, { error: 'SUPABASE_SERVICE_KEY not set' });

    try {
        const rows = await shopee.sb('GET', '/products_master?select=sku,images,metadata&limit=10000') || [];
        // group by tiktok_product_id; a group "needs fill" if ANY variant has <=1 image
        const groups = {};
        for (const r of rows) {
            const m = (r.metadata && typeof r.metadata === 'object') ? r.metadata : {};
            const pid = m.tiktok_product_id;
            if (!pid) continue;
            const g = groups[pid] = groups[pid] || { skus: [], needs: false };
            g.skus.push(r.sku);
            if (imgCount(r.images) <= 1) g.needs = true;
        }
        const pids = Object.keys(groups).filter(pid => groups[pid].needs).sort();
        out.remaining_before = pids.length;
        const slice = pids.slice(0, limit);
        out.processed = slice.length;
        if (!slice.length) { out.done = true; out.more = false; out.note = 'All mapped galleries filled.'; return json(200, out); }

        const tok = await tiktok.getValidToken();
        const cipher = await tiktok.ensureShopCipher(tok);
        let filled = 0, variantsFilled = 0, noImg = 0; const errors = [];
        for (const pid of slice) {
            try {
                const r = await tiktok.ttRequest('GET', `/product/${tiktok.VERSION}/products/${pid}`,
                    { accessToken: tok.access_token, shopCipher: cipher });
                if (r.code !== 0) { errors.push({ pid, code: r.code, msg: r.message }); continue; }
                const imgs = ((r.data && r.data.main_images) || []).map(i => (i.urls && i.urls[0]) || '').filter(Boolean);
                if (!imgs.length) { noImg++; continue; }
                const skuList = groups[pid].skus.map(s => `"${s}"`).join(',');
                await shopee.sb('PATCH', `/products_master?sku=in.(${skuList})`, { images: imgs }, { Prefer: 'return=minimal' });
                filled++; variantsFilled += groups[pid].skus.length;
            } catch (e) { errors.push({ pid, err: String(e).slice(0, 150) }); }
        }
        out.filled_groups = filled;
        out.variants_filled = variantsFilled;
        out.no_images = noImg;
        out.remaining_after = pids.length - filled;
        out.more = out.remaining_after > 0;
        if (errors.length) out.errors = errors.slice(0, 10);
        out.ok = true;
        return json(200, out);
    } catch (err) {
        out.ok = false; out.error = String(err);
        return json(500, out);
    }
};
