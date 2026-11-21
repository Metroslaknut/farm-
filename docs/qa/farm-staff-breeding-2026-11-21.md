# FARM+ — ผู้ดูแลฟาร์มหลายฟาร์ม, สายพันธุ์ไก่ชน และการผสมพันธุ์ไก่: รายงานสรุปผลการพัฒนา

**วันที่:** 2026-11-21 (Asia/Bangkok)
**ขอบเขต:** Module 1–3 ตามข้อกำหนด "Farm Ownership, Farm Staff & Chicken Breeding Management Enhancement" บน Web และ API
**สภาพแวดล้อมทดสอบ:** เครื่อง local (macOS), MongoDB in-memory (`mongodb-memory-server`), Chrome ผ่าน Playwright
**ไม่ได้แตะ:** MongoDB Atlas, staging, production และข้อมูลจริงใด ๆ

## สรุปผู้บริหาร

- **ผู้ดูแลฟาร์ม:** ผู้ใช้หนึ่งคนเป็นเจ้าของหลายฟาร์ม และเป็นผู้ดูแลฟาร์มของผู้อื่นได้พร้อมกัน
  - คนจะเข้าฟาร์มได้ต้องผ่านคำเชิญหรือคำขอเข้าร่วมที่ได้รับอนุมัติเท่านั้น
  - เจ้าของกำหนดสิทธิ์ผู้ดูแลได้ทีละคน
  - ระบบตรวจสิทธิ์ทั้งหมดที่ API ไม่ได้พึ่งหน้าเว็บ
- **สายพันธุ์ไก่ชน:** มี 5 กลุ่ม 39 สายพันธุ์เป็นข้อมูลตั้งต้นในฐานข้อมูล Admin เพิ่ม แก้ไข และปิดใช้งานได้โดยไม่ต้องแก้โค้ด
- **การผสมพันธุ์ไก่:** บันทึกรายการผสม จำนวนไข่และการฟัก แล้วลงทะเบียนลูกไก่ซึ่งเชื่อมกับพ่อแม่จริงให้อัตโนมัติ
  - ระบบแนะนำสายพันธุ์ลูกจากสายพันธุ์พ่อแม่ ผู้ใช้ยืนยันหรือแก้เองได้
  - Pedigree แสดงรุ่น F0/F1/F2 จากพ่อแม่ที่บันทึกจริงเท่านั้น
- **ผลทดสอบ:** API ผ่าน 1,335 ข้อ (ล้ม 1 ข้อที่ไม่เกี่ยวกับงานนี้), Web ผ่าน 387, Mobile ผ่าน 293, e2e บน Chrome ผ่าน 23 ข้อ
- **ก่อน deploy:** ต้องรัน migration `0002-fighting-cock-catalogue` และสร้าง index ใหม่ (ดูหัวข้อ 3)

## 1. สรุปสิ่งที่พัฒนา

### ทำตามแผนที่อนุมัติ: ไม่สร้างระบบซ้ำ

ระบบเดิมมีส่วนสำคัญหลายอย่างอยู่แล้ว ได้แก่ `farm_members` (User↔Farm แบบ N:M), Pedigree และสายเลือด, `breeding_records` พร้อมการลงทะเบียนลูก, ประเภทสัตว์และสายพันธุ์ที่ Admin จัดการได้ รวมถึง Audit Log และ soft delete งานนี้จึงขยายของเดิม ไม่ได้สร้างตารางตามชื่อในข้อกำหนดซ้ำ (เทียบชื่อไว้ในหัวข้อ 3)

### การตัดสินใจของเจ้าของโครงการ (2026-11-21)

| ประเด็น               | ข้อสรุป                                                                                |
| --------------------- | -------------------------------------------------------------------------------------- |
| การเข้าร่วมฟาร์ม      | มีสองทาง: เจ้าของเชิญแล้วผู้รับยอมรับ หรือผู้ใช้ขอเข้าร่วมแล้วเจ้าของอนุมัติ           |
| การจัดการผู้ดูแล      | เป็นสิทธิ์ของเจ้าของฟาร์มเท่านั้น Manager ไม่มีสิทธิ์นี้อีกต่อไป                       |
| API เพิ่มสมาชิกโดยตรง | ใช้ได้เฉพาะ admin แพลตฟอร์มที่มีสิทธิ์ `farms.manage` และยืนยันตัวตน 2 ชั้น (MFA) แล้ว |
| แอปมือถือ             | ไม่เพิ่มหน้าจอใหม่ในรอบนี้ (ทำเฉพาะเว็บ)                                               |

