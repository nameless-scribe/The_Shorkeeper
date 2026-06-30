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
      { id: 'profile', label: '用户信息', icon: '👤' },
      { id: 'memory', label: '记忆', icon: '🧠' },
      { id: 'worldbook', label: 'Worldbook', icon: '📖' },
    ],
  },
  {
    label: '数据与任务',
    items: [
      { id: 'documents', label: '文档', icon: '📄' },
      { id: 'tasks', label: '定时任务', icon: '⏰' },
    ],
  },
  {
    label: '系统',
    items: [
      { id: 'model', label: 'API 设置', icon: '🔑' },
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
  return (
    <aside className="flex w-48 shrink-0 flex-col border-r border-keeper-cyan/10 bg-gradient-to-b from-keeper-navyDeep/80 to-keeper-navyDeep/95">
      <div className="shrink-0 border-b border-keeper-cyan/10 px-4 py-4">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-keeper-cyan/15 text-sm">
            ⚓
          </span>
          <div>
            <p className="text-sm font-semibold text-keeper-ice">守岸人</p>
            <p className="text-[10px] text-keeper-ice/45">设置中心</p>
          </div>
        </div>
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto px-2 py-3">
        {NAV_GROUPS.map((group) => (
          <div key={group.label} className="mb-3 last:mb-0">
            <p className="mb-1.5 px-2 text-[10px] font-medium uppercase tracking-wider text-keeper-ice/30">
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
                      className={`flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-xs transition ${
                        active
                          ? 'bg-gradient-to-r from-keeper-cyan/20 to-keeper-cyan/5 font-medium text-keeper-cyan shadow-[inset_0_0_0_1px_rgba(0,212,255,0.25)]'
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
                      {item.label}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="shrink-0 border-t border-keeper-cyan/10 px-4 py-3">
        <p className="text-[10px] text-keeper-ice/30">The Shorekeeper</p>
        <p className="text-[10px] text-keeper-ice/20">v0.1.0</p>
      </div>
    </aside>
  );
}

export const SETTINGS_TAB_TITLES: Record<SettingsTab, { title: string; subtitle: string; icon: string }> = {
  plugins: { title: '插件', subtitle: '扩展功能与第三方集成', icon: '🧩' },
  profile: { title: '用户信息', subtitle: '长期画像与偏好字段', icon: '👤' },
  memory: { title: '记忆', subtitle: 'RAG 注入、自动提取与上下文压缩', icon: '🧠' },
  worldbook: { title: 'Worldbook', subtitle: '触发词与背景设定', icon: '📖' },
  tasks: { title: '定时任务', subtitle: '提醒与静默 Agent 任务', icon: '⏰' },
  documents: { title: '文档', subtitle: '知识库导入与管理', icon: '📄' },
  skills: { title: '技能', subtitle: 'Agent Skills 包', icon: '✨' },
  mcp: { title: 'MCP', subtitle: 'Model Context Protocol 服务器', icon: '🔌' },
  model: { title: 'API 设置', subtitle: '模型协议与接入配置', icon: '🔑' },
  disclaimer: { title: '免责声明', subtitle: '使用须知', icon: '⚠️' },
};
