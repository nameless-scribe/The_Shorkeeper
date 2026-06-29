import { useCallback, useEffect, useState } from 'react';
import type { ScheduleKind, ScheduledTaskInfo } from '@/shared/types';
import { formatScheduleLabel } from '@/scheduler/format';

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
    <div className="space-y-4">
      <div className="keeper-glass-soft space-y-3 rounded-2xl p-4">
        <p className="text-xs font-medium text-keeper-ice/80">新建任务</p>
        <input
          className="no-drag w-full rounded-lg border border-keeper-silver/20 bg-keeper-navyDeep/50 px-3 py-2 text-xs text-keeper-ice outline-none focus:border-keeper-cyan/40"
          placeholder="任务名称"
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
        />
        <select
          className="no-drag w-full rounded-lg border border-keeper-silver/20 bg-keeper-navyDeep/50 px-3 py-2 text-xs text-keeper-ice outline-none"
          value={form.scheduleKind}
          onChange={(e) =>
            setForm((f) => ({
              ...f,
              scheduleKind: e.target.value as ScheduleKind,
            }))
          }
        >
          <option value="recurring">周期性（每天/按 cron）</option>
          <option value="once">仅一次</option>
        </select>
        {form.scheduleKind === 'recurring' ? (
          <input
            className="no-drag w-full rounded-lg border border-keeper-silver/20 bg-keeper-navyDeep/50 px-3 py-2 text-xs text-keeper-ice outline-none focus:border-keeper-cyan/40"
            placeholder="Cron 表达式，如 0 9 * * *"
            value={form.cron}
            onChange={(e) => setForm((f) => ({ ...f, cron: e.target.value }))}
          />
        ) : (
          <input
            type="datetime-local"
            className="no-drag w-full rounded-lg border border-keeper-silver/20 bg-keeper-navyDeep/50 px-3 py-2 text-xs text-keeper-ice outline-none focus:border-keeper-cyan/40"
            value={form.runAtLocal}
            onChange={(e) => setForm((f) => ({ ...f, runAtLocal: e.target.value }))}
          />
        )}
        <select
          className="no-drag w-full rounded-lg border border-keeper-silver/20 bg-keeper-navyDeep/50 px-3 py-2 text-xs text-keeper-ice outline-none"
          value={form.actionType}
          onChange={(e) =>
            setForm((f) => ({
              ...f,
              actionType: e.target.value as 'reminder' | 'agent_prompt',
            }))
          }
        >
          <option value="reminder">提醒通知</option>
          <option value="agent_prompt">Agent 静默执行</option>
        </select>
        <textarea
          className="no-drag w-full rounded-lg border border-keeper-silver/20 bg-keeper-navyDeep/50 px-3 py-2 text-xs text-keeper-ice outline-none focus:border-keeper-cyan/40"
          placeholder="提醒内容 / Agent 提示词"
          rows={2}
          value={form.message}
          onChange={(e) => setForm((f) => ({ ...f, message: e.target.value }))}
        />
        <button
          type="button"
          disabled={saving || !form.name.trim()}
          onClick={handleCreate}
          className="no-drag w-full rounded-xl bg-keeper-cyan/20 py-2 text-xs font-medium text-keeper-cyan hover:bg-keeper-cyan/30 disabled:opacity-40"
        >
          添加任务
        </button>
      </div>

      <ul className="space-y-2">
        {tasks.map((task) => (
          <li
            key={task.id}
            className="keeper-glass-soft flex items-start justify-between gap-2 rounded-xl p-3"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium text-keeper-ice">{task.name}</p>
              <p className="text-[10px] text-keeper-ice/40">{formatScheduleLabel(task)}</p>
              <p className="text-[10px] text-keeper-ice/30">{task.actionType}</p>
            </div>
            <div className="no-drag flex shrink-0 flex-col gap-1">
              <button
                type="button"
                onClick={() => toggleEnabled(task)}
                className="rounded-lg px-2 py-1 text-[10px] text-keeper-cyan hover:bg-keeper-cyan/10"
              >
                {task.enabled ? '停用' : '启用'}
              </button>
              <button
                type="button"
                onClick={() => remove(task.id)}
                className="rounded-lg px-2 py-1 text-[10px] text-red-300 hover:bg-red-500/10"
              >
                删除
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
