import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ModelEvent } from '../../shared/types';
import type { PermissionPolicy } from '../types';
import { ToolRegistry } from '../../tools/registry';
import { askUserTool } from '../../tools/interaction/ask-user';
import { setUserQuestionResponder } from '../user-questions';
import { clearRunPlan, getRunPlan, setRunPlan } from '../plan-state';

const { streamChatMock } = vi.hoisted(() => ({ streamChatMock: vi.fn() }));

vi.mock('../../models/stream-chat', () => ({ streamChat: streamChatMock }));
vi.mock('../../models/config', () => ({
  loadModelRuntimeConfig: vi.fn(() => ({
    apiKey: 'test-key',
    baseUrl: 'https://example.test',
    model: 'test-model',
    protocol: 'openai',
    profileId: 'profile-test',
  })),
}));

import { runAgentLoop } from '../loop';

const policy: PermissionPolicy = {
  filesystem: { allowedRoots: [], writeAllowed: false, requireConfirmOnWrite: false },
  network: false,
  mcp: false,
  automation: { allowed: true, requireConfirm: true },
  shell: { allowed: false, requireConfirm: true },
};

async function* modelEvents(events: ModelEvent[]): AsyncGenerator<ModelEvent> {
  yield* events;
}

function askRound(callId: string): ModelEvent[] {
  return [
    {
      type: 'round_complete',
      content: null,
      toolCalls: [{
        id: callId,
        type: 'function',
        function: {
          name: 'ask_user',
          arguments: JSON.stringify({ question: '改哪一份？', options: [{ id: 'v1', label: 'v1' }, { id: 'v2', label: 'v2' }] }),
        },
      }],
    },
    { type: 'done' },
  ];
}

function textRound(text: string): ModelEvent[] {
  return [
    { type: 'text_delta', delta: text },
    { type: 'round_complete', content: text, toolCalls: [] },
    { type: 'done' },
  ];
}

async function run(runId: string, hooks: { onQuestionStart?: () => void; onQuestionEnd?: (status: string, message?: string) => void }) {
  const registry = new ToolRegistry();
  registry.register(askUserTool);
  const events = [];
  for await (const event of runAgentLoop({
    sessionId: 'session-q',
    runId,
    messages: [{ role: 'user', content: '把报价单税率改成 13%' }],
    registry,
    policy,
    onQuestionStart: hooks.onQuestionStart,
    onQuestionEnd: hooks.onQuestionEnd as never,
  })) {
    events.push(event);
  }
  return events;
}

let workspace: string;
beforeEach(() => {
  workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-question-budget-'));
  vi.stubEnv('SHOREKEEPER_WORKSPACE_DIR', workspace);
});
afterEach(() => {
  vi.unstubAllEnvs();
  fs.rmSync(workspace, { recursive: true, force: true });
  vi.useRealTimers();
  setUserQuestionResponder(null);
  streamChatMock.mockReset();
});

