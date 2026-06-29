import { describe, expect, it } from 'vitest';
import { isPluginToolEnabled, type PluginSettings } from '../plugins';

const base: PluginSettings = {
  webSearch: true,
  fetchUrl: true,
  docGen: true,
  bookkeeping: true,
  lifeTools: true,
  filesystemMode: 'confirm',
};

describe('plugin settings', () => {
  it('disables web_search when plugin off', () => {
    expect(isPluginToolEnabled('web_search', { ...base, webSearch: false })).toBe(false);
  });

  it('blocks write_file in readonly mode', () => {
    expect(isPluginToolEnabled('write_file', { ...base, filesystemMode: 'readonly' })).toBe(false);
    expect(isPluginToolEnabled('write_file', { ...base, filesystemMode: 'full' })).toBe(true);
  });

  it('blocks gen tools when docGen off', () => {
    expect(isPluginToolEnabled('gen_xlsx', { ...base, docGen: false })).toBe(false);
  });

  it('keeps core memory tools enabled', () => {
    expect(isPluginToolEnabled('save_memory', base)).toBe(true);
    expect(isPluginToolEnabled('recall_memory', base)).toBe(true);
  });
});
