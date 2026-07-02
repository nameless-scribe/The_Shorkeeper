import { getVoiceSettings } from '../config/voice';
import { hasSpeakableCharacters, prepareChunkForTts } from './text-for-speech';
import { getBailianTtsEngine } from './bailian-tts';

export async function synthesizeVoiceChunk(text: string): Promise<{ audio: ArrayBuffer; mime: string }> {
  const trimmed = prepareChunkForTts(text);
  if (!trimmed || !hasSpeakableCharacters(trimmed)) {
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
    languageHint:
      settings.sttLanguage === 'en' ? 'en' : settings.sttLanguage === 'zh' ? 'zh' : undefined,
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
