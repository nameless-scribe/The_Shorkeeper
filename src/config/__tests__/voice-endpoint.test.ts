import { describe, expect, it } from 'vitest';
import { deriveTtsEndpointFromModelBaseUrl, normalizeVoiceTtsEndpoint } from '../voice';

describe('deriveTtsEndpointFromModelBaseUrl', () => {
  it('derives workspace endpoint from compatible-mode base url', () => {
    const base =
      'https://llm-o3kz1vn36c7rl7o7.cn-beijing.maas.aliyuncs.com/compatible-mode/v1';
    expect(deriveTtsEndpointFromModelBaseUrl(base)).toBe(
      'https://llm-o3kz1vn36c7rl7o7.cn-beijing.maas.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer',
    );
  });

  it('returns null for generic dashscope url', () => {
    expect(
      deriveTtsEndpointFromModelBaseUrl('https://dashscope.aliyuncs.com/compatible-mode/v1'),
    ).toBeNull();
  });

  it('normalizes compatible-mode url to SpeechSynthesizer endpoint', () => {
    expect(
      normalizeVoiceTtsEndpoint(
        'https://llm-o3kz1vn36c7rl7o7.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
      ),
    ).toBe(
      'https://llm-o3kz1vn36c7rl7o7.cn-beijing.maas.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer',
    );
  });
});
