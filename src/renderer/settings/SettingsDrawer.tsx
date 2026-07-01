import { useState } from 'react';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { ProfilePage } from './ProfilePage';
import { PersonaPage } from './PersonaPage';
import { AppearancePage } from './AppearancePage';
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
  onConfigChange?: () => void;
}

export function SettingsDrawer({ open, onClose, onConfigChange }: SettingsDrawerProps) {
  const [tab, setTab] = useState<SettingsTab>('plugins');

  if (!open) return null;

  const { title, subtitle, icon } = SETTINGS_TAB_TITLES[tab];

  return (
    <div className="no-drag absolute inset-0 z-30 flex bg-keeper-navyDeep/96 backdrop-blur-xl">
      <SettingsSidebar tab={tab} onTabChange={setTab} />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex shrink-0 items-center justify-between border-b border-keeper-cyan/12 bg-keeper-navyDeep/40 px-6 py-4">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-keeper-cyan/12 text-lg">
              {icon}
            </span>
            <div>
              <h2 className="text-base font-semibold text-keeper-ice">{title}</h2>
              <p className="mt-0.5 text-xs text-keeper-ice/45">{subtitle}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-keeper-silver/15 text-keeper-ice/50 transition hover:border-keeper-cyan/30 hover:bg-keeper-cyan/10 hover:text-keeper-cyan"
            title="关闭"
          >
            ✕
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          <ErrorBoundary>
            {tab === 'plugins' && <PluginsPage />}
            {tab === 'persona' && (
              <PersonaPage onOpenWorldbook={() => setTab('worldbook')} />
            )}
            {tab === 'profile' && <ProfilePage />}
            {tab === 'memory' && <PerformancePage />}
            {tab === 'worldbook' && <WorldbookPage />}
            {tab === 'appearance' && <AppearancePage />}
            {tab === 'tasks' && <TasksPage />}
            {tab === 'documents' && <DocumentsPage />}
            {tab === 'skills' && <SkillsPage />}
            {tab === 'mcp' && <McpPage />}
            {tab === 'model' && <ModelPage onConfigChange={onConfigChange} />}
            {tab === 'disclaimer' && <DisclaimerPage />}
          </ErrorBoundary>
        </div>
      </div>
    </div>
  );
}
