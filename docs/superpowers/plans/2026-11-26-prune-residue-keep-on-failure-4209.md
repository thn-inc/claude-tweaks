# pruneResidueFailures keep-on-failure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `pruneResidueFailures` keeps an escalated residue entry whose resolve did not land, retrying it on later passes up to `RESIDUE_RETRY_LIMIT` (5) failed retries, instead of dropping it on the first failure — and reconcile reports each failed resolve exactly once per pass.

**Architecture:** Move the `delete failures[key]` for escalated entries to after the resolve. A landed resolve (status in `RESIDUE_RESOLVED_STATUSES`) drops the entry; a failed one increments an op-neutral `residueRetries` counter on the entry and records `lastResidueError`, and the entry is dropped on the pass that records the 5th failure. Non-escalated entries keep today's immediate drop with no resolve call. Because a kept entry's failure now reaches `reconcile()`'s `residueErrors` both through its `lastResidueError` and through the prune's returned `failures`, `index.js` drops the returned-failure duplicate.

**Tech Stack:** Node 18+, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-11-26T082505-record-4209/work/4209-spec.md` (record #4209; supersedes the earlier run's `2026-11-26T081411-record-4209/work/4209-spec.md`, which predates the Decisions section)

**Scope keywords:** pruneResidueFailures, still drops the cache entry, retried once by the same pass's prune, the entry is dropped either way

## Global Constraints

- Bound (spec Decisions, verbatim): "The bound is 5 failed prune retries, counted per reconcile pass: one increment per pass in which the entry's resolve did not land. The entry is dropped on the pass that records the 5th failure. Export it as one named constant, `RESIDUE_RETRY_LIMIT = 5`, from `plugin/bin/lib/reconcile/cache.js`."
- Counter (spec Decisions): "store the count on the entry as an op-neutral `residueRetries` integer, next to `lastResidueError`. Do not call it `pruneRetries`." #4253 adopts the same field and constant; a test pins the constant's value.
- Reporting (spec Decisions): "a kept entry's failed resolve is reported exactly once per pass." `pruneResidueFailures` still returns every failed resolve in `{ failures }` (spec AC2, Gotchas); the dedup happens in `index.js`, where both channels meet. A test asserts the once-per-pass count.
- `residue-summary.js` needs no change: a kept entry is still listed by `listResidueFailures`, so it counts as stuck (spec Decisions).
- The keep-on-failure rule applies to every escalated entry, whatever its reason — `pruneResidueFailures` is reason-agnostic by design (spec Gotchas).
- Never revert to drop-on-first-failure (spec Deliverable 2).
- Governing skill `gh-api-module-pattern` (`batching-failure-posture.md`), quoted: "**That joined text is unbounded and multi-line, so bound it where it reaches a one-line or model-facing surface.**" — the kept entry's `lastResidueError.reason` goes through the existing `boundedError(error, detail)`, exactly as the returned failure's `error` already does.
- Commit tests only where the task asks for them or the repo already keeps tests for this kind of change, sized like the neighboring test files; scratch checks stay scratch. Touch only what the task requires — a pre-existing bug you notice is a follow-up to report, not a fix to fold in, unless the task cannot work without it. Don't reformat or "improve" adjacent code; edit in place rather than rewrite when the result is the same.

## Review Focus

- A resolve that throws (gh absent) counts as a failed retry exactly like a `resolution-failed` status (covered: Task 1 test `AC1.1`, throw variant).
- A resolve returning `null`/`undefined` — `unresolvedError` maps it to `no result`; counts as a failure (same code path; no extra test).
- An entry written before this change (no `residueRetries` field, or a non-integer one) is treated as 0 (covered: every test seeds via `recordResidueFailure`, which writes no counter).
- A kept entry whose resolve later lands is dropped with no further counting (covered: Task 1 test "a kept entry is dropped once a later pass's resolve lands").
- A path that comes back after a kept failure: prune skips an entry whose path exists, so `residueRetries` sits unchanged while the path is present. A later `recordResidueSuccess` drops the whole entry, and a later `recordResidueFailure` rebuilds it carrying only `lastResidueError` forward — either way the counter resets, so a path that disappears again starts counting from 0. Only a path that comes back and is never touched again keeps its count (cumulative). No code change; state this in the `pruneResidueFailures` header comment beside the bound.

---

### Task 1: Keep a failed-resolve escalated entry, bounded by RESIDUE_RETRY_LIMIT, reported once per pass

**Role:** integration

**Review risk:** high — reverses the documented #1892 Deliverable 3 drop-on-failure posture (spec Decisions).

**Files:**
- Modify: `plugin/bin/lib/reconcile/cache.js` — `pruneResidueFailures` (~:443-466) and its header comment (~:429-442); the `residueFailures` schema comment (~:63-65: add `residueRetries?: number`); the `RESIDUE_RESOLVED_STATUSES` comment's "retries the resolve once" clause (~:337); new constant `RESIDUE_RETRY_LIMIT = 5` beside `RESIDUE_ESCALATE_THRESHOLD` (~:47), exported.
- Modify: `plugin/bin/lib/reconcile/index.js` — the `residueErrors` composition (~:145-158) and its comment: drop a prune failure whose `(reason, path, op)` matches a listed entry's `lastResidueError`; also the `state` comment at ~:135 ("whose entries are already gone from the cache") — a prune failure's entry is now gone only when its resolve landed or the bound dropped it.
- Modify if red: `tests/bin-lib/reconcile/archive-merged.test.js` — any existing test that seeds an escalated gone-path entry with a failing resolve and asserts `listResidueFailures(root)` is `[]` now sees the entry kept; update that assertion to the kept entry (`residueRetries === 1`), naming #4209. Step 4's run shows which, if any.
- Modify: `plugin/bin/lib/reconcile/archive-merged.js` — comment only, ~:2960-2968 ("then drops the entry whatever that retry returns", "(the entry is dropped either way)") — reword to the new contract.
- Modify: `docs/reconcile-checks.md` — the **Residue pruning** paragraph (~:310-320): "a resolution failure still drops the cache entry" and "retried once by the same pass's prune, then dropped" — reword to: a failed resolve keeps the entry (`residueRetries` counted on it) and later passes retry it, dropping it on the pass that records the 5th failed retry (`RESIDUE_RETRY_LIMIT`).
- Modify: `docs/journeys/preview-reconcile-and-see-why-an-escalation-failed-4180.md` — `:54` ("`at: null` marks a failure from this pass's prune of a path that no longer exists. That entry is already dropped from the cache…"): reword so `at: null` marks a prune failure whose entry this pass dropped at the `RESIDUE_RETRY_LIMIT`-th (5th) failed retry, while a kept entry's prune failure is reported once, from its `lastResidueError`, with a numeric `at`. `:58` (drop conditions): add "or its 5th failed prune retry (`RESIDUE_RETRY_LIMIT`)".
- No change: `plugin/bin/lib/reconcile/residue-summary.js`; `plugin/bin/lib/reconcile/issue-list-cache.js:12` (names the function only).
- Test: `tests/bin-lib/reconcile/cache.test.js`, `tests/reconcile-archive-residue.test.js`

**Interfaces:**
- Produces: `RESIDUE_RETRY_LIMIT` (number, `5`) exported from `cache.js`; `pruneResidueFailures(root, residueRepo, { resolve = resolveResidue, runner, now = Date.now() } = {}) -> { failures }` (signature gains only the optional `now`; return shape `{ failures: [{ reason, path, op: 'resolve', error }] }` unchanged); entry field `residueRetries` (integer >= 1, present only on a kept entry).

- [ ] **Step 1: Write the failing tests**

  In `tests/bin-lib/reconcile/cache.test.js`, in the `#1892 Deliverable 3` prune block (~:387; import `RESIDUE_RETRY_LIMIT` alongside `RESIDUE_ESCALATE_THRESHOLD`):
  - Replace `pruneResidueFailures: a resolve failure (gh absent / network) still drops the cache entry, never throws` (~:433) with `AC1.1 #4209 pruneResidueFailures: an escalated entry whose path is gone and whose resolve fails is kept, never throws`, run for two injected resolves — `() => ({ status: 'resolution-failed', reason: 'boom' })` and `() => { throw new Error('gh not found'); }`. Assert: `doesNotThrow`; `listResidueFailures(root)` has length 1 with `residueRetries === 1` and `escalated === true`; `lastResidueError.op === 'resolve'`; the returned `failures` has length 1 with `{ reason: 'move-failed', path: gonePath, op: 'resolve' }` and a string `error`.
  - Add `AC2.1 #4209 pruneResidueFailures: drops the entry on the pass that records the RESIDUE_RETRY_LIMIT-th failed retry, reporting every failed resolve`: `assert.equal(RESIDUE_RETRY_LIMIT, 5)`; escalate an entry at a gone path, then call `pruneResidueFailures` `RESIDUE_RETRY_LIMIT` times with a failing resolve. After each of the first `RESIDUE_RETRY_LIMIT - 1` calls the entry is present with `residueRetries` equal to the call number; after the last call `listResidueFailures(root)` is `[]`. Every call's returned `failures` has length 1.
  - Add `#4209 pruneResidueFailures: a kept entry is dropped once a later pass's resolve lands`: one failing call (entry kept, `residueRetries === 1`), then a call with `() => ({ status: 'closed' })` → `listResidueFailures(root)` is `[]` and `failures` is `[]`.
  - Retitle the test at ~:414 to `…triggers exactly one resolve call, naming the reason and path, and is dropped once it lands` (assertions unchanged).
  - Retitle `#4180 pruneResidueFailures: returns resolve failures for gone escalated paths and still drops the entries` (~:715) to `…returns resolve failures for gone escalated paths and keeps the entries` and change its final assertion to: one entry listed, `residueRetries === 1`, `lastResidueError` deep-equal to `{ op: 'resolve', reason: 'HTTP 500', at: <number> }` (check `at` with `typeof`). The returned `failures` assertion is unchanged.
  - In `#4180 pruneResidueFailures: a throwing resolve is a failure with the thrown message; a resolved or unescalated gone path is not` (~:722), replace the final `assert.deepEqual(listResidueFailures(root), [])` with: only the `thrown` path is still listed (`listResidueFailures(root).map((e) => e.path)` deep-equals `[thrown]`) — the closed and unescalated ones are dropped.
  - Leave the non-escalated drop test (~:390) byte-for-byte unchanged (AC3.1).
  - Update the comment above the block (~:387-389) to state the new posture and the bound: an escalated entry is dropped only once its resolve lands or on the pass recording the `RESIDUE_RETRY_LIMIT`-th (5th) failed retry.

  In `tests/reconcile-archive-residue.test.js`:
  - Add `#4209 reconcile: a kept entry's failed prune resolve is reported once in residueErrors`: `dryRunFixture()`; seed an escalated entry at `path.join(root, '.claude-tweaks', 'pipelines', 'gone-4209')` (`recordResidueFailure(..., { lastError: 'EBUSY', threshold: 1 })`); `await run({})`. Assert the entry is still listed with `residueRetries === 1`; `r.residueErrors.filter((e) => e.path === gone).length === 1`, that entry has `op: 'resolve'` and a numeric `at`.
  - Update `#4180 reconcile: an over-budget return after archive still reports a prune resolve failure in residueErrors` (~:558) so the prune still drops the entry this pass: seed the entry's `residueRetries` to `RESIDUE_RETRY_LIMIT - 1` (via `writeCache(root, { ...readCache(root), residueFailures: { ...} })` on the seeded entry) before `run`. Its assertions stay as they are (dropped entry, one `residueErrors` item with `at: null`).

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/bin-lib/reconcile/cache.test.js tests/reconcile-archive-residue.test.js`
Expected: FAIL — `AC1.1`, `AC2.1` and the `#4209 reconcile` test fail against the unchanged code (entry dropped on first failure; `RESIDUE_RETRY_LIMIT` undefined). This red run is AC1.2's proof that the test fails when the change is reverted.