### Module 1: ผู้ดูแลฟาร์มหลายฟาร์ม

- **คำเชิญและคำขอเข้าร่วม** มีสถานะ `PENDING` → `APPROVED`, `REJECTED` หรือ `CANCELLED` และ `APPROVED` → `REVOKED` เมื่อถูกเพิกถอน
  - ระบบสร้างสิทธิ์เข้าฟาร์มเฉพาะตอนที่คำเชิญเป็น `APPROVED` ระหว่าง `PENDING` จึงเข้าถึงข้อมูลไม่ได้เลย
  - การเปลี่ยนสถานะทำแบบ atomic ถ้ามีการกดซ้ำพร้อมกันจะสำเร็จได้ครั้งเดียว
- **สิทธิ์รายคน:** บทบาทเป็นเพดานสิทธิ์ เจ้าของปรับได้เฉพาะให้แคบลง และไม่มีใครแก้สิทธิ์ของตัวเองได้
  - สมาชิกเดิมใช้สิทธิ์ตามบทบาทเหมือนเดิม จึงไม่ต้อง migrate ข้อมูล
- **สิทธิ์ใหม่ `breeding.read/write/correct`:** แยกการผสมพันธุ์ออกจากสิทธิ์บันทึกการเลี้ยง ทุกบทบาทได้สิทธิ์เท่าเดิม
- **ชื่อสิทธิ์ในข้อกำหนดเทียบกับระบบ:**

  | ข้อกำหนด                             | Farm+              |
  | ------------------------------------ | ------------------ |
  | `animal.view`                        | `animals.read`     |
  | `animal.create`, `animal.update`     | `animals.write`    |
  | `animal.delete`                      | `animals.archive`  |
  | `breeding.view`                      | `breeding.read`    |
  | `breeding.create`, `breeding.update` | `breeding.write`   |
  | `breeding.delete`                    | `breeding.correct` |
  | `farm.report.view`                   | `farm.read`        |
  | `farm.staff.manage`                  | `members.manage`   |
  | `farm.settings.manage`               | `farm.update`      |

- **การแจ้งเตือน:** เพิ่ม 5 ประเภท ได้แก่ ได้รับคำเชิญ, คำเชิญถูกยอมรับ, คำเชิญถูกปฏิเสธ, มีผู้ขอเข้าร่วม และคำขอถูกปฏิเสธ
- **หน้าเว็บ:**
  - เมนูใหม่ "จัดการฟาร์ม" ประกอบด้วยข้อมูลฟาร์ม, จัดการผู้ดูแลฟาร์ม และตั้งค่าฟาร์ม
  - หน้าจัดการผู้ดูแล `/farms/:id/staff`
  - หน้าคำเชิญของฉัน `/farms/invitations` พร้อมลิงก์ขอเข้าร่วมฟาร์มที่เจ้าของคัดลอกไปส่งต่อได้
  - หน้าฟาร์มของฉันแยก "ฟาร์มที่ฉันเป็นเจ้าของ" กับ "ฟาร์มที่ฉันเป็นผู้ดูแล" ส่วนการสลับฟาร์มใช้ตัวเลือกฟาร์มเดิมบนแถบด้านบน

### Module 2: สายพันธุ์ไก่ชน

- **ข้อมูลที่เพิ่มในประเภทสัตว์ "ไก่":** การสืบพันธุ์แบบออกไข่, ประเภทการเลี้ยง "ไก่ชน", 5 กลุ่มสายพันธุ์ และ 39 สายพันธุ์ (10/10/4/5/10 ตามข้อกำหนด)
- **ส่วนประกอบสายเลือด (`composition`):** สายพันธุ์ลูกผสมระบุส่วนประกอบไว้ เช่น "พม่า + ไทย" = `burmese, thai` ระบบใช้ค่านี้เพื่อแนะนำสายพันธุ์ลูกเท่านั้น
  - ข้อกำหนดมีบางส่วนที่ไม่ได้เป็นกลุ่ม ("ป่าก๋อย", "บราซิล") จึงใช้คีย์ส่วนประกอบแยก (`pakoi`, `brazil`)
  - สายพันธุ์ต่างประเทศแต่ละตัวนับเป็นส่วนประกอบของตัวเอง
