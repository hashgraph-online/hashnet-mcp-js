declare module 'better-sqlite3' {
  namespace Database {
    export type RunResult = Record<string, unknown> & { changes?: number };

    export interface Statement {
      run(...params: unknown[]): RunResult;
      all(...params: unknown[]): unknown[];
      get(...params: unknown[]): unknown;
    }

    export interface Database {
      pragma(value: string): unknown;
      prepare(sql: string): Statement;
    }
  }

  const Database: {
    new (filename: string, options?: Record<string, unknown>): Database.Database;
  };

  export default Database;
}
