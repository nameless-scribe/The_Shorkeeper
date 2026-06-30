import fs from 'node:fs';
import path from 'node:path';

export interface DbRuntimeContext {
  isPackaged: boolean;
  appPath: string;
  resourcesPath: string;
}

let runtime: DbRuntimeContext | null = null;

export function configureDbRuntime(context: DbRuntimeContext): void {
  runtime = context;
}

export function resolveSqlWasmPath(file = 'sql-wasm.wasm'): string {
  if (runtime?.isPackaged) {
    const inResources = path.join(runtime.resourcesPath, 'sql.js', file);
    if (fs.existsSync(inResources)) return inResources;

    const inApp = path.join(runtime.appPath, 'sql.js', file);
    if (fs.existsSync(inApp)) return inApp;
  }

  return path.join(process.cwd(), 'node_modules', 'sql.js', 'dist', file);
}

export function resolveMigrationsDir(): string {
  if (runtime?.isPackaged) {
    const inResources = path.join(runtime.resourcesPath, 'db-migrations');
    if (fs.existsSync(inResources)) return inResources;

    const inApp = path.join(runtime.appPath, 'src', 'db', 'migrations');
    if (fs.existsSync(inApp)) return inApp;
  }

  return path.join(process.cwd(), 'src', 'db', 'migrations');
}