describe('ask_user inside the agent loop (P6.1)', () => {
  it('accepts an answer after three minutes without charging user wait as active execution', async () => {
    vi.useFakeTimers();
    setUserQuestionResponder(async () => {
      await new Promise((resolve) => setTimeout(resolve, 180_000));
      return { answer: 'v2', optionId: 'v2', decidedBy: 'user' };
    });
    streamChatMock.mockReturnValueOnce(modelEvents(askRound('delayed')))
      .mockReturnValueOnce(modelEvents(textRound('好，改 v2')));
    const registry = new ToolRegistry();
    registry.register(askUserTool);
    const pending = (async () => {
      const events = [];
      for await (const event of runAgentLoop({ sessionId: 's', runId: 'delayed', registry, policy,
        messages: [{ role: 'user', content: '修改' }], maxActiveMs: 60_000 })) events.push(event);
      return events;
    })();
    await vi.advanceTimersByTimeAsync(180_000);
    const events = await pending;
    expect(events).toContainEqual(expect.objectContaining({ type: 'tool_call_end', result: expect.objectContaining({ success: true }) }));
    expect(events.at(-1)).toMatchObject({ type: 'text_delta', delta: '好，改 v2' });
  });

  it('stops dependent calls in the same batch when the question times out at ten minutes', async () => {
    vi.useFakeTimers();
    setUserQuestionResponder(async () => new Promise(() => undefined));
    const execute = vi.fn(async () => ({ success: true, output: 'must not run' }));
    const registry = new ToolRegistry();
    registry.register(askUserTool);
    registry.register({ ...askUserTool, name: 'dependent', execute });
    const initial = askRound('timeout');
    if (initial[0].type === 'round_complete') initial[0].toolCalls.push({ id: 'dependent', type: 'function', function: { name: 'dependent', arguments: '{}' } });
    streamChatMock.mockReturnValueOnce(modelEvents(initial)).mockReturnValueOnce(modelEvents(textRound('等待回答')));
    const pending = (async () => {
      const events = [];
      for await (const event of runAgentLoop({ sessionId: 's', runId: 'timeout', registry, policy,
        messages: [{ role: 'user', content: '修改' }] })) events.push(event);
      return events;
    })();
    await vi.advanceTimersByTimeAsync(599_999);
    expect(streamChatMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    const events = await pending;
    expect(execute).not.toHaveBeenCalled();
    expect(events.at(-1)).toMatchObject({ type: 'run_error', reason: 'awaiting_input' });
  });
  it('switches the run phase to waiting_user around the question and marks the active plan item', async () => {
    const runId = 'run-question';
    setRunPlan(runId, [
      { id: '1', content: '找到报价单', status: 'completed' },
      { id: '2', content: '修改税率', status: 'in_progress' },
      { id: '3', content: '读回校验', status: 'pending' },
    ]);
    const phases: string[] = [];
    setUserQuestionResponder(async () => {
      // 等待期间，计划项应已标为 waiting_user
      expect(getRunPlan(runId).map((item) => item.status)).toEqual(['completed', 'waiting_user', 'pending']);
      return { answer: 'v2', optionId: 'v2', decidedBy: 'user' };
    });
    streamChatMock
      .mockReturnValueOnce(modelEvents(askRound('call-q1')))
      .mockReturnValueOnce(modelEvents(textRound('好，改 v2')));

    const events = await run(runId, {
      onQuestionStart: () => phases.push('start'),
      onQuestionEnd: (status) => phases.push(`end:${status}`),
    });

    expect(phases).toEqual(['start', 'end:succeeded']);
    // 回答后计划项恢复 in_progress，且两次变化都广播了
    const planEvents = events.filter((event) => event.type === 'plan_updated');
    expect(planEvents.map((event) => (event as { items: Array<{ status: string }> }).items[1].status)).toEqual(['waiting_user', 'in_progress']);
    const toolEnd = events.find((event) => event.type === 'tool_call_end') as { result: { success: boolean; output: string } };
    expect(toolEnd.result.success).toBe(true);
    expect(toolEnd.result.output).toBe('用户回答：v2（选项 v2）');
    clearRunPlan(runId);
  });

  it('reports a cancelled question and lets the model stop instead of assuming', async () => {
    const runId = 'run-question-abort';
    const phases: string[] = [];
    setUserQuestionResponder(async () => ({ answer: '', decidedBy: 'abort' }));
    streamChatMock
      .mockReturnValueOnce(modelEvents(askRound('call-q2')))
      .mockReturnValueOnce(modelEvents(textRound('这一步需要你的回答，我先停在这里。')));

    const events = await run(runId, {
      onQuestionStart: () => phases.push('start'),
      onQuestionEnd: (status, message) => phases.push(`end:${status}:${message ?? ''}`),
    });

    expect(phases).toEqual(['start', 'end:cancelled:这一步需要你的回答（未收到）']);
    const toolEnd = events.find((event) => event.type === 'tool_call_end') as { result: { success: boolean; error?: string } };
    expect(toolEnd.result.success).toBe(false);
    expect(toolEnd.result.error).toBe('这一步需要你的回答（未收到）');
    // 没有计划时不广播 plan_updated
    expect(events.some((event) => event.type === 'plan_updated')).toBe(false);
  });
});
