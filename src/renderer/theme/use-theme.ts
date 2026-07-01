import { useContext } from 'react';
import type { AppearanceSettingsInfo } from '@/shared/types';
import { ThemeContext } from './ThemeProvider';

export function useTheme(): AppearanceSettingsInfo | null {
  return useContext(ThemeContext);
}
