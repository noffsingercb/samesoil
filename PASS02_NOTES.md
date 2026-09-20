# Pass 2 notes

## Human review decision: place scope

The real-tree review established that broad geographic co-occurrence is not sufficiently interesting by itself. A pair of people both associated only with England, a country, or a large region must not become a strong encounter candidate.

- `locality` (city, town, village, or equivalent) is the preferred matching tier.
- `district` (county, parish, or equivalent) may remain eligible, but downstream precision scoring must keep it structurally below an otherwise equal locality match.
- `region` and `country` are coarse places and should be suppressed by default rather than treated as meaningful proximity.
- The existing default `min_tier: "district"` already routes resolved region- and country-level places to review as `coarse_place` while retaining district rows for lower-strength consideration.
- Passes 5 and 6 must preserve monotonicity: with all other factors equal, a coarser tier can never outscore a finer tier.
- Inputs with empty comma components, such as `,,,France` or `, Wayne, IL, USA`, are normalized by dropping empty components before lookup while preserving the original `place_raw` evidence.

## Acceptance evidence

- Purity and both TypeScript builds passed.
- Test suite: 60 passed, 0 failed.
- Warm-cache regression proves zero provider calls when a cached response exists.
- Corrected-place regression proves human corrections survive reruns byte-for-byte.
- Real tree: 5,192 unique place strings processed in approximately 32.67 seconds.
- Cold cache: 5,192 unresolved rows, as expected for the cache-only CLI.
- `review_queue.csv` contained 5,192 impact-sorted rows and was byte-deterministic across reruns.

## Schema and config gaps

- `radius_km_by_tier` has no `unknown` entry. Unresolved places therefore persist `radius_km = NULL`; the pass never substitutes a provider radius.
- There is no dedicated qualifier-confidence multiplier. To satisfy the required confidence reduction without inventing a config key, the qualifier penalty uses `confidence * (1 - min_geocode_conf)`. A future spec revision should give this policy its own key.
- There is no geocoder endpoint, user-agent, or rate-limit configuration. The HTTP adapter isolates endpoint construction and applies no delay. It is not selected by the CLI; the CLI remains cache-only until configuration is specified.
- The schema has no column recording the stripped qualifier. It affects confidence during the pass but is not persisted separately.
- The schema has no historical-boundary flag. The pass report records the caveat that modern geocoding does not reconstruct historical boundaries.
- The Node artifact sink uses platform-aware path containment so `review_queue.csv` can be written safely on Windows.

No DDL was changed.
