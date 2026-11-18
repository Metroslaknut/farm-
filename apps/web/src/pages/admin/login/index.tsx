import { useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../../auth/AuthContext';
import { errorMessage } from '../../../lib/format';
import '../../../components/admin/admin.css';
import { useAdminI18n } from '../../../components/admin/i18n';
import { LanguageToggle } from '../../../components/layout/LanguageToggle';
import { PasswordInput } from '../../../components/ui/PasswordInput';

export default function AdminLogin() {
  const { status, login, verifyMfa } = useAuth();
  const { t } = useAdminI18n();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? '/admin';
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [needsCode, setNeedsCode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  if (status === 'authenticated') return <Navigate to={from} replace />;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      if (needsCode) {
        await verifyMfa(code.trim());
        navigate(from, { replace: true });
      } else if ((await login(identifier.trim(), password)) === 'mfa_required') {
        setNeedsCode(true);
      } else {
        navigate(from, { replace: true });
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="adm-root">
      <main className="adm-login">
        <div className="adm-login__lang">
          <LanguageToggle />
        </div>
        <div className="adm-card">
          <h1>{t('login.title')}</h1>
          <form className="adm-form" onSubmit={submit}>
            {!needsCode ? (
              <>
                <label className="adm-field">
                  <span>{t('login.identifier')}</span>
                  <input
                    autoComplete="username"
                    value={identifier}
                    onChange={(e) => setIdentifier(e.target.value)}
                    required
                  />
                </label>
                <label className="adm-field">
                  <span>{t('login.password')}</span>
                  <PasswordInput
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                </label>
              </>
            ) : (
              <label className="adm-field">
                <span>{t('login.code')}</span>
                <input
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  required
                  autoFocus
                />
              </label>
            )}
            {error && (
              <p className="adm-error" role="alert">
                {error}
              </p>
            )}
            <button type="submit" className="adm-btn adm-btn--primary" disabled={busy}>
              {busy ? t('login.signingIn') : needsCode ? t('login.verify') : t('login.signIn')}
            </button>
          </form>
        </div>
      </main>
    </div>
  );
}
