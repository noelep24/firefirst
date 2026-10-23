import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { focusManager, onlineManager, QueryClient } from '@tanstack/react-query';
import { AppState, Platform } from 'react-native';

import { ApiError } from '@/api/client';
import { SCHEMA_VERSION } from '@/api/schema-version';

const DAY = 24 * 60 * 60 * 1000;

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      // Keep data around long enough to be saved for offline use.
      gcTime: DAY,
      // Don't retry requests the server rejected (4xx); do retry flaky connections.
      retry: (count, error) => !(error instanceof ApiError && error.status >= 400 && error.status < 500) && count < 2,
    },
    mutations: {
      // Run writes even when offline: `submit` queues them in the outbox instead of failing.
      networkMode: 'always',
    },
  },
});

/** Saves the query cache on the phone so screens open with the last-known data when there's no signal. */
export const persister = createAsyncStoragePersister({ storage: AsyncStorage, key: 'ff.query-cache.v1' });
// Saved data is only reused by an app built against the same API: when the API changes, it's dropped and refetched.
export const persistOptions = { persister, maxAge: DAY, buster: SCHEMA_VERSION };

export async function clearCache() {
  queryClient.clear();
  await persister.removeClient();
}

onlineManager.setEventListener((setOnline) =>
  NetInfo.addEventListener((state) => setOnline(state.isConnected !== false)),
);

// Refetch stale data when the app comes back to the foreground.
if (Platform.OS !== 'web') {
  focusManager.setEventListener((handleFocus) => {
    const subscription = AppState.addEventListener('change', (state) => handleFocus(state === 'active'));
    return () => subscription.remove();
  });
}
