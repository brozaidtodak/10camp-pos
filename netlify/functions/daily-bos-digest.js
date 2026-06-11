/**
 * Daily Bos Digest — Netlify Scheduled Function (p1_118).
 *
 * Sends a daily summary email at 8am Asia/Kuala_Lumpur (00:00 UTC).
 * Aggregates yesterday's data from Supabase + sends HTML email via Resend.
 *
 * Env vars required:
 *   RESEND_API_KEY     — sign up resend.com, get API key
 *   DIGEST_RECIPIENTS  — comma-separated emails (e.g. zaid@10camp.com)
 *   DIGEST_FROM        — sender email (e.g. "10 CAMP POS <pos@10camp.com>")
 *                        Note: domain must be verified in Resend, or use
 *                        "onboarding@resend.dev" for testing (only sends to
 *                        your Resend account email).
 *
 * Manual trigger: GET /.netlify/functions/daily-bos-digest?send=1
 *   (returns digest preview JSON without sending if no ?send=1)
 *
 * Schedule: 0 0 * * * (every day at 00:00 UTC = 8:00am Asia/KL)
 */

const RESEND_KEY  = process.env.RESEND_API_KEY || '';
const RECIPIENTS  = (process.env.DIGEST_RECIPIENTS || '').split(',').map(s => s.trim()).filter(Boolean);
const FROM_ADDR   = process.env.DIGEST_FROM || 'onboarding@resend.dev';
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://asehjdnfzoypbwfeazra.supabase.co';
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY || '';

async function sb(path) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
        headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` }
    });
    if (!res.ok) throw new Error(`Supabase ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return res.json();
}

