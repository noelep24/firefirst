import { describe, expect, it } from 'vitest';

import { Outbox, type OutboxItem, type OutboxStore, type SendResult } from './outbox-core';

function memoryStore(initial: OutboxItem[] = []): OutboxStore & { saved: OutboxItem[] } {
  const store = {
    saved: initial,
    load: async () => store.saved,
    save: async (items: OutboxItem[]) => {
      store.saved = items;
    },
  };
  return store;
}

const item = (id: string, userId = 1) => ({ id, userId, path: '/api/v1/inspections/', body: { n: id }, label: id });

describe('Outbox', () => {
  it('sends queued items in order and removes them', async () => {
    const sent: string[] = [];
    const store = memoryStore();
    const outbox = new Outbox(store, async (i) => {
      sent.push(i.id);
      return { status: 'ok' };
    });
    await outbox.add(item('a'));
    await outbox.add(item('b'));
    await outbox.flush(1);
    expect(sent).toEqual(['a', 'b']);
    expect(outbox.snapshot()).toEqual([]);
    expect(store.saved).toEqual([]);
  });

  it('stops at the first retryable failure and keeps the rest queued', async () => {
    const sent: string[] = [];
    const outbox = new Outbox(memoryStore(), async (i) => {
      sent.push(i.id);
      return i.id === 'a' ? { status: 'retry', error: 'offline' } : { status: 'ok' };
    });
    await outbox.add(item('a'));
    await outbox.add(item('b'));
    await outbox.flush(1);
    expect(sent).toEqual(['a']);
    expect(outbox.snapshot().map((i) => [i.id, i.attempts, i.error])).toEqual([
      ['a', 1, 'offline'],
      ['b', 0, undefined],
    ]);
  });

  it('treats a thrown error (network) as retryable', async () => {
    const outbox = new Outbox(memoryStore(), async () => {
      throw new Error('Network request failed');
    });
    await outbox.add(item('a'));
    await outbox.flush(1);
    expect(outbox.snapshot()[0]).toMatchObject({ attempts: 1, failed: false, error: 'Network request failed' });
  });

  it('marks rejected items and moves on; retry() resends them', async () => {
    let reject = true;
    const outbox = new Outbox(memoryStore(), async (i): Promise<SendResult> =>
      i.id === 'bad' && reject ? { status: 'rejected', error: 'Describe each deficient item' } : { status: 'ok' },
    );
    await outbox.add(item('bad'));
    await outbox.add(item('good'));
    await outbox.flush(1);
    expect(outbox.snapshot()).toMatchObject([{ id: 'bad', failed: true, error: 'Describe each deficient item' }]);

    await outbox.flush(1); // rejected items aren't re-sent automatically
    expect(outbox.snapshot()).toHaveLength(1);

    reject = false;
    await outbox.retry('bad', 1);
    expect(outbox.snapshot()).toEqual([]);
  });

  it("never sends another member's items", async () => {
    const sent: number[] = [];
    const outbox = new Outbox(memoryStore(), async (i) => {
      sent.push(i.userId);
      return { status: 'ok' };
    });
    await outbox.add(item('mine', 1));
    await outbox.add(item('theirs', 2));
    await outbox.flush(1);
    expect(sent).toEqual([1]);
    expect(outbox.snapshot().map((i) => i.id)).toEqual(['theirs']);
  });

  it('survives a restart', async () => {
    const store = memoryStore();
    const first = new Outbox(store, async () => ({ status: 'retry', error: 'offline' }));
    await first.add(item('a'));
    const second = new Outbox(store, async () => ({ status: 'ok' }));
    await second.flush(1);
    expect(second.snapshot()).toEqual([]);
  });

  it('concurrent flushes send each item once', async () => {
    const sent: string[] = [];
    const outbox = new Outbox(memoryStore(), async (i) => {
      sent.push(i.id);
      await new Promise((r) => setTimeout(r, 5));
      return { status: 'ok' };
    });
    await outbox.add(item('a'));
    await Promise.all([outbox.flush(1), outbox.flush(1), outbox.flush(1)]);
    expect(sent).toEqual(['a']);
  });

  it('discard removes an item', async () => {
    const outbox = new Outbox(memoryStore(), async () => ({ status: 'ok' }));
    await outbox.add(item('a'));
    await outbox.discard('a');
    expect(outbox.snapshot()).toEqual([]);
  });
});