- **ข้อมูลสัตว์:** มีประเภทการเลี้ยงและสายพันธุ์ผสม ส่วนกลุ่มสายพันธุ์อ่านจากข้อมูลตั้งต้นทุกครั้ง ไม่เก็บซ้ำในตัวสัตว์
- **ฟอร์มสัตว์:**
  - dropdown กลุ่มสายพันธุ์ → สายพันธุ์ (ดึงจาก API) และเลือกสายพันธุ์ผสมได้
  - ช่องน้ำหนักแรกรับ ระบบบันทึกเป็นรายการน้ำหนักครั้งแรก
  - แสดงฟาร์มที่สังกัด
- **รายการสัตว์:** กรองตามกลุ่มสายพันธุ์ได้
- **หน้า Admin `/admin/animal-types`:** จัดการประเภทการเลี้ยง กลุ่มสายพันธุ์ กลุ่มและส่วนประกอบของสายพันธุ์ และวิธีการสืบพันธุ์
- **ตัวสะกด:** ข้อกำหนดพิมพ์ "ชамо" ด้วยอักษรรัสเซีย ระบบบันทึกเป็น "ชาโม"

### Module 3: การผสมพันธุ์และสายเลือด

- **รายการผสมพันธุ์:**
  - มีรหัส `BR-00001…` แยกตามฟาร์ม
  - บันทึกจำนวนไข่, ไข่มีเชื้อ, ไข่เข้าฟัก และลูกที่ฟักออก ระบบตรวจว่าไข่มีเชื้อและไข่เข้าฟักไม่เกินจำนวนไข่ และลูกที่ฟักออกไม่เกินไข่เข้าฟัก
- **ลูกไก่:** ลงทะเบียนได้ครั้งละไม่เกิน 50 ตัว เชื่อมพ่อแม่และรับประเภทการเลี้ยงจากพ่อแม่อัตโนมัติ
- **แสดงสายพันธุ์ทันที:** ทั้งตอนเลือกพ่อแม่ในฟอร์มและในรายละเอียดรายการ ระบบแสดงสายพันธุ์และกลุ่มของพ่อแม่ พร้อมสายพันธุ์ลูกที่แนะนำ
  - ตัวอย่าง: ม้าล่อ × เหลืองหางขาว → พม่า + ไทย, F1 × พม่า → พม่า + ไทย, F2 × ไซ่ง่อน → พม่า + ไซ่ง่อน + ไทย
  - เว็บและ API ใช้โค้ดคำนวณชุดเดียวกัน (`@farmplus/shared-utils`)
- **รุ่น F:** ไก่ที่ไม่มีพ่อแม่บันทึกไว้เป็น F0 ลูกเป็นรุ่นสูงสุดของพ่อหรือแม่ + 1 ถ้าทราบพ่อหรือแม่เพียงตัวเดียว ระบบแสดง "ไม่ทราบ" ไม่เดาเอง
- **Pedigree:**
  - แสดงพ่อแม่ ปู่ย่าตายาย (เลือกดูได้ 1–5 รุ่น) และพี่น้องแยกร่วมพ่อแม่/ร่วมพ่อ/ร่วมแม่
  - แสดงลูกทั้งหมด ป้ายรุ่น สายพันธุ์และกลุ่ม คลิกชื่อเพื่อเปิดหน้าสัตว์ตัวนั้นได้
  - มีลิงก์ "ประวัติการผสมพันธุ์" ที่แสดงรายการซึ่งสัตว์ตัวนั้นเป็นพ่อหรือแม่
