/**
 * Mockup data for FARM+: 10 shops (farms that sell products), 10 livestock farms with 20 animals each, and the users
 * who own them. Used by `scripts/seed-mockup.ts`; kept separate so tests can run it against an in-memory database.
 *
 * Identification: every mockup user's e-mail ends in `@mockup.farmplus.test`; farms are found by `createdBy`, and every
 * other document by the farm (or user) it belongs to. No extra field or collection is introduced.
 *
 * Idempotency: each document has a deterministic key (user e-mail, farm owner + name, farm + SKU, farm + animal code)
 * and is written with `$setOnInsert`, so a second run inserts only what is missing and never changes existing data.
 * Child records (growth, health, listings, parent links) are added only to animals that have none yet.
 */
import type { Model, Types } from 'mongoose';
import type { AnimalSex, AnimalStatus, ProductStatus } from '@farmplus/shared-types';
import { hashPassword } from '../../lib/password';
import {
  Animal,
  AnimalType,
  BreedingRecord,
  Cart,
  Comment,
  Conversation,
  Farm,
  FarmExpense,
  FarmMember,
  FeedingRecord,
  Follow,
  HealthRecord,
  InventoryMovement,
  Listing,
  ListingEvent,
  ListingFavorite,
  Negotiation,
  Notification,
  NotificationPreference,
  OAuthIdentity,
  Order,
  Post,
  Product,
  ProductReview,
  Reaction,
  RefreshToken,
  Role,
  Session,
  User,
  UserRole,
  VerificationToken,
  WeightRecord,
} from '../../models';
import { seedAnimalTypes } from '../../modules/animal-types/seed';
import { seedProductCategories } from '../../modules/products/compliance';
import { getNumberSetting } from '../../modules/settings/settings.service';
import { syncRbac } from '../../rbac/seed';
import {
  ANIMAL_TYPES,
  FARMS,
  LIVESTOCK_NAMES,
  MOCKUP_EMAIL_DOMAIN,
  MOCKUP_NOTE,
  PET_NAMES,
  PRODUCT_GROUPS,
  PRODUCT_TEMPLATES,
  SHOPS,
  type AnimalTypeSpec,
  type BreedSpec,
  type FarmSpec,
  type ShopSpec,
} from './catalog';
import { IMAGES } from './images';

const DAY = 86_400_000;
export const MOCKUP_EMAIL_PATTERN = new RegExp(`@${MOCKUP_EMAIL_DOMAIN.replace(/\./g, '\\.')}$`);
export const mockupEmail = (code: string) => `${code.toLowerCase()}@${MOCKUP_EMAIL_DOMAIN}`;

// ─── Small helpers ───────────────────────────────────────────────────────────────────────────────────────────────────

/** Deterministic PRNG (mulberry32) seeded from a string, so every run plans the same data. */
function rngFor(seed: string): () => number {
  let a = [...seed].reduce(
    (h, c) => Math.imul(h ^ c.charCodeAt(0), 2_654_435_761) >>> 0,
    1_779_033_703,
  );
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}
const randInt = (rng: () => number, min: number, max: number) =>
  min + Math.floor(rng() * (max - min + 1));
const pick = <T>(rng: () => number, items: readonly T[]): T =>
  items[Math.floor(rng() * items.length)]!;
const daysBefore = (now: Date, days: number) => new Date(now.getTime() - days * DAY);
const addDays = (date: Date, days: number) => new Date(date.getTime() + days * DAY);
const minDate = (a: Date, b: Date) => (a < b ? a : b);
const maxDate = (a: Date, b: Date) => (a > b ? a : b);

/** A checked Commons image for the key, rotated by `index`; a labelled placeholder when the manifest has none. */
export function imageFor(key: string, index: number): string {
  const list = IMAGES[key] ?? [];
  if (list.length > 0) return list[index % list.length]!.url;
  return `https://placehold.co/640x480/png?text=${encodeURIComponent(key.replace(/^[a-z]+:/, ''))}`;
}
const avatarFor = (code: string) =>
  `https://placehold.co/256x256/2e7d32/ffffff/png?text=${encodeURIComponent(code)}`;

/** Live weight (kg) at an age, from the breed's growth curve and a per-animal factor. */
export function weightAt(
  breed: BreedSpec,
  sex: AnimalSex,
  ageDays: number,
  factor: number,
): number {
  const adult = sex === 'male' ? breed.adultKg.male : breed.adultKg.female;
  const kg =
    (breed.birthKg + (adult - breed.birthKg) * (1 - Math.exp(-ageDays / breed.tauDays))) * factor;
  const digits = kg >= 100 ? 0 : kg >= 10 ? 1 : kg >= 1 ? 2 : 3;
  return Number(kg.toFixed(digits));
}

/**
 * Validate with the real schema (types, enums, required fields, defaults) and return the plain document. Writes then go
 * through the driver so dates the seed sets on purpose (createdAt of a farm registered two years ago) are kept as given.
 */
async function prepare<T>(
  model: Model<T>,
  data: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const doc = new model(data);
  await doc.validate();
  return doc.toObject({ depopulate: true }) as Record<string, unknown>;
}

/** Insert-if-missing by a natural key. Returns the stored document's id and whether it was created now. */
async function upsertOne<T>(
  model: Model<T>,
  filter: Record<string, unknown>,
  data: Record<string, unknown>,
): Promise<{ id: Types.ObjectId; created: boolean }> {
  const raw = await prepare(model, { ...filter, ...data });
  const res = await model.collection.updateOne(filter, { $setOnInsert: raw }, { upsert: true });
  if (res.upsertedId) return { id: res.upsertedId as Types.ObjectId, created: true };
  const existing = await model.collection.findOne(filter, { projection: { _id: 1 } });
  return { id: existing!['_id'] as Types.ObjectId, created: false };
}

