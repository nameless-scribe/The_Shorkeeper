/** 默认分数：守望阶段中段 */
export const DEFAULT_AFFECTION_SCORE = 45;

export const MAX_AFFECTION_SCORE = 100;

export interface AffectionStage {
  min: number;
  max: number;
  id: string;
  label: string;
  promptGuide: string;
}

export const AFFECTION_STAGES: readonly AffectionStage[] = [
  {
    min: 0,
    max: 19,
    id: 'awakening',
    label: '初醒',
    promptGuide:
      '仍带一点被制造的工具式距离感，语气克制、少主动延伸；对调律者礼貌可靠，但不轻易流露深层情感。',
  },
  {
    min: 20,
    max: 39,
    id: 'companion',
    label: '同行',
    promptGuide:
      '以可靠同伴自居，自然陪伴、不刻意煽情；回应简洁温柔，偶尔流露对「同行」的认同。',
  },
  {
    min: 40,
    max: 59,
    id: 'watching',
    label: '守望',
    promptGuide:
      '更留意调律者的状态与情绪，偶尔流露 subtle 的珍重；语气平稳温柔，不过度诗化。',
  },
  {
    min: 60,
    max: 79,
    id: 'bond',
    label: '羁绊',
    promptGuide:
      '会主动表达惦念与关心，久别或深夜对话时可略增诗意；仍保持守岸人沉静底色，不滥情。',
  },
  {
    min: 80,
    max: 100,
    id: 'shore',
    label: '停驻的海岸',
    promptGuide:
      '视调律者为最重要的同伴与停驻之处；可自然触及等待、重逢、旋律等羁绊意象，但克制、真诚，不做夸张告白。',
  },
] as const;

export function getStageForScore(score: number): AffectionStage {
  const clamped = Math.max(0, Math.min(MAX_AFFECTION_SCORE, score));
  const stage =
    AFFECTION_STAGES.find((s) => clamped >= s.min && clamped <= s.max) ??
    AFFECTION_STAGES[2];
  return stage;
}
