/**
 * Starter catalogue for fighting cocks (ไก่ชน): 1 rearing type, 5 breed groups, 39 breeds.
 *
 * This is STARTER DATA only: once in the database it belongs to the administrators (`animal_types.manage`), who can
 * add, rename and deactivate entries at /admin/animal-types without a code change. Nothing in the code depends on
 * these keys. Migration 0002 adds whatever is missing to an existing database and never changes what is there.
 *
 * FROZEN: migration 0002 applies exactly this list. To change the starter catalogue later, add a new migration
 * (with its own data) instead of editing this file.
 *
 * `composition` = the lineage components a breed stands for, used only to SUGGEST an offspring's breed from its real
 * parents. Without it a breed counts as its group. A component may be a line with no group of its own ("pakoi").
 */
export const FIGHTING_COCK_REARING_TYPE = {
  key: 'fighting_cock',
  name: 'Fighting cock',
  nameTh: 'ไก่ชน',
} as const;

export const FIGHTING_COCK_GROUPS = [
  { key: 'thai', name: 'Thai fighting cock breeds', nameTh: 'สายพันธุ์ไก่ชนไทย' },
  { key: 'burmese', name: 'Burmese breeds', nameTh: 'สายพันธุ์ไก่พม่า' },
  { key: 'saigon', name: 'Vietnamese (Saigon) breeds', nameTh: 'สายพันธุ์เวียดนาม (ไซ่ง่อน)' },
  { key: 'foreign', name: 'Taiwanese & foreign breeds', nameTh: 'สายพันธุ์ไต้หวันและต่างประเทศ' },
  { key: 'crossbred', name: 'Crossbreeds', nameTh: 'สายพันธุ์ลูกผสม' },
] as const;

interface CatalogueBreed {
  key: string;
  name: string;
  nameTh: string;
  groupKey: string;
  composition?: string[];
}

const g =
  (groupKey: string) =>
  (key: string, name: string, nameTh: string, composition?: string[]): CatalogueBreed => ({
    key,
    name,
    nameTh,
    groupKey,
    ...(composition ? { composition } : {}),
  });
const thai = g('thai');
const burmese = g('burmese');
const saigon = g('saigon');
const foreign = g('foreign');
const cross = g('crossbred');

export const FIGHTING_COCK_BREEDS: CatalogueBreed[] = [
  thai('lueang_hang_khao', 'Lueang Hang Khao', 'เหลืองหางขาว'),
  thai('pradu_hang_dam', 'Pradu Hang Dam', 'ประดู่หางดำ'),
  thai('khiao_hang_dam', 'Khiao Hang Dam', 'เขียวหางดำ'),
  thai('thao_hang_khao', 'Thao Hang Khao', 'เทาหางขาว'),
  thai('nok_daeng', 'Nok Daeng', 'นกแดง'),
  thai('nok_krot_thong_daeng', 'Nok Krot Thong Daeng', 'นกกรดทองแดง'),
  thai('khiao_lao', 'Khiao Lao', 'เขียวเลา'),
  thai('thong_daeng_hang_dam', 'Thong Daeng Hang Dam', 'ทองแดงหางดำ'),
  thai('lai', 'Lai', 'ลาย'),
  thai('chi', 'Chi', 'ชี'),

  burmese('pama_ramwong', 'Burmese Ramwong', 'พม่ารำวง'),
  burmese('pama_ma_lo', 'Burmese Ma Lo', 'พม่าม้าล่อ'),
  burmese('pama_ngon', 'Burmese Ngon', 'พม่าง่อน'),
  burmese('pama_khaeng_plao', 'Burmese Khaeng Plao', 'พม่าแข้งเปล่า'),
  burmese('pama_na_hngon', 'Burmese Na Ngon', 'พม่าหน้าหงอน'),
  burmese('pama_hua_chuk', 'Burmese Hua Chuk', 'พม่าหัวจุก'),
  burmese('pama_hang_dam', 'Burmese Hang Dam', 'พม่าหางดำ'),
  burmese('pama_mon', 'Burmese Mon', 'พม่าหม่น'),
  burmese('pama_roi', 'Burmese Roi', 'พม่าร้อย'),
  burmese('pama_cross', 'Burmese crossbred', 'พม่าลูกผสม'),

  saigon('saigon', 'Saigon', 'ไก่ไซ่ง่อน'),
  saigon('vietnamese', 'Vietnamese', 'ไก่เวียดนาม'),
  saigon('ga_don', 'Ga Don', 'ไก่ตีดอน (Ga Don)'),
  saigon('saigon_cross', 'Saigon crossbred', 'ไก่ลูกผสมไซ่ง่อน'),

  foreign('taiwan', 'Taiwanese (Yiar)', 'ไก่ไต้หวัน (เยียร์)', ['taiwan']),
  foreign('brazil', 'Brazilian', 'ไก่บราซิล', ['brazil']),
  foreign('aseel', 'Indian (Aseel)', 'ไก่อินเดีย (อาซิล)', ['aseel']),
  foreign('malay', 'Malay', 'ไก่มาเลย์', ['malay']),
  foreign('shamo', 'Japanese (Shamo)', 'ไก่ญี่ปุ่น (ชาโม)', ['shamo']),

  cross('cross_burmese_thai', 'Burmese + Thai', 'พม่า + ไทย', ['burmese', 'thai']),
  cross('cross_burmese_saigon', 'Burmese + Saigon', 'พม่า + ไซ่ง่อน', ['burmese', 'saigon']),
  cross('cross_burmese_pakoi', 'Burmese + Pakoi', 'พม่า + ป่าก๋อย', ['burmese', 'pakoi']),
  cross('cross_thai_pakoi', 'Thai + Pakoi', 'ไทย + ป่าก๋อย', ['thai', 'pakoi']),
  cross('cross_saigon_pakoi', 'Saigon + Pakoi', 'ไซ่ง่อน + ป่าก๋อย', ['saigon', 'pakoi']),
  cross('cross_thai_saigon', 'Thai + Saigon', 'ไทย + ไซ่ง่อน', ['thai', 'saigon']),
  cross('cross_burmese_thai_pakoi', 'Burmese + Thai + Pakoi', 'พม่า + ไทย + ป่าก๋อย', [
    'burmese',
    'thai',
    'pakoi',
  ]),
  cross('cross_burmese_saigon_pakoi', 'Burmese + Saigon + Pakoi', 'พม่า + ไซ่ง่อน + ป่าก๋อย', [
    'burmese',
    'saigon',
    'pakoi',
  ]),
  cross('cross_burmese_saigon_thai', 'Burmese + Saigon + Thai', 'พม่า + ไซ่ง่อน + ไทย', [
    'burmese',
    'saigon',
    'thai',
  ]),
  cross('cross_brazil_burmese', 'Brazilian + Burmese', 'บราซิล + พม่า', ['brazil', 'burmese']),
];

/** The rearing type, groups and breeds as they are stored on the `chicken` animal type. */
export function fightingCockCatalogue() {
  return {
    rearingTypes: [{ ...FIGHTING_COCK_REARING_TYPE, active: true }],
    breedGroups: FIGHTING_COCK_GROUPS.map((x) => ({
      ...x,
      rearingTypeKey: FIGHTING_COCK_REARING_TYPE.key,
      active: true,
    })),
    breeds: FIGHTING_COCK_BREEDS.map((b) => ({ ...b, active: true })),
  };
}
