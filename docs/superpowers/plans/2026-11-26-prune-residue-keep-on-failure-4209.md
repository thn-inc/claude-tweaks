# pruneResidueFailures keep-on-failure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `pruneResidueFailures` keeps an escalated residue entry whose resolve did not land, retrying it on later passes up to a fixed bound, instead of dropping it on the first failure.

**Architecture:** Move the `delete failures[key]` for escalated entries to after the resolve. A landed resolve (status in `RESIDUE_RESOLVED_STATUSES`) drops the entry; a failed one increments a `pruneRetries` counter stored on the entry and records `lastResidueError`, and the entry is dropped once `pruneRetries` reaches a new exported constant `RESIDUE_RETRY_LIMIT`. Non-escalated entries keep today's immediate drop with no resolve call.

**Tech Stack:** Node 18+, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-11-26T081411-record-4209/work/4209-spec.md` (record #4209)

**Scope keywords:** pruneResidueFailures, still drops the cache entry, retried once by the same pass's prune

## Global Constraints

- The keep-on-failure rule applies to every escalated entry, whatever its reason — `pruneResidueFailures` is reason-agnostic by design (spec Gotchas).
- Callers read the returned `{ failures }` list for reporting: every failed resolve is still reported, whether the entry is kept or dropped (spec Gotchas). The return shape `{ failures: [{ reason, path, op: 'resolve', error }] }` is unchanged.
- Never revert to drop-on-first-failure (spec Deliverable 2).
- The bound and counter are one shape a sibling record (#4253, retrying a failed escalation in the same file) will adopt, so the constant name is op-neutral (`RESIDUE_RETRY_LIMIT`), not prune-specific.
- Bound value: `RESIDUE_RETRY_LIMIT = 5` failed prune retries. Rationale (to be confirmed by the reviewer, per the spec's Gotchas): one reconcile pass runs per SessionStart, so 5 passes rides out a `gh` outage spanning several sessions, while a machine with no `gh` gives up after 5 cheap ENOENT spawns per entry. The value is documented in the function header and beside the #1892 test comment.
- Governing skill `gh-api-module-pattern` (`batching-failure-posture.md`), quoted: "**That joined text is unbounded and multi-line, so bound it where it reaches a one-line or model-facing surface.**" — the kept entry's `lastResidueError.reason` goes through the existing `boundedError(error, detail)`, exactly as the returned failure's `error` already does.
- Commit tests only where the task asks for them or the repo already keeps tests for this kind of change, sized like the neighboring test files; scratch checks stay scratch. Touch only what the task requires — a pre-existing bug you notice is a follow-up to report, not a fix to fold in, unless the task cannot work without it. Don't reformat or "improve" adjacent code; edit in place rather than rewrite when the result is the same.

## Review Focus

- A resolve that throws (gh absent) — must count as a failed retry exactly like a `resolution-failed` status (covered: Task 1 test `AC1.1`'s throw variant).
- A resolve returning `null`/`undefined` — `unresolvedError` already maps it to `no result`; counts as a failure (covered by the same code path; no extra test).
- An entry written before this change (no `pruneRetries` field) — treated as 0 (covered: every test starts from `recordResidueFailure`, which writes no counter).
- A kept entry whose resolve later lands — dropped with no further counting (covered: Task 1 test "a kept entry is dropped once a later pass's resolve lands").
- The cache is written even when every gone entry was kept (the counter must persist across passes) — covered by the bound test, which runs separate `pruneResidueFailures` calls that each re-read the cache from disk.

---

### Task 1: Keep a failed-resolve escalated entry, bounded by RESIDUE_RETRY_LIMIT

**Role:** integration

**Files:**
- Modify: `plugin/bin/lib/reconcile/cache.js` — `pruneResidueFailures` (~:443-466) and its header comment (~:429-442); the `residueFailures` schema comment (~:63-65: add `pruneRetries?: number`); the `RESIDUE_RESOLVED_STATUSES` comment's "retries the resolve once" clause (~:337); new constant `RESIDUE_RETRY_LIMIT` beside `RESIDUE_ESCALATE_THRESHOLD` (~:47), exported.
- Modify: `plugin/bin/lib/reconcile/archive-merged.js` — comment only, ~:2960-2968 ("then drops the entry whatever that retry returns", "(the entry is dropped either way)") — reword to the new contract.
- Modify: `docs/reconcile-checks.md` — the **Residue pruning** paragraph (~:310-319): "a resolution failure still drops the cache entry" and "retried once by the same pass's prune, then dropped" — reword to: a failed resolve keeps the entry (`pruneRetries` counted on it) and later passes retry it, dropping it after `RESIDUE_RETRY_LIMIT` (5) failed retries.
- No change: `plugin/bin/lib/reconcile/issue-list-cache.js:12` (names the function only); `tests/bin-lib/reconcile/archive-merged.test.js` #4180 test (asserts only `residueErrors`, which is unchanged).
- Test: `tests/bin-lib/reconcile/cache.test.js`

**Interfaces:**
- Produces: `RESIDUE_RETRY_LIMIT` (number, `5`) exported from `cache.js`; `pruneResidueFailures(root, residueRepo, { resolve = resolveResidue, runner, now = Date.now() } = {}) -> { failures }` (signature gains only the optional `now`); entry field `pruneRetries` (integer >= 1, present only on a kept entry).

- [ ] **Step 1: Write the failing tests** in `tests/bin-lib/reconcile/cache.test.js`, in the `#1892 Deliverable 3` prune block (import `RESIDUE_RETRY_LIMIT` alongside `RESIDUE_ESCALATE_THRESHOLD`):

  - Replace the test `pruneResidueFailures: a resolve failure (gh absent / network) still drops the cache entry, never throws` (~:371) with `AC1.1 #4209 pruneResidueFailures: an escalated entry whose path is gone and whose resolve fails is kept, never throws`, run for two injected resolves — `() => ({ status: 'resolution-failed', reason: 'boom' })` and `() => { throw new Error('gh not found'); }`. Assert: `doesNotThrow`; `listResidueFailures(root)` has length 1 with `pruneRetries === 1` and `escalated === true`; `lastResidueError.op === 'resolve'`; the returned `failures` has length 1 with `{ reason: 'move-failed', path: gonePath, op: 'resolve' }` and a string `error`.
  - Add `AC2.1 #4209 pruneResidueFailures: drops the entry after RESIDUE_RETRY_LIMIT failed retries, reporting every failed resolve`: escalate an entry at a gone path, then call `pruneResidueFailures` `RESIDUE_RETRY_LIMIT` times with a failing resolve. After each of the first `RESIDUE_RETRY_LIMIT - 1` calls the entry is present with `pruneRetries` equal to the call number; after the last call `listResidueFailures(root)` is `[]`. Every call's returned `failures` has length 1. Also `assert.equal(RESIDUE_RETRY_LIMIT, 5)`.
  - Add `#4209 pruneResidueFailures: a kept entry is dropped once a later pass's resolve lands`: one failing call (entry kept, `pruneRetries === 1`), then a call with `() => ({ status: 'closed' })` → `[]` and `failures` `[]`.
  - Retitle the test at ~:352 to `…triggers exactly one resolve call, naming the reason and path, and is dropped once it lands` (assertions unchanged).
  - Leave the non-escalated drop test (~:328) byte-for-byte unchanged (AC3.1).
  - Update the comment above the block (~:325-327) to state the new posture and the bound: an escalated entry is dropped only once its resolve lands or after `RESIDUE_RETRY_LIMIT` (5) failed retries.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/bin-lib/reconcile/cache.test.js`
Expected: FAIL — the `AC1.1` and `AC2.1` tests fail (this red run against the unchanged code is AC1.2's proof that the test fails when the change is reverted) (entry dropped on first failure; `RESIDUE_RETRY_LIMIT` undefined).

- [ ] **Step 3: Implement in `plugin/bin/lib/reconcile/cache.js`**

  In the loop, a non-escalated gone entry is deleted as today. For an escalated gone entry, run the resolve first (same try/catch and `unresolvedError` mapping as today). On a landed resolve, delete. On a failure: push the failure to `resolveFailures` as today; let `retries = (Number.isInteger(entry.pruneRetries) ? entry.pruneRetries : 0) + 1`; if `retries >= RESIDUE_RETRY_LIMIT` delete the entry, otherwise set `failures[key] = { ...entry, pruneRetries: retries, lastResidueError: { op: 'resolve', reason: boundedError(failure.error, failure.detail), at: now } }`. Set `changed = true` in every branch so the counter persists. Rewrite the header comment's "a resolution failure (gh absent, network) still drops the cache entry" sentence to the keep-and-bound contract, naming #4209, the bound, and its rationale; keep the #4180 sentence about the returned failures.

  Then apply the comment/doc rewording in `archive-merged.js` and `docs/reconcile-checks.md` listed in Files.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/reconcile/cache.test.js tests/bin-lib/reconcile/archive-merged.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/reconcile/cache.js plugin/bin/lib/reconcile/archive-merged.js docs/reconcile-checks.md tests/bin-lib/reconcile/cache.test.js
git commit -m "Keep an escalated residue entry whose prune resolve failed — bounded retries, refs #4209"
```

AC4.1 (`npm test` is green) is verified by `/claude-tweaks:build`'s Common Step 5 final verification, not by this task.
