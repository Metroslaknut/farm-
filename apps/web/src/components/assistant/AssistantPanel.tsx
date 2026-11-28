import { useContext, useState, type FormEvent } from 'react';
import { Link, useLocation } from 'react-router-dom';
import type { AssistantAnswerDTO } from '@farmplus/shared-types';
import { api, publicApi } from '../../api';
import { AuthContext } from '../../auth/AuthContext';
import { useLocale, useT } from '../../i18n';
import { useTours } from '../../tours/TourProvider';
import { Alert, Button, Textarea } from '../ui';
import { TipCards } from './TipCards';

/**
 * "Ask the FARM+ assistant" (docs/architecture/assistant.md). Signed-in people may get an AI answer that cites help
 * articles; everyone else (or when AI is off or over its limit) gets the matching articles. The answer is shown as
 * plain text: links and tours come only from the API's checked lists.
 */
export default function AssistantPanel() {
  const t = useT('help');
  const tt = useT('tours');
  const [locale] = useLocale();
  // Read softly: the help centre is public and also rendered without an auth provider.
  const status = useContext(AuthContext)?.status ?? 'anonymous';
  const { pathname } = useLocation();
  const { startable, toursHere, start } = useTours();
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [result, setResult] = useState<AssistantAnswerDTO | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const text = message.trim();
    if (text.length < 2 || busy) return;
    setBusy(true);
    setFailed(false);
    try {
      const client = status === 'authenticated' ? api : publicApi;
      setResult(
        await client.request<AssistantAnswerDTO>('POST', '/assistant/ask', {
          body: { message: text, locale, context: { route: pathname } },
        }),
      );
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  const tours = (result?.tours ?? [])
    .map((id) => [...toursHere, ...startable].find((tour) => tour.id === id))
    .filter((tour): tour is NonNullable<typeof tour> => !!tour);

  return (
    <>
      <TipCards />
      <section aria-labelledby="help-assistant" className="help-section" data-tour="help-assistant">
        <h2 id="help-assistant">{t('assistant.title')}</h2>
        <form onSubmit={submit} className="ds-stack">
          <Textarea
            label={t('assistant.label')}
            hint={t('assistant.privacy')}
            value={message}
            maxLength={500}
            rows={2}
            placeholder={t('assistant.placeholder')}
            onChange={(e) => setMessage(e.target.value)}
          />
          <div>
            <Button type="submit" variant="primary" disabled={busy || message.trim().length < 2}>
              {busy ? t('assistant.asking') : t('assistant.ask')}
            </Button>
          </div>
        </form>

        <div aria-live="polite">
          {failed && <Alert tone="danger">{t('assistant.error')}</Alert>}
          {result && !failed && (
            <div className="ds-stack" data-testid="assistant-result">
              {result.mode === 'ai' && result.answer ? (
                <>
                  <p style={{ whiteSpace: 'pre-line' }}>{result.answer}</p>
                  <p className="ds-field__hint">{t('assistant.aiNote')}</p>
                </>
              ) : (
                result.reason && <Alert tone="info">{t(`assistant.reason.${result.reason}`)}</Alert>
              )}
              {result.citations.length === 0 ? (
                <p>{t('assistant.none')}</p>
              ) : (
                <>
                  <h3>{result.mode === 'ai' ? t('assistant.sources') : t('assistant.articles')}</h3>
                  <ul className="help-list">
                    {result.citations.map((c) => (
                      <li key={c.slug}>
                        <Link className="help-list__link" to={`/help/${c.slug}`}>
                          <strong>{c.title}</strong>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {result.links.length > 0 && (
                <>
                  <h3>{t('assistant.pages')}</h3>
                  <ul className="help-list">
                    {result.links.map((l) => (
                      <li key={l.route}>
                        <Link className="help-list__link" to={l.route}>
                          <strong>{l.label}</strong>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {tours.length > 0 && (
                <div className="ds-row">
                  {tours.map((tour) => (
                    <Button key={tour.id} size="sm" onClick={() => start(tour.id)}>
                      {t('assistant.tour', { name: tt(`name.${tour.id}` as never) })}
                    </Button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </section>
    </>
  );
}
