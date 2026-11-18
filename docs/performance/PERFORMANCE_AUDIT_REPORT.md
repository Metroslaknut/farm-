# FARM+ Performance Audit Report

**วันที่ตรวจ:** 8–9 พฤศจิกายน 2026
**ขอบเขต:** Repository, การวัดบนเครื่อง local (in-memory MongoDB) และผล `explain()` ไม่ได้เข้าถึง Production, Staging หรือ MongoDB Atlas
**รายงานฉบับก่อนหน้า** (8 พ.ย. 2026 ภาษาอังกฤษ) เก็บไว้ครบใน[ภาคผนวก B](#ภาคผนวก-b-รายงานฉบับก่อนหน้า-8-พย-2026)

---

## 1. Executive Summary

สาเหตุหลักที่ระบบช้าไม่ใช่ query ตัวใดตัวหนึ่ง แต่เป็น**จำนวน round trip ที่ API ต้องรอฐานข้อมูลต่อกันในแต่ละ request**:

- ทุก request ที่ login แล้ว ต้อง query ต่อกัน 6 ครั้งเพื่อตรวจ session และสิทธิ์ก่อนเริ่มงานจริง
- หลายรายการมี N+1 (query แยกต่อแถว)
- รายการที่ใช้บ่อยต้องเรียงข้อมูลในหน่วยความจำ เพราะ index ไม่ตรงกับรูปแบบ query

เมื่อฐานข้อมูลอยู่บน Atlas ซึ่งทุก round trip ต้องผ่านเครือข่าย ต้นทุนเหล่านี้จะคูณกับ latency ของเครือข่าย

แก้แบบความเสี่ยงต่ำ: ไม่เปลี่ยน UI, API contract, business logic หรือ schema และเพิ่มเฉพาะ index ใหม่ ไม่ลบ index เดิม ผลที่**วัดจริง**บนเครื่องเดียวกันด้วยข้อมูลและเงื่อนไขเดียวกัน:

- เวลาตอบสนองเฉลี่ยของ 20 endpoint หลัก ภายใต้ความหน่วงฐานข้อมูลจำลอง 10 ms: **p50 143 → 91 ms (−36%)**, **p95 151 → 96 ms (−37%)**
- รายการคำสั่งซื้อของผู้ซื้อ: **31 → 9 DB operations** ต่อ request; ตะกร้า: **207 → 86 ms**
- รายการสุขภาพ อาหาร น้ำหนัก ผสมพันธุ์ สัตว์ คำสั่งซื้อ และประกาศขาย: อ่าน **5,000 → 20 documents** ต่อหน้า และไม่ต้องเรียงในหน่วยความจำอีก
- ที่ 100 connection พร้อมกัน รายการสัตว์รับโหลดได้ **520 → 930 req/s** และ p50 ลดจาก **187 → 102 ms**
- ทุกรอบไม่มี error

**ยังเป็น BLOCKED:**

- Atlas metrics (CPU, IOPS, slow query, connections)
- Region ของ API และ Atlas
- Production telemetry
- Web Vitals บนอุปกรณ์จริง

ทั้งหมดนี้ต้องขอข้อมูลจากผู้ดูแลระบบ ตัวเลขในรายงานนี้เป็นการวัดแบบสัมพัทธ์บนเครื่อง local ไม่ใช่ capacity ของ production

## 2. Architecture ที่ตรวจสอบ

| Layer    | Implementation                                                                                   | หมายเหตุด้าน performance                                                                                                |
| -------- | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| Web      | React 19 + Vite + react-router (`apps/web`)                                                      | แยก chunk ตามส่วนของเว็บด้วย `React.lazy` แต่หน้าในแต่ละส่วนยังโหลดรวมกัน; ใช้ hook `useAsync` เอง (ไม่มี React Query)  |
| Mobile   | Expo Router (`apps/mobile`)                                                                      | ไม่ได้วัดในรอบนี้                                                                                                       |
| API      | Express 5 + Mongoose 9, REST `/api/v1`                                                           | ทุก route ที่ login แล้วผ่าน `authenticate` → `resolveAccess`; route ใต้ `/farms/:farmId` ผ่าน `farm-access.ts` อีกชั้น |
| Database | MongoDB Atlas / Mongoose; index ประกาศใน model; production สร้าง index ผ่าน `db indexes --apply` | ไม่มี `$text` index หรือ Atlas Search; การค้นหาทั้งหมดใช้ `$regex`                                                      |
| Cache    | Analytics cache ในหน่วยความจำของแต่ละ instance (TTL 60 วินาที)                                   | ไม่มี cache อื่น และไม่มี Redis                                                                                         |
| Realtime | Socket.IO (instance เดียว)                                                                       | Web เชื่อมต่อใหม่ทุกครั้งที่เปลี่ยนส่วนของเว็บ                                                                          |

## 3. วิธีวัดและ Performance Baseline

**สภาพแวดล้อม:**

- Apple M1, 8 cores, RAM 8 GB, Node v26.5.0
- MongoDB in-memory บนเครื่องเดียวกัน
- วัดหลังรีสตาร์ทเครื่อง load average 1 นาทีต่ำกว่า 4 และปิด Antigravity แล้ว

ก่อนหน้านั้นเครื่องใช้ swap เต็มและ load average เกิน 70 ทำให้วัดไม่ได้

**Baseline:** วัดจาก**สำเนาของโค้ดเดิม** ซึ่งสร้างจากโค้ดปัจจุบันแล้ว revert ทุกจุดที่แก้ วัดสลับกับโค้ดใหม่ด้วยข้อมูลชุดเดียวกัน (repository ไม่ได้เป็น git จึงใช้วิธีนี้)

เครื่องมือวัดมี 3 ตัว ตัวแรกและตัวที่สองอยู่ใน repo และรันเฉพาะเมื่อตั้ง `PERF_PROBE=1`:

1. **Query probe:** [services/api/test/perf/query-probe.test.ts](../../services/api/test/perf/query-probe.test.ts)
   - Seed ข้อมูลผ่าน API จริง: สัตว์ 800 ตัว, บันทึกน้ำหนัก 480 รายการ, บันทึกสุขภาพ 200 รายการ, สินค้า 30 รายการ, คำสั่งซื้อ 12 รายการ, ประกาศขาย 60 รายการ, ห้องแชต 10 ห้อง, โพสต์ 40 รายการ
   - เรียกแต่ละ endpoint ทีละ request 15 รอบ
   - นับจำนวน MongoDB operation ด้วย Mongoose debug hook (ไม่ขึ้นกับ CPU)
   - วัด latency 2 แบบ: ต่อฐานข้อมูลตรง ("local") และต่อผ่าน TCP proxy ที่หน่วงไป-กลับ 10 ms ("rtt10") เพื่อจำลองการต่อ Atlas ผ่านเครือข่าย

   ```bash
   cd services/api && PERF_PROBE=1 PERF_OUT=/tmp/perf.json npx vitest run test/perf/query-probe.test.ts
   ```

2. **Explain probe:** [services/api/test/perf/explain-probe.test.ts](../../services/api/test/perf/explain-probe.test.ts)
   - สร้าง index ตาม model
   - Insert ข้อมูล 5,000 records ต่อฟาร์ม (10,000 ต่อ collection)
   - รัน `explain("executionStats")` ด้วย filter, sort และ collation เดียวกับที่ service ใช้จริง

3. **Load test:** `e2e/load/load-test.mjs` เดิม (autocannon) ใช้สัตว์ 3,000 ตัวและประกาศขาย 400 รายการ รันสำเนาที่ปรับให้เลือก API ฝั่งก่อนหรือหลังแก้ และกำหนดจำนวน connection ได้ ที่ 10, 50 และ 100 connection พร้อมกัน scenario ละ 6 วินาที

## 4. รายการปัญหาที่พบ

| #   | ระดับ  | ปัญหา                                                                                                    | หลักฐาน                                           | สถานะ                                          |
| --- | ------ | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------- | ---------------------------------------------- |
| P1  | High   | ทุก request ที่ login แล้วต้อง query ต่อกัน 6 ครั้ง                                                      | `authenticate.ts`, `rbac/access.ts`               | **แก้แล้ว**                                    |
| P2  | High   | รายการคำสั่งซื้อมี N+1 ถอดรหัสที่อยู่ทิ้ง และเขียน audit log ทุกแถว                                      | `orders.service.ts` `page()` → `toOrderDTO`       | **แก้แล้ว**                                    |
| P3  | High   | รายการบันทึก สัตว์ คำสั่งซื้อ และประกาศขาย เรียงข้อมูลในหน่วยความจำ                                      | explain: `SORT` stage, อ่าน 2,500–5,000 docs      | **แก้แล้ว** (เพิ่ม index)                      |
| P4  | High   | `/farms/:id/summary` ใช้ 17 operations ไม่มี cache และ aggregate ประวัติน้ำหนักทั้งฟาร์ม                 | probe: 17 ops, 240 ms @rtt10                      | ยังไม่แก้ (ข้อ 17)                             |
| P5  | High   | ค้นหาสินค้าในร้านค้าใช้ aggregate ทั้งชุด และเรียงตามค่าที่คำนวณใหม่ทุก request                          | `shop.service.ts` `$addFields` → `$facet`/`$sort` | ยังไม่แก้ (ต้องเปลี่ยน schema)                 |
| P6  | Medium | ตะกร้าเช็กสิทธิ์ทีละสินค้าแบบรอต่อกัน (N+1)                                                              | `cart.service.ts`                                 | **แก้แล้ว**                                    |
| P7  | Medium | Badge แชตที่ยังไม่อ่าน อ่านข้อความทั้งประวัติ                                                            | explain: 10,000 docs                              | **แก้แล้ว** (index)                            |
| P8  | Medium | การค้นหาทุกจุดใช้ `$regex` ที่ไม่สนตัวพิมพ์และไม่ได้ขึ้นต้นด้วยคำค้น จึงใช้ index ไม่ได้                 | listings/products/animals/health services         | ยังไม่แก้ (ต้องเลือกวิธีค้นหาภาษาไทย)          |
| P9  | Medium | Web: ทุกหน้าโหลด chunk ร่วม 618 KB เพราะ import ข้อความแปลภาษาทั้ง 12 ชุดตั้งแต่ต้น                      | `apps/web/src/i18n/index.ts`, build ใน `dist/`    | ยังไม่แก้                                      |
| P10 | Medium | Web: layout และ Socket.IO เริ่มใหม่ทุกครั้งที่เปลี่ยนส่วนของเว็บ และโหลดตะกร้าใหม่ทุกครั้งที่เปลี่ยนหน้า | `PublicLayout`, `FarmShell`, `SiteHeader`         | ยังไม่แก้ (กระทบโครงสร้าง routing)             |
| P11 | Medium | Web: หน้า My Farm รอข้อมูลต่อกัน 4 ขั้น และเรียก `/farms/me`, `/farms/:id`, `/animal-types` ซ้ำ          | `FarmShell`, `useFarmSetup`, `FarmHomePage`       | ยังไม่แก้                                      |
| P12 | Low    | รายการแจ้งเตือนคำนวณจำนวนแชตที่ยังไม่อ่านแล้วทิ้ง; รายการแชตมี query ที่ไม่ได้ใช้ผล                      | `notifications/service.ts`, `chat.service.ts`     | **แก้แล้ว**                                    |
| P13 | Low    | Records, listings, posts และ products ใน DTO builder ดึงข้อมูลต่อกันทั้งที่ดึงพร้อมกันได้                | serializers ใน services                           | **แก้แล้ว**                                    |
| P14 | Low    | `/shop/categories` ถูกเรียก 3 ครั้งในหน้าแรก                                                             | `App.tsx`, `SiteHeader.tsx`                       | **แก้แล้ว**                                    |
| P15 | Low    | หน้า Live ยัง polling เมื่อผู้ใช้อยู่แท็บอื่น                                                            | `pages/live/*`                                    | **แก้แล้ว**                                    |
| P16 | Low    | API ไม่บีบอัด response (ไม่มี gzip/brotli)                                                               | `app.ts`                                          | ยังไม่แก้ (ตรวจ proxy/CDN ของ production ก่อน) |
| P17 | Info   | รายการสัตว์เมื่อเรียงตามรหัส/ชื่อ ยังเรียงในหน่วยความจำ                                                  | explain after                                     | ยังไม่แก้                                      |

## 5. Root Cause ของแต่ละปัญหา

- **P1:** `authenticateToken` อ่าน Session แล้วรอ อ่าน User แล้วรอ จากนั้นเรียก `resolveAccess` ที่อ่าน UserRole → Role → RolePermission → Permission ต่อกันอีกทอด แม้หลายตัวไม่ได้ขึ้นต่อกัน ทั้งหมดอ่านเป็น Mongoose document เต็มรูปแบบ
- **P2:** `toOrderDTO` ออกแบบไว้สำหรับหน้ารายละเอียดคำสั่งซื้อ แต่ `page()` เรียกซ้ำทุกแถว ทำให้:
  - อ่าน `authorsById` และ `Shipment.find` แยกต่อคำสั่งซื้อ
  - ถอดรหัสที่อยู่ (HKDF + AES) แล้วทิ้ง เพราะรายการตั้ง `address: undefined`
  - ฝั่งผู้ขายบันทึก audit `order.address_viewed` ทั้งที่ไม่ได้แสดงที่อยู่
- **P3:** Query เรียงแบบ `{date: -1, _id: -1}` แต่ index มีแค่ `{farmId, date}` ไม่มี `_id` ต่อท้าย MongoDB จึงใช้ index เรียงไม่ได้ ส่วนรายการสัตว์ใช้ collation `{locale: 'en', strength: 2, numericOrdering: true}` ที่ไม่ตรงกับ index ใดเลย
- **P4:** `outsideStandardByType` ดึง id สัตว์ทั้งฟาร์ม แล้ว `$match` น้ำหนักทุกรายการในประวัติก่อน `$group`; settings อ่านจาก DB ทุกครั้งโดยไม่มี cache
- **P5:** ราคาจริงและคะแนนรีวิวไม่ได้เก็บเป็น field จึงต้องคำนวณใน pipeline ทุกครั้ง ทำให้ใช้ index ในการเรียงและนับไม่ได้
- **P6:** `for … await isSellerSide()` ทีละสินค้า
- **P7:** Index ที่มีคือ `{conversationId, seq}` จึงต้องอ่านทุกข้อความในห้องแล้วกรอง `readAt: null` ทีหลัง
- **P8:** `$regex` ที่ไม่ได้ anchor และใช้ option `i` ใช้ขอบเขตของ index ไม่ได้
- **P9–P11:** โครงสร้างโค้ดฝั่ง web ตามรายละเอียดในข้อ 6

## 6. ผลการตรวจสอบ Frontend

ส่วนที่ทำไว้ดีแล้ว:

- ช่องค้นหาส่ง request ตอนกด submit ไม่ได้ส่งทุกครั้งที่พิมพ์
- รายการทั้งหมดแบ่งหน้าแล้ว
- รูปในการ์ดใช้ `loading="lazy"` และกำหนด aspect ratio
- hls.js โหลดแบบ dynamic import
- Video player โหลดเฉพาะคลิปปัจจุบันและคลิปข้างเคียง

ปัญหาที่พบ:

- **Bundle (P9):**
  - Chunk ร่วม 618 KB ถูก `modulepreload` ทุกหน้า และ entry อีก 255 KB (ขนาดก่อนบีบอัด จาก build วันที่ 7 พ.ย.)
  - ข้อความแปลภาษาทั้ง 12 ชุด (ราว 430 KB source) รวมของ admin 126 KB ถูกโหลดในหน้าสาธารณะด้วย
  - zod และ validation ถูกรวมไว้ใน chunk ร่วม
  - `vite.config.ts` ไม่มี `manualChunks`
- **Data fetching (P10, P11):**
  - `InboxProvider` และ Socket.IO อยู่ในแต่ละ layout จึงเชื่อมต่อใหม่ทุกครั้งที่เปลี่ยนส่วนของเว็บ
  - Header โหลดตะกร้าใหม่ทุกครั้งที่ `pathname` เปลี่ยน
  - `shared()` รวมเฉพาะ request ที่ยิงพร้อมกัน จึงไม่ช่วยกรณีที่ page mount หลัง guard โหลดเสร็จแล้ว
- **อื่น ๆ:**
  - Dropdown สัตว์ในฟอร์มดึง `pageSize: 100` ทำให้ฟาร์มที่มีสัตว์เกิน 100 ตัวเห็นไม่ครบ ซึ่งเป็นปัญหาความถูกต้องด้วย
  - ฟอนต์ 2 ตระกูล × 4 น้ำหนัก
  - ฟีดวิดีโอใช้ `preload="metadata"` ทุกคลิป
- **ไม่ได้วัด:** Core Web Vitals, waterfall จริงบนเบราว์เซอร์ และ mobile → N/A

## 7. ผลการตรวจสอบ Backend

- ไม่พบ `.populate()` หรือ `$lookup`
- ทั้งโค้ดมี `.lean()` ประมาณ 10 จุด
- Connection pool ใช้ค่า default ของ driver (maxPoolSize 100)
- Login ใช้ `scrypt` (N=2^15) แบบ async ซึ่งเป็นต้นทุนด้านความปลอดภัยที่ตั้งใจ จึงไม่ควรลด
- Rate limiter และ analytics cache อยู่ในหน่วยความจำของแต่ละ instance

ผลวัด (query probe, 15 รอบ/endpoint, ค่ามัธยฐาน):

| Endpoint                               | DB ops ก่อน → หลัง | Response bytes | local p50 ms |     rtt10 p50 ms |  rtt10 p95 ms |
| -------------------------------------- | -----------------: | -------------: | -----------: | ---------------: | ------------: |
| GET /auth/me                           |              9 → 9 |            272 |    4.9 → 4.0 |     122.1 → 83.0 |  136.1 → 87.3 |
| GET /notifications/unread-count        |              9 → 9 |             58 |    5.5 → 5.2 |     109.7 → 71.6 |  114.6 → 74.7 |
| GET /notifications                     |             10 → 8 |          1,684 |    6.3 → 5.0 |     123.7 → 59.0 |  132.7 → 60.1 |
| GET /farms/me                          |            10 → 10 |            238 |    6.0 → 5.2 |     109.2 → 71.3 |  115.1 → 74.4 |
| GET /farms/:id                         |              9 → 9 |            535 |    6.4 → 5.8 |     112.7 → 74.7 |  120.7 → 79.4 |
| GET /farms/:id/summary                 |            17 → 17 |            404 |  15.2 → 13.7 |    239.9 → 200.4 | 249.1 → 205.3 |
| GET /farms/:id/animals (20 แถว)        |            11 → 11 |          6,826 |    6.8 → 6.3 |     129.8 → 87.7 |  140.9 → 91.9 |
| GET /farms/:id/animals?sort=animalCode |            11 → 11 |          6,826 |    7.2 → 5.8 |     126.9 → 86.6 |  131.0 → 90.7 |
| GET /farms/:id/animals/:animalId       |            12 → 12 |            475 |    6.3 → 6.3 |    152.2 → 113.4 | 161.9 → 123.8 |
| GET /farms/:id/health                  |            12 → 12 |          8,106 |    7.6 → 6.6 |     142.6 → 88.4 |  157.3 → 93.0 |
| GET /farms/:id/weights                 |            12 → 12 |          7,906 |    7.4 → 6.5 |     144.5 → 85.6 |  148.0 → 92.8 |
| GET /farms/:id/orders (ผู้ขาย)         |            18 → 10 |          6,847 |    7.7 → 6.0 |     159.6 → 87.6 |  163.9 → 94.0 |
| GET /orders (ผู้ซื้อ)                  |         **31 → 9** |         20,513 |    9.1 → 6.5 |     130.2 → 77.5 |  139.5 → 82.1 |
| GET /marketplace/listings              |            12 → 12 |         18,275 |    7.7 → 7.2 |     143.4 → 90.1 |  147.2 → 93.5 |
| GET /marketplace/listings/:id          |            12 → 12 |            921 |    6.4 → 4.9 |     138.8 → 86.3 |  145.2 → 92.2 |
| GET /shop/products                     |            12 → 12 |         26,558 |    7.5 → 6.9 |    157.3 → 103.2 | 164.3 → 108.1 |
| GET /shop/products/:id                 |            12 → 12 |          1,113 |    7.0 → 5.7 |     149.0 → 97.5 | 159.7 → 100.4 |
| GET /shop/cart                         |            15 → 10 |          2,370 |    8.4 → 6.1 | **207.0 → 85.9** |  215.2 → 90.0 |
| GET /conversations                     |            13 → 12 |            391 |    6.0 → 5.5 |     123.0 → 86.6 |  129.7 → 91.1 |
| GET /posts (feed)                      |            11 → 11 |          7,155 |    7.3 → 6.0 |     139.2 → 86.6 |  146.8 → 90.5 |

หมายเหตุการอ่านตาราง:

- หลาย endpoint มีจำนวน ops เท่าเดิม แต่ latency ที่ rtt10 ลดลง เพราะ query ที่ไม่ขึ้นต่อกันทำงาน**พร้อมกัน**แทนการรอต่อกัน
- ทุก endpoint ได้ประโยชน์ราว 35–40 ms จาก P1
- Response bytes ไม่เปลี่ยน (ขนาดสัตว์ต่างกัน 2 bytes เพราะ id ต่างกัน) แปลว่า API contract คงเดิม

## 8. ผลการตรวจสอบ MongoDB Atlas

**BLOCKED:** ไม่มีสิทธิ์เข้าถึง Atlas จึงไม่มีข้อมูลต่อไปนี้:

- CPU, memory, disk IOPS, connections, network
- read/write latency, slow query log, profiler
- จำนวน document จริงในแต่ละ collection

ข้อมูลที่ต้องขอจากผู้ดูแลระบบ:

- Atlas tier และ region
- กราฟ metrics ช่วงที่ผู้ใช้รายงานว่าช้า
- Profiler หรือ slow query (ตัดข้อมูลส่วนบุคคลออก)
- ผล `db indexes` (dry run) ของ cluster จริง

ผล `explain("executionStats")` บน in-memory MongoDB (5,000 records ต่อฟาร์ม, หน้าละ 20 แถว):

| Query (ตามที่ service ใช้จริง)                                                      | ก่อน: plan                                     | ก่อน: keys / docs | หลัง: plan                              | หลัง: keys / docs |
| ----------------------------------------------------------------------------------- | ---------------------------------------------- | ----------------: | --------------------------------------- | ----------------: |
| สัตว์ (default) `{farmId, archivedAt:null}` sort `{createdAt:-1,_id:1}` + collation | SORT > FETCH > IXSCAN                          |     5,000 / 5,000 | LIMIT > FETCH > IXSCAN                  |           20 / 20 |
| สัตว์ เรียงตามรหัส                                                                  | SORT > FETCH > IXSCAN                          |     5,000 / 5,000 | SORT (ไม่เปลี่ยน)                       |     5,000 / 5,000 |
| สุขภาพ `{farmId, voided:false}` sort `{recordedOn:-1,_id:-1}`                       | SORT > FETCH > IXSCAN                          |     5,000 / 5,000 | LIMIT > FETCH > IXSCAN                  |           20 / 20 |
| น้ำหนัก sort `{weighedOn:-1,_id:-1}`                                                | SORT                                           |     5,000 / 5,000 | index                                   |           20 / 20 |
| อาหาร sort `{date:-1,_id:-1}`                                                       | SORT                                           |     5,000 / 5,000 | index                                   |           20 / 20 |
| ผสมพันธุ์ sort `{breedingDate:-1,_id:-1}`                                           | SORT                                           |     5,000 / 5,000 | index                                   |           20 / 20 |
| คำสั่งซื้อผู้ขาย (ไม่กรอง status)                                                   | FETCH > SORT > IXSCAN                          |        2,500 / 21 | LIMIT > FETCH > IXSCAN                  |           21 / 21 |
| ประกาศขายของฟาร์ม (ไม่กรอง status)                                                  | FETCH > SORT > IXSCAN                          |        2,500 / 20 | LIMIT > FETCH > IXSCAN                  |           20 / 20 |
| Badge แชต: aggregate `{conversationId $in 20, readAt:null}`                         | GROUP > FETCH > IXSCAN `{conversationId, seq}` |   10,000 / 10,000 | IXSCAN `{conversationId, readAt, side}` |         100 / 100 |

เวลา execution ฝั่งก่อนแก้อยู่ที่ 2–33 ms ที่ 5,000 records และจะโตตามจำนวน record ของฟาร์ม ฝั่งหลังแก้อยู่ที่ 0–1 ms และคงที่ตามขนาดหน้า

## 9. ผลการตรวจสอบ Network และ Infrastructure

- ยังไม่ได้ deploy staging (ตาม README Part 19) จึงตรวจสิ่งต่อไปนี้ไม่ได้: region ของ API เทียบกับ Atlas, DNS/TLS, keep-alive, CDN, load balancer, cold start และ resource ของ server → **BLOCKED**
- **การบีบอัด:** API ไม่มี gzip/brotli middleware ถ้า reverse proxy หรือ CDN ใน production ไม่บีบอัดให้ response รายการขนาด 18–27 KB จะส่งเต็มขนาด
- **ผลจากการจำลอง:** การจำลองความหน่วง 10 ms ไป-กลับ ทำให้ endpoint ส่วนใหญ่ใช้ 110–240 ms แม้ฐานข้อมูลประมวลผลไม่ถึง 10 ms แปลว่า **ระยะทางระหว่าง API กับ Atlas สำคัญมาก** ควรให้ API และ Atlas อยู่ region เดียวกันก่อนพิจารณาขยาย tier
- **ระหว่างพัฒนา:**
  - การรัน API บนเครื่อง developer ต่อ Atlas dev DB ผ่านอินเทอร์เน็ต จะช้ากว่า production โดยธรรมชาติ
  - เครื่องที่ใช้ตรวจเคยมี swap เต็มเพราะแอปอื่นใช้ CPU ราว 670% ทำให้ทุกอย่างช้าโดยไม่เกี่ยวกับโค้ด

## 10. รายการ API ที่ช้า (หลังแก้, rtt10 p50)

1. `GET /farms/:id/summary`: 200 ms, 17 ops (P4)
2. `GET /farms/:id/animals/:animalId`: 113 ms, 12 ops; รายละเอียดสัตว์โหลด type, parents และนับลูกต่อกัน
3. `GET /shop/products`: 103 ms (P5); ช้าลงตามจำนวนสินค้า ACTIVE
4. `GET /farms/:id/dashboard?fresh=true`: ประมาณ 25 aggregations; load test p50 202–422 ms ที่ 50–100 connection
5. `POST /auth/login`: 156–2,346 ms ตามจำนวนผู้ใช้พร้อมกัน เพราะ scrypt ใช้ CPU มาก ซึ่งตั้งใจไว้ด้านความปลอดภัย

## 11. Query ที่ต้องปรับปรุงต่อ

- `farms.service.ts` `outsideStandardByType`: จำกัด `$match` ด้วยช่วงวันที่ หรือเก็บน้ำหนักล่าสุดไว้ใน document ของสัตว์
- `shop.service.ts` `searchProducts`: เก็บ `effectivePriceMinor` และ `avgRating` เป็น field แล้วใช้ `find` + `countDocuments` แทน `$facet` (ต้องมี migration)
- `listings.service.ts` `searchListings`: เพิ่ม index `{status, 'animal.animalTypeId', activatedAt:-1, _id:-1}` และเลิกใช้ `^…$` กับ option `i` ในการกรองจังหวัด/สายพันธุ์
- `posts.service.ts` (trending): index `{status, visibility, createdAt, engagement, _id}` เรียง field ผิดลำดับ (range อยู่ก่อน sort) จึงใช้ไม่ได้ ต้องตรวจด้วย explain ก่อนแก้
- การค้นหาด้วยข้อความ: พิจารณา Atlas Search ที่มี Thai analyzer หรือเก็บ field ที่ normalize แล้ว และค้นแบบขึ้นต้นด้วยคำค้น

## 12. Index ที่เพิ่มและเหตุผล

ทุกตัวเป็น index **ใหม่** ไม่ได้แก้หรือลบ index เดิม จึงย้อนกลับได้โดยไม่ต้องทำ migration:

- Production: สร้างด้วย `db indexes --apply --confirm-db <name>` ตามขั้นตอน release ใน `docs/ops/migrations.md` และควรรันช่วงที่ระบบเงียบ
- Dev/test: `syncIndexes()` สร้างให้ตอนเปิด API

| Collection       | Index                                                                                         | เหตุผล                                          | ผลต่อการเขียน                          |
| ---------------- | --------------------------------------------------------------------------------------------- | ----------------------------------------------- | -------------------------------------- |
| health_records   | `{farmId:1, recordedOn:-1, _id:-1}`                                                           | default sort ของรายการ                          | +1 index ต่อ insert/update วันที่      |
| feeding_records  | `{farmId:1, date:-1, _id:-1}`                                                                 | เหมือนกัน                                       | เหมือนกัน                              |
| weight_records   | `{farmId:1, weighedOn:-1, _id:-1}`                                                            | เหมือนกัน                                       | เหมือนกัน                              |
| breeding_records | `{farmId:1, breedingDate:-1, _id:-1}`                                                         | เหมือนกัน (เดิมไม่มี index สำหรับ breedingDate) | เหมือนกัน                              |
| animals          | `{farmId:1, archivedAt:1, createdAt:-1, _id:1}` collation `{en, strength 2, numericOrdering}` | default sort; collation ต้องตรงกับ query        | +1 index; archive/restore อัปเดต index |
| orders           | `{farmId:1, createdAt:-1, _id:-1}`                                                            | รายการผู้ขายเมื่อไม่กรอง status                 | +1 index ต่อคำสั่งซื้อ                 |
| listings         | `{farmId:1, createdAt:-1, _id:-1}`                                                            | รายการประกาศของฟาร์มเมื่อไม่กรอง status         | +1 index ต่อประกาศ                     |
| messages         | `{conversationId:1, readAt:1, side:1}`                                                        | badge ข้อความที่ยังไม่อ่าน                      | +1 index ต่อข้อความ และอัปเดตเมื่ออ่าน |

ข้อสังเกต:

- **ไม่มี unique index ใหม่** จึงไม่ต้องตรวจข้อมูลซ้ำก่อนสร้าง
- **Index ที่อาจซ้ำซ้อน และพิจารณาลบได้ใน release ถัดไป** ตามขั้นตอน contract ใน `migrations.md`:
  - `health_records {farmId, recordedOn:1}`, `feeding_records {farmId, date:1}`, `weight_records {farmId, weighedOn:1}`: index ใหม่ครอบคลุมแล้ว
  - `listing_events.listingId`: เป็น prefix ของ `{listingId, at, _id}`
  - ต้องยืนยันด้วยสถิติการใช้ index (`$indexStats`) บน Atlas ก่อนลบ

## 13. รายการไฟล์ที่แก้ไข

**API:**

- `services/api/src/middleware/authenticate.ts`: Session, User และ access โหลดพร้อมกันด้วย `.lean()`; ลำดับการตรวจและ error code คงเดิม
- `services/api/src/rbac/access.ts`: เพิ่ม `loadAccess()` (3 ขั้นแทน 4 ขั้น, `.lean()` + projection); `resolveAccess()` คง signature เดิม
- `services/api/src/modules/orders/orders.service.ts`:
  - `toOrderDTO` รับ `preloaded` และ `withAddress` เพิ่ม (default คงเดิม)
  - `page()` โหลด people และ shipments ครั้งเดียวต่อหน้า
  - รายการไม่ถอดรหัสที่อยู่และไม่บันทึก `address_viewed` เพราะรายการไม่แสดงที่อยู่อยู่แล้ว
  - หน้ารายละเอียดคำสั่งซื้อยัง audit เหมือนเดิม
- `services/api/src/modules/products/cart.service.ts`: ใช้ `sellerFarmIds()` ครั้งเดียวแทน N+1
- `services/api/src/modules/notifications/service.ts`: นับเฉพาะแจ้งเตือนที่ยังไม่อ่าน พร้อมกับการดึงรายการ
- `services/api/src/modules/chat/chat.service.ts`: ตัด query ที่ไม่ได้ใช้ผลออก
- `services/api/src/modules/{health,feeding,animal-growth,breeding}/*.service.ts`: `metaFor` และ `animalLites` ทำงานพร้อมกัน
- `services/api/src/modules/marketplace/listings.service.ts`, `community/posts.service.ts`, `products/products.service.ts`: ย้ายการดึงผู้เขียนหรือสมาชิกเข้า `Promise.all` เดิม
- `services/api/src/modules/animals/animals.service.ts`, `src/models/index.ts`: แก้ type error ที่มีอยู่ก่อนแล้ว (`toSummary` รับ lean row ได้); เป็นการแก้ type อย่างเดียว ไม่มีผลตอน runtime
- `services/api/src/models/{health-record,feeding-record,weight-record,breeding-record,animal,order,listing,message}.model.ts`: index ใหม่ตามข้อ 12
- `services/api/test/perf/query-probe.test.ts`, `explain-probe.test.ts` (ใหม่): เครื่องมือวัด รันเฉพาะเมื่อตั้ง `PERF_PROBE=1`

**Web:**

- `apps/web/src/lib/shopCategories.ts` (ใหม่) ใช้ใน `App.tsx`, `components/layout/SiteHeader.tsx` และ `pages/shop/BrowsePage.tsx`: request ของ `/shop/categories` ที่ยิงพร้อมกันใช้ร่วมกัน (ไม่ cache)
- `apps/web/src/lib/shared.ts`: คืน promise ต้นฉบับโดยตรง ไม่ผ่าน `.finally` ทำให้ resolve เร็วขึ้น 1 microtask; พฤติกรรมอื่นคงเดิม
- `apps/web/src/lib/poll.ts` (ใหม่) ใช้ใน `pages/live/Live{List,Viewer,Host}Page.tsx`: ข้าม polling เมื่อแท็บถูกซ่อน และโหลดใหม่ทันทีเมื่อกลับมา

UI, layout, CSS, ข้อความ และ API response ไม่มีการเปลี่ยนแปลง

## 14. ผลการทดสอบ

| การทดสอบ                                           | ผล                                                                   |
| -------------------------------------------------- | -------------------------------------------------------------------- |
| `tsc --noEmit` API                                 | ผ่าน                                                                 |
| `tsc --noEmit` Web                                 | ผ่าน                                                                 |
| ESLint และ Prettier เฉพาะไฟล์ที่แก้                | ผ่าน                                                                 |
| API unit/integration ทั้งชุด (vitest, 1,290 tests) | 1,285 ผ่าน, 2 skipped, **3 ล้มเหลว** (รายละเอียดด้านล่าง)            |
| Web tests ทั้งชุด (381 tests)                      | 378 ผ่าน, **3 ล้มเหลว** (รายละเอียดด้านล่าง)                         |
| Load test 10/50/100 connection ก่อนและหลัง         | ไม่มี error, timeout หรือ status ผิดปกติ; API ยัง ready หลังจบทุกรอบ |
| E2E (Playwright)                                   | **ไม่ได้รัน**                                                        |
| Mobile tests                                       | **ไม่ได้รัน**; ไม่มีการแก้โค้ด mobile                                |

Test ที่ล้มเหลว ตรวจแล้วทั้งหมดว่า**ไม่ได้เกิดจากการแก้ครั้งนี้**:

1. `api test/qa/security-static.test.ts`: ไฟล์ `.env` ของเครื่องมี Mongo URI พร้อมรหัสผ่าน เป็นปัญหาของสภาพแวดล้อม ไม่ใช่โค้ด
2. `api test/qa/authz-matrix.test.ts` route inventory: route `GET /animal-photos/:key` และ `POST /farms/:farmId/animals/:animalId/photos` มาจากงานอัปโหลดรูปสัตว์ก่อนหน้า **ต้องมีคนตรวจ authorization ก่อน** แล้วจึง regenerate snapshot ด้วย `UPDATE_QA_SNAPSHOTS=1`
3. `api test/rbac.test.ts` concurrent permission replacements: flaky เมื่อรันทั้งชุด; รันแยก 3 รอบผ่าน 32/32 ทุกรอบ และ test นี้ไม่ได้ใช้ `resolveAccess`
4. `web test/i18n-errors.test.ts`: test สแกนเจอรหัสข้อมูล mockup (`F01`, `S01` ใน `scripts/mockup/catalog.ts`) แล้วนับเป็น error code
5. `web test/shop-ui.test.tsx` 2 tests: test หา dropdown "Category" และ heading "ร้านค้า" ซึ่งไม่มีในหน้าร้านค้าแล้ว เพราะ layout ถูกเปลี่ยนก่อนหน้า (`BrowsePage` ไม่ใช้ key `browse.category`)

ระหว่างแก้ ผมทำให้ test 7 ตัวใน `home`, `shop-ui` และ `register-social` ล้มเหลวชั่วคราว เพราะ test เหล่านั้น mock โมดูล `../src/api` แล้วผมเพิ่ม export ใหม่เข้าไป แก้แล้วโดยย้าย helper ไปไว้ที่ `lib/shopCategories.ts` จึงไม่ต้องแก้ test

## 15. Performance Comparison

| Metric                                                                      |            Before |             After |                              Improvement |
| --------------------------------------------------------------------------- | ----------------: | ----------------: | ---------------------------------------: |
| API Average (ค่าเฉลี่ย p50 ของ 20 endpoint, rtt10)                          |          143.0 ms |           91.2 ms |                                   −36.3% |
| API P95 (ค่าเฉลี่ย p95 ของ 20 endpoint, rtt10)                              |          150.9 ms |           95.8 ms |                                   −36.6% |
| API p50 ต่อ DB ตรง (ค่าเฉลี่ยของ 20 endpoint)                               |            7.3 ms |            6.3 ms |                                   −14.7% |
| DB operations ต่อ request (ค่าเฉลี่ย)                                       |              12.9 |              11.0 |                                   −14.7% |
| Dashboard Load: `/farms/:id/summary` (rtt10 p50)                            |          239.9 ms |          200.4 ms |                                   −16.5% |
| Dashboard Load: `/dashboard?fresh=true` (load test p50, 10 / 50 / 100 conn) | 42 / 232 / 427 ms | 43 / 202 / 422 ms |    ไม่ต่างอย่างมีนัยสำคัญ (ยังไม่ได้แก้) |
| Database Query: รายการบันทึก (docs examined ต่อหน้า)                        |             5,000 |                20 |                                   −99.6% |
| Database Query: badge แชต (docs examined)                                   |            10,000 |               100 |                                     −99% |
| Animals page: load test req/s (10 / 50 / 100 conn)                          |   590 / 538 / 520 |   908 / 957 / 930 |                       +54% / +78% / +79% |
| Animals page: load test p50 (10 / 50 / 100 conn)                            |  16 / 90 / 187 ms |  10 / 50 / 102 ms |                       −38% / −44% / −45% |
| Unread counters: p99 @100 conn                                              |          1,851 ms |            723 ms |                                     −61% |
| Chat message write: p99 @50 conn                                            |            318 ms |            146 ms |                                     −54% |
| Marketplace search: load test p50 @100 conn                                 |            245 ms |            238 ms | ไม่ต่างอย่างมีนัยสำคัญ (ยังไม่ได้แก้ P8) |
| Frontend Load / Web Vitals                                                  |               N/A |               N/A |             N/A (ไม่ได้วัดบนเบราว์เซอร์) |

ข้อสังเกตที่ต้องรายงานตามจริง:

- Load test `POST /auth/login` ที่ 100 connection ได้ 49 → 33 req/s และ p50 1,971 → 2,346 ms ผมไม่ได้แก้ login path ซึ่งใช้ CPU หนักจาก scrypt จึงน่าจะเป็นความผันผวนจากการวัดเพียงรอบเดียว ที่ 10 และ 50 connection ผลแทบไม่เปลี่ยน (51 → 50 และ 47 → 48 req/s) ควรวัดซ้ำบน staging
- Marketplace search p99 @100 conn: 982 → 1,155 ms ซึ่งอยู่ในช่วงความผันผวนของการวัดรอบเดียว
- ตัวเลขทั้งหมดมาจากเครื่อง local เครื่องเดียวที่ load generator, API และ MongoDB อยู่ด้วยกัน จึงใช้ดู**ทิศทางและสัดส่วน**ได้ แต่ใช้ประเมิน capacity ของ production ไม่ได้

## 16. ปัญหาที่ยังไม่สามารถแก้ไขได้

- **ต้องรออนุมัติ เพราะกระทบ architecture, schema หรือ UX:**
  - P4: cache ของ summary พร้อมวิธี invalidation
  - P5: field ราคาและคะแนนรีวิวที่คำนวณไว้ล่วงหน้า พร้อม migration
  - P8: วิธีค้นหาข้อความภาษาไทย
  - P10: ย้าย layout และ `InboxProvider` ขึ้นไประดับบนสุดของ router
  - P9: โหลดข้อความแปลภาษาแยกตามส่วนของเว็บ
- **BLOCKED (ไม่มีสิทธิ์หรือยังไม่มี environment):** Atlas metrics, region, production/staging telemetry, Web Vitals, mobile
- **ต้องให้คนตรวจ:** route snapshot ของงานอัปโหลดรูปสัตว์ (ข้อ 14)
- **ยังไม่ได้รัน:** E2E (Playwright)

## 17. ข้อเสนอแนะสำหรับการพัฒนาต่อ (เรียงตามผลกระทบต่อผู้ใช้ เทียบกับความเสี่ยง)

1. **ตรวจ region:** ให้ API server และ Atlas อยู่ region เดียวกัน ผลจำลองชี้ว่าความหน่วงเครือข่ายเป็นต้นทุนหลัก
2. **หน้า My Farm:**
   - ฝั่ง backend: cache `summary` สั้น ๆ แยกตามฟาร์มและสิทธิ์ แบบเดียวกับ analytics cache ที่มีอยู่ และจำกัดช่วงข้อมูลน้ำหนักที่ aggregate
   - ฝั่ง web: ใช้ข้อมูล `/farms/me` และ `/farms/:id` ที่ shell โหลดไว้แล้ว แทนการโหลดซ้ำ
3. **Web bundle:** โหลดข้อความแปลภาษาแยกตามส่วนของเว็บ และตั้ง `manualChunks` ให้ zod/validation
4. **Layout และ realtime:** ย้าย `InboxProvider` และ layout ขึ้นไประดับบนสุด เพื่อไม่ให้ socket เชื่อมต่อใหม่ทุกครั้งที่เปลี่ยนส่วนของเว็บ และโหลดตะกร้าใหม่เฉพาะเมื่อตะกร้าเปลี่ยน
5. **ค้นหาสินค้า:** เก็บราคาจริงและคะแนนรีวิวเป็น field แล้วใช้ index ทำ migration แบบ expand → migrate → contract
6. **การค้นหาข้อความ:** ประเมิน Atlas Search ที่มี Thai analyzer
7. **Monitoring:**
   - Log ปัจจุบันมี duration ของ request อยู่แล้ว ควรตั้ง dashboard และ alert สำหรับ p95 แยกตาม route บนระบบ log ของ production
   - เปิด Atlas Performance Advisor และ profiler (slowms 100)
   - เก็บ Web Vitals ด้วย `web-vitals`
8. **Compression:** ตรวจว่า proxy หรือ CDN ใน production บีบอัด response หรือไม่ ถ้าไม่ ให้เพิ่มที่ proxy ก่อนเพิ่มใน Express
9. **Index:** เมื่อ release นี้เสถียรแล้ว ตรวจ `$indexStats` แล้วลบ index ที่ซ้ำซ้อนตามข้อ 12 ด้วย migration แบบ contract
10. **วัดซ้ำบน staging:** ใช้ `query-probe` และ `e2e/load/load-test.mjs` ชี้ไปที่ staging เมื่อพร้อม

---

## ภาคผนวก A: ข้อจำกัดของการวัด

- **รันทุกอย่างบนเครื่องเดียว:** API, MongoDB in-memory และตัวยิงโหลดอยู่บนเครื่องเดียวกัน
- **Latency เครือข่ายเป็นการจำลอง:** "rtt10" ใช้ TCP proxy หน่วงคงที่ 5 ms ต่อทิศทาง ไม่มี jitter และไม่มี TLS
- **เงื่อนไขวัดเท่ากันทั้งสองฝั่ง:** Baseline และ After ใช้ข้อมูล seed ชุดเดียวกัน ขนาดเท่ากัน ต่อกันในช่วงเวลาเดียวกัน บนเครื่องที่ load average ต่ำกว่า 4
- **Load test วัดรอบเดียว:** ต่อ scenario ต่อระดับ connection วัดเพียงรอบเดียว (6 วินาที) ค่า p99 จึงผันผวนได้
- **รายงานฉบับก่อนหน้าไม่ได้วัดใหม่:** ตัวเลขในฉบับก่อนหน้า (ภาคผนวก B) มาจากผลวัดวันที่ 13 ต.ค. ไม่ได้รันใหม่ในรอบนั้น

## ภาคผนวก B: รายงานฉบับก่อนหน้า (8 พ.ย. 2026)

ข้อความต่อจากนี้คือรายงานฉบับเดิมทั้งฉบับ ไม่ได้แก้ไข ข้อสรุปในฉบับนั้นถูกแทนที่ด้วยข้อ 1–17 ข้างบนแล้ว

### FARM+ Performance Audit Report

**Audit date:** 8 November 2026  
**Scope:** Repository and locally available performance evidence. No production or staging systems were accessed.

#### 1. Executive summary

FARM+ is a TypeScript monorepo with a React/Vite web client, Expo/React Native mobile client, Express 5/Mongoose API, MongoDB, and a worker skeleton. Main web areas are already lazy loaded; analytics already uses short lived, permission-scoped in-process caching. The codebase defines query indexes for major workflows and contains a synthetic load harness.

The strongest available performance evidence is the recorded local load run from 13 October 2026 (3,000 animals, 400 listings, in-memory MongoDB on the same host). It shows the animal list and marketplace search have higher latency than cached dashboard reads. An animal list optimization was applied: select only fields needed by the list DTO and use Mongoose lean reads. No fresh before/after performance run completed in this audit environment, so no speedup is claimed.

**Blocked:** Atlas metrics and production/staging request telemetry are unavailable. A fresh local harness attempt could not complete: the sandbox initially denied MongoDB's localhost listener (`EPERM`); an approved retry remained in startup without results and was stopped. The existing recorded result is therefore historical evidence, not a new measurement.

#### 2. Architecture inspected

| Layer      | Implementation                                                                                                              | Evidence                                                         |
| ---------- | --------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Web        | React 19, Vite 8, TypeScript, React Router                                                                                  | `apps/web`, `apps/web/src/main.tsx`                              |
| Mobile     | Expo 57, React Native 0.86, Expo Router                                                                                     | `apps/mobile`                                                    |
| API        | Express 5, REST under `/api/v1`, Mongoose 9                                                                                 | `services/api/src/app.ts`, `services/api/src/modules`            |
| Database   | MongoDB/Mongoose; memory server used for tests/load harness                                                                 | `services/api/src/db`, models, `e2e/load/load-test.mjs`          |
| Worker     | TypeScript worker skeleton; no queue backend                                                                                | `services/worker`                                                |
| Cache      | In-process analytics report cache, configurable TTL (default 60 seconds, zero disables)                                     | `services/api/src/modules/analytics/cache.ts`, architecture docs |
| Monitoring | Structured request logs include duration; alert/dashboard guidance exists but external alert rules are not provisioned here | `services/api/src/lib/logger.ts`, `docs/ops/monitoring.md`       |

#### 3. Performance baseline

The table is copied from `e2e/load/results/latest.json`, recorded 13 October 2026. Synthetic in-memory MongoDB and API ran on the same Apple M1/8-core/8-GB host. Each scenario ran for 8 seconds. The harness reports p97.5 rather than p95; those are not interchangeable. `Average`, response bytes, and endpoint query counts were not recorded.

| Scenario                              | Concurrency |  req/s | p50 ms | p97.5 ms | p99 ms | Errors / notes                                                                |
| ------------------------------------- | ----------: | -----: | -----: | -------: | -----: | ----------------------------------------------------------------------------- |
| GET /health                           |          50 | 30,966 |      1 |        2 |      3 | 0 errors                                                                      |
| GET /ready (database ping)            |          50 | 13,808 |      3 |        5 |      5 | 0 errors                                                                      |
| POST /auth/login                      |          10 |     50 |    193 |      299 |    311 | 400 successful requests                                                       |
| GET unread counters                   |          50 |  1,519 |     31 |       41 |     47 | 0 errors                                                                      |
| GET animals page (3,000 animals)      |          40 |    486 |     80 |      117 |    131 | 0 errors                                                                      |
| GET marketplace search (400 listings) |          40 |    408 |     95 |      116 |    124 | 0 errors                                                                      |
| GET farm dashboard (cached 60s)       |          20 |  1,052 |     18 |       24 |     28 | 0 errors                                                                      |
| GET farm dashboard (`fresh=true`)     |          10 |    214 |     45 |       63 |     66 | 0 errors                                                                      |
| POST chat message                     |          20 |    895 |     20 |       34 |     57 | 123 successful, 7,033 rate-limited responses; interpret throughput cautiously |

| Metric                     |                                         Before | After |                                    Improvement |
| -------------------------- | ---------------------------------------------: | ----: | ---------------------------------------------: |
| API average / p95 / p99    |                                            N/A |   N/A |      N/A (not recorded; harness reports p97.5) |
| Animal list                | Historical p50 80 ms, p97.5 117 ms, p99 131 ms |   N/A |                             N/A (no fresh run) |
| Dashboard load             |  Historical cached p50 18 ms / fresh p50 45 ms |   N/A |                                            N/A |
| Database query             |                                            N/A |   N/A | N/A (no Atlas access or query profiler output) |
| Frontend load / Web Vitals |                                            N/A |   N/A |            N/A (no browser/device measurement) |

#### 4. Findings and priority

| Priority | Finding                                                                                    | Evidence / impact                                                                                                                          | Action                                                                                                                                                                                                        |
| -------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Medium   | Animal list reads hydrate full Mongoose documents, including fields not used by list cards | `listAnimals` maps only identity, type, breed, display, status, photo, and creation fields; measured historical p50 80 ms at 3,000 animals | **Applied:** field projection plus `.lean()` on the read-only list query. This reduces fetched fields and hydration work without changing DTO behavior. Measure again in a working local/staging environment. |
| Medium   | Marketplace search is the highest-latency measured read scenario                           | Historical p50 95 ms, p97.5 116 ms, p99 124 ms at 400 listings                                                                             | Inspect real search query plans and Atlas profiler output before index or regex changes. Search supports substring matching; adding a generic index without query-plan evidence may not help.                 |
| Low      | Fresh analytics dashboards cost more than cached reads                                     | Historical p50 45 ms fresh vs 18 ms cached; 214 vs 1,052 req/s in harness                                                                  | Existing cache already has TTL, permission-aware keys and `fresh=true`. Preserve; inspect per-pipeline explain data under representative production data.                                                     |
| Low      | Animal list search uses case-insensitive regex over animal code/name                       | `animals.service.ts`; escaped user query avoids regex injection but a leading-wildcard pattern can limit index use                         | Consider Atlas Search or a purpose-built indexed search only after query plans and product search semantics are confirmed.                                                                                    |
| Info     | Main web route areas are already lazy loaded                                               | `apps/web/src/main.tsx` uses `React.lazy`; HLS imports dynamically                                                                         | No code change indicated by repository evidence. Browser bundle and Web Vitals are not measured.                                                                                                              |
| Blocked  | Production API and Atlas performance are unknown                                           | No staging deployment/account/connection is available in repository docs or environment                                                    | Obtain redacted Atlas profiler/explain output, Atlas metrics, deployment region, and production/staging telemetry.                                                                                            |

#### 5. Frontend results

- Major web application areas use route-level `React.lazy`; HLS is dynamically imported by the video player.
- The API client is shared by web and mobile. Mobile has not been performance-measured on a device in this audit.
- No browser bundle analysis, Core Web Vitals, image byte audit, or real network waterfall was available. Media provider/CDN delivery performance cannot be established from source alone.
- No UI, layout, media quality, or workflow changes were made.

#### 6. Backend and API results

Request duration is available in structured API request logs. The repository load harness records throughput and percentile latency for selected workflows, but not response size or query counts. No production log sample was supplied.

| Endpoint/workflow                                          | Available measurement                                                                                         | Follow-up                                                                                                                               |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Authentication login                                       | Historical local run p50 193 ms / p97.5 299 ms / p99 311 ms; password hashing is expected to be CPU-expensive | Verify staging latency and event-loop/CPU saturation before changing hash cost. Do not reduce security work based on this local figure. |
| Animal list                                                | Historical local run p50 80 ms / p97.5 117 ms / p99 131 ms                                                    | Projection + lean applied; rerun matched harness.                                                                                       |
| Marketplace search                                         | Historical local run p50 95 ms / p97.5 116 ms / p99 124 ms                                                    | Capture representative search explain plans; inspect full-text strategy.                                                                |
| Farm analytics                                             | Historical cached p50 18 ms; fresh p50 45 ms                                                                  | Cache policy exists; production cache invalidation remains TTL based and explicitly documented.                                         |
| Notifications/unread                                       | Historical unread counters p50 31 ms / p97.5 41 ms / p99 47 ms                                                | No query count/profiler data; inspect farm membership and unread queries in Atlas.                                                      |
| Orders, payments, profile, animal growth, product listings | N/A                                                                                                           | No endpoint-specific measurements in supplied load run; instrument/test in staging.                                                     |

#### 7. MongoDB and query review

The repository has declared indexes for farms, animals, health/weight/feeding records, listings, products, orders, payments, notifications, and analytics. Analytics architecture states that pipeline tests assert index support. This is source-level evidence only; it does not prove current Atlas plans or index presence.

No Atlas URI, profiler output, `explain("executionStats")` results, collection cardinalities, or Atlas metrics were available. Therefore COLLSCAN/IXSCAN rates, docs/keys examined, execution times, CPU, memory, disk IOPS, connections, read/write latency, and region alignment are **N/A / blocked**. No index or schema migration is recommended from this audit alone.

Queries to examine first in Atlas: animal list filter/sort/count (including text search), public listing search by status/filter/sort, analytics aggregate pipelines over orders and growth records, and unread notification/message counts. Capture `executionStats` with realistic data and actual filter/sort combinations before proposing index changes.

#### 8. Network and infrastructure

Deployment docs describe a deployment procedure but say staging was not deployed due to unavailable hosting/Atlas/CI accounts. Server and Atlas regions, DNS/TLS timing, keep-alive behavior in deployed infrastructure, compression, CDN, cold starts, server resource use, and database connection pool saturation cannot be verified. No infrastructure sizing change is recommended without those measurements.

#### 9. Cache review

Analytics has an in-process configurable TTL, defaults to 60 seconds, supports bypass, scopes keys to farm/range/filters/authorized sections, and authorizes before cache reads. It is per API instance and TTL expiry is the invalidation approach; this limitation is documented. No cross-user private or financial cache was added.

#### 10. Change made

- `services/api/src/modules/animals/animals.service.ts`: `listAnimals` now projects only list DTO fields and uses `.lean()` for the read query. The count query, filters, sort, pagination, authorization, and returned DTO are unchanged.
- No schema, index, caching, UI, or business logic changes.

#### 11. Test and comparison status

| Check                                                  | Result                                                                                       |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| Initial source audit                                   | Completed before edits                                                                       |
| Recorded load evidence                                 | Available, 13 Oct 2026; historical synthetic local run                                       |
| Fresh before load run                                  | Blocked: sandbox listener restriction; approved retry stalled during startup and was stopped |
| After load run / comparison                            | Not completed; no improvement claim                                                          |
| API typecheck                                          | Pending at report creation; see final task status                                            |
| Full unit/integration/API/frontend/security regression | Not yet run                                                                                  |
| Staging load at 10/50/100 users                        | Not run; staging deployment/access unavailable                                               |

#### 12. Next steps

1. Run matched before/after load scenarios in a working local harness or staging; preserve the same data volume, host, runtime, duration, and concurrency.
2. Add 10/50/100 concurrent-user staging scenarios for login, dashboard, farms, animals/search, marketplace/product detail, writes, and listing creation with test accounts only.
3. Capture Atlas `executionStats` and profiler samples for the queries named above, then validate current deployed indexes and write cost before migrations.
4. Supply production/staging request-duration logs (with identifiers and personal data removed), Atlas CPU/memory/connection/IOPS/latency graphs, and application/Atlas regions.
5. Measure web Core Web Vitals, bundle chunks, media transfer sizes, and mobile startup/API timing on representative devices and networks.

#### Appendix: Measurement limits

The local harness represents a single-process development setup with an in-memory database colocated with the API and load generator. It is useful for relative regression checks, not production capacity planning. It does not establish real Atlas latency, network distance, cache behavior across instances, or performance under 100 concurrent production users.
