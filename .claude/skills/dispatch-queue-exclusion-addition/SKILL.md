---
name: dispatch-queue-exclusion-addition
description: Use when adding an exclusion reason to /dispatch's queue pull (`plugin/bin/lib/dispatch/queue-pull.js`, #5230) — a pass that drops candidates from `dispatch-groups.json` or tags them in `dispatch-exclusions.json` — or changing a pass's position or whether it removes candidates. Lists every site the reason must land in, which of them a test derives from the script, and the decisions each pass owes (removing or not, bypass, cache-hit behavior, fail-open posture, MCP transport). Keywords - queue pull, exclusion reason, dispatch-exclusions.json, appendExclusion, removing reason, REMOVING_REASONS, #N report, notFound, exclusion report, queue-pull-notes, fail open.
---

# Dispatch queue-pull exclusion addition

## Overview

Each exclusion pass lives in `plugin/bin/lib/dispatch/queue-pull.js` (#5230: a `PASSES` row plus a `RUNNERS` entry; `/dispatch` Steps 2-3 call it through `plugin/bin/queue-pull.js`) and writes `{reason, records, detail}` entries through `plugin/bin/lib/dispatch/exclusions.js`'s `appendExclusion`, the one sanctioned writer (#3110: it refuses a corrupt file rather than clobbering earlier passes' entries). The pass is the easy part. Every selection form, report and doc that names the reasons must learn the new one too, and the earlier additions missed sites: #3084 fixed the `#N` forms misreporting a `not-spec-shaped` record as an open PR, and #3085 restored the shipped-candidate report.

## The registration set

**Until the removal unit lands, the retained `plugin/skills/dispatch/queue-pull-script.md` is not the live home of a pass but is still mirrored.** A pass change is made in the module and mirrored in the retained `queue-pull-script.md` (header bullet and pass block), so #5227's parity test stays green. Rows 1 and 2 below are that mirror, not the live pass.

| # | Site | What it owes | Enforced by |
|---|---|---|---|
| 1 | The retained `queue-pull-script.md` header (the mirror, until the removal unit) | One `` - `reason: '{name}'` `` bullet with its `detail` shape and record number. A reason whose records stay in `dispatch-groups.json` says `stay IN `dispatch-groups.json`` in that bullet | `tests/bin-lib/dispatch/queue-pull.test.js` AC11.1 compares the bullets to the `PASSES` reasons; `tests/dispatch-named-form-exclusion-reasons.test.js` derives `REMOVING_REASONS` from `PASSES` (`removes`), so the module row, not the bullet wording, decides removing or not |
| 2 | The retained `queue-pull-script.md` pass block (the mirror) | The pass at its position, with a one-line comment pointing at `queue-pull-notes.md` | The parity tests in `tests/bin-lib/dispatch/queue-pull.test.js` (the script's fence and the module run on the same fixtures) |
| 3 | `plugin/skills/dispatch/queue-pull-notes.md` | Why the pass sits where it does, whether it runs on a cache hit, and its fail-open posture. The script keeps one line; the reasoning lives here (#4792 moved three passes' rationale out of the script) | — |
| 4 | `plugin/skills/dispatch/SKILL.md` Step 2's queue sentence | The new condition in "The queue: open + `auto:build` + …" | — |
| 5 | `SKILL.md` `#N` and `#N[,#M,#O...]` bullets | The reason, by name, in both bullets' lists | `REMOVING_REASONS` loop in the same test (removing reasons only) |
| 6 | A report file | The per-record line Step 3 prints: `blocked-exclusion-report.md` (blocked, target-missing, unlanded-blocker, malformed-blocker), or a file of its own (`open-pr-exclusion-report.md`, `not-spec-shaped-exclusion-report.md`) | A per-reason conformance test (#4792: `tests/dispatch-unlanded-blocker-consumers-conformance.test.js`) |
| 7 | `plugin/skills/dispatch/mcp-transport.md` | What the pass does on a `gh`-absent firing: an MCP mapping, or the stated limit and its fail-open line | Same per-reason test |
| 8 | `docs/journeys/learn-why-a-named-record-wont-dispatch-3084.md` | The reason in Step 1 and in the Success state, and the count word ("for seven reasons") | The same named-form test, removing reasons only |
| 9 | `docs/skill-graph.md`, `docs/plugin-structure.md` | A CLI the pass calls gets its skill-graph edge and its command line | Per-reason test |
| 10 | `plugin/bin/lib/dispatch/queue-pull.js`, the live home of the pass (#5230; #5227 built it as the script's Node twin) | A `PASSES` row at the pass's script position, its columns recording the decisions below (`removes`, `bypass`, `runsOnCacheHit`, `failOpen`, `mcp`), and a `RUNNERS` entry keyed by its `id` that implements the pass, quirks included; `REMOVING_REASONS` derives from `PASSES` (`removes`), so no second list needs the reason | `tests/bin-lib/dispatch/queue-pull.test.js`: AC11.1 derives the reason set, `removes` and `bypass` from site 1's bullets; the parity tests run the fence and the module on the same fixtures, so add one that reaches the pass |

## Decisions each pass owes

1. **Removing or not?** A removing reason drops the record from `dispatch-groups.json` before any selection form reads it, so even a named `#N` cannot dispatch it. `oversized` and `neighbour-in-flight` stay in the file and only bare drain's ranking skips them, because a person naming the record accepts that risk. Choose removing only when no one could accept the risk, because a later gate would stop the record anyway after a claim and a spent retry.
2. **Where in the order?** Run a pure pass (no `gh`, such as `not-spec-shaped`) before the `gh`-backed probes, so an excluded candidate costs none of their calls. A pass that judges the remaining pool goes after the passes whose exclusions it should not re-check.
3. **Cache hit too?** Run the pass on a queue-order cache hit when the state it reads can change without touching the records' `updatedAt` (an open PR, a blocker's commit landing). Skipping it there brings back the bug the pass exists to fix. A pass whose verdict a hit replays instead of re-running needs the cache to miss whenever its inputs carry such state: the `blocked` pass reads foreign blocker states the freshness signal cannot see, so `cacheUsable` in `plugin/bin/lib/dispatch/queue-order.js` refuses a hit while any `auto:build` body declares a `Blocked by owner/name#N` line or a persisted exclusion names a foreign blocker (#4793).
4. **Fail open or stop?** A pass whose judgment a later gate repeats before any claim (`/flow` Step 2.7b re-checks blocker landing) fails open with one `Warning:` or `AUTO` line. Only a refused `appendExclusion` write or an unreadable `$DISPATCH_GROUPS` stops the pull.
5. **Can one record turn the pass off?** When the pass batches every candidate into one call that fails as a whole on a single bad input, screen that input out under its own reason first (#4792's `malformed-blocker`). See `gh-api-module-pattern`'s `batching-failure-posture.md`.

## Common Operations

Derive the site list from the last reason added rather than trusting the table alone:

```bash
git grep -n -l -E "unlanded-blocker|target-missing" -- plugin docs tests
```

Then run the derived-list test, the module suite (its parity tests fail when the module and the retained script disagree) and the new reason's conformance test:

```bash
node --test tests/dispatch-named-form-exclusion-reasons.test.js tests/bin-lib/dispatch/queue-pull.test.js
```

## Anti-Patterns

| Pattern | Why it fails here |
|---|---|
| Adding the pass and its report, but not the `#N` bullets | A named record dropped by the pass prints the wrong reason or none (#3084, after #2829 added `not-spec-shaped`) |
| Wording a removing reason's bullet with "stay IN `dispatch-groups.json`" | The mirrored bullet then disagrees with the module's `removes` column, which `REMOVING_REASONS` derives from; AC11.1 goes red on it. Keep the bullet and the `PASSES` row saying the same thing |
| Writing the entry with `fs.writeFileSync` instead of `appendExclusion` | It clobbers every earlier pass's entries for this firing (#3110) |
| Changing only the retained `queue-pull-script.md` | It is no longer the live path; the CLI runs the module, so the change never takes effect (#5230). Change the module, then mirror the script |
| Changing only the module, until the removal unit lands | #5227's parity test runs the script's fence and the module on the same fixtures and goes red on the drift |
| Keeping the pass's rationale in the module's or script's comments | Running the pass needs none of it, yet every reader of the code pays for it; `queue-pull-notes.md` holds it for whoever changes a pass's position or posture |
