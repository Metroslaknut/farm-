import { defineMessages } from '@farmplus/i18n';

/** App-side error texts (API errors by code come from @farmplus/i18n `apiErrorMessage`). */
export default defineMessages({
  th: {
    offline: 'เชื่อมต่อ FARM+ ไม่ได้ กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองใหม่',
    sessionExpired: 'เซสชันหมดอายุแล้ว กรุณาเข้าสู่ระบบอีกครั้ง',
    server: 'ระบบ FARM+ ขัดข้องชั่วคราว กรุณาลองใหม่อีกสักครู่',
    somethingWrong: 'เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง',
    somethingWrongShort: 'เกิดข้อผิดพลาด',
    cantConnect: 'เชื่อมต่อไม่ได้',
    errorTitle: 'เกิดข้อผิดพลาด',
  },
  en: {
    offline: 'Can’t reach FARM+. Check your connection and try again.',
    sessionExpired: 'Your session has expired. Please sign in again.',
    server: 'FARM+ is having trouble right now. Please try again shortly.',
    somethingWrong: 'Something went wrong. Please try again.',
    somethingWrongShort: 'Something went wrong.',
    cantConnect: 'Can’t connect',
    errorTitle: 'Something went wrong',
  },
});
