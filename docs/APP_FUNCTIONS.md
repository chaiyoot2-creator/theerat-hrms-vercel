# THEERAT HRMS Pro — เอกสารฟังก์ชันทั้งหมดของแอป

ระบบบริหารทรัพยากรบุคคลและเงินเดือน (HRMS) สำหรับธุรกิจขนส่ง/ค้าส่ง ใช้ React + TypeScript (ฝั่งหน้าเว็บ), ฐานข้อมูล Postgres ในตัว และฟังก์ชัน Backend (Deno) สำหรับงานเบื้องหลัง

---

## 1. ภาพรวมระบบ

| หัวข้อ | รายละเอียด |
|---|---|
| หน้าเว็บ (Routes) | `/` (ระบบหลัก), `/login`, `/register`, `/onauthsuccess`, `/resetpassword`, `/company-settings`, `*` (ไม่พบหน้า) |
| สิทธิ์ผู้ใช้ (Roles) | `OWNER`, `HR_ADMIN`, `PAYROLL_OFFICER`, `TEAM_MANAGER`, `EMPLOYEE` |
| การเชื่อมผู้ใช้ | ผู้ใช้ที่ล็อกอินถูกจับคู่กับพนักงานด้วย **อีเมล** (ไม่ตรง = หน้า "บัญชียังไม่ผูกกับพนักงาน") |
| ประเภทค่าจ้าง | `DAILY` (รายวัน), อื่นๆ = รายเดือน |
| เดือนปัจจุบัน | คำนวณจากวันที่จริงของเครื่อง (`CURRENT_MONTH`, `TODAY_DATE`) ไม่ใช้ข้อมูลตัวอย่าง |

### เมนูและสิทธิ์การเข้าถึง

| เมนู | วิว | สิทธิ์ที่เห็น |
|---|---|---|
| แดชบอร์ด | `dashboard` | ทุกบทบาท (ตัวเลขการเงินเห็นเฉพาะ OWNER) |
| พนักงาน | `employees` | OWNER, HR_ADMIN, PAYROLL_OFFICER |
| เวลาและกะ | `time` | ทุกบทบาท |
| การลา | `leave` | ทุกบทบาท |
| ล่วงเวลา (OT) | `overtime` | ทุกบทบาท |
| ค่าลงของ | `unloading` | ทุกบทบาท |
| เงินเดือน | `payroll` | OWNER, PAYROLL_OFFICER |
| ค่าใช้จ่าย | `expenses` | OWNER, PAYROLL_OFFICER |
| รถส่งของ | `fleet` | OWNER, PAYROLL_OFFICER |
| ตั้งค่าองค์กร | `settings` | OWNER |

---

## 2. ระบบผู้ใช้และการยืนยันตัวตน

| ฟังก์ชัน | ไฟล์ | วัตถุประสงค์ / การทำงาน |
|---|---|---|
| `LoginPage` | `pages/LoginPage.tsx` | เข้าสู่ระบบด้วยอีเมล+รหัสผ่าน (`apis.login`) แล้วไปหน้า `/` |
| `RegisterPage` | `pages/RegisterPage.tsx` | สมัครสมาชิกด้วยอีเมล+รหัสผ่าน (`apis.register`) |
| `ResetPasswordPage` | `pages/ResetPasswordPage.tsx` | ส่งอีเมลรีเซ็ตรหัสผ่าน (`sendResetPwdEmail`) และตั้งรหัสใหม่ด้วยโทเคน (`resetPassword`) |
| `OnAuthSuccessPage` | `pages/OnAuthSuccessPage.tsx` | หน้ารองรับหลังล็อกอินสำเร็จ แล้วพาไปหน้าหลัก |
| `AppRoot` | `HomePage.tsx` | ตรวจสถานะล็อกอิน/โหลดข้อมูล แสดง `LoadingScreen`, `UnlinkedScreen` หรือ `AppLayout` |
| `currentUser` (useMemo) | `HomePage.tsx` | จับคู่ผู้ใช้ที่ล็อกอินกับพนักงานด้วยอีเมล |
| `logout` | `HomePage.tsx` | ออกจากระบบ (`apis.logout`) แล้วไปหน้า `/login` |

---

## 3. โครงสร้างหลักและตัวจัดการข้อมูล (`HomePage.tsx`)

### 3.1 `DataProvider` (AppContext)
ศูนย์กลางข้อมูลของแอป โหลดทุกตารางผ่าน `fetchAll` แล้วแปลงด้วย mapper (snake_case → camelCase)

