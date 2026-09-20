import { describe, expect, it, vi } from 'vitest';
import { recoverInterruptedRuntimeState } from '../startup-recovery';

describe('startup runtime recovery', () => {
  it('closes every persisted running state before new runtime work starts', () => {
    const reconcileAgentRuns = vi.fn(() => null);
    const failAudioTranscripts = vi.fn(() => 2);
    const interruptQueryRuns = vi.fn(() => 3);

    expect(recoverInterruptedRuntimeState({
      reconcileAgentRuns,
      failAudioTranscripts,
      interruptQueryRuns,
    })).toEqual({
      agentRuns: null,
      audioTranscripts: 2,
      queryRuns: 3,
    });
    expect(reconcileAgentRuns).toHaveBeenCalledOnce();
    expect(failAudioTranscripts).toHaveBeenCalledOnce();
    expect(interruptQueryRuns).toHaveBeenCalledOnce();
  });

  it('does not hide mandatory recovery failures', () => {
    expect(() => recoverInterruptedRuntimeState({
      reconcileAgentRuns: () => null,
      failAudioTranscripts: () => 0,
      interruptQueryRuns: () => { throw new Error('query recovery failed'); },
    })).toThrow('query recovery failed');
  });
});
