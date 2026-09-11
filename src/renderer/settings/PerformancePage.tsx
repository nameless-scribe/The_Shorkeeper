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

const RAG_INJECT_OPTIONS: {
  value: PerformanceSettingsInfo['ragInjectMode'];
  label: string;
  hint: string;
}[] = [
  { value: 'catalog', label: '目录', hint: '仅注入文件名列表（默认，省 Token）' },
  { value: 'auto', label: '自动', hint: '知识问句时自动检索并注入片段' },
  { value: 'tool', label: '工具', hint: '不自动检索，靠 search_knowledge' },
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

        {settings.ragEnabled && (
          <div className="space-y-2">
            <span className="text-xs font-medium text-keeper-ice/75">RAG 注入模式</span>
            <SettingsSegmented
              value={settings.ragInjectMode}
              options={RAG_INJECT_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
              onChange={(ragInjectMode) => void update({ ragInjectMode })}
            />
            <p className="text-[11px] leading-relaxed text-keeper-ice/45">
              {RAG_INJECT_OPTIONS.find((o) => o.value === settings.ragInjectMode)?.hint}
            </p>
            <SettingsField label="RAG 最低相似度" hint="0.2–0.8，越高越严格">
              <input
                type="range"
                min={0.2}
                max={0.8}
                step={0.05}
                value={settings.ragMinScore}
                onChange={(e) =>
                  void update({ ragMinScore: Number.parseFloat(e.target.value) })
                }
                className="w-full accent-keeper-cyan"
              />
              <span className="text-[11px] text-keeper-ice/50">{settings.ragMinScore.toFixed(2)}</span>
            </SettingsField>
          </div>
        )}

        <SettingsRow label="Context 用语义记忆检索">
          <SettingsToggle
            checked={settings.memorySemanticInContext}
            onChange={(memorySemanticInContext) => void update({ memorySemanticInContext })}
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
        <SettingsField label="最大输入 Token 预算" hint="默认 24000；私人小模型可设为 8000–16000">
          <input
            type="number"
            min={8000}
            max={120000}
            step={1000}
            value={settings.contextMaxInputTokens}
            onChange={(e) =>
              void update({ contextMaxInputTokens: Number(e.target.value) || 24000 })
            }
            className={SETTINGS_INPUT_CLASS}
          />
        </SettingsField>

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
