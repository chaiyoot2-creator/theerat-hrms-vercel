// Table registry. The numeric ids are the EzSite table ids the frontend still sends
// (see src/lib/ezsite.ts TABLES), so the UI code did not have to change.
// Column types: int | num | text | bool. Every table also gets an `id` SERIAL primary key.

export const MANAGERS = ['OWNER', 'HR_ADMIN', 'TEAM_MANAGER'];
const OWNER_HR = ['OWNER', 'HR_ADMIN'];
const OWNER_PAYROLL = ['OWNER', 'PAYROLL_OFFICER'];
const ANY = '*'; // any signed-in user that is linked to an employee row

export const TABLES = {
  89339: {
    name: 'employees',
    columns: {
      emp_code: 'text', username: 'text', email: 'text', name: 'text', roles: 'text', dept: 'text',
      salary: 'num', salary_type: 'text', bank_account: 'text', bank_name: 'text', bank_account_name: 'text',
      phone: 'text', has_social_security: 'bool', hire_date: 'text', resignation_deposit_monthly: 'num'
    },
    write: { create: OWNER_HR, update: OWNER_HR, delete: OWNER_HR }
  },
  89340: {
    name: 'leaves',
    columns: { emp_id: 'int', leave_date: 'text', type: 'text', status: 'text', reason: 'text', period: 'text', duration: 'num' },
    write: { create: ANY, update: MANAGERS, delete: MANAGERS }
  },
  89341: {
    name: 'unloading_logs',
    columns: { log_date: 'text', bags: 'int', recorded_by: 'int' },
    write: { create: OWNER_HR, update: OWNER_HR, delete: OWNER_HR }
  },
  89342: {
    name: 'advances',
    columns: { emp_id: 'int', amount: 'num', advance_date: 'text', status: 'text', deduction_month: 'text', category: 'text', note: 'text' },
    write: { create: OWNER_PAYROLL, update: OWNER_PAYROLL, delete: OWNER_PAYROLL }
  },
  89343: {
    name: 'expenses',
    columns: { expense_date: 'text', category: 'text', description: 'text', amount: 'num', vehicle: 'text' },
    write: { create: OWNER_PAYROLL, update: OWNER_PAYROLL, delete: OWNER_PAYROLL }
  },
  89344: {
    name: 'expense_categories',
    columns: { name: 'text' },
    write: { create: OWNER_PAYROLL, update: OWNER_PAYROLL, delete: OWNER_PAYROLL }
  },
  89345: {
    name: 'vehicles',
    columns: {
      plate: 'text', name: 'text', vehicle_type: 'text', is_active: 'bool', driver_name: 'text',
      insurance_company: 'text', insurance_date: 'text', insurance_expiry: 'text', insurance_cost: 'num',
      act_company: 'text', act_date: 'text', act_expiry: 'text', act_cost: 'num',
      registration_expiry: 'text', registration_cost: 'num'
    },
    write: { create: OWNER_PAYROLL, update: OWNER_PAYROLL, delete: OWNER_PAYROLL }
  },
  89346: {
    name: 'company_settings',
    columns: {
      name: 'text', tax_id: 'text', phone: 'text', address: 'text', logo_url: 'text', gps_check_in_enabled: 'bool',
      workplace_lat: 'num', workplace_lng: 'num', gps_radius_m: 'num',
      work_location_latitude: 'num', work_location_longitude: 'num'
    },
    write: { create: OWNER_HR, update: OWNER_HR, delete: ['OWNER'] }
  },
  89347: {
    name: 'attendance_logs',
    columns: { emp_id: 'int', log_time: 'text', log_date: 'text', type: 'text', method: 'text' },
    write: { create: ANY, update: OWNER_HR, delete: OWNER_HR }
  },
  89355: {
    name: 'data_backups',
    columns: { source_table: 'text', source_id: 'int', action: 'text', record_json: 'text', backup_time: 'text' },
    read: ['OWNER'],
    write: { create: [], update: [], delete: [] } // written by the server only
  },
  89358: {
    name: 'overtime',
    columns: { emp_id: 'int', ot_date: 'text', hours: 'num', rate: 'num', amount: 'num', status: 'text', approved_by: 'int' },
    write: { create: MANAGERS, update: MANAGERS, delete: MANAGERS }
  },
  89410: {
    name: 'resignation_deposits',
    columns: { emp_id: 'int', amount: 'num', deduction_month: 'text', note: 'text' },
    write: { create: OWNER_PAYROLL, update: OWNER_PAYROLL, delete: OWNER_PAYROLL }
  }
};

export const ANY_ROLE = ANY;

export const tableByName = (name) => Object.values(TABLES).find((t) => t.name === name);

const SQL_TYPE = { int: 'INTEGER', num: 'DOUBLE PRECISION', text: 'TEXT', bool: 'BOOLEAN' };

/** Idempotent DDL: creates missing tables and adds missing columns on every boot. */
export function migrationSql() {
  const stmts = [
    `CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL DEFAULT '',
      password_hash TEXT NOT NULL,
      reset_token_hash TEXT,
      reset_expires TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`
  ];
  for (const t of Object.values(TABLES)) {
    stmts.push(`CREATE TABLE IF NOT EXISTS ${t.name} (id SERIAL PRIMARY KEY)`);
    for (const [col, type] of Object.entries(t.columns)) {
      stmts.push(`ALTER TABLE ${t.name} ADD COLUMN IF NOT EXISTS ${col} ${SQL_TYPE[type]}`);
    }
  }
  stmts.push('CREATE INDEX IF NOT EXISTS employees_email_idx ON employees (lower(email))');
  stmts.push('CREATE INDEX IF NOT EXISTS attendance_emp_date_idx ON attendance_logs (emp_id, log_date)');
  return stmts;
}
