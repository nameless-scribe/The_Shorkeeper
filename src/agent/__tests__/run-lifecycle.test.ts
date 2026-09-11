import { describe, expect, it } from 'vitest';
import { createRunLifecycle } from '../run-lifecycle';

describe('run lifecycle', () => {
  it('allows a tool run to finish through the expected phases', () => {
    const lifecycle = createRunLifecycle('run-1', 'session-1');

    lifecycle.transition('running');
    lifecycle.transition('waiting_tool');
    lifecycle.transition('running');
    lifecycle.transition('finalizing');
    lifecycle.transition('finished', 'finished');

    expect(lifecycle.snapshot()).toMatchObject({
      runId: 'run-1',
      sessionId: 'session-1',
      phase: 'finished',
      terminalReason: 'finished',
    });
    expect(lifecycle.isTerminal()).toBe(true);
  });

  it('rejects transitions after a terminal phase', () => {
    const lifecycle = createRunLifecycle('run-2', 'session-2');
    lifecycle.transition('running');
    lifecycle.transition('cancelled', 'cancelled');

    expect(() => lifecycle.transition('finished', 'finished')).toThrow('非法 run 生命周期转移');
  });

  it('records an error when setup fails before running', () => {
    const lifecycle = createRunLifecycle('run-3', 'missing');
    lifecycle.transition('error', 'session_not_found');

    expect(lifecycle.snapshot()).toMatchObject({
      phase: 'error',
      terminalReason: 'session_not_found',
    });
  });
});
