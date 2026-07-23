/**
 * jadual-auto-cron.js — AUTO-TUGASAN ikut jadual kerja (p1_1178/1183/1191/1192).
 * Tiap 08:00 MYT: baca TEMPLATE dari table `task_templates` (p1_1192 — dipindah dari
 * const dlm kod supaya staf boleh edit jadual SENDIRI via "Jadual Saya" dlm app;
 * Bos boleh edit jadual sesiapa dari papan) → insert staff_tasks → tab Task + papan Bos.
 *
 * Peraturan:
 *  - Roster hari tu: shift OFF/AL/MC/EL/PH = SKIP staf (tiada tugasan hari cuti);
 *    tiada baris roster = anggap KERJA (fail-open). Syif B (masuk 2ptg): slot < 14 skip.
 *  - freq: 'daily' | 'weekly' (dow jsonb [0=Ahad..6=Sabtu]) | 'monthly' (cipta 1-5hb,
 *    sekali sebulan pada hari pertama staf bekerja).
 *  - Anti-dup: auto_key `<staff>:<d|w|m>-<tplId>:<tarikh|bulan>` + unique index penuh
 *    (p1_1189: index partial TAK serasi PostgREST on_conflict) + on_conflict ignore.
 *  - Cleanup: tugasan HARIAN (auto_key '*:d-*') semalam yang masih 'baru' dipadam.
 *  - Push per-staf (sendToStaff) bila ada tugasan baru. ?dry=1 = preview tanpa tulis.
 */
const { requireAuth } = require('./_auth');
const { sendToStaff } = require('./_pushcore');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://asehjdnfzoypbwfeazra.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || '';

const OFF_CODES = ['OFF', 'AL', 'MC', 'EL', 'PH'];

// Meta staf (nama papar + nama dlm roster_schedules). Template datang dari DB;
// staf baru = tambah sini + baris template dlm task_templates.
const STAFF_META = {
    CMP001: { name: 'Zaid', roster: 'Zaid' },
    CMP005: { name: 'Zack', roster: 'Zack' },
    CMP006: { name: 'Ariff', roster: 'Ariff' },
    CMP003: { name: 'Irfan', roster: 'Irfan' },
    CMP009: { name: 'Fahmi', roster: 'Fahmi' },
    CMP011: { name: 'Tarmizi Kael', roster: 'Tarmizi' },
    CMP008: { name: 'Aliff', roster: 'Aliff' },
    CMP010: { name: 'Farhan Moyy', roster: 'Farhan Moyy' }
};

async function sb(method, path, body, extraHeaders) {
    const r = await fetch(SUPABASE_URL + '/rest/v1' + path, {
        method,
        headers: Object.assign({
            apikey: SERVICE_KEY, Authorization: 'Bearer ' + SERVICE_KEY,
            'Content-Type': 'application/json'
        }, extraHeaders || {}),
        body: body ? JSON.stringify(body) : undefined
    });
    const t = await r.text();
    if (!r.ok) throw new Error(method + ' ' + path.split('?')[0] + ' ' + r.status + ': ' + t.slice(0, 180));
    try { return t ? JSON.parse(t) : null; } catch (e) { return null; }
}

