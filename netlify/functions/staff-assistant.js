/**
 * staff-assistant.js — in-app AI helper for staff (p1_795 v1; p1_796 v2 = live data via tools;
 * p1_1041 v3 = Gemini free tier as primary brain, OpenAI fallback).
 * Browser-called by logged-in staff; gated by requireStaff.
 *
 * v3 (p1_1041): PRIMARY = Google Gemini (gemini-2.5-flash, free tier = RM0/bulan) via GEMINI_API_KEY.
 * FALLBACK = OpenAI gpt-4o-mini (only when Gemini errors/quota — still under the RM50 monthly cap).
 * Same TOOLS + KB + safety rules for both providers. Response includes `provider` for debugging.
 *
 * v2: the model can call READ-ONLY, SAFETY-SCOPED tools (function calling). It NEVER touches the DB
 * directly. Hard rules enforced server-side: NO cost/margin/profit, NO customer PII, NO other staff's
 * sales/commission. "My sales/commission" is scoped to the AUTHENTICATED caller (from the JWT, not the
 * client) so it can't be spoofed.
 *
 * POST { messages: [{role:'user'|'assistant', content}] }  → { reply }  (or { reply, capped:true })
 */
const { requireStaff } = require('./_auth');

const GEMINI_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_MODEL = 'gemini-2.5-flash';    // free tier: cukup besar utk pasukan kecil; kos RM0
const OPENAI_KEY = process.env.OPENAI_API_KEY || '';
const MODEL = 'gpt-4o-mini';                // fallback sahaja
const CAP_USD = 10;                 // ~RM50/month; safety backstop (hanya relevan bila fallback OpenAI digunakan)
const PRICE_IN = 0.15 / 1e6, PRICE_OUT = 0.60 / 1e6;
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://asehjdnfzoypbwfeazra.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || '';

const cors = { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (code, obj) => ({ statusCode: code, headers: cors, body: JSON.stringify(obj) });

async function sb(method, path, body, extra) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
        method, headers: Object.assign({ apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' }, extra || {}),
        body: body ? JSON.stringify(body) : undefined
    });
    const t = await res.text();
    if (!res.ok) throw new Error(`sb ${res.status}: ${t.slice(0, 200)}`);
    return t ? (t[0] === '[' || t[0] === '{' ? JSON.parse(t) : t) : null;
}

// Caller identity from the validated JWT email → staff display name (as stored in sales_history.staff_name).
// Embedded (10 staff, stable) so "my sales/commission" can't be spoofed by the client.
const STAFF_BY_EMAIL = {
    'zaid@10camp.com': 'Zaid', 'aliff@10camp.com': 'Aliff', 'farhanwakiman@10camp.com': 'Farhan Moyy',
    'zack@10camp.com': 'Zack', 'ariff@10camp.com': 'Ariff', 'irfan@10camp.com': 'Irfan',
    'tarmizi@10camp.com': 'Tarmizi Kael', 'fahmi@10camp.com': 'Fahmi', 'tester@10camp.com': 'Tester'
};

