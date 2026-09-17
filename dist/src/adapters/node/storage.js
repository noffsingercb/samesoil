import Database from "better-sqlite3";
export class NodeStorageAdapter {
    #database;
    constructor(path) {
        this.#database = new Database(path);
        this.#database.pragma("foreign_keys = ON");
    }
    run(sql, parameters = []) {
        const result = this.#database.prepare(sql).run(parameters);
        return { changes: result.changes, lastInsertRowid: result.lastInsertRowid };
    }
    get(sql, parameters = []) {
        return this.#database.prepare(sql).get(parameters);
    }
    all(sql, parameters = []) {
        return this.#database.prepare(sql).all(parameters);
    }
    transaction(work) {
        return this.#database.transaction(work)();
    }
    applySchema(sql) { this.#database.exec(sql); }
    close() { this.#database.close(); }
}
