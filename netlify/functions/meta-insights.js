/**
 * meta-insights.js — read-only Meta (FB Page + IG) insights for the POS Marketing hub (p1_1078).
 *
 *   ?mode=page   (default) — page identity + follower/fan count + 28-day reach & impressions
 *   ?mode=posts            — recent published posts with basic engagement
 *   ?mode=ig               — linked Instagram business account: followers + recent media
 *
 * Reads the page access token from meta_tokens (service-role only). If nothing is configured
 * yet, returns { connected:false } so the UI can show the connect card instead of an error.
 *
 * Gated by requireAuth. Public URL: /.netlify/functions/meta-insights
 */
const { getMetaConfig, graph } = require('./_meta');
const { requireAuth } = require('./_auth');

function json(code, obj) {
    return { statusCode: code, headers: { 'Content-Type': 'application/json; charset=utf-8' }, body: JSON.stringify(obj, null, 2) };
}

// Sum a Graph insights metric response ({ data:[{ values:[{value}] }] }) into one number.
function sumMetric(insights, name) {
    try {
        const m = (insights && insights.data || []).find(x => x.name === name);
        if (!m) return null;
        return (m.values || []).reduce((a, v) => a + (Number(v.value) || 0), 0);
    } catch (e) { return null; }
}

exports.handler = async (event) => {
    const auth = await requireAuth(event);
    if (!auth.ok) return auth.response;

    const p = (event && event.queryStringParameters) || {};
    const mode = p.mode || 'page';

    let cfg;
    try { cfg = await getMetaConfig(); } catch (e) { return json(500, { error: 'config read failed: ' + (e.message || e) }); }
    if (!cfg || !cfg.page_access_token) return json(200, { connected: false });

    const token = cfg.page_access_token;
    const pageId = cfg.page_id;

    try {
        if (mode === 'posts') {
            if (!pageId) return json(400, { error: 'page_id not set' });
            const r = await graph(`/${encodeURIComponent(pageId)}/posts`, {
                token,
                query: { fields: 'id,message,created_time,permalink_url,shares,likes.summary(true),comments.summary(true)', limit: 10 }
            });
            const posts = (r.data || []).map(x => ({
                id: x.id,
                message: x.message || '',
                created_time: x.created_time,
                permalink_url: x.permalink_url || '',
                likes: (x.likes && x.likes.summary && x.likes.summary.total_count) || 0,
                comments: (x.comments && x.comments.summary && x.comments.summary.total_count) || 0,
                shares: (x.shares && x.shares.count) || 0
            }));
            return json(200, { connected: true, posts });
        }

        if (mode === 'ig') {
            if (!cfg.ig_user_id) return json(200, { connected: true, ig: null, note: 'ig_user_id not set' });
            const ig = await graph(`/${encodeURIComponent(cfg.ig_user_id)}`, {
                token, query: { fields: 'username,followers_count,media_count,profile_picture_url' }
            });
            let media = [];
            try {
                const m = await graph(`/${encodeURIComponent(cfg.ig_user_id)}/media`, {
                    token, query: { fields: 'id,caption,media_type,permalink,timestamp,like_count,comments_count', limit: 8 }
                });
                media = m.data || [];
            } catch (e) { /* media optional */ }
            return json(200, { connected: true, ig, media });
        }

        // default: page
        if (!pageId) return json(400, { error: 'page_id not set' });
        const page = await graph(`/${encodeURIComponent(pageId)}`, {
            token, query: { fields: 'name,followers_count,fan_count,link,picture{url}' }
        });
        // 28-day reach + impressions. Wrapped so a metric-permission error doesn't kill the whole call.
        let reach = null, impressions = null;
        try {
            const ins = await graph(`/${encodeURIComponent(pageId)}/insights`, {
                token, query: { metric: 'page_impressions_unique,page_impressions', period: 'days_28' }
            });
            reach = sumMetric(ins, 'page_impressions_unique');
            impressions = sumMetric(ins, 'page_impressions');
        } catch (e) { /* insights need extra perms; skip gracefully */ }

        return json(200, {
            connected: true,
            page: {
                name: page.name || cfg.page_name || null,
                followers: page.followers_count != null ? page.followers_count : (page.fan_count != null ? page.fan_count : null),
                link: page.link || null,
                picture: (page.picture && page.picture.data && page.picture.data.url) || null
            },
            reach_28d: reach,
            impressions_28d: impressions
        });
    } catch (e) {
        return json(200, { connected: true, error: e.message || String(e), graph: e.graph || null });
    }
};
