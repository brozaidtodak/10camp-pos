/**
 * Send Receipt Email — Netlify on-demand function (p1_237).
 *
 * Triggered by client (Cashier) selepas sale insert berjaya.
 * Hantar HTML receipt email via Resend dari admin@10camp.com (atau RECEIPT_FROM).
 *
 * Env vars (Netlify):
 *   RESEND_API_KEY   — same key as daily-bos-digest
 *   RECEIPT_FROM     — sender (default: "10 CAMP Receipts <admin@10camp.com>")
 *   SUPABASE_URL     — POS project URL
 *   SUPABASE_SERVICE_KEY — service key (server-side, never expose to browser)
 *
 * Endpoint: POST /api/send-receipt-email
 *   Body JSON: { sale_id: 123 }   atau   { sale_id: 123, force: true }
 *
 * Behavior:
 *   1. Fetch sale row from sales_history
 *   2. If customer_email empty or email_sent_at already set → skip (unless force)
 *   3. Render HTML email body
 *   4. POST to Resend API
 *   5. UPDATE sales_history.email_sent_at + email_status
 */

const { requireStaff } = require('./_auth'); // H2 (audit 2026-07-01) — PII/email gate
const RESEND_KEY = process.env.RESEND_API_KEY || '';
const FROM_ADDR  = process.env.RECEIPT_FROM || '10 CAMP Receipts <admin@10camp.com>';
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://asehjdnfzoypbwfeazra.supabase.co';
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY || '';

function escHtml(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function fmtRM(n) {
    return 'RM ' + (Number(n) || 0).toFixed(2);
}

function fmtDate(iso) {
    if(!iso) return '-';
    const d = new Date(iso);
    return d.toLocaleString('en-MY', { day:'numeric', month:'short', year:'numeric', hour:'numeric', minute:'2-digit', hour12:true });
}

async function sb(path, opts = {}) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
        ...opts,
        headers: {
            apikey: SERVICE_KEY,
            Authorization: `Bearer ${SERVICE_KEY}`,
            'Content-Type': 'application/json',
            Prefer: opts.method === 'PATCH' ? 'return=minimal' : 'return=representation',
            ...(opts.headers || {})
        }
    });
    if(!res.ok) {
        const txt = await res.text();
        throw new Error(`Supabase ${res.status}: ${txt.slice(0, 200)}`);
    }
    return res.json().catch(() => null);
}

