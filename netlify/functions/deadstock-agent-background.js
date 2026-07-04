/**
 * deadstock-agent-background.js — EJEN JUALAN DEAD STOCK (p1_1062).
 *
 * Zaid: "ada tak sales agent yang boleh lihat angle macam mana nak jual dead stock —
 * create suggestion setiap masa, siapa-siapa boleh reject/accept untuk dijadikan bundle."
 *
 * ALIRAN: kira DEAD STOCK server-side (stok > 0, published, 0 jualan 60 hari) + FAST MOVERS
 * (top penjual 30 hari, sbg "anchor" bundle) → hantar ke Gemini (free) dgn konteks harga/kos/
 * margin → AI cadang max 3 bundle (nama BM catchy, item+qty, harga, rationale jualan) →
 * SERVER SEMAK SEMULA MARGIN (tak percaya matematik AI): kos bundle dari cost_price sebenar,
 * margin < 35% → harga dinaikkan ke lantai (dicatat "adjusted") → simpan ke agent_suggestions
 * (status pending). Staf terima/tolak di page Bundles; yang DITOLAK 30 hari lepas diberitahu
 * pada AI supaya tak cadang kombinasi sama.
 *
 * DEDUP: SKU dead yang dah ada dlm cadangan pending / bundle sebenar TAK dicadang lagi.
 * Suffix -background: AI + kira data boleh > 10s (had fungsi sync).
 * Gate: requireAuth (scheduled / internal key / staff JWT — butang "Jana" di UI guna JWT staf).
 */
const { requireAuth } = require('./_auth');

const GEMINI_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_MODEL = 'gemini-2.5-flash';
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://asehjdnfzoypbwfeazra.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || '';
const DEAD_DAYS = 60;        // 0 jualan dalam tempoh ni = dead (dashboard guna 30; ejen lebih konservatif)
const FLOOR_MARGIN = 35;     // lantai margin kedai (peratus) — harga bundle tak boleh bawah ni
const MAX_SUGGESTIONS = 3;

const json = (code, obj) => ({ statusCode: code, headers: { 'Content-Type': 'application/json; charset=utf-8' }, body: JSON.stringify(obj) });

async function sb(method, path, body, extra) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
        method, headers: Object.assign({ apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' }, extra || {}),
        body: body ? JSON.stringify(body) : undefined
    });
    const t = await res.text();
    if (!res.ok) throw new Error(`sb ${res.status}: ${t.slice(0, 200)}`);
    return t ? (t[0] === '[' || t[0] === '{' ? JSON.parse(t) : t) : null;
}

