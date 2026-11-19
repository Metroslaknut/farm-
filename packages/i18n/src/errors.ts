import { defineMessages, type Locale } from './core';

/**
 * Messages for the API's error codes (`{ error: { code } }`). The API keeps English `message`s for logs and API
 * users; screens show these instead. Unknown codes fall back to a generic message in the user's language.
 *
 * Every code the API (services/api/src) and the API client can produce has an entry; apps/web/test/i18n-errors.test.ts
 * scans the sources and fails when a new code has no message here. Messages are written for end users: they say what
 * happened and what to do, never internal details.
 */
export const apiErrors = defineMessages({
  th: {
    UNKNOWN: 'เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง',
    NETWORK: 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองใหม่',
    OFFLINE: 'ยังไม่ได้เชื่อมต่อ กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองใหม่',
    TIMEOUT: 'การเชื่อมต่อใช้เวลานานเกินไป กรุณาลองใหม่อีกครั้ง',

    // General / transport
    BAD_REQUEST: 'คำขอไม่ถูกต้อง กรุณาลองใหม่อีกครั้ง',
    REQUEST_ERROR: 'คำขอไม่ถูกต้องหรือมีขนาดใหญ่เกินไป กรุณาตรวจสอบแล้วลองใหม่',
    VALIDATION_ERROR: 'ข้อมูลบางช่องไม่ถูกต้อง กรุณาตรวจสอบอีกครั้ง',
    INVALID: 'ข้อมูลไม่ถูกต้อง กรุณาลองใหม่อีกครั้ง',
    NOT_FOUND: 'ไม่พบข้อมูลที่ต้องการ หรือข้อมูลนี้ไม่พร้อมใช้งานแล้ว',
    CONFLICT: 'ข้อมูลนี้ขัดแย้งกับข้อมูลที่มีอยู่ กรุณาตรวจสอบแล้วลองใหม่',
    FORBIDDEN: 'คุณไม่มีสิทธิ์ทำรายการนี้',
    RATE_LIMITED: 'ทำรายการบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่',
    HTTPS_REQUIRED: 'กรุณาใช้การเชื่อมต่อที่ปลอดภัย (HTTPS)',
    INTERNAL_ERROR: 'ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง',
    INTERNAL: 'ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง',
    INVALID_SIGNATURE: 'คำขอไม่ผ่านการตรวจสอบความถูกต้อง',
    PROVIDER_UNAVAILABLE: 'บริการที่เกี่ยวข้องไม่พร้อมใช้งานชั่วคราว กรุณาลองใหม่ในอีกสักครู่',
    IDEMPOTENCY_KEY_REQUIRED: 'คำขอไม่สมบูรณ์ กรุณาลองทำรายการใหม่อีกครั้ง',
    IDEMPOTENCY_KEY_REUSED: 'คำขอนี้ถูกใช้ไปแล้วกับจำนวนเงินอื่น กรุณาเริ่มทำรายการใหม่',
    CONFIRMATION_MISMATCH: 'ข้อความยืนยันไม่ตรงกัน กรุณาพิมพ์ให้ตรงตามที่แสดง',
    NO_CHANGE: 'ไม่มีอะไรเปลี่ยนแปลง ข้อมูลเป็นแบบนี้อยู่แล้ว',
    STATE_CHANGED: 'ข้อมูลเพิ่งมีการเปลี่ยนแปลง กรุณาโหลดใหม่แล้วลองอีกครั้ง',
    INVALID_STATE:
      'ทำรายการนี้ไม่ได้ในสถานะปัจจุบัน หรือรายการหมดอายุแล้ว กรุณาโหลดใหม่แล้วลองอีกครั้ง',
    INVALID_TRANSITION: 'ทำขั้นตอนนี้ไม่ได้ในสถานะปัจจุบันของรายการ',

    // Sign-in, sessions and account
    UNAUTHENTICATED: 'กรุณาเข้าสู่ระบบก่อน',
    INVALID_TOKEN: 'เซสชันไม่ถูกต้องหรือหมดอายุแล้ว กรุณาเข้าสู่ระบบใหม่',
    INVALID_REFRESH_TOKEN: 'เซสชันหมดอายุแล้ว กรุณาเข้าสู่ระบบใหม่',
    SESSION_REVOKED: 'เซสชันนี้ใช้ไม่ได้แล้ว กรุณาเข้าสู่ระบบใหม่',
    INVALID_CREDENTIALS: 'ข้อมูลเข้าสู่ระบบหรือรหัสผ่านไม่ถูกต้อง',
    INVALID_RESET_TOKEN: 'ลิงก์ตั้งรหัสผ่านใหม่ไม่ถูกต้องหรือหมดอายุแล้ว',
    INVALID_VERIFICATION: 'รหัสหรือลิงก์ยืนยันไม่ถูกต้องหรือหมดอายุแล้ว',
    INVALID_TICKET: 'การเข้าสู่ระบบนี้หมดอายุแล้ว กรุณาลองใหม่อีกครั้ง',
    RETURN_URL_NOT_ALLOWED: 'ไม่อนุญาตให้กลับไปยังที่อยู่นี้',
    ACCOUNT_EXISTS: 'มีบัญชีที่ใช้ข้อมูลนี้อยู่แล้ว',
    ACCOUNT_INACTIVE: 'บัญชีนี้ไม่ได้เปิดใช้งาน',
    ACCOUNT_DEACTIVATED: 'บัญชีนี้ถูกปิดการใช้งานแล้ว',
    ACCOUNT_SUSPENDED: 'บัญชีนี้ถูกระงับการใช้งาน',
    ACCOUNT_NOT_VERIFIED: 'กรุณายืนยันอีเมลหรือเบอร์โทรศัพท์ก่อนเข้าสู่ระบบ',
    ALREADY_VERIFIED: 'ข้อมูลนี้ได้รับการยืนยันแล้ว',
    NO_EMAIL: 'บัญชีนี้ยังไม่มีอีเมล',
    NO_PHONE: 'บัญชีนี้ยังไม่มีเบอร์โทรศัพท์',
    MFA_REQUIRED: 'ต้องยืนยันตัวตนแบบสองขั้นตอนก่อนทำรายการนี้',
    MFA_REQUIRED_BY_ROLE: 'ปิดการยืนยันตัวตนแบบสองขั้นตอนไม่ได้ขณะที่คุณมีบทบาทผู้ดูแลระบบ',
    MFA_SETUP_REQUIRED: 'กรุณาเริ่มตั้งค่าการยืนยันตัวตนแบบสองขั้นตอนก่อน',
    MFA_ALREADY_ENABLED: 'เปิดใช้การยืนยันตัวตนแบบสองขั้นตอนอยู่แล้ว',
    MFA_NOT_ENABLED: 'ยังไม่ได้เปิดใช้การยืนยันตัวตนแบบสองขั้นตอน',
    INVALID_MFA_CODE: 'รหัสยืนยันไม่ถูกต้อง',

    // Roles and permissions
    NOT_OWNER: 'คุณไม่ใช่เจ้าของรายการนี้',
    PRIVILEGE_ESCALATION: 'คุณจัดการบทบาทหรือสิทธิ์ที่เกินกว่าสิทธิ์ของตัวเองไม่ได้',
    ROLE_ESCALATION: 'คุณจัดการได้เฉพาะสมาชิกและบทบาทที่ต่ำกว่าระดับของคุณ',
    ROLE_EXISTS: 'มีบทบาทที่ใช้รหัสนี้อยู่แล้ว',
    ROLE_IMMUTABLE: 'บทบาทนี้แก้ไขไม่ได้',
    ROLE_CHANGE_BUSY: 'มีการเปลี่ยนบทบาทอื่นกำลังดำเนินการอยู่ กรุณาลองใหม่ในอีกสักครู่',
    LAST_SUPER_ADMIN: 'นำผู้ดูแลระบบสูงสุดคนสุดท้ายออกไม่ได้',
    SELF_ROLE_CHANGE: 'คุณเปลี่ยนบทบาทของตัวเองไม่ได้',
    SELF_APPROVAL: 'คุณอนุมัติรายการของตัวเองไม่ได้',
    SELF_DECISION: 'คุณพิจารณาใบสมัครของตัวเองไม่ได้',
    SELF_MODERATION: 'คุณตรวจสอบหรือตัดสินเรื่องที่เกี่ยวข้องกับตัวเองไม่ได้',
    EXPORT_FORBIDDEN: 'คุณไม่มีสิทธิ์ส่งออกข้อมูลนี้',

    // Registrations
    REGISTRATION_EXISTS: 'คุณมีใบสมัครประเภทนี้ที่ยังดำเนินการอยู่แล้ว',
    IDENTITY_NOT_VERIFIED: 'ต้องยืนยันตัวตนของผู้สมัครก่อน จึงจะอนุมัติเป็นผู้ขายได้',
    FARM_OWNER_REQUIRED:
      'เฉพาะเจ้าของฟาร์มที่ได้รับอนุมัติเท่านั้นที่สร้างฟาร์มได้ กรุณาสมัครเป็นเจ้าของฟาร์มก่อน',
    SELLER_REQUIRED: 'เฉพาะผู้ขายที่ได้รับอนุมัติเท่านั้นที่ขายได้ กรุณาสมัครเป็นผู้ขายก่อน',

    // Farms and members
    FARM_ARCHIVED: 'ฟาร์มนี้ถูกเก็บถาวรแล้ว และไม่ได้เปิดซื้อขาย',
    FARM_FORBIDDEN: 'คุณไม่มีสิทธิ์ทำรายการนี้ในฟาร์มนี้',
    ALREADY_MEMBER: 'ผู้ใช้นี้เป็นสมาชิกของฟาร์มอยู่แล้ว',
    OWNER_IMMUTABLE: 'เปลี่ยนบทบาทหรือนำเจ้าของฟาร์มออกไม่ได้',
    MEMBERS_ONLY: 'เฉพาะสมาชิกของฟาร์มเท่านั้นที่ทำการประเมินได้',

    // Animals, records and breeding
    ANIMAL_ARCHIVED:
      'สัตว์ตัวนี้ถูกเก็บถาวรแล้ว จึงแก้ไขหรือใช้งานไม่ได้ (กู้คืนก่อนหากต้องการแก้ไข)',
    ANIMAL_TYPE_EXISTS: 'มีชนิดสัตว์ที่ใช้รหัสนี้อยู่แล้ว',
    BREED_EXISTS: 'ชนิดสัตว์นี้มีสายพันธุ์ที่ใช้รหัสนี้อยู่แล้ว',
    DUPLICATE_ANIMAL_CODE: 'รหัสสัตว์นี้ถูกใช้ในฟาร์มนี้แล้ว',
    OVERLAPPING_STANDARD:
      'มีเกณฑ์ที่ใช้งานอยู่สำหรับประเภท สายพันธุ์ เพศ และชนิดเกณฑ์เดียวกันครอบคลุมช่วงอายุนี้บางส่วนแล้ว',
    CODE_ALLOCATION_FAILED: 'สร้างรหัสสัตว์ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง',
    SEX_CONFLICT: 'เพศที่เลือกขัดกับประวัติการเป็นพ่อพันธุ์หรือแม่พันธุ์ของสัตว์ตัวนี้',
    MEDIA_EXISTS: 'ไฟล์นี้แนบไว้แล้ว',
    MEDIA_LIMIT: 'สัตว์ตัวนี้มีไฟล์แนบครบจำนวนสูงสุดแล้ว',
    MEDIA_NOT_CONFIGURED: 'ยังไม่เปิดให้แนบลิงก์สื่อ',
    ATTACHMENT_EXISTS: 'ไฟล์นี้แนบไว้แล้ว',
    ATTACHMENT_LIMIT: 'บันทึกนี้มีไฟล์แนบครบจำนวนสูงสุดแล้ว',
    DUPLICATE_RECORD: 'มีการบันทึกน้ำหนักเดียวกันของวันนั้นไว้แล้ว',
    RECORD_CHANGED: 'บันทึกนี้ถูกแก้ไขโดยผู้อื่นในเวลาเดียวกัน กรุณาโหลดใหม่แล้วลองอีกครั้ง',
    RECORD_VOIDED: 'บันทึกนี้ถูกยกเลิกแล้ว จึงแก้ไขไม่ได้ กรุณาสร้างบันทึกใหม่แทน',
    DAM_ALREADY_BRED:
      'แม่พันธุ์ตัวนี้มีบันทึกการผสมพันธุ์ที่ยังไม่ปิด กรุณาบันทึกการคลอดหรือผลการผสมก่อน',
    OVERLAPPING_BREEDING: 'วันที่นี้ทับซ้อนกับบันทึกการผสมพันธุ์อื่นของแม่พันธุ์ตัวเดียวกัน',
    ALREADY_OFFSPRING: 'สัตว์ตัวนี้ถูกบันทึกเป็นลูกจากการผสมพันธุ์ครั้งอื่นแล้ว',
    PARENT_CONFLICT: 'สัตว์ตัวนี้มีพ่อพันธุ์หรือแม่พันธุ์ที่บันทึกไว้เป็นตัวอื่นแล้ว',
    SIRE_LOCKED: 'แก้ไขพ่อพันธุ์หลังการคลอดไม่ได้ กรุณายกเลิกบันทึกนี้แล้วสร้างบันทึกใหม่',

    // Community and moderation
    CONTENT_LOCKED: 'เนื้อหานี้ปิดรับความคิดเห็น การแก้ไข หรือการกดแสดงความรู้สึกแล้ว',
    CANNOT_FOLLOW_SELF: 'คุณติดตามตัวเองไม่ได้',
    CANNOT_REPORT_OWN: 'คุณรายงานเนื้อหาของตัวเองไม่ได้',
    ALREADY_REPORTED: 'คุณได้รายงานเรื่องนี้ไปแล้ว',
    ALREADY_RESOLVED: 'รายงานนี้ได้รับการจัดการแล้ว',
    ALREADY_DELETED: 'เนื้อหานี้ถูกผู้เขียนลบไปแล้ว',
    MODERATOR_HOLD: 'ผู้ตรวจสอบได้ระงับรายการนี้ไว้',

    // Chat and notifications
    CHAT_RATE_LIMITED: 'คุณส่งข้อความหรือเริ่มการสนทนาบ่อยเกินไป กรุณารอสักครู่',
    CHAT_RESTRICTED: 'บัญชีของคุณถูกจำกัดการส่งข้อความ',
    CHAT_UNAVAILABLE: 'คุณส่งข้อความในการสนทนานี้ไม่ได้',
    FARM_UNAVAILABLE: 'ฟาร์มนี้ไม่ได้เปิดรับข้อความ',
    OWN_FARM: 'คุณส่งข้อความถึงฟาร์มของตัวเองไม่ได้',
    OWN_MESSAGE: 'รายงานได้เฉพาะข้อความจากอีกฝ่ายเท่านั้น',
    TOO_MANY_ROOMS: 'เปิดการสนทนาพร้อมกันมากเกินไป กรุณาปิดบางหน้าต่างแล้วลองใหม่',
    CATEGORY_LOCKED: 'ปิดการแจ้งเตือนประเภทนี้ไม่ได้ เพราะเกี่ยวกับการเงินหรือสถานะบัญชีของคุณ',

    // Video and live
    EMPTY_FILE: 'ไฟล์นี้ว่างเปล่า',
    FILE_TOO_LARGE: 'ไฟล์มีขนาดใหญ่เกินกำหนด',
    UNSUPPORTED_MEDIA_TYPE: 'ไม่รองรับไฟล์ประเภทนี้',
    PHOTO_STORAGE_UNAVAILABLE: 'ระบบเก็บรูปภาพขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง',
    VIDEO_NOT_CONFIGURED: 'ยังไม่เปิดให้ใช้งานวิดีโอและไลฟ์',
    UPLOAD_REJECTED: 'อัปโหลดไฟล์นี้ไม่สำเร็จ',
    UPLOAD_LIMIT: 'อัปโหลดเกินจำนวนที่กำหนด กรุณาทำรายการที่ค้างอยู่ให้เสร็จ หรือลองใหม่ในวันถัดไป',
    NOT_READY: 'วิดีโอนี้ยังไม่พร้อมเล่น',
    LIVE_ALREADY_ACTIVE: 'คุณมีไลฟ์ที่ยังไม่จบอยู่แล้ว',
    LIVE_HOST_REQUIRED: 'เฉพาะเจ้าของฟาร์มและผู้ขายที่ได้รับอนุมัติเท่านั้นที่เริ่มไลฟ์ได้',
    LIVE_OVER: 'ไลฟ์นี้จบแล้วหรือไม่พร้อมให้รับชม',
    NOT_LIVE_YET: 'ไลฟ์นี้ยังไม่เริ่ม',

    // Marketplace (animals)
    ALREADY_LISTED: 'สัตว์ตัวนี้มีประกาศขายที่เปิดอยู่แล้ว',
    ANIMAL_NOT_SELLABLE: 'สัตว์ตัวนี้ขายหรือลงประกาศไม่ได้',
    LISTING_UNAVAILABLE: 'ประกาศนี้ไม่พร้อมให้ซื้อขายแล้ว',
    EXPIRED: 'ประกาศนี้หมดอายุแล้ว กรุณาต่ออายุประกาศแทน',
    NOT_EDITABLE: 'แก้ไขรายการนี้ไม่ได้ในสถานะปัจจุบัน',
    RESERVED: 'กรุณายกเลิกการจองก่อน หรือปิดการขายให้เสร็จ',
    OWN_LISTING: 'คุณซื้อหรือเสนอราคาประกาศของฟาร์มตัวเองไม่ได้',
    NEGOTIATION_EXISTS: 'คุณมีการต่อรองสำหรับประกาศนี้อยู่แล้ว',
    NEGOTIATION_CLOSED: 'การต่อรองนี้ปิดแล้ว',
    TOO_MANY_NEGOTIATIONS: 'คุณมีการต่อรองที่เปิดอยู่มากเกินไป',
    TOO_MANY_ROUNDS: 'มีการเสนอราคาหลายรอบเกินไปแล้ว กรุณาตอบรับหรือปฏิเสธข้อเสนอ',
    NOT_YOUR_TURN: 'ยังไม่ถึงตาของคุณ',
    OFFER_EXPIRED: 'ข้อเสนอนี้หมดอายุแล้ว',
    STALE_OFFER: 'ข้อเสนอมีการเปลี่ยนแปลง กรุณาโหลดใหม่แล้วลองอีกครั้ง',
    PRICE_FIXED: 'ราคานี้เป็นราคาตายตัว กรุณาตอบรับหรือปฏิเสธข้อเสนอ',
    NOT_ACCEPTED: 'ทำรายการนี้ได้เฉพาะข้อเสนอที่ตกลงกันแล้วเท่านั้น',
    READ_ONLY: 'คุณดูการต่อรองนี้ได้อย่างเดียว ร่วมต่อรองไม่ได้',
    RESERVATION_EXPIRED: 'การจองหมดอายุแล้ว',

    // Orders and shipping
    ORDER_EXISTS: 'มีคำสั่งซื้อสำหรับรายการนี้อยู่แล้ว',
    ORDER_CHANGED: 'คำสั่งซื้อมีการเปลี่ยนแปลง กรุณาโหลดใหม่แล้วลองอีกครั้ง',
    ORDER_NOT_PAYABLE: 'คำสั่งซื้อนี้ไม่ได้อยู่ในสถานะรอชำระเงิน',
    CANCEL_NOT_ALLOWED: 'ยกเลิกคำสั่งซื้อนี้ไม่ได้ในสถานะปัจจุบัน',
    CANNOT_REQUOTE:
      'คำนวณค่าจัดส่งใหม่สำหรับคำสั่งซื้อนี้ไม่ได้ หากต้องการเปลี่ยนที่อยู่ กรุณายกเลิกแล้วสั่งซื้อใหม่',
    QUOTE_STALE: 'ค่าจัดส่งที่คำนวณไว้ใช้ไม่ได้แล้ว กรุณาคำนวณค่าจัดส่งใหม่',
    PICKUP_ORDER: 'คำสั่งซื้อนี้เป็นแบบรับเอง ผู้ซื้อจะยืนยันการรับเมื่อมารับสินค้า',
    SHIPMENT_EXISTS: 'เลขพัสดุนี้ถูกใช้แล้ว หรือคำสั่งซื้อนี้มีการจัดส่งแล้ว',
    INVALID_SHIPMENT_TRANSITION: 'เปลี่ยนสถานะการจัดส่งเป็นสถานะนี้ไม่ได้',

    // Shop (products and cart)
    OWN_PRODUCT: 'คุณซื้อหรือรีวิวสินค้าของฟาร์มตัวเองไม่ได้',
    SKU_TAKEN: 'รหัส SKU นี้ถูกใช้กับสินค้าอื่นของฟาร์มแล้ว',
    NEGATIVE_STOCK: 'จำนวนสต็อกต้องไม่ติดลบ',
    BELOW_RESERVED: 'ลดสต็อกให้ต่ำกว่าจำนวนที่ถูกจองไว้ในคำสั่งซื้อที่ยังไม่ชำระเงินไม่ได้',
    STOCK_CHANGED: 'สต็อกมีการเปลี่ยนแปลงระหว่างที่คุณแก้ไข กรุณาโหลดใหม่แล้วลองอีกครั้ง',
    INSUFFICIENT_STOCK: 'สินค้าบางรายการเพิ่งถูกซื้อหมด กรุณาตรวจสอบตะกร้าอีกครั้ง',
    CART_EMPTY: 'ตะกร้าของคุณว่างอยู่',
    CART_FULL: 'ตะกร้ามีสินค้าครบจำนวนสูงสุดแล้ว',
    CART_CHANGED: 'ตะกร้าของคุณมีการเปลี่ยนแปลง กรุณาตรวจสอบแล้วสั่งซื้ออีกครั้ง',
    CART_HAS_PROBLEMS: 'สินค้าบางรายการในตะกร้าสั่งซื้อไม่ได้ในขณะนี้ กรุณาตรวจสอบตะกร้า',
    CHECKOUT_IN_PROGRESS: 'ตะกร้านี้กำลังอยู่ระหว่างการสั่งซื้อ',
    PRICE_CHANGED: 'ราคาสินค้ามีการเปลี่ยนแปลง กรุณาตรวจสอบตะกร้า',
    SHIPPING_CHANGED: 'ค่าจัดส่งมีการเปลี่ยนแปลง กรุณาตรวจสอบตะกร้า',
    NO_DELIVERY: 'ร้านค้าไม่จัดส่งสินค้าบางรายการไปยังที่อยู่ของคุณ',
    NO_PICKUP: 'ร้านค้าไม่มีบริการรับเองสำหรับสินค้าบางรายการในตะกร้า',
    ALREADY_REVIEWED: 'คุณรีวิวสินค้านี้ไปแล้ว',
    NOT_PURCHASED: 'เฉพาะผู้ซื้อที่ได้รับสินค้านี้แล้วเท่านั้นที่รีวิวได้',
    REVIEW_HIDDEN: 'รีวิวนี้ถูกผู้ตรวจสอบซ่อนไว้ จึงลบไม่ได้',
    CATEGORY_DISABLED: 'หมวดหมู่นี้ยังไม่เปิดให้ขาย',
    PROHIBITED_CATEGORY: 'สินค้าหมวดหมู่นี้ห้ามขายบน FARM+',
    PROHIBITED_PRODUCT: 'สินค้านี้มีเนื้อหาที่ไม่อนุญาตบน FARM+',
    REGISTRATION_REQUIRED: 'สินค้าควบคุมต้องระบุเลขทะเบียนหรือเลขใบอนุญาต',
    UNSUPPORTED_CLAIM:
      'คำอธิบายสินค้ากล่าวอ้างสรรพคุณการรักษา กรุณาอธิบายว่าสินค้าคืออะไรและมีส่วนประกอบอะไร',
    COMPLIANCE_REVIEW_REQUIRED: 'สินค้าควบคุมต้องระบุเลขอ้างอิงผลการตรวจสอบที่อนุมัติให้ขาย',

    // Payments, refunds and payouts
    PAYMENTS_UNAVAILABLE: 'ระบบชำระเงินหรือการโอนเงินไม่พร้อมใช้งานในขณะนี้',
    PAYMENT_IN_PROGRESS: 'คำสั่งซื้อนี้กำลังอยู่ระหว่างการชำระเงิน',
    PAYMENT_WINDOW_CLOSED: 'หมดเวลาชำระเงินสำหรับคำสั่งซื้อนี้แล้ว',
    PAYMENT_NOT_REFUNDABLE: 'การชำระเงินนี้คืนเงินผ่านระบบไม่ได้',
    LEDGER_IMBALANCE: 'บันทึกรายการทางการเงินของคำสั่งซื้อนี้ไม่สำเร็จ กรุณาติดต่อผู้ดูแลระบบ',
    INSUFFICIENT_FUNDS: 'ยอดเงินที่ถอนได้ไม่เพียงพอ',
    BELOW_MINIMUM: 'จำนวนเงินต่ำกว่ายอดถอนขั้นต่ำ',
    PAYOUTS_DISABLED: 'ยังไม่เปิดให้ถอนเงิน',
    PAYOUT_ACCOUNT_REQUIRED: 'กรุณาเพิ่มบัญชีรับเงินก่อน',
    RULE_CONFLICT:
      'กฎนี้มีลำดับความสำคัญเท่ากับกฎอื่นที่อาจใช้กับการขายเดียวกัน กรุณาเปลี่ยนลำดับความสำคัญหรือจำกัดขอบเขต',
  },
  en: {
    UNKNOWN: 'Something went wrong. Please try again.',
    NETWORK: 'Could not reach the server. Check your connection and try again.',
    OFFLINE: 'You are not connected. Check your connection and try again.',
    TIMEOUT: 'The connection took too long. Please try again.',

    BAD_REQUEST: 'This request could not be processed. Please try again.',
    REQUEST_ERROR: 'This request is invalid or too large. Please check it and try again.',
    VALIDATION_ERROR: 'Some fields are not valid. Please check them and try again.',
    INVALID: 'That was not valid. Please try again.',
    NOT_FOUND: 'We could not find what you were looking for, or it is no longer available.',
    CONFLICT: 'This conflicts with existing information. Please check and try again.',
    FORBIDDEN: 'You do not have permission to do this.',
    RATE_LIMITED: 'Too many attempts. Please wait a moment and try again.',
    HTTPS_REQUIRED: 'Please use a secure (HTTPS) connection.',
    INTERNAL_ERROR: 'Something went wrong on our side. Please try again.',
    INTERNAL: 'Something went wrong on our side. Please try again.',
    INVALID_SIGNATURE: 'This request could not be verified.',
    PROVIDER_UNAVAILABLE:
      'A service we depend on is temporarily unavailable. Please try again shortly.',
    IDEMPOTENCY_KEY_REQUIRED: 'This request was incomplete. Please try again.',
    IDEMPOTENCY_KEY_REUSED:
      'This request was already used for a different amount. Please start a new one.',
    CONFIRMATION_MISMATCH: 'The confirmation text does not match. Type it exactly as shown.',
    NO_CHANGE: 'Nothing to change: it is already like this.',
    STATE_CHANGED: 'This was just changed. Reload and try again.',
    INVALID_STATE:
      'This cannot be done in its current state, or it has expired. Reload and try again.',
    INVALID_TRANSITION: 'This step is not possible in the current status.',

    UNAUTHENTICATED: 'Please sign in first.',
    INVALID_TOKEN: 'Your session is invalid or has expired. Please sign in again.',
    INVALID_REFRESH_TOKEN: 'Your session has expired. Please sign in again.',
    SESSION_REVOKED: 'This session is no longer valid. Please sign in again.',
    INVALID_CREDENTIALS: 'The sign-in details or password are incorrect.',
    INVALID_RESET_TOKEN: 'This password reset link is invalid or has expired.',
    INVALID_VERIFICATION: 'This verification code or link is invalid or has expired.',
    INVALID_TICKET: 'This sign-in has expired. Please try again.',
    RETURN_URL_NOT_ALLOWED: 'This return address is not allowed.',
    ACCOUNT_EXISTS: 'An account with these details already exists.',
    ACCOUNT_INACTIVE: 'This account is not active.',
    ACCOUNT_DEACTIVATED: 'This account has been deactivated.',
    ACCOUNT_SUSPENDED: 'This account is suspended.',
    ACCOUNT_NOT_VERIFIED: 'Verify your email or phone number before signing in.',
    ALREADY_VERIFIED: 'This is already verified.',
    NO_EMAIL: 'This account has no email address yet.',
    NO_PHONE: 'This account has no phone number yet.',
    MFA_REQUIRED: 'Two-step verification is required for this action.',
    MFA_REQUIRED_BY_ROLE:
      'Two-step verification cannot be turned off while you have an administrator role.',
    MFA_SETUP_REQUIRED: 'Start the two-step verification setup first.',
    MFA_ALREADY_ENABLED: 'Two-step verification is already on.',
    MFA_NOT_ENABLED: 'Two-step verification is not turned on.',
    INVALID_MFA_CODE: 'The verification code is incorrect.',

    NOT_OWNER: 'You are not the owner of this.',
    PRIVILEGE_ESCALATION: 'You cannot manage roles or permissions beyond your own.',
    ROLE_ESCALATION: 'You can only manage members and roles below your own level.',
    ROLE_EXISTS: 'A role with this key already exists.',
    ROLE_IMMUTABLE: 'This role cannot be changed.',
    ROLE_CHANGE_BUSY: 'Another role change is in progress. Please try again shortly.',
    LAST_SUPER_ADMIN: 'The last super admin cannot be removed.',
    SELF_ROLE_CHANGE: 'You cannot change your own role.',
    SELF_APPROVAL: 'You cannot approve your own request.',
    SELF_DECISION: 'You cannot review your own registration.',
    SELF_MODERATION: 'You cannot moderate or decide something you are part of.',
    EXPORT_FORBIDDEN: 'You do not have permission to export this.',

    REGISTRATION_EXISTS: 'You already have an active registration of this type.',
    IDENTITY_NOT_VERIFIED:
      'The applicant’s identity must be verified before they can be approved as a seller.',
    FARM_OWNER_REQUIRED:
      'Only approved farm owners can create farms. Submit a farm-owner registration first.',
    SELLER_REQUIRED: 'Only approved sellers can sell. Submit a seller registration first.',

    FARM_ARCHIVED: 'This farm is archived and is not trading.',
    FARM_FORBIDDEN: 'You do not have permission to do this on this farm.',
    ALREADY_MEMBER: 'This user is already a member of the farm.',
    OWNER_IMMUTABLE: 'The farm owner cannot be changed or removed.',
    MEMBERS_ONLY: 'Only members of the farm can run an assessment.',

    ANIMAL_ARCHIVED:
      'This animal is archived and cannot be changed or used. Restore it to edit it.',
    ANIMAL_TYPE_EXISTS: 'An animal type with this key already exists.',
    BREED_EXISTS: 'This animal type already has a breed with this key.',
    DUPLICATE_ANIMAL_CODE: 'This animal code is already used on this farm.',
    OVERLAPPING_STANDARD:
      'An active criterion for the same type, breed, sex and kind already covers part of this age range.',
    CODE_ALLOCATION_FAILED: 'Could not create an animal code. Please try again.',
    SEX_CONFLICT: 'The chosen sex conflicts with this animal’s records as a sire or dam.',
    MEDIA_EXISTS: 'This file is already attached.',
    MEDIA_LIMIT: 'This animal already has the maximum number of files.',
    MEDIA_NOT_CONFIGURED: 'Media links are not enabled yet.',
    ATTACHMENT_EXISTS: 'This file is already attached.',
    ATTACHMENT_LIMIT: 'This record already has the maximum number of files.',
    DUPLICATE_RECORD: 'The same weight is already recorded for that day.',
    RECORD_CHANGED: 'Someone else changed this record at the same time. Reload it and try again.',
    RECORD_VOIDED: 'This record was voided and cannot be changed. Create a new record instead.',
    DAM_ALREADY_BRED:
      'This dam already has an open breeding record. Record its delivery or outcome first.',
    OVERLAPPING_BREEDING: 'This date overlaps another breeding record of the same dam.',
    ALREADY_OFFSPRING: 'This animal is already recorded as the offspring of another breeding.',
    PARENT_CONFLICT: 'This animal already has a different sire or dam recorded.',
    SIRE_LOCKED:
      'The sire cannot be changed after delivery. Void this record and create a new one.',

    CONTENT_LOCKED: 'This content is closed to comments, edits or reactions.',
    CANNOT_FOLLOW_SELF: 'You cannot follow yourself.',
    CANNOT_REPORT_OWN: 'You cannot report your own content.',
    ALREADY_REPORTED: 'You have already reported this.',
    ALREADY_RESOLVED: 'This report has already been resolved.',
    ALREADY_DELETED: 'The author has already deleted this.',
    MODERATOR_HOLD: 'A moderator has put this on hold.',

    CHAT_RATE_LIMITED:
      'You are sending messages or starting conversations too quickly. Please wait a moment.',
    CHAT_RESTRICTED: 'Messaging is restricted on your account.',
    CHAT_UNAVAILABLE: 'You cannot send messages in this conversation.',
    FARM_UNAVAILABLE: 'This farm is not taking messages.',
    OWN_FARM: 'You cannot message your own farm.',
    OWN_MESSAGE: 'You can only report messages from the other person.',
    TOO_MANY_ROOMS: 'Too many conversations are open at once. Close some and try again.',
    CATEGORY_LOCKED:
      'These notifications cannot be turned off: they concern money or your account standing.',

    EMPTY_FILE: 'The file is empty.',
    FILE_TOO_LARGE: 'The file is too large.',
    UNSUPPORTED_MEDIA_TYPE: 'This file type is not supported.',
    PHOTO_STORAGE_UNAVAILABLE: 'Photo storage is temporarily unavailable. Please try again.',
    VIDEO_NOT_CONFIGURED: 'Video and live streaming are not enabled yet.',
    UPLOAD_REJECTED: 'This file could not be uploaded.',
    UPLOAD_LIMIT: 'Upload limit reached. Finish your pending uploads, or try again tomorrow.',
    NOT_READY: 'This video is not ready to play yet.',
    LIVE_ALREADY_ACTIVE: 'You already have a live stream that has not ended.',
    LIVE_HOST_REQUIRED: 'Only approved farm owners and sellers can start a live stream.',
    LIVE_OVER: 'This live stream has ended or is not available.',
    NOT_LIVE_YET: 'This live stream has not started yet.',

    ALREADY_LISTED: 'This animal already has an open listing.',
    ANIMAL_NOT_SELLABLE: 'This animal cannot be sold or listed.',
    LISTING_UNAVAILABLE: 'This listing is no longer available.',
    EXPIRED: 'This listing has expired. Renew it instead.',
    NOT_EDITABLE: 'This cannot be edited in its current status.',
    RESERVED: 'Cancel the reservation first, or complete the sale.',
    OWN_LISTING: 'You cannot buy or make an offer on your own farm’s listing.',
    NEGOTIATION_EXISTS: 'You already have a negotiation for this listing.',
    NEGOTIATION_CLOSED: 'This negotiation is closed.',
    TOO_MANY_NEGOTIATIONS: 'You have too many open negotiations.',
    TOO_MANY_ROUNDS: 'There have been too many offers. Please accept or reject.',
    NOT_YOUR_TURN: 'It is not your turn yet.',
    OFFER_EXPIRED: 'This offer has expired.',
    STALE_OFFER: 'The offer changed. Reload and try again.',
    PRICE_FIXED: 'The price is fixed. Please accept or reject the offer.',
    NOT_ACCEPTED: 'This is only possible for an accepted offer.',
    READ_ONLY: 'You can view this negotiation but not take part.',
    RESERVATION_EXPIRED: 'The reservation has expired.',

    ORDER_EXISTS: 'An order already exists for this.',
    ORDER_CHANGED: 'The order changed. Reload and try again.',
    ORDER_NOT_PAYABLE: 'This order is not waiting for payment.',
    CANCEL_NOT_ALLOWED: 'This order cannot be cancelled in its current status.',
    CANNOT_REQUOTE:
      'Shipping cannot be recalculated for this order. To change the address, cancel and order again.',
    QUOTE_STALE: 'This shipping quote can no longer be used. Please get a new one.',
    PICKUP_ORDER: 'This is a pickup order: the buyer confirms receipt when they collect it.',
    SHIPMENT_EXISTS:
      'This tracking number is already in use, or the order has already been shipped.',
    INVALID_SHIPMENT_TRANSITION: 'The shipment cannot be moved to this status.',

    OWN_PRODUCT: 'You cannot buy or review your own farm’s product.',
    SKU_TAKEN: 'Another product of this farm already uses this SKU.',
    NEGATIVE_STOCK: 'Stock cannot be negative.',
    BELOW_RESERVED: 'Stock cannot go below the units held by unpaid orders.',
    STOCK_CHANGED: 'Stock changed while you were editing. Reload and try again.',
    INSUFFICIENT_STOCK: 'Some items just sold out. Please check your cart.',
    CART_EMPTY: 'Your cart is empty.',
    CART_FULL: 'Your cart already holds the maximum number of products.',
    CART_CHANGED: 'Your cart changed. Review it and check out again.',
    CART_HAS_PROBLEMS:
      'Some items in your cart cannot be ordered right now. Please review your cart.',
    CHECKOUT_IN_PROGRESS: 'This cart is already being checked out.',
    PRICE_CHANGED: 'A price changed. Please review your cart.',
    SHIPPING_CHANGED: 'Shipping changed. Please review your cart.',
    NO_DELIVERY: 'The seller does not deliver some items in your cart to your address.',
    NO_PICKUP: 'The seller does not offer pickup for some items in your cart.',
    ALREADY_REVIEWED: 'You have already reviewed this product.',
    NOT_PURCHASED: 'Only buyers who received this product can review it.',
    REVIEW_HIDDEN: 'A moderator hid this review, so it cannot be deleted.',
    CATEGORY_DISABLED: 'This category is not open for sale yet.',
    PROHIBITED_CATEGORY: 'Products in this category cannot be sold on FARM+.',
    PROHIBITED_PRODUCT: 'This product mentions something that is not allowed on FARM+.',
    REGISTRATION_REQUIRED: 'Regulated goods need their registration or licence number.',
    UNSUPPORTED_CLAIM:
      'The description reads as a treatment or health claim. Describe what the product is and contains instead.',
    COMPLIANCE_REVIEW_REQUIRED:
      'Regulated goods need the reference of the compliance review that approved their sale.',

    PAYMENTS_UNAVAILABLE: 'Payments and payouts are not available right now.',
    PAYMENT_IN_PROGRESS: 'A payment for this order is already in progress.',
    PAYMENT_WINDOW_CLOSED: 'The payment window for this order has closed.',
    PAYMENT_NOT_REFUNDABLE: 'This payment cannot be refunded through the system.',
    LEDGER_IMBALANCE:
      'The payment records for this order could not be completed. Please contact support.',
    INSUFFICIENT_FUNDS: 'Your available balance is not enough.',
    BELOW_MINIMUM: 'The amount is below the minimum withdrawal.',
    PAYOUTS_DISABLED: 'Withdrawals are not open yet.',
    PAYOUT_ACCOUNT_REQUIRED: 'Add a payout account first.',
    RULE_CONFLICT:
      'This rule has the same priority as another rule that could apply to the same sales. Change its priority or narrow its scope.',
  },
});

