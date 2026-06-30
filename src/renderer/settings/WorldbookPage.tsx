import { useCallback, useEffect, useState } from 'react';
import type { WorldbookEntryInfo } from '@/shared/types';
import {
  SettingsActionLink,
  SettingsBadge,
  SettingsEmpty,
  SettingsField,
  SettingsInlineActions,
  SettingsIntro,
  SettingsListCard,
  SettingsLoading,
  SettingsPageShell,
  SettingsPanel,
  SettingsPrimaryButton,
  SettingsSecondaryButton,
  SETTINGS_INPUT_CLASS,
  SETTINGS_TEXTAREA_CLASS,
} from './components/settings-ui';

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

  if (loading) return <SettingsLoading />;

  return (
    <SettingsPageShell>
      <SettingsIntro>
        Worldbook 条目在用户消息命中关键词时自动注入对话上下文。触发词用逗号分隔。
      </SettingsIntro>

      <SettingsPanel title="条目列表" subtitle={`${entries.length} 条`} icon="📖">
        {entries.length === 0 ? (
          <SettingsEmpty title="暂无 Worldbook 条目" hint="在下方表单添加第一条" />
        ) : (
          <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
            {entries.map((entry) => (
              <SettingsListCard
                key={entry.id}
                title={entry.keys}
                subtitle={entry.content}
                meta={`优先级 P${entry.priority}`}
                dimmed={!entry.enabled}
                badge={
                  entry.enabled ? (
                    <SettingsBadge tone="green">启用</SettingsBadge>
                  ) : (
                    <SettingsBadge tone="muted">禁用</SettingsBadge>
                  )
                }
                actions={
                  <SettingsInlineActions>
                    <SettingsActionLink onClick={() => void toggleEnabled(entry)}>
                      {entry.enabled ? '禁用' : '启用'}
                    </SettingsActionLink>
                    <SettingsActionLink onClick={() => startEdit(entry)}>编辑</SettingsActionLink>
                    <SettingsActionLink onClick={() => void handleDelete(entry.id)} danger>
                      删除
                    </SettingsActionLink>
                  </SettingsInlineActions>
                }
              />
            ))}
          </div>
        )}
      </SettingsPanel>

      <SettingsPanel
        title={editingId ? '编辑条目' : '新增条目'}
        icon={editingId ? '✏️' : '➕'}
      >
        <SettingsField label="触发词" hint="逗号分隔，如：魔法,法术,咒语">
          <input
            value={form.keys}
            onChange={(e) => setForm((f) => ({ ...f, keys: e.target.value }))}
            placeholder="魔法,法术"
            className={SETTINGS_INPUT_CLASS}
          />
        </SettingsField>
        <SettingsField label="注入内容">
          <textarea
            value={form.content}
            onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))}
            placeholder="命中后注入的背景设定…"
            rows={4}
            className={SETTINGS_TEXTAREA_CLASS}
          />
        </SettingsField>
        <div className="flex flex-wrap items-center gap-4">
          <SettingsField label="优先级">
            <input
              type="number"
              value={form.priority}
              onChange={(e) =>
                setForm((f) => ({ ...f, priority: Number(e.target.value) || 0 }))
              }
              className={`${SETTINGS_INPUT_CLASS} max-w-[100px]`}
            />
          </SettingsField>
          <label className="flex items-center gap-2 pt-5 text-xs text-keeper-ice/70">
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(e) => setForm((f) => ({ ...f, enabled: e.target.checked }))}
              className="rounded"
            />
            启用
          </label>
        </div>
        <div className="flex gap-2 pt-1">
          <SettingsPrimaryButton
            className="flex-1"
            disabled={!form.keys.trim() || !form.content.trim()}
            onClick={() => void handleSubmit()}
          >
            {editingId ? '保存修改' : '添加条目'}
          </SettingsPrimaryButton>
          {editingId && (
            <SettingsSecondaryButton onClick={resetForm}>取消</SettingsSecondaryButton>
          )}
        </div>
      </SettingsPanel>
    </SettingsPageShell>
  );
}
