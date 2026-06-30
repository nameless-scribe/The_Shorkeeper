import { useCallback, useEffect, useState } from 'react';
import type { PerformanceSettingsInfo } from '@/shared/types';
import { SettingsToggle } from './components/SettingsToggle';
import { SettingsSegmented } from './components/SettingsSegmented';
import {
  SettingsField,
  SettingsIntro,
  SettingsLoading,
  SettingsPageShell,
  SettingsPanel,
  SettingsRow,
  SETTINGS_INPUT_CLASS,
} from './components/settings-ui';

const MEMORY_MODE_OPTIONS: {
  value: PerformanceSettingsInfo['memoryExtractMode'];
  label: string;
}[] = [
  { value: 'always', label: '每轮' },
  { value: 'every_n', label: '每 N 轮' },
  { value: 'manual', label: '手动' },
];

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

  if (loading || !settings) return <SettingsLoading />;

  return (
    <SettingsPageShell>
      <SettingsIntro>
        控制 RAG 注入、记忆自动提取与送入模型的历史消息上限，降低 Token 消耗。也可在{' '}
        <code className="rounded bg-keeper-navyDeep/60 px-1 py-0.5 text-keeper-cyan/90">.env</code>{' '}
        设置默认值。
      </SettingsIntro>

      <SettingsPanel title="检索与记忆" icon="🧠">
        <SettingsRow label="启用 RAG 检索注入">
          <SettingsToggle
            checked={settings.ragEnabled}
            onChange={(ragEnabled) => void update({ ragEnabled })}
          />
        </SettingsRow>

        <div className="space-y-2">
          <span className="text-xs font-medium text-keeper-ice/75">自动提取记忆</span>
          <SettingsSegmented
            value={settings.memoryExtractMode}
            options={MEMORY_MODE_OPTIONS}
            onChange={(memoryExtractMode) => void update({ memoryExtractMode })}
          />
          {settings.memoryExtractMode === 'every_n' && (
            <SettingsField label="间隔 N 轮">
              <input
                type="number"
                min={2}
                max={20}
                value={settings.memoryExtractInterval}
                onChange={(e) =>
                  void update({ memoryExtractInterval: Number(e.target.value) || 3 })
                }
                className={`${SETTINGS_INPUT_CLASS} max-w-[120px]`}
              />
            </SettingsField>
          )}
        </div>
      </SettingsPanel>

      <SettingsPanel title="上下文窗口" icon="📊">
        <SettingsField label="送入模型的最近消息条数" hint="默认 20，范围 6–60">
          <input
            type="number"
            min={6}
            max={60}
            value={settings.maxHistoryMessages}
            onChange={(e) =>
              void update({ maxHistoryMessages: Number(e.target.value) || 20 })
            }
            className={SETTINGS_INPUT_CLASS}
          />
        </SettingsField>

        <SettingsField label="触发会话压缩的消息总数阈值" hint="超过此数量时压缩旧消息摘要">
          <input
            type="number"
            min={20}
            max={200}
            value={settings.compressThreshold}
            onChange={(e) =>
              void update({ compressThreshold: Number(e.target.value) || 30 })
            }
            className={SETTINGS_INPUT_CLASS}
          />
        </SettingsField>
      </SettingsPanel>
    </SettingsPageShell>
  );
}
