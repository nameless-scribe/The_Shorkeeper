import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../config', () => ({
  shouldIncludeStreamUsage: vi.fn(() => false),
  shouldUseExplicitCache: vi.fn(() => false),
}));
vi.mock('../../db/token-usage', () => ({ recordTokenUsage: vi.fn() }));

import { streamChat as streamOpenAI } from '../openai-compatible';
import { streamChatAnthropic } from '../anthropic-like';

const config = {
  apiKey: 'test-key',
  baseUrl: 'https://example.test/v1',
  model: 'test-model',
};

function streamingResponse(payload: string, cancel: ReturnType<typeof vi.fn>) {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
    },
    cancel: cancel as unknown as UnderlyingSourceCancelCallback,
  });
  return { ok: true, body };
}

function completedStreamingResponse(payloads: string[]) {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(
        payloads.map((payload) => `data: ${payload}\n\n`).join(''),
      ));
      controller.close();
    },
  });
  return { ok: true, status: 200, body };
}

describe('model stream resource cleanup', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('cancels the OpenAI response reader when the consumer closes early', async () => {
    const cancel = vi.fn();
    vi.stubGlobal('fetch', vi.fn(async () => streamingResponse(JSON.stringify({
      choices: [{ delta: { content: '部分回复' } }],
    }), cancel)));

    const iterator = streamOpenAI([{ role: 'user', content: '你好' }], config)[Symbol.asyncIterator]();
    await expect(iterator.next()).resolves.toMatchObject({
      value: { type: 'text_delta', delta: '部分回复' },
    });
    await iterator.return?.(undefined);

    expect(cancel).toHaveBeenCalledOnce();
  });

  it('cancels the Anthropic response reader when the consumer closes early', async () => {
    const cancel = vi.fn();
    vi.stubGlobal('fetch', vi.fn(async () => streamingResponse(JSON.stringify({
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'text_delta', text: '部分回复' },
    }), cancel)));

    const iterator = streamChatAnthropic(
      [{ role: 'user', content: '你好' }],
      config,
    )[Symbol.asyncIterator]();
    await expect(iterator.next()).resolves.toMatchObject({
      value: { type: 'text_delta', delta: '部分回复' },
    });
    await iterator.return?.(undefined);

    expect(cancel).toHaveBeenCalledOnce();
  });

  it('keeps an OpenAI tool call whose provider id is missing for loop normalization', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => completedStreamingResponse([
      JSON.stringify({
        choices: [{
          delta: {
            tool_calls: [{
              index: 0,
              function: { name: 'read_file', arguments: '{"path":"a.txt"}' },
            }],
          },
        }],
      }),
      '[DONE]',
    ])));

    const events = [];
    for await (const event of streamOpenAI([{ role: 'user', content: '读取' }], config)) {
      events.push(event);
    }

    expect(events).toContainEqual(expect.objectContaining({
      type: 'round_complete',
      toolCalls: [expect.objectContaining({
        id: '',
        function: expect.objectContaining({ name: 'read_file' }),
      })],
    }));
  });
});
