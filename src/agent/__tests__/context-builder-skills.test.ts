import { describe, expect, it, vi } from 'vitest';

vi.mock('../../db', () => ({
  getDatabase: vi.fn(() => ({
    prepare: vi.fn(() => ({
      get: vi.fn(() => ({ value: '测试人设' })),
    })),
  })),
}));

vi.mock('../../memory/user-profile', () => ({
  getProfileSummary: vi.fn(() => null),
}));
vi.mock('../../memory/long-term', () => ({
  searchMemories: vi.fn(() => []),
  searchMemoriesWithEmbedding: vi.fn(async () => []),
  formatMemoriesForPrompt: vi.fn(() => null),
}));
vi.mock('../../memory/worldbook', () => ({
  matchWorldbook: vi.fn(() => []),
  formatWorldbookForPrompt: vi.fn(() => null),
}));
vi.mock('../../memory/session-context', () => ({
  getSessionSummary: vi.fn(() => null),
  formatSummaryForPrompt: vi.fn(() => null),
}));
vi.mock('../../affection', () => ({
  formatAffectionForPrompt: vi.fn(() => '【好感度】'),
}));
vi.mock('../../rag/documents', () => ({
  listDocuments: vi.fn(() => []),
}));
vi.mock('../../config/performance', () => ({
  getPerformanceSettings: vi.fn(() => ({ memorySemanticInContext: false })),
  shouldInjectRagCatalog: vi.fn(() => false),
  shouldAutoRetrieveRag: vi.fn(() => false),
}));

import { buildSystemPromptParts } from '../context-builder';
import { readFileTool } from '../../tools/file/read-file';

describe('context-builder skills', () => {
  it('injects active skills between persona and tool guide', async () => {
    const parts = await buildSystemPromptParts({
      userMessage: '分析表格',
      sessionId: 's1',
      availableTools: [readFileTool],
      activeSkills: [
        {
          id: 'excel',
          name: 'Excel 表格处理',
          description: '',
          version: '1.0.0',
          systemPromptFragment: '【技能：Excel】',
          trigger: 'auto',
          priority: 10,
          kind: 'capability',
          validationErrors: [],
        },
      ],
    });

    const personaIdx = parts.stable.indexOf('测试人设');
    const skillIdx = parts.stable.indexOf('<skill id="excel"');
    const toolIdx = parts.stable.indexOf('【当前可用工具】');

    expect(personaIdx).toBeGreaterThanOrEqual(0);
    expect(skillIdx).toBeGreaterThan(personaIdx);
    expect(toolIdx).toBeGreaterThan(skillIdx);
    expect(parts.stable).toContain('【技能：Excel】');
    // P6.0：证据不足先问属于稳定前缀，排在技能与工具说明之前，每轮都在
    const ruleIdx = parts.stable.indexOf('【证据不足先问】');
    expect(ruleIdx).toBeGreaterThan(personaIdx);
    expect(ruleIdx).toBeLessThan(skillIdx);
  });

  it('omits skills block when none active', async () => {
    const parts = await buildSystemPromptParts({
      userMessage: '你好',
      sessionId: 's1',
      availableTools: [readFileTool],
      activeSkills: [],
    });

    expect(parts.stable).not.toContain('<skill');
  });
});
