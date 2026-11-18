/**
 * Farm management domain types, shared by API, Web and Mobile.
 * Farm-level roles and their permissions are DATA here (not logic in the API only) so clients can hide
 * actions the user cannot perform — the API still enforces every one of them.
 */
export const FARM_ROLES = ['owner', 'manager', 'worker', 'viewer'] as const;
export type FarmRole = (typeof FARM_ROLES)[number];
/** Roles that can be handed out through the members API (there is exactly one `owner`: the creator). */
export const ASSIGNABLE_FARM_ROLES = ['manager', 'worker', 'viewer'] as const;

export const FARM_PERMISSIONS = [
  'farm.read',
  'farm.update',
  'farm.archive',
  'members.read',
  'members.manage',
  'animals.read',
  'animals.write',
  'animals.archive',
  /** Breeding, health, feeding and weight records. */
  'records.read',
  'records.write',
  /** Correct or void an existing record (always with a reason, always kept in the record's history). */
  'records.correct',
  /** Money: farm expenses. Deliberately narrower than records.*. */
  'expenses.read',
  'expenses.write',
  /** Create and manage marketplace listings and negotiate for the farm (a seller-side permission). */
  'listings.manage',
] as const;
export type FarmPermission = (typeof FARM_PERMISSIONS)[number];

export const FARM_ROLE_PERMISSIONS: Record<FarmRole, readonly FarmPermission[]> = {
  owner: FARM_PERMISSIONS,
  manager: [
    'farm.read',
    'farm.update',
    'members.read',
    'members.manage',
    'animals.read',
    'animals.write',
    'animals.archive',
    'records.read',
    'records.write',
    'records.correct',
    'expenses.read',
    'expenses.write',
    'listings.manage',
  ],
  worker: [
    'farm.read',
    'members.read',
    'animals.read',
    'animals.write',
    'records.read',
    'records.write',
  ],
  viewer: ['farm.read', 'members.read', 'animals.read', 'records.read'],
};

/** Platform staff (Part 03/04 global permissions) may also reach farms they are not members of. */
export const PLATFORM_FARM_PERMISSIONS = {
  'farms.read': ['farm.read', 'members.read', 'animals.read', 'records.read'],
  // Platform staff never sell on a farm's behalf: marketplace moderation has its own permission.
  'farms.manage': FARM_PERMISSIONS.filter((p) => p !== 'farm.archive' && p !== 'listings.manage'),
} as const satisfies Record<string, readonly FarmPermission[]>;

export const FARM_STATUSES = ['active', 'archived'] as const;
export type FarmStatus = (typeof FARM_STATUSES)[number];

export interface FarmLocation {
  province?: string;
  district?: string;
  subdistrict?: string;
  postalCode?: string;
  address?: string;
  latitude?: number;
  longitude?: number;
}

export interface FarmContact {
  phone?: string;
  email?: string;
  lineId?: string;
}

export interface FarmSummary {
  id: string;
  name: string;
  description?: string;
  status: FarmStatus;
  location: FarmLocation;
  contact: FarmContact;
  /** The kinds of animals the farm raises (ids from `animal_types`), as declared by the farm. */
  animalTypeIds: string[];
  /** The caller's membership role, if they are a member. */
  myRole: FarmRole | null;
  createdAt: string;
}

export interface FarmDetail extends FarmSummary {
  access: { via: 'member' | 'platform'; permissions: FarmPermission[] };
  stats: { animalsTotal: number; animalsActive: number; byStatus: Record<string, number> };
}

/**
 * Onboarding state of the signed-in user (`GET /farms/me`). Derived, never stored:
 * `farm_setup_completed` = member of at least one farm; `farm_setup_required` = no farm yet but allowed to create one;
 * `not_applicable` = no farm and not allowed to create one (e.g. a buyer without an approved farm-owner registration).
 */
export const FARM_SETUP_STATUSES = [
  'farm_setup_completed',
  'farm_setup_required',
  'not_applicable',
] as const;
export type FarmSetupStatus = (typeof FARM_SETUP_STATUSES)[number];

export interface FarmSetupDTO {
  status: FarmSetupStatus;
  canCreateFarm: boolean;
  /** Farms the caller belongs to (first page, sorted by name). */
  farms: FarmSummary[];
}

