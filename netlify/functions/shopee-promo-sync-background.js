/**
 * shopee-promo-sync-background.js — pull ONGOING Shopee discounts and write a snapshot
 * onto products_master.shopee_campaign per SKU (with below_cost flag). Mirrors
 * tiktok-promo-sync-background. Background fn (15-min budget); triggered by cron.
 *
 * Modes: ?mode=peek (raw shape, no write) | ?mode=sync (map + write).
 * Shopee Discount API: GET /api/v2/discount/get_discount_list + /api/v2/discount/get_discount.
 */
const sp = require('./_shopee');

function json(code, obj) {
    return { statusCode: code, headers: { 'Content-Type': 'application/json; charset=utf-8' }, body: JSON.stringify(obj, null, 2) };
}

async function getOngoingDiscounts(tok) {
    const ids = [];
    let page = 1, guard = 0;
    do {
        const r = await sp.shopeeGet('/api/v2/discount/get_discount_list',
            { discount_status: 'ongoing', page_size: 100, page_no: page }, tok.access_token, tok.shop_id);
        if (r.error) throw new Error(`get_discount_list: ${r.error} ${r.message || ''}`);
        const resp = r.response || {};
        for (const d of (resp.discount_list || [])) ids.push(d);
        if (!resp.more) break;
        page++;
    } while (++guard < 20);
    return ids;
}

async function getDiscountDetail(tok, discountId) {
    const items = [];
    let name = '', start = null, end = null;
    let page = 1, guard = 0;
    do {
        const r = await sp.shopeeGet('/api/v2/discount/get_discount',
            { discount_id: discountId, page_size: 100, page_no: page }, tok.access_token, tok.shop_id);
        if (r.error) throw new Error(`get_discount ${discountId}: ${r.error} ${r.message || ''}`);
        const resp = r.response || {};
        name = resp.discount_name || name;
        start = resp.start_time || start; end = resp.end_time || end;
        for (const it of (resp.item_list || [])) items.push(it);
        if (!resp.more) break;
        page++;
    } while (++guard < 50);
    return { name, start, end, items };
}

const isoFromUnix = (s) => (s ? new Date(Number(s) * 1000).toISOString() : null);

// Desired shopee_campaign per seller_sku from ongoing discounts.
async function buildShopeeCampaignMap(tok, posByItem, posByModel) {
    const discounts = await getOngoingDiscounts(tok);
    const map = {};
    for (const d of discounts) {
        const det = await getDiscountDetail(tok, d.discount_id);
        const name = det.name || d.discount_name || 'Shopee Discount';
        const starts = isoFromUnix(det.start || d.start_time);
        const ends = isoFromUnix(det.end || d.end_time);
        const assign = (sku, base, promo) => {
            if (!sku || promo == null) return;
            const b = parseFloat(base) || 0, p = parseFloat(promo) || 0;
            const pct = (b > 0 && p > 0) ? Math.round((1 - p / b) * 100) : null;
            map[sku] = {
                active: true, name, type: 'DISCOUNT',
                discount_type: pct != null ? 'percentage' : 'fixed_price',
                discount_value: pct, base_price: b || null, promo_price: +p.toFixed(2),
                starts_at: starts, ends_at: ends
            };
        };
        for (const it of (det.items || [])) {
            if (Array.isArray(it.model_list) && it.model_list.length) {
                for (const m of it.model_list)
                    assign(posByModel[String(m.model_id)], m.model_original_price, m.model_promotion_price);
            } else {
                assign(posByItem[String(it.item_id)], it.item_original_price, it.item_promotion_price);
            }
        }
    }
    return map;
}

exports.handler = async (event) => {
    const params = (event && event.queryStringParameters) || {};
    const mode = params.mode === 'sync' ? 'sync' : 'peek';
    try {
        const tok = await sp.getValidToken();

        if (mode === 'peek') {
            const discounts = await getOngoingDiscounts(tok);
            const out = { mode, ongoing_discounts: discounts.length, first_discount: discounts[0] || null };
            if (discounts[0]) {
                const det = await getDiscountDetail(tok, discounts[0].discount_id);
                out.first_detail_name = det.name;
                out.first_detail_item_sample = (det.items || []).slice(0, 3);
            }
            return json(200, out);
        }

        // ---- sync ----
        const rows = await sp.sb('GET', '/products_master?select=sku,cost_price,metadata,shopee_campaign');
        const cost = {}, current = {}, byItem = {}, byModel = {};
        for (const r of rows) {
            const s = (r.sku || '').toUpperCase();
            cost[s] = parseFloat(r.cost_price) || 0;
            current[s] = r.shopee_campaign || null;
            const m = r.metadata || {};
            if (m.shopee_item_id) byItem[String(m.shopee_item_id)] = s;
            if (m.shopee_model_id) byModel[String(m.shopee_model_id)] = s;
        }
        const desired = await buildShopeeCampaignMap(tok, byItem, byModel);
        const now = new Date().toISOString();
        let belowCostCount = 0; const belowCostSkus = [];
        const sig = (c) => c ? JSON.stringify([c.active, c.promo_price, c.below_cost, c.discount_value, c.ends_at, c.name]) : 'null';
        const setRows = [], clearRows = [];
        for (const [sku, camp] of Object.entries(desired)) {
            if (!(sku in cost)) continue;
            camp.below_cost = (cost[sku] > 0 && camp.promo_price != null && camp.promo_price < cost[sku]);
            camp.synced_at = now;
            if (camp.below_cost) { belowCostCount++; belowCostSkus.push({ sku, promo_price: camp.promo_price, cost: cost[sku] }); }
            if (sig(current[sku]) !== sig(camp)) setRows.push({ sku, shopee_campaign: camp });
        }
        for (const [sku, cur] of Object.entries(current))
            if (cur && cur.active && !(sku in desired)) clearRows.push({ sku, shopee_campaign: null });

        const all = setRows.concat(clearRows);
        const chunk = (arr, n) => { const o = []; for (let i = 0; i < arr.length; i += n) o.push(arr.slice(i, i + n)); return o; };
        for (const c of chunk(all, 25))
            await Promise.all(c.map(r => sp.sb('PATCH', `/products_master?sku=eq.${encodeURIComponent(r.sku)}`,
                { shopee_campaign: r.shopee_campaign }, { Prefer: 'return=minimal' })));

        return json(200, {
            mode, promo_skus: Object.keys(desired).length, updated: setRows.length, cleared: clearRows.length,
            below_cost_count: belowCostCount, below_cost: belowCostSkus, synced_at: now
        });
    } catch (err) {
        return json(500, { mode, error: String(err) });
    }
};
