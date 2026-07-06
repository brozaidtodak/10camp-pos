/**
 * meta-settings.js — save / read Meta (FB+IG) Graph API config (p1_1078).
 *
 *   GET   → connection STATUS only (never returns the access token).
 *           { connected, page_id, page_name, ig_user_id, business_id, has_token, token_updated_at }
 *   POST  → save config. Body: { page_id?, page_access_token?, ig_user_id?, business_id?, page_name? }
 *           Validates the token against Graph /me before saving; resolves page_name if page_id given.
 *
 * Gated by requireAuth (staff session). The token is write-only from the browser's POV:
 * it goes IN via POST but never comes back OUT via GET.
 *
 * Public URL: /.netlify/functions/meta-settings
 */
const { getMetaConfig, saveMetaConfig, graph } = require('./_meta');
const { requireAuth } = require('./_auth');

function json(code, obj) {
    return { statusCode: code, headers: { 'Content-Type': 'application/json; charset=utf-8' }, body: JSON.stringify(obj, null, 2) };
}

exports.handler = async (event) => {
    const auth = await requireAuth(event);
    if (!auth.ok) return auth.response;

    try {
        if (event.httpMethod === 'GET') {
            const cfg = await getMetaConfig();
            if (!cfg) return json(200, { connected: false, has_token: false });
            return json(200, {
                connected: !!cfg.page_access_token,
                has_token: !!cfg.page_access_token,
                page_id: cfg.page_id || null,
                page_name: cfg.page_name || null,
                ig_user_id: cfg.ig_user_id || null,
                business_id: cfg.business_id || null,
                token_updated_at: cfg.token_updated_at || null,
                updated_by: cfg.updated_by || null
            });
        }

        if (event.httpMethod === 'POST') {
            let body = {};
            try { body = JSON.parse(event.body || '{}'); } catch (e) { return json(400, { error: 'bad json' }); }

            const patch = {};
            ['page_id', 'ig_user_id', 'business_id', 'page_name'].forEach(k => {
                if (body[k] != null && String(body[k]).trim() !== '') patch[k] = String(body[k]).trim();
            });

            const token = body.page_access_token != null ? String(body.page_access_token).trim() : '';
            if (token) {
                // Validate before saving so we never store a dead token.
                let me;
                try {
                    me = await graph('/me', { token, query: { fields: 'id,name' } });
                } catch (e) {
                    return json(400, { error: 'token_invalid', detail: e.message || String(e) });
                }
                patch.page_access_token = token;
                // If caller didn't pass a page name but /me returned one (page token → page identity), keep it.
                if (!patch.page_name && me && me.name) patch.page_name = me.name;
                if (!patch.page_id && me && me.id) patch.page_id = me.id;
            }

            if (!Object.keys(patch).length) return json(400, { error: 'nothing to save' });

            const saved = await saveMetaConfig(patch, (auth.user && (auth.user.email || auth.user.id)) || 'staff');
            const row = Array.isArray(saved) ? saved[0] : saved;
            return json(200, {
                ok: true,
                connected: !!(row && row.page_access_token),
                page_id: row && row.page_id || null,
                page_name: row && row.page_name || null,
                ig_user_id: row && row.ig_user_id || null
            });
        }

        return json(405, { error: 'method not allowed' });
    } catch (e) {
        return json(500, { error: String(e && e.message || e) });
    }
};
