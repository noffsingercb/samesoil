# EDGE CASES HANDLED

- Exact day, month, year, ABT, CAL, EST, BEF, AFT, BET/AND, FROM/TO, and dual-year dates normalize to inclusive intervals.
- BEF/AFT intervals clamp to known lifespan bounds or the configured fallback and become `inferred` when fallback bounds are used.
- Unqualified pre-1752 dates widen by the configured day count without calendar conversion.
- Gregorian escapes parse normally; Julian escapes remain unconverted and are marked partial.
- French Republican and Hebrew escapes are rejected without conversion.
- Empty, free-text, malformed, impossible, overlong-year, reversed-range, and trailing-commentary dates are counted as unparsed.
- UTF-8, UTF-16, CP1252, and ANSEL are detected; ANSEL combining marks are reordered and normalized, and unmappable bytes become U+FFFD.
- LF, CRLF, CR, BOM, truncated files, unknown tags, malformed lines, deep nesting, CONC, and CONT are tolerated.
- Child links distinguish birth, adopted, foster, and sealed relationships.

# SCHEMA GAPS

- `raw_records` has no complete-source-line column. Every line is retained structurally, while malformed lines are retained verbatim in `value`; parsed rows cannot retain both parsed value and the full original line.
- `event_dates.date_start` and `date_end` are `NOT NULL`, so unparseable dates and unsupported calendars cannot persist a row with `parse_status='unparsed'` without fabricated dates. They are excluded and counted.
- There is no calendar-tag column. Supported escapes are retained in `qualifier`; unsupported calendar tags are reported but cannot be stored in `event_dates`.
