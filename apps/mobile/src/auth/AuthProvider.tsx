import type { OAuthProviderId } from '@farmplus/api-client';
import type { LoginResponse, PublicUser } from '@farmplus/shared-types';
import type { RegisterInput } from '@farmplus/validation';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { api } from '@/api/client';
import { publicApi } from '@/api/public';
import { t } from '@/i18n';
import { AppError } from '@/lib/messages';
import {
  completeOAuthCallback,
  signInWithProvider,
  type OAuthCallback,
  type OAuthOutcome,
} from './oauth';
import { nativeOAuthDeps, pendingVerifier } from './oauth-native';
import { session } from './session';

export interface AuthState {
  status: 'loading' | 'anonymous' | 'authenticated';
  user: PublicUser | null;
  permissions: string[];
}

export interface AuthContextValue extends AuthState {
  signIn(identifier: string, password: string): Promise<'authenticated' | 'mfa_required'>;
  verifyMfa(code: string): Promise<void>;
  register(input: RegisterInput): Promise<void>;
  /** Confirm a phone number with the 6-digit SMS code (account must then sign in). */
  verifyPhone(phone: string, code: string): Promise<void>;
  /** Send a new verification code (phone) or link (email). */
  resendVerification(identifier: string): Promise<void>;
  /** Google / Facebook via the system auth session. MFA accounts continue with `verifyMfa`. */
  signInWithProvider(provider: OAuthProviderId): Promise<OAuthOutcome>;
  /** Finish a social sign-in that came back as a deep link (Android fallback). Null when none is pending. */
  completeOAuthRedirect(callback: OAuthCallback): Promise<OAuthOutcome | null>;
  signOut(): Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);
const ANONYMOUS: AuthState = { status: 'anonymous', user: null, permissions: [] };

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading', user: null, permissions: [] });
  const mfaToken = useRef<string | null>(null);

  const load = useCallback(async () => {
    const me = await api.getMyAccess();
    setState({ status: 'authenticated', user: me.user, permissions: me.permissions });
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // App launch: the access token is gone (memory only); the refresh token may be in the secure store.
        if (await session.restore()) await load();
        else if (!cancelled) setState(ANONYMOUS);
      } catch {
        // Offline at launch: stay signed-out in the UI but keep the stored token for the next attempt.
        if (!cancelled) setState(ANONYMOUS);
      }
    })();
    const off = session.onSessionLost(() => setState(ANONYMOUS));
    return () => {
      cancelled = true;
      off();
    };
  }, [load]);

  /** Every login path (password, Google, Facebook) ends here: tokens to the session, or remember the MFA step. */
  const completeLogin = useCallback(
    async (res: LoginResponse): Promise<'authenticated' | 'mfa_required'> => {
      if (res.status === 'mfa_required') {
        mfaToken.current = res.mfaToken;
        return 'mfa_required';
      }
      await session.setTokens(res.tokens);
      await load();
      return 'authenticated';
    },
    [load],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      ...state,
      async signIn(identifier, password) {
        return completeLogin(await publicApi.login({ identifier, password }));
      },
      signInWithProvider: (provider) =>
        signInWithProvider(provider, nativeOAuthDeps(completeLogin)),
      async completeOAuthRedirect(callback) {
        const verifier = await pendingVerifier.take();
        if (!verifier) return null;
        return completeOAuthCallback(callback, verifier, { api: publicApi, completeLogin });
      },
      async verifyPhone(phone, code) {
        await publicApi.request('POST', '/auth/verify/phone', { body: { phone, code } });
      },
      async resendVerification(identifier) {
        await publicApi.request('POST', '/auth/verify/resend', { body: { identifier } });
      },
      async verifyMfa(code) {
        if (!mfaToken.current) throw new AppError(t('auth', 'mfa.signInAgain'));
        const res = await publicApi.verifyMfa(mfaToken.current, code);
        mfaToken.current = null;
        await session.setTokens(res.tokens);
        await load();
      },
      async register(input) {
        await publicApi.register(input);
      },
      async signOut() {
        try {
          await api.logout(); // revoke server-side first so the refresh token is dead everywhere
        } catch {
          /* offline or already revoked: still clear this device */
        }
        await session.clear();
        setState(ANONYMOUS);
      },
    }),
    [state, load, completeLogin],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
