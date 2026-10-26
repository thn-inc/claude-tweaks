---
name: test-impact-tracer-read-shape
description: Use when changing `tools/test-impact/tracer.js` — teaching it a new read shape (a require resolution rule, a child-process wrapper such as `xargs` or `timeout`, a way a node child loses the trace) or cutting what it records — and writing the fixtures and assertions in `tests/test-impact-tracer.test.js` that prove it. Covers the record kinds and the over-record-never-under-record rule, one fixture file per mechanism that yields an identical record, single-mechanism mutants, negatives the old tracer fails, measuring candidate volume, and BSD-vs-GNU tool gaps in fixtures. Keywords - test-impact, tracer, read tracer, impact map, fixture, c '', fail closed, resolution candidates, env wrapper, sh -c, mutant, NODE_OPTIONS.
---

# Test-impact tracer: adding a read shape

## Overview

`tools/test-impact/tracer.js` is a `--require` preload that records which repo paths each test file reads; `node tools/test-impact.js trace` folds the records into the map that `plugin/bin/lib/verify/impact.js` selects tests from. A read the tracer misses under-selects: a change to that file skips a test that reads it, and only CI's full suite catches it. #4024 built the tracer, #4158 made a failed trace write fail closed, and #4133 taught it Node's resolution and the shell/env wrappers. `plugin/skills/test/impact-selection.md`'s Known limits lists the shapes still approximated (`xargs`, `timeout`, `nice`, a mid-script `export NODE_OPTIONS=`, `#` imports). This skill is the method #4133's review converged on, so the next shape lands in one pass.

## Key Patterns

### Know the four kinds and which way each error falls

The header comment of `tracer.js` is the canonical kinds list: `f` content read, `s` existence probe, `d` directory listing, `c` content prefix (`''` is the whole repo). `impact.js`'s `reads()` selects a test for a path equal to or under an `f`/`s` entry, or under a `d`/`c` prefix. An extra record costs map size and some over-selection; a missing one silently under-selects. When the tracer cannot know what a process reads, it records `c ''`, which selects the test for every change: a node child whose env lost the trace (`recordCommand`'s `stripped` flag, set by `envCommand` for `-i`, `-u NODE_OPTIONS`, `--unset=` and `-uNODE_OPTIONS`, or by a `NODE_OPTIONS=`/`CT_TRACE_*=` assignment), and a patch that cannot be installed (`failClosed`). An option the tracer does not know falls back to recording the path arguments generically (`envCommand` returns `null`), never to recording nothing.

### Cut records only where a rule impact.js already applies covers them

#4133 cut `s` records from 135,709 to 31,033 over 985 tests by keeping only the resolution candidates up to the winner and dropping an `s` nested under an earlier kept `s` (the `Module._resolveFilename` patch). The comment beside that patch carries the justification: a candidate after the winner cannot change the result while the winner exists, and a nested `s` is covered by `reads()`' ancestor rule. `f` entries are never dropped, because a `package.json`'s content changes resolution. Measure the volume before and after with a traced full suite (`node tools/test-impact.js trace` at the base and at the tip) and record both numbers in the plan.

### One fixture file per mechanism that produces an identical record

Records are unioned per test file, so two mechanisms that both emit `c ''` in one fixture cannot show that either one alone is recognised: delete one and the other still passes the assertion. `i.fixture.js` (`env -i`), `j` (`env -u NODE_OPTIONS`), `k` (`--unset=`), `l` (`-uNODE_OPTIONS`) and `m` (a `NODE_OPTIONS=` assignment) each hold one way of losing the trace for that reason, and `h.fixture.js` gives every wrapped git call its own cwd so its `c` records differ. A new fixture is `tests/fixtures/test-impact/{x}.fixture.js` (`copyFixture` renames it to `.test.js` in the temp root) and must be added to `TEST_FILES`.

### Prove each assertion with a single-mechanism mutant, and pin with a negative the old tracer fails

A positive assertion the old tracer already satisfies proves nothing: `s lib/x.js` is recorded through Node's own `realpathSync` of the resolved file whether or not the `paths` option is followed, so the `paths` mechanism is pinned by `!s x` and `!s x.js` instead. For each new rule, disable that rule alone in a copy of the tracer and confirm its assertion goes red. Where no fixture can tell the rule from the generic fallback (`--rcfile` records the same `f` either way), record that in the ledger rather than adding a row that cannot fail.

