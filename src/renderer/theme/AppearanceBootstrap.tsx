import { useEffect } from 'react';
import { initAppearance, subscribeAppearance } from './use-appearance';
import { applyTheme } from './apply-theme';
import type { AppearanceSettingsInfo } from '../../shared/types';

export function AppearanceBootstrap({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    void initAppearance().catch(console.error);
    const off = subscribeAppearance((info: AppearanceSettingsInfo) => applyTheme(info));
    return off;
  }, []);

  return children;
}
