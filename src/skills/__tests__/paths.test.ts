import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  configureSkillsPaths,
  resolveSkillsDirectory,
  setSkillsDirectoryOverride,
} from '../paths';

afterEach(() => {
  setSkillsDirectoryOverride(null);
});

describe('resolveSkillsDirectory', () => {
  it('uses override in tests', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skills-'));
    setSkillsDirectoryOverride(dir);
    expect(resolveSkillsDirectory()).toBe(dir);
  });

  it('resolves packaged appPath when configured', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pack-'));
    const skills = path.join(root, 'skills');
    fs.mkdirSync(path.join(skills, 'demo'), { recursive: true });
    fs.writeFileSync(path.join(skills, 'demo', 'SKILL.md'), '---\nid: demo\n---\nbody');

    configureSkillsPaths({
      isPackaged: true,
      appPath: root,
      resourcesPath: path.join(root, 'resources'),
    });

    expect(resolveSkillsDirectory()).toBe(skills);
  });
});
