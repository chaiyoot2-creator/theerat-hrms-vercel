import express from 'express';
import cookieParser from 'cookie-parser';
import cron from 'node-cron';
import { migrate, ensureOwner, pool } from './db.js';
import { authRouter, requireAuth } from './auth.js';
import { tablesRouter } from './tables.js';
import { pushTable, pushAll } from './sheets.js';
import { processDailyCheckout } from './jobs/checkout.js';

const app = express();
// Requests arrive via Vercel's /api rewrite and then Caddy, so trust two proxy hops for client IPs.
app.set('trust proxy', Number(process.env.TRUST_PROXY ?? 2));
app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

app.get('/api/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true });
  } catch {
    res.status(503).json({ ok: false });
  }
});

app.use('/api/auth', authRouter());
app.use('/api/tables', tablesRouter());

// Replacement for EzSite `apis.run`: only the backend functions the UI calls are exposed.
const RUNNABLE = {
  'sheets/push': { pushTable, pushAll }
};
const SYNC_ROLES = ['OWNER', 'HR_ADMIN', 'PAYROLL_OFFICER'];

app.post('/api/run', requireAuth, async (req, res) => {
  const { path, methodName, param = [] } = req.body || {};
  const fn = RUNNABLE[path]?.[methodName];
  if (!fn) return res.status(404).json({ data: null, error: `Unknown function ${path}.${methodName}` });
  if (!req.user.roles.some((r) => SYNC_ROLES.includes(r))) return res.status(403).json({ data: null, error: 'ไม่มีสิทธิ์ดำเนินการนี้' });
  try {
    res.json({ data: await fn(...param), error: null });
  } catch (e) {
    res.json({ data: null, error: e.message });
  }
});

app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

const port = Number(process.env.PORT) || 3001;

await migrate();
await ensureOwner();

cron.schedule('0 20 * * *', () => {
  processDailyCheckout()
    .then((r) => console.log('[cron] daily checkout', r))
    .catch((e) => console.error('[cron] daily checkout failed', e));
}, { timezone: 'Asia/Bangkok' });

app.listen(port, () => console.log(`HRMS API listening on :${port}`));
