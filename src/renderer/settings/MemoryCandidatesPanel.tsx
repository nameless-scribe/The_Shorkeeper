import { useCallback, useEffect, useState } from 'react';
import type {
  MemoryCandidateInfo,
  MemoryCandidateResolution,
  MemoryInfo,
  PersonalMemoryType,
} from '@/shared/types';
import {
  SettingsActionLink,
  SettingsBadge,
  SettingsListCard,
  SettingsPanel,
} from './components/settings-ui';

export const MEMORY_TYPE_LABELS: Record<PersonalMemoryType, string> = {
  identity: '身份',
  preference: '偏好',
  relationship: '关系',
  event: '事件',
  goal: '目标',
  habit: '习惯',
  procedure: '做事方式',
  other: '旧版记忆',
};

export function formatCandidateMeta(candidate: MemoryCandidateInfo): string {
  const parts = [
    `${Math.round(candidate.confidence * 100)}% 置信度`,
    candidate.sourceSessionId ? `来源会话 ${candidate.sourceSessionId.slice(0, 12)}` : '来源未记录',
    new Date(candidate.createdAt).toLocaleString(),
  ];
  if (candidate.sensitivity === 'private') parts.splice(1, 0, '私密');
  if (candidate.sensitivity === 'sensitive') parts.splice(1, 0, '敏感 · 不提供给模型');
  if (candidate.modelUsePolicy === 'deny' && candidate.sensitivity !== 'sensitive') {
    parts.splice(1, 0, '不提供给模型');
  }
  if (candidate.expiresAt) parts.splice(2, 0, `有效至 ${new Date(candidate.expiresAt).toLocaleString()}`);
  return parts.join(' · ');
}

function candidateTone(candidate: MemoryCandidateInfo): 'cyan' | 'amber' | 'muted' {
  if (candidate.conflictsWithMemoryId || candidate.sensitivity !== 'normal') return 'amber';
  return candidate.memoryType === 'other' ? 'muted' : 'cyan';
}

