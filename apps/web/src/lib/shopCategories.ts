import type { ProductCategoryDTO } from '@farmplus/shared-types';
import { api } from '../api';
import { shared } from './shared';

/**
 * Shop categories, read by the header and by several sections of the same page: callers mounting together share one
 * request (nothing is cached once it settles, so later reads are fresh).
 */
export const shopCategories = (): Promise<{ categories: ProductCategoryDTO[] }> =>
  shared('/shop/categories', () =>
    api.request<{ categories: ProductCategoryDTO[] }>('GET', '/shop/categories'),
  );
