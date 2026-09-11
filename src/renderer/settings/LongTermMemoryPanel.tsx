import { useCallback, useEffect, useState } from 'react';
import type { MemoryInfo } from '@/shared/types';
import {
  SettingsActionLink,
  SettingsBadge,
  SettingsInlineActions,
  SettingsListCard,
  SettingsPanel,
  SettingsPrimaryButton,
  SETTINGS_TEXTAREA_CLASS,
} from './components/settings-ui';

function formatMemoryMeta(memory: MemoryInfo): string {
  const time = new Date(memory.createdAt).toLocaleString();
  return memory.memoryKey ? `${memory.memoryKey} · ${time}` : time;
}

export function LongTermMemoryPanel() {
  const [memories, setMemories] = useState<MemoryInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const items = await window.shorekeeper.memories.list(200);
      setMemories(items);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const saveEdit = async (memory: MemoryInfo) => {
    setBusyId(memory.id);
    setError(null);
    try {
      const updated = await window.shorekeeper.memories.update(memory.id, editValue);
      setMemories((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      setEditingId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  };

  const deleteMemory = async (memory: MemoryInfo) => {
    const label = memory.memoryKey ?? memory.content.slice(0, 24);
    if (!window.confirm(`删除长期记忆「${label}」？自动提取不会再恢复同一条；你仍可以明确要求记住。`)) {
      return;
    }
    setBusyId(memory.id);
    setError(null);
    try {
      await window.shorekeeper.memories.delete(memory.id);
      setMemories((current) => current.filter((item) => item.id !== memory.id));
      if (editingId === memory.id) setEditingId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <SettingsPanel
      title="已保存记忆"
      subtitle="查看、修改或删除长期记忆，不把删除只留给对话指令"
      icon="🗂️"
      badge={memories.length > 0 ? <SettingsBadge tone="muted">{memories.length} 条</SettingsBadge> : undefined}
    >
      {error && (
        <p className="rounded-xl border border-red-400/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">
          {error}
        </p>
      )}

      {loading ? (
        <p className="text-xs text-keeper-ice/45">正在读取记忆…</p>
      ) : memories.length === 0 ? (
        <p className="text-xs leading-relaxed text-keeper-ice/45">
          还没有长期记忆。确认候选或让守岸人记住稳定偏好后，会出现在这里。
        </p>
      ) : (
        <div className="space-y-2">
          {memories.map((memory) => (
            <div key={memory.id} className="space-y-2">
              <SettingsListCard
                title={memory.content}
                subtitle={editingId === memory.id ? undefined : formatMemoryMeta(memory)}
                actions={
                  editingId !== memory.id ? (
                    <SettingsInlineActions>
                      <SettingsActionLink
                        disabled={busyId !== null}
                        onClick={() => {
                          setEditingId(memory.id);
                          setEditValue(memory.content);
                        }}
                      >
                        编辑
                      </SettingsActionLink>
                      <SettingsActionLink
                        danger
                        disabled={busyId !== null}
                        onClick={() => void deleteMemory(memory)}
                      >
                        删除
                      </SettingsActionLink>
                    </SettingsInlineActions>
                  ) : undefined
                }
              />
              {editingId === memory.id && (
                <div className="space-y-2">
                  <textarea
                    value={editValue}
                    rows={3}
                    onChange={(event) => setEditValue(event.target.value)}
                    className={SETTINGS_TEXTAREA_CLASS}
                  />
                  <div className="flex justify-end gap-2">
                    <SettingsActionLink
                      disabled={busyId !== null}
                      onClick={() => setEditingId(null)}
                    >
                      取消
                    </SettingsActionLink>
                    <SettingsPrimaryButton
                      className="px-4"
                      disabled={busyId !== null || !editValue.trim()}
                      onClick={() => void saveEdit(memory)}
                    >
                      {busyId === memory.id ? '保存中…' : '保存'}
                    </SettingsPrimaryButton>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="flex justify-end">
        <SettingsActionLink onClick={() => void refresh()} disabled={loading || busyId !== null}>
          刷新记忆
        </SettingsActionLink>
      </div>
    </SettingsPanel>
  );
}
