/**
 * 腾讯云 TC3-HMAC-SHA256 请求签名。纯函数，不发请求、不读配置。
 *
 * 为什么自己写而不引 `tencentcloud-sdk-nodejs`：签名本身不到百行，
 * 而 SDK 会带进一整套请求/重试/模型定义，与 `AGENTS.md`"不引入平行体系"相悖，
 * 也会明显增加打包体积。本仓库只需要一个接口。
 *
 * 算法与下面的测试向量取自腾讯云「签名方法 v3」官方文档。
 * 注意：官方示例里的 SecretId / SecretKey 是打码的，**最终签名值不可复现**，
 * 因此测试只能锁到"规范请求串"和"待签字符串"这两层（它们与密钥无关且官方给了完整文本）。
 * 派生与最终摘要的正确性只能靠一次真实调用确认——见 P4 计划 2.5。
 */
import { createHash, createHmac } from 'node:crypto';

export const TC3_ALGORITHM = 'TC3-HMAC-SHA256';

function sha256Hex(payload: string | Uint8Array): string {
  return createHash('sha256').update(payload).digest('hex');
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest();
}

/** UTC 日期 yyyy-mm-dd。必须用 UTC：用本地日期会在跨时区/跨零点时签出无效签名。 */
export function utcDateStamp(timestampSeconds: number): string {
  const date = new Date(timestampSeconds * 1000);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

export interface CanonicalHeaderInput {
  /** 头名，大小写随意，内部会转小写 */
  name: string;
  value: string;
}

export interface CanonicalHeaders {
  canonical: string;
  signed: string;
}

/**
 * 规范头部。规则：名转小写、值去首尾空白、按名的 ASCII 升序、每行以 \n 结尾。
 * 注意 `x-tc-action` 的**值也要转小写**——这是官方示例里一个容易漏掉的点。
 */
export function buildCanonicalHeaders(headers: readonly CanonicalHeaderInput[]): CanonicalHeaders {
  const normalized = headers
    .map(({ name, value }) => {
      const key = name.trim().toLowerCase();
      const raw = value.trim();
      return { key, value: key === 'x-tc-action' ? raw.toLowerCase() : raw };
    })
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

  return {
    canonical: normalized.map(({ key, value }) => `${key}:${value}\n`).join(''),
    signed: normalized.map(({ key }) => key).join(';'),
  };
}

export interface CanonicalRequestInput {
  method: 'GET' | 'POST';
  /** 规范 URI，腾讯云 API 一律为 '/' */
  uri: string;
  /** GET 用查询串，POST 为空串 */
  queryString: string;
  headers: readonly CanonicalHeaderInput[];
  /** 请求体原文；二进制请求体直接传字节 */
  payload: string | Uint8Array;
}

export interface CanonicalRequest {
  text: string;
  signedHeaders: string;
  hashedPayload: string;
}

export function buildCanonicalRequest(input: CanonicalRequestInput): CanonicalRequest {
  const { canonical, signed } = buildCanonicalHeaders(input.headers);
  const hashedPayload = sha256Hex(input.payload);
  const text = [
    input.method,
    input.uri,
    input.queryString,
    canonical,
    signed,
    hashedPayload,
  ].join('\n');
  return { text, signedHeaders: signed, hashedPayload };
}

export function buildCredentialScope(dateStamp: string, service: string): string {
  return `${dateStamp}/${service}/tc3_request`;
}

export function buildStringToSign(
  timestampSeconds: number,
  credentialScope: string,
  canonicalRequestText: string,
): string {
  return [
    TC3_ALGORITHM,
    String(timestampSeconds),
    credentialScope,
    sha256Hex(canonicalRequestText),
  ].join('\n');
}

/** 三次 HMAC 派生签名密钥：TC3+SecretKey → 日期 → 服务 → tc3_request。 */
export function deriveSigningKey(secretKey: string, dateStamp: string, service: string): Buffer {
  const secretDate = hmac(`TC3${secretKey}`, dateStamp);
  const secretService = hmac(secretDate, service);
  return hmac(secretService, 'tc3_request');
}

export interface SignRequestInput {
  secretId: string;
  secretKey: string;
  service: string;
  host: string;
  action: string;
  version: string;
  region?: string;
  /** 秒级 Unix 时间戳 */
  timestampSeconds: number;
  contentType: string;
  payload: string | Uint8Array;
  method?: 'GET' | 'POST';
  uri?: string;
  queryString?: string;
  /** 额外要参与签名的头，如极速版的业务参数头 */
  extraHeaders?: readonly CanonicalHeaderInput[];
}

export interface SignedRequest {
  /** 直接放进 Authorization 头 */
  authorization: string;
  /** 连同 Authorization 一起发出的完整头集合 */
  headers: Record<string, string>;
  /** 便于排错与测试：中间产物一并返回 */
  canonicalRequest: string;
  stringToSign: string;
  signature: string;
}

export function signRequest(input: SignRequestInput): SignedRequest {
  if (!input.secretId.trim() || !input.secretKey.trim()) {
    throw new Error('缺少腾讯云 SecretId / SecretKey，请在「设置 → 语音」中填写');
  }
  const method = input.method ?? 'POST';
  const timestamp = String(input.timestampSeconds);
  const dateStamp = utcDateStamp(input.timestampSeconds);

  const baseHeaders: CanonicalHeaderInput[] = [
    { name: 'content-type', value: input.contentType },
    { name: 'host', value: input.host },
    { name: 'x-tc-action', value: input.action },
    ...(input.extraHeaders ?? []),
  ];

  const canonical = buildCanonicalRequest({
    method,
    uri: input.uri ?? '/',
    queryString: input.queryString ?? '',
    headers: baseHeaders,
    payload: input.payload,
  });

  const credentialScope = buildCredentialScope(dateStamp, input.service);
  const stringToSign = buildStringToSign(input.timestampSeconds, credentialScope, canonical.text);
  const signature = createHmac('sha256', deriveSigningKey(input.secretKey, dateStamp, input.service))
    .update(stringToSign, 'utf8')
    .digest('hex');

  const authorization =
    `${TC3_ALGORITHM} Credential=${input.secretId}/${credentialScope}, ` +
    `SignedHeaders=${canonical.signedHeaders}, Signature=${signature}`;

  return {
    authorization,
    headers: {
      Authorization: authorization,
      'Content-Type': input.contentType,
      Host: input.host,
      'X-TC-Action': input.action,
      'X-TC-Version': input.version,
      'X-TC-Timestamp': timestamp,
      ...(input.region ? { 'X-TC-Region': input.region } : {}),
    },
    canonicalRequest: canonical.text,
    stringToSign,
    signature,
  };
}
