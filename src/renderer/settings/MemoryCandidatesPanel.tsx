import { useCallback, useEffect, useState } from 'react';
import type { MemoryCandidateCategory, MemoryCandidateInfo } from '@/shared/types';
import {
  SettingsActionLink,
  SettingsBadge,
  SettingsListCard,
  SettingsPanel,
} from './components/settings-ui';

const CATEGORY_LABELS: Record<MemoryCandidateCategory, string> = {
  stable_preference: '偏好 / 习惯',
  relationship: '关系类',
  other: '其他',
};

function formatCandidateMeta(candidate: MemoryCandidateInfo): string {
  const confidence = `${Math.round(candidate.confidence * 100)}% 置信度`;
  const time = new Date(candidate.createdAt).toLocaleString();
  return `${confidence} · ${time}`;
}

export function MemoryCandidatesPanel() {
  const [candidates, setCandidates] = useState<MemoryCandidateInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const pending = await window.shorekeeper.memoryCandidates.list('pending', 100);
      setCandidates(pending);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const confirmCandidate = async (candidate: MemoryCandidateInfo) => {
    setBusyId(candidate.id);
    setError(null);
    try {
      await window.shorekeeper.memoryCandidates.confirm(candidate.id);
      setCandidates((current) => current.filter((item) => item.id !== candidate.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  };

  const rejectCandidate = async (candidate: MemoryCandidateInfo) => {
    if (!window.confirm(`拒绝记忆候选「${candidate.content}」？后续自动提取不会再次提交同一候选。`)) {
      return;
    }
    setBusyId(candidate.id);
    setError(null);
    try {
      await window.shorekeeper.memoryCandidates.reject(candidate.id);
      setCandidates((current) => current.filter((item) => item.id !== candidate.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <SettingsPanel
      title="待确认记忆"
      subtitle="自动提取的低置信度或敏感候选不会直接写入"
      icon="🛡️"
      badge={candidates.length > 0 ? <SettingsBadge tone="amber">{candidates.length} 条待处理</SettingsBadge> : undefined}
    >
      {error && (
        <p className="rounded-xl border border-red-400/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">
          {error}
        </p>
      )}

      {loading ? (
        <p className="text-xs text-keeper-ice/45">正在读取候选…</p>
      ) : candidates.length === 0 ? (
        <p className="text-xs leading-relaxed text-keeper-ice/45">
          暂无待确认候选。高置信度的稳定偏好会按策略静默保存，关系类和敏感内容始终需要你确认。
        </p>
      ) : (
        <div className="space-y-2">
          {candidates.map((candidate) => (
            <SettingsListCard
              key={candidate.id}
              title={candidate.content}
              subtitle={`${candidate.memoryKey} · ${candidate.reason}`}
              meta={formatCandidateMeta(candidate)}
              badge={<SettingsBadge tone={candidate.category === 'relationship' ? 'amber' : 'muted'}>{CATEGORY_LABELS[candidate.category]}</SettingsBadge>}
              actions={
                <div className="flex shrink-0 items-center gap-3 pt-0.5">
                  <SettingsActionLink
                    onClick={() => void confirmCandidate(candidate)}
                    disabled={busyId !== null}
                  >
                    {busyId === candidate.id ? '处理中…' : '确认保存'}
                  </SettingsActionLink>
                  <SettingsActionLink
                    onClick={() => void rejectCandidate(candidate)}
                    danger
                    disabled={busyId !== null}
                  >
                    拒绝
                  </SettingsActionLink>
                </div>
              }
            />
          ))}
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
