import { createPortal } from 'react-dom';
import React, { useState, useEffect, useRef, createContext, useContext, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Users, Clock, CalendarOff, Calculator,
  Package, Receipt, Settings, LogOut, Menu, X,
  CheckCircle2, XCircle, AlertCircle, ChevronRight, Wallet,
  PieChart as PieChartIcon, ShieldCheck, Edit,
  MapPin, Fingerprint, Plus, UploadCloud, Trash2, Truck, Loader2,
  BarChart3, ArrowUpRight, ArrowDownRight, Minus, RefreshCw, Timer, Printer
} from 'lucide-react';
import { apis, fetchAll, TABLES, UserInfo } from '@/lib/ezsite';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { useUserLocation, distanceInMeters } from '@/hooks/useUserLocation';
import { LocationPermissionDialog } from '@/components/LocationPermissionDialog';

// ---- Always reflect the real current date/month, never a fixed sample date ----
const pad2 = (n: number) => String(n).padStart(2, '0');
const now = new Date();
const CURRENT_MONTH = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}`;
const TODAY_DATE = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;

// ---- Display helper: ISO date (YYYY-MM-DD) -> วัน/เดือน/ปี order ----
const formatDateDMY = (dateStr: string) => {
  if (!dateStr) return '-';
  const parts = dateStr.split('-');
  if (parts.length !== 3) return dateStr;
  const [y, m, d] = parts;
  return `${d}/${m}/${y}`;
};

const DEFAULT_COMPANY = {
  id: 0, name: 'หจก.ธีรัตม์อาหารสัตว์', taxId: '', phone: '', address: '', logoUrl: '', gpsCheckInEnabled: false,
  workplaceLat: null as number | null, workplaceLng: null as number | null, gpsRadiusM: 200
};

// ---- Row mappers: DB (snake_case) <-> UI (camelCase) ----
const mapEmployee = (r: any) => ({
  id: r.ID, empCode: r.emp_code, username: r.username, email: r.email, name: r.name,
  roles: (r.roles || '').split(',').map((s: string) => s.trim()).filter(Boolean),
  dept: r.dept, salary: r.salary || 0, type: r.salary_type, bankAccount: r.bank_account,
  bankName: r.bank_name || '', bankAccountName: r.bank_account_name || '',
  phone: r.phone, hasSocialSecurity: !!r.has_social_security, hireDate: r.hire_date || '',
  resignationDepositMonthly: Number(r.resignation_deposit_monthly) || 0
});

// ---- Employment tenure helpers ----
const calcTenure = (hireDateStr: string) => {
  if (!hireDateStr) return null;
  const start = new Date(hireDateStr + 'T00:00:00');
  if (isNaN(start.getTime())) return null;
  const now = new Date();
  if (start.getTime() > now.getTime()) return null;
  let years = now.getFullYear() - start.getFullYear();
  let months = now.getMonth() - start.getMonth();
  let days = now.getDate() - start.getDate();
  if (days < 0) { months -= 1; days += new Date(now.getFullYear(), now.getMonth(), 0).getDate(); }
  if (months < 0) { years -= 1; months += 12; }
  const totalDays = Math.floor((now.getTime() - start.getTime()) / 86400000);
  return { years, months, days, totalDays };
};
const formatTenure = (t: ReturnType<typeof calcTenure>, detailed = false) => {
  if (!t) return 'ไม่ระบุวันเริ่มงาน';
  const parts: string[] = [];
  if (t.years > 0) parts.push(`${t.years} ปี`);
  if (t.months > 0) parts.push(`${t.months} เดือน`);
  if (detailed || (t.years === 0 && t.months === 0)) parts.push(`${t.days} วัน`);
  return parts.length ? parts.join(' ') : '0 วัน';
};

// ---- Days worked in a given YYYY-MM, counted from distinct IN check-ins ----
const countWorkDaysInMonth = (empId: number, month: string, attendanceLogs: any[]) => {
  const days = new Set(
    (attendanceLogs || [])
      .filter((log: any) => log.empId === empId && log.type === 'IN' && (log.date || '').startsWith(month))
      .map((log: any) => log.date)
  );
  return days.size;
};

// Number of Monday–Saturday days in a YYYY-MM month (used as the leave-deduction divisor)
const countMonSatDays = (month: string) => {
  const [y, m] = month.split('-').map(Number);
  const total = new Date(y, m, 0).getDate();
  let count = 0;
  for (let d = 1; d <= total; d++) if (new Date(y, m - 1, d).getDay() !== 0) count++;
  return count || 1;
};

// ---- Monthly income calculation (base salary - deductions + unloading share, filtered to the given YYYY-MM) ----
const calcMonthlyIncome = (
  emp: any,
  month: string,
  ctx: { leaves: any[]; advances: any[]; overtime: any[]; attendanceLogs: any[]; resignationDeposits?: any[]; getEmployeeUnloadingTotal: (empId: number, month: string) => number }
) => {
  const daysWorked = emp.type === 'DAILY' ? countWorkDaysInMonth(emp.id, month, ctx.attendanceLogs) : 0;
  const base = emp.type === 'DAILY' ? (emp.salary || 0) * daysWorked : (emp.salary || 0);
  const unpaidDays = ctx.leaves
    .filter((l: any) => l.empId === emp.id && l.status === 'APPROVED' && l.type.includes('UNPAID') && (l.date || '').startsWith(month))
    .reduce((sum: number, l: any) => sum + (l.duration || 1), 0);
  // Daily-rate pay already excludes unpaid days (no check-in = no pay for that day), so no separate deduction applies.
  const deductLeave = emp.type !== 'DAILY' && unpaidDays > 0 ? (base / countMonSatDays(month)) * unpaidDays : 0;
  const advanceDeduction = ctx.advances
    .filter((a: any) => a.empId === emp.id && a.status === 'APPROVED' && (a.deductionMonth || (a.date || '').slice(0, 7)) === month)
    .reduce((sum: number, a: any) => sum + a.amount, 0);
  const unloadingShare = ctx.getEmployeeUnloadingTotal(emp.id, month);
  const otIncome = (ctx.overtime || [])
    .filter((o: any) => o.empId === emp.id && o.status === 'APPROVED' && (o.date || '').startsWith(month))
    .reduce((sum: number, o: any) => sum + (o.amount || 0), 0);
  const ssoDeduction = emp.hasSocialSecurity ? Math.min(base * 0.05, 750) : 0;
  const resignationDepositDeduction = (ctx.resignationDeposits || [])
    .filter((d: any) => d.empId === emp.id && (d.deductionMonth || '') === month)
    .reduce((sum: number, d: any) => sum + (d.amount || 0), 0);
  const net = base - deductLeave - advanceDeduction - ssoDeduction - resignationDepositDeduction + unloadingShare + otIncome;
  return { base, daysWorked, deductLeave, advanceDeduction, ssoDeduction, resignationDepositDeduction, unloadingShare, otIncome, net };
};
const mapLeave = (r: any) => ({ id: r.ID, empId: r.emp_id, date: r.leave_date, type: r.type, status: r.status, reason: r.reason, period: r.period, duration: r.duration });
const mapUnloading = (r: any) => ({ id: r.ID, date: r.log_date, bags: r.bags, recordedBy: r.recorded_by });
const mapAdvance = (r: any) => ({ id: r.ID, empId: r.emp_id, amount: r.amount, date: r.advance_date, status: r.status, deductionMonth: r.deduction_month, category: r.category || 'อื่นๆ', note: r.note || '' });
const ADVANCE_CATEGORIES = ['เงินเดือนล่วงหน้า', 'ค่ารักษาพยาบาล', 'ฉุกเฉิน', 'อื่นๆ'];
const mapResignationDeposit = (r: any) => ({ id: r.ID, empId: r.emp_id, amount: r.amount || 0, deductionMonth: r.deduction_month, note: r.note || '' });
const mapExpense = (r: any) => ({ id: r.ID, date: r.expense_date, category: r.category, description: r.description, amount: r.amount, vehicle: r.vehicle });
const mapCategory = (r: any) => ({ id: r.ID, name: r.name });
const mapVehicle = (r: any) => ({
  id: r.ID, plate: r.plate, name: r.name, type: r.vehicle_type, isActive: r.is_active !== false,
  driverName: r.driver_name || '',
  insurance: { company: r.insurance_company || '', date: r.insurance_date || '', expiry: r.insurance_expiry || '', cost: Number(r.insurance_cost) || 0 },
  act: { company: r.act_company || '', date: r.act_date || '', expiry: r.act_expiry || '', cost: Number(r.act_cost) || 0 },
  registration: { expiry: r.registration_expiry || '', cost: Number(r.registration_cost) || 0 }
});
// Legacy rows store the date as DD/MM/BBBB (Thai Buddhist year); normalize everything to ISO YYYY-MM-DD.
const normalizeLogDate = (v: string) => {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec((v || '').trim());
  if (!m) return v || '';
  const y = Number(m[3]);
  return `${y > 2400 ? y - 543 : y}-${pad2(Number(m[2]))}-${pad2(Number(m[1]))}`;
};
const localISODate = () => { const n = new Date(); return `${n.getFullYear()}-${pad2(n.getMonth() + 1)}-${pad2(n.getDate())}`; };
const mapAttendance = (r: any) => ({ id: r.ID, empId: r.emp_id, time: r.log_time, date: normalizeLogDate(r.log_date), type: r.type, method: r.method });
const mapOvertime = (r: any) => ({ id: r.ID, empId: r.emp_id, date: r.ot_date, hours: r.hours || 0, rate: r.rate || 0, amount: r.amount || 0, status: r.status, approvedBy: r.approved_by });
const mapCompany = (r: any) => ({
  id: r.ID, name: r.name, taxId: r.tax_id, phone: r.phone, address: r.address, logoUrl: r.logo_url, gpsCheckInEnabled: !!r.gps_check_in_enabled,
  workplaceLat: r.workplace_lat ? Number(r.workplace_lat) : null,
  workplaceLng: r.workplace_lng ? Number(r.workplace_lng) : null,
  gpsRadiusM: Number(r.gps_radius_m) || 200
});

const AppContext = createContext<any>(null);

const DataProvider = ({ children }: any) => {
  const navigate = useNavigate();
  const [status, setStatus] = useState<'loading' | 'guest' | 'ready'>('loading');
  const [authUser, setAuthUser] = useState<UserInfo | null>(null);

  const [employees, setEmployees] = useState<any[]>([]);
  const [leaves, setLeaves] = useState<any[]>([]);
  const [unloadingLogs, setUnloadingLogs] = useState<any[]>([]);
  const [advances, setAdvances] = useState<any[]>([]);
  const [resignationDeposits, setResignationDeposits] = useState<any[]>([]);
  const [expenses, setExpenses] = useState<any[]>([]);
  const [expenseCategories, setExpenseCategories] = useState<any[]>([]);
  const [vehicles, setVehicles] = useState<any[]>([]);
  const [attendanceLogs, setAttendanceLogs] = useState<any[]>([]);
  const [overtimeRecords, setOvertimeRecords] = useState<any[]>([]);
  const [companySettings, setCompanySettings] = useState<any>(DEFAULT_COMPANY);

  const [isLeaveModalOpen, setIsLeaveModalOpen] = useState(false);
  const [currentView, setCurrentView] = useState('dashboard');

  // ---- Table refreshers ----
  const refreshEmployees = async () => setEmployees((await fetchAll(TABLES.employees)).map(mapEmployee));
  const refreshLeaves = async () => setLeaves((await fetchAll(TABLES.leaves, 'ID', false)).map(mapLeave));
  const refreshUnloading = async () => setUnloadingLogs((await fetchAll(TABLES.unloadingLogs, 'ID', false)).map(mapUnloading));
  const refreshAdvances = async () => setAdvances((await fetchAll(TABLES.advances, 'ID', false)).map(mapAdvance));
  const refreshResignationDeposits = async () => setResignationDeposits((await fetchAll(TABLES.resignationDeposits, 'ID', false)).map(mapResignationDeposit));
  const refreshExpenses = async () => setExpenses((await fetchAll(TABLES.expenses, 'ID', false)).map(mapExpense));
  const refreshCategories = async () => setExpenseCategories((await fetchAll(TABLES.expenseCategories)).map(mapCategory));
  const refreshVehicles = async () => setVehicles((await fetchAll(TABLES.vehicles)).map(mapVehicle));
  const refreshAttendance = async () => setAttendanceLogs((await fetchAll(TABLES.attendanceLogs, 'ID', false)).map(mapAttendance));
  const refreshOvertime = async () => setOvertimeRecords((await fetchAll(TABLES.overtime, 'ID', false)).map(mapOvertime));
  const refreshCompany = async () => {
    const rows = await fetchAll(TABLES.companySettings);
    setCompanySettings(rows.length ? mapCompany(rows[0]) : DEFAULT_COMPANY);
  };

  useEffect(() => {
    (async () => {
      try {
        const { data, error } = await apis().getUserInfo();
        if (error || !data) { setStatus('guest'); return; }
        setAuthUser(data);
        await Promise.all([
          refreshEmployees(), refreshLeaves(), refreshUnloading(), refreshAdvances(), refreshResignationDeposits(),
          refreshExpenses(), refreshCategories(), refreshVehicles(), refreshAttendance(), refreshOvertime(), refreshCompany()
        ]);
        setStatus('ready');
      } catch (e) {
        setStatus('guest');
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const currentUser = useMemo(() => {
    if (!authUser) return null;
    const email = (authUser.Email || '').toLowerCase();
    return employees.find((e) => (e.email || '').toLowerCase() === email) || null;
  }, [authUser, employees]);

  const logout = async () => {
    await apis().logout();
    navigate('/login');
  };

  // ---- Helper to run a write op with error handling + refresh ----
  const run = async (op: () => Promise<{ error: string | null }>, refresh: () => Promise<void>) => {
    try {
      const { error } = await op();
      if (error) { toast({ title: 'เกิดข้อผิดพลาด', description: error, variant: 'destructive' }); return false; }
      await refresh();
      return true;
    } catch (e: any) {
      toast({ title: 'เกิดข้อผิดพลาด', description: e?.message || 'ดำเนินการไม่สำเร็จ', variant: 'destructive' });
      return false;
    }
  };

  // ---- Mutations ----
  const saveEmployee = async (emp: any) => {
    const rec: any = {
      emp_code: emp.empCode || '', username: emp.username || emp.empCode || '', email: emp.email || '',
      name: emp.name || '', roles: (emp.roles || ['EMPLOYEE']).join(','), dept: emp.dept || 'OFFICE',
      salary: Number(emp.salary) || 0, salary_type: emp.type || 'MONTHLY', bank_account: emp.bankAccount || '',
      bank_name: emp.bankName || '', bank_account_name: emp.bankAccountName || '',
      phone: emp.phone || '', has_social_security: !!emp.hasSocialSecurity, hire_date: emp.hireDate || '',
      resignation_deposit_monthly: Number(emp.resignationDepositMonthly) || 0
    };
    return emp.id
      ? run(() => apis().tableUpdate(TABLES.employees, { ID: emp.id, ...rec }), refreshEmployees)
      : run(() => apis().tableCreate(TABLES.employees, rec), refreshEmployees);
  };
  const updateEmployee = async (id: number, updates: any) => {
    const cur = employees.find((e) => e.id === id);
    if (!cur) return;
    await saveEmployee({ ...cur, ...updates });
  };
  const deleteEmployee = (id: number) => run(() => apis().tableDelete(TABLES.employees, { ID: id }), refreshEmployees);

  const addLeave = (d: any) => run(() => apis().tableCreate(TABLES.leaves, {
    emp_id: d.empId, leave_date: d.date, type: d.type, status: d.status || 'PENDING',
    reason: d.reason, period: d.period, duration: d.duration
  }), refreshLeaves);
  const setLeaveStatus = (id: number, statusVal: string) =>
    run(() => apis().tableUpdate(TABLES.leaves, { ID: id, status: statusVal }), refreshLeaves);

  const saveUnloading = (d: any) => {
    const rec = { log_date: d.date, bags: Number(d.bags) || 0, recorded_by: d.recordedBy || 0 };
    return d.id
      ? run(() => apis().tableUpdate(TABLES.unloadingLogs, { ID: d.id, ...rec }), refreshUnloading)
      : run(() => apis().tableCreate(TABLES.unloadingLogs, rec), refreshUnloading);
  };
  const deleteUnloading = (id: number) => run(() => apis().tableDelete(TABLES.unloadingLogs, { ID: id }), refreshUnloading);

  const saveAdvance = (a: any) => {
    const rec = {
      emp_id: a.empId, amount: Number(a.amount) || 0, advance_date: a.date,
      status: a.status || 'PENDING', deduction_month: a.deductionMonth || '',
      category: a.category || 'อื่นๆ', note: a.note || ''
    };
    return a.id
      ? run(() => apis().tableUpdate(TABLES.advances, { ID: a.id, ...rec }), refreshAdvances)
      : run(() => apis().tableCreate(TABLES.advances, rec), refreshAdvances);
  };
  const deleteAdvance = (id: number) => run(() => apis().tableDelete(TABLES.advances, { ID: id }), refreshAdvances);
  const setAdvanceStatus = (id: number, statusVal: string) =>
    run(() => apis().tableUpdate(TABLES.advances, { ID: id, status: statusVal }), refreshAdvances);

  const saveResignationDeposit = (d: any) => {
    const rec = { emp_id: d.empId, amount: Number(d.amount) || 0, deduction_month: d.deductionMonth || '', note: d.note || '' };
    return d.id
      ? run(() => apis().tableUpdate(TABLES.resignationDeposits, { ID: d.id, ...rec }), refreshResignationDeposits)
      : run(() => apis().tableCreate(TABLES.resignationDeposits, rec), refreshResignationDeposits);
  };
  const deleteResignationDeposit = (id: number) => run(() => apis().tableDelete(TABLES.resignationDeposits, { ID: id }), refreshResignationDeposits);

  // ---- Auto-post this month's resignation deposit installment for every enrolled employee (runs once payroll data is ready) ----
  const ensuredDepositMonthRef = useRef<string | null>(null);
  useEffect(() => {
    if (status !== 'ready' || !currentUser) return;
    if (!currentUser.roles.some((r: string) => ['OWNER', 'PAYROLL_OFFICER'].includes(r))) return;
    if (ensuredDepositMonthRef.current === CURRENT_MONTH) return;
    ensuredDepositMonthRef.current = CURRENT_MONTH;
    (async () => {
      const missing = employees.filter((emp) =>
        (emp.resignationDepositMonthly || 0) > 0 &&
        !resignationDeposits.some((d) => d.empId === emp.id && d.deductionMonth === CURRENT_MONTH)
      );
      if (missing.length === 0) return;
      for (const emp of missing) {
        await apis().tableCreate(TABLES.resignationDeposits, {
          emp_id: emp.id, amount: emp.resignationDepositMonthly, deduction_month: CURRENT_MONTH, note: 'หักอัตโนมัติประจำเดือน'
        });
      }
      await refreshResignationDeposits();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, currentUser, employees, resignationDeposits]);

  const saveExpense = (exp: any) => {
    const rec = { expense_date: exp.date, category: exp.category, description: exp.description || '', amount: Number(exp.amount) || 0, vehicle: exp.vehicle || '' };
    return exp.id
      ? run(() => apis().tableUpdate(TABLES.expenses, { ID: exp.id, ...rec }), refreshExpenses)
      : run(() => apis().tableCreate(TABLES.expenses, rec), refreshExpenses);
  };
  const deleteExpense = (id: number) => run(() => apis().tableDelete(TABLES.expenses, { ID: id }), refreshExpenses);

  const saveCategory = (cat: any) =>
    cat.id
      ? run(() => apis().tableUpdate(TABLES.expenseCategories, { ID: cat.id, name: cat.name }), refreshCategories)
      : run(() => apis().tableCreate(TABLES.expenseCategories, { name: cat.name }), refreshCategories);
  const deleteCategory = (id: number) => run(() => apis().tableDelete(TABLES.expenseCategories, { ID: id }), refreshCategories);

  const saveVehicle = (v: any) => {
    const rec = {
      plate: v.plate || '', name: v.name, vehicle_type: v.type || '6W', is_active: v.isActive !== false,
      driver_name: v.driverName || '',
      insurance_company: v.insurance?.company || '', insurance_date: v.insurance?.date || '',
      insurance_expiry: v.insurance?.expiry || '', insurance_cost: Number(v.insurance?.cost) || 0,
      act_company: v.act?.company || '', act_date: v.act?.date || '',
      act_expiry: v.act?.expiry || '', act_cost: Number(v.act?.cost) || 0,
      registration_expiry: v.registration?.expiry || '', registration_cost: Number(v.registration?.cost) || 0
    };
    return v.id
      ? run(() => apis().tableUpdate(TABLES.vehicles, { ID: v.id, ...rec }), refreshVehicles)
      : run(() => apis().tableCreate(TABLES.vehicles, rec), refreshVehicles);
  };
  const deleteVehicle = (id: number) => run(() => apis().tableDelete(TABLES.vehicles, { ID: id }), refreshVehicles);

  const saveCompanySettings = async (s: any) => {
    const rec = {
      name: s.name, tax_id: s.taxId, phone: s.phone, address: s.address, logo_url: s.logoUrl || '',
      gps_check_in_enabled: !!s.gpsCheckInEnabled,
      workplace_lat: s.workplaceLat ?? 0, workplace_lng: s.workplaceLng ?? 0,
      gps_radius_m: Number(s.gpsRadiusM) || 200
    };
    // อัปเดตแถวการตั้งค่าหลักเสมอ (แถวเดียว) เพื่อไม่ให้เกิดข้อมูลซ้ำ และค่าที่บันทึกคงอยู่ถาวรในฐานข้อมูล
    const rows = await fetchAll(TABLES.companySettings).catch(() => []);
    const targetId = s.id || (rows.length ? rows[0].ID : null);
    const ok = targetId
      ? await run(() => apis().tableUpdate(TABLES.companySettings, { ID: targetId, ...rec }), refreshCompany)
      : await run(() => apis().tableCreate(TABLES.companySettings, rec), refreshCompany);
    if (!ok) return false;
    // อ่านค่ากลับมาตรวจสอบว่า DB เก็บค่า gps_check_in_enabled ได้จริง (กันกรณีคอลัมน์ไม่มี/ไม่ถูกบันทึกแบบเงียบ ๆ)
    const after = await fetchAll(TABLES.companySettings).catch(() => []);
    const savedRow = after.find((r: any) => r.ID === (targetId || (after.length ? after[0].ID : null))) || after[0];
    if (savedRow && !!savedRow.gps_check_in_enabled !== !!s.gpsCheckInEnabled) {
      toast({
        title: 'บันทึกไม่สำเร็จจริง',
        description: 'ระบบไม่สามารถเก็บค่าสวิตช์ลงฐานข้อมูลได้ (คอลัมน์ gps_check_in_enabled ในตารางตั้งค่าองค์กรอาจยังไม่มี หรือชนิดข้อมูลไม่ใช่ boolean) กรุณาเพิ่ม/แก้คอลัมน์นี้ในตาราง',
        variant: 'destructive'
      });
      return false;
    }
    return true;
  };

  const addAttendance = (d: any) => run(() => apis().tableCreate(TABLES.attendanceLogs, {
    emp_id: d.empId, log_time: d.time, log_date: d.date, type: d.type, method: d.method
  }), refreshAttendance);

  const setOvertimeStatus = (id: number, statusVal: string, approvedBy: number) =>
    run(() => apis().tableUpdate(TABLES.overtime, { ID: id, status: statusVal, approved_by: approvedBy }), refreshOvertime);

  // ---- Calculations (unchanged business logic, numeric ids) ----
  const calculateDailyUnloadingPool = (date: string, totalBags: number) => {
    const pool = totalBags * 1.0; // 1 บาทต่อกระสอบ
    const eligibleStaffIds = employees.filter((e) => (e.roles || []).includes('EMPLOYEE')).map((e) => e.id);
    const staffOnLeaveFullDay = leaves.filter((l) => l.date === date && l.status === 'APPROVED' && l.period === 'FULL').map((l) => l.empId);
    const presentStaffIds = eligibleStaffIds.filter((id) => !staffOnLeaveFullDay.includes(id));
    if (presentStaffIds.length === 0) return { pool, perPerson: 0, presentCount: 0, distribution: [] as any[] };

    const totalSatang = pool * 100;
    const baseShareSatang = Math.floor(totalSatang / presentStaffIds.length);
    const remainder = totalSatang % presentStaffIds.length;
    const distribution = presentStaffIds.map((id, index) => ({
      empId: id, share: (baseShareSatang + (index < remainder ? 1 : 0)) / 100
    }));
    return { pool, presentCount: presentStaffIds.length, distribution };
  };

  const getEmployeeUnloadingTotal = (empId: number, month = CURRENT_MONTH) => {
    let total = 0;
    const filteredLogs = unloadingLogs.filter((log) => (log.date || '').startsWith(month));
    filteredLogs.forEach((log) => {
      const calc = calculateDailyUnloadingPool(log.date, log.bags);
      const userShare = calc.distribution?.find((d: any) => d.empId === empId)?.share || 0;
      total += userShare;
    });
    return total;
  };

  const value = {
    status, authUser, currentUser, logout,
    employees, leaves, unloadingLogs, advances, resignationDeposits, expenses, expenseCategories, vehicles, attendanceLogs, overtimeRecords, companySettings, setCompanySettings,
    saveEmployee, updateEmployee, deleteEmployee, addLeave, setLeaveStatus, saveUnloading, deleteUnloading,
    saveAdvance, deleteAdvance, setAdvanceStatus, saveResignationDeposit, deleteResignationDeposit,
    saveExpense, deleteExpense, saveCategory, deleteCategory, saveVehicle, deleteVehicle,
    saveCompanySettings, addAttendance, setOvertimeStatus,
    isLeaveModalOpen, setIsLeaveModalOpen,
    currentView, setCurrentView,
    calculateDailyUnloadingPool, getEmployeeUnloadingTotal,
    CURRENT_MONTH, TODAY_DATE
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
};

const Card = ({ children, className = '', onClick }: any) => (
  <div onClick={onClick} className={cn('bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden', className, onClick && 'cursor-pointer hover:border-teal-500 transition-colors')}>
    {children}
  </div>
);

const Button = ({ children, onClick, variant = 'primary', className = '', disabled = false, type = 'button' }: any) => {
  const baseStyle = 'px-4 py-2 rounded-lg font-medium transition-all duration-200 flex items-center justify-center gap-2';
  const variants: any = {
    primary: 'bg-teal-600 hover:bg-teal-700 text-white disabled:bg-teal-300',
    secondary: 'bg-slate-100 hover:bg-slate-200 text-slate-700 disabled:bg-slate-50',
    danger: 'bg-red-50 hover:bg-red-100 text-red-600 disabled:opacity-50',
    outline: 'border border-slate-300 hover:bg-slate-50 text-slate-700 bg-white'
  };
  return (
    <button type={type} onClick={onClick} disabled={disabled} className={`${baseStyle} ${variants[variant]} ${className}`}>
      {children}
    </button>
  );
};

const Badge = ({ children, type = 'default' }: any) => {
  const types: any = {
    success: 'bg-emerald-100 text-emerald-800',
    warning: 'bg-amber-100 text-amber-800',
    danger: 'bg-red-100 text-red-800',
    info: 'bg-blue-100 text-blue-800',
    default: 'bg-slate-100 text-slate-800',
    navy: 'bg-slate-800 text-white'
  };
  return <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${types[type]}`}>{children}</span>;
};

