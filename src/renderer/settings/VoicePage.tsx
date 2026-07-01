import { useCallback, useEffect, useState } from 'react';
import type { CosyVoiceModel, VoiceSettingsInfo } from '@/shared/types';
import { COSYVOICE_MODELS } from '@/voice/types';
import { SettingsIntro, SettingsLoading, SettingsPageShell, SettingsField } from './components/settings-ui';
import { SettingsToggle } from './components/SettingsToggle';
import { SettingsSegmented } from './components/SettingsSegmented';

const PREVIEW_TEXT = '调律者，我在这里。';

const DEFAULT_TTS_ENDPOINT_PLACEHOLDER =
  'https://llm-xxxx.cn-beijing.maas.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer';

export function VoicePage() {
  const [settings, setSettings] = useState<VoiceSettingsInfo | null>(null);
  const [voiceIdDraft, setVoiceIdDraft] = useState('');
  const [voiceApiKeyDraft, setVoiceApiKeyDraft] = useState('');
  const [voiceEndpointDraft, setVoiceEndpointDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [previewState, setPreviewState] = useState<'idle' | 'loading' | 'playing'>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const value = await window.shorekeeper.voice.getSettings();
    setSettings(value);
    setVoiceIdDraft(value.ttsVoiceId);
    setVoiceEndpointDraft(value.voiceTtsEndpoint);
    setVoiceApiKeyDraft('');
    setLoading(false);
  }, []);

  useEffect(() => {
    load().catch(console.error);
  }, [load]);

  const save = async (patch: Parameters<typeof window.shorekeeper.voice.saveSettings>[0]) => {
    setSaving(true);
    setError(null);
    try {
      const value = await window.shorekeeper.voice.saveSettings(patch);
      setSettings(value);
      setVoiceIdDraft(value.ttsVoiceId);
      setMessage('已保存');
      setTimeout(() => setMessage(null), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const saveVoiceId = async () => {
    const trimmed = voiceIdDraft.trim();
    await save({
      ttsVoiceId: trimmed,
      ttsVoiceSource: trimmed ? 'cloned' : 'preset',
    });
  };

  const preview = async () => {
    if (!settings) return;
    setPreviewState('loading');
    setError(null);
    try {
      const result = await window.shorekeeper.voice.synthesize({ text: PREVIEW_TEXT });
      if (!result.ok) {
        setError(result.error);
        setPreviewState('idle');
        return;
      }
      const blob = new Blob([result.audio], { type: result.mime || 'audio/mpeg' });
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.onended = () => {
        URL.revokeObjectURL(url);
        setPreviewState('idle');
      };
      audio.onerror = () => {
        URL.revokeObjectURL(url);
        setError('试听播放失败');
        setPreviewState('idle');
      };
      setPreviewState('playing');
      await audio.play();
    } catch (err) {
      setError(err instanceof Error ? err.message : '试听失败');
      setPreviewState('idle');
    }
  };

  if (loading || !settings) return <SettingsLoading />;

  return (
    <SettingsPageShell>
      <SettingsIntro>
        对话模型与语音合成相互独立：可在 API 设置使用 Claude 等模型聊天，此处单独配置百炼 CosyVoice
        朗读与复刻音色。
      </SettingsIntro>

      <section className="rounded-2xl border border-keeper-cyan/15 bg-keeper-navy/30 p-4 space-y-3">
        <p className="text-sm font-medium text-keeper-ice">语音 API</p>
        <SettingsSegmented
          value={settings.useChatApi ? 'chat' : 'dedicated'}
          options={[
            { value: 'dedicated', label: '独立百炼（推荐）' },
            { value: 'chat', label: '复用对话 API' },
          ]}
          onChange={(value) => void save({ useChatApi: value === 'chat' })}
        />
        {!settings.useChatApi && (
          <>
            <SettingsField
              label="百炼 API Key"
              hint={
                settings.apiKeyConfigured
                  ? `已配置 ${settings.voiceApiKeyMasked || '（来自环境变量）'}`
                  : '与对话 Key 可不同；北京地域 sk- 开头'
              }
            >
              <input
                type="password"
                value={voiceApiKeyDraft}
                onChange={(e) => setVoiceApiKeyDraft(e.target.value)}
                placeholder={settings.voiceApiKeyMasked ? '留空则不修改' : 'sk-…'}
                className="w-full rounded-xl border border-keeper-silver/15 bg-keeper-navyDeep/60 px-3 py-2 text-sm text-keeper-ice outline-none focus:border-keeper-cyan/40"
              />
            </SettingsField>
            <SettingsField
              label="CosyVoice 合成接入点"
              hint="可粘贴对话 Base URL（/compatible-mode/v1），保存时会自动转为 CosyVoice 地址"
            >
              <input
                type="text"
                value={voiceEndpointDraft}
                onChange={(e) => setVoiceEndpointDraft(e.target.value)}
                placeholder={DEFAULT_TTS_ENDPOINT_PLACEHOLDER}
                className="w-full rounded-xl border border-keeper-silver/15 bg-keeper-navyDeep/60 px-3 py-2 text-xs text-keeper-ice outline-none focus:border-keeper-cyan/40"
              />
            </SettingsField>
            <button
              type="button"
              disabled={saving}
              onClick={() =>
                void save({
                  voiceApiKey: voiceApiKeyDraft.trim() || undefined,
                  voiceTtsEndpoint: voiceEndpointDraft.trim(),
                })
              }
              className="rounded-xl border border-keeper-cyan/30 bg-keeper-cyan/15 px-4 py-2 text-xs text-keeper-cyan transition hover:bg-keeper-cyan/25 disabled:opacity-50"
            >
              保存语音 API
            </button>
          </>
        )}
        {settings.useChatApi && (
          <p className="text-xs text-keeper-ice/45">
            将使用 设置 → API 设置 中当前模型的 Key；若对话为 Claude 等非百炼模型，请改选「独立百炼」。
          </p>
        )}
        {settings.ttsEndpoint && (
          <p className="text-[11px] text-keeper-ice/40 break-all">
            当前合成接入点：{settings.ttsEndpoint}
          </p>
        )}
      </section>

      {!settings.apiKeyConfigured && (
        <p className="rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-100/90">
          未检测到 API Key。请先在 设置 → API 设置 填写百炼 Key。
        </p>
      )}

      {error && (
        <p className="rounded-xl border border-red-400/30 bg-red-400/10 px-4 py-3 text-sm text-red-100/90">
          {error}
        </p>
      )}

      {message && (
        <p className="text-sm text-keeper-cyan/80">{message}</p>
      )}

      <div className="space-y-4">
        <section className="rounded-2xl border border-keeper-cyan/15 bg-keeper-navy/30 p-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-keeper-ice">启用语音朗读</p>
              <p className="mt-1 text-xs text-keeper-ice/45">关闭后消息 🔊 按钮不可用</p>
            </div>
            <SettingsToggle
              checked={settings.ttsEnabled}
              onChange={(ttsEnabled) => void save({ ttsEnabled })}
            />
          </div>
        </section>

        <section className="rounded-2xl border border-keeper-cyan/15 bg-keeper-navy/30 p-4 space-y-3">
          <p className="text-sm font-medium text-keeper-ice">复刻音色 ID</p>
          <p className="text-xs text-keeper-ice/45">
            在百炼 → 语音合成 → 声音复刻，点击「守岸人」旁的复制按钮，粘贴完整 voice_id（形如
            cosyvoice-v3.5-plus-bailian-…）。
          </p>
          <textarea
            value={voiceIdDraft}
            onChange={(e) => setVoiceIdDraft(e.target.value)}
            rows={2}
            placeholder="cosyvoice-v3.5-plus-bailian-xxxxxxxx"
            className="w-full resize-none rounded-xl border border-keeper-silver/15 bg-keeper-navyDeep/60 px-3 py-2 text-xs text-keeper-ice outline-none focus:border-keeper-cyan/40"
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={saving}
              onClick={() => void saveVoiceId()}
              className="rounded-xl border border-keeper-cyan/30 bg-keeper-cyan/15 px-4 py-2 text-xs text-keeper-cyan transition hover:bg-keeper-cyan/25 disabled:opacity-50"
            >
              保存音色 ID
            </button>
            <button
              type="button"
              disabled={!settings.ttsEnabled || previewState === 'loading'}
              onClick={() => void preview()}
              className="rounded-xl border border-keeper-silver/15 px-4 py-2 text-xs text-keeper-ice/70 transition hover:border-keeper-cyan/30 hover:text-keeper-cyan disabled:opacity-50"
            >
              {previewState === 'loading' ? '合成中…' : previewState === 'playing' ? '播放中…' : '试听示例句'}
            </button>
          </div>
        </section>

        <section className="rounded-2xl border border-keeper-cyan/15 bg-keeper-navy/30 p-4 space-y-3">
          <p className="text-sm font-medium text-keeper-ice">合成模型</p>
          <select
            value={settings.ttsModel}
            onChange={(e) => void save({ ttsModel: e.target.value as CosyVoiceModel })}
            className="w-full rounded-xl border border-keeper-silver/15 bg-keeper-navyDeep/60 px-3 py-2 text-sm text-keeper-ice outline-none focus:border-keeper-cyan/40"
          >
            {COSYVOICE_MODELS.map((model) => (
              <option key={model} value={model}>
                {model}
              </option>
            ))}
          </select>
          <p className="text-xs text-keeper-ice/45">须与百炼复刻时的 target_model 一致（默认 v3.5-plus）</p>
        </section>

        <section className="rounded-2xl border border-keeper-cyan/15 bg-keeper-navy/30 p-4 space-y-3">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-keeper-ice">自动朗读</p>
              <p className="mt-1 text-xs text-keeper-ice/45">每轮 Agent 回复结束后自动播放（V2 启用）</p>
            </div>
            <SettingsToggle
              checked={settings.ttsAutoPlay}
              onChange={(ttsAutoPlay) => void save({ ttsAutoPlay })}
            />
          </div>

          <div>
            <label className="text-xs text-keeper-ice/50">
              语速 {settings.ttsRate.toFixed(1)}×
            </label>
            <input
              type="range"
              min={0.5}
              max={2}
              step={0.1}
              value={settings.ttsRate}
              onChange={(e) => void save({ ttsRate: Number(e.target.value) })}
              className="mt-2 w-full accent-keeper-cyan"
            />
          </div>
        </section>
      </div>
    </SettingsPageShell>
  );
}
