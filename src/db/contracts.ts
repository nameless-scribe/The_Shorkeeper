export interface DatabaseStatement {
  all(...params: unknown[]): Record<string, unknown>[];
  get(...params: unknown[]): Record<string, unknown> | undefined;
  run(...params: unknown[]): void;
}

/** Minimum synchronous contract implemented by sql.js and native SQLite adapters. */
export interface AppDatabase {
  beginBatch(): void;
  endBatch(): void;
  transaction<T>(operation: () => T): T;
  exec(sql: string): void;
  prepare(sql: string): DatabaseStatement;
}

export interface ManagedDatabase extends AppDatabase {
  close(): void;
  closeAsync(): Promise<void>;
  supportsFts5(tokenizer?: 'unicode61' | 'trigram'): boolean;
}
