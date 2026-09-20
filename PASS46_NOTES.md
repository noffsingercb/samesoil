# Passes 4–6 notes

## JUDGMENT CALLS

- **Presence confidence configuration:** §6.3 says every confidence is configuration, while the existing config only exposed duration and minimum confidence. The normative event-role table is now represented under `presence.projections`; changing a role confidence changes only newly projected intervals.
- **Point-event uncertainty:** dwell and transit windows expand the normalized date interval rather than replacing it. A year-precision transit record therefore remains year-uncertain plus the transit allowance; shrinking it to fourteen days would invent a date.
- **Marriage parents:** a family marriage projects both spouses at subject confidence and the known parents of each spouse at parent confidence. If that is too speculative, remove the `parents` value from the `MARR` projection.
- **Spouse projection:** RESI and CENS project known spouses because §6.3 explicitly assigns spouse confidence. Multiple or former spouses may be projected; Pass 6 suppresses direct spouse pairs, and same-event household projections are suppressed first.
- **Spatial blocking:** Pass 5 uses deterministic latitude/longitude cells sized from configured place radii and compares adjacent cells and decades. It does not require a geohash dependency.
- **Kinship timing:** Pass 5 computes and memoizes kinship only after temporal and distance checks pass, but does not suppress there. Pass 6 remains the sole owner of the ordered suppression policy.
- **Temporal score:** because §7.3 requires both overlap reward and a one-day exact match to beat a decade-long vague overlap, temporal score combines a bounded overlap bonus with a dominant config-driven precision factor.
- **Pair precision:** `s_precision` uses the worse of the two tiers. Thus a coarse endpoint can never borrow the other endpoint's finer precision.
- **Geocode confidence pair:** §7.3 names one geocode confidence although a pair has two. The implementation uses their geometric mean, preserving symmetry and collapsing when either endpoint is zero.
- **Source independence:** the schema stores source counts but not source identities. Same event or same GEDCOM line is treated as the same source record; distinct records receive the configured independent value. True cross-source identity needs schema support.
- **Household identity:** exact shared event IDs are household evidence; separate census rows count as the same household only when they share a GEDCOM line and place. A household identifier would be more reliable.
- **Candidate cap:** threshold suppression happens before deterministic score sorting. Rows beyond `max_candidates` are logged as `below_limit` rather than silently discarded.

## SCHEMA GAPS

- `events.source_count` does not identify sources, so independence cannot distinguish two events citing the same source document.
- There is no household or census-enumeration identifier; same-line matching is the conservative available proxy.
- `candidate_pairs` cannot store the blocking bucket or early-rejection audit details.
- `suppression_log` has no `candidate_id`; candidate IDs are retained in `detail`.
- `presence_intervals` does not store date precision or geocode confidence, so Pass 6 joins back through events, event dates, and places.
- `scored_candidates` has no relationship-summary column; the deterministic summary is included in `explanation`.
- Timing is report-only because the normative schema has no pass-run table.