export function apiErrorMessage(locale: Locale, code: string | undefined): string {
  const messages = apiErrors[locale] as Record<string, string>;
  return (
    (code && Object.prototype.hasOwnProperty.call(messages, code) && messages[code]) ||
    messages['UNKNOWN']!
  );
}

/**
 * Field messages from the API's validation (Zod) are English. Known ones are translated here: the custom messages of
 * packages/validation and the API's own field messages (`invalid(field, '…')`, `details`). Messages with numbers or
 * names in them, and Zod's default messages, are matched by `validationPatterns` below; anything else gets a generic
 * message.
 */
export const validationMessages: Record<string, string> = {
  // --- packages/validation: shared ---
  'Invalid id': 'รหัสอ้างอิงไม่ถูกต้อง',
  'Invalid cursor': 'ตำแหน่งหน้าข้อมูลไม่ถูกต้อง กรุณาโหลดใหม่',
  'Invalid filter': 'ตัวกรองไม่ถูกต้อง',
  'Invalid MIME type': 'ประเภทไฟล์ไม่ถูกต้อง',
  'Invalid file name': 'ชื่อไฟล์ไม่ถูกต้อง',
  'Contains characters that are not allowed': 'มีอักขระที่ไม่อนุญาต',
  'The message contains characters that are not allowed': 'ข้อความมีอักขระที่ไม่อนุญาต',
  'Nothing to change': 'ไม่มีอะไรเปลี่ยนแปลง',
  'No fields to update': 'ไม่มีข้อมูลที่ต้องแก้ไข',
  'No changes given': 'ไม่มีการเปลี่ยนแปลง',
  Required: 'กรุณากรอกข้อมูลช่องนี้',
  'At least 2 characters': 'ต้องมีอย่างน้อย 2 ตัวอักษร',
  'At least 10 characters': 'ต้องมีอย่างน้อย 10 ตัวอักษร',
  'At most 2 decimals': 'ทศนิยมไม่เกิน 2 ตำแหน่ง',
  'Must be greater than 0': 'ต้องมากกว่า 0',
  'Use YYYY-MM-DD': 'ใช้รูปแบบวันที่ ปปปป-ดด-วว (ค.ศ.)',
  'Use an ISO date-time': 'วันที่และเวลาไม่ถูกต้อง',
  'Use 24-hour HH:MM': 'ใช้รูปแบบเวลา 24 ชั่วโมง ชช:นน',
  'Give a reason': 'กรุณาระบุเหตุผล',
  'A reason of at least 3 characters is required': 'กรุณาระบุเหตุผลอย่างน้อย 3 ตัวอักษร',
  'Lowercase letters, digits and underscores':
    'ใช้ได้เฉพาะตัวอักษรภาษาอังกฤษพิมพ์เล็ก ตัวเลข และขีดล่าง (_)',
  'Use lower-case letters, digits and _':
    'ใช้ได้เฉพาะตัวอักษรภาษาอังกฤษพิมพ์เล็ก ตัวเลข และขีดล่าง (_)',

  // --- auth ---
  'Phone must be in E.164 format': 'เบอร์โทรศัพท์ต้องอยู่ในรูปแบบสากล เช่น +66812345678',
  'Must be a 6-digit code': 'ต้องเป็นรหัส 6 หลัก',
  'Provide an email or a phone number': 'กรุณาระบุอีเมลหรือเบอร์โทรศัพท์',
  'Invalid challenge': 'คำขอเข้าสู่ระบบไม่ถูกต้อง กรุณาลองใหม่',
  'Invalid verifier': 'คำขอเข้าสู่ระบบไม่ถูกต้อง กรุณาลองใหม่',

  // --- farms and animals ---
  'Postal code must be 5 digits': 'รหัสไปรษณีย์ต้องเป็นตัวเลข 5 หลัก',
  'Provide both latitude and longitude, or neither':
    'กรุณาระบุทั้งละติจูดและลองจิจูด หรือไม่ระบุทั้งสองค่า',
  'Invalid phone number': 'เบอร์โทรศัพท์ไม่ถูกต้อง',
  'Enter a valid phone number': 'กรุณากรอกเบอร์โทรศัพท์ที่ถูกต้อง',
  'Provide exactly one of userId or email': 'กรุณาระบุผู้ใช้หรืออีเมลอย่างใดอย่างหนึ่ง',
  'Use letters, digits and . _ - / (max 40, no spaces)':
    'ใช้ตัวอักษร ตัวเลข และ . _ - / ได้ (ไม่เกิน 40 ตัว ไม่มีช่องว่าง)',
  'Choose an animal type': 'กรุณาเลือกชนิดสัตว์',
  'Invalid breed key': 'รหัสสายพันธุ์ไม่ถูกต้อง',
  'Choose the animal’s sex': 'กรุณาเลือกเพศของสัตว์',
  'Birth date cannot be in the future': 'วันเกิดต้องไม่เป็นวันในอนาคต',
  'Acquisition date cannot be in the future': 'วันที่ได้มาต้องไม่เป็นวันในอนาคต',
  'Acquisition date cannot be before the birth date': 'วันที่ได้มาต้องไม่ก่อนวันเกิด',

  // --- records ---
  'The date cannot be in the future': 'วันที่ต้องไม่เป็นวันในอนาคต',
  'The weighing date cannot be in the future': 'วันที่ชั่งน้ำหนักต้องไม่เป็นวันในอนาคต',
  'The expense date cannot be in the future': 'วันที่ค่าใช้จ่ายต้องไม่เป็นวันในอนาคต',
  'The breeding date cannot be in the future': 'วันที่ผสมพันธุ์ต้องไม่เป็นวันในอนาคต',
  'The check date cannot be in the future': 'วันที่ตรวจต้องไม่เป็นวันในอนาคต',
  'The delivery date cannot be in the future': 'วันที่คลอดต้องไม่เป็นวันในอนาคต',
  'A feeding log cannot be in the future': 'บันทึกการให้อาหารต้องไม่เป็นวันในอนาคต',
  'Name the vaccine': 'กรุณาระบุชื่อวัคซีน',
  'Record the outcome': 'กรุณาบันทึกผลการรักษา',
  'The outcome belongs to a recovery record': 'ผลการรักษาใช้กับบันทึกการหายป่วยเท่านั้น',
  'Vaccine details belong to a vaccination record':
    'รายละเอียดวัคซีนใช้กับบันทึกการฉีดวัคซีนเท่านั้น',
  'Say who stated this condition': 'กรุณาระบุผู้ที่วินิจฉัยอาการนี้',
  'Enter the condition, or clear “stated by”': 'กรุณาระบุอาการ หรือล้างช่อง “ผู้วินิจฉัย”',
  'Say who prescribed or recommended this medication': 'กรุณาระบุผู้ที่สั่งหรือแนะนำยานี้',
  'Enter the medication, or clear “prescribed by”': 'กรุณาระบุยา หรือล้างช่อง “ผู้สั่งยา”',
  'Cannot be before the record date': 'ต้องไม่ก่อนวันที่ของบันทึก',
  'Cannot be before the start date': 'ต้องไม่ก่อนวันเริ่มต้น',
  'Choose one animal or a group, not both': 'กรุณาเลือกสัตว์หนึ่งตัวหรือกลุ่มอย่างใดอย่างหนึ่ง',
  'Only schedules have this': 'ข้อมูลนี้ใช้กับตารางการให้อาหารเท่านั้น',
  'Give one time per feeding, or leave the times out':
    'กรุณาระบุเวลาให้ครบทุกมื้อ หรือไม่ต้องระบุเวลา',
  'Give at least one detail': 'กรุณาระบุรายละเอียดอย่างน้อยหนึ่งอย่าง',
  'Choose a sire on this farm or an outside sire, not both':
    'กรุณาเลือกพ่อพันธุ์ในฟาร์มหรือพ่อพันธุ์จากภายนอกอย่างใดอย่างหนึ่ง',
  'The sire and dam must be different animals': 'พ่อพันธุ์และแม่พันธุ์ต้องเป็นสัตว์คนละตัวกัน',
  'Say what happened': 'กรุณาระบุสิ่งที่เกิดขึ้น',

  // --- community, chat, video ---
  'Write something or attach a photo or video': 'กรุณาเขียนข้อความหรือแนบรูปภาพหรือวิดีโอ',
  'Write a comment': 'กรุณาเขียนความคิดเห็น',
  'Write a message': 'กรุณาเขียนข้อความ',
  'Provide either listingId or productId': 'กรุณาระบุประกาศหรือสินค้าอย่างใดอย่างหนึ่ง',
  'Use either before or after': 'กรุณาใช้ตำแหน่งก่อนหรือหลังอย่างใดอย่างหนึ่ง',
  'Give the video a title': 'กรุณาตั้งชื่อวิดีโอ',
  'Give the live stream a title': 'กรุณาตั้งชื่อไลฟ์',
  'Unsupported video type': 'ไม่รองรับไฟล์วิดีโอประเภทนี้',
  'The file is empty': 'ไฟล์นี้ว่างเปล่า',

  // --- marketplace ---
  'Enter an amount': 'กรุณากรอกจำนวนเงิน',
  'Amounts are whole satang': 'จำนวนเงินต้องเป็นหน่วยสตางค์เต็ม',
  'Whole satang only': 'จำนวนเงินต้องเป็นหน่วยสตางค์เต็ม',
  'The amount must be greater than zero': 'จำนวนเงินต้องมากกว่าศูนย์',
  'The amount is too large': 'จำนวนเงินมากเกินไป',
  'Only THB is supported': 'รองรับเฉพาะสกุลเงินบาท (THB)',
  'Enter the delivery price': 'กรุณากรอกค่าจัดส่ง',
  'Add at least one province you deliver to': 'กรุณาเพิ่มจังหวัดที่จัดส่งอย่างน้อยหนึ่งจังหวัด',
  'The shortest time is above the longest':
    'ระยะเวลาที่สั้นที่สุดต้องไม่มากกว่าระยะเวลาที่นานที่สุด',
  'A province is listed twice': 'มีจังหวัดซ้ำกัน',
  'Give the listing a title': 'กรุณาตั้งชื่อประกาศ',
  'Choose at least one option': 'กรุณาเลือกอย่างน้อยหนึ่งตัวเลือก',
  'The lowest offer cannot be above the asking price':
    'ราคาเสนอขั้นต่ำต้องไม่สูงกว่าราคาที่ตั้งไว้',
  'The minimum price is above the maximum': 'ราคาต่ำสุดต้องไม่สูงกว่าราคาสูงสุด',

  // --- orders ---
  'Enter the province': 'กรุณากรอกจังหวัด',
  'Enter the district': 'กรุณากรอกอำเภอ/เขต',
  'Enter the recipient name': 'กรุณากรอกชื่อผู้รับ',
  'Enter the street address': 'กรุณากรอกที่อยู่',
  'Enter the delivery address': 'กรุณากรอกที่อยู่จัดส่ง',
  'Get a shipping quote first': 'กรุณาคำนวณค่าจัดส่งก่อน',
  'A pickup order has no delivery address or shipping quote':
    'คำสั่งซื้อแบบรับเองไม่ต้องมีที่อยู่จัดส่งหรือค่าจัดส่ง',
  'A pickup order has no delivery address': 'คำสั่งซื้อแบบรับเองไม่ต้องมีที่อยู่จัดส่ง',
  'Enter the carrier or how it is sent': 'กรุณาระบุบริษัทขนส่งหรือวิธีการจัดส่ง',
  'Tracking numbers use letters, digits and dashes':
    'เลขพัสดุใช้ได้เฉพาะตัวอักษร ตัวเลข และขีด (-)',

  // --- products ---
  'Name the specification': 'กรุณาระบุชื่อคุณสมบัติ',
  'Give the value': 'กรุณาระบุค่า',
  'The promotion must end after it starts': 'วันสิ้นสุดโปรโมชันต้องอยู่หลังวันเริ่มต้น',
  'Enter the registration or licence number': 'กรุณากรอกเลขทะเบียนหรือเลขใบอนุญาต',
  'Transport requirements are for animals only': 'ข้อกำหนดการขนส่งใช้กับสัตว์เท่านั้น',
  'Give the product a title': 'กรุณาตั้งชื่อสินค้า',
  'The promotion price must be lower than the regular price': 'ราคาโปรโมชันต้องต่ำกว่าราคาปกติ',
  'The maximum cannot be below the minimum': 'ค่าสูงสุดต้องไม่ต่ำกว่าค่าต่ำสุด',
  'Give a reason (e.g. "stock count", "damaged")':
    'กรุณาระบุเหตุผล (เช่น “ตรวจนับสต็อก”, “สินค้าเสียหาย”)',
  'Give either a change (delta) or a new total (set)':
    'กรุณาระบุจำนวนที่เปลี่ยนหรือยอดรวมใหม่อย่างใดอย่างหนึ่ง',
  'The change cannot be zero': 'จำนวนที่เปลี่ยนต้องไม่เป็นศูนย์',
  'The lowest price is above the highest': 'ราคาต่ำสุดต้องไม่สูงกว่าราคาสูงสุด',
  'Choose 1 to 5 stars': 'กรุณาเลือก 1 ถึง 5 ดาว',
  'Write a few words about the product': 'กรุณาเขียนความเห็นเกี่ยวกับสินค้าสักเล็กน้อย',

  // --- finance ---
  'Idempotency-Key must be at least 8 characters': 'คำขอไม่สมบูรณ์ กรุณาลองใหม่อีกครั้ง',
  'Idempotency-Key may only contain letters, digits and _-:.':
    'คำขอไม่สมบูรณ์ กรุณาลองใหม่อีกครั้ง',
  'Give the rule a name': 'กรุณาตั้งชื่อกฎ',
  'Give a reason (it is kept in the financial audit log)':
    'กรุณาระบุเหตุผล (จะถูกบันทึกไว้ในประวัติการตรวจสอบทางการเงิน)',
  'Maximum fee must not be below the minimum fee':
    'ค่าธรรมเนียมสูงสุดต้องไม่ต่ำกว่าค่าธรรมเนียมขั้นต่ำ',
  'Maximum price must not be below the minimum price': 'ราคาสูงสุดต้องไม่ต่ำกว่าราคาต่ำสุด',
  'The end date must be after the start date': 'วันสิ้นสุดต้องอยู่หลังวันเริ่มต้น',
  'Use the bank code, e.g. KBANK': 'ใช้รหัสธนาคาร เช่น KBANK',
  'Account number must be 8–20 digits': 'เลขบัญชีต้องเป็นตัวเลข 8–20 หลัก',
  'Enter the account holder name': 'กรุณากรอกชื่อเจ้าของบัญชี',

  // --- AI (admin) ---
  'The minimum must be below the maximum': 'ค่าต่ำสุดต้องน้อยกว่าค่าสูงสุด',
  'Say where these numbers come from (guideline, veterinarian, farm policy)':
    'กรุณาระบุที่มาของตัวเลขเหล่านี้ (แนวทางปฏิบัติ สัตวแพทย์ หรือนโยบายฟาร์ม)',
  'Set at least one rule': 'กรุณาตั้งกฎอย่างน้อยหนึ่งข้อ',
  'Give the reference of the validation (study, review, sign-off) before marking the method validated':
    'กรุณาระบุเอกสารอ้างอิงการตรวจสอบ (งานวิจัย การทบทวน หรือการอนุมัติ) ก่อนระบุว่าวิธีนี้ผ่านการตรวจสอบแล้ว',
  'Name the source of this price': 'กรุณาระบุแหล่งที่มาของราคานี้',
  'State why FARM+ is allowed to use this data':
    'กรุณาระบุเหตุผลที่ FARM+ ได้รับอนุญาตให้ใช้ข้อมูลนี้',
  'Unknown animal type': 'ไม่พบชนิดสัตว์นี้',
  'A price cannot be observed in the future': 'วันที่สำรวจราคาต้องไม่เป็นวันในอนาคต',

  // --- API field messages: animals and growth ---
  'Unknown or inactive animal type': 'ไม่พบชนิดสัตว์นี้ หรือชนิดสัตว์นี้ปิดใช้งานแล้ว',
  'Duplicate animal type': 'เลือกชนิดสัตว์ซ้ำ',
  'The end of the age range must be after its start': 'อายุสิ้นสุดต้องมากกว่าอายุเริ่มต้น',
  'The minimum cannot be greater than the maximum': 'ค่าต่ำสุดต้องไม่มากกว่าค่าสูงสุด',
  'Give at least one minimum or maximum': 'ระบุค่าต่ำสุดหรือสูงสุดอย่างน้อยหนึ่งค่า',
  'Only an age range applies to this kind of criterion': 'เกณฑ์ชนิดนี้ระบุได้เฉพาะช่วงอายุ',
  'A reference needs a citation': 'เกณฑ์อ้างอิงต้องระบุแหล่งที่มา',
  'Whole days only': 'ระบุเป็นจำนวนวันเต็ม',
  'Breed is not part of this animal type': 'สายพันธุ์นี้ไม่อยู่ในประเภทสัตว์ที่เลือก',
  'Sire and dam must be different animals': 'พ่อพันธุ์และแม่พันธุ์ต้องเป็นสัตว์คนละตัวกัน',
  'An animal cannot be its own parent': 'สัตว์เป็นพ่อหรือแม่ของตัวเองไม่ได้',
  'That would make the animal its own ancestor': 'การบันทึกนี้จะทำให้สัตว์เป็นบรรพบุรุษของตัวเอง',
  'Must be before the birth of this animal’s offspring': 'ต้องอยู่ก่อนวันเกิดของลูกของสัตว์ตัวนี้',
  'Records for this animal exist from before this date':
    'มีบันทึกของสัตว์ตัวนี้ก่อนวันที่นี้อยู่แล้ว',
  'Already used on this farm': 'ถูกใช้ในฟาร์มนี้แล้ว',
  'This host is not an allowed media source': 'ไม่อนุญาตให้ใช้สื่อจากเว็บไซต์นี้',
  'A photo must be an image': 'ไฟล์รูปภาพต้องเป็นไฟล์ภาพ',
  'Attached twice': 'แนบไฟล์ซ้ำ',
  'This file is attached twice': 'แนบไฟล์นี้ซ้ำ',
  'The animal was not born yet on this date': 'สัตว์ยังไม่เกิดในวันที่นี้',
  'Animal not found on this farm': 'ไม่พบสัตว์ตัวนี้ในฟาร์ม',
  'Some fields cannot be corrected': 'บางช่องแก้ไขไม่ได้',
  'This field cannot be corrected. Void the record and create a new one.':
    'ช่องนี้แก้ไขไม่ได้ กรุณายกเลิกบันทึกนี้แล้วสร้างบันทึกใหม่',
  'Invalid breeds': 'ข้อมูลสายพันธุ์ไม่ถูกต้อง',

  // --- API field messages: breeding ---
  'The dam was not found on this farm': 'ไม่พบแม่พันธุ์ตัวนี้ในฟาร์ม',
  'The dam must be recorded as female': 'แม่พันธุ์ต้องถูกบันทึกเป็นเพศเมีย',
  'The dam was not born yet on this date': 'แม่พันธุ์ยังไม่เกิดในวันที่นี้',
  'The sire was not found on this farm': 'ไม่พบพ่อพันธุ์ตัวนี้ในฟาร์ม',
  'The sire must be recorded as male': 'พ่อพันธุ์ต้องถูกบันทึกเป็นเพศผู้',
  'The sire must be the same animal type as the dam': 'พ่อพันธุ์ต้องเป็นสัตว์ชนิดเดียวกับแม่พันธุ์',
  'The sire was not born yet on this date': 'พ่อพันธุ์ยังไม่เกิดในวันที่นี้',
  'The sire is the dam’s own father': 'พ่อพันธุ์ตัวนี้เป็นพ่อของแม่พันธุ์',
  'The sire is the dam’s own son': 'พ่อพันธุ์ตัวนี้เป็นลูกของแม่พันธุ์',
  'Breeding cannot be after the recorded pregnancy check':
    'วันผสมพันธุ์ต้องไม่อยู่หลังวันตรวจการตั้งท้องที่บันทึกไว้',
  'Breeding cannot be after the recorded failure date':
    'วันผสมพันธุ์ต้องไม่อยู่หลังวันที่บันทึกว่าผสมไม่ติด',
  'Breeding cannot be after the recorded delivery':
    'วันผสมพันธุ์ต้องไม่อยู่หลังวันคลอดที่บันทึกไว้',
  'The check cannot be before the breeding date': 'วันตรวจต้องไม่ก่อนวันผสมพันธุ์',
  'This cannot be before the breeding date': 'ต้องไม่ก่อนวันผสมพันธุ์',
  'An animal cannot be its own parent’s offspring': 'สัตว์เป็นลูกของพ่อแม่ตัวเองซ้ำไม่ได้',
  'The offspring must be the same animal type as the dam': 'ลูกต้องเป็นสัตว์ชนิดเดียวกับแม่พันธุ์',
  'That animal is an ancestor of the dam': 'สัตว์ตัวนี้เป็นบรรพบุรุษของแม่พันธุ์',
  'That animal is an ancestor of the sire': 'สัตว์ตัวนี้เป็นบรรพบุรุษของพ่อพันธุ์',
  'This animal is listed twice': 'มีสัตว์ตัวนี้ซ้ำในรายการ',
  'This code is listed twice': 'มีรหัสนี้ซ้ำในรายการ',
  'The delivery cannot be before the breeding date': 'วันคลอดต้องไม่ก่อนวันผสมพันธุ์',
  'The delivery cannot be before the pregnancy check': 'วันคลอดต้องไม่ก่อนวันตรวจการตั้งท้อง',
  'Add at least one offspring': 'กรุณาเพิ่มลูกอย่างน้อยหนึ่งตัว',

  // --- API field messages: health and expenses ---
  'Related record not found on this farm': 'ไม่พบบันทึกที่เกี่ยวข้องในฟาร์มนี้',
  'Related record not found for this animal': 'ไม่พบบันทึกที่เกี่ยวข้องของสัตว์ตัวนี้',
  'The related record has been voided': 'บันทึกที่เกี่ยวข้องถูกยกเลิกแล้ว',
  'The expense is attributed to a different animal than the related record':
    'ค่าใช้จ่ายนี้ระบุสัตว์คนละตัวกับบันทึกที่เกี่ยวข้อง',
  'The record cannot be dated before the animal was born':
    'วันที่ของบันทึกต้องไม่ก่อนวันเกิดของสัตว์',

  // --- API field messages: marketplace and orders ---
  'This photo is added twice': 'เพิ่มรูปภาพนี้ซ้ำ',
  'Add at least one photo before submitting': 'กรุณาเพิ่มรูปภาพอย่างน้อยหนึ่งรูปก่อนส่ง',
  'Add your delivery prices, or untick delivery': 'กรุณาเพิ่มค่าจัดส่ง หรือยกเลิกตัวเลือกจัดส่ง',
  'Add your delivery rates, or offer pickup only':
    'กรุณาเพิ่มอัตราค่าจัดส่ง หรือเลือกให้รับเองเท่านั้น',
  'Invalid amount': 'จำนวนเงินไม่ถูกต้อง',
  'An offer cannot be above the asking price': 'ราคาเสนอต้องไม่สูงกว่าราคาที่ตั้งไว้',
  'This amount is below what the seller will consider': 'จำนวนเงินนี้ต่ำกว่าราคาที่ผู้ขายจะพิจารณา',
  'The price is fixed: the offer must equal the asking price':
    'ราคานี้เป็นราคาตายตัว ราคาเสนอต้องเท่ากับราคาที่ตั้งไว้',
  'A counter-offer cannot be below the buyer’s offer':
    'ราคาที่เสนอกลับต้องไม่ต่ำกว่าราคาที่ผู้ซื้อเสนอ',
  'A counter-offer cannot be above the seller’s price':
    'ราคาที่เสนอกลับต้องไม่สูงกว่าราคาของผู้ขาย',
  'That is the current price: accept it instead': 'นี่คือราคาปัจจุบันอยู่แล้ว กรุณากดตอบรับแทน',
  'The file extension does not match the video type': 'นามสกุลไฟล์ไม่ตรงกับประเภทวิดีโอ',
  'Confirm you can meet the transport requirements for this animal':
    'กรุณายืนยันว่าคุณทำตามข้อกำหนดการขนส่งของสัตว์ตัวนี้ได้',
  'Unknown shipping quote': 'ไม่พบค่าจัดส่งที่คำนวณไว้ กรุณาคำนวณใหม่',
  'Unknown shipping option': 'ไม่พบตัวเลือกการจัดส่งนี้',

  // --- API field messages: shop ---
  'Not enough stock': 'สินค้าในสต็อกไม่เพียงพอ',
  'A category cannot be its own parent': 'หมวดหมู่เป็นหมวดหมู่หลักของตัวเองไม่ได้',
  'Unknown parent category': 'ไม่พบหมวดหมู่หลักนี้',
  'Categories can be nested one level only': 'หมวดหมู่ซ้อนกันได้เพียงชั้นเดียว',
  'Regulated goods need the reference of the compliance review that approved their sale':
    'สินค้าควบคุมต้องระบุเลขอ้างอิงผลการตรวจสอบที่อนุมัติให้ขาย',
  'Unknown product category': 'ไม่พบหมวดหมู่สินค้านี้',
  'Choose one of the listed categories': 'กรุณาเลือกหมวดหมู่จากรายการ',
  'This category is not open for sale': 'หมวดหมู่นี้ยังไม่เปิดให้ขาย',
  'Regulated goods need their registration or licence number':
    'สินค้าควบคุมต้องระบุเลขทะเบียนหรือเลขใบอนุญาต',
  'Stock cannot be negative': 'จำนวนสต็อกต้องไม่ติดลบ',
  'Another product of this farm already uses that SKU':
    'รหัส SKU นี้ถูกใช้กับสินค้าอื่นของฟาร์มแล้ว',

  // --- API field messages: analytics and settings ---
  'Orders cannot be filtered by animal type': 'คำสั่งซื้อกรองตามชนิดสัตว์ไม่ได้',
  'Not available for the orders export': 'ใช้กับการส่งออกคำสั่งซื้อไม่ได้',
  'The start date is after the end date': 'วันเริ่มต้นต้องไม่อยู่หลังวันสิ้นสุด',
  'Unknown setting': 'ไม่พบการตั้งค่านี้',
  'Invalid settings': 'การตั้งค่าไม่ถูกต้อง',

  // --- Zod defaults without numbers ---
  'Invalid input': 'ข้อมูลไม่ถูกต้อง',
  'Invalid email address': 'อีเมลไม่ถูกต้อง',
  'Invalid URL': 'ลิงก์ (URL) ไม่ถูกต้อง',
  'Invalid E.164 number': 'เบอร์โทรศัพท์ต้องอยู่ในรูปแบบสากล เช่น +66812345678',
  'Invalid ISO datetime': 'วันที่และเวลาไม่ถูกต้อง',
  'Invalid ISO date': 'วันที่ไม่ถูกต้อง',
  'Invalid ISO time': 'เวลาไม่ถูกต้อง',
  'Invalid UUID': 'รหัสอ้างอิงไม่ถูกต้อง',
};