- **Business rules:**

  | ข้อกำหนด                                             | สถานะ      |
  | ---------------------------------------------------- | ---------- |
  | เพศพ่อและแม่ต้องถูกต้อง, ไม่ใช่ตัวเดียวกัน           | มีอยู่เดิม |
  | ไม่ข้ามฟาร์ม, ไม่มีสายเลือดวนกลับ                    | มีอยู่เดิม |
  | ลูกหนึ่งตัวมีครอกได้ครอกเดียว                        | มีอยู่เดิม |
  | รองรับกรณีไม่ทราบพ่อหรือแม่                          | มีอยู่เดิม |
  | ลบแบบ soft delete และ void                           | มีอยู่เดิม |
  | บันทึก Audit การแก้พ่อหรือแม่ พร้อมค่าก่อนและหลังแก้ | เพิ่มใหม่  |

## 2. รายการไฟล์ที่เพิ่มและแก้ไข

รวม 61 ไฟล์ที่แก้ไข และ 14 ไฟล์ใหม่ (+3,057 / −389 บรรทัดในไฟล์ที่แก้ไข)

**ไฟล์ใหม่**

| ส่วน   | ไฟล์                                                                                                                                                                                                                                                                                 |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| API    | `services/api/src/models/farm-invitation.model.ts`, `services/api/src/modules/farms/invitations.service.ts`, `services/api/src/modules/farms/invitations.routes.ts`, `services/api/src/modules/animal-types/fighting-cock-catalogue.ts`                                              |
| Shared | `packages/shared-utils/src/breeding.ts`                                                                                                                                                                                                                                              |
| Web    | `apps/web/src/pages/farms/FarmStaffPage.tsx`, `apps/web/src/pages/farms/MyInvitationsPage.tsx`, `apps/web/src/pages/farms/staffLabels.ts`                                                                                                                                            |
| Tests  | `services/api/test/farm-invitations.test.ts`, `services/api/test/fighting-cock-breeding.test.ts`, `services/api/test/breed-suggestion.test.ts`, `services/api/test/perf/pedigree-probe.test.ts`, `apps/web/test/farm-staff-ui.test.tsx`, `e2e/tests/farm-staff-and-breeding.spec.ts` |

**ไฟล์ที่แก้ไข**

| ส่วน                          | ไฟล์                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Shared                        | `packages/shared-types/src/{farms,records,notifications,index}.ts`, `packages/validation/src/{farms,records}.ts`, `packages/shared-utils/src/index.ts`, `packages/i18n/src/errors.ts`                                                                                                                                                                                                                                                                                                |
| API models/db                 | `services/api/src/models/{farm-member,animal-type,animal,breeding-record,farm,index}.model.ts`, `services/api/src/db/{registry.ts,migrations/index.ts}`                                                                                                                                                                                                                                                                                                                              |
| API modules                   | `services/api/src/modules/farms/{farm-access,members.service,farms.controller,farms.routes,farms.service}.ts`, `services/api/src/modules/animal-types/{service,controller,routes,seed}.ts`, `services/api/src/modules/animals/animals.service.ts`, `services/api/src/modules/breeding/{breeding.service,breeding.routes}.ts`, `services/api/src/modules/records/history.service.ts`, `services/api/src/modules/notifications/{events,templates}.ts`, `services/api/src/routes/v1.ts` |
| Web                           | `apps/web/src/pages/farms/{FarmsApp,FarmListPage,AnimalFormPage,AnimalDetailPage,AnimalListPage,LineagePage,FarmOverviewPage}.tsx`, `apps/web/src/pages/farms/shell/FarmShell.tsx`, `apps/web/src/pages/farms/records/{RecordForm,BreedingActions,PedigreePage}.tsx` และ `recordConfigs.ts`, `apps/web/src/pages/admin/animal-types/index.tsx`, `apps/web/src/pages/inbox/notificationText.ts`, `apps/web/src/i18n/messages/{farms,admin,inbox}.ts`                                  |
| Tests เดิมที่ปรับตามกติกาใหม่ | `services/api/test/{helpers,farms,notifications}.test.ts`, `services/api/test/workflows/audit-b-g.test.ts`, `services/api/test/qa/{authz-allowlists.ts,routes.snapshot.txt,query-plans.test.ts}`, `apps/web/test/farms-ui.test.tsx`, `e2e/tests/{audit-ui-journeys,business-workflows}.spec.ts`                                                                                                                                                                                      |
| Docs                          | `docs/architecture/farms.md`, `docs/architecture/records.md`                                                                                                                                                                                                                                                                                                                                                                                                                         |

