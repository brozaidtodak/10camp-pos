/**
 * price-sentinel-background.js — Integration hardening #2 (p1_633).
 * Daily: pull LIVE TikTok prices, compare each mapped product's effective price
 * (live × (1 − active campaign discount)) against COST, and the live base price
 * against the POS intended price (tiktok_price). Flags:
 *   below_cost — effective live price < cost (BD069 class)
 *   drift      — live base differs from POS price by > DRIFT_PCT (push failed / changed on marketplace)
 * Writes findings to price_sentinel (replaced each run). Background fn; cron-triggered.
 *
 * ?mode=peek returns the computed findings without writing (test).
 */
const tt = require('./_tiktok');

const sp = require('./_shopee');

const DRIFT_PCT = 30;   // % gap between live and POS price to flag as drift
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const chunk = (arr, n) => { const o = []; for (let i = 0; i < arr.length; i += n) o.push(arr.slice(i, i + n)); return o; };
// p1_658 — floor (base) price = floor_price ?? cost/(1−floor_margin%) ?? cost. Mirrors marketplace-price-push.
const floorFor = (cost, floorPrice, floorMarginPct) => {
    const fp = parseFloat(floorPrice) || 0;
    if (fp > 0) return fp;
    const fm = parseFloat(floorMarginPct) || 0;
    if (cost > 0 && fm > 0) return round2(cost / (1 - Math.min(fm, 90) / 100));
    return cost;
};
const marginPct = (price, cost) => (price > 0 ? Math.round((price - cost) / price * 100) : 0);

function json(code, obj) {
    return { statusCode: code, headers: { 'Content-Type': 'application/json; charset=utf-8' }, body: JSON.stringify(obj, null, 2) };
}
function ttSkuPrice(sku) {
    const p = sku.price || {};
    const v = p.sale_price || p.tax_exclusive_price || p.original_price || p.amount || p.list_price;
    return parseFloat(v) || 0;
}

async function computeTiktok() {
    const tok = await tt.getValidToken();
    const cipher = await tt.ensureShopCipher(tok);
    const products = await tt.getTiktokProducts(tok.access_token, cipher);
    // live base price by seller_sku
    const live = {};
    for (const p of products) for (const s of (p.skus || [])) {
        const ss = (s.seller_sku || '').toUpperCase();
        if (ss) live[ss] = ttSkuPrice(s);
    }
    const rows = await tt.sb('GET', '/products_master?select=sku,cost_price,tiktok_price,tiktok_campaign,floor_price,floor_margin_pct&metadata->>tiktok_sku_id=not.is.null');
    const findings = [];
    let checked = 0;
    for (const r of rows) {
        const sku = (r.sku || '').toUpperCase();
        const lp = live[sku];
        if (lp == null || lp <= 0) continue; // not live / no price
        checked++;
        const cost = parseFloat(r.cost_price) || 0;
        const pos = parseFloat(r.tiktok_price) || 0;
        const camp = r.tiktok_campaign && r.tiktok_campaign.active ? r.tiktok_campaign : null;
        const disc = camp && camp.discount_value != null ? Number(camp.discount_value) : 0;
        const eff = round2(lp * (1 - disc / 100));
        const floor = floorFor(cost, r.floor_price, r.floor_margin_pct);
        if (cost > 0 && eff < cost) {
            findings.push({ sku, platform: 'TikTok', flag: 'below_cost', live_price: lp, effective_price: eff, cost, pos_price: pos, campaign_disc: disc || null,
                detail: `Live ${lp}${disc ? ` −${disc}% = ${eff}` : ''} < kos ${cost}` });
        } else if (floor > cost && eff < floor) {
            findings.push({ sku, platform: 'TikTok', flag: 'below_floor', live_price: lp, effective_price: eff, cost, pos_price: pos, campaign_disc: disc || null,
                detail: `Jual ${eff}${disc ? ` (${disc}% off ${lp})` : ''} < floor 35% ${floor} (margin ${marginPct(eff, cost)}%)` });
        } else if (pos > 0 && lp > 0 && Math.abs(lp - pos) / pos > DRIFT_PCT / 100) {
            findings.push({ sku, platform: 'TikTok', flag: 'drift', live_price: lp, effective_price: eff, cost, pos_price: pos, campaign_disc: disc || null,
                detail: `Live ${lp} vs POS ${pos} (beza ${Math.round(Math.abs(lp - pos) / pos * 100)}%)` });
        }
    }
    return { checked, findings, prices: live };
}

