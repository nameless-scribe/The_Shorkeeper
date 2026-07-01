import { useEffect, useState } from 'react';
import type { AppearanceSettingsInfo } from '@/shared/types';
import { applyTheme, getLatestAppearance } from './apply-theme';

export function useAppearance(): AppearanceSettingsInfo | null {
  const [info, setInfo] = useState<AppearanceSettingsInfo | null>(() => getLatestAppearance());

  useEffect(() => {
    if (!window.shorekeeper?.appearance) return undefined;

    window.shorekeeper.appearance.get().then((data) => {
      applyTheme(data);
      setInfo(data);
    }).catch(console.error);

    const off = window.shorekeeper.appearance.onChanged((data) => {
      applyTheme(data);
      setInfo(data);
    });

    return off;
  }, []);

  return info;
}

export async function initAppearance(): Promise<void> {
  if (!window.shorekeeper?.appearance) return;
  const data = await window.shorekeeper.appearance.get();
  applyTheme(data);
}

export function subscribeAppearance(callback: (info: AppearanceSettingsInfo) => void): () => void {
  if (!window.shorekeeper?.appearance) {
    return () => {};
  }
  return window.shorekeeper.appearance.onChanged(callback);
}