// ─── Report ──────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface SeedReport {
  created: Record<string, number>;
  existing: Record<string, number>;
  animalTypesCreated: string[];
  breedsAdded: string[];
  warnings: string[];
}

function tally(report: SeedReport, collection: string, created: boolean): void {
  const bucket = created ? report.created : report.existing;
  bucket[collection] = (bucket[collection] ?? 0) + 1;
}

// ─── Reference data ──────────────────────────────────────────────────────────────────────────────────────────────────

/** Adds the animal types and breeds the mockup needs if they are missing. Never renames or deactivates anything. */
async function ensureAnimalTypes(
  report: SeedReport,
): Promise<Map<string, { id: Types.ObjectId; name: string }>> {
  const byKey = new Map<string, { id: Types.ObjectId; name: string }>();
  for (const spec of ANIMAL_TYPES) {
    const breeds = spec.breeds.map((b) => ({
      key: b.key,
      name: b.name,
      nameTh: b.nameTh,
      active: true,
    }));
    const existing = await AnimalType.findOne({ key: spec.key });
    if (!existing) {
      const created = await AnimalType.create({
        key: spec.key,
        name: spec.name,
        nameTh: spec.nameTh,
        status: 'active',
        breeds,
        isSeeded: false,
      });
      report.animalTypesCreated.push(spec.key);
      byKey.set(spec.key, { id: created._id, name: created.name });
      continue;
    }
    if (existing.status !== 'active')
      report.warnings.push(
        `Animal type "${spec.key}" exists but is ${existing.status}: its animals are seeded anyway`,
      );
    for (const b of breeds) {
      const current = existing.breeds.find((x) => x.key === b.key);
      if (!current) {
        await AnimalType.updateOne(
          { _id: existing._id, 'breeds.key': { $ne: b.key } },
          { $push: { breeds: b } },
        );
        report.breedsAdded.push(`${spec.key}:${b.key}`);
      } else if (!current.active) {
        report.warnings.push(
          `Breed "${spec.key}:${b.key}" is inactive: animals of it cannot be edited through the API`,
        );
      }
    }
    byKey.set(spec.key, { id: existing._id, name: existing.name });
  }
  return byKey;
}

async function roleIds(keys: string[]): Promise<Types.ObjectId[]> {
  const roles = await Role.find({ key: { $in: keys } });
  if (roles.length !== keys.length) throw new Error(`Missing roles: expected ${keys.join(', ')}`);
  return roles.map((r) => r._id);
}

// ─── Users and farms ─────────────────────────────────────────────────────────────────────────────────────────────────

async function ensureOwner(
  report: SeedReport,
  code: string,
  owner: { displayName: string },
  roles: Types.ObjectId[],
  passwordHash: string,
  now: Date,
): Promise<Types.ObjectId> {
  const { id, created } = await upsertOne(
    User,
    { email: mockupEmail(code) },
    {
      displayName: owner.displayName,
      passwordHash,
      avatarUrl: avatarFor(code),
      locale: 'th',
      status: 'active',
      // Mirrors an approved seller registration so the account can sell (as `applyEffects` does on approval).
      sellerVerification: 'verified',
      emailVerifiedAt: now,
      passwordChangedAt: now,
      createdAt: now,
      updatedAt: now,
    },
  );
  tally(report, 'users', created);
  for (const roleId of roles) {
    const r = await upsertOne(
      UserRole,
      { userId: id, roleId },
      { grantedBy: null, grantedAt: now },
    );
    tally(report, 'user_roles', r.created);
  }
  return id;
}

async function ensureFarm(
  report: SeedReport,
  spec: { name: string; place: ShopSpec['place']; owner: { phone: string }; ageDays: number },
  description: string,
  ownerId: Types.ObjectId,
  ownerEmail: string,
  animalTypeIds: Types.ObjectId[],
  now: Date,
): Promise<{ id: Types.ObjectId; createdAt: Date }> {
  const createdAt = daysBefore(now, spec.ageDays);
  const { id, created } = await upsertOne(
    Farm,
    { createdBy: ownerId, name: spec.name },
    {
      description: `${description}\n\n${MOCKUP_NOTE}`,
      status: 'active',
      location: { ...spec.place },
      contact: { phone: spec.owner.phone, email: ownerEmail },
      animalTypeIds,
      animalSeq: 0,
      createdAt,
      updatedAt: createdAt,
    },
  );
  tally(report, 'farms', created);
  const member = await upsertOne(
    FarmMember,
    { farmId: id, userId: ownerId },
    {
      role: 'owner',
      addedBy: null,
      createdAt,
    },
  );
  tally(report, 'farm_members', member.created);
  const stored = await Farm.findById(id).orFail();
  return { id, createdAt: stored.createdAt };
}

// ─── Products ────────────────────────────────────────────────────────────────────────────────────────────────────────

