import os from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModelEvent } from '../../shared/types';
import type { PermissionPolicy } from '../../agent/types';
import { ToolRegistry } from '../../tools/registry';
import type { ToolDefinition } from '../../tools/types';
import { setPermissionConfirmer } from '../../agent/permissions';
import { ASSISTANT_MODES } from '../mode';
import { ASSISTANT_SCENARIOS, getAssistantScenario } from '../scenarios';

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

import { runAgentLoop } from '../../agent/loop';

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

async function collectEvents(generator: AsyncGenerator<unknown>) {
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

const readonlyPolicy: PermissionPolicy = policy;

const confirmWritePolicy: PermissionPolicy = {
  ...policy,
  filesystem: {
    allowedRoots: [path.join(os.tmpdir(), 'sk-s5-workspace')],
    writeAllowed: true,
    requireConfirmOnWrite: true,
  },
};

function writeTool(name: string, execute = vi.fn(async () => ({ success: true, output: '已写入' }))): ToolDefinition {
  return {
    name,
    description: '测试写入',
    parameters: { type: 'object' },
    category: 'file',
    requiresPermission: ['filesystem:write'],
    execute,
  };
}

describe('S5 scenario contracts', () => {
  it('freezes six unique scenarios across all assistant modes', () => {
    expect(ASSISTANT_SCENARIOS.map((scenario) => scenario.id)).toEqual([
      'casual_chat',
      'multi_step_task',
      'workspace_organize',
      'knowledge_qa',
      'review_plan',
      'create_reminder',
    ]);
    expect(new Set(ASSISTANT_SCENARIOS.map((scenario) => scenario.mode)))
      .toEqual(new Set(ASSISTANT_MODES));
  });

  it('keeps companion free of automatic side effects and memory', () => {
    const chat = getAssistantScenario('casual_chat');
    expect(chat).toMatchObject({
      mode: 'companion',
      allowsSideEffects: false,
      autoExtractMemory: false,
      expectedTools: 'none',
    });
  });

  it('requires confirmation for writes and reminders, and keeps review read-only', () => {
    expect(getAssistantScenario('workspace_organize')).toMatchObject({
      requiresConfirmation: true,
      expectedTools: 'confirm_write',
    });
    expect(getAssistantScenario('create_reminder')).toMatchObject({
      requiresConfirmation: true,
      allowsSideEffects: true,
    });
    expect(getAssistantScenario('review_plan')).toMatchObject({
      allowsSideEffects: false,
      expectedTools: 'readonly',
    });
    expect(getAssistantScenario('knowledge_qa')).toMatchObject({
      allowsSideEffects: false,
      expectedTools: 'readonly',
    });
  });
});

describe('organize five paths', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    streamChatMock.mockReset();
    setPermissionConfirmer(async () => false);
  });

  it('completes a read-only organize search', async () => {
    const searchTool: ToolDefinition = {
      name: 'search_workspace',
      description: '检索工作区',
      parameters: { type: 'object' },
      category: 'file',
      requiresPermission: [],
      execute: vi.fn(async () => ({ success: true, output: '找到 2 份资料' })),
    };
    streamChatMock
      .mockReturnValueOnce(modelEvents([{
        type: 'round_complete',
        content: null,
        toolCalls: [{
          id: 'call-organize-search',
          type: 'function',
          function: { name: 'search_workspace', arguments: '{}' },
        }],
      }, { type: 'done' }]))
      .mockReturnValueOnce(modelEvents(textRound('已按来源列出待归档文件')));

    const registry = new ToolRegistry();
    registry.register(searchTool);
    const events = await collectEvents(runAgentLoop({
      sessionId: 'session-organize-success',
      runId: 'run-organize-success',
      messages: [{ role: 'user', content: '整理工作区里的会议纪要' }],
      registry,
      policy: readonlyPolicy,
    }));

    expect(searchTool.execute).toHaveBeenCalledOnce();
    expect(events).toContainEqual({
      type: 'text_delta',
      runId: 'run-organize-success',
      delta: '已按来源列出待归档文件',
    });
  });

  it('returns organize tool failures to the model', async () => {
    const failingSearch: ToolDefinition = {
      name: 'search_workspace',
      description: '检索工作区',
      parameters: { type: 'object' },
      category: 'file',
      requiresPermission: [],
      execute: vi.fn(async () => ({ success: false, output: '', error: '索引不可用' })),
    };
    streamChatMock
      .mockReturnValueOnce(modelEvents([{
        type: 'round_complete',
        content: null,
        toolCalls: [{
          id: 'call-organize-fail',
          type: 'function',
          function: { name: 'search_workspace', arguments: '{}' },
        }],
      }, { type: 'done' }]))
      .mockReturnValueOnce(modelEvents(textRound('检索失败，尚未归档')));

    const registry = new ToolRegistry();
    registry.register(failingSearch);
    const events = await collectEvents(runAgentLoop({
      sessionId: 'session-organize-fail',
      runId: 'run-organize-fail',
      messages: [{ role: 'user', content: '归档这些资料' }],
      registry,
      policy: readonlyPolicy,
    }));

    expect(events).toContainEqual(expect.objectContaining({
      type: 'tool_call_end',
      result: expect.objectContaining({ success: false, errorCategory: 'internal_error' }),
    }));
    expect(events).toContainEqual({
      type: 'text_delta',
      runId: 'run-organize-fail',
      delta: '检索失败，尚未归档',
    });
  });

  it('stops organize work when the user cancels', async () => {
    const controller = new AbortController();
    controller.abort();
    const events = await collectEvents(runAgentLoop({
      sessionId: 'session-organize-cancel',
      runId: 'run-organize-cancel',
      messages: [{ role: 'user', content: '整理工作区' }],
      registry: new ToolRegistry(),
      policy: readonlyPolicy,
      signal: controller.signal,
    }));

    expect(streamChatMock).not.toHaveBeenCalled();
    expect(events).toEqual([{
      type: 'run_error',
      runId: 'run-organize-cancel',
      message: '已取消',
      sessionId: 'session-organize-cancel',
    }]);
  });

  it('denies organize writes when the filesystem is read-only', async () => {
    const archiveTool = writeTool('archive_workspace');
    streamChatMock
      .mockReturnValueOnce(modelEvents([{
        type: 'round_complete',
        content: null,
        toolCalls: [{
          id: 'call-organize-deny',
          type: 'function',
          function: { name: 'archive_workspace', arguments: JSON.stringify({ path: 'notes.md' }) },
        }],
      }, { type: 'done' }]))
      .mockReturnValueOnce(modelEvents(textRound('当前没有写入权限，未移动文件')));

    const registry = new ToolRegistry();
    registry.register(archiveTool);
    const events = await collectEvents(runAgentLoop({
      sessionId: 'session-organize-deny',
      runId: 'run-organize-deny',
      messages: [{ role: 'user', content: '把这些文件归档' }],
      registry,
      policy: readonlyPolicy,
    }));

    expect(archiveTool.execute).not.toHaveBeenCalled();
    expect(events).toContainEqual(expect.objectContaining({
      type: 'tool_call_end',
      result: expect.objectContaining({ errorCategory: 'permission_denied' }),
    }));
  });

  it('archives only after the existing write confirmation', async () => {
    const archiveTool = writeTool('archive_workspace');
    setPermissionConfirmer(async () => true);
    streamChatMock
      .mockReturnValueOnce(modelEvents([{
        type: 'round_complete',
        content: null,
        toolCalls: [{
          id: 'call-organize-confirm',
          type: 'function',
          function: { name: 'archive_workspace', arguments: JSON.stringify({ path: 'notes.md' }) },
        }],
      }, { type: 'done' }]))
      .mockReturnValueOnce(modelEvents(textRound('已按确认结果归档')));

    const registry = new ToolRegistry();
    registry.register(archiveTool);
    const events = await collectEvents(runAgentLoop({
      sessionId: 'session-organize-confirm',
      runId: 'run-organize-confirm',
      messages: [{ role: 'user', content: '确认后把纪要归档' }],
      registry,
      policy: confirmWritePolicy,
    }));
    setPermissionConfirmer(async () => false);

    expect(archiveTool.execute).toHaveBeenCalledOnce();
    expect(events).toContainEqual({
      type: 'text_delta',
      runId: 'run-organize-confirm',
      delta: '已按确认结果归档',
    });
  });
});

