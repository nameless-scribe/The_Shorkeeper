import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ModelEvent } from '../../shared/types';
import type { PermissionPolicy } from '../types';
import { ToolRegistry } from '../../tools/registry';
import type { ToolDefinition } from '../../tools/types';
import { setPermissionConfirmer } from '../permissions';
import { estimateTokens } from '../context-budget';
import type { RunCheckpoint } from '../checkpoint-contract';

const { streamChatMock } = vi.hoisted(() => ({
  streamChatMock: vi.fn(),
}));

vi.mock('../../models/stream-chat', () => ({
  streamChat: streamChatMock,
}));

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
  let workspace: string;
  beforeEach(() => {
    workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-loop-budget-'));
    vi.stubEnv('SHOREKEEPER_WORKSPACE_DIR', workspace);
    vi.clearAllMocks();
    streamChatMock.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    fs.rmSync(workspace, { recursive: true, force: true });
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
    expect(streamChatMock).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({ model: 'test-model' }),
      expect.objectContaining({ protocol: 'openai' }),
    );
  });

  it('generates one stable call id when the provider omits it', async () => {
    const tool: ToolDefinition = {
      name: 'id_tool',
      description: '测试调用编号',
      parameters: { type: 'object', properties: {} },
      category: 'skill',
      requiresPermission: [],
      execute: vi.fn(async () => ({ success: true, output: 'ok' })),
    };
    streamChatMock
      .mockReturnValueOnce(modelEvents([{
        type: 'round_complete',
        content: null,
        toolCalls: [{
          id: '',
          type: 'function',
          function: { name: 'id_tool', arguments: '{}' },
        }],
      }, { type: 'done' }]))
      .mockReturnValueOnce(modelEvents(textRound('完成')));

    const registry = new ToolRegistry();
    registry.register(tool);
    await collectEvents(runAgentLoop({
      sessionId: 'session-generated-id',
      runId: 'run-generated-id',
      messages: [{ role: 'user', content: '执行工具' }],
      registry,
      policy,
    }));

    const secondRoundMessages = streamChatMock.mock.calls[1][0];
    const assistantCallId = secondRoundMessages.at(-2).tool_calls[0].id;
    expect(assistantCallId).toBeTruthy();
    expect(secondRoundMessages.at(-1).tool_call_id).toBe(assistantCallId);
  });

  it('replays a repeated tool call id without repeating its side effect', async () => {
    const execute = vi.fn(async () => ({ success: true, output: 'written once' }));
    const tool: ToolDefinition = {
      name: 'side_effect_tool',
      description: '测试重复调用',
      parameters: { type: 'object', properties: {} },
      category: 'skill',
      requiresPermission: [],
      execute,
    };
    const repeatedRound: ModelEvent[] = [{
      type: 'round_complete',
      content: null,
      toolCalls: [{
        id: 'same-call-id',
        type: 'function',
        function: { name: 'side_effect_tool', arguments: '{"value":1}' },
      }],
    }, { type: 'done' }];
    streamChatMock
      .mockReturnValueOnce(modelEvents(repeatedRound))
      .mockReturnValueOnce(modelEvents(repeatedRound))
      .mockReturnValueOnce(modelEvents(textRound('完成')));

    const registry = new ToolRegistry();
    registry.register(tool);
    const events = await collectEvents(runAgentLoop({
      sessionId: 'session-repeated-call',
      runId: 'run-repeated-call',
      messages: [{ role: 'user', content: '执行一次' }],
      registry,
      policy,
    }));

    expect(execute).toHaveBeenCalledOnce();
    expect(events).toContainEqual(expect.objectContaining({
      type: 'tool_call_end',
      callId: 'same-call-id',
      result: expect.objectContaining({
        metadata: expect.objectContaining({ replayedToolCall: true }),
      }),
    }));
  });

  it('bounds large tool output before returning it to the model', async () => {
    const tool: ToolDefinition = {
      name: 'large_output_tool',
      description: '测试大输出',
      parameters: { type: 'object', properties: {} },
      category: 'skill',
      requiresPermission: [],
      execute: vi.fn(async () => ({ success: true, output: '数'.repeat(10_000) })),
    };
    streamChatMock
      .mockReturnValueOnce(modelEvents([{
        type: 'round_complete',
        content: null,
        toolCalls: [{
          id: 'large-call',
          type: 'function',
          function: { name: 'large_output_tool', arguments: '{}' },
        }],
      }, { type: 'done' }]))
      .mockReturnValueOnce(modelEvents(textRound('已读取')));

    const registry = new ToolRegistry();
    registry.register(tool);
    await collectEvents(runAgentLoop({
      sessionId: 'session-large-output',
      runId: 'run-large-output',
      messages: [{ role: 'user', content: '读取大结果' }],
      registry,
      policy,
      toolResultContextBudgetTokens: 300,
    }));

    const toolMessage = streamChatMock.mock.calls[1][0].at(-1);
    expect(toolMessage.content).toContain('内容因上下文预算截断');
    expect(toolMessage.content.length).toBeLessThan(400);
  });

  it('keeps cumulative tool-result context inside one rolling budget', async () => {
    const tool: ToolDefinition = {
      name: 'rolling_output_tool',
      description: '测试累计输出',
      parameters: { type: 'object', properties: {} },
      category: 'skill',
      requiresPermission: [],
      execute: vi.fn(async () => ({ success: true, output: '结'.repeat(400) })),
    };
    const toolRound = (id: string): ModelEvent[] => [{
      type: 'round_complete',
      content: null,
      toolCalls: [{
        id,
        type: 'function',
        function: { name: 'rolling_output_tool', arguments: '{}' },
      }],
    }, { type: 'done' }];
    streamChatMock
      .mockReturnValueOnce(modelEvents(toolRound('rolling-1')))
      .mockReturnValueOnce(modelEvents(toolRound('rolling-2')))
      .mockReturnValueOnce(modelEvents(textRound('完成')));

    const registry = new ToolRegistry();
    registry.register(tool);
    await collectEvents(runAgentLoop({
      sessionId: 'session-rolling-output',
      runId: 'run-rolling-output',
      messages: [{ role: 'user', content: '连续读取' }],
      registry,
      policy,
      toolResultContextBudgetTokens: 500,
    }));

    const thirdRoundMessages = streamChatMock.mock.calls[2][0];
    const totalToolTokens = thirdRoundMessages
      .filter((message: { role: string }) => message.role === 'tool')
      .reduce(
        (total: number, message: { content: string }) => total + estimateTokens(message.content),
        0,
      );
    expect(totalToolTokens).toBeLessThanOrEqual(500);
  });

  it('rejects a model tool-call flood before executing side effects', async () => {
    const execute = vi.fn(async () => ({ success: true, output: 'ok' }));
    const tool: ToolDefinition = {
      name: 'flood_tool',
      description: '测试调用洪泛',
      parameters: { type: 'object', properties: {} },
      category: 'skill',
      requiresPermission: [],
      execute,
    };
    streamChatMock.mockReturnValueOnce(modelEvents([{
      type: 'round_complete',
      content: null,
      toolCalls: ['one', 'two'].map((id) => ({
        id,
        type: 'function' as const,
        function: { name: 'flood_tool', arguments: '{}' },
      })),
    }, { type: 'done' }]));

    const registry = new ToolRegistry();
    registry.register(tool);
    const events = await collectEvents(runAgentLoop({
      sessionId: 'session-tool-flood',
      runId: 'run-tool-flood',
      messages: [{ role: 'user', content: '执行' }],
      registry,
      policy,
      maxToolCallsPerRound: 1,
    }));

    expect(execute).not.toHaveBeenCalled();
    expect(events.at(-1)).toEqual({
      type: 'run_error',
      runId: 'run-tool-flood',
      message: '单轮工具调用超过安全限制 (1)',
      sessionId: 'session-tool-flood',
    });
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
      message: '已达到本段模型工作轮次预算 (2)',
      reason: 'budget_exhausted',
      sessionId: 'session-4',
    });
    expect(streamChatMock).toHaveBeenCalledTimes(3);
    expect(streamChatMock.mock.calls[2][2].tools).toBeUndefined();
    expect(events.some((event) => event.type === 'text_delta' && event.delta.includes('本段已停止'))).toBe(true);
  });

  it('finishes a progressing task after more than ten tool rounds', async () => {
    let round = 0;
    const execute = vi.fn(async () => ({ success: true, output: `page ${round}` }));
    const registry = new ToolRegistry();
    registry.register({ ...failingTool, name: 'pages', execute });
    streamChatMock.mockImplementation(() => {
      round += 1;
      return modelEvents(round <= 12 ? [{ type: 'round_complete', content: null, toolCalls: [{
        id: `page-${round}`, type: 'function', function: { name: 'pages', arguments: JSON.stringify({ page: round }) },
      }] }] : textRound('十二页处理完成'));
    });
    const events = await collectEvents(runAgentLoop({ sessionId: 's', runId: 'r', registry, policy,
      messages: [{ role: 'user', content: '读取十二页' }] }));
    expect(execute).toHaveBeenCalledTimes(12);
    expect(events.at(-1)).toMatchObject({ type: 'text_delta', delta: '十二页处理完成' });
    expect(events.some((event) => event.type === 'run_error')).toBe(false);
  });

  it('preserves the tenth successful result when finalization fails', async () => {
    let round = 0;
    const registry = new ToolRegistry();
    registry.register({ ...failingTool, name: 'pages', execute: async () => ({ success: true, output: `verified-page-${round}` }) });
    streamChatMock.mockImplementation(() => {
      round += 1;
      return modelEvents(round <= 10 ? [{ type: 'round_complete', content: null, toolCalls: [{
        id: `page-${round}`, type: 'function', function: { name: 'pages', arguments: '{}' },
      }] }] : [{ type: 'error', message: 'offline' }]);
    });
    const events = await collectEvents(runAgentLoop({ sessionId: 's', runId: 'r', registry, policy, maxRounds: 10,
      messages: [{ role: 'user', content: '读取十页' }] }));
    expect(events.filter((event) => event.type === 'tool_call_end')).toHaveLength(10);
    expect(events.at(-2)).toMatchObject({ type: 'text_delta', delta: expect.stringContaining('verified-page-10') });
    expect(events.at(-1)).toMatchObject({ type: 'run_error', reason: 'budget_exhausted' });
    expect(streamChatMock.mock.calls[10][2]).toMatchObject({ maxOutputTokens: 2000 });
    expect(streamChatMock.mock.calls[10][2].tools).toBeUndefined();
  });

  it('counts actual tool dispatches within a batch, not only model rounds', async () => {
    const execute = vi.fn(async () => ({ success: true, output: 'verified' }));
    const registry = new ToolRegistry();
    registry.register({ ...failingTool, execute });
    streamChatMock.mockImplementation(() => modelEvents([{ type: 'round_complete', content: null,
      toolCalls: ['a', 'b', 'c'].map((id) => ({ id, type: 'function' as const,
        function: { name: 'failing_tool', arguments: '{}' } })),
    }]));
    const events = await collectEvents(runAgentLoop({ sessionId: 's', runId: 'r', registry, policy, maxToolCalls: 2,
      messages: [{ role: 'user', content: '执行' }] }));
    expect(execute).toHaveBeenCalledTimes(2);
    expect(events.at(-1)).toMatchObject({ reason: 'budget_exhausted', message: expect.stringContaining('工具调用预算 (2)') });
    // 收尾中即使返回工具调用也不执行。
    expect(streamChatMock).toHaveBeenCalledTimes(2);
  });

  it('checks full input including tool schemas before issuing a request', async () => {
    const registry = new ToolRegistry();
    registry.register({ ...failingTool, description: '大'.repeat(1000) });
    const events = await collectEvents(runAgentLoop({ sessionId: 's', runId: 'r', registry, policy, maxInputTokens: 1,
      messages: [{ role: 'user', content: '执行' }] }));
    expect(streamChatMock).not.toHaveBeenCalled();
    expect(events.at(-1)).toMatchObject({ reason: 'budget_exhausted', message: '完整模型输入达到上下文预算' });
  });

  it('does not spend a finalization request when cumulative token allowance is exhausted', async () => {
    const events = await collectEvents(runAgentLoop({ sessionId: 's', runId: 'r', registry: new ToolRegistry(), policy,
      maxTotalTokens: 1, messages: [{ role: 'user', content: '执行' }] }));
    expect(streamChatMock).not.toHaveBeenCalled();
    expect(events.at(-2)).toMatchObject({ type: 'text_delta', delta: expect.stringContaining('本段已停止') });
    expect(events.at(-1)).toMatchObject({ reason: 'budget_exhausted' });
  });

  it('stops repeated failures despite fresh call IDs and reordered JSON keys', async () => {
    let round = 0;
    const registry = new ToolRegistry();
    registry.register(failingTool);
    streamChatMock.mockImplementation(() => {
      round += 1;
      return modelEvents([{ type: 'round_complete', content: null, toolCalls: [{
        id: `retry-${round}`, type: 'function', function: {
          name: 'failing_tool', arguments: round % 2 ? '{ "a": 1, "b": 2 }' : '{"b":2,"a":1}',
        },
      }] }]);
    });
    const events = await collectEvents(runAgentLoop({ sessionId: 's', runId: 'r', registry, policy,
      messages: [{ role: 'user', content: '执行' }] }));
    expect(failingTool.execute).toHaveBeenCalledTimes(3);
    expect(events.at(-1)).toMatchObject({ reason: 'repeated_failure' });
    const thirdInput = streamChatMock.mock.calls[2][0];
    expect(thirdInput.at(-1).content).toContain('相同请求已失败两次');
  });

  it.each(['length', 'max_tokens'])('does not execute tool calls from a truncated %s response', async (stopReason) => {
    const registry = new ToolRegistry();
    registry.register(failingTool);
    streamChatMock.mockReturnValueOnce(modelEvents([{ type: 'round_complete', content: null, stopReason,
      toolCalls: [{ id: 'truncated', type: 'function', function: { name: 'failing_tool', arguments: '{}' } }],
    }])).mockReturnValueOnce(modelEvents([{ type: 'round_complete', content: '不完整的收尾', toolCalls: [], stopReason }]));
    const events = await collectEvents(runAgentLoop({ sessionId: 's', runId: 'r', registry, policy,
      messages: [{ role: 'user', content: '执行' }] }));
    expect(failingTool.execute).not.toHaveBeenCalled();
    expect(events.at(-1)).toMatchObject({ reason: 'budget_exhausted', message: expect.stringContaining('输出不完整') });
    expect(events.filter((event) => event.type === 'text_delta').map((event) => event.delta).join('')).not.toContain('不完整的收尾');
  });

  it('uses controlled finalization when the active budget expires inside a model request', async () => {
    vi.useFakeTimers();
    streamChatMock.mockImplementationOnce(async function* () { await new Promise(() => undefined); })
      .mockReturnValueOnce(modelEvents(textRound('尚未完成')));
    const pending = collectEvents(runAgentLoop({ sessionId: 's', runId: 'r', registry: new ToolRegistry(), policy,
      maxActiveMs: 100, messages: [{ role: 'user', content: '执行' }] }));
    await vi.advanceTimersByTimeAsync(100);
    const events = await pending;
    expect(events.at(-1)).toMatchObject({ reason: 'budget_exhausted', message: '已达到本段主动执行时间预算' });
    expect(events.at(-2)).toMatchObject({ type: 'text_delta', delta: expect.stringContaining('本段已停止') });
  });

  it('saves a bounded checkpoint and blocks a successful non-idempotent effect in a later segment', async () => {
    const execute = vi.fn(async () => ({ success: true, output: 'sent once' }));
    const registry = new ToolRegistry();
    registry.register({ ...failingTool, name: 'send_once', execute,
      sideEffects: { risk: 'low', idempotent: false, supportsPreview: false, reversible: 'none', evidence: 'none' } });
    let snapshot: RunCheckpoint | undefined;
    const toolRound = (): ModelEvent[] => [{ type: 'round_complete', content: null, toolCalls: [{
      id: 'call-new', type: 'function', function: { name: 'send_once', arguments: '{"to":"test"}' },
    }] }];
    streamChatMock.mockReturnValueOnce(modelEvents(toolRound())).mockReturnValueOnce(modelEvents(textRound('阶段总结')));
    const first = await collectEvents(runAgentLoop({ sessionId: 's', runId: 'parent', registry, policy, maxRounds: 1,
      messages: [{ role: 'user', content: '原任务' }], checkpoint: {
        goal: '原任务', environment: 'a'.repeat(64), save: (value) => { snapshot = value; },
      } }));
    expect(snapshot).toMatchObject({ rootRunId: 'parent', totals: { segments: 1, rounds: 1, toolCalls: 1 } });
    expect(snapshot?.completedEffects).toHaveLength(1);
    expect(first.some((event) => event.type === 'text_delta' && event.delta.includes('检查点已保存'))).toBe(true);
    streamChatMock.mockReturnValueOnce(modelEvents(toolRound())).mockReturnValueOnce(modelEvents(textRound('阶段总结')));
    const second = await collectEvents(runAgentLoop({ sessionId: 's', runId: 'child', registry, policy, maxRounds: 1,
      messages: [{ role: 'user', content: '继续' }], checkpoint: {
        goal: '原任务', environment: 'a'.repeat(64), previous: snapshot, save: (value) => { snapshot = value; },
      } }));
    expect(execute).toHaveBeenCalledOnce();
    expect(second).toContainEqual(expect.objectContaining({ type: 'tool_call_end', result: expect.objectContaining({
      error: expect.stringContaining('禁止重放'),
    }) }));
    expect(snapshot?.totals.segments).toBe(2);
    expect(snapshot?.totals.rounds).toBe(2);
  });

  it('does not claim resumability when checkpoint persistence fails', async () => {
    streamChatMock.mockImplementation(() => modelEvents([{ type: 'round_complete', content: null, toolCalls: [{
      id: 'call', type: 'function', function: { name: 'failing_tool', arguments: '{}' },
    }] }]));
    const registry = new ToolRegistry(); registry.register(failingTool);
    const events = await collectEvents(runAgentLoop({ sessionId: 's', runId: 'r', registry, policy, maxRounds: 1,
      messages: [{ role: 'user', content: '任务' }], checkpoint: { goal: '任务', environment: 'a'.repeat(64), save: () => { throw new Error('disk full'); } } }));
    const text = events.filter((event) => event.type === 'text_delta').map((event) => event.delta).join('');
    expect(text).not.toContain('检查点已保存');
    expect(text).toContain('未能建立可安全继续');
  });

  it('requires a fresh approval for changed side-effect arguments in a resumed task', async () => {
    const execute = vi.fn(async () => ({ success: true, output: 'sent' }));
    const confirm = vi.fn(async () => false);
    setPermissionConfirmer(confirm);
    const registry = new ToolRegistry();
    registry.register({ ...failingTool, name: 'send_changed', execute,
      sideEffects: { risk: 'low', idempotent: false, supportsPreview: false, reversible: 'none', evidence: 'output' } });
    streamChatMock.mockReturnValueOnce(modelEvents([{ type: 'round_complete', content: null, toolCalls: [{
      id: 'new', type: 'function', function: { name: 'send_changed', arguments: '{"to":"new-recipient"}' },
    }] }])).mockReturnValueOnce(modelEvents(textRound('未发送')));
    const events = await collectEvents(runAgentLoop({ sessionId: 's', runId: 'r', registry, policy,
      messages: [{ role: 'user', content: '继续' }], checkpoint: { goal: '原任务', environment: 'a'.repeat(64), save: () => undefined,
        previous: { version: 1, rootRunId: 'parent', goal: '原任务', environment: 'a'.repeat(64), answers: [], facts: [], pending: [], files: [], completedEffects: [],
          totals: { rounds: 20, toolCalls: 1, tokens: 1000, activeMs: 100, segments: 1 } },
      } }));
    expect(confirm).toHaveBeenCalledOnce();
    expect(execute).not.toHaveBeenCalled();
    expect(events).toContainEqual(expect.objectContaining({ type: 'tool_call_end', result: expect.objectContaining({ errorCategory: 'permission_denied' }) }));
    setPermissionConfirmer(async () => false);
  });

  it('keeps a review-style write request read-only when writes are not allowed', async () => {
    const writeTool: ToolDefinition = {
      name: 'write_review_result',
      description: '测试审核写入',
      parameters: { type: 'object' },
      category: 'file',
      requiresPermission: ['filesystem:write'],
      execute: vi.fn(async () => ({ success: true, output: '不应写入' })),
    };
    streamChatMock
      .mockReturnValueOnce(modelEvents([{
        type: 'round_complete',
        content: null,
        toolCalls: [{
          id: 'call-review-write',
          type: 'function',
          function: { name: 'write_review_result', arguments: JSON.stringify({ path: 'review.md' }) },
        }],
      }, { type: 'done' }]))
      .mockReturnValueOnce(modelEvents(textRound('已完成只读审核，未写入文件')));

    const registry = new ToolRegistry();
    registry.register(writeTool);
    const events = await collectEvents(runAgentLoop({
      sessionId: 'session-review-write',
      runId: 'run-review-write',
      messages: [{ role: 'user', content: '审核这份计划，不要修改文件' }],
      registry,
      policy,
    }));

    expect(writeTool.execute).not.toHaveBeenCalled();
    expect(events).toContainEqual(expect.objectContaining({
      type: 'tool_call_end',
      result: expect.objectContaining({ errorCategory: 'permission_denied' }),
    }));
    expect(events).toContainEqual({
      type: 'text_delta',
      runId: 'run-review-write',
      delta: '已完成只读审核，未写入文件',
    });
  });

  it('allows a focus-style write step only after the existing confirmation', async () => {
    const writeTool: ToolDefinition = {
      name: 'write_focus_result',
      description: '测试任务写入',
      parameters: { type: 'object' },
      category: 'file',
      requiresPermission: ['filesystem:write'],
      execute: vi.fn(async () => ({ success: true, output: '已写入结果' })),
    };
    setPermissionConfirmer(async () => true);
    streamChatMock
      .mockReturnValueOnce(modelEvents([{
        type: 'round_complete',
        content: null,
        toolCalls: [{
          id: 'call-focus-write',
          type: 'function',
          function: { name: 'write_focus_result', arguments: JSON.stringify({ path: 'result.md' }) },
        }],
      }, { type: 'done' }]))
      .mockReturnValueOnce(modelEvents(textRound('结果已保存')));

    const registry = new ToolRegistry();
    registry.register(writeTool);
    const events = await collectEvents(runAgentLoop({
      sessionId: 'session-focus-write',
      runId: 'run-focus-write',
      messages: [{ role: 'user', content: '推进任务并保存结果' }],
      registry,
      policy: {
        ...policy,
        filesystem: {
          allowedRoots: [path.join(os.tmpdir(), 'sk-focus-workspace')],
          writeAllowed: true,
          requireConfirmOnWrite: true,
        },
      },
    }));
    setPermissionConfirmer(async () => false);

    expect(writeTool.execute).toHaveBeenCalledOnce();
    expect(events).toContainEqual({
      type: 'text_delta',
      runId: 'run-focus-write',
      delta: '结果已保存',
    });
  });
});
