import { describe, expect, it } from 'vitest';
import { VOICE_DEFAULTS } from '../../voice/types';

describe('voice settings defaults', () => {
  it('uses cosyvoice v3.5 plus model', () => {
    expect(VOICE_DEFAULTS.ttsModel).toBe('cosyvoice-v3.5-plus');
  });

  it('defaults to independent bailian voice api', () => {
    expect(VOICE_DEFAULTS.useChatApi).toBe(false);
  });

  it('starts with empty voice id for user clone', () => {
    expect(VOICE_DEFAULTS.ttsVoiceId).toBe('');
    expect(VOICE_DEFAULTS.ttsVoiceSource).toBe('cloned');
  });

  it('defaults synthesis volume to full and playback gain to 2x', () => {
    expect(VOICE_DEFAULTS.ttsVolume).toBe(100);
    expect(VOICE_DEFAULTS.ttsPlaybackGain).toBe(2);
  });
});
