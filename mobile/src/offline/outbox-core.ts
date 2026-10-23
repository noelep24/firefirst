/**
 * A persistent queue of writes made while offline.
 *
 * Each item carries an idempotency key (its id) that the server uses to make
 * retries safe: a rig check that actually reached the server before the
 * connection dropped is never saved twice.
 *
 * This module has no React Native imports so it can be unit-tested; storage
 * and the network call are injected.
 */

export type OutboxItem = {
  id: string;
  /** Who queued it. Items are only ever sent with that member's credentials. */
  userId: number;
  path: string;
  body: unknown;
  /** Human description for the outbox screen, e.g. "Rig check · E1". */
  label: string;
  createdAt: string;
  attempts: number;
  /** Set when the server rejected the item; it waits for the member to retry or discard it. */
  failed?: boolean;
  error?: string;
};

/** ok: sent (or already sent). retry: try again later (offline, server busy). rejected: needs a person. */
export type SendResult = { status: 'ok' } | { status: 'retry'; error: string } | { status: 'rejected'; error: string };

export type OutboxStore = {
  load(): Promise<OutboxItem[]>;
  save(items: OutboxItem[]): Promise<void>;
};

export class Outbox {
  private items: OutboxItem[] = [];
  private listeners = new Set<() => void>();
  private flushing: Promise<void> | null = null;
  private ready: Promise<void>;

  constructor(
    private store: OutboxStore,
    private send: (item: OutboxItem) => Promise<SendResult>,
  ) {
    this.ready = store.load().then(
      (items) => {
        this.items = items;
        this.notify();
      },
      () => {
        this.items = [];
      },
    );
  }

  /** A snapshot of the queue (new array each change, for React). */
  snapshot(): readonly OutboxItem[] {
    return this.items;
  }

  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async add(item: Omit<OutboxItem, 'createdAt' | 'attempts'>) {
    await this.ready;
    this.items = [...this.items, { ...item, createdAt: new Date().toISOString(), attempts: 0 }];
    await this.persist();
  }

  async discard(id: string) {
    await this.ready;
    this.items = this.items.filter((i) => i.id !== id);
    await this.persist();
  }

  /** Clear a rejected item's error so the next flush tries it again. */
  async retry(id: string, userId: number) {
    await this.ready;
    this.items = this.items.map((i) => (i.id === id ? { ...i, failed: false, error: undefined } : i));
    await this.persist();
    await this.flush(userId);
  }

  /**
   * Send queued items for `userId`, oldest first. Stops at the first
   * retryable failure (most likely still offline); rejected items are marked
   * and skipped. Concurrent calls share one run.
   */
  flush(userId: number): Promise<void> {
    this.flushing ??= this.run(userId).finally(() => {
      this.flushing = null;
    });
    return this.flushing;
  }

  private async run(userId: number) {
    await this.ready;
    for (const item of [...this.items]) {
      if (item.userId !== userId || item.failed) continue;
      let result: SendResult;
      try {
        result = await this.send(item);
      } catch (e) {
        result = { status: 'retry', error: e instanceof Error ? e.message : String(e) };
      }
      if (result.status === 'ok') {
        this.items = this.items.filter((i) => i.id !== item.id);
      } else {
        this.items = this.items.map((i) =>
          i.id === item.id
            ? { ...i, attempts: i.attempts + 1, error: result.error, failed: result.status === 'rejected' }
            : i,
        );
      }
      await this.persist();
      if (result.status === 'retry') break;
    }
  }

  private async persist() {
    this.notify();
    await this.store.save(this.items);
  }

  private notify() {
    for (const listener of this.listeners) listener();
  }
}
