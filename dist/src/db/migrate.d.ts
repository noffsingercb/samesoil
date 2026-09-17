import type { StorageAdapter } from "../core/adapters.js";
export declare function migrate(storage: StorageAdapter, schemaSql: string): void;
export declare function rebuildDerived(storage: StorageAdapter, schemaSql: string): void;