- [ ] **Step 3: Implement in `plugin/bin/lib/reconcile/cache.js`**

  In the loop, a non-escalated gone entry is deleted as today. For an escalated gone entry, run the resolve first (same try/catch and `unresolvedError` mapping as today). On a landed resolve, delete. On a failure: push the failure to `resolveFailures` as today; let `retries = (Number.isInteger(entry.residueRetries) ? entry.residueRetries : 0) + 1`; if `retries >= RESIDUE_RETRY_LIMIT` delete the entry, otherwise set `failures[key] = { ...entry, residueRetries: retries, lastResidueError: { op: 'resolve', reason: boundedError(failure.error, failure.detail), at: now } }`. Set `changed = true` in every branch so the counter persists. Rewrite the header comment's "a resolution failure (gh absent, network) still drops the cache entry" sentence to the keep-and-bound contract, naming #4209, the bound and its rationale (one pass per SessionStart rides out a multi-session `gh` outage; a gh-absent machine gives up after 5 cheap ENOENT spawns per entry); keep the #4180 sentence about the returned failures, noting a kept entry's failure also rides on its `lastResidueError`.

  In `plugin/bin/lib/reconcile/index.js`, when composing `residueErrors`, drop each `state.archiveResidueErrors` item whose `reason`, `path` and `op` match a listed entry carrying `lastResidueError` with that `op` — the entry's record carries the same bounded text plus a timestamp. Update the #4180 comment there to say so.

  Then apply the comment/doc rewording in `archive-merged.js` and `docs/reconcile-checks.md` listed in Files.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/reconcile/cache.test.js tests/reconcile-archive-residue.test.js tests/bin-lib/reconcile/archive-merged.test.js tests/bin-lib/reconcile/residue-summary.test.js tests/bin-lib/hooks/reconcile-background.test.js tests/hooks-session-start.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/reconcile/cache.js plugin/bin/lib/reconcile/index.js plugin/bin/lib/reconcile/archive-merged.js docs/reconcile-checks.md docs/journeys/preview-reconcile-and-see-why-an-escalation-failed-4180.md tests/bin-lib/reconcile/cache.test.js tests/reconcile-archive-residue.test.js
# plus tests/bin-lib/reconcile/archive-merged.test.js only if Step 4 required a change there
git commit -m "Keep an escalated residue entry whose prune resolve failed — bounded retries, refs #4209"
```

Waived AC4.1: `npm test` is green — verified by `/claude-tweaks:build`'s Common Step 5 final verification, not by a task test.
