import { describe, expect, it } from 'vitest';
import {
  FLASH_ASR_HOST,
  buildFlashQueryString,
  buildFlashSigningString,
  signFlashRequest,
  signFlashString,
} from '../tencent-flash-signature';

describe('flash ASR HMAC-SHA1 primitive', () => {
  /**
   * RFC 2202 的 HMAC-SHA1 标准测试向量。腾讯云文档里的密钥是打码的、
   * 最终签名不可复现，但签名原语是公开标准，可以真正验证。
   * 这能把"算法选错"（比如误用 SHA256）挡在真实调用之前。
   */
  it('matches the RFC 2202 HMAC-SHA1 test vectors', () => {
    expect(signFlashString('Hi There', '\x0b'.repeat(20))).toBe('thcxhlUFcmTii8C2+zeMjvFGvgA=');
    expect(signFlashString('what do ya want for nothing?', 'Jefe')).toBe('7/zfauXrL6LSdBbV8YTfnCWafHk=');
  });

  it('is sensitive to both the string and the key', () => {
    const base = signFlashString('POSTexample', 'key');
    expect(signFlashString('POSTexample', 'key')).toBe(base);
    expect(signFlashString('POSTexamplf', 'key')).not.toBe(base);
    expect(signFlashString('POSTexample', 'kex')).not.toBe(base);
  });
});

describe('flash ASR query string', () => {
  it('sorts keys in ascii order', () => {
    expect(buildFlashQueryString({ voice_format: 'wav', engine_type: '16k_zh', convert_num_mode: 1 })).toBe(
      'convert_num_mode=1&engine_type=16k_zh&voice_format=wav',
    );
  });

  it('produces the same string regardless of insertion order', () => {
    const a = buildFlashQueryString({ b: 2, a: 1, c: 3 });
    const b = buildFlashQueryString({ c: 3, b: 2, a: 1 });
    expect(a).toBe(b);
    expect(a).toBe('a=1&b=2&c=3');
  });

  it('drops empty keys and nullish values rather than emitting blanks', () => {
    // 多出一个空参数就会让签名原文与实际 URL 不一致，服务端只会回一个笼统的鉴权失败
    const query = buildFlashQueryString({
      engine_type: '16k_zh',
      missing: undefined as unknown as string,
      empty: null as unknown as string,
      '': 'x',
    });
    expect(query).toBe('engine_type=16k_zh');
  });

  it('keeps numeric values unquoted', () => {
    expect(buildFlashQueryString({ speaker_diarization: 1, timestamp: 1609560089 })).toBe(
      'speaker_diarization=1&timestamp=1609560089',
    );
  });
});

describe('flash ASR signing string', () => {
  it('follows POST + host + path + ? + sorted params, without scheme', () => {
    const signing = buildFlashSigningString('1259220000', 'engine_type=16k_zh&voice_format=wav');
    expect(signing).toBe('POSTasr.cloud.tencent.com/asr/flash/v1/1259220000?engine_type=16k_zh&voice_format=wav');
    // 原文里不能带 https://，带上会签出无效签名
    expect(signing).not.toContain('https://');
  });
});

describe('signFlashRequest', () => {
  const base = {
    secretId: 'AKIDEXAMPLE',
    secretKey: 'SECRETEXAMPLE',
    appId: '1259220000',
    timestampSeconds: 1609560089,
    params: { engine_type: '16k_zh', voice_format: 'wav', speaker_diarization: 1 },
  };

  it('adds secretid and timestamp, and keeps url and signing string consistent', () => {
    const signed = signFlashRequest(base);
    expect(signed.queryString).toBe(
      'engine_type=16k_zh&secretid=AKIDEXAMPLE&speaker_diarization=1&timestamp=1609560089&voice_format=wav',
    );
    // 签到的原文与真正请求的 URL 必须逐字对应，否则服务端算出的签名不同
    expect(signed.url).toBe(`https://${FLASH_ASR_HOST}/asr/flash/v1/1259220000?${signed.queryString}`);
    expect(signed.signingString).toBe(`POST${FLASH_ASR_HOST}/asr/flash/v1/1259220000?${signed.queryString}`);
    expect(signed.authorization).toBe(signFlashString(signed.signingString, base.secretKey));
  });

  it('puts the appid in the path, not in the query', () => {
    const signed = signFlashRequest(base);
    expect(signed.url).toContain('/asr/flash/v1/1259220000?');
    expect(signed.queryString).not.toContain('1259220000');
  });

  it('is deterministic and changes when any input changes', () => {
    const first = signFlashRequest(base).authorization;
    expect(signFlashRequest(base).authorization).toBe(first);
    expect(signFlashRequest({ ...base, timestampSeconds: base.timestampSeconds + 1 }).authorization).not.toBe(first);
    expect(signFlashRequest({ ...base, secretKey: 'OTHER' }).authorization).not.toBe(first);
    expect(
      signFlashRequest({ ...base, params: { ...base.params, speaker_diarization: 0 } }).authorization,
    ).not.toBe(first);
  });

  it('refuses to sign without credentials, naming where to set them', () => {
    expect(() => signFlashRequest({ ...base, secretId: '' })).toThrow('SecretId');
    expect(() => signFlashRequest({ ...base, secretKey: '  ' })).toThrow('设置');
  });

  it('explains that AppID is required and is not the SecretId', () => {
    expect(() => signFlashRequest({ ...base, appId: '' })).toThrow('AppID');
    const wrong = () => signFlashRequest({ ...base, appId: 'AKIDEXAMPLE' });
    expect(wrong).toThrow('纯数字');
    expect(wrong).toThrow('不是 SecretId');
  });
});
