import type { AnimalSex, AnimalStatus } from './farms';

/**
 * Husbandry records: breeding, health, feeding, weights and expenses.
 *
 * Principles (enforced by the API, reflected here):
 *  - Records are never deleted or silently overwritten. A change is a *correction* with a reason; a mistaken
 *    record is *voided* with a reason. Every step is kept in `history` and says who did it.
 *  - FARM+ records what people tell it. It never diagnoses, never suggests treatments or dosages.
 */
export const RECORD_KINDS = ['breeding', 'health', 'feeding', 'weight', 'expense'] as const;
export type RecordKind = (typeof RECORD_KINDS)[number];

export interface ActorRef {
  id: string;
  displayName: string;
}

export interface AnimalLite {
  id: string;
  animalCode: string;
  name?: string;
}

export interface RecordAttachment {
  id: string;
  kind: 'photo' | 'document';
  url: string;
  mimeType?: string;
  caption?: string;
  addedBy: ActorRef;
  addedAt: string;
}

export interface RecordHistoryEntry {
  at: string;
  by: ActorRef;
  kind: 'correction' | 'attachment_added' | 'attachment_removed' | 'void' | 'event';
  reason?: string;
  /** Previous and new values for every field that changed. */
  changes: { field: string; from: unknown; to: unknown }[];
}

export interface RecordMeta {
  id: string;
  farmId: string;
  /** 1 when created; +1 for every correction. */
  revision: number;
  createdBy: ActorRef;
  createdAt: string;
  updatedBy?: ActorRef;
  updatedAt: string;
  voided?: { at: string; by: ActorRef; reason: string };
  attachments: RecordAttachment[];
}

export type WithHistory<T> = T & { history: RecordHistoryEntry[] };

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------
export const HEALTH_TYPES = [
  'illness',
  'treatment',
  'vaccination',
  'recovery',
  'checkup',
  'other',
] as const;
export type HealthType = (typeof HEALTH_TYPES)[number];
export const HEALTH_SEVERITIES = ['mild', 'moderate', 'severe'] as const;
export const HEALTH_OUTCOMES = ['recovered', 'improving', 'unchanged', 'worsened', 'died'] as const;
export const STATED_BY = ['farmer', 'veterinarian'] as const;
export const PRESCRIBED_BY = ['veterinarian', 'farmer', 'product_label'] as const;

export interface HealthRecordDTO extends RecordMeta {
  animal: AnimalLite;
  type: HealthType;
  recordedOn: string;
  title: string;
  symptoms?: string;
  /** A condition name exactly as stated by the person named in `conditionStatedBy`. Never inferred by FARM+. */
  condition?: string;
  conditionStatedBy?: (typeof STATED_BY)[number];
  severity?: (typeof HEALTH_SEVERITIES)[number];
  medication?: { name: string; dosage?: string; route?: string; batchNumber?: string };
  prescribedBy?: (typeof PRESCRIBED_BY)[number];
  veterinarian?: { name: string; licenseNo?: string; clinic?: string };
  /** As stated on the label / by the vet. Not calculated. */
  withdrawalEndsOn?: string;
  vaccine?: { name: string; batchNumber?: string; manufacturer?: string };
  nextDueOn?: string;
  relatedRecordId?: string;
  outcome?: (typeof HEALTH_OUTCOMES)[number];
  notes?: string;
}

// ---------------------------------------------------------------------------
// Weights & growth
// ---------------------------------------------------------------------------
export const WEIGH_METHODS = ['scale', 'tape_estimate', 'visual_estimate'] as const;

export interface WeightRecordDTO extends RecordMeta {
  animal: AnimalLite;
  weighedOn: string;
  weightKg: number;
  method: (typeof WEIGH_METHODS)[number];
  /** Height at withers (cm) and body length (cm): whichever suits the species; both optional. */
  heightCm?: number;
  lengthCm?: number;
  /** Free-text body condition as observed (FARM+ does not score or interpret it). */
  bodyCondition?: string;
  notes?: string;
}

// ---------------------------------------------------------------------------
// Growth standards (admin-managed criteria, per type / breed / sex)
// ---------------------------------------------------------------------------
/**
 * `weight_for_age`: expected weight/height/length bounds for an age range.
 * `breeding_age` / `sale_age`: the age window considered suitable for breeding / selling.
 */
