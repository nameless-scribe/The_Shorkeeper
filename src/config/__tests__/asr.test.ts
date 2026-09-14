import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeDatabase, initDatabase } from '../../db';
import { getSetting } from '../../db/app-settings';
import {
  ASR_SETTING_KEYS,
  checkAsrConfig,
  getAsrSettingsInfo,
  maskSecret,
  resolveAsrSettings,
  saveAsrSettings,
} from '../asr';

const ENV_KEYS = [
  'TENCENT_ASR_SECRET_ID',
  'TENCENT_ASR_SECRET_KEY',
  'TENCENT_ASR_APP_ID',
  'TENCENT_ASR_ENGINE_TYPE',
  'TENCENT_ASR_DIARIZATION',
] as const;

let root = '';
const savedEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

beforeEach(async () => {
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'sk-asr-config-'));
  await initDatabase(path.join(root, 'settings.db'));
});

afterEach(async () => {
  closeDatabase();
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  await fs.rm(root, { recursive: true, force: true });
});

describe('ASR credential settings', () => {
  it('reports "none" and names every missing field before anything is configured', () => {
    const info = getAsrSettingsInfo();
    expect(info.configured).toBe(false);
    expect(info.credentialsSource).toBe('none');
    expect(info.reason).toContain('SecretId / SecretKey / AppID');
    expect(info.reason).toContain('设置 → 语音');
  });

  it('stores credentials in the app, masks them on read, and never returns plaintext', () => {
    const info = saveAsrSettings({
      secretId: 'AKIDabcdefghijklmnopqrstuvwxyz',
      secretKey: 'sk-secret-value-0123456789',
      appId: '1250000001',
    });
    expect(info.configured).toBe(true);
    expect(info.credentialsSource).toBe('settings');
    expect(info.appId).toBe('1250000001');
    expect(info.secretIdMasked).toMatch(/^AKID\*+wxyz$/);
    expect(info.secretKeyMasked).toMatch(/^sk-s\*+6789$/);
    expect(JSON.stringify(info)).not.toContain('sk-secret-value');

    expect(resolveAsrSettings().secretKey).toBe('sk-secret-value-0123456789');
  });

  it('app settings win over environment variables field by field', () => {
    process.env.TENCENT_ASR_SECRET_ID = 'env-id';
    process.env.TENCENT_ASR_SECRET_KEY = 'env-key';
    process.env.TENCENT_ASR_APP_ID = '1';
    expect(getAsrSettingsInfo().credentialsSource).toBe('env');

    saveAsrSettings({ appId: '2' });
    const settings = resolveAsrSettings();
    expect(settings).toMatchObject({ secretId: 'env-id', secretKey: 'env-key', appId: '2' });
    expect(getAsrSettingsInfo().credentialsSource).toBe('settings');
  });

  it('treats an empty credential field as "leave unchanged"', () => {
    saveAsrSettings({ secretId: 'id-1', secretKey: 'key-1', appId: '3' });
    saveAsrSettings({ secretId: '', secretKey: '   ', appId: undefined });
    expect(resolveAsrSettings()).toMatchObject({ secretId: 'id-1', secretKey: 'key-1', appId: '3' });
  });

  it('rejects a non-numeric AppID without touching the stored value', () => {
    saveAsrSettings({ appId: '4' });
    expect(() => saveAsrSettings({ appId: 'AKID-not-an-app-id' })).toThrow('AppID 应为纯数字');
    expect(resolveAsrSettings().appId).toBe('4');
  });

  it('clearCredentials removes the app copies and falls back to the environment', () => {
    process.env.TENCENT_ASR_APP_ID = '9';
    saveAsrSettings({ secretId: 'id', secretKey: 'key', appId: '5' });
    const info = saveAsrSettings({ clearCredentials: true });
    expect(getSetting(ASR_SETTING_KEYS.secretId)).toBeNull();
    expect(getSetting(ASR_SETTING_KEYS.secretKey)).toBeNull();
    expect(info.appId).toBe('9');
    expect(info.credentialsSource).toBe('env');
  });

  it('persists engine type and diarization, validating the engine', () => {
    const info = saveAsrSettings({ engineType: '16k_zh_en', diarization: false });
    expect(info.engineType).toBe('16k_zh_en');
    expect(info.diarization).toBe(false);
    expect(resolveAsrSettings().diarization).toBe(false);
    expect(() => saveAsrSettings({ engineType: '32k_fr' as never })).toThrow('不支持的引擎类型');
  });

  it('checkAsrConfig still names the field when only AppID is malformed', () => {
    const status = checkAsrConfig({
      secretId: 'a',
      secretKey: 'b',
      appId: 'not-digits',
      engineType: '16k_zh',
      diarization: true,
    });
    expect(status.configured).toBe(false);
    if (!status.configured) expect(status.missing).toEqual(['AppID']);
  });

  it('masks short values entirely and long values by their ends', () => {
    expect(maskSecret('')).toBe('');
    expect(maskSecret('12345678')).toBe('********');
    expect(maskSecret('abcdefghijklmnop')).toBe('abcd********mnop');
  });
});
