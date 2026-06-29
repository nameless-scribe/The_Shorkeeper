export type SettingsTab =
  | 'plugins'
  | 'profile'
  | 'memory'
  | 'worldbook'
  | 'tasks'
  | 'documents'
  | 'skills'
  | 'mcp'
  | 'model'
  | 'disclaimer';

interface NavItem {
  id: SettingsTab;
  label: string;
  icon: string;
  disabled?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { id: 'plugins', label: '插件', icon: '🧩' },
  { id: 'profile', label: '用户信息', icon: '👤' },
  { id: 'memory', label: '记忆', icon: '🧠' },
  { id: 'worldbook', label: 'Worldbook', icon: '📖' },
  { id: 'tasks', label: '定时任务', icon: '⏰' },
  { id: 'documents', label: '文档', icon: '📄' },
  { id: 'skills', label: '技能', icon: '✨' },
  { id: 'mcp', label: 'MCP', icon: '🔌' },
  { id: 'model', label: 'API 设置', icon: '🔑' },
  { id: 'disclaimer', label: '免责声明', icon: '⚠️' },
];

interface SettingsSidebarProps {
  tab: SettingsTab;
  onTabChange: (tab: SettingsTab) => void;
}

export function SettingsSidebar({ tab, onTabChange }: SettingsSidebarProps) {
  return (
    <aside className="flex w-44 shrink-0 flex-col border-r border-keeper-cyan/10 bg-keeper-navyDeep/50">
      <div className="shrink-0 border-b border-keeper-cyan/10 px-4 py-4">
        <p className="text-sm font-semibold text-keeper-ice">守岸人</p>
        <p className="mt-0.5 text-[10px] text-keeper-ice/45">设置中心</p>
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        <ul className="space-y-0.5">
          {NAV_ITEMS.map((item) => {
            const active = tab === item.id;
            return (
              <li key={item.id}>
                <button
                  type="button"
                  disabled={item.disabled}
                  onClick={() => onTabChange(item.id)}
                  className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-xs transition ${
                    active
                      ? 'border-l-2 border-keeper-cyan bg-keeper-cyan/15 pl-[10px] font-medium text-keeper-cyan'
                      : 'text-keeper-ice/65 hover:bg-white/5 hover:text-keeper-ice'
                  } ${item.disabled ? 'cursor-not-allowed opacity-40' : ''}`}
                >
                  <span className="text-sm">{item.icon}</span>
                  {item.label}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="shrink-0 border-t border-keeper-cyan/10 px-4 py-3">
        <p className="text-[10px] text-keeper-ice/35">The Shorekeeper v0.1.0</p>
      </div>
    </aside>
  );
}

export const SETTINGS_TAB_TITLES: Record<SettingsTab, { title: string; subtitle: string }> = {
  plugins: { title: '插件', subtitle: '扩展功能与第三方集成' },
  profile: { title: '用户信息', subtitle: '长期画像与偏好字段' },
  memory: { title: '记忆', subtitle: 'RAG 注入、自动提取与上下文压缩' },
  worldbook: { title: 'Worldbook', subtitle: '触发词与背景设定' },
  tasks: { title: '定时任务', subtitle: '提醒与静默 Agent 任务' },
  documents: { title: '文档', subtitle: '知识库导入与管理' },
  skills: { title: '技能', subtitle: 'Agent Skills 包' },
  mcp: { title: 'MCP', subtitle: 'Model Context Protocol 服务器' },
  model: { title: 'API 设置', subtitle: '模型协议与接入配置' },
  disclaimer: { title: '免责声明', subtitle: '使用须知' },
};
