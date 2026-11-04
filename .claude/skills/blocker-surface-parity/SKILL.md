---
name: blocker-surface-parity
description: Use when changing what blocks a record or how a blocker is named — a new blocker form, a state rule, a reader for native `blockedBy` or body `Blocked by` lines — on any surface that classifies, counts or names blockers (dispatch queue pull and resume, /flow pre-flight and materialize, backlog funnel, refine and grant pre-pass, wrap-up newly unblocked). Lists every surface, the shared helpers, and the rules that keep their verdicts identical across both work-links modes and both transports. Keywords - blocker, Blocked by, blockedBy, cross-repository, owner/name#N, openBlockerRefs, foreignBlockerBlocks, partitionByOpenBodyBlockers, bodyForeignBlockers, state unreadable, fail closed, cacheUsable, newly unblocked, funnel.
---

# Blocker surface parity

## Overview

Many surfaces read a record's blockers, and each must reach the same verdict, or one reports a record ready while another excludes it. #4553, #4792 and #4793 each had to land one blocker rule across all of them, and #4793's final review still found two surfaces short. `docs/journeys/block-a-record-on-another-repositorys-issue-4793.md` walks the surfaces as a user sees them; this skill is the change-side roster.

## The surface set

| Surface | Code | Prose |
|---|---|---|
| Parse | `plugin/bin/lib/issues/cross-repo-refs.js` (`parseCrossRepoDependencies`, `stripCrossRepoRefs`); this repository's `#N` stays with `parseDependencies` | — |
| Shared verdict | `plugin/bin/lib/issues/record-dependencies.js` (`foreignBlockerBlocks`, `openBlockerRefs`, `openNativeBlockerRefs`, `partitionByOpenBodyBlockers`), re-exported by `record.js` | — |
| Foreign state lookup | `plugin/bin/lib/issues/cross-repo-states.js` (`bodyForeignBlockers`, `suppliedStates`), `plugin/bin/resolve-foreign-blockers.js`; native links via `plugin/bin/resolve-blockers.js` | — |
| Dispatch queue pull | the body-text and native passes | `plugin/skills/dispatch/queue-pull-script.md`, `queue-pull-notes.md`, `blocked-exclusion-report.md` |
| Queue-order cache | `plugin/bin/lib/dispatch/queue-order.js` (`cacheUsable`) | `queue-pull-notes.md` |
| Unlanded-blocker pass | `plugin/bin/dispatch-unlanded-blockers.js`, `plugin/bin/lib/dispatch/unlanded-blockers.js` | `queue-pull-notes.md` |
| Dispatch resume | `plugin/bin/dispatch-resume.js`, `plugin/bin/lib/dispatch/resume-eligibility.js` | — |
| /flow pre-flight (2.7b) and multi-spec order | `plugin/bin/preflight-records.js`, `plugin/bin/lib/preflight-records/blocker-landing.js` | `plugin/skills/flow/multi-spec.md`, `multispec-dependency-ordering.md`, `multispec-preflight-failure.md` |
| Materialize `blocked-by:` header | `plugin/bin/materialize.js` | `plugin/skills/flow/materialize.md` |
| Backlog funnel, overview and refine | `plugin/bin/lib/issues/backlog.js` (`attachBodyForeignBlockers`), `plugin/bin/lib/issues/ranking.js` | `plugin/skills/backlog/overview-mode.md`, `refine-mode.md`, `refine-lanes.md` (Dependency repair) |
| Headless grant pre-pass | `plugin/bin/lib/backlog-grant-gate/backlog-grant-gate.js` (`filterCandidates`) | `plugin/skills/backlog/machine-grant-outlook.md` |
| Wrap-up newly unblocked | `plugin/bin/lib/wrap-up/pack.js` | `plugin/skills/wrap-up/unblocked-records.md` |
| gh-absent transport | — | `plugin/skills/dispatch/mcp-transport.md`, `plugin/skills/backlog/mcp-transport.md` (see `mcp-agent-fetch-node-compute`) |

## Rules

1. **One predicate decides.** Every surface calls `foreignBlockerBlocks` / `openBlockerRefs` rather than restating the rule: only an exact CLOSED releases; open and unreadable both hold (fail closed).
2. **Name it the same everywhere.** A foreign blocker reads `owner/name#N`, or `owner/name#N (state unreadable)` with one `Warning:` line naming the cause. No surface reads a qualified ref as this repository's bare number.
3. **Make the new input a required argument.** `filterCandidates` and `partitionByOpenBodyBlockers` throw `TypeError` without a foreign `Map` (`new Map()` for none), so a caller that never learned the rule fails loudly instead of reading every foreign blocker as absent.
4. **State the freshness signal cannot see means a cache miss.** A foreign issue closing changes nothing in this repository, so `cacheUsable` misses while any `auto:build` body declares a qualified line or a persisted exclusion names a foreign blocker.
5. **Cover both `work-links` modes and both transports** on every row of the table, or say in the row's prose which one the surface does not support and what it prints instead.

## Tests

- `tests/cross-repo-blocker-readers-conformance.test.js` (backlog regions, one fact list each), `tests/dispatch-cross-repo-blocker-exclusion-fixture.test.js` (extract-and-run of the queue pass, including the states-file export shape), `tests/flow-cross-repo-header-conformance.test.js`, `tests/flow-blocker-landing-conformance.test.js`, `tests/dispatch-unlanded-blocker-consumers-conformance.test.js`.
- Follow `skill-prose-conformance-tests` for the prose rows and prove each new assertion red.

## Common Operations

Derive the current reader list instead of trusting the table:

```bash
git grep -n -l -E "openBlockerRefs|foreignBlockerBlocks|partitionByOpenBodyBlockers|bodyForeignBlockers|openNativeBlockerRefs" -- plugin tests
```

## Anti-Patterns

| Pattern | Why it fails here |
|---|---|
| Landing the rule in the dispatch queue pull only | Backlog's funnel counts the record dispatchable and wrap-up reports it newly unblocked while dispatch excludes it (journey step 3's red flags) |
| An optional foreign argument that defaults to empty | Every caller that never passes it reads all foreign blockers as absent and releases the record, with no error |
| Re-checking a cached verdict only on `updatedAt` | The foreign issue closes without touching any local record, so the stale exclusion replays until something unrelated changes (#4793 final review) |
