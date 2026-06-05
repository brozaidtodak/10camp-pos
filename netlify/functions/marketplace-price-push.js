/**
 * Marketplace Price Push — Netlify Function (p1_295, "manage listing from POS").
 *
 * Pushes POS price (+ per-channel markup to cover marketplace commission) out to
 * Shopee + TikTok listings. POS becomes the price master.
 *
 *   base price = products_master.price_marketplace ?? products_master.price
 *   Shopee price = round2(base * (1 + SHOPEE_MARKUP%))
 *   TikTok price = round2(base * (1 + TIKTOK_MARKUP%))
 *
 * Modes (SAFE BY DEFAULT):
 *   ?mode=dryrun (default) — compute the plan, write NOTHING. Review first.
 *   ?mode=push             — actually update marketplace prices (LIVE, money!).
 * Markup override: ?shopee_markup=8&tiktok_markup=5  (percent)
 * Scope: POST {skus:[...]} or ?skus=A,B,C ; omit → all mapped products.
 *
 * Shopee: POST /api/v2/product/update_price {item_id, price_list:[{model_id, original_price}]}
 * TikTok: POST /product/202309/products/{id}/prices/update {skus:[{id, price:{amount,currency}}]}
 */

const shopee = require('./_shopee');
const tiktok = require('./_tiktok');

const DEFAULT_SHOPEE_MARKUP = 8;   // percent — covers ~Shopee commission+processing
const DEFAULT_TIKTOK_MARKUP = 5;   // percent — covers ~TikTok commission+processing
const CURRENCY = 'MYR';

function json(statusCode, obj) {
    return { statusCode, headers: { 'Content-Type': 'application/json; charset=utf-8' }, body: JSON.stringify(obj, null, 2) };
}
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

function parseSkus(event) {
    let skus = [];
    if (event.body) { try { const b = JSON.parse(event.body); if (Array.isArray(b.skus)) skus = b.skus; } catch (_) {} }
    const q = (event.queryStringParameters || {}).skus;
    if (!skus.length && q) skus = q.split(',');
    const seen = new Set(); const clean = [];
    for (const s of skus) {
        const sku = (s || '').trim().toUpperCase();
        if (!sku || sku.startsWith('CUSTOM-') || seen.has(sku)) continue;
        seen.add(sku); clean.push(sku);
    }
    return clean;
}