| กลุ่มฟังก์ชัน | ฟังก์ชัน | หน้าที่ |
|---|---|---|
| โหลดข้อมูล | `refreshEmployees`, `refreshLeaves`, `refreshUnloading`, `refreshAdvances`, `refreshResignationDeposits`, `refreshExpenses`, `refreshCategories`, `refreshVehicles`, `refreshAttendance`, `refreshOvertime`, `refreshCompany` | ดึงข้อมูลล่าสุดของแต่ละตารางเข้า state |
| ตัวช่วยเขียนข้อมูล | `run(op, refresh)` | รันคำสั่งเขียน, แจ้ง toast เมื่อผิดพลาด, แล้วรีเฟรชตาราง |
| พนักงาน | `saveEmployee`, `updateEmployee`, `deleteEmployee` | เพิ่ม/แก้ไข/ลบพนักงาน |
| การลา | `addLeave`, `setLeaveStatus` | ยื่นใบลา / อนุมัติ-ไม่อนุมัติ |
| ค่าลงของ | `saveUnloading`, `deleteUnloading` | บันทึก/แก้ไข/ลบจำนวนกระสอบรายวัน |
| เบิกล่วงหน้า | `saveAdvance`, `deleteAdvance`, `setAdvanceStatus` | จัดการรายการเบิก และสถานะอนุมัติ |
| เงินประกันลาออก | `saveResignationDeposit`, `deleteResignationDeposit` | จัดการเงินประกันที่หักสะสม |
| ค่าใช้จ่าย | `saveExpense`, `deleteExpense`, `saveCategory`, `deleteCategory` | จัดการค่าใช้จ่ายและหมวดหมู่ |
| รถ | `saveVehicle`, `deleteVehicle` | จัดการข้อมูลรถ |
| ตั้งค่าบริษัท | `saveCompanySettings` | บันทึก/อัปเดตแถวตั้งค่า (สร้างใหม่ถ้ายังไม่มี) |
| เวลา | `addAttendance` | บันทึกเข้า/ออกงาน |
| OT | `setOvertimeStatus` | อนุมัติ/ปฏิเสธ OT พร้อมผู้อนุมัติ |
| ค่าลงของ (คำนวณ) | `calculateDailyUnloadingPool`, `getEmployeeUnloadingTotal` | ดูหัวข้อ 5.6 |
| อัตโนมัติ | `useEffect` เงินประกันลาออก | เมื่อ OWNER/PAYROLL_OFFICER เปิดแอป จะสร้างรายการหักเงินประกันรายเดือน ("หักอัตโนมัติประจำเดือน") ให้พนักงานที่ตั้งค่าไว้และยังไม่มีรายการในเดือนนี้ |

### 3.2 `AppLayout`
- แสดงแถบเมนูข้าง/เมนูมือถือ (`renderMobileNav`) กรองตามสิทธิ์
- ปุ่ม **สำรองข้อมูล** (`BackupModal`) และ **ซิงก์ Google ชีต** (`handleSyncSheets`) สำหรับ OWNER/HR_ADMIN/PAYROLL_OFFICER
- ปุ่มออกจากระบบ

### 3.3 คอมโพเนนต์ UI พื้นฐาน
`Card`, `Button`, `Badge` — ชิ้นส่วนที่ใช้ซ้ำทั้งแอป

---

## 4. ฟังก์ชันแต่ละโมดูล

### 4.1 แดชบอร์ด — `ViewDashboard`
- **วัตถุประสงค์:** สรุปภาพรวมค่าใช้จ่ายรายเดือน
- **การทำงาน:** เลือกเดือน → รวมเงินเดือนประมาณการ (รายวัน = ค่าแรง × วันทำงาน), ค่าลงของ, ค่าใช้จ่ายดำเนินงาน → `grandTotal`; จัดอันดับหมวดค่าใช้จ่ายพร้อมสัดส่วน %; แสดงพนักงานที่ลาวันนี้
- **ข้อมูล:** employees, attendanceLogs, expenses, unloadingLogs, leaves
- **สิทธิ์:** ตัวเลขการเงินแสดงเฉพาะ OWNER

