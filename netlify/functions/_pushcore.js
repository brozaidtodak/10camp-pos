/**
 * _pushcore.js — enjin push notification (p1_1119).
 *
 * Dua laluan hantar:
 *   iOS     → APNs terus (HTTP/2 + kunci .p8). Tiada Firebase SDK dalam app iOS.
 *   Android → FCM HTTP v1 (service account Firebase).
 *
 * Env (WAJIB set di ACCOUNT level Netlify — functions tak nampak site-level, gotcha lama):
 *   FIREBASE_SERVICE_ACCOUNT — kandungan JSON service account Firebase (untuk Android)
 *   APNS_KEY_P8              — kandungan fail .p8 APNs Auth Key (untuk iOS)
 *   APNS_KEY_ID              — Key ID kunci .p8
 *   APPLE_TEAM_ID            — Team ID akaun Apple Developer
 *   APNS_TOPIC               — bundle id app (com.tencamp.pos)
 *   APNS_ENV                 — 'prod' (App Store/TestFlight) atau 'dev' (Xcode run). Default prod.
 *
 * Fail "_" tidak di-deploy sebagai endpoint (modul privat).
 */

const crypto = require('crypto');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://asehjdnfzoypbwfeazra.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || '';

// ---------- Supabase REST ringkas ----------
async function sbFetch(method, path, body, headers) {
    const res = await fetch(SUPABASE_URL + '/rest/v1' + path, {
        method,
        headers: Object.assign({
            apikey: SERVICE_KEY,
            Authorization: 'Bearer ' + SERVICE_KEY,
            'Content-Type': 'application/json'
        }, headers || {}),
        body: body ? JSON.stringify(body) : undefined
    });
    if (!res.ok) throw new Error('supabase ' + method + ' ' + path + ' -> ' + res.status);
    const txt = await res.text();
    return txt ? JSON.parse(txt) : null;
}

// ---------- OAuth token FCM (cache dalam invocation container) ----------
let _fcmTok = null; // { token, exp }
function b64url(buf) { return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }

async function fcmAccessToken(sa) {
    const now = Math.floor(Date.now() / 1000);
    if (_fcmTok && _fcmTok.exp > now + 60) return _fcmTok.token;
    const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const claims = b64url(JSON.stringify({
        iss: sa.client_email,
        scope: 'https://www.googleapis.com/auth/firebase.messaging',
        aud: 'https://oauth2.googleapis.com/token',
        iat: now, exp: now + 3600
    }));
    const sig = crypto.createSign('RSA-SHA256').update(header + '.' + claims).sign(sa.private_key);
    const jwt = header + '.' + claims + '.' + b64url(sig);
    const res = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'grant_type=' + encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer') + '&assertion=' + jwt
    });
    if (!res.ok) throw new Error('oauth fcm -> ' + res.status + ' ' + (await res.text()).slice(0, 200));
    const j = await res.json();
    _fcmTok = { token: j.access_token, exp: now + (j.expires_in || 3600) };
    return _fcmTok.token;
}

async function sendFcm(token, title, body, data) {
    const saRaw = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!saRaw) return { ok: false, dead: false, why: 'FIREBASE_SERVICE_ACCOUNT missing' };
    const sa = JSON.parse(saRaw);
    const access = await fcmAccessToken(sa);
    const res = await fetch('https://fcm.googleapis.com/v1/projects/' + sa.project_id + '/messages:send', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + access, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            message: {
                token,
                notification: { title, body },
                data: data || {},
                android: { priority: 'high', notification: { sound: 'default', channel_id: 'orders' } }
            }
        })
    });
    if (res.ok) return { ok: true };
    const txt = await res.text();
    // UNREGISTERED / INVALID_ARGUMENT token mati — buang dari DB
    const dead = res.status === 404 || /UNREGISTERED|INVALID_ARGUMENT/.test(txt);
    return { ok: false, dead, why: 'fcm ' + res.status + ' ' + txt.slice(0, 160) };
}

// ---------- APNs (iOS) — HTTP/2 + JWT p8 ----------
let _apnsTok = null; // { token, iat }
function apnsJwt() {
    const now = Math.floor(Date.now() / 1000);
    // APNs terima JWT berumur < 1 jam; refresh tiap 45 min
    if (_apnsTok && (now - _apnsTok.iat) < 2700) return _apnsTok.token;
    const header = b64url(JSON.stringify({ alg: 'ES256', kid: process.env.APNS_KEY_ID }));
    const claims = b64url(JSON.stringify({ iss: process.env.APPLE_TEAM_ID, iat: now }));
    const sig = crypto.createSign('SHA256').update(header + '.' + claims)
        .sign({ key: process.env.APNS_KEY_P8, dsaEncoding: 'ieee-p1363' });
    const jwt = header + '.' + claims + '.' + b64url(sig);
    _apnsTok = { token: jwt, iat: now };
    return jwt;
}

