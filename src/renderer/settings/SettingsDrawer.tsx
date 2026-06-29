import { useState } from 'react';
import { ProfilePage } from './ProfilePage';
import { WorldbookPage } from './WorldbookPage';
import { TasksPage } from './TasksPage';

type SettingsTab = 'profile' | 'worldbook' | 'tasks';

interface SettingsDrawerProps {
  open: boolean;
  onClose: () => void;
}

export function SettingsDrawer({ open, onClose }: SettingsDrawerProps) {
  const [tab, setTab] = useState<SettingsTab>('profile');

  if (!open) return null;

  return (
    <div className="no-drag absolute inset-0 z-30 flex flex-col bg-keeper-navyDeep/92 backdrop-blur-md">
      <header className="flex shrink-0 items-center justify-between border-b border-keeper-cyan/15 px-4 py-3">
        <h2 className="text-sm font-semibold text-keeper-ice">设置</h2>
        <button
          type="button"
          onClick={onClose}
          className="flex h-7 w-7 items-center justify-center rounded-lg text-keeper-ice/50 hover:bg-keeper-cyan/10 hover:text-keeper-cyan"
          title="关闭"
        >
          ✕
        </button>
      </header>

      <div className="flex shrink-0 gap-1 border-b border-keeper-cyan/10 px-4 py-2">
        <button
          type="button"
          onClick={() => setTab('profile')}
          className={`rounded-lg px-3 py-1.5 text-xs ${
            tab === 'profile'
              ? 'bg-keeper-cyan/20 text-keeper-cyan'
              : 'text-keeper-ice/60 hover:text-keeper-ice'
          }`}
        >
          用户画像
        </button>
        <button
          type="button"
          onClick={() => setTab('worldbook')}
          className={`rounded-lg px-3 py-1.5 text-xs ${
            tab === 'worldbook'
              ? 'bg-keeper-cyan/20 text-keeper-cyan'
              : 'text-keeper-ice/60 hover:text-keeper-ice'
          }`}
        >
          Worldbook
        </button>
        <button
          type="button"
          onClick={() => setTab('tasks')}
          className={`rounded-lg px-3 py-1.5 text-xs ${
            tab === 'tasks'
              ? 'bg-keeper-cyan/20 text-keeper-cyan'
              : 'text-keeper-ice/60 hover:text-keeper-ice'
          }`}
        >
          定时任务
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {tab === 'profile' && <ProfilePage />}
        {tab === 'worldbook' && <WorldbookPage />}
        {tab === 'tasks' && <TasksPage />}
      </div>
    </div>
  );
}
