/** Cross-window guard: only one TTS stream at a time (chat vs call, or overlapping rounds). */
let activeStop: (() => void) | null = null;

export function claimSpeechPlayback(stop: () => void): void {
  activeStop?.();
  activeStop = stop;
}

export function releaseSpeechPlayback(stop: () => void): void {
  if (activeStop === stop) {
    activeStop = null;
  }
}

export function stopAllSpeechPlayback(): void {
  activeStop?.();
  activeStop = null;
}
