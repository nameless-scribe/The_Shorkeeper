import { useState } from 'react';
import { ProfilePage } from './ProfilePage';
import { WorldbookPage } from './WorldbookPage';
import { TasksPage } from './TasksPage';
import { DocumentsPage } from './DocumentsPage';
import { McpPage } from './McpPage';
import { SkillsPage } from './SkillsPage';
import { ModelPage } from './ModelPage';
import { PerformancePage } from './PerformancePage';
import { PluginsPage } from './PluginsPage';
import { DisclaimerPage } from './DisclaimerPage';
import {
  SettingsSidebar,
  SETTINGS_TAB_TITLES,
  type SettingsTab,
} from './SettingsSidebar';

interface SettingsDrawerProps {
  open: boolean;
  onClose: () => void;
}

export function SettingsDrawer({ open, onClose }: SettingsDrawerProps) {
  const [tab, setTab] = useState<SettingsTab>('plugins');

  if (!open) return null;

  const { title, subtitle } = SETTINGS_TAB_TITLES[tab];

  return (
    <div className="no-drag absolute inset-0 z-30 flex bg-keeper-navyDeep/95 backdrop-blur-md">
      <SettingsSidebar tab={tab} onTabChange={setTab} />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex shrink-0 items-center justify-between border-b border-keeper-cyan/15 px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-keeper-ice">{title}</h2>
            <p className="mt-0.5 text-xs text-keeper-ice/50">{subtitle}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-keeper-ice/50 hover:bg-keeper-cyan/10 hover:text-keeper-cyan"
            title="关闭"
          >
            ✕
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {tab === 'plugins' && <PluginsPage />}
          {tab === 'profile' && <ProfilePage />}
          {tab === 'memory' && <PerformancePage />}
          {tab === 'worldbook' && <WorldbookPage />}
          {tab === 'tasks' && <TasksPage />}
          {tab === 'documents' && <DocumentsPage />}
          {tab === 'skills' && <SkillsPage />}
          {tab === 'mcp' && <McpPage />}
          {tab === 'model' && <ModelPage />}
          {tab === 'disclaimer' && <DisclaimerPage />}
        </div>
      </div>
    </div>
  );
}
