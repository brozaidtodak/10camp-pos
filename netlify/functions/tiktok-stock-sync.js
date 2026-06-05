/**
 * TikTok Shop stock sync — Netlify Function (p3_9 direct integration, Phase 3).
 *
 * FULL reconcile: pushes POS stock levels OUT to TikTok Shop so the marketplace
 * never oversells. For the targeted per-sale push see tiktok-stock-push.js.
 *
 * Query modes:
 *   ?mode=peek    (default) — searchProducts page 1, return raw product shape.
 *   ?mode=dryrun            — build full seller_sku↔TikTok mapping, compare POS
 *                             stock vs TikTok stock, return the diff plan. No push.
 *   ?mode=push              — apply the diffs via updateInventory.
 *
 * Public URL: https://www.10camp.com/api/tiktok-stock-sync
 *
 * Shared TikTok API logic lives in _tiktok.js (signing, token, products, push).
 *
 * Cutover note: EasyStore's TikTok channel was disconnected 2026-05-25 (p1_105),
 * so POS is now the sole source of truth for TikTok stock — safe to push.
 */

const {
    VERSION, APP_KEY, APP_SECRET, SERVICE_KEY,
    ttRequest, getValidToken, ensureShopCipher,
    getPosStock, getTiktokProducts, pushInventoryDiffs
} = require('./_tiktok');

function json(statusCode, obj) {
    return {
        statusCode,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify(obj, null, 2)
    };
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
                query: { page_size: 5 }, body: { status: 'ACTIVATE' },
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

        // PUSH — updateInventory per product (shared helper)
        const res = await pushInventoryDiffs(tok, shopCipher, diffs);
        out.pushed = res.pushed;
        out.failed = res.failed;
        if (res.errors.length) out.errors = res.errors.slice(0, 20);
        out.ok = res.failed === 0;
        return json(200, out);

    } catch (err) {
        out.error = String(err);
        return json(500, out);
    }
};