// p1_637 (#2b) — Shopee live prices via get_item_base_info (single) + get_model_list (variants).
async function computeShopee() {
    const tok = await sp.getValidToken();
    const rows = await sp.sb('GET', "/products_master?select=sku,cost_price,shopee_price,shopee_campaign,floor_price,floor_margin_pct,smid:metadata->>shopee_item_id,smod:metadata->>shopee_model_id&metadata->>shopee_item_id=not.is.null&limit=10000");
    const byItem = {};
    for (const r of (rows || [])) {
        const item = String(r.smid);
        const c = parseFloat(r.cost_price) || 0;
        (byItem[item] = byItem[item] || []).push({
            sku: (r.sku || '').toUpperCase(),
            model_id: r.smod != null ? String(r.smod) : null,
            cost: c,
            floor: floorFor(c, r.floor_price, r.floor_margin_pct),
            pos: parseFloat(r.shopee_price) || 0,
            camp: r.shopee_campaign && r.shopee_campaign.active ? r.shopee_campaign : null
        });
    }
    const ids = Object.keys(byItem);
    // Shopee price_info.current_price = ACTUAL selling price (already discount-applied);
    // original_price = listing price before discount. Store BOTH (don't re-apply discount).
    const liveItem = {}, hasModel = {};
    const px = (pi) => ({ cur: parseFloat(pi.current_price) || 0, orig: parseFloat(pi.original_price) || 0 });
    for (const batch of chunk(ids, 50)) {
        const r = await sp.shopeeGet('/api/v2/product/get_item_base_info', { item_id_list: batch.join(',') }, tok.access_token, tok.shop_id);
        for (const it of ((r.response && r.response.item_list) || [])) {
            hasModel[String(it.item_id)] = !!it.has_model;
            const pi = (it.price_info && it.price_info[0]) || null;
            if (pi) liveItem[String(it.item_id)] = px(pi);
        }
    }
    const liveModel = {};
    for (const item of ids) {
        if (!hasModel[item]) continue;
        const r = await sp.shopeeGet('/api/v2/product/get_model_list', { item_id: Number(item) }, tok.access_token, tok.shop_id);
        for (const m of ((r.response && r.response.model) || [])) {
            const pi = (m.price_info && m.price_info[0]) || null;
            if (pi) liveModel[String(m.model_id)] = px(pi);
        }
    }
    const findings = []; let checked = 0; const prices = {};
    for (const [item, prods] of Object.entries(byItem)) {
        for (const p of prods) {
            const lv = p.model_id ? liveModel[p.model_id] : liveItem[item];
            if (!lv || !lv.cur) continue;
            checked++;
            const cur = lv.cur, orig = lv.orig || lv.cur;          // cur = actual selling price (post-discount)
            prices[p.sku] = orig;                                   // p1_700 — base/listing price utk trace history
            const discPct = (orig > 0 && cur < orig) ? Math.round((1 - cur / orig) * 100) : 0;
            if (p.cost > 0 && cur < p.cost) {                       // real selling price below cost
                findings.push({ sku: p.sku, platform: 'Shopee', flag: 'below_cost', live_price: orig, effective_price: cur, cost: p.cost, pos_price: p.pos, campaign_disc: discPct || null, detail: `Jual RM${cur}${discPct ? ` (${discPct}% off RM${orig})` : ''} < kos RM${p.cost}` });
            } else if (p.floor > p.cost && cur < p.floor) {          // selling above cost but below the 35% floor
                findings.push({ sku: p.sku, platform: 'Shopee', flag: 'below_floor', live_price: orig, effective_price: cur, cost: p.cost, pos_price: p.pos, campaign_disc: discPct || null, detail: `Jual RM${cur}${discPct ? ` (${discPct}% off RM${orig})` : ''} < floor 35% RM${p.floor} (margin ${marginPct(cur, p.cost)}%)` });
            } else if (p.pos > 0 && orig > 0 && Math.abs(orig - p.pos) / p.pos > DRIFT_PCT / 100) { // listing vs POS intended
                findings.push({ sku: p.sku, platform: 'Shopee', flag: 'drift', live_price: orig, effective_price: cur, cost: p.cost, pos_price: p.pos, campaign_disc: discPct || null, detail: `Listing RM${orig} vs POS RM${p.pos} (beza ${Math.round(Math.abs(orig - p.pos) / p.pos * 100)}%)` });
            }
        }
    }
    return { checked, findings, prices };
}

