# claims: reuse claim-store resolveRepoSlug in claim-targets.js repoSlugOf (#3438) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove `claim-targets.js`'s private `gh repo view` slug resolver by sharing one throwing resolver from `claim-store.js`.

**Architecture:** Deliverable 1's decision: the timeout-vs-error classification at `claim-targets.js`'s single call site (`runClassified(..., { retryOnTimeout: true })` + `isTimeoutError`) needs the thrown error, so a null-swallowing resolver cannot replace it. Deliverable 2: `claim-store.js` gains an exported throwing variant `resolveRepoSlugOrThrow`; `resolveRepoSlug` becomes a try/catch wrapper over it; `claim-targets.js` deletes `repoSlugOf` and calls `claimStore.resolveRepoSlugOrThrow(deps.gh)` (`deps.gh` already satisfies the `runGh` contract — returns stdout, throws on failure).

**Tech Stack:** Node 18+, CommonJS, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-10-19T042037-record-3438/work/3438-spec.md` (materialized from GitHub issue #3438)

## Global Constraints

- No user-visible change (spec Release Note).
- `tests/bin-lib/claim-targets/claim-targets.test.js` passes **unchanged** — no edits to that file (AC2).
- Commit messages: `{Verb} {what} — {detail}`, `refs #3438` (never `closes`/`fixes`).

## Review Focus

- `gh` returning a non-string/undefined stdout: the shared resolver uses `String(out || '').trim()` (the `repoSlugOf` form), so `undefined` resolves to `null` — not the literal `'undefined'` the old `resolveRepoSlug` form `String(runGh(...))` produced. Pinned by the Task 1 test.
- A timeout-shaped throw (`err.code = 'ETIMEDOUT'`) must still propagate out of the throwing variant unchanged so `isTimeoutError` sees it — existing claim-targets tests `(slug-1)`/`(slug-2)`/`(slug-3)` pin this end-to-end.
- `resolveRepoSlug`'s null-on-throw / null-on-empty contract is unchanged — existing test `resolveRepoSlug: a thrown or empty gh answer resolves to null` pins it.

---

### Task 1: Share one throwing repo-slug resolver

**Files:**
- Modify: `plugin/bin/lib/issues/claim-store.js:278-287` (resolver) and the `module.exports` block (~line 532)
- Modify: `plugin/bin/lib/claim-targets/claim-targets.js:127-131` (delete `repoSlugOf`), `:269` (call site)
- Test: `tests/bin-lib/issues/claim-store.test.js` (add after the existing `resolveRepoSlug` test, ~line 943; add `resolveRepoSlugOrThrow` to the line-6 import)

**Interfaces:**
- Produces: `resolveRepoSlugOrThrow(runGh = defaultRunGh) -> string|null` exported from `claim-store.js` — trimmed `nameWithOwner`, `null` on an empty/absent answer, rethrows whatever `runGh` throws.
- `resolveRepoSlug(runGh = defaultRunGh) -> string|null` — unchanged contract, now `try { return resolveRepoSlugOrThrow(runGh); } catch { return null; }`.

- [ ] **Step 1: Write the failing test** (AC1 — the shared resolver `claim-targets.js` will use)

```js
test('resolveRepoSlugOrThrow: trims the slug, null on empty/absent output, rethrows a gh failure unchanged (AC1)', () => {
  const runGh = (args) => { assert.deepEqual(args, ['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner']); return 'acme/w\n'; };
  assert.equal(resolveRepoSlugOrThrow(runGh), 'acme/w');
  assert.equal(resolveRepoSlugOrThrow(() => '\n'), null);
  assert.equal(resolveRepoSlugOrThrow(() => undefined), null);
  const timeout = Object.assign(new Error('spawnSync gh ETIMEDOUT'), { code: 'ETIMEDOUT' });
  assert.throws(() => resolveRepoSlugOrThrow(() => { throw timeout; }), (e) => e === timeout);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/bin-lib/issues/claim-store.test.js`
Expected: FAIL — `resolveRepoSlugOrThrow is not a function`

- [ ] **Step 3: Implement**

In `claim-store.js`: add `resolveRepoSlugOrThrow` directly above `resolveRepoSlug` (body: one `runGh([...same args...])` call, `String(out || '').trim()`, `|| null`); rewrite `resolveRepoSlug` as the try/catch wrapper above; add `resolveRepoSlugOrThrow` to `module.exports` next to `resolveRepoSlug`. Update the comment above both to state which one throws.

In `claim-targets.js`: delete `repoSlugOf`; change line 269 to `slug: claimStore.resolveRepoSlugOrThrow(deps.gh)`. Leave the `runClassified`/`isTimeoutError` block exactly as is.

- [ ] **Step 4: Run tests to verify they pass** (AC1 grep + AC2)

Run: `node --test tests/bin-lib/issues/claim-store.test.js tests/bin-lib/claim-targets/claim-targets.test.js tests/bin-lib/claim-targets/cli.test.js`
Expected: PASS, 0 failures (claim-targets suites include the gh-present happy path and `fail.repoView` / `(slug-1..3)` failing-`gh repo view` cases — AC2)

Run: `git grep -n "'repo', 'view'" -- plugin/bin/lib/claim-targets/claim-targets.js`
Expected: no output (AC1 — no private `gh repo view` resolver left)

Run: `git diff --stat -- tests/bin-lib/claim-targets/`
Expected: no output (AC2 — claim-targets tests unchanged)

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/issues/claim-store.js plugin/bin/lib/claim-targets/claim-targets.js tests/bin-lib/issues/claim-store.test.js
git commit -m "Share a throwing repo-slug resolver from claim-store — claim-targets drops its private repoSlugOf, refs #3438"
```

---

## Self-review

- **Spec coverage:** Deliverable 1 decided in Architecture (classification needs the throw). Deliverable 2 / AC1 → Task 1 Step 3 + Step 4 grep. AC2 → Task 1 Step 4 (claim-targets suites unchanged and passing, incl. failing-`repo view` cases).
- **Sole site:** `git grep -n "repoSlugOf" -- plugin/bin/lib/claim-targets` → lines 127 (def) and 269 (only call). `resolveRepoSlug`'s only internal caller is `createClaimReader` (`claim-store.js:307`), whose contract is unchanged. `plugin/bin/lib/hooks/git-exec.js`'s `repoSlugOf(repoRoot)` is an unrelated git-remote parser — out of scope.
- **Placeholders:** none.
