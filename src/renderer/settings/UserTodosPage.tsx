import { useCallback, useEffect, useState } from 'react';
import type { UserTaskInfo, UserTaskStatus } from '@/shared/types';
import { SettingsSegmented } from './components/SettingsSegmented';
import {
  SettingsActionLink,
  SettingsBadge,
  SettingsEmpty,
  SettingsInlineActions,
  SettingsIntro,
  SettingsListCard,
  SettingsPageShell,
  SettingsPanel,
} from './components/settings-ui';

const STATUS_LABEL: Record<UserTaskStatus, string> = {
  pending: '待开始',
  in_progress: '进行中',
  done: '已完成',
  cancelled: '已取消',
};

const STATUS_TONE: Record<UserTaskStatus, 'muted' | 'cyan' | 'green' | 'amber'> = {
  pending: 'muted',
  in_progress: 'cyan',
  done: 'green',
  cancelled: 'amber',
};

export function UserTodosPage() {
  const [tasks, setTasks] = useState<UserTaskInfo[]>([]);
  const [filter, setFilter] = useState<UserTaskStatus | 'all'>('all');

  const load = useCallback(async () => {
    const list = await window.shorekeeper.userTasks.list(
      filter === 'all' ? undefined : { status: filter },
    );
    setTasks(list);
  }, [filter]);

  useEffect(() => {
    load().catch(console.error);
    const off = window.shorekeeper.userTasks.onUpdated(() => {
      load().catch(console.error);
    });
    return () => off();
  }, [load]);

  const setStatus = async (id: string, status: UserTaskStatus) => {
    await window.shorekeeper.userTasks.update(id, { status });
    await load();
  };

  return (
    <SettingsPageShell>
      <SettingsIntro>
        用户待办由对话中的 import_tasks_from_xlsx / update_user_task 工具维护，也可在此查看与改状态。
        来自 Excel 的任务更新状态时会尝试回写源表格。
      </SettingsIntro>

      <SettingsPanel title="筛选" icon="🔍">
        <SettingsSegmented<UserTaskStatus | 'all'>
          value={filter}
          options={[
            { value: 'all', label: '全部' },
            { value: 'pending', label: '待开始' },
            { value: 'in_progress', label: '进行中' },
            { value: 'done', label: '已完成' },
            { value: 'cancelled', label: '已取消' },
          ]}
          onChange={setFilter}
        />
      </SettingsPanel>

      <SettingsPanel title="待办列表" subtitle={`${tasks.length} 项`} icon="✅">
        {tasks.length === 0 ? (
          <SettingsEmpty title="暂无待办" hint="上传 Excel 后让助手「导入表格待办」" />
        ) : (
          <div className="space-y-2">
            {tasks.map((task) => (
              <SettingsListCard
                key={task.id}
                title={task.title}
                subtitle={task.module ?? task.sourceFile ?? undefined}
                meta={task.dueAt ? `截止 ${task.dueAt}` : task.notes ?? undefined}
                badge={
                  <SettingsBadge tone={STATUS_TONE[task.status]}>
                    {STATUS_LABEL[task.status]}
                  </SettingsBadge>
                }
                actions={
                  <SettingsInlineActions>
                    {task.status !== 'in_progress' && (
                      <SettingsActionLink
                        onClick={() => void setStatus(task.id, 'in_progress')}
                      >
                        进行中
                      </SettingsActionLink>
                    )}
                    {task.status !== 'done' && (
                      <SettingsActionLink onClick={() => void setStatus(task.id, 'done')}>
                        完成
                      </SettingsActionLink>
                    )}
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
