import type { z } from 'zod';
import type { createProductSchema, updateProductSchema } from '@farmplus/validation';

export type CreateProductInput = z.output<typeof createProductSchema>;
export type UpdateProductInput = z.output<typeof updateProductSchema>;
