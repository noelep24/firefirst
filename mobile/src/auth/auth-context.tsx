import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, type ReactNode, use, useEffect, useState } from 'react';

import * as client from '@/api/client';
import { api, type Schemas, unwrap } from '@/api/client';
import { clearCache } from '@/offline/query-cache';

type AuthState =
  { status: 'loading' } | { status: 'signedOut' } | { status: 'signedIn'; me: Schemas['Me']; isOfficer: boolean };

type AuthContextValue = AuthState & {
  signIn: (server: string, username: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

// The last profile we loaded, so the app can open without signal.
const ME_KEY = 'ff.me';

function signedIn(me: Schemas['Me']): AuthState {
  return { status: 'signedIn', me, isOfficer: me.role === 'admin' || me.role === 'officer' };
}

async function loadMe() {
  const me = await unwrap(api().GET('/api/v1/me/'));
  await AsyncStorage.setItem(ME_KEY, JSON.stringify(me));
  return me;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading' });

  useEffect(() => {
    client.setSessionExpiredHandler(() => {
      clearCache();
      setState({ status: 'signedOut' });
    });
    (async () => {
      if (!(await client.restoreSession())) {
        setState({ status: 'signedOut' });
        return;
      }
      try {
        setState(signedIn(await loadMe()));
      } catch (e) {
        if (e instanceof client.ApiError && e.status === 0) {
          // No signal: carry on with the saved session and the last-known profile.
          const cached = await AsyncStorage.getItem(ME_KEY);
          setState(cached ? signedIn(JSON.parse(cached)) : { status: 'signedOut' });
          return;
        }
        await client.signOut();
        setState({ status: 'signedOut' });
      }
    })();
  }, []);

  const value: AuthContextValue = {
    ...state,
    async signIn(server, username, password) {
      await client.signIn(server, username, password);
      const me = await loadMe();
      if (!me.department) {
        await client.signOut();
        throw new client.ApiError('This account is not part of a department.', 403);
      }
      setState(signedIn(me));
    },
    async signOut() {
      // Queued changes stay on the phone, tagged with their author, and are sent next time they sign in.
      await client.signOut();
      await AsyncStorage.removeItem(ME_KEY);
      await clearCache();
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