/** One card on the "My farm" home: live counts for one animal type (archived animals excluded). */
export interface FarmAnimalTypeCount {
  animalTypeId: string;
  key: string;
  name: string;
  nameTh?: string;
  total: number;
  /** `active` + `for_sale`: animals currently on the farm. */
  onFarm: number;
  forSale: number;
  sold: number;
  /** On-farm animals with no (non-voided) weighing in the last `growthCheckDays` days; `null` without `records.read`. */
  needsGrowthCheck: number | null;
  /** On-farm animals whose latest measurement is outside its growth criterion; `null` without `records.read`. */
  outsideStandard: number | null;
}

export interface FarmAnimalSummaryDTO {
  totals: Omit<FarmAnimalTypeCount, 'animalTypeId' | 'key' | 'name' | 'nameTh'>;
  byType: FarmAnimalTypeCount[];
  growthCheckDays: number;
  /** Selling figures; only present for callers with `listings.manage`. */
  trade?: { listingsByStatus: Record<string, number>; listingsTotal: number; animalOrders: number };
}

export interface FarmMemberSummary {
  id: string;
  userId: string;
  displayName: string;
  email?: string;
  role: FarmRole;
  joinedAt: string;
}

// ---------------------------------------------------------------------------
// Animal types (configurable species) & animals
// ---------------------------------------------------------------------------
export const ANIMAL_TYPE_STATUSES = ['active', 'inactive'] as const;
export type AnimalTypeStatus = (typeof ANIMAL_TYPE_STATUSES)[number];

export interface BreedSummary {
  key: string;
  name: string;
  nameTh?: string;
  active: boolean;
}

/**
 * Optional, administrator-supplied limits for a species. FARM+ ships NO values: nothing biological is assumed
 * about any species. Where a value is configured, records are validated against it; where it is not, they are not.
 */
export interface AnimalTypeConfig {
  /** Days from breeding to expected delivery (enables the expected delivery date). */
  gestationDays?: number;
  /** Animals younger than this (days) cannot be recorded as breeding. */
  minBreedingAgeDays?: number;
  /** Heaviest plausible weight; larger weights are rejected as entry mistakes. */
  maxWeightKg?: number;
}

export interface AnimalTypeSummary extends AnimalTypeConfig {
  id: string;
  key: string;
  name: string;
  nameTh?: string;
  status: AnimalTypeStatus;
  breeds: BreedSummary[];
}

export const ANIMAL_SEXES = ['male', 'female', 'unknown'] as const;
export type AnimalSex = (typeof ANIMAL_SEXES)[number];

/** Current state of an animal on the farm. Archiving (soft delete) is separate from this. */
export const ANIMAL_STATUSES = [
  'active',
  'for_sale',
  'sold',
  'deceased',
  'transferred',
  'lost',
] as const;
export type AnimalStatus = (typeof ANIMAL_STATUSES)[number];

export const ANIMAL_ORIGINS = [
  'born_on_farm',
  'purchased',
  'transferred_in',
  'gift',
  'other',
] as const;
export type AnimalOriginKind = (typeof ANIMAL_ORIGINS)[number];

export const MEDIA_KINDS = ['photo', 'document'] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];

export interface AnimalMedia {
  id: string;
  kind: MediaKind;
  url: string;
  mimeType?: string;
  caption?: string;
  uploadedAt: string;
}

export interface AnimalRef {
  id: string;
  animalCode: string;
  name?: string;
}

export interface AnimalSummary {
  id: string;
  farmId: string;
  animalCode: string;
  /** `nameTh` is the Thai name, when the administrator gave one. */
  animalType: { id: string; key: string; name: string; nameTh?: string };
  /** Breed key (stable identifier). */
  breed?: string;
  /** Display name of the breed, resolved from the animal type's catalogue. */
  breedName?: string;
  breedNameTh?: string;
  name?: string;
  sex: AnimalSex;
  birthDate?: string;
  currentStatus: AnimalStatus;
  archived: boolean;
  primaryPhotoUrl?: string;
  createdAt: string;
}

export interface AnimalDetail extends AnimalSummary {
  birthDateEstimated: boolean;
  acquisitionDate?: string;
  origin: { kind: AnimalOriginKind; note?: string };
  sire?: AnimalRef;
  dam?: AnimalRef;
  offspringCount: number;
  media: AnimalMedia[];
  /** Colour / markings as described by the farm (free text). */
  color?: string;
  notes?: string;
  archivedAt?: string;
  archiveReason?: string;
  updatedAt: string;
}