### Fixtures spawn tools whose options differ by platform

macOS's BSD `env` has no `-C`, `--chdir` or `--unset=`, so `h.fixture.js` and `k.fixture.js` spawn those shapes with `spawnSync` and ignore the status: the tracer records the command before the spawn, so the record exists whether or not the tool accepted it. Use `execFileSync`, which throws on a failed command, only for a shape every developer and CI platform runs. Every fixture test that spawns `bash`, `sh` or `env` skips on win32 with a stated reason (`'win32: no bash/sh/env'`), and so does the assertion test that reads it; tracing itself is POSIX-only (Known limits).

## Decision Framework

| The new shape | Do |
|---|---|
| A wrapper that runs another command (`env`, `sh -c`, a new one) | Read it in `recordCommand` as the command it runs; an option it does not know returns `null` so the generic recording applies |
| A way a node child loses `NODE_OPTIONS` or `CT_TRACE_*` | Set `stripped` so it records `c ''`, and give it its own fixture file |
| A resolution rule | Add its candidates to `resolutionCandidates` in the order Node probes them, so the cut at the winner stays correct |
| A record you want to drop | Name the `impact.js` rule that already covers it, and measure the volume change |
| A shape you will not handle | Add it to `impact-selection.md`'s Known limits in the same change |

## Project Conventions

- `impact-selection.md`'s kinds table and Known limits change in the same commit as the tracer, and `docs/journeys/verify-only-the-tests-a-change-can-affect-4024.md` when a user-visible limit moves.
- Fixture `node_modules` packages are written by the test's `before()` into the temp root, never committed (`.gitignore` ignores `node_modules/`).
- Node-version-dependent behavior (Node 22 counts the exact request `.` as relative, Node 20 does not) is pinned through the tracer's records only, never through the resolution result; CI runs Node 20.
- A map traced with `trace --allow-dirty` on a tree with tracked changes records `dirty: true`, and `verify.js` refuses it as `map-dirty` (#4131); use that command to inspect the traced volume, never to build a map you expect to select tests. Untracked files never make a tree dirty.
- A new optional map key stays under `version: 1`: `parseImpactMap` ignores keys it does not know, and `tests/fixtures/test-impact/parse-impact-map-v1.js` is the frozen pre-`dirty` reader that proves an older reader still parses the new map.
- A rule that makes `impact.js` refuse a cached map needs a matching "not current, replace it" rule in `tools/test-impact.js`'s `fetch`, or `fetch` skips the download as "already current" and the refusal can never heal (#4131: `fetch` replaces a cached dirty map and refuses a dirty artifact).

## Common Operations

```bash
node --test tests/test-impact-tracer.test.js    # runs every fixture once under the tracer, then asserts per test file
node tools/test-impact.js trace --allow-dirty   # traced full suite; prints test files, paths and map bytes
```

## Anti-Patterns

| Pattern | Why It Fails in This Project |
|---------|------------------------------|
| Two mechanisms that emit the same record in one fixture file | The per-file union hides a regression in either one (#4133's `i.fixture.js` first held both `env -i` and the `NODE_OPTIONS=` assignment) |
| A positive assertion the old tracer already passes | It stays green with the new rule deleted (`s lib/x.js` under the `paths` option) |
| Recording nothing for an option or wrapper the tracer does not parse | Silent under-selection; fall back to the generic path-argument recording |
| `execFileSync` of a GNU-only option in a fixture | It throws on macOS and fails the test though the tracer recorded correctly |
| Dropping a record because it looks redundant | Unless an `impact.js` rule covers it, a change to that path stops selecting the test |

## Reference

- `tools/test-impact/tracer.js` (header comment, the `Module._resolveFilename` patch, `envCommand`, `shellScript`, `recordCommand`)
- `plugin/bin/lib/verify/impact.js` (`reads()`), `tools/test-impact.js`, `tools/test-impact/build-map.js`
- `tests/test-impact-tracer.test.js`, `tests/fixtures/test-impact/`
- `plugin/skills/test/impact-selection.md` (kinds table, Known limits)
- Related skills: `verify-scope-rule-kind` (the declaration side of impact rules), `shell-scanner-bash-differential` (the same mutant discipline for the write gate's shell scanner), `windows-checkout-test-parity`