async function seedShopProducts(
  report: SeedReport,
  shop: ShopSpec,
  shopIndex: number,
  farmId: Types.ObjectId,
  farmCreatedAt: Date,
  ownerId: Types.ObjectId,
  now: Date,
): Promise<void> {
  const rng = rngFor(`products:${shop.code}`);
  let ordinary = 0;
  for (const [j, key] of shop.products.entries()) {
    const t = PRODUCT_TEMPLATES[key];
    const group = PRODUCT_GROUPS[t.group];
    const regulated = t.group === 'health_regulated';
    // A fixed mix per shop: on sale, on promotion, out of stock, paused (closed) and waiting for review.
    const k = regulated ? -1 : ordinary++;
    const status: ProductStatus = regulated
      ? 'DRAFT'
      : k === 5
        ? 'PAUSED'
        : k === 7
          ? 'PENDING_REVIEW'
          : 'ACTIVE';
    const outOfStock = k === 2;
    const priceMinor = Math.round((t.priceBaht * (0.92 + rng() * 0.16)) / 5) * 5 * 100;
    const stock = outOfStock ? 0 : randInt(rng, 5, 120);
    const createdAt = minDate(addDays(farmCreatedAt, 3 * (j + 1)), daysBefore(now, 1));
    const reviewed = status === 'ACTIVE' || status === 'PAUSED';
    const history: Record<string, unknown>[] = [
      { at: createdAt, type: 'created', from: null, to: 'DRAFT', actorId: ownerId },
    ];
    if (status !== 'DRAFT')
      history.push({
        at: addDays(createdAt, 1),
        type: 'seeded',
        from: 'DRAFT',
        to: status,
        actorId: null,
        data: { source: 'mockup-seed' },
      });

    const sku = `MOCK-${shop.code}-${String(j + 1).padStart(3, '0')}`;
    const { id, created } = await upsertOne(
      Product,
      { farmId, sku },
      {
        sellerId: ownerId,
        farmName: shop.name,
        categoryKey: group.categoryKey,
        title: t.title,
        description: regulated ? t.description : `${t.description}\n\n${MOCKUP_NOTE}`,
        brand: shop.brand,
        unit: t.unit,
        status,
        currency: 'THB',
        priceMinor,
        promotion:
          status === 'ACTIVE' && (k === 0 || k === 4)
            ? {
                priceMinor: Math.round((priceMinor * 0.88) / 500) * 500,
                startsAt: daysBefore(now, 3),
                endsAt: addDays(now, 27),
              }
            : null,
        specs: [{ name: 'กลุ่มสินค้า', value: group.label }, ...t.specs],
        photos: [{ url: imageFor(t.image, shopIndex + j), caption: t.title }],
        deliveryOptions: ['pickup'],
        shipping: null,
        minOrderQty: 1,
        maxOrderQty: null,
        stock,
        reserved: 0,
        lowStockThreshold: 5,
        regulatory: regulated
          ? {
              registrationNumber: `MOCK-REG-${shop.code}-${j + 1}`,
              notes: 'เลขทะเบียนสมมติสำหรับทดสอบ',
            }
          : null,
        review: {
          submittedAt: status === 'DRAFT' ? null : addDays(createdAt, 1),
          approvedAt: reviewed ? addDays(createdAt, 1) : null,
          approvedBy: null,
          rejectedReason: null,
          suspendedReason: null,
          moderatorHold: false,
        },
        ratingCount: 0,
        ratingSum: 0,
        soldCount: 0,
        history,
        createdAt,
        updatedAt: addDays(createdAt, 1),
      },
    );
    tally(report, 'products', created);
    // `stock` is a projection of the inventory ledger: the opening stock needs its `initial` movement.
    if (stock > 0) {
      const stored = await Product.findById(id).orFail();
      const m = await upsertOne(
        InventoryMovement,
        { productId: id, type: 'initial' },
        {
          farmId,
          deltaStock: stored.stock,
          deltaReserved: 0,
          actorId: ownerId,
          note: 'Opening stock',
          createdAt,
        },
      );
      tally(report, 'inventory_movements', m.created);
    }
  }
}

// ─── Animals ─────────────────────────────────────────────────────────────────────────────────────────────────────────

interface AnimalPlan {
  code: string;
  type: AnimalTypeSpec;
  breed: BreedSpec;
  sex: AnimalSex;
  ageDays: number;
  name: string;
  color: string;
  factor: number;
  sireCode?: string;
  damCode?: string;
  status: AnimalStatus;
  photo: string;
}

const SEX_TH: Record<AnimalSex, string> = {
  male: 'เพศผู้',
  female: 'เพศเมีย',
  unknown: 'ไม่ระบุเพศ',
};

function ageText(days: number): string {
  if (days < 60) return `${days} วัน`;
  const months = Math.floor(days / 30.44);
  if (months < 24) return `${months} เดือน`;
  const years = Math.floor(months / 12);
  return months % 12 ? `${years} ปี ${months % 12} เดือน` : `${years} ปี`;
}