// p1_700 — Auto-trace: rakam harga LIVE marketplace ke Price History bila berubah dari kali terakhir
// direkod (sumber 'marketplace-trace'). Tangkap perubahan yang dibuat TERUS di Seller Centre (luar POS)
// — yg trigger DB POS terlepas. Append-only ke product_price_history (price_type shopee/tiktok).
async function traceHistory(platform, prices, now) {
    const ptype = platform === 'TikTok' ? 'tiktok' : 'shopee';
    const skus = Object.keys(prices || {}).filter(s => Number(prices[s]) > 0);
    if (!skus.length) return { logged: 0, baseline: 0 };
    // Harga TRACE terakhir per sku (asingkan dari baris trigger POS supaya tak silap-kira).
    const seen = {};
    try {
        const hist = await tt.sb('GET', `/product_price_history?select=sku,new_price,changed_at&price_type=eq.${ptype}&change_source=in.(%22marketplace-trace%22,%22marketplace-trace-baseline%22)&order=changed_at.desc&limit=20000`);
        for (const h of (hist || [])) { const k = (h.sku || '').toUpperCase(); if (!(k in seen)) seen[k] = Number(h.new_price); }
    } catch (e) { /* gagal baca → anggap belum ada; baseline semula (selamat, append-only) */ }
    // Nama produk (batch)
    const nameBy = {};
    for (let i = 0; i < skus.length; i += 200) {
        const batch = skus.slice(i, i + 200).map(s => `"${s}"`).join(',');
        try { const nr = await tt.sb('GET', `/products_master?select=sku,name&sku=in.(${batch})`); for (const r of (nr || [])) nameBy[(r.sku || '').toUpperCase()] = r.name; } catch (e) {}
    }
    const inserts = [];
    for (const sku of skus) {
        const live = round2(prices[sku]);
        const last = seen[sku];
        if (last == null) {
            inserts.push({ sku, product_name: nameBy[sku] || null, old_price: null, new_price: live, delta: null, delta_pct: null, changed_by: platform + ' (auto)', change_source: 'marketplace-trace-baseline', price_type: ptype, changed_at: now });
        } else if (round2(last) !== live) {
            const delta = round2(live - last);
            inserts.push({ sku, product_name: nameBy[sku] || null, old_price: last, new_price: live, delta, delta_pct: (last > 0 ? round2((delta / last) * 100) : null), changed_by: platform + ' (auto)', change_source: 'marketplace-trace', price_type: ptype, changed_at: now });
        }
    }
    for (let i = 0; i < inserts.length; i += 200) await tt.sb('POST', '/product_price_history', inserts.slice(i, i + 200), { Prefer: 'return=minimal' });
    return { logged: inserts.length, baseline: inserts.filter(x => x.change_source === 'marketplace-trace-baseline').length };
}

const writeFindings = async (platform, findings, now) => {
    await tt.sb('DELETE', `/price_sentinel?platform=eq.${platform}`, null, { Prefer: 'return=minimal' });
    if (findings.length) {
        const rows = findings.map(f => Object.assign({}, f, { checked_at: now }));
        for (let i = 0; i < rows.length; i += 200) await tt.sb('POST', '/price_sentinel', rows.slice(i, i + 200), { Prefer: 'return=minimal' });
    }
};

exports.handler = async (event) => {
    const mode = (event && event.queryStringParameters && event.queryStringParameters.mode) || 'sync';
    const now = new Date().toISOString();
    const out = { mode };
    // Run each platform independently — one failing must not wipe the other's findings.
    let tkRes = null, spRes = null;
    try { tkRes = await computeTiktok(); } catch (e) { out.tiktok_error = String(e).slice(0, 200); }
    try { spRes = await computeShopee(); } catch (e) { out.shopee_error = String(e).slice(0, 200); }

    const cnt = (r, flag) => r.findings.filter(f => f.flag === flag).length;
    if (mode === 'peek') {
        const sum = (r) => r ? { checked: r.checked, below_cost: cnt(r, 'below_cost'), below_floor: cnt(r, 'below_floor'), drift: cnt(r, 'drift'), sample: r.findings.slice(0, 20) } : null;
        out.tiktok = sum(tkRes); out.shopee = sum(spRes);
        return json(200, out);
    }
    if (tkRes) { await writeFindings('TikTok', tkRes.findings, now); out.tiktok = { checked: tkRes.checked, below_cost: cnt(tkRes, 'below_cost'), below_floor: cnt(tkRes, 'below_floor'), drift: cnt(tkRes, 'drift') }; }
    if (spRes) { await writeFindings('Shopee', spRes.findings, now); out.shopee = { checked: spRes.checked, below_cost: cnt(spRes, 'below_cost'), below_floor: cnt(spRes, 'below_floor'), drift: cnt(spRes, 'drift') }; }
    // p1_700 — auto-trace harga marketplace ke Price History (append-only; log perubahan dari trace terakhir)
    out.trace = {};
    try { if (tkRes && tkRes.prices) out.trace.tiktok = await traceHistory('TikTok', tkRes.prices, now); } catch (e) { out.tiktok_trace_error = String(e).slice(0, 200); }
    try { if (spRes && spRes.prices) out.trace.shopee = await traceHistory('Shopee', spRes.prices, now); } catch (e) { out.shopee_trace_error = String(e).slice(0, 200); }
    out.checked_at = now;
    return json(200, out);
};
