import { findTerms, parseTerms } from '@farmplus/shared-utils';
import type { ProductRegulatory } from '@farmplus/shared-types';
import { HttpError } from '../../lib/errors';
import { ProductCategory, type ProductCategoryDoc } from '../../models';
import { getStringSetting } from '../settings/settings.service';

/**
 * Product compliance gates. They are deliberately blunt: a configurable block-list, a configurable list of treatment-claim
 * phrases, and a per-category switch that keeps regulated goods (medicines…) off until a person records that the applicable
 * rules were reviewed. None of this is legal advice and none of it replaces moderator review.
 */
export interface TextParts {
  title: string;
  description?: string | null | undefined;
  brand?: string | null | undefined;
  specs?: { name: string; value: string }[] | undefined;
  regulatoryNotes?: string | null | undefined;
}
const textsOf = (t: TextParts): (string | null | undefined)[] => [
  t.title,
  t.description,
  t.brand,
  t.regulatoryNotes,
  ...(t.specs ?? []).flatMap((s) => [s.name, s.value]),
];

const unprocessable = (code: string, message: string, path = 'title') =>
  new HttpError(422, code, message, [{ path, message }]);

export async function loadCategory(key: string): Promise<ProductCategoryDoc> {
  const cat = await ProductCategory.findOne({ key });
  if (!cat)
    throw new HttpError(400, 'VALIDATION_ERROR', 'Unknown product category', [
      { path: 'categoryKey', message: 'Choose one of the listed categories' },
    ]);
  return cat;
}

/** Is this category open for sale at all (create, list, buy)? */
export function assertCategoryOpen(
  cat: Pick<ProductCategoryDoc, 'key' | 'name' | 'regulation' | 'salesEnabled'>,
): void {
  if (cat.regulation === 'prohibited')
    throw unprocessable(
      'PROHIBITED_CATEGORY',
      `${cat.name} cannot be sold on FARM+`,
      'categoryKey',
    );
  if (!cat.salesEnabled)
    throw new HttpError(
      409,
      'CATEGORY_DISABLED',
      `Sales of ${cat.name} are not enabled yet${cat.regulation === 'regulated' ? ' (regulated goods need a compliance review first)' : ''}`,
      [{ path: 'categoryKey', message: 'This category is not open for sale' }],
    );
}

/** Content rules that apply to what a product says. Throws the first problem it finds. */
export async function assertContentAllowed(
  cat: Pick<ProductCategoryDoc, 'regulation'>,
  text: TextParts,
  regulatory: ProductRegulatory | null | undefined,
): Promise<void> {
  const [prohibited, claims] = await Promise.all([
    getStringSetting('products.prohibitedTerms'),
    getStringSetting('products.claimTerms'),
  ]);
  const hits = findTerms(textsOf(text), parseTerms(prohibited));
  if (hits.length > 0)
    throw unprocessable(
      'PROHIBITED_PRODUCT',
      `This product mentions “${hits[0]}”, which is not allowed on FARM+`,
    );
  if (cat.regulation === 'regulated') {
    if (!regulatory?.registrationNumber)
      throw unprocessable(
        'REGISTRATION_REQUIRED',
        'Regulated goods need their registration or licence number',
        'regulatory.registrationNumber',
      );
    return; // label claims of a registered product are for the moderator to check against the registration
  }
  const claimed = findTerms(textsOf(text), parseTerms(claims));
  if (claimed.length > 0)
    throw unprocessable(
      'UNSUPPORTED_CLAIM',
      `“${claimed[0]}” reads as a treatment or health claim. Describe what the product is and contains, not what it cures or prevents.`,
      'description',
    );
}

export const SEED_CATEGORIES = [
  {
    key: 'feed',
    name: 'Animal feed',
    regulation: 'none',
    salesEnabled: true,
    sortOrder: 10,
    description: 'Complete feeds, concentrates, forage and grain.',
  },
  {
    key: 'supplements',
    name: 'Feed supplements & minerals',
    regulation: 'none',
    salesEnabled: true,
    sortOrder: 20,
    description: 'Non-medicated minerals, salt licks and vitamin premixes sold as feed additives.',
  },
  {
    key: 'equipment',
    name: 'Farm equipment',
    regulation: 'none',
    salesEnabled: true,
    sortOrder: 30,
    description: 'Feeders, drinkers, fencing, handling and milking equipment.',
  },
  {
    key: 'medicines',
    name: 'Veterinary medicines',
    regulation: 'regulated',
    salesEnabled: false,
    sortOrder: 40,
    description: 'Regulated. Not for sale until a compliance review is recorded.',
  },
  {
    key: 'medicated_feed',
    name: 'Medicated feed',
    regulation: 'regulated',
    salesEnabled: false,
    sortOrder: 50,
    description: 'Regulated. Not for sale until a compliance review is recorded.',
  },
] as const;

/** Adds missing categories; never overwrites what an administrator changed. */
export async function seedProductCategories(): Promise<void> {
  for (const c of SEED_CATEGORIES)
    await ProductCategory.updateOne({ key: c.key }, { $setOnInsert: { ...c } }, { upsert: true });
}
