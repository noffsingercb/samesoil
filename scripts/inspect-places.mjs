import Database from "better-sqlite3";

const dbPath = process.argv[2] ?? "tree.sqlite";
const db = new Database(dbPath, { readonly: true });

try {
  console.log("\nPLACE SUMMARY");
  console.table(db.prepare(`
    SELECT
      COUNT(*) AS total_places,
      SUM(CASE WHEN lat IS NOT NULL AND lon IS NOT NULL THEN 1 ELSE 0 END) AS geocoded_places,
      SUM(CASE WHEN precision_tier = 'unknown' OR lat IS NULL OR lon IS NULL THEN 1 ELSE 0 END) AS unresolved_places,
      SUM(CASE WHEN review_status IN ('confirmed', 'corrected') THEN 1 ELSE 0 END) AS human_reviewed_places,
      (SELECT COUNT(*) FROM geocode_cache) AS cache_entries
    FROM places
  `).all());

  console.log("\nPRECISION TIERS");
  console.table(db.prepare(`
    SELECT COALESCE(precision_tier, '(null)') AS precision_tier, COUNT(*) AS places
    FROM places
    GROUP BY precision_tier
    ORDER BY places DESC, precision_tier
  `).all());

  console.log("\nREVIEW STATUS");
  console.table(db.prepare(`
    SELECT review_status, COUNT(*) AS places
    FROM places
    GROUP BY review_status
    ORDER BY places DESC, review_status
  `).all());

  console.log("\nLOWEST-CONFIDENCE RESOLVED PLACES");
  console.table(db.prepare(`
    SELECT place_raw, place_normalized, precision_tier, geocode_conf, radius_km
    FROM places
    WHERE lat IS NOT NULL AND lon IS NOT NULL
    ORDER BY geocode_conf, place_raw COLLATE BINARY
    LIMIT 30
  `).all());
} finally {
  db.close();
}
