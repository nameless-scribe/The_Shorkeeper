import { describe, expect, it, beforeEach, vi } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import type { ModelEvent } from '../../shared/types';
import type { PermissionPolicy } from '../types';
import { ToolRegistry } from '../../tools/registry';
import type { ToolDefinition } from '../../tools/types';
import { setPermissionConfirmer } from '../permissions';
import { estimateTokens } from '../context-budget';

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
      message: '已达到最大工具轮次 (2)',
      sessionId: 'session-4',
    });
    expect(streamChatMock).toHaveBeenCalledTimes(2);
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
