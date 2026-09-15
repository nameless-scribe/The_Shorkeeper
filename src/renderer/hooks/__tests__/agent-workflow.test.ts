import { describe, expect, it } from 'vitest';
import { deriveAgentWorkflow } from '../agent-workflow';
import type { UiMessage } from '../useAgentEvents';

describe('deriveAgentWorkflow', () => {
  it('returns idle when not running', () => {
    const status = deriveAgentWorkflow([], false, null);
    expect(status.mode).toBe('idle');
    expect(status.headline).toBe('就绪');
  });

  it('reports a pending question ahead of everything else (P6.1)', () => {
    const status = deriveAgentWorkflow([], true, null, {
      requestId: 'q1', question: '改哪一份报价单？', options: [], allowFreeText: true,
    });
    expect(status.mode).toBe('question');
    expect(status.headline).toBe('等待回答');
    expect(status.detail).toBe('改哪一份报价单？');
    expect(status.steps.find((s) => s.id === 'tool')?.state).toBe('active');
  });

  it('shows thinking phase for streaming assistant without content', () => {
    const messages: UiMessage[] = [
      {
        id: 'stream-1',
        role: 'assistant',
        content: '',
        streaming: true,
        thinking: true,
      },
    ];
    const status = deriveAgentWorkflow(messages, true, null);
    expect(status.mode).toBe('running');
    expect(status.headline).toBe('思考中');
    expect(status.steps.find((s) => s.id === 'think')?.state).toBe('active');
  });

  it('shows tool phase when a tool is running', () => {
    const messages: UiMessage[] = [
      {
        id: 'stream-1',
        role: 'assistant',
        content: '',
        streaming: true,
        toolCalls: [
          {
            callId: 'c1',
            name: 'read_file',
            args: { path: 'a.txt' },
            status: 'running',
          },
        ],
      },
    ];
    const status = deriveAgentWorkflow(messages, true, null);
    expect(status.headline).toBe('执行工具');
    expect(status.detail).toBe('读取文件');
  });

  it('shows permission wait state', () => {
    const status = deriveAgentWorkflow([], true, {
      requestId: 'r1',
      toolName: 'write_file',
      args: {},
    });
    expect(status.mode).toBe('permission');
    expect(status.headline).toBe('等待确认');
  });
});
