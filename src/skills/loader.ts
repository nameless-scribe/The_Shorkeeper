import fs from 'node:fs';
import path from 'node:path';
import { load as parseYaml } from 'js-yaml';
import { resolveSkillsDirectory } from './paths';

export interface Skill {
  id: string;
  name: string;
  description: string;
  version: string;
  systemPromptFragment: string;
  allowedTools?: string[];
  requiredTools?: string[];
  conflictsWith?: string[];
  trigger: 'manual' | 'auto';
  matchKeywords?: string[];
  priority: number;
  kind: 'capability' | 'workflow' | 'internal';
  validationErrors: string[];
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

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function parseFrontmatter(raw: string): { meta: Record<string, unknown>; body: string; error?: string } {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    return { meta: {}, body: raw.trim(), error: '缺少有效 YAML frontmatter' };
  }
  try {
    return { meta: asRecord(parseYaml(match[1])), body: match[2].trim() };
  } catch (error) {
    return {
      meta: {},
      body: match[2].trim(),
      error: `YAML 解析失败：${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

function parseCommaList(raw: unknown): string[] | undefined {
  if (Array.isArray(raw)) {
    const list = raw.map(String).map((item) => item.trim()).filter(Boolean);
    return list.length ? [...new Set(list)] : undefined;
  }
  if (typeof raw !== 'string' || !raw.trim()) return undefined;
  const trimmed = raw.trim();
  const list = trimmed.split(',').map((s) => s.trim()).filter(Boolean);
  return list.length ? [...new Set(list)] : undefined;
}

function parseAllowedTools(raw: unknown): string[] | undefined {
  return parseCommaList(raw);
}

function parsePriority(raw: unknown): number {
  if (raw == null || raw === '') return 0;
  const n = typeof raw === 'number' ? raw : Number.parseInt(String(raw).trim(), 10);
  return Number.isFinite(n) ? n : 0;
}

function parseKind(raw: unknown): Skill['kind'] {
  if (raw === 'workflow' || raw === 'internal') return raw;
  return 'capability';
}

function loadSkillFile(filePath: string): Skill | null {
  const raw = fs.readFileSync(filePath, 'utf8');
  const { meta, body, error: frontmatterError } = parseFrontmatter(raw);
  const dirName = path.basename(path.dirname(filePath));
  const metadata = asRecord(meta.metadata);
  const shorekeeper = asRecord(metadata.shorekeeper);
  // Legacy Shorekeeper skills carried a custom top-level `id`. Standard Agent
  // Skills use `name` as their identity, with optional runtime data in metadata.
  const isStandard = Object.keys(shorekeeper).length > 0 || meta['allowed-tools'] != null || meta.id == null;
  const config = isStandard ? shorekeeper : meta;
  const technicalName = typeof meta.name === 'string' ? meta.name.trim() : '';
  const legacyId = typeof meta.id === 'string' ? meta.id.trim() : '';
  const id = (isStandard ? technicalName : legacyId) || dirName;
  const displayName = typeof config.displayName === 'string' ? config.displayName.trim() : '';
  const legacyName = !isStandard && typeof meta.name === 'string' ? meta.name.trim() : '';
  const name = displayName || legacyName || id;
  const description = typeof meta.description === 'string' ? meta.description.trim() : '';
  const version = typeof config.version === 'string' ? config.version.trim() : '1.0.0';
  const triggerValue = typeof config.trigger === 'string' ? config.trigger.trim() : 'manual';
  const trigger = triggerValue === 'auto' ? 'auto' : 'manual';
  const matchKeywords = parseCommaList(config.matchKeywords);
  const allowedTools = parseAllowedTools(config.allowedTools ?? meta['allowed-tools']);
  const requiredTools = parseAllowedTools(config.requiredTools);
  const conflictsWith = parseCommaList(config.conflictsWith);
  const validationErrors: string[] = [];
  if (frontmatterError) validationErrors.push(frontmatterError);
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(id)) {
    validationErrors.push('id 只能包含小写字母、数字和连字符，且不超过 64 个字符');
  }
  if (!technicalName) validationErrors.push('缺少 name');
  if (!description) validationErrors.push('缺少 description');
  if (isStandard && technicalName !== dirName) {
    validationErrors.push(`name 必须与目录名一致：${dirName}`);
  }
  if (!body) validationErrors.push('正文为空');
  if (config.trigger && !['auto', 'manual'].includes(String(config.trigger).trim())) {
    validationErrors.push('trigger 只能是 auto 或 manual');
  }
  if (config.kind && !['capability', 'workflow', 'internal'].includes(String(config.kind).trim())) {
    validationErrors.push('kind 只能是 capability、workflow 或 internal');
  }
  if (config.version && !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(String(config.version).trim())) {
    validationErrors.push('version 须为语义版本号，如 1.0.0');
  }
  if (
    config.priority != null &&
    (!Number.isFinite(Number(config.priority)) || !Number.isInteger(Number(config.priority)))
  ) {
    validationErrors.push('priority 须为整数');
  }
  if (trigger === 'auto' && !matchKeywords?.length) {
    validationErrors.push('自动 Skill 必须配置非空 matchKeywords');
  }
  if (requiredTools?.length) {
    const hiddenRequired = requiredTools.filter((tool) => !allowedTools?.includes(tool));
    if (hiddenRequired.length) {
      validationErrors.push(`requiredTools 未包含在 allowedTools 中: ${hiddenRequired.join(', ')}`);
    }
  }
  if (conflictsWith?.includes(id)) validationErrors.push('Skill 不能与自身冲突');

  return {
    id,
    name,
    description,
    version,
    systemPromptFragment: body,
    allowedTools,
    requiredTools,
    conflictsWith,
    trigger,
    matchKeywords,
    priority: parsePriority(config.priority),
    kind: parseKind(config.kind),
    validationErrors,
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

  const idCounts = new Map<string, number>();
  for (const skill of skills) idCounts.set(skill.id, (idCounts.get(skill.id) ?? 0) + 1);
  const validated = skills.map((skill) => ({
    ...skill,
    validationErrors: idCounts.get(skill.id)! > 1
      ? [...skill.validationErrors, `重复 Skill id: ${skill.id}`]
      : skill.validationErrors,
  }));
  const sorted = sortSkills(validated);
  cachedSkills = { mtimeMs, skills: sorted };
  return sorted;
}

export function formatSkillsForPrompt(skills: Skill[]): string | null {
  const unique = new Map<string, Skill>();
  for (const skill of skills) {
    if (skill.validationErrors.length === 0 && skill.kind !== 'internal' && !unique.has(skill.id)) {
      unique.set(skill.id, skill);
    }
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