## 3. Database Schema ที่เปลี่ยนแปลง

**เทียบชื่อตารางในข้อกำหนดกับระบบ**

| ข้อกำหนด                                                            | Farm+                                                                      |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `farms`, `farm_members`, `animals`, `breeding_records`              | ใช้ collection เดิม                                                        |
| `farm_invitations`                                                  | collection ใหม่                                                            |
| `farm_permissions`                                                  | ค่าสิทธิ์อยู่ในโค้ด `FARM_PERMISSIONS`                                     |
| `farm_member_permissions`                                           | `farm_members.permissions`                                                 |
| `farm_audit_logs`                                                   | `audit_logs` เดิม                                                          |
| `animal_breed_groups`, `animal_breeds`, `animal_breed_compositions` | ฝังอยู่ใน `animal_types` (`breedGroups`, `breeds`, `breeds[].composition`) |
| `animal_parent_relationships`                                       | `animals.sireId` / `animals.damId` เดิม                                    |
| `breeding_offspring`                                                | `breeding_records.delivery.offspring` เดิม                                 |

**การเปลี่ยนแปลง** (ทุกจุดเป็นการเพิ่มฟิลด์ใหม่แบบ optional ไม่ลบหรือเปลี่ยนชื่อฟิลด์เดิม ข้อมูลเดิมยังใช้ได้)

| Collection                | สิ่งที่เปลี่ยน                                                                                                                                                                                                                                                        |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `farm_invitations` (ใหม่) | ฟิลด์ `farmId, userId, direction(invite/request), status, role, permissions, message, createdBy, decidedBy/At, endedBy/At` พร้อม timestamps<br>Index: unique partial `(farmId, userId)` เมื่อ `PENDING`, `(farmId, status, createdAt)`, `(userId, status, createdAt)` |
| `farm_members`            | เพิ่ม `permissions` (null = ใช้สิทธิ์ตามบทบาท), `invitationId`, `invitedAt`, `approvedAt`                                                                                                                                                                             |
| `animal_types`            | เพิ่ม `reproduction`, `rearingTypes[]`, `breedGroups[]`, `breeds[].groupKey`, `breeds[].composition`                                                                                                                                                                  |
| `animals`                 | เพิ่ม `rearingType`, `crossBreeds[]`<br>Index ใหม่ `(farmId, breed)` (index `sireId` และ `damId` มีอยู่เดิม)                                                                                                                                                          |
| `breeding_records`        | เพิ่ม `code`, `clutch{eggsLaid, eggsFertile, eggsSet, chicksHatched}`<br>Index unique partial `(farmId, code)`                                                                                                                                                        |
| `farms`                   | เพิ่ม `breedingSeq` (ตัวนับรหัส BR-)                                                                                                                                                                                                                                  |

**Migration `0002-fighting-cock-catalogue`**

- เพิ่มประเภทการเลี้ยง กลุ่มสายพันธุ์ และสายพันธุ์ไก่ชนเฉพาะรายการที่ยังไม่มีในประเภทสัตว์ "ไก่"
- ไม่ลบหรือแก้ข้อมูลเดิม รันซ้ำได้ปลอดภัย (ทดสอบแล้ว)
- ตั้งค่าไก่และเป็ดเป็นสัตว์ออกไข่ เฉพาะเมื่อยังไม่มีค่านี้
- การติดตั้งใหม่ได้ข้อมูลชุดเดียวกันจากข้อมูลตั้งต้น

**ขั้นตอนก่อน deploy** (ทำกับ staging ก่อน และต้องได้รับอนุมัติก่อนทำกับ production):

```bash
pnpm --filter @farmplus/api db migrate            # ดูรายการที่จะรัน
pnpm --filter @farmplus/api db migrate --apply
pnpm --filter @farmplus/api db indexes --apply    # สร้าง index ใหม่เท่านั้น ไม่ลบของเดิม
```

**Transaction:** ไม่ได้ใช้ MongoDB transaction การบันทึกการฟักใช้วิธีเดิม คือจองรายการก่อน แล้วย้อนกลับถ้ามีขั้นตอนไหนล้มเหลว ดูหัวข้อ 7

## 4. API ที่เพิ่ม

