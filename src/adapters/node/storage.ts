import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import Database from "better-sqlite3";
import type { RunResult, SqlParameters, SqlRow, StorageAdapter } from "../../core/adapters.js";

export class NodeStorageAdapter implements StorageAdapter {
  readonly #database: Database.Database;
  public constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(resolve(path)), { recursive: true });
    this.#database = new Database(path);
    this.#database.pragma("foreign_keys = ON");
  }
  public run(sql: string, parameters: SqlParameters = []): RunResult {
    const result = this.#database.prepare(sql).run(parameters);
    return { changes: result.changes, lastInsertRowid: result.lastInsertRowid };
  }
  public get<T extends SqlRow>(sql: string, parameters: SqlParameters = []): T | undefined {
    return this.#database.prepare(sql).get(parameters) as T | undefined;
  }
  public all<T extends SqlRow>(sql: string, parameters: SqlParameters = []): ReadonlyArray<T> {
    return this.#database.prepare(sql).all(parameters) as T[];
  }
  public transaction<T>(work: () => T): T {
    return this.#database.transaction(work)();
  }
  public applySchema(sql: string): void { this.#database.exec(sql); }
  public close(): void { this.#database.close(); }
}
