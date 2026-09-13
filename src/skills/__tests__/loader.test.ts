import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  discoverSkills,
  formatSkillsForPrompt,
  invalidateSkillsCache,
} from '../loader';
import { setSkillsDirectoryOverride } from '../paths';

afterEach(() => {
  setSkillsDirectoryOverride(null);
  invalidateSkillsCache();
});

describe('skills loader', () => {
  it('discovers example skill from skills/example/SKILL.md', () => {
    invalidateSkillsCache();
    const skills = discoverSkills();
    const example = skills.find((s) => s.id === 'example');
    expect(example).toBeDefined();
    expect(example?.name).toBe('简洁助手');
    expect(example?.trigger).toBe('manual');
    expect(example?.priority).toBe(0);
    expect(example?.allowedTools).toEqual(['read_file', 'list_dir', 'web_search', 'recall_memory']);
    expect(example?.systemPromptFragment).toContain('【技能：简洁助手】');
  });

  it('parses auto skill matchKeywords and priority', () => {
    invalidateSkillsCache();
    const excel = discoverSkills().find((s) => s.id === 'excel');
    expect(excel?.trigger).toBe('auto');
    expect(excel?.priority).toBe(10);
    expect(excel?.matchKeywords).toContain('xlsx');
    expect(excel?.matchKeywords).not.toContain('附件已解析');
    expect(excel?.requiredTools).toEqual(['read_xlsx']);
  });

  it('wraps skills in structured tags for prompt', () => {
    const block = formatSkillsForPrompt([
      {
        id: 'excel',
        name: 'Excel 表格处理',
        description: '',
        version: '1.0.0',
        systemPromptFragment: 'body',
        trigger: 'auto',
        priority: 10,
        kind: 'capability',
        validationErrors: [],
      },
    ]);
    expect(block).toContain('<skill id="excel" name="Excel 表格处理">');
    expect(block).toContain('body');
    expect(block).toContain('</skill>');
  });

  it('does not inject the same skill twice', () => {
    const item = {
      id: 'duplicate',
      name: 'Duplicate',
      description: '',
      version: '1.0.0',
      systemPromptFragment: 'body',
      trigger: 'manual' as const,
      priority: 0,
      kind: 'capability' as const,
      validationErrors: [],
    };

    expect(formatSkillsForPrompt([item, item])?.match(/<skill /g)).toHaveLength(1);
  });

  it('caches discoverSkills until invalidated', () => {
    invalidateSkillsCache();
    const first = discoverSkills();
    const second = discoverSkills();
    expect(first).toBe(second);

    invalidateSkillsCache();
    const third = discoverSkills();
    expect(third).not.toBe(first);
    expect(third).toEqual(first);
  });

  it('reports invalid metadata and duplicate ids instead of activating them silently', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-validation-'));
    for (const folder of ['one', 'two']) {
      const dir = path.join(root, folder);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, 'SKILL.md'),
        '---\nid: duplicate\ntrigger: auto\n---\nbody',
      );
    }
    setSkillsDirectoryOverride(root);
    invalidateSkillsCache();

    const skills = discoverSkills();
    expect(skills).toHaveLength(2);
    for (const skill of skills) {
      expect(skill.validationErrors).toContain('缺少 name');
      expect(skill.validationErrors).toContain('缺少 description');
      expect(skill.validationErrors).toContain('自动 Skill 必须配置非空 matchKeywords');
      expect(skill.validationErrors).toContain('重复 Skill id: duplicate');
    }
  });

  it('recognizes a minimal standard Agent Skill without Shorekeeper metadata', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-standard-'));
    const dir = path.join(root, 'plain-skill');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'SKILL.md'),
      '---\nname: plain-skill\ndescription: A standard skill\n---\nFollow the request.',
    );
    setSkillsDirectoryOverride(root);
    invalidateSkillsCache();

    const [skill] = discoverSkills();
    expect(skill).toMatchObject({ id: 'plain-skill', validationErrors: [] });
  });

  it('rejects required tools that are not exposed by the skill whitelist', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-tool-contract-'));
    const dir = path.join(root, 'broken-skill');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'SKILL.md'),
      [
        '---',
        'name: broken-skill',
        'description: Broken tool contract',
        'metadata:',
        '  shorekeeper:',
        '    requiredTools: [read_file]',
        '---',
        'Follow the request.',
      ].join('\n'),
    );
    setSkillsDirectoryOverride(root);
    invalidateSkillsCache();

    const [skill] = discoverSkills();
    expect(skill.validationErrors).toContain('requiredTools 未包含在 allowedTools 中: read_file');
  });
});
