import fs from 'node:fs';
import path from 'node:path';
import { resolveSkillsDirectory } from './paths';

export interface Skill {
  id: string;
  name: string;
  description: string;
  version: string;
  systemPromptFragment: string;
  allowedTools?: string[];
  trigger: 'manual' | 'auto';
  matchKeywords?: string[];
  priority: number;
}

const SKILLS_DIR = () => resolveSkillsDirectory();

let cachedSkills: { mtimeMs: number; skills: Skill[] } | null = null;

function getSkillsDirMtime(skillsDir: string): number {
  if (!fs.existsSync(skillsDir)) return 0;
  let latest = fs.statSync(skillsDir).mtimeMs;
  for (const entry of fs.readdirSync(skillsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const skillPath = path.join(skillsDir, entry.name, 'SKILL.md');
    if (!fs.existsSync(skillPath)) continue;
    latest = Math.max(latest, fs.statSync(skillPath).mtimeMs);
  }
  return latest;
}

/** 测试或技能文件变更后调用 */
export function invalidateSkillsCache(): void {
  cachedSkills = null;
}

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

function parseCommaList(raw: string | undefined): string[] | undefined {
  if (!raw?.trim()) return undefined;
  const trimmed = raw.trim();
  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean);
    } catch {
      /* fall through */
    }
  }
  const list = trimmed.split(',').map((s) => s.trim()).filter(Boolean);
  return list.length ? list : undefined;
}

function parseAllowedTools(raw: string | undefined): string[] | undefined {
  return parseCommaList(raw);
}

function parsePriority(raw: string | undefined): number {
  if (!raw?.trim()) return 0;
  const n = Number.parseInt(raw.trim(), 10);
  return Number.isFinite(n) ? n : 0;
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
    matchKeywords: parseCommaList(meta.matchKeywords),
    priority: parsePriority(meta.priority),
  };
}

function sortSkills(skills: Skill[]): Skill[] {
  return [...skills].sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    return a.name.localeCompare(b.name, 'zh-CN');
  });
}

export function discoverSkills(): Skill[] {
  const skillsDir = SKILLS_DIR();
  const mtimeMs = getSkillsDirMtime(skillsDir);
  if (cachedSkills && cachedSkills.mtimeMs === mtimeMs) {
    return cachedSkills.skills;
  }

  if (!fs.existsSync(skillsDir)) {
    cachedSkills = { mtimeMs, skills: [] };
    return [];
  }

  const skills: Skill[] = [];
  for (const entry of fs.readdirSync(skillsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const skillPath = path.join(skillsDir, entry.name, 'SKILL.md');
    if (!fs.existsSync(skillPath)) continue;
    try {
      const skill = loadSkillFile(skillPath);
      if (skill) skills.push(skill);
    } catch (err) {
      console.warn(`[skills] 跳过 ${skillPath}:`, err);
    }
  }

  const sorted = sortSkills(skills);
  cachedSkills = { mtimeMs, skills: sorted };
  return sorted;
}

export function formatSkillsForPrompt(skills: Skill[]): string | null {
  const unique = new Map<string, Skill>();
  for (const skill of skills) {
    if (!unique.has(skill.id)) unique.set(skill.id, skill);
  }
  if (!unique.size) return null;
  return [...unique.values()]
    .map(
      (s) =>
        `<skill id="${s.id}" name="${s.name}">\n${s.systemPromptFragment}\n</skill>`,
    )
    .join('\n\n');
}

export function getSkillById(id: string): Skill | null {
  return discoverSkills().find((s) => s.id === id) ?? null;
}

export function getSkillsDirectory(): string {
  return SKILLS_DIR();
}
