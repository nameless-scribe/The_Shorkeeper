import { lookup } from 'node:dns/promises';
import http, { type IncomingMessage } from 'node:http';
import https from 'node:https';
import { BlockList, isIP, type LookupFunction } from 'node:net';
import type { ToolDefinition } from '../types';

const MAX_BYTES = 64_000;
const MAX_REDIRECTS = 5;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

const BLOCKED_IPV4 = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  BLOCKED_IPV4.addSubnet(network, prefix, 'ipv4');
}
const BLOCKED_IPV6 = new BlockList();
for (const [network, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['::ffff:0:0', 96],
  ['64:ff9b::', 96],
  ['64:ff9b:1::', 48],
  ['100::', 64],
  ['2001:10::', 28],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
] as const) {
  BLOCKED_IPV6.addSubnet(network, prefix, 'ipv6');
}

interface ResolvedAddress {
  address: string;
  family: 4 | 6;
}

interface PinnedResponse {
  status: number;
  contentType: string;
  location?: string;
  body: Buffer;
  truncated: boolean;
}

export function isPublicAddress(address: string): boolean {
  const normalized = address.split('%', 1)[0];
  const family = isIP(normalized);
  if (family === 4) return !BLOCKED_IPV4.check(normalized, 'ipv4');
  if (family === 6) return !BLOCKED_IPV6.check(normalized, 'ipv6');
  return false;
}

async function resolvePublicAddress(hostname: string): Promise<ResolvedAddress> {
  const bareHostname = hostname.replace(/^\[/, '').replace(/\]$/, '');
  if (bareHostname === 'localhost' || bareHostname.toLowerCase().endsWith('.localhost')) {
    throw new Error('不允许访问本地或私有网络地址');
  }

  const literalFamily = isIP(bareHostname);
  const answers = literalFamily
    ? [{ address: bareHostname, family: literalFamily }]
    : await lookup(bareHostname, { all: true, verbatim: true });

  if (!answers.length || answers.some((answer) => !isPublicAddress(answer.address))) {
    throw new Error('不允许访问本地或私有网络地址');
  }

  const selected = answers[0];
  return { address: selected.address, family: selected.family as 4 | 6 };
}

export async function readLimitedBody(
  response: IncomingMessage,
  maxBytes = MAX_BYTES,
): Promise<{ body: Buffer; truncated: boolean }> {
  const chunks: Buffer[] = [];
  let total = 0;

  for await (const rawChunk of response) {
    const chunk = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk);
    const remaining = maxBytes - total;
    if (remaining <= 0) {
      response.destroy();
      return { body: Buffer.concat(chunks, total), truncated: true };
    }
    if (chunk.length > remaining) {
      chunks.push(chunk.subarray(0, remaining));
      total += remaining;
      response.destroy();
      return { body: Buffer.concat(chunks, total), truncated: true };
    }
    chunks.push(chunk);
    total += chunk.length;
  }

  return { body: Buffer.concat(chunks, total), truncated: false };
}

async function requestPinned(url: URL, signal: AbortSignal): Promise<PinnedResponse> {
  const resolved = await resolvePublicAddress(url.hostname);
  const client = url.protocol === 'https:' ? https : http;
  const pinnedLookup: LookupFunction = (_hostname, _options, callback) => {
    callback(null, resolved.address, resolved.family);
  };

  return new Promise<PinnedResponse>((resolve, reject) => {
    const request = client.request(
      url,
      {
        method: 'GET',
        signal,
        lookup: pinnedLookup,
        headers: {
          'User-Agent': 'TheShorekeeper/1.0',
          Accept: 'text/html,text/plain,application/json;q=0.9,*/*;q=0.5',
        },
      },
      (response) => {
        const status = response.statusCode ?? 0;
        const location = response.headers.location;
        const contentType = String(response.headers['content-type'] ?? '');

        if (REDIRECT_STATUSES.has(status) && location) {
          response.resume();
          resolve({ status, location, contentType, body: Buffer.alloc(0), truncated: false });
          return;
        }

        if (status < 200 || status >= 300) {
          response.resume();
          resolve({ status, contentType, body: Buffer.alloc(0), truncated: false });
          return;
        }

        void readLimitedBody(response).then(
          ({ body, truncated }) => resolve({ status, contentType, body, truncated }),
          reject,
        );
      },
    );
    request.on('error', reject);
    request.end();
  });
}

async function fetchPublicUrl(initialUrl: URL, signal: AbortSignal): Promise<PinnedResponse> {
  let current = initialUrl;

  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    if (signal.aborted) throw new DOMException('已取消', 'AbortError');
    const response = await requestPinned(current, signal);
    if (!response.location || !REDIRECT_STATUSES.has(response.status)) return response;
    if (redirects === MAX_REDIRECTS) throw new Error('重定向次数过多');

    const next = new URL(response.location, current);
    if (next.protocol !== 'http:' && next.protocol !== 'https:') {
      throw new Error('重定向目标仅支持 http/https');
    }
    current = next;
  }

  throw new Error('重定向次数过多');
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

    if (ctx.signal.aborted) {
      return { success: false, output: '', error: '已取消' };
    }

    try {
      const response = await fetchPublicUrl(parsed, ctx.signal);
      if (response.status < 200 || response.status >= 300) {
        return {
          success: false,
          output: '',
          error: `请求失败: HTTP ${response.status}`,
        };
      }

      let text = response.body.toString('utf-8');
      if (response.contentType.includes('html') || text.includes('<html')) {
        text = stripHtml(text);
      }

      const suffix = response.truncated ? `\n\n（内容已截断至 ${MAX_BYTES} 字节）` : '';
      return {
        success: true,
        output: `${text}${suffix}`.trim() || '（页面无可见文本）',
      };
    } catch (err) {
      if (ctx.signal.aborted) {
        return { success: false, output: '', error: '已取消' };
      }
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, output: '', error: message };
    }
  },
};
