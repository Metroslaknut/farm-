# FARM+ Performance Optimization Plan

**วันที่:** 10 พฤศจิกายน 2026
**ต่อจาก:** [PERFORMANCE_AUDIT_REPORT.md](PERFORMANCE_AUDIT_REPORT.md) (8–9 พ.ย. 2026) ซึ่งแก้ P1–P3, P6, P7, P12–P15 ไปแล้ว
**วิธีตรวจ:** อ่านโค้ดปัจจุบันซ้ำทุกข้อ (ไม่ถือว่าปัญหาในรายงานเดิมยังอยู่) และรัน query probe ใหม่เป็น baseline ของรอบนี้

## 1. Baseline รอบนี้ (วัดจริง 10 พ.ย. 2026)

- `PERF_PROBE=1 npx vitest run test/perf/query-probe.test.ts`, in-memory MongoDB, rtt10 = proxy หน่วงไป-กลับ 10 ms, 15 รอบต่อ endpoint
- Load average ขณะวัด 2.2 (เครื่องว่างพอ)
- ตัวเลขตรงกับ "หลังแก้" ของรายงานเมื่อวาน (เช่น `/auth/me` 83 ms, `/farms/:id/summary` 199 ms) จึงยืนยันว่าโค้ดยังอยู่ในสถานะเดียวกัน

## 2. ยืนยันสถานะงานเดิมกับโค้ดปัจจุบัน

| ข้อเดิม                | ตรวจที่                                        | สถานะในโค้ดปัจจุบัน                                               |
| ---------------------- | ---------------------------------------------- | ----------------------------------------------------------------- |
| P1 auth 6 query ต่อกัน | `middleware/authenticate.ts`, `rbac/access.ts` | แก้แล้ว: session/user/access โหลดพร้อมกัน, `.lean()`              |
| P2 orders N+1          | `orders.service.ts`                            | แก้แล้ว: list = 9 ops (`orders.find, users.find, shipments.find`) |
| P3 sort ในหน่วยความจำ  | models                                         | แก้แล้ว: index `{farmId, <date>:-1, _id:-1}`                      |
| P6 cart N+1            | `cart.service.ts`                              | แก้แล้ว                                                           |
| Farm access            | `farms/farm-access.ts`                         | โหลด Farm และ FarmMember พร้อมกันอยู่แล้ว ไม่ต้องแก้              |

## 3. ปัญหาที่ตรวจพบจริงและแผนแก้ไข

| #   | Pri | ปัญหา                                                        | ไฟล์ / function                                                                        | สาเหตุ                                                                                                                                                                                     | ผลกระทบ                                                                      | แนวทางแก้                                                                                                                                                                                                                           | ความเสี่ยง                                                                             | วิธีทดสอบ                                                           |
| --- | --- | ------------------------------------------------------------ | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| A1  | P0  | `/farms/:id/summary` รอ DB ต่อกัน 7 ขั้น                     | `farms.service.ts` `farmAnimalSummary`, `outsideStandardByType`                        | settings → animals agg → animal_types → weight agg → animals.find → growth standards → trade ทำต่อกัน ทั้งที่หลายตัวไม่ขึ้นต่อกัน; `animals.find` อ่านซ้ำข้อมูลที่ aggregate แรกอ่านมาแล้ว | endpoint ช้าที่สุดของหน้า My Farm (199 ms @rtt10)                            | (1) ทำ settings + animals agg + trade พร้อมกัน (2) ให้ aggregate แรกส่ง breed/sex/birthDate ออกมาเลย จึงตัด `animals.find` (3) ทำ distinct น้ำหนัก, animal_types, weight agg, growth standards พร้อมกัน → เหลือ 2 ขั้น ไม่ใช้ cache | ต่ำ: ผลคำนวณต้องเท่าเดิมทุก field                                                      | `test/my-farm.test.ts`, `growth-standards.test.ts`, probe ก่อน/หลัง |
| A2  | P0  | `/auth/me` อ่าน user แล้วค่อยอ่าน roles                      | `controllers/auth.controller.ts` `me`                                                  | `loadPublicUser(await currentUser())` ต่อกัน 3 ขั้น                                                                                                                                        | ทุกการเปิดแอปเรียก endpoint นี้                                              | อ่าน user และ role keys พร้อมกัน (3 → 2 ขั้น) response เหมือนเดิม                                                                                                                                                                   | ต่ำ                                                                                    | `auth.test.ts`, probe                                               |
| W1  | P0  | หน้า My Farm โหลด `/farms/:id` และ `/farms/me` ซ้ำ           | `useFarmAccess.ts`, `useFarmSetup.ts`, `lib/shared.ts`                                 | `shared()` รวมเฉพาะ request ที่ยิงพร้อมกัน แต่หน้า mount หลัง guard รอ `/farms/me` เสร็จ จึงยิง `/farms/:id` ใหม่ และ summary ต้องรอรอบที่สองนี้                                           | เพิ่ม 1 round trip ในเส้นทางโหลดหน้า และโหลดซ้ำทุกครั้งที่เปลี่ยนหน้าในฟาร์ม | เก็บผลที่สำเร็จไว้สั้น ๆ (`sharedRecent`, 30 วินาที) ล้างทันทีเมื่อมี request แบบแก้ไขข้อมูล (POST/PATCH/PUT/DELETE) หรือเมื่อ token เปลี่ยน; error ไม่ถูกเก็บ                                                                      | ต่ำ–กลาง: ข้อมูลที่ผู้อื่นแก้อาจเห็นช้าสูงสุด 30 วินาที (API ยังตรวจสิทธิ์ทุก request) | web tests ของ farms, e2e My Farm                                    |
| W2  | P1  | `/animal-types` ถูกโหลดใหม่ทุกหน้าในฟาร์ม                    | `AnimalListPage`, `AnimalFormPage`, `FarmFormPage`, `LineagePage`, `FarmDashboardPage` | ไม่มีการใช้ข้อมูลร่วม                                                                                                                                                                      | request ซ้ำทุกครั้งที่เปลี่ยนหน้า                                            | ใช้ `sharedRecent` เดียวกัน (catalog เปลี่ยนเฉพาะ admin)                                                                                                                                                                            | ต่ำ                                                                                    | web tests                                                           |
| B1  | P1  | รายการสัตว์เมื่อเรียงตามรหัสยังเรียงในหน่วยความจำ (P17 เดิม) | `animals.service.ts`                                                                   | ไม่มี index ที่ collation ตรงกับ sort                                                                                                                                                      | ฟาร์มใหญ่อ่านสัตว์ทั้งฟาร์ม                                                  | ตรวจด้วย explain ก่อน แล้วพิจารณา index ใหม่ (additive)                                                                                                                                                                             | ต่ำ (เพิ่ม index อย่างเดียว)                                                           | explain-probe                                                       |

