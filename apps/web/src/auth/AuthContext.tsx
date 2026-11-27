import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { AuthTokens, LoginResponse, PublicUser } from '@farmplus/shared-types';
import { api, publicApi, refreshSession } from '../api';
import { answerOtherTabs, requestSessionFromOtherTab, setSignedInHint } from './tabHandoff';
import { tokenStore } from './tokens';

export interface AuthState {
  status: 'loading' | 'anonymous' | 'authenticated';
  user?: PublicUser;
  permissions: string[];
  /** True when admin permissions are being withheld until the session is MFA-verified. */
  mfaRequired: boolean;
}

export interface AuthContextValue extends AuthState {
  login(identifier: string, password: string): Promise<'authenticated' | 'mfa_required'>;
  /**
   * Finish a sign-in from any source that returns a login response (password login, social sign-in exchange): stores
   * the tokens, or keeps the MFA challenge for `verifyMfa`.
   */
  completeSignIn(response: LoginResponse): Promise<'authenticated' | 'mfa_required'>;
  verifyMfa(code: string): Promise<void>;
  logout(): Promise<void>;
  reload(): Promise<void>;
  can(permission: string): boolean;
  canAny(permissions: readonly string[]): boolean;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

// Pending MFA challenge (short-lived, memory only). Module-level: it never needs to trigger a render.
let pendingMfaToken: string | null = null;

const ANONYMOUS: AuthState = { status: 'anonymous', permissions: [], mfaRequired: false };

/** Build the permission helpers from state; also used by tests to supply a fake session. */
export function withHelpers(
  state: AuthState,
  actions: Omit<AuthContextValue, keyof AuthState | 'can' | 'canAny'>,
): AuthContextValue {
  const set = new Set(state.permissions);
  return {
    ...state,
    ...actions,
    can: (permission) => set.has(permission),
    canAny: (permissions) => permissions.some((p) => set.has(p)),
  };
}

/** A new tab with no session of its own: take one from another signed-in tab, if there is one. */
async function fromOtherTab(): Promise<boolean> {
  const tokens = await requestSessionFromOtherTab();
  if (!tokens) return false;
  tokenStore.set(tokens);
  return true;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    status: 'loading',
    permissions: [],
    mfaRequired: false,
  });

  const load = useCallback(async () => {
    const me = await api.getMyAccess();
    setState({
      status: 'authenticated',
      user: me.user,
      permissions: me.permissions,
      mfaRequired: me.mfaRequired,
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Page reload: the access token is gone, the refresh token may still be in this tab. A new tab has none: it asks
      // an open, signed-in tab for a session of its own (tabHandoff.ts).
      const restored = tokenStore.getRefresh() ? await refreshSession() : await fromOtherTab();
      if (cancelled) return;
      if (!restored) return setState(ANONYMOUS);
      try {
        await load();
      } catch {
        if (!cancelled) setState(ANONYMOUS);
      }
    })();
    const off = tokenStore.onSessionLost(() => setState(ANONYMOUS));
    return () => {
      cancelled = true;
      off();
    };
  }, [load]);

  // While signed in, answer new tabs of this browser that ask for a session.
  useEffect(() => {
    if (state.status !== 'authenticated') return;
    setSignedInHint(true);
    return answerOtherTabs(
      async () =>
        (await api.request<{ tokens: AuthTokens }>('POST', '/auth/session/handoff')).tokens,
    );
  }, [state.status]);

  const actions = useMemo(() => {
    const completeSignIn = async (res: LoginResponse) => {
      if (res.status === 'mfa_required') {
        pendingMfaToken = res.mfaToken;
        return 'mfa_required' as const;
      }
      tokenStore.set(res.tokens);
      await load();
      return 'authenticated' as const;
    };
    return {
      async login(identifier: string, password: string) {
        return completeSignIn(await publicApi.login({ identifier, password }));
      },
      completeSignIn,
      async verifyMfa(code: string) {
        if (!pendingMfaToken) throw new Error('Sign in again to continue');
        const res = await publicApi.verifyMfa(pendingMfaToken, code);
        pendingMfaToken = null;
        tokenStore.set(res.tokens);
        await load();
      },
      async logout() {
        try {
          await api.logout();
        } catch {
          /* the session may already be gone: still clear locally */
        }
        tokenStore.clear();
        setSignedInHint(false);
        setState(ANONYMOUS);
      },
      reload: load,
    };
  }, [load]);

  const value = useMemo(() => withHelpers(state, actions), [state, actions]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
