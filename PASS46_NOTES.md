# Passes 4–6 notes

## JUDGMENT CALLS

- **Presence confidence configuration:** the event-role table is represented under `presence.projections`; changing a role confidence changes only newly projected intervals.
- **Point-event uncertainty:** dwell and transit windows expand the normalized date interval rather than replacing it. A year-precision record therefore remains year-uncertain plus its configured allowance.
- **No lifetime residence invention:** Pass 4 still persists only evidence-based presence. Birthplace-to-next-event and last-event-to-death interpolation remain deferred because they would create unsupported residence claims and excessive pair growth.
- **Decade-proximity discovery:** Pass 5 admits actual interval overlaps plus evidence anchors whose nearest endpoints are at most `temporal_candidate_window_days` apart. The default is 3,653 days. Same and adjacent decade buckets keep this bounded without scanning every person pair.
- **Honest temporal language:** `overlap` candidates retain an actual overlap duration. `near` candidates store zero overlap and a positive `temporal_gap_days`; explanations state the measured gap rather than claiming simultaneous presence.
- **Temporal ranking:** overlap duration or event gap produces `s_temporal_proximity`; date precision produces `s_date_precision`; their product remains `s_temporal`. Events within 366 days receive full proximity, followed by linear decay to the configured ten-year floor.
- **Person-pair consolidation:** after suppression and threshold scoring, only the highest-scoring evidence pair survives for each unordered pair of people. Additional evidence rows are logged as `duplicate_pair` with the retained candidate ID.
- **Locality diversity:** review selection caps each normalized locality pair at `max_candidates_per_locality`, default 10. Excess rows are logged as `locality_limit`. This does not claim population knowledge or change a candidate's score; it prevents large-city evidence from crowding smaller localities out of the review set.
- **Review depth:** the default score threshold is 0.15 and the deterministic global review cap remains 500. Pair consolidation and locality diversity happen before the global cap.
- **Marriage parents:** a family marriage projects both spouses at subject confidence and the known parents of each spouse at parent confidence. Remove the `parents` value from the `MARR` projection if that is too speculative.
- **Spouse projection:** RESI and CENS project known spouses because the semantic specification assigns spouse confidence. Direct spouse pairs and same-event household projections are suppressed.
- **Spatial blocking:** Pass 5 uses deterministic latitude/longitude cells sized from configured place radii and compares adjacent cells and same/adjacent decades. It does not require a geohash dependency.
- **Kinship timing:** Pass 5 computes and memoizes kinship only after temporal and distance checks pass, but Pass 6 remains the sole owner of the ordered suppression policy.
- **Pair precision:** `s_precision` uses the worse of the two place tiers. Geocode confidence uses the geometric mean, preserving symmetry and collapsing when either endpoint is zero.
- **Candidate cap:** threshold suppression happens before deterministic score sorting. Rows beyond `max_candidates` are logged as `below_limit` rather than silently discarded.

## SCHEMA CHANGES

- `candidate_pairs.temporal_relation`: `overlap` or `near`.
- `candidate_pairs.temporal_gap_days`: zero for overlap; positive endpoint-to-endpoint gap for near-event evidence.
- `scored_candidates.s_temporal_proximity`: duration/gap contribution before date precision.
- `scored_candidates.s_date_precision`: independent precision contribution.
- Schema version `0.2.0` added these columns in place. Engine version `0.2.1` adds pair consolidation and locality-diverse review selection without another schema change.

## SCHEMA GAPS

- `events.source_count` does not identify sources, so independence cannot distinguish two events citing the same source document.
- There is no household or census-enumeration identifier; same-line matching is the conservative available proxy.
- `candidate_pairs` cannot store the blocking bucket or early-rejection audit details.
- `suppression_log` has no `candidate_id`; candidate IDs are retained in `detail`.
- `presence_intervals` does not store date precision or geocode confidence, so Pass 6 joins back through events, event dates, and places.
- Timing is report-only because the schema has no pass-run table.
