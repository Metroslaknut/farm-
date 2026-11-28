import type { SettingValue } from '@farmplus/shared-types';
import type { Actor } from '../../context';
import { HttpError } from '../../lib/errors';
import { Setting } from '../../models';
import { recordAudit } from '../../services/audit.service';

type Scalar = string | number | boolean;

interface SettingDefinition {
  type: 'boolean' | 'string' | 'number';
  default: Scalar;
  description: string;
}

/** Only keys listed here can be stored: the registry is the allow-list and the validator. */
export const SETTING_REGISTRY = {
  'registrations.requireIdentityForSeller': {
    type: 'boolean',
    default: true,
    description: 'Seller registrations can only be approved for users whose identity is verified.',
  },
  'farms.requireFarmOwnerRole': {
    type: 'boolean',
    default: true,
    description:
      'Only users with the farm_owner role (granted when a farm-owner registration is approved) can create farms.',
  },
  'farms.growthCheckDays': {
    type: 'number',
    default: 30,
    description:
      'An animal on the farm with no weighing in this many days is counted as "needs a growth check" on the My farm home (1–365 days). A reminder threshold, not a husbandry standard.',
  },
  'live.requireHostRole': {
    type: 'boolean',
    default: true,
    description:
      'Only users with the farm_owner or seller role can start live streams. Turn off to let every member go live.',
  },
  'marketplace.requireSellerRole': {
    type: 'boolean',
    default: true,
    description:
      'Only users with the seller role (granted when a seller registration is approved) can list animals.',
  },
  'marketplace.requireReview': {
    type: 'boolean',
    default: true,
    description:
      'New listings are reviewed by a moderator before they go live. Turn off to publish on submit.',
  },
  'chat.messagesPerMinute': {
    type: 'number',
    default: 20,
    description: 'Most chat messages one user may send per minute (1–120).',
  },
  'chat.newConversationsPerDay': {
    type: 'number',
    default: 20,
    description: 'Most new buyer–seller conversations one user may start per day (1–200).',
  },
  'marketplace.offerHours': {
    type: 'number',
    default: 48,
    description: 'How long an offer or counter-offer stays valid before it expires (1–720 hours).',
  },
  'marketplace.reservationHours': {
    type: 'number',
    default: 48,
    description:
      'How long an animal stays reserved after an offer is accepted before it is released (1–720 hours).',
  },
  'marketplace.listingDays': {
    type: 'number',
    default: 30,
    description: 'How long an approved listing stays active before it expires (1–365 days).',
  },
  'orders.paymentWindowHours': {
    type: 'number',
    default: 24,
    description:
      'How long a buyer has to pay before an unpaid order is cancelled and the animal released (1–168 hours).',
  },
  'orders.autoConfirmDays': {
    type: 'number',
    default: 3,
    description:
      'Days after the carrier reports delivery before the order completes by itself if the buyer has not confirmed (1–30).',
  },
  'orders.platformFeeBps': {
    type: 'number',
    default: 0,
    description:
      'Platform fee in basis points (100 = 1%), deducted from the seller’s payout — never added to the buyer’s total. 0 = no fee.',
  },
  'finance.payoutsEnabled': {
    type: 'boolean',
    default: false,
    description:
      'Allow sellers to request withdrawals. Off until the legal and payment-provider review of holding and paying out seller earnings is complete.',
  },
  'finance.minWithdrawalMinor': {
    type: 'number',
    default: 10_000,
    description: 'Smallest withdrawal a seller may request, in satang (10000 = ฿100).',
  },
  'finance.paymentAttemptMinutes': {
    type: 'number',
    default: 30,
    description:
      'How long a started payment stays open before it is treated as abandoned (5–1440 minutes).',
  },
  'products.prohibitedTerms': {
    type: 'string',
    default:
      'clenbuterol, salbutamol, ractopamine, chloramphenicol, nitrofuran, malachite green, diethylstilbestrol',
    description:
      'Comma-separated terms that may never appear in a product (title, text, brand, specifications). STARTER LIST ONLY — it has not been legally reviewed; the platform owner must replace it with the list that applies to them.',
  },
  'products.claimTerms': {
    type: 'string',
    default:
      'cure, cures, cured, curing, heal, heals, miracle, guaranteed results, 100% effective, treats disease, treatment for, prevents disease, disease prevention, replaces antibiotics, รักษา, หายขาด, ป้องกันโรค',
    description:
      'Comma-separated phrases that look like veterinary treatment or health claims. Products outside a registered regulated category may not use them. STARTER LIST ONLY — to be reviewed by the platform owner.',
  },
  'ai.narrativeEnabled': {
    type: 'boolean',
    default: true,
    description:
      'Allow the AI provider to add a short plain-language explanation to assessments. Assessments themselves never depend on it.',
  },
  'ai.dailyNarrativeLimit': {
    type: 'number',
    default: 300,
    description:
      'Most AI explanations the whole platform may request per day (a cost guard). Past it, assessments run without one.',
  },
  'ai.perUserDailyNarratives': {
    type: 'number',
    default: 20,
    description: 'Most AI explanations one user may request per day.',
  },
  'ai.minMarketSamples': {
    type: 'number',
    default: 5,
    description:
      'Fewest price observations needed before a price range is suggested. Below it no range is shown.',
  },
  'ai.marketWindowDays': {
    type: 'number',
    default: 180,
    description: 'How far back completed FARM+ sales count as market data (days).',
  },
  'ai.weightFreshDays': {
    type: 'number',
    default: 30,
    description:
      'A weight older than this is flagged as stale (unless the animal type criteria set their own value).',
  },
  'ai.inputCostPerMillionMicros': {
    type: 'number',
    default: 0,
    description:
      'Your price per million INPUT tokens, in millionths of a baht (for cost monitoring only; 0 = not configured).',
  },
  'ai.outputCostPerMillionMicros': {
    type: 'number',
    default: 0,
    description:
      'Your price per million OUTPUT tokens, in millionths of a baht (for cost monitoring only; 0 = not configured).',
  },
  'ai.blockedNarrativeTerms': {
    type: 'string',
    default:
      'diagnos, prescri, dosage, antibiotic, treat, cure, medicat, vaccinat, guarantee, parasite, infection, disease, ' +
      // health-status claims: FARM+ records health events but never interprets them
      'healthy, unhealthy, good health, sick, illness, ' +
      // the same claims in Thai (matched as substrings: Thai has no spaces between words)
      'วินิจฉัย, สั่งยา, ขนาดยา, ยาปฏิชีวนะ, การรักษา, รักษาด้วย, รักษาโรค, หายขาด, วัคซีน, รับประกัน, พยาธิ, ติดเชื้อ, โรค, สุขภาพดี, สุขภาพแข็งแรง, ป่วย',
    description:
      'Comma-separated word STEMS an AI explanation may not contain ("treat" also blocks "treatment"; Thai terms match anywhere in the text): no diagnosis, treatment, health-status claims or guarantees. A starter list: extend it for your needs.',
  },
  'assistant.enabled': {
    type: 'boolean',
    default: false,
    description:
      'Let signed-in users get AI answers from the FARM+ assistant (help Q&A). Off: everyone gets help-article search only, with no AI call.',
  },
  'assistant.dailyLimit': {
    type: 'number',
    default: 1000,
    description:
      'Most AI answers from the assistant the whole platform may request per day (a cost guard). Past it, people get help-article search only.',
  },
  'assistant.actionsEnabled': {
    type: 'boolean',
    default: false,
    description:
      "Let signed-in users ask the assistant to open a page, a tour or a form filled in from what they typed (they always check and save the form themselves). Uses the assistant's daily limits.",
  },
  'assistant.perUserDaily': {
    type: 'number',
    default: 20,
    description: 'Most AI answers from the assistant one user may request per day.',
  },
  'analytics.cacheSeconds': {
    type: 'number',
    default: 60,
    description:
      'How long a dashboard report is reused before it is recalculated (seconds, 0 = never cache). Figures can be this old; a refresh option recalculates immediately.',
  },
  'platform.maintenanceMode': {
    type: 'boolean',
    default: false,
    description: 'Informational flag. Not yet enforced by any public endpoint.',
  },
} as const satisfies Record<string, SettingDefinition>;

