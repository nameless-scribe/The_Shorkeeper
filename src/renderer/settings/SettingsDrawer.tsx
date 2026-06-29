import { useState } from 'react';
import { ProfilePage } from './ProfilePage';
import { WorldbookPage } from './WorldbookPage';
import { TasksPage } from './TasksPage';
import { DocumentsPage } from './DocumentsPage';
import { McpPage } from './McpPage';
import { SkillsPage } from './SkillsPage';
import { ModelPage } from './ModelPage';

type SettingsTab = 'profile' | 'worldbook' | 'tasks' | 'documents' | 'skills' | 'mcp' | 'model';

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

      <div className="flex shrink-0 flex-wrap gap-1 border-b border-keeper-cyan/10 px-4 py-2">
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
        <button
          type="button"
          onClick={() => setTab('documents')}
          className={`rounded-lg px-3 py-1.5 text-xs ${
            tab === 'documents'
              ? 'bg-keeper-cyan/20 text-keeper-cyan'
              : 'text-keeper-ice/60 hover:text-keeper-ice'
          }`}
        >
          文档
        </button>
        <button
          type="button"
          onClick={() => setTab('skills')}
          className={`rounded-lg px-3 py-1.5 text-xs ${
            tab === 'skills'
              ? 'bg-keeper-cyan/20 text-keeper-cyan'
              : 'text-keeper-ice/60 hover:text-keeper-ice'
          }`}
        >
          技能
        </button>
        <button
          type="button"
          onClick={() => setTab('mcp')}
          className={`rounded-lg px-3 py-1.5 text-xs ${
            tab === 'mcp'
              ? 'bg-keeper-cyan/20 text-keeper-cyan'
              : 'text-keeper-ice/60 hover:text-keeper-ice'
          }`}
        >
          MCP
        </button>
        <button
          type="button"
          onClick={() => setTab('model')}
          className={`rounded-lg px-3 py-1.5 text-xs ${
            tab === 'model'
              ? 'bg-keeper-cyan/20 text-keeper-cyan'
              : 'text-keeper-ice/60 hover:text-keeper-ice'
          }`}
        >
          模型
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {tab === 'profile' && <ProfilePage />}
        {tab === 'worldbook' && <WorldbookPage />}
        {tab === 'tasks' && <TasksPage />}
        {tab === 'documents' && <DocumentsPage />}
        {tab === 'skills' && <SkillsPage />}
        {tab === 'mcp' && <McpPage />}
        {tab === 'model' && <ModelPage />}
      </div>
    </div>
  );
}
