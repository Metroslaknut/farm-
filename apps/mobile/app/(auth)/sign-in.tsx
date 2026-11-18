import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { useAuth } from '@/auth/AuthProvider';
import { toViewError } from '@/api/errors';
import { SocialSignIn } from '@/components/auth/SocialSignIn';
import { Button, LanguageSwitch, Screen, Text, TextField } from '@/components/ui';
import { useT } from '@/i18n';
import { safeRedirect } from '@/lib/deep-links';
import { errorText } from '@/lib/messages';
import { parseIdentifier } from '@/lib/phone';
import { theme } from '@/theme';

export default function SignInScreen() {
  const { signIn, verifyMfa } = useAuth();
  const router = useRouter();
  const t = useT('auth');
  const { redirect, notice, mfa } = useLocalSearchParams<{
    redirect?: string;
    /** A notice to show by code (`verify_email`), so it is in the reader's language. */
    notice?: string;
    /** Set when a social sign-in needs the authenticator code (the MFA token is held by AuthProvider). */
    mfa?: string;
  }>();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [needsCode, setNeedsCode] = useState(mfa === '1');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const submit = async () => {
    setBusy(true);
    setError(undefined);
    try {
      if (needsCode) await verifyMfa(code.trim());
      // Phones are stored in E.164: accept 0812345678 as well as +66812345678.
      else if (
        (await signIn(parseIdentifier(identifier)?.value ?? identifier.trim(), password)) ===
        'mfa_required'
      )
        return setNeedsCode(true);
      router.replace(safeRedirect(redirect) as '/');
    } catch (e) {
      setError(toViewError(e).kind === 'offline' ? toViewError(e).message : errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <LanguageSwitch />
      {notice === 'verify_email' ? (
        <Text color={theme.colors.success.fg}>{t('signIn.verifyEmailNotice')}</Text>
      ) : null}
      {needsCode ? (
        <TextField
          label={t('signIn.code')}
          value={code}
          onChangeText={setCode}
          keyboardType="number-pad"
          autoComplete="one-time-code"
          error={error}
        />
      ) : (
        <>
          <TextField
            label={t('signIn.identifier')}
            value={identifier}
            onChangeText={setIdentifier}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            autoComplete="username"
          />
          <TextField
            label={t('signIn.password')}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete="current-password"
            textContentType="password"
            error={error}
          />
        </>
      )}
      <Button
        title={needsCode ? t('signIn.verify') : t('signIn.submit')}
        loading={busy}
        disabled={needsCode ? !code : !identifier || !password}
        onPress={submit}
      />
      {!needsCode && (
        <SocialSignIn
          disabled={busy}
          onAuthenticated={() => router.replace(safeRedirect(redirect) as '/')}
          onMfaRequired={() => {
            setError(undefined);
            setNeedsCode(true);
          }}
        />
      )}
      {!needsCode && (
        <Button
          title={t('signIn.createAccount')}
          variant="ghost"
          onPress={() => router.replace('/register')}
        />
      )}
    </Screen>
  );
}
