import { describe, expect, it, vi } from 'vitest';
import { recoverInterruptedRuntimeState } from '../startup-recovery';

describe('startup runtime recovery', () => {
  it('closes every persisted running state before new runtime work starts', () => {
    const agentRuns = { runIds: ['run-1'], steps: 1, approvals: 1, questions: 0 };
    const reconcileAgentRuns = vi.fn(() => agentRuns);
    const failAudioTranscripts = vi.fn(() => 2);
    const interruptQueryRuns = vi.fn(() => 3);
    const interruptErpBatches = vi.fn(() => ({ batches: 1, unknownSubmissions: 1, cancelledSubmissions: 0 }));

    expect(recoverInterruptedRuntimeState({
      reconcileAgentRuns,
      failAudioTranscripts,
      interruptQueryRuns,
      interruptErpBatches,
    })).toEqual({
      agentRuns,
      audioTranscripts: 2,
      queryRuns: 3,
      erpBatches: { batches: 1, unknownSubmissions: 1, cancelledSubmissions: 0 },
    });
    expect(reconcileAgentRuns).toHaveBeenCalledOnce();
    expect(failAudioTranscripts).toHaveBeenCalledOnce();
    expect(interruptQueryRuns).toHaveBeenCalledOnce();
    expect(interruptErpBatches).toHaveBeenCalledOnce();
  });

  it('does not hide mandatory recovery failures', () => {
    expect(() => recoverInterruptedRuntimeState({
      reconcileAgentRuns: () => ({ runIds: [], steps: 0, approvals: 0, questions: 0 }),
      failAudioTranscripts: () => 0,
      interruptQueryRuns: () => { throw new Error('query recovery failed'); },
      interruptErpBatches: () => ({ batches: 0, unknownSubmissions: 0, cancelledSubmissions: 0 }),
    })).toThrow('query recovery failed');
  });

  it('propagates agent ledger recovery failures before later recovery steps run', () => {
    const failAudioTranscripts = vi.fn(() => 0);
    const interruptQueryRuns = vi.fn(() => 0);
    expect(() => recoverInterruptedRuntimeState({
      reconcileAgentRuns: () => { throw new Error('agent recovery failed'); },
      failAudioTranscripts,
      interruptQueryRuns,
      interruptErpBatches: () => ({ batches: 0, unknownSubmissions: 0, cancelledSubmissions: 0 }),
    })).toThrow('agent recovery failed');
    expect(failAudioTranscripts).not.toHaveBeenCalled();
    expect(interruptQueryRuns).not.toHaveBeenCalled();
  });

  it('stops startup when ERP ledger recovery fails', () => {
    expect(() => recoverInterruptedRuntimeState({
      reconcileAgentRuns: () => ({ runIds: [], steps: 0, approvals: 0, questions: 0 }),
      failAudioTranscripts: () => 0,
      interruptQueryRuns: () => 0,
      interruptErpBatches: () => { throw new Error('ERP ledger recovery failed'); },
    })).toThrow('ERP ledger recovery failed');
  });
});
