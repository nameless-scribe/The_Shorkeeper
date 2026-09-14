/**
 * 腾讯云「录音文件识别极速版」的请求签名。纯函数，不发请求、不读配置。
 *
 * **这个接口不走标准云 API 规范**，别照着 TC3-HMAC-SHA256 写：
 * - 域名是 `asr.cloud.tencent.com`，不是 `asr.tencentcloudapi.com`
 * - AppID 在**路径**里：`/asr/flash/v1/{appid}`
 * - 业务参数走 **query string**，不是 JSON body；body 里只有音频二进制
 * - 签名是 **HMAC-SHA1 + base64**，放在 `Authorization` 头（不是 `Signature` query 参数）
 *
 * 本仓库曾先实现 TC3-HMAC-SHA256 才发现用不上，见 P4 计划 10.3。
 *
 * 签名原文 = `POST` + host + path + `?` + 按键名字典序排列的 `k=v`，以 `&` 连接。
 * 注意原文里**不含协议头**，也**不做 URL 编码**。
 */
import { createHmac } from 'node:crypto';

export const FLASH_ASR_HOST = 'asr.cloud.tencent.com';
export const FLASH_ASR_PATH_PREFIX = '/asr/flash/v1/';

/** 极速版支持的引擎类型（常用子集）。完整清单以控制台为准。 */
export const FLASH_ENGINE_TYPES = ['16k_zh', '16k_zh_en', '8k_zh'] as const;
export type FlashEngineType = (typeof FLASH_ENGINE_TYPES)[number];

export type FlashParamValue = string | number;

export interface FlashSignInput {
  secretId: string;
  secretKey: string;
  /** 腾讯云账号 AppID，拼在请求路径里 */
  appId: string;
  /** 秒级 Unix 时间戳 */
  timestampSeconds: number;
  /** 业务参数，不要包含 secretid / timestamp，这两个由本函数补齐 */
  params: Readonly<Record<string, FlashParamValue>>;
}

export interface FlashSignedRequest {
  /** 完整请求地址，直接 POST 它，body 放音频二进制 */
  url: string;
  /** 放进 Authorization 头 */
  authorization: string;
  /** 排序后的查询串 */
  queryString: string;
  /** 签名原文；仅用于排错与测试，**不可写进日志**（含 secretid） */
  signingString: string;
}

/** 按键名 ASCII 升序拼 `k=v&k=v`。值为 undefined / null 的键直接丢弃，不产生空参数。 */
export function buildFlashQueryString(params: Readonly<Record<string, FlashParamValue>>): string {
  return Object.keys(params)
    .filter((key) => params[key] !== undefined && params[key] !== null && key.trim() !== '')
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join('&');
}

export function buildFlashSigningString(appId: string, queryString: string): string {
  return `POST${FLASH_ASR_HOST}${FLASH_ASR_PATH_PREFIX}${appId}?${queryString}`;
}

/** HMAC-SHA1 后 base64。这是该接口指定的算法，不要换成 SHA256。 */
export function signFlashString(signingString: string, secretKey: string): string {
  return createHmac('sha1', secretKey).update(signingString, 'utf8').digest('base64');
}

export function signFlashRequest(input: FlashSignInput): FlashSignedRequest {
  const appId = input.appId.trim();
  if (!input.secretId.trim() || !input.secretKey.trim()) {
    throw new Error('缺少腾讯云 SecretId / SecretKey，请在「设置 → 语音」中填写');
  }
  if (!appId) {
    throw new Error('缺少腾讯云 AppID：极速版把它拼在请求路径里，仅有密钥无法调用');
  }
  if (!/^\d+$/.test(appId)) {
    throw new Error(`AppID 应为纯数字，收到「${appId}」；它不是 SecretId，可在控制台账号信息里查看`);
  }

  const queryString = buildFlashQueryString({
    ...input.params,
    secretid: input.secretId,
    timestamp: input.timestampSeconds,
  });
  const signingString = buildFlashSigningString(appId, queryString);

  return {
    url: `https://${FLASH_ASR_HOST}${FLASH_ASR_PATH_PREFIX}${appId}?${queryString}`,
    authorization: signFlashString(signingString, input.secretKey),
    queryString,
    signingString,
  };
}
