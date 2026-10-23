import NetInfo from '@react-native-community/netinfo';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';

import { outbox, useOutbox } from './outbox';

const RETRY_EVERY_MS = 30_000;

/** Sends queued writes when the connection comes back, when the app is opened, and periodically while any wait. */
export function OutboxSync({ userId }: { userId: number }) {
  const queryClient = useQueryClient();
  const pending = useOutbox(userId).filter((i) => !i.failed).length;
  const previous = useRef(pending);

  useEffect(() => {
    const flush = () => outbox.flush(userId);
    flush();
    const net = NetInfo.addEventListener((state) => {
      if (state.isConnected) flush();
    });
    const app = AppState.addEventListener('change', (state) => state === 'active' && flush());
    return () => {
      net();
      app.remove();
    };
  }, [userId]);

  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(() => outbox.flush(userId), RETRY_EVERY_MS);
    return () => clearInterval(timer);
  }, [pending, userId]);

  // When queued items go through, refresh the screens that show them.
  useEffect(() => {
    if (pending < previous.current) queryClient.invalidateQueries();
    previous.current = pending;
  }, [pending, queryClient]);

  return null;
}
