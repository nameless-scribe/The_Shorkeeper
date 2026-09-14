import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import {
  TC3_ALGORITHM,
  buildCanonicalHeaders,
  buildCanonicalRequest,
  buildCredentialScope,
  buildStringToSign,
  deriveSigningKey,
  signRequest,
  utcDateStamp,
} from '../tencent-signature';

const BACKSLASH = String.fromCharCode(92);

/**
 * 官方「签名方法 v3」文档给出的示例。SecretId / SecretKey 在文档里是打码的，
 * 因此**最终签名值无法复现**；能锁的是与密钥无关的两层中间产物，
 * 而这两层恰好是最容易出错的地方（排序、大小写、空行、结尾换行）。
 */
const OFFICIAL = {
  timestamp: 1551113065,
  service: 'cvm',
  host: 'cvm.tencentcloudapi.com',
  action: 'DescribeInstances',
  contentType: 'application/json; charset=utf-8',
  // 官方示例的请求体是 Python json.dumps 的默认输出：非 ASCII 被转成字面 \u 转义
  payload:
    '{"Limit": 1, "Filters": [{"Values": ["' +
    `${BACKSLASH}u672a${BACKSLASH}u547d${BACKSLASH}u540d` +
    '"], "Name": "instance-name"}]}',
  hashedPayload: '35e9c5b0e3ae67532d3c9f17ead6c90222632e5b1ff7f6e89887f1398934f064',
  hashedCanonicalRequest: '7019a55be8395899b900fb5564e4200d984910f34794a27cb3fb7d10ff6a1e84',
} as const;

const sha256Hex = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');

const officialHeaders = [
  { name: 'Content-Type', value: OFFICIAL.contentType },
  { name: 'Host', value: OFFICIAL.host },
  { name: 'X-TC-Action', value: OFFICIAL.action },
];

function officialCanonical() {
  return buildCanonicalRequest({
    method: 'POST',
    uri: '/',
    queryString: '',
    headers: officialHeaders,
    payload: OFFICIAL.payload,
  });
}

