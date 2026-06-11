/**
 * config-check.js — Integration hardening #7 (p1_640). Non-background (returns 200
 * sync) so ?mode=peek is inspectable on demand.
 *
 * Preflight self-test for the config/creds that silently break integrations. This is
 * the class of bug behind the worst incidents this round:
 *   - wrong SHOPEE_PUSH_KEY (test key in prod)  → webhook signatures failed silently for months
 *   - env-scope gotcha (site-level vars unseen by functions) → OPENAI/keys "set" but invisible
 *   - split-brain DB (app pointed at the wrong Supabase project)
 *
 * Runs IN the function runtime (so it sees exactly what the integrations see) and probes:
 *   env    — required env vars actually present
 *   sanity — values sane (right Supabase project, Shopee on live, push key is NOT a placeholder/test key)
 *   auth   — a real authenticated API call to each marketplace succeeds (catches wrong partner key / dead auth)
 * Writes results to config_health (replaced each run). Surfaced in health dashboard #4,
 * daily email, and the in-POS alert card. ?mode=peek returns without writing.
 */
const tt = require('./_tiktok');
const sp = require('./_shopee');

const EXPECTED_PROJECT = 'asehjdnfzoypbwfeazra'; // POS-System-Test — split-brain guard
const json = (code, obj) => ({ statusCode: code, headers: { 'Content-Type': 'application/json; charset=utf-8' }, body: JSON.stringify(obj, null, 2) });
const present = (v) => typeof v === 'string' && v.trim().length > 0;

function envChecks() {
    const e = process.env;
    // [key, severity-if-missing] — fail = breaks a core integration; warn = degrades a feature
    const req = [
        ['SUPABASE_URL', 'fail'], ['SUPABASE_SERVICE_KEY', 'fail'],
        ['SHOPEE_PARTNER_ID', 'fail'], ['SHOPEE_PARTNER_KEY', 'fail'], ['SHOPEE_ENV', 'fail'],
        ['SHOPEE_PUSH_KEY', 'fail'], ['TIKTOK_APP_KEY', 'fail'], ['TIKTOK_APP_SECRET', 'fail'],
        ['RESEND_API_KEY', 'warn'], ['OPENAI_API_KEY', 'warn']
    ];
    return req.map(([k, sev]) => present(e[k])
        ? { check_key: `env:${k}`, category: 'env', status: 'ok', detail: 'ada' }
        : { check_key: `env:${k}`, category: 'env', status: sev, detail: 'TIADA dalam runtime fungsi (semak env account-level + scope functions)' });
}

function sanityChecks() {
    const e = process.env;
    const out = [];
    // Right Supabase project (split-brain guard)
    const url = e.SUPABASE_URL || '';
    out.push(url.includes(EXPECTED_PROJECT)
        ? { check_key: 'sanity:supabase_project', category: 'sanity', status: 'ok', detail: EXPECTED_PROJECT }
        : { check_key: 'sanity:supabase_project', category: 'sanity', status: 'fail', detail: `SUPABASE_URL bukan projek ${EXPECTED_PROJECT} (split-brain?) → ${url.slice(0, 60)}` });
    // Shopee must be live in production
    const env = (e.SHOPEE_ENV || '').toLowerCase();
    out.push(env === 'live'
        ? { check_key: 'sanity:shopee_env', category: 'sanity', status: 'ok', detail: 'live' }
        : { check_key: 'sanity:shopee_env', category: 'sanity', status: 'warn', detail: `SHOPEE_ENV = "${env || '(kosong)'}" (bukan live)` });
    // Push key must NOT be a placeholder / test key (the exact months-long webhook bug)
    const pk = e.SHOPEE_PUSH_KEY || '';
    const looksTest = !pk || pk.length < 16 || /^(.)\1+$/.test(pk) || /^a{4,}/i.test(pk) || /test|placeholder|xxxx/i.test(pk);
    out.push(looksTest
        ? { check_key: 'sanity:shopee_push_key', category: 'sanity', status: 'fail', detail: 'SHOPEE_PUSH_KEY nampak macam kunci TEST/placeholder — webhook Shopee akan gagal sign senyap. Guna Live Push Partner Key.' }
        : { check_key: 'sanity:shopee_push_key', category: 'sanity', status: 'ok', detail: 'bukan placeholder' });
    return out;
}

async function authChecks() {
    const out = [];
    // Shopee: real authed call — get_shop_info. Catches wrong partner key / sign mismatch / dead token.
    try {
        const tok = await sp.getValidToken();
        const r = await sp.shopeeGet('/api/v2/shop/get_shop_info', {}, tok.access_token, tok.shop_id);
        if (r && r.error) out.push({ check_key: 'auth:shopee', category: 'auth', status: 'fail', detail: `Shopee API tolak: ${r.error} ${r.message || ''}`.slice(0, 200) });
        else out.push({ check_key: 'auth:shopee', category: 'auth', status: 'ok', detail: 'authed call OK (get_shop_info)' });
    } catch (e) { out.push({ check_key: 'auth:shopee', category: 'auth', status: 'fail', detail: `Shopee auth gagal: ${String(e).slice(0, 160)}` }); }
    // TikTok: getValidToken + ensureShopCipher (the cipher call is itself an authed shop API hit).
    try {
        const tok = await tt.getValidToken();
        await tt.ensureShopCipher(tok);
        out.push({ check_key: 'auth:tiktok', category: 'auth', status: 'ok', detail: 'authed call OK (shop cipher)' });
    } catch (e) { out.push({ check_key: 'auth:tiktok', category: 'auth', status: 'fail', detail: `TikTok auth gagal: ${String(e).slice(0, 160)}` }); }
    return out;
}

exports.handler = async (event) => {
    const mode = (event && event.queryStringParameters && event.queryStringParameters.mode) || 'sync';
    const now = new Date().toISOString();
    let checks = [];
    checks = checks.concat(envChecks(), sanityChecks());
    try { checks = checks.concat(await authChecks()); }
    catch (e) { checks.push({ check_key: 'auth:error', category: 'auth', status: 'fail', detail: String(e).slice(0, 160) }); }

    const summary = { ok: checks.filter(c => c.status === 'ok').length, warn: checks.filter(c => c.status === 'warn').length, fail: checks.filter(c => c.status === 'fail').length };
    if (mode === 'peek') return json(200, { mode, summary, checks });

    // replace all rows
    await tt.sb('DELETE', '/config_health?check_key=neq.__never__', null, { Prefer: 'return=minimal' });
    const rows = checks.map(c => Object.assign({}, c, { checked_at: now }));
    for (let i = 0; i < rows.length; i += 200) await tt.sb('POST', '/config_health', rows.slice(i, i + 200), { Prefer: 'return=minimal' });
    return json(200, { checked_at: now, summary });
};