function fmtRM(n) {
    return 'RM ' + Number(n || 0).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtRMC(n) {
    return 'RM ' + Number(n || 0).toLocaleString('en-MY', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

async function buildDigest() {
    // Yesterday in MYT
    const now = new Date();
    const offsetMs = 8 * 3600 * 1000; // MYT = UTC+8
    const ytdayMyt = new Date(now.getTime() + offsetMs);
    ytdayMyt.setUTCDate(ytdayMyt.getUTCDate() - 1);
    const ytdayStart = new Date(Date.UTC(ytdayMyt.getUTCFullYear(), ytdayMyt.getUTCMonth(), ytdayMyt.getUTCDate(), 0, 0, 0) - offsetMs);
    const ytdayEnd = new Date(Date.UTC(ytdayMyt.getUTCFullYear(), ytdayMyt.getUTCMonth(), ytdayMyt.getUTCDate(), 23, 59, 59) - offsetMs);
    const dateLabel = ytdayMyt.toISOString().slice(0, 10);

    // Fetch sales yesterday
    let sales = [];
    try {
        sales = await sb(`/sales_history?select=id,total,total_amount,channel,customer_name,items,created_at,timestamp&or=(created_at.gte.${ytdayStart.toISOString()},timestamp.gte.${ytdayStart.toISOString()})&or=(created_at.lte.${ytdayEnd.toISOString()},timestamp.lte.${ytdayEnd.toISOString()})&limit=1000`);
    } catch(e) { /* fallback empty */ }

    // Filter to yesterday range strictly
    sales = (sales || []).filter(s => {
        const t = new Date(s.timestamp || s.created_at || 0).getTime();
        return t >= ytdayStart.getTime() && t <= ytdayEnd.getTime();
    });

    const totalRevenue = sales.reduce((sum, s) => sum + Number(s.total || s.total_amount || 0), 0);
    const orderCount = sales.length;
    const aov = orderCount > 0 ? totalRevenue / orderCount : 0;

    // By channel
    const byChannel = {};
    sales.forEach(s => {
        const ch = s.channel || 'Walk-in';
        if (!byChannel[ch]) byChannel[ch] = { revenue: 0, orders: 0 };
        byChannel[ch].revenue += Number(s.total || s.total_amount || 0);
        byChannel[ch].orders++;
    });
    const channels = Object.entries(byChannel)
        .map(([ch, st]) => ({ ch, ...st }))
        .sort((a, b) => b.revenue - a.revenue);

    // Top SKU sold yesterday
    const skuTally = {};
    sales.forEach(s => {
        const items = (() => { try { return JSON.parse(s.items || '[]'); } catch(e) { return s.items || []; } })();
        (Array.isArray(items) ? items : []).forEach(it => {
            const sku = (it.sku || '').toUpperCase();
            if (!sku) return;
            if (!skuTally[sku]) skuTally[sku] = { sku, name: it.name || sku, qty: 0 };
            skuTally[sku].qty += Number(it.qty || 0);
        });
    });
    const topSkus = Object.values(skuTally).sort((a, b) => b.qty - a.qty).slice(0, 5);

    // Pending approvals (cuti + claim + stock check)
    let pendingStockCheck = 0;
    try {
        const sc = await sb('/stock_check_reports?select=id&status=eq.submitted');
        pendingStockCheck = (sc || []).length;
    } catch(e){}

    // Sync errors today
    let shopeeErrors = 0, tiktokErrors = 0;
    try {
        const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0));
        const sl = await sb(`/shopee_sync_log?select=error_message&ran_at=gte.${todayStart.toISOString()}`);
        shopeeErrors = (sl || []).filter(r => r.error_message).length;
        const tl = await sb(`/tiktok_sync_log?select=error_message&ran_at=gte.${todayStart.toISOString()}`);
        tiktokErrors = (tl || []).filter(r => r.error_message).length;
    } catch(e){}

    // p1_634 (#3) — price sentinel: products selling below cost / drifted on marketplace
    let belowCost = 0, drift = 0, belowCostSample = [];
    try {
        const ps = await sb('/price_sentinel?select=sku,platform,flag,detail');
        belowCost = (ps || []).filter(r => r.flag === 'below_cost').length;
        drift = (ps || []).filter(r => r.flag === 'drift').length;
        belowCostSample = (ps || []).filter(r => r.flag === 'below_cost').slice(0, 8);
    } catch(e){}

    // p1_638 (#5) — token watchdog: marketplace tokens dead / near-expiry (sync about to go dark)
    let tokenDead = [], tokenWarn = [];
    try {
        const th = await sb('/token_health?select=platform,status,message,refresh_days_left');
        tokenDead = (th || []).filter(r => r.status === 'dead' || r.status === 'critical');
        tokenWarn = (th || []).filter(r => r.status === 'warn');
    } catch(e){}

    // p1_639 (#6) — dead-letter: marketplace price pushes that keep failing
    let pushDead = [], pushPending = 0;
    try {
        const pf = await sb('/push_failures?select=sku,channel,status,attempts,error_message');
        pushDead = (pf || []).filter(r => r.status === 'dead');
        pushPending = (pf || []).filter(r => r.status === 'pending').length;
    } catch(e){}

    // p1_640 (#7) — config/creds preflight failures (env/sanity/auth)
    let configFail = [];
    try {
        const cf = await sb('/config_health?select=check_key,category,status,detail&status=eq.fail');
        configFail = cf || [];
    } catch(e){}

    return {
        date: dateLabel,
        totals: { revenue: totalRevenue, orders: orderCount, aov },
        channels,
        topSkus,
        alerts: { pendingStockCheck, shopeeErrors, tiktokErrors, belowCost, drift, belowCostSample, tokenDead, tokenWarn, pushDead, pushPending, configFail }
    };
}

function buildHTML(d) {
    const dateStr = new Date(d.date + 'T00:00:00').toLocaleDateString('ms-MY', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    const channelRows = d.channels.map(c => `
        <tr>
            <td style="padding:8px 12px;border-bottom:1px solid #eee;">${c.ch}</td>
            <td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:right;">${c.orders}</td>
            <td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:right;font-weight:600;">${fmtRMC(c.revenue)}</td>
        </tr>`).join('');
    const skuRows = d.topSkus.map((s, i) => `
        <tr>
            <td style="padding:6px 12px;border-bottom:1px solid #eee;color:#888;">#${i+1}</td>
            <td style="padding:6px 12px;border-bottom:1px solid #eee;font-weight:600;">${s.sku}</td>
            <td style="padding:6px 12px;border-bottom:1px solid #eee;font-size:12px;color:#555;">${(s.name || '').slice(0, 50)}</td>
            <td style="padding:6px 12px;border-bottom:1px solid #eee;text-align:right;">${s.qty} unit</td>
        </tr>`).join('');
    const a = d.alerts;
    // p1_634 (#3) — CRITICAL: products selling below cost on marketplace (money loss)
    const belowCostBlock = a.belowCost > 0 ? `
        <div style="background:#FEE2E2;border-left:4px solid #DC2626;padding:14px 16px;margin:20px 0;border-radius:6px;">
            <h3 style="margin:0 0 6px;font-size:14px;color:#991B1B;">AMARAN: ${a.belowCost} PRODUK JUAL BAWAH KOS (marketplace)</h3>
            <ul style="margin:0;padding-left:18px;font-size:13px;color:#7F1D1D;">
                ${(a.belowCostSample || []).map(x => `<li><b>${x.sku}</b> (${x.platform}) — ${x.detail}</li>`).join('')}
                ${a.belowCost > (a.belowCostSample || []).length ? `<li>+${a.belowCost - (a.belowCostSample || []).length} lagi</li>` : ''}
            </ul>
            <p style="margin:6px 0 0;font-size:12px;color:#991B1B;">Betulkan harga/diskaun di Shopee/TikTok Seller Center.</p>
        </div>` : '';
    // p1_638 (#5) — CRITICAL: marketplace token dead / about to expire (sync goes dark)
    const tokenDeadBlock = (a.tokenDead && a.tokenDead.length) ? `
        <div style="background:#FEE2E2;border-left:4px solid #DC2626;padding:14px 16px;margin:20px 0;border-radius:6px;">
            <h3 style="margin:0 0 6px;font-size:14px;color:#991B1B;">AMARAN: SAMBUNGAN MARKETPLACE NAK PUTUS</h3>
            <ul style="margin:0;padding-left:18px;font-size:13px;color:#7F1D1D;">
                ${a.tokenDead.map(x => `<li><b>${x.platform}</b> — ${x.message}</li>`).join('')}
            </ul>
            <p style="margin:6px 0 0;font-size:12px;color:#991B1B;">Kalau token putus, harga & stok BERHENTI sync. Authorize semula segera.</p>
        </div>` : '';
    // p1_639 (#6) — CRITICAL: price pushes that gave up after retries (price stuck wrong on marketplace)
    const pushDeadBlock = (a.pushDead && a.pushDead.length) ? `
        <div style="background:#FEE2E2;border-left:4px solid #DC2626;padding:14px 16px;margin:20px 0;border-radius:6px;">
            <h3 style="margin:0 0 6px;font-size:14px;color:#991B1B;">AMARAN: ${a.pushDead.length} PUSH HARGA GAGAL (dah cuba ${5}× — tak jadi)</h3>
            <ul style="margin:0;padding-left:18px;font-size:13px;color:#7F1D1D;">
                ${a.pushDead.slice(0,8).map(x => `<li><b>${x.sku}</b> (${x.channel}) — ${(x.error_message||'').slice(0,80)}</li>`).join('')}
                ${a.pushDead.length > 8 ? `<li>+${a.pushDead.length - 8} lagi</li>` : ''}
            </ul>
            <p style="margin:6px 0 0;font-size:12px;color:#991B1B;">Harga di marketplace mungkin tak ikut POS. Semak listing / mapping produk.</p>
        </div>` : '';
    // p1_640 (#7) — CRITICAL: config/creds broken (split-brain, wrong key, dead auth, missing env)
    const configFailBlock = (a.configFail && a.configFail.length) ? `
        <div style="background:#FEE2E2;border-left:4px solid #DC2626;padding:14px 16px;margin:20px 0;border-radius:6px;">
            <h3 style="margin:0 0 6px;font-size:14px;color:#991B1B;">AMARAN: ${a.configFail.length} MASALAH KONFIGURASI/CREDS</h3>
            <ul style="margin:0;padding-left:18px;font-size:13px;color:#7F1D1D;">
                ${a.configFail.map(x => `<li><b>${x.check_key}</b> — ${(x.detail||'').slice(0,110)}</li>`).join('')}
            </ul>
            <p style="margin:6px 0 0;font-size:12px;color:#991B1B;">Ini punca kegagalan senyap (kunci salah / env hilang / DB salah). Betulkan segera.</p>
        </div>` : '';
    const hasAlerts = a.pendingStockCheck > 0 || a.shopeeErrors > 0 || a.tiktokErrors > 0 || a.drift > 0 || (a.tokenWarn && a.tokenWarn.length) || a.pushPending > 0;
    const alertBlock = hasAlerts ? `
        <div style="background:#FEF3C7;border-left:4px solid #D97706;padding:14px 16px;margin:20px 0;border-radius:6px;">
            <h3 style="margin:0 0 6px;font-size:14px;color:#92400E;">PERHATIAN</h3>
            <ul style="margin:0;padding-left:18px;font-size:13px;color:#7C2D12;">
                ${(a.tokenWarn || []).map(x => `<li>${x.message}</li>`).join('')}
                ${a.pushPending > 0 ? `<li>${a.pushPending} push harga gagal — tengah auto-retry</li>` : ''}
                ${a.drift > 0 ? `<li>${a.drift} harga DRIFT (POS tak sama dengan harga live marketplace)</li>` : ''}
                ${a.pendingStockCheck > 0 ? `<li>${a.pendingStockCheck} stock check report menunggu review</li>` : ''}
                ${a.shopeeErrors > 0 ? `<li>${a.shopeeErrors} Shopee sync errors hari ni</li>` : ''}
                ${a.tiktokErrors > 0 ? `<li>${a.tiktokErrors} TikTok sync errors hari ni</li>` : ''}
            </ul>
        </div>` : '';

    return `<!doctype html><html><body style="margin:0;padding:0;background:#F4F6F8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<div style="max-width:600px;margin:20px auto;background:#FFF;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,.08);">
    <div style="background:linear-gradient(135deg,#CD7C32 0%,#A05F22 100%);padding:24px;color:#FFF;">
        <h1 style="margin:0 0 4px;font-size:22px;font-weight:800;">10 CAMP — Daily Digest</h1>
        <p style="margin:0;font-size:13px;opacity:.9;">${dateStr}</p>
    </div>
    <div style="padding:24px;">
        <div style="text-align:center;padding:20px 0;border-bottom:1px solid #eee;">
            <div style="font-size:12px;color:#888;font-weight:700;text-transform:uppercase;letter-spacing:.5px;">JUALAN SEMALAM</div>
            <div style="font-size:36px;font-weight:800;color:#CD7C32;margin-top:6px;">${fmtRM(d.totals.revenue)}</div>
            <div style="font-size:13px;color:#666;margin-top:4px;">${d.totals.orders} pesanan · ${fmtRM(d.totals.aov)} purata</div>
        </div>
        ${configFailBlock}
        ${tokenDeadBlock}
        ${pushDeadBlock}
        ${belowCostBlock}
        ${alertBlock}
        <h2 style="font-size:14px;margin:24px 0 10px;color:#333;">Sales by Channel</h2>
        <table style="width:100%;border-collapse:collapse;font-size:13px;">
            <thead><tr style="background:#F9FAFB;">
                <th style="padding:8px 12px;text-align:left;font-size:11px;color:#666;text-transform:uppercase;">Channel</th>
                <th style="padding:8px 12px;text-align:right;font-size:11px;color:#666;text-transform:uppercase;">Orders</th>
                <th style="padding:8px 12px;text-align:right;font-size:11px;color:#666;text-transform:uppercase;">Revenue</th>
            </tr></thead>
            <tbody>${channelRows || '<tr><td colspan="3" style="padding:14px;text-align:center;color:#999;">Tiada sales semalam</td></tr>'}</tbody>
        </table>
        ${d.topSkus.length > 0 ? `
        <h2 style="font-size:14px;margin:24px 0 10px;color:#333;">Top 5 SKU Laku</h2>
        <table style="width:100%;border-collapse:collapse;font-size:13px;">
            <tbody>${skuRows}</tbody>
        </table>` : ''}
        <div style="margin-top:30px;padding:14px;background:#F9FAFB;border-radius:8px;text-align:center;">
            <a href="https://www.10camp.com" style="color:#CD7C32;text-decoration:none;font-size:13px;font-weight:600;">Buka POS Dashboard →</a>
        </div>
    </div>
    <div style="padding:14px 24px;background:#F9FAFB;border-top:1px solid #eee;color:#999;font-size:11px;text-align:center;">
        Auto-generated daily digest · 10 CAMP POS · ${new Date().toISOString()}
    </div>
</div>
</body></html>`;
}

async function sendEmail(html, subject) {
    if (!RESEND_KEY) throw new Error('RESEND_API_KEY tak set');
    if (!RECIPIENTS.length) throw new Error('DIGEST_RECIPIENTS tak set');
    const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: FROM_ADDR, to: RECIPIENTS, subject, html })
    });
    const j = await res.json();
    if (!res.ok) throw new Error(`Resend ${res.status}: ${JSON.stringify(j).slice(0, 200)}`);
    return j;
}

exports.handler = async (event) => {
    const isManualSend = event && event.queryStringParameters && event.queryStringParameters.send === '1';
    const isPreview = event && event.queryStringParameters && event.queryStringParameters.preview === '1';

    try {
        const digest = await buildDigest();
        const html = buildHTML(digest);
        const subject = `10 CAMP Daily Digest · ${digest.date} · ${fmtRMC(digest.totals.revenue)} revenue`;

        if (isPreview) {
            return { statusCode: 200, headers: { 'Content-Type': 'text/html' }, body: html };
        }

        // Scheduled invocation OR manual ?send=1
        if (event && event.next_run || isManualSend) {
            const result = await sendEmail(html, subject);
            return { statusCode: 200, body: JSON.stringify({ ok: true, sent_to: RECIPIENTS, resend_id: result.id, digest_summary: { revenue: digest.totals.revenue, orders: digest.totals.orders } }) };
        }

        // Default GET: return digest JSON for inspection
        return { statusCode: 200, body: JSON.stringify({ ok: true, preview_only: true, digest, note: 'Add ?send=1 to send. Add ?preview=1 to view HTML.' }, null, 2) };
    } catch (err) {
        return { statusCode: 500, body: JSON.stringify({ error: String(err) }) };
    }
};
