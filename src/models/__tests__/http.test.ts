import { afterEach, describe, expect, it, vi } from 'vitest';
import { createModelHttpError, fetchModelResponse } from '../http';

describe('model HTTP boundaries', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('retries a transient response before any stream output is consumed', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('busy', { status: 429 }))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const response = await fetchModelResponse(
      'https://example.test/chat/completions',
      { method: 'POST' },
      { retryDelayMs: 0 },
    );

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not retry permanent authentication failures or expose their body', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      'secret upstream details and echoed prompt',
      {
        status: 401,
        headers: { 'x-request-id': 'request-123' },
      },
    ));
    vi.stubGlobal('fetch', fetchMock);

    const response = await fetchModelResponse(
      'https://example.test/chat/completions',
      { method: 'POST' },
      { retryDelayMs: 0 },
    );
    const error = await createModelHttpError(response);

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(error.message).toContain('API Key 无效');
    expect(error.message).toContain('request-123');
    expect(error.message).not.toContain('secret upstream');
  });
});
