import { useCallback, useEffect, useState } from 'react';
import type { WorldbookEntryInfo } from '@/shared/types';

const EMPTY_FORM = {
  keys: '',
  content: '',
  priority: 0,
  enabled: true,
};

export function WorldbookPage() {
  const [entries, setEntries] = useState<WorldbookEntryInfo[]>([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const list = await window.shorekeeper.worldbook.list();
    setEntries(list);
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh().catch(console.error);
  }, [refresh]);

  const resetForm = () => {
    setForm(EMPTY_FORM);
    setEditingId(null);
  };

  const handleSubmit = async () => {
    if (!form.keys.trim() || !form.content.trim()) return;

    if (editingId) {
      await window.shorekeeper.worldbook.update(editingId, {
        keys: form.keys.trim(),
        content: form.content.trim(),
        priority: form.priority,
        enabled: form.enabled,
      });
    } else {
      await window.shorekeeper.worldbook.create({
        keys: form.keys.trim(),
        content: form.content.trim(),
        priority: form.priority,
        enabled: form.enabled,
      });
    }

    resetForm();
    await refresh();
  };

  const startEdit = (entry: WorldbookEntryInfo) => {
    setEditingId(entry.id);
    setForm({
      keys: entry.keys,
      content: entry.content,
      priority: entry.priority,
      enabled: entry.enabled,
    });
  };

  const toggleEnabled = async (entry: WorldbookEntryInfo) => {
    await window.shorekeeper.worldbook.update(entry.id, { enabled: !entry.enabled });
    await refresh();
  };

  const handleDelete = async (id: string) => {
    await window.shorekeeper.worldbook.delete(id);
    if (editingId === id) resetForm();
    await refresh();
  };

  if (loading) {
    return <p className="text-sm text-keeper-ice/60">加载中…</p>;
  }

  return (
    <div className="space-y-4">
      <p className="text-xs leading-relaxed text-keeper-ice/65">
        Worldbook 条目在用户消息命中关键词时自动注入对话上下文。触发词用逗号分隔。
      </p>

      <div className="max-h-52 space-y-2 overflow-y-auto pr-1">
        {entries.map((entry) => (
          <div
            key={entry.id}
            className={`keeper-glass-soft rounded-xl px-3 py-2 ${!entry.enabled ? 'opacity-50' : ''}`}
          >
            <div className="mb-1 flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-xs text-keeper-cyan">{entry.keys}</p>
                <p className="mt-1 line-clamp-2 text-xs text-keeper-ice/75">{entry.content}</p>
              </div>
              <span className="shrink-0 text-[10px] text-keeper-ice/40">P{entry.priority}</span>
            </div>
            <div className="flex gap-2 text-xs">
              <button
                type="button"
                onClick={() => toggleEnabled(entry)}
                className="text-keeper-ice/60 hover:text-keeper-cyan"
              >
                {entry.enabled ? '禁用' : '启用'}
              </button>
              <button
                type="button"
                onClick={() => startEdit(entry)}
                className="text-keeper-ice/60 hover:text-keeper-cyan"
              >
                编辑
              </button>
              <button
                type="button"
                onClick={() => handleDelete(entry.id)}
                className="text-red-300/70 hover:text-red-300"
              >
                删除
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="keeper-glass-soft space-y-2 rounded-xl p-3">
        <p className="text-xs font-medium text-keeper-ice/80">
          {editingId ? '编辑条目' : '新增条目'}
        </p>
        <input
          value={form.keys}
          onChange={(e) => setForm((f) => ({ ...f, keys: e.target.value }))}
          placeholder="触发词，逗号分隔，如：魔法,法术"
          className="w-full rounded-lg border border-keeper-cyan/20 bg-keeper-navyDeep/60 px-2 py-1.5 text-sm text-keeper-ice"
        />
        <textarea
          value={form.content}
          onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))}
          placeholder="命中后注入的背景内容"
          rows={3}
          className="w-full resize-none rounded-lg border border-keeper-cyan/20 bg-keeper-navyDeep/60 px-2 py-1.5 text-sm text-keeper-ice"
        />
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1 text-xs text-keeper-ice/70">
            优先级
            <input
              type="number"
              value={form.priority}
              onChange={(e) =>
                setForm((f) => ({ ...f, priority: Number(e.target.value) || 0 }))
              }
              className="w-16 rounded border border-keeper-cyan/20 bg-keeper-navyDeep/60 px-1 py-0.5 text-keeper-ice"
            />
          </label>
          <label className="flex items-center gap-1 text-xs text-keeper-ice/70">
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(e) => setForm((f) => ({ ...f, enabled: e.target.checked }))}
            />
            启用
          </label>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!form.keys.trim() || !form.content.trim()}
            className="flex-1 rounded-lg bg-keeper-cyan/25 py-2 text-sm text-keeper-cyan disabled:opacity-40"
          >
            {editingId ? '保存修改' : '添加条目'}
          </button>
          {editingId && (
            <button
              type="button"
              onClick={resetForm}
              className="rounded-lg border border-keeper-ice/20 px-3 py-2 text-sm text-keeper-ice/70"
            >
              取消
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
