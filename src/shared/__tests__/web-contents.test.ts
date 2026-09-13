import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import type { WebContents } from 'electron';
import {
  safeSendToWebContents,
  sendWhenWebContentsReady,
} from '../../../electron/windows/web-contents';

function fakeWebContents(options: { destroyed?: boolean; loading?: boolean } = {}) {
  const emitter = new EventEmitter() as EventEmitter & {
    destroyed: boolean;
    loading: boolean;
    sent: Array<[string, unknown]>;
    isDestroyed: () => boolean;
    isLoadingMainFrame: () => boolean;
    send: (channel: string, payload: unknown) => void;
  };
  emitter.destroyed = options.destroyed ?? false;
  emitter.loading = options.loading ?? false;
  emitter.sent = [];
  emitter.isDestroyed = () => emitter.destroyed;
  emitter.isLoadingMainFrame = () => emitter.loading;
  emitter.send = (channel, payload) => emitter.sent.push([channel, payload]);
  return emitter;
}

describe('safe renderer delivery', () => {
  it('does not send to destroyed contents', () => {
    const contents = fakeWebContents({ destroyed: true });
    expect(safeSendToWebContents(contents as unknown as WebContents, 'event', 1)).toBe(false);
    expect(contents.sent).toEqual([]);
  });

  it('queues one send until loading finishes and removes lifecycle listeners', () => {
    const contents = fakeWebContents({ loading: true });
    sendWhenWebContentsReady(contents as unknown as WebContents, 'event', { ok: true });

    expect(contents.sent).toEqual([]);
    expect(contents.listenerCount('did-finish-load')).toBe(1);
    expect(contents.listenerCount('destroyed')).toBe(1);
    contents.emit('did-finish-load');
    contents.emit('did-finish-load');

    expect(contents.sent).toEqual([['event', { ok: true }]]);
    expect(contents.listenerCount('did-finish-load')).toBe(0);
    expect(contents.listenerCount('destroyed')).toBe(0);
  });

  it('supports cancellation and contains synchronous send failures', () => {
    const loading = fakeWebContents({ loading: true });
    const cancel = sendWhenWebContentsReady(loading as unknown as WebContents, 'event');
    cancel();
    loading.emit('did-finish-load');
    expect(loading.sent).toEqual([]);

    const ready = fakeWebContents();
    ready.send = vi.fn(() => {
      throw new Error('renderer disappeared');
    });
    expect(safeSendToWebContents(ready as unknown as WebContents, 'event')).toBe(false);
  });
});