type Replacer = (match: RegExpExecArray) => string;

const SIZE_UNITS: Record<string, string> = {
  characters: 'ตัวอักษร',
  items: 'รายการ',
  bytes: 'ไบต์',
  entries: 'รายการ',
};
const PARENT: Record<string, string> = { dam: 'แม่พันธุ์', sire: 'พ่อพันธุ์' };
const SEX: Record<string, string> = { male: 'เพศผู้', female: 'เพศเมีย' };

function sizeMessage(direction: 'small' | 'big', adj: string, count: string, unit: string): string {
  const u = SIZE_UNITS[unit] ?? unit;
  if (direction === 'small') {
    if (count === '1' && adj === '>=')
      return unit === 'characters' ? 'กรุณากรอกข้อมูลช่องนี้' : `ต้องมีอย่างน้อย 1 ${u}`;
    if (adj === '>=') return `ต้องมีอย่างน้อย ${count} ${u}`;
    if (adj === '>') return `ต้องมีมากกว่า ${count} ${u}`;
    return `ต้องมี ${count} ${u}พอดี`;
  }
  if (adj === '<=') return `ต้องมีไม่เกิน ${count} ${u}`;
  if (adj === '<') return `ต้องมีน้อยกว่า ${count} ${u}`;
  return `ต้องมี ${count} ${u}พอดี`;
}

