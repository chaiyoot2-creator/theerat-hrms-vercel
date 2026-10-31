// Google Sheets mirror (ported from the EzSite Deno functions in sheets/*.js).
// Optional: does nothing unless GOOGLE_SHEET_ID + service-account credentials are set.
import crypto from 'node:crypto';
import { query } from './db.js';
import { TABLES } from './schema.js';

const SHEETS = 'https://sheets.googleapis.com/v4/spreadsheets';
const RANGE_SUFFIX = 'A1:Z5000';

export const sheetsConfigured = () =>
  !!(process.env.GOOGLE_SHEET_ID && process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY);

const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

let cachedToken = null;

async function getAccessToken() {
  if (cachedToken && cachedToken.exp > Date.now() + 60_000) return cachedToken.value;
  const key = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY.replace(/\\n/g, '\n').trim().replace(/^["']|["']$/g, '');
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64url(JSON.stringify({
    iss: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600
  }))}`;
  const signature = crypto.createSign('RSA-SHA256').update(unsigned).sign(key);
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${b64url(signature)}` })
  });
  const data = await res.json();
  if (!res.ok || !data.access_token) {
    throw new Error(`Google token request failed (${data.error || res.status}: ${data.error_description || ''})`);
  }
  cachedToken = { value: data.access_token, exp: Date.now() + data.expires_in * 1000 };
  return cachedToken.value;
}

async function gfetch(url, token, init = {}) {
  const res = await fetch(url, { ...init, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } });
  if (!res.ok) throw new Error(`Sheets API ${res.status}: ${await res.text()}`);
  return res.json();
}

const formatCell = (v, type) => (v === null || v === undefined ? '' : type === 'bool' ? (v ? 'TRUE' : 'FALSE') : v);

export async function pushTable({ tableName }) {
  const t = Object.values(TABLES).find((x) => x.name === tableName && x.name !== 'data_backups');
  if (!t) throw new Error(`Unknown backup table: ${tableName}`);
  if (!sheetsConfigured()) throw new Error('ยังไม่ได้ตั้งค่า Google Sheets (GOOGLE_SHEET_ID / GOOGLE_SERVICE_ACCOUNT_*)');
  const id = process.env.GOOGLE_SHEET_ID;
  const { rows } = await query(`SELECT * FROM ${t.name} ORDER BY id LIMIT 5000`);
  const cols = Object.entries(t.columns);
  const values = [['ID', ...cols.map(([c]) => c)], ...rows.map((r) => [r.id, ...cols.map(([c, type]) => formatCell(r[c], type))])];

  const token = await getAccessToken();
  const meta = await gfetch(`${SHEETS}/${id}?fields=sheets.properties.title`, token);
  if (!(meta.sheets || []).some((s) => s.properties.title === tableName)) {
    await gfetch(`${SHEETS}/${id}:batchUpdate`, token, { method: 'POST', body: JSON.stringify({ requests: [{ addSheet: { properties: { title: tableName } } }] }) });
  }
  await gfetch(`${SHEETS}/${id}/values/${encodeURIComponent(`${tableName}!${RANGE_SUFFIX}`)}:clear`, token, { method: 'POST', body: '{}' });
  await gfetch(`${SHEETS}/${id}/values/${encodeURIComponent(`${tableName}!A1`)}?valueInputOption=USER_ENTERED`, token, { method: 'PUT', body: JSON.stringify({ values }) });
  return { synced: rows.length };
}

export async function pushAll() {
  const results = {};
  for (const t of Object.values(TABLES)) {
    if (t.name === 'data_backups') continue;
    try { results[t.name] = await pushTable({ tableName: t.name }); } catch (e) { results[t.name] = { error: e.message }; }
  }
  const failed = Object.entries(results).filter(([, r]) => r.error);
  if (failed.length) throw new Error(failed.map(([n, r]) => `${n}: ${r.error}`).join('; '));
  return results;
}

// Debounced background push after writes, so a burst of edits causes one sync per table.
const pending = new Map();
export function pushTableSoon(tableName) {
  if (!sheetsConfigured()) return;
  clearTimeout(pending.get(tableName));
  pending.set(tableName, setTimeout(() => {
    pending.delete(tableName);
    pushTable({ tableName }).catch((e) => console.error('[sheets]', tableName, e.message));
  }, 3000));
}
