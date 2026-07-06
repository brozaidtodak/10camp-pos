/**
 * _meta.js — shared Meta (Facebook / Instagram) Graph API helper (p1_1078).
 *
 * Reads the single-row config from `meta_tokens` (service-role only; RLS-locked so the
 * page access token never reaches the browser) and wraps Graph API calls.
 *
 * Files prefixed "_" are ignored by Netlify's function scanner (private module).
 */
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://asehjdnfzoypbwfeazra.supabase.co';
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY || '';

// Graph API version — bump when Meta deprecates. v21.0 is current-stable as of 2026-07.
const GRAPH_VERSION = process.env.META_GRAPH_VERSION || 'v21.0';
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

async function sb(method, path, body, extraHeaders) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
        method,
        headers: Object.assign({
            apikey: SERVICE_KEY,
            Authorization: `Bearer ${SERVICE_KEY}`,
            'Content-Type': 'application/json'
        }, extraHeaders || {}),
        body: body ? JSON.stringify(body) : undefined
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`Supabase ${res.status}: ${text.slice(0, 300)}`);
    return text ? JSON.parse(text) : null;
}

// Returns the meta_tokens row (or null if never configured).
async function getMetaConfig() {
    const rows = await sb('GET', '/meta_tokens?id=eq.1&limit=1');
    return (Array.isArray(rows) && rows.length) ? rows[0] : null;
}

// Upsert the single config row. Only the provided fields are written.
async function saveMetaConfig(patch, updatedBy) {
    const body = Object.assign({ id: 1, token_updated_at: new Date().toISOString(), updated_by: updatedBy || null }, patch);
    // Postgres upsert via PostgREST: POST with resolution=merge-duplicates on the PK.
    return sb('POST', '/meta_tokens', body, { Prefer: 'resolution=merge-duplicates,return=representation' });
}

/**
 * graph(path, { token, query, method, body }) — call Graph API. `path` starts with "/" (e.g. "/me").
 * GET by default; pass method:'POST' + body (object) to write (e.g. send a message).
 * Returns parsed JSON. Throws Error with Meta's message on non-2xx so callers can surface it.
 */
async function graph(path, { token, query, method, body } = {}) {
    const q = new URLSearchParams(Object.assign({}, query || {}));
    if (token) q.set('access_token', token);
    const url = `${GRAPH_BASE}${path}?${q.toString()}`;
    const opts = { method: method || 'GET' };
    if (body != null) {
        opts.headers = { 'Content-Type': 'application/json' };
        opts.body = JSON.stringify(body);
    }
    const res = await fetch(url, opts);
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (e) { /* non-json */ }
    if (!res.ok) {
        const msg = (data && data.error && data.error.message) ? data.error.message : `Graph ${res.status}: ${text.slice(0, 200)}`;
        const err = new Error(msg);
        err.graph = (data && data.error) || null;
        err.status = res.status;
        throw err;
    }
    return data;
}

module.exports = { sb, getMetaConfig, saveMetaConfig, graph, GRAPH_VERSION };
