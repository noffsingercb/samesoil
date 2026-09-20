# Pass 2 notes

## Schema and config gaps

- `radius_km_by_tier` has no `unknown` entry. Unresolved places therefore persist `radius_km = NULL`; the pass never substitutes a provider radius.
- There is no dedicated qualifier-confidence multiplier. To satisfy the required confidence reduction without inventing a config key, the qualifier penalty uses `confidence * (1 - min_geocode_conf)`. A future spec revision should give this policy its own key.
- There is no geocoder endpoint, user-agent, or rate-limit configuration. The HTTP adapter isolates endpoint construction and applies no delay. It is not selected by the CLI; the CLI remains cache-only until configuration is specified.
- The schema has no column recording the stripped qualifier. It affects confidence during the pass but is not persisted separately.
- The schema has no historical-boundary flag. The pass report records the caveat that modern geocoding does not reconstruct historical boundaries.
- The Node artifact sink now uses platform-aware path containment so `review_queue.csv` can be written safely on Windows.

No DDL was changed.
