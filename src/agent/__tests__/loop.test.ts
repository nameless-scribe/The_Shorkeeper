import { describe, expect, it, beforeEach, vi } from 'vitest';
import type { ModelEvent } from '../../shared/types';
import type { PermissionPolicy } from '../types';
import { ToolRegistry } from '../../tools/registry';
import type { ToolDefinition } from '../../tools/types';

const { streamChatMock } = vi.hoisted(() => ({
  streamChatMock: vi.fn(),
}));

vi.mock('../../models/stream-chat', () => ({
  streamChat: streamChatMock,
}));

vi.mock('../../models/config', () => ({
  loadModelConfig: vi.fn(() => ({
    apiKey: 'test-key',
    baseUrl: 'https://example.test',
    model: 'test-model',
  })),
}));

import { runAgentLoop } from '../loop';

const policy: PermissionPolicy = {
  filesystem: {
    allowedRoots: [],
    writeAllowed: false,
    requireConfirmOnWrite: false,
  },
  network: false,
  mcp: false,
  automation: { allowed: true, requireConfirm: true },
  shell: { allowed: false, requireConfirm: true },
};

async function* modelEvents(events: ModelEvent[]): AsyncGenerator<ModelEvent> {
  yield* events;
}

async function collectEvents(generator: AsyncGenerator<ReturnType<typeof import('../events')['ev']['textDelta']>>) {
  const events = [];
  for await (const event of generator) events.push(event);
  return events;
}

function textRound(text: string): ModelEvent[] {
  return [
    { type: 'text_delta', delta: text },
    { type: 'round_complete', content: text, toolCalls: [] },
    { type: 'done' },
  ];
}

const failingTool: ToolDefinition = {
  name: 'failing_tool',
  description: '测试工具',
  parameters: { type: 'object', properties: {} },
  category: 'skill',
  requiresPermission: [],
  execute: vi.fn(async () => ({
    success: false,
    output: '',
    error: '工具内部失败',
  })),
};

const hangingTool: ToolDefinition = {
  name: 'hanging_tool',
  description: '测试超时工具',
  parameters: { type: 'object', properties: {} },
  category: 'skill',
  requiresPermission: [],
  execute: async (_args, ctx) => new Promise((resolve) => {
    ctx.signal.addEventListener('abort', () => {
      resolve({ success: false, output: '', error: '底层工具已收到取消' });
    }, { once: true });
  }),
};

