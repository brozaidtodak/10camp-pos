/**
 * tiktok-finance.js — pull TikTok Shop settlement (Finance API) → normalized rows.
 *
 * TikTok payout works in two layers:
 *   1. Statements  GET /finance/202309/statements                  — payout batches.
 *   2. Transactions GET /finance/202309/statements/{id}/statement_transactions
 *                                                                   — per-order breakdown.
 *
 * Query modes:
 *   ?mode=peek (default)  — fetch statements for window + 1 statement's transactions,
 *                           return RAW shapes so we can verify field names. READ-ONLY.
 *   ?mode=rows            — iterate all statements in window, build normalized rows
 *                           [{ order_sn, order_date, gross, commission_fee,
 *                              service_fee, transaction_fee, net_payout }].
 *
 * Window: ?from=YYYY-MM-DD&to=YYYY-MM-DD (statement_time). Defaults: last 30 days.
 * Public URL: https://www.10camp.com/api/tiktok-finance
 *
 * Mirror of shopee-sync.js mode=escrow. Reuses _tiktok.js (signing/token/cipher).
 */

const { VERSION, ttRequest, getValidToken, ensureShopCipher } = require('./_tiktok.js');

function json(status, body) {
    return { statusCode: status, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
}

const num = (x) => { const n = Math.abs(parseFloat(x)); return isNaN(n) ? 0 : n; };

function ymd(epochSec) {
    if (!epochSec) return null;
    const ms = Number(epochSec) * (Number(epochSec) > 1e12 ? 1 : 1000);
    return new Date(ms).toISOString().slice(0, 10);
}

// Get one page of statements.
async function getStatements(tok, cipher, query) {
    const res = await ttRequest('GET', `/finance/${VERSION}/statements`, {
        query, accessToken: tok.access_token, shopCipher: cipher
    });
    if (res.code !== 0) throw new Error(`statements: ${res.message} (code ${res.code})`);
    return res.data || {};
}

// Get one page of a statement's per-order transactions.
async function getStatementTxns(tok, cipher, statementId, query) {
    const res = await ttRequest('GET', `/finance/${VERSION}/statements/${statementId}/statement_transactions`, {
        query, accessToken: tok.access_token, shopCipher: cipher
    });
    if (res.code !== 0) throw new Error(`txns(${statementId}): ${res.message} (code ${res.code})`);
    return res.data || {};
}

// Map a TikTok statement_transaction → normalized settlement row.
// Field names guarded against version drift (snake variants).
function mapTxn(t) {
    const gross = num(t.revenue_amount ?? t.gross_sales_amount ?? t.sub_total_amount);
    const net   = num(t.settlement_amount ?? t.settlement_amount_value);
    // Fee breakdown if present, else lump total platform fee into commission_fee.
    const commission = num(t.commission_fee ?? t.platform_commission ?? 0);
    const service    = num(t.service_fee ?? t.sfp_service_fee ?? t.affiliate_commission ?? 0);
    const txnFee     = num(t.transaction_fee ?? t.payment_fee ?? 0);
    let feeBucket = commission + service + txnFee;
    const totalFee = num(t.fee_amount ?? t.total_fee_amount);
    // If we couldn't break fees down, dump the whole fee_amount into commission_fee.
    const useLump = feeBucket === 0 && totalFee > 0;
    return {
        order_sn: String(t.order_id ?? t.id ?? ''),
        order_date: ymd(t.order_create_time ?? t.statement_time ?? t.create_time),
        gross,
        commission_fee: useLump ? totalFee : commission,
        service_fee: useLump ? 0 : service,
        transaction_fee: useLump ? 0 : txnFee,
        net_payout: net,
    };
}

exports.handler = async (event) => {
    const params = event.queryStringParameters || {};
    const mode = params.mode === 'rows' ? 'rows' : 'peek';
    const toMs   = params.to   ? Date.parse(params.to)   : Date.now();
    const fromMs = params.from ? Date.parse(params.from) : (toMs - 30 * 24 * 60 * 60 * 1000);
    if (isNaN(fromMs) || isNaN(toMs)) return json(400, { error: 'invalid ?from/?to (YYYY-MM-DD)' });
    const ge = Math.floor(fromMs / 1000), lt = Math.floor(toMs / 1000);

    const out = { mode, from: new Date(fromMs).toISOString().slice(0, 10), to: new Date(toMs).toISOString().slice(0, 10) };

    try {
        const tok = await getValidToken();
        const cipher = await ensureShopCipher(tok);

        // Page through all statements in the window.
        const statements = [];
        let pageToken = '', guard = 0;
        do {
            const q = {
                statement_time_ge: ge, statement_time_lt: lt,
                page_size: 100, sort_field: 'statement_time', sort_order: 'DESC',
            };
            if (pageToken) q.page_token = pageToken;
            const data = await getStatements(tok, cipher, q);
            for (const s of (data.statements || [])) statements.push(s);
            pageToken = data.next_page_token || '';
        } while (pageToken && ++guard < 50);
        out.statement_count = statements.length;

        if (mode === 'peek') {
            out.statements_sample = statements.slice(0, 3);
            if (statements.length) {
                const first = statements[0];
                const td = await getStatementTxns(tok, cipher, first.id, { page_size: 20 });
                out.first_statement_id = first.id;
                out.txns_sample = (td.statement_transactions || []).slice(0, 5);
                out.txns_total_on_first = (td.statement_transactions || []).length;
            }
            out.note = 'PEEK — raw shapes only. Verify field names, then ?mode=rows.';
            return json(200, out);
        }

        // mode=rows — per-order normalized settlement rows across all statements.
        const rows = [];
        for (const s of statements) {
            let pt = '', g2 = 0;
            do {
                const q = { page_size: 100 };
                if (pt) q.page_token = pt;
                const td = await getStatementTxns(tok, cipher, s.id, q);
                for (const t of (td.statement_transactions || [])) {
                    const r = mapTxn(t);
                    if (r.order_sn) rows.push(r);
                }
                pt = td.next_page_token || '';
            } while (pt && ++g2 < 50);
        }
        out.rows = rows;
        out.row_count = rows.length;
        return json(200, out);
    } catch (e) {
        out.error = e.message;
        return json(500, out);
    }
};
