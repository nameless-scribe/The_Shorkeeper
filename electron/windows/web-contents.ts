import type { WebContents } from 'electron';

export function safeSendToWebContents(
  contents: WebContents,
  channel: string,
  payload?: unknown,
): boolean {
  if (contents.isDestroyed()) return false;
  try {
    contents.send(channel, payload);
    return true;
  } catch (error) {
    if (!contents.isDestroyed()) {
      console.warn(`[window] IPC 发送失败 (${channel}):`, error);
    }
    return false;
  }
}

/** Send immediately when loaded, otherwise once after the next main-frame load. */
export function sendWhenWebContentsReady(
  contents: WebContents,
  channel: string,
  payload?: unknown,
): () => void {
  if (contents.isDestroyed()) return () => undefined;
  if (!contents.isLoadingMainFrame()) {
    safeSendToWebContents(contents, channel, payload);
    return () => undefined;
  }

  const send = () => {
    cleanup();
    safeSendToWebContents(contents, channel, payload);
  };
  const cleanup = () => {
    contents.removeListener('did-finish-load', send);
    contents.removeListener('destroyed', cleanup);
  };
  contents.once('did-finish-load', send);
  contents.once('destroyed', cleanup);
  return cleanup;
}
