import { useContext, useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import type { AssistantTipDTO, AssistantTipsDTO } from '@farmplus/shared-types';
import { api } from '../../api';
import { AuthContext } from '../../auth/AuthContext';
import { useT } from '../../i18n';
import { formatDate } from '../../lib/format';
import { useTours } from '../../tours/TourProvider';
import { Alert, Button, buttonClass } from '../ui';

const TONE = { warning: 'warning', action: 'info', info: 'info' } as const;

/**
 * Contextual tips (docs/architecture/assistant.md, PR 5): the API decides them with fixed rules; this only words them
 * (`tip.<rule>.*` in the help catalog) and stores "hide" / "remind me in 7 days". Signed-in people only; nothing is
 * shown while loading, when there is nothing to suggest, or when the request fails (tips are optional help).
 */
export function TipCards({ farmId, compact = false }: { farmId?: string; compact?: boolean }) {
  const t = useT('help');
  const status = useContext(AuthContext)?.status ?? 'anonymous';
  const { pathname } = useLocation();
  const { start } = useTours();
  const [tips, setTips] = useState<AssistantTipDTO[]>([]);

  useEffect(() => {
    if (status !== 'authenticated') return;
    let live = true;
    const qs = new URLSearchParams({ route: pathname, ...(farmId ? { farmId } : {}) });
    api
      .request<AssistantTipsDTO>('GET', `/assistant/suggestions?${qs}`)
      .then((r) => live && setTips(Array.isArray(r?.tips) ? r.tips : []))
      .catch(() => live && setTips([]));
    return () => {
      live = false;
    };
    // The page path only ranks; re-asking on every navigation inside a page is not needed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, farmId]);

  if (tips.length === 0) return null;

  const choose = (tip: AssistantTipDTO, action: 'hide' | 'snooze') => {
    setTips((all) => all.filter((x) => x.key !== tip.key));
    void api
      .request('PUT', `/me/assistant-tips/${encodeURIComponent(tip.key)}`, { body: { action } })
      .catch(() => undefined);
  };
  const params = (tip: AssistantTipDTO) => ({
    ...tip.params,
    ...(typeof tip.params['until'] === 'string' ? { until: formatDate(tip.params['until']) } : {}),
  });

  return (
    <section
      aria-label={t('tips.title')}
      className="ds-stack"
      data-testid="assistant-tips"
      data-tour="assistant-tips"
    >
      {!compact && <h2>{t('tips.title')}</h2>}
      {tips.map((tip) => {
        const reason =
          typeof tip.params['reason'] === 'string' && tip.params['reason']
            ? tip.params['reason']
            : null;
        return (
          <Alert key={tip.key} tone={TONE[tip.severity]}>
            <strong>{t(`tip.${tip.rule}.title`, params(tip))}</strong>
            <div>{t(`tip.${tip.rule}.body`, params(tip))}</div>
            {reason && <div>{t('tips.reason', { reason })}</div>}
            <div className="ds-row">
              {tip.action && 'route' in tip.action && (
                <Link
                  className={buttonClass({ variant: 'primary', size: 'sm' })}
                  to={tip.action.route}
                >
                  {t(`tip.${tip.rule}.action`)}
                </Link>
              )}
              {tip.action && 'tourId' in tip.action && (
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => start((tip.action as { tourId: string }).tourId)}
                >
                  {t(`tip.${tip.rule}.action`)}
                </Button>
              )}
              <Button size="sm" onClick={() => choose(tip, 'snooze')}>
                {t('tips.snooze')}
              </Button>
              <Button size="sm" onClick={() => choose(tip, 'hide')}>
                {t('tips.hide')}
              </Button>
            </div>
          </Alert>
        );
      })}
    </section>
  );
}
