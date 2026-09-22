import { describe, expect, it } from 'vitest';
import { normalizeErpApiPrefix } from '../../config/erp';
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
});
