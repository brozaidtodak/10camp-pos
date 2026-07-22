/**
 * jadual-auto-cron.js — AUTO-TUGASAN ikut jadual kerja (p1_1178).
 * Zaid: Aliff & Farhan "timetable-driven" — jadual harian/mingguan/bulanan diorang
 * auto-masuk ke staff_tasks tiap pagi (08:00 MYT, lihat netlify.toml) → muncul dlm
 * tab Task app + papan Tugasan Staf Bos.
 *
 * Peraturan:
 *  - Baca roster_schedules hari ini: shift OFF/AL/MC/EL/PH → SKIP staf tu (tiada
 *    tugasan hari cuti). Tiada baris roster → anggap KERJA (fail-open; roster pernah
 *    mati 21 Jun - 22 Jul, jangan senyapkan jadual sebab roster tak diupdate).
 *  - Anti-duplicate: staff_tasks.auto_key unik (harian/mingguan ikut tarikh, bulanan
 *    ikut bulan) + POST on_conflict=ignore — selamat run berkali-kali.
 *  - Bulanan: cuba pada 1-5hb, cipta sekali sahaja pada hari pertama staf bekerja.
 *  - Cleanup: tugasan HARIAN semalam yang masih 'baru' (tak disentuh) dipadam supaya
 *    senarai tak bertimbun; mingguan/bulanan kekal sampai siap.
 *  - Push notification ke staf berkenaan sahaja (sendToStaff) bila ada tugasan baru.
 *  - ?dry=1 (perlu staff JWT) = kira & pulang apa AKAN dicipta tanpa tulis apa-apa.
 */
const { requireAuth } = require('./_auth');
const { sendToStaff } = require('./_pushcore');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://asehjdnfzoypbwfeazra.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || '';

const OFF_CODES = ['OFF', 'AL', 'MC', 'EL', 'PH'];

