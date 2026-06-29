import { useCallback, useEffect, useState } from 'react';
import type { ScheduledTaskInfo } from '@/shared/types';
import { formatDockScheduleShort, sortDockScheduleTasks } from '@/scheduler/format';

export function DockScheduleBar() {
  const [tasks, setTasks] = useState<ScheduledTaskInfo[]>([]);

  const loadTasks = useCallback(async () => {
    const list = await window.shorekeeper.tasks.list();
    setTasks(sortDockScheduleTasks(list));
  }, []);

  useEffect(() => {
    loadTasks().catch(console.error);
    const off = window.shorekeeper.tasks.onUpdated(() => {
      loadTasks().catch(console.error);
    });
    return () => {
      off();
    };
  }, [loadTasks]);

  return (
    <div
      data-dock-action="schedule"
      title="打开日程面板"
      className="flex min-w-0 flex-1 flex-col gap-1 rounded-2xl border border-keeper-cyan/20 bg-keeper-navyDeep/75 px-2.5 py-2 backdrop-blur-md transition hover:border-keeper-cyan/35 hover:bg-keeper-navyDeep/90"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-medium tracking-wide text-keeper-cyan/90">日程</span>
        <span className="text-[10px] text-keeper-ice/40">{tasks.length} 项</span>
      </div>

      {tasks.length === 0 ? (
        <p className="text-[10px] text-keeper-ice/35">暂无定时任务</p>
      ) : (
        <div
          className="flex gap-1.5 overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          onPointerDown={(event) => event.stopPropagation()}
        >
          {tasks.map((task) => (
            <span
              key={task.id}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-keeper-silver/15 bg-white/5 px-2 py-1"
            >
              <span className="max-w-[88px] truncate text-[11px] text-keeper-ice">{task.name}</span>
              <span className="text-[10px] text-keeper-ice/45">
                {formatDockScheduleShort(task)}
              </span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
