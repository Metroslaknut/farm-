import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { Button } from '../components/ui';
import { useMediaQuery, useMinWidth } from '../hooks/useMediaQuery';
import { useT } from '../i18n';
import { anchorEl } from './TourProvider';
import type { TourDefinition, TourStep } from './types';
import './tours.css';

interface Props {
  tour: TourDefinition;
  steps: TourStep[];
  index: number;
  onBack: () => void;
  onNext: () => void;
  onSkip: () => void;
  onDismissForever: () => void;
}

type Box = { top: number; left: number; width: number; height: number };
const PAD = 8;
const GAP = 12;
/** An element taller than this share of the screen is shown from its top, with the card in a corner. */
const TALL = 0.5;

/** Height of the page's sticky header (site header or farm shell top bar), so a scrolled-to element is not under it. */
function stickyHeaderHeight(): number {
  const header = document.querySelector<HTMLElement>('.site-header, .fd-topbar');
  if (!header) return 0;
  const pos = getComputedStyle(header).position;
  return pos === 'sticky' || pos === 'fixed' ? header.offsetHeight : 0;
}

/**
 * One step of a guided tour: a spotlight around the pointed element and a card next to it (a bottom sheet on phones).
 * The page is NOT locked — everything stays usable — except the pointed element on "look only" steps. Esc closes;
 * focus moves into the card and goes back where it was when the tour ends (TourProvider); the step is announced.
 */
export default function TourOverlay({
  tour,
  steps,
  index,
  onBack,
  onNext,
  onSkip,
  onDismissForever,
}: Props) {
  const t = useT('tours');
  const wide = useMinWidth('md');
  const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const step = steps[index]!;
  const last = index === steps.length - 1;
  const card = useRef<HTMLDivElement>(null);
  const nextButton = useRef<HTMLButtonElement>(null);
  const [box, setBox] = useState<Box | null>(null);
  const [cardSize, setCardSize] = useState({ w: 320, h: 200 });
  const text = (key: string) => t(key as never);
  const title = text(step.titleKey);

  // Bring the element into view (above the bottom sheet on phones), then follow it while the page scrolls.
  useEffect(() => {
    const el = anchorEl(step.anchor);
    if (!el) return;
    const behavior = reduceMotion ? 'auto' : 'smooth';
    const r0 = el.getBoundingClientRect();
    if (r0.height > window.innerHeight * TALL) {
      // Taller than half the screen: show its top (its heading), just below a sticky header.
      window.scrollTo?.({ top: r0.top + window.scrollY - stickyHeaderHeight() - GAP, behavior });
    } else el.scrollIntoView?.({ block: 'center', behavior });
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const r = el.getBoundingClientRect();
        setBox({ top: r.top, left: r.left, width: r.width, height: r.height });
      });
    };
    measure();
    window.addEventListener('scroll', measure, true);
    window.addEventListener('resize', measure);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', measure, true);
      window.removeEventListener('resize', measure);
    };
  }, [step.anchor, reduceMotion]);

  useLayoutEffect(() => {
    const c = card.current;
    if (c) setCardSize({ w: c.offsetWidth, h: c.offsetHeight });
  }, [index, wide]);

  // On phones the card is a bottom sheet: keep the element above it.
  useEffect(() => {
    if (wide || !box || box.height > window.innerHeight * TALL) return;
    const covered = box.top + box.height + PAD - (window.innerHeight - cardSize.h - GAP);
    if (covered > 0) window.scrollBy({ top: covered, behavior: reduceMotion ? 'auto' : 'smooth' });
  }, [wide, box, cardSize.h, reduceMotion]);

  // Focus into the card when the tour opens; keep it inside when a button disappears (e.g. "Back" on step 1).
  useEffect(() => {
    // A step without the tour's Next (the page's own button moves it on) focuses the card's first button.
    if (!card.current?.contains(document.activeElement))
      (nextButton.current ?? card.current?.querySelector('button'))?.focus();
  }, [index]);

  // "Press the form's own Next": pressing the pointed element moves the tour on.
  useEffect(() => {
    if (!step.advanceOnClick) return;
    const el = anchorEl(step.anchor);
    if (!el) return;
    el.addEventListener('click', onNext);
    return () => el.removeEventListener('click', onNext);
  }, [step.advanceOnClick, step.anchor, onNext]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onSkip();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onSkip]);

  // Desktop: below the element when there is room, otherwise above; kept on screen.
  let cardStyle: React.CSSProperties | undefined;
  if (wide && box && box.height > window.innerHeight * TALL) {
    // A tall element: the card waits in the bottom-right corner instead of covering it.
    cardStyle = {
      top: window.innerHeight - cardSize.h - GAP,
      left: window.innerWidth - cardSize.w - GAP,
    };
  } else if (wide && box) {
    const below = box.top + box.height + PAD + GAP;
    const roomBelow = window.innerHeight - below;
    const preferTop =
      step.placement === 'top' || (step.placement !== 'bottom' && roomBelow < cardSize.h);
    const top = preferTop ? Math.max(GAP, box.top - PAD - GAP - cardSize.h) : below;
    const left = Math.min(
      Math.max(GAP, box.left + box.width / 2 - cardSize.w / 2),
      window.innerWidth - cardSize.w - GAP,
    );
    cardStyle = { top, left };
  }

  return createPortal(
    <>
      {box && (
        <div
          className={`tour-spot${step.observeOnly ? ' tour-spot--block' : ''}`}
          aria-hidden="true"
          style={{
            top: box.top - PAD,
            left: box.left - PAD,
            width: box.width + PAD * 2,
            height: box.height + PAD * 2,
          }}
        />
      )}
      <div
        ref={card}
        className={`tour-card ${wide ? 'tour-card--float' : 'tour-card--sheet'}`}
        style={cardStyle}
        role="dialog"
        aria-modal="false"
        aria-labelledby="tour-title"
        aria-describedby="tour-body"
        data-tour-id={tour.id}
      >
        <p className="tour-card__count">{t('ui.stepOf', { n: index + 1, total: steps.length })}</p>
        <h2 id="tour-title" className="tour-card__title">
          {title}
        </h2>
        <p id="tour-body" className="tour-card__body">
          {text(step.bodyKey)}
        </p>
        {step.helpSlug && (
          <p className="tour-card__more">
            <Link to={`/help/${step.helpSlug}`}>{t('ui.readMore')}</Link>
          </p>
        )}
        <div className="tour-card__actions">
          <Button variant="ghost" size="sm" onClick={onSkip}>
            {t('ui.skip')}
          </Button>
          <span className="tour-card__nav">
            {index > 0 && (
              <Button size="sm" onClick={onBack}>
                {t('ui.back')}
              </Button>
            )}
            {!step.advanceOnClick && (
              <Button ref={nextButton} variant="primary" size="sm" onClick={onNext}>
                {last ? t('ui.done') : t('ui.next')}
              </Button>
            )}
          </span>
        </div>
        <button type="button" className="tour-card__never" onClick={onDismissForever}>
          {t('ui.dontShow')}
        </button>
      </div>
      <p className="ds-sr-only" aria-live="polite">
        {t('ui.announce', { n: index + 1, total: steps.length, title })}
      </p>
    </>,
    // Inside the page's design-system root, where the colour and spacing tokens are defined.
    anchorEl(step.anchor)?.closest('.ds-root') ??
      document.querySelector('.ds-root') ??
      document.body,
  );
}
