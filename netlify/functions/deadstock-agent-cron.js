/**
 * deadstock-agent-cron.js — pencetus harian Ejen Jualan Dead Stock (p1_1062, lihat netlify.toml
 * 23:15 UTC = 07:15 MYT). Dedup dlm ejen sendiri — hari tanpa dead stock baru = 0 cadangan baru.
 */
const { internalHeaders } = require('./_auth');
exports.handler = async () => {
    const base = process.env.URL || process.env.DEPLOY_PRIME_URL || 'https://www.10camp.com';
    try { await fetch(`${base}/.netlify/functions/deadstock-agent-background`, { headers: internalHeaders() }); }
    catch (e) { return { statusCode: 200, body: `trigger attempted: ${String(e)}` }; }
    return { statusCode: 200, body: 'deadstock-agent triggered' };
};
