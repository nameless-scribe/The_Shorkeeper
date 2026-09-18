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
  it.each([
    { stream: streamOpenAI, payloads: [JSON.stringify({ choices: [{ delta: { content: '截断' }, finish_reason: 'length' }] }), '[DONE]'], reason: 'length' },
    { stream: streamChatAnthropic, payloads: [JSON.stringify({ type: 'message_delta', delta: { stop_reason: 'max_tokens' } }), JSON.stringify({ type: 'message_stop' })], reason: 'max_tokens' },
  ])('propagates provider truncation reason $reason', async ({ stream, payloads, reason }) => {
    vi.stubGlobal('fetch', vi.fn(async () => completedStreamingResponse(payloads)));
    const events = [];
    for await (const event of stream([{ role: 'user', content: '收尾' }], config)) events.push(event);
    expect(events).toContainEqual(expect.objectContaining({ type: 'round_complete', stopReason: reason }));
  });
  it.each([streamOpenAI, streamChatAnthropic])('sends a bounded output allowance and omits tools for finalization', async (stream) => {
    const fetch = vi.fn(async () => completedStreamingResponse([]));
    vi.stubGlobal('fetch', fetch);
    for await (const _event of stream([{ role: 'user', content: '收尾' }], config, { maxOutputTokens: 2000 })) {
      // drain
    }
    const request = JSON.parse((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(request.max_tokens).toBe(2000);
    expect(request.tools).toBeUndefined();
    expect(request.tool_choice).toBeUndefined();
  });
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
