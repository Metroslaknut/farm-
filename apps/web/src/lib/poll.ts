/**
 * Calls `fn` every `ms` while the tab is visible. Ticks are skipped while it is hidden (no requests from background
 * tabs), and `fn` runs once as soon as the tab is shown again so the screen is fresh. Returns the cleanup.
 */
export function pollWhileVisible(fn: () => void, ms: number): () => void {
  const timer = setInterval(() => {
    if (!document.hidden) fn();
  }, ms);
  const onVisible = () => {
    if (!document.hidden) fn();
  };
  document.addEventListener('visibilitychange', onVisible);
  return () => {
    clearInterval(timer);
    document.removeEventListener('visibilitychange', onVisible);
  };
}
