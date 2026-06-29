declare module 'sql.js' {
  export interface SqlJsStatic {
    Database: new (data?: ArrayLike<number> | Buffer | null) => SqlJsDatabase;
  }

  export interface SqlJsDatabase {
    run(sql: string, params?: unknown): void;
    prepare(sql: string): SqlJsStatement;
    export(): Uint8Array;
    close(): void;
  }

  export interface SqlJsStatement {
    bind(params?: unknown): boolean;
    step(): boolean;
    getAsObject(): Record<string, unknown>;
    free(): void;
  }

  export interface InitSqlJsConfig {
    locateFile?: (file: string) => string;
  }

  export default function initSqlJs(config?: InitSqlJsConfig): Promise<SqlJsStatic>;
}
