import { describe, expect, it, vi } from 'vitest';
import {
  TranscriptionCancelledError,
  TranscriptionFailedError,
  describeAsrError,
  transcribeAudio,
  type AudioBytes,
  type FetchLike,
} from '../tencent-file-asr';

const credentials = { secretId: 'AKIDEXAMPLE', secretKey: 'SECRETEXAMPLE', appId: '1259220000' };
const bytes = (...values: number[]): AudioBytes => new Uint8Array(values);
const audio = bytes(0x52, 0x49, 0x46, 0x46, 0x01, 0x02, 0x03);

/** 按实测结构构造的成功响应（见 P4 计划 10.4）。 */
function successBody() {
  return JSON.stringify({
    request_id: 'req-abc',
    code: 0,
    message: '',
    audio_duration: 12000,
    flash_result: [
      {
        text: '你好。好的。',
        channel_id: 0,
        sentence_list: [
          { text: '你好。', start_time: 100, end_time: 900, speaker_id: 0 },
          { text: '好的。', start_time: 1000, end_time: 1800, speaker_id: 1 },
        ],
      },
    ],
  });
}

function fetchReturning(body: string, status = 200): { impl: FetchLike; calls: Array<Record<string, unknown>> } {
  const calls: Array<Record<string, unknown>> = [];
  const impl: FetchLike = async (url, init) => {
    calls.push({ url, ...init });
    return { status, text: async () => body };
  };
  return { impl, calls };
}