// Jadual dipersetujui Zaid 22 Jul 2026. freq: 'daily' | {dow:[0=Ahad..6=Sabtu]} | 'monthly' (1-5hb).
const JADUAL = [
    {
        staff_id: 'CMP008', name: 'Aliff', roster_name: 'Aliff',
        tasks: [
            { key: 'd-pettycash', freq: 'daily', title: 'Rekod petty cash & resit semalam', notes: '11:15 pagi — masukkan semua belanja & resit semalam ke sistem. Target: sifar tunggakan.' },
            { key: 'd-invois', freq: 'daily', title: 'Failkan invois/resit supplier hari ini', notes: '7:30 malam sebelum tutup — failkan semua dokumen hari ini.' },
            { key: 'w-claim', freq: { dow: [1] }, title: 'Triage claim & cuti staf', notes: 'Semak claim/permohonan cuti yang masuk. Yang lengkap hantar ke Bos untuk lulus.' },
            { key: 'w-recon', freq: { dow: [3] }, title: 'Recon petty cash vs fizikal', notes: '2:30 petang — kira duit fizikal, padankan dengan sistem ke sen. Lari? Lapor terus.' },
            { key: 'w-komisen', freq: { dow: [5] }, title: 'Kira komisen minggu + laporan admin ke Bos', notes: '6:00 petang — WhatsApp ringkas ke Bos: komisen, claim, isu admin.' },
            { key: 'w-roster', freq: { dow: [5] }, title: 'Kemaskini roster minggu depan ke sistem', notes: '7:00 malam — masukkan jadual minggu depan dalam Jadual Tugas back office.' },
            { key: 'm-komisenfinal', freq: 'monthly', title: 'Komisen bulan lepas FINAL + data payroll', notes: 'Siapkan sebelum 5hb — kiraan komisen muktamad & data cuti/claim/OT untuk gaji bulan+1.' },
            { key: 'm-todakreport', freq: 'monthly', title: 'Hantar Sales Report ke Finance TODAK', notes: 'Back office → Reports → Laporan TODAK → pilih bulan lepas → Jana → semak (order BELUM SETTLE? tunggu 2-3 hari jana semula) → Cetak/CSV → hantar macam biasa.' }
        ]
    },
    {
        staff_id: 'CMP010', name: 'Farhan Moyy', roster_name: 'Farhan Moyy',
        tasks: [
            { key: 'd-scoreboard', freq: 'daily', title: 'Scoreboard semalam: POS / Shopee / TikTok', notes: '11:15 pagi — 1 mesej ke group: angka semalam + 1 tindakan hari ini.' },
            { key: 'd-chat', freq: 'daily', title: 'Balas chat inbox Shopee + follow-up customer', notes: '11:30 pagi — chat sifar tertunggak. Follow-up customer yang tanya tapi belum beli.' },
            { key: 'd-prospek', freq: 'daily', title: 'Cari 3 prospek B2B baru', notes: '3:00 petang — syarikat / sekolah / kelab outdoor / corporate gift. Rekod dalam senarai pipeline.' },
            { key: 'w-target', freq: { dow: [1] }, title: 'Set target minggu bersama Bos', notes: '15 minit dengan Bos — bawa nota weekend (apa customer cari tapi kita takde).' },
            { key: 'w-harga', freq: { dow: [3] }, title: 'Semak harga vs competitor marketplace', notes: '2:30 petang — senarai cadangan ubah harga. Ingat: marketplace tinggi, POS terendah.' },
            { key: 'w-kempen', freq: { dow: [4] }, title: 'Rancang 1 kempen / bundle', notes: 'Guna cadangan Ejen Dead Stock + event SKU. Satu idea sedia lancar.' },
            { key: 'w-pipeline', freq: { dow: [5] }, title: 'Laporan pipeline B2B ke Bos', notes: 'Siapa, nilai, status — hantar sebelum balik.' },
            { key: 'w-floor', freq: { dow: [6, 0] }, title: 'Fokus floor: catat permintaan customer', notes: 'Weekend ramai walk-in — layan customer, catat apa orang cari tapi kita takde. Bawa ke meeting Isnin.' }
        ]
    }
];

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
        // 1) Roster hari ini utk staf berjadual
        const names = JADUAL.map(s => '"' + s.roster_name + '"').join(',');
        const roster = await sb('GET', '/roster_schedules?select=staff_name,shift&date=eq.' + ymd + '&staff_name=in.(' + names + ')');
        const shiftOf = {};
        (roster || []).forEach(r => { shiftOf[r.staff_name] = String(r.shift || '').toUpperCase(); });

        // 2) Bina tugasan hari ini
        const inserts = [];
        for (const s of JADUAL) {
            const shift = shiftOf[s.roster_name] || null;
            const working = !shift || OFF_CODES.indexOf(shift) === -1; // tiada baris roster = anggap kerja
            summary.staff[s.name] = { shift: shift || '(tiada roster — anggap kerja)', working, created: [] };
            if (!working) continue;
            for (const t of s.tasks) {
                let due = false, keyDate = ymd;
                if (t.freq === 'daily') due = true;
                else if (t.freq === 'monthly') { due = dom >= 1 && dom <= 5; keyDate = ym; }
                else if (t.freq && Array.isArray(t.freq.dow)) due = t.freq.dow.indexOf(dow) !== -1;
                if (!due) continue;
                inserts.push({
                    title: t.title, notes: t.notes,
                    assigned_to: s.staff_id, assigned_to_name: s.name,
                    assigned_by: 'Jadual Auto',
                    auto_key: s.staff_id + ':' + t.key + ':' + keyDate
                });
                summary.staff[s.name].created.push(t.key);
            }
        }

        if (dry) return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(summary) };

        // 3) Insert (on_conflict auto_key ignore = idempotent)
        let inserted = [];
        if (inserts.length) {
            inserted = await sb('POST', '/staff_tasks?on_conflict=auto_key', inserts,
                { Prefer: 'resolution=ignore-duplicates,return=representation' }) || [];
        }
        summary.inserted = inserted.length;

        // 4) Cleanup: tugasan HARIAN lepas yang tak disentuh (masih 'baru') — padam supaya tak bertimbun
        try {
            const todayStartUtc = new Date(ymd + 'T00:00:00+08:00').toISOString();
            const gone = await sb('DELETE', '/staff_tasks?status=eq.baru&assigned_by=eq.Jadual%20Auto&auto_key=like.*%3Ad-*&created_at=lt.' + encodeURIComponent(todayStartUtc), null,
                { Prefer: 'return=representation' });
            summary.cleaned = (gone || []).length;
        } catch (e) { summary.clean_err = String(e.message || e).slice(0, 120); }

        // 5) Push ke staf yang dapat tugasan BARU hari ini (iOS live; Android tunggu build FCM)
        const byStaff = {};
        inserted.forEach(r => { byStaff[r.assigned_to] = (byStaff[r.assigned_to] || 0) + 1; });
        for (const s of JADUAL) {
            const n = byStaff[s.staff_id] || 0;
            if (!n) continue;
            try {
                const p = await sendToStaff(s.staff_id, {
                    title: 'Jadual hari ini dah sedia',
                    body: n + ' tugasan untuk ' + s.name.split(' ')[0] + ' — buka tab Task untuk mula.',
                    data: { kind: 'jadual_auto' }
                });
                summary.staff[s.name].push = p;
            } catch (e) { summary.staff[s.name].push = { err: String(e.message || e).slice(0, 100) }; }
        }

        return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(summary) };
    } catch (e) {
        return { statusCode: 200, body: 'jadual-auto error: ' + String(e.message || e).slice(0, 200) };
    }
};