const LeaveRequestModal = () => {
  const { isLeaveModalOpen, setIsLeaveModalOpen, addLeave, currentUser } = useContext(AppContext);
  const [leaveForm, setLeaveForm] = useState({ date: '', type: 'SICK_PAID', reason: '', period: 'FULL', duration: 1 });
  const [saving, setSaving] = useState(false);

  if (!isLeaveModalOpen) return null;

  const handleSubmitLeave = async () => {
    if (!leaveForm.date || !leaveForm.reason) return;
    setSaving(true);
    const ok = await addLeave({
      empId: currentUser.id, date: leaveForm.date, type: leaveForm.type,
      status: 'PENDING', reason: leaveForm.reason, period: leaveForm.period, duration: leaveForm.duration
    });
    setSaving(false);
    if (ok) {
      toast({ title: 'ส่งคำขอลาสำเร็จ', description: 'คำขอของคุณถูกบันทึกและรออนุมัติ' });
      setLeaveForm({ date: '', type: 'SICK_PAID', reason: '', period: 'FULL', duration: 1 });
      setIsLeaveModalOpen(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-[100] p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        <div className="p-5 border-b border-slate-100 flex justify-between items-center bg-slate-50">
          <h3 className="font-bold text-slate-800 flex items-center gap-2"><CalendarOff className="w-5 h-5" /> แบบฟอร์มยื่นขอลางาน</h3>
          <button onClick={() => setIsLeaveModalOpen(false)} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">วันที่ต้องการลา</label>
            <input type="date" value={leaveForm.date} onChange={(e) => setLeaveForm({ ...leaveForm, date: e.target.value })} className="w-full border border-slate-300 rounded-lg p-2.5 text-sm outline-none focus:border-teal-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">ประเภทการลา</label>
            <select value={leaveForm.type} onChange={(e) => setLeaveForm({ ...leaveForm, type: e.target.value })} className="w-full border border-slate-300 rounded-lg p-2.5 text-sm outline-none focus:border-teal-500">
              <option value="SICK_PAID">ลาป่วย (มีใบรับรองแพทย์ - ได้รับค่าจ้าง)</option>
              <option value="SICK_UNPAID">ลาป่วย (ไม่มีใบรับรองแพทย์ - หักเงิน)</option>
              <option value="PERSONAL_UNPAID">ลากิจ (หักเงินอัตโนมัติ)</option>
              <option value="ANNUAL_PAID">ลาพักร้อน (รับค่าจ้าง)</option>
            </select>
          </div>
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800 space-y-1">
            <p>• <strong>ลาป่วย</strong> จะได้รับค่าจ้างเฉพาะเมื่อมีใบรับรองแพทย์ หากไม่มีใบรับรองแพทย์ให้เลือก "ไม่มีใบรับรองแพทย์" ระบบจะหักเงินอัตโนมัติ</p>
            <p>• <strong>ลากิจ</strong> ระบบหักเงินอัตโนมัติ ไม่มีตัวเลือกได้รับค่าจ้าง</p>
            <p>• <strong>ลากิจในวันจันทร์</strong> จะถูกหักค่าแรงสองแรง และมีผลต่อการปรับฐานเงินเดือน</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">ระยะเวลา</label>
            <select value={leaveForm.period} onChange={(e) => {
              const val = e.target.value;
              setLeaveForm({ ...leaveForm, period: val, duration: val === 'FULL' ? 1 : 0.5 });
            }} className="w-full border border-slate-300 rounded-lg p-2.5 text-sm outline-none focus:border-teal-500">
              <option value="FULL">เต็มวัน (หัก 1 วัน)</option>
              <option value="HALF_MORNING">ครึ่งวันเช้า (หัก 0.5 วัน, ได้ส่วนแบ่งลงของ)</option>
              <option value="HALF_AFTERNOON">ครึ่งวันบ่าย (หัก 0.5 วัน, ได้ส่วนแบ่งลงของ)</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">เหตุผลการลา</label>
            <textarea rows={3} value={leaveForm.reason} onChange={(e) => setLeaveForm({ ...leaveForm, reason: e.target.value })} placeholder="ระบุเหตุผล..." className="w-full border border-slate-300 rounded-lg p-2.5 text-sm outline-none focus:border-teal-500"></textarea>
          </div>
          <div className="pt-2 flex justify-end gap-3">
            <Button variant="secondary" onClick={() => setIsLeaveModalOpen(false)}>ยกเลิก</Button>
            <Button variant="primary" onClick={handleSubmitLeave} disabled={!leaveForm.date || !leaveForm.reason || saving}>
              {saving && <Loader2 className="w-4 h-4 animate-spin" />} ส่งคำขอ
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

const PayslipModal = ({ isOpen, onClose, emp, CURRENT_MONTH, advances, leaves, getEmployeeUnloadingTotal }: any) => {
  const { companySettings, attendanceLogs, resignationDeposits } = useContext(AppContext);
  if (!isOpen || !emp) return null;

  const daysWorked = emp.type === 'DAILY' ? countWorkDaysInMonth(emp.id, CURRENT_MONTH, attendanceLogs) : 0;
  const base = emp.type === 'DAILY' ? (emp.salary || 0) * daysWorked : (emp.salary || 0);
  const unpaidDays = leaves.filter((l: any) => l.empId === emp.id && l.status === 'APPROVED' && l.type.includes('UNPAID') && (l.date || '').startsWith(CURRENT_MONTH)).reduce((sum: number, l: any) => sum + (l.duration || 1), 0);
  const deductLeave = emp.type !== 'DAILY' && unpaidDays > 0 ? (base / countMonSatDays(CURRENT_MONTH)) * unpaidDays : 0;
  const advance = advances.filter((a: any) => a.empId === emp.id && a.status === 'APPROVED' && (a.deductionMonth || (a.date || '').slice(0, 7)) === CURRENT_MONTH).reduce((sum: number, a: any) => sum + a.amount, 0);
  const unloadingShare = getEmployeeUnloadingTotal(emp.id);
  const ssoDeduction = emp.hasSocialSecurity ? Math.min(base * 0.05, 750) : 0;
  const resignationDeposit = resignationDeposits.filter((d: any) => d.empId === emp.id && d.deductionMonth === CURRENT_MONTH).reduce((sum: number, d: any) => sum + d.amount, 0);
  const net = base - deductLeave - advance - ssoDeduction - resignationDeposit + unloadingShare;

  return (
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-[100] p-4">
      <div id="payslip-printable" className="bg-white rounded-xl shadow-xl w-full max-w-lg overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        <div className="bg-slate-800 p-5 text-white flex justify-between items-center rounded-t-xl">
          <div>
            <h3 className="font-bold text-lg">{companySettings?.name || 'หจก.ธีรัตม์อาหารสัตว์'}</h3>
            <p className="text-slate-300 text-sm">ใบแจ้งเงินเดือน (e-Payslip) - งวด {formatMonthTH(CURRENT_MONTH)}</p>
          </div>
          <Receipt className="w-8 h-8 text-teal-400 opacity-80" />
        </div>
        <div className="p-5 bg-slate-50 border-b border-slate-200 grid grid-cols-2 gap-y-2 text-sm">
          <p><span className="text-slate-500">รหัส:</span> <span className="font-medium text-slate-800">{emp.empCode}</span></p>
          <p><span className="text-slate-500">ชื่อ:</span> <span className="font-medium text-slate-800">{emp.name}</span></p>
          <p><span className="text-slate-500">แผนก:</span> <span className="font-medium text-slate-800">{emp.dept}</span></p>
          <p><span className="text-slate-500">บัญชี:</span> <span className="font-medium text-slate-800">{emp.bankAccount || '-'}</span></p>
        </div>
        <div className="p-5">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <h4 className="font-bold text-teal-700 mb-3 border-b border-teal-100 pb-1">รายรับ (Earnings)</h4>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-slate-600">{emp.type === 'DAILY' ? `ค่าแรงรายวัน (${daysWorked} วัน)` : 'เงินเดือนพื้นฐาน'}</span><span className="font-medium">฿{base.toLocaleString()}</span></div>
                <div className="flex justify-between"><span className="text-slate-600">ส่วนแบ่งลงของ</span><span className="font-medium">฿{unloadingShare.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span></div>
              </div>
            </div>
            <div>
              <h4 className="font-bold text-red-700 mb-3 border-b border-red-100 pb-1">รายการหัก (Deductions)</h4>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-slate-600">หักลากิจ ({unpaidDays} วัน)</span><span className="font-medium text-red-600">{deductLeave > 0 ? `-฿${deductLeave.toLocaleString(undefined, { minimumFractionDigits: 2 })}` : '-'}</span></div>
                <div className="flex justify-between"><span className="text-slate-600">เบิกล่วงหน้า</span><span className="font-medium text-red-600">{advance > 0 ? `-฿${advance.toLocaleString()}` : '-'}</span></div>
                {ssoDeduction > 0 && <div className="flex justify-between"><span className="text-slate-600">ประกันสังคม (5%)</span><span className="font-medium text-red-600">-฿{ssoDeduction.toLocaleString()}</span></div>}
                {resignationDeposit > 0 && <div className="flex justify-between"><span className="text-slate-600">ค่าประกันการลาออก</span><span className="font-medium text-red-600">-฿{resignationDeposit.toLocaleString()}</span></div>}
              </div>
            </div>
          </div>
          <div className="mt-6 pt-4 border-t border-slate-200 flex justify-between items-end">
            <div><Badge type="info">สถานะ: รอประมวลผลสิ้นเดือน</Badge></div>
            <div className="text-right">
              <p className="text-sm font-bold text-slate-500 mb-1">ยอดรับสุทธิ (Net Pay)</p>
              <p className="text-3xl font-bold text-teal-600 underline decoration-teal-200 underline-offset-4">฿{net.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
            </div>
          </div>
        </div>
        <div className="p-4 border-t border-slate-100 flex justify-end gap-3 bg-slate-50 rounded-b-xl no-print">
          <Button variant="secondary" onClick={onClose}>ปิดหน้าต่าง</Button>
          <Button variant="primary" onClick={() => window.print()}><Printer className="w-4 h-4" /> พิมพ์ / บันทึกเป็น PDF</Button>
        </div>
      </div>
    </div>
  );
};

const ViewDashboard = () => {
  const { currentUser, employees, leaves, unloadingLogs, expenses, setIsLeaveModalOpen, CURRENT_MONTH, getEmployeeUnloadingTotal, TODAY_DATE, advances, attendanceLogs } = useContext(AppContext);
  const [isPayslipOpen, setIsPayslipOpen] = useState(false);
  const [selectedMonth, setSelectedMonth] = useState(CURRENT_MONTH);

  if (currentUser.roles.includes('OWNER')) {
    const filteredExpenses = expenses.filter((exp: any) => exp.date.startsWith(selectedMonth));
    const filteredUnloading = unloadingLogs.filter((log: any) => log.date.startsWith(selectedMonth));

    const estSalary = employees.reduce((acc: number, emp: any) => acc + (emp.type === 'DAILY' ? (emp.salary || 0) * countWorkDaysInMonth(emp.id, selectedMonth, attendanceLogs) : (emp.salary || 0)), 0);
    const estUnloading = filteredUnloading.reduce((acc: number, log: any) => acc + log.bags, 0);
    const staffOnLeave = leaves.filter((l: any) => l.date === TODAY_DATE && l.status === 'APPROVED');

    const totalOperationalExpense = filteredExpenses.reduce((sum: number, exp: any) => sum + exp.amount, 0);
    const grandTotal = estSalary + estUnloading + totalOperationalExpense;

    const expenseByCategory = filteredExpenses.reduce((acc: any, exp: any) => {
      acc[exp.category] = (acc[exp.category] || 0) + exp.amount;
      return acc;
    }, {} as any);

    if (estSalary > 0) expenseByCategory['ค่าแรงพนักงาน'] = estSalary;
    if (estUnloading > 0) expenseByCategory['ส่วนแบ่งค่าลงของ (กองกลาง)'] = estUnloading;

    const sortedCategories = Object.entries(expenseByCategory)
      .map(([name, amount]) => ({ name, amount: amount as number }))
      .filter((cat) => cat.amount > 0)
      .sort((a, b) => b.amount - a.amount);

    const monthNames = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
    const [yearStr, monthStr] = selectedMonth.split('-');
    const displayMonth = `${monthNames[parseInt(monthStr, 10) - 1]} ${parseInt(yearStr, 10) + 543}`;

    return (
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white p-4 rounded-xl shadow-sm border border-slate-200">
          <div>
            <h2 className="text-lg font-bold text-slate-800">สรุปภาพรวมกิจการ</h2>
            <p className="text-sm text-teal-600 font-medium">ข้อมูลประจำเดือน {displayMonth}</p>
          </div>
          <div className="flex items-center gap-3 bg-slate-50 p-2 rounded-lg border border-slate-100">
            <label className="text-sm font-medium text-slate-600">เลือกเดือนดูงบการเงิน:</label>
            <input type="month" value={selectedMonth} onChange={(e) => setSelectedMonth(e.target.value)} className="border border-slate-300 rounded-lg p-2 text-sm outline-none focus:border-teal-500 bg-white" />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card className="p-5 border-l-4 border-l-teal-500">
            <p className="text-sm font-medium text-slate-500 mb-1">พนักงานทั้งหมด</p>
            <div className="flex justify-between items-end"><h3 className="text-3xl font-bold text-slate-800">{employees.length}</h3><Users className="text-slate-200 w-8 h-8" /></div>
          </Card>
          <Card className="p-5 border-l-4 border-l-amber-500">
            <p className="text-sm font-medium text-slate-500 mb-1">ลางานวันนี้ ({formatDateDMY(TODAY_DATE)})</p>
            <div className="flex justify-between items-end"><h3 className="text-3xl font-bold text-slate-800">{staffOnLeave.length}</h3><CalendarOff className="text-slate-200 w-8 h-8" /></div>
          </Card>
          <Card className="p-5 border-l-4 border-l-blue-500">
            <p className="text-sm font-medium text-slate-500 mb-1">รวมต้นทุนกิจการ ({displayMonth})</p>
            <div className="flex justify-between items-end"><h3 className="text-3xl font-bold text-slate-800">฿{grandTotal.toLocaleString()}</h3><Wallet className="text-slate-200 w-8 h-8" /></div>
          </Card>
        </div>

        <Card className="p-6">
          <h3 className="text-lg font-bold text-slate-800 mb-6 flex items-center gap-2 border-b border-slate-100 pb-4"><PieChartIcon className="w-5 h-5 text-teal-500" /> สรุปค่าใช้จ่ายทุกหมวดหมู่ (ประจำเดือน {displayMonth})</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-5">
            {sortedCategories.length > 0 ? sortedCategories.map((cat) => {
              const percentage = grandTotal > 0 ? (cat.amount / grandTotal) * 100 : 0;
              const isPrimaryCost = cat.name.includes('เงินเดือน') || cat.name.includes('ค่าลงของ');
              return (
                <div key={cat.name} className="bg-slate-50 p-4 rounded-xl border border-slate-100 hover:border-teal-200 transition-colors">
                  <div className="flex justify-between text-sm mb-2"><span className={`font-semibold ${isPrimaryCost ? 'text-teal-700' : 'text-slate-700'}`}>{cat.name}</span><span className="font-bold text-slate-900 text-base">฿{cat.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span></div>
                  <div className="w-full bg-slate-200 rounded-full h-2.5 mb-1 overflow-hidden"><div className={`h-2.5 rounded-full ${isPrimaryCost ? 'bg-teal-500' : 'bg-blue-500'}`} style={{ width: `${percentage}%` }}></div></div>
                  <p className="text-xs text-slate-400 text-right">{percentage.toFixed(1)}% ของค่าใช้จ่ายทั้งหมด</p>
                </div>
              );
            }) : <p className="text-sm text-slate-400 text-center py-4 md:col-span-2">ไม่มีข้อมูลค่าใช้จ่ายในเดือนนี้</p>}
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card className="bg-gradient-to-br from-teal-600 to-slate-800 text-white p-6 md:p-8">
        <h2 className="text-2xl font-bold mb-2">สวัสดี, {currentUser.name}</h2>
        <p className="text-teal-100 opacity-90">ข้อมูลการทำงานประจำเดือน {formatMonthTH(CURRENT_MONTH)}</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-6">
          <div className="bg-white/10 p-4 rounded-xl backdrop-blur-sm">
            <p className="text-teal-100 text-sm mb-1">ส่วนแบ่งลงของ (ประเมิน)</p>
            <p className="text-2xl font-bold">~฿{getEmployeeUnloadingTotal(currentUser.id).toLocaleString(undefined, { minimumFractionDigits: 2 })} <span className="text-sm font-normal">บาท</span></p>
          </div>
        </div>
      </Card>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card onClick={() => setIsLeaveModalOpen(true)} className="p-5 flex items-center justify-between group">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-teal-100 group-hover:bg-teal-200 rounded-full flex items-center justify-center"><CalendarOff className="w-6 h-6 text-teal-600" /></div>
            <div><h3 className="font-bold text-slate-800">ยื่นขอลางาน</h3><p className="text-sm text-slate-500">ป่วย, กิจ, พักร้อน</p></div>
          </div>
          <ChevronRight className="text-slate-300 group-hover:text-teal-500" />
        </Card>
        <Card onClick={() => setIsPayslipOpen(true)} className="p-5 flex items-center justify-between group cursor-pointer hover:border-amber-500">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-amber-100 group-hover:bg-amber-200 rounded-full flex items-center justify-center"><Receipt className="w-6 h-6 text-amber-600" /></div>
            <div><h3 className="font-bold text-slate-800">สลิปเงินเดือน</h3><p className="text-sm text-slate-500">ดูประวัติย้อนหลัง / ปัจจุบัน</p></div>
          </div>
          <ChevronRight className="text-slate-300 group-hover:text-amber-500" />
        </Card>
      </div>
      <PayslipModal isOpen={isPayslipOpen} onClose={() => setIsPayslipOpen(false)} emp={currentUser} CURRENT_MONTH={CURRENT_MONTH} advances={advances} leaves={leaves} getEmployeeUnloadingTotal={getEmployeeUnloadingTotal} />
    </div>
  );
};

const ViewEmployees = () => {
  const { employees, currentUser, saveEmployee, deleteEmployee } = useContext(AppContext);
  const isOwner = currentUser.roles.includes('OWNER') || currentUser.roles.includes('PAYROLL_OFFICER');
  const canManageEmployees = currentUser.roles.includes('OWNER') || currentUser.roles.includes('HR_ADMIN');

  const [editingRolesFor, setEditingRolesFor] = useState<any>(null);
  const [editingProfileFor, setEditingProfileFor] = useState<any>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [saving, setSaving] = useState(false);

  const handleRoleToggle = (role: string) => {
    const currentRoles = editingRolesFor.roles || [];
    const newRoles = currentRoles.includes(role) ? currentRoles.filter((r: string) => r !== role) : [...currentRoles, role];
    setEditingRolesFor({ ...editingRolesFor, roles: newRoles.length > 0 ? newRoles : currentRoles });
  };

  const handleSaveProfile = async () => {
    setSaving(true);
    const ok = await saveEmployee(editingProfileFor);
    setSaving(false);
    if (ok) { toast({ title: 'บันทึกข้อมูลพนักงานสำเร็จ' }); setEditingProfileFor(null); }
  };

  const handleSaveRoles = async () => {
    setSaving(true);
    const ok = await saveEmployee(editingRolesFor);
    setSaving(false);
    if (ok) { toast({ title: 'บันทึกสิทธิ์สำเร็จ' }); setEditingRolesFor(null); }
  };

  return (
    <Card>
      <div className="p-5 border-b border-slate-100 flex justify-between items-center bg-slate-50">
        <h3 className="font-bold text-slate-800 flex items-center gap-2"><Users className="w-5 h-5" /> จัดการพนักงาน</h3>
        {canManageEmployees && (
          <Button variant="outline" onClick={() => setEditingProfileFor({ empCode: '', name: '', dept: 'EMPLOYEE', roles: ['EMPLOYEE'], salary: 0, type: 'MONTHLY', bankAccount: '', bankName: '', bankAccountName: '', phone: '', hasSocialSecurity: false, resignationDepositMonthly: 0, username: '', email: '', hireDate: '' })}><Plus className="w-4 h-4" /> เพิ่มพนักงานใหม่</Button>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm whitespace-nowrap">
          <thead className="bg-slate-100 text-slate-600">
            <tr>
              <th className="p-4 font-medium">รหัส</th><th className="p-4 font-medium">ชื่อพนักงาน</th><th className="p-4 font-medium">แผนก</th>
              <th className="p-4 font-medium">วันเริ่มงาน</th><th className="p-4 font-medium">อายุงาน</th>
              {currentUser.roles.includes('OWNER') && <th className="p-4 font-medium">สิทธิ์ใช้งาน</th>}
              <th className="p-4 font-medium">ฐานเงินเดือน</th><th className="p-4 font-medium">บัญชีธนาคาร</th><th className="p-4 font-medium text-right">จัดการ</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {employees.map((emp: any) => {
              const tenure = calcTenure(emp.hireDate);
              return (
              <tr key={emp.id} className="hover:bg-slate-50">
                <td className="p-4 text-slate-500">{emp.empCode}</td>
                <td className="p-4 font-medium text-slate-900">{emp.name}</td>
                <td className="p-4"><Badge>{emp.dept}</Badge></td>
                <td className="p-4 text-slate-600">{formatDateDMY(emp.hireDate)}</td>
                <td className="p-4">
                  {tenure ? <Badge type="info">{formatTenure(tenure)}</Badge> : <span className="text-xs text-slate-400">ไม่ระบุ</span>}
                </td>
                {currentUser.roles.includes('OWNER') && (
                  <td className="p-4">
                    <div className="flex items-center gap-2">
                      <div className="flex gap-1 flex-wrap">
                        {emp.roles.map((r: string) => <Badge key={r} type={r === 'OWNER' ? 'navy' : r === 'HR_ADMIN' ? 'success' : r === 'PAYROLL_OFFICER' ? 'warning' : 'default'}>{r}</Badge>)}
                      </div>
                      <button onClick={() => setEditingRolesFor(emp)} className="p-1 hover:bg-slate-200 rounded text-slate-400"><ShieldCheck className="w-4 h-4" /></button>
                    </div>
                  </td>
                )}
                <td className="p-4 font-medium text-slate-800">
                  {isOwner ? `฿${emp.salary.toLocaleString()}${emp.type === 'DAILY' ? '/วัน' : ''}` : '***'}
                  {isOwner && emp.hasSocialSecurity && <span className="block text-[10px] text-blue-500 font-semibold mt-0.5">ประกันสังคม</span>}
                </td>
                <td className="p-4 text-slate-600">
                  {isOwner ? emp.bankAccount : '***'}
                  {isOwner && (emp.bankName || emp.bankAccountName) && (
                    <span className="block text-[11px] text-slate-400 mt-0.5">{emp.bankName}{emp.bankName && emp.bankAccountName ? ' · ' : ''}{emp.bankAccountName}</span>
                  )}
                </td>
                <td className="p-4 text-right">
                  <div className="flex justify-end gap-2">
                    <button onClick={() => setEditingProfileFor(emp)} className="p-2 bg-slate-100 hover:bg-teal-100 text-slate-600 hover:text-teal-600 rounded-lg transition-colors"><Edit className="w-4 h-4" /></button>
                    {canManageEmployees && emp.id !== currentUser.id && (
                      <button onClick={() => setDeleteId(emp.id)} className="p-2 bg-slate-100 hover:bg-red-100 text-slate-600 hover:text-red-600 rounded-lg transition-colors"><Trash2 className="w-4 h-4" /></button>
                    )}
                  </div>
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {editingRolesFor && (
        <div className="fixed inset-0 bg-slate-900/40 flex items-center justify-center z-[100] p-4">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-sm">
            <h3 className="font-bold text-lg mb-4">กำหนดสิทธิ์: {editingRolesFor.name}</h3>
            <div className="space-y-3 mb-6">
              {['OWNER', 'HR_ADMIN', 'PAYROLL_OFFICER', 'TEAM_MANAGER', 'EMPLOYEE'].map((role) => (
                <label key={role} className="flex items-center gap-3 p-3 border rounded-lg cursor-pointer hover:bg-slate-50">
                  <input type="checkbox" checked={editingRolesFor.roles.includes(role)} onChange={() => handleRoleToggle(role)} className="w-5 h-5 text-teal-600 rounded border-slate-300 focus:ring-teal-500" />
                  <span className="font-medium text-slate-700">{role}</span>
                </label>
              ))}
            </div>
            <div className="flex justify-end gap-3"><Button variant="secondary" onClick={() => setEditingRolesFor(null)}>ยกเลิก</Button><Button onClick={handleSaveRoles} disabled={saving}>{saving && <Loader2 className="w-4 h-4 animate-spin" />} บันทึกสิทธิ์</Button></div>
          </div>
        </div>
      )}

      {editingProfileFor && (
        <div className="fixed inset-0 bg-slate-900/40 flex items-center justify-center z-[100] p-4">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-md">
            <h3 className="font-bold text-lg mb-4">แก้ไขประวัติ: {editingProfileFor.name || 'เพิ่มพนักงานใหม่'}</h3>
            {!isOwner && <div className="mb-4 p-3 bg-amber-50 text-amber-800 text-sm rounded-lg border border-amber-200 flex items-center gap-2"><AlertCircle className="w-4 h-4" /> คุณไม่มีสิทธิ์แก้ไขข้อมูลเงินเดือนและบัญชี</div>}
            <div className="space-y-4 mb-6 max-h-96 overflow-y-auto">
              <div><label className="block text-sm font-medium mb-1">รหัสพนักงาน</label><input type="text" value={editingProfileFor.empCode} onChange={(e) => setEditingProfileFor({ ...editingProfileFor, empCode: e.target.value })} className="w-full border p-2 rounded-lg" /></div>
              <div><label className="block text-sm font-medium mb-1">ชื่อ-นามสกุล</label><input type="text" value={editingProfileFor.name} onChange={(e) => setEditingProfileFor({ ...editingProfileFor, name: e.target.value })} className="w-full border p-2 rounded-lg" /></div>
              <div><label className="block text-sm font-medium mb-1">เบอร์โทรศัพท์</label><input type="text" value={editingProfileFor.phone || ''} onChange={(e) => setEditingProfileFor({ ...editingProfileFor, phone: e.target.value })} className="w-full border p-2 rounded-lg" /></div>
              <div>
                <label className="block text-sm font-medium mb-1">วันเริ่มงาน</label>
                <input type="date" value={editingProfileFor.hireDate || ''} onChange={(e) => setEditingProfileFor({ ...editingProfileFor, hireDate: e.target.value })} className="w-full border p-2 rounded-lg" />
                {editingProfileFor.hireDate && (
                  <p className="text-xs text-slate-400 mt-1">อายุงานปัจจุบัน: {formatTenure(calcTenure(editingProfileFor.hireDate), true)}</p>
                )}
              </div>

              {isOwner && (
                <>
                  <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg space-y-3 mb-2">
                    <h4 className="font-bold text-sm text-slate-700 flex items-center gap-2"><ShieldCheck className="w-4 h-4" /> ข้อมูลบัญชีผู้ใช้ (สำหรับผูกกับบัญชีล็อกอิน)</h4>
                    <div>
                      <label className="block text-xs font-medium text-slate-500 mb-1">ชื่อผู้ใช้งาน (Username)</label>
                      <input type="text" value={editingProfileFor.username || editingProfileFor.empCode} onChange={(e) => setEditingProfileFor({ ...editingProfileFor, username: e.target.value })} className="w-full border p-2 rounded-lg text-sm" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-500 mb-1">อีเมลสำหรับเข้าสู่ระบบ</label>
                      <input type="email" placeholder="ผูกกับอีเมลที่ใช้สมัคร EZSite" value={editingProfileFor.email || ''} onChange={(e) => setEditingProfileFor({ ...editingProfileFor, email: e.target.value })} className="w-full border p-2 rounded-lg text-sm" />
                      <p className="text-[11px] text-slate-400 mt-1">พนักงานต้องสมัครสมาชิกด้วยอีเมลนี้ จึงจะเข้าใช้งานด้วยสิทธิ์ของตนเองได้</p>
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">ประเภทการจ่ายค่าแรง</label>
                    <select value={editingProfileFor.type || 'MONTHLY'} onChange={(e) => setEditingProfileFor({ ...editingProfileFor, type: e.target.value })} className="w-full border p-2 rounded-lg">
                      <option value="MONTHLY">รายเดือน</option>
                      <option value="DAILY">รายวัน</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">{editingProfileFor.type === 'DAILY' ? 'ค่าแรงต่อวัน (บาท)' : 'ฐานเงินเดือน (บาท)'}</label>
                    <input type="number" value={editingProfileFor.salary} onChange={(e) => setEditingProfileFor({ ...editingProfileFor, salary: Number(e.target.value) })} className="w-full border p-2 rounded-lg" />
                    {editingProfileFor.type === 'DAILY' && <p className="text-[11px] text-slate-400 mt-1">ยอดรับจริงจะคำนวณจากจำนวนวันที่มีการลงเวลาเข้างาน (IN) ในเดือนนั้น</p>}
                  </div>
                  <div><label className="block text-sm font-medium mb-1">เลขบัญชีธนาคาร</label><input type="text" value={editingProfileFor.bankAccount} onChange={(e) => setEditingProfileFor({ ...editingProfileFor, bankAccount: e.target.value })} className="w-full border p-2 rounded-lg" /></div>
                  <div><label className="block text-sm font-medium mb-1">ธนาคาร</label><input type="text" value={editingProfileFor.bankName || ''} onChange={(e) => setEditingProfileFor({ ...editingProfileFor, bankName: e.target.value })} className="w-full border p-2 rounded-lg" /></div>
                  <div><label className="block text-sm font-medium mb-1">ชื่อบัญชีธนาคาร</label><input type="text" value={editingProfileFor.bankAccountName || ''} onChange={(e) => setEditingProfileFor({ ...editingProfileFor, bankAccountName: e.target.value })} className="w-full border p-2 rounded-lg" /></div>
                  <label className="flex items-center gap-3 mt-4 cursor-pointer p-3 border border-slate-200 rounded-lg bg-slate-50 hover:bg-slate-100 transition-colors">
                    <input type="checkbox" checked={editingProfileFor.hasSocialSecurity || false} onChange={(e) => setEditingProfileFor({ ...editingProfileFor, hasSocialSecurity: e.target.checked })} className="w-5 h-5 text-teal-600 rounded border-slate-300 focus:ring-teal-500" />
                    <div className="flex flex-col"><span className="font-bold text-slate-700">หักเงินสมทบประกันสังคม (5%)</span><span className="text-xs text-slate-500">สูงสุดไม่เกิน 750 บาท/เดือน</span></div>
                  </label>
                  <div className="p-3 border border-amber-200 bg-amber-50 rounded-lg">
                    <label className="block text-sm font-bold text-amber-800 mb-1">ค่าประกันการลาออกโดยไม่แจ้งล่วงหน้า (บาท/เดือน)</label>
                    <input type="number" min="0" value={editingProfileFor.resignationDepositMonthly || 0} onChange={(e) => setEditingProfileFor({ ...editingProfileFor, resignationDepositMonthly: Number(e.target.value) })} className="w-full border border-amber-200 p-2 rounded-lg" />
                    <p className="text-[11px] text-amber-700 mt-1">ระบบจะหักยอดนี้จากเงินเดือนอัตโนมัติทุกเดือนและสะสมยอดรวมไว้ ใส่ 0 หากไม่ต้องการหัก</p>
                  </div>
                </>
              )}
            </div>
            <div className="flex justify-end gap-3">
              <Button variant="secondary" onClick={() => setEditingProfileFor(null)}>ยกเลิก</Button>
              <Button onClick={handleSaveProfile} disabled={saving}>{saving && <Loader2 className="w-4 h-4 animate-spin" />} บันทึกข้อมูล</Button>
            </div>
          </div>
        </div>
      )}

      {deleteId !== null && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-[100] p-4">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-sm text-center">
            <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4"><Trash2 className="w-8 h-8 text-red-500" /></div>
            <h3 className="font-bold text-lg text-slate-800 mb-2">ยืนยันการลบพนักงาน?</h3>
            <p className="text-sm text-slate-500 mb-4">ข้อมูลพนักงานคนนี้จะถูกลบออกจากระบบอย่างถาวร</p>
            <div className="flex justify-center gap-3">
              <Button variant="secondary" onClick={() => setDeleteId(null)}>ยกเลิก</Button>
              <Button variant="danger" disabled={deleting} onClick={async () => {
                setDeleting(true);
                const ok = await deleteEmployee(deleteId);
                setDeleting(false);
                if (ok) toast({ title: 'ลบพนักงานแล้ว' });
                setDeleteId(null);
              }}>{deleting && <Loader2 className="w-4 h-4 animate-spin" />} ลบพนักงาน</Button>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
};

const ViewTime = () => {
  const { currentUser, companySettings, setCompanySettings, saveCompanySettings, attendanceLogs, addAttendance, employees } = useContext(AppContext);
  const getEmpName = (id: number) => employees.find((e: any) => e.id === id)?.name || 'ไม่ทราบชื่อ';
  // เฉพาะ OWNER/HR เท่านั้นที่กดเปิด/ปิดสวิตช์ได้ ส่วนคนอื่นยังลงเวลาได้ตามปกติ
  const canManageCheckIn = currentUser.roles.some((r: string) => ['OWNER', 'HR_ADMIN'].includes(r));

  const [time, setTime] = useState(new Date().toLocaleTimeString('th-TH'));
  const [checkInStatus, setCheckInStatus] = useState<string | null>(null);
  const [checkInMsg, setCheckInMsg] = useState('');
  const [activeAction, setActiveAction] = useState<'IN' | 'OUT' | null>(null);
  const [togglingCheckIn, setTogglingCheckIn] = useState(false);
  const [pendingCheckType, setPendingCheckType] = useState<'IN' | 'OUT' | null>(null);
  const { requestLocation, permissionDenied, dismissPermissionDialog } = useUserLocation();
  // ควบคุมสถานะสวิตช์แบบ optimistic เพื่อให้ปุ่มเปลี่ยนเป็นสีเขียวทันทีที่กดเปิด
  const [isAppCheckInEnabled, setIsAppCheckInEnabled] = useState(!!companySettings?.gpsCheckInEnabled);
  useEffect(() => { setIsAppCheckInEnabled(!!companySettings?.gpsCheckInEnabled); }, [companySettings?.gpsCheckInEnabled]);

  // ---- ตั้งค่ารัศมี GPS: พิกัดสถานที่ทำงานและรัศมีที่อนุญาต (OWNER/HR เท่านั้น) ----
  const [savingLocation, setSavingLocation] = useState(false);
  const [radiusInput, setRadiusInput] = useState(String(companySettings?.gpsRadiusM || 200));
  const [savingRadius, setSavingRadius] = useState(false);
  useEffect(() => { setRadiusInput(String(companySettings?.gpsRadiusM || 200)); }, [companySettings?.gpsRadiusM]);

  const handleToggleCheckIn = async () => {
    setTogglingCheckIn(true);
    const nextEnabled = !isAppCheckInEnabled;
    setIsAppCheckInEnabled(nextEnabled);
    const ok = await saveCompanySettings({ ...companySettings, gpsCheckInEnabled: nextEnabled });
    setTogglingCheckIn(false);
    if (ok) {
      // ยืนยันค่าใน context หลังบันทึก เพื่อไม่ให้ค่าย้อนกลับเมื่อสลับไปหน้าอื่น
      setCompanySettings((prev: any) => ({ ...prev, gpsCheckInEnabled: nextEnabled }));
      toast({ title: nextEnabled ? 'เปิดใช้งานแล้ว' : 'ปิดใช้งานแล้ว', description: 'บันทึกการตั้งค่าระบบลงเวลาเรียบร้อย' });
    } else {
      setIsAppCheckInEnabled(!nextEnabled);
    }
  };

  const handleSetWorkplaceLocation = async () => {
    setSavingLocation(true);
    const coords = await requestLocation();
    if (!coords) { setSavingLocation(false); return; }
    const ok = await saveCompanySettings({ ...companySettings, workplaceLat: coords.lat, workplaceLng: coords.lng });
    setSavingLocation(false);
    if (ok) {
      setCompanySettings((prev: any) => ({ ...prev, workplaceLat: coords.lat, workplaceLng: coords.lng }));
      toast({ title: 'บันทึกพิกัดสถานที่ทำงานแล้ว', description: `${coords.lat.toFixed(6)}, ${coords.lng.toFixed(6)}` });
    }
  };

  const handleSaveRadius = async () => {
    const radius = Number(radiusInput);
    if (!radius || radius <= 0) {
      toast({ title: 'รัศมีไม่ถูกต้อง', description: 'กรุณากรอกตัวเลขมากกว่า 0', variant: 'destructive' });
      return;
    }
    setSavingRadius(true);
    const ok = await saveCompanySettings({ ...companySettings, gpsRadiusM: radius });
    setSavingRadius(false);
    if (ok) {
      setCompanySettings((prev: any) => ({ ...prev, gpsRadiusM: radius }));
      toast({ title: 'บันทึกรัศมีเรียบร้อย', description: `รัศมีที่อนุญาต ${radius} เมตร` });
    }
  };

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date().toLocaleTimeString('th-TH')), 1000);
    return () => clearInterval(timer);
  }, []);

  const resetStatusSoon = () => setTimeout(() => { setCheckInStatus(null); setCheckInMsg(''); setActiveAction(null); }, 4000);

  // ---- ตรวจสอบลำดับลงเวลา: ต้อง "เข้า" ก่อนจึงจะ "ออก" ได้ในรอบเดียวกัน ----
  const todayStr = localISODate();
  const lastTodayLog = attendanceLogs.find((log: any) => log.empId === currentUser.id && log.date === todayStr);
  const allowedCheckType: 'IN' | 'OUT' = lastTodayLog?.type === 'IN' ? 'OUT' : 'IN';

  const handleCheck = async (type: 'IN' | 'OUT') => {
    if (type !== allowedCheckType) {
      toast({
        title: 'ลำดับการลงเวลาไม่ถูกต้อง',
        description: type === 'IN' ? 'คุณลงเวลาเข้างานไปแล้ว กรุณาลงเวลาออกก่อน' : 'คุณยังไม่ได้ลงเวลาเข้างาน กรุณาลงเวลาเข้าก่อน',
        variant: 'destructive'
      });
      return;
    }
    setActiveAction(type);
    setCheckInStatus('loading');
    setCheckInMsg('');
    setPendingCheckType(type);

    const coords = await requestLocation();
    if (!coords) {
      setCheckInStatus('error');
      resetStatusSoon();
      return;
    }

    // ตรวจสอบระยะทางจากที่ทำงาน (เมื่อ OWNER/HR ตั้งพิกัดสถานที่ทำงานไว้แล้ว)
    const workplaceTarget = companySettings?.workplaceLat != null && companySettings?.workplaceLng != null
      ? { lat: companySettings.workplaceLat, lng: companySettings.workplaceLng }
      : null;
    const radiusM = companySettings?.gpsRadiusM || 200;
    const dist = workplaceTarget ? distanceInMeters(coords, workplaceTarget) : null;
    if (workplaceTarget && dist !== null && dist > radiusM) {
      setCheckInStatus('error');
      toast({
        title: 'อยู่นอกระยะที่กำหนด',
        description: `คุณอยู่ห่างจากที่ทำงาน ${Math.round(dist)} เมตร (เกิน ${radiusM} เมตร)`,
        variant: 'destructive'
      });
      resetStatusSoon();
      return;
    }

    const coord = `${coords.lat.toFixed(6)},${coords.lng.toFixed(6)}`;
    const ok = await addAttendance({
      empId: currentUser.id, time: new Date().toLocaleTimeString('th-TH'),
      date: new Date().toLocaleDateString('th-TH'), type, method: `GPS ${coord}`
    });
    if (ok) {
      setCheckInStatus('success');
      const distMsg = dist !== null ? ` • ห่างจากที่ทำงาน ${Math.round(dist)} เมตร` : '';
      setCheckInMsg(`บันทึกลงเวลา${type === 'IN' ? 'เข้า' : 'ออก'}งานสำเร็จ • พิกัด ${coord}${distMsg}`);
      resetStatusSoon();
    } else {
      setCheckInStatus(null);
      setActiveAction(null);
    }
  };

  return (
    <div className="space-y-6">
      {canManageCheckIn && (
        <Card className="p-5 bg-slate-800 text-white space-y-4">
          <div className="flex items-center justify-between">
            <div><h3 className="font-bold text-lg">การตั้งค่าระบบลงเวลา (OWNER/HR)</h3><p className="text-sm text-slate-300">อนุญาตให้พนักงานลงเวลาผ่าน GPS มือถือ</p></div>
            <button onClick={handleToggleCheckIn} disabled={togglingCheckIn} className={`w-14 h-8 flex items-center rounded-full p-1 transition-colors disabled:opacity-50 ${isAppCheckInEnabled ? 'bg-green-500' : 'bg-slate-600'}`}>
              <div className={`bg-white w-6 h-6 rounded-full shadow-md transform transition-transform ${isAppCheckInEnabled ? 'translate-x-6' : ''}`}></div>
            </button>
          </div>

          <div className="border-t border-slate-700 pt-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm font-medium">พิกัดสถานที่ทำงาน</p>
                <p className="text-xs text-slate-400 font-mono">
                  {companySettings?.workplaceLat != null && companySettings?.workplaceLng != null
                    ? `${companySettings.workplaceLat.toFixed(6)}, ${companySettings.workplaceLng.toFixed(6)}`
                    : 'ยังไม่ได้ตั้งค่า (ยังไม่บล็อกระยะทาง)'}
                </p>
              </div>
              <Button variant="outline" className="!bg-slate-700 !border-slate-600 !text-white hover:!bg-slate-600" onClick={handleSetWorkplaceLocation} disabled={savingLocation}>
                {savingLocation ? <Loader2 className="w-4 h-4 animate-spin" /> : <MapPin className="w-4 h-4" />} ใช้พิกัดปัจจุบัน
              </Button>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <label className="text-sm text-slate-300 whitespace-nowrap">รัศมีที่อนุญาต (เมตร)</label>
              <input
                type="number" min={1} value={radiusInput} onChange={(e) => setRadiusInput(e.target.value)}
                className="w-24 px-2 py-1.5 rounded-lg text-slate-800 text-sm"
              />
              <Button variant="outline" className="!bg-slate-700 !border-slate-600 !text-white hover:!bg-slate-600" onClick={handleSaveRadius} disabled={savingRadius}>
                {savingRadius && <Loader2 className="w-4 h-4 animate-spin" />} บันทึกรัศมี
              </Button>
            </div>

            <p className="text-xs text-amber-300 border-t border-slate-700 pt-3">
              หากลืมลงเวลาออก ระบบจะลงเวลาออก 17:00 น. ให้อัตโนมัติตอน 20:00 น. (ผู้ที่ทำโอทีให้กดลงเวลาออกก่อน 20:00 น.)
            </p>
          </div>
        </Card>
      )}

      {isAppCheckInEnabled ? (
        <Card className="p-8 text-center bg-gradient-to-br from-teal-50 to-slate-50 border border-teal-100">
          <p className="text-slate-500 font-medium mb-2">เวลาปัจจุบัน</p>
          <h2 className="text-6xl font-bold text-slate-800 tracking-wider mb-8 drop-shadow-sm">{time}</h2>

          <div className="flex items-center justify-center gap-6 mb-6">
            {(['IN', 'OUT'] as const).map((type) => {
              const isActive = activeAction === type;
              const isAllowed = type === allowedCheckType;
              const color = type === 'IN' ? 'bg-teal-500 hover:bg-teal-600' : 'bg-orange-500 hover:bg-orange-600';
              return (
                <button key={type} onClick={() => handleCheck(type)} disabled={checkInStatus === 'loading' || !isAllowed}
                  className={`w-32 h-32 rounded-full flex flex-col items-center justify-center text-white shadow-xl transition-all disabled:opacity-40 ${
                    isActive && checkInStatus === 'success' ? 'bg-emerald-500 scale-110' :
                    isActive && checkInStatus === 'error' ? 'bg-red-500' :
                    `${color} hover:scale-105 active:scale-95`}`}>
                  {isActive && checkInStatus === 'loading' ? <div className="w-10 h-10 border-4 border-white border-t-transparent rounded-full animate-spin"></div> :
                   isActive && checkInStatus === 'success' ? <CheckCircle2 className="w-12 h-12 mb-1" /> :
                   isActive && checkInStatus === 'error' ? <XCircle className="w-12 h-12 mb-1" /> :
                   <Fingerprint className="w-12 h-12 mb-1" />}
                  <span className="font-bold text-lg">{type === 'IN' ? 'ลงเวลาเข้า' : 'ลงเวลาออก'}</span>
                </button>
              );
            })}
          </div>

          {checkInStatus === 'success' && checkInMsg && <p className="text-emerald-600 font-medium">✅ {checkInMsg}</p>}

          <div className="mt-4 flex items-center justify-center gap-2 bg-slate-200/50 w-fit mx-auto px-4 py-2 rounded-full text-slate-600 text-sm">
            <MapPin className="w-4 h-4" /> <span>ระบบจะอ่านพิกัด GPS จริงจากอุปกรณ์ของคุณ</span>
          </div>
        </Card>
      ) : (
        <Card className="p-8 text-center bg-amber-50 border-amber-200">
          <AlertCircle className="w-12 h-12 text-amber-500 mx-auto mb-4" />
          <h3 className="text-lg font-bold text-amber-800 mb-2">ปิดใช้งานการลงเวลาผ่านแอป</h3>
          <p className="text-amber-700">กรุณาลงเวลาเข้า-ออกผ่านเครื่องสแกนลายนิ้วมือที่บริษัทเท่านั้น</p>
        </Card>
      )}

      <Card>
        <div className="p-4 border-b bg-slate-50 font-bold text-slate-800">ประวัติการลงเวลาล่าสุด</div>
        <div className="p-4">
          {attendanceLogs.length === 0 ? <p className="text-center text-slate-400 py-4">ยังไม่มีประวัติการลงเวลา</p> : (
            <div className="space-y-3">
              {attendanceLogs.map((log: any) => (
                <div key={log.id} className="flex justify-between items-center p-3 border rounded-lg bg-white">
                  <div><p className="font-bold text-slate-800">{getEmpName(log.empId)} • {log.time}</p><p className="text-xs text-slate-500">{formatDateDMY(log.date)} • {log.method}</p></div>
                  <Badge type={log.type === 'IN' ? 'success' : 'warning'}>{log.type === 'IN' ? 'เข้า' : 'ออก'}</Badge>
                </div>
              ))}
            </div>
          )}
        </div>
      </Card>

      <LocationPermissionDialog
        open={permissionDenied}
        onOpenChange={(open) => { if (!open) dismissPermissionDialog(); }}
        onRetry={pendingCheckType ? () => handleCheck(pendingCheckType) : undefined}
      />
    </div>
  );
};

const ViewLeaves = () => {
  const { leaves, setLeaveStatus, employees, currentUser } = useContext(AppContext);
  const isManager = currentUser.roles.includes('OWNER') || currentUser.roles.includes('HR_ADMIN') || currentUser.roles.includes('TEAM_MANAGER');

  const handleStatus = async (id: number, statusVal: string) => {
    const ok = await setLeaveStatus(id, statusVal);
    if (ok) toast({ title: statusVal === 'APPROVED' ? 'อนุมัติการลาแล้ว' : 'ปฏิเสธการลาแล้ว' });
  };
  const getEmpName = (id: number) => employees.find((e: any) => e.id === id)?.name || id;

  return (
    <Card>
      <div className="p-5 border-b border-slate-100 bg-slate-50"><h3 className="font-bold text-slate-800 flex items-center gap-2"><CalendarOff className="w-5 h-5" /> ประวัติการลา</h3></div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm whitespace-nowrap">
          <thead className="bg-slate-100 text-slate-600"><tr><th className="p-4">พนักงาน</th><th className="p-4">วันที่ (ระยะเวลา)</th><th className="p-4">ประเภท</th><th className="p-4">เหตุผล</th><th className="p-4">สถานะ</th>{isManager && <th className="p-4 text-right">จัดการ</th>}</tr></thead>
          <tbody className="divide-y divide-slate-100">
            {leaves.length === 0 ? <tr><td colSpan={6} className="p-8 text-center text-slate-400">ยังไม่มีข้อมูลการลา</td></tr> : leaves.map((l: any) => (
              <tr key={l.id} className="hover:bg-slate-50">
                <td className="p-4 font-medium">{getEmpName(l.empId)}</td>
                <td className="p-4">{formatDateDMY(l.date)} <span className="text-xs text-slate-400 block mt-0.5">{l.period === 'HALF_MORNING' ? 'ครึ่งวัน (เช้า)' : l.period === 'HALF_AFTERNOON' ? 'ครึ่งวัน (บ่าย)' : 'เต็มวัน'}</span></td>
                <td className="p-4"><Badge type={l.type.includes('UNPAID') ? 'danger' : 'info'}>{l.type === 'SICK_PAID' ? 'ลาป่วย (มีใบรับรองแพทย์ - ได้เงิน)' : l.type === 'SICK_UNPAID' ? 'ลาป่วย (ไม่มีใบรับรองแพทย์ - หักเงิน)' : l.type === 'PERSONAL_UNPAID' ? 'ลากิจ (หักเงินอัตโนมัติ)' : l.type === 'ANNUAL_PAID' ? 'ลาพักร้อน (ได้เงิน)' : l.type}</Badge></td>
                <td className="p-4 text-slate-500">{l.reason}</td>
                <td className="p-4"><Badge type={l.status === 'APPROVED' ? 'success' : l.status === 'REJECTED' ? 'danger' : 'warning'}>{l.status}</Badge></td>
                {isManager && (
                  <td className="p-4 text-right">
                    {l.status === 'PENDING' && (
                      <div className="flex gap-2 justify-end">
                        <Button variant="outline" onClick={() => handleStatus(l.id, 'REJECTED')} className="text-red-500 px-2 py-1 text-xs">ปฏิเสธ</Button>
                        <Button variant="primary" onClick={() => handleStatus(l.id, 'APPROVED')} className="px-2 py-1 text-xs">อนุมัติ</Button>
                      </div>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
};

const ViewOvertime = () => {
  const { overtimeRecords, setOvertimeStatus, employees, currentUser } = useContext(AppContext);
  const isManager = currentUser.roles.includes('OWNER') || currentUser.roles.includes('HR_ADMIN') || currentUser.roles.includes('TEAM_MANAGER');
  const visibleRecords = isManager ? overtimeRecords : overtimeRecords.filter((o: any) => o.empId === currentUser.id);

  const handleStatus = async (id: number, statusVal: string) => {
    const ok = await setOvertimeStatus(id, statusVal, currentUser.id);
    if (ok) toast({ title: statusVal === 'APPROVED' ? 'อนุมัติ OT แล้ว' : 'ปฏิเสธ OT แล้ว' });
  };
  const getEmpName = (id: number) => employees.find((e: any) => e.id === id)?.name || id;

  return (
    <Card>
      <div className="p-5 border-b border-slate-100 bg-slate-50"><h3 className="font-bold text-slate-800 flex items-center gap-2"><Timer className="w-5 h-5" /> รายการทำงานล่วงเวลา (OT)</h3></div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm whitespace-nowrap">
          <thead className="bg-slate-100 text-slate-600"><tr><th className="p-4">พนักงาน</th><th className="p-4">วันที่</th><th className="p-4 text-right">ชั่วโมง</th><th className="p-4 text-right">ยอดเงิน</th><th className="p-4">สถานะ</th>{isManager && <th className="p-4 text-right">จัดการ</th>}</tr></thead>
          <tbody className="divide-y divide-slate-100">
            {visibleRecords.length === 0 ? <tr><td colSpan={6} className="p-8 text-center text-slate-400">ยังไม่มีข้อมูล OT</td></tr> : visibleRecords.map((o: any) => (
              <tr key={o.id} className="hover:bg-slate-50">
                <td className="p-4 font-medium">{getEmpName(o.empId)}</td>
                <td className="p-4">{formatDateDMY(o.date)}</td>
                <td className="p-4 text-right">{o.hours} ชม.</td>
                <td className="p-4 text-right font-medium text-teal-600">฿{o.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                <td className="p-4"><Badge type={o.status === 'APPROVED' ? 'success' : o.status === 'REJECTED' ? 'danger' : 'warning'}>{o.status}</Badge></td>
                {isManager && (
                  <td className="p-4 text-right">
                    {o.status === 'PENDING' && (
                      <div className="flex gap-2 justify-end">
                        <Button variant="outline" onClick={() => handleStatus(o.id, 'REJECTED')} className="text-red-500 px-2 py-1 text-xs">ปฏิเสธ</Button>
                        <Button variant="primary" onClick={() => handleStatus(o.id, 'APPROVED')} className="px-2 py-1 text-xs">อนุมัติ</Button>
                      </div>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
};

const ViewUnloading = () => {
  const { unloadingLogs, saveUnloading, deleteUnloading, currentUser, calculateDailyUnloadingPool, getEmployeeUnloadingTotal, TODAY_DATE, CURRENT_MONTH } = useContext(AppContext);
  const isHRorOwner = currentUser.roles.includes('OWNER') || currentUser.roles.includes('HR_ADMIN');
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [newLog, setNewLog] = useState({ date: TODAY_DATE, bags: '' });
  const [saving, setSaving] = useState(false);

  const handleAdd = async () => {
    if (!newLog.date || !newLog.bags) return;
    setSaving(true);
    const ok = await saveUnloading({ id: editId || undefined, date: newLog.date, bags: Number(newLog.bags), recordedBy: currentUser.id });
    setSaving(false);
    if (ok) {
      toast({ title: editId ? 'แก้ไขยอดลงของสำเร็จ' : 'บันทึกยอดลงของสำเร็จ' });
      setIsAddOpen(false); setEditId(null); setNewLog({ date: TODAY_DATE, bags: '' });
    }
  };

  const handleEdit = (log: any) => {
    setNewLog({ date: log.date, bags: String(log.bags) });
    setEditId(log.id);
    setIsAddOpen(true);
  };

  const currentMonthLogs = unloadingLogs.filter((log: any) => log.date.startsWith(CURRENT_MONTH));
  const totalBags = currentMonthLogs.reduce((sum: number, log: any) => sum + log.bags, 0);
  const myShare = getEmployeeUnloadingTotal(currentUser.id, CURRENT_MONTH);
  const isEligibleForPool = currentUser.roles.includes('EMPLOYEE');

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="p-5 border-l-4 border-l-teal-500 bg-gradient-to-br from-teal-50 to-white">
          <p className="text-sm font-medium text-teal-700 mb-1">ยอดรวมกองกลางของทีม (เดือนนี้)</p>
          <div className="flex justify-between items-end">
            <div><h3 className="text-3xl font-bold text-slate-800">฿{(totalBags * 1).toLocaleString()}</h3><p className="text-sm text-slate-500 mt-1">จากทั้งหมด {totalBags.toLocaleString()} กระสอบ</p></div>
            <Package className="text-teal-200 w-10 h-10" />
          </div>
        </Card>

        {isEligibleForPool ? (
          <Card className="p-5 border-l-4 border-l-amber-500 bg-gradient-to-br from-amber-50 to-white">
            <p className="text-sm font-medium text-amber-700 mb-1">ส่วนแบ่งสะสมของคุณ (ประเมิน)</p>
            <div className="flex justify-between items-end">
              <div><h3 className="text-3xl font-bold text-slate-800">~฿{myShare.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</h3><p className="text-sm text-slate-500 mt-1">คำนวณตามวันที่คุณมาทำงาน (ลาครึ่งวันยังได้สิทธิ)</p></div>
              <Wallet className="text-amber-200 w-10 h-10" />
            </div>
          </Card>
        ) : (
          <Card className="p-5 flex items-center justify-center bg-slate-50 border border-dashed border-slate-300">
            <p className="text-slate-400 text-sm">คุณไม่อยู่ในกลุ่มพนักงานที่มีสิทธิรับส่วนแบ่งกองกลาง</p>
          </Card>
        )}
      </div>

      <Card>
        <div className="p-5 border-b border-slate-100 flex justify-between items-center bg-slate-50">
          <h3 className="font-bold text-slate-800 flex items-center gap-2"><Package className="w-5 h-5" /> ประวัติค่าลงของกองกลาง (วันต่อวัน)</h3>
          {isHRorOwner && <Button onClick={() => { setEditId(null); setNewLog({ date: TODAY_DATE, bags: '' }); setIsAddOpen(true); }}><Plus className="w-4 h-4" /> บันทึกยอดประจำวัน</Button>}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm whitespace-nowrap">
            <thead className="bg-slate-100 text-slate-600"><tr><th className="p-4">วันที่</th><th className="p-4 text-right">จำนวนกระสอบ</th><th className="p-4 text-right">ยอดเงินกองกลาง (บาท)</th><th className="p-4 text-center">คนทำงาน (ไม่ลา)</th><th className="p-4 text-right">หารเฉลี่ย/คน</th>{isHRorOwner && <th className="p-4 text-center">จัดการ</th>}</tr></thead>
            <tbody className="divide-y divide-slate-100">
              {unloadingLogs.map((log: any) => {
                const calc = calculateDailyUnloadingPool(log.date, log.bags);
                const avg = calc.distribution.length > 0 ? calc.distribution[0].share : 0;
                return (
                  <tr key={log.id} className="hover:bg-slate-50">
                    <td className="p-4 font-medium">{formatDateDMY(log.date)}</td>
                    <td className="p-4 text-right text-slate-600">{log.bags.toLocaleString()}</td>
                    <td className="p-4 text-right font-bold text-teal-600">฿{calc.pool.toLocaleString()}</td>
                    <td className="p-4 text-center"><Badge type="info">{calc.presentCount} คน</Badge></td>
                    <td className="p-4 text-right text-slate-600">~฿{avg.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                    {isHRorOwner && (
                      <td className="p-4 text-center whitespace-nowrap">
                        <button onClick={() => handleEdit(log)} className="p-2 bg-slate-100 hover:bg-teal-100 text-slate-600 hover:text-teal-600 rounded-lg transition-colors mr-2"><Edit className="w-4 h-4" /></button>
                        <button onClick={() => setDeleteId(log.id)} className="p-2 bg-slate-100 hover:bg-red-100 text-slate-600 hover:text-red-600 rounded-lg transition-colors"><Trash2 className="w-4 h-4" /></button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {isAddOpen && (
        <div className="fixed inset-0 bg-slate-900/40 flex items-center justify-center z-[100] p-4">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-sm">
            <h3 className="font-bold text-lg mb-4">{editId ? 'แก้ไขยอดลงของ (กระสอบ)' : 'บันทึกยอดลงของ (กระสอบ)'}</h3>
            <div className="space-y-4 mb-6">
              <div><label className="block text-sm font-medium mb-1">วันที่</label><input type="date" value={newLog.date} onChange={(e) => setNewLog({ ...newLog, date: e.target.value })} className="w-full border p-2 rounded-lg" /></div>
              <div><label className="block text-sm font-medium mb-1">จำนวนกระสอบรวมทั้งหมด</label><input type="number" placeholder="เช่น 1500" value={newLog.bags} onChange={(e) => setNewLog({ ...newLog, bags: e.target.value })} className="w-full border p-2 rounded-lg" /></div>
            </div>
            <div className="flex justify-end gap-3"><Button variant="secondary" onClick={() => { setIsAddOpen(false); setEditId(null); }}>ยกเลิก</Button><Button onClick={handleAdd} disabled={!newLog.date || !newLog.bags || saving}>{saving && <Loader2 className="w-4 h-4 animate-spin" />} บันทึกยอด</Button></div>
          </div>
        </div>
      )}

      {deleteId !== null && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-[100] p-4">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-sm text-center">
            <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4"><Trash2 className="w-8 h-8 text-red-500" /></div>
            <h3 className="font-bold text-lg text-slate-800 mb-2">ยืนยันการลบ?</h3>
            <p className="text-sm text-slate-500 mb-4">ยอดกองกลางของวันนี้จะถูกลบและคำนวณส่วนแบ่งใหม่ทันที</p>
            <div className="flex justify-center gap-3"><Button variant="secondary" onClick={() => setDeleteId(null)}>ยกเลิก</Button><Button variant="danger" onClick={async () => { const ok = await deleteUnloading(deleteId); if (ok) toast({ title: 'ลบรายการแล้ว' }); setDeleteId(null); }}>ลบรายการ</Button></div>
          </div>
        </div>
      )}
    </div>
  );
};

const AdvanceSection = () => {
  const { employees, advances, saveAdvance, deleteAdvance, setAdvanceStatus, CURRENT_MONTH, TODAY_DATE } = useContext(AppContext);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const emptyForm = { empId: employees[0]?.id || '', date: TODAY_DATE, amount: '', category: ADVANCE_CATEGORIES[0], note: '', deductionMonth: CURRENT_MONTH };
  const [formData, setFormData] = useState<any>(emptyForm);

  const empName = (id: number) => employees.find((e: any) => e.id === id)?.name || '-';

  const handleSave = async () => {
    if (!formData.empId || !formData.date || !formData.amount) return;
    setSaving(true);
    const ok = await saveAdvance({ id: editId || undefined, ...formData, amount: Number(formData.amount) });
    setSaving(false);
    if (ok) { toast({ title: 'บันทึกรายการเบิกล่วงหน้าสำเร็จ' }); setIsModalOpen(false); setEditId(null); }
  };

  const handleEdit = (a: any) => {
    setFormData({ empId: a.empId, date: a.date, amount: a.amount, category: a.category, note: a.note, deductionMonth: a.deductionMonth });
    setEditId(a.id);
    setIsModalOpen(true);
  };

  const handleStatus = async (id: number, statusVal: string) => {
    const ok = await setAdvanceStatus(id, statusVal);
    if (ok) toast({ title: statusVal === 'APPROVED' ? 'อนุมัติการเบิกแล้ว' : 'ปฏิเสธการเบิกแล้ว' });
  };

  return (
    <Card>
      <div className="p-5 border-b border-slate-100 flex flex-wrap gap-3 justify-between items-center bg-slate-50">
        <h3 className="font-bold text-slate-800 flex items-center gap-2"><Wallet className="w-5 h-5" /> รายการเบิกล่วงหน้า</h3>
        <Button onClick={() => { setEditId(null); setFormData(emptyForm); setIsModalOpen(true); }}><Plus className="w-4 h-4" /> เพิ่มรายการเบิกล่วงหน้า</Button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm whitespace-nowrap">
          <thead className="bg-slate-100 text-slate-600">
            <tr>
              <th className="p-4 font-medium">พนักงาน</th><th className="p-4 font-medium">วันที่</th>
              <th className="p-4 font-medium">หมวดหมู่</th><th className="p-4 font-medium">หมายเหตุ</th>
              <th className="p-4 text-right font-medium">ยอดเงิน</th><th className="p-4 font-medium">สถานะ</th>
              <th className="p-4 text-center font-medium">จัดการ</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {advances.length === 0 ? <tr><td colSpan={7} className="p-8 text-center text-slate-400">ยังไม่มีรายการเบิกล่วงหน้า</td></tr> : (
              advances.map((a: any) => (
                <tr key={a.id} className="hover:bg-slate-50">
                  <td className="p-4 font-medium">{empName(a.empId)}</td>
                  <td className="p-4 text-slate-600">{formatDateDMY(a.date)}</td>
                  <td className="p-4"><Badge type="info">{a.category}</Badge></td>
                  <td className="p-4 text-slate-600 max-w-xs truncate">{a.note || '-'}</td>
                  <td className="p-4 text-right font-bold text-red-600">฿{a.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                  <td className="p-4"><Badge type={a.status === 'APPROVED' ? 'success' : a.status === 'REJECTED' ? 'danger' : 'warning'}>{a.status}</Badge></td>
                  <td className="p-4 text-center whitespace-nowrap">
                    {a.status === 'PENDING' && (
                      <>
                        <Button variant="outline" onClick={() => handleStatus(a.id, 'REJECTED')} className="text-red-500 px-2 py-1 text-xs mr-1">ปฏิเสธ</Button>
                        <Button variant="primary" onClick={() => handleStatus(a.id, 'APPROVED')} className="px-2 py-1 text-xs mr-1">อนุมัติ</Button>
                      </>
                    )}
                    <button onClick={() => handleEdit(a)} className="p-2 bg-slate-100 hover:bg-teal-100 text-slate-600 hover:text-teal-600 rounded-lg transition-colors mr-2"><Edit className="w-4 h-4" /></button>
                    <button onClick={() => setDeleteId(a.id)} className="p-2 bg-slate-100 hover:bg-red-100 text-slate-600 hover:text-red-600 rounded-lg transition-colors"><Trash2 className="w-4 h-4" /></button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-[100] p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            <div className="p-5 border-b border-slate-100 flex justify-between items-center bg-slate-50">
              <h3 className="font-bold text-slate-800">{editId ? 'แก้ไขรายการเบิกล่วงหน้า' : 'เพิ่มรายการเบิกล่วงหน้า'}</h3>
              <button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-5 space-y-4">
              <div><label className="block text-sm font-medium text-slate-700 mb-1">พนักงาน</label>
                <select value={formData.empId} onChange={(e) => setFormData({ ...formData, empId: Number(e.target.value) })} className="w-full border border-slate-300 focus:border-teal-500 p-2.5 rounded-lg text-sm outline-none">
                  {employees.map((e: any) => <option key={e.id} value={e.id}>{e.name}</option>)}
                </select>
              </div>
              <div><label className="block text-sm font-medium text-slate-700 mb-1">วันที่เบิก</label><input type="date" value={formData.date} onChange={(e) => setFormData({ ...formData, date: e.target.value })} className="w-full border border-slate-300 focus:border-teal-500 p-2.5 rounded-lg text-sm outline-none" /></div>
              <div><label className="block text-sm font-medium text-slate-700 mb-1">หมวดหมู่เบิกล่วงหน้า</label>
                <select value={formData.category} onChange={(e) => setFormData({ ...formData, category: e.target.value })} className="w-full border border-slate-300 focus:border-teal-500 p-2.5 rounded-lg text-sm outline-none">
                  {ADVANCE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div><label className="block text-sm font-medium text-slate-700 mb-1">ยอดเงิน (บาท)</label><input type="number" placeholder="0.00" value={formData.amount} onChange={(e) => setFormData({ ...formData, amount: e.target.value })} className="w-full border border-slate-300 focus:border-teal-500 p-2.5 rounded-lg text-sm outline-none" /></div>
              <div><label className="block text-sm font-medium text-slate-700 mb-1">งวดเดือนที่หัก</label><input type="month" value={formData.deductionMonth} onChange={(e) => setFormData({ ...formData, deductionMonth: e.target.value })} className="w-full border border-slate-300 focus:border-teal-500 p-2.5 rounded-lg text-sm outline-none" /></div>
              <div><label className="block text-sm font-medium text-slate-700 mb-1">หมายเหตุ</label><textarea rows={3} placeholder="ระบุหมายเหตุ (ถ้ามี)..." value={formData.note} onChange={(e) => setFormData({ ...formData, note: e.target.value })} className="w-full border border-slate-300 focus:border-teal-500 p-2.5 rounded-lg text-sm outline-none"></textarea></div>
              <div className="pt-4 flex justify-end gap-3"><Button variant="secondary" onClick={() => setIsModalOpen(false)}>ยกเลิก</Button><Button variant="primary" onClick={handleSave} disabled={!formData.empId || !formData.date || !formData.amount || saving}>{saving && <Loader2 className="w-4 h-4 animate-spin" />} บันทึกข้อมูล</Button></div>
            </div>
          </div>
        </div>
      )}

      {deleteId !== null && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-[100] p-4">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-sm text-center">
            <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4"><Trash2 className="w-8 h-8 text-red-500" /></div>
            <h3 className="font-bold text-lg text-slate-800 mb-2">ยืนยันการลบ?</h3>
            <div className="flex justify-center gap-3"><Button variant="secondary" onClick={() => setDeleteId(null)}>ยกเลิก</Button><Button variant="danger" onClick={async () => { const ok = await deleteAdvance(deleteId); if (ok) toast({ title: 'ลบรายการแล้ว' }); setDeleteId(null); }}>ลบรายการ</Button></div>
          </div>
        </div>
      )}
    </Card>
  );
};

const ResignationDepositSection = () => {
  const { employees, resignationDeposits, saveResignationDeposit, deleteResignationDeposit, CURRENT_MONTH } = useContext(AppContext);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const emptyForm = { empId: employees[0]?.id || '', amount: '', deductionMonth: CURRENT_MONTH, note: '' };
  const [formData, setFormData] = useState<any>(emptyForm);

  const empName = (id: number) => employees.find((e: any) => e.id === id)?.name || '-';
  const totalByEmp = (empId: number) => resignationDeposits.filter((d: any) => d.empId === empId).reduce((sum: number, d: any) => sum + d.amount, 0);
  const grandTotal = resignationDeposits.reduce((sum: number, d: any) => sum + d.amount, 0);
  const enrolledEmployees = employees.filter((e: any) => (e.resignationDepositMonthly || 0) > 0 || totalByEmp(e.id) !== 0);

  const handleSave = async () => {
    if (!formData.empId || !formData.amount || !formData.deductionMonth) return;
    setSaving(true);
    const ok = await saveResignationDeposit({ ...formData, amount: Number(formData.amount) });
    setSaving(false);
    if (ok) { toast({ title: 'บันทึกรายการค่าประกันการลาออกสำเร็จ' }); setIsModalOpen(false); setFormData(emptyForm); }
  };

  return (
    <Card>
      <div className="p-5 border-b border-slate-100 flex flex-wrap gap-3 justify-between items-center bg-slate-50">
        <h3 className="font-bold text-slate-800 flex items-center gap-2"><ShieldCheck className="w-5 h-5" /> ค่าประกันการลาออกโดยไม่แจ้งล่วงหน้า</h3>
        <Button onClick={() => { setFormData(emptyForm); setIsModalOpen(true); }}><Plus className="w-4 h-4" /> เพิ่มรายการปรับปรุง/คืนเงิน</Button>
      </div>

      <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="bg-amber-50 border border-amber-100 rounded-xl p-4">
          <p className="text-xs font-medium text-amber-700 mb-1">ยอดสะสมรวมทุกพนักงาน</p>
          <p className="text-2xl font-bold text-slate-800">฿{grandTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
        </div>
        <div className="bg-slate-50 border border-slate-100 rounded-xl p-4">
          <p className="text-xs font-medium text-slate-500 mb-1">พนักงานที่ถูกหักค่าประกันนี้</p>
          <p className="text-2xl font-bold text-slate-800">{enrolledEmployees.length} คน</p>
        </div>
      </div>

      <div className="overflow-x-auto border-t border-slate-100">
        <table className="w-full text-left text-sm whitespace-nowrap">
          <thead className="bg-slate-100 text-slate-600">
            <tr>
              <th className="p-4 font-medium">พนักงาน</th>
              <th className="p-4 text-right font-medium">หักต่อเดือน</th>
              <th className="p-4 text-right font-medium">ยอดสะสมทั้งหมด</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {enrolledEmployees.length === 0 ? <tr><td colSpan={3} className="p-8 text-center text-slate-400">ยังไม่มีพนักงานที่ตั้งค่าหักค่าประกันนี้</td></tr> : (
              enrolledEmployees.map((e: any) => (
                <tr key={e.id} className="hover:bg-slate-50">
                  <td className="p-4 font-medium">{e.name}</td>
                  <td className="p-4 text-right text-red-500">{e.resignationDepositMonthly > 0 ? `฿${e.resignationDepositMonthly.toLocaleString()}` : '-'}</td>
                  <td className="p-4 text-right font-bold text-slate-900">฿{totalByEmp(e.id).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="p-5 border-t border-slate-100 bg-slate-50">
        <h4 className="font-bold text-slate-700 text-sm mb-3">ประวัติรายการหัก/ปรับปรุง</h4>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm whitespace-nowrap">
          <thead className="bg-slate-100 text-slate-600">
            <tr>
              <th className="p-4 font-medium">พนักงาน</th><th className="p-4 font-medium">งวดเดือน</th>
              <th className="p-4 font-medium">หมายเหตุ</th><th className="p-4 text-right font-medium">ยอดเงิน</th>
              <th className="p-4 text-center font-medium">จัดการ</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {resignationDeposits.length === 0 ? <tr><td colSpan={5} className="p-8 text-center text-slate-400">ยังไม่มีรายการ</td></tr> : (
              resignationDeposits.map((d: any) => (
                <tr key={d.id} className="hover:bg-slate-50">
                  <td className="p-4 font-medium">{empName(d.empId)}</td>
                  <td className="p-4 text-slate-600">{d.deductionMonth}</td>
                  <td className="p-4 text-slate-600 max-w-xs truncate">{d.note || '-'}</td>
                  <td className={cn('p-4 text-right font-bold', d.amount >= 0 ? 'text-red-600' : 'text-teal-600')}>{d.amount >= 0 ? '-' : '+'}฿{Math.abs(d.amount).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                  <td className="p-4 text-center">
                    <button onClick={() => setDeleteId(d.id)} className="p-2 bg-slate-100 hover:bg-red-100 text-slate-600 hover:text-red-600 rounded-lg transition-colors"><Trash2 className="w-4 h-4" /></button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-[100] p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            <div className="p-5 border-b border-slate-100 flex justify-between items-center bg-slate-50">
              <h3 className="font-bold text-slate-800">เพิ่มรายการปรับปรุง / คืนเงินประกันการลาออก</h3>
              <button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-5 space-y-4">
              <div><label className="block text-sm font-medium text-slate-700 mb-1">พนักงาน</label>
                <select value={formData.empId} onChange={(e) => setFormData({ ...formData, empId: Number(e.target.value) })} className="w-full border border-slate-300 focus:border-teal-500 p-2.5 rounded-lg text-sm outline-none">
                  {employees.map((e: any) => <option key={e.id} value={e.id}>{e.name}</option>)}
                </select>
              </div>
              <div><label className="block text-sm font-medium text-slate-700 mb-1">งวดเดือน</label><input type="month" value={formData.deductionMonth} onChange={(e) => setFormData({ ...formData, deductionMonth: e.target.value })} className="w-full border border-slate-300 focus:border-teal-500 p-2.5 rounded-lg text-sm outline-none" /></div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">ยอดเงิน (บาท)</label>
                <input type="number" placeholder="ใส่ค่าบวกเพื่อหักเพิ่ม หรือค่าลบเพื่อคืนเงิน" value={formData.amount} onChange={(e) => setFormData({ ...formData, amount: e.target.value })} className="w-full border border-slate-300 focus:border-teal-500 p-2.5 rounded-lg text-sm outline-none" />
                <p className="text-[11px] text-slate-400 mt-1">ใส่จำนวนบวกเพื่อหักเงินเพิ่ม หรือจำนวนลบ (เช่น -500) เพื่อคืนเงินให้พนักงาน</p>
              </div>
              <div><label className="block text-sm font-medium text-slate-700 mb-1">หมายเหตุ</label><textarea rows={3} placeholder="ระบุหมายเหตุ (ถ้ามี)..." value={formData.note} onChange={(e) => setFormData({ ...formData, note: e.target.value })} className="w-full border border-slate-300 focus:border-teal-500 p-2.5 rounded-lg text-sm outline-none"></textarea></div>
              <div className="pt-4 flex justify-end gap-3"><Button variant="secondary" onClick={() => setIsModalOpen(false)}>ยกเลิก</Button><Button variant="primary" onClick={handleSave} disabled={!formData.empId || !formData.amount || saving}>{saving && <Loader2 className="w-4 h-4 animate-spin" />} บันทึกข้อมูล</Button></div>
            </div>
          </div>
        </div>
      )}

      {deleteId !== null && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-[100] p-4">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-sm text-center">
            <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4"><Trash2 className="w-8 h-8 text-red-500" /></div>
            <h3 className="font-bold text-lg text-slate-800 mb-2">ยืนยันการลบ?</h3>
            <div className="flex justify-center gap-3"><Button variant="secondary" onClick={() => setDeleteId(null)}>ยกเลิก</Button><Button variant="danger" onClick={async () => { const ok = await deleteResignationDeposit(deleteId); if (ok) toast({ title: 'ลบรายการแล้ว' }); setDeleteId(null); }}>ลบรายการ</Button></div>
          </div>
        </div>
      )}
    </Card>
  );
};

const YEAR_MONTH_NAMES_TH = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];

const IncomeSummarySection = () => {
  const { employees, leaves, advances, resignationDeposits, overtimeRecords, attendanceLogs, getEmployeeUnloadingTotal, CURRENT_MONTH } = useContext(AppContext);
  const [mode, setMode] = useState<'month' | 'year'>('month');
  const [selectedMonth, setSelectedMonth] = useState(CURRENT_MONTH);
  const [selectedYear, setSelectedYear] = useState(CURRENT_MONTH.slice(0, 4));

  const ctx = { leaves, advances, resignationDeposits, overtime: overtimeRecords, attendanceLogs, getEmployeeUnloadingTotal };

  const rows = employees.map((emp: any) => {
    const tenure = calcTenure(emp.hireDate);
    if (mode === 'month') {
      return { emp, tenure, monthsCounted: 1, ...calcMonthlyIncome(emp, selectedMonth, ctx) };
    }
    const totals = { base: 0, daysWorked: 0, deductLeave: 0, advanceDeduction: 0, ssoDeduction: 0, resignationDepositDeduction: 0, unloadingShare: 0, otIncome: 0, net: 0, monthsCounted: 0 };
    for (let m = 1; m <= 12; m++) {
      const ym = `${selectedYear}-${String(m).padStart(2, '0')}`;
      if (ym > CURRENT_MONTH) continue;
      if (emp.hireDate && ym < emp.hireDate.slice(0, 7)) continue;
      const calc = calcMonthlyIncome(emp, ym, ctx);
      totals.base += calc.base; totals.daysWorked += calc.daysWorked; totals.deductLeave += calc.deductLeave; totals.advanceDeduction += calc.advanceDeduction;
      totals.ssoDeduction += calc.ssoDeduction; totals.resignationDepositDeduction += calc.resignationDepositDeduction; totals.unloadingShare += calc.unloadingShare; totals.otIncome += calc.otIncome; totals.net += calc.net;
      totals.monthsCounted += 1;
    }
    return { emp, tenure, ...totals };
  });

  const grandTotalNet = rows.reduce((sum: number, r: any) => sum + r.net, 0);
  const periodLabel = mode === 'month'
    ? `${YEAR_MONTH_NAMES_TH[parseInt(selectedMonth.split('-')[1], 10) - 1]} ${parseInt(selectedMonth.split('-')[0], 10) + 543}`
    : `ปี ${parseInt(selectedYear, 10) + 543}`;

  return (
    <Card>
      <div className="p-5 border-b border-slate-100 flex flex-wrap gap-3 justify-between items-center bg-slate-50">
        <h3 className="font-bold text-slate-800 flex items-center gap-2"><BarChart3 className="w-5 h-5" /> สรุปรายได้และอายุงานพนักงาน</h3>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex bg-slate-200 rounded-lg p-1">
            <button onClick={() => setMode('month')} className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${mode === 'month' ? 'bg-white shadow-sm text-teal-700' : 'text-slate-500'}`}>รายเดือน</button>
            <button onClick={() => setMode('year')} className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${mode === 'year' ? 'bg-white shadow-sm text-teal-700' : 'text-slate-500'}`}>รายปี</button>
          </div>
          {mode === 'month' ? (
            <input type="month" value={selectedMonth} onChange={(e) => setSelectedMonth(e.target.value)} className="border border-slate-300 rounded-lg p-2 text-sm outline-none focus:border-teal-500 bg-white" />
          ) : (
            <input type="number" value={selectedYear} onChange={(e) => setSelectedYear(e.target.value)} className="w-24 border border-slate-300 rounded-lg p-2 text-sm outline-none focus:border-teal-500 bg-white" />
          )}
        </div>
      </div>

      <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="bg-teal-50 border border-teal-100 rounded-xl p-4">
          <p className="text-xs font-medium text-teal-700 mb-1">รวมยอดรับสุทธิของพนักงานทั้งหมด ({periodLabel})</p>
          <p className="text-2xl font-bold text-slate-800">฿{grandTotalNet.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
        </div>
        <div className="bg-slate-50 border border-slate-100 rounded-xl p-4">
          <p className="text-xs font-medium text-slate-500 mb-1">จำนวนพนักงานในรายงาน</p>
          <p className="text-2xl font-bold text-slate-800">{employees.length} คน</p>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm whitespace-nowrap">
          <thead className="bg-slate-100 text-slate-600">
            <tr>
              <th className="p-4 font-medium">พนักงาน</th>
              <th className="p-4 font-medium">วันเริ่มงาน</th>
              <th className="p-4 font-medium">อายุงาน (โดยละเอียด)</th>
              <th className="p-4 text-right font-medium">ฐานเงินเดือนรวม</th>
              <th className="p-4 text-right font-medium text-red-600">หักลากิจ</th>
              <th className="p-4 text-right font-medium text-red-600">เบิกล่วงหน้า</th>
              <th className="p-4 text-right font-medium text-red-600">ประกันสังคม</th>
              <th className="p-4 text-right font-medium text-red-600">ค่าประกันลาออก</th>
              <th className="p-4 text-right font-medium text-teal-600">ค่าลงของ</th>
              <th className="p-4 text-right font-medium text-teal-600">OT ที่อนุมัติ</th>
              <th className="p-4 text-right font-medium text-slate-900">รับสุทธิ{mode === 'year' ? ' (รวมทั้งปี)' : ''}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r: any) => (
              <tr key={r.emp.id} className="hover:bg-slate-50">
                <td className="p-4 font-medium text-slate-900">{r.emp.name}</td>
                <td className="p-4 text-slate-600">{formatDateDMY(r.emp.hireDate)}</td>
                <td className="p-4">{r.tenure ? formatTenure(r.tenure, true) : <span className="text-xs text-slate-400">ไม่ระบุวันเริ่มงาน</span>}</td>
                <td className="p-4 text-right">
                  ฿{r.base.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  {r.emp.type === 'DAILY' && <span className="block text-[11px] text-slate-400 mt-0.5">รายวัน · {r.daysWorked} วัน</span>}
                </td>
                <td className="p-4 text-right text-red-500">{r.deductLeave > 0 ? `-฿${r.deductLeave.toLocaleString(undefined, { maximumFractionDigits: 2 })}` : '-'}</td>
                <td className="p-4 text-right text-red-500">{r.advanceDeduction > 0 ? `-฿${r.advanceDeduction.toLocaleString()}` : '-'}</td>
                <td className="p-4 text-right text-red-500">{r.ssoDeduction > 0 ? `-฿${r.ssoDeduction.toLocaleString(undefined, { maximumFractionDigits: 2 })}` : '-'}</td>
                <td className="p-4 text-right text-red-500">{r.resignationDepositDeduction > 0 ? `-฿${r.resignationDepositDeduction.toLocaleString(undefined, { maximumFractionDigits: 2 })}` : '-'}</td>
                <td className="p-4 text-right text-teal-600">{r.unloadingShare > 0 ? `+฿${r.unloadingShare.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '-'}</td>
                <td className="p-4 text-right text-teal-600">{r.otIncome > 0 ? `+฿${r.otIncome.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '-'}</td>
                <td className="p-4 text-right font-bold text-slate-900 border-l border-slate-100">฿{r.net.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={11} className="p-8 text-center text-slate-400">ยังไม่มีข้อมูลพนักงาน</td></tr>}
          </tbody>
        </table>
      </div>
    </Card>
  );
};

const PayrollSummaryModal = ({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) => {
  const { employees, leaves, advances, resignationDeposits, overtimeRecords, attendanceLogs, unloadingLogs, calculateDailyUnloadingPool, getEmployeeUnloadingTotal, CURRENT_MONTH, companySettings } = useContext(AppContext);
  if (!isOpen) return null;

  const fmt = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const dash = (n: number, sign = '') => (n > 0 ? `${sign}${fmt(n)}` : '-');
  const ctx = { leaves, advances, resignationDeposits, overtime: overtimeRecords, attendanceLogs, getEmployeeUnloadingTotal };
  const rows = employees
    .filter((e: any) => !(e.hireDate && CURRENT_MONTH < e.hireDate.slice(0, 7)))
    .map((e: any) => ({ emp: e, ...calcMonthlyIncome(e, CURRENT_MONTH, ctx) }));
  const sum = (key: string) => rows.reduce((s: number, r: any) => s + (r[key] || 0), 0);
  const totalDeduct = rows.reduce((s: number, r: any) => s + r.deductLeave + r.advanceDeduction + r.ssoDeduction + r.resignationDepositDeduction, 0);

  // Daily-wage employees: income per day = day rate + unloading share of that day + approved OT of that day
  const dailyEmps = rows.filter((r: any) => r.emp.type === 'DAILY' && r.daysWorked > 0).map((r: any) => r.emp);
  const unloadingByDate: Record<string, Record<number, number>> = {};
  (unloadingLogs || []).filter((l: any) => (l.date || '').startsWith(CURRENT_MONTH)).forEach((l: any) => {
    const map: Record<number, number> = {};
    (calculateDailyUnloadingPool(l.date, l.bags).distribution || []).forEach((d: any) => { map[d.empId] = d.share; });
    unloadingByDate[l.date] = map;
  });
  const workedOn = (empId: number, date: string) => (attendanceLogs || []).some((l: any) => l.empId === empId && l.type === 'IN' && l.date === date);
  const dates = Array.from(new Set<string>(
    (attendanceLogs || []).filter((l: any) => l.type === 'IN' && (l.date || '').startsWith(CURRENT_MONTH) && dailyEmps.some((e: any) => e.id === l.empId)).map((l: any) => l.date)
  )).sort();
  const dayIncome = (emp: any, date: string) => {
    if (!workedOn(emp.id, date)) return null;
    const ot = (overtimeRecords || []).filter((o: any) => o.empId === emp.id && o.status === 'APPROVED' && o.date === date).reduce((s: number, o: any) => s + (o.amount || 0), 0);
    return (emp.salary || 0) + (unloadingByDate[date]?.[emp.id] || 0) + ot;
  };
  const dateTotals = dates.map((d) => dailyEmps.reduce((s: number, e: any) => s + (dayIncome(e, d) || 0), 0));
  const empTotals = dailyEmps.map((e: any) => dates.reduce((s: number, d) => s + (dayIncome(e, d) || 0), 0));
  const fmtDate = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
  const th = 'p-2 text-right font-medium';

  return createPortal(
    <div id="summary-modal" className="fixed inset-0 bg-slate-900/40 flex items-center justify-center z-[100] p-4 print:static print:block print:p-0 print:bg-white">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-6xl max-h-[92vh] flex flex-col overflow-hidden print:max-h-none print:overflow-visible print:shadow-none print:max-w-none">
        <div id="summary-printable" className="overflow-auto p-6 space-y-6">
          <div className="text-center">
            <h3 className="font-bold text-lg text-slate-800">{companySettings?.name || 'หจก.ธีรัตม์อาหารสัตว์'}</h3>
            <p className="text-slate-600 text-sm">สรุปเงินเดือนพนักงานทุกคน (หักค่าใช้จ่ายทุกอย่าง) - งวด {formatMonthTH(CURRENT_MONTH)}</p>
            <p className="text-slate-400 text-xs">พิมพ์เมื่อ {new Date().toLocaleString('th-TH')}</p>
          </div>

          <div>
            <h4 className="font-bold text-slate-800 mb-2">1) สรุปเงินเดือนรายคน</h4>
            <div className="overflow-x-auto">
              <table className="w-full text-xs whitespace-nowrap border border-slate-200">
                <thead className="bg-slate-100 text-slate-600">
                  <tr>
                    <th className="p-2 text-left font-medium">พนักงาน</th><th className={th}>ฐานเงินเดือน/ค่าแรง</th>
                    <th className={th}>+ค่าลงของ</th><th className={th}>+OT</th>
                    <th className={th}>-หักลา</th><th className={th}>-เบิกล่วงหน้า</th>
                    <th className={th}>-ประกันสังคม</th><th className={th}>-เงินประกันลาออก</th>
                    <th className={th}>รวมหัก</th><th className={`${th} font-bold text-slate-900`}>รับสุทธิ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map((r: any) => (
                    <tr key={r.emp.id}>
                      <td className="p-2">{r.emp.name}<span className="text-slate-400"> {r.emp.type === 'DAILY' ? `(รายวัน ${r.daysWorked} วัน)` : '(รายเดือน)'}</span></td>
                      <td className="p-2 text-right">{fmt(r.base)}</td>
                      <td className="p-2 text-right">{dash(r.unloadingShare, '+')}</td>
                      <td className="p-2 text-right">{dash(r.otIncome, '+')}</td>
                      <td className="p-2 text-right">{dash(r.deductLeave, '-')}</td>
                      <td className="p-2 text-right">{dash(r.advanceDeduction, '-')}</td>
                      <td className="p-2 text-right">{dash(r.ssoDeduction, '-')}</td>
                      <td className="p-2 text-right">{dash(r.resignationDepositDeduction, '-')}</td>
                      <td className="p-2 text-right text-red-600">{dash(r.deductLeave + r.advanceDeduction + r.ssoDeduction + r.resignationDepositDeduction, '-')}</td>
                      <td className="p-2 text-right font-bold">{fmt(r.net)}</td>
                    </tr>
                  ))}
                  <tr className="bg-slate-50 font-bold">
                    <td className="p-2">รวมทุกคน ({rows.length} คน)</td>
                    <td className="p-2 text-right">{fmt(sum('base'))}</td>
                    <td className="p-2 text-right">{fmt(sum('unloadingShare'))}</td>
                    <td className="p-2 text-right">{fmt(sum('otIncome'))}</td>
                    <td className="p-2 text-right">{fmt(sum('deductLeave'))}</td>
                    <td className="p-2 text-right">{fmt(sum('advanceDeduction'))}</td>
                    <td className="p-2 text-right">{fmt(sum('ssoDeduction'))}</td>
                    <td className="p-2 text-right">{fmt(sum('resignationDepositDeduction'))}</td>
                    <td className="p-2 text-right text-red-600">{fmt(totalDeduct)}</td>
                    <td className="p-2 text-right text-indigo-700">{fmt(sum('net'))}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <div>
            <h4 className="font-bold text-slate-800 mb-1">2) สรุปรายได้รายวัน - พนักงานรายวัน</h4>
            <p className="text-xs text-slate-500 mb-2">รายได้ต่อวัน = ค่าแรงรายวัน + ส่วนแบ่งค่าลงของ + OT ที่อนุมัติของวันนั้น (ก่อนหักรายการหักประจำเดือน)</p>
            {dailyEmps.length === 0 || dates.length === 0 ? (
              <p className="text-sm text-slate-400 py-4 text-center border border-dashed rounded-lg">ยังไม่มีข้อมูลการทำงานของพนักงานรายวันในเดือนนี้</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs whitespace-nowrap border border-slate-200">
                  <thead className="bg-slate-100 text-slate-600">
                    <tr>
                      <th className="p-2 text-left font-medium">วันที่</th>
                      {dailyEmps.map((e: any) => <th key={e.id} className={th}>{e.name}<span className="block text-[10px] text-slate-400 font-normal">฿{(e.salary || 0).toLocaleString()}/วัน</span></th>)}
                      <th className={`${th} font-bold text-slate-900`}>รวมต่อวัน</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {dates.map((d, i) => (
                      <tr key={d}>
                        <td className="p-2">{fmtDate(d)}</td>
                        {dailyEmps.map((e: any) => { const v = dayIncome(e, d); return <td key={e.id} className="p-2 text-right">{v === null ? '-' : fmt(v)}</td>; })}
                        <td className="p-2 text-right font-bold">{fmt(dateTotals[i])}</td>
                      </tr>
                    ))}
                    <tr className="bg-slate-50 font-bold">
                      <td className="p-2">รวมเดือนนี้</td>
                      {empTotals.map((t, i) => <td key={dailyEmps[i].id} className="p-2 text-right">{fmt(t)}</td>)}
                      <td className="p-2 text-right text-indigo-700">{fmt(empTotals.reduce((a, b) => a + b, 0))}</td>
                    </tr>
                    <tr className="bg-slate-50">
                      <td className="p-2 text-slate-500">วันทำงาน</td>
                      {dailyEmps.map((e: any) => <td key={e.id} className="p-2 text-right text-slate-500">{rows.find((r: any) => r.emp.id === e.id)?.daysWorked} วัน</td>)}
                      <td className="p-2"></td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
        <div className="p-4 border-t border-slate-100 flex justify-end gap-3 bg-slate-50 no-print">
          <Button variant="secondary" onClick={onClose}>ปิดหน้าต่าง</Button>
          <Button variant="primary" onClick={() => window.print()}><Printer className="w-4 h-4" /> พิมพ์ / บันทึกเป็น PDF</Button>
        </div>
      </div>
    </div>,
    document.body
  );
};

const ViewPayroll = () => {
  const { employees, leaves, getEmployeeUnloadingTotal, advances, resignationDeposits, attendanceLogs, currentUser, CURRENT_MONTH, overtimeRecords } = useContext(AppContext);
  const [payslipEmp, setPayslipEmp] = useState<any>(null);
  const [summaryOpen, setSummaryOpen] = useState(false);

  if (!currentUser.roles.some((r: string) => ['OWNER', 'PAYROLL_OFFICER'].includes(r))) return <div className="p-8 text-center text-red-500 font-bold bg-white rounded-xl shadow-sm border border-red-200">ไม่มีสิทธิ์เข้าถึงข้อมูลเงินเดือน</div>;

  const cumCtx = { leaves, advances, resignationDeposits, overtime: overtimeRecords, attendanceLogs, getEmployeeUnloadingTotal };
  const cumulativeOf = (emp: any) => {
    const skip = emp.hireDate && CURRENT_MONTH < emp.hireDate.slice(0, 7);
    return { total: skip ? 0 : calcMonthlyIncome(emp, CURRENT_MONTH, cumCtx)?.net || 0 };
  };
  const today = new Date();
  const isOpenMonth = CURRENT_MONTH === `${today.getFullYear()}-${pad2(today.getMonth() + 1)}`;
  // Projected full-month net for a DAILY employee: wage x projected working days; deductions, OT and unloading stay actual.
  const projectDailyNet = (emp: any): number | null => {
    const skip = emp.hireDate && CURRENT_MONTH < emp.hireDate.slice(0, 7);
    if (skip) return null;
    const actual = calcMonthlyIncome(emp, CURRENT_MONTH, cumCtx);
    if (!actual || actual.daysWorked <= 0) return null;
    const [y, m] = CURRENT_MONTH.split('-').map(Number);
    const daysInMonth = new Date(y, m, 0).getDate();
    const elapsed = isOpenMonth ? Math.max(1, Math.min(today.getDate(), daysInMonth)) : daysInMonth;
    const projectedDays = Math.round((actual.daysWorked / elapsed) * daysInMonth);
    return actual.net + (emp.salary || 0) * (projectedDays - actual.daysWorked);
  };
  const fmtMoney = (n: number) => `฿${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const cumulativeGrandTotal = employees.reduce((sum: number, e: any) => sum + cumulativeOf(e).total, 0);
  const projectedGrandTotal = employees.reduce((sum: number, e: any) => {
    const actual = cumulativeOf(e).total;
    if (e.type !== 'DAILY' || !isOpenMonth) return sum + actual;
    return sum + (projectDailyNet(e) ?? actual);
  }, 0);

  return (
    <div className="space-y-6">
    <AdvanceSection />
    <ResignationDepositSection />
    <Card>
      <div className="p-5 border-b border-slate-100 flex justify-between items-center bg-slate-50">
        <h3 className="font-bold text-slate-800 flex items-center gap-2"><Calculator className="w-5 h-5" /> ประมวลผลเงินเดือน (งวด {formatMonthTH(CURRENT_MONTH)})</h3>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setSummaryOpen(true)}><Printer className="w-4 h-4" /> สรุปเงินเดือนทุกคน / พิมพ์</Button>
          <Button variant="primary">ส่งอนุมัติ</Button>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm whitespace-nowrap">
          <thead className="bg-slate-100 text-slate-600">
            <tr>
              <th className="p-4 font-medium">พนักงาน</th><th className="p-4 text-right">ฐานเงินเดือน</th>
              <th className="p-4 text-right text-red-600">หักลากิจ</th><th className="p-4 text-right text-red-600">เบิกล่วงหน้า</th>
              <th className="p-4 text-right text-red-600">ประกันสังคม</th><th className="p-4 text-right text-red-600">ค่าประกันลาออก</th>
              <th className="p-4 text-right text-teal-600">บวกค่าลงของ</th><th className="p-4 text-right font-bold text-slate-900">รับสุทธิ</th>
              <th className="p-4 text-right font-bold text-indigo-700">ยอดสะสม ({formatMonthTH(CURRENT_MONTH)})</th>
              <th className="p-4 text-center">สลิปเงินเดือน</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {employees.map((emp: any) => {
              const daysWorked = emp.type === 'DAILY' ? countWorkDaysInMonth(emp.id, CURRENT_MONTH, attendanceLogs) : 0;
              const base = emp.type === 'DAILY' ? (emp.salary || 0) * daysWorked : (emp.salary || 0);
              const unpaidDays = leaves.filter((l: any) => l.empId === emp.id && l.status === 'APPROVED' && l.type.includes('UNPAID') && (l.date || '').startsWith(CURRENT_MONTH)).reduce((sum: number, l: any) => sum + (l.duration || 1), 0);
              const deductLeave = emp.type !== 'DAILY' && unpaidDays > 0 ? (base / countMonSatDays(CURRENT_MONTH)) * unpaidDays : 0;
              const advance = advances.filter((a: any) => a.empId === emp.id && a.status === 'APPROVED' && (a.deductionMonth || (a.date || '').slice(0, 7)) === CURRENT_MONTH).reduce((sum: number, a: any) => sum + a.amount, 0);
              const unloadingShare = getEmployeeUnloadingTotal(emp.id, CURRENT_MONTH);
              const ssoDeduction = emp.hasSocialSecurity ? Math.min(base * 0.05, 750) : 0;
              const resignationDeposit = resignationDeposits.filter((d: any) => d.empId === emp.id && d.deductionMonth === CURRENT_MONTH).reduce((sum: number, d: any) => sum + d.amount, 0);
              const net = base - deductLeave - advance - ssoDeduction - resignationDeposit + unloadingShare;
              const cum = cumulativeOf(emp);
              const projected = emp.type === 'DAILY' && isOpenMonth ? projectDailyNet(emp) : null;

              return (
                <tr key={emp.id} className="hover:bg-slate-50">
                  <td className="p-4 font-medium">{emp.name} {emp.hasSocialSecurity && <span className="text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded ml-2">สปส.</span>}</td>
                  <td className="p-4 text-right">
                    ฿{base.toLocaleString()}
                    {emp.type === 'DAILY' && <span className="block text-[11px] text-slate-400 mt-0.5">รายวัน · {daysWorked} วัน</span>}
                  </td>
                  <td className="p-4 text-right text-red-500">{deductLeave > 0 ? `-฿${deductLeave.toLocaleString(undefined, { maximumFractionDigits: 2 })}` : '-'}</td>
                  <td className="p-4 text-right text-red-500">{advance > 0 ? `-฿${advance.toLocaleString()}` : '-'}</td>
                  <td className="p-4 text-right text-red-500">{ssoDeduction > 0 ? `-฿${ssoDeduction.toLocaleString()}` : '-'}</td>
                  <td className="p-4 text-right text-red-500">{resignationDeposit > 0 ? `-฿${resignationDeposit.toLocaleString()}` : '-'}</td>
                  <td className="p-4 text-right text-teal-600">{unloadingShare > 0 ? `+฿${unloadingShare.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '-'}</td>
                  <td className="p-4 text-right font-bold text-slate-900 border-l border-slate-100">฿{net.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                  <td className="p-4 text-right font-bold text-indigo-700">
                    {fmtMoney(cum.total)}
                    <span className="block text-[11px] font-normal text-slate-400 mt-0.5">เฉพาะเดือน {formatMonthTH(CURRENT_MONTH)}</span>
                    {emp.type === 'DAILY' && (isOpenMonth ? (
                      <>
                        <span className="inline-block text-[10px] font-medium bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded mt-1">ยอดถึงวันนี้ (ยังไม่ปิดเดือน)</span>
                        <span className="block text-[11px] font-normal text-slate-500 mt-0.5" title="คาดการณ์จากอัตราการมาทำงานถึงวันนี้ อาจเปลี่ยนแปลงได้">
                          {projected === null ? '-' : `คาดการณ์ทั้งเดือน ≈ ${fmtMoney(projected)}`}
                        </span>
                      </>
                    ) : (
                      <span className="inline-block text-[10px] font-medium bg-green-100 text-green-700 px-1.5 py-0.5 rounded mt-1">ปิดยอดแล้ว</span>
                    ))}
                  </td>
                  <td className="p-4 text-center">
                    <button onClick={() => setPayslipEmp(emp)} title="พิมพ์ / ส่งออก PDF สลิปเงินเดือน" className="p-2 bg-slate-100 hover:bg-teal-100 text-slate-600 hover:text-teal-600 rounded-lg transition-colors inline-flex">
                      <Printer className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              );
            })}
            {employees.length > 0 && (
              <tr className="bg-slate-50 font-bold">
                <td className="p-4 text-right text-slate-700" colSpan={8}>รวมยอดสะสมทุกคน ({formatMonthTH(CURRENT_MONTH)})</td>
                <td className="p-4 text-right text-indigo-700">
                  {fmtMoney(cumulativeGrandTotal)}
                  {isOpenMonth && <span className="block text-[11px] font-normal text-slate-500 mt-0.5" title="คาดการณ์จากอัตราการมาทำงานถึงวันนี้ อาจเปลี่ยนแปลงได้">รวมคาดการณ์ทั้งเดือน ≈ {fmtMoney(projectedGrandTotal)}</span>}
                </td>
                <td className="p-4"></td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Card>
    <IncomeSummarySection />
    <PayrollSummaryModal isOpen={summaryOpen} onClose={() => setSummaryOpen(false)} />
    <PayslipModal isOpen={!!payslipEmp} onClose={() => setPayslipEmp(null)} emp={payslipEmp} CURRENT_MONTH={CURRENT_MONTH} advances={advances} leaves={leaves} getEmployeeUnloadingTotal={getEmployeeUnloadingTotal} />
    </div>
  );
};

const isFuelOrMaintCategory = (cat: string) => (cat || '').includes('น้ำมัน') || (cat || '').includes('ซ่อมบำรุง');

const ViewExpenses = () => {
  const { expenses, saveExpense, deleteExpense, expenseCategories, saveCategory, deleteCategory, vehicles, setCurrentView, TODAY_DATE } = useContext(AppContext);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isCategoryModalOpen, setIsCategoryModalOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [editId, setEditId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  const [formData, setFormData] = useState<any>({ date: TODAY_DATE, category: expenseCategories[0]?.name || 'ค่าใช้จ่ายอื่นๆ', description: '', amount: '', vehicle: '' });
  const [catFormData, setCatFormData] = useState<any>({ id: null, name: '' });

  const activeVehicles = vehicles.filter((v: any) => v.isActive !== false);
  const isVehicleRequired = isFuelOrMaintCategory(formData.category);

  const handleSave = async () => {
    if (!formData.date || !formData.amount || !formData.category) return;
    if (isVehicleRequired && !formData.vehicle) {
      toast({ title: 'กรุณาเลือกทะเบียนรถ', description: 'หมวดค่าน้ำมันรถและค่าซ่อมบำรุงรถต้องระบุทะเบียนรถที่ใช้งาน เพื่อเก็บประวัติแยกคัน', variant: 'destructive' });
      return;
    }
    setSaving(true);
    const ok = await saveExpense({ id: editId || undefined, ...formData, amount: Number(formData.amount) });
    setSaving(false);
    if (ok) { toast({ title: 'บันทึกค่าใช้จ่ายสำเร็จ' }); setIsModalOpen(false); setEditId(null); }
  };

  const handleEdit = (exp: any) => {
    setFormData({ date: exp.date, category: exp.category, description: exp.description, amount: exp.amount, vehicle: exp.vehicle || '' });
    setEditId(exp.id);
    setIsModalOpen(true);
  };

  const handleSaveCategory = async () => {
    if (!catFormData.name.trim()) return;
    const ok = await saveCategory(catFormData);
    if (ok) setCatFormData({ id: null, name: '' });
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="p-5 border-l-4 border-l-red-500 bg-red-50/50">
          <p className="text-sm font-medium text-red-600 mb-1">รวมค่าใช้จ่ายทั้งหมด (เดือนนี้)</p>
          <h3 className="text-3xl font-bold text-slate-800">฿{expenses.reduce((sum: number, exp: any) => sum + exp.amount, 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</h3>
        </Card>
      </div>

      <Card>
        <div className="p-5 border-b border-slate-100 flex flex-wrap gap-3 justify-between items-center bg-slate-50">
          <h3 className="font-bold text-slate-800 flex items-center gap-2"><Wallet className="w-5 h-5" /> บันทึกค่าใช้จ่าย</h3>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setCurrentView('fleet')}><Truck className="w-4 h-4" /> จัดการรถส่งของ</Button>
            <Button variant="outline" onClick={() => setIsCategoryModalOpen(true)}><Settings className="w-4 h-4" /> จัดการหมวดหมู่</Button>
            <Button onClick={() => { setEditId(null); setFormData({ date: TODAY_DATE, category: expenseCategories[0]?.name || 'ค่าใช้จ่ายอื่นๆ', description: '', amount: '', vehicle: '' }); setIsModalOpen(true); }}><Plus className="w-4 h-4" /> เพิ่มค่าใช้จ่าย</Button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm whitespace-nowrap">
            <thead className="bg-slate-100 text-slate-600"><tr><th className="p-4 font-medium">วันที่</th><th className="p-4 font-medium">หมวดหมู่</th><th className="p-4 font-medium">รายละเอียด / ทะเบียนรถ</th><th className="p-4 font-medium text-right">ยอดเงิน (บาท)</th><th className="p-4 font-medium text-center">จัดการ</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {expenses.length === 0 ? <tr><td colSpan={5} className="p-8 text-center text-slate-400">ยังไม่มีข้อมูลค่าใช้จ่าย</td></tr> : (
                expenses.map((exp: any) => (
                  <tr key={exp.id} className="hover:bg-slate-50">
                    <td className="p-4 text-slate-600">{formatDateDMY(exp.date)}</td>
                    <td className="p-4"><Badge type="info">{exp.category}</Badge></td>
                    <td className="p-4 font-medium text-slate-800">
                      {exp.vehicle && <span className="text-teal-600 mr-2">[{exp.vehicle}]</span>}
                      {exp.description || '-'}
                    </td>
                    <td className="p-4 text-right font-bold text-red-600">฿{exp.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                    <td className="p-4 text-center">
                      <button onClick={() => handleEdit(exp)} className="p-2 bg-slate-100 hover:bg-teal-100 text-slate-600 hover:text-teal-600 rounded-lg transition-colors mr-2"><Edit className="w-4 h-4" /></button>
                      <button onClick={() => setDeleteId(exp.id)} className="p-2 bg-slate-100 hover:bg-red-100 text-slate-600 hover:text-red-600 rounded-lg transition-colors"><Trash2 className="w-4 h-4" /></button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {isModalOpen && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-[100] p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            <div className="p-5 border-b border-slate-100 flex justify-between items-center bg-slate-50">
              <h3 className="font-bold text-slate-800">{editId ? 'แก้ไขรายการค่าใช้จ่าย' : 'เพิ่มค่าใช้จ่ายใหม่'}</h3>
              <button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-5 space-y-4">
              <div><label className="block text-sm font-medium text-slate-700 mb-1">วันที่</label><input type="date" value={formData.date} onChange={(e) => setFormData({ ...formData, date: e.target.value })} className="w-full border border-slate-300 focus:border-teal-500 p-2.5 rounded-lg text-sm outline-none" /></div>
              <div><label className="block text-sm font-medium text-slate-700 mb-1">หมวดหมู่ตามบัญชี</label><select value={formData.category} onChange={(e) => setFormData({ ...formData, category: e.target.value, vehicle: '' })} className="w-full border border-slate-300 focus:border-teal-500 p-2.5 rounded-lg text-sm outline-none">{expenseCategories.map((cat: any) => <option key={cat.id} value={cat.name}>{cat.name}</option>)}</select></div>

              {isVehicleRequired && (
                <div className="p-3 bg-teal-50 border border-teal-100 rounded-lg">
                  <label className="block text-sm font-medium text-teal-800 mb-1">เลือกทะเบียนรถ <span className="text-red-500">*</span></label>
                  <select value={formData.vehicle} onChange={(e) => setFormData({ ...formData, vehicle: e.target.value })} className="w-full border border-teal-200 focus:border-teal-500 p-2.5 rounded-lg text-sm outline-none bg-white">
                    <option value="">-- กรุณาเลือกรถ --</option>
                    {activeVehicles.map((v: any) => <option key={v.id} value={v.name}>{v.plate} - {v.name}</option>)}
                  </select>
                  {activeVehicles.length === 0 && <p className="text-xs text-red-500 mt-1.5">ยังไม่มีรถที่เปิดใช้งาน กรุณาเพิ่มรถในเมนู "รถส่งของ" ก่อน</p>}
                </div>
              )}

              <div><label className="block text-sm font-medium text-slate-700 mb-1">รายละเอียดเพิ่มเติม</label><input type="text" placeholder="เช่น บิลเดือน ก.ย. หรือ เปลี่ยนถ่ายน้ำมันเครื่อง" value={formData.description} onChange={(e) => setFormData({ ...formData, description: e.target.value })} className="w-full border border-slate-300 focus:border-teal-500 p-2.5 rounded-lg text-sm outline-none" /></div>
              <div><label className="block text-sm font-medium text-slate-700 mb-1">ยอดเงิน (บาท)</label><input type="number" placeholder="0.00" value={formData.amount} onChange={(e) => setFormData({ ...formData, amount: e.target.value })} className="w-full border border-slate-300 focus:border-teal-500 p-2.5 rounded-lg text-sm outline-none" /></div>
              <div className="pt-4 flex justify-end gap-3"><Button variant="secondary" onClick={() => setIsModalOpen(false)}>ยกเลิก</Button><Button variant="primary" onClick={handleSave} disabled={!formData.date || !formData.amount || (isVehicleRequired && !formData.vehicle) || saving}>{saving && <Loader2 className="w-4 h-4 animate-spin" />} บันทึกข้อมูล</Button></div>
            </div>
          </div>
        </div>
      )}

      {deleteId !== null && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-[100] p-4">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-sm text-center">
            <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4"><Trash2 className="w-8 h-8 text-red-500" /></div>
            <h3 className="font-bold text-lg text-slate-800 mb-2">ยืนยันการลบ?</h3>
            <div className="flex justify-center gap-3"><Button variant="secondary" onClick={() => setDeleteId(null)}>ยกเลิก</Button><Button variant="danger" onClick={async () => { const ok = await deleteExpense(deleteId); if (ok) toast({ title: 'ลบรายการแล้ว' }); setDeleteId(null); }}>ลบรายการ</Button></div>
          </div>
        </div>
      )}

      {isCategoryModalOpen && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-[100] p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            <div className="p-5 border-b border-slate-100 flex justify-between items-center bg-slate-50">
              <h3 className="font-bold text-slate-800 flex items-center gap-2"><Settings className="w-5 h-5" /> จัดการหมวดหมู่ค่าใช้จ่าย</h3>
              <button onClick={() => setIsCategoryModalOpen(false)} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-5">
              <div className="flex gap-2 mb-4">
                <input type="text" placeholder="พิมพ์ชื่อหมวดหมู่ใหม่..." value={catFormData.name} onChange={(e) => setCatFormData({ ...catFormData, name: e.target.value })} className="flex-1 border border-slate-300 focus:border-teal-500 p-2 rounded-lg text-sm outline-none" />
                <Button onClick={handleSaveCategory}>{catFormData.id ? 'บันทึก' : 'เพิ่ม'}</Button>
              </div>
              <div className="max-h-60 overflow-y-auto border rounded-lg border-slate-200">
                <table className="w-full text-left text-sm">
                  <tbody className="divide-y divide-slate-100">
                    {expenseCategories.map((cat: any) => (
                      <tr key={cat.id} className="hover:bg-slate-50">
                        <td className="p-3 font-medium text-slate-800">{cat.name}</td>
                        <td className="p-3 text-right w-24">
                          <button onClick={() => setCatFormData({ id: cat.id, name: cat.name })} className="p-1.5 text-slate-400 hover:text-teal-600 rounded"><Edit className="w-4 h-4" /></button>
                          <button onClick={() => deleteCategory(cat.id)} className="p-1.5 text-slate-400 hover:text-red-600 rounded"><Trash2 className="w-4 h-4" /></button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="p-4 border-t border-slate-100 flex justify-end bg-slate-50"><Button variant="secondary" onClick={() => setIsCategoryModalOpen(false)}>ปิดหน้าต่าง</Button></div>
          </div>
        </div>
      )}
    </div>
  );
};

// ---- Fleet management helpers ----
const getRealMonth = () => new Date().toISOString().slice(0, 7);
const shiftMonth = (ym: string, delta: number) => {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};
const MONTH_NAMES_TH = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
const formatMonthTH = (ym: string) => {
  const [y, m] = ym.split('-').map(Number);
  return `${MONTH_NAMES_TH[m - 1]} ${y + 543}`;
};
const daysUntil = (dateStr: string) => {
  if (!dateStr) return null;
  const target = new Date(dateStr + 'T00:00:00');
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86400000);
};
const isFuelCategory = (cat: string) => (cat || '').includes('น้ำมัน');
const isMaintCategory = (cat: string) => (cat || '').includes('ซ่อมบำรุง');

const RenewalBadge = ({ expiry }: { expiry: string }) => {
  if (!expiry) return <Badge type="default">ยังไม่ระบุ</Badge>;
  const days = daysUntil(expiry) as number;
  if (days < 0) return <Badge type="danger">หมดอายุแล้ว {Math.abs(days)} วัน</Badge>;
  if (days <= 30) return <Badge type="warning">เหลืออีก {days} วัน</Badge>;
  return <Badge type="success">เหลืออีก {days} วัน</Badge>;
};

const RenewalSection = ({ title, icon, company, date, expiry, cost, showCompany = true, showDate = true }: any) => (
  <div className="p-3 rounded-lg border border-slate-100 bg-slate-50 flex flex-col gap-1.5">
    <span className="text-xs font-bold text-slate-600 flex items-center gap-1">{icon} {title}</span>
    <RenewalBadge expiry={expiry} />
    <div className="text-xs text-slate-500 space-y-0.5 mt-1">
      {showCompany && <p>บริษัท: <span className="text-slate-700 font-medium">{company || '-'}</span></p>}
      {showDate && <p>วันที่ทำ: {formatDateDMY(date)}</p>}
      <p>วันหมดอายุ: <span className="font-medium text-slate-700">{formatDateDMY(expiry)}</span></p>
      {Number(cost) > 0 && <p>ค่าใช้จ่าย: ฿{Number(cost).toLocaleString()}</p>}
    </div>
  </div>
);

const TrendIndicator = ({ current, previous }: { current: number; previous: number }) => {
  const diff = Math.round((current - previous) * 100) / 100;
  if (diff === 0) return <span className="text-xs text-slate-400 flex items-center gap-1"><Minus className="w-3 h-3" /> เท่าเดือนที่แล้ว</span>;
  const up = diff > 0;
  return (
    <span className={`text-xs font-semibold flex items-center gap-1 ${up ? 'text-red-600' : 'text-emerald-600'}`}>
      {up ? <ArrowUpRight className="w-3.5 h-3.5" /> : <ArrowDownRight className="w-3.5 h-3.5" />}
      {up ? 'เพิ่ม' : 'ลด'} ฿{Math.abs(diff).toLocaleString(undefined, { maximumFractionDigits: 0 })}
    </span>
  );
};

const FleetAnalysisTab = ({ vehicles, expenses }: any) => {
  const [month, setMonth] = useState(getRealMonth());
  const prevMonth = shiftMonth(month, -1);

  const totalsForMonth = (ym: string, vehicleName?: string) => {
    const rows = expenses.filter((e: any) => (e.date || '').startsWith(ym) && (!vehicleName || e.vehicle === vehicleName));
    const fuel = rows.filter((e: any) => isFuelCategory(e.category)).reduce((s: number, e: any) => s + e.amount, 0);
    const maint = rows.filter((e: any) => isMaintCategory(e.category)).reduce((s: number, e: any) => s + e.amount, 0);
    return { fuel, maint };
  };

  const companyCurrent = totalsForMonth(month);
  const companyPrevious = totalsForMonth(prevMonth);

  return (
    <div className="space-y-6">
      <Card className="p-4 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <div>
          <h3 className="font-bold text-slate-800">วิเคราะห์งบประมาณรถขนส่งรายเดือน</h3>
          <p className="text-sm text-teal-600 font-medium">ข้อมูลประจำเดือน {formatMonthTH(month)}</p>
        </div>
        <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="border border-slate-300 rounded-lg p-2 text-sm outline-none focus:border-teal-500 bg-white" />
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="p-5 border-l-4 border-l-orange-500">
          <p className="text-sm font-medium text-slate-500 mb-1">รวมค่าน้ำมันทุกคัน (เดือนนี้)</p>
          <h3 className="text-2xl font-bold text-slate-800 mb-2">฿{companyCurrent.fuel.toLocaleString(undefined, { minimumFractionDigits: 2 })}</h3>
          <TrendIndicator current={companyCurrent.fuel} previous={companyPrevious.fuel} />
        </Card>
        <Card className="p-5 border-l-4 border-l-purple-500">
          <p className="text-sm font-medium text-slate-500 mb-1">รวมค่าซ่อมบำรุงทุกคัน (เดือนนี้)</p>
          <h3 className="text-2xl font-bold text-slate-800 mb-2">฿{companyCurrent.maint.toLocaleString(undefined, { minimumFractionDigits: 2 })}</h3>
          <TrendIndicator current={companyCurrent.maint} previous={companyPrevious.maint} />
        </Card>
      </div>

      <div>
        <h3 className="font-bold text-slate-800 mb-3">สรุปรายคัน</h3>
        {vehicles.length === 0 ? <Card className="p-8 text-center text-slate-400">ยังไม่มีข้อมูลรถ</Card> : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {vehicles.map((v: any) => {
              const cur = totalsForMonth(month, v.name);
              const prev = totalsForMonth(prevMonth, v.name);
              return (
                <Card key={v.id} className="p-4">
                  <p className="font-bold text-slate-800 mb-3">{v.plate} <span className="text-slate-400 font-normal text-sm">{v.name}</span></p>
                  <div className="space-y-3">
                    <div className="p-2.5 bg-orange-50 rounded-lg border border-orange-100">
                      <div className="flex justify-between items-center mb-1"><span className="text-xs font-medium text-orange-700">ค่าน้ำมัน</span><span className="font-bold text-slate-800">฿{cur.fuel.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span></div>
                      <TrendIndicator current={cur.fuel} previous={prev.fuel} />
                    </div>
                    <div className="p-2.5 bg-purple-50 rounded-lg border border-purple-100">
                      <div className="flex justify-between items-center mb-1"><span className="text-xs font-medium text-purple-700">ค่าซ่อมบำรุง</span><span className="font-bold text-slate-800">฿{cur.maint.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span></div>
                      <TrendIndicator current={cur.maint} previous={prev.maint} />
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

const ViewFleet = () => {
  const { vehicles, saveVehicle, deleteVehicle, expenses, employees } = useContext(AppContext);
  const [tab, setTab] = useState<'list' | 'analysis'>('list');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  const emptyForm = {
    plate: '', name: '', type: '6W', isActive: true, driverName: '',
    insurance: { company: '', date: '', expiry: '', cost: '' },
    act: { company: '', date: '', expiry: '', cost: '' },
    registration: { expiry: '', cost: '' }
  };
  const [formData, setFormData] = useState<any>(emptyForm);

  const driverNames = employees.filter((e: any) => e.dept === 'DRIVER').map((e: any) => e.name);

  const openAdd = () => { setEditId(null); setFormData(emptyForm); setIsModalOpen(true); };
  const openEdit = (v: any) => {
    setEditId(v.id);
    setFormData({
      plate: v.plate, name: v.name, type: v.type, isActive: v.isActive, driverName: v.driverName,
      insurance: { ...v.insurance, cost: v.insurance.cost || '' },
      act: { ...v.act, cost: v.act.cost || '' },
      registration: { ...v.registration, cost: v.registration.cost || '' }
    });
    setIsModalOpen(true);
  };

  const handleSave = async () => {
    if (!formData.plate.trim() || !formData.name.trim()) return;
    setSaving(true);
    const ok = await saveVehicle({ id: editId || undefined, ...formData });
    setSaving(false);
    if (ok) { toast({ title: 'บันทึกข้อมูลรถสำเร็จ' }); setIsModalOpen(false); }
  };

  return (
    <div className="space-y-6">
      <div className="flex gap-2 bg-white p-1.5 rounded-xl border border-slate-200 w-fit">
        <button onClick={() => setTab('list')} className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5 ${tab === 'list' ? 'bg-teal-600 text-white' : 'text-slate-600 hover:bg-slate-100'}`}><Truck className="w-4 h-4" /> รายการรถ</button>
        <button onClick={() => setTab('analysis')} className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5 ${tab === 'analysis' ? 'bg-teal-600 text-white' : 'text-slate-600 hover:bg-slate-100'}`}><BarChart3 className="w-4 h-4" /> วิเคราะห์งบเดือน</button>
      </div>

      {tab === 'list' ? (
        <div className="space-y-4">
          <div className="flex justify-end"><Button onClick={openAdd}><Plus className="w-4 h-4" /> เพิ่มรถใหม่</Button></div>

          {vehicles.length === 0 ? (
            <Card className="p-10 text-center text-slate-400">ยังไม่มีข้อมูลรถส่งของ</Card>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {vehicles.map((v: any) => (
                <Card key={v.id} className="p-5">
                  <div className="flex justify-between items-start mb-3">
                    <div>
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <h3 className="font-bold text-lg text-slate-800">{v.plate}</h3>
                        <Badge>{v.type === '6W' ? '6 ล้อ' : 'กระบะ'}</Badge>
                        <Badge type={v.isActive ? 'success' : 'default'}>{v.isActive ? 'ใช้งานอยู่' : 'ปิดใช้งาน'}</Badge>
                      </div>
                      <p className="text-sm text-slate-500">{v.name}</p>
                      <p className="text-sm text-slate-600 mt-1">คนขับ: <span className="font-medium">{v.driverName || '-'}</span></p>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <button onClick={() => openEdit(v)} className="p-2 bg-slate-100 hover:bg-teal-100 text-slate-600 hover:text-teal-600 rounded-lg transition-colors"><Edit className="w-4 h-4" /></button>
                      <button onClick={() => setDeleteId(v.id)} className="p-2 bg-slate-100 hover:bg-red-100 text-slate-600 hover:text-red-600 rounded-lg transition-colors"><Trash2 className="w-4 h-4" /></button>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <RenewalSection title="ประกันภาคสมัครใจ" icon={<ShieldCheck className="w-3.5 h-3.5" />} company={v.insurance.company} date={v.insurance.date} expiry={v.insurance.expiry} cost={v.insurance.cost} />
                    <RenewalSection title="พรบ." icon={<ShieldCheck className="w-3.5 h-3.5" />} company={v.act.company} date={v.act.date} expiry={v.act.expiry} cost={v.act.cost} />
                    <RenewalSection title="ทะเบียนรถ / ภาษี" icon={<Truck className="w-3.5 h-3.5" />} expiry={v.registration.expiry} cost={v.registration.cost} showCompany={false} showDate={false} />
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      ) : (
        <FleetAnalysisTab vehicles={vehicles} expenses={expenses} />
      )}

      {isModalOpen && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-[100] p-4 overflow-y-auto">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200 my-8">
            <div className="p-5 border-b border-slate-100 flex justify-between items-center bg-slate-50">
              <h3 className="font-bold text-slate-800 flex items-center gap-2"><Truck className="w-5 h-5" /> {editId ? 'แก้ไขข้อมูลรถ' : 'เพิ่มรถใหม่'}</h3>
              <button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-5 space-y-5 max-h-[75vh] overflow-y-auto">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div><label className="block text-sm font-medium text-slate-700 mb-1">ทะเบียนรถ</label><input type="text" value={formData.plate} onChange={(e) => setFormData({ ...formData, plate: e.target.value })} className="w-full border border-slate-300 p-2.5 rounded-lg text-sm outline-none focus:border-teal-500" /></div>
                <div><label className="block text-sm font-medium text-slate-700 mb-1">ชื่อเรียก</label><input type="text" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} className="w-full border border-slate-300 p-2.5 rounded-lg text-sm outline-none focus:border-teal-500" /></div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">ประเภทรถ</label>
                  <select value={formData.type} onChange={(e) => setFormData({ ...formData, type: e.target.value })} className="w-full border border-slate-300 p-2.5 rounded-lg text-sm outline-none focus:border-teal-500">
                    <option value="6W">6 ล้อ</option><option value="4W">กระบะ</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">พนักงานขับรถ</label>
                  <input list="driver-list" type="text" value={formData.driverName} onChange={(e) => setFormData({ ...formData, driverName: e.target.value })} placeholder="ชื่อพนักงานขับรถ" className="w-full border border-slate-300 p-2.5 rounded-lg text-sm outline-none focus:border-teal-500" />
                  <datalist id="driver-list">{driverNames.map((n: string) => <option key={n} value={n} />)}</datalist>
                </div>
              </div>

              <label className="flex items-center gap-3 p-3 border border-slate-200 rounded-lg bg-slate-50 cursor-pointer w-fit">
                <input type="checkbox" checked={formData.isActive} onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })} className="w-5 h-5 text-teal-600 rounded border-slate-300" />
                <span className="text-sm font-medium text-slate-700">เปิดใช้งานรถคันนี้ (ใช้เลือกในหน้าบันทึกค่าใช้จ่าย)</span>
              </label>

              <div className="p-4 bg-teal-50/50 border border-teal-100 rounded-lg space-y-3">
                <h4 className="font-bold text-sm text-teal-800 flex items-center gap-2"><ShieldCheck className="w-4 h-4" /> ประกันภาคสมัครใจ</h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div><label className="block text-xs text-slate-500 mb-1">บริษัทที่ทำ</label><input type="text" value={formData.insurance.company} onChange={(e) => setFormData({ ...formData, insurance: { ...formData.insurance, company: e.target.value } })} className="w-full border border-slate-300 p-2 rounded-lg text-sm outline-none" /></div>
                  <div><label className="block text-xs text-slate-500 mb-1">ค่าเบี้ยประกัน (บาท)</label><input type="number" value={formData.insurance.cost} onChange={(e) => setFormData({ ...formData, insurance: { ...formData.insurance, cost: e.target.value } })} className="w-full border border-slate-300 p-2 rounded-lg text-sm outline-none" /></div>
                  <div><label className="block text-xs text-slate-500 mb-1">วันที่ทำ</label><input type="date" value={formData.insurance.date} onChange={(e) => setFormData({ ...formData, insurance: { ...formData.insurance, date: e.target.value } })} className="w-full border border-slate-300 p-2 rounded-lg text-sm outline-none" /></div>
                  <div><label className="block text-xs text-slate-500 mb-1">วันหมดอายุ</label><input type="date" value={formData.insurance.expiry} onChange={(e) => setFormData({ ...formData, insurance: { ...formData.insurance, expiry: e.target.value } })} className="w-full border border-slate-300 p-2 rounded-lg text-sm outline-none" /></div>
                </div>
              </div>

              <div className="p-4 bg-blue-50/50 border border-blue-100 rounded-lg space-y-3">
                <h4 className="font-bold text-sm text-blue-800 flex items-center gap-2"><ShieldCheck className="w-4 h-4" /> พรบ. (ประกันภาคบังคับ)</h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div><label className="block text-xs text-slate-500 mb-1">บริษัทที่ทำ</label><input type="text" value={formData.act.company} onChange={(e) => setFormData({ ...formData, act: { ...formData.act, company: e.target.value } })} className="w-full border border-slate-300 p-2 rounded-lg text-sm outline-none" /></div>
                  <div><label className="block text-xs text-slate-500 mb-1">ค่าใช้จ่าย (บาท)</label><input type="number" value={formData.act.cost} onChange={(e) => setFormData({ ...formData, act: { ...formData.act, cost: e.target.value } })} className="w-full border border-slate-300 p-2 rounded-lg text-sm outline-none" /></div>
                  <div><label className="block text-xs text-slate-500 mb-1">วันที่ทำ</label><input type="date" value={formData.act.date} onChange={(e) => setFormData({ ...formData, act: { ...formData.act, date: e.target.value } })} className="w-full border border-slate-300 p-2 rounded-lg text-sm outline-none" /></div>
                  <div><label className="block text-xs text-slate-500 mb-1">วันหมดอายุ</label><input type="date" value={formData.act.expiry} onChange={(e) => setFormData({ ...formData, act: { ...formData.act, expiry: e.target.value } })} className="w-full border border-slate-300 p-2 rounded-lg text-sm outline-none" /></div>
                </div>
              </div>

              <div className="p-4 bg-amber-50/50 border border-amber-100 rounded-lg space-y-3">
                <h4 className="font-bold text-sm text-amber-800 flex items-center gap-2"><Truck className="w-4 h-4" /> ทะเบียนรถ / ต่อภาษีประจำปี</h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div><label className="block text-xs text-slate-500 mb-1">ค่าใช้จ่าย (บาท)</label><input type="number" value={formData.registration.cost} onChange={(e) => setFormData({ ...formData, registration: { ...formData.registration, cost: e.target.value } })} className="w-full border border-slate-300 p-2 rounded-lg text-sm outline-none" /></div>
                  <div><label className="block text-xs text-slate-500 mb-1">วันครบกำหนดต่อทะเบียน/ภาษี</label><input type="date" value={formData.registration.expiry} onChange={(e) => setFormData({ ...formData, registration: { ...formData.registration, expiry: e.target.value } })} className="w-full border border-slate-300 p-2 rounded-lg text-sm outline-none" /></div>
                </div>
              </div>
            </div>
            <div className="p-4 border-t border-slate-100 flex justify-end gap-3 bg-slate-50">
              <Button variant="secondary" onClick={() => setIsModalOpen(false)}>ยกเลิก</Button>
              <Button onClick={handleSave} disabled={!formData.plate.trim() || !formData.name.trim() || saving}>{saving && <Loader2 className="w-4 h-4 animate-spin" />} บันทึกข้อมูลรถ</Button>
            </div>
          </div>
        </div>
      )}

      {deleteId !== null && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-[100] p-4">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-sm text-center">
            <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4"><Trash2 className="w-8 h-8 text-red-500" /></div>
            <h3 className="font-bold text-lg text-slate-800 mb-2">ยืนยันการลบรถคันนี้?</h3>
            <p className="text-sm text-slate-500 mb-4">ประวัติค่าใช้จ่ายที่เคยบันทึกไว้จะยังคงอยู่ แต่จะไม่สามารถเลือกรถคันนี้ในรายการใหม่ได้</p>
            <div className="flex justify-center gap-3"><Button variant="secondary" onClick={() => setDeleteId(null)}>ยกเลิก</Button><Button variant="danger" onClick={async () => { const ok = await deleteVehicle(deleteId); if (ok) toast({ title: 'ลบข้อมูลรถแล้ว' }); setDeleteId(null); }}>ลบรถคันนี้</Button></div>
          </div>
        </div>
      )}
    </div>
  );
};

const ViewSettings = () => {
  const { companySettings, saveCompanySettings, currentUser } = useContext(AppContext);
  const [formData, setFormData] = useState(companySettings);
  const [isSaved, setIsSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => { setFormData(companySettings); }, [companySettings]);

  if (!currentUser.roles.includes('OWNER')) return null;

  const handleSave = async () => {
    setSaving(true);
    const ok = await saveCompanySettings(formData);
    setSaving(false);
    if (ok) { setIsSaved(true); setTimeout(() => setIsSaved(false), 3000); }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <Card className="p-6">
        <h3 className="text-xl font-bold text-slate-800 mb-6 flex items-center gap-2 border-b border-slate-100 pb-4"><Settings className="w-6 h-6 text-teal-600" /> ข้อมูลองค์กร (พิมพ์ใบเสร็จ/สลิป)</h3>
        <div className="space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div className="md:col-span-2"><label className="block text-sm font-medium text-slate-700 mb-1">ชื่อบริษัท / กิจการ</label><input type="text" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} className="w-full border border-slate-300 rounded-lg p-2.5 text-sm outline-none focus:border-teal-500" /></div>
            <div><label className="block text-sm font-medium text-slate-700 mb-1">เลขประจำตัวผู้เสียภาษี (Tax ID)</label><input type="text" maxLength={13} value={formData.taxId} onChange={(e) => setFormData({ ...formData, taxId: e.target.value })} className="w-full border border-slate-300 rounded-lg p-2.5 text-sm outline-none focus:border-teal-500" /></div>
            <div><label className="block text-sm font-medium text-slate-700 mb-1">เบอร์โทรศัพท์ติดต่อ</label><input type="text" value={formData.phone} onChange={(e) => setFormData({ ...formData, phone: e.target.value })} className="w-full border border-slate-300 rounded-lg p-2.5 text-sm outline-none focus:border-teal-500" /></div>
            <div className="md:col-span-2"><label className="block text-sm font-medium text-slate-700 mb-1">ที่ตั้งสำนักงาน</label><textarea rows={3} value={formData.address} onChange={(e) => setFormData({ ...formData, address: e.target.value })} className="w-full border border-slate-300 rounded-lg p-2.5 text-sm outline-none focus:border-teal-500"></textarea></div>
          </div>
        </div>
        <div className="mt-8 pt-5 border-t border-slate-100 flex items-center justify-between">
          <div>{isSaved && <span className="text-emerald-600 font-medium text-sm flex items-center gap-1 animate-in fade-in zoom-in"><CheckCircle2 className="w-4 h-4" /> บันทึกการตั้งค่าสำเร็จ!</span>}</div>
          <Button variant="primary" onClick={handleSave} disabled={saving}>{saving && <Loader2 className="w-4 h-4 animate-spin" />} บันทึกข้อมูลองค์กร</Button>
        </div>
      </Card>
    </div>
  );
};

const BackupModal = ({ isOpen, onClose }: any) => {
  const { employees, expenses, attendanceLogs, leaves, unloadingLogs, advances } = useContext(AppContext);

  if (!isOpen) return null;

  const handleExport = (data: any[], filename: string) => {
    if (!data || !data.length) return;
    const headers = Object.keys(data[0]);
    const csvContent = [
      headers.join(','),
      ...data.map((row) => headers.map((field) => {
        let val = row[field];
        if (Array.isArray(val)) val = val.join(';');
        else if (typeof val === 'object' && val !== null) val = JSON.stringify(val);
        return `"${(val || '').toString().replace(/"/g, '""')}"`;
      }).join(','))
    ].join('\n');

    const blob = new Blob(['﻿' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${filename}_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
  };

  return (
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-[100] p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        <div className="p-5 border-b border-slate-100 flex justify-between items-center bg-slate-50">
          <h3 className="font-bold text-slate-800 flex items-center gap-2"><UploadCloud className="w-5 h-5 text-amber-600" /> ศูนย์สำรองข้อมูล (Export to Google Sheets)</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-5 space-y-4">
          <p className="text-sm text-slate-600">ดาวน์โหลดข้อมูลจากระบบในรูปแบบไฟล์ <code>.csv</code> เพื่อนำไปเปิดใน Google Sheets หรือ Excel ต่อได้ทันที</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Button variant="outline" onClick={() => handleExport(employees, 'Employees_Backup')} className="justify-start gap-3"><Users className="w-5 h-5 text-teal-600" /> <span>รายชื่อพนักงาน</span></Button>
            <Button variant="outline" onClick={() => handleExport(expenses, 'Expenses_Backup')} className="justify-start gap-3"><Wallet className="w-5 h-5 text-red-500" /> <span>ประวัติค่าใช้จ่าย</span></Button>
            <Button variant="outline" onClick={() => handleExport(attendanceLogs, 'Attendance_Backup')} className="justify-start gap-3"><Clock className="w-5 h-5 text-blue-500" /> <span>เวลาการทำงาน (GPS)</span></Button>
            <Button variant="outline" onClick={() => handleExport(leaves, 'Leaves_Backup')} className="justify-start gap-3"><CalendarOff className="w-5 h-5 text-amber-500" /> <span>ประวัติการลา</span></Button>
            <Button variant="outline" onClick={() => handleExport(unloadingLogs, 'Unloading_Backup')} className="justify-start gap-3"><Package className="w-5 h-5 text-indigo-500" /> <span>ประวัติค่าลงของ</span></Button>
            <Button variant="outline" onClick={() => handleExport(advances, 'Advances_Backup')} className="justify-start gap-3"><Calculator className="w-5 h-5 text-purple-500" /> <span>รายการเบิกล่วงหน้า</span></Button>
          </div>
        </div>
        <div className="p-4 border-t border-slate-100 flex justify-end bg-slate-50">
          <Button variant="secondary" onClick={onClose}>ปิดหน้าต่าง</Button>
        </div>
      </div>
    </div>
  );
};

const AppLayout = () => {
  const { currentUser, logout, currentView, setCurrentView } = useContext(AppContext);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isBackupModalOpen, setIsBackupModalOpen] = useState(false);
  const [isSyncingSheets, setIsSyncingSheets] = useState(false);

  const handleSyncSheets = async () => {
    setIsSyncingSheets(true);
    try {
      const { error } = await window.ezsite.apis.run({ path: 'sheets/push', methodName: 'pushAll', param: [] });
      if (error) { toast({ title: 'ซิงก์ข้อมูลไม่สำเร็จ', description: error, variant: 'destructive' }); return; }
      toast({ title: 'ซิงก์กับ Google ชีตสำเร็จ' });
    } catch (e: any) {
      toast({ title: 'ซิงก์ข้อมูลไม่สำเร็จ', description: e?.message || 'ดำเนินการไม่สำเร็จ', variant: 'destructive' });
    } finally {
      setIsSyncingSheets(false);
    }
  };

  const navItems = [
    { id: 'dashboard', label: 'แดชบอร์ด', icon: LayoutDashboard, roles: ['OWNER', 'HR_ADMIN', 'PAYROLL_OFFICER', 'TEAM_MANAGER', 'EMPLOYEE'] },
    { id: 'employees', label: 'พนักงาน', icon: Users, roles: ['OWNER', 'HR_ADMIN', 'PAYROLL_OFFICER'] },
    { id: 'time', label: 'เวลาและกะ', icon: Clock, roles: ['OWNER', 'HR_ADMIN', 'PAYROLL_OFFICER', 'TEAM_MANAGER', 'EMPLOYEE'] },
    { id: 'leave', label: 'การลา', icon: CalendarOff, roles: ['OWNER', 'HR_ADMIN', 'PAYROLL_OFFICER', 'TEAM_MANAGER', 'EMPLOYEE'] },
    { id: 'overtime', label: 'ล่วงเวลา (OT)', icon: Timer, roles: ['OWNER', 'HR_ADMIN', 'PAYROLL_OFFICER', 'TEAM_MANAGER', 'EMPLOYEE'] },
    { id: 'unloading', label: 'ค่าลงของ', icon: Package, roles: ['OWNER', 'HR_ADMIN', 'PAYROLL_OFFICER', 'EMPLOYEE', 'TEAM_MANAGER'] },
    { id: 'payroll', label: 'เงินเดือน', icon: Calculator, roles: ['OWNER', 'PAYROLL_OFFICER'] },
    { id: 'expenses', label: 'ค่าใช้จ่าย', icon: Wallet, roles: ['OWNER', 'PAYROLL_OFFICER'] },
    { id: 'fleet', label: 'รถส่งของ', icon: Truck, roles: ['OWNER', 'PAYROLL_OFFICER'] },
    { id: 'settings', label: 'ตั้งค่าองค์กร', icon: Settings, roles: ['OWNER'] }
  ];

  const allowedNav = navItems.filter((item) => item.roles.some((r) => currentUser.roles.includes(r)));

  const renderMobileNav = () => (
    <div className="md:hidden bg-slate-900 border-t border-slate-800">
      <nav className="px-4 py-3 space-y-1">
        {allowedNav.map((item) => {
          const IconComponent = item.icon;
          const isActive = currentView === item.id;
          return (
            <button key={item.id} onClick={() => { setCurrentView(item.id); setIsMobileMenuOpen(false); }} className={`w-full flex items-center gap-3 px-3 py-3 rounded-lg text-sm font-medium transition-colors ${isActive ? 'bg-teal-600 text-white' : 'text-slate-300 hover:bg-slate-800 hover:text-white'}`}>
              <IconComponent className="w-5 h-5" /> {item.label}
            </button>
          );
        })}
        <button onClick={logout} className="w-full flex items-center gap-3 px-3 py-3 rounded-lg text-sm font-medium text-red-400 hover:bg-slate-800"><LogOut className="w-5 h-5" /> ออกจากระบบ</button>
      </nav>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50 flex">
      <aside className="hidden md:flex flex-col w-64 bg-slate-900 text-white h-screen sticky top-0">
        <div className="p-6 flex items-center gap-3 border-b border-slate-800">
          <div className="bg-teal-500 p-2 rounded-lg"><Package className="w-5 h-5 text-white" /></div>
          <div><h1 className="font-bold text-lg leading-none tracking-wide">THEERAT</h1><span className="text-[10px] text-teal-400 font-medium">HRMS PRO</span></div>
        </div>
        <nav className="flex-1 px-4 py-6 space-y-1 overflow-y-auto">
          {allowedNav.map((item) => {
            const IconComponent = item.icon;
            const isActive = currentView === item.id;
            return (
              <button key={item.id} onClick={() => setCurrentView(item.id)} className={`w-full flex items-center gap-3 px-3 py-3 rounded-lg text-sm font-medium transition-colors ${isActive ? 'bg-teal-600 text-white' : 'text-slate-300 hover:bg-slate-800 hover:text-white'}`}>
                <IconComponent className="w-5 h-5" /> {item.label}
              </button>
            );
          })}
        </nav>
        <div className="p-4 border-t border-slate-800">
          <div className="px-3 py-2 mb-2 text-xs text-slate-400">
            <p className="font-medium text-slate-200 truncate">{currentUser.name}</p>
            <p className="truncate">{currentUser.email}</p>
          </div>
          <button onClick={logout} className="w-full flex items-center justify-center gap-2 py-2 text-sm text-red-400 hover:bg-slate-800 rounded-lg transition-colors"><LogOut className="w-4 h-4" /> ออกจากระบบ</button>
        </div>
      </aside>

      <main className="flex-1 flex flex-col min-w-0 h-screen overflow-hidden">
        <header className="md:hidden bg-slate-900 text-white p-4 flex items-center justify-between sticky top-0 z-20">
          <div className="flex items-center gap-2"><Package className="w-6 h-6 text-teal-400" /><h1 className="font-bold">THEERAT HRMS</h1></div>
          <button onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)} className="p-2">{isMobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}</button>
        </header>
        {isMobileMenuOpen && renderMobileNav()}

        <div className="flex-1 overflow-y-auto p-4 md:p-8 bg-slate-50/50 relative">
          <div className="max-w-6xl mx-auto flex items-center justify-between mb-6 pb-4 border-b border-slate-200">
            <h2 className="text-2xl font-bold text-slate-800 tracking-tight">{allowedNav.find((n) => n.id === currentView)?.label || ''}</h2>
            <div className="flex items-center gap-3">
              {currentUser.roles.some((r: string) => ['OWNER', 'HR_ADMIN', 'PAYROLL_OFFICER'].includes(r)) && (
                <>
                  <Button variant="outline" onClick={handleSyncSheets} disabled={isSyncingSheets} className="hidden sm:flex bg-white hover:bg-teal-50 border-slate-200 shadow-sm text-slate-700 hover:text-teal-700 hover:border-teal-300">
                    {isSyncingSheets ? <Loader2 className="w-4 h-4 text-teal-500 animate-spin" /> : <RefreshCw className="w-4 h-4 text-teal-500" />} Sync กับ Google ชีต
                  </Button>
                  <Button variant="outline" onClick={() => setIsBackupModalOpen(true)} className="hidden sm:flex bg-white hover:bg-amber-50 border-slate-200 shadow-sm text-slate-700 hover:text-amber-700 hover:border-amber-300">
                    <UploadCloud className="w-4 h-4 text-amber-500" /> นำออกข้อมูล (CSV)
                  </Button>
                </>
              )}
              <Badge type="success">เชื่อมต่อฐานข้อมูล</Badge>
            </div>
          </div>

          <div className="max-w-6xl mx-auto space-y-6">
            {currentView === 'dashboard' && <ViewDashboard />}
            {currentView === 'employees' && <ViewEmployees />}
            {currentView === 'time' && <ViewTime />}
            {currentView === 'leave' && <ViewLeaves />}
            {currentView === 'overtime' && <ViewOvertime />}
            {currentView === 'unloading' && <ViewUnloading />}
            {currentView === 'payroll' && <ViewPayroll />}
            {currentView === 'expenses' && <ViewExpenses />}
            {currentView === 'fleet' && <ViewFleet />}
            {currentView === 'settings' && <ViewSettings />}
          </div>
        </div>
      </main>

      <LeaveRequestModal />
      <BackupModal isOpen={isBackupModalOpen} onClose={() => setIsBackupModalOpen(false)} />
    </div>
  );
};

const LoadingScreen = () => (
  <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50 gap-4">
    <div className="bg-teal-500 p-3 rounded-xl shadow-lg shadow-teal-200"><Package className="w-8 h-8 text-white" /></div>
    <div className="flex items-center gap-2 text-slate-500"><Loader2 className="w-5 h-5 animate-spin" /> กำลังโหลดข้อมูลจากฐานข้อมูล...</div>
  </div>
);

const UnlinkedScreen = () => {
  const { authUser, logout } = useContext(AppContext);
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
      <div className="bg-white p-8 rounded-2xl shadow-xl max-w-md w-full border border-slate-200 text-center">
        <div className="w-16 h-16 bg-amber-100 rounded-2xl flex items-center justify-center mx-auto mb-4"><AlertCircle className="w-8 h-8 text-amber-600" /></div>
        <h1 className="text-xl font-bold text-slate-800 mb-2">บัญชียังไม่ได้ผูกกับข้อมูลพนักงาน</h1>
        <p className="text-slate-600 mb-2">อีเมล <span className="font-medium">{authUser?.Email}</span> ยังไม่ตรงกับพนักงานคนใดในระบบ</p>
        <p className="text-sm text-slate-500 mb-6">กรุณาให้ผู้ดูแล (OWNER) เพิ่มอีเมลนี้ให้กับพนักงานของคุณในเมนู "จัดการพนักงาน"</p>
        <Button variant="secondary" onClick={logout} className="mx-auto"><LogOut className="w-4 h-4" /> ออกจากระบบ</Button>
      </div>
    </div>
  );
};

const AppRoot = () => {
  const { status, currentUser } = useContext(AppContext);
  const navigate = useNavigate();

  useEffect(() => {
    if (status === 'guest') navigate('/login');
  }, [status, navigate]);

  if (status === 'loading') return <LoadingScreen />;
  if (status === 'guest') return <LoadingScreen />;
  if (!currentUser) return <UnlinkedScreen />;
  return <AppLayout />;
};

export default function HomePage() {
  return (
    <DataProvider>
      <AppRoot />
    </DataProvider>
  );
}
