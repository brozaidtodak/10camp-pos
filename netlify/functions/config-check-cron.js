/**
 * config-check-cron.js — daily scheduled trigger (see netlify.toml). Fires
 * config-check so config_health (env/sanity/auth preflight) stays fresh.
 * Returns immediately.
 */
exports.handler = async () => {
    const base = process.env.URL || process.env.DEPLOY_PRIME_URL || 'https://www.10camp.com';
    try { await fetch(`${base}/.netlify/functions/config-check?mode=sync`); }
    catch (e) { return { statusCode: 200, body: `trigger attempted: ${String(e)}` }; }
    return { statusCode: 200, body: 'config-check-background triggered' };
};
