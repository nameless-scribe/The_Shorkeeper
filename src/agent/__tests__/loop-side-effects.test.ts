import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModelEvent } from '../../shared/types';
import type { PermissionPolicy } from '../types';
import { ToolRegistry } from '../../tools/registry';
import type { ToolDefinition } from '../../tools/types';
import { LOCAL_APPEND_CONTRACT, READ_ONLY_CONTRACT, WORKSPACE_WRITE_CONTRACT } from '../../tools/contract';
import { writeWorkspaceFileAtomically } from '../../tools/file/artifact';
import { setPermissionConfirmer } from '../permissions';

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
  filesystem: { allowedRoots: [], writeAllowed: true, requireConfirmOnWrite: false },
  network: true,
  mcp: false,
  automation: { allowed: true, requireConfirm: false },
  shell: { allowed: false, requireConfirm: true },
};

async function* modelEvents(events: ModelEvent[]): AsyncGenerator<ModelEvent> {
  yield* events;
}

function toolRound(calls: Array<{ id: string; name: string; args?: unknown }>): AsyncGenerator<ModelEvent> {
  return modelEvents([
    {
      type: 'round_complete',
      content: null,
      toolCalls: calls.map((call) => ({
        id: call.id,
        type: 'function' as const,
        function: { name: call.name, arguments: JSON.stringify(call.args ?? {}) },
      })),
    },
    { type: 'done' },
  ]);
}

function textRound(text: string): AsyncGenerator<ModelEvent> {
  return modelEvents([
    { type: 'text_delta', delta: text },
    { type: 'round_complete', content: text, toolCalls: [] },
    { type: 'done' },
  ]);
}

async function collect(generator: AsyncGenerator<unknown>) {
  const events: unknown[] = [];
  for await (const event of generator) events.push(event);
  return events;
}

function toolEnds(events: unknown[]) {
  return events.filter((event): event is { type: 'tool_call_end'; callId: string; result: { success: boolean; output: string; error?: string; metadata?: Record<string, unknown> } } =>
    (event as { type?: string }).type === 'tool_call_end');
}

