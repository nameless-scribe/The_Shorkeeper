import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const SAFE_STORAGE_PREFIX = 'safe-storage:v1:';
const REDACTED_SECRET = '••••••••';

interface SafeStorageApi {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}

let cachedSafeStorage: SafeStorageApi | null | undefined;

function getSafeStorage(): SafeStorageApi | null {
  if (cachedSafeStorage !== undefined) return cachedSafeStorage;
  try {
    const electron = require('electron') as { safeStorage?: SafeStorageApi } | string;
    if (
      typeof electron !== 'string' &&
      electron.safeStorage &&
      electron.safeStorage.isEncryptionAvailable()
    ) {
      cachedSafeStorage = electron.safeStorage;
      return cachedSafeStorage;
    }
  } catch {
    // Node-only scripts and tests do not expose Electron safeStorage.
  }
  cachedSafeStorage = null;
  return null;
}

export function isProtectedSecret(value: string): boolean {
  return value.startsWith(SAFE_STORAGE_PREFIX);
}

export function protectSecret(value: string): string {
  if (!value || isProtectedSecret(value)) return value;
  const safeStorage = getSafeStorage();
  if (!safeStorage) return value;
  return `${SAFE_STORAGE_PREFIX}${safeStorage.encryptString(value).toString('base64')}`;
}

/** 用于不允许明文回退的新敏感配置；系统加密不可用时直接停止保存。 */
export function protectSecretStrict(value: string): string {
  if (!value) throw new Error('凭据不能为空');
  if (isProtectedSecret(value)) return value;
  const safeStorage = getSafeStorage();
  if (!safeStorage) throw new Error('系统凭据存储不可用，未保存 ERP 密码；你仍可选择人工登录');
  return `${SAFE_STORAGE_PREFIX}${safeStorage.encryptString(value).toString('base64')}`;
}

export function revealSecret(value: string): string {
  if (!isProtectedSecret(value)) return value;
  const safeStorage = getSafeStorage();
  if (!safeStorage) {
    throw new Error('系统凭据存储不可用，无法解密已保存的密钥');
  }
  const payload = value.slice(SAFE_STORAGE_PREFIX.length);
  return safeStorage.decryptString(Buffer.from(payload, 'base64'));
}

export function protectSecretMap(values: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => [key, protectSecret(value)]),
  );
}

export function revealSecretMap(values: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => [key, revealSecret(value)]),
  );
}

export function redactSecretMap(values: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.keys(values).map((key) => [key, REDACTED_SECRET]));
}
