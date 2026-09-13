import { useCallback, useEffect, useState } from 'react';
import type { DailyStewardSettingsInfo, ScheduleKind, ScheduledTaskInfo } from '@/shared/types';
import { formatScheduleLabel } from '@/scheduler/format';
import { SettingsSegmented } from './components/SettingsSegmented';
import {
  SettingsActionLink,
  SettingsBadge,
  SettingsEmpty,
  SettingsField,
  SettingsInlineActions,
  SettingsIntro,
  SettingsListCard,
  SettingsPageShell,
  SettingsPanel,
  SettingsPrimaryButton,
  SETTINGS_INPUT_CLASS,
  SETTINGS_SELECT_CLASS,
  SETTINGS_TEXTAREA_CLASS,
} from './components/settings-ui';

function defaultRunAtLocal(): string {
  const d = new Date(Date.now() + 3600_000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const EMPTY_FORM = {
  name: '',
  scheduleKind: 'recurring' as ScheduleKind,
  cron: '0 9 * * *',
  runAtLocal: defaultRunAtLocal(),
  actionType: 'reminder' as 'reminder' | 'agent_prompt',
  message: '',
};

function DailyStewardPanel() {
  const [settings, setSettings] = useState<DailyStewardSettingsInfo | null>(null);
  const [draft, setDraft] = useState<DailyStewardSettingsInfo | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    window.shorekeeper.steward
      .get()
      .then((value) => {
        setSettings(value);
        setDraft(value);
      })
      .catch(console.error);
  }, []);

  if (!draft) return null;

  const dirty = JSON.stringify(draft) !== JSON.stringify(settings);
  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const saved = await window.shorekeeper.steward.set(draft);
      setSettings(saved);
      setDraft(saved);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <SettingsPanel
      title="每日管家"
      subtitle={settings?.enabled ? `早 ${settings.morningTime} · 晚 ${settings.eveningTime}` : '未开启'}
      icon="🌅"
    >
      <SettingsField
        label="状态"
        hint="开启后会创建两条系统任务：早间简报聚合待办、提醒、承诺与目标；晚间复盘逐项确认未完成事项。安静时段内会推迟。"
      >
        <SettingsSegmented
          value={draft.enabled ? 'on' : 'off'}
          options={[
            { value: 'on', label: '开启' },
            { value: 'off', label: '关闭' },
          ]}
          onChange={(value) => setDraft((d) => (d ? { ...d, enabled: value === 'on' } : d))}
        />
      </SettingsField>
      <SettingsField label="早间简报时间">
        <input
          type="time"
          value={draft.morningTime}
          onChange={(e) => setDraft((d) => (d ? { ...d, morningTime: e.target.value } : d))}
          className={SETTINGS_INPUT_CLASS}
        />
      </SettingsField>
      <SettingsField label="晚间复盘时间">
        <input
          type="time"
          value={draft.eveningTime}
          onChange={(e) => setDraft((d) => (d ? { ...d, eveningTime: e.target.value } : d))}
          className={SETTINGS_INPUT_CLASS}
        />
      </SettingsField>
      <SettingsField label="生成后弹出提醒" hint="只弹标题，正文在聊天窗口中查看">
        <SettingsSegmented
          value={draft.popup ? 'on' : 'off'}
          options={[
            { value: 'on', label: '弹出' },
            { value: 'off', label: '不弹' },
          ]}
          onChange={(value) => setDraft((d) => (d ? { ...d, popup: value === 'on' } : d))}
        />
      </SettingsField>
      {error ? <p className="text-xs text-red-400">{error}</p> : null}
      <SettingsPrimaryButton className="w-full" disabled={saving || !dirty} onClick={() => void save()}>
        {saving ? '保存中…' : '保存每日管家设置'}
      </SettingsPrimaryButton>
    </SettingsPanel>
  );
}

