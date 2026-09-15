import { useEffect, useState } from 'react';
import { TethysEmblem } from '../components/TethysEmblem';

export type SettingsTab =
  | 'plugins'
  | 'persona'
  | 'profile'
  | 'memory'
  | 'worldbook'
  | 'appearance'
  | 'voice'
  | 'tasks'
  | 'userTodos'
  | 'runs'
  | 'documents'
  | 'datasources'
  | 'skills'
  | 'mcp'
  | 'model'
  | 'about'
  | 'disclaimer';

interface NavItem {
  id: SettingsTab;
  label: string;
  icon: string;
  disabled?: boolean;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    label: '能力',
    items: [
      { id: 'plugins', label: '插件', icon: '🧩' },
      { id: 'skills', label: '技能', icon: '✨' },
      { id: 'mcp', label: 'MCP', icon: '🔌' },
    ],
  },
  {
    label: '人格与记忆',
    items: [
      { id: 'persona', label: '人设', icon: '🎭' },
      { id: 'profile', label: '用户信息', icon: '👤' },
      { id: 'memory', label: '记忆', icon: '🧠' },
      { id: 'worldbook', label: 'Worldbook', icon: '📖' },
    ],
  },
  {
    label: '个性化',
    items: [
      { id: 'appearance', label: '外观', icon: '🎨' },
      { id: 'voice', label: '语音', icon: '🔊' },
    ],
  },
  {
    label: '数据与任务',
    items: [
      { id: 'documents', label: '泰提斯终端', icon: '🛰' },
      { id: 'datasources', label: '数据源', icon: '🗄' },
      { id: 'userTodos', label: '用户待办', icon: '✅' },
      { id: 'tasks', label: '定时任务', icon: '⏰' },
      { id: 'runs', label: '运行记录', icon: '📋' },
    ],
  },
  {
    label: '系统',
    items: [
      { id: 'model', label: 'API 设置', icon: '🔑' },
      { id: 'about', label: '关于与更新', icon: 'ℹ️' },
      { id: 'disclaimer', label: '免责声明', icon: '⚠️' },
    ],
  },
];

export const NAV_ITEMS: NavItem[] = NAV_GROUPS.flatMap((g) => g.items);

interface SettingsSidebarProps {
  tab: SettingsTab;
  onTabChange: (tab: SettingsTab) => void;
}

export function SettingsSidebar({ tab, onTabChange }: SettingsSidebarProps) {
  const [version, setVersion] = useState('');

  useEffect(() => {
    void window.shorekeeper?.update?.getVersion().then(setVersion).catch(() => undefined);
  }, []);

  return (
    <aside className="flex w-[68px] shrink-0 flex-col border-r border-keeper-cyan/10 bg-gradient-to-b from-keeper-navyDeep/80 to-keeper-navyDeep/95 sm:w-48">
      <div className="shrink-0 border-b border-keeper-cyan/10 px-2 py-4 sm:px-4">
        <div className="flex items-center justify-center gap-2.5 sm:justify-start">
          <TethysEmblem size="sm" />
          <div className="hidden sm:block">
            <p className="text-sm font-semibold text-keeper-ice">守岸人</p>
            <p className="text-[10px] text-keeper-ice/45">设置中心</p>
          </div>
        </div>
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto px-2 py-3">
        {NAV_GROUPS.map((group) => (
          <div key={group.label} className="mb-3 last:mb-0">
            <p className="mb-1.5 hidden px-2 text-[10px] font-medium uppercase tracking-wider text-keeper-ice/30 sm:block">
              {group.label}
            </p>
            <ul className="space-y-0.5">
              {group.items.map((item) => {
                const active = tab === item.id;
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      disabled={item.disabled}
                      onClick={() => onTabChange(item.id)}
                      title={item.label}
                      aria-label={item.label}
                      className={`flex w-full items-center justify-center gap-2.5 rounded-xl px-2 py-2 text-left text-xs transition sm:justify-start sm:px-2.5 ${
                        active
                          ? 'bg-gradient-to-r from-keeper-cyan/20 to-keeper-cyan/5 font-medium text-keeper-cyan shadow-inset-accent'
                          : 'text-keeper-ice/60 hover:bg-white/5 hover:text-keeper-ice'
                      } ${item.disabled ? 'cursor-not-allowed opacity-40' : ''}`}
                    >
                      <span
                        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-sm ${
                          active ? 'bg-keeper-cyan/20' : 'bg-keeper-silver/10'
                        }`}
                      >
                        {item.icon}
                      </span>
                      <span className="hidden sm:inline">{item.label}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="hidden shrink-0 border-t border-keeper-cyan/10 px-4 py-3 sm:block">
        <p className="text-[10px] text-keeper-ice/30">The Shorekeeper</p>
        <p className="text-[10px] text-keeper-ice/20">{version ? `v${version}` : 'v…'}</p>
      </div>
    </aside>
  );
}

export const SETTINGS_TAB_TITLES: Record<SettingsTab, { title: string; subtitle: string; icon: string }> = {
  plugins: { title: '插件', subtitle: '扩展功能与第三方集成', icon: '🧩' },
  persona: { title: '人设', subtitle: '核心 System Prompt，每轮对话注入', icon: '🎭' },
  profile: { title: '用户信息', subtitle: '长期画像与偏好字段', icon: '👤' },
  memory: { title: '记忆', subtitle: '长期记忆、自动提取与 RAG', icon: '🧠' },
  worldbook: { title: 'Worldbook', subtitle: '触发词与背景设定', icon: '📖' },
  appearance: { title: '外观', subtitle: '主题预设与背景、头像', icon: '🎨' },
  voice: { title: '语音', subtitle: 'CosyVoice 朗读与复刻音色', icon: '🔊' },
  tasks: { title: '定时任务', subtitle: '提醒与静默 Agent 任务', icon: '⏰' },
  runs: { title: '运行记录', subtitle: '步骤、审批、产物与中断恢复', icon: '📋' },
  userTodos: { title: '用户待办', subtitle: '进度跟踪与 Excel 同步', icon: '✅' },
  documents: { title: '泰提斯终端', subtitle: '知识库导入与管理', icon: '🛰' },
  datasources: { title: '数据源', subtitle: '只读连接业务数据库、数据字典与指标', icon: '🗄' },
  skills: { title: '技能', subtitle: 'Agent Skills 包', icon: '✨' },
  mcp: { title: 'MCP', subtitle: 'Model Context Protocol 服务器', icon: '🔌' },
  model: { title: 'API 设置', subtitle: '模型协议与接入配置', icon: '🔑' },
  about: { title: '关于与更新', subtitle: '版本信息与联网更新', icon: 'ℹ️' },
  disclaimer: { title: '免责声明', subtitle: '使用须知', icon: '⚠️' },
};