function sendApns(token, title, body, data) {
    return new Promise((resolve) => {
        if (!process.env.APNS_KEY_P8 || !process.env.APNS_KEY_ID || !process.env.APPLE_TEAM_ID) {
            return resolve({ ok: false, dead: false, why: 'APNS env missing' });
        }
        const http2 = require('http2');
        const host = (process.env.APNS_ENV === 'dev') ? 'https://api.sandbox.push.apple.com' : 'https://api.push.apple.com';
        const client = http2.connect(host);
        client.on('error', (e) => { try { client.close(); } catch (_) {} resolve({ ok: false, dead: false, why: 'apns conn ' + e.message }); });
        const req = client.request({
            ':method': 'POST',
            ':path': '/3/device/' + token,
            authorization: 'bearer ' + apnsJwt(),
            'apns-topic': process.env.APNS_TOPIC || 'com.tencamp.pos',
            'apns-push-type': 'alert',
            'apns-priority': '10'
        });
        let status = 0, chunks = '';
        req.on('response', (h) => { status = h[':status']; });
        req.on('data', (c) => { chunks += c; });
        req.on('end', () => {
            try { client.close(); } catch (_) {}
            if (status === 200) return resolve({ ok: true });
            const dead = status === 410 || /BadDeviceToken|Unregistered/.test(chunks);
            resolve({ ok: false, dead, why: 'apns ' + status + ' ' + chunks.slice(0, 160) });
        });
        req.setTimeout(8000, () => { try { req.close(); client.close(); } catch (_) {} resolve({ ok: false, dead: false, why: 'apns timeout' }); });
        req.end(JSON.stringify({
            aps: { alert: { title, body }, sound: 'default', badge: 1 },
            data: data || {}
        }));
    });
}

// ---------- API utama ----------
/**
 * Hantar notification ke SEMUA peranti berdaftar.
 * opts = { title, body, data }
 */
async function sendToAll(opts) {
    let rows = [];
    try {
        rows = await sbFetch('GET', '/push_tokens?select=token,platform&order=last_seen.desc&limit=200') || [];
    } catch (e) {
        return { sent: 0, failed: 0, why: 'tokens fetch: ' + e.message };
    }
    if (!rows.length) return { sent: 0, failed: 0, why: 'no tokens' };
    let sent = 0, failed = 0;
    const deadTokens = [];
    for (const r of rows) {
        try {
            const res = (r.platform === 'ios')
                ? await sendApns(r.token, opts.title, opts.body, opts.data)
                : await sendFcm(r.token, opts.title, opts.body, opts.data);
            if (res.ok) sent++;
            else { failed++; if (res.dead) deadTokens.push(r.token); }
        } catch (e) { failed++; }
    }
    // Buang token mati supaya senarai kekal bersih
    if (deadTokens.length) {
        try { await sbFetch('DELETE', '/push_tokens?token=in.(' + deadTokens.map(t => '"' + t + '"').join(',') + ')'); } catch (_) {}
    }
    return { sent, failed };
}

/**
 * Notification "order masuk" — dipanggil dari sync Shopee/TikTok & checkout kasir/web.
 * info = { channel, count, total }  (total = RM, optional)
 */
async function notifyNewOrders(info) {
    const count = info.count || 1;
    const ch = info.channel || 'POS';
    const rm = (info.total != null) ? ' — RM' + Number(info.total).toFixed(2) : '';
    const title = count > 1 ? (count + ' order baru masuk (' + ch + ')') : ('Order baru masuk (' + ch + ')');
    const body = (count > 1 ? count + ' pesanan baru diterima' : 'Satu pesanan baru diterima') + rm + '. Buka POS untuk proses.';
    return sendToAll({ title, body, data: { kind: 'new_order', channel: ch } });
}

/**
 * p1_1178 — Push ke SEORANG staf sahaja (ikut push_tokens.staff_id).
 * opts = { title, body, data }
 */
async function sendToStaff(staffId, opts) {
    let rows = [];
    try {
        rows = await sbFetch('GET', '/push_tokens?select=token,platform&staff_id=eq.' + encodeURIComponent(staffId) + '&order=last_seen.desc&limit=10') || [];
    } catch (e) {
        return { sent: 0, failed: 0, why: 'tokens fetch: ' + e.message };
    }
    if (!rows.length) return { sent: 0, failed: 0, why: 'no tokens for ' + staffId };
    let sent = 0, failed = 0;
    const deadTokens = [];
    for (const r of rows) {
        try {
            const res = (r.platform === 'ios')
                ? await sendApns(r.token, opts.title, opts.body, opts.data)
                : await sendFcm(r.token, opts.title, opts.body, opts.data);
            if (res.ok) sent++;
            else { failed++; if (res.dead) deadTokens.push(r.token); }
        } catch (e) { failed++; }
    }
    if (deadTokens.length) {
        try { await sbFetch('DELETE', '/push_tokens?token=in.(' + deadTokens.map(t => '"' + t + '"').join(',') + ')'); } catch (_) {}
    }
    return { sent, failed };
}

module.exports = { sendToAll, sendToStaff, notifyNewOrders };
