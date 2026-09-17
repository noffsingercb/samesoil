import type { StorageAdapter } from "../core/adapters.js";
const SCHEMA_VERSION = "0.1.0";
const TABLES = ["scored_candidates","suppression_log","candidate_pairs","presence_intervals","kinship_distance","kinship_edges","event_dates","events","family_children","families","individuals","raw_records","places","geocode_cache"] as const;
export function migrate(storage: StorageAdapter, schemaSql: string): void {
  storage.applySchema("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);");
  const current = storage.get<{ readonly value: string }>("SELECT value FROM meta WHERE key = ?", ["schema_version"]);
  if (current?.value === SCHEMA_VERSION) return;
  storage.transaction((): void => {
    storage.applySchema(schemaSql);
    storage.run("INSERT INTO meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", ["schema_version", SCHEMA_VERSION]);
  });
}
export function rebuildDerived(storage: StorageAdapter, schemaSql: string): void {
  storage.applySchema("PRAGMA foreign_keys = OFF;");
  try {
    storage.transaction((): void => {
      storage.applySchema("CREATE TEMP TABLE keep_geocode_cache AS SELECT * FROM geocode_cache;");
      storage.applySchema("CREATE TEMP TABLE keep_places AS SELECT * FROM places WHERE review_status IN ('confirmed', 'corrected');");
      for (const table of TABLES) storage.applySchema(`DROP TABLE IF EXISTS ${table};`);
      storage.applySchema(schemaSql);
      storage.applySchema("INSERT INTO geocode_cache SELECT * FROM keep_geocode_cache;");
      storage.applySchema("INSERT INTO places SELECT * FROM keep_places;");
      storage.applySchema("DROP TABLE keep_geocode_cache; DROP TABLE keep_places;");
    });
  } finally {
    storage.applySchema("PRAGMA foreign_keys = ON;");
  }
}
