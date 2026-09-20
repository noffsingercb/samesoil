# Pass 3 notes

## STRATEGY
Pass 3 builds the complete sparse edge graph but does not materialize an all-pairs distance matrix. `createKinshipService` resolves only pairs requested after candidate blocking, memoizes them for the process, and upserts every queried result into `kinship_distance`. The standalone `kinship` command rebuilds edges and clears stale distances.

## SEMANTICS
- **Half-siblings:** one shared biological parent gives `blood_degree = 2` and the label `half-siblings`.
- **Step-relations:** spouse edges affect `graph_degree`, never `blood_degree`.
- **Adoption:** adopted, foster, and sealed links use semantic weights 2, 3, and 4; they are social graph edges, not blood edges.
- **Pedigree collapse and cousin marriage:** shortest degree wins; equal shortest paths are counted and exposed by `hasMultipleBloodPaths`.
- **Duplicate records:** remain separate nodes; matching names or dates never imply identity.
- **Disconnected subgraphs:** both degrees and `mrca_id` remain `NULL`; the label is `no known relationship`.

## SCHEMA GAPS
- `kinship_distance` has no multiplicity column, so multiplicity is available in `KinshipAnalysis` but cannot be persisted without changing DDL.
- `kinship_edges.edge_type` cannot distinguish biological/adopted/foster/sealed links; semantic weights preserve one relation kind, but the primary key cannot store two kinds between the same ordered pair.
- Persisting every reachable pair conflicts with the prohibition on a full pair matrix. The implementation uses the explicitly permitted on-demand memoization strategy.

No DDL changed and no dependency was added.
