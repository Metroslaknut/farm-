import { lazy, Suspense, useState, type FormEvent, type ReactNode } from 'react';
import { Link, Route, Routes, useParams, useSearchParams } from 'react-router-dom';
import { formatDate } from '@farmplus/i18n';
import { publicApi } from '../../api';
import { Alert, Button, Card, Modal, buttonClass } from '../../components/ui';
import { useLocale, useT } from '../../i18n';
import { article as findArticle, articles, byCategory, type HelpLocale } from '../../help/content';
import {
  IMAGE_WIDTHS,
  imagePath,
  type Article,
  type Block,
  type ImageRef,
  type Inline,
} from '../../help/parse';
import { search } from '../../help/search';
import { useTours } from '../../tours/TourProvider';
import NotFoundPage from '../NotFoundPage';
import './help.css';

/** The assistant panel loads on its own (docs/architecture/assistant.md). */
const AssistantPanel = lazy(() => import('../../components/assistant/AssistantPanel'));

/** `/help` (public): the help centre. Article content: `src/help/content/{th,en}/<slug>.md`. */
export default function HelpApp() {
  return (
    <Routes>
      <Route index element={<HelpIndexPage />} />
      <Route path=":slug" element={<HelpArticlePage />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}

const useHelpLocale = (): HelpLocale => useLocale()[0] as HelpLocale;

function HelpIndexPage() {
  const t = useT('help');
  const locale = useHelpLocale();
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const [draft, setDraft] = useState(q);
  const results = q ? search(articles(locale), q) : [];

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setParams(draft.trim() ? { q: draft.trim() } : {}, { replace: true });
  };

  return (
    <div className="help">
      <h1>{t('index.title')}</h1>
      <p className="help__lead">{t('index.lead')}</p>
      <form role="search" className="help-search" onSubmit={submit} data-tour="help-search">
        <label htmlFor="help-q" className="help-search__label">
          {t('index.search')}
        </label>
        <div className="ds-row">
          <input
            id="help-q"
            type="search"
            className="ds-input help-search__input"
            value={draft}
            placeholder={t('index.searchPlaceholder')}
            onChange={(e) => setDraft(e.target.value)}
          />
          <Button type="submit" variant="primary">
            {t('index.search')}
          </Button>
        </div>
      </form>

      {q && (
        <section aria-labelledby="help-results" aria-live="polite" className="help-section">
          <h2 id="help-results">{t('index.results')}</h2>
          {results.length === 0 ? (
            <p>{t('index.noResults', { q })}</p>
          ) : (
            <ArticleList items={results} />
          )}
          <button
            type="button"
            className="help-linkbtn"
            onClick={() => {
              setDraft('');
              setParams({}, { replace: true });
            }}
          >
            {t('index.clear')}
          </button>
        </section>
      )}

      <Suspense fallback={null}>
        <AssistantPanel />
      </Suspense>

      {byCategory(locale).map(({ category, items }) => (
        <section
          key={category}
          aria-labelledby={`help-${category}`}
          className="help-section"
          data-tour={category === 'getting-started' ? 'help-getting-started' : undefined}
        >
          <h2 id={`help-${category}`}>{t(`category.${category}`)}</h2>
          <ArticleList items={items} />
        </section>
      ))}
      <TourList />
    </div>
  );
}

/** Every guided tour this person can start from here (guests too: they have no account menu). */
function TourList() {
  const t = useT('tours');
  const { startable, start } = useTours();
  if (startable.length === 0) return null;
  return (
    <section aria-labelledby="help-tours" className="help-section" data-tour="help-tours">
      <h2 id="help-tours">{t('ui.listTitle')}</h2>
      <p className="ds-field__hint">{t('ui.listLead')}</p>
      <ul className="help-list">
        {startable.map((tour) => (
          <li key={tour.id} className="help-list__link">
            <strong>{t(`name.${tour.id}` as never)}</strong>
            <span>
              <Button size="sm" onClick={() => start(tour.id)}>
                {t('ui.start')}
              </Button>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ArticleList({ items }: { items: Article[] }) {
  return (
    <ul className="help-list">
      {items.map((a) => (
        <li key={a.slug}>
          <Link to={`/help/${a.slug}`} className="help-list__link">
            <strong>{a.title}</strong>
            <span>{a.summary}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function HelpArticlePage() {
  const t = useT('help');
  const locale = useHelpLocale();
  const { slug = '' } = useParams();
  const a = findArticle(locale, slug);
  const [zoom, setZoom] = useState<ImageRef>();

  if (!a)
    return (
      <div className="help">
        <Card title={t('article.notFound')} headingLevel={1}>
          <p>{t('article.notFoundLead')}</p>
          <p>
            <Link to="/help">{t('article.back')}</Link>
          </p>
        </Card>
      </div>
    );

  const steps = a.blocks.flatMap((b) => (b.kind === 'steps' ? b.items : []));
  return (
    <article className="help help-article">
      <p className="help-noprint">
        <Link to="/help">{t('article.back')}</Link>
      </p>
      <h1>{a.title}</h1>
      <p className="help__lead">{a.summary}</p>
      {a.availability === 'messaging-pending' && (
        <Alert tone="warning">{t('article.messagingPending')}</Alert>
      )}
      <div className="ds-row help-noprint help-actions">
        {a.goTo && (
          <Link to={a.goTo} className={buttonClass({ variant: 'primary' })}>
            {t('article.goTo')}
          </Link>
        )}
        <Button onClick={() => window.print()}>{t('article.print')}</Button>
      </div>
      {steps.length > 1 && (
        <nav aria-labelledby="help-toc" className="help-toc">
          <h2 id="help-toc">{t('article.contents')}</h2>
          <ol>
            {steps.map((s, i) => (
              <li key={i}>
                <a href={`#step-${i + 1}`}>{plain(s.content)}</a>
              </li>
            ))}
          </ol>
        </nav>
      )}
      <Blocks blocks={a.blocks} slug={a.slug} locale={locale} onZoom={setZoom} />
      <p className="ds-field__hint">
        {t('article.updated', { date: formatDate(a.updatedAt, locale, { dateStyle: 'long' }) })}
      </p>
      <Feedback slug={a.slug} locale={locale} />
      <Modal
        open={zoom !== undefined}
        onClose={() => setZoom(undefined)}
        title={zoom?.alt ?? ''}
        footer={<Button onClick={() => setZoom(undefined)}>{t('article.close')}</Button>}
      >
        {zoom && (
          <img
            className="help-zoom"
            src={imagePath(a.slug, zoom.id, locale, 1280)}
            alt={zoom.alt}
          />
        )}
      </Modal>
    </article>
  );
}

const plain = (xs: Inline[]) => xs.map((x) => x.text).join('');

function Inlines({ items }: { items: Inline[] }) {
  return (
    <>
      {items.map((x, i) =>
        x.kind === 'bold' ? (
          <strong key={i}>{x.text}</strong>
        ) : x.kind === 'link' ? (
          <Link key={i} to={x.to}>
            {x.text}
          </Link>
        ) : x.kind === 'help' ? (
          <Link key={i} to={`/help/${x.slug}`}>
            {x.text}
          </Link>
        ) : (
          <span key={i}>{x.text}</span>
        ),
      )}
    </>
  );
}

function Blocks({
  blocks,
  slug,
  locale,
  onZoom,
}: {
  blocks: Block[];
  slug: string;
  locale: HelpLocale;
  onZoom: (img: ImageRef) => void;
}) {
  const t = useT('help');
  // Steps are numbered across the whole article (several step lists continue the count).
  const firstStep: number[] = [];
  blocks.reduce((n, b, i) => {
    firstStep[i] = n + 1;
    return b.kind === 'steps' ? n + b.items.length : n;
  }, 0);
  return (
    <>
      {blocks.map((b, i): ReactNode => {
        switch (b.kind) {
          case 'paragraph':
            return (
              <p key={i}>
                <Inlines items={b.content} />
              </p>
            );
          case 'heading':
            return (
              <h2 key={i} id={b.id}>
                {b.text}
              </h2>
            );
          case 'bullets':
            return (
              <ul key={i}>
                {b.items.map((it, j) => (
                  <li key={j}>
                    <Inlines items={it} />
                  </li>
                ))}
              </ul>
            );
          case 'steps':
            return (
              <ol key={i} className="help-steps" start={firstStep[i]}>
                {b.items.map((it, j) => {
                  const stepNo = firstStep[i]! + j;
                  return (
                    <li key={j} id={`step-${stepNo}`} className="help-step">
                      <p className="help-step__text">
                        <span className="help-step__no" aria-hidden="true">
                          {stepNo}
                        </span>
                        <Inlines items={it.content} />
                      </p>
                      {it.image && (
                        <StepImage slug={slug} locale={locale} image={it.image} onZoom={onZoom} />
                      )}
                    </li>
                  );
                })}
              </ol>
            );
          case 'box':
            return (
              <aside key={i} className={`help-box help-box--${b.tone}`}>
                <p className="help-box__kicker">{t(`box.${b.tone}`)}</p>
                <h3 className="help-box__title">{b.title}</h3>
                <Blocks blocks={b.blocks} slug={slug} locale={locale} onZoom={onZoom} />
              </aside>
            );
        }
      })}
    </>
  );
}

function StepImage({
  slug,
  locale,
  image,
  onZoom,
}: {
  slug: string;
  locale: HelpLocale;
  image: ImageRef;
  onZoom: (img: ImageRef) => void;
}) {
  const t = useT('help');
  const [phone, desktop] = IMAGE_WIDTHS;
  return (
    <button
      type="button"
      className="help-step__img"
      aria-label={t('article.zoom', { alt: image.alt })}
      onClick={() => onZoom(image)}
    >
      <picture>
        <source media="(max-width: 600px)" srcSet={imagePath(slug, image.id, locale, phone)} />
        <img
          src={imagePath(slug, image.id, locale, desktop)}
          alt={image.alt}
          loading="lazy"
          decoding="async"
        />
      </picture>
    </button>
  );
}

/** Anonymous "was this helpful?" — counts only (`POST /help/feedback`), one answer per page view. */
function Feedback({ slug, locale }: { slug: string; locale: HelpLocale }) {
  const t = useT('help');
  const [state, setState] = useState<'idle' | 'sending' | 'done' | 'failed'>('idle');
  const send = async (helpful: boolean) => {
    setState('sending');
    try {
      await publicApi.request('POST', '/help/feedback', { body: { slug, locale, helpful } });
      setState('done');
    } catch {
      setState('failed');
    }
  };
  return (
    <section className="help-feedback help-noprint" aria-live="polite">
      {state === 'done' ? (
        <p>{t('feedback.thanks')}</p>
      ) : (
        <>
          <p>{t('feedback.question')}</p>
          <div className="ds-row">
            <Button disabled={state === 'sending'} onClick={() => void send(true)}>
              {t('feedback.yes')}
            </Button>
            <Button disabled={state === 'sending'} onClick={() => void send(false)}>
              {t('feedback.no')}
            </Button>
          </div>
          {state === 'failed' && <Alert tone="danger">{t('feedback.failed')}</Alert>}
        </>
      )}
    </section>
  );
}
