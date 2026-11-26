import { Fragment, type ReactNode } from 'react';
import { formatDateTime, formatNumber, validationMessage } from '@farmplus/i18n';
import { useLocale, useT, type Translate } from '../../i18n';
import messages from '../../i18n/messages/admin';

/** Any key of the admin catalog. */
export type AdminKey = Parameters<Translate<'admin'>>[0];

const isKey = (key: string): key is AdminKey =>
  Object.prototype.hasOwnProperty.call(messages.th, key);

/** `pending_review` → `pending review` (the English wording used when a value has no catalog entry). */
const plain = (value: string): string => value.replace(/_/g, ' ').toLowerCase();

/** Sentence case for Latin text (`pending review` → `Pending review`); Thai is left as it is. */
export const cap = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

/**
 * Text with React nodes in it: `rich(t('x'), { code: <code>a</code> })` replaces `{code}` in the translated
 * string, so word order stays the translator's (no sentence assembled from fragments).
 */
export function rich(text: string, nodes: Record<string, ReactNode>): ReactNode[] {
  return text
    .split(/\{(\w+)\}/g)
    .map((part, i) =>
      i % 2 === 1 ? <Fragment key={i}>{part in nodes ? nodes[part] : `{${part}}`}</Fragment> : part,
    );
}

/**
 * Admin translations plus the label helpers every admin page needs. Status and enum values coming from the API are
 * resolved through key maps (`status.*`, `walletKind.*`…) at render time, so they follow the language switch.
 */
export function useAdminI18n() {
  const t = useT('admin');
  const [locale] = useLocale();
  const lookup = (key: string, fallback: string): string => (isKey(key) ? t(key) : fallback);
  return {
    t,
    locale,
    /** A status value (any case) in lower case: `PENDING_REVIEW` → `pending review` / `รอตรวจสอบ`. */
    status: (value: string): string => lookup(`status.${value.toLowerCase()}`, plain(value)),
    /** An enum value of a group (`walletKind`, `reportReason`…) in lower case; unknown values stay readable. */
    label: (group: string, value: string, fallback = plain(value)): string =>
      lookup(`${group}.${value}`, fallback),
    /**
     * Text the API sends in English (permission descriptions, setting descriptions, role names, audit actions):
     * Thai comes from the catalog when known; English keeps the API's own wording.
     */
    apiText: (key: string, english: string): string =>
      locale === 'th' && isKey(key) ? t(key) : english,
    /**
     * An audit action (`farm.archived`): its own label when the catalog has one, otherwise worded from its parts
     * (`archived` + `farm` → "เก็บถาวร (ฟาร์ม)"); the raw action when neither part is known. English keeps the API's
     * action, as before.
     */
    auditAction: (action: string): string => {
      if (locale !== 'th') return action;
      if (isKey(`auditAction.${action}`)) return t(`auditAction.${action}` as AdminKey);
      const dot = action.lastIndexOf('.');
      const entity = action.slice(0, dot);
      const verb = action.slice(dot + 1);
      return dot > 0 && isKey(`auditVerb.${verb}`)
        ? t('auditAction.fallback', {
            verb: t(`auditVerb.${verb}` as AdminKey),
            entity: lookup(`auditEntity.${entity}`, entity),
          })
        : action;
    },
    /** Client-side (Zod) validation messages are English; Thai gets the shared translation. */
    validation: (english: string): string => validationMessage(locale, english),
    dateTime: (iso: string | null | undefined): string =>
      (iso && formatDateTime(iso, locale)) || '—',
    number: (value: number): string => formatNumber(value, locale),
  };
}

export type AdminI18n = ReturnType<typeof useAdminI18n>;
