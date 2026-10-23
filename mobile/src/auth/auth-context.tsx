import { useQueryClient } from '@tanstack/react-query';
import { createContext, type ReactNode, use, useEffect, useState } from 'react';

import * as client from '@/api/client';
import { api, type Schemas, unwrap } from '@/api/client';

type AuthState =
  { status: 'loading' } | { status: 'signedOut' } | { status: 'signedIn'; me: Schemas['Me']; isOfficer: boolean };

type AuthContextValue = AuthState & {
  signIn: (server: string, username: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function signedIn(me: Schemas['Me']): AuthState {
  return { status: 'signedIn', me, isOfficer: me.role === 'admin' || me.role === 'officer' };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading' });
  const queryClient = useQueryClient();

  useEffect(() => {
    client.setSessionExpiredHandler(() => {
      queryClient.clear();
      setState({ status: 'signedOut' });
    });
    (async () => {
      if (!(await client.restoreSession())) {
        setState({ status: 'signedOut' });
        return;
      }
      try {
        setState(signedIn(await unwrap(api().GET('/api/v1/me/'))));
      } catch (e) {
        // A rejected session is cleared. If the server just couldn't be reached, keep the saved
        // tokens so the next launch can resume, and show login in the meantime.
        setState({ status: 'signedOut' });
        if (e instanceof client.ApiError && e.status !== 0) await client.signOut();
      }
    })();
  }, [queryClient]);

  const value: AuthContextValue = {
    ...state,
    async signIn(server, username, password) {
      await client.signIn(server, username, password);
      const me = await unwrap(api().GET('/api/v1/me/'));
      if (!me.department) {
        await client.signOut();
        throw new client.ApiError('This account is not part of a department.', 403);
      }
      setState(signedIn(me));
    },
    async signOut() {
      await client.signOut();
      queryClient.clear();
      setState({ status: 'signedOut' });
    },
  };

  return <AuthContext value={value}>{children}</AuthContext>;
}

export function useAuth() {
  const value = use(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider');
  return value;
}

/** The signed-in member. Only call from screens behind the auth guard. */
export function useMe() {
  const auth = useAuth();
  if (auth.status !== 'signedIn') throw new Error('useMe called while signed out');
  return auth;
}