/** Plans a farm's 20 animals: deterministic codes, ages, sexes, families and statuses. */
export function planFarmAnimals(farm: FarmSpec): AnimalPlan[] {
  const rng = rngFor(`animals:${farm.code}`);
  const plans: AnimalPlan[] = [];
  const counters = new Map<string, number>();
  const pools = { pet: 0, livestock: 0 };
  const family = new Set<string>();

  const add = (
    type: AnimalTypeSpec,
    breed: BreedSpec,
    sex: AnimalSex,
    ageDays: number,
    extra: Partial<AnimalPlan> = {},
  ): AnimalPlan => {
    const n = (counters.get(type.codePrefix) ?? 0) + 1;
    counters.set(type.codePrefix, n);
    const breedN = (counters.get(`${type.key}:${breed.key}`) ?? 0) + 1;
    counters.set(`${type.key}:${breed.key}`, breedN);
    const name =
      type.naming === 'pet'
        ? PET_NAMES[pools.pet++]!
        : type.naming === 'livestock'
          ? LIVESTOCK_NAMES[pools.livestock++]!
          : `${breed.nameTh} ${String(breedN).padStart(2, '0')}`;
    const plan: AnimalPlan = {
      code: `${type.codePrefix}-${String(n).padStart(3, '0')}`,
      type,
      breed,
      sex,
      ageDays,
      name,
      color: pick(rng, breed.colors),
      factor: 0.93 + rng() * 0.14,
      status: 'active',
      photo: imageFor(`${type.key}:${breed.key}`, plans.length),
      ...extra,
    };
    plans.push(plan);
    return plan;
  };

  for (const group of farm.groups) {
    const type = ANIMAL_TYPES.find((t) => t.key === group.type)!;
    const breed = type.breeds.find((b) => b.key === group.breed)!;
    const sexOf = (): AnimalSex => group.sex ?? (rng() < 0.5 ? 'male' : 'female');
    if (!group.family) {
      for (let i = 0; i < group.count; i++)
        add(type, breed, sexOf(), randInt(rng, 30, Math.round(breed.maxAgeDays * 0.7)));
      continue;
    }
    // A family: offspring are born on the farm after it was registered, and both parents were old enough to breed then.
    const childAges = Array.from({ length: group.count - 4 }, () =>
      randInt(rng, 30, Math.min(Math.round(breed.breedingAgeDays * 0.9), farm.ageDays - 90)),
    );
    const parentMin = Math.max(...childAges) + breed.breedingAgeDays + 30;
    const parentMax = Math.max(parentMin + 60, Math.round(breed.maxAgeDays * 0.6));
    const sire = add(type, breed, 'male', randInt(rng, parentMin, parentMax));
    const dams = [0, 1, 2].map(() =>
      add(type, breed, 'female', randInt(rng, parentMin, parentMax)),
    );
    family.add(sire.code);
    dams.forEach((d) => family.add(d.code));
    childAges.forEach((age, i) => {
      const child = add(type, breed, sexOf(), age, {
        sireCode: sire.code,
        damCode: dams[i % 3]!.code,
      });
      family.add(child.code);
    });
  }

  // Three animals ready for sale (with a live listing) and one sold, picked from animals outside the families.
  const candidates = plans.filter((p) => !family.has(p.code) && p.ageDays >= 60);
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j]!, candidates[i]!];
  }
  candidates.slice(0, 3).forEach((p) => (p.status = 'for_sale'));
  if (candidates[3]) candidates[3].status = 'sold';
  return plans;
}

function listingPriceMinor(plan: AnimalPlan, kg: number, rng: () => number): number {
  const baht =
    'each' in plan.breed.price
      ? plan.breed.price.each * (0.9 + rng() * 0.3)
      : Math.max(kg * plan.breed.price.perKg, 500);
  const step = baht >= 1000 ? 100 : 10;
  return Math.round(baht / step) * step * 100;
}

