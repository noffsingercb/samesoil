> **Copyright © 2026 Ben Noffsinger. All rights reserved.**
>
> This repository is public, but it is **not** open source. No license is granted. You may view and
> fork it within GitHub's Terms of Service; you may not otherwise use, copy, modify, or redistribute
> it.
# Samesoil

Samesoil is a standalone, local-first CLI pipeline that reads one GEDCOM file and will produce ranked, explainable geo-temporal near-encounter candidates. The current implementation includes fault-tolerant GEDCOM ingestion and uncertainty-preserving date normalization. It has no server, hosted component, bundled dataset, or network dependency.

## Requirements

- Node.js 20 or newer
- Declared npm dependencies installed locally

## Install and verify

```sh
npm install
npm run check
```

## Initialize working state

```sh
npm run dev -- init --db ./tree.sqlite
```

Use a partial config override when needed:

```sh
npm run dev -- init --db ./tree.sqlite --config ./my-config.json --verbose
```

## Pass 0: ingest one GEDCOM file

```sh
npm run dev -- ingest --db ./tree.sqlite --gedcom ./tree.ged
```

The pass tolerates unknown tags and malformed lines, handles CONC/CONT, detects UTF-8, UTF-16, CP1252, and ANSEL, and populates raw records, people, families, child links, and events.

## Pass 1: normalize dates

```sh
npm run dev -- dates --db ./tree.sqlite
```

The pass creates inclusive uncertainty intervals and clamps every open BEF/AFT interval to known lifespan bounds or the configured fallback.

Run both implemented passes in sequence:

```sh
npm run dev -- all --db ./tree.sqlite --gedcom ./tree.ged
```

## Remaining pass commands

The remaining commands are retained as CLI placeholders for later subtasks:

```sh
npm run dev -- places --db ./tree.sqlite
npm run dev -- kinship --db ./tree.sqlite
npm run dev -- presence --db ./tree.sqlite
npm run dev -- candidates --db ./tree.sqlite
npm run dev -- score --db ./tree.sqlite
npm run dev -- export --db ./tree.sqlite
```

## Purity boundary

`src/core` and `src/passes` must remain independent of Node, browsers, networking, clocks, and randomness. Check the boundary with:

```sh
npm run check:purity
```

## Known schema limitations

See `PASS01_NOTES.md` for handled edge cases and schema gaps that were documented rather than resolved by changing the normative schema.
