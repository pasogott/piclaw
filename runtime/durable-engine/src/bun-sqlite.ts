import { Database } from "bun:sqlite";
import { AsyncLocalStorage } from "node:async_hooks";
import type { SqliteDatabase, SqliteExecutor, SqliteValue } from "@earendil-works/pi-durable/storage/sqlite";

/** Inactive host bridge. The host must acquire ownership BEFORE construction. */
export class BunSqliteDatabase implements SqliteDatabase {
  private readonly db: Database;
  private readonly callback = new AsyncLocalStorage<boolean>();
  private tail: Promise<unknown> = Promise.resolve();
  private closing?: Promise<void>;
  private failure?: Error;

  constructor(path: string) {
    this.db = new Database(path, { create: true, strict: true });
  }

  private enqueue<T>(operation: () => T | Promise<T>): Promise<T> {
    if (this.callback.getStore()) return Promise.reject(new Error("Use the transaction handle inside its callback"));
    if (this.closing) return Promise.reject(new Error("SQLite database is closed"));
    const result = this.tail.then(() => {
      if (this.failure) throw this.failure;
      return operation();
    });
    this.tail = result.catch(() => {}); // A rejected operation must not strand later admissions.
    return result;
  }

  private executor(valid: () => void): SqliteExecutor {
    return {
      exec: async sql => { valid(); this.db.exec(sql); },
      run: async (sql, ...params) => { valid(); this.db.query(sql).run(...params); },
      get: async <T extends object>(sql: string, ...params: SqliteValue[]) => {
        valid(); return (this.db.query(sql).get(...params) ?? undefined) as T | undefined;
      },
      all: async <T extends object>(sql: string, ...params: SqliteValue[]) => {
        valid(); return this.db.query(sql).all(...params) as T[];
      },
    };
  }

  exec(sql: string): Promise<void> {
    return this.enqueue(() => this.executor(() => {}).exec(sql));
  }
  run(sql: string, ...params: SqliteValue[]): Promise<void> {
    return this.enqueue(() => this.executor(() => {}).run(sql, ...params));
  }
  get<T extends object>(sql: string, ...params: SqliteValue[]): Promise<T | undefined> {
    return this.enqueue(() => this.executor(() => {}).get<T>(sql, ...params));
  }
  all<T extends object>(sql: string, ...params: SqliteValue[]): Promise<T[]> {
    return this.enqueue(() => this.executor(() => {}).all<T>(sql, ...params));
  }

  transaction<T>(callback: (tx: SqliteExecutor) => Promise<T>): Promise<T> {
    return this.enqueue(async () => {
      this.db.exec("BEGIN");
      let active = true;
      const tx = this.executor(() => {
        if (!active) throw new Error("SQLite transaction handle expired");
      });
      try {
        let value: T;
        try { value = await this.callback.run(true, () => callback(tx)); }
        finally { active = false; }
        this.db.exec("COMMIT");
        return value;
      } catch (error) {
        // Explicit SQL, never Bun's synchronous transaction(callback) helper.
        try { this.db.exec("ROLLBACK"); }
        catch (rollbackError) {
          this.failure = new AggregateError([error, rollbackError], "SQLite rollback failed; database unusable until close");
          throw this.failure;
        }
        throw error;
      }
    });
  }

  close(): Promise<void> {
    if (this.callback.getStore()) return Promise.reject(new Error("Use the transaction handle inside its callback"));
    // Seal now, close only after all admitted operations settle, including failures.
    return this.closing ??= this.tail.then(() => { this.db.close(); });
  }
}