exports.handler = async (event) => {
    const auth = await requireAuth(event);
    if (!auth.ok) return auth.response;
    if (!SERVICE_KEY) return json(500, { error: 'SUPABASE_SERVICE_KEY tak set' });
    if (!GEMINI_KEY) return json(500, { error: 'GEMINI_API_KEY tak set' });

    try {
        // ---- 1) Data asas ----
        const prods = await sb('GET', `/products_master?select=sku,name,price,cost_price,is_published&is_published=eq.true&limit=3000`);
        const batches = await sb('GET', `/inventory_batches?select=sku,qty_remaining&limit=20000`);
        const sinceDead = new Date(Date.now() - DEAD_DAYS * 86400000).toISOString();
        const since30 = new Date(Date.now() - 30 * 86400000).toISOString();
        const sales = await sb('GET', `/sales_history?select=created_at,status,is_test,items&created_at=gte.${encodeURIComponent(sinceDead)}&limit=8000`);

        const stock = {};
        (batches || []).forEach(b => { if (b.sku) stock[b.sku] = (stock[b.sku] || 0) + (Number(b.qty_remaining) || 0); });

        const VOID = ['voided', 'cancelled', 'canceled', 'refunded'];
        const sold60 = {}, sold30 = {};
        (sales || []).forEach(s => {
            if (!s || s.is_test) return;
            if (VOID.includes(String(s.status || '').toLowerCase())) return;
            let items = s.items; if (typeof items === 'string') { try { items = JSON.parse(items); } catch (e) { items = []; } }
            if (!Array.isArray(items)) return;
            const is30 = s.created_at >= since30;
            items.forEach(it => {
                const k = String(it && it.sku || '').toUpperCase(); if (!k) return;
                const q = Number(it.quantity != null ? it.quantity : it.qty) || 0;
                sold60[k] = (sold60[k] || 0) + q;
                if (is30) sold30[k] = (sold30[k] || 0) + q;
            });
        });

        const costOf = {}, priceOf = {}, nameOf = {};
        (prods || []).forEach(p => { const k = (p.sku || '').toUpperCase(); costOf[k] = Number(p.cost_price) || 0; priceOf[k] = Number(p.price) || 0; nameOf[k] = p.name || ''; });

        // DEAD = published, stok > 0, 0 jualan 60 hari, ada harga & kos (perlu utk kira margin bundle)
        const dead = (prods || []).filter(p => {
            const k = (p.sku || '').toUpperCase();
            return (stock[k] || 0) > 0 && !(sold60[k] > 0) && priceOf[k] > 0 && costOf[k] > 0;
        }).map(p => { const k = (p.sku || '').toUpperCase(); return { sku: p.sku, name: p.name, price: priceOf[k], stock: stock[k] || 0, margin: Math.round((priceOf[k] - costOf[k]) / priceOf[k] * 100) }; });

        // ANCHOR = top penjual 30 hari yang masih ada stok (pasangan penarik utk dead stock)
        const anchors = Object.keys(sold30)
            .filter(k => (stock[k] || 0) > 0 && priceOf[k] > 0)
            .sort((a, b) => sold30[b] - sold30[a]).slice(0, 25)
            .map(k => ({ sku: k, name: nameOf[k], price: priceOf[k], sold30: sold30[k], stock: stock[k] || 0 }));

        if (!dead.length) return json(200, { ok: true, note: 'Tiada dead stock layak — semua bergerak. Bagus!', dead: 0 });

        // ---- 2) Dedup konteks: pending + bundle sebenar + ditolak 30 hari ----
        const sugs = await sb('GET', `/agent_suggestions?type=eq.bundle&select=status,payload,created_at&order=created_at.desc&limit=200`);
        const cutoff30 = Date.now() - 30 * 86400000;
        const coveredSkus = new Set();   // dead SKU yang dah ada cadangan pending → skip
        const rejectedNames = [];
        (sugs || []).forEach(g => {
            const items = (g.payload && g.payload.items) || [];
            if (g.status === 'pending') items.forEach(it => coveredSkus.add(String(it.sku || '').toUpperCase()));
            if (g.status === 'rejected' && new Date(g.created_at).getTime() > cutoff30 && g.payload && g.payload.name) rejectedNames.push(g.payload.name + ' [' + items.map(i => i.sku).join('+') + ']');
        });
        const bundles = await sb('GET', `/product_bundles?select=items&limit=200`);
        (bundles || []).forEach(b => { const its = Array.isArray(b.items) ? b.items : []; its.forEach(it => coveredSkus.add(String(it.sku || '').toUpperCase())); });

        const deadOpen = dead.filter(d => !coveredSkus.has(String(d.sku).toUpperCase())).slice(0, 40); // cap konteks AI
        if (!deadOpen.length) return json(200, { ok: true, note: 'Semua dead stock dah ada cadangan pending / dlm bundle. Tunggu keputusan staf.', dead: dead.length, open: 0 });

        // ---- 3) Gemini: cadang bundle (JSON) ----
        const prompt = `Kau JURUJUAL kreatif kedai camping/outdoor 10 CAMP (Cyberjaya, Malaysia). Tugas: reka BUNDLE untuk gerakkan DEAD STOCK (tak terjual ${DEAD_DAYS} hari). Strategi bagus: pasangkan dead stock dgn FAST MOVER (penarik), atau gabung beberapa dead stock jadi set bertema (cth "Set Picnic Keluarga", "Starter Camping Solo").

DEAD STOCK (sku | nama | harga RM | stok | margin%):
${deadOpen.map(d => `${d.sku} | ${d.name.slice(0, 70)} | RM${d.price} | ${d.stock} unit | ${d.margin}%`).join('\n')}

FAST MOVERS 30 HARI (calon penarik — sku | nama | harga | terjual):
${anchors.map(a => `${a.sku} | ${(a.name || '').slice(0, 70)} | RM${a.price} | ${a.sold30} terjual`).join('\n')}

${rejectedNames.length ? 'CADANGAN YANG STAF DAH TOLAK (JANGAN ulang kombinasi serupa):\n' + rejectedNames.slice(0, 10).join('\n') : ''}

PERATURAN:
- Max ${MAX_SUGGESTIONS} cadangan. Setiap bundle 2-4 item, MESTI ada sekurang-kurangnya 1 dead stock.
- qty ikut logik (biasanya 1; barang kecil boleh 2).
- suggested_price: lebih murah dari jumlah harga asal (diskaun 10-20%) TAPI jangan terlalu rendah — kedai perlu untung.
- rationale: 1-2 ayat BM santai — KENAPA combo ni masuk akal utk customer camping (angle jualan sebenar, bukan generik).
- name: nama pakej BM/campuran yang menarik & mudah faham.

Jawab JSON SAHAJA (tiada teks lain):
{"suggestions":[{"name":"...","items":[{"sku":"...","qty":1}],"suggested_price":123.00,"rationale":"..."}]}`;

        const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`, {
            method: 'POST',
            headers: { 'x-goog-api-key': GEMINI_KEY, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ role: 'user', parts: [{ text: prompt }] }],
                generationConfig: { temperature: 0.8, maxOutputTokens: 1200, responseMimeType: 'application/json' }
            })
        });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) return json(502, { error: 'Gemini gagal', detail: String((d.error && d.error.message) || r.status).slice(0, 150) });
        let out = {};
        try { out = JSON.parse(((d.candidates || [])[0] || {}).content.parts.map(p => p.text || '').join('')); } catch (e) { return json(502, { error: 'Jawapan AI bukan JSON', raw: String(JSON.stringify(d)).slice(0, 200) }); }
        const raw = Array.isArray(out.suggestions) ? out.suggestions.slice(0, MAX_SUGGESTIONS) : [];

        // ---- 4) SEMAK SEMULA server-side (jangan percaya matematik AI) + simpan ----
        const saved = [];
        for (const s of raw) {
            const items = (Array.isArray(s.items) ? s.items : []).map(it => ({ sku: String(it.sku || '').toUpperCase(), qty: Math.max(1, Math.min(5, parseInt(it.qty) || 1)) }))
                .filter(it => it.sku && priceOf[it.sku] > 0);
            if (items.length < 2) continue;
            // mesti ada >=1 dead stock sebenar
            const deadSet = new Set(deadOpen.map(x => String(x.sku).toUpperCase()));
            if (!items.some(it => deadSet.has(it.sku))) continue;
            const origTotal = items.reduce((t, it) => t + priceOf[it.sku] * it.qty, 0);
            const cost = items.reduce((t, it) => t + (costOf[it.sku] || 0) * it.qty, 0);
            let price = Number(s.suggested_price) || 0;
            let adjusted = false;
            if (!(price > 0) || price >= origTotal) { price = Math.round(origTotal * 0.88 * 10) / 10; adjusted = true; }   // default ~12% diskaun
            const floorPrice = cost > 0 ? cost / (1 - FLOOR_MARGIN / 100) : 0;
            if (cost > 0 && price < floorPrice) { price = Math.ceil(floorPrice); adjusted = true; }                        // kuatkuasa lantai margin
            const marginPct = price > 0 && cost > 0 ? Math.round((price - cost) / price * 100) : null;
            const payload = {
                name: String(s.name || 'Pakej Cadangan AI').slice(0, 80),
                items,
                item_names: items.map(it => ({ sku: it.sku, name: (nameOf[it.sku] || '').slice(0, 80), price: priceOf[it.sku] })),
                suggested_price: price,
                orig_total: Math.round(origTotal * 100) / 100,
                margin_pct: marginPct,
                price_adjusted: adjusted,
                rationale: String(s.rationale || '').slice(0, 400),
                dead_skus: items.filter(it => deadSet.has(it.sku)).map(it => it.sku)
            };
            await sb('POST', '/agent_suggestions', [{ type: 'bundle', payload, status: 'pending' }], { Prefer: 'return=minimal' });
            saved.push(payload.name);
        }

        return json(200, { ok: true, dead: dead.length, open: deadOpen.length, suggested: saved.length, names: saved });
    } catch (e) {
        return json(500, { error: String(e.message || e).slice(0, 250) });
    }
};