ทุก route อยู่ใต้ `/api/v1` ทุกเส้นต้องเข้าสู่ระบบ ตรวจสิทธิ์ที่ฝั่ง API และฟาร์มที่ไม่มีสิทธิ์จะตอบ 404

| Method       | Path                                                             | สิทธิ์                                  |
| ------------ | ---------------------------------------------------------------- | --------------------------------------- |
| GET          | `/farm-invitations?status=`                                      | เจ้าของคำเชิญเอง                        |
| POST         | `/farm-invitations/requests`                                     | ผู้ใช้ทุกคน (จำกัดจำนวนครั้ง)           |
| POST         | `/farm-invitations/:id/accept` · `/decline` · `/cancel`          | เจ้าของคำเชิญหรือคำขอนั้น               |
| GET · POST   | `/farms/:farmId/invitations`                                     | `members.manage` (POST จำกัดจำนวนครั้ง) |
| POST         | `/farms/:farmId/invitations/:id/cancel` · `/approve` · `/reject` | `members.manage`                        |
| PUT          | `/farms/:farmId/members/:memberId/permissions`                   | `members.manage`                        |
| POST         | `/farms/:farmId/breeding/:id/clutch`                             | `breeding.write`                        |
| POST · PATCH | `/animal-types/:id/rearing-types[/:key]`                         | `animal_types.manage`                   |
| POST · PATCH | `/animal-types/:id/breed-groups[/:key]`                          | `animal_types.manage`                   |

**ส่วนที่ขยายจาก API เดิม**

- `GET /farms?relation=owned|managed`
- `GET /farms/:id/animals?breedGroup=&rearingType=`
- `GET /farms/:id/breeding?animalId=`
- ฟิลด์ใหม่ในการสร้าง/แก้ไขสัตว์ สายพันธุ์ และรายการผสมพันธุ์
- ข้อมูลรุ่น F และสายพันธุ์ใน `GET …/animals/:id/lineage`

**ความแตกต่างจากชื่อในข้อกำหนด:**

- ใช้ path แบบเดิม `/api/v1/farms/...` ไม่ใช่ `/api/farms/...`
- ใช้ `memberId` แทน `userId` ใน path ของสมาชิก
- ใช้ `/lineage` เดิมแทน `/pedigree`, `/offspring` และ `/siblings`
- `DELETE` สายพันธุ์ใช้การปิดใช้งาน (`active: false`) แทนการลบ

## 5. ผลการทดสอบ

ทุกรายการรันจริงบนเครื่อง local วันที่ 2026-11-21

| ชุดทดสอบ                                 | Passed | Failed | หมายเหตุ                                                                                                                                                                                   |
| ---------------------------------------- | -----: | -----: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| API ทั้งชุด (vitest + in-memory MongoDB) |  1,335 |      1 | ล้ม: `security-static` "no real credential pattern" เพราะไฟล์ `.env` และ `.env.render-staging` ในเครื่องมีรหัสผ่านจริง ไม่ใช่ปัญหาของโค้ด (3 ข้อ skip คือ perf probe ที่รันเฉพาะเมื่อสั่ง) |
| เฉพาะส่วนใหม่ใน API                      |     26 |      0 | `farm-invitations` 11, `fighting-cock-breeding` 12, `breed-suggestion` 3 (นับรวมอยู่ใน 1,335 แล้ว)                                                                                         |
| Query plans (`qa/query-plans`)           |     30 |      0 | query ใหม่ 7 รายการใช้ index ทั้งหมด ไม่สแกนทั้ง collection                                                                                                                                |
| QA authz และ permission matrix           |   ผ่าน |      0 | route ใหม่ 16 เส้นผ่านการตรวจสิทธิ์ และสิทธิ์ระดับแพลตฟอร์มไม่กว้างขึ้น                                                                                                                    |
| Web unit tests                           |    387 |      0 | หน้าใหม่ 6 ข้อ                                                                                                                                                                             |
| Mobile tests                             |    293 |      0 | ไม่มีหน้าจอใหม่ แต่ใช้ types และ validation ร่วมกัน                                                                                                                                        |
| e2e (Playwright, Chrome)                 |     23 |      0 | ใหม่ 3 ข้อ: ผู้ดูแลฟาร์ม, ผสมพันธุ์และฟักไก่, responsive ที่ 375 และ 820 px                                                                                                                |
| typecheck / lint / format:check          |   ผ่าน |      — | ทุก workspace                                                                                                                                                                              |
| `qa:audit` (dependency)                  |      — |    ล้ม | ช่องโหว่ใน dependency เดิม เช่น undici, mongoose, node-forge ไม่ได้เพิ่มหรือแก้ dependency ใด ๆ                                                                                            |

