import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { publicApi } from '../../api';
import { useAuth } from '../../auth/AuthContext';
import { Icon, type IconName } from '../../components/layout/Icon';
import { Alert, Button, PasswordField, TextField } from '../../components/ui';
import { SocialButtons } from './auth/SocialButtons';
import { useT } from '../../i18n';
import { authError, errorCode, normalizeThaiPhone, withElement } from './auth/messages';
import './auth/auth.css';

type Method = 'email' | 'phone';
type Step = 'form' | 'phone' | 'email';
type Errors = Partial<Record<'displayName' | 'email' | 'phone' | 'password' | 'confirm', string>>;

/** Benefit cards beside the form; texts come from the `auth` catalog (`register.benefit.<key>.title|text`). */
const BENEFITS: { icon: IconName; key: 'farm' | 'trade' | 'community' | 'secure' }[] = [
  { icon: 'cow', key: 'farm' },
  { icon: 'store', key: 'trade' },
  { icon: 'users', key: 'community' },
  { icon: 'shield', key: 'secure' },
];

const MIN_PASSWORD = 10;

/** Self-service registration: email or phone, then verification when the API requires it. */
export default function RegisterPage() {
  const { status, login } = useAuth();
  const t = useT('auth');
  const navigate = useNavigate();
  const [method, setMethod] = useState<Method>('email');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [phoneInput, setPhoneInput] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [step, setStep] = useState<Step>('form');
  /** The identifier actually registered (normalised email or E.164 phone). */
  const [identifier, setIdentifier] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [exists, setExists] = useState(false);

  // Signed in (also right after a successful registration): straight to the farms.
  if (status === 'authenticated') return <Navigate to="/farms" replace />;

  const validate = (): { email?: string; phone?: string } | null => {
    const next: Errors = {};
    let id: { email?: string; phone?: string } = {};
    if (!displayName.trim()) next.displayName = t('register.errDisplayName');
    if (method === 'email') {
      const value = email.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) next.email = t('register.errEmail');
      else id = { email: value };
    } else {
      const value = normalizeThaiPhone(phoneInput);
      if (!value) next.phone = t('register.errPhone');
      else id = { phone: value };
    }
    if (password.length < MIN_PASSWORD)
      next.password = t('register.errPasswordShort', { min: MIN_PASSWORD });
    else if (confirm !== password) next.confirm = t('register.errConfirm');
    setErrors(next);
    return Object.keys(next).length === 0 ? id : null;
  };

  /** Sign in with the credentials still in memory; returns false when the account still needs verifying. */
  const signIn = async (id: string): Promise<boolean> => {
    try {
      const result = await login(id, password);
      if (result === 'mfa_required')
        navigate('/farms/sign-in', { replace: true, state: { mfa: true, from: '/farms' } });
      else navigate('/farms', { replace: true });
      return true;
    } catch (e) {
      if (errorCode(e) === 'ACCOUNT_NOT_VERIFIED') return false;
      throw e;
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(undefined);
    setExists(false);
    const id = validate();
    if (!id) return;
    setBusy(true);
    try {
      await publicApi.register({ displayName: displayName.trim(), password, ...id });
      const registered = id.email ?? id.phone!;
      setIdentifier(registered);
      if (!(await signIn(registered))) setStep(id.phone ? 'phone' : 'email');
    } catch (e) {
      if (errorCode(e) === 'ACCOUNT_EXISTS') {
        setExists(true);
        setError(method === 'email' ? t('register.emailExists') : t('register.phoneExists'));
      } else setError(authError(e, t));
    } finally {
      setBusy(false);
    }
  };

  const verifyPhone = async (event: FormEvent) => {
    event.preventDefault();
    setError(undefined);
    setNotice(undefined);
    const value = code.trim();
    if (!/^\d{6}$/.test(value)) return setError(t('verifyPhone.errCode'));
    setBusy(true);
    try {
      await publicApi.request('POST', '/auth/verify/phone', {
        body: { phone: identifier, code: value },
      });
      if (!(await signIn(identifier))) setError(t('verifyPhone.notYet'));
    } catch (e) {
      setError(authError(e, t));
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    setError(undefined);
    setNotice(undefined);
    setResending(true);
    try {
      await publicApi.request('POST', '/auth/verify/resend', { body: { identifier } });
      setNotice(step === 'phone' ? t('verifyPhone.resent') : t('checkEmail.resent'));
    } catch (e) {
      setError(authError(e, t));
    } finally {
      setResending(false);
    }
  };

  const messages = (
    <>
      {error && (
        <Alert tone="danger">
          {error}
          {exists && (
            <>
              {' '}
              <Link to="/farms/sign-in" className="auth-link">
                {t('register.signIn')}
              </Link>
            </>
          )}
        </Alert>
      )}
      {notice && <Alert tone="success">{notice}</Alert>}
    </>
  );

  if (step === 'phone') {
    return (
      <div className="auth-page auth-page--narrow">
        <section className="auth-card" aria-labelledby="verify-phone-title">
          <span className="auth-card__icon">
            <Icon name="phone" size={26} />
          </span>
          <h1 id="verify-phone-title">{t('verifyPhone.title')}</h1>
          <p className="auth-card__lead">
            {withElement(t('verifyPhone.lead'), 'phone', <strong>{identifier}</strong>)}
          </p>
          <form onSubmit={verifyPhone} noValidate>
            <TextField
              label={t('verifyPhone.code')}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              autoComplete="one-time-code"
              inputMode="numeric"
              maxLength={6}
              className="auth-code"
              required
            />
            {messages}
            <div className="auth-actions">
              <Button type="submit" variant="primary" block loading={busy}>
                {t('verifyPhone.submit')}
              </Button>
            </div>
          </form>
          <p className="auth-footnote">
            {t('verifyPhone.noCode')}{' '}
            <button
              type="button"
              className="auth-linkbtn"
              onClick={() => void resend()}
              disabled={resending}
            >
              {t('verifyPhone.resend')}
            </button>
          </p>
        </section>
      </div>
    );
  }

  if (step === 'email') {
    return (
      <div className="auth-page auth-page--narrow">
        <section className="auth-card" aria-labelledby="verify-email-title">
          <span className="auth-card__icon">
            <Icon name="mail" size={26} />
          </span>
          <h1 id="verify-email-title">{t('checkEmail.title')}</h1>
          <p className="auth-card__lead">
            {withElement(t('checkEmail.lead'), 'email', <strong>{identifier}</strong>)}
          </p>
          {messages}
          <div className="auth-actions">
            <Button block onClick={() => void resend()} loading={resending}>
              {t('checkEmail.resend')}
            </Button>
          </div>
          <p className="auth-footnote">
            {t('checkEmail.verified')} <Link to="/farms/sign-in">{t('checkEmail.signIn')}</Link>
          </p>
        </section>
      </div>
    );
  }

  return (
    <div className="auth-page">
      <section className="auth-card" aria-labelledby="register-title">
        <h1 id="register-title">{t('register.title')}</h1>
        <p className="auth-card__lead">{t('register.lead')}</p>
        <form onSubmit={submit} noValidate>
          <fieldset className="auth-switch">
            <legend>{t('register.method')}</legend>
            {(
              [
                ['email', t('register.methodEmail'), 'mail'],
                ['phone', t('register.methodPhone'), 'phone'],
              ] as const
            ).map(([value, label, icon]) => (
              <label key={value}>
                <input
                  type="radio"
                  name="method"
                  value={value}
                  checked={method === value}
                  onChange={() => {
                    setMethod(value);
                    setErrors({});
                  }}
                />
                <Icon name={icon} size={18} />
                {label}
              </label>
            ))}
          </fieldset>
          <TextField
            label={t('register.displayName')}
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            autoComplete="name"
            maxLength={80}
            error={errors.displayName}
            required
          />
          {method === 'email' ? (
            <TextField
              label={t('register.email')}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              error={errors.email}
              required
            />
          ) : (
            <TextField
              label={t('register.phone')}
              type="tel"
              value={phoneInput}
              onChange={(e) => setPhoneInput(e.target.value)}
              autoComplete="tel"
              inputMode="tel"
              hint={t('register.phoneHint')}
              error={errors.phone}
              required
            />
          )}
          <PasswordField
            label={t('register.password')}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            hint={t('register.passwordHint', { min: MIN_PASSWORD })}
            error={errors.password}
            required
          />
          <PasswordField
            label={t('register.confirm')}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
            error={errors.confirm}
            required
          />
          {messages}
          <div className="auth-actions">
            <Button type="submit" variant="primary" block loading={busy}>
              {t('register.submit')}
            </Button>
          </div>
        </form>
        <SocialButtons next="/farms" />
        <p className="auth-footnote">
          {t('register.haveAccount')} <Link to="/farms/sign-in">{t('register.signIn')}</Link>
        </p>
      </section>
      <aside className="auth-panel" aria-labelledby="register-benefits">
        <h2 id="register-benefits">{t('register.panelTitle')}</h2>
        <p>{t('register.panelText')}</p>
        <ul>
          {BENEFITS.map((b) => (
            <li key={b.key}>
              <span>
                <Icon name={b.icon} size={20} />
              </span>
              <span>
                <strong>{t(`register.benefit.${b.key}.title`)}</strong>
                <small>{t(`register.benefit.${b.key}.text`)}</small>
              </span>
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}
