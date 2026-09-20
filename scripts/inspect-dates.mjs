import Database from "better-sqlite3";

const dbPath = process.argv[2] ?? "tree.sqlite";
const db = new Database(dbPath, { readonly: true });

try {
  console.log("\nROW COUNTS");
  console.table(db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM raw_records) AS raw_records,
      (SELECT COUNT(*) FROM individuals) AS individuals,
      (SELECT COUNT(*) FROM families) AS families,
      (SELECT COUNT(*) FROM events) AS events,
      (SELECT COUNT(*) FROM event_dates) AS normalized_dates
  `).all());

  console.log("\nNORMALIZED DATE SAMPLE");
  console.table(db.prepare(`
    SELECT
      i.name_full,
      e.event_type,
      e.date_raw,
      d.date_start,
      d.date_end,
      d.precision,
      d.qualifier,
      d.parse_status
    FROM event_dates d
    JOIN events e ON e.id = d.event_id
    LEFT JOIN individuals i
      ON e.subject_type = 'individual'
     AND i.id = e.subject_id
    ORDER BY e.id
    LIMIT 30
  `).all());

  console.log("\nNON-EMPTY UNPARSED DATES");
  console.table(db.prepare(`
    SELECT e.date_raw, COUNT(*) AS occurrences
    FROM events e
    LEFT JOIN event_dates d ON d.event_id = e.id
    WHERE d.event_id IS NULL
      AND e.date_raw IS NOT NULL
      AND TRIM(e.date_raw) <> ''
    GROUP BY e.date_raw
    ORDER BY occurrences DESC, e.date_raw
    LIMIT 50
  `).all());

  const violations = db.prepare(`
    SELECT
      i.name_full,
      e.event_type,
      e.date_raw,
      d.date_start,
      d.date_end,
      i.birth_start,
      i.death_end
    FROM event_dates d
    JOIN events e ON e.id = d.event_id
    JOIN individuals i
      ON e.subject_type = 'individual'
     AND i.id = e.subject_id
    WHERE (d.qualifier LIKE '%BEF%' OR d.qualifier LIKE '%AFT%')
      AND (
        (i.birth_start IS NOT NULL AND d.date_start < i.birth_start)
        OR
        (i.death_end IS NOT NULL AND d.date_end > i.death_end)
      )
    ORDER BY e.id
  `).all();

  console.log("\nBEF/AFT LIFESPAN VIOLATIONS:", violations.length);
  console.table(violations);
} finally {
  db.close();
}
