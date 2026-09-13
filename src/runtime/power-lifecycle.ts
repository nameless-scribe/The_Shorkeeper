export interface PowerEventSource {
  on(event: 'suspend' | 'resume' | 'unlock-screen', listener: () => void): unknown;
  removeListener(event: 'suspend' | 'resume' | 'unlock-screen', listener: () => void): unknown;
}

export interface PowerLifecycleCallbacks {
  suspend: () => void;
  resume: () => void;
}

/** Reconcile timers after sleep/unlock, coalescing duplicate wake events. */
export function bindPowerLifecycle(
  source: PowerEventSource,
  callbacks: PowerLifecycleCallbacks,
  resumeDelayMs = 500,
): () => void {
  let disposed = false;
  let resumeTimer: ReturnType<typeof setTimeout> | null = null;

  const cancelResume = () => {
    if (resumeTimer) clearTimeout(resumeTimer);
    resumeTimer = null;
  };
  const onSuspend = () => {
    if (disposed) return;
    cancelResume();
    callbacks.suspend();
  };
  const onResume = () => {
    if (disposed) return;
    cancelResume();
    resumeTimer = setTimeout(() => {
      resumeTimer = null;
      if (!disposed) callbacks.resume();
    }, Math.max(0, resumeDelayMs));
  };

  source.on('suspend', onSuspend);
  source.on('resume', onResume);
  source.on('unlock-screen', onResume);

  return () => {
    if (disposed) return;
    disposed = true;
    cancelResume();
    source.removeListener('suspend', onSuspend);
    source.removeListener('resume', onResume);
    source.removeListener('unlock-screen', onResume);
  };
}
