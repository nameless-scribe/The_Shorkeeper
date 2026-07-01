import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBochaProvider, formatWebSearchOutput } from '../search-providers/bocha';

describe('bocha web search provider', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.WEB_SEARCH_API_KEY;
  });

  it('formats web pages from bocha response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        text: async () =>
          JSON.stringify({
            code: 200,
            data: {
              webPages: {
                value: [
                  {
                    name: '今日热搜榜',
                    url: 'https://example.com/hot',
                    snippet: '某话题登上热搜第一',
                    siteName: '示例站',
                    datePublished: '2026-07-01',
                  },
                ],
              },
            },
          }),
      }),
    );

    const provider = createBochaProvider('test-key');
    const result = await provider.search('今日热搜', new AbortController().signal);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].title).toBe('今日热搜榜');

    const output = formatWebSearchOutput('今日热搜', result);
    expect(output).toContain('博查');
    expect(output).toContain('今日热搜榜');
  });
});