**สิ่งที่ข้อกำหนดขอให้ทดสอบ: ทั้งหมดมีเทสต์อัตโนมัติและผ่าน**

- เป็นเจ้าของหลายฟาร์ม และเป็นทั้งเจ้าของและผู้ดูแลพร้อมกันได้
- ต้องได้รับอนุมัติก่อน (ระหว่างรอได้ 404) และเข้าถึงได้เฉพาะฟาร์มที่ได้รับอนุญาต
- เพิ่มสิทธิ์ให้ตัวเองไม่ได้ และหลังถูกเพิกถอนเรียก API ทุกเส้นของฟาร์มนั้นไม่ได้
- แสดงครบ 5 กลุ่ม 39 สายพันธุ์ เพิ่ม แก้ และปิดใช้งานได้โดยประวัติสัตว์เดิมไม่เสีย
- เพศผิดถูกปฏิเสธ, F1/F2/F3, ป้องกันสายเลือดวนกลับ, รองรับกรณีไม่ทราบพ่อหรือแม่ และมี Audit การแก้สายเลือด
- Migration เพิ่มข้อมูลโดยไม่แตะของเดิม และรันซ้ำได้

**Performance:** วัดด้วย `test/perf/pedigree-probe.test.ts` บนฟาร์มสายเลือด 6 รุ่นและไก่ 500+ ตัว 15 รอบต่อ endpoint

- p95 บนเครื่อง local อยู่ที่ 7–25 ms ทุก endpoint
- เมื่อจำลองเวลาเดินทางไปกลับฐานข้อมูล 10 ms: Pedigree ~174–179 ms ซึ่งช้าที่สุด (18 DB ops ในนั้นราว 7 ops เป็นของการยืนยันตัวตนที่ทุก request มี) ส่วนรายการผสมพันธุ์และรายการสัตว์ ~105–108 ms และผู้ดูแลกับคำเชิญ ~88–90 ms
- ตัวเลขจากเครื่อง local ใช้เปรียบเทียบได้ แต่ไม่ใช่ benchmark ของ production

**Bundle (gzip):** JS ที่โหลดตอนเปิดเว็บไม่เปลี่ยน (78.4 kB) ส่วนฟาร์ม +5.9 kB, ส่วน Admin +0.9 kB และ chunk ที่ใช้ร่วมซึ่งมีข้อความแปลอยู่ด้วย +6.5 kB

## 6. ปัญหาที่พบและวิธีแก้

| ปัญหา                                                                                          | วิธีแก้                                                                                                                       |
| ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| ข้อกำหนดให้เจ้าของอนุมัติคำเชิญที่ตัวเองส่ง และให้ Manager ไม่จัดการผู้ดูแล ซึ่งขัดกับระบบเดิม | สอบถามเจ้าของโครงการแล้วทำตามข้อสรุปในหัวข้อ 1                                                                                |
| ระบบไม่มีฟิลด์ username                                                                        | ค้นหาผู้ใช้ด้วยอีเมลหรือเบอร์โทรที่ตรงทั้งหมดเท่านั้น และจำกัดจำนวนครั้ง เพื่อกันการไล่ดึงรายชื่อผู้ใช้ทั้งหมด                |
| ลูกผสมบางสายระบุส่วนที่ไม่ได้เป็นกลุ่ม (ป่าก๋อย, บราซิล)                                       | ให้ส่วนประกอบสายเลือดใช้คีย์ของตัวเองได้                                                                                      |
| เทสต์เดิม 83 จุดเพิ่มสมาชิกด้วย API ที่ตอนนี้จำกัดสิทธิ์แล้ว                                   | เปลี่ยน helper `addFarmMember` ให้เชิญแล้วยอมรับผ่าน API จริง และปรับเทสต์ที่ตรวจพฤติกรรมเก่าให้ตรงกติกาใหม่                  |
| Manager ที่ถูกปิดสิทธิ์ซื้อขายยังเข้าแชทกับผู้ซื้อได้                                          | การแชทและการแจ้งเตือนฝั่งผู้ขายตรวจสิทธิ์รายคนด้วยแล้ว                                                                        |
| e2e WF-UI-B06 ล้ม เพราะ selector `getByLabel('Animal')` จับได้ 3 element                       | เปลี่ยนเป็น `getByRole('combobox', { name: /^Animal/ })` (selector นี้ไม่เกี่ยวกับโค้ดที่แก้ แต่ยังไม่ได้รันเทียบกับโค้ดเดิม) |
| `networkidle` ใน e2e ไม่เกิดขึ้น เพราะแอปเปิด realtime connection ค้างไว้                      | รอให้ข้อความกำลังโหลดหายไปแทน                                                                                                 |
| `inbox-ui` ล้มเมื่อรันพร้อม e2e                                                                | รันแยกแล้วผ่าน 23/23 (เป็นอาการเดิมเมื่อเครื่องโหลดหนัก)                                                                      |