describe('TC3-HMAC-SHA256 signing', () => {
  it('hashes the official example payload to the documented digest', () => {
    expect(sha256Hex(OFFICIAL.payload)).toBe(OFFICIAL.hashedPayload);
  });

  it('builds the canonical request exactly as documented', () => {
    const canonical = officialCanonical();
    expect(canonical.text).toBe(
      'POST\n/\n\n' +
        'content-type:application/json; charset=utf-8\n' +
        'host:cvm.tencentcloudapi.com\n' +
        'x-tc-action:describeinstances\n' +
        '\n' +
        'content-type;host;x-tc-action\n' +
        OFFICIAL.hashedPayload,
    );
    expect(sha256Hex(canonical.text)).toBe(OFFICIAL.hashedCanonicalRequest);
  });

  it('builds the documented string to sign', () => {
    const scope = buildCredentialScope(utcDateStamp(OFFICIAL.timestamp), OFFICIAL.service);
    expect(scope).toBe('2019-02-25/cvm/tc3_request');
    expect(buildStringToSign(OFFICIAL.timestamp, scope, officialCanonical().text)).toBe(
      `${TC3_ALGORITHM}\n1551113065\n2019-02-25/cvm/tc3_request\n${OFFICIAL.hashedCanonicalRequest}`,
    );
  });

  it('lowercases the x-tc-action value but not other header values', () => {
    // 官方示例里 action 写作 DescribeInstances，规范头部里却是 describeinstances。
    const { canonical, signed } = buildCanonicalHeaders([
      { name: 'X-TC-Action', value: 'FlashRecognize' },
      { name: 'Content-Type', value: 'application/octet-stream' },
      { name: 'Host', value: 'Asr.TencentCloudApi.com' },
    ]);
    expect(canonical).toBe(
      'content-type:application/octet-stream\nhost:Asr.TencentCloudApi.com\nx-tc-action:flashrecognize\n',
    );
    expect(signed).toBe('content-type;host;x-tc-action');
  });

  it('sorts headers by name regardless of input order and trims values', () => {
    const { canonical, signed } = buildCanonicalHeaders([
      { name: 'z-last', value: '  spaced  ' },
      { name: 'a-first', value: 'v' },
      { name: 'Host', value: 'h' },
    ]);
    expect(signed).toBe('a-first;host;z-last');
    expect(canonical).toBe('a-first:v\nhost:h\nz-last:spaced\n');
  });

  it('uses UTC for the date stamp, not local time', () => {
    // 本地日期会在跨时区或跨零点时签出无效签名
    expect(utcDateStamp(OFFICIAL.timestamp)).toBe('2019-02-25');
    expect(utcDateStamp(0)).toBe('1970-01-01');
    expect(utcDateStamp(Date.UTC(2019, 1, 25, 23, 59, 59) / 1000)).toBe('2019-02-25');
    expect(utcDateStamp(Date.UTC(2019, 1, 26, 0, 0, 0) / 1000)).toBe('2019-02-26');
  });

  it('hashes a binary payload, which is what the flash ASR endpoint sends', () => {
    const audio = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x00, 0xff, 0x7f]);
    const canonical = buildCanonicalRequest({
      method: 'POST',
      uri: '/',
      queryString: '',
      headers: [
        { name: 'content-type', value: 'application/octet-stream' },
        { name: 'host', value: 'asr.tencentcloudapi.com' },
      ],
      payload: audio,
    });
    expect(canonical.hashedPayload).toBe(createHash('sha256').update(audio).digest('hex'));
    expect(canonical.text.endsWith(canonical.hashedPayload)).toBe(true);
  });

  it('derives the signing key through three chained HMACs', () => {
    const key = deriveSigningKey('secret', '2026-09-13', 'asr');
    expect(key).toHaveLength(32);
    // 派生必须同时受密钥、日期与服务影响，否则跨天或跨服务会复用签名密钥
    expect(deriveSigningKey('secret', '2026-09-14', 'asr').equals(key)).toBe(false);
    expect(deriveSigningKey('secret', '2026-09-13', 'cvm').equals(key)).toBe(false);
    expect(deriveSigningKey('other', '2026-09-13', 'asr').equals(key)).toBe(false);
  });

  it('assembles the authorization header in the documented shape', () => {
    const signed = signRequest({
      secretId: 'AKIDEXAMPLE',
      secretKey: 'SECRETEXAMPLE',
      service: 'asr',
      host: 'asr.tencentcloudapi.com',
      action: 'FlashRecognize',
      version: '2019-06-14',
      region: 'ap-shanghai',
      timestampSeconds: OFFICIAL.timestamp,
      contentType: 'application/octet-stream',
      payload: new Uint8Array([1, 2, 3]),
    });

    expect(signed.authorization).toBe(
      `${TC3_ALGORITHM} Credential=AKIDEXAMPLE/2019-02-25/asr/tc3_request, ` +
        `SignedHeaders=content-type;host;x-tc-action, Signature=${signed.signature}`,
    );
    expect(signed.signature).toMatch(/^[0-9a-f]{64}$/);
    expect(signed.headers).toMatchObject({
      'X-TC-Action': 'FlashRecognize',
      'X-TC-Version': '2019-06-14',
      'X-TC-Timestamp': '1551113065',
      'X-TC-Region': 'ap-shanghai',
    });
  });

  it('is deterministic for the same input and changes when anything changes', () => {
    const base = {
      secretId: 'AKIDEXAMPLE',
      secretKey: 'SECRETEXAMPLE',
      service: 'asr',
      host: 'asr.tencentcloudapi.com',
      action: 'FlashRecognize',
      version: '2019-06-14',
      timestampSeconds: OFFICIAL.timestamp,
      contentType: 'application/octet-stream',
      payload: new Uint8Array([1, 2, 3]),
    } as const;

    const first = signRequest({ ...base });
    expect(signRequest({ ...base }).signature).toBe(first.signature);
    expect(signRequest({ ...base, payload: new Uint8Array([1, 2, 4]) }).signature).not.toBe(first.signature);
    expect(signRequest({ ...base, timestampSeconds: base.timestampSeconds + 1 }).signature).not.toBe(first.signature);
    expect(signRequest({ ...base, secretKey: 'OTHER' }).signature).not.toBe(first.signature);
  });

  it('omits the region header when no region is given', () => {
    const signed = signRequest({
      secretId: 'AKIDEXAMPLE', secretKey: 'SECRETEXAMPLE', service: 'asr',
      host: 'asr.tencentcloudapi.com', action: 'A', version: 'v',
      timestampSeconds: 1, contentType: 'application/json', payload: '{}',
    });
    expect(signed.headers['X-TC-Region']).toBeUndefined();
  });

  it('refuses to sign without credentials, naming where to set them', () => {
    const base = {
      secretId: '', secretKey: 'k', service: 'asr', host: 'h', action: 'A', version: 'v',
      timestampSeconds: 1, contentType: 'application/json', payload: '{}',
    };
    expect(() => signRequest(base)).toThrow('SecretId');
    expect(() => signRequest({ ...base, secretId: 'i', secretKey: '   ' })).toThrow('设置');
  });
});
