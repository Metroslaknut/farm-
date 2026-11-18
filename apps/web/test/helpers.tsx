import type { ReactElement } from 'react';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthContext, withHelpers, type AuthState } from '../src/auth/AuthContext';

const noop = async () => undefined;

/** Render with a fake signed-in session holding exactly `permissions`. */
export function renderAs(
  ui: ReactElement,
  options: {
    permissions?: string[];
    status?: AuthState['status'];
    route?: string;
    mfaRequired?: boolean;
  } = {},
) {
  const state: AuthState = {
    status: options.status ?? 'authenticated',
    permissions: options.permissions ?? [],
    mfaRequired: options.mfaRequired ?? false,
    ...(options.status === 'anonymous'
      ? {}
      : {
          user: {
            id: 'u1',
            displayName: 'Tester',
            status: 'active' as const,
            emailVerified: true,
            phoneVerified: false,
            mfaEnabled: true,
            roles: ['admin'],
            createdAt: '2026-01-01T00:00:00.000Z',
          },
        }),
  };
  const value = withHelpers(state, {
    login: async () => 'authenticated',
    completeSignIn: async () => 'authenticated',
    verifyMfa: noop,
    logout: noop,
    reload: noop,
  });
  return render(
    <AuthContext.Provider value={value}>
      <MemoryRouter initialEntries={[options.route ?? '/admin']}>{ui}</MemoryRouter>
    </AuthContext.Provider>,
  );
}