### 4.2 พนักงาน — `ViewEmployees`
| ฟังก์ชัน | หน้าที่ |
|---|---|
| `handleSaveProfile` | เพิ่ม/แก้ไขข้อมูลพนักงาน (ชื่อ, แผนก, ค่าจ้าง, ธนาคาร, ประกันสังคม, วันเริ่มงาน, เงินประกันลาออก) |
| `handleRoleToggle` / `handleSaveRoles` | กำหนดสิทธิ์การใช้งาน (เฉพาะ OWNER) |
| ลบพนักงาน | ผ่านกล่องยืนยัน → `deleteEmployee` |
| `calcTenure`, `formatTenure` | คำนวณ/แสดงอายุงานจากวันเริ่มงาน |
- **สิทธิ์:** จัดการข้อมูล = OWNER/HR_ADMIN; เห็นข้อมูลเงินเดือน = OWNER/PAYROLL_OFFICER

### 4.3 เวลาและกะ — `ViewTime`
| ฟังก์ชัน | หน้าที่ |
|---|---|
| `handleCheck('IN'/'OUT')` | ลงเวลาเข้า-ออก: ขอพิกัด GPS, เทียบระยะกับที่ทำงาน (`distanceInMeters`) ตามรัศมีที่ตั้งไว้ แล้วบันทึกด้วย `addAttendance` |
| `handleToggleCheckIn` | เปิด/ปิดระบบลงเวลาด้วย GPS (OWNER/HR_ADMIN) |
| `handleSetWorkplaceLocation` | บันทึกพิกัดปัจจุบันเป็นที่ตั้งที่ทำงาน |
| `handleSaveRadius` | ตั้งรัศมีที่อนุญาต (เมตร) |
| `resetStatusSoon` | ล้างสถานะหลังแสดงผล 4 วินาที |
| `useUserLocation` | hook ขอสิทธิ์/อ่านตำแหน่ง, `LocationPermissionDialog` แจ้งเมื่อถูกปฏิเสธ |
- แสดงนาฬิกาเรียลไทม์ และประวัติลงเวลา; ปุ่มที่กดได้ขึ้นกับการลงเวลาล่าสุดของวันนี้

### 4.4 การลา — `ViewLeaves` และ `LeaveRequestModal`
- `handleSubmitLeave` — พนักงานยื่นใบลา (ประเภท, วัน, ช่วงเวลา, เหตุผล)
- `handleStatus` — OWNER/HR_ADMIN/TEAM_MANAGER อนุมัติหรือปฏิเสธ
- ลาประเภท **UNPAID** ที่อนุมัติแล้ว จะถูกหักในเงินเดือนรายเดือน

### 4.5 ล่วงเวลา — `ViewOvertime`
- พนักงานเห็นเฉพาะ OT ของตนเอง; ผู้จัดการเห็นทั้งหมด
- `handleStatus` — อนุมัติ/ปฏิเสธ OT (บันทึกผู้อนุมัติ)
- OT สถานะอนุมัติถูกรวมเป็นรายได้ในการคำนวณเงินเดือน
- รายการ OT ถูกสร้างอัตโนมัติจากงานเบื้องหลัง (หัวข้อ 7.1)

### 4.6 ค่าลงของ — `ViewUnloading`
| ฟังก์ชัน | หน้าที่ |
|---|---|
| `handleAdd` / `handleEdit` | บันทึก/แก้ไขจำนวนกระสอบรายวัน (OWNER/HR_ADMIN) |
| `calculateDailyUnloadingPool(date, bags)` | กองกลาง = กระสอบ × 1 บาท แบ่งเท่ากันให้พนักงานบทบาท `EMPLOYEE` ที่ไม่ลาเต็มวัน (อนุมัติแล้ว); คิดเป็นสตางค์และกระจายเศษให้ครบ |
| `getEmployeeUnloadingTotal(empId, month)` | รวมส่วนแบ่งของพนักงานในเดือนนั้น |
- แสดงยอดกระสอบรวมเดือนนี้และส่วนแบ่งของผู้ใช้เอง

### 4.7 เงินเดือน — `ViewPayroll`
- **วัตถุประสงค์:** ประมวลผลเงินเดือนประจำเดือน
- **ฟังก์ชันคำนวณหลัก `calcMonthlyIncome(emp, month, ctx)`:**
  - ฐาน: รายวัน = ค่าแรง × วันทำงาน (`countWorkDaysInMonth` นับวันที่มีลงเวลา), รายเดือน = เงินเดือน
  - หักลาไม่รับค่าจ้าง = ฐาน/30 × วันลา (เฉพาะรายเดือน)
  - หักเบิกล่วงหน้า (อนุมัติแล้ว, ตาม `deductionMonth` — แยกเดือนต่อเดือน)
  - หักประกันสังคม = min(ฐาน × 5%, 750) หากมีสิทธิ์
  - หักเงินประกันลาออกของเดือนนั้น
  - บวกส่วนแบ่งค่าลงของ และ OT
  - **สุทธิ = ฐาน − หักลา − เบิก − ประกันสังคม − เงินประกัน + ค่าลงของ + OT**