async function seedFarmAnimals(
  report: SeedReport,
  farm: FarmSpec,
  farmId: Types.ObjectId,
  farmCreatedAt: Date,
  ownerId: Types.ObjectId,
  types: Map<string, { id: Types.ObjectId; name: string }>,
  listingDays: number,
  now: Date,
): Promise<void> {
  const rng = rngFor(`records:${farm.code}`);
  const plans = planFarmAnimals(farm);

  for (const plan of plans) {
    const birthDate = daysBefore(now, plan.ageDays);
    const bornBeforeFarm = birthDate < farmCreatedAt;
    const bought = bornBeforeFarm || (!plan.sireCode && rng() < 0.3);
    const acquisitionDate = bought
      ? bornBeforeFarm
        ? addDays(farmCreatedAt, randInt(rng, 0, 30))
        : minDate(addDays(birthDate, randInt(rng, 30, 90)), daysBefore(now, 7))
      : null;
    const createdAt = minDate(
      addDays(maxDate(farmCreatedAt, acquisitionDate ?? birthDate), 1),
      now,
    );
    const { id, created } = await upsertOne(
      Animal,
      { farmId, animalCode: plan.code },
      {
        animalTypeId: types.get(plan.type.key)!.id,
        breed: plan.breed.key,
        name: plan.name,
        sex: plan.sex,
        birthDate,
        birthDateEstimated: bought,
        acquisitionDate,
        origin: bought
          ? { kind: 'purchased', note: 'ซื้อเข้าฟาร์ม (ข้อมูลทดสอบ)' }
          : { kind: 'born_on_farm', note: null },
        currentStatus: plan.status,
        sireId: null,
        damId: null,
        media: [
          {
            kind: 'photo',
            url: plan.photo,
            mimeType: 'image/jpeg',
            caption: `${plan.type.nameTh}พันธุ์${plan.breed.nameTh}`,
            uploadedBy: ownerId,
            uploadedAt: createdAt,
          },
        ],
        color: plan.color,
        notes: MOCKUP_NOTE,
        archivedAt: null,
        createdBy: ownerId,
        createdAt,
        updatedAt: createdAt,
      },
    );
    tally(report, 'animals', created);

    // Child records use what is STORED (a re-run may compute other dates than the run that created the animal).
    const animal = await Animal.findById(id).orFail();
    const born = animal.birthDate ?? birthDate;
    const ageNow = Math.floor((now.getTime() - born.getTime()) / DAY);
    const startAge = animal.acquisitionDate
      ? Math.max(0, Math.floor((animal.acquisitionDate.getTime() - born.getTime()) / DAY))
      : 0;
    const base = {
      farmId,
      revision: 1,
      createdBy: ownerId,
      voided: false,
      attachments: [],
      history: [],
    };

    let latestKg = weightAt(plan.breed, plan.sex, ageNow, plan.factor);
    if (!(await WeightRecord.exists({ animalId: id }))) {
      const endAge = Math.max(startAge, ageNow - randInt(rng, 0, 10));
      const span = endAge - startAge;
      const ages =
        span > 540
          ? [endAge - 365, endAge - 240, endAge - 120, endAge]
          : span >= 30
            ? [0, 1, 2, 3].map((i) => startAge + Math.round((span * i) / 3))
            : [startAge, endAge];
      const rows = [];
      for (const a of [...new Set(ages)]) {
        const weighedOn = addDays(born, a);
        const kg = weightAt(plan.breed, plan.sex, a, plan.factor * (0.98 + rng() * 0.04));
        latestKg = kg;
        rows.push(
          await prepare(WeightRecord, {
            ...base,
            animalId: id,
            weighedOn,
            weightKg: kg,
            method: plan.type.weighMethod,
            notes: a === 0 ? 'น้ำหนักแรกเกิด' : null,
            createdAt: weighedOn,
            updatedAt: weighedOn,
          }),
        );
      }
      await WeightRecord.collection.insertMany(rows);
      report.created['weight_records'] = (report.created['weight_records'] ?? 0) + rows.length;
    }

    if (!(await HealthRecord.exists({ animalId: id }))) {
      const earliest = addDays(born, startAge + 3);
      const recordedOn = maxDate(daysBefore(now, randInt(rng, 5, 90)), minDate(earliest, now));
      await HealthRecord.collection.insertOne(
        await prepare(HealthRecord, {
          ...base,
          animalId: id,
          type: 'checkup',
          recordedOn,
          title: 'ตรวจสุขภาพทั่วไปประจำรอบ',
          notes: 'บันทึกตัวอย่างสำหรับทดสอบระบบ (Mockup) ไม่ใช่คำแนะนำทางสัตวแพทย์',
          createdAt: recordedOn,
          updatedAt: recordedOn,
        }),
      );
      tally(report, 'health_records', true);
    }

    // Animals ready for sale get a live listing, as if the owner had published one.
    if (animal.currentStatus === 'for_sale' && !(await Listing.exists({ animalId: id }))) {
      const activatedAt = daysBefore(now, randInt(rng, 1, 10));
      await Listing.collection.insertOne(
        await prepare(Listing, {
          sellerId: ownerId,
          farmId,
          animalId: id,
          animal: {
            animalTypeId: animal.animalTypeId,
            animalTypeKey: plan.type.key,
            animalTypeName: types.get(plan.type.key)!.name,
            breed: animal.breed,
            sex: animal.sex,
            birthDate: animal.birthDate,
            birthDateEstimated: animal.birthDateEstimated,
          },
          farmName: farm.name,
          location: { province: farm.place.province, district: farm.place.district },
          title: `${plan.breed.nameTh} ${SEX_TH[animal.sex]} อายุ ${ageText(ageNow)} — ${animal.name ?? plan.code}`,
          description: `${plan.type.nameTh}พันธุ์${plan.breed.nameTh} สี${animal.color ?? plan.color} น้ำหนักล่าสุดประมาณ ${latestKg} กก. เลี้ยงที่${farm.name} จ.${farm.place.province}\n\n${MOCKUP_NOTE}`,
          status: 'ACTIVE',
          askingPriceMinor: listingPriceMinor(plan, latestKg, rng),
          currency: 'THB',
          negotiable: true,
          deliveryOptions: ['pickup'],
          photos: animal.media.map((m) => ({ url: m.url, caption: m.caption ?? null })),
          favoriteCount: 0,
          activatedAt,
          expiresAt: addDays(activatedAt, listingDays),
          animalStatusBefore: 'active',
          createdAt: addDays(activatedAt, -1),
          updatedAt: activatedAt,
        }),
      );
      tally(report, 'listings', true);
    }
  }

  // Parent links last, once every animal exists; only on animals that have no parents recorded yet.
  const ids = new Map(
    (await Animal.find({ farmId }).select('animalCode')).map((a) => [a.animalCode, a._id]),
  );
  for (const plan of plans) {
    if (!plan.sireCode || !plan.damCode) continue;
    const res = await Animal.collection.updateOne(
      { farmId, animalCode: plan.code, sireId: null, damId: null },
      { $set: { sireId: ids.get(plan.sireCode), damId: ids.get(plan.damCode) } },
    );
    if (res.modifiedCount) tally(report, 'parent_links', true);
  }
}

// ─── Entry points ────────────────────────────────────────────────────────────────────────────────────────────────────

export async function seedMockup(options: { password: string; now?: Date }): Promise<SeedReport> {
  const now = options.now ?? new Date();
  const report: SeedReport = {
    created: {},
    existing: {},
    animalTypesCreated: [],
    breedsAdded: [],
    warnings: [],
  };

  // The same idempotent bootstrap the API runs at startup, so an empty database has roles, types and categories.
  await syncRbac();
  await seedAnimalTypes();
  await seedProductCategories();
  const types = await ensureAnimalTypes(report);
  const passwordHash = await hashPassword(options.password);
  const listingDays = await getNumberSetting('marketplace.listingDays', 1, 365);
  const shopRoles = await roleIds(['seller', 'buyer']);
  const farmRoles = await roleIds(['farm_owner', 'seller', 'buyer']);

  for (const [i, shop] of SHOPS.entries()) {
    const ownerId = await ensureOwner(report, shop.code, shop.owner, shopRoles, passwordHash, now);
    const farm = await ensureFarm(
      report,
      shop,
      `ประเภทร้าน: ${shop.shopType}\n${shop.description}`,
      ownerId,
      mockupEmail(shop.code),
      [],
      now,
    );
    await seedShopProducts(report, shop, i, farm.id, farm.createdAt, ownerId, now);
  }

  for (const spec of FARMS) {
    const ownerId = await ensureOwner(report, spec.code, spec.owner, farmRoles, passwordHash, now);
    const typeIds = [...new Set(spec.groups.map((g) => g.type))].map((k) => types.get(k)!.id);
    const farm = await ensureFarm(
      report,
      spec,
      spec.description,
      ownerId,
      mockupEmail(spec.code),
      typeIds,
      now,
    );
    await seedFarmAnimals(report, spec, farm.id, farm.createdAt, ownerId, types, listingDays, now);
  }
  return report;
}

