import { useCallback, useEffect, useState } from 'react';
import type { FilesystemMode, PluginSettingsInfo } from '@/shared/types';
import { PluginCard, PluginStatusDot } from './components/PluginCard';
import { SettingsSegmented } from './components/SettingsSegmented';
import { SettingsToggle } from './components/SettingsToggle';

const FILESYSTEM_OPTIONS: { value: FilesystemMode; label: string }[] = [
  { value: 'readonly', label: '只读' },
  { value: 'confirm', label: '审批' },
  { value: 'full', label: '完全' },
];

const LIFE_TOOL_ITEMS = [
  { name: 'travel_plan', label: '旅行规划' },
  { name: 'get_weather', label: '天气查询' },
  { name: 'translate', label: '翻译' },
];

export function PluginsPage() {
  const [settings, setSettings] = useState<PluginSettingsInfo | null>(null);
  const [lifeExpanded, setLifeExpanded] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const value = await window.shorekeeper.plugins.get();
    setSettings(value);
    setLoading(false);
  }, []);

  useEffect(() => {
    load().catch(console.error);
  }, [load]);

  const patch = async (next: Partial<PluginSettingsInfo>) => {
    const value = await window.shorekeeper.plugins.set(next);
    setSettings(value);
  };

  const setFilesystemMode = async (mode: FilesystemMode) => {
    const value = await window.shorekeeper.plugins.setFilesystemMode(mode);
    setSettings(value);
  };

  if (loading || !settings) {
    return <p className="text-sm text-keeper-ice/60">加载中…</p>;
  }

  return (
    <div className="space-y-3">
      <PluginCard
        icon="🌐"
        title="联网搜索"
        description="允许 Agent 调用 web_search 实时检索网络信息"
        control={
          <SettingsToggle
            checked={settings.webSearch}
            onChange={(webSearch) => void patch({ webSearch })}
          />
        }
      />

      <PluginCard
        icon="📁"
        title="本地文件"
        description="工作区 read_file / list_dir / write_file；只读禁止写入，审批需确认，完全免确认"
        control={
          <SettingsSegmented
            value={settings.filesystemMode}
            options={FILESYSTEM_OPTIONS}
            onChange={(mode) => void setFilesystemMode(mode)}
          />
        }
      />

      <PluginCard
        icon="📝"
        title="多格式编写"
        description="导出 Excel / Word / PDF / Markdown 到工作区"
        control={
          <SettingsToggle
            checked={settings.docGen}
            onChange={(docGen) => void patch({ docGen })}
          />
        }
      />

      <PluginCard
        icon="🔗"
        title="网页抓取"
        description="fetch_url 将网页转为可读文本"
        control={
          <SettingsToggle
            checked={settings.fetchUrl}
            onChange={(fetchUrl) => void patch({ fetchUrl })}
          />
        }
      />

      <PluginCard
        icon="💰"
        title="收支记账"
        description="bookkeeping 记录与汇总个人收支"
        control={
          <SettingsToggle
            checked={settings.bookkeeping}
            onChange={(bookkeeping) => void patch({ bookkeeping })}
          />
        }
      />

      <PluginCard
        icon="🔌"
        title="MCP 工具"
        description="已注册的 MCP Server 工具，按需自动调用"
        control={<PluginStatusDot active={settings.mcpEnabledCount > 0} />}
        footer={
          <p className="text-[11px] text-keeper-ice/50">
            已启用 {settings.mcpEnabledCount} 个 MCP Server · 在左侧「MCP」页管理
          </p>
        }
      />

      <PluginCard
        icon="🏠"
        title="生活工具"
        description="旅行规划、天气、翻译等小工具集合"
        control={
          <div className="flex items-center gap-2">
            <SettingsToggle
              checked={settings.lifeTools}
              onChange={(lifeTools) => void patch({ lifeTools })}
            />
            <button
              type="button"
              onClick={() => setLifeExpanded((v) => !v)}
              className="rounded-lg border border-keeper-silver/20 px-2 py-1 text-[10px] text-keeper-ice/60 hover:text-keeper-cyan"
            >
              {lifeExpanded ? '收起' : '展开'}
            </button>
          </div>
        }
        footer={
          lifeExpanded ? (
            <ul className="space-y-1.5">
              {LIFE_TOOL_ITEMS.map((item) => (
                <li
                  key={item.name}
                  className="flex items-center justify-between text-[11px] text-keeper-ice/65"
                >
                  <span>{item.label}</span>
                  <PluginStatusDot active={settings.lifeTools} />
                </li>
              ))}
            </ul>
          ) : undefined
        }
      />
    </div>
  );
}
