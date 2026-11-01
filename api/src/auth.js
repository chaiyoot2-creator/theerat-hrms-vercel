import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import nodemailer from 'nodemailer';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { query } from './db.js';

const COOKIE = 'hr_session';
const SESSION_DAYS = 7;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const secret = () => {
  const s = process.env.JWT_SECRET;
  if (!s || s.length < 32) throw new Error('JWT_SECRET must be set (32+ chars)');
  return s;
};

const cookieOpts = () => ({
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.COOKIE_SECURE !== 'false',
  path: '/',
  maxAge: SESSION_DAYS * 86400 * 1000
});

const toUserInfo = (u, roles) => ({
  ID: u.id, Name: u.name, Email: u.email, CreateTime: u.created_at, Roles: roles.join(',')
});

/** Roles come from the employee row whose email matches the signed-in user (same rule as the UI). */
export async function rolesForEmail(email) {
  const { rows } = await query('SELECT id, roles FROM employees WHERE lower(email) = lower($1) LIMIT 1', [email]);
  if (!rows.length) return { employeeId: null, roles: [] };
  const roles = (rows[0].roles || '').split(',').map((s) => s.trim()).filter(Boolean);
  return { employeeId: rows[0].id, roles };
}

/** Express middleware: attaches req.user = { id, email, employeeId, roles } or responds 401. */
export async function requireAuth(req, res, next) {
  try {
    const token = req.cookies?.[COOKIE];
    if (!token) return res.status(401).json({ error: 'กรุณาเข้าสู่ระบบ' });
    const payload = jwt.verify(token, secret());
    const { rows } = await query('SELECT id, email FROM users WHERE id = $1', [payload.sub]);
    if (!rows.length) return res.status(401).json({ error: 'กรุณาเข้าสู่ระบบ' });
    req.user = { id: rows[0].id, email: rows[0].email, ...(await rolesForEmail(rows[0].email)) };
    next();
  } catch {
    res.status(401).json({ error: 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่' });
  }
}

const hashToken = (t) => crypto.createHash('sha256').update(t).digest('hex');

async function sendResetMail(to, link) {
  if (!process.env.SMTP_HOST) throw new Error('ระบบยังไม่ได้ตั้งค่าการส่งอีเมล กรุณาติดต่อผู้ดูแลระบบ');
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 587,
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined
  });
  await transport.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to,
    subject: 'ตั้งรหัสผ่านใหม่ - THEERAT HRMS',
    text: `กดลิงก์นี้เพื่อตั้งรหัสผ่านใหม่ (หมดอายุใน 1 ชั่วโมง):\n${link}`
  });
}

export function authRouter() {
  const r = Router();
  // Keyed by IP + account: behind Vercel's rewrite many users share a few edge IPs,
  // so an IP-only key would let one person's typos lock everyone out.
  const limiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false,
    keyGenerator: (req) => `${req.ip}|${String(req.body?.email || req.body?.token || '').trim().toLowerCase()}`,
    message: { error: 'ลองหลายครั้งเกินไป กรุณารอ 15 นาที' } });

  r.post('/login', limiter, async (req, res) => {
    let identifier = String(req.body?.email || '').trim();
    const password = String(req.body?.password || '');
    // Usernames resolve to the email bound on the employee row (the UI used to do this lookup itself).
    if (!EMAIL_RE.test(identifier)) {
      const { rows } = await query('SELECT email FROM employees WHERE username = $1 LIMIT 1', [identifier]);
      if (!rows[0]?.email) return res.json({ error: 'ไม่พบชื่อผู้ใช้นี้ หรือบัญชียังไม่ได้ผูกอีเมลไว้ กรุณาเข้าสู่ระบบด้วยอีเมลแทน' });
      identifier = rows[0].email.trim();
    }
    const { rows } = await query('SELECT * FROM users WHERE lower(email) = lower($1)', [identifier]);
    const user = rows[0];
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.json({ error: 'อีเมลหรือรหัสผ่านไม่ถูกต้อง' });
    }
    const token = jwt.sign({ sub: user.id }, secret(), { expiresIn: `${SESSION_DAYS}d` });
    res.cookie(COOKIE, token, cookieOpts());
    res.json({ error: null });
  });

  r.post('/register', limiter, async (req, res) => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    if (!EMAIL_RE.test(email)) return res.json({ error: 'รูปแบบอีเมลไม่ถูกต้อง' });
    if (password.length < 8) return res.json({ error: 'รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร' });
    // Only emails HR has already put on an employee row may sign up.
    const { rows: emp } = await query('SELECT name FROM employees WHERE lower(email) = $1 LIMIT 1', [email]);
    if (!emp.length) return res.json({ error: 'อีเมลนี้ยังไม่ได้ลงทะเบียนเป็นพนักงาน กรุณาติดต่อฝ่ายบุคคล' });
    const { rows: existing } = await query('SELECT 1 FROM users WHERE lower(email) = $1', [email]);
    if (existing.length) return res.json({ error: 'อีเมลนี้มีบัญชีอยู่แล้ว' });
    await query('INSERT INTO users (email, name, password_hash) VALUES ($1, $2, $3)',
      [email, emp[0].name || '', await bcrypt.hash(password, 12)]);
    res.json({ error: null });
  });

  r.post('/logout', (_req, res) => {
    res.clearCookie(COOKIE, { ...cookieOpts(), maxAge: undefined });
    res.json({ error: null });
  });

  r.get('/me', requireAuth, async (req, res) => {
    const { rows } = await query('SELECT id, email, name, created_at FROM users WHERE id = $1', [req.user.id]);
    res.json({ data: toUserInfo(rows[0], req.user.roles), error: null });
  });

  r.post('/reset-request', limiter, async (req, res) => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const { rows } = await query('SELECT id FROM users WHERE lower(email) = $1', [email]);
    // Same answer whether or not the account exists, so the form cannot be used to probe emails.
    if (!rows.length) return res.json({ error: null });
    const token = crypto.randomBytes(32).toString('hex');
    await query("UPDATE users SET reset_token_hash = $1, reset_expires = now() + interval '1 hour' WHERE id = $2",
      [hashToken(token), rows[0].id]);
    try {
      const appUrl = (process.env.APP_URL || '').replace(/\/$/, '');
      await sendResetMail(email, `${appUrl}/resetpassword?token=${token}`);
      res.json({ error: null });
    } catch (e) {
      res.json({ error: e.message });
    }
  });

  r.post('/reset', limiter, async (req, res) => {
    const token = String(req.body?.token || '');
    const password = String(req.body?.password || '');
    if (password.length < 8) return res.json({ error: 'รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร' });
    const { rowCount } = await query(
      `UPDATE users SET password_hash = $1, reset_token_hash = NULL, reset_expires = NULL
       WHERE reset_token_hash = $2 AND reset_expires > now()`,
      [await bcrypt.hash(password, 12), hashToken(token)]
    );
    res.json({ error: rowCount ? null : 'ลิงก์ไม่ถูกต้องหรือหมดอายุแล้ว' });
  });

  return r;
}
