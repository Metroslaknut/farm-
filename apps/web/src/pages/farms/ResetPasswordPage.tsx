import { useEffect, useState, type FormEvent } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { passwordSchema } from '@farmplus/validation';
import { publicApi } from '../../api';
import { Icon } from '../../components/layout/Icon';
import { Alert, Button, buttonClass, PasswordField } from '../../components/ui';
import { useT } from '../../i18n';
import { authError, errorCode } from './auth/messages';
import './auth/auth.css';

type State = 'form' | 'done' | 'invalid';

/** Same minimum as the API (`passwordSchema`). */
const MIN_PASSWORD = passwordSchema.minLength ?? 10;

/**
 * `/farms/reset-password?token=…` — the link from the password-reset message. Saves a new password with
 * `POST /auth/password/reset`; the API signs every device out (all sessions are revoked).
 */
export default function ResetPasswordPage() {
  const location = useLocation();
  const t = useT('auth');
  const [token] = useState(() => new URLSearchParams(location.search).get('token') ?? '');
  const [state, setState] = useState<State>(token ? 'form' : 'invalid');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<{ password?: string; confirm?: string; form?: string }>({});
  const [busy, setBusy] = useState(false);

  // Keep the token out of the address bar (history, screenshots, referrers).
  useEffect(() => {
    if (token) window.history.replaceState(window.history.state, '', location.pathname);
    // Runs once for the token captured on the first render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const next: typeof errors = {};
    if (password.length < MIN_PASSWORD)
      next.password = t('register.errPasswordShort', { min: MIN_PASSWORD });
    else if (confirm !== password) next.confirm = t('register.errConfirm');
    setErrors(next);
    if (Object.keys(next).length) return;
    setBusy(true);
    try {
      await publicApi.request('POST', '/auth/password/reset', {
        body: { token, newPassword: password },
      });
      setState('done');
    } catch (e) {
      if (errorCode(e) === 'INVALID_RESET_TOKEN') setState('invalid');
      else setErrors({ form: authError(e, t) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-page auth-page--narrow">
      <section className="auth-card" aria-labelledby="reset-title" aria-live="polite">
        {state === 'form' && (
          <>
            <h1 id="reset-title">{t('reset.title')}</h1>
            <form onSubmit={submit} noValidate>
              <PasswordField
                label={t('reset.password')}
                hint={t('register.passwordHint', { min: MIN_PASSWORD })}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                error={errors.password}
                required
              />
              <PasswordField
                label={t('reset.confirm')}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoComplete="new-password"
                error={errors.confirm}
                required
              />
              {errors.form && <Alert tone="danger">{errors.form}</Alert>}
              <div className="auth-actions">
                <Button type="submit" variant="primary" block loading={busy}>
                  {t('reset.submit')}
                </Button>
              </div>
            </form>
          </>
        )}
        {state === 'done' && (
          <>
            <span className="auth-card__icon">
              <Icon name="check" size={28} />
            </span>
            <h1 id="reset-title">{t('reset.done')}</h1>
            <p className="auth-card__lead">{t('reset.doneLead')}</p>
            <Link to="/farms/sign-in" className={buttonClass({ variant: 'primary', block: true })}>
              {t('reset.signIn')}
            </Link>
          </>
        )}
        {state === 'invalid' && (
          <>
            <span className="auth-card__icon">
              <Icon name="alert" size={28} />
            </span>
            <h1 id="reset-title">{t('reset.invalid')}</h1>
            <p className="auth-card__lead">{t('reset.invalidLead')}</p>
            <Link
              to="/farms/forgot-password"
              className={buttonClass({ variant: 'primary', block: true })}
            >
              {t('reset.again')}
            </Link>
          </>
        )}
      </section>
    </div>
  );
}
