import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { AndroidImportance } from 'expo-notifications';
import { router } from 'expo-router';
import { Platform } from 'react-native';

import { api } from '@/api/client';

// Show notifications that arrive while the app is open, too.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

/**
 * Ask to send notifications (once; the phone remembers the answer) and tell the server where to send them.
 * Never throws: without push, members still see offers on the Today screen. (Web uses push.web.ts.)
 */
export async function registerForPush() {
  if (!Device.isDevice) return;
  try {
    let { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') status = (await Notifications.requestPermissionsAsync()).status;
    if (status !== 'granted') return;
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'FireFirst',
        importance: AndroidImportance.HIGH,
      });
    }
    const projectId = Constants.expoConfig?.extra?.eas?.projectId;
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    await api().POST('/api/v1/push-devices/', { body: { token, platform: Platform.OS } });
  } catch (error) {
    console.warn('Push notifications unavailable:', error);
  }
}

/** Opening a notification takes you to what it's about. */
export function listenForNotificationTaps() {
  const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
    const link = response.notification.request.content.data?.link;
    if (typeof link === 'string' && link.startsWith('/schedule')) router.push('/(tabs)');
  });
  return () => subscription.remove();
}