export function MemoryCandidatesPanel() {
  const [candidates, setCandidates] = useState<MemoryCandidateInfo[]>([]);
  const [originals, setOriginals] = useState<Record<string, MemoryInfo | null>>({});
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const pending = await window.shorekeeper.memoryCandidates.list('pending', 100);
      const conflictIds = [...new Set(pending
        .map((candidate) => candidate.conflictsWithMemoryId)
        .filter((id): id is string => Boolean(id)))];
      const conflictRows = await Promise.all(conflictIds.map(async (id) => [
        id,
        await window.shorekeeper.memories.get(id),
      ] as const));
      setCandidates(pending);
      setOriginals(Object.fromEntries(conflictRows));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const removeCandidate = (id: string) => {
    setCandidates((current) => current.filter((item) => item.id !== id));
  };

  const confirmCandidate = async (candidate: MemoryCandidateInfo) => {
    setBusyId(candidate.id);
    setError(null);
    try {
      await window.shorekeeper.memoryCandidates.confirm(candidate.id);
      removeCandidate(candidate.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  };

  const resolveCandidate = async (
    candidate: MemoryCandidateInfo,
    resolution: MemoryCandidateResolution,
  ) => {
    const messages: Record<MemoryCandidateResolution, string> = {
      keep_original: '保留原事实并拒绝这条新候选？同样的新事实后续不会再次自动提交。',
      replace: '用新事实替代原事实？原事实会保留在历史记录中，但不再提供给助手。',
      coexist: '让两条事实并存？新事实会使用独立的情境 key 保存。',
    };
    if (!window.confirm(messages[resolution])) return;
    setBusyId(candidate.id);
    setError(null);
    try {
      await window.shorekeeper.memoryCandidates.resolve(candidate.id, resolution);
      removeCandidate(candidate.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  };

  const rejectCandidate = async (candidate: MemoryCandidateInfo) => {
    if (!window.confirm(`拒绝记忆候选「${candidate.content}」？后续自动提取不会再次提交同一候选。`)) return;
    setBusyId(candidate.id);
    setError(null);
    try {
      await window.shorekeeper.memoryCandidates.reject(candidate.id);
      removeCandidate(candidate.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <SettingsPanel
      title="待确认记忆"
      subtitle="身份、关系、敏感或冲突事实由你决定；密码和密钥不会进入候选"
      icon="🛡️"
      badge={candidates.length > 0
        ? <SettingsBadge tone="amber">{candidates.length} 条待处理</SettingsBadge>
        : undefined}
    >
      {error && (
        <p role="alert" className="rounded-xl border border-red-400/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">
          {error}
        </p>
      )}

      {loading ? (
        <p className="text-xs text-keeper-ice/45">正在读取候选与原事实…</p>
      ) : candidates.length === 0 ? (
        <p className="text-xs leading-relaxed text-keeper-ice/45">
          暂无待确认候选。普通的高置信偏好和习惯可按策略保存；冲突事实不会静默覆盖。
        </p>
      ) : (
        <div className="space-y-3">
          {candidates.map((candidate) => {
            const original = candidate.conflictsWithMemoryId
              ? originals[candidate.conflictsWithMemoryId]
              : null;
            const isConflict = Boolean(candidate.conflictsWithMemoryId);
            return (
              <div key={candidate.id} className="space-y-2">
                <SettingsListCard
                  title={isConflict ? '发现记忆冲突' : candidate.content}
                  subtitle={`${candidate.memoryKey} · ${candidate.reason}`}
                  meta={formatCandidateMeta(candidate)}
                  badge={
                    <SettingsBadge tone={candidateTone(candidate)}>
                      {isConflict ? '需选择' : MEMORY_TYPE_LABELS[candidate.memoryType]}
                    </SettingsBadge>
                  }
                  actions={isConflict ? undefined : (
                    <div className="flex shrink-0 items-center gap-3 pt-0.5">
                      <SettingsActionLink
                        onClick={() => void confirmCandidate(candidate)}
                        disabled={busyId !== null}
                      >
                        {busyId === candidate.id
                          ? '处理中…'
                          : candidate.memoryType === 'goal' ? '创建目标' : '确认保存'}
                      </SettingsActionLink>
                      <SettingsActionLink
                        onClick={() => void rejectCandidate(candidate)}
                        danger
                        disabled={busyId !== null}
                      >
                        拒绝
                      </SettingsActionLink>
                    </div>
                  )}
                />
                {isConflict && (
                  <div className="rounded-2xl border border-amber-400/15 bg-amber-500/5 p-3">
                    <div className="grid gap-2 sm:grid-cols-2">
                      <div className="rounded-xl border border-keeper-silver/12 bg-keeper-navyDeep/35 p-2.5">
                        <p className="text-[10px] font-medium uppercase tracking-wide text-keeper-ice/40">原事实</p>
                        <p className="mt-1 text-xs leading-relaxed text-keeper-ice/75">
                          {original?.content ?? '原事实已变化或暂时无法读取，请刷新后重试。'}
                        </p>
                      </div>
                      <div className="rounded-xl border border-keeper-cyan/20 bg-keeper-cyan/5 p-2.5">
                        <p className="text-[10px] font-medium uppercase tracking-wide text-keeper-cyan/65">新事实</p>
                        <p className="mt-1 text-xs leading-relaxed text-keeper-ice/85">{candidate.content}</p>
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap justify-end gap-x-4 gap-y-2">
                      <SettingsActionLink
                        onClick={() => void resolveCandidate(candidate, 'keep_original')}
                        disabled={busyId !== null}
                      >
                        保留原事实
                      </SettingsActionLink>
                      <SettingsActionLink
                        onClick={() => void resolveCandidate(candidate, 'coexist')}
                        disabled={busyId !== null || !original}
                      >
                        两条并存
                      </SettingsActionLink>
                      <SettingsActionLink
                        onClick={() => void resolveCandidate(candidate, 'replace')}
                        disabled={busyId !== null || !original}
                      >
                        {busyId === candidate.id ? '处理中…' : '使用新事实'}
                      </SettingsActionLink>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="flex justify-end">
        <SettingsActionLink onClick={() => void refresh()} disabled={loading || busyId !== null}>
          刷新候选
        </SettingsActionLink>
      </div>
    </SettingsPanel>
  );
}