- `cumulativeOf(emp)` — ยอดสะสมเฉพาะเดือนนั้น (ข้ามพนักงานที่เริ่มงานหลังเดือนนั้น)
- `projectDailyNet(emp)` — คาดการณ์ยอดทั้งเดือนของพนักงานรายวัน: วันทำงานคาดการณ์ = (วันที่มาจริง ÷ วันที่ผ่านไป) × วันทั้งเดือน (ปัดเป็นจำนวนเต็ม) ส่วนรายการหักและ OT ใช้ค่าจริง
- ตารางแสดงป้าย "ยอดถึงวันนี้ (ยังไม่ปิดเดือน)" / "ปิดยอดแล้ว", บรรทัด "คาดการณ์ทั้งเดือน ≈ …" และแถว **รวมยอดสะสมทุกคน** (+ รวมคาดการณ์)
- `fmtMoney` จัดรูปแบบเงินบาท
- `PayslipModal` — สลิปเงินเดือนรายบุคคล (พิมพ์ได้)

### 4.8 เบิกล่วงหน้า — `AdvanceSection`
- `handleSave` / `handleEdit` — บันทึก/แก้ไขรายการเบิก (หมวด: `ADVANCE_CATEGORIES`, เดือนที่หัก)
- `handleStatus` — อนุมัติ/ปฏิเสธ; ลบรายการได้

### 4.9 เงินประกันลาออก — `ResignationDepositSection`
- `handleSave` — เพิ่มรายการเงินประกัน (ยอดติดลบ = คืน/ปรับ)
- `totalByEmp`, `grandTotal` — ยอดสะสมรายคน/รวม; แสดงเฉพาะพนักงานที่เข้าร่วม

### 4.10 สรุปรายได้ — `IncomeSummarySection`
- เลือกปีและโหมด (รายเดือน/ทั้งปี) → วนเรียก `calcMonthlyIncome` ต่อเดือนต่อพนักงาน รวมยอดรายรับ รายการหัก และสุทธิ พร้อม `grandTotalNet`

### 4.11 ค่าใช้จ่าย — `ViewExpenses`
- `handleSave` / `handleEdit` — บันทึกค่าใช้จ่าย (หมวดน้ำมัน/ซ่อมบำรุงต้องเลือกรถ — `isFuelOrMaintCategory`)
- `handleSaveCategory` — เพิ่มหมวดค่าใช้จ่ายใหม่; ลบหมวด/รายการได้

### 4.12 รถส่งของ — `ViewFleet`, `FleetAnalysisTab`
| ฟังก์ชัน | หน้าที่ |
|---|---|
| `openAdd` / `openEdit` / `handleSave` | จัดการข้อมูลรถ (คนขับเลือกจากพนักงานแผนก DRIVER) |
| `RenewalSection`, `RenewalBadge`, `daysUntil` | แสดงวันหมดอายุ ประกัน/ภาษี/พ.ร.บ. พร้อมป้ายเตือนจำนวนวันที่เหลือ |
| `FleetAnalysisTab` | วิเคราะห์ค่าน้ำมัน/ซ่อมบำรุงรายคัน เทียบเดือนก่อน (`totalsForMonth`) |
| `TrendIndicator` | ลูกศรขึ้น/ลง/เท่าเดิม |
| `shiftMonth`, `formatMonthTH`, `getRealMonth` | เลื่อน/แสดงเดือนภาษาไทย (พ.ศ.) |

### 4.13 ตั้งค่าองค์กร — `ViewSettings` และ `CompanySettingsPage`
- `ViewSettings.handleSave` — บันทึกข้อมูลบริษัท (ใช้ในสลิป/หัวเอกสาร)
- `CompanySettingsPage` (`/company-settings`) — โหลด/บันทึกพิกัดที่ทำงานของบริษัทโดยตรง (`loadSettings`, `handleSave`, ใช้ตำแหน่งปัจจุบัน)

### 4.14 สำรองข้อมูล — `BackupModal`
- `handleExport(data, filename)` — ส่งออกข้อมูลแต่ละตารางเป็น CSV (UTF-8 BOM เพื่อเปิดใน Excel ภาษาไทยได้)

---

## 5. ฟังก์ชันตัวช่วย (Shared)

