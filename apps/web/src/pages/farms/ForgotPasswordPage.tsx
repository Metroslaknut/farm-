import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { publicApi } from '../../api';
import { Alert, Button, TextField } from '../../components/ui';
import { useT } from '../../i18n';
import { authError } from './auth/messages';
import './auth/auth.css';

/**
 * `/farms/forgot-password` — asks the API to send a reset link (`POST /auth/password/forgot`). The answer is the same
 * whether or not the account exists (the API does not reveal it), so the page says "if this account exists".
 */
export default function ForgotPasswordPage() {
  const t = useT('auth');
  const [identifier, setIdentifier] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string>();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(undefined);
    const value = identifier.trim();
    if (value.length < 3) return setError(t('forgot.errIdentifier'));
    setBusy(true);
    try {
      await publicApi.request('POST', '/auth/password/forgot', { body: { identifier: value } });
      setSent(true);
    } catch (e) {
      setError(authError(e, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-page auth-page--narrow">
      <section className="auth-card" aria-labelledby="forgot-title" aria-live="polite">
        <h1 id="forgot-title">{t('forgot.title')}</h1>
        <p className="auth-card__lead">{t('forgot.lead')}</p>
        {sent ? (
          <Alert tone="success">{t('forgot.sent')}</Alert>
        ) : (
          <form onSubmit={submit} noValidate data-help-anchor="forgot-form">
            <TextField
              label={t('forgot.identifier')}
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              autoComplete="username"
              required
            />
            {error && <Alert tone="danger">{error}</Alert>}
            <div className="auth-actions">
              <Button type="submit" variant="primary" block loading={busy}>
                {t('forgot.submit')}
              </Button>
            </div>
          </form>
        )}
        <p className="auth-footnote">
          <Link to="/farms/sign-in">{t('forgot.backToSignIn')}</Link>
        </p>
        <p className="auth-footnote">
          <Link to="/help/forgot-password">{t('help.link')}</Link>
        </p>
      </section>
    </div>
  );
}
