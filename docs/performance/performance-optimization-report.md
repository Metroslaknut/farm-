# FARM+ Performance Optimization Report

**วันที่:** 10 พฤศจิกายน 2026
**แผนงาน:** [optimization-plan.md](optimization-plan.md)
**งานก่อนหน้า:** [PERFORMANCE_AUDIT_REPORT.md](PERFORMANCE_AUDIT_REPORT.md) (8–9 พ.ย.) แก้ P1–P3, P6, P7, P12–P15 แล้ว ในรอบนี้ตรวจกับโค้ดปัจจุบันแล้วยืนยันว่ายังอยู่ครบ

## 1. สรุปสถานะ

| #     | งาน                                                                                                                                                     | สถานะ                                                                                                                                 |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| A1    | `/farms/:id/summary` ลดการรอ DB ต่อกันจาก 7 ขั้นเหลือ 2 ขั้น (ไม่ใช้ cache)                                                                             | **COMPLETED**                                                                                                                         |
| A2    | `/auth/me` อ่าน user และ role พร้อมกัน                                                                                                                  | **COMPLETED**                                                                                                                         |
| W1    | Web: My Farm ใช้ `/farms/me` และ `/farms/:id` ที่ layout โหลดแล้วซ้ำได้ 5 วินาที                                                                        | **COMPLETED** (ยังไม่ได้วัดบนเบราว์เซอร์)                                                                                             |
| W2    | Web: `/animal-types` ใช้ร่วมกันระหว่างหน้าในฟาร์ม 60 วินาที                                                                                             | **COMPLETED** (ยังไม่ได้วัดบนเบราว์เซอร์)                                                                                             |
| B1    | Index สำหรับรายการสัตว์เรียงตามรหัส                                                                                                                     | **NOT STARTED**: index ใช้ได้เฉพาะเรียงจากน้อยไปมาก เพราะ tie-breaker `_id: 1` คงที่ ผลคุ้มค่าต่ำ ควรตัดสินใจจาก explain บนข้อมูลจริง |
| D1–D9 | Cache summary ฝั่ง server, cache settings, ราคา/คะแนนสินค้าแบบ denormalized, cursor pagination, แยก i18n, ย้าย layout, ค้นหาภาษาไทย, compression, Redis | **NOT STARTED**: ต้องขออนุมัติ (เหตุผลในแผนข้อ 4)                                                                                     |
| —     | Atlas metrics, region, production telemetry, Web Vitals                                                                                                 | **BLOCKED**                                                                                                                           |

## 2. รายละเอียดการแก้ไข

### A1 `GET /farms/:id/summary`

`services/api/src/modules/farms/farms.service.ts`: `farmAnimalSummary`, `outsideStandardByType`

- **ก่อนแก้:** อ่าน 7 ขั้นต่อกัน: settings → animals aggregate + distinct น้ำหนัก → animal_types → weight aggregate → `animals.find` → growth standards → listings + orders
- **ขั้นที่ 1 (พร้อมกัน):**
  - setting `farms.growthCheckDays`
  - animals aggregate ซึ่งตอนนี้ส่ง `breed`, `sex`, `birthDate` และ `birthDateEstimated` ของสัตว์ในฟาร์มออกมาด้วย
  - ตัวเลขการซื้อขาย (เฉพาะผู้มีสิทธิ์ `listings.manage` เหมือนเดิม)
- **ขั้นที่ 2 (พร้อมกัน):**
  - distinct น้ำหนักล่าสุด
  - animal_types
  - weight aggregate และ growth standards
- **ตัด `animals.find` ออก** เพราะข้อมูลมาจาก aggregate แรกแล้ว
- **คงเดิม:**
  - สูตรคำนวณ
  - การตรวจสิทธิ์ (`animals.read`, `records.read`, `listings.manage`)
  - รูปแบบ response
- ทุกค่ายังอ่านจากฐานข้อมูลสดทุก request ไม่มี cache

### A2 `GET /auth/me`

`services/api/src/controllers/auth.controller.ts`:

- `User.findById` และ `roleKeysByUser` ทำงานพร้อมกัน แล้วใช้ `toPublicUser` เดิม
- response เหมือนเดิม
- authentication middleware ไม่ถูกแก้

