> **Copyright © 2026 Ben Noffsinger. All rights reserved.**
>
> This repository is public, but it is **not** open source. No license is granted. You may view and
> fork it within GitHub's Terms of Service; you may not otherwise use, copy, modify, or redistribute
> it.
# Samesoil

Samesoil is a standalone, local-first CLI pipeline that reads one GEDCOM file and will produce ranked, explainable geo-temporal near-encounter candidates. Phase 0 contains platform-neutral contracts, the Node adapters, the exact working schema, configuration validation, and pass stubs. It does not implement pipeline logic.

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

## Pass commands

Each command accepts `--db`, `--config`, and `--verbose`. In Phase 0, commands only validate wiring and print the command, resolved database path, and config hash; `init` also applies the schema.

```sh
npm run dev -- ingest --db ./tree.sqlite
npm run dev -- dates --db ./tree.sqlite
npm run dev -- places --db ./tree.sqlite
npm run dev -- kinship --db ./tree.sqlite
npm run dev -- presence --db ./tree.sqlite
npm run dev -- candidates --db ./tree.sqlite
npm run dev -- score --db ./tree.sqlite
npm run dev -- export --db ./tree.sqlite
npm run dev -- all --db ./tree.sqlite
```

## Purity boundary

`src/core` and `src/passes` must remain independent of Node, browsers, networking, clocks, and randomness. Check the boundary with:

```sh
npm run check:purity
```