const VOID = ['voided', 'cancelled', 'canceled', 'refunded'];
const isReal = (s) => s && s.is_test !== true && !VOID.includes(String(s.status || '').toLowerCase());
const esc = (s) => encodeURIComponent('"' + String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"');
const ymNow = () => new Date(new Date().getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 7);
const todayLocal = () => new Date(new Date().getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);

// ---- TOOLS (read-only, safety-scoped) ----
const TOOLS = [
    { type: 'function', function: { name: 'lookup_product', description: 'Cari produk ikut SKU atau nama. Pulang nama, SKU, BARCODE, harga jual, stok semasa, LOKASI STOK (di mana barang disimpan dalam kedai/gudang), status terbit. TIADA kos.', parameters: { type: 'object', properties: { query: { type: 'string', description: 'SKU atau sebahagian nama produk' } }, required: ['query'] } } },
    { type: 'function', function: { name: 'my_sales', description: 'Jualan staf yang sedang bertanya SENDIRI (tak boleh orang lain). Pulang bilangan order + jumlah RM + anggaran komisen 5%.', parameters: { type: 'object', properties: { period: { type: 'string', enum: ['today', 'month'], description: 'today = hari ni, month = bulan ni' } }, required: ['period'] } } },
    { type: 'function', function: { name: 'low_stock', description: 'Senarai produk yang stok rendah/habis (untuk inventory).', parameters: { type: 'object', properties: { threshold: { type: 'integer', description: 'paras stok (default 5)' } } } } },
    { type: 'function', function: { name: 'store_sales_today', description: 'Jumlah jualan + bilangan order SELURUH kedai hari ni (semua channel, semua staf). Tiada pecahan kos/untung.', parameters: { type: 'object', properties: {} } } }
];

async function runTool(name, args, caller) {
    try {
        if (name === 'lookup_product') {
            // sanitise to safe chars (alnum/space/-/_) so it can't break the PostgREST or()/ilike filter
            const q = String((args && args.query) || '').replace(/[^a-zA-Z0-9 _-]/g, '').trim().slice(0, 40);
            if (!q) return { error: 'query kosong / tak sah' };
            const qe = encodeURIComponent(q);
            // match by sku OR name; NO cost columns selected. + barcode (erp_barcode/barcode) utk staf padan sticker
            const rows = await sb('GET', `/products_master?select=sku,name,price,is_published,erp_barcode&or=(sku.ilike.*${qe}*,name.ilike.*${qe}*)&limit=8`);
            if (!rows || !rows.length) return { found: 0, note: 'Tiada produk padan.' };
            const skus = rows.map(r => r.sku).filter(Boolean);
            const stockMap = {};
            const locMap = {};
            if (skus.length) {
                const inList = skus.map(esc).join(',');
                const batches = await sb('GET', `/inventory_batches?select=sku,qty_remaining&sku=in.(${inList})`);
                (batches || []).forEach(b => { stockMap[b.sku] = (stockMap[b.sku] || 0) + (Number(b.qty_remaining) || 0); });
                // lokasi stok (di mana barang disimpan) — table stock_locations, multi-lokasi
                const locs = await sb('GET', `/stock_locations?select=sku,location,qty&sku=in.(${inList})`);
                (locs || []).forEach(l => { if (l.location) (locMap[l.sku] = locMap[l.sku] || []).push({ location: l.location, qty: Number(l.qty) || 0 }); });
            }
            return { found: rows.length, products: rows.map(r => ({ sku: r.sku, name: r.name, barcode: (r.erp_barcode || null), price_rm: Number(r.price) || 0, stock: stockMap[r.sku] || 0, locations: locMap[r.sku] || [], published: !!r.is_published })) };
        }
        if (name === 'my_sales') {
            if (!caller) return { error: 'Tak dapat sahkan siapa anda — cuba log keluar/masuk.' };
            const period = (args && args.period === 'today') ? 'today' : 'month';
            const start = period === 'today' ? todayLocal() : (ymNow() + '-01');
            const rows = await sb('GET', `/sales_history?select=total,total_amount,status,is_test,staff_name,created_at&staff_name=eq.${esc(caller)}&created_at=gte.${start}&limit=4000`);
            const real = (rows || []).filter(isReal);
            const total = real.reduce((s, x) => s + (Number(x.total != null ? x.total : x.total_amount) || 0), 0);
            return { staff: caller, period, orders: real.length, total_rm: Math.round(total * 100) / 100, est_commission_rm: Math.round(total * 0.05 * 100) / 100, note: 'Komisen ANGGARAN 5% sahaja; angka rasmi di "My Commission" atau tanya Aliff.' };
        }
        if (name === 'low_stock') {
            const th = Math.max(0, Math.min(parseInt((args && args.threshold) || 5, 10) || 5, 50));
            // sum stock per sku, then filter <= threshold among published products
            const prods = await sb('GET', `/products_master?select=sku,name&is_published=eq.true&limit=5000`);
            const batches = await sb('GET', `/inventory_batches?select=sku,qty_remaining&limit=20000`);
            const stockMap = {};
            (batches || []).forEach(b => { if (b.sku) stockMap[b.sku] = (stockMap[b.sku] || 0) + (Number(b.qty_remaining) || 0); });
            const low = (prods || []).map(p => ({ sku: p.sku, name: p.name, stock: stockMap[p.sku] || 0 })).filter(p => p.stock <= th).sort((a, b) => a.stock - b.stock).slice(0, 25);
            return { threshold: th, count: low.length, products: low };
        }
        if (name === 'store_sales_today') {
            const start = todayLocal();
            const rows = await sb('GET', `/sales_history?select=total,total_amount,status,is_test,created_at&created_at=gte.${start}&limit=5000`);
            const real = (rows || []).filter(isReal);
            const total = real.reduce((s, x) => s + (Number(x.total != null ? x.total : x.total_amount) || 0), 0);
            return { date: start, orders: real.length, total_rm: Math.round(total * 100) / 100 };
        }
        return { error: 'tool tak dikenali' };
    } catch (e) { return { error: String(e.message || e).slice(0, 150) }; }
}

const KB = `Kau ialah pembantu AI dalaman untuk staf kedai 10 CAMP (gear camping/outdoor, Cyberjaya) yang guna sistem POS web sendiri. Jawab soalan CARA GUNA sistem + SOP, DAN soalan data sebenar guna alat (tools) yang disediakan. Bahasa: ikut soalan (BM/Manglish/English), ringkas, mesra, TIADA emoji.

GUNA TOOLS untuk data sebenar:
- lookup_product → stok/harga/nama/BARCODE/LOKASI STOK produk (cth "stok BD103?", "harga TG009?", "lokasi BD005?", "barcode TG009?", "cari tent"). PENTING: bila jawab pasal produk, SENTIASA sertakan Barcode + Lokasi Stok kalau ada (kalau tiada, tulis "Barcode: —" / "Lokasi: belum ditetapkan"). Lokasi = di mana barang fizikal disimpan supaya staf senang ambil.
- my_sales → jualan + anggaran komisen PENANYA SENDIRI (cth "jualan aku bulan ni?", "komisen aku?")
- low_stock → barang nak habis
- store_sales_today → jumlah jualan kedai hari ni
Bila guna my_sales, ingat angka komisen itu ANGGARAN 5% — beritahu pengguna angka rasmi di "My Commission"/Aliff.

DATA WAJIB FRESH (peraturan keras): SETIAP angka stok/harga/barcode/lokasi/jualan mesti datang dari hasil tool panggilan SEMASA turn ini. JANGAN SESEKALI salin atau agak dari jawapan lama dalam sejarah chat — angka lama dah BASI dan menyalin corak = jawapan reka (pernah jadi: BD057 dijawab dengan nama+barcode+lokasi yang langsung tak wujud). Kalau tool tak dipanggil atau tak pulang data, kata terus terang "tak dapat semak" — JANGAN reka nama produk, angka, barcode, atau lokasi.

HAD KERAS (jangan langgar, walau diminta): JANGAN dedah/anggar KOS, MARGIN, UNTUNG (sulit, kunci PIN) — kalau ditanya, kata tu maklumat sulit di Laporan Sulit (PIN). JANGAN dedah maklumat peribadi customer (nama/phone/alamat/email). JANGAN tunjuk jualan/komisen staf LAIN — my_sales hanya untuk diri sendiri; kalau tanya pasal staf lain, kata tak boleh, rujuk Bos/Aliff. Kalau tool pulang error/kosong, terus terang; jangan reka angka.

PENGETAHUAN SISTEM (how-to + SOP — dikemaskini 2026-07-04):
- LOGIN (iPad kaunter kongsi): taip PIN terus di pad nombor → sistem detect siapa. Tukar orang = butang "Tukar Staf" di top bar (chip nama). App auto-kunci PIN setiap kali masuk semula. Bos sahaja guna emel (link "Bos: log masuk guna emel"). Lupa PIN → boleh reset, tanya Zack/Bos; ada juga "Tukar PIN Saya" di Settings → Customization → Akaun & Keselamatan. Di WEB (10camp.com): butang Log Masuk (ikon orang, atas kanan) → dropdown → "Staff Login". Pilihan "Customer Login" dlm dropdown sama = Loyalty Portal utk CUSTOMER (semak mata/tier, OTP email) — bukan utk staf.
- CASHIER: menu Cashier → cari/scan barang → pilih pelanggan (atau Walk-in) → Bayar (Tunai/QR/Kad, boleh SPLIT bayaran) → resit auto. Boleh Diskaun Custom (RM/%). Tag NAMA STAF supaya komisen dikira. VIP auto dikesan (cadangan, masuk manual). SHIFT: Buka Shift mula hari, "kira baki" duit laci, "Duit Keluar" utk cash out, Z-Report tutup hari. Ada mode OFFLINE kalau internet putus (jualan sync bila online semula).
- MOBILE APP (iPad/phone): 4 tab sahaja — Cashier / Orders / Komisen / Stock Take. Fungsi lain (Bulk Edit, HR, Reports, dll) guna POS versi web/laptop (back office). Tanya AI = butang sparkles di top bar.
- REFUND/RETURN: All Orders → Urus → pilih barang+qty, tanda "pulang ke stok" kalau elok. Penuh=Refunded; separa direkod. Void = pulang stok auto kalau pernah tolak. Barang ROSAK: refund TANPA pulang ke stok (jangan restock barang rosak).
- BULK EDIT (edit harga PUKAL — cara utama tukar harga banyak produk): Products → butang "Bulk Edit" (jadual macam spreadsheet). Tapis/cari produk → edit terus Harga/Kos/Harga Shopee/Harga TikTok dalam jadual → margin per-channel auto-kira (MERAH kalau bawah 35%) → "Simpan Perubahan". Butang "Pilih Field" utk tambah kolum (termasuk Marketplace variation ID). Klik SKU dari mana-mana amaran (cth jual bawah kos) → terus buka Bulk Edit ditapis ke SKU tu. Web/laptop sahaja.
- STOK: Semakan Stok / Stock Take (kira fizikal vs sistem → hantar utk semakan bos); Cycle Count = kira sikit-sikit bergilir (guna sistem Stock Take sama). Adjust di kad produk (PDP) → Adjust Stock (+/-) + sebab. Online auto-sync. Inventory → Stock Transfer: rekod pindah stok antara lokasi (Bilik Stok ke Kedai dan sebaliknya, jejak audit). Inventory → Reorder / Low Stock: senarai barang nak habis + cadangan kuantiti restock. Inventory → Event: senarai pack barang utk event (+shortfall kalau tak cukup). NOTA: "Maklum Inventori" dah DISOROK (tak digunakan) — kalau staf tanya, cakap feature tu tak aktif sekarang.
- RETURNS / BARANG ROSAK-HILANG: kalau ADA order → buat di All Orders (Urus/Refund) — rekod Returns auto tercipta, jangan log manual (nanti dua kali). Kalau TIADA order (jumpa rosak/hilang/expired dalam stok) → Jual → Returns → "+ Log New Item": taip SKU (kos & supplier auto-isi), pilih jenis (Rosak/Hilang/Expired = dikira rugi; Return customer = tak rugi sebab masuk stok balik), WAJIB isi sebab. Return Shopee/TikTok → butang "Pull from Channel" (auto-tarik, jangan taip manual). Laporan "Top Problematic SKU" guna data ni utk kenal pasti supplier bermasalah.
- PRODUK: Master Produk (senarai), Kalkulator Harga (set kos+harga), Bundles (pakej), Bulk Edit (pukal — atas).
- KOMISEN: 5% base jualan ditag nama staf; order batal/void tak dikira; bulan X dibayar dlm gaji X+1. Detail → Aliff.
- GANJARAN TIER (skim 5 Jul 2026 — WALK-IN SAHAJA): attach customer di checkout → banner tier keluar. Diskaun tier = tekan butang dlm banner, sistem KIRA SENDIRI item mana layak (ikut margin dalaman — VIP 10%, Silver 5%, Bronze 3%; item margin nipis TAK layak, itu normal) — JANGAN kira manual & JANGAN terangkan syarat margin pada customer (dalaman). Baju percuma: Silver & VIP sahaja, 1×/TAHUN per customer, saiz terhad ikut stok — tekan butang "Baju percuma" dlm banner utk rekod claim (sistem tolak kalau dah claim tahun tu). Channel mesti POS Cashier; Shopee/TikTok tiada ganjaran ni.
- HR: Cuti (baki+pohon) + Claim (hantar tuntutan). Bos lulus. Roster = jadual kerja.
- MARKETPLACE: Shopee+TikTok sync auto (stok 2 hala + harga). Harga marketplace per-produk di Bulk Edit / kad Variants, biasa LEBIH TINGGI dari walk-in (jangan samakan). Harga kempen betulkan di Seller Centre. Chat pelanggan Shopee: Messages → Chat Inbox.
- PUSAT AMARAN (Home tab "Amaran"): isu ikut bahagian. LOCENG notifikasi ada tapisan Belum baca/Penting/Semua; notifikasi boleh klik ("Buka →") bawa terus ke tempat betulkan.
- SIAPA: Bos=Zaid (keputusan/harga/polisi). Aliff=admin/kewangan/komisen/claim. Zack=sistem/bug. Kael/Fahmi=inventory.
- KALAU TAK PASTI (feature baru / soalan luar senarai ni): JANGAN reka jawapan atau bagi langkah lama. Cakap terus terang kau tak pasti sebab sistem selalu di-update, dan suruh staf buka Setup Guide (Checklist + Panduan How-To + Peta Sistem, dalam POS web) atau tanya Zack.`;

// p1_1043 — soalan "bentuk data" (ada SKU / kata kunci stok-harga-lokasi-jualan)? Kalau ya,
// PAKSA model panggil tool pada langkah pertama (mode ANY / tool_choice required). Punca: Zack
// dapat jawapan REKA utk BD057 — bila sejarah chat penuh corak "SKU → jawapan stok", model
// tiru corak & jawab dari ingatan TANPA panggil tool (disahkan reproduce: nama/barcode/lokasi
// semua fabricated). Paksaan deterministik > harapan prompt.
const DATA_SHAPED = (txt) => {
    const t = String(txt || '');
    if (/\b[A-Za-z]{2,4}-?\d{2,4}\b/.test(t)) return true;                                  // token macam SKU (BD057, MG077, TG-009)
    return /(stok|stock|harga|price|barcode|lokasi|location|berapa|jualan|sales|komisen|commission|unit|habis|low)/i.test(t);
};

// ---- p1_1041 — GEMINI (primary, free tier): loop dgn function-calling, sama tools/KB ----
async function askGemini(systemText, history, caller, forceTool) {
    // tukar TOOLS (format OpenAI) → functionDeclarations Gemini. Fungsi tanpa parameter: omit `parameters`.
    const decls = TOOLS.map(t => {
        const f = t.function;
        const d = { name: f.name, description: f.description };
        if (f.parameters && f.parameters.properties && Object.keys(f.parameters.properties).length) d.parameters = f.parameters;
        return d;
    });
    const contents = history.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));
    let totIn = 0, totOut = 0;
    for (let step = 0; step < 4; step++) {
        const req = {
            systemInstruction: { parts: [{ text: systemText }] },
            contents,
            tools: [{ functionDeclarations: decls }],
            // thinkingBudget 0 = jawab terus tanpa "berfikir" (laju utk chat staf; soalan SOP tak perlu deep reasoning)
            generationConfig: { temperature: 0.3, maxOutputTokens: 600, thinkingConfig: { thinkingBudget: 0 } }
        };
        // p1_1043 — soalan data: langkah PERTAMA wajib panggil tool (tak boleh jawab dari ingatan/sejarah).
        // Langkah seterusnya kembali AUTO supaya model boleh tulis jawapan teks dari hasil tool.
        if (forceTool && step === 0) req.toolConfig = { functionCallingConfig: { mode: 'ANY' } };
        const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`, {
            method: 'POST',
            headers: { 'x-goog-api-key': GEMINI_KEY, 'Content-Type': 'application/json' },
            body: JSON.stringify(req)
        });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error('gemini ' + r.status + ': ' + String((d.error && d.error.message) || '').slice(0, 120));
        const um = d.usageMetadata || {};
        totIn += um.promptTokenCount || 0;
        totOut += (um.candidatesTokenCount || 0) + (um.thoughtsTokenCount || 0);
        const content = d.candidates && d.candidates[0] && d.candidates[0].content;
        const parts = (content && content.parts) || [];
        const calls = parts.filter(p => p.functionCall);
        if (calls.length) {
            contents.push({ role: 'model', parts });
            const fr = [];
            for (const c of calls) {
                const result = await runTool(c.functionCall.name, c.functionCall.args || {}, caller);
                fr.push({ functionResponse: { name: c.functionCall.name, response: result } });
            }
            contents.push({ role: 'user', parts: fr });
            continue; // biar model baca hasil tool + jawab
        }
        const text = parts.map(p => p.text || '').join('').trim();
        return { reply: text || 'Maaf, aku tak dapat jawab tu.', in_tok: totIn, out_tok: totOut };
    }
    return { reply: 'Maaf, soalan tu agak kompleks — cuba pecahkan atau tanya Bos/Aliff.', in_tok: totIn, out_tok: totOut };
}

// ---- OpenAI (fallback sahaja — bila Gemini error/kuota) ----
async function askOpenAI(systemText, history, caller, forceTool) {
    const messages = [{ role: 'system', content: systemText }, ...history];
    let totIn = 0, totOut = 0;
    for (let step = 0; step < 4; step++) {
        const req = { model: MODEL, messages, tools: TOOLS, temperature: 0.3, max_tokens: 600 };
        if (forceTool && step === 0) req.tool_choice = 'required'; // p1_1043 — sama paksaan mcm Gemini
        const r = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: { Authorization: `Bearer ${OPENAI_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(req)
        });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error('openai ' + r.status + ': ' + String((d.error && d.error.message) || '').slice(0, 120));
        totIn += (d.usage && d.usage.prompt_tokens) || 0;
        totOut += (d.usage && d.usage.completion_tokens) || 0;
        const msg = d.choices && d.choices[0] && d.choices[0].message;
        if (!msg) return { reply: 'Maaf, aku tak dapat jawab tu.', in_tok: totIn, out_tok: totOut };
        if (msg.tool_calls && msg.tool_calls.length) {
            messages.push(msg);
            for (const tc of msg.tool_calls) {
                let a = {}; try { a = JSON.parse(tc.function.arguments || '{}'); } catch (_) {}
                const result = await runTool(tc.function.name, a, caller);
                messages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(result) });
            }
            continue; // let the model read tool results + answer
        }
        return { reply: msg.content || 'Maaf, aku tak dapat jawab tu.', in_tok: totIn, out_tok: totOut };
    }
    return { reply: 'Maaf, soalan tu agak kompleks — cuba pecahkan atau tanya Bos/Aliff.', in_tok: totIn, out_tok: totOut };
}

