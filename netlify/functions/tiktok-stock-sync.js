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
    getPosStock, getTiktokProducts, pushInventoryDiffs, getSyncDisabledSet
} = require('./_tiktok');

function json(statusCode, obj) {
    return {
        statusCode,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify(obj, null, 2)
    };
}

const { requireAuth } = require('./_auth'); // p1_787 (C1)
exports.handler = async (event) => {
    const __a = await requireAuth(event); if (!__a.ok) return __a.response;
    if (!APP_KEY || !APP_SECRET) return json(500, { error: 'TIKTOK_APP_KEY / TIKTOK_APP_SECRET not set' });
    if (!SERVICE_KEY) return json(500, { error: 'SUPABASE_SERVICE_KEY not set' });

    const params = event.queryStringParameters || {};
    const mode = ['dryrun', 'push', 'list'].includes(params.mode) ? params.mode : 'peek';
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

        // LIST — ALL products across every status (so staff see DRAFT vs LIVE), with
        // TikTok stock vs POS stock per SKU. Read-only (no push). Powers the Stock Sync view.
        if (mode === 'list') {
            const STATUSES = ['ACTIVATE', 'DRAFT', 'PENDING', 'FAILED', 'SELLER_DEACTIVATED', 'PLATFORM_DEACTIVATED', 'FREEZE'];
            const posStock = await getPosStock();
            const syncOff = await getSyncDisabledSet();
            const items = [];
            const statusCount = {};
            for (const st of STATUSES) {
                let pageToken = '', guard = 0;
                do {
                    const q = { page_size: 50 };
                    if (pageToken) q.page_token = pageToken;
                    const res = await ttRequest('POST', `/product/${VERSION}/products/search`, {
                        query: q, body: { status: st }, accessToken: tok.access_token, shopCipher
                    });
                    if (res.code !== 0) break; // status unsupported / empty → skip
                    const products = (res.data && res.data.products) || [];
                    for (const p of products) {
                        const skus = (p.skus || []).map(s => {
                            const sellerSku = (s.seller_sku || '').toUpperCase();
                            const inv = (s.inventory || [])[0] || {};
                            return {
                                seller_sku: s.seller_sku || '',
                                tiktok_qty: parseInt(inv.quantity, 10) || 0,
                                pos_qty: (sellerSku in posStock) ? posStock[sellerSku] : null,
                                sync_enabled: !syncOff.has(sellerSku)
                            };
                        });
                        // product sync = ON unless EVERY mapped SKU is turned off
                        const mapped = skus.filter(s => s.seller_sku);
                        const syncEnabled = mapped.length ? mapped.some(s => s.sync_enabled) : true;
                        items.push({ product_id: String(p.id), title: p.title || '', status: st, skus, sync_enabled: syncEnabled });
                        statusCount[st] = (statusCount[st] || 0) + 1;
                    }
                    pageToken = (res.data && res.data.next_page_token) || '';
                } while (pageToken && ++guard < 60);
            }
            out.status_count = statusCount;
            out.total = items.length;
            out.items = items;
            return json(200, out);
        }

        // DRYRUN / PUSH — build mapping + compare stock
        const products = await getTiktokProducts(tok.access_token, shopCipher);
        out.tiktok_products = products.length;

        const posStock = await getPosStock();
        out.pos_skus_with_stock = Object.keys(posStock).length;
        const syncOff = await getSyncDisabledSet(); // SKUs with sync turned OFF — skip
        out.sync_off_skus = syncOff.size;

        // Map seller_sku → {product_id, sku_id, warehouse_id, tiktok_qty}
        const diffs = [];
        let mapped = 0, unmatched = 0, skipped_off = 0;
        for (const p of products) {
            for (const sku of (p.skus || [])) {
                const sellerSku = (sku.seller_sku || '').toUpperCase();
                if (!sellerSku) { unmatched++; continue; }
                if (syncOff.has(sellerSku)) { skipped_off++; continue; } // sync OFF for this SKU
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
        out.skipped_sync_off = skipped_off;
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
