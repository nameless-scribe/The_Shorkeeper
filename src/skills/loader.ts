import fs from 'node:fs';
import path from 'node:path';

export interface Skill {
  id: string;
  name: string;
  description: string;
  version: string;
  systemPromptFragment: string;
  allowedTools?: string[];
  trigger: 'manual' | 'auto';
}

const SKILLS_DIR = path.join(process.cwd(), 'skills');

function parseFrontmatter(raw: string): { meta: Record<string, string>; body: string } {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    return { meta: {}, body: raw.trim() };
  }

  const meta: Record<string, string> = {};
  for (const line of match[1].split('\n')) {
    const idx = line.indexOf(':');
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    meta[key] = value;
  }

  return { meta, body: match[2].trim() };
}

function parseAllowedTools(raw: string | undefined): string[] | undefined {
  if (!raw?.trim()) return undefined;
  const trimmed = raw.trim();
  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (Array.isArray(parsed)) return parsed.map(String);
    } catch {
      /* fall through */
    }
  }
  return trimmed.split(',').map((s) => s.trim()).filter(Boolean);
}

function loadSkillFile(filePath: string): Skill | null {
  const raw = fs.readFileSync(filePath, 'utf8');
  const { meta, body } = parseFrontmatter(raw);
  const dirName = path.basename(path.dirname(filePath));
  const id = meta.id?.trim() || dirName;
  const name = meta.name?.trim() || id;
  const description = meta.description?.trim() || '';
  const version = meta.version?.trim() || '1.0.0';
  const trigger = meta.trigger?.trim() === 'auto' ? 'auto' : 'manual';

  if (!body) return null;

  return {
    id,
    name,
    description,
    version,
    systemPromptFragment: body,
    allowedTools: parseAllowedTools(meta.allowedTools),
    trigger,
  };
}

export function discoverSkills(): Skill[] {
  if (!fs.existsSync(SKILLS_DIR)) return [];

  const skills: Skill[] = [];
  for (const entry of fs.readdirSync(SKILLS_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const skillPath = path.join(SKILLS_DIR, entry.name, 'SKILL.md');
    if (!fs.existsSync(skillPath)) continue;
    try {
      const skill = loadSkillFile(skillPath);
      if (skill) skills.push(skill);
    } catch (err) {
      console.warn(`[skills] 跳过 ${skillPath}:`, err);
    }
  }

  return skills.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
}

export function getSkillById(id: string): Skill | null {
  return discoverSkills().find((s) => s.id === id) ?? null;
}

export function getSkillsDirectory(): string {
  return SKILLS_DIR;
}
