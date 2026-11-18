import { useEffect, useState, type FormEvent } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { publicApi } from '../../api';
import { Icon } from '../../components/layout/Icon';
import { Alert, Button, buttonClass, Spinner, TextField } from '../../components/ui';
import { useT } from '../../i18n';
import { authError } from './auth/messages';
import './auth/auth.css';

// A link token is single-use: one request per token, even if the effect runs twice (StrictMode) or the page re-mounts.
const confirmations = new Map<string, Promise<void>>();
function confirmEmail(token: string): Promise<void> {
  let pending = confirmations.get(token);
  if (!pending) {
    pending = publicApi.request<void>('POST', '/auth/verify/email', { body: { token } });
    confirmations.set(token, pending);
  }
  return pending;
}

type State = 'verifying' | 'verified' | 'invalid';

/** `/farms/verify-email?token=…` — the link from the verification email. */
export default function VerifyEmailPage() {
  const location = useLocation();
  const t = useT('auth');
  const [token] = useState(() => new URLSearchParams(location.search).get('token') ?? '');
  const [state, setState] = useState<State>(token ? 'verifying' : 'invalid');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    // Keep the token out of the address bar (history, screenshots, referrers).
    if (token) window.history.replaceState(window.history.state, '', location.pathname);
    if (!token) return;
    let active = true;
    confirmEmail(token).then(
      () => active && setState('verified'),
      () => active && setState('invalid'),
    );
    return () => {
      active = false;
    };
    // Runs once for the token captured on the first render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const resend = async (event: FormEvent) => {
    event.preventDefault();
    setError(undefined);
    setNotice(undefined);
    const value = email.trim().toLowerCase();
    if (!value.includes('@')) return setError(t('verifyEmail.errEmail'));
    setBusy(true);
    try {
      await publicApi.request('POST', '/auth/verify/resend', { body: { identifier: value } });
      setNotice(t('verifyEmail.resent'));
    } catch (e) {
      setError(authError(e, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-page auth-page--narrow">
      <section className="auth-card" aria-labelledby="verify-title" aria-live="polite">
        {state === 'verifying' && (
          <>
            <h1 id="verify-title">{t('verifyEmail.verifying')}</h1>
            <p className="auth-card__lead" role="status">
              <Spinner /> {t('verifyEmail.wait')}
            </p>
          </>
        )}
        {state === 'verified' && (
          <>
            <span className="auth-card__icon">
              <Icon name="check" size={28} />
            </span>
            <h1 id="verify-title">{t('verifyEmail.verified')}</h1>
            <p className="auth-card__lead">{t('verifyEmail.verifiedLead')}</p>
            <Link to="/farms/sign-in" className={buttonClass({ variant: 'primary', block: true })}>
              {t('verifyEmail.signIn')}
            </Link>
          </>
        )}
        {state === 'invalid' && (
          <>
            <span className="auth-card__icon">
              <Icon name="alert" size={28} />
            </span>
            <h1 id="verify-title">{t('verifyEmail.invalid')}</h1>
            <p className="auth-card__lead">{t('verifyEmail.invalidLead')}</p>
            <form onSubmit={resend} noValidate>
              <TextField
                label={t('verifyEmail.email')}
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                required
              />
              {error && <Alert tone="danger">{error}</Alert>}
              {notice && <Alert tone="success">{notice}</Alert>}
              <div className="auth-actions">
                <Button type="submit" variant="primary" block loading={busy}>
                  {t('verifyEmail.resend')}
                </Button>
              </div>
            </form>
            <p className="auth-footnote">
              <Link to="/farms/sign-in">{t('verifyEmail.backToSignIn')}</Link>
            </p>
          </>
        )}
      </section>
    </div>
  );
}
