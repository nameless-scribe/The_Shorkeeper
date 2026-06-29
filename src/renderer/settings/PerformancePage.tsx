import { useCallback, useEffect, useState } from 'react';
import type { PerformanceSettingsInfo } from '@/shared/types';

export function PerformancePage() {
  const [settings, setSettings] = useState<PerformanceSettingsInfo | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const value = await window.shorekeeper.performance.get();
    setSettings(value);
    setLoading(false);
  }, []);

  useEffect(() => {
    load().catch(console.error);
  }, [load]);

  const update = async (patch: Partial<PerformanceSettingsInfo>) => {
    const value = await window.shorekeeper.performance.set(patch);
    setSettings(value);
  };

  if (loading || !settings) {
    return <p className="text-sm text-keeper-ice/60">加载中…</p>;
  }

  return (
    <div className="space-y-5">
      <p className="text-xs leading-relaxed text-keeper-ice/65">
        控制 RAG 注入、记忆自动提取与送入模型的历史消息上限，降低 Token 消耗。
        也可在 <code className="text-keeper-cyan">.env</code> 设置默认值。
      </p>

      <label className="flex items-center gap-2 text-sm text-keeper-ice">
        <input
          type="checkbox"
          checked={settings.ragEnabled}
          onChange={(e) => void update({ ragEnabled: e.target.checked })}
        />
        启用 RAG 检索注入
      </label>

      <div className="space-y-2">
        <p className="text-xs text-keeper-ice/70">自动提取记忆</p>
        <select
          value={settings.memoryExtractMode}
          onChange={(e) =>
            void update({
              memoryExtractMode: e.target.value as PerformanceSettingsInfo['memoryExtractMode'],
            })
          }
          className="w-full rounded-lg border border-keeper-silver/20 bg-keeper-navy/50 px-3 py-2 text-sm text-keeper-ice"
        >
          <option value="always">每轮对话后</option>
          <option value="every_n">每 N 轮</option>
          <option value="manual">仅手动（save_memory 工具）</option>
        </select>
        {settings.memoryExtractMode === 'every_n' && (
          <label className="flex items-center gap-2 text-xs text-keeper-ice/70">
            间隔 N =
            <input
              type="number"
              min={2}
              max={20}
              value={settings.memoryExtractInterval}
              onChange={(e) =>
                void update({ memoryExtractInterval: Number(e.target.value) || 3 })
              }
              className="w-16 rounded border border-keeper-silver/20 bg-keeper-navy/50 px-2 py-1"
            />
          </label>
        )}
      </div>

      <label className="block space-y-1 text-sm text-keeper-ice">
        <span className="text-xs text-keeper-ice/70">送入模型的最近消息条数</span>
        <input
          type="number"
          min={6}
          max={60}
          value={settings.maxHistoryMessages}
          onChange={(e) =>
            void update({ maxHistoryMessages: Number(e.target.value) || 20 })
          }
          className="w-full rounded-lg border border-keeper-silver/20 bg-keeper-navy/50 px-3 py-2"
        />
      </label>

      <label className="block space-y-1 text-sm text-keeper-ice">
        <span className="text-xs text-keeper-ice/70">触发会话压缩的消息总数阈值</span>
        <input
          type="number"
          min={20}
          max={200}
          value={settings.compressThreshold}
          onChange={(e) =>
            void update({ compressThreshold: Number(e.target.value) || 30 })
          }
          className="w-full rounded-lg border border-keeper-silver/20 bg-keeper-navy/50 px-3 py-2"
        />
      </label>
    </div>
  );
}
