import { useCallback, useEffect, useState } from 'react';
import type { PersonaSettingsInfo } from '@/shared/types';
import { MAX_PERSONA_PROMPT_LENGTH } from '@/shared/persona';
import {
  SettingsBadge,
  SettingsField,
  SettingsInlineActions,
  SettingsIntro,
  SettingsLoading,
  SettingsPageShell,
  SettingsPanel,
  SettingsPrimaryButton,
  SettingsSecondaryButton,
  SETTINGS_INPUT_CLASS,
  SETTINGS_TEXTAREA_CLASS,
} from './components/settings-ui';

interface PersonaPageProps {
  onOpenWorldbook?: () => void;
}

export function PersonaPage({ onOpenWorldbook }: PersonaPageProps) {
  const [info, setInfo] = useState<PersonaSettingsInfo | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const data = await window.shorekeeper.persona.get();
    setInfo(data);
    setDisplayName(data.displayName);
    setSystemPrompt(data.systemPrompt);
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh().catch(console.error);
  }, [refresh]);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const updated = await window.shorekeeper.persona.set({ displayName, systemPrompt });
      setInfo(updated);
      setMessage('人设已更新，下一条消息起生效');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    if (
      !window.confirm(
        '将恢复为内置守岸人人设，当前自定义内容会被覆盖。Worldbook 与用户画像不受影响。确定继续？',
      )
    ) {
      return;
    }
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const updated = await window.shorekeeper.persona.reset();
      setInfo(updated);
      setDisplayName(updated.displayName);
      setSystemPrompt(updated.systemPrompt);
      setMessage('已恢复为内置人设');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <SettingsLoading />;

  const charCount = systemPrompt.length;
  const overLimit = charCount > MAX_PERSONA_PROMPT_LENGTH;

  return (
    <SettingsPageShell>
      <SettingsIntro>
        人设决定 Agent <strong className="text-keeper-ice/90">每一轮</strong>{' '}
        如何扮演与回应；Worldbook 在对话
        <strong className="text-keeper-ice/90"> 提到相关词</strong>{' '}
        时注入额外背景。两者可同时使用，但不可替代。
      </SettingsIntro>

      {message && (
        <p className="rounded-xl border border-keeper-cyan/25 bg-keeper-cyan/10 px-3 py-2 text-xs text-keeper-cyan">
          {message}
        </p>
      )}
      {error && (
        <p className="rounded-xl border border-red-400/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">
          {error}
        </p>
      )}

      <SettingsPanel
        title="核心人设"
        subtitle="System Prompt · 每轮对话注入"
        icon="🎭"
        badge={
          info?.isCustom ? (
            <SettingsBadge tone="cyan">自定义</SettingsBadge>
          ) : (
            <SettingsBadge tone="muted">内置 {info?.builtinVersion}</SettingsBadge>
          )
        }
      >
        <SettingsField label="角色名" hint="状态面板等处显示的名称">
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className={SETTINGS_INPUT_CLASS}
            placeholder="守岸人"
          />
        </SettingsField>

        <SettingsField
          label="System Prompt"
          hint={`${charCount} / ${MAX_PERSONA_PROMPT_LENGTH} 字${overLimit ? ' · 超出上限' : ''}`}
        >
          <textarea
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            rows={16}
            className={`${SETTINGS_TEXTAREA_CLASS} font-mono text-xs leading-relaxed`}
            spellCheck={false}
          />
        </SettingsField>

        <div className="flex flex-wrap gap-2">
          <SettingsPrimaryButton
            className="flex-1"
            disabled={saving || !systemPrompt.trim() || overLimit}
            onClick={() => void handleSave()}
          >
            {saving ? '保存中…' : '保存人设'}
          </SettingsPrimaryButton>
          <SettingsSecondaryButton onClick={() => void handleReset()}>
            恢复默认
          </SettingsSecondaryButton>
        </div>

        {onOpenWorldbook && (
          <SettingsInlineActions>
            <button
              type="button"
              className="text-xs text-keeper-cyan/80 underline-offset-2 hover:text-keeper-cyan hover:underline"
              onClick={onOpenWorldbook}
            >
              在 Worldbook 中管理触发背景 →
            </button>
          </SettingsInlineActions>
        )}
      </SettingsPanel>
    </SettingsPageShell>
  );
}