// ─── Mockup data in a real user's farm ───────────────────────────────────────────────────────────────────────────────
//
// Fills an EXISTING farm owned by a real (non-mockup) user with one shop's products and one farm's animals, so that user
// can try the product and livestock screens with their own account. The user, the farm and their roles are never
// changed. Marker inside that farm: SKU `MOCK-U<shop code>-nnn` and animal notes equal to MOCKUP_NOTE.

export const USER_MOCKUP_SKU = /^MOCK-U/;

/** The farm the user owns (the only one, or `farmId`). Throws a readable error when it is ambiguous or missing. */
async function ownedFarm(email: string, farmId?: string) {
  const user = await User.findOne({ email: email.toLowerCase() });
  if (!user) throw new Error(`No user with e-mail ${email}`);
  const owned = await FarmMember.find({ userId: user._id, role: 'owner' }).select('farmId');
  const ownedIds = owned.map((m) => String(m.farmId));
  const farms = await Farm.find({
    _id: { $in: farmId ? ownedIds.filter((id) => id === farmId) : ownedIds },
    archivedAt: null,
  });
  if (farms.length !== 1)
    throw new Error(
      farms.length === 0
        ? `${email} owns no active farm${farmId ? ` with id ${farmId}` : ''}`
        : `${email} owns ${farms.length} farms: pass --farm-id (${farms.map((f) => `${String(f._id)} ${f.name}`).join(', ')})`,
    );
  return { user, farm: farms[0]! };
}

export async function seedMockupForUser(options: {
  email: string;
  farmId?: string;
  shopCode?: string;
  farmCode?: string;
  now?: Date;
}): Promise<SeedReport & { farmName: string }> {
  const now = options.now ?? new Date();
  const report: SeedReport = {
    created: {},
    existing: {},
    animalTypesCreated: [],
    breedsAdded: [],
    warnings: [],
  };
  const shopSpec = SHOPS.find((s) => s.code === (options.shopCode ?? 'S03'));
  const farmSpec = FARMS.find((f) => f.code === (options.farmCode ?? 'F03'));
  if (!shopSpec || !farmSpec) throw new Error('Unknown --shop or --farm code');
  const { user, farm } = await ownedFarm(options.email, options.farmId);

  await seedAnimalTypes();
  await seedProductCategories();
  const types = await ensureAnimalTypes(report);
  const listingDays = await getNumberSetting('marketplace.listingDays', 1, 365);
  // The catalogue specs, renamed and relocated to the user's farm (listings show its name and province).
  const place = { ...farmSpec.place, ...farm.location } as ShopSpec['place'];
  const shop: ShopSpec = {
    ...shopSpec,
    code: `U${shopSpec.code}`,
    name: farm.name,
    brand: farm.name,
    place,
  };
  const spec: FarmSpec = { ...farmSpec, name: farm.name, place };

  await seedShopProducts(report, shop, 0, farm._id, farm.createdAt, user._id, now);
  await seedFarmAnimals(report, spec, farm._id, farm.createdAt, user._id, types, listingDays, now);
  return { ...report, farmName: farm.name };
}

/** Deletes ONLY the mockup products and animals seedMockupForUser put in the user's farm; refuses if activity uses them. */
export async function cleanMockupForUser(
  email: string,
  farmId?: string,
): Promise<{ deleted: Record<string, number> }> {
  const { farm } = await ownedFarm(email, farmId);
  const productIds = (
    await Product.find({ farmId: farm._id, sku: USER_MOCKUP_SKU }).select('_id')
  ).map((p) => p._id);
  const animalIds = (await Animal.find({ farmId: farm._id, notes: MOCKUP_NOTE }).select('_id')).map(
    (a) => a._id,
  );
  const listingIds = (await Listing.find({ animalId: { $in: animalIds } }).select('_id')).map(
    (l) => l._id,
  );

  const blockers = {
    orders: await Order.countDocuments({
      $or: [{ 'items.animalId': { $in: animalIds } }, { listingId: { $in: listingIds } }],
    }),
    negotiations: await Negotiation.countDocuments({ listingId: { $in: listingIds } }),
    product_reviews: await ProductReview.countDocuments({ productId: { $in: productIds } }),
    breeding_records: await BreedingRecord.countDocuments({
      $or: [
        { damId: { $in: animalIds } },
        { sireId: { $in: animalIds } },
        { 'delivery.offspring.animalId': { $in: animalIds } },
      ],
    }),
    real_animals_with_mockup_parents: await Animal.countDocuments({
      _id: { $nin: animalIds },
      $or: [{ sireId: { $in: animalIds } }, { damId: { $in: animalIds } }],
    }),
  };
  const found = Object.entries(blockers).filter(([, n]) => n > 0);
  if (found.length)
    throw new Error(
      `Mockup data is referenced by activity that must not be deleted silently: ${found.map(([k, n]) => `${k}=${n}`).join(', ')}. Nothing was deleted.`,
    );

  const byAnimal = { animalId: { $in: animalIds } };
  const steps: [string, () => Promise<{ deletedCount?: number; modifiedCount?: number }>][] = [
    ['listing_favorites', () => ListingFavorite.deleteMany({ listingId: { $in: listingIds } })],
    ['listing_events', () => ListingEvent.deleteMany({ listingId: { $in: listingIds } })],
    ['listings', () => Listing.deleteMany({ _id: { $in: listingIds } })],
    ['weight_records', () => WeightRecord.deleteMany(byAnimal)],
    ['health_records', () => HealthRecord.deleteMany(byAnimal)],
    ['feeding_records', () => FeedingRecord.deleteMany(byAnimal)],
    ['animals', () => Animal.deleteMany({ _id: { $in: animalIds } })],
    ['inventory_movements', () => InventoryMovement.deleteMany({ productId: { $in: productIds } })],
    [
      'cart_items',
      () =>
        Cart.updateMany(
          { 'items.productId': { $in: productIds } },
          { $pull: { items: { productId: { $in: productIds } } } },
        ),
    ],
    ['products', () => Product.deleteMany({ _id: { $in: productIds } })],
  ];
  const deleted: Record<string, number> = {};
  for (const [name, run] of steps) {
    const res = await run();
    deleted[name] = res.deletedCount ?? res.modifiedCount ?? 0;
  }
  return { deleted };
}