### W1/W2 Web data fetching

- **`apps/web/src/lib/shared.ts`:**
  - เพิ่ม `sharedRecent(key, run, keepMs = 5000)`: ใช้ผลที่**สำเร็จ**ซ้ำได้ภายใน `keepMs`; ผลที่ error ไม่ถูกเก็บ
  - เพิ่ม `forgetRecent()`
  - `shared()` เดิมไม่เปลี่ยน
- **การล้าง cache (invalidation):**
  - `apps/web/src/api.ts`: ทุก request ที่ไม่ใช่ GET ล้าง cache ทั้งก่อนส่ง และหลังได้ผล ผลที่โหลดระหว่างนั้นจะไม่ถูกเก็บ (ตรวจด้วยตัวนับ generation)
  - `apps/web/src/auth/tokens.ts`: ล้าง cache เมื่อ access token เปลี่ยน หรือเมื่อ sign-out เพื่อไม่ให้ข้อมูลของผู้ใช้คนก่อนถูกใช้ซ้ำ
- **จุดที่ใช้:**
  - `pages/farms/useFarmSetup.ts` (`/farms/me`) และ `pages/farms/useFarmAccess.ts` (`/farms/:id`): หน้าที่ mount หลัง guard ได้ข้อมูลฟาร์มจาก layout ทันที จึงไม่ต้องยิง `/farms/:id` ซ้ำ และ summary เริ่มเร็วขึ้น 1 round trip
  - `apps/web/src/lib/animalTypes.ts` (ใหม่) ใช้ใน `AnimalListPage`, `AnimalFormPage`, `FarmFormPage`, `LineagePage` และ `FarmDashboardPage`
- **ข้อแลกเปลี่ยน:** ถ้าผู้ใช้อื่นแก้ฟาร์ม (เช่น archive) ผู้ใช้คนนี้อาจเห็นข้อมูลเก่าได้ไม่เกิน 5 วินาที ส่วน animal types ไม่เกิน 60 วินาที API ยังตรวจสิทธิ์และสถานะฟาร์มทุก action
- **UI:** layout, CSS และข้อความไม่เปลี่ยน

## 3. Benchmark ก่อน/หลัง (วัดจริง)

**วิธีวัด:** `PERF_PROBE=1 npx vitest run test/perf/query-probe.test.ts`

- in-memory MongoDB, 15 รอบต่อ endpoint, ค่ามัธยฐาน
- rtt10 = จำลองความหน่วงเครือข่ายไป-กลับ 10 ms
- load average ขณะวัด: ก่อนแก้ 2.2, หลังแก้ 4.8
- วัดหลังแก้ซ้ำแยกต่างหาก เพราะรอบแรกรันพร้อม web tests

| Endpoint                      |  DB ops | Response bytes | local p50 ms |             rtt10 p50 ms |  rtt10 p95 ms |
| ----------------------------- | ------: | -------------: | -----------: | -----------------------: | ------------: |
| GET /farms/:id/summary        | 17 → 16 |      404 → 404 |  13.8 → 10.7 | **198.9 → 112.1 (−44%)** | 203.8 → 118.1 |
| GET /auth/me                  |   9 → 9 |      272 → 272 |    3.9 → 3.8 |   **83.3 → 71.2 (−15%)** |   90.6 → 82.1 |
| ค่าเฉลี่ย p50 ของ 20 endpoint |       — |     ไม่เปลี่ยน |            — |              91.1 → 85.8 |             — |

- Endpoint อื่นไม่ได้ถูกแก้ ผลต่างอยู่ในช่วง ±3 ms ซึ่งเป็นความผันผวนของการวัด
- Response bytes ไม่เปลี่ยนทุก endpoint ยกเว้น listing detail ที่ต่าง 2 bytes เพราะ id ที่สร้างใหม่แต่ละรอบ
- **Web:** จำนวน request และเวลาโหลดบนเบราว์เซอร์ **NOT MEASURED** ผลที่คาดไว้คือหน้า My Farm ไม่ยิง `/farms/:id` ซ้ำ และไม่ยิง `/animal-types` ซ้ำเมื่อเปลี่ยนหน้า แต่ยังไม่ได้วัดยืนยัน

## 4. Regression Testing

