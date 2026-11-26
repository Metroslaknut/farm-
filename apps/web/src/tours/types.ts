/**
 * A guided tour is data: which pages it runs on, who it is for, and its steps. Each step points at an element marked
 * `data-tour="<anchor>"` in the page (the only change a page needs — no layout or CSS changes). Texts are keys of the
 * `tours` catalog (`src/i18n/messages/tours.ts`), in Thai and English.
 */
export type Placement = 'auto' | 'top' | 'bottom';

export interface TourStep {
  /** `data-tour` value of the element the step points at. */
  anchor: string;
  /** Keys in the `tours` catalog. */
  titleKey: string;
  bodyKey: string;
  placement?: Placement;
  /** A help article for "Read more" (`/help/<slug>`). */
  helpSlug?: string;
  /** Skipped silently when its element is not on the page (no permission, no data yet…). */
  optional?: boolean;
  /** Look only: the pointed element cannot be pressed while this step is shown. */
  observeOnly?: boolean;
  /**
   * The person goes on by pressing the pointed element itself (e.g. a form wizard's own "Next"), not the tour's Next.
   * The tour's Next button is not shown on this step.
   */
  advanceOnClick?: boolean;
  /**
   * The element only appears after something the person does on the page (the next screen of a wizard). Kept when the
   * tour opens even though its element is not there yet; when the tour reaches it, the card waits for the element.
   */
  later?: boolean;
}

export interface TourContext {
  signedIn: boolean;
  /** Platform permissions of the signed-in user (RBAC). */
  can: (permission: string) => boolean;
}

export interface TourDefinition {
  id: string;
  /** Raise it when the content changes a lot: the tour is shown again (not to people who chose "don't show again"). */
  version: number;
  /** react-router path patterns the tour runs on, e.g. "/farms/:farmId/animals/new". */
  routes: string[];
  /** Paths that `routes` would also match but are other pages (e.g. `/farms/seller` for `/farms/:farmId`). */
  notOn?: string[];
  /** Where "Show again" sends people when they are not on one of `routes` (only for routes without parameters). */
  startPath?: string;
  /** Who it is for. Default: everyone who can open the page. */
  audience?: 'guest' | 'member' | 'any';
  /** Extra condition (permissions, …). Uses the existing RBAC only. */
  when?: (ctx: TourContext) => boolean;
  steps: TourStep[];
}