async function mockupScope(): Promise<{
  userIds: Types.ObjectId[];
  shopFarmIds: Types.ObjectId[];
  livestockFarmIds: Types.ObjectId[];
}> {
  const users = await User.find({ email: MOCKUP_EMAIL_PATTERN }).select('email');
  const shopOwners = users.filter((u) => u.email!.startsWith('s')).map((u) => u._id);
  const farmOwners = users.filter((u) => u.email!.startsWith('f')).map((u) => u._id);
  const [shops, farms] = await Promise.all([
    Farm.find({ createdBy: { $in: shopOwners } }).select('_id'),
    Farm.find({ createdBy: { $in: farmOwners } }).select('_id'),
  ]);
  return {
    userIds: users.map((u) => u._id),
    shopFarmIds: shops.map((f) => f._id),
    livestockFarmIds: farms.map((f) => f._id),
  };
}

export interface VerifyReport {
  counts: Record<string, number>;
  productsPerShop: { min: number; max: number };
  animalsPerFarm: { min: number; max: number };
  problems: string[];
}

/** Read-only checks of the mockup data: counts, links between collections, duplicates and biology. */
export async function verifyMockup(now = new Date()): Promise<VerifyReport> {
  const problems: string[] = [];
  const { userIds, shopFarmIds, livestockFarmIds } = await mockupScope();
  const allFarmIds = [...shopFarmIds, ...livestockFarmIds];
  const farms = await Farm.find({ _id: { $in: allFarmIds } });
  const farmById = new Map(farms.map((f) => [String(f._id), f]));

  const products = await Product.find({ farmId: { $in: shopFarmIds } });
  const perShop = shopFarmIds.map(
    (id) => products.filter((p) => String(p.farmId) === String(id)).length,
  );
  for (const p of products) {
    const farm = farmById.get(String(p.farmId))!;
    if (p.farmName !== farm.name || String(p.sellerId) !== String(farm.createdBy))
      problems.push(`Product ${p.sku} does not match its shop ${farm.name}`);
  }
  const groupsPerShop = shopFarmIds.map(
    (id) =>
      new Set(
        products
          .filter((p) => String(p.farmId) === String(id))
          .map((p) => p.specs[0]?.value?.replace(' (ควบคุม)', '')),
      ).size,
  );
  if (groupsPerShop.some((n) => n < 4)) problems.push('A shop does not cover all 4 product groups');

  const animals = await Animal.find({ farmId: { $in: livestockFarmIds } });
  const perFarm = livestockFarmIds.map(
    (id) => animals.filter((a) => String(a.farmId) === String(id)).length,
  );
  const types = new Map((await AnimalType.find()).map((t) => [String(t._id), t]));
  const byId = new Map(animals.map((a) => [String(a._id), a]));
  for (const a of animals) {
    const type = types.get(String(a.animalTypeId));
    if (!type?.breeds.some((b) => b.key === a.breed))
      problems.push(
        `${a.animalCode}: breed "${a.breed}" is not a breed of ${type?.key ?? 'unknown type'}`,
      );
    if (!a.birthDate || a.birthDate > now)
      problems.push(`${a.animalCode}: birth date missing or in the future`);
    for (const [label, pid, sex] of [
      ['sire', a.sireId, 'male'],
      ['dam', a.damId, 'female'],
    ] as const) {
      if (!pid) continue;
      const parent = byId.get(String(pid));
      if (!parent || String(parent.farmId) !== String(a.farmId))
        problems.push(`${a.animalCode}: ${label} not on the same farm`);
      else if (String(parent.animalTypeId) !== String(a.animalTypeId) || parent.sex !== sex)
        problems.push(`${a.animalCode}: ${label} has the wrong type or sex`);
      else if (parent.birthDate && a.birthDate && parent.birthDate >= a.birthDate)
        problems.push(`${a.animalCode}: ${label} is not older than its offspring`);
    }
  }
  const animalIds = animals.map((a) => a._id);
  const [weights, health, listings, dupAnimals, dupSkus] = await Promise.all([
    WeightRecord.find({ animalId: { $in: animalIds } }).select('animalId weighedOn'),
    HealthRecord.countDocuments({ animalId: { $in: animalIds } }),
    Listing.find({ farmId: { $in: livestockFarmIds } }).select('animalId status'),
    Animal.aggregate([
      { $match: { farmId: { $in: livestockFarmIds } } },
      { $group: { _id: { f: '$farmId', c: '$animalCode' }, n: { $sum: 1 } } },
      { $match: { n: { $gt: 1 } } },
    ]),
    Product.aggregate([
      { $match: { farmId: { $in: shopFarmIds } } },
      { $group: { _id: { f: '$farmId', s: '$sku' }, n: { $sum: 1 } } },
      { $match: { n: { $gt: 1 } } },
    ]),
  ]);
  for (const w of weights) {
    const a = byId.get(String(w.animalId))!;
    if (a.birthDate && w.weighedOn < a.birthDate)
      problems.push(`${a.animalCode}: weighed before birth`);
  }
  for (const l of listings) {
    const a = byId.get(String(l.animalId));
    if (!a || (l.status === 'ACTIVE' && a.currentStatus !== 'for_sale'))
      problems.push(`Listing ${String(l._id)} does not match its animal's status`);
  }
  if (dupAnimals.length) problems.push(`${dupAnimals.length} duplicated animal code(s)`);
  if (dupSkus.length) problems.push(`${dupSkus.length} duplicated SKU(s)`);
  if (farms.length !== new Set(farms.map((f) => `${String(f.createdBy)}|${f.name}`)).size)
    problems.push('Duplicated farm for the same owner');

  const count = (status: string) => products.filter((p) => p.status === status).length;
  return {
    counts: {
      users: userIds.length,
      shops: shopFarmIds.length,
      products: products.length,
      productsActive: count('ACTIVE'),
      productsOutOfStock: products.filter((p) => p.status === 'ACTIVE' && p.stock === 0).length,
      productsPaused: count('PAUSED'),
      productsPendingReview: count('PENDING_REVIEW'),
      productsDraftRegulated: count('DRAFT'),
      farms: livestockFarmIds.length,
      animals: animals.length,
      animalsForSale: animals.filter((a) => a.currentStatus === 'for_sale').length,
      animalsSold: animals.filter((a) => a.currentStatus === 'sold').length,
      animalsWithParents: animals.filter((a) => a.sireId && a.damId).length,
      weightRecords: weights.length,
      healthRecords: health,
      listingsActive: listings.filter((l) => l.status === 'ACTIVE').length,
    },
    productsPerShop: { min: Math.min(...perShop), max: Math.max(...perShop) },
    animalsPerFarm: { min: Math.min(...perFarm), max: Math.max(...perFarm) },
    problems,
  };
}