describe('runAgentLoop lifecycle boundaries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    streamChatMock.mockReset();
  });

  it('finishes a normal text run without tool calls', async () => {
    streamChatMock.mockReturnValueOnce(modelEvents(textRound('完成')));
    const phases: string[] = [];
    const registry = new ToolRegistry();

    const events = await collectEvents(runAgentLoop({
      sessionId: 'session-1',
      runId: 'run-1',
      messages: [{ role: 'user', content: '你好' }],
      registry,
      policy,
      onPhaseChange: (phase) => phases.push(phase),
    }));

    expect(events).toEqual([
      { type: 'text_delta', runId: 'run-1', delta: '完成' },
    ]);
    expect(phases).toContain('running');
  });

  it('returns tool failures to the model for recovery', async () => {
    streamChatMock
      .mockReturnValueOnce(modelEvents([
        {
          type: 'round_complete',
          content: null,
          toolCalls: [{
            id: 'call-1',
            type: 'function',
            function: { name: 'failing_tool', arguments: '{}' },
          }],
        },
        { type: 'done' },
      ]))
      .mockReturnValueOnce(modelEvents(textRound('已处理失败')));

    const phases: string[] = [];
    const registry = new ToolRegistry();
    registry.register(failingTool);
    const events = await collectEvents(runAgentLoop({
      sessionId: 'session-2',
      runId: 'run-2',
      messages: [{ role: 'user', content: '执行工具' }],
      registry,
      policy,
      onPhaseChange: (phase) => phases.push(phase),
    }));

    expect(failingTool.execute).toHaveBeenCalledOnce();
    expect(events).toContainEqual({
      type: 'tool_call_end',
      runId: 'run-2',
      callId: 'call-1',
      result: {
        success: false,
        output: '',
        error: '工具内部失败',
        errorCategory: 'internal_error',
      },
    });
    expect(events).toContainEqual({ type: 'text_delta', runId: 'run-2', delta: '已处理失败' });
    expect(phases).toContain('waiting_tool');
  });

  it('reports cancellation before the model request starts', async () => {
    const controller = new AbortController();
    controller.abort();
    const registry = new ToolRegistry();

    const events = await collectEvents(runAgentLoop({
      sessionId: 'session-3',
      runId: 'run-3',
      messages: [{ role: 'user', content: '取消' }],
      registry,
      policy,
      signal: controller.signal,
    }));

    expect(streamChatMock).not.toHaveBeenCalled();
    expect(events).toEqual([
      { type: 'run_error', runId: 'run-3', message: '已取消', sessionId: 'session-3' },
    ]);
  });

  it('turns a non-responsive model round into a timeout error', async () => {
    streamChatMock.mockImplementation(async function* () {
      await new Promise<never>(() => undefined);
    });

    const registry = new ToolRegistry();
    const events = await collectEvents(runAgentLoop({
      sessionId: 'session-timeout-model',
      runId: 'run-timeout-model',
      messages: [{ role: 'user', content: '等待模型' }],
      registry,
      policy,
      modelTimeoutMs: 10,
    }));

    expect(events.at(-1)).toEqual({
      type: 'run_error',
      runId: 'run-timeout-model',
      message: '模型请求超时',
      sessionId: 'session-timeout-model',
    });
  });

  it('aborts a hanging tool and returns a recoverable tool error', async () => {
    streamChatMock
      .mockReturnValueOnce(modelEvents([
        {
          type: 'round_complete',
          content: null,
          toolCalls: [{
            id: 'call-timeout',
            type: 'function',
            function: { name: 'hanging_tool', arguments: '{}' },
          }],
        },
        { type: 'done' },
      ]))
      .mockReturnValueOnce(modelEvents(textRound('超时已恢复')));

    const registry = new ToolRegistry();
    registry.register(hangingTool);
    const events = await collectEvents(runAgentLoop({
      sessionId: 'session-timeout-tool',
      runId: 'run-timeout-tool',
      messages: [{ role: 'user', content: '执行超时工具' }],
      registry,
      policy,
      toolTimeoutMs: 10,
    }));

    expect(events).toContainEqual({
      type: 'tool_call_end',
      runId: 'run-timeout-tool',
      callId: 'call-timeout',
      result: {
        success: false,
        output: '',
        error: '工具执行超时',
        errorCategory: 'timeout',
      },
    });
    expect(events).toContainEqual({ type: 'text_delta', runId: 'run-timeout-tool', delta: '超时已恢复' });
  });

  it('stops remaining tool calls after cancellation', async () => {
    const controller = new AbortController();
    const firstTool: ToolDefinition = {
      name: 'cancel_tool',
      description: '测试取消',
      parameters: { type: 'object', properties: {} },
      category: 'skill',
      requiresPermission: [],
      execute: vi.fn(async () => {
        controller.abort();
        return { success: true, output: '已完成' };
      }),
    };
    const secondTool: ToolDefinition = {
      name: 'should_not_run',
      description: '不应执行',
      parameters: { type: 'object', properties: {} },
      category: 'skill',
      requiresPermission: [],
      execute: vi.fn(async () => ({ success: true, output: '错误执行' })),
    };

    streamChatMock.mockReturnValueOnce(modelEvents([
      {
        type: 'round_complete',
        content: null,
        toolCalls: [
          {
            id: 'call-cancel',
            type: 'function',
            function: { name: 'cancel_tool', arguments: '{}' },
          },
          {
            id: 'call-should-not-run',
            type: 'function',
            function: { name: 'should_not_run', arguments: '{}' },
          },
        ],
      },
      { type: 'done' },
    ]));

    const registry = new ToolRegistry();
    registry.register(firstTool);
    registry.register(secondTool);
    const events = await collectEvents(runAgentLoop({
      sessionId: 'session-cancel-tools',
      runId: 'run-cancel-tools',
      messages: [{ role: 'user', content: '取消剩余工具' }],
      registry,
      policy,
      signal: controller.signal,
    }));

    expect(firstTool.execute).toHaveBeenCalledOnce();
    expect(secondTool.execute).not.toHaveBeenCalled();
    expect(events).toContainEqual({
      type: 'run_error',
      runId: 'run-cancel-tools',
      message: '已取消',
      sessionId: 'session-cancel-tools',
    });
  });

  it('stops after the configured maximum tool rounds', async () => {
    streamChatMock.mockImplementation(() => modelEvents([
      {
        type: 'round_complete',
        content: null,
        toolCalls: [{
          id: 'call-loop',
          type: 'function',
          function: { name: 'failing_tool', arguments: '{}' },
        }],
      },
      { type: 'done' },
    ]));

    const registry = new ToolRegistry();
    registry.register(failingTool);
    const events = await collectEvents(runAgentLoop({
      sessionId: 'session-4',
      runId: 'run-4',
      messages: [{ role: 'user', content: '不要死循环' }],
      registry,
      policy,
      maxRounds: 2,
    }));

    expect(events.at(-1)).toEqual({
      type: 'run_error',
      runId: 'run-4',
      message: '已达到最大工具轮次 (2)',
      sessionId: 'session-4',
    });
    expect(streamChatMock).toHaveBeenCalledTimes(2);
  });
});
