// Ported from the EzSite function attendance/processDailyCheckout.js.
// Runs daily at 20:00 Asia/Bangkok. For every employee who checked IN today:
// - no OUT log yet -> auto-record OUT at 17:00:00 (method "AUTO"), no OT (on-time exit assumed)
// - real OUT after 17:30 -> log PENDING overtime for the hours past 17:00 (rounded up)
// - real OUT at/before 17:30 -> no OT
import { query } from '../db.js';

const CUTOFF_MINUTES = 17 * 60;
const GRACE_MINUTES = 17 * 60 + 30;
const OT_MULTIPLIER = 1.5;

// The UI stores log_date as toLocaleDateString('th-TH'), e.g. "21/9/2569"; accept ISO too.
function logDateToISO(value) {
  const v = String(value || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{3,4})$/);
  if (!m) return null;
  let year = parseInt(m[3], 10);
  if (year > 2400) year -= 543;
  return `${year}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}

function parseTimeToMinutes(value) {
  const m = String(value || '').trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)?$/i);
  if (!m) return null;
  let hour = parseInt(m[1], 10);
  const ampm = m[3];
  if (ampm) {
    const isPM = ampm.toUpperCase() === 'PM';
    if (isPM && hour < 12) hour += 12;
    if (!isPM && hour === 12) hour = 0;
  }
  return hour * 60 + parseInt(m[2], 10);
}

export async function processDailyCheckout(now = new Date()) {
  const todayISO = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const todayThai = now.toLocaleDateString('th-TH', { timeZone: 'Asia/Bangkok' });

  const { rows: logs } = await query('SELECT * FROM attendance_logs ORDER BY id DESC LIMIT 5000');
  const byEmp = new Map();
  for (const log of logs) {
    if (logDateToISO(log.log_date) !== todayISO) continue;
    if (!byEmp.has(log.emp_id)) byEmp.set(log.emp_id, { ins: [], outs: [] });
    const bucket = byEmp.get(log.emp_id);
    if (log.type === 'IN') bucket.ins.push(log);
    else if (log.type === 'OUT') bucket.outs.push(log);
  }

  const { rows: emps } = await query('SELECT id, salary FROM employees');
  const salaryById = new Map(emps.map((e) => [e.id, Number(e.salary) || 0]));

  let autoCheckouts = 0;
  let overtimeCreated = 0;

  for (const [empId, bucket] of byEmp.entries()) {
    if (!bucket.ins.length) continue;

    if (!bucket.outs.length) {
      await query("INSERT INTO attendance_logs (emp_id, log_time, log_date, type, method) VALUES ($1, '17:00:00', $2, 'OUT', 'AUTO')", [empId, todayThai]);
      autoCheckouts += 1;
      continue;
    }

    const latestOut = bucket.outs.reduce((a, b) => ((parseTimeToMinutes(b.log_time) ?? -1) > (parseTimeToMinutes(a.log_time) ?? -1) ? b : a));
    const outMinutes = parseTimeToMinutes(latestOut.log_time);
    if (outMinutes === null || outMinutes <= GRACE_MINUTES) continue;

    const { rows: existing } = await query('SELECT 1 FROM overtime WHERE emp_id = $1 AND ot_date = $2 LIMIT 1', [empId, todayISO]);
    if (existing.length) continue;

    const hours = Math.ceil((outMinutes - CUTOFF_MINUTES) / 60);
    const rate = Math.round(((salaryById.get(empId) || 0) / 30 / 8) * OT_MULTIPLIER * 100) / 100;
    const amount = Math.round(hours * rate * 100) / 100;
    await query("INSERT INTO overtime (emp_id, ot_date, hours, rate, amount, status) VALUES ($1, $2, $3, $4, $5, 'PENDING')",
      [empId, todayISO, hours, rate, amount]);
    overtimeCreated += 1;
  }

  return { autoCheckouts, overtimeCreated };
}