export const GROWTH_STANDARD_KINDS = ['weight_for_age', 'breeding_age', 'sale_age'] as const;
export type GrowthStandardKind = (typeof GROWTH_STANDARD_KINDS)[number];
export const GROWTH_STANDARD_SEXES = ['male', 'female', 'any'] as const;
export type GrowthStandardSex = (typeof GROWTH_STANDARD_SEXES)[number];
/** Every criterion says where it comes from: a cited reference, or "recommended by the system" (not an academic standard). */
export const GROWTH_SOURCE_KINDS = ['reference', 'system_recommendation'] as const;
export type GrowthSourceKind = (typeof GROWTH_SOURCE_KINDS)[number];

export interface GrowthStandardSource {
  kind: GrowthSourceKind;
  /** Required for `reference`: the publication, organisation or URL the numbers come from. */
  citation?: string;
  note?: string;
}

export interface GrowthStandardDTO {
  id: string;
  animalType: { id: string; key: string; name: string; nameTh?: string };
  /** Breed key; absent = every breed of the type. */
  breed?: string;
  sex: GrowthStandardSex;
  kind: GrowthStandardKind;
  /** Age range in days: from (inclusive) … to (exclusive). */
  ageFromDays: number;
  ageToDays: number;
  minWeightKg?: number;
  maxWeightKg?: number;
  minHeightCm?: number;
  maxHeightCm?: number;
  minLengthCm?: number;
  maxLengthCm?: number;
  source: GrowthStandardSource;
  active: boolean;
  updatedAt: string;
}

export const GROWTH_STATUSES = ['below', 'within', 'above', 'no_standard', 'no_age'] as const;
export type GrowthStatus = (typeof GROWTH_STATUSES)[number];
export type GrowthMetric = 'weight' | 'height' | 'length';

export interface MetricEvaluation {
  status: 'below' | 'within' | 'above';
  value: number;
  min?: number;
  max?: number;
}

/** A measurement compared with the matching criterion (computed by the API, never stored). */
export interface GrowthEvaluation {
  status: GrowthStatus;
  standardId?: string;
  source?: GrowthStandardSource;
  /** True when the age comes from an estimated birth date: the comparison is approximate. */
  ageEstimated: boolean;
  metrics: Partial<Record<GrowthMetric, MetricEvaluation>>;
}

export interface GrowthPoint {
  id: string;
  date: string;
  weightKg: number;
  heightCm?: number;
  lengthCm?: number;
  bodyCondition?: string;
  /** Age on the day of the measurement (absent without a birth date). */
  ageDays?: number;
  evaluation: GrowthEvaluation;
  /** Differences to the previous weighing — plain arithmetic, no interpretation. */
  daysSincePrevious?: number;
  changeKg?: number;
  gainKgPerDay?: number;
}

export interface AgeWindowStatus {
  standard: Pick<GrowthStandardDTO, 'id' | 'ageFromDays' | 'ageToDays' | 'source'>;
  /** Where the animal is today relative to the window (`no_age` without a birth date). */
  status: 'before' | 'within' | 'after' | 'no_age';
  ageEstimated: boolean;
}

export interface GrowthAlert {
  code: 'LATEST_BELOW_STANDARD' | 'LATEST_ABOVE_STANDARD';
  metric: GrowthMetric;
  date: string;
  value: number;
  min?: number;
  max?: number;
  ageEstimated: boolean;
}

export interface GrowthResponse {
  animal: AnimalLite;
  /** Age today (absent without a birth date); `estimated` mirrors the animal's `birthDateEstimated`. */
  age: { birthDate?: string; estimated: boolean; days?: number };
  points: GrowthPoint[];
  summary: {
    count: number;
    firstDate?: string;
    latestDate?: string;
    firstKg?: number;
    latestKg?: number;
    totalChangeKg?: number;
    averageGainKgPerDay?: number;
  };
  /** Configured plausible maximum for the species (null: not configured). */
  maxWeightKg: number | null;
  /** The weight-for-age criteria that apply to this animal (for the chart's reference bands). */
  standards: GrowthStandardDTO[];
  windows: { breeding?: AgeWindowStatus; sale?: AgeWindowStatus };
  /** The latest measurement is outside its criterion. */
  alerts: GrowthAlert[];
}

// ---------------------------------------------------------------------------
// Feeding
// ---------------------------------------------------------------------------
export const FEEDING_KINDS = ['log', 'schedule'] as const;
export const FEED_CATEGORIES = [
  'roughage',
  'concentrate',
  'supplement',
  'mineral',
  'water',
  'other',
] as const;
export const QUANTITY_UNITS = ['kg', 'g', 'l', 'ml', 'piece'] as const;

