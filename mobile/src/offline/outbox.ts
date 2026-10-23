import AsyncStorage from '@react-native-async-storage/async-storage';
import { randomUUID } from 'expo-crypto';
import { useSyncExternalStore } from 'react';

import { api, ApiError, errorMessage } from '@/api/client';

import { Outbox, type OutboxItem, type OutboxStore, type SendResult } from './outbox-core';

const STORAGE_KEY = 'ff.outbox.v1';

const store: OutboxStore = {
  async load() {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as OutboxItem[]) : [];
  },
  save: (items) => AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(items)),
};

/** Statuses worth retrying later rather than asking the member to fix something. */
const RETRYABLE = new Set([401, 408, 409, 425, 429, 500, 502, 503, 504]);

async function post(path: string, body: unknown, key: string) {
  // The path comes from our own code; openapi-fetch's per-path typing doesn't apply to a queued request.
  const client = api() as unknown as {
    POST: (path: string, init: object) => Promise<{ data?: unknown; error?: unknown; response: Response }>;
  };
  return client.POST(path, { body, headers: { 'Idempotency-Key': key } });
}

async function send(item: OutboxItem): Promise<SendResult> {
  const { error, response } = await post(item.path, item.body, item.id);
  if (response.ok) return { status: 'ok' };
  const message = errorMessage(error) || `Server error ${response.status}`;
  return RETRYABLE.has(response.status) ? { status: 'retry', error: message } : { status: 'rejected', error: message };
}

export const outbox = new Outbox(store, send);

export function useOutbox(userId: number) {
  const items = useSyncExternalStore(
    (listener) => outbox.subscribe(listener),
    () => outbox.snapshot(),
  );
  return items.filter((i) => i.userId === userId);
}

export type Submitted<T> = { queued: false; data: T } | { queued: true };

/**
 * Send a write now if we can; if there's no connection, keep it in the
 * outbox to send later. Validation errors are thrown as usual so the member
 * can fix them on the spot.
 */
export async function submit<T>(path: string, body: unknown, label: string, userId: number): Promise<Submitted<T>> {
  const id = randomUUID();
  let result;
  try {
    result = await post(path, body, id);
  } catch {
    await outbox.add({ id, userId, path, body, label });
    return { queued: true };
  }
  if (result.response.ok) {
    outbox.flush(userId); // We're online: send anything left from earlier.
    return { queued: false, data: result.data as T };
  }
  if (RETRYABLE.has(result.response.status) && result.response.status !== 401) {
    await outbox.add({ id, userId, path, body, label });
    return { queued: true };
  }
  throw new ApiError(errorMessage(result.error), result.response.status);
}
