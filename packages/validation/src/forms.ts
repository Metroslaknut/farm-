import type { ZodError } from 'zod';

/** One message per field, keyed by dotted path (e.g. `origin.kind`). `_form` holds errors with no field. */
export type FieldErrors = Record<string, string>;

/** Client-side validation with the SAME schemas the API uses: first problem per field. */
export function fieldErrorsFromZod(error: ZodError): FieldErrors {
  const out: FieldErrors = {};
  for (const issue of error.issues) {
    const path = issue.path.join('.') || '_form';
    out[path] ??= issue.message;
  }
  return out;
}

/** Map the API's `{ error: { details: [{ path, message }] } }` onto form fields. */
export function fieldErrorsFromDetails(
  details: { path: string; message: string }[] | undefined,
): FieldErrors {
  const out: FieldErrors = {};
  for (const d of details ?? []) out[d.path || '_form'] ??= d.message;
  return out;
}