## 7. ข้อจำกัดที่ยังเหลือ

- **ไม่ได้ใช้ MongoDB transaction:** การบันทึกการฟักและการสร้างลูกยังใช้วิธีจองรายการแล้วย้อนกลับเมื่อผิดพลาด การเปลี่ยนไปใช้ transaction ต้องแก้โค้ดสร้างสัตว์ที่ใช้ร่วมกับส่วนอื่น
- **แอปมือถือ:** ไม่มีหน้าผู้ดูแลฟาร์ม คำเชิญ การผสมพันธุ์ หรือ Pedigree ฟอร์มสัตว์บนมือถือยังไม่มี dropdown กลุ่มสายพันธุ์ แต่ API รองรับแล้ว
- **การขอเข้าร่วมฟาร์ม:** ผู้ขอต้องได้ลิงก์หรือรหัสฟาร์มจากเจ้าของก่อน ยังไม่มีระบบค้นหาฟาร์ม
- **โอนกรรมสิทธิ์ฟาร์ม:** ยังไม่ได้พัฒนา ข้อกำหนดระบุให้รอข้อกำหนดที่ชัดเจน
- **รูปประกอบการผสมพันธุ์:** ยังเป็นแบบแนบลิงก์ ยังไม่มีการอัปโหลดไฟล์
- **การโหลด Pedigree:** โหลดบรรพบุรุษทีละรุ่น ถ้าสายเลือดลึกมากและฐานข้อมูลอยู่ไกล จะช้าลงตามจำนวนรุ่น
- **Dependency:** `qa:audit` แจ้งช่องโหว่ใน dependency เดิม ควรอัปเกรดแยกเป็นงานต่างหาก

## 8. รายการที่ยังไม่ได้ทดสอบ

รายการต่อไปนี้ยังไม่ได้ทดสอบจริง จึงไม่ถือว่า Passed

- รัน migration `0002` และสร้าง index กับ MongoDB Atlas, staging หรือ production
- Load test ซึ่งต้องมี environment แยกและได้รับอนุญาตก่อน
- Safari, Firefox และอุปกรณ์มือถือจริง (ทดสอบแล้วเฉพาะ Chrome ที่ 375/820 px)
- การส่งการแจ้งเตือนผ่านช่องทางนอกแอป (ระบบรองรับเฉพาะการแจ้งเตือนในแอป)
- ประสิทธิภาพบน Atlas จริง (วัดแล้วเฉพาะแบบจำลองเวลาเดินทาง 10 ms)

**วิธีรันซ้ำ:**

```bash
cd services/api && npx vitest run test/farm-invitations.test.ts test/fighting-cock-breeding.test.ts test/breed-suggestion.test.ts
cd apps/web && npx vitest run test/farm-staff-ui.test.tsx
cd e2e && E2E_CHROME=1 npx playwright test tests/farm-staff-and-breeding.spec.ts
cd services/api && PERF_PROBE=1 npx vitest run test/perf/pedigree-probe.test.ts
```
