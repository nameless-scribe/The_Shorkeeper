import type { ToolDefinition } from '../types';

const MAX_BYTES = 64_000;

function isBlockedHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  if (host === '0.0.0.0') return true;

  const bare = host.replace(/^\[/, '').replace(/\]$/, '');
  if (bare.includes(':')) {
    if (bare === '::1') return true;
    if (bare.startsWith('fe80:') || bare.startsWith('fc') || bare.startsWith('fd')) return true;
  }

  const parts = bare.split('.').map((p) => Number.parseInt(p, 10));
  if (parts.length === 4 && parts.every((n) => Number.isFinite(n))) {
    const [a, b] = parts;
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 0) return true;
  }

  return false;
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export const fetchUrlTool: ToolDefinition = {
  name: 'fetch_url',
  description: '抓取指定 URL 的网页文本内容（自动去除 HTML 标签）',
  category: 'web',
  requiresPermission: ['network'],
  parameters: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: '要抓取的 http(s) URL',
      },
    },
    required: ['url'],
  },
  async execute(args, ctx) {
    const { url } = args as { url?: string };
    if (!url?.trim()) {
      return { success: false, output: '', error: '缺少 url 参数' };
    }

    let parsed: URL;
    try {
      parsed = new URL(url.trim());
    } catch {
      return { success: false, output: '', error: '无效的 URL' };
    }

    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return { success: false, output: '', error: '仅支持 http/https' };
    }

    if (isBlockedHost(parsed.hostname)) {
      return { success: false, output: '', error: '不允许访问本地或私有网络地址' };
    }

    if (ctx.signal.aborted) {
      return { success: false, output: '', error: '已取消' };
    }

    try {
      const response = await fetch(parsed.toString(), {
        signal: ctx.signal,
        headers: { 'User-Agent': 'TheShorekeeper/1.0' },
      });

      if (!response.ok) {
        return {
          success: false,
          output: '',
          error: `请求失败: HTTP ${response.status}`,
        };
      }

      const contentType = response.headers.get('content-type') ?? '';
      const buffer = Buffer.from(await response.arrayBuffer());
      const truncated = buffer.subarray(0, MAX_BYTES);
      let text = truncated.toString('utf-8');

      if (contentType.includes('html') || text.includes('<html')) {
        text = stripHtml(text);
      }

      const suffix =
        buffer.length > MAX_BYTES ? `\n\n（内容已截断至 ${MAX_BYTES} 字节）` : '';

      return {
        success: true,
        output: `${text}${suffix}`.trim() || '（页面无可见文本）',
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, output: '', error: message };
    }
  },
};
