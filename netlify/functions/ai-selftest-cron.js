/**
 * ai-selftest-cron.js — pencetus berjadual harian (lihat netlify.toml, 06:45 MYT) untuk
 * ai-selftest (ujian automatik Tanya AI lawan database, p1_1044). Balas serta-merta.
 */
const { internalHeaders } = require('./_auth');
exports.handler = async () => {
    const base = process.env.URL || process.env.DEPLOY_PRIME_URL || 'https://www.10camp.com';
    try { await fetch(`${base}/.netlify/functions/ai-selftest-background`, { headers: internalHeaders() }); }
    catch (e) { return { statusCode: 200, body: `trigger attempted: ${String(e)}` }; }
    return { statusCode: 200, body: 'ai-selftest triggered' };
};
