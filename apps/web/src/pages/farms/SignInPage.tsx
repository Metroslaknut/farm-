import { useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { Alert, Button, Card, PasswordField, TextField } from '../../components/ui';
import { useT } from '../../i18n';
import { errorMessage } from '../../lib/format';
import { SocialButtons } from './auth/SocialButtons';
import './auth/auth.css';

export default function SignInPage() {
  const { status, login, verifyMfa } = useAuth();
  const t = useT('auth');
  const navigate = useNavigate();
  // `mfa`: a social sign-in came back needing the second factor (the challenge is already held by AuthContext).
  const state = useLocation().state as { from?: string; mfa?: boolean } | null;
  const from = state?.from ?? '/farms';
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [needsCode, setNeedsCode] = useState(state?.mfa === true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  if (status === 'authenticated') return <Navigate to={from} replace />;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      if (needsCode) await verifyMfa(code.trim());
      else if ((await login(identifier.trim(), password)) === 'mfa_required')
        return setNeedsCode(true);
      navigate(from, { replace: true });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card
      title={t('signIn.title')}
      headingLevel={1}
      style={{ maxWidth: '28rem', margin: '0 auto' }}
    >
      <form onSubmit={submit} noValidate>
        {needsCode ? (
          <TextField
            label={t('signIn.code')}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            autoComplete="one-time-code"
            inputMode="numeric"
            required
          />
        ) : (
          <>
            <TextField
              label={t('signIn.identifier')}
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              autoComplete="username"
              required
            />
            <PasswordField
              label={t('signIn.password')}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </>
        )}
        {error && <Alert tone="danger">{error}</Alert>}
        <Button
          type="submit"
          variant="primary"
          block
          loading={busy}
          style={{ marginTop: 'var(--ds-space-3)' }}
        >
          {needsCode ? t('signIn.verify') : t('signIn.submit')}
        </Button>
      </form>
      {!needsCode && (
        <>
          <SocialButtons next={from} />
          <p className="auth-footnote">
            {t('signIn.noAccount')} <Link to="/farms/register">{t('signIn.register')}</Link>
          </p>
        </>
      )}
    </Card>
  );
}