exports.handler = async (event) => {
    const a = await requireAuth(event); if (!a.ok) return a.response;
    if (!SERVICE_KEY) return { statusCode: 500, body: 'SUPABASE_SERVICE_KEY not set' };
    const dry = !!(event && event.queryStringParameters && event.queryStringParameters.dry);

    // Tarikh MYT (DB/cron = UTC, +8)
    const myt = new Date(Date.now() + 8 * 3600e3);
    const ymd = myt.toISOString().slice(0, 10);
    const ym = ymd.slice(0, 7);
    const dow = myt.getUTCDay();          // 0=Ahad
    const dom = myt.getUTCDate();
    const summary = { date: ymd, dow, dry, staff: {}, cleaned: 0 };

    try {
        // 1) Template aktif dari DB (p1_1192)
        const tpls = await sb('GET', '/task_templates?select=id,staff_id,freq,dow,slot,title,notes&active=is.true&order=slot.asc.nullslast,id.asc') || [];
        const byStaff = {};
        tpls.forEach(t => { (byStaff[t.staff_id] = byStaff[t.staff_id] || []).push(t); });
        summary.templates = tpls.length;

        // 2) Roster hari ini
        const names = Object.values(STAFF_META).map(m => '"' + m.roster + '"').join(',');
        const roster = await sb('GET', '/roster_schedules?select=staff_name,shift&date=eq.' + ymd + '&staff_name=in.(' + names + ')');
        const shiftOf = {};
        (roster || []).forEach(r => { shiftOf[r.staff_name] = String(r.shift || '').toUpperCase(); });

        // 3) Bina tugasan hari ini
        const inserts = [];
        for (const sid of Object.keys(STAFF_META)) {
            const meta = STAFF_META[sid];
            const shift = shiftOf[meta.roster] || null;
            const working = !shift || OFF_CODES.indexOf(shift) === -1;
            summary.staff[meta.name] = { shift: shift || '(tiada roster — anggap kerja)', working, created: [] };
            if (!working) continue;
            for (const t of (byStaff[sid] || [])) {
                let due = false, keyDate = ymd, fl = 'd';
                if (t.freq === 'daily') due = true;
                else if (t.freq === 'monthly') { due = dom >= 1 && dom <= 5; keyDate = ym; fl = 'm'; }
                else if (t.freq === 'weekly') {
                    fl = 'w';
                    let dws = t.dow; if (typeof dws === 'string') { try { dws = JSON.parse(dws); } catch (e) { dws = []; } }
                    due = Array.isArray(dws) && dws.indexOf(dow) !== -1;
                }
                if (!due) continue;
                // Syif B masuk 2ptg (cth Rabu): slot pagi (< 14) auto-skip
                if (t.slot != null && shift === 'B' && Number(t.slot) < 14) continue;
                inserts.push({
                    title: t.title, notes: t.notes || '',
                    assigned_to: sid, assigned_to_name: meta.name,
                    assigned_by: 'Jadual Auto',
                    auto_key: sid + ':' + fl + '-' + t.id + ':' + keyDate
                });
                summary.staff[meta.name].created.push(fl + '-' + t.id + ' ' + String(t.title).slice(0, 30));
            }
        }

        if (dry) return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(summary) };

        // 4) Insert (idempotent)
        let inserted = [];
        if (inserts.length) {
            inserted = await sb('POST', '/staff_tasks?on_conflict=auto_key', inserts,
                { Prefer: 'resolution=ignore-duplicates,return=representation' }) || [];
        }
        summary.inserted = inserted.length;

        // 5) Cleanup: harian lepas yang tak disentuh (masih 'baru')
        try {
            const todayStartUtc = new Date(ymd + 'T00:00:00+08:00').toISOString();
            const gone = await sb('DELETE', '/staff_tasks?status=eq.baru&assigned_by=eq.Jadual%20Auto&auto_key=like.*%3Ad-*&created_at=lt.' + encodeURIComponent(todayStartUtc), null,
                { Prefer: 'return=representation' });
            summary.cleaned = (gone || []).length;
        } catch (e) { summary.clean_err = String(e.message || e).slice(0, 120); }

        // 6) Push ke staf yang dapat tugasan baru
        const nBy = {};
        inserted.forEach(r => { nBy[r.assigned_to] = (nBy[r.assigned_to] || 0) + 1; });
        for (const sid of Object.keys(nBy)) {
            const meta = STAFF_META[sid]; if (!meta) continue;
            try {
                const p = await sendToStaff(sid, {
                    title: 'Jadual hari ini dah sedia',
                    body: nBy[sid] + ' tugasan untuk ' + meta.name.split(' ')[0] + ' — buka tab Task untuk mula.',
                    data: { kind: 'jadual_auto' }
                });
                summary.staff[meta.name].push = p;
            } catch (e) { summary.staff[meta.name].push = { err: String(e.message || e).slice(0, 100) }; }
        }

        return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(summary) };
    } catch (e) {
        return { statusCode: 200, body: 'jadual-auto error: ' + String(e.message || e).slice(0, 200) };
    }
};
