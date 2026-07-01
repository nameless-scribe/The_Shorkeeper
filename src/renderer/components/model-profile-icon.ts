import type { ModelProfileInfo } from '@/shared/types';

export function profileIcon(
  profile: Pick<ModelProfileInfo, 'name' | 'baseUrl' | 'model' | 'protocol'>,
): string {
  const hay = `${profile.name} ${profile.baseUrl} ${profile.model}`.toLowerCase();
  if (hay.includes('deepseek')) return '🌊';
  if (profile.protocol === 'anthropic' || hay.includes('claude') || hay.includes('anthropic')) {
    return '🟣';
  }
  if (hay.includes('qwen') || hay.includes('aliyun') || hay.includes('dashscope') || hay.includes('bailian')) {
    return '✦';
  }
  if (hay.includes('openai') || hay.includes('gpt')) return '◉';
  return '◇';
}
