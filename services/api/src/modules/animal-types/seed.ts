import { AnimalType } from '../../models';

const b = (key: string, name: string, nameTh: string) => ({ key, name, nameTh, active: true });

/**
 * Starter data so a new installation is usable. Created ONLY when no animal types exist; afterwards the catalogue
 * belongs to the administrators (`animal_types.manage`): species and breeds can be added, renamed or deactivated
 * freely. Nothing in the code depends on any of these keys.
 */
const STARTER_TYPES = [
  {
    key: 'buffalo',
    name: 'Buffalo',
    nameTh: 'ควาย',
    breeds: [b('swamp', 'Swamp buffalo', 'ควายไทย'), b('murrah', 'Murrah', 'เมอร์ราห์')],
  },
  {
    key: 'cattle',
    name: 'Cattle',
    nameTh: 'โค',
    breeds: [
      b('thai_native', 'Thai native', 'พื้นเมือง'),
      b('brahman', 'Brahman', 'บราห์มัน'),
      b('charolais', 'Charolais', 'ชาโรเลส์'),
    ],
  },
  {
    key: 'goat',
    name: 'Goat',
    nameTh: 'แพะ',
    breeds: [
      b('thai_native', 'Thai native', 'พื้นเมือง'),
      b('boer', 'Boer', 'โบเออร์'),
      b('saanen', 'Saanen', 'ซาเนน'),
    ],
  },
  {
    key: 'pig',
    name: 'Pig',
    nameTh: 'สุกร',
    breeds: [
      b('landrace', 'Landrace', 'แลนด์เรซ'),
      b('large_white', 'Large White', 'ลาร์จไวท์'),
      b('duroc', 'Duroc', 'ดูร็อก'),
    ],
  },
  {
    key: 'chicken',
    name: 'Chicken',
    nameTh: 'ไก่',
    breeds: [
      b('native', 'Native', 'พื้นเมือง'),
      b('layer', 'Layer', 'ไก่ไข่'),
      b('broiler', 'Broiler', 'ไก่เนื้อ'),
    ],
  },
  {
    key: 'duck',
    name: 'Duck',
    nameTh: 'เป็ด',
    breeds: [
      b('pekin', 'Pekin', 'ปักกิ่ง'),
      b('khaki_campbell', 'Khaki Campbell', 'กากีแคมป์เบลล์'),
    ],
  },
];

export async function seedAnimalTypes(): Promise<void> {
  if ((await AnimalType.estimatedDocumentCount()) > 0) return;
  await AnimalType.insertMany(
    STARTER_TYPES.map((t) => ({ ...t, status: 'active', isSeeded: true })),
  );
}
