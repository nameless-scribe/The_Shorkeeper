import type { ThemeColorTokens } from '../../shared/types';

export interface ThemePreset {
  id: string;
  name: string;
  description?: string;
  colors: ThemeColorTokens;
  backgrounds: {
    scene: string;
    stars?: boolean;
  };
  veil: {
    chat: string;
    status: string;
  };
  defaultAvatars: {
    keeper: string;
    user: string;
  };
  defaultVeilOpacity: number;
}
