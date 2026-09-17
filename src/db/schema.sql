-- Pass 0: verbatim GEDCOM capture
CREATE TABLE raw_records (
  id            INTEGER PRIMARY KEY,
  gedcom_xref   TEXT NOT NULL,
  tag           TEXT NOT NULL,
  level         INTEGER NOT NULL,
  value         TEXT,
  parent_id     INTEGER REFERENCES raw_records(id),
  line_no       INTEGER NOT NULL
);

CREATE TABLE individuals (
  id            INTEGER PRIMARY KEY,
  gedcom_xref   TEXT NOT NULL UNIQUE,
  name_given    TEXT,
  name_surname  TEXT,
  name_full     TEXT,
  sex           TEXT,
  is_living     INTEGER NOT NULL DEFAULT 0,
  birth_start   TEXT,   -- ISO date, interval lower bound
  birth_end     TEXT,
  death_start   TEXT,
  death_end     TEXT,
  lifespan_src  TEXT    -- stated | inferred | unknown
);

CREATE TABLE families (
  id            INTEGER PRIMARY KEY,
  gedcom_xref   TEXT NOT NULL UNIQUE,
  husband_id    INTEGER REFERENCES individuals(id),
  wife_id       INTEGER REFERENCES individuals(id),
  marriage_start TEXT,
  marriage_end  TEXT
);

CREATE TABLE family_children (
  family_id     INTEGER NOT NULL REFERENCES families(id),
  child_id      INTEGER NOT NULL REFERENCES individuals(id),
  link_type     TEXT NOT NULL DEFAULT 'birth',  -- birth | adopted | foster | sealed
  PRIMARY KEY (family_id, child_id)
);

CREATE TABLE events (
  id            INTEGER PRIMARY KEY,
  subject_type  TEXT NOT NULL,          -- individual | family
  subject_id    INTEGER NOT NULL,
  event_type    TEXT NOT NULL,          -- BIRT CHR RESI CENS MARR DEAT BURI IMMI EMIG MILI OCCU PROB ...
  date_raw      TEXT,
  place_raw     TEXT,
  source_count  INTEGER NOT NULL DEFAULT 0,
  note          TEXT,
  line_no       INTEGER
);

-- Pass 1 output, stored on events
CREATE TABLE event_dates (
  event_id      INTEGER PRIMARY KEY REFERENCES events(id),
  date_start    TEXT NOT NULL,          -- ISO 8601, inclusive
  date_end      TEXT NOT NULL,          -- ISO 8601, inclusive
  precision     TEXT NOT NULL,          -- day | month | year | decade | range | inferred
  qualifier     TEXT,                   -- ABT CAL EST BEF AFT BET FROM TO
  parse_status  TEXT NOT NULL           -- ok | partial | unparsed
);

-- Pass 2
CREATE TABLE places (
  id                INTEGER PRIMARY KEY,
  place_raw         TEXT NOT NULL UNIQUE,
  place_normalized  TEXT,
  lat               REAL,
  lon               REAL,
  radius_km         REAL,
  precision_tier    TEXT,               -- address | locality | district | region | country | unknown
  admin1            TEXT,
  admin2            TEXT,
  country           TEXT,
  geocode_source    TEXT,
  geocode_conf      REAL,               -- 0.0 - 1.0
  review_status     TEXT NOT NULL DEFAULT 'auto'  -- auto | confirmed | corrected | rejected
);

CREATE TABLE geocode_cache (
  query_hash    TEXT PRIMARY KEY,
  query_text    TEXT NOT NULL,
  response_json TEXT NOT NULL,
  fetched_at    TEXT NOT NULL
);

-- Pass 3
CREATE TABLE kinship_edges (
  from_id       INTEGER NOT NULL REFERENCES individuals(id),
  to_id         INTEGER NOT NULL REFERENCES individuals(id),
  edge_type     TEXT NOT NULL,          -- parent | child | spouse
  weight        REAL NOT NULL,
  PRIMARY KEY (from_id, to_id, edge_type)
);

CREATE TABLE kinship_distance (
  a_id          INTEGER NOT NULL REFERENCES individuals(id),
  b_id          INTEGER NOT NULL REFERENCES individuals(id),
  blood_degree  INTEGER,                -- NULL when no consanguineous path within cutoff
  graph_degree  INTEGER,                -- includes marriage edges
  mrca_id       INTEGER REFERENCES individuals(id),
  same_branch   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (a_id, b_id)
);

-- Pass 4
CREATE TABLE presence_intervals (
  id              INTEGER PRIMARY KEY,
  individual_id   INTEGER NOT NULL REFERENCES individuals(id),
  event_id        INTEGER NOT NULL REFERENCES events(id),
  place_id        INTEGER NOT NULL REFERENCES places(id),
  date_start      TEXT NOT NULL,
  date_end        TEXT NOT NULL,
  role            TEXT NOT NULL,        -- subject | spouse | parent | child | officiant | resident
  presence_conf   REAL NOT NULL,        -- 0.0 - 1.0
  precision_tier  TEXT NOT NULL,
  radius_km       REAL NOT NULL
);

-- Pass 5 / 6
CREATE TABLE candidate_pairs (
  id              INTEGER PRIMARY KEY,
  a_interval_id   INTEGER NOT NULL REFERENCES presence_intervals(id),
  b_interval_id   INTEGER NOT NULL REFERENCES presence_intervals(id),
  a_id            INTEGER NOT NULL REFERENCES individuals(id),
  b_id            INTEGER NOT NULL REFERENCES individuals(id),
  overlap_start   TEXT NOT NULL,
  overlap_end     TEXT NOT NULL,
  overlap_days    INTEGER NOT NULL,
  distance_km     REAL NOT NULL,
  combined_radius REAL NOT NULL
);

CREATE TABLE scored_candidates (
  candidate_id    INTEGER PRIMARY KEY REFERENCES candidate_pairs(id),
  score           REAL NOT NULL,
  s_proximity     REAL NOT NULL,
  s_temporal      REAL NOT NULL,
  s_precision     REAL NOT NULL,
  s_confidence    REAL NOT NULL,
  s_unrelatedness REAL NOT NULL,
  s_independence  REAL NOT NULL,
  explanation     TEXT NOT NULL,
  config_hash     TEXT NOT NULL,
  engine_version  TEXT NOT NULL
);

CREATE TABLE suppression_log (
  id              INTEGER PRIMARY KEY,
  a_id            INTEGER NOT NULL,
  b_id            INTEGER NOT NULL,
  reason          TEXT NOT NULL,        -- close_kin | same_household | coarse_place | low_conf | living | below_threshold
  detail          TEXT
);

CREATE INDEX idx_presence_time  ON presence_intervals(date_start, date_end);
CREATE INDEX idx_presence_place ON presence_intervals(place_id);
CREATE INDEX idx_presence_pers  ON presence_intervals(individual_id);
