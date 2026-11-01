# THEERAT HRMS

ระบบบริหารทรัพยากรบุคคลและเงินเดือน (พอร์ตจาก [theerat-hrms](https://github.com/chaiyoot2-creator/theerat-hrms) ออกจากแพลตฟอร์ม EzSite)
รายละเอียดฟังก์ชันทุกโมดูลอยู่ใน [docs/APP_FUNCTIONS.md](docs/APP_FUNCTIONS.md)

## สถาปัตยกรรม

```
เบราว์เซอร์ ──► Vercel (React/Vite: hr.theeratfeed.com)
                  │  /api/*  (rewrite ใน vercel.json, same-origin → คุกกี้ล็อกอินเป็น first-party)
                  ▼
              VPS Munjai (Ubuntu + Docker: hrapi.theeratfeed.com)
                Caddy (HTTPS อัตโนมัติ) ─► api (Node/Express) ─► PostgreSQL
                                             └─ cron 20:00 ลงเวลาออกอัตโนมัติ + คำนวณ OT
```

| โฟลเดอร์ | หน้าที่ |
|---|---|
| `src/` | หน้าเว็บ (เหมือนต้นแบบ) — `src/lib/ezsite.ts` ถูกเขียนใหม่ให้เรียก `/api` แทน EzSite SDK |
| `api/` | Backend: ล็อกอิน (JWT ในคุกกี้ httpOnly), CRUD ทุกตาราง + ตรวจสิทธิ์ตามบทบาทฝั่งเซิร์ฟเวอร์, สำรองข้อมูลอัตโนมัติ, ซิงก์ Google Sheets, งาน cron |
| `deploy/` | Docker Compose, Caddyfile, สคริปต์ติดตั้ง VPS / สำรองฐานข้อมูล / อัปเดต |

## รันบนเครื่อง (dev)

ต้องมี Node 22+, PostgreSQL (หรือ Docker)

```bash
docker run -d --name hrms-db -e POSTGRES_USER=hrms -e POSTGRES_PASSWORD=hrms -e POSTGRES_DB=hrms -p 5432:5432 postgres:17-alpine
```

สร้าง `api/.env`:
```
DATABASE_URL=postgres://hrms:hrms@localhost:5432/hrms
JWT_SECRET=dev-secret-change-me-dev-secret-change-me
COOKIE_SECURE=false
OWNER_EMAIL=you@example.com
APP_URL=http://localhost:8080
```

```bash
cd api && npm install && npm run dev
```
```bash
corepack pnpm install && corepack pnpm dev
```
เปิด http://localhost:8080/register → สมัครด้วยอีเมลใน `OWNER_EMAIL` → ล็อกอิน (Vite proxy `/api` ไปที่ :3001)

## Deploy ขั้นที่ 1 — VPS Munjai (backend)

1. **DNS**: สร้าง A record `hrapi.theeratfeed.com` → IP ของ VPS
2. SSH เข้า VPS แล้วดึงโค้ด:
   ```bash
   sudo git clone https://github.com/<you>/theerat-hrms.git /opt/theerat-hrms
   ```
   ```bash
   sudo bash /opt/theerat-hrms/deploy/setup-vps.sh
   ```
   (ติดตั้ง Docker, เปิด firewall เฉพาะ 22/80/443, Fail2Ban, ตั้ง timezone Asia/Bangkok)
3. ตั้งค่าความลับ:
   ```bash
   cd /opt/theerat-hrms/deploy && sudo cp .env.example .env && sudo nano .env
   ```
   สร้างรหัสด้วย `openssl rand -hex 24` (POSTGRES_PASSWORD) และ `openssl rand -hex 32` (JWT_SECRET)
4. เริ่มระบบ:
   ```bash
   sudo docker compose up -d --build
   ```
5. ตรวจสอบ: `curl https://hrapi.theeratfeed.com/api/health` ต้องได้ `{"ok":true}`
6. สำรองฐานข้อมูลทุกคืน: `sudo crontab -e` แล้วเพิ่ม
   `0 2 * * * /opt/theerat-hrms/deploy/backup-db.sh >> /var/log/hrms-backup.log 2>&1`

อัปเดตครั้งต่อไป: `sudo bash /opt/theerat-hrms/deploy/update.sh`

> **VPS ที่มี Coolify อยู่แล้ว (151.242.34.51)**: Traefik ของ Coolify ใช้พอร์ต 80/443 อยู่ ให้ใช้
> `docker compose -f deploy/coolify/docker-compose.yml --env-file deploy/.env up -d --build` แทน
> (Traefik ออกใบรับรอง SSL ให้จาก labels, ไม่เปิดพอร์ตเพิ่ม และไม่ต้องรัน `setup-vps.sh`)
>
> ถ้า VPS ใช้ Hestia Control Panel อยู่แล้ว (พอร์ต 80/443 ถูกใช้) ให้ลบ service `caddy` ออกจาก compose,
> เพิ่ม `ports: ["127.0.0.1:3001:3001"]` ให้ `api` แล้วตั้ง Proxy ใน Hestia ไปที่ `http://127.0.0.1:3001` + เปิด SSL ตามบทความ Munjai "เพิ่ม SSL ให้เว็บไซต์"

## Deploy ขั้นที่ 2 — Vercel (frontend)

1. ถ้าโดเมน API ไม่ใช่ `hrapi.theeratfeed.com` ให้แก้ `destination` ใน [vercel.json](vercel.json)
2. Push โปรเจกต์นี้ขึ้น GitHub
3. https://vercel.com/new → Import repository → Framework: Vite (ค่าอื่นอ่านจาก `vercel.json`) → Deploy
   หรือใช้ CLI: `npx vercel` แล้ว `npx vercel --prod`
4. Vercel → Settings → Domains → เพิ่ม `hr.theeratfeed.com` แล้วตั้ง DNS ตามที่ Vercel บอก (CNAME `cname.vercel-dns.com`)
5. ทุกครั้งที่ push เข้า `main` Vercel จะ deploy หน้าเว็บให้อัตโนมัติ (backend อัปเดตด้วย `update.sh`)

## ใช้งานครั้งแรก

1. เปิด `https://hr.theeratfeed.com/register` สมัครด้วยอีเมลเดียวกับ `OWNER_EMAIL`
2. ล็อกอิน → เมนูพนักงาน → เพิ่มพนักงาน (ใส่อีเมลของแต่ละคน)
3. พนักงานสมัครที่ `/register` ด้วยอีเมลที่ HR ใส่ไว้ (อีเมลที่ไม่มีในรายชื่อพนักงานสมัครไม่ได้)

## ย้ายข้อมูลเดิมจาก EzSite

ส่งออกแต่ละตารางเป็น CSV (ปุ่ม "สำรองข้อมูล" หรือ Google Sheets ที่ซิงก์ไว้) แล้วนำเข้า Postgres:
```bash
docker compose exec -T db psql -U hrms -d hrms -c "\copy employees(id,emp_code,username,email,name,roles,dept,salary,salary_type,bank_account,phone,has_social_security) FROM STDIN CSV HEADER" < employees.csv
```
หลังนำเข้าให้รีเซ็ต sequence: `SELECT setval('employees_id_seq', (SELECT max(id) FROM employees));` (ทำแบบเดียวกันทุกตาราง)
