import pg from 'pg';
import { migrationSql } from './schema.js';

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10
});
// An idle client dropping (e.g. Postgres restart) must not crash the API; the pool reconnects.
pool.on('error', (e) => console.error('[db] idle client error', e.message));

export const query = (text, params) => pool.query(text, params);

export async function migrate() {
  for (const sql of migrationSql()) await pool.query(sql);
}

/** First boot: make sure the owner configured in OWNER_EMAIL has an employee row with the OWNER role. */
export async function ensureOwner() {
  const email = (process.env.OWNER_EMAIL || '').trim().toLowerCase();
  if (!email) return;
  const { rows } = await pool.query('SELECT id FROM employees WHERE lower(email) = $1', [email]);
  if (rows.length) return;
  await pool.query(
    `INSERT INTO employees (emp_code, username, email, name, roles, dept, salary, salary_type, has_social_security, resignation_deposit_monthly)
     VALUES ('OWNER', 'owner', $1, $2, 'OWNER', 'OFFICE', 0, 'MONTHLY', false, 0)`,
    [email, process.env.OWNER_NAME || 'เจ้าของกิจการ']
  );
  console.log(`[bootstrap] created OWNER employee for ${email}`);
}
