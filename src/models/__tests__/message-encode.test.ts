import { describe, expect, it, vi } from 'vitest';

vi.mock('../config', () => ({
  shouldUseExplicitCache: vi.fn(() => true),
}));

import { encodeMessagesForApi } from '../message-encode';

describe('encodeMessagesForApi', () => {
  it('adds cache_control to stable system prefix', () => {
    const stable = 'STABLE_PART';
    const result = encodeMessagesForApi(
      [{ role: 'system', content: 'STABLE_PART\n\n动态块' }],
      stable,
    );
    expect(result[0]).toEqual({
      role: 'system',
      content: [
        { type: 'text', text: 'STABLE_PART', cache_control: { type: 'ephemeral' } },
        { type: 'text', text: '动态块' },
      ],
    });
  });

  it('leaves user messages unchanged', () => {
    const result = encodeMessagesForApi(
      [
        { role: 'system', content: 'STABLE' },
        { role: 'user', content: '你好' },
      ],
      'STABLE',
    );
    expect(result[1]).toEqual({ role: 'user', content: '你好' });
  });
});
