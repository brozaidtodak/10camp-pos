/**
 * Shopee targeted stock push — Netlify Function (Lubang B Shopee, p1_291).
 *
 * Pushes the CURRENT POS stock level of a small set of SKUs out to Shopee.
 * Called fire-and-forget by the cashier counter (app.js) right after a sale so
 * Shopee reflects the new stock within seconds — the outbound half of "stok auto
 * 2-hala" for Shopee. For a full catalog reconcile see shopee-stock-sync.js.
 *
 * Input (either form):
 *   POST body: { "skus": ["TENT-01", "LAMP-01"] }
 *   GET query: ?skus=TENT-01,LAMP-01   (handy for manual testing)
 *
 * Uses the PERSISTED mapping in products_master.metadata (shopee_item_id +
 * shopee_model_id) so no full catalog pull is needed — efficient.
 *
 * Safe even while EasyStore still syncs Shopee: update_stock sets an ABSOLUTE
 * stock value (not a decrement), so a parallel EasyStore push just writes the
 * same number — no double-deduction.
 *
 * Shared Shopee API logic lives in _shopee.js.
 */

const {
    PARTNER_ID, PARTNER_KEY, ENV, SERVICE_KEY,
    sb, shopeePost, getValidToken, loadPosStock
} = require('./_shopee');

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
    if (!PARTNER_ID || !PARTNER_KEY) return json(500, { error: 'SHOPEE_PARTNER_ID / SHOPEE_PARTNER_KEY not set' });
    if (!SERVICE_KEY) return json(500, { error: 'SUPABASE_SERVICE_KEY not set' });

    const skus = parseSkus(event);
    const out = { env: ENV, requested: skus.length };
    if (!skus.length) { out.note = 'No SKUs supplied — nothing to push.'; return json(200, out); }

    try {
        const tok = await getValidToken();
        out.shop_id = tok.shop_id;

        // Resolve mapping (shopee_item_id + shopee_model_id) + current POS stock.
        const list = skus.map(s => `"${s}"`).join(',');
        const [rows, posStock] = await Promise.all([
            sb('GET', `/products_master?select=sku,metadata&sku=in.(${list})`),
            loadPosStock(skus)
        ]);

        // Group stock updates per Shopee item_id.
        const byItem = {};     // item_id -> [{ model_id, stock }]
        const mapped = [];
        const unmapped = [];
        for (const sku of skus) {
            const row = (rows || []).find(r => (r.sku || '').toUpperCase() === sku);
            const m = (row && row.metadata && typeof row.metadata === 'object') ? row.metadata : {};
            if (!m.shopee_item_id) { unmapped.push(sku); continue; }
            const itemId = String(m.shopee_item_id);
            const modelId = m.shopee_model_id != null ? Number(m.shopee_model_id) : 0;
            const qty = posStock[sku] || 0;
            (byItem[itemId] = byItem[itemId] || []).push({ model_id: modelId || 0, seller_stock: [{ stock: qty }] });
            mapped.push(sku);
        }

        out.mapped = mapped.length;
        out.unmapped = unmapped;

        let pushed = 0;
        const errors = [];
        for (const [itemId, stockList] of Object.entries(byItem)) {
            const r = await shopeePost('/api/v2/product/update_stock', {}, {
                item_id: Number(itemId),
                stock_list: stockList
            }, tok.access_token, tok.shop_id);
            if (r.error) errors.push({ item_id: itemId, error: r.error, message: r.message });
            else pushed += stockList.length;
        }

        out.pushed = pushed;
        if (errors.length) out.errors = errors.slice(0, 20);
        out.ok = errors.length === 0;
        if (!Object.keys(byItem).length) out.note = 'None of these SKUs are mapped to Shopee (run mapping first).';
        return json(200, out);

    } catch (err) {
        out.error = String(err);
        return json(500, out);
    }
};
