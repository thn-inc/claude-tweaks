# check-sibling-sessions "#N" record-ref normalization (#3768) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `check-sibling-sessions --record "#77"` reports the same live-worktree conflict as `--record 77`.

**Architecture:** One normalization helper in `plugin/bin/lib/hooks/sibling-sessions.js` strips a single leading `#` from a numeric record ref, using the same numeric shape `findLiveClaim` already accepts (`/^#?[1-9]\d*$/`). `matchesRecordRef` tokenizes the normalized ref, so `findConflictingSession` (the worktree half) and `findLiveClaim` (the claim half, already `#`-tolerant) agree on every ref form. Slug refs pass through untouched.

**Tech Stack:** Node 18+, CommonJS, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-10-20T224802-record-3768/work/3768-spec.md` (materialized from GitHub issue #3768)

Scope keywords: matchesRecordRef, findConflictingSession

## Global Constraints

- Normalize one leading `#` from a **numeric** record ref only; slug refs (e.g. `spec-3412`) are untouched.
- The module keeps failing open — the helper never throws, and a non-string ref is handled like today (`String(...)`).
- Tests use frozen `git worktree list --porcelain` fixtures (the file's existing `porcelainWith`/`stubRun` helpers), never live git output ([IL-80]).

## Review Focus

- `#77` vs `77` against a live worktree on `worktree-dispatch-record-77` — must return the identical match object (pinned in Task 1, AC1.1).
- A slug ref `spec-3412` against `flow-spec-3412` — must match exactly as before (pinned in Task 1, AC2.1).
- A `#`-prefixed non-numeric ref (`#spec-3412`) — must NOT be rewritten (the rule is numeric-only); pinned in Task 1.
- Token boundary still holds after normalization: `#19` must not match `flow-spec-192-193` (pinned in Task 1).
- `#0` / `#077` — outside `findLiveClaim`'s `[1-9]\d*` shape, so left as-is; the two halves stay consistent. Not separately tested (no caller emits them).

## Sole-site evidence

`grep -rn "findConflictingSession\|matchesRecordRef" plugin` → the only call site outside the module is `plugin/bin/hooks.js:1426` (`siblingSessions.findConflictingSession(recordRef, { cwd: process.cwd() })`); `matchesRecordRef` is called only at `sibling-sessions.js:154`. Normalizing inside `matchesRecordRef` therefore covers every worktree-half caller, and `hooks.js` needs no edit (Key Files listed it as a candidate site; the spec allows either).

---

### Task 1: Normalize a leading `#` on numeric record refs in `matchesRecordRef`

**Files:**
- Modify: `plugin/bin/lib/hooks/sibling-sessions.js:70-74` (`matchesRecordRef`), plus a new helper beside it and its export at `:248`
- Test: `tests/hooks-sibling-sessions.test.js`

**Interfaces:**
- Produces: `normalizeRecordRef(recordRef: unknown) -> string` — exported from `sibling-sessions.js`. Returns `String(recordRef)` with one leading `#` removed when the remainder matches `/^[1-9]\d*$/`; otherwise returns `String(recordRef)` unchanged. (`null`/`undefined` callers are already short-circuited by `findConflictingSession`; `matchesRecordRef` must still tolerate them via `String(recordRef || '')`-equivalent behavior — `tokenize` already maps empty to `[]`.)
- `matchesRecordRef(entry, recordRef)` — signature unchanged; tokenizes `normalizeRecordRef(recordRef)`.

- [ ] **Step 1: Write the failing tests** (append to `tests/hooks-sibling-sessions.test.js`, update the require on line 7 to also pull `normalizeRecordRef`)

```js
test('AC1.1: findConflictingSession reports the same worktree conflict for "#77" and "77"', () => {
  const porcelain = porcelainWith({
    path: '/repo/.claude/worktrees/dispatch-record-77',
    branch: 'worktree-dispatch-record-77',
    lockReason: `claude session x (pid ${process.pid} start Fri Aug  7 14:40:15 2026)`,
  });
  const expected = { path: '/repo/.claude/worktrees/dispatch-record-77', branch: 'worktree-dispatch-record-77', pid: process.pid };
  assert.deepStrictEqual(findConflictingSession('77', { run: stubRun(porcelain), sessionId: null }), expected);
  assert.deepStrictEqual(findConflictingSession('#77', { run: stubRun(porcelain), sessionId: null }), expected);
});

test('AC2.1: a slug ref matches exactly as before; a #-prefixed slug is not rewritten', () => {
  assert.strictEqual(matchesRecordRef({ branch: 'flow-spec-3412', path: '/x' }, 'spec-3412'), true);
  assert.strictEqual(normalizeRecordRef('spec-3412'), 'spec-3412');
  assert.strictEqual(normalizeRecordRef('#spec-3412'), '#spec-3412');
  assert.strictEqual(matchesRecordRef({ branch: 'flow-spec-3412', path: '/x' }, '#spec-3412'), false);
});

test('normalizeRecordRef strips one leading # from a numeric ref only, and the token boundary still holds', () => {
  assert.strictEqual(normalizeRecordRef('#77'), '77');
  assert.strictEqual(normalizeRecordRef('77'), '77');
  assert.strictEqual(normalizeRecordRef(77), '77');
  assert.strictEqual(matchesRecordRef({ branch: 'flow-spec-192-193', path: '/x' }, '#19'), false);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/hooks-sibling-sessions.test.js`
Expected: FAIL — `normalizeRecordRef is not a function` (and, once the helper exists without being wired in, the AC1.1 `#77` assertion fails with `null` vs the expected object).

- [ ] **Step 3: Implement `normalizeRecordRef` and use it in `matchesRecordRef`**

Add the helper directly above `matchesRecordRef` with a two-line comment naming why (the `#77` needle never equals branch token `77`; `findLiveClaim` already accepts `#N`, so both halves must agree). Use `String(recordRef).replace(/^#(?=[1-9]\d*$)/, '')`. In `matchesRecordRef`, replace `tokenize(recordRef)` with `tokenize(normalizeRecordRef(recordRef))` — guard `null`/`undefined` so `tokenize` still receives `''` (e.g. `recordRef == null ? '' : normalizeRecordRef(recordRef)`). Add `normalizeRecordRef` to `module.exports`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/hooks-sibling-sessions.test.js`
Expected: PASS, all tests (existing + 3 new), 0 failures.

- [ ] **Step 5: AC3.1 go-red check — revert the normalization and confirm the `#77` test goes red**

Temporarily change `matchesRecordRef` back to `tokenize(recordRef)` (keep the helper exported so the require still resolves), run `node --test tests/hooks-sibling-sessions.test.js`, and confirm the `AC1.1` test FAILS on the `'#77'` assertion (`null` !== expected). Restore the normalized line in the same step and re-run to PASS. Do not commit the reverted state.

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/lib/hooks/sibling-sessions.js tests/hooks-sibling-sessions.test.js
git commit -m "Normalize leading # on numeric record refs in check-sibling-sessions — refs #3768"
```

---

## Self-review

- **Spec coverage:** Deliverable 1 (normalize one leading `#` on numeric refs before both halves, slugs untouched) → Task 1 Step 3; Deliverable 2 (`#77` worktree-conflict test) → Task 1 Step 1 `AC1.1`. AC1.1 → `AC1.1` test; AC2.1 → `AC2.1` test; AC3.1 → Step 5 go-red revert.
- **Placeholders:** none.
- **Proportion:** one task, one source file, one test file.