describe('transcribeAudio', () => {
  it('returns sentences, speakers, duration and an idempotency hash', async () => {
    const { impl } = fetchReturning(successBody());
    const result = await transcribeAudio({ audio, extension: '.wav', credentials, fetchImpl: impl });

    expect(result.sentences).toHaveLength(2);
    expect(result.speakerCount).toBe(2);
    expect(result.durationMs).toBe(12000);
    expect(result.plainText).toBe('你好。好的。');
    expect(result.sourceHash).toMatch(/^[0-9a-f]{64}$/);
    expect(result.engineType).toBe('16k_zh');
    expect(result.diarization).toBe(true);
  });

  it('derives voice_format from the extension and sends the audio as a binary body', async () => {
    const { impl, calls } = fetchReturning(successBody());
    await transcribeAudio({ audio, extension: '.M4A', credentials, fetchImpl: impl });

    const call = calls[0];
    expect(String(call.url)).toContain('voice_format=m4a');
    expect(String(call.url)).toContain('engine_type=16k_zh');
    expect(String(call.url)).toContain('speaker_diarization=1');
    expect((call.headers as Record<string, string>)['Content-Type']).toBe('application/octet-stream');
    expect(call.body).toBe(audio);
  });

  it('turns diarization off when asked', async () => {
    const { impl, calls } = fetchReturning(successBody());
    const result = await transcribeAudio({ audio, extension: '.wav', credentials, diarization: false, fetchImpl: impl });
    expect(String(calls[0].url)).toContain('speaker_diarization=0');
    expect(result.diarization).toBe(false);
  });

  it('produces a stable hash for identical audio and a different one otherwise', async () => {
    const { impl } = fetchReturning(successBody());
    const run = (data: AudioBytes) => transcribeAudio({ audio: data, extension: '.wav', credentials, fetchImpl: impl });
    const first = await run(audio);
    expect((await run(bytes(...audio))).sourceHash).toBe(first.sourceHash);
    expect((await run(bytes(9, 9, 9))).sourceHash).not.toBe(first.sourceHash);
  });

  it('rejects an unsupported format before spending a request', async () => {
    const impl = vi.fn() as unknown as FetchLike;
    await expect(transcribeAudio({ audio, extension: '.mp4', credentials, fetchImpl: impl })).rejects.toThrow('不支持的音频格式');
    expect(impl).not.toHaveBeenCalled();
  });

  it('rejects empty audio before spending a request', async () => {
    const impl = vi.fn() as unknown as FetchLike;
    await expect(
      transcribeAudio({ audio: bytes(), extension: '.wav', credentials, fetchImpl: impl }),
    ).rejects.toThrow('为空');
    expect(impl).not.toHaveBeenCalled();
  });

  it('surfaces a business failure even though HTTP was 200', async () => {
    // 实测：服务未开通时 HTTP 是 200，错误只在顶层 code
    const { impl } = fetchReturning(
      JSON.stringify({ request_id: 'req-1', code: 4003, message: 'service not opened||innererr=...' }),
      200,
    );
    const error = await transcribeAudio({ audio, extension: '.wav', credentials, fetchImpl: impl }).catch((e) => e);
    expect(error).toBeInstanceOf(TranscriptionFailedError);
    expect(error.code).toBe(4003);
    expect(error.message).toContain('分别开通');
    // 原始报文不该原样抛给用户
    expect(error.message).not.toContain('innererr');
  });

  it('reports an unparseable response with its HTTP status', async () => {
    const { impl } = fetchReturning('<html>502 Bad Gateway</html>', 502);
    const error = await transcribeAudio({ audio, extension: '.wav', credentials, fetchImpl: impl }).catch((e) => e);
    expect(error.message).toContain('HTTP 502');
    expect(error.retryable).toBe(true);
  });

  it('treats a network error as retryable, not as a provider failure', async () => {
    const impl: FetchLike = async () => {
      throw new Error('ECONNRESET');
    };
    const error = await transcribeAudio({ audio, extension: '.wav', credentials, fetchImpl: impl }).catch((e) => e);
    expect(error).toBeInstanceOf(TranscriptionFailedError);
    expect(error.retryable).toBe(true);
    expect(error.message).toContain('无法连接');
  });

  describe('cancellation', () => {
    it('does not start the request when already aborted', async () => {
      const controller = new AbortController();
      controller.abort();
      const impl = vi.fn() as unknown as FetchLike;
      await expect(
        transcribeAudio({ audio, extension: '.wav', credentials, signal: controller.signal, fetchImpl: impl }),
      ).rejects.toBeInstanceOf(TranscriptionCancelledError);
      expect(impl).not.toHaveBeenCalled();
    });

    it('passes the signal down so the HTTP request is really aborted', async () => {
      const controller = new AbortController();
      const { impl, calls } = fetchReturning(successBody());
      await transcribeAudio({ audio, extension: '.wav', credentials, signal: controller.signal, fetchImpl: impl });
      expect(calls[0].signal).toBe(controller.signal);
    });

    it('reports an abort during the request as cancelled, not failed', async () => {
      const controller = new AbortController();
      const impl: FetchLike = async () => {
        controller.abort();
        const error = new Error('The operation was aborted');
        error.name = 'AbortError';
        throw error;
      };
      await expect(
        transcribeAudio({ audio, extension: '.wav', credentials, signal: controller.signal, fetchImpl: impl }),
      ).rejects.toBeInstanceOf(TranscriptionCancelledError);
    });

    it('reports an abort that lands after the response as cancelled', async () => {
      const controller = new AbortController();
      const impl: FetchLike = async () => {
        controller.abort();
        return { status: 200, text: async () => successBody() };
      };
      await expect(
        transcribeAudio({ audio, extension: '.wav', credentials, signal: controller.signal, fetchImpl: impl }),
      ).rejects.toBeInstanceOf(TranscriptionCancelledError);
    });
  });
});

describe('describeAsrError', () => {
  it('translates every documented code into something a user can act on', () => {
    const cases: Array<[number, string]> = [
      [4001, '参数不合法'],
      [4002, 'SecretId'],
      [4003, '分别开通'],
      [4004, '资源包'],
      [4005, '欠费'],
      [4006, '并发'],
      [4007, '解码失败'],
      [4011, '过大'],
      [4012, '为空'],
    ];
    for (const [code, expected] of cases) {
      expect(describeAsrError(code, null).message).toContain(expected);
    }
  });

  it('marks transient failures retryable and permanent ones not', () => {
    for (const code of [4006, 4008, 4009, 5001, 5002, 5003]) {
      expect(describeAsrError(code, null).retryable).toBe(true);
    }
    for (const code of [4001, 4002, 4003, 4004, 4005, 4007, 4011, 4012]) {
      expect(describeAsrError(code, null).retryable).toBe(false);
    }
  });

  it('keeps an unknown code visible instead of swallowing it', () => {
    const described = describeAsrError(9999, 'req-xyz');
    expect(described.message).toContain('9999');
    // 提工单要有据可依
    expect(described.message).toContain('req-xyz');
  });
});
