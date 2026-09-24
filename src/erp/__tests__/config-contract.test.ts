import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { closeDatabase, initDatabase } from '../../db';
import { getSetting } from '../../db/app-settings';
import { normalizeErpApiPrefix, saveErpSettings } from '../../config/erp';
import { protectSecretStrict } from '../../security/secret-storage';

describe('ERP configuration safety', () => {
  it('accepts only an origin-local API prefix', () => {
    expect(normalizeErpApiPrefix('/prod-api/')).toBe('/prod-api');
    expect(() => normalizeErpApiPrefix('https://other.test/api')).toThrow('API 前缀无效');
    expect(() => normalizeErpApiPrefix('/../admin')).toThrow('API 前缀无效');
  });

  it('does not fall back to plaintext when safeStorage is unavailable', () => {
    expect(() => protectSecretStrict('erp-password')).toThrow('未保存 ERP 密码');
  });

  it('does not leave earlier ERP settings changed when a later field is invalid', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'shorekeeper-erp-config-'));
    try {
      await initDatabase(path.join(directory, 'settings.db'));
      expect(() => saveErpSettings({ enabled: true, apiPrefix: '/../invalid' })).toThrow('API 前缀无效');
      expect(getSetting('erp.enabled')).toBeNull();
      expect(() => saveErpSettings({ enabled: true, password: 'plain-secret' })).toThrow('未保存 ERP 密码');
      expect(getSetting('erp.enabled')).toBeNull();
    } finally {
      closeDatabase();
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});