export function TasksPage() {
  const [tasks, setTasks] = useState<ScheduledTaskInfo[]>([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const list = await window.shorekeeper.tasks.list();
    setTasks(list);
  }, []);

  useEffect(() => {
    load().catch(console.error);
    const off = window.shorekeeper.tasks.onUpdated(() => {
      load().catch(console.error);
    });
    return () => {
      off();
    };
  }, [load]);

  const handleCreate = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      const payload =
        form.actionType === 'reminder'
          ? JSON.stringify({ message: form.message || form.name })
          : JSON.stringify({ prompt: form.message || form.name });

      await window.shorekeeper.tasks.create({
        name: form.name.trim(),
        scheduleKind: form.scheduleKind,
        cron: form.scheduleKind === 'recurring' ? form.cron.trim() : '',
        runAt: form.scheduleKind === 'once' ? new Date(form.runAtLocal).getTime() : null,
        actionType: form.actionType,
        actionPayload: payload,
        enabled: true,
      });
      setForm({ ...EMPTY_FORM, runAtLocal: defaultRunAtLocal() });
      await load();
    } finally {
      setSaving(false);
    }
  };

  const toggleEnabled = async (task: ScheduledTaskInfo) => {
    await window.shorekeeper.tasks.update(task.id, { enabled: !task.enabled });
    await load();
  };

  const remove = async (id: string) => {
    await window.shorekeeper.tasks.delete(id);
    await load();
  };

  return (
    <SettingsPageShell>
      <SettingsIntro>
        创建定时提醒或静默 Agent 任务。Agent 也可通过对话调用 create_scheduled_task 工具创建。
      </SettingsIntro>

      <DailyStewardPanel />

      <SettingsPanel title="新建任务" icon="⏰">
        <SettingsField label="任务名称">
          <input
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            placeholder="如：晨间提醒"
            className={SETTINGS_INPUT_CLASS}
          />
        </SettingsField>

        <SettingsField label="调度类型">
          <SettingsSegmented
            value={form.scheduleKind}
            options={[
              { value: 'recurring', label: '周期性' },
              { value: 'once', label: '仅一次' },
            ]}
            onChange={(scheduleKind) => setForm((f) => ({ ...f, scheduleKind }))}
          />
        </SettingsField>

        {form.scheduleKind === 'recurring' ? (
          <SettingsField label="Cron 表达式" hint="如 0 9 * * * 表示每天 9:00">
            <input
              value={form.cron}
              onChange={(e) => setForm((f) => ({ ...f, cron: e.target.value }))}
              placeholder="0 9 * * *"
              className={`${SETTINGS_INPUT_CLASS} font-mono text-[13px]`}
            />
          </SettingsField>
        ) : (
          <SettingsField label="执行时间">
            <input
              type="datetime-local"
              value={form.runAtLocal}
              onChange={(e) => setForm((f) => ({ ...f, runAtLocal: e.target.value }))}
              className={SETTINGS_INPUT_CLASS}
            />
          </SettingsField>
        )}

        <SettingsField label="任务类型">
          <select
            value={form.actionType}
            onChange={(e) =>
              setForm((f) => ({
                ...f,
                actionType: e.target.value as 'reminder' | 'agent_prompt',
              }))
            }
            className={SETTINGS_SELECT_CLASS}
          >
            <option value="reminder">提醒通知</option>
            <option value="agent_prompt">Agent 静默执行</option>
          </select>
        </SettingsField>

        <SettingsField label="内容 / 提示词">
          <textarea
            value={form.message}
            onChange={(e) => setForm((f) => ({ ...f, message: e.target.value }))}
            placeholder="提醒正文或 Agent 提示词"
            rows={2}
            className={SETTINGS_TEXTAREA_CLASS}
          />
        </SettingsField>

        <SettingsPrimaryButton
          className="w-full"
          disabled={saving || !form.name.trim()}
          onClick={() => void handleCreate()}
        >
          {saving ? '添加中…' : '添加任务'}
        </SettingsPrimaryButton>
      </SettingsPanel>

      <SettingsPanel title="已有任务" subtitle={`${tasks.length} 个`} icon="📋">
        {tasks.length === 0 ? (
          <SettingsEmpty title="暂无定时任务" />
        ) : (
          <div className="space-y-2">
            {tasks.map((task) => (
              <SettingsListCard
                key={task.id}
                title={task.name}
                subtitle={formatScheduleLabel(task)}
                meta={task.actionType}
                badge={
                  task.enabled ? (
                    <SettingsBadge tone="green">启用</SettingsBadge>
                  ) : (
                    <SettingsBadge tone="muted">停用</SettingsBadge>
                  )
                }
                actions={
                  <SettingsInlineActions>
                    <SettingsActionLink onClick={() => void toggleEnabled(task)}>
                      {task.enabled ? '停用' : '启用'}
                    </SettingsActionLink>
                    <SettingsActionLink onClick={() => void remove(task.id)} danger>
                      删除
                    </SettingsActionLink>
                  </SettingsInlineActions>
                }
              />
            ))}
          </div>
        )}
      </SettingsPanel>
    </SettingsPageShell>
  );
}