describe('agent loop side-effect contract', () => {
  let workspace: string;

  beforeEach(async () => {
    streamChatMock.mockReset();
    workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'sk-loop-side-effects-'));
    process.env.SHOREKEEPER_WORKSPACE_DIR = workspace;
  });

  afterEach(async () => {
    delete process.env.SHOREKEEPER_WORKSPACE_DIR;
    setPermissionConfirmer(async () => false);
    await fs.rm(workspace, { recursive: true, force: true });
  });

  it('merges a repeated non-idempotent call with identical arguments instead of re-executing it', async () => {
    let counter = 0;
    const appendTool: ToolDefinition = {
      name: 'append_record',
      description: 'test',
      parameters: { type: 'object' },
      category: 'life',
      requiresPermission: [],
      sideEffects: LOCAL_APPEND_CONTRACT,
      execute: vi.fn(async () => ({ success: true, output: `记录 #${++counter}` })),
    };
    streamChatMock
      .mockReturnValueOnce(toolRound([
        { id: 'c1', name: 'append_record', args: { note: 'a' } },
        { id: 'c2', name: 'append_record', args: { note: 'a' } },
        { id: 'c3', name: 'append_record', args: { note: 'b' } },
      ]))
      .mockReturnValueOnce(textRound('完成'));

    const registry = new ToolRegistry();
    registry.register(appendTool);
    const events = await collect(runAgentLoop({
      sessionId: 's', runId: 'r', messages: [{ role: 'user', content: '记两条' }], registry, policy,
    }));

    expect(appendTool.execute).toHaveBeenCalledTimes(2);
    const ends = toolEnds(events);
    expect(ends.map((end) => end.callId)).toEqual(['c1', 'c2', 'c3']);
    expect(ends[0].result.output).toBe('记录 #1');
    expect(ends[1].result.metadata).toMatchObject({ duplicateSuppressed: true });
    expect(ends[1].result.output).toContain('[重复调用已合并]');
    expect(ends[1].result.output).toContain('记录 #1');
    expect(ends[2].result.output).toBe('记录 #2');
  });

  it('does not merge repeated calls of idempotent or read-only tools', async () => {
    const listTool: ToolDefinition = {
      name: 'list_things',
      description: 'test',
      parameters: { type: 'object' },
      category: 'life',
      requiresPermission: [],
      sideEffects: READ_ONLY_CONTRACT,
      execute: vi.fn(async () => ({ success: true, output: 'list' })),
    };
    streamChatMock
      .mockReturnValueOnce(toolRound([
        { id: 'c1', name: 'list_things' },
        { id: 'c2', name: 'list_things' },
      ]))
      .mockReturnValueOnce(textRound('完成'));

    const registry = new ToolRegistry();
    registry.register(listTool);
    const events = await collect(runAgentLoop({
      sessionId: 's', runId: 'r', messages: [{ role: 'user', content: '列两次' }], registry, policy,
    }));

    expect(listTool.execute).toHaveBeenCalledTimes(2);
    expect(toolEnds(events).every((end) => !end.result.metadata?.duplicateSuppressed)).toBe(true);
  });

  it('uses the per-call contract so read actions of a mixed tool are never served stale results', async () => {
    let total = 0;
    const ledger: ToolDefinition = {
      name: 'ledger',
      description: 'test',
      parameters: { type: 'object' },
      category: 'life',
      requiresPermission: [],
      sideEffects: LOCAL_APPEND_CONTRACT,
      describeCall: (args) => ((args as { action?: string }).action === 'add' ? {} : { risk: 'read', idempotent: true }),
      execute: vi.fn(async (args) => {
        const { action, amount } = args as { action: string; amount?: number };
        if (action === 'add') total += amount ?? 0;
        return { success: true, output: action === 'add' ? `已记 ${amount}` : `合计 ${total}` };
      }),
    };
    streamChatMock
      .mockReturnValueOnce(toolRound([
        { id: 'c1', name: 'ledger', args: { action: 'summary' } },
        { id: 'c2', name: 'ledger', args: { action: 'add', amount: 50 } },
        { id: 'c3', name: 'ledger', args: { action: 'summary' } },
        { id: 'c4', name: 'ledger', args: { action: 'add', amount: 50 } },
      ]))
      .mockReturnValueOnce(textRound('完成'));

    const registry = new ToolRegistry();
    registry.register(ledger);
    const events = await collect(runAgentLoop({
      sessionId: 's', runId: 'r', messages: [{ role: 'user', content: '记账' }], registry, policy,
    }));

    const ends = toolEnds(events);
    expect(ends[0].result.output).toBe('合计 0');
    expect(ends[2].result.output).toBe('合计 50');
    expect(ends[3].result.metadata).toMatchObject({ duplicateSuppressed: true });
    expect(total).toBe(50);
  });

  it('does not count the user confirmation wait against the tool execution timeout', async () => {
    setPermissionConfirmer(() => new Promise((resolve) => setTimeout(() => resolve(true), 120)));
    const slowApprove: ToolDefinition = {
      name: 'needs_confirm',
      description: 'test',
      parameters: { type: 'object' },
      category: 'life',
      requiresPermission: ['automation'],
      sideEffects: { risk: 'medium', idempotent: true, supportsPreview: false, reversible: 'manual', evidence: 'output' },
      execute: vi.fn(async () => ({ success: true, output: '执行成功' })),
    };
    streamChatMock
      .mockReturnValueOnce(toolRound([{ id: 'c1', name: 'needs_confirm' }]))
      .mockReturnValueOnce(textRound('完成'));

    const registry = new ToolRegistry();
    registry.register(slowApprove);
    const events = await collect(runAgentLoop({
      sessionId: 's', runId: 'r', messages: [{ role: 'user', content: 'x' }], registry,
      policy: { ...policy, automation: { allowed: true, requireConfirm: true } },
      toolTimeoutMs: 40,
    }));

    expect(slowApprove.execute).toHaveBeenCalledOnce();
    expect(toolEnds(events)[0].result).toMatchObject({ success: true, output: '执行成功' });
  });

  it('does not treat a failed side-effect call as a completed one for later retries', async () => {
    let attempt = 0;
    const flakyTool: ToolDefinition = {
      name: 'flaky_append',
      description: 'test',
      parameters: { type: 'object' },
      category: 'life',
      requiresPermission: [],
      sideEffects: LOCAL_APPEND_CONTRACT,
      execute: vi.fn(async () => (++attempt === 1
        ? { success: false, output: '', error: '暂时失败' }
        : { success: true, output: '第二次成功' })),
    };
    streamChatMock
      .mockReturnValueOnce(toolRound([{ id: 'c1', name: 'flaky_append', args: { x: 1 } }]))
      .mockReturnValueOnce(toolRound([{ id: 'c2', name: 'flaky_append', args: { x: 1 } }]))
      .mockReturnValueOnce(textRound('完成'));

    const registry = new ToolRegistry();
    registry.register(flakyTool);
    const events = await collect(runAgentLoop({
      sessionId: 's', runId: 'r', messages: [{ role: 'user', content: '重试' }], registry, policy,
    }));

    expect(flakyTool.execute).toHaveBeenCalledTimes(2);
    expect(toolEnds(events)[1].result).toMatchObject({ success: true, output: '第二次成功' });
  });

  it('downgrades a write tool that claims success without a readable artifact', async () => {
    const fakeWrite: ToolDefinition = {
      name: 'fake_write',
      description: 'test',
      parameters: { type: 'object' },
      category: 'file',
      requiresPermission: ['filesystem:write'],
      sideEffects: WORKSPACE_WRITE_CONTRACT,
      execute: vi.fn(async () => ({ success: true, output: '已写入（其实没有）' })),
    };
    const realWrite: ToolDefinition = {
      name: 'real_write',
      description: 'test',
      parameters: { type: 'object' },
      category: 'file',
      requiresPermission: ['filesystem:write'],
      sideEffects: WORKSPACE_WRITE_CONTRACT,
      execute: async (_args, ctx) => {
        const artifact = await writeWorkspaceFileAtomically(
          ctx.workspaceRoot,
          'out/real.md',
          (temporaryPath) => fs.writeFile(temporaryPath, '# real', 'utf-8'),
        );
        return { success: true, output: '已写入', artifacts: [artifact] };
      },
    };
    streamChatMock
      .mockReturnValueOnce(toolRound([
        { id: 'c1', name: 'fake_write', args: { path: 'out/fake.md' } },
        { id: 'c2', name: 'real_write', args: { path: 'out/real.md' } },
      ]))
      .mockReturnValueOnce(textRound('完成'));

    const registry = new ToolRegistry();
    registry.register(fakeWrite);
    registry.register(realWrite);
    const events = await collect(runAgentLoop({
      sessionId: 's', runId: 'r', messages: [{ role: 'user', content: '写文件' }], registry,
      policy: { ...policy, filesystem: { allowedRoots: [workspace], writeAllowed: true, requireConfirmOnWrite: false } },
    }));

    const ends = toolEnds(events);
    expect(ends[0].result.success).toBe(false);
    expect(ends[0].result.error).toContain('完成证据校验失败');
    expect(ends[1].result.success).toBe(true);
    expect(ends[1].result.metadata).toMatchObject({ evidenceVerified: true });
  });

  it('passes run, session and risk context into permission confirmation', async () => {
    const received: unknown[] = [];
    setPermissionConfirmer(async (_tool, _args, _signal, context) => {
      received.push(context);
      return true;
    });
    const automationTool: ToolDefinition = {
      name: 'create_thing',
      description: 'test',
      parameters: { type: 'object' },
      category: 'life',
      requiresPermission: ['automation'],
      sideEffects: { risk: 'medium', idempotent: false, supportsPreview: false, reversible: 'manual', evidence: 'output' },
      execute: vi.fn(async () => ({ success: true, output: 'ok' })),
    };
    streamChatMock
      .mockReturnValueOnce(toolRound([{ id: 'c1', name: 'create_thing' }]))
      .mockReturnValueOnce(textRound('完成'));

    const registry = new ToolRegistry();
    registry.register(automationTool);
    await collect(runAgentLoop({
      sessionId: 'session-ctx', runId: 'run-ctx', messages: [{ role: 'user', content: 'x' }], registry,
      policy: { ...policy, automation: { allowed: true, requireConfirm: true } },
    }));

    expect(received).toEqual([{ runId: 'run-ctx', sessionId: 'session-ctx', risk: 'medium' }]);
    expect(automationTool.execute).toHaveBeenCalledOnce();
  });
});
