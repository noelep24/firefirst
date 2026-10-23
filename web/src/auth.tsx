import { useQueryClient } from '@tanstack/react-query';
import { createContext, type ReactNode, use, useEffect, useState } from 'react';

import { ApiError, http, type Schemas, setUnauthorizedHandler } from '@/api/http';

type Me = Schemas['Me'];

type AuthState = { status: 'loading' } | { status: 'signedOut' } | { status: 'signedIn'; me: Me };

type AuthValue = AuthState & {
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshMe: () => Promise<void>;
};

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading' });
  const queryClient = useQueryClient();

  useEffect(() => {
    setUnauthorizedHandler(() => {
      queryClient.clear();
      setState({ status: 'signedOut' });
    });
    http
      .get<Me>('/api/v1/me/')
      .then((me) => setState({ status: 'signedIn', me }))
      .catch(() => setState({ status: 'signedOut' }));
  }, [queryClient]);

  const value: AuthValue = {
    ...state,
    async login(username, password) {
      await http.get('/api/v1/auth/csrf/');
      const me = await http.post<Me>('/api/v1/auth/session/', { username, password });
      if (me.role === 'member') {
        await http.delete('/api/v1/auth/session/');
        throw new ApiError('The web app is for officers and admins. Members use the FireFirst mobile app.', 403);
      }
      setState({ status: 'signedIn', me });
    },
    async logout() {
      await http.delete('/api/v1/auth/session/').catch(() => {});
      queryClient.clear();
      setState({ status: 'signedOut' });
    },
    async refreshMe() {
      setState({ status: 'signedIn', me: await http.get<Me>('/api/v1/me/') });
    },
  };

  return <AuthContext value={value}>{children}</AuthContext>;
}

export function useAuth() {
  const value = use(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider');
  return value;
}

/** The signed-in officer or admin. Only call inside the authenticated layout. */
export function useMe() {
  const auth = useAuth();
  if (auth.status !== 'signedIn') throw new Error('useMe called while signed out');
  return { me: auth.me, isAdmin: auth.me.role === 'admin', logout: auth.logout };
}
