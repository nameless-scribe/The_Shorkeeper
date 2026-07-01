let dbReady = false;
let dbInitError: string | null = null;

export function setDatabaseReady(ready: boolean, error?: string): void {
  dbReady = ready;
  dbInitError = error ?? null;
}

export function isDatabaseReady(): boolean {
  return dbReady;
}

export function getDatabaseInitError(): string | null {
  return dbInitError;
}

export function assertDatabaseReady(): void {
  if (!dbReady) {
    throw new Error(dbInitError ?? '数据库未就绪');
  }
}
