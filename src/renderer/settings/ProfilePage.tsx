import { useCallback, useEffect, useState } from 'react';
import type { ProfileEntryInfo } from '@/shared/types';
import {
  SettingsActionLink,
  SettingsChip,
  SettingsEmpty,
  SettingsField,
  SettingsInlineActions,
  SettingsIntro,
  SettingsListCard,
  SettingsLoading,
  SettingsPageShell,
  SettingsPanel,
  SettingsPrimaryButton,
  SETTINGS_INPUT_CLASS,
} from './components/settings-ui';

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

  if (loading) return <SettingsLoading />;

  return (
    <SettingsPageShell>
      <SettingsIntro>
        用户画像会注入到每次对话的 system prompt，帮助守岸人记住你的称呼与偏好。
      </SettingsIntro>

      <SettingsPanel title="画像条目" subtitle={`${entries.length} 个字段`} icon="👤">
        {entries.length === 0 ? (
          <SettingsEmpty title="暂无画像条目" hint="在下方添加字段，或点击快捷标签" />
        ) : (
          <div className="space-y-2">
            {entries.map((entry) => (
              <div key={entry.key} className="space-y-2">
                <SettingsListCard
                  title={entry.key}
                  subtitle={editingKey === entry.key ? undefined : entry.value}
                  actions={
                    editingKey !== entry.key ? (
                      <SettingsInlineActions>
                        <SettingsActionLink
                          onClick={() => {
                            setEditingKey(entry.key);
                            setEditValue(entry.value);
                          }}
                        >
                          编辑
                        </SettingsActionLink>
                        <SettingsActionLink onClick={() => void handleDelete(entry.key)} danger>
                          删除
                        </SettingsActionLink>
                      </SettingsInlineActions>
                    ) : undefined
                  }
                />
                {editingKey === entry.key && (
                  <div className="flex gap-2">
                    <input
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      className={SETTINGS_INPUT_CLASS}
                    />
                    <SettingsPrimaryButton
                      className="shrink-0 px-4"
                      onClick={() => void handleSaveEdit(entry.key)}
                    >
                      保存
                    </SettingsPrimaryButton>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </SettingsPanel>

      <SettingsPanel title="添加字段" subtitle="自定义或使用快捷标签" icon="➕">
        <div className="flex flex-wrap gap-1.5">
          {SUGGESTED_KEYS.filter((s) => !entries.some((e) => e.key === s.key)).map((s) => (
            <SettingsChip key={s.key} onClick={() => setNewKey(s.key)}>
              {s.label}
            </SettingsChip>
          ))}
        </div>
        <SettingsField label="字段名" hint="如 nickname、preference.tone">
          <input
            value={newKey}
            onChange={(e) => setNewKey(e.target.value)}
            placeholder="nickname"
            className={SETTINGS_INPUT_CLASS}
          />
        </SettingsField>
        <SettingsField label="内容">
          <input
            value={newValue}
            onChange={(e) => setNewValue(e.target.value)}
            placeholder="希望守岸人如何称呼你…"
            className={SETTINGS_INPUT_CLASS}
          />
        </SettingsField>
        <SettingsPrimaryButton
          className="w-full"
          disabled={!newKey.trim() || !newValue.trim()}
          onClick={() => void handleAdd()}
        >
          添加画像字段
        </SettingsPrimaryButton>
      </SettingsPanel>
    </SettingsPageShell>
  );
}
