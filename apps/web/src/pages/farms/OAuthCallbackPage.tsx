import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import type { LoginResponse } from '@farmplus/shared-types';
import { publicApi } from '../../api';
import { useAuth } from '../../auth/AuthContext';
import { takePendingSocialSignIn } from '../../auth/social';
import { Icon } from '../../components/layout/Icon';
import { Alert, Spinner, buttonClass } from '../../components/ui';
import { useT } from '../../i18n';
import { authError, errorCode, oauthErrorMessage } from './auth/messages';
import './auth/auth.css';

interface Exchanged {
  response: LoginResponse;
  next: string | undefined;
}

// A ticket is single-use: one exchange per ticket even if the effect runs twice (StrictMode) or the page re-mounts.
const exchanges = new Map<string, Promise<Exchanged>>();
function exchange(ticket: string): Promise<Exchanged> {
  let pending = exchanges.get(ticket);
  if (!pending) {
    const stored = takePendingSocialSignIn(); // read once, then forgotten
    pending = stored
      ? publicApi
          .oauthExchange(ticket, stored.verifier)
          .then((response) => ({ response, next: stored.next }))
      : Promise.reject(Object.assign(new Error('No pending sign-in'), { code: 'INVALID_TICKET' }));
    exchanges.set(ticket, pending);
  }
  return pending;
}

/** `/farms/oauth-callback?ticket=…` (or `?error=…`): where Google / Facebook sign-in comes back to. */
export default function OAuthCallbackPage() {
  const { completeSignIn } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useState(() => {
    const q = new URLSearchParams(location.search);
    return { ticket: q.get('ticket'), error: q.get('error') };
  });
  const t = useT('auth');
  // A failed exchange keeps its message; the `?error=` / missing-ticket cases are worded at render time.
  const [failure, setFailure] = useState<string | undefined>();
  const error =
    failure ??
    (params.ticket
      ? undefined
      : params.error
        ? (oauthErrorMessage(params.error, t) ?? t('oauth.unknownError'))
        : t('error.signInExpired'));

  useEffect(() => {
    // The ticket must not stay in the address bar (history, bookmarks, screenshots).
    window.history.replaceState(window.history.state, '', location.pathname);
    if (!params.ticket) {
      takePendingSocialSignIn(); // the attempt is over: forget its verifier
      return;
    }
    let active = true;
    (async () => {
      try {
        const { response, next } = await exchange(params.ticket!);
        if (!active) return; // StrictMode's first run: the second run finishes the sign-in
        const result = await completeSignIn(response);
        if (result === 'mfa_required')
          navigate('/farms/sign-in', {
            replace: true,
            state: { mfa: true, from: next ?? '/farms' },
          });
        else navigate(next ?? '/farms', { replace: true });
      } catch (e) {
        if (active)
          setFailure(
            errorCode(e) === 'INVALID_TICKET' ? t('error.signInExpired') : authError(e, t),
          );
      }
    })();
    return () => {
      active = false;
    };
    // Runs once for the parameters captured on the first render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="auth-page auth-page--narrow">
      <section className="auth-card" aria-labelledby="oauth-title" aria-live="polite">
        {error ? (
          <>
            <span className="auth-card__icon">
              <Icon name="alert" size={28} />
            </span>
            <h1 id="oauth-title">{t('oauth.failed')}</h1>
            <Alert tone="danger">{error}</Alert>
            <div className="auth-actions">
              <Link
                to="/farms/sign-in"
                className={buttonClass({ variant: 'primary', block: true })}
              >
                {t('oauth.backToSignIn')}
              </Link>
            </div>
            <p className="auth-footnote">
              {t('oauth.noAccount')} <Link to="/farms/register">{t('oauth.register')}</Link>
            </p>
          </>
        ) : (
          <>
            <h1 id="oauth-title">{t('oauth.signingIn')}</h1>
            <p className="auth-card__lead" role="status">
              <Spinner /> {t('oauth.wait')}
            </p>
          </>
        )}
      </section>
    </div>
  );
}
