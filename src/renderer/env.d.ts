import type { ShorekeeperApi } from '../../electron/preload.js';

declare global {
  interface Window {
    shorekeeper: ShorekeeperApi;
  }
}

export {};
