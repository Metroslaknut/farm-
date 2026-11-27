/**
 * After a form is submitted, move focus to the first field that comes back invalid (`aria-invalid="true"`, set by
 * FormField), or to a form-level error marked `data-form-error`, so keyboard and screen-reader users land on what to fix
 * (staging QA #16). One listener for every form: messages from the browser-side check appear right away, messages from
 * the API a moment later, so the form is watched for a few seconds after each submit. Focus is only moved when the
 * person has not moved on (focus is still on the submit button, the form or the page).
 */
const WATCH_MS = 4000;
const INVALID = '[aria-invalid="true"], [data-form-error]';

export function installFocusFirstInvalid(doc: Document = document): () => void {
  const onSubmit = (event: Event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    const submitter = (event as SubmitEvent).submitter ?? null;
    const untouched = () => {
      const active = doc.activeElement;
      return !active || active === doc.body || active === form || active === submitter;
    };
    let done = false;
    const tryFocus = () => {
      if (done) return;
      const first = form.querySelector<HTMLElement>(INVALID);
      if (!first) return;
      done = true;
      stop();
      if (untouched()) {
        if (
          !first.hasAttribute('tabindex') &&
          !/^(INPUT|SELECT|TEXTAREA|BUTTON)$/.test(first.tagName)
        )
          first.setAttribute('tabindex', '-1');
        first.focus();
      }
    };
    const observer = new MutationObserver(tryFocus);
    observer.observe(form, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['aria-invalid'],
    });
    const timer = setTimeout(() => stop(), WATCH_MS);
    // A message that was already shown (the same mistake again) does not change the page: check after the next render.
    requestAnimationFrame(() => requestAnimationFrame(tryFocus));
    function stop() {
      observer.disconnect();
      clearTimeout(timer);
    }
  };
  doc.addEventListener('submit', onSubmit, true);
  return () => doc.removeEventListener('submit', onSubmit, true);
}
