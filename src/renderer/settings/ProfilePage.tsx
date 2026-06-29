import { useCallback, useEffect, useState } from 'react';
import type { ProfileEntryInfo } from '@/shared/types';

const SUGGESTED_KEYS = [
  { key: 'nickname', label: '称呼' },
  { key: 'preference.tone', label: '偏好语气' },
  { key: 'bio', label: '简介' },
  { key: 'notes', label: '备注' },
];

export function ProfilePage() {
  const [entries, setEntries] = useState<ProfileEntryInfo[]>([]);
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const list = await window.shorekeeper.profile.list();
    setEntries(list);
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh().catch(console.error);
  }, [refresh]);

  const handleAdd = async () => {
    const key = newKey.trim();
    if (!key || !newValue.trim()) return;
    await window.shorekeeper.profile.set(key, newValue.trim());
    setNewKey('');
    setNewValue('');
    await refresh();
  };

  const handleSaveEdit = async (key: string) => {
    await window.shorekeeper.profile.set(key, editValue.trim());
    setEditingKey(null);
    await refresh();
  };

  const handleDelete = async (key: string) => {
    await window.shorekeeper.profile.delete(key);
    await refresh();
  };

  if (loading) {
    return <p className="text-sm text-keeper-ice/60">加载中…</p>;
  }

  return (
    <div className="space-y-4">
      <p className="text-xs leading-relaxed text-keeper-ice/65">
        用户画像会注入到每次对话的 system prompt，帮助守岸人记住你的称呼与偏好。
      </p>

      <div className="space-y-2">
        {entries.length === 0 && (
          <p className="text-sm text-keeper-ice/50">暂无画像条目，可添加下方字段。</p>
        )}
        {entries.map((entry) => (
          <div
            key={entry.key}
            className="keeper-glass-soft rounded-xl px-3 py-2"
          >
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-keeper-cyan">{entry.key}</span>
              <div className="flex gap-1">
                <button
                  type="button"
                  onClick={() => {
                    setEditingKey(entry.key);
                    setEditValue(entry.value);
                  }}
                  className="text-xs text-keeper-ice/60 hover:text-keeper-cyan"
                >
                  编辑
                </button>
                <button
                  type="button"
                  onClick={() => handleDelete(entry.key)}
                  className="text-xs text-red-300/70 hover:text-red-300"
                >
                  删除
                </button>
              </div>
            </div>
            {editingKey === entry.key ? (
              <div className="flex gap-2">
                <input
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  className="min-w-0 flex-1 rounded-lg border border-keeper-cyan/20 bg-keeper-navyDeep/60 px-2 py-1 text-sm text-keeper-ice"
                />
                <button
                  type="button"
                  onClick={() => handleSaveEdit(entry.key)}
                  className="rounded-lg bg-keeper-cyan/20 px-2 py-1 text-xs text-keeper-cyan"
                >
                  保存
                </button>
              </div>
            ) : (
              <p className="text-sm text-keeper-ice/90">{entry.value}</p>
            )}
          </div>
        ))}
      </div>

      <div className="keeper-glass-soft space-y-2 rounded-xl p-3">
        <p className="text-xs text-keeper-ice/60">快捷添加</p>
        <div className="flex flex-wrap gap-1">
          {SUGGESTED_KEYS.filter(
            (s) => !entries.some((e) => e.key === s.key),
          ).map((s) => (
            <button
              key={s.key}
              type="button"
              onClick={() => setNewKey(s.key)}
              className="rounded-full border border-keeper-cyan/25 px-2 py-0.5 text-xs text-keeper-ice/70 hover:border-keeper-cyan/50"
            >
              {s.label}
            </button>
          ))}
        </div>
        <input
          value={newKey}
          onChange={(e) => setNewKey(e.target.value)}
          placeholder="字段名，如 nickname"
          className="w-full rounded-lg border border-keeper-cyan/20 bg-keeper-navyDeep/60 px-2 py-1.5 text-sm text-keeper-ice"
        />
        <input
          value={newValue}
          onChange={(e) => setNewValue(e.target.value)}
          placeholder="内容"
          className="w-full rounded-lg border border-keeper-cyan/20 bg-keeper-navyDeep/60 px-2 py-1.5 text-sm text-keeper-ice"
        />
        <button
          type="button"
          onClick={handleAdd}
          disabled={!newKey.trim() || !newValue.trim()}
          className="w-full rounded-lg bg-keeper-cyan/25 py-2 text-sm text-keeper-cyan disabled:opacity-40"
        >
          添加画像字段
        </button>
      </div>
    </div>
  );
}
