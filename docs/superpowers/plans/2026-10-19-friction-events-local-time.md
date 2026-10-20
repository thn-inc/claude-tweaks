# friction-events local-time claim boundary (#3442) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `computeClaimBoundary` read `decisions.md`'s `HH:MM:SS` as local time (matching `log-decision`'s `hms()`), so events after the claim survive east of UTC.

**Architecture:** `parseRunDirMintTime` already yields the correct UTC mint instant from the run-id. The claim instant becomes `new Date(Y, M, D, hh, mm, ss)` built from the mint instant's *local* calendar date plus the logged local wall time; when that lands before the mint, roll to the next local day by incrementing the date component (DST-safe), not by adding 24h.

**Tech Stack:** Node 18+, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-10-19T202905-record-3442/work/3442-spec.md` (materialized from GitHub issue #3442)

Scope keywords: computeClaimBoundary

## Global Constraints

- The writer is `plugin/bin/lib/log-decision/append.js`'s `hms()` (`getHours()/getMinutes()/getSeconds()` — local time); do not change the writer.
- `events.jsonl` `ts` values are ISO UTC; do not change event parsing.
- Fail-open posture is unchanged: unrecognized dir name or no readable first entry → `null` boundary.

## Review Focus

- Mint and claim straddle a *local* midnight that is not a UTC midnight (Copenhagen: mint 22:30Z = 00:30 local next day) — boundary must land on the correct local date. Pinned by test B below.
- Existing #2989 fixtures encode UTC wall-clock; on a non-UTC machine they are only meaningful under `TZ=UTC` — pinned by wrapping them in `withTz('UTC', …)`.
- `process.env.TZ` leaking between tests — the helper restores it in `finally`.

---

### Task 1: Read the decisions.md claim time as local time

**Files:**
- Modify: `plugin/bin/friction-events.js:154-170` (`computeClaimBoundary`, plus its comment block)
- Test: `tests/friction-events-cli.test.js` (#2989 block, lines 218-283)

**Interfaces:**
- Consumes: `parseRunDirMintTime(runDir) -> Date | null` (unchanged)
- Produces: `computeClaimBoundary(runDir) -> Date | null` (same signature; internal), observed through exported `readEvents(runDir, source)`

- [ ] **Step 1: Write the failing tests**

Add a helper near the #2989 block:

```js
function withTz(tz, fn) {
  const original = process.env.TZ;
  process.env.TZ = tz;
  try { return fn(); } finally { if (original === undefined) delete process.env.TZ; else process.env.TZ = original; }
}
```

(AC2.1) Wrap the bodies of the two existing #2989 tests that write a `decisions.md` entry (`excludes an event timestamped before…`, `handles a mint/claim pair that straddles a UTC midnight rollover`) in `withTz('UTC', () => { … })` — fixtures and assertions unchanged.

Test A — `#3442 AC1.1: readEvents reads the decisions.md claim time as local time (TZ=Europe/Copenhagen)`: under `withTz('Europe/Copenhagen', …)`, dir `2026-10-17T183900-record-999`, events `2026-10-17T18:38:00.000Z` and `2026-10-17T18:40:00.000Z`, decisions.md `## /flow\n- AUTO 20:39:18 — Step 2.8: claimed #999. Reversibility: high.\n`. Assert `events.length === 1` and `events[0].ts === '2026-10-17T18:40:00.000Z'`.

Test B — `#3442: a mint/claim pair straddling a local (non-UTC) midnight lands on the correct local day`: under `withTz('Europe/Copenhagen', …)`, dir `2026-10-17T223000-record-999` (00:30 local on 10-18), events `2026-10-17T22:30:30.000Z` and `2026-10-17T22:32:00.000Z`, decisions.md first entry `00:31:00`. Assert `events.length === 1` and `events[0].ts === '2026-10-17T22:32:00.000Z'`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/friction-events-cli.test.js`
Expected: FAIL — Test A returns 0 events, Test B returns 0 events (old `Z` construction puts the boundary hours late).

- [ ] **Step 3: Implement in `computeClaimBoundary`**

Replace the `mintDay` + `` `…Z` `` construction: split `entry[1]` into numeric `hh, mm, ss`; `claimed = new Date(mint.getFullYear(), mint.getMonth(), mint.getDate(), hh, mm, ss)`; if `claimed < mint`, rebuild with `mint.getDate() + 1`. Keep the `NaN` guard. Update the rollover comment to say local midnight and cite #3442 (writer is local time, mint is UTC).

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/friction-events-cli.test.js`
Expected: PASS (all, including the UTC-pinned #2989 tests)

- [ ] **Step 5: Revert-check discrimination (AC2.2)**

Temporarily restore the old `Z` line via `git show HEAD:plugin/bin/friction-events.js` comparison; confirm Tests A and B fail, then restore the fix. Expected: A and B FAIL on old code, PASS on new.

- [ ] **Step 5b: Real-input probe**

This pipeline's own run dir is a real east-of-UTC input (CEST machine; `decisions.md` first entry is a local time, `events.jsonl` holds this session's events). Count its in-vocabulary events independently, then run `node plugin/bin/friction-events.js --run "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines/2026-10-19T202905-record-3442"` and compare: post-claim in-vocabulary events must appear, not `[]`.

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/friction-events.js tests/friction-events-cli.test.js
git commit -m "Read decisions.md claim time as local time in friction-events — refs #3442"
```