exports.handler = async (event) => {
    const p = event.queryStringParameters || {};
    const mode = p.mode === 'push' ? 'push' : 'dryrun';
    // channel: 'both' (default) | 'shopee' | 'tiktok'. Lets callers batch each
    // channel separately to stay under Netlify's function time limit.
    const channel = ['shopee', 'tiktok'].includes(p.channel) ? p.channel : 'both';
    const doShopee = channel === 'both' || channel === 'shopee';
    const doTiktok = channel === 'both' || channel === 'tiktok';
    const shopeeMarkup = p.shopee_markup != null ? Number(p.shopee_markup) : DEFAULT_SHOPEE_MARKUP;
    const tiktokMarkup = p.tiktok_markup != null ? Number(p.tiktok_markup) : DEFAULT_TIKTOK_MARKUP;
    const out = { mode, channel, shopee_markup_pct: shopeeMarkup, tiktok_markup_pct: tiktokMarkup };

    const skus = parseSkus(event);
    try {
        // Load products (scoped to skus, or all that are mapped to either channel)
        let path = '/products_master?select=sku,price,price_marketplace,metadata';
        if (skus.length) path += `&sku=in.(${skus.map(s => `"${s}"`).join(',')})`;
        const rows = await shopee.sb('GET', path) || [];

        // Build plan
        const plan = rows.map(r => {
            const m = (r.metadata && typeof r.metadata === 'object') ? r.metadata : {};
            const base = (r.price_marketplace != null ? Number(r.price_marketplace) : Number(r.price)) || 0;
            return {
                sku: (r.sku || '').toUpperCase(),
                base,
                shopee_price: round2(base * (1 + shopeeMarkup / 100)),
                tiktok_price: round2(base * (1 + tiktokMarkup / 100)),
                shopee_item_id: m.shopee_item_id || null,
                shopee_model_id: m.shopee_model_id != null ? m.shopee_model_id : null
            };
        }).filter(x => x.base > 0);

        out.products = plan.length;
        out.shopee_targets = plan.filter(x => x.shopee_item_id).length;

        if (mode === 'dryrun') {
            out.sample = plan.slice(0, 15).map(x => ({ sku: x.sku, base: x.base, shopee: x.shopee_price, tiktok: x.tiktok_price, shopee_mapped: !!x.shopee_item_id }));
            out.note = 'DRYRUN — nothing written. Add ?mode=push to apply (LIVE prices).';
            return json(200, out);
        }

        // ---- PUSH: Shopee (group by item_id) ----
        const shopeeRes = { pushed: 0, failed: 0, errors: [], skipped: !doShopee };
        const shopeeMapped = doShopee ? plan.filter(x => x.shopee_item_id) : [];
        if (shopeeMapped.length) {
            const tok = await shopee.getValidToken();
            const byItem = {};
            for (const x of shopeeMapped) {
                (byItem[String(x.shopee_item_id)] = byItem[String(x.shopee_item_id)] || []).push(x);
            }
            for (const [itemId, list] of Object.entries(byItem)) {
                const price_list = list.map(x => x.shopee_model_id != null
                    ? { model_id: Number(x.shopee_model_id), original_price: x.shopee_price }
                    : { original_price: x.shopee_price });
                const r = await shopee.shopeePost('/api/v2/product/update_price', {}, { item_id: Number(itemId), price_list }, tok.access_token, tok.shop_id);
                if (r.error) shopeeRes.errors.push({ item_id: itemId, error: r.error, message: r.message });
                else shopeeRes.pushed += list.length;
            }
            shopeeRes.failed = shopeeRes.errors.length;
        }
        out.shopee = shopeeRes;

        // ---- PUSH: TikTok (resolve product/sku via catalog, mapping not persisted) ----
        const tiktokRes = { pushed: 0, failed: 0, errors: [], unmatched: 0, skipped: !doTiktok };
        if (doTiktok) try {
            const tok = await tiktok.getValidToken();
            const cipher = await tiktok.ensureShopCipher(tok);
            const products = await tiktok.getTiktokProducts(tok.access_token, cipher);
            const want = new Map(plan.map(x => [x.sku, x.tiktok_price]));
            const bySku = {};
            for (const prod of products) {
                for (const sk of (prod.skus || [])) {
                    const sellerSku = (sk.seller_sku || '').toUpperCase();
                    if (!want.has(sellerSku)) continue;
                    (bySku[String(prod.id)] = bySku[String(prod.id)] || []).push({ id: String(sk.id), price: { amount: String(want.get(sellerSku)), currency: CURRENCY } });
                }
            }
            for (const [productId, skuList] of Object.entries(bySku)) {
                const r = await tiktok.ttRequest('POST', `/product/202309/products/${productId}/prices/update`, { body: { skus: skuList }, accessToken: tok.access_token, shopCipher: cipher });
                if (r.code === 0) tiktokRes.pushed += skuList.length;
                else tiktokRes.errors.push({ product_id: productId, code: r.code, message: r.message });
            }
            tiktokRes.failed = tiktokRes.errors.length;
        } catch (e) {
            tiktokRes.errors.push({ error: String(e).slice(0, 200) });
            tiktokRes.failed = 1;
        }
        out.tiktok = tiktokRes;

        out.ok = (shopeeRes.failed === 0) && (tiktokRes.failed === 0);
        return json(200, out);
    } catch (err) {
        out.error = String(err);
        return json(500, out);
    }
};