export type SettingKey = keyof typeof SETTING_REGISTRY;

const definition = (key: string): SettingDefinition | undefined =>
  (SETTING_REGISTRY as Record<string, SettingDefinition>)[key];

export async function getBooleanSetting(key: SettingKey): Promise<boolean> {
  const row = await Setting.findOne({ key });
  return typeof row?.value === 'boolean' ? row.value : (SETTING_REGISTRY[key].default as boolean);
}

export async function getStringSetting(key: SettingKey): Promise<string> {
  const row = await Setting.findOne({ key });
  return typeof row?.value === 'string' ? row.value : (SETTING_REGISTRY[key].default as string);
}

export async function getNumberSetting(key: SettingKey, min = 1, max = 10_000): Promise<number> {
  const row = await Setting.findOne({ key });
  const v = typeof row?.value === 'number' ? row.value : (SETTING_REGISTRY[key].default as number);
  return Math.min(max, Math.max(min, v));
}

export async function listSettings(): Promise<SettingValue[]> {
  const rows = new Map((await Setting.find()).map((r) => [r.key, r]));
  return Object.entries(SETTING_REGISTRY).map(([key, def]) => {
    const row = rows.get(key);
    return {
      key,
      value: row?.value ?? def.default,
      default: def.default,
      description: def.description,
      ...(row ? { updatedAt: row.updatedAt.toISOString() } : {}),
      ...(row?.updatedBy ? { updatedBy: String(row.updatedBy) } : {}),
    };
  });
}

export async function updateSettings(
  actor: Actor,
  values: Record<string, Scalar>,
  reason: string,
): Promise<SettingValue[]> {
  const details: { path: string; message: string }[] = [];
  for (const [key, value] of Object.entries(values)) {
    const def = definition(key);
    if (!def) details.push({ path: key, message: 'Unknown setting' });
    else if (typeof value !== def.type)
      details.push({ path: key, message: `Expected ${def.type}` });
  }
  if (details.length > 0) throw new HttpError(400, 'VALIDATION_ERROR', 'Invalid settings', details);

  const current = new Map((await listSettings()).map((s) => [s.key, s.value]));
  const changes: Record<string, { from: Scalar; to: Scalar }> = {};
  for (const [key, value] of Object.entries(values)) {
    const from = current.get(key) as Scalar;
    if (from === value) continue;
    await Setting.updateOne(
      { key },
      { $set: { value, updatedBy: actor.userId } },
      { upsert: true },
    );
    changes[key] = { from, to: value };
  }
  if (Object.keys(changes).length > 0) {
    await recordAudit({
      actorId: actor.userId,
      action: 'settings.updated',
      targetType: 'settings',
      metadata: { changes, reason },
      ip: actor.ip,
    });
  }
  return listSettings();
}
