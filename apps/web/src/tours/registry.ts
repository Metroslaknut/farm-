import type { TourDefinition } from './types';

/**
 * Every guided tour. Keep each one short (3–7 steps, ≤ 2 lines per step). The test `test/tours.test.tsx` checks that
 * every text key exists in Thai and English and every `helpSlug` is a real help article.
 */
export const TOURS: TourDefinition[] = [
  {
    id: 'help-centre',
    version: 1,
    routes: ['/help'],
    startPath: '/help',
    audience: 'any',
    steps: [
      { anchor: 'help-search', titleKey: 'help-centre.1.title', bodyKey: 'help-centre.1.body' },
      {
        anchor: 'help-getting-started',
        titleKey: 'help-centre.2.title',
        bodyKey: 'help-centre.2.body',
        helpSlug: 'account-overview',
      },
      {
        anchor: 'help-tours',
        titleKey: 'help-centre.3.title',
        bodyKey: 'help-centre.3.body',
        optional: true,
      },
    ],
  },
];

export const tourById = (id: string): TourDefinition | undefined => TOURS.find((t) => t.id === id);
