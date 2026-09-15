import { useCallback, useEffect, useRef, useState } from 'react';
import type { VisionSettingsInfo, VisionSettingsPatch } from '@/shared/types';
import { SettingsBadge, SettingsErrorBanner, SettingsField, SettingsPanel, SettingsPrimaryButton, SettingsRow, SettingsSecondaryButton, SETTINGS_INPUT_CLASS } from './components/settings-ui';
import { SettingsToggle } from './components/SettingsToggle';

/**
 * 看图（视觉模型）设置（P8.2）。开关默认关：关着时图片不会发出。
 * 接入点与 Key 留空复用 API 设置里的百炼配置；Key 永不回填明文。
 */
export function VisionSettingsSection() {
  const [info, setInfo] = useState<VisionSettingsInfo | null>(null);
  const [model, setModel] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [maxPixels, setMaxPixels] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const apply = useCallback((value: VisionSettingsInfo) => {
    setInfo(value);
    setModel(value.model);
    setBaseUrl(value.baseUrl);
    setApiKey('');
    setMaxPixels(String(value.maxPixels));
  }, []);

  useEffect(() => {
    window.shorekeeper.vision
      .getSettings()
      .then(apply)
      .catch((err) => setError(err instanceof Error ? err.message : '读取看图设置失败'));
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [apply]);

  const save = async (patch: VisionSettingsPatch) => {
    setSaving(true);
    setError(null);
    try {
      apply(await window.shorekeeper.vision.saveSettings(patch));
      setMessage('已保存');
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setMessage(null), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  if (!info) return null;

  return (
    <SettingsPanel
      title="看图（视觉模型）"
      subtitle="上传图片后就图片提问；只在你问的时候才把图片发给百炼的通义千问视觉模型"
      icon="👁"
      badge={info.configured ? <SettingsBadge tone="green">可用</SettingsBadge> : <SettingsBadge tone={info.enabled ? 'amber' : 'muted'}>{info.enabled ? '未配置' : '未开启'}</SettingsBadge>}
    >
      <SettingsRow label="允许把图片发送到视觉模型">
        <SettingsToggle checked={info.enabled} disabled={saving} onChange={(enabled) => void save({ enabled })} />
      </SettingsRow>
      {!info.enabled && <p className="text-[11px] text-keeper-ice/45">默认关闭。关闭时助理会告诉你"看图功能未开启"，图片不会发出。</p>}
      {info.reason && info.enabled && <SettingsErrorBanner message={info.reason} />}
      <SettingsField label="视觉模型 ID" hint="qwen3-vl-plus 识别更准；qwen3-vl-flash 便宜约 7 倍，两者接口一致">
        <input value={model} onChange={(e) => setModel(e.target.value)} className={SETTINGS_INPUT_CLASS} placeholder="qwen3-vl-plus" />
      </SettingsField>
      <SettingsField label="接入点（可选）" hint={info.credentialsSource === 'shared' ? '当前复用 API 设置里的百炼接入点与 Key' : '留空则复用 API 设置里的百炼配置；对话模型用了别家接口时才需要单独填'}>
        <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} className={SETTINGS_INPUT_CLASS} placeholder="https://dashscope.aliyuncs.com/compatible-mode/v1" />
      </SettingsField>
      <SettingsField label="API Key（可选）" hint={info.apiKeyMasked ? `已保存：${info.apiKeyMasked}，留空表示不修改` : '与接入点一起填；保存后加密存储'}>
        <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} className={SETTINGS_INPUT_CLASS} autoComplete="new-password" />
      </SettingsField>
      <SettingsField label="单张最大像素" hint="超过就等比缩到最长边 3600；不要为省钱调太低，图纸的尺寸标注会看不清">
        <input value={maxPixels} onChange={(e) => setMaxPixels(e.target.value)} inputMode="numeric" className={SETTINGS_INPUT_CLASS} />
      </SettingsField>
      {error && <SettingsErrorBanner message={error} />}
      <div className="flex flex-wrap items-center gap-2">
        <SettingsPrimaryButton
          className="px-4"
          disabled={saving}
          onClick={() =>
            void save({
              model: model.trim() || 'qwen3-vl-plus',
              baseUrl: baseUrl.trim(),
              ...(apiKey ? { apiKey } : {}),
              ...(Number.isFinite(Number(maxPixels)) && maxPixels.trim() ? { maxPixels: Number(maxPixels) } : {}),
            })
          }
        >
          {saving ? '保存中…' : '保存'}
        </SettingsPrimaryButton>
        {(info.baseUrl || info.apiKeyMasked) && (
          <SettingsSecondaryButton onClick={() => void save({ clearCredentials: true })}>清除独立凭证，改回复用</SettingsSecondaryButton>
        )}
        {message && <span className="text-xs text-keeper-cyan">{message}</span>}
      </div>
    </SettingsPanel>
  );
}
