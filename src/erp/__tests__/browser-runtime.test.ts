import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { erpBrowserLaunchOptions, erpBrowserProfilePath } from '../../../electron/erp/browser-runtime';

describe('ERP browser runtime configuration', () => {
  it('uses a dedicated deterministic profile without exposing the ERP host', () => {
    const root = path.resolve('C:/Users/test/AppData/Roaming/TheShorekeeper');
    const profile = erpBrowserProfilePath(root, 'http://49.7.10.65:9024/login', 'msedge');
    expect(profile.startsWith(path.join(root, 'erp-browser'))).toBe(true);
    expect(profile).toContain('msedge-');
    expect(profile).not.toContain('49.7.10.65');
  });

  it('launches a visible branded browser with sandboxing and downloads disabled', () => {
    expect(erpBrowserLaunchOptions('msedge')).toMatchObject({
      channel: 'msedge', headless: false, chromiumSandbox: true, acceptDownloads: false, viewport: null,
    });
  });
});
