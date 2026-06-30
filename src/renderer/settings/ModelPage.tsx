import { useCallback, useEffect, useState } from 'react';
import type { ModelProfileInfo, ModelProfilesInfo, ModelProtocol } from '@/shared/types';
import { SettingsSegmented } from './components/SettingsSegmented';
import {
  SettingsDangerButton,
  SettingsEmpty,
  SettingsErrorBanner,
  SettingsField,
  SettingsIntro,
  SettingsLoading,
  SettingsPageShell,
  SettingsPanel,
  SettingsPrimaryButton,
  SettingsSection,
  SETTINGS_INPUT_CLASS,
} from './components/settings-ui';

interface ModelPageProps {
  onConfigChange?: () => void;
}

const BAILIAN_URL_HINT =
  'https://llm-xxxx.cn-beijing.maas.aliyuncs.com/compatible-mode/v1';

const PROTOCOL_OPTIONS: { value: ModelProtocol; label: string }[] = [
  { value: 'openai', label: 'OpenAI' },
  { value: 'anthropic', label: 'Anthropic' },
];

function profileIcon(profile: Pick<ModelProfileInfo, 'name' | 'baseUrl' | 'model' | 'protocol'>): string {
  const hay = `${profile.name} ${profile.baseUrl} ${profile.model}`.toLowerCase();
  if (hay.includes('deepseek')) return '🌊';
  if (profile.protocol === 'anthropic' || hay.includes('claude') || hay.includes('anthropic')) return '🟣';
  if (hay.includes('qwen') || hay.includes('aliyun') || hay.includes('dashscope') || hay.includes('bailian')) {
    return '✦';
  }
  if (hay.includes('openai') || hay.includes('gpt')) return '◉';
  return '◇';
}

function shortHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url.slice(0, 28) || '—';
  }
}