describe('companion five paths', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    streamChatMock.mockReset();
    setPermissionConfirmer(async () => false);
  });

  it('completes companion chat without tools', async () => {
    streamChatMock.mockReturnValueOnce(modelEvents(textRound('我在，慢慢说就好')));
    const events = await collectEvents(runAgentLoop({
      sessionId: 'session-companion-success',
      runId: 'run-companion-success',
      messages: [{ role: 'user', content: '今天有点累' }],
      registry: new ToolRegistry(),
      policy: readonlyPolicy,
    }));

    expect(events).toEqual([{
      type: 'text_delta',
      runId: 'run-companion-success',
      delta: '我在，慢慢说就好',
    }]);
  });

  it('does not treat a companion tool failure as success', async () => {
    const failingTool: ToolDefinition = {
      name: 'companion_note',
      description: '测试失败',
      parameters: { type: 'object' },
      category: 'skill',
      requiresPermission: [],
      execute: vi.fn(async () => ({ success: false, output: '', error: '保存失败' })),
    };
    streamChatMock
      .mockReturnValueOnce(modelEvents([{
        type: 'round_complete',
        content: null,
        toolCalls: [{
          id: 'call-companion-fail',
          type: 'function',
          function: { name: 'companion_note', arguments: '{}' },
        }],
      }, { type: 'done' }]))
      .mockReturnValueOnce(modelEvents(textRound('这次没有记下，我们继续聊')));

    const registry = new ToolRegistry();
    registry.register(failingTool);
    const events = await collectEvents(runAgentLoop({
      sessionId: 'session-companion-fail',
      runId: 'run-companion-fail',
      messages: [{ role: 'user', content: '陪我聊聊' }],
      registry,
      policy: readonlyPolicy,
    }));

    expect(events).toContainEqual(expect.objectContaining({
      type: 'tool_call_end',
      result: expect.objectContaining({ success: false }),
    }));
    expect(events).toContainEqual({
      type: 'text_delta',
      runId: 'run-companion-fail',
      delta: '这次没有记下，我们继续聊',
    });
  });

  it('stops companion work when the user cancels', async () => {
    const controller = new AbortController();
    controller.abort();
    const events = await collectEvents(runAgentLoop({
      sessionId: 'session-companion-cancel',
      runId: 'run-companion-cancel',
      messages: [{ role: 'user', content: '陪我聊聊' }],
      registry: new ToolRegistry(),
      policy: readonlyPolicy,
      signal: controller.signal,
    }));

    expect(events).toEqual([{
      type: 'run_error',
      runId: 'run-companion-cancel',
      message: '已取消',
      sessionId: 'session-companion-cancel',
    }]);
  });

  it('still denies companion writes through the existing permission layer', async () => {
    const noteTool = writeTool('write_companion_note');
    streamChatMock
      .mockReturnValueOnce(modelEvents([{
        type: 'round_complete',
        content: null,
        toolCalls: [{
          id: 'call-companion-deny',
          type: 'function',
          function: { name: 'write_companion_note', arguments: JSON.stringify({ path: 'mood.md' }) },
        }],
      }, { type: 'done' }]))
      .mockReturnValueOnce(modelEvents(textRound('我没有写入，只继续陪你聊')));

    const registry = new ToolRegistry();
    registry.register(noteTool);
    const events = await collectEvents(runAgentLoop({
      sessionId: 'session-companion-deny',
      runId: 'run-companion-deny',
      messages: [{ role: 'user', content: '把心情写进文件' }],
      registry,
      policy: readonlyPolicy,
    }));

    expect(noteTool.execute).not.toHaveBeenCalled();
    expect(events).toContainEqual(expect.objectContaining({
      type: 'tool_call_end',
      result: expect.objectContaining({ errorCategory: 'permission_denied' }),
    }));
  });

  it('requires confirmation even if companion explicitly asks to write', async () => {
    const noteTool = writeTool('write_companion_note');
    setPermissionConfirmer(async () => true);
    streamChatMock
      .mockReturnValueOnce(modelEvents([{
        type: 'round_complete',
        content: null,
        toolCalls: [{
          id: 'call-companion-confirm',
          type: 'function',
          function: { name: 'write_companion_note', arguments: JSON.stringify({ path: 'mood.md' }) },
        }],
      }, { type: 'done' }]))
      .mockReturnValueOnce(modelEvents(textRound('已按你的确认写下笔记')));

    const registry = new ToolRegistry();
    registry.register(noteTool);
    const events = await collectEvents(runAgentLoop({
      sessionId: 'session-companion-confirm',
      runId: 'run-companion-confirm',
      messages: [{ role: 'user', content: '请把这句话写进工作区' }],
      registry,
      policy: confirmWritePolicy,
    }));
    setPermissionConfirmer(async () => false);

    expect(noteTool.execute).toHaveBeenCalledOnce();
    expect(events).toContainEqual({
      type: 'text_delta',
      runId: 'run-companion-confirm',
      delta: '已按你的确认写下笔记',
    });
  });
});
