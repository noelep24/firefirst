import createClient, { type Middleware } from 'openapi-fetch';
import { Platform } from 'react-native';

import { storage } from '@/lib/storage';

import type { components, paths } from './schema';

export type Schemas = components['schemas'];

const KEYS = {
  server: 'ff.server',
  access: 'ff.access',
  refresh: 'ff.refresh',
  defaultServer: 'ff.defaultServer',
} as const;

/** How long sign-in waits for the server. Firewalls often drop requests silently rather than refuse them. */
const SIGN_IN_TIMEOUT_MS = 15_000;

/** Where the API lives when nothing else is configured. Android emulators reach the host at 10.0.2.2. */
export const DEFAULT_SERVER =
  process.env.EXPO_PUBLIC_API_URL ?? (Platform.OS === 'android' ? 'http://10.0.2.2:8000' : 'http://localhost:8000');

type Session = { server: string; access: string | null; refresh: string | null };

const session: Session = { server: DEFAULT_SERVER, access: null, refresh: null };
let onSessionExpired: () => void = () => {};

export function setSessionExpiredHandler(handler: () => void) {
  onSessionExpired = handler;
}

export function currentServer() {
  return session.server;
}

/** Load the saved server and tokens. Returns true when there is a session to resume. */
export async function restoreSession(): Promise<boolean> {
  const [server, access, refresh, savedDefault] = await Promise.all([
    storage.get(KEYS.server),
    storage.get(KEYS.access),
    storage.get(KEYS.refresh),
    storage.get(KEYS.defaultServer),
  ]);
  if (savedDefault !== DEFAULT_SERVER) {
    await storage.set(KEYS.defaultServer, DEFAULT_SERVER);
    if (server !== null && server !== DEFAULT_SERVER) {
      // This build (or trial run) points at a different server than the one saved, e.g. the
      // computer running the trial got a new Wi-Fi address. Start over on the new one.
      await Promise.all([storage.set(KEYS.server, null), saveTokens(null, null)]);
      session.server = DEFAULT_SERVER;
      return false;
    }
  }
  session.server = server ?? DEFAULT_SERVER;
  session.access = access;
  session.refresh = refresh;
  return refresh !== null;
}

async function saveTokens(access: string | null, refresh: string | null) {
  session.access = access;
  session.refresh = refresh;
  await Promise.all([storage.set(KEYS.access, access), storage.set(KEYS.refresh, refresh)]);
}

export async function signIn(server: string, username: string, password: string) {
  const base = normalizeServer(server);
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), SIGN_IN_TIMEOUT_MS);
  let result;
  try {
    result = await createClient<paths>({ baseUrl: base }).POST('/api/v1/auth/token/', {
      body: { username, password },
      signal: abort.signal,
    });
  } catch {
    throw new ApiError(
      `Can't reach ${base}. Check the server address below, and that this phone is on the same network as the server.`,
      0,
    );
  } finally {
    clearTimeout(timer);
  }
  const { data, error, response } = result;
  if (!data) {
    throw response.status === 401
      ? new ApiError('Wrong username or password.', 401)
      : new ApiError(errorMessage(error), response.status);
  }
  session.server = base;
  await storage.set(KEYS.server, base);
  await saveTokens(data.access, data.refresh);
}

export async function signOut() {
  await saveTokens(null, null);
}

export function normalizeServer(server: string) {
  const trimmed = server.trim().replace(/\/+$/, '');
  return /^https?:\/\//.test(trimmed) ? trimmed : `http://${trimmed}`;
}

/** Seconds until the JWT expires (negative if expired, -Infinity if unreadable). */
function secondsLeft(token: string) {
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return payload.exp - Date.now() / 1000;
  } catch {
    return -Infinity;
  }
}

let refreshing: Promise<string | null> | null = null;

/** A valid access token, refreshing it first if it's about to expire. Concurrent callers share one refresh. */
async function accessToken(): Promise<string | null> {
  if (session.access && secondsLeft(session.access) > 60) return session.access;
  if (!session.refresh) return null;
  refreshing ??= (async () => {
    try {
      const res = await fetch(`${session.server}/api/v1/auth/token/refresh/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh: session.refresh }),
      });
      if (!res.ok) {
        // Only a rejected refresh token ends the session; network errors are thrown below.
        await saveTokens(null, null);
        onSessionExpired();
        return null;
      }
      const data: Schemas['TokenRefresh'] = await res.json();
      // The backend rotates refresh tokens, so keep the new one.
      await saveTokens(data.access, (data as { refresh?: string }).refresh ?? session.refresh);
      return data.access;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

const auth: Middleware = {
  async onRequest({ request }) {
    const token = await accessToken();
    if (token) request.headers.set('Authorization', `Bearer ${token}`);
    return request;
  },
  async onResponse({ response }) {
    if (response.status === 401 && session.refresh) {
      await saveTokens(null, null);
      onSessionExpired();
    }
    return response;
  },
};

let client: ReturnType<typeof createClient<paths>> | null = null;
let clientServer = '';

/** The typed API client for the current server. */
export function api() {
  if (!client || clientServer !== session.server) {
    client = createClient<paths>({ baseUrl: session.server });
    client.use(auth);
    clientServer = session.server;
  }
  return client;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

/** Turn a DRF error body ({detail}, {field: [msg]}, nested lists…) into one readable message. */
export function errorMessage(error: unknown): string {
  if (!error) return 'Something went wrong.';
  if (typeof error === 'string') return error;
  if (Array.isArray(error)) return error.map(errorMessage).join(' ');
  if (typeof error === 'object') {
    return Object.entries(error as Record<string, unknown>)
      .map(([field, value]) => {
        const text = errorMessage(value);
        return field === 'detail' || field === 'non_field_errors' ? text : `${humanize(field)}: ${text}`;
      })
      .join('\n');
  }
  return String(error);
}

function humanize(field: string) {
  const words = field.replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Await an openapi-fetch call and return its data, or throw an ApiError. */
export async function unwrap<T>(call: Promise<{ data?: T; error?: unknown; response: Response }>): Promise<T> {
  let result;
  try {
    result = await call;
  } catch {
    throw new ApiError(`Can't reach ${session.server}. Check your connection.`, 0);
  }
  if (result.error !== undefined || !result.response.ok) {
    throw new ApiError(errorMessage(result.error), result.response.status);
  }
  return result.data as T;
}
