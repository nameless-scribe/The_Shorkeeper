import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_DATA_ROOT = 'D:\\SQLlite';

const WORKSPACE_README = `Shorekeeper Agent 工作区
========================

此目录供 AI 助手读写文件（文档、表格、生成的报告等）。
可将办公文档放在此处，或在聊天中通过附件导入。

数据库文件位于同级目录的 shorekeeper.db。
`;

export interface DataLayoutBootstrapResult {
  databaseDir: string;
  databasePath: string;
  workspaceDir: string;
  usedFallback: boolean;
  fallbackReason?: string;
}

function uniqueDirs(...dirs: string[]): string[] {
  return [...new Set(dirs.map((d) => path.resolve(d)))];
}

function seedWorkspace(workspaceDir: string): void {
  const readmePath = path.join(workspaceDir, 'README.txt');
  if (!fs.existsSync(readmePath)) {
    fs.writeFileSync(readmePath, WORKSPACE_README, 'utf8');
  }
}

function applyEnvLayout(databaseDir: string, databasePath: string, workspaceDir: string): void {
  if (!process.env.SHOREKEEPER_DB_DIR) {
    process.env.SHOREKEEPER_DB_DIR = databaseDir;
  }
  if (!process.env.SHOREKEEPER_DB_PATH) {
    process.env.SHOREKEEPER_DB_PATH = databasePath;
  }
  if (!process.env.SHOREKEEPER_WORKSPACE_DIR) {
    process.env.SHOREKEEPER_WORKSPACE_DIR = workspaceDir;
  }
}

function mkdirAll(dirs: string[]): void {
  for (const dir of dirs) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * 首次启动时创建 D:\\SQLlite 与 workspace；若无 D 盘或权限不足则回退到 userData。
 * 须在 initDatabase() 之前调用。
 */
export function bootstrapDataLayout(
  userDataFallback: string,
  options?: { primaryRoot?: string },
): DataLayoutBootstrapResult {
  const explicitRoot = process.env.SHOREKEEPER_DB_DIR?.trim();
  const primaryRoot =
    explicitRoot || options?.primaryRoot || path.join(userDataFallback, 'data');

  const primaryDbPath =
    process.env.SHOREKEEPER_DB_PATH?.trim() || path.join(primaryRoot, 'shorekeeper.db');
  const primaryWorkspace =
    process.env.SHOREKEEPER_WORKSPACE_DIR?.trim() || path.join(primaryRoot, 'workspace');

  const primaryDirs = uniqueDirs(path.dirname(primaryDbPath), primaryWorkspace);

  try {
    mkdirAll(primaryDirs);
    seedWorkspace(primaryWorkspace);
    applyEnvLayout(primaryRoot, primaryDbPath, primaryWorkspace);
    return {
      databaseDir: primaryRoot,
      databasePath: primaryDbPath,
      workspaceDir: primaryWorkspace,
      usedFallback: false,
    };
  } catch (err) {
    if (explicitRoot) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`无法在指定数据目录创建文件（${explicitRoot}）：${message}`);
    }

    const fallbackRoot = path.join(userDataFallback, 'data');
    const fallbackDbPath = path.join(fallbackRoot, 'shorekeeper.db');
    const fallbackWorkspace = path.join(fallbackRoot, 'workspace');
    const fallbackDirs = uniqueDirs(fallbackRoot, fallbackWorkspace);

    mkdirAll(fallbackDirs);
    seedWorkspace(fallbackWorkspace);

    process.env.SHOREKEEPER_DB_DIR = fallbackRoot;
    process.env.SHOREKEEPER_DB_PATH = fallbackDbPath;
    process.env.SHOREKEEPER_WORKSPACE_DIR = fallbackWorkspace;

    const reason = err instanceof Error ? err.message : String(err);
    return {
      databaseDir: fallbackRoot,
      databasePath: fallbackDbPath,
      workspaceDir: fallbackWorkspace,
      usedFallback: true,
      fallbackReason: reason,
    };
  }
}
