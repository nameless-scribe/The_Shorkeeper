import { lazy, Suspense, useState } from 'react';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { TethysEmblem } from '../components/TethysEmblem';
import { SettingsLoading } from './components/settings-ui';
import {
  SettingsSidebar,
  SETTINGS_TAB_TITLES,
  type SettingsTab,
} from './SettingsSidebar';

const lazyPage = <T extends Record<string, unknown>, K extends keyof T>(
  loader: () => Promise<T>,
  exportName: K,
) => lazy(() => loader().then((module) => ({ default: module[exportName] as React.ComponentType<any> })));

const ProfilePage = lazyPage(() => import('./ProfilePage'), 'ProfilePage');
const PersonaPage = lazyPage(() => import('./PersonaPage'), 'PersonaPage');
const AppearancePage = lazyPage(() => import('./AppearancePage'), 'AppearancePage');
const WorldbookPage = lazyPage(() => import('./WorldbookPage'), 'WorldbookPage');
const TasksPage = lazyPage(() => import('./TasksPage'), 'TasksPage');
const UserTodosPage = lazyPage(() => import('./UserTodosPage'), 'UserTodosPage');
const DocumentsPage = lazyPage(() => import('./DocumentsPage'), 'DocumentsPage');
const McpPage = lazyPage(() => import('./McpPage'), 'McpPage');
const SkillsPage = lazyPage(() => import('./SkillsPage'), 'SkillsPage');
const ModelPage = lazyPage(() => import('./ModelPage'), 'ModelPage');
const PerformancePage = lazyPage(() => import('./PerformancePage'), 'PerformancePage');
const PluginsPage = lazyPage(() => import('./PluginsPage'), 'PluginsPage');
const DisclaimerPage = lazyPage(() => import('./DisclaimerPage'), 'DisclaimerPage');
const AboutPage = lazyPage(() => import('./AboutPage'), 'AboutPage');
const VoicePage = lazyPage(() => import('./VoicePage'), 'VoicePage');
const RunHistoryPage = lazyPage(() => import('./RunHistoryPage'), 'RunHistoryPage');
const DataSourcesPage = lazyPage(() => import('./DataSourcesPage'), 'DataSourcesPage');

interface SettingsDrawerProps {
  open: boolean;
  onClose: () => void;
  onConfigChange?: () => void;
  /** 外部要求打开的页签（例如收件箱回链）；每次变化都会切换 */
  requestedTab?: { tab: SettingsTab; nonce: number } | null;
}

export function SettingsDrawer({ open, onClose, onConfigChange, requestedTab }: SettingsDrawerProps) {
  const [tab, setTab] = useState<SettingsTab>('plugins');
  const [seenNonce, setSeenNonce] = useState<number | null>(null);

  // 在渲染期间切换页签，避免先挂载旧页签一帧再跳转。
  if (requestedTab && requestedTab.nonce !== seenNonce) {
    setSeenNonce(requestedTab.nonce);
    setTab(requestedTab.tab);
  }

  if (!open) return null;

  const { title, subtitle, icon } = SETTINGS_TAB_TITLES[tab];

  return (
    <div className="no-drag absolute inset-0 z-30 flex bg-keeper-navyDeep/96 backdrop-blur-xl">
      <SettingsSidebar tab={tab} onTabChange={setTab} />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex shrink-0 items-center justify-between border-b border-keeper-cyan/12 bg-keeper-navyDeep/40 px-3 py-4 sm:px-6">
          <div className="flex items-center gap-3">
            {tab === 'about' ? (
              <TethysEmblem size="md" />
            ) : (
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-keeper-cyan/12 text-lg">
                {icon}
              </span>
            )}
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

        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-5 sm:px-6">
          <ErrorBoundary>
            <Suspense fallback={<SettingsLoading />}>
              {tab === 'plugins' && <PluginsPage />}
              {tab === 'persona' && (
                <PersonaPage onOpenWorldbook={() => setTab('worldbook')} />
              )}
              {tab === 'profile' && <ProfilePage />}
              {tab === 'memory' && <PerformancePage />}
              {tab === 'worldbook' && <WorldbookPage />}
              {tab === 'appearance' && <AppearancePage />}
              {tab === 'voice' && <VoicePage />}
              {tab === 'userTodos' && <UserTodosPage />}
              {tab === 'tasks' && <TasksPage />}
              {tab === 'runs' && <RunHistoryPage />}
              {tab === 'documents' && <DocumentsPage />}
              {tab === 'datasources' && <DataSourcesPage />}
              {tab === 'skills' && <SkillsPage />}
              {tab === 'mcp' && <McpPage />}
              {tab === 'model' && <ModelPage onConfigChange={onConfigChange} />}
              {tab === 'about' && <AboutPage />}
              {tab === 'disclaimer' && <DisclaimerPage />}
            </Suspense>
          </ErrorBoundary>
        </div>
      </div>
    </div>
  );
}
