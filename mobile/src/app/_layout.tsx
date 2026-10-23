import { focusManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';

import { ApiError } from '@/api/client';
import { AuthProvider, useAuth } from '@/auth/auth-context';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      // Don't retry requests the server rejected (4xx); do retry flaky connections.
      retry: (count, error) => !(error instanceof ApiError && error.status >= 400 && error.status < 500) && count < 2,
    },
  },
});

// Refetch stale data when the app comes back to the foreground.
if (Platform.OS !== 'web') {
  focusManager.setEventListener((handleFocus) => {
    const subscription = AppState.addEventListener('change', (state) => handleFocus(state === 'active'));
    return () => subscription.remove();
  });
}

export default function RootLayout() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <Navigation />
      </AuthProvider>
    </QueryClientProvider>
  );
}

function Navigation() {
  const auth = useAuth();
  const scheme = useColorScheme();
  const dark = scheme === 'dark';
  const base = dark ? DarkTheme : DefaultTheme;
  const theme = { ...base, colors: { ...base.colors, primary: Colors[dark ? 'dark' : 'light'].accent } };

  useEffect(() => {
    if (auth.status !== 'loading') SplashScreen.hideAsync();
  }, [auth.status]);

  if (auth.status === 'loading') return null;

  return (
    <ThemeProvider value={theme}>
      <Stack screenOptions={{ headerBackButtonDisplayMode: 'minimal' }}>
        <Stack.Protected guard={auth.status === 'signedIn'}>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="rig/[id]/index" options={{ title: 'Apparatus' }} />
          <Stack.Screen name="rig/[id]/check" options={{ title: 'Rig check' }} />
          <Stack.Screen name="work-order/new" options={{ title: 'Report a problem', presentation: 'modal' }} />
          <Stack.Screen name="work-order/[id]" options={{ title: 'Work order' }} />
          <Stack.Screen name="stock/[id]" options={{ title: 'Stock' }} />
          <Stack.Screen name="scan" options={{ title: 'Scan barcode', presentation: 'modal' }} />
          <Stack.Screen name="leave/new" options={{ title: 'Request leave', presentation: 'modal' }} />
          <Stack.Screen name="trade/new" options={{ title: 'Trade a shift', presentation: 'modal' }} />
          <Stack.Screen name="event/[id]" options={{ title: 'Event' }} />
        </Stack.Protected>
        <Stack.Protected guard={auth.status === 'signedOut'}>
          <Stack.Screen name="login" options={{ headerShown: false }} />
        </Stack.Protected>
      </Stack>
    </ThemeProvider>
  );
}
