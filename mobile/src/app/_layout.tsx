import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';

import { AuthProvider, useAuth } from '@/auth/auth-context';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { OutboxSync } from '@/offline/outbox-sync';
import { persistOptions, queryClient } from '@/offline/query-cache';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  return (
    <PersistQueryClientProvider client={queryClient} persistOptions={persistOptions}>
      <AuthProvider>
        <Navigation />
      </AuthProvider>
    </PersistQueryClientProvider>
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
      {auth.status === 'signedIn' ? <OutboxSync userId={auth.me.id} /> : null}
      <Stack screenOptions={{ headerBackButtonDisplayMode: 'minimal' }}>
        <Stack.Protected guard={auth.status === 'signedIn'}>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="rig/[id]/index" options={{ title: 'Apparatus' }} />
          <Stack.Screen name="rig/[id]/check" options={{ title: 'Rig check' }} />
          <Stack.Screen name="rig/[id]/move" options={{ title: 'Move rig', presentation: 'modal' }} />
          <Stack.Screen name="incidents" options={{ title: 'Incident reports' }} />
          <Stack.Screen name="incident/[id]" options={{ title: 'Incident' }} />
          <Stack.Screen name="work-order/new" options={{ title: 'Report a problem', presentation: 'modal' }} />
          <Stack.Screen name="work-order/[id]" options={{ title: 'Work order' }} />
          <Stack.Screen name="stock/[id]" options={{ title: 'Stock' }} />
          <Stack.Screen name="scan" options={{ title: 'Scan barcode', presentation: 'modal' }} />
          <Stack.Screen name="leave/new" options={{ title: 'Request leave', presentation: 'modal' }} />
          <Stack.Screen name="trade/new" options={{ title: 'Trade a shift', presentation: 'modal' }} />
          <Stack.Screen name="event/[id]" options={{ title: 'Event' }} />
          <Stack.Screen name="outbox" options={{ title: 'Waiting to sync' }} />
          <Stack.Screen name="certifications" options={{ title: 'My certifications' }} />
        </Stack.Protected>
        <Stack.Protected guard={auth.status === 'signedOut'}>
          <Stack.Screen name="login" options={{ headerShown: false }} />
        </Stack.Protected>
      </Stack>
    </ThemeProvider>
  );
}