exports.handler = async (event) => {
    if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors, body: '' };
    if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' });

    const auth = await requireStaff(event);
    if (!auth.ok) return auth.response;
    if (!GEMINI_KEY && !OPENAI_KEY) return json(500, { error: 'tiada API key AI diset' });

    const callerEmail = (auth.user && auth.user.email || '').toLowerCase();
    const caller = STAFF_BY_EMAIL[callerEmail] || null;

    let body = {};
    try { body = JSON.parse(event.body || '{}'); } catch (_) {}
    let history = Array.isArray(body.messages) ? body.messages : [];
    history = history.filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
        .map(m => ({ role: m.role, content: String(m.content).slice(0, 2000) })).slice(-8);
    if (!history.length || history[history.length - 1].role !== 'user') return json(400, { error: 'no user message' });

    // ---- monthly cost cap (hanya kos OpenAI fallback yang menambah cost_usd; Gemini free = 0) ----
    const usageKey = 'ai_usage_' + ymNow();
    let usage = { cost_usd: 0, calls: 0, in_tok: 0, out_tok: 0, g_calls: 0, o_calls: 0 };
    try {
        const rows = await sb('GET', `/app_settings?key=eq.${usageKey}&select=value&limit=1`);
        if (rows && rows[0] && rows[0].value) usage = Object.assign(usage, rows[0].value);
    } catch (_) {}
    const capped = usage.cost_usd >= CAP_USD; // cap hanya menyekat laluan BERBAYAR (OpenAI); Gemini free diteruskan

    // ---- language: follow the APP'S selected mode (window.I18N.lang), NOT the user's typing language ----
    const __lang = (body.lang === 'en') ? 'en' : 'bm';
    const __langRule = __lang === 'en'
        ? '\n\nLANGUAGE — HARD OVERRIDE (overrides any language guidance above): Reply ONLY in English, even if the user types in Malay / Manglish / mixed. Do not use Malay words.'
        : '\n\nBAHASA — WAJIB IKUT (atasi arahan bahasa lain): Jawab dalam Bahasa Melayu sahaja, walaupun pengguna menaip dalam English / campur.';
    const systemText = KB + __langRule;

    // p1_1043 — soalan bentuk data? paksa tool call langkah pertama (anti-hallucination)
    const forceTool = DATA_SHAPED(history[history.length - 1].content);

    // ---- Gemini dulu (free); OpenAI hanya bila Gemini gagal DAN belum capped ----
    let out = null, provider = '', cost = 0;
    try {
        if (!GEMINI_KEY) throw new Error('gemini key tiada');
        out = await askGemini(systemText, history, caller, forceTool);
        provider = 'gemini';
    } catch (ge) {
        if (OPENAI_KEY && !capped) {
            try {
                out = await askOpenAI(systemText, history, caller, forceTool);
                provider = 'openai';
                cost = out.in_tok * PRICE_IN + out.out_tok * PRICE_OUT;
            } catch (oe) {
                return json(502, { error: 'AI gagal jawab', detail: String(oe.message || oe).slice(0, 150) });
            }
        } else if (capped) {
            return json(200, { reply: 'Maaf, had penggunaan AI bulan ni dah dicapai. Cuba bulan depan, atau bagitahu Bos kalau perlu naikkan had.', capped: true });
        } else {
            return json(502, { error: 'AI gagal jawab', detail: String(ge.message || ge).slice(0, 150) });
        }
    }

    // ---- record usage ----
    try {
        const next = {
            cost_usd: +(usage.cost_usd + cost).toFixed(6), calls: (usage.calls || 0) + 1,
            in_tok: (usage.in_tok || 0) + out.in_tok, out_tok: (usage.out_tok || 0) + out.out_tok,
            g_calls: (usage.g_calls || 0) + (provider === 'gemini' ? 1 : 0),
            o_calls: (usage.o_calls || 0) + (provider === 'openai' ? 1 : 0),
            updated_at: new Date().toISOString()
        };
        await sb('POST', '/app_settings?on_conflict=key', { key: usageKey, value: next }, { Prefer: 'resolution=merge-duplicates,return=minimal' });
    } catch (_) {}

    return json(200, { reply: out.reply, provider });
};
