import { useCallback, useEffect, useState } from 'react';
import type { ScheduleKind, ScheduledTaskInfo } from '@/shared/types';
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
