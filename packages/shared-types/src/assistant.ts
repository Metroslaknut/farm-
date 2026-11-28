/**
 * FARM+ assistant (help Q&A, docs/architecture/assistant.md). `ai` answers come from the model, grounded in help
 * articles; `search` answers are the best matching articles only (guests, assistant off, daily limit reached, or the
 * model's answer did not pass the checks).
 */
export type AssistantMode = 'ai' | 'search';

export interface AssistantCitation {
  slug: string;
  title: string;
}

export interface AssistantLink {
  /** A page from the assistant's catalogue (never a free URL). */
  route: string;
  label: string;
}

export interface AssistantAnswerDTO {
  mode: AssistantMode;
  /** The model's answer (plain text, short); absent in search mode. */
  answer?: string;
  citations: AssistantCitation[];
  links: AssistantLink[];
  /** Guided tours worth starting (ids from the web tour registry). */
  tours: string[];
  /** Why there is no AI answer, when the mode is search: guest, disabled, limit, unavailable, unchecked. */
  reason?: 'guest' | 'disabled' | 'limit' | 'unavailable' | 'unchecked';
}

/** Contextual tips (PR 5): decided by fixed server rules; the web words them from its catalogs by `rule`. */
export type AssistantTipRule =
  | 'create-farm'
  | 'owner-request'
  | 'owner-request-pending'
  | 'first-animal'
  | 'weigh-overdue'
  | 'growth-outside'
  | 'withdrawal'
  | 'seller-apply'
  | 'seller-rejected'
  | 'seller-pending'
  | 'offers-waiting'
  | 'listings-in-review'
  | 'enable-mfa';

export type AssistantTipAction = { route: string } | { tourId: string };

export interface AssistantTipDTO {
  /** Stable per person (and farm, for farm tips): the key "hide" and "remind me later" are stored under. */
  key: string;
  rule: AssistantTipRule;
  severity: 'info' | 'warning' | 'action';
  /** Values for the text (counts, a tag, a Thai date, a reason). */
  params: Record<string, string | number>;
  action?: AssistantTipAction;
}

export interface AssistantTipsDTO {
  tips: AssistantTipDTO[];
}

/** Assistant actions, level 1 (PR 6a): go somewhere, start a tour, or open a form filled in — the person saves it. */
export type AssistantFormKind = 'add_animal' | 'record_weight' | 'feeding_schedule';
export type AssistantActResultDTO =
  | { kind: 'navigate'; route: string; label: string }
  | { kind: 'tour'; tourId: string }
  | {
      kind: 'form';
      form: AssistantFormKind;
      route: string;
      /** Draft values for the form's own fields (strings, as typed in the form). */
      values: Record<string, string>;
      /** What was understood, for the person to check: field → shown value (an animal's code, "2.3", a day). */
      understood: { field: string; value: string }[];
    }
  /** Something needed is missing or unclear: the person is asked for these fields (never guessed). */
  | { kind: 'question'; form?: AssistantFormKind; missing: string[] }
  | {
      kind: 'none';
      reason:
        | 'disabled'
        | 'limit'
        | 'unavailable'
        | 'unchecked'
        | 'not_understood'
        | 'no_farm'
        | 'not_allowed';
    };
