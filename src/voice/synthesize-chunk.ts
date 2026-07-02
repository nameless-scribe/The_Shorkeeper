import { getVoiceSettings } from '../config/voice';
import { getBailianTtsEngine } from './bailian-tts';

export async function synthesizeVoiceChunk(text: string): Promise<{ audio: ArrayBuffer; mime: string }> {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error('朗读文本为空');
  }

  const settings = getVoiceSettings();
  if (!settings.ttsEnabled) {
    throw new Error('语音朗读已关闭');
  }

  const engine = getBailianTtsEngine();
  const result = await engine.synthesize(trimmed, {
    model: settings.ttsModel,
    voiceId: settings.ttsVoiceId,
    rate: settings.ttsRate,
    volume: settings.ttsVolume,
    format: 'mp3',
    languageHint: settings.sttLanguage === 'en' ? 'en' : 'zh',
  });

  const audioBuffer = Buffer.from(result.audio);
  return {
    mime: result.mime,
    audio: audioBuffer.buffer.slice(
      audioBuffer.byteOffset,
      audioBuffer.byteOffset + audioBuffer.byteLength,
    ),
  };
}
