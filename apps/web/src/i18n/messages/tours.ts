import { defineMessages } from '@farmplus/i18n';

/**
 * Guided tours: the buttons, and the text of every step (`<tourId>.<n>.title|body`, ≤ 2 lines each).
 * Thai first, written for farmers; English with the same keys (tsc checks they match).
 */
export default defineMessages({
  th: {
    'ui.stepOf': 'ขั้นที่ {n} จาก {total}',
    'ui.announce': 'คำแนะนำ ขั้นที่ {n} จาก {total}: {title}',
    'ui.next': 'ถัดไป',
    'ui.back': 'ย้อนกลับ',
    'ui.done': 'เสร็จสิ้น',
    'ui.skip': 'ข้าม',
    'ui.dontShow': 'ไม่ต้องแสดงคำแนะนำนี้อีก',
    'ui.readMore': 'อ่านเพิ่ม',
    'ui.showAgain': 'ดูคำแนะนำหน้านี้อีกครั้ง',
    'ui.listTitle': 'คำแนะนำทีละขั้น',
    'ui.listLead': 'เริ่มคำแนะนำของหน้าใดหน้าหนึ่งใหม่ได้ทุกเมื่อ',
    'ui.start': 'เริ่มคำแนะนำ',
    'name.help-centre': 'ศูนย์ช่วยเหลือ',
    'help-centre.1.title': 'ค้นหาวิธีใช้',
    'help-centre.1.body': 'พิมพ์สิ่งที่อยากรู้ เช่น "ไม่ได้รับอีเมล" แล้วกด "ค้นหาวิธีใช้"',
    'help-centre.2.title': 'เริ่มต้นใช้งาน',
    'help-centre.2.body': 'ผู้ใช้ใหม่เริ่มอ่านจากหมวดนี้ มีตั้งแต่สมัครสมาชิกจนถึงสร้างฟาร์ม',
    'help-centre.3.title': 'คำแนะนำทีละขั้น',
    'help-centre.3.body': 'กด "เริ่มคำแนะนำ" เพื่อดูคำแนะนำของหน้าต่าง ๆ อีกครั้งเมื่อไหร่ก็ได้',
  },
  en: {
    'ui.stepOf': 'Step {n} of {total}',
    'ui.announce': 'Tip, step {n} of {total}: {title}',
    'ui.next': 'Next',
    'ui.back': 'Back',
    'ui.done': 'Done',
    'ui.skip': 'Skip',
    'ui.dontShow': "Don't show these tips again",
    'ui.readMore': 'Read more',
    'ui.showAgain': "Show this page's tips again",
    'ui.listTitle': 'Step-by-step tips',
    'ui.listLead': 'Start the tips of any page again whenever you like.',
    'ui.start': 'Start the tips',
    'name.help-centre': 'Help centre',
    'help-centre.1.title': 'Search the help',
    'help-centre.1.body':
      'Type what you want to know, e.g. "email did not arrive", then press "Search help".',
    'help-centre.2.title': 'Getting started',
    'help-centre.2.body': 'New users start here: from registering to creating a farm.',
    'help-centre.3.title': 'Step-by-step tips',
    'help-centre.3.body': 'Press "Start the tips" to see a page\'s tips again whenever you like.',
  },
});
