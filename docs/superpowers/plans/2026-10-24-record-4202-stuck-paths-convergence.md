# Stuck-Paths Convergence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make reconcile's consolidated structurally-stuck record close by itself once every run directory it lists is gone.

**Architecture:** Two changes. The first is in `escalate-residue.js`. Its structurally-stuck escalate and resolve paths gain an opt-in `pathExists` predicate. Whenever they already edit the record, they also drop every other listed path the predicate says is gone, and resolve closes the record once the converged list is empty. The second is wiring. `cache.js` passes `pathExists: fs.existsSync` on its three escalate/resolve calls. `archive-merged.js`'s `trackArchiveResult` clears a successful archive's `structurally-stuck` entry through `clearResidue`, which resolves it, instead of `recordResidueSuccess`, which deletes it silently.

**Tech Stack:** Node 18+ CommonJS, `node:test` + `node:assert/strict`, `gh` CLI via an injectable `runner`.

**Spec:** `.claude-tweaks/pipelines/2026-10-24T192714-record-4202/work/4202-spec.md` (record #4202)

**Scope keywords:** recordResidueSuccess, structurally-stuck, pathExists

## Global Constraints

- When `pathExists` is omitted, escalate and resolve behave byte-for-byte as today. Every existing `tests/bin-lib/reconcile/escalate-residue.test.js` case uses paths that are absent from disk, such as `/x/run-a`, and must pass unchanged.
- An edit keeps every byte outside the stuck-paths block. Use `withStuckPaths` for that, as today. The one exception is the CLOSED-reopen branch, which already re-renders `structurallyStuckBody`.
- `move-failed` success handling is unchanged: it still goes through `recordResidueSuccess`.
- A failed resolve keeps the cache entry, following `clearResidue`'s existing `RESIDUE_RESOLVED_STATUSES` rule.
- Comments match the file's style: a terse `// #4202: …` line next to the `// #2724:` ones.
- Commit message style: `{Verb} {what} — {detail}`, ending with the trailer `Claude-Session: https://claude.ai/code/session_01K8JunuuUfG8EwkbhUSun6n`.

**Deliberate refinement of Deliverable 2:** a path counts as gone when `pathExists(p)` is false. Absence from the cache is not part of the test. A run dir that has left disk can never be stuck again, and `pruneResidueFailures` drops its entry anyway, so a cache check adds nothing. It would also force `escalate-residue.js` to learn the cache.

Waived AC4.1: the full suite is `/claude-tweaks:build` Common Step 5's verification run, not a task test.

**Sole-site proof:** `git grep -n "recordResidueSuccess" -- plugin/bin` lists only `archive-merged.js:1809` (`move-failed`) and `:1814` (`structurally-stuck`) as call sites outside `cache.js`. `cache.js` itself uses it inside `clearResidue` (`:224`, `:230`) and `trackResidue` (`:245`). `trackResidue`'s success branch is never reached for `structurally-stuck`: `trackStuckSkip` passes `failed: true` only. So `:1814` is the one place a `structurally-stuck` entry is deleted without a resolve.

**Dependency callers:** `trackArchiveResult`'s new resolve reaches `gh` only for an escalated `structurally-stuck` entry on an archive success. No existing test in `tests/bin-lib/reconcile/archive-merged.test.js` reaches that state: its escalated stuck seeds, around lines 1968, 1986 and 2085, are dirs that stay stuck, never archived. No other test module calls `trackArchiveResult`.

**Wording note on AC 1:** the spec says "through `archiveMergedRuns`", but no export has that name. `archiveMerged` is the entry point, and `trackArchiveResult` is the single place every archive success passes through, so AC 1 is tested at `trackArchiveResult`.

## Review Focus

1. **Reopening a CLOSED record whose block holds orphans:** the reopened body must list only the live paths plus the new one. Covered by the test in Task 1.
2. **Orphans when every other path is gone at resolve time:** the record closes, and the closing comment names the dropped paths. Covered in Task 1.
3. **A non-escalated `structurally-stuck` entry on archive success:** it is cleared with no `gh` call at all, so a never-filed path makes no network traffic. Covered in Task 2.
4. **The open-and-already-named re-escalation (dedup-hit):** it makes no edit even when orphans are present. This is deliberate, because the spec converges only on edits. Pinned in Task 1, so a later change has to be intentional.
5. **A CRLF body with an orphan:** the converged edit keeps CRLF line endings. `withStuckPaths` already handles CRLF, and Task 1's CRLF case asserts it.

---

### Task 1: Converge the stuck-paths block on escalate/resolve edits

**Files:**
- Modify: `plugin/bin/lib/reconcile/escalate-residue.js` (`escalateStructurallyStuck` ~284, `escalateResidue` ~319, `resolveStructurallyStuck` ~368, `resolveResidue` ~407, and their header comments)
- Test: `tests/bin-lib/reconcile/escalate-residue.test.js` (append after the `#2724` block; reuse `SHAPED` and `stuckRecordRunner`)

**Interfaces:**
- Produces:
  - `escalateResidue({ repo, reason, targetPath, count, firstFailedAt, lastError, dirtyFiles, runner, pathExists })`, where `pathExists?: (p: string) => boolean`. Only the `structurally-stuck` path reads it.
  - `resolveResidue({ repo, reason, targetPath, runner, why, pathExists })`, same rule.
  - Return shapes are unchanged: `appended` / `reopened` / `dedup-hit` / `filed` / `escalation-failed`, and `path-removed` / `closed` / `not-found` / `already-closed` / `resolution-failed`.

- [ ] **Step 1: Write the failing tests**

  Add five tests with `const gone = new Set([...])` and `pathExists = (p) => !gone.has(p)`:
  - `#4202 AC3.1 AC3.2: escalate: an append drops a listed path pathExists reports gone, keeping the text around the block`
    - Body: `SHAPED(renderStuckPathsBlock(['/x/run-a', '/x/gone-1']))`, with `gone = {'/x/gone-1'}`.
    - Escalate `/x/run-b` with `pathExists`.
    - Assert `{ status: 'appended', number: 2724 }` and `seen.edited === SHAPED(renderStuckPathsBlock(['/x/run-a', '/x/run-b']))`.
    - Assert `seen.commented` matches `/gone-1/`.
  - `#4202 escalate: reopening a CLOSED record drops gone paths from the re-rendered body`
    - Closed body: block `['/x/gone-1', '/x/run-a']`, with `gone = {'/x/gone-1'}`.
    - Escalate `/x/run-new`.
    - Assert `seen.edited === structurallyStuckBody(['/x/run-a', '/x/run-new'])`.
  - `#4202 AC3.1 AC3.2: resolve: removing a path also drops gone paths and closes when nothing live remains`
    - Block `['/x/run-a', '/x/gone-1', '/x/gone-2']`, with `gone = {'/x/gone-1','/x/gone-2'}`.
    - Resolve `/x/run-a`.
    - Assert `{ status: 'closed', number: 2724 }`, `seen.edited === SHAPED(renderStuckPathsBlock([]))`, and that a `close` call was made.
    - Assert `seen.commented` matches `/gone-1/` and `/gone-2/`.
  - `#4202 resolve: a CRLF body with a gone path stays CRLF and keeps live paths`
    - Body: `SHAPED(renderStuckPathsBlock(['/x/run-a', '/x/gone-1', '/x/run-b'])).replace(/\n/g, '\r\n')`.
    - Resolve `/x/run-a`.
    - Assert `{ status: 'path-removed', number: 2724 }` and `seen.edited === SHAPED(renderStuckPathsBlock(['/x/run-b'])).replace(/\n/g, '\r\n')`.
  - `#4202 escalate: an already-named path on an OPEN record stays a plain dedup-hit even with gone paths listed`
    - Block `['/x/run-a', '/x/gone-1']`.
    - Escalate `/x/run-a` with `pathExists`.
    - Assert `{ status: 'dedup-hit', number: 2724 }` and `seen.edited === null`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/bin-lib/reconcile/escalate-residue.test.js`
Expected: FAIL after Step 1 — the first four new tests fail because the edited body still lists `/x/gone-1`. The dedup-hit test passes before and after; it is a pin, not a red-first test.

- [ ] **Step 3: Implement the convergence in `plugin/bin/lib/reconcile/escalate-residue.js`**
  - Add `pathExists` to `escalateStructurallyStuck`'s and `resolveStructurallyStuck`'s destructured params. Forward it from `escalateResidue` and `resolveResidue` on the `structurally-stuck` branch only.
  - Inside each `onHit`, after the existing early returns (`dedup-hit`; `not-found` / `already-closed`), compute two lists:
    - `kept`: `existingPaths.filter((p) => p === targetPath || !pathExists || pathExists(p))`
    - `dropped`: the rest
  - Build `updatedPaths` / `remaining` from `kept` rather than `existingPaths`.
  - When `dropped.length`, append to the comment already posted ` (dropped ${dropped.length} path(s) no longer on disk: ${dropped.map((p) => `\`${p}\``).join(', ')})`. Put it before the closing period on the resolve comments, and at the end of the escalate comments.
  - Resolve closes when `remaining.length === 0`, as today. That condition is computed over the converged list now.
  - Add `// #4202:` lines on both functions' header comments: `pathExists` is opt-in, and omitted means no convergence.

- [ ] **Step 4: Run the tests to verify they pass**

  Run: `node --test tests/bin-lib/reconcile/escalate-residue.test.js`
  Expected: PASS, with every pre-existing test unchanged.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/reconcile/escalate-residue.js tests/bin-lib/reconcile/escalate-residue.test.js
git commit -m "Converge the stuck-paths block on escalate/resolve edits — drop listed paths gone from disk (#4202)

Claude-Session: https://claude.ai/code/session_01K8JunuuUfG8EwkbhUSun6n"
```

### Task 2: Resolve on archive success and wire `pathExists` from the cache

**Files:**
- Modify: `plugin/bin/lib/reconcile/archive-merged.js` (`trackArchiveResult` ~1807-1816, the prune comment ~2351-2358)
- Modify: `plugin/bin/lib/reconcile/cache.js` (`trackResidue`'s `escalate({…})` ~251, `clearResidue`'s `resolve({…})` ~228, `pruneResidueFailures`' `resolve({…})` ~298)
- Test: `tests/bin-lib/reconcile/archive-merged.test.js` (beside the `trackArchiveResult` tests ~1799)
- Test: `tests/bin-lib/reconcile/cache.test.js` (beside the `runner`-forwarding tests ~242/333 and the `#2724 clearResidue` block)

**Interfaces:**
- Consumes: Task 1's `pathExists` param on `escalateResidue` and `resolveResidue`.
- Produces: `trackArchiveResult(cacheTarget, repoSlug, dir, result, { escalate = escalateResidue, resolve = resolveResidue, runner } = {})`, with an unchanged return (none).

- [ ] **Step 1: Write the failing tests**

  **`archive-merged.test.js`** — import `resolveResidue` and `structurallyStuckBody` / `parseStuckPaths` from `escalate-residue`. In each case:
  - `root` is a tmpdir.
  - `dir` is `path.join(root, '.claude-tweaks', 'pipelines', '2026-01-01T000000-record-1')`, not created, so it is already archived.
  - `live` is a created sibling dir.
  - The entry is seeded escalated with `recordResidueFailure(root, 'structurally-stuck', dir, { lastError: 'stuck at no-pr', threshold: 1 })`.

  Tests:
  - `#4202 AC1.1 AC1.2: trackArchiveResult: archive success resolves an escalated structurally-stuck entry off the consolidated record`
    - The runner's `issue list` returns `[{ number: 2724, title: 't', body: structurallyStuckBody([dir, live]), createdAt: '2024-01-01T00:00:00Z', state: 'OPEN' }]`, and the runner records the `issue edit --body`.
    - Call `trackArchiveResult(root, 'o/r', dir, { ok: true, movedEntries: [] }, { runner })`.
    - Assert `parseStuckPaths(edited)` equals `[live]` and `listResidueFailures(root)` is `[]`.
  - `#4202 AC2.1: trackArchiveResult: a failed resolve keeps the structurally-stuck entry for the next pass`
    - The runner throws on `issue edit`.
    - Assert `listResidueFailures(root).map((e) => e.reason)` equals `['structurally-stuck']`.
  - `#4202 trackArchiveResult: an unescalated structurally-stuck entry is cleared with no gh call`
    - Seed with the default threshold, one failure only.
    - Use a runner that throws on any call.
    - Assert no throw and `listResidueFailures(root)` is `[]`.

  **`cache.test.js`** — add three tests:
  - `#4202 trackResidue: passes pathExists (fs.existsSync) into the escalate call`. Capture `calls[0].pathExists === fs.existsSync`.
  - `#4202 clearResidue: passes pathExists into the resolve call`. Use `escalatedEntryRoot()` and assert the captured `pathExists === fs.existsSync`.
  - `#4202 pruneResidueFailures: passes pathExists into the resolve call`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/bin-lib/reconcile/archive-merged.test.js tests/bin-lib/reconcile/cache.test.js`
Expected: FAIL after Step 1 — the first `#4202 trackArchiveResult` test sees no edit (`edited` is null), the failed-resolve test sees the entry deleted, and the three cache tests see `pathExists` as `undefined` on each captured call.

- [ ] **Step 3: Implement**
  - **`cache.js`:** add `pathExists: fs.existsSync` to the three calls' argument objects.
  - **`archive-merged.js` `trackArchiveResult`:**
    - Add `resolve = resolveResidue` to the opts.
    - On `result.ok`, replace `recordResidueSuccess(cacheTarget, 'structurally-stuck', dir)` with `clearResidue(cacheTarget, repoSlug, 'structurally-stuck', dir, { resolve, runner })`.
    - Rewrite the `#1613` comment above it: a successful archive resolves an escalated entry off the consolidated record (#4202) rather than silently dropping it, and a failed resolve keeps the entry.
  - **`archive-merged.js` prune comment (~2355):** reword it. A dir this pass just archived has its `structurally-stuck` entry cleared, or kept on a failed resolve, by `trackArchiveResult`'s `clearResidue`. A kept entry's path is now gone, so the `pruneResidueFailures` call below retries the resolve in the same pass.

- [ ] **Step 4: Run the tests to verify they pass**

  Run: `node --test "tests/bin-lib/reconcile/*.test.js"`
  Expected: PASS. There were 617 passing tests before this plan, so expect 617 plus the 11 new ones (5 + 3 + 3).

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/reconcile/archive-merged.js plugin/bin/lib/reconcile/cache.js tests/bin-lib/reconcile/archive-merged.test.js tests/bin-lib/reconcile/cache.test.js
git commit -m "Resolve a stuck dir's escalation when reconcile archives it — clearResidue on archive success, pathExists wired from the cache (#4202)

Claude-Session: https://claude.ai/code/session_01K8JunuuUfG8EwkbhUSun6n"
```