function ProfileCard({
  profile,
  selected,
  active,
  onSelect,
}: {
  profile: ModelProfileInfo;
  selected: boolean;
  active: boolean;
  onSelect: () => void;
}) {
  const icon = profileIcon(profile);

  return (
    <button
      type="button"
      onClick={onSelect}
      className={`group relative w-full overflow-hidden rounded-2xl border p-3 text-left transition-all duration-200 ${
        selected
          ? 'border-keeper-cyan/50 bg-gradient-to-br from-keeper-cyan/15 via-keeper-navyDeep/60 to-keeper-navyDeep/40 shadow-[0_0_24px_rgba(0,212,255,0.08)]'
          : 'border-keeper-silver/12 bg-keeper-navyDeep/35 hover:border-keeper-silver/25 hover:bg-keeper-navyDeep/50'
      }`}
    >
      {active && (
        <span className="absolute right-2.5 top-2.5 flex items-center gap-1 rounded-full bg-keeper-cyan/20 px-2 py-0.5 text-[10px] font-medium text-keeper-cyan">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-keeper-cyan shadow-[0_0_6px_rgba(0,212,255,0.9)]" />
          使用中
        </span>
      )}

      <div className="flex items-start gap-3 pr-16">
        <span
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-lg transition ${
            selected
              ? 'bg-keeper-cyan/20 shadow-[inset_0_0_12px_rgba(0,212,255,0.15)]'
              : 'bg-keeper-silver/10 group-hover:bg-keeper-silver/15'
          }`}
        >
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-keeper-ice">{profile.name}</p>
          <p className="mt-0.5 truncate font-mono text-[11px] text-keeper-cyan/75">{profile.model}</p>
          <p className="mt-1 truncate text-[10px] text-keeper-ice/40">
            {shortHost(profile.baseUrl)} · {profile.protocol === 'anthropic' ? 'Anthropic' : 'OpenAI'}
          </p>
        </div>
      </div>
    </button>
  );
}

export function ModelPage({ onConfigChange }: ModelPageProps) {
  const [profilesInfo, setProfilesInfo] = useState<ModelProfilesInfo | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: '',
    baseUrl: '',
    model: '',
    apiKey: '',
    protocol: 'openai' as ModelProtocol,
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const patchForm = (patch: Partial<typeof form>) => {
    setForm((f) => ({ ...f, ...patch }));
    setSaved(false);
  };

  const loadFormFromProfile = useCallback((profile: ModelProfileInfo) => {
    setForm({
      name: profile.name,
      baseUrl: profile.baseUrl,
      model: profile.model,
      apiKey: '',
      protocol: profile.protocol,
    });
    setSelectedId(profile.id);
    setSaved(false);
    setError('');
  }, []);

  const load = useCallback(async () => {
    const info = await window.shorekeeper.model.getProfiles();
    setProfilesInfo(info);
    const active =
      info.profiles.find((p) => p.id === info.activeId) ?? info.profiles[0] ?? null;
    if (active) {
      loadFormFromProfile(active);
    } else {
      const settings = await window.shorekeeper.model.getSettings();
      setSelectedId(null);
      setForm({
        name: settings.name || settings.model,
        baseUrl: settings.baseUrl,
        model: settings.model,
        apiKey: '',
        protocol: settings.protocol,
      });
    }
    setLoading(false);
  }, [loadFormFromProfile]);

  useEffect(() => {
    load().catch(console.error);
  }, [load]);

  const selectedProfile =
    profilesInfo?.profiles.find((p) => p.id === selectedId) ?? null;
  const isActive = selectedId != null && selectedId === profilesInfo?.activeId;

  const handleSelect = async (profile: ModelProfileInfo) => {
    loadFormFromProfile(profile);
    if (profile.id !== profilesInfo?.activeId) {
      const next = await window.shorekeeper.model.setActiveProfile(profile.id);
      setProfilesInfo(next);
      onConfigChange?.();
    }
  };

  const handleCreate = async () => {
    setError('');
    const next = await window.shorekeeper.model.createProfile({
      name: '新配置',
      baseUrl: '',
      model: 'qwen3.6-plus',
      protocol: 'openai',
    });
    setProfilesInfo(next);
    const created = next.profiles[next.profiles.length - 1];
    if (created) loadFormFromProfile(created);
  };

  const handleDelete = async () => {
    if (!selectedId || !profilesInfo || profilesInfo.profiles.length <= 1) return;
    if (!window.confirm(`确定删除配置「${selectedProfile?.name ?? ''}」？`)) return;
    setError('');
    try {
      const next = await window.shorekeeper.model.deleteProfile(selectedId);
      setProfilesInfo(next);
      onConfigChange?.();
      const active =
        next.profiles.find((p) => p.id === next.activeId) ?? next.profiles[0] ?? null;
      if (active) loadFormFromProfile(active);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    setError('');
    try {
      const input = {
        name: form.name.trim() || form.model.trim() || '未命名配置',
        baseUrl: form.baseUrl.trim(),
        model: form.model.trim(),
        protocol: form.protocol,
        apiKey: form.apiKey.trim() || undefined,
      };

      let next: ModelProfilesInfo;
      if (!selectedId) {
        next = await window.shorekeeper.model.createProfile(input);
        const created = next.profiles.find((p) => p.id === next.activeId) ?? next.profiles.at(-1);
        if (created) loadFormFromProfile(created);
      } else {
        next = await window.shorekeeper.model.updateProfile(selectedId, input);
        const updated = next.profiles.find((p) => p.id === selectedId);
        if (updated) loadFormFromProfile(updated);
      }
      setProfilesInfo(next);
      setSaved(true);
      onConfigChange?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  if (loading || !profilesInfo) return <SettingsLoading />;

  return (
    <SettingsPageShell>
      <SettingsIntro>
        保存多套模型接入，点击卡片即可切换。当前配置用于所有新对话；未配置时回退到{' '}
        <code className="rounded bg-keeper-navyDeep/60 px-1 py-0.5 text-keeper-cyan/90">.env</code>。
      </SettingsIntro>

      <SettingsSection
        title="我的接入"
        hint={`${profilesInfo.profiles.length} 套配置`}
        action={
          <button
            type="button"
            onClick={() => void handleCreate()}
            className="flex items-center gap-1 rounded-xl border border-keeper-cyan/30 bg-keeper-cyan/10 px-3 py-1.5 text-xs font-medium text-keeper-cyan transition hover:bg-keeper-cyan/20"
          >
            <span className="text-sm leading-none">+</span>
            新增
          </button>
        }
      >
        {profilesInfo.profiles.length === 0 ? (
          <SettingsEmpty title="还没有保存的配置" hint="点击下方表单填写并保存，或点「新增」" />
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {profilesInfo.profiles.map((profile) => (
              <ProfileCard
                key={profile.id}
                profile={profile}
                selected={profile.id === selectedId}
                active={profile.id === profilesInfo.activeId}
                onSelect={() => void handleSelect(profile)}
              />
            ))}
          </div>
        )}
      </SettingsSection>

      <SettingsPanel
        title={selectedProfile ? selectedProfile.name : '新建配置'}
        subtitle={isActive ? '当前对话使用此接入' : '编辑后保存；切换卡片可启用'}
        icon={profileIcon({
          name: form.name,
          baseUrl: form.baseUrl,
          model: form.model,
          protocol: form.protocol,
        })}
        badge={
          saved ? (
            <span className="shrink-0 rounded-full bg-emerald-500/15 px-2.5 py-1 text-[10px] text-emerald-300">
              ✓ 已保存
            </span>
          ) : undefined
        }
      >
        <SettingsField label="配置名称" hint="便于区分，如「百炼 Qwen」「DeepSeek」">
          <input
            value={form.name}
            onChange={(e) => patchForm({ name: e.target.value })}
            placeholder="给这套接入起个名字"
            className={SETTINGS_INPUT_CLASS}
          />
        </SettingsField>

        <SettingsField label="Base URL" hint="OpenAI 兼容接入点，百炼通常以 /compatible-mode/v1 结尾">
          <input
            value={form.baseUrl}
            onChange={(e) => patchForm({ baseUrl: e.target.value })}
            placeholder={BAILIAN_URL_HINT}
            className={`${SETTINGS_INPUT_CLASS} font-mono text-[13px]`}
          />
        </SettingsField>

        <div className="grid gap-4 sm:grid-cols-2">
          <SettingsField label="模型 ID" hint="API 模型名，小写">
            <input
              value={form.model}
              onChange={(e) => patchForm({ model: e.target.value })}
              placeholder="qwen3.6-plus"
              className={`${SETTINGS_INPUT_CLASS} font-mono text-[13px]`}
            />
          </SettingsField>

          <SettingsField label="API Key">
            <input
              type="password"
              value={form.apiKey}
              onChange={(e) => patchForm({ apiKey: e.target.value })}
              placeholder={
                selectedProfile?.apiKeyConfigured
                  ? `已配置 ${selectedProfile.apiKeyMasked}`
                  : 'sk- 开头'
              }
              autoComplete="off"
              className={SETTINGS_INPUT_CLASS}
            />
          </SettingsField>
        </div>

        <div className="space-y-2">
          <span className="text-xs font-medium text-keeper-ice/75">请求协议</span>
          <SettingsSegmented
            value={form.protocol}
            options={PROTOCOL_OPTIONS}
            onChange={(protocol) => patchForm({ protocol })}
          />
          <p className="text-[11px] text-keeper-ice/40">
            OpenAI 兼容适用于百炼 / DeepSeek 等；Anthropic 兼容适用于 Claude 风格 API
          </p>
        </div>

        {error && <SettingsErrorBanner message={error} />}

        <div className="flex gap-2 pt-1">
          <SettingsPrimaryButton
            className="flex-1"
            disabled={saving || !form.baseUrl.trim() || !form.model.trim()}
            onClick={() => void handleSave()}
          >
            {saving ? '保存中…' : '保存配置'}
          </SettingsPrimaryButton>
          {profilesInfo.profiles.length > 1 && selectedId && (
            <SettingsDangerButton onClick={() => void handleDelete()}>删除</SettingsDangerButton>
          )}
        </div>
      </SettingsPanel>
    </SettingsPageShell>
  );
}
