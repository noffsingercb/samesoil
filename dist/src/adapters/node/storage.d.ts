import type { RunResult, SqlParameters, SqlRow, StorageAdapter } from "../../core/adapters.js";
export declare class NodeStorageAdapter implements StorageAdapter {
    #private;
    constructor(path: string);
    run(sql: string, parameters?: SqlParameters): RunResult;
    get<T extends SqlRow>(sql: string, parameters?: SqlParameters): T | undefined;
    all<T extends SqlRow>(sql: string, parameters?: SqlParameters): ReadonlyArray<T>;
    transaction<T>(work: () => T): T;
    applySchema(sql: string): void;
    close(): void;
}
