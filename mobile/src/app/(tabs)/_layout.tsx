import { useEffect } from 'react';

import AppTabs from '@/components/app-tabs';
import { listenForNotificationTaps, registerForPush } from '@/lib/push';

export default function TabLayout() {
  // Signed in: make sure this phone gets overtime offers and other notifications.
  useEffect(() => {
    registerForPush();
    return listenForNotificationTaps();
  }, []);
  return <AppTabs />;
}
