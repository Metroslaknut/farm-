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