export interface FeedingRecordDTO extends RecordMeta {
  /** Missing = the whole farm / a group (see groupLabel). */
  animal?: AnimalLite;
  groupLabel?: string;
  kind: (typeof FEEDING_KINDS)[number];
  /** Log: the day fed. Schedule: the day it starts. */
  date: string;
  endDate?: string;
  /** Schedule only: running today. */
  active?: boolean;
  feedName: string;
  category: (typeof FEED_CATEGORIES)[number];
  quantity: { amount: number; unit: (typeof QUANTITY_UNITS)[number] };
  frequencyPerDay?: number;
  timesOfDay?: string[];
  notes?: string;
}

// ---------------------------------------------------------------------------
// Expenses
// ---------------------------------------------------------------------------
export const EXPENSE_CATEGORIES = [
  'feed',
  'medication',
  'veterinary',
  'vaccination',
  'equipment',
  'labor',
  'other',
] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export interface ExpenseDTO extends RecordMeta {
  category: ExpenseCategory;
  expenseDate: string;
  /** Baht, two decimals at most. Stored as integer satang on the server. */
  amount: number;
  currency: 'THB';
  description: string;
  supplier?: string;
  animal?: AnimalLite;
  related?: { kind: 'health' | 'feeding'; id: string };
  quantity?: { amount: number; unit: (typeof QUANTITY_UNITS)[number] };
  notes?: string;
}

export interface ExpenseSummary {
  from?: string;
  to?: string;
  total: number;
  count: number;
  byCategory: { category: ExpenseCategory; total: number; count: number }[];
  byMonth: { month: string; total: number }[];
}

// ---------------------------------------------------------------------------
// Breeding
// ---------------------------------------------------------------------------
export const BREEDING_METHODS = [
  'natural',
  'artificial_insemination',
  'embryo_transfer',
  'unknown',
] as const;
export const BREEDING_STATUSES = ['bred', 'pregnant', 'delivered', 'failed'] as const;
export type BreedingStatus = (typeof BREEDING_STATUSES)[number];
export const OFFSPRING_OUTCOMES = ['alive', 'stillborn', 'died_at_birth'] as const;

export interface BreedingRecordDTO extends RecordMeta {
  dam: AnimalLite;
  sire?: AnimalLite;
  /** A sire that is not an animal on this farm (e.g. a bull used for artificial insemination). */
  sireExternal?: { name?: string; code?: string; note?: string };
  method: (typeof BREEDING_METHODS)[number];
  breedingDate: string;
  status: BreedingStatus;
  /** Present only when the species' gestationDays is configured. */
  expectedDeliveryDate?: string;
  pregnancyConfirmedOn?: string;
  failedOn?: string;
  failureReason?: string;
  delivery?: {
    date: string;
    offspring: {
      animal?: AnimalLite;
      outcome: (typeof OFFSPRING_OUTCOMES)[number];
      sex?: AnimalSex;
      note?: string;
    }[];
  };
  notes?: string;
  /** Informational notes about the pairing (e.g. shared parent). Not blocking. */
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Complete history of one animal
// ---------------------------------------------------------------------------
export const HISTORY_EVENT_TYPES = ['animal', ...RECORD_KINDS] as const;
export type HistoryEventType = (typeof HISTORY_EVENT_TYPES)[number];

export interface HistoryEvent {
  /** Stable key: `${type}:${recordId or audit id}` */
  key: string;
  type: HistoryEventType;
  date: string;
  title: string;
  summary?: string;
  by?: ActorRef;
  voided?: boolean;
  recordId?: string;
  /** For breeding events: the animal's part in it. */
  role?: 'dam' | 'sire' | 'offspring';
}

export interface PedigreeAnimal extends AnimalLite {
  sex: AnimalSex;
  birthDate?: string;
  breed?: string;
  currentStatus: AnimalStatus;
  archived: boolean;
}

/** One animal and its recorded parents, recursively (only animals of the same farm; nothing is guessed). */
export interface PedigreeNode {
  animal: PedigreeAnimal;
  sire?: PedigreeNode;
  dam?: PedigreeNode;
}

export interface LineageResponse {
  animal: AnimalLite;
  sire?: AnimalLite;
  dam?: AnimalLite;
  offspring: (AnimalLite & { sex: AnimalSex; birthDate?: string; role: 'sire' | 'dam' })[];
  /** Family tree up to `generations` levels above the animal. */
  pedigree: PedigreeNode;
  generations: number;
  /** How many generations of ancestors are recorded (0 = no parent recorded); counted beyond `generations`. */
  generation: number;
  /** Animals sharing both parents (`full`) or one (`half_sire` / `half_dam`). */
  siblings: (PedigreeAnimal & { relation: 'full' | 'half_sire' | 'half_dam' })[];
}
