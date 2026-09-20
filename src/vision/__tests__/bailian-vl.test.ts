import { describe, expect, it } from 'vitest';
import { askVisionModel, buildVisionRequestBody, VisionRequestError } from '../bailian-vl';

const endpoint = { baseUrl: 'https://example.test/compatible-mode/v1/', apiKey: 'sk-secret', model: 'qwen3-vl-plus' };
const images = [{ name: 'a.png', dataUrl: 'data:image/png;base64,AAAA' }];

function jsonResponse(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}): Response {
  return new Response(JSON.stringify(body), { status: init.status ?? 200, headers: { 'content-type': 'application/json', ...(init.headers ?? {}) } });
}

describe('buildVisionRequestBody', () => {
  it('puts the prompt and every image into one user message, disables thinking and streaming', () => {
    const body = buildVisionRequestBody({ images: [...images, { name: 'b.png', dataUrl: 'data:image/png;base64,BBBB' }], question: '这是什么', mode: 'answer', model: 'm' });
    expect(body.model).toBe('m');
    expect(body.stream).toBe(false);
    expect(body.enable_thinking).toBe(false);
    expect(body.max_tokens).toBe(1024);
    const content = (body.messages as Array<{ content: Array<Record<string, unknown>> }>)[0].content;
    expect(content[0]).toMatchObject({ type: 'text' });
    expect((content[0].text as string)).toContain('这是什么');
    expect(content[1]).toEqual({ type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } });
    expect(content).toHaveLength(3);
    expect(buildVisionRequestBody({ images, question: 'q', mode: 'read_text', model: 'm' }).max_tokens).toBe(4096);
  });
});

describe('askVisionModel', () => {
  it('posts to /chat/completions with the bearer key and parses answer, usage and request id', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} });
      return jsonResponse({ id: 'chatcmpl-1', choices: [{ message: { content: '一台立式加工中心' } }], usage: { prompt_tokens: 1200, completion_tokens: 12 } }, { headers: { 'x-request-id': 'req-9' } });
    };
    const response = await askVisionModel({ images, question: '这是什么', mode: 'answer', endpoint, fetchImpl });
    expect(response).toEqual({ answer: '一台立式加工中心', requestId: 'req-9', model: 'qwen3-vl-plus', promptTokens: 1200, completionTokens: 12 });
    expect(calls[0].url).toBe('https://example.test/compatible-mode/v1/chat/completions');
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer sk-secret');
    expect(JSON.parse(String(calls[0].init.body)).enable_thinking).toBe(false);
  });

  it('accepts array content and falls back to the body id when there is no header', async () => {
    const fetchImpl: typeof fetch = async () => jsonResponse({ id: 'body-id', choices: [{ message: { content: [{ type: 'text', text: '图号 ' }, { type: 'text', text: 'A-12' }] } }] });
    const response = await askVisionModel({ images, question: 'q', mode: 'read_text', endpoint, fetchImpl });
    expect(response.answer).toBe('图号 A-12');
    expect(response.requestId).toBe('body-id');
    expect(response.promptTokens).toBeNull();
  });

  it('rejects length-truncated answers even when the provider returned partial text', async () => {
    const fetchImpl: typeof fetch = async () => jsonResponse({
      id: 'truncated-1',
      choices: [{ message: { content: '只返回了一半' }, finish_reason: 'length' }],
    });
    await expect(askVisionModel({ images, question: '抄录全部文字', mode: 'read_text', endpoint, fetchImpl }))
      .rejects.toMatchObject({
        kind: 'truncated',
        requestId: 'truncated-1',
        message: expect.stringContaining('回答不完整'),
      });
  });

  it('turns 4xx into an http error with status, code and request id', async () => {
    const fetchImpl: typeof fetch = async () => jsonResponse({ error: { message: 'model not found', code: 'InvalidParameter' }, id: 'err-1' }, { status: 404 });
    await expect(askVisionModel({ images, question: 'q', mode: 'answer', endpoint, fetchImpl })).rejects.toMatchObject({ kind: 'http', status: 404, requestId: 'err-1', message: expect.stringContaining('InvalidParameter') });
  });

  it('classifies timeouts, cancellations, malformed and empty responses', async () => {
    const hang: typeof fetch = (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      });
    await expect(askVisionModel({ images, question: 'q', mode: 'answer', endpoint, fetchImpl: hang, timeoutMs: 20 })).rejects.toMatchObject({ kind: 'timeout' });

    const controller = new AbortController();
    const pending = askVisionModel({ images, question: 'q', mode: 'answer', endpoint, fetchImpl: hang, signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ kind: 'cancelled' });

    const garbage: typeof fetch = async () => new Response('<html>', { status: 200 });
    await expect(askVisionModel({ images, question: 'q', mode: 'answer', endpoint, fetchImpl: garbage })).rejects.toMatchObject({ kind: 'malformed' });

    const empty: typeof fetch = async () => jsonResponse({ choices: [{ message: { content: '' } }] });
    await expect(askVisionModel({ images, question: 'q', mode: 'answer', endpoint, fetchImpl: empty })).rejects.toBeInstanceOf(VisionRequestError);

    const down: typeof fetch = async () => {
      throw new Error('ECONNREFUSED');
    };
    await expect(askVisionModel({ images, question: 'q', mode: 'answer', endpoint, fetchImpl: down })).rejects.toMatchObject({ kind: 'network' });
  });
});
