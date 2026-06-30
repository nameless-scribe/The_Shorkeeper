import fs from 'node:fs';
import path from 'node:path';

export interface SkillsPathContext {
  isPackaged: boolean;
  appPath: string;
  resourcesPath: string;
}

let pathContext: SkillsPathContext | null = null;
let overrideDir: string | null = null;

/** 由 Electron 主进程在启动时注入；开发/测试环境可不调用 */
export function configureSkillsPaths(context: SkillsPathContext): void {
  pathContext = context;
}

/** 测试或自定义安装路径 */
export function setSkillsDirectoryOverride(dir: string | null): void {
  overrideDir = dir;
}

export function resolveSkillsDirectory(): string {
  if (overrideDir) return overrideDir;

  const fromEnv = process.env.SHOREKEEPER_SKILLS_DIR?.trim();
  if (fromEnv) return path.resolve(fromEnv);

  if (pathContext?.isPackaged) {
    const inApp = path.join(pathContext.appPath, 'skills');
    if (fs.existsSync(inApp)) return inApp;

    const inResources = path.join(pathContext.resourcesPath, 'skills');
    if (fs.existsSync(inResources)) return inResources;
  }

  return path.join(process.cwd(), 'skills');
}