| ฟังก์ชัน | ไฟล์ | หน้าที่ |
|---|---|---|
| `pad2`, `formatDateDMY` | HomePage | จัดรูปแบบวันที่ |
| `mapEmployee`, `mapLeave`, `mapUnloading`, `mapAdvance`, `mapResignationDeposit`, `mapExpense`, `mapCategory`, `mapVehicle`, `mapAttendance`, `mapOvertime`, `mapCompany` | HomePage | แปลงแถวฐานข้อมูลเป็นอ็อบเจ็กต์ UI |
| `apis()`, `TABLES`, `UserInfo` | `lib/ezsite.ts` | จุดเข้าถึง API ของแพลตฟอร์ม + รหัสตาราง |
| `fetchAll(tableId, orderBy, asc)` | `lib/ezsite.ts` | ดึงข้อมูลทุกหน้าของตาราง |
| `writeBackup`, `pushToSheet` | `lib/ezsite.ts` | ทุกครั้งที่เพิ่ม/แก้/ลบ จะบันทึกสำเนาลง `dataBackups` และซิงก์ขึ้น Google ชีต |
| `fetchRowById` | `lib/ezsite.ts` | อ่านแถวล่าสุดเพื่อเก็บในสำเนา |
| `useUserLocation`, `distanceInMeters` | `hooks/useUserLocation.ts` | ขอพิกัดและคำนวณระยะทาง (เมตร) |
| `useIsMobile` | `hooks/use-mobile.tsx` | ตรวจหน้าจอมือถือ |
| `toast` | `hooks/use-toast.ts` | แจ้งผลการทำงาน |
| `cn` | `lib/utils.ts` | รวม class Tailwind |
| `CanonicalManager`, `ErrorFallback` | `components/` | จัดการ canonical URL / หน้าจอแสดงข้อผิดพลาด |

---

## 6. ฟังก์ชัน Backend (`__easysite_nodejs__/`)

### 6.1 `attendance/processDailyCheckout` — `processDailyCheckout()`
- **วัตถุประสงค์:** ปิดวันทำงานอัตโนมัติ (ตั้งเวลารันรายวัน)
- **การทำงาน:**
  1. อ่านบันทึกเวลาของ "วันนี้" (เขตเวลา Asia/Bangkok) แปลงวันที่ พ.ศ. → ISO (`thaiDateToISO`)
  2. พนักงานที่ลงเวลาเข้าแต่ไม่ลงออก → สร้างบันทึกออก 17:00 (`method: AUTO`)
  3. พนักงานที่ออกหลัง 17:30 (`parseTimeToMinutes`) → สร้าง OT สถานะ `PENDING` ชั่วโมง = ปัดขึ้นนับจาก 17:00, อัตรา = เงินเดือน/30/8 × 1.5; ไม่สร้างซ้ำถ้ามีของวันนั้นแล้ว
- **ตารางที่เกี่ยวข้อง:** attendance_logs, employees, overtime

### 6.2 `sheets/` — ซิงก์ Google ชีต
| ฟังก์ชัน | หน้าที่ |
|---|---|
| `pushAll()` | ซิงก์ทุกตารางที่สำรองไว้ขึ้นชีต (ปุ่ม "ซิงก์" ใน AppLayout) |
| `pushTable({tableName})` | อ่านข้อมูลตารางหนึ่งแล้วเขียนทับแท็บชีตชื่อเดียวกัน (ใช้ `GOOGLE_SHEET_ID`) |
| `getAccessToken()` | ขอโทเคน Google ด้วย service account (`base64url` สำหรับเซ็น JWT) |
| `ensureSheetExists`, `writeSheetValues` | สร้างแท็บถ้ายังไม่มี / เขียนค่าลงชีต |
| `tables.js` | กำหนดค่าตาราง/คอลัมน์ที่ซิงก์ |

---

## 7. สรุปกฎธุรกิจสำคัญ

1. เบิกล่วงหน้าและเงินประกันลาออก **หักตามเดือนที่กำหนด** ไม่รวมข้ามเดือน
2. ประกันสังคม 5% ของฐาน สูงสุด 750 บาท/เดือน
3. ค่าลงของ 1 บาท/กระสอบ แบ่งเท่ากันให้พนักงานที่มาทำงาน
4. OT = 1.5 เท่าของค่าแรงรายชั่วโมง (เงินเดือน/30/8) เริ่มนับหลัง 17:00 และต้องรออนุมัติ
5. ข้อมูลทุกการเปลี่ยนแปลงถูกสำรองอัตโนมัติ และซิงก์ขึ้น Google ชีตได้
6. การเข้าถึงเมนูและข้อมูลการเงินควบคุมด้วยบทบาทผู้ใช้
