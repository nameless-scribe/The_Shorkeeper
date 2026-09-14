import { useCallback, useEffect, useRef, useState } from 'react';
import type { AsrSettingsInfo, AsrSettingsPatch } from '@/shared/types';
import { SettingsField } from './components/settings-ui';
import { SettingsSegmented } from './components/SettingsSegmented';
import { SettingsToggle } from './components/SettingsToggle';

const INPUT_CLASS =
  'w-full rounded-xl border border-keeper-silver/15 bg-keeper-navyDeep/60 px-3 py-2 text-sm text-keeper-ice outline-none focus:border-keeper-cyan/40';

const ENGINE_OPTIONS = [
  { value: '16k_zh', label: '中文' },
  { value: '16k_zh_en', label: '中英混说' },
  { value: '8k_zh', label: '电话录音' },
] as const;

/**
 * 录音转写（腾讯云）凭证段落。与百炼语音 Key 完全分离：两套凭证、两种鉴权。
 * 密钥输入框永远不回填明文，留空即"不修改"。
 */
export function AsrCredentialsSection() {
  const [info, setInfo] = useState<AsrSettingsInfo | null>(null);
  const [secretIdDraft, setSecretIdDraft] = useState('');
  const [secretKeyDraft, setSecretKeyDraft] = useState('');
  const [appIdDraft, setAppIdDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const messageTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const apply = useCallback((value: AsrSettingsInfo) => {
    setInfo(value);
    setAppIdDraft(value.appId);
    setSecretIdDraft('');
    setSecretKeyDraft('');
  }, []);

  useEffect(() => {
    window.shorekeeper.asr
      .getSettings()
      .then(apply)
      .catch((err) => setError(err instanceof Error ? err.message : '读取转写设置失败'));
    return () => {
      if (messageTimerRef.current) clearTimeout(messageTimerRef.current);
    };
  }, [apply]);

  const save = async (patch: AsrSettingsPatch) => {
    setSaving(true);
    setError(null);
    try {
      apply(await window.shorekeeper.asr.saveSettings(patch));
      setMessage('已保存');
      if (messageTimerRef.current) clearTimeout(messageTimerRef.current);
      messageTimerRef.current = setTimeout(() => {
        messageTimerRef.current = null;
        setMessage(null);
      }, 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  if (!info) return null;

  const sourceLabel =
    info.credentialsSource === 'settings'
      ? '来自应用内设置'
      : info.credentialsSource === 'env'
        ? '来自环境变量（.env）'
        : '尚未配置';

  return (
    <section className="rounded-2xl border border-keeper-cyan/15 bg-keeper-navy/30 p-4 space-y-3">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-keeper-ice">录音转写（腾讯云）</p>
          <p className="mt-1 text-xs text-keeper-ice/45">
            把工作区里的会议录音转成带说话人的逐字稿。与上面的百炼 Key 无关，需要单独开通「录音文件识别极速版」。
          </p>
        </div>
        <span
          className={`shrink-0 rounded-lg border px-2 py-0.5 text-[10px] ${
            info.configured
              ? 'border-emerald-400/30 bg-emerald-950/30 text-emerald-200'
              : 'border-amber-400/30 bg-amber-950/30 text-amber-100'
          }`}
        >
          {info.configured ? '已配置' : '未配置'} · {sourceLabel}
        </span>
      </div>

      {!info.configured && info.reason && (
        <p className="text-xs text-amber-100/80">{info.reason}</p>
      )}

      <SettingsField
        label="SecretId"
        hint={info.secretIdMasked ? `当前 ${info.secretIdMasked}` : '腾讯云控制台 → 访问管理 → API 密钥'}
      >
        <input
          type="password"
          value={secretIdDraft}
          onChange={(e) => setSecretIdDraft(e.target.value)}
          placeholder={info.secretIdMasked ? '留空则不修改' : 'AKID…'}
          className={INPUT_CLASS}
          autoComplete="off"
        />
      </SettingsField>
      <SettingsField
        label="SecretKey"
        hint={info.secretKeyMasked ? `当前 ${info.secretKeyMasked}` : '与 SecretId 成对'}
      >
        <input
          type="password"
          value={secretKeyDraft}
          onChange={(e) => setSecretKeyDraft(e.target.value)}
          placeholder={info.secretKeyMasked ? '留空则不修改' : ''}
          className={INPUT_CLASS}
          autoComplete="off"
        />
      </SettingsField>
      <SettingsField
        label="AppID"
        hint="控制台「账号信息」页标为 APPID 的纯数字；不是账号ID，也不是 SecretId"
      >
        <input
          type="text"
          inputMode="numeric"
          value={appIdDraft}
          onChange={(e) => setAppIdDraft(e.target.value)}
          placeholder="1250000000"
          className={INPUT_CLASS}
          autoComplete="off"
        />
      </SettingsField>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={saving}
          onClick={() =>
            void save({
              secretId: secretIdDraft.trim() || undefined,
              secretKey: secretKeyDraft.trim() || undefined,
              appId: appIdDraft.trim() || undefined,
            })
          }
          className="rounded-xl border border-keeper-cyan/30 bg-keeper-cyan/15 px-4 py-2 text-xs text-keeper-cyan transition hover:bg-keeper-cyan/25 disabled:opacity-50"
        >
          保存转写凭证
        </button>
        {info.credentialsSource === 'settings' && (
          <button
            type="button"
            disabled={saving}
            onClick={() => void save({ clearCredentials: true })}
            className="rounded-xl border border-keeper-ice/15 px-3 py-2 text-xs text-keeper-ice/60 transition hover:border-red-400/40 hover:text-red-200 disabled:opacity-50"
          >
            清除应用内凭证
          </button>
        )}
        {message && <span className="text-xs text-emerald-200">{message}</span>}
        {error && <span className="text-xs text-red-300">{error}</span>}
      </div>

      <SettingsField label="识别引擎" hint="中文会议用「中文」；夹杂英文时选「中英混说」；电话线路录音选「电话录音」">
        <SettingsSegmented
          value={info.engineType}
          options={ENGINE_OPTIONS.map((option) => ({ value: option.value, label: option.label }))}
          onChange={(engineType) => void save({ engineType })}
        />
      </SettingsField>
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-keeper-ice">区分说话人</p>
          <p className="mt-1 text-xs text-keeper-ice/45">逐字稿按发言人分段，会议纪要需要它来归属待办</p>
        </div>
        <SettingsToggle checked={info.diarization} onChange={(diarization) => void save({ diarization })} />
      </div>
    </section>
  );
}
