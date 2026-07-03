import { useCallback, useEffect, useState } from 'react';
import type { AppearanceSettingsInfo } from '@/shared/types';
import { publicAssetUrl } from '../public-assets';
import { getResolvedKeeperAvatarSrc, getResolvedUserAvatarSrc } from '../theme/apply-theme';
import {
  SettingsField,
  SettingsIntro,
  SettingsLoading,
  SettingsPageShell,
  SettingsPanel,
  SettingsPrimaryButton,
  SettingsSecondaryButton,
} from './components/settings-ui';
import { SettingsThemeSelect } from './components/SettingsThemeSelect';

function resolvePreviewBackground(info: AppearanceSettingsInfo): string {
  if (info.assets.backgroundUrl) return info.assets.backgroundUrl;
  return publicAssetUrl(info.assets.builtinBackground);
}

export function AppearancePage() {
  const [info, setInfo] = useState<AppearanceSettingsInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const refresh = useCallback(async () => {
    const data = await window.shorekeeper.appearance.get();
    setInfo(data);
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh().catch(console.error);
    const off = window.shorekeeper.appearance.onChanged((data) => {
      setInfo(data);
    });
    return off;
  }, [refresh]);

  const runAction = async (action: () => Promise<AppearanceSettingsInfo | null>) => {
    setError(null);
    try {
      const result = await action();
      if (result) {
        setInfo(result);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (!file?.type.startsWith('image/')) {
      setError('请拖拽图片文件（png / jpg / webp）');
      return;
    }
    const filePath = window.shorekeeper.workspace.getPathForFile(file);
    await runAction(() => window.shorekeeper.appearance.importBackground(filePath));
  };

  if (loading || !info) return <SettingsLoading />;

  const bgPreview = resolvePreviewBackground(info);
  const veilPercent = Math.round(info.veilOpacity * 100);

  return (
    <SettingsPageShell>
      <SettingsIntro>
        主题预设会切换配色、气泡、遮罩与强调色。<strong>已上传的自定义壁纸会保留</strong>
        ；若需恢复内置立绘，请点「恢复预设背景」。
      </SettingsIntro>

      {error && (
        <p className="rounded-xl border border-red-400/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">
          {error}
        </p>
      )}

      <SettingsPanel title="主题预设" subtitle="下拉选择即时切换" icon="🎨">
        <SettingsThemeSelect
          presets={info.presets}
          value={info.presetId}
          onChange={(presetId) =>
            void runAction(() => window.shorekeeper.appearance.setPreset(presetId))
          }
        />
      </SettingsPanel>

      <SettingsPanel title="背景" subtitle="聊天窗与状态面板" icon="🖼️">
        <div
          className={`relative aspect-video overflow-hidden rounded-xl border bg-keeper-navyDeep/60 ${
            dragOver ? 'border-keeper-cyan/60' : 'border-keeper-silver/20'
          }`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => void handleDrop(e)}
        >
          <img
            src={bgPreview}
            alt=""
            className={`h-full w-full bg-keeper-navyDeep/80 ${
              info.backgroundFit === 'contain' ? 'object-contain' : 'object-cover'
            }`}
            draggable={false}
          />
          <div className="absolute inset-0 bg-gradient-to-r from-keeper-navyDeep/80 to-transparent" />
          {dragOver && (
            <div className="absolute inset-0 flex items-center justify-center bg-keeper-cyan/10 text-xs text-keeper-cyan">
              松开以上传背景
            </div>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <SettingsPrimaryButton
            className="flex-1"
            onClick={() => void runAction(() => window.shorekeeper.appearance.pickBackground())}
          >
            从本机选择
          </SettingsPrimaryButton>
          <SettingsSecondaryButton
            onClick={() =>
              void runAction(() =>
                window.shorekeeper.appearance.clearAsset('background').then((r) => r),
              )
            }
          >
            恢复预设背景
          </SettingsSecondaryButton>
        </div>

        <SettingsField
          label="适应方式"
          hint={
            info.backgroundFit === 'contain'
              ? '完整显示 · 窗口变化时保持比例，两侧或上下可能留白'
              : '铺满窗口 · 窗口变化时自动裁切以填满'
          }
        >
          <div className="flex gap-2">
            {(
              [
                { id: 'cover' as const, label: '铺满窗口' },
                { id: 'contain' as const, label: '完整显示' },
              ] as const
            ).map((option) => {
              const active = info.backgroundFit === option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  onClick={() =>
                    void runAction(() =>
                      window.shorekeeper.appearance.setBackgroundFit(option.id),
                    )
                  }
                  className={`flex-1 rounded-xl border px-3 py-2 text-xs transition ${
                    active
                      ? 'border-keeper-cyan/50 bg-keeper-cyan/10 text-keeper-cyan'
                      : 'border-keeper-silver/15 text-keeper-ice/60 hover:border-keeper-cyan/25'
                  }`}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        </SettingsField>

        <SettingsField label="遮罩强度" hint={`${veilPercent}% · 保证聊天气泡可读`}>
          <input
            type="range"
            min={0}
            max={100}
            value={veilPercent}
            className="no-drag w-full accent-keeper-cyan"
            onChange={(e) => {
              const value = Number.parseInt(e.target.value, 10) / 100;
              void runAction(() => window.shorekeeper.appearance.setVeilOpacity(value));
            }}
          />
        </SettingsField>
      </SettingsPanel>

      <SettingsPanel title="头像" subtitle="Agent 与用户" icon="👤">
        <div className="grid grid-cols-2 gap-4">
          {(
            [
              {
                label: 'Agent',
                src: getResolvedKeeperAvatarSrc(info),
                pick: () => window.shorekeeper.appearance.pickKeeperAvatar(),
                clear: () => window.shorekeeper.appearance.clearAsset('keeperAvatar'),
              },
              {
                label: '用户',
                src: getResolvedUserAvatarSrc(info),
                pick: () => window.shorekeeper.appearance.pickUserAvatar(),
                clear: () => window.shorekeeper.appearance.clearAsset('userAvatar'),
              },
            ] as const
          ).map((item) => (
            <div key={item.label} className="flex flex-col items-center gap-2">
              <img
                src={item.src}
                alt={item.label}
                className="h-16 w-16 rounded-full border-2 border-keeper-cyan/40 object-cover"
                draggable={false}
              />
              <p className="text-xs text-keeper-ice/60">{item.label}</p>
              <div className="flex gap-1">
                <SettingsSecondaryButton
                  className="px-2 py-1 text-[10px]"
                  onClick={() => void runAction(() => item.pick())}
                >
                  更换
                </SettingsSecondaryButton>
                <SettingsSecondaryButton
                  className="px-2 py-1 text-[10px]"
                  onClick={() => void runAction(() => item.clear().then((r) => r))}
                >
                  恢复
                </SettingsSecondaryButton>
              </div>
            </div>
          ))}
        </div>
      </SettingsPanel>
    </SettingsPageShell>
  );
}
