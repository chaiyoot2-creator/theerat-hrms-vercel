import { Router } from 'express';
import { query } from './db.js';
import { TABLES, ANY_ROLE, tableByName } from './schema.js';
import { requireAuth } from './auth.js';
import { pushTableSoon } from './sheets.js';

// Filter operators accepted in tablePage queries (EzSite names -> SQL).
const OPS = {
  Equal: '=', NotEqual: '<>', GreaterThan: '>', GreaterThanOrEqual: '>=', LessThan: '<', LessThanOrEqual: '<=',
  StringContains: 'ILIKE', StringStartsWith: 'ILIKE', StringEndsWith: 'ILIKE'
};

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const getTable = (id) => {
  const t = TABLES[Number(id)];
  if (!t) throw new HttpError(404, `Unknown table ${id}`);
  return t;
};

/** Maps an incoming field name to a real column; `ID`/`id` both mean the primary key. */
const column = (t, name) => {
  if (name === 'ID' || name === 'id') return 'id';
  if (!(name in t.columns)) throw new HttpError(400, `Unknown column ${name} on ${t.name}`);
  return name;
};

const coerce = (type, v) => {
  if (v === undefined) return undefined;
  if (type === 'bool') return v === 'false' ? false : !!v;
  if (type === 'text') return v === null ? null : String(v);
  if (v === null || v === '') return null;
  const n = Number(v);
  if (Number.isNaN(n)) throw new HttpError(400, `Invalid number: ${v}`);
  return type === 'int' ? Math.trunc(n) : n;
};

/** Rows go back with both `ID` (what the EzSite UI reads) and `id`. */
const out = (row) => ({ ID: row.id, ...row });

function assertCan(user, t, action) {
  const allowed = action === 'read' ? (t.read || ANY_ROLE) : t.write[action];
  if (!user.employeeId) throw new HttpError(403, 'บัญชียังไม่ผูกกับพนักงาน');
  if (allowed === ANY_ROLE) return;
  if (!allowed.some((r) => user.roles.includes(r))) throw new HttpError(403, 'ไม่มีสิทธิ์ดำเนินการนี้');
}

function writableFields(t, record) {
  const fields = {};
  for (const [k, v] of Object.entries(record || {})) {
    if (k === 'ID' || k === 'id') continue;
    fields[column(t, k)] = coerce(t.columns[k], v);
  }
  return fields;
}

async function backup(t, action, row) {
  if (t.name === 'data_backups' || !row) return;
  await query(
    'INSERT INTO data_backups (source_table, source_id, action, record_json, backup_time) VALUES ($1, $2, $3, $4, $5)',
    [t.name, row.id ?? 0, action, JSON.stringify(out(row)), new Date().toISOString()]
  ).catch((e) => console.error('[backup]', e.message));
  pushTableSoon(t.name);
}

export async function tablePage(t, q = {}) {
  const where = [];
  const params = [];
  for (const f of q.Filters || []) {
    const op = OPS[f.op];
    if (!op) throw new HttpError(400, `Unsupported filter op ${f.op}`);
    const col = column(t, f.name);
    let value = f.value;
    if (f.op === 'StringContains') value = `%${value}%`;
    if (f.op === 'StringStartsWith') value = `${value}%`;
    if (f.op === 'StringEndsWith') value = `%${value}`;
    params.push(op === 'ILIKE' ? value : coerce(col === 'id' ? 'int' : t.columns[col], value));
    where.push(`${col}${op === 'ILIKE' ? '::text' : ''} ${op} $${params.length}`);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const orderCol = column(t, q.OrderByField || 'id');
  const size = Math.min(Math.max(Number(q.PageSize) || 20, 1), 5000);
  const offset = (Math.max(Number(q.PageNo) || 1, 1) - 1) * size;
  const [{ rows }, { rows: count }] = await Promise.all([
    query(`SELECT * FROM ${t.name} ${whereSql} ORDER BY ${orderCol} ${q.IsAsc === false ? 'DESC' : 'ASC'}, id LIMIT ${size} OFFSET ${offset}`, params),
    query(`SELECT count(*)::int AS n FROM ${t.name} ${whereSql}`, params)
  ]);
  return { List: rows.map(out), VirtualCount: count[0].n };
}

export function tablesRouter() {
  const r = Router();
  r.use(requireAuth);

  const handle = (fn) => async (req, res) => {
    try {
      res.json({ data: (await fn(req)) ?? null, error: null });
    } catch (e) {
      if (!e.status) console.error(e);
      res.status(e.status || 500).json({ data: null, error: e.status ? e.message : 'เกิดข้อผิดพลาดของเซิร์ฟเวอร์' });
    }
  };

  r.post('/:id/page', handle(async (req) => {
    const t = getTable(req.params.id);
    assertCan(req.user, t, 'read');
    return tablePage(t, req.body);
  }));

  r.post('/:id/create', handle(async (req) => {
    const t = getTable(req.params.id);
    assertCan(req.user, t, 'create');
    const fields = writableFields(t, req.body);
    if (t.name === 'employees' && fields.roles && !req.user.roles.includes('OWNER')) fields.roles = 'EMPLOYEE';
    const cols = Object.keys(fields);
    const sql = cols.length
      ? `INSERT INTO ${t.name} (${cols.join(',')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(',')}) RETURNING *`
      : `INSERT INTO ${t.name} DEFAULT VALUES RETURNING *`;
    const { rows } = await query(sql, Object.values(fields));
    await backup(t, 'create', rows[0]);
    return { ID: rows[0].id };
  }));

  r.post('/:id/update', handle(async (req) => {
    const t = getTable(req.params.id);
    assertCan(req.user, t, 'update');
    const id = Number(req.body?.ID ?? req.body?.id);
    if (!id) throw new HttpError(400, 'Missing ID');
    const fields = writableFields(t, req.body);
    // Role changes are owner-only, matching the UI where only OWNER sees the role editor.
    if (t.name === 'employees' && 'roles' in fields && !req.user.roles.includes('OWNER')) {
      const { rows } = await query('SELECT roles FROM employees WHERE id = $1', [id]);
      if (rows.length && (rows[0].roles || '') !== (fields.roles || '')) throw new HttpError(403, 'เฉพาะเจ้าของเท่านั้นที่แก้สิทธิ์ได้');
    }
    const cols = Object.keys(fields);
    if (!cols.length) return null;
    const { rows } = await query(
      `UPDATE ${t.name} SET ${cols.map((c, i) => `${c} = $${i + 1}`).join(', ')} WHERE id = $${cols.length + 1} RETURNING *`,
      [...Object.values(fields), id]
    );
    if (!rows.length) throw new HttpError(404, 'ไม่พบรายการ');
    await backup(t, 'update', rows[0]);
    return null;
  }));

  r.post('/:id/delete', handle(async (req) => {
    const t = getTable(req.params.id);
    assertCan(req.user, t, 'delete');
    const id = Number(req.body?.ID ?? req.body?.id);
    if (!id) throw new HttpError(400, 'Missing ID');
    if (t.name === 'employees' && id === req.user.employeeId) throw new HttpError(400, 'ลบบัญชีของตัวเองไม่ได้');
    const { rows } = await query(`DELETE FROM ${t.name} WHERE id = $1 RETURNING *`, [id]);
    await backup(t, 'delete', rows[0]);
    return null;
  }));

  return r;
}

export { HttpError, tableByName };