// p1_477 — ambil gambar produk (products_master.images[0]) untuk SKU dalam order.
async function fetchItemImages(sale) {
    try {
        const items = Array.isArray(sale.items) ? sale.items : [];
        const skus = [...new Set(items.map(it => (it && it.sku ? String(it.sku).trim() : '')).filter(Boolean))];
        if(!skus.length) return {};
        const inList = skus.map(s => encodeURIComponent('"' + s.replace(/"/g, '') + '"')).join(',');
        const rows = await sb(`/products_master?select=sku,images&sku=in.(${inList})`);
        const map = {};
        (rows || []).forEach(r => {
            let img = '';
            if(Array.isArray(r.images)) img = r.images[0] || '';
            else if(typeof r.images === 'string') { try { const a = JSON.parse(r.images); img = Array.isArray(a) ? (a[0] || '') : r.images; } catch(_) { img = r.images; } }
            if(img) map[r.sku] = img;
        });
        return map;
    } catch(e) { return {}; }
}

function buildEmailHtml(sale, imgMap) {
    imgMap = imgMap || {};
    const items = Array.isArray(sale.items) ? sale.items : [];
    // p1_477 — qty: POS Cashier guna `quantity`, marketplace guna `qty`
    const qtyOf = (it) => Number(it.quantity != null ? it.quantity : it.qty) || 0;
    const subtotal = items.reduce((s, it) => s + (Number(it.price) || 0) * qtyOf(it), 0);
    const total = Number(sale.total_amount || sale.total || 0);
    const discount = Math.max(0, subtotal - total);
    const invId = `INV-${sale.id}`;

    // p1_477 — gambar produk untuk rujukan customer
    const itemRows = items.map(it => {
        const img = imgMap[it.sku] || '';
        const q = qtyOf(it);
        const imgCell = img
            ? `<td style="padding:8px 10px; border-bottom:1px solid #E5E7EB; width:56px;"><img src="${escHtml(img)}" width="46" height="46" alt="" style="width:46px; height:46px; object-fit:cover; border-radius:6px; border:1px solid #E5E7EB; display:block;"></td>`
            : `<td style="padding:8px 10px; border-bottom:1px solid #E5E7EB; width:56px;"></td>`;
        return `
        <tr>
            ${imgCell}
            <td style="padding:10px 12px; border-bottom:1px solid #E5E7EB; font-family:'SF Mono',Menlo,monospace; font-size:12px; color:#6B7280;">${escHtml(it.sku || '-')}</td>
            <td style="padding:10px 12px; border-bottom:1px solid #E5E7EB; font-size:13.5px; color:#111;">${escHtml(it.name || '-')}</td>
            <td style="padding:10px 12px; border-bottom:1px solid #E5E7EB; text-align:center; font-size:13px; color:#374151;">${q}</td>
            <td style="padding:10px 12px; border-bottom:1px solid #E5E7EB; text-align:right; font-size:13px; color:#374151;">${fmtRM(it.price)}</td>
            <td style="padding:10px 12px; border-bottom:1px solid #E5E7EB; text-align:right; font-size:13px; font-weight:700; color:#111;">${fmtRM((Number(it.price)||0) * q)}</td>
        </tr>
    `;
    }).join('');

    const channelLabel = sale.channel || 'POS Cashier';
    const pmLabel = sale.payment_method || 'Cash';

    return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Receipt ${invId}</title></head>
<body style="margin:0; padding:0; background:#F9FAFB; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; color:#111;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#F9FAFB; padding:24px 16px;">
        <tr><td align="center">
            <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px; background:#fff; border-radius:12px; overflow:hidden; box-shadow:0 4px 12px rgba(0,0,0,0.06);">

                <!-- Header -->
                <tr><td style="background:linear-gradient(135deg, #C8741E, #A05F22); padding:28px 32px; color:#fff;">
                    <h1 style="margin:0; font-size:24px; font-weight:800; letter-spacing:0.5px;">10 CAMP</h1>
                    <p style="margin:4px 0 0; font-size:13px; opacity:0.9;">Outdoor &amp; Camping Gear</p>
                </td></tr>

                <!-- Thank you -->
                <tr><td style="padding:32px 32px 12px;">
                    <h2 style="margin:0 0 6px; font-size:20px; font-weight:800; color:#111;">Terima kasih, ${escHtml(sale.customer_name || 'Pelanggan')}!</h2>
                    <p style="margin:0; font-size:14px; color:#6B7280; line-height:1.5;">Resit rasmi pembelian anda dilampirkan di bawah. Simpan untuk rekod warranty.</p>
                </td></tr>

                <!-- Sale info -->
                <tr><td style="padding:14px 32px;">
                    <table width="100%" cellpadding="0" cellspacing="0" style="background:#FEF7ED; border:1px solid #FED7AA; border-radius:8px;">
                        <tr>
                            <td style="padding:14px 16px; font-size:13px;">
                                <strong style="color:#9A3412;">Invoice:</strong> ${invId}<br>
                                <strong style="color:#9A3412;">Tarikh:</strong> ${escHtml(fmtDate(sale.created_at))}
                            </td>
                            <td style="padding:14px 16px; font-size:13px; text-align:right;">
                                <strong style="color:#9A3412;">Channel:</strong> ${escHtml(channelLabel)}<br>
                                <strong style="color:#9A3412;">Kaedah:</strong> ${escHtml(pmLabel)}
                            </td>
                        </tr>
                    </table>
                </td></tr>

                <!-- Items table -->
                <tr><td style="padding:14px 32px 0;">
                    <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #E5E7EB; border-radius:8px; overflow:hidden;">
                        <thead style="background:#F9FAFB;">
                            <tr>
                                <th style="padding:10px 12px; text-align:left; font-size:11px; color:#6B7280; text-transform:uppercase; letter-spacing:0.4px;"></th>
                                <th style="padding:10px 12px; text-align:left; font-size:11px; color:#6B7280; text-transform:uppercase; letter-spacing:0.4px;">SKU</th>
                                <th style="padding:10px 12px; text-align:left; font-size:11px; color:#6B7280; text-transform:uppercase; letter-spacing:0.4px;">Item</th>
                                <th style="padding:10px 12px; text-align:center; font-size:11px; color:#6B7280; text-transform:uppercase; letter-spacing:0.4px;">Qty</th>
                                <th style="padding:10px 12px; text-align:right; font-size:11px; color:#6B7280; text-transform:uppercase; letter-spacing:0.4px;">Harga</th>
                                <th style="padding:10px 12px; text-align:right; font-size:11px; color:#6B7280; text-transform:uppercase; letter-spacing:0.4px;">Jumlah</th>
                            </tr>
                        </thead>
                        <tbody>${itemRows}</tbody>
                    </table>
                </td></tr>

                <!-- Totals -->
                <tr><td style="padding:18px 32px;">
                    <table width="100%" cellpadding="0" cellspacing="0">
                        <tr>
                            <td style="padding:6px 0; font-size:13px; color:#6B7280;">Subtotal</td>
                            <td style="padding:6px 0; font-size:13px; color:#6B7280; text-align:right;">${fmtRM(subtotal)}</td>
                        </tr>
                        ${discount > 0 ? `<tr>
                            <td style="padding:6px 0; font-size:13px; color:#059669;">Diskaun</td>
                            <td style="padding:6px 0; font-size:13px; color:#059669; text-align:right;">− ${fmtRM(discount)}</td>
                        </tr>` : ''}
                        <tr><td colspan="2" style="border-top:1px dashed #D1D5DB; padding:0; height:8px;"></td></tr>
                        <tr>
                            <td style="padding:10px 0; font-size:16px; font-weight:800; color:#111;">TOTAL</td>
                            <td style="padding:10px 0; font-size:22px; font-weight:800; color:#C8741E; text-align:right;">${fmtRM(total)}</td>
                        </tr>
                    </table>
                </td></tr>

                <!-- Footer -->
                <tr><td style="padding:24px 32px 32px; background:#F9FAFB; border-top:1px solid #E5E7EB;">
                    <p style="margin:0 0 6px; font-size:13px; color:#374151; line-height:1.6;">
                        Ada soalan? Hubungi kami: <a href="https://wa.me/601133109547" style="color:#C8741E; text-decoration:none; font-weight:700;">WhatsApp</a> · <a href="mailto:admin@10camp.com" style="color:#C8741E; text-decoration:none; font-weight:700;">admin@10camp.com</a>
                    </p>
                    <p style="margin:6px 0 0; font-size:11.5px; color:#9CA3AF; line-height:1.5;">
                        Lihat katalog penuh: <a href="https://www.10camp.com" style="color:#9CA3AF;">www.10camp.com</a><br>
                        Shopee: <a href="https://shopee.com.my/10camp.os" style="color:#9CA3AF;">10camp.os</a> · TikTok: <a href="https://vt.tiktok.com/ZSxoAXDhd/" style="color:#9CA3AF;">10 CAMP</a>
                    </p>
                </td></tr>

            </table>
            <p style="margin:18px 0 0; font-size:11px; color:#9CA3AF; text-align:center;">Resit automatik dari 10 CAMP POS · Jangan reply email ini</p>
        </td></tr>
    </table>
</body></html>`;
}

exports.handler = async (event) => {
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
    if(event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: cors, body: '' };
    if(event.httpMethod !== 'POST') return { statusCode: 405, headers: cors, body: JSON.stringify({ error: 'POST only' }) };

    // H2 (audit 2026-07-01) — this endpoint returns customer PII (name, email, full order) and can send
    // real emails. Was fully public → anyone could enumerate sale_id to exfiltrate the customer list.
    // Fail-closed staff gate: only a logged-in staff Supabase session may call it. All 4 browser callers
    // send the staff JWT via __authHeaders/__authHeaderSync.
    const __a = await requireStaff(event);
    if(!__a.ok) return { ...__a.response, headers: { ...cors, ...(__a.response.headers || {}) } };

    let body;
    try { body = JSON.parse(event.body || '{}'); }
    catch(e) { return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

    const saleId = parseInt(body.sale_id, 10);
    const force = !!body.force;
    const preview = !!body.preview;   // p1_477 — pulang HTML tanpa hantar (untuk preview)
    if(!saleId) return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'sale_id required' }) };

    // Env var sanity. Preview cuma perlu SERVICE_KEY (baca order); hantar sebenar perlu RESEND_KEY.
    if(!SERVICE_KEY) return { statusCode: 200, headers: cors, body: JSON.stringify({ skipped: true, reason: 'SUPABASE_SERVICE_KEY tak set' }) };
    if(!preview && !RESEND_KEY) return { statusCode: 200, headers: cors, body: JSON.stringify({ skipped: true, reason: 'RESEND_API_KEY tak set dalam Netlify env' }) };

    try {
        const rows = await sb(`/sales_history?id=eq.${saleId}&select=*`);
        const sale = rows && rows[0];
        if(!sale) return { statusCode: 404, headers: cors, body: JSON.stringify({ error: 'sale not found' }) };

        // p1_477 — gambar produk untuk SKU dalam order (rujukan customer)
        const imgMap = await fetchItemImages(sale);
        const html = buildEmailHtml(sale, imgMap);
        const subject = `Resit 10 CAMP — INV-${sale.id} (${(Number(sale.total_amount || sale.total) || 0).toFixed(2)} RM)`;
        const email = (sale.customer_email || '').trim();

        // p1_477 — PREVIEW: pulang HTML sahaja, tak hantar, tak ubah DB
        if(preview) {
            return { statusCode: 200, headers: cors, body: JSON.stringify({ preview: true, html, subject, to: email }) };
        }

        if(!email) {
            await sb(`/sales_history?id=eq.${saleId}`, { method: 'PATCH', body: JSON.stringify({ email_status: 'skipped_no_email' }) });
            return { statusCode: 200, headers: cors, body: JSON.stringify({ skipped: true, reason: 'No customer_email' }) };
        }
        if(sale.email_sent_at && !force) {
            return { statusCode: 200, headers: cors, body: JSON.stringify({ skipped: true, reason: 'Already sent', sent_at: sale.email_sent_at }) };
        }

        const resendRes = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                from: FROM_ADDR,
                to: [email],
                subject,
                html,
                tags: [{ name: 'category', value: 'receipt' }, { name: 'sale_id', value: String(saleId) }]
            })
        });

        const resendData = await resendRes.json().catch(() => ({}));
        if(!resendRes.ok) {
            await sb(`/sales_history?id=eq.${saleId}`, {
                method: 'PATCH',
                body: JSON.stringify({ email_status: 'failed: ' + (resendData.message || resendRes.status).toString().slice(0, 200) })
            });
            return { statusCode: 502, headers: cors, body: JSON.stringify({ error: 'Resend failed', detail: resendData }) };
        }

        // Success: update sale row
        await sb(`/sales_history?id=eq.${saleId}`, {
            method: 'PATCH',
            body: JSON.stringify({
                email_sent_at: new Date().toISOString(),
                email_status: 'sent'
            })
        });

        return { statusCode: 200, headers: cors, body: JSON.stringify({ success: true, resend_id: resendData.id || null, to: email }) };
    } catch(e) {
        console.error('send-receipt-email error:', e);
        try {
            await sb(`/sales_history?id=eq.${saleId}`, {
                method: 'PATCH',
                body: JSON.stringify({ email_status: 'error: ' + e.message.slice(0, 200) })
            });
        } catch(_){}
        return { statusCode: 500, headers: cors, body: JSON.stringify({ error: e.message }) };
    }
};
