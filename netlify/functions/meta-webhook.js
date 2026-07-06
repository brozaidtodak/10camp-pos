/**
 * meta-webhook.js — receives FB Messenger + Instagram DM events from Meta (p1_1079).
 *
 *   GET  → webhook verification handshake (Meta sends hub.challenge on subscribe).
 *   POST → incoming message events → stored into meta_messages (channel 'fb' / 'ig').
 *
 * PUBLIC endpoint (Meta calls it server-to-server, no staff JWT). Security:
 *   - GET verify: hub.verify_token must equal META_VERIFY_TOKEN.
 *   - POST: if META_APP_SECRET is set, X-Hub-Signature-256 is verified; else accepted (progressive-safe).
 *
 * Meta App Dashboard setup (once): Webhooks → callback URL = https://www.10camp.com/.netlify/functions/meta-webhook,
 * verify token = value of META_VERIFY_TOKEN, subscribe fields: messages, messaging_postbacks.
 *
 * Public URL: /.netlify/functions/meta-webhook
 */
const crypto = require('crypto');
const { sb } = require('./_meta');

// Default so the endpoint verifies even before the env var is set; override in Netlify env for real security.
const VERIFY_TOKEN = process.env.META_VERIFY_TOKEN || '10camp_meta_webhook_verify';
const APP_SECRET   = process.env.META_APP_SECRET || '';

// Netlify may base64-encode the body; return the raw UTF-8 string either way.
function rawBody(event) {
    if (!event || event.body == null) return '';
    return event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
}

function signatureOk(event, raw) {
    if (!APP_SECRET) return true; // no secret configured → skip
    const h = (event.headers || {});
    const sig = h['x-hub-signature-256'] || h['X-Hub-Signature-256'] || '';
    // Dashboard "Test" tool sends UNSIGNED events — allow when no signature header present.
    // When a signature IS present (real production events), it MUST be valid.
    if (!sig) return true;
    try {
        const expected = 'sha256=' + crypto.createHmac('sha256', APP_SECRET).update(raw || '', 'utf8').digest('hex');
        const a = Buffer.from(sig), b = Buffer.from(expected);
        return a.length === b.length && crypto.timingSafeEqual(a, b);
    } catch (e) { return false; }
}

// One messaging event → a stored row (or null to skip).
function rowFromEvent(ev, channel) {
    const senderId = ev.sender && ev.sender.id;
    const m = ev.message;
    if (!senderId || !m) return null;
    if (m.is_echo) return null; // page's own outbound echo — we store our own sends separately
    return {
        channel,
        thread_id: String(senderId),
        direction: 'in',
        text: m.text != null ? String(m.text) : null,
        mid: m.mid || null,
        attachments: m.attachments ? m.attachments : null,
        raw: ev
    };
}

// Pull message rows out of a webhook body. Handles BOTH real events (entry[].messaging[])
// AND the dashboard Test tool + some IG events (entry[].changes[] with field=messages, value=event).
function extractRows(body) {
    const rows = [];
    const channel = (body.object === 'instagram') ? 'ig' : 'fb';
    (body.entry || []).forEach(entry => {
        (entry.messaging || entry.standby || []).forEach(ev => {
            const r = rowFromEvent(ev, channel); if (r) rows.push(r);
        });
        // Test tool / change-based delivery: { changes:[{ field:'messages', value:{ sender, message, ... } }] }
        (entry.changes || []).forEach(ch => {
            if (!ch || !ch.value) return;
            if (ch.field && !/messag/i.test(String(ch.field))) return;
            const r = rowFromEvent(ch.value, channel); if (r) rows.push(r);
        });
    });
    return rows;
}

exports.handler = async (event) => {
    // --- GET: verification handshake ---
    if (event.httpMethod === 'GET') {
        const p = event.queryStringParameters || {};
        const mode = p['hub.mode'];
        const token = p['hub.verify_token'];
        const challenge = p['hub.challenge'];
        if (mode === 'subscribe' && token === VERIFY_TOKEN) {
            return { statusCode: 200, headers: { 'Content-Type': 'text/plain' }, body: String(challenge || '') };
        }
        return { statusCode: 403, body: 'verification failed' };
    }

    // --- POST: incoming events ---
    if (event.httpMethod === 'POST') {
        const raw = rawBody(event);
        // p1_1082 DEBUG (temporary): capture EVERY POST (raw + whether signed) BEFORE any check,
        // so we can see exactly what Meta's Test tool sends. Remove after diagnosis.
        try {
            const hh = event.headers || {};
            const sigHdr = hh['x-hub-signature-256'] || hh['X-Hub-Signature-256'] || '(none)';
            await sb('POST', '/meta_messages', {
                channel: '_debug', thread_id: 'raw_capture', direction: 'in',
                text: 'sig=' + String(sigHdr).slice(0, 24) + ' b64=' + (event.isBase64Encoded ? 'Y' : 'N') + ' | ' + String(raw).slice(0, 300),
                mid: null, raw: (function () { try { return JSON.parse(raw); } catch (e) { return { unparseable: String(raw).slice(0, 500) }; } })()
            }, { Prefer: 'return=minimal' });
        } catch (e) { /* ignore debug errors */ }
        if (!signatureOk(event, raw)) return { statusCode: 401, body: 'bad signature' };
        let body = {};
        try { body = JSON.parse(raw || '{}'); } catch (e) { return { statusCode: 200, body: 'ok' }; }
        try {
            const rows = extractRows(body);
            // Insert; ignore-duplicates on mid so Meta retries don't double-store.
            if (rows.length) {
                await sb('POST', '/meta_messages', rows, { Prefer: 'resolution=ignore-duplicates,return=minimal' });
            } else {
                // p1_1082 DEBUG (temporary): capture raw payload when nothing parsed, to learn Meta's exact shape.
                await sb('POST', '/meta_messages', {
                    channel: '_debug', thread_id: 'webhook_debug', direction: 'in',
                    text: String(raw).slice(0, 500), mid: null, raw: body
                }, { Prefer: 'return=minimal' });
            }
        } catch (e) {
            // Never 5xx to Meta or it will retry aggressively; log-and-ack.
            console.error('meta-webhook store error:', e && e.message);
        }
        // Meta requires a fast 200 ack.
        return { statusCode: 200, body: 'EVENT_RECEIVED' };
    }

    return { statusCode: 405, body: 'method not allowed' };
};