function valueMessage(direction: 'small' | 'big', adj: string, value: string): string {
  if (direction === 'small') {
    if (adj === '>=') return `ต้องไม่น้อยกว่า ${value}`;
    if (adj === '>') return `ต้องมากกว่า ${value}`;
    return `ต้องเท่ากับ ${value}`;
  }
  if (adj === '<=') return `ต้องไม่เกิน ${value}`;
  if (adj === '<') return `ต้องน้อยกว่า ${value}`;
  return `ต้องเท่ากับ ${value}`;
}

/**
 * Messages with numbers or names inside (from packages/validation, the API and Zod 4's default English messages).
 * The values are kept in the Thai message. The first matching pattern wins.
 */
const validationPatterns: readonly (readonly [RegExp, Replacer])[] = [
  // packages/validation templates
  [/^At most (\d+) characters$/, (m) => `ไม่เกิน ${m[1]} ตัวอักษร`],
  [/^At most (\d+) bps \((\d+)%\)$/, (m) => `ไม่เกิน ${m[1]} bps (${m[2]}%)`],
  [
    /^A (image|video) must be (?:image|video)\/\*$/,
    (m) => (m[1] === 'image' ? 'ไฟล์ต้องเป็นรูปภาพ' : 'ไฟล์ต้องเป็นวิดีโอ'),
  ],
  // API field templates
  [/^The minimum order is (\d+)$/, (m) => `สั่งซื้อขั้นต่ำ ${m[1]} ชิ้น`],
  [/^The maximum order is (\d+)$/, (m) => `สั่งซื้อได้สูงสุด ${m[1]} ชิ้น`],
  [/^A report can cover at most (\d+) days$/, (m) => `รายงานครอบคลุมได้ไม่เกิน ${m[1]} วัน`],
  [
    /^Daily detail is limited to (\d+) days: choose weeks or months$/,
    (m) => `ดูรายวันได้ไม่เกิน ${m[1]} วัน กรุณาเลือกเป็นรายสัปดาห์หรือรายเดือน`,
  ],
  [/^\w+ is not a real date$/, () => 'วันที่ไม่ถูกต้อง'],
  [/^The (dam|sire) was not found on this farm$/, (m) => `ไม่พบ${PARENT[m[1]!]}ตัวนี้ในฟาร์ม`],
  [
    /^The (dam|sire) must be the same animal type$/,
    (m) => `${PARENT[m[1]!]}ต้องเป็นสัตว์ชนิดเดียวกัน`,
  ],
  [
    /^The (dam|sire) is recorded as (male|female)$/,
    (m) => `${PARENT[m[1]!]}ตัวนี้ถูกบันทึกเป็น${SEX[m[2]!]}`,
  ],
  [/^Must be after the (dam|sire)'s birth date$/, (m) => `ต้องอยู่หลังวันเกิดของ${PARENT[m[1]!]}`],
  [
    /^The (dam|sire) was (\d+) days old; the minimum configured for (.+) is (\d+) days$/,
    (m) => `${PARENT[m[1]!]}มีอายุ ${m[2]} วัน แต่อายุขั้นต่ำที่กำหนดสำหรับ${m[3]}คือ ${m[4]} วัน`,
  ],
  [
    /^Above the maximum configured for (.+) \(([\d.]+) kg\)\. Check the value\.$/,
    (m) => `เกินค่าสูงสุดที่กำหนดสำหรับ${m[1]} (${m[2]} กก.) กรุณาตรวจสอบค่าอีกครั้ง`,
  ],
  [/^Breed "(.+)" is not available for (.+)$/, (m) => `สายพันธุ์ "${m[1]}" ไม่มีใน${m[2]}`],
  [/^Duplicate breed key "(.+)"$/, (m) => `รหัสสายพันธุ์ "${m[1]}" ซ้ำกัน`],
  [/^This listing is priced in (\w+)$/, (m) => `ประกาศนี้ตั้งราคาเป็นสกุลเงิน ${m[1]}`],
  [
    /^The seller does not offer (pickup|delivery) for this animal$/,
    (m) =>
      m[1] === 'pickup'
        ? 'ผู้ขายไม่มีบริการรับเองสำหรับสัตว์ตัวนี้'
        : 'ผู้ขายไม่มีบริการจัดส่งสำหรับสัตว์ตัวนี้',
  ],
  [
    /^The animal’s recorded birth date \((.+)\) differs from the delivery date$/,
    (m) => `วันเกิดที่บันทึกไว้ของสัตว์ (${m[1]}) ไม่ตรงกับวันคลอด`,
  ],
  [
    /^(\d+) unit\(s\) are held by unpaid orders: you cannot go below that$/,
    (m) => `มี ${m[1]} ชิ้นถูกจองไว้ในคำสั่งซื้อที่ยังไม่ชำระเงิน จึงลดต่ำกว่านี้ไม่ได้`,
  ],
  [/^Type “(.+)” to confirm$/, (m) => `พิมพ์ “${m[1]}” เพื่อยืนยัน`],
  [
    /^This product mentions “(.+)”, which is not allowed on FARM\+$/,
    (m) => `สินค้านี้กล่าวถึง “${m[1]}” ซึ่งไม่อนุญาตบน FARM+`,
  ],
  [
    /^“(.+)” reads as a treatment or health claim\./,
    (m) =>
      `“${m[1]}” เป็นการกล่าวอ้างสรรพคุณการรักษา กรุณาอธิบายว่าสินค้าคืออะไรและมีส่วนประกอบอะไร แทนการบอกว่ารักษาหรือป้องกันโรคอะไร`,
  ],
  [/^(.+) cannot be sold on FARM\+$/, (m) => `${m[1]} ห้ามขายบน FARM+`],
  [/^Expected (\w+)$/, (m) => `ค่าต้องเป็นประเภท ${m[1]}`],

  // Zod 4 defaults (node_modules/zod/v4/locales/en.js)
  [
    /^Invalid input: expected \w+, received (\w+)$/,
    (m) =>
      m[1] === 'undefined' || m[1] === 'null' ? 'กรุณากรอกข้อมูลช่องนี้' : 'รูปแบบข้อมูลไม่ถูกต้อง',
  ],
  [/^Invalid input: expected (.+)$/, (m) => `ค่าต้องเป็น ${m[1]}`],
  [/^Invalid input\b/, () => 'ข้อมูลไม่ถูกต้อง'],
  [/^Invalid option: expected one of /, () => 'กรุณาเลือกตัวเลือกที่ถูกต้อง'],
  [
    /^Too small: expected \w+ to have (>=|>|exactly )(\d+) (characters|items|bytes|entries)$/,
    (m) => sizeMessage('small', m[1]!.trim(), m[2]!, m[3]!),
  ],
  [
    /^Too big: expected \w+ to have (<=|<|exactly )(\d+) (characters|items|bytes|entries)$/,
    (m) => sizeMessage('big', m[1]!.trim(), m[2]!, m[3]!),
  ],
  [
    /^Too small: expected \w+ to be (>=|>|exactly )(.+)$/,
    (m) => valueMessage('small', m[1]!.trim(), m[2]!),
  ],
  [
    /^Too big: expected \w+ to be (<=|<|exactly )(.+)$/,
    (m) => valueMessage('big', m[1]!.trim(), m[2]!),
  ],
  [/^Invalid string: must start with "(.*)"$/, (m) => `ต้องขึ้นต้นด้วย "${m[1]}"`],
  [/^Invalid string: must end with "(.*)"$/, (m) => `ต้องลงท้ายด้วย "${m[1]}"`],
  [/^Invalid string: must include "(.*)"$/, (m) => `ต้องมี "${m[1]}"`],
  [/^Invalid string: must match pattern /, () => 'รูปแบบไม่ถูกต้อง'],
  [/^Invalid number: must be a multiple of (.+)$/, (m) => `ต้องเป็นผลคูณของ ${m[1]}`],
  [/^Unrecognized keys?: (.+)$/, (m) => `มีข้อมูลที่ไม่รู้จัก: ${m[1]}`],
  [/^Invalid discriminator value\./, () => 'ประเภทข้อมูลไม่ถูกต้อง'],
  [/^Invalid (?:key|value) in \w+$/, () => 'ข้อมูลไม่ถูกต้อง'],
  [/^Invalid [\w. -]+$/, () => 'รูปแบบไม่ถูกต้อง'],
];

const GENERIC_VALIDATION_MESSAGE_TH = 'ข้อมูลบางช่องไม่ถูกต้อง กรุณาตรวจสอบอีกครั้ง';

export function validationMessage(locale: Locale, english: string): string {
  if (locale === 'en') return english;
  if (Object.prototype.hasOwnProperty.call(validationMessages, english))
    return validationMessages[english]!;
  for (const [pattern, replace] of validationPatterns) {
    const match = pattern.exec(english);
    if (match) return replace(match);
  }
  return GENERIC_VALIDATION_MESSAGE_TH;
}
