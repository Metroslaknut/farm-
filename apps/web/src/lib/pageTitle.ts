/**
 * The browser tab / history title follows the page's main heading: "Weights · FARM+" instead of "FARM+" everywhere
 * (staging QA #17). Every page already has one <h1> in its <main>; this keeps the title in step as pages and
 * languages change, without each page having to set it. The home page keeps the plain site name (its heading is a
 * rotating slide).
 */
const SITE = 'FARM+';

function titleFor(doc: Document): string {
  if (doc.location.pathname === '/') return SITE;
  const h1 = doc.querySelector('main h1');
  const text = h1?.textContent?.replace(/\s+/g, ' ').trim();
  return text ? `${text} · ${SITE}` : SITE;
}

export function installPageTitles(doc: Document = document): () => void {
  let frame = 0;
  const update = () => {
    frame = 0;
    const next = titleFor(doc);
    if (doc.title !== next) doc.title = next;
  };
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(update);
  };
  const observer = new MutationObserver(schedule);
  observer.observe(doc.body, { subtree: true, childList: true, characterData: true });
  schedule();
  return () => {
    observer.disconnect();
    if (frame) cancelAnimationFrame(frame);
  };
}
