/**
 * TikTok Shop targeted stock push — Netlify Function (Lubang B, p1_285).
 *
 * Pushes the CURRENT POS stock level of a small set of SKUs out to TikTok Shop.
 * Called fire-and-forget by the cashier counter (app.js) right after a sale so
 * TikTok reflects the new stock within seconds — the outbound half of "stok auto
 * 2-hala". For a full catalog reconcile see tiktok-stock-sync.js.
 *
 * Input (either form):
 *   POST body: { "skus": ["TENT-01", "LAMP-01"] }
 *   GET query: ?skus=TENT-01,LAMP-01   (handy for manual testing)
 *
 * Safe to run: EasyStore's TikTok channel was disconnected 2026-05-25 (p1_105),
 * so POS is the sole source of truth for TikTok stock — no double-push fight.
 *
 * Shared TikTok API logic lives in _tiktok.js.
 */

const {
    APP_KEY, APP_SECRET, SERVICE_KEY,
    getValidToken, ensureShopCipher,
    getPosStock, getTiktokProducts, pushInventoryDiffs
} = require('./_tiktok');

function json(statusCode, obj) {
    return {
        statusCode,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify(obj, null, 2)
    };
}

function parseSkus(event) {
    let skus = [];
    if (event.body) {
        try { const b = JSON.parse(event.body); if (Array.isArray(b.skus)) skus = b.skus; } catch (_) {}
    }
    const q = (event.queryStringParameters || {}).skus;
    if (!skus.length && q) skus = q.split(',');
    // normalise: uppercase, trim, drop blanks + CUSTOM-* (no marketplace mapping), dedupe
    const seen = new Set();
    const clean = [];
    for (const s of skus) {
        const sku = (s || '').trim().toUpperCase();
        if (!sku || sku.startsWith('CUSTOM-') || seen.has(sku)) continue;
        seen.add(sku); clean.push(sku);
    }
    return clean;
}

exports.handler = async (event) => {
    if (!APP_KEY || !APP_SECRET) return json(500, { error: 'TIKTOK_APP_KEY / TIKTOK_APP_SECRET not set' });
    if (!SERVICE_KEY) return json(500, { error: 'SUPABASE_SERVICE_KEY not set' });

    const skus = parseSkus(event);
    const out = { requested: skus.length };
    if (!skus.length) { out.note = 'No SKUs supplied — nothing to push.'; return json(200, out); }

    try {
        const tok = await getValidToken();
        const shopCipher = await ensureShopCipher(tok);

        // Mapping isn't persisted yet, so pull the catalog to resolve
        // seller_sku → {product_id, sku_id, warehouse_id}. (Future: cache this.)
        const [products, posStock] = await Promise.all([
            getTiktokProducts(tok.access_token, shopCipher),
            getPosStock(skus)
        ]);

        const want = new Set(skus);
        const diffs = [];
        const matched = [];
        for (const p of products) {
            for (const sku of (p.skus || [])) {
                const sellerSku = (sku.seller_sku || '').toUpperCase();
                if (!want.has(sellerSku)) continue;
                const inv = (sku.inventory || [])[0] || {};
                const ttQty = parseInt(inv.quantity, 10) || 0;
                const posQty = posStock[sellerSku] || 0;
                matched.push(sellerSku);
                if (posQty !== ttQty) {
                    diffs.push({
                        seller_sku: sellerSku,
                        product_id: String(p.id),
                        sku_id: String(sku.id),
                        warehouse_id: inv.warehouse_id || null,
                        tiktok_qty: ttQty,
                        pos_qty: posQty
                    });
                }
            }
        }

        out.matched = matched.length;
        out.unmatched = skus.filter(s => !matched.includes(s));
        out.to_push = diffs.length;

        if (diffs.length) {
            const res = await pushInventoryDiffs(tok, shopCipher, diffs);
            out.pushed = res.pushed;
            out.failed = res.failed;
            if (res.errors.length) out.errors = res.errors.slice(0, 20);
            out.ok = res.failed === 0;
        } else {
            out.pushed = 0;
            out.ok = true;
            out.note = 'TikTok already matches POS for these SKUs — nothing to push.';
        }
        return json(200, out);

    } catch (err) {
        out.error = String(err);
        return json(500, out);
    }
};
