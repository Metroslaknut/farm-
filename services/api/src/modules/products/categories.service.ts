import { Types } from 'mongoose';
import type { ProductCategoryDTO, ProductRegulation } from '@farmplus/shared-types';
import type { Actor } from '../../context';
import { HttpError, notFound } from '../../lib/errors';
import { ProductCategory } from '../../models';
import { recordAudit } from '../../services/audit.service';
import { categoryDTO } from './products.service';

const err = (status: number, code: string, message: string, path?: string) =>
  new HttpError(status, code, message, path ? [{ path, message }] : undefined);

const audit = (actor: Actor, action: string, key: string, metadata: Record<string, unknown>) =>
  recordAudit({
    actorId: actor.userId,
    action,
    targetType: 'product_category',
    targetId: key,
    metadata,
    ...(actor.ip ? { ip: actor.ip } : {}),
  });

/** Create or edit a category. New categories start with sales OFF; making one stricter switches it off again. */
export async function upsertCategory(
  actor: Actor,
  key: string,
  input: {
    name: string;
    description?: string | null | undefined;
    parentKey?: string | null | undefined;
    regulation?: ProductRegulation | undefined;
    sortOrder?: number | undefined;
    reason: string;
  },
): Promise<ProductCategoryDTO> {
  if (input.parentKey) {
    if (input.parentKey === key)
      throw err(400, 'VALIDATION_ERROR', 'A category cannot be its own parent', 'parentKey');
    const parent = await ProductCategory.findOne({ key: input.parentKey });
    if (!parent) throw err(400, 'VALIDATION_ERROR', 'Unknown parent category', 'parentKey');
    if (parent.parentKey)
      throw err(400, 'VALIDATION_ERROR', 'Categories can be nested one level only', 'parentKey');
  }
  const existing = await ProductCategory.findOne({ key });
  if (!existing) {
    const created = await ProductCategory.create({
      key,
      name: input.name,
      description: input.description ?? null,
      parentKey: input.parentKey ?? null,
      regulation: input.regulation ?? 'none',
      salesEnabled: false,
      sortOrder: input.sortOrder ?? 100,
    });
    await audit(actor, 'product_category.created', key, {
      reason: input.reason,
      regulation: created.regulation,
    });
    return categoryDTO(created);
  }
  const stricter =
    input.regulation !== undefined &&
    input.regulation !== existing.regulation &&
    input.regulation !== 'none';
  const next = await ProductCategory.findOneAndUpdate(
    { key },
    {
      $set: {
        name: input.name,
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.parentKey !== undefined ? { parentKey: input.parentKey } : {}),
        ...(input.regulation !== undefined ? { regulation: input.regulation } : {}),
        ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
        // A stricter classification must be re-reviewed before sales continue.
        ...(stricter
          ? { salesEnabled: false, complianceReference: null, complianceReviewedAt: null }
          : {}),
      },
    },
    { returnDocument: 'after' },
  );
  await audit(actor, 'product_category.updated', key, {
    reason: input.reason,
    regulation: next!.regulation,
    salesSwitchedOff: stricter,
  });
  return categoryDTO(next!);
}

/**
 * THE compliance gate. Regulated goods (medicines…) stay off until a person records that the applicable rules were
 * reviewed (a reference to that review is mandatory) and confirms by typing `ENABLE <key>`. Prohibited categories can never be enabled.
 */
export async function setCategorySales(
  actor: Actor,
  key: string,
  input: {
    enabled: boolean;
    complianceReference?: string | undefined;
    reason: string;
    confirmation: string;
  },
): Promise<ProductCategoryDTO> {
  const cat = await ProductCategory.findOne({ key });
  if (!cat) throw notFound('Category not found');
  const expected = `${input.enabled ? 'ENABLE' : 'DISABLE'} ${key}`;
  if (input.confirmation !== expected)
    throw err(400, 'CONFIRMATION_MISMATCH', `Type “${expected}” to confirm`, 'confirmation');
  if (input.enabled) {
    if (cat.regulation === 'prohibited')
      throw err(409, 'PROHIBITED_CATEGORY', 'A prohibited category can never be opened for sale');
    if (cat.regulation === 'regulated' && !input.complianceReference)
      throw err(
        400,
        'COMPLIANCE_REVIEW_REQUIRED',
        'Regulated goods need the reference of the compliance review that approved their sale',
        'complianceReference',
      );
  }
  const next = await ProductCategory.findOneAndUpdate(
    { key },
    {
      $set: {
        salesEnabled: input.enabled,
        ...(input.enabled
          ? {
              complianceReference: input.complianceReference ?? cat.complianceReference ?? null,
              complianceReviewedAt: new Date(),
              complianceReviewedBy: new Types.ObjectId(actor.userId),
            }
          : {}),
      },
    },
    { returnDocument: 'after' },
  );
  await audit(
    actor,
    input.enabled ? 'product_category.sales_enabled' : 'product_category.sales_disabled',
    key,
    {
      reason: input.reason,
      regulation: cat.regulation,
      complianceReference: input.complianceReference ?? null,
    },
  );
  return categoryDTO(next!);
}
