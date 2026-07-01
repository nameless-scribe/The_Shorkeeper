import { useCallback, useEffect, useRef, useState } from 'react';
import type { ModelProfileInfo, ModelProfilesInfo } from '@/shared/types';
import { profileIcon } from './model-profile-icon';

interface ModelQuickSwitcherProps {
  disabled?: boolean;
  onModelChange?: () => void;
}

export function ModelQuickSwitcher({ disabled, onModelChange }: ModelQuickSwitcherProps) {
  const [profilesInfo, setProfilesInfo] = useState<ModelProfilesInfo | null>(null);
  const [open, setOpen] = useState(false);
  const [switching, setSwitching] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const loadProfiles = useCallback(async () => {
    const info = await window.shorekeeper.model.getProfiles();
    setProfilesInfo(info);
    return info;
  }, []);

  useEffect(() => {
    loadProfiles().catch(console.error);
  }, [loadProfiles]);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const activeProfile =
    profilesInfo?.profiles.find((p) => p.id === profilesInfo.activeId) ??
    profilesInfo?.profiles[0] ??
    null;

  const handleToggle = async () => {
    if (disabled || switching) return;
    if (!open) {
      await loadProfiles();
    }
    setOpen((v) => !v);
  };

  const handleSelect = async (profile: ModelProfileInfo) => {
    if (disabled || switching || profile.id === profilesInfo?.activeId) {
      setOpen(false);
      return;
    }

    setSwitching(true);
    try {
      const next = await window.shorekeeper.model.setActiveProfile(profile.id);
      setProfilesInfo(next);
      onModelChange?.();
      setOpen(false);
    } catch (err) {
      console.error(err);
    } finally {
      setSwitching(false);
    }
  };

  if (!activeProfile) return null;

  const hasMultiple = (profilesInfo?.profiles.length ?? 0) > 1;

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        disabled={disabled || switching}
        onClick={() => void handleToggle()}
        title={hasMultiple ? '切换对话模型' : `当前模型：${activeProfile.model}`}
        className="flex h-9 max-w-[132px] items-center gap-1 rounded-xl border border-keeper-silver/15 bg-keeper-navyDeep/40 px-2 text-[10px] text-keeper-ice/75 transition hover:border-keeper-cyan/30 hover:bg-keeper-cyan/5 hover:text-keeper-cyan disabled:cursor-not-allowed disabled:opacity-40"
      >
        <span className="shrink-0 text-xs leading-none">{profileIcon(activeProfile)}</span>
        <span className="min-w-0 truncate font-medium">{activeProfile.name}</span>
        {hasMultiple && (
          <span
            className={`shrink-0 text-[8px] text-keeper-ice/35 transition ${open ? 'rotate-180' : ''}`}
          >
            ▾
          </span>
        )}
      </button>

      {open && hasMultiple && (
        <div className="absolute bottom-full left-0 z-50 mb-2 min-w-[220px] overflow-hidden rounded-xl border border-keeper-cyan/20 bg-keeper-navyDeep/95 p-1 shadow-[0_8px_32px_rgba(0,0,0,0.45)] backdrop-blur-md">
          <p className="px-2.5 py-1.5 text-[10px] font-medium text-keeper-ice/40">切换模型</p>
          <ul className="max-h-52 overflow-y-auto">
            {profilesInfo?.profiles.map((profile) => {
              const isActive = profile.id === profilesInfo.activeId;
              return (
                <li key={profile.id}>
                  <button
                    type="button"
                    onClick={() => void handleSelect(profile)}
                    className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left transition ${
                      isActive
                        ? 'bg-keeper-cyan/15 text-keeper-cyan'
                        : 'text-keeper-ice/80 hover:bg-keeper-silver/10 hover:text-keeper-ice'
                    }`}
                  >
                    <span className="shrink-0 text-sm">{profileIcon(profile)}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-medium">{profile.name}</span>
                      <span className="block truncate font-mono text-[10px] opacity-60">
                        {profile.model}
                      </span>
                    </span>
                    {isActive && (
                      <span className="shrink-0 text-[10px] text-keeper-cyan/80">✓</span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