| การทดสอบ                                                                                       | ผล                                                                                      |
| ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `tsc --noEmit` API และ Web                                                                     | ผ่าน                                                                                    |
| ESLint และ Prettier เฉพาะไฟล์ที่แก้                                                            | ผ่าน                                                                                    |
| API `my-farm`, `growth-standards` (ครอบคลุม summary, outsideStandard, needsGrowthCheck, trade) | 20/20 ผ่าน                                                                              |
| API `farms`, `rbac`, `auth`, `oauth`                                                           | 109/109 ผ่าน                                                                            |
| Web ทั้งชุด (381 tests)                                                                        | 378 ผ่าน, 3 ล้มเหลวที่มีอยู่ก่อนแล้ว (`i18n-errors` 1, `shop-ui` 2; ดูรายงานเดิมข้อ 14) |
| API ทั้งชุด, E2E, Mobile                                                                       | **ไม่ได้รัน** (ไม่ได้แก้ mobile)                                                        |

ระหว่างแก้มี test ใหม่ล้มเหลว 1 ตัว: `farms-ui` "refuses to render the form … on an archived farm" test จำลองการที่ฟาร์มถูก archive ระหว่างการ mount 2 ครั้ง ซึ่งเป็นกรณี staleness ตามที่ออกแบบไว้ แก้ 2 ส่วน:

- ลดช่วงเวลาที่ใช้ข้อมูลฟาร์มซ้ำจาก 30 เป็น 5 วินาที
- ให้ test เรียก `forgetRecent()` ระหว่างการ mount 2 ครั้ง เพื่อจำลองว่าเวลาผ่านไปแล้ว

นอกจากนี้ `test/setup.ts` ล้าง cache หลังทุก test

## 5. ไฟล์ที่แก้ไข

- **API:**
  - `services/api/src/modules/farms/farms.service.ts`
  - `services/api/src/controllers/auth.controller.ts`
- **Web:**
  - `apps/web/src/lib/shared.ts`
  - `apps/web/src/lib/animalTypes.ts` (ใหม่)
  - `apps/web/src/api.ts`
  - `apps/web/src/auth/tokens.ts`
  - `apps/web/src/pages/farms/{useFarmSetup,useFarmAccess}.ts`
  - `apps/web/src/pages/farms/{AnimalListPage,AnimalFormPage,FarmFormPage,LineagePage,FarmDashboardPage}.tsx`
- **Tests:**
  - `apps/web/test/setup.ts`
  - `apps/web/test/farms-ui.test.tsx`
- **Docs:**
  - `docs/performance/optimization-plan.md`
  - `docs/performance/performance-optimization-report.md`

**Database index:** ไม่มีการเพิ่มหรือเปลี่ยนแปลงในรอบนี้
**Schema / migration:** ไม่มี

## 6. ความเสี่ยงที่ยังเหลือและงานต่อไป

- **Cache ฝั่ง web:** เป็น cache ต่อแท็บ ล้างเมื่อผู้ใช้แก้ข้อมูลหรือ token เปลี่ยน แต่ไม่รู้การแก้ข้อมูลจากผู้ใช้หรือแท็บอื่น จึงอาจเห็นข้อมูลเก่าได้ไม่เกิน 5 หรือ 60 วินาที
- **Summary:** ยัง aggregate ประวัติน้ำหนักของสัตว์ทุกตัวในฟาร์ม ต้นทุนจะโตตามจำนวน record แนวทางแก้คือเก็บน้ำหนักล่าสุดไว้ใน document ของสัตว์ ซึ่งต้องเปลี่ยน schema และทำ migration จึงต้องขออนุมัติ
- **ต้องขออนุมัติ:** รายการ D1–D9 ในแผน
- **ต้องขอจากผู้ดูแล MongoDB Atlas:**
  - tier และ region ของ Atlas และของ API server
  - กราฟ CPU, memory, IOPS และ connections
  - slow query log หรือ profiler
  - connection pool metrics
  - network latency
  - ผล `db indexes` (dry run) บน cluster จริง
- **ควรวัดเพิ่ม:**
  - E2E My Farm
  - จำนวน request ใน Network tab ก่อน/หลัง
  - วัดซ้ำบน staging เมื่อพร้อม