/**
 * Deletes ONLY mockup data: documents of mockup farms and mockup users. Refuses (and changes nothing) if real
 * activity touches them (orders, offers, chats, posts, reviews), because deleting those would remove other people's
 * records. Animal types and breeds the seed added stay: they are part of the shared catalogue.
 */
export async function cleanMockup(): Promise<{ deleted: Record<string, number> }> {
  const { userIds, shopFarmIds, livestockFarmIds } = await mockupScope();
  const farmIds = [...shopFarmIds, ...livestockFarmIds];
  const productIds = (await Product.find({ farmId: { $in: farmIds } }).select('_id')).map(
    (p) => p._id,
  );

  const blockers = {
    orders: await Order.countDocuments({
      $or: [
        { farmId: { $in: farmIds } },
        { buyerId: { $in: userIds } },
        { sellerId: { $in: userIds } },
      ],
    }),
    negotiations: await Negotiation.countDocuments({
      $or: [{ farmId: { $in: farmIds } }, { buyerId: { $in: userIds } }],
    }),
    conversations: await Conversation.countDocuments({
      $or: [{ farmId: { $in: farmIds } }, { buyerId: { $in: userIds } }],
    }),
    posts: await Post.countDocuments({ authorId: { $in: userIds } }),
    comments: await Comment.countDocuments({ authorId: { $in: userIds } }),
    product_reviews: await ProductReview.countDocuments({
      $or: [{ productId: { $in: productIds } }, { buyerId: { $in: userIds } }],
    }),
  };
  const found = Object.entries(blockers).filter(([, n]) => n > 0);
  if (found.length)
    throw new Error(
      `Mockup data is referenced by activity that must not be deleted silently: ${found.map(([k, n]) => `${k}=${n}`).join(', ')}. Nothing was deleted.`,
    );

  const listingIds = (await Listing.find({ farmId: { $in: farmIds } }).select('_id')).map(
    (l) => l._id,
  );
  const byFarm = { farmId: { $in: farmIds } };
  const byUser = { userId: { $in: userIds } };
  const steps: [string, () => Promise<{ deletedCount: number }>][] = [
    [
      'listing_favorites',
      () => ListingFavorite.deleteMany({ $or: [{ listingId: { $in: listingIds } }, byUser] }),
    ],
    ['listing_events', () => ListingEvent.deleteMany(byFarm)],
    ['listings', () => Listing.deleteMany(byFarm)],
    ['weight_records', () => WeightRecord.deleteMany(byFarm)],
    ['health_records', () => HealthRecord.deleteMany(byFarm)],
    ['feeding_records', () => FeedingRecord.deleteMany(byFarm)],
    ['breeding_records', () => BreedingRecord.deleteMany(byFarm)],
    ['farm_expenses', () => FarmExpense.deleteMany(byFarm)],
    ['animals', () => Animal.deleteMany(byFarm)],
    ['inventory_movements', () => InventoryMovement.deleteMany(byFarm)],
    ['products', () => Product.deleteMany(byFarm)],
    ['farm_members', () => FarmMember.deleteMany({ $or: [byFarm, byUser] })],
    ['farms', () => Farm.deleteMany({ _id: { $in: farmIds } })],
    ['carts', () => Cart.deleteMany(byUser)],
    ['reactions', () => Reaction.deleteMany(byUser)],
    [
      'follows',
      () =>
        Follow.deleteMany({
          $or: [{ followerId: { $in: userIds } }, { followeeId: { $in: userIds } }],
        }),
    ],
    ['notifications', () => Notification.deleteMany(byUser)],
    ['notification_preferences', () => NotificationPreference.deleteMany(byUser)],
    ['sessions', () => Session.deleteMany(byUser)],
    ['refresh_tokens', () => RefreshToken.deleteMany(byUser)],
    ['verification_tokens', () => VerificationToken.deleteMany(byUser)],
    ['oauth_identities', () => OAuthIdentity.deleteMany(byUser)],
    ['user_roles', () => UserRole.deleteMany(byUser)],
    ['users', () => User.deleteMany({ _id: { $in: userIds }, email: MOCKUP_EMAIL_PATTERN })],
  ];
  const deleted: Record<string, number> = {};
  for (const [name, run] of steps) deleted[name] = (await run()).deletedCount;
  return { deleted };
}