## 4. รายการที่ต้องขออนุมัติก่อน (ไม่แก้ในรอบนี้)

| #   | Pri | เรื่อง                                                   | เหตุที่ต้องรอ                                                                                                                           |
| --- | --- | -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | P0  | Cache ผลของ `/farms/:id/summary` ฝั่ง server             | A1 ลด round trip โดยไม่ต้องใช้ cache แล้ว; cache ข้อมูลจำนวนสัตว์ต้องมีแผน invalidation ข้าม instance ตามข้อกำหนด จึงควรวัดหลัง A1 ก่อน |
| D2  | P1  | Cache ค่า settings ในหน่วยความจำ                         | settings แก้จาก admin; หลาย instance จะเห็นค่าเก่าจนหมด TTL; A1 ทำให้การอ่าน settings ไม่อยู่บนเส้นทางวิกฤติแล้ว                        |
| D3  | P1  | ค้นหาสินค้า: เก็บราคาจริง/คะแนนรีวิวเป็น field (P5 เดิม) | เปลี่ยน schema + migration expand→migrate→contract                                                                                      |
| D4  | P1  | Cursor pagination                                        | เปลี่ยน API contract (`page` → `cursor`) ต้องแก้ web และ mobile พร้อมกัน; index ใหม่ทำให้ skip/limit ที่หน้าต้น ๆ ใช้ index แล้ว        |
| D5  | P2  | แยก i18n catalog ตามส่วนของเว็บ (P9 เดิม)                | `useT` เป็น synchronous; ต้องเปลี่ยนเป็นโหลดแบบ async ทั้งแอป                                                                           |
| D6  | P2  | ย้าย layout/`InboxProvider` ขึ้นระดับ router (P10 เดิม)  | เปลี่ยนโครงสร้าง routing ทั้ง web                                                                                                       |
| D7  | P3  | ค้นหาภาษาไทย (Atlas Search / text index) (P8 เดิม)       | ต้องเลือกเทคโนโลยีและทดสอบผลค้นหาจริง                                                                                                   |
| D8  | P3  | Compression                                              | ต้องรู้ก่อนว่า proxy/CDN ใน production บีบอัดอยู่หรือไม่                                                                                |
| D9  | —   | Redis                                                    | ไม่จำเป็น: ปัญหาที่วัดได้ทั้งหมดแก้ได้ด้วยการลด round trip และ index                                                                    |

## 5. BLOCKED (ต้องขอข้อมูลจากผู้ดูแลระบบ)

Atlas tier/region, region ของ API server, CPU/memory/IOPS, slow query log/profiler, connection pool metrics, network latency, production request logs, Web Vitals บนอุปกรณ์จริง

## 6. ลำดับการทำงาน

1. A1 → ทดสอบ → probe
2. A2 → ทดสอบ → probe
3. W1, W2 → web tests + typecheck
4. B1 → explain ก่อนตัดสินใจ
5. Typecheck, lint, test ที่เกี่ยวข้อง แล้วสรุปใน `performance-optimization-report.md`
