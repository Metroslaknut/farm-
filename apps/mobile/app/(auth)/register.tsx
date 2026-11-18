import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { useAuth } from '@/auth/AuthProvider';
import {
  identifierError,
  registerAccount,
  verifyPhoneAndSignIn,
  type RegisterStep,
} from '@/auth/register-flow';
import { SocialSignIn } from '@/components/auth/SocialSignIn';
import { Button, Screen, Text, TextField } from '@/components/ui';
import { useT } from '@/i18n';
import { errorText } from '@/lib/messages';
import { theme } from '@/theme';

const RESEND_COOLDOWN_S = 30;

/**
 * Create an account with an email OR a phone number. If the API requires verification before the first sign-in:
 *   phone → enter the 6-digit SMS code here, then we sign in with the password still in memory;
 *   email → "check your inbox" (the link opens on the web), with resend, then back to sign-in.
 */
export default function RegisterScreen() {
  const { register, signIn, verifyPhone, resendVerification } = useAuth();
  const router = useRouter();
  const t = useT('auth');
  const [displayName, setDisplayName] = useState('');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<RegisterStep | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    try {
      await work();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const toMfa = () => router.replace({ pathname: '/sign-in', params: { mfa: '1' } });

  const submit = () =>
    run(async () => {
      const next = await registerAccount(
        { displayName, identifier, password },
        { register, signIn },
      );
      if (next.step === 'done') return router.replace('/');
      if (next.step === 'mfa_required') return toMfa();
      setStep(next);
      setCooldown(RESEND_COOLDOWN_S); // a code / link was just sent with the registration
    });

  const confirm = (phone: string) =>
    run(async () => {
      const result = await verifyPhoneAndSignIn({ phone, code, password }, { verifyPhone, signIn });
      if (result === 'mfa_required') return toMfa();
      setPassword(''); // no longer needed in memory
      router.replace('/');
    });

  const resend = (target: string) =>
    run(async () => {
      await resendVerification(target);
      setCooldown(RESEND_COOLDOWN_S);
      setNotice(
        step?.step === 'verify_phone'
          ? t('register.verifyPhone.sent')
          : t('register.verifyEmail.sent'),
      );
    });

  const resendTitle = (label: string) =>
    cooldown > 0 ? t('register.cooldown', { label, seconds: cooldown }) : label;

  if (step?.step === 'verify_phone') {
    return (
      <Screen>
        <Text variant="heading">{t('register.verifyPhone.title')}</Text>
        <Text muted>{t('register.verifyPhone.body', { phone: step.phone })}</Text>
        {notice ? <Text color={theme.colors.success.fg}>{notice}</Text> : null}
        <TextField
          label={t('register.verifyPhone.code')}
          value={code}
          onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))}
          keyboardType="number-pad"
          autoComplete="one-time-code"
          textContentType="oneTimeCode"
          maxLength={6}
          error={error}
        />
        <Button
          title={t('register.verifyPhone.submit')}
          loading={busy}
          disabled={code.length !== 6}
          onPress={() => void confirm(step.phone)}
        />
        <Button
          title={resendTitle(t('register.verifyPhone.resend'))}
          variant="secondary"
          disabled={busy || cooldown > 0}
          onPress={() => void resend(step.phone)}
        />
        <Button
          title={t('register.verifyPhone.otherNumber')}
          variant="ghost"
          disabled={busy}
          onPress={() => {
            setStep(null);
            setCode('');
            setError(undefined);
          }}
        />
      </Screen>
    );
  }

  if (step?.step === 'verify_email') {
    return (
      <Screen>
        <Text variant="heading">{t('register.verifyEmail.title')}</Text>
        <Text muted>{t('register.verifyEmail.body', { email: step.email })}</Text>
        {notice ? <Text color={theme.colors.success.fg}>{notice}</Text> : null}
        {error ? <Text color={theme.colors.error.fg}>{`⚠ ${error}`}</Text> : null}
        <Button
          title={t('register.verifyEmail.back')}
          onPress={() =>
            router.replace({
              pathname: '/sign-in',
              params: { notice: 'verify_email' },
            })
          }
        />
        <Button
          title={resendTitle(t('register.verifyEmail.resend'))}
          variant="secondary"
          loading={busy}
          disabled={cooldown > 0}
          onPress={() => void resend(step.email)}
        />
      </Screen>
    );
  }

  const idProblem = identifierError(identifier);
  return (
    <Screen>
      <TextField
        label={t('register.name')}
        value={displayName}
        onChangeText={setDisplayName}
        autoComplete="name"
      />
      <TextField
        label={t('register.identifier')}
        hint={t('register.identifierHint')}
        value={identifier}
        onChangeText={setIdentifier}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        autoComplete="email"
        error={identifier.length > 3 ? idProblem : undefined}
      />
      <TextField
        label={t('register.password')}
        hint={t('register.passwordHint')}
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoComplete="new-password"
        textContentType="newPassword"
        error={error}
      />
      <Button
        title={t('register.submit')}
        loading={busy}
        disabled={!displayName.trim() || !identifier || !!idProblem || password.length < 10}
        onPress={() => void submit()}
      />
      <SocialSignIn
        disabled={busy}
        onAuthenticated={() => router.replace('/')}
        onMfaRequired={toMfa}
      />
      <Button
        title={t('register.haveAccount')}
        variant="ghost"
        onPress={() => router.replace('/sign-in')}
      />
    </Screen>
  );
}
