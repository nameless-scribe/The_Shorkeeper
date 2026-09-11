import {
  deleteProfileKey,
  getProfileValue,
  listProfileEntries,
  setProfileValue,
  type ProfileEntry,
} from '../db/repositories/user-profile';

export {
  deleteProfileKey,
  getProfileValue,
  listProfileEntries,
  setProfileValue,
  type ProfileEntry,
};

const PROFILE_LABELS: Record<string, string> = {
  nickname: '称呼',
  'preference.tone': '偏好语气',
  bio: '简介',
  notes: '备注',
};

/** 格式化为 system prompt 片段 */
export function getProfileSummary(): string | null {
  const entries = listProfileEntries();
  if (!entries.length) return null;

  const lines = entries.map((entry) => {
    const label = PROFILE_LABELS[entry.key] ?? entry.key;
    return `- ${label}：${entry.value}`;
  });

  return `【用户画像】\n${lines.join('\n')}`;
}
