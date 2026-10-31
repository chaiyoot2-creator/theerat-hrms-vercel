// Data access for THEERAT HRMS. This used to be the EzSite platform SDK (window.ezsite.apis);
// it now talks to our own API (api/ on the VPS) through same-origin `/api/*`, which Vercel
// rewrites to the VPS (see vercel.json) and Vite proxies in dev. The shape of `apis` is kept
// identical so the pages did not have to change. Backups and Google Sheets sync now happen
// on the server after every write.

export const TABLES = {
  employees: 89339,
  leaves: 89340,
  unloadingLogs: 89341,
  advances: 89342,
  expenses: 89343,
  expenseCategories: 89344,
  vehicles: 89345,
  companySettings: 89346,
  attendanceLogs: 89347,
  dataBackups: 89355,
  overtime: 89358,
  resignationDeposits: 89410
} as const;

type EzError = { error: string | null };
type EzData<T> = { data: T; error: string | null };

interface TablePageResult {
  List: any[];
  VirtualCount: number;
}

interface EzSiteApis {
  login(p: { email: string; password: string }): Promise<EzError>;
  register(p: { email: string; password: string }): Promise<EzError>;
  logout(): Promise<EzError>;
  getUserInfo(): Promise<EzData<UserInfo>>;
  sendResetPwdEmail(p: { email: string }): Promise<EzError>;
  resetPassword(p: { token: string; password: string }): Promise<EzError>;
  tablePage(tableId: number, query: any): Promise<EzData<TablePageResult>>;
  tableCreate(tableId: number, record: any): Promise<EzError>;
  tableUpdate(tableId: number, record: any): Promise<EzError>;
  tableDelete(tableId: number, record: any): Promise<EzError>;
  run(p: { path: string; methodName: string; param: any[] }): Promise<EzData<any>>;
}

export interface UserInfo {
  ID: number;
  Name: string;
  Email: string;
  CreateTime: string;
  Roles: string;
}

declare global {
  interface Window {
    ezsite: { apis: EzSiteApis };
  }
}

async function call<T = any>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<EzData<T>> {
  try {
    const res = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const json = await res.json().catch(() => null);
    if (!json) return { data: null as T, error: `เซิร์ฟเวอร์ไม่ตอบสนอง (HTTP ${res.status})` };
    return { data: json.data ?? null, error: json.error ?? null };
  } catch {
    return { data: null as T, error: 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาตรวจสอบอินเทอร์เน็ต' };
  }
}

const client: EzSiteApis = {
  login: (p) => call('POST', '/auth/login', p),
  register: (p) => call('POST', '/auth/register', p),
  logout: () => call('POST', '/auth/logout', {}),
  getUserInfo: () => call<UserInfo>('GET', '/auth/me'),
  sendResetPwdEmail: (p) => call('POST', '/auth/reset-request', p),
  resetPassword: (p) => call('POST', '/auth/reset', p),
  tablePage: (tableId, query) => call<TablePageResult>('POST', `/tables/${tableId}/page`, query),
  tableCreate: (tableId, record) => call('POST', `/tables/${tableId}/create`, record),
  tableUpdate: (tableId, record) => call('POST', `/tables/${tableId}/update`, record),
  tableDelete: (tableId, record) => call('POST', `/tables/${tableId}/delete`, record),
  run: (p) => call('POST', '/run', p)
};

// A few pages still call window.ezsite.apis directly.
window.ezsite = { apis: client };

export const apis = (): EzSiteApis => client;

/** Load every row of a table (small operational tables, so a single large page is fine). */
export async function fetchAll(
  tableId: number,
  orderByField = 'ID',
  isAsc = true
): Promise<any[]> {
  const { data, error } = await apis().tablePage(tableId, {
    PageNo: 1,
    PageSize: 1000,
    OrderByField: orderByField,
    IsAsc: isAsc,
    Filters: []
  });
  if (error) throw new Error(error);
  return data?.List ?? [];
}
