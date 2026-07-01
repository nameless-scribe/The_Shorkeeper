import { createContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { AppearanceSettingsInfo } from '@/shared/types';
import { applyTheme } from './apply-theme';

export const ThemeContext = createContext<AppearanceSettingsInfo | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [appearance, setAppearance] = useState<AppearanceSettingsInfo | null>(null);

  useEffect(() => {
    if (!window.shorekeeper?.appearance) return undefined;

    let cancelled = false;
    window.shorekeeper.appearance
      .get()
      .then((data) => {
        if (cancelled) return;
        applyTheme(data);
        setAppearance(data);
      })
      .catch(console.error);

    const off = window.shorekeeper.appearance.onChanged((data) => {
      applyTheme(data);
      setAppearance(data);
    });

    return () => {
      cancelled = true;
      off();
    };
  }, []);

  const value = useMemo(() => appearance, [appearance]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
