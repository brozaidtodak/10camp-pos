/**
 * Per-variant LABELS from TikTok — Netlify BACKGROUND Function (p1_447).
 *
 * Some grouped variants have no variant_color/variant_size label, so the PDP
 * variant chips fall back to the raw SKU. TikTok stores the variant name at
 *   skus[].sales_attributes[].value_name
 * This fills products_master.variant_color (when both color+size are empty) from
 * that value_name, matched by metadata.tiktok_sku_id == sku.id.
 *
 * Idempotent: a variant that already has a label is skipped. 13.5-min deadline.
 */

const tiktok = require('./_tiktok');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://asehjdnfzoypbwfeazra.supabase.co';
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY || '';

async function sb(method, path, body, extraHeaders) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
        method,
        headers: Object.assign({ apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' }, extraHeaders || {}),
        body: body ? JSON.stringify(body) : undefined
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`Supabase ${res.status}: ${text.slice(0, 200)}`);
    return text ? JSON.parse(text) : null;
}

exports.handler = async () => {
    if (!SERVICE_KEY) return { statusCode: 500, body: 'no service key' };
    const start = Date.now();
    const DEADLINE = 13.5 * 60 * 1000;

    const rows = await sb('GET', '/products_master?select=sku,variant_color,variant_size,metadata&limit=10000') || [];
    const groups = {};
    for (const r of rows) {
        const m = (r.metadata && typeof r.metadata === 'object') ? r.metadata : {};
        if (!m.tiktok_product_id || !m.tiktok_sku_id) continue;
        const g = groups[m.tiktok_product_id] = groups[m.tiktok_product_id] || [];
        g.push({ sku: r.sku, sid: String(m.tiktok_sku_id), hasLabel: !!((r.variant_color && r.variant_color.trim()) || (r.variant_size && r.variant_size.trim())) });
    }

    let groupsDone = 0, labelled = 0;
    for (const pid of Object.keys(groups)) {
        if (Date.now() - start > DEADLINE) { console.log('[variant-label] deadline'); break; }
        const vars = groups[pid];
        if (!vars.some(v => !v.hasLabel)) continue; // every variant already labelled

        let r;
        try {
            const tok = await tiktok.getValidToken();
            const cipher = await tiktok.ensureShopCipher(tok);
            r = await tiktok.ttRequest('GET', `/product/${tiktok.VERSION}/products/${pid}`,
                { accessToken: tok.access_token, shopCipher: cipher });
        } catch (e) { console.log('[variant-label] fetch fail', pid, String(e).slice(0, 100)); continue; }
        if (!r || r.code !== 0) { console.log('[variant-label] api', pid, r && r.message); continue; }

        const nameById = {};
        for (const s of (r.data && r.data.skus) || []) {
            let nm = '';
            for (const a of (s.sales_attributes || [])) { if (a.value_name) { nm = nm ? (nm + ' ' + a.value_name) : a.value_name; } }
            if (nm) nameById[String(s.id)] = nm.trim();
        }
        let any = false;
        for (const v of vars) {
            if (v.hasLabel) continue;
            const nm = nameById[v.sid];
            if (!nm) continue;
            try {
                await sb('PATCH', `/products_master?sku=eq.${encodeURIComponent(v.sku)}`, { variant_color: nm }, { Prefer: 'return=minimal' });
                labelled++; any = true;
            } catch (e) { console.log('[variant-label] patch fail', v.sku, String(e).slice(0, 100)); }
        }
        if (any) groupsDone++;
    }
    console.log(`[variant-label] done groups:${groupsDone} labelled:${labelled}`);
    return { statusCode: 200, body: JSON.stringify({ groupsDone, labelled }) };
};
