# Pass 7 notes — exports and the self-contained HTML report

## Scope

Implements `src/passes/export.ts` (previously a `NotImplemented` stub) and wires an `export` CLI subcommand in `src/cli.ts`. Produces five artifacts from already-scored, already-persisted state:

- `artifacts/candidates.csv`
- `artifacts/candidates.geojson`
- `artifacts/report.html`
- `artifacts/branch_intersections.md`
- `artifacts/review_queue.csv`

## What this pass reads

`scored_candidates`, `candidate_pairs`, `presence_intervals`, `events`, `places`, `individuals`, and the kinship graph (`kinship_edges`/`family_children` via the existing `loadKinshipGraph` helper). It writes only to the configured artifact sink and, through the reused `KinshipService`, an idempotent memoized upsert into `kinship_distance` — the same side effect `score.ts` already performs when it builds candidate explanations. It never writes to `scored_candidates`, `candidate_pairs`, or `places`, and never recomputes a score component.

## Ancestral branch (new display-only concept)

The normative schema has no "ancestral branch" column. For the colour key, the branch legend, and `branch_intersections.md`, each individual is assigned the label of a deterministic root ancestor: walk `KinshipGraph.biologicalParents` upward, always choosing the numerically smallest parent id at each generation, up to `config.kinship.bfs_max_depth` generations, and label the result by that root's surname and GEDCOM xref (or "Unlabeled branch" if no surname is recorded). This is presentation-only, fully derived from already-computed kinship data, and does not touch the schema or the scoring path.

## review_queue.csv sourcing

Pass 2 (`places.ts`) already writes a `review_queue.csv` computed from the resolution results seen during that run. Pass 7 regenerates the same file directly from the persisted `places` table (`review_status = 'auto'` rows only, so any place a human has already reviewed and marked otherwise is excluded), using the same `unresolved` / `low_conf` / `coarse_place` reasoning and the same occurrence/affected-individual counting query. This means `samesoil export` can be re-run standalone, after manual place review, without re-running `places`.

## Verification (after applying this branch)

```
npm ci
npm run check
node --import tsx src/cli.ts export --db <path-to-existing-db>.sqlite --verbose
```

`report.html` should open directly from disk with networking disabled and show the ranked list, the coordinate-plotted SVG map with uncertainty circles, the decade filter, the branch colour key, the evidence panel, and the persistent caveat banner.

## Schema gaps retained without DDL changes

- No `ancestral_branch` column exists anywhere in the schema; the export pass derives one for display only, as described above.
- `scored_candidates` and `candidate_pairs` have no cached place-label or individual-name columns, so this pass re-joins to `places` and `individuals` at export time rather than duplicating that data into the scoring tables.
