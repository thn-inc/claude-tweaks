# Merge-base anchor for every verify-scope declaration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A scoped `verify.js --scope … --integration-branch {ref}` run with no stamp anchor diffs the branch against the merge-base for every declaration, not only one with an `impact` block.

**Architecture:** One condition in `selectScope` (`plugin/bin/lib/verify/scope.js`) drops its `decl.impact` gate, so `fallbackBase` (already computed by `verify.js` for any declaration) anchors every declaration. Tests that relied on the old no-stamp full fallback get fixtures that select their suites by rule; comments and prose that say only an impact declaration anchors are corrected.

**Tech Stack:** Node 18+, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-11-25T085518-record-6102/work/6102-spec.md` (record #6102)

Scope keywords: fallbackBase

## Global Constraints

- Explicit `--base` never anchors: `verify.js` passes `fallbackBase: null` then; do not change that.
- `decl: null` stays `full`. `stamp: null` with `fallbackBase: null` stays `full` for any declaration.
- An `impact` declaration's unanchored `no-anchor` fallback reason is unchanged.
- `verify.js` changes are comment-only (lane ct-verify-ci is editing its CI-source code concurrently).
- `plugin/skills/test/verification.md` is 51934 bytes against the 52500-byte `RAIL_BYTES` rail: its edit must not grow the file (measure `wc -c` before and after; net delta ≤ 0). `plugin/skills/test/impact-selection.md`'s `no-anchor` row stays as is.
- Intermediate commits reference the record as `refs #6102`, never `closes`/`fixes`.

## Review Focus

- A feature branch with zero own commits (merge-base == HEAD) and no stamp: the changed set is empty, so a declaration now selects `none` and stamps instead of running `full`. Fixtures that need a genuine full first pass must get it from an explicit `--base {trunk}` (which never anchors), not from the removed fallback — Task 1 Step 5.
- A rebase-stranded stamp (anchor no longer an ancestor of HEAD) on a non-impact declaration with `--integration-branch` now anchors on the merge-base too; it previously forced `full`. Covered by the same `fallbackBase` path in `verify.js` — no new code, but the CLI case in Task 1 proves the no-stamp half.
- Scoped selections sort suite names (`[...selected].sort()`), while `suites: '*'` keeps declaration order. The #3511 fixture must keep `unit` (failing at base) running before `other`, so it selects both via a `'*'` rule (Task 1 Step 4), never `['unit','other']` with `static: false`.
- The new stamp written for a non-full first pass records `fullSha` = the merge-base, so the following `--stamp-status` reports `verifiedHead: true` (AC 4).
- Prose elsewhere that says the first run is always `full` (journey step 8; test comments at `tests/bin-lib/verify/cli.test.js:738/792/1064/1268`, `impact-cli.test.js:469`, `scope.test.js:36`) must be corrected only where it is now false (a run that passes `--integration-branch`).

---

### Task 1: Anchor every declaration on the merge-base, with its tests

**Files:**
- Modify: `plugin/bin/lib/verify/scope.js` (line 53 condition; header comment lines 6-9 and 17-19)
- Test: `tests/bin-lib/verify/scope.test.js` (replace the `no impact block is unchanged: no impact key, fallbackBase ignored` test, ~line 300)
- Test: `tests/bin-lib/verify/cli-scope-integration.test.js` (`scopedBaselineRepo` fixture + AC1.1 comment; new AC 4 CLI case; any fixture relying on the old fallback, e.g. `anchorFullPass`)
- Modify (only if the run shows them relying on the old fallback): `tests/bin-lib/verify/cli.test.js`, `tests/bin-lib/verify/impact-cli.test.js`

**Interfaces:**
- Consumes: `selectScope({ decl, files, stamp, statuses, impact, fallbackBase })` — unchanged signature.
- Produces: same return shape; only the anchoring rule widens.

- [ ] **Step 1: Write the failing tests in `tests/bin-lib/verify/scope.test.js`**

Replace the `no impact block is unchanged: no impact key, fallbackBase ignored` test with:
- `test('no impact block: no impact key in any result', …)` keeping the existing `decl: null` + `STAMP` deepStrictEqual and the `'impact' in …` loop (drop only the final `fallbackBase ignored` assertion).
- `test('no stamp + fallbackBase anchors a declaration without impact on the merge-base (#6102 AC1-2)', …)` with `const MB = 'fedcba9876543210fedcba9876543210fedcba98'`:
  - `selectScope({ decl: EXAMPLE, files: ['docs/x.md'], stamp: null, fallbackBase: MB })` → `mode === 'none'`, `base === MB`.
  - `files: ['apps/api/src/a.ts']` → `mode === 'scoped'`, `suites` deepStrictEqual `['api']`, `base === MB`.
  - `files: ['unknown/path.txt']` → `mode === 'full'`, `suites === '*'`, `base === MB`.
- `test('no stamp: decl null or no fallbackBase stays full (#6102 AC3)', …)`:
  - `selectScope({ decl: null, files: ['a.js'], stamp: null, fallbackBase: MB }).mode === 'full'`.
  - `selectScope({ decl: EXAMPLE, files: ['docs/x.md'], stamp: null, fallbackBase: null })` → `mode === 'full'`, `base === null`.

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/bin-lib/verify/scope.test.js`
Expected: FAIL — the AC1-2 test gets `mode: 'full'`, `base: null`.

- [ ] **Step 3: Implement in `plugin/bin/lib/verify/scope.js`**

Line 53 becomes `if (base === null && decl) base = fallbackBase || null;`. Rewrite the header comment's two sentences that say the fallback anchors an impact declaration so they say it anchors any declaration (an explicit `--base` never does). Leave the unanchored-impact `no-anchor` block below unchanged.

- [ ] **Step 4: Fix the #3511 fixture in `tests/bin-lib/verify/cli-scope-integration.test.js`**

In `scopedBaselineRepo`, change the `src/**` rule to `{ match: 'src/**', suites: '*', static: true }` so the branch's own diff selects every suite by rule (mode `full` by rule, `suites` in declared order `unit`, `other`; `types`/`lint` are undeclared, so `static: true` adds no check). Update the AC1.1 comment ("No prior stamp anchor → … forces mode full") to say the `src/**` rule selects every suite. Keep every existing assertion, including `report.scope.suites` deepStrictEqual `['unit', 'other']`.

- [ ] **Step 5: Add the AC 4 CLI case and fix fallback-reliant tests**

Add `test('--scope --integration-branch: no stamp, a declaration without impact, a bookkeeping-only branch diff runs no suite and stamps the merge-base (#6102 AC4)', …)`:
- `const r = scopedRepo([{ match: 'src/**', suites: ['unit'], static: false }, { match: 'docs/plans/*-ledger.md', suites: [], static: false }]);` then `r.git('checkout', '-q', '-b', 'feat')`, `commitFile(r, 'docs/plans/x-ledger.md', 'x')`.
- Run `runCli(['--scope', r.declPath, '--integration-branch', r.branch, '--cmd', \`unit=${r.unitCmd}\`, '--cmd', 'other=node -e 0'], { cwd: r.repo })`.
- Assert: exit 0; `stdout` matches `/still-verified: bookkeeping-only delta \(docs\/plans\/x-ledger\.md\)/`; `fs.existsSync(r.marker) === false` (no suite spawned); `stampOf(r.gitDir).fullSha === r.git('merge-base', 'HEAD', r.branch).trim()`.
- Then `runCli(['--stamp-status'], { cwd: r.repo })` → parse stdout JSON, `verifiedHead === true`.

Then run the whole verify test directory (Step 6). For every other failure caused by the removed fallback (a test expecting a no-stamp `full` while passing `--integration-branch`, e.g. `anchorFullPass` asserting `/^Scope: full/` on a branch with no own commits), make the fixture produce that result by its own means — pass `--base {trunk}` instead of `--integration-branch` for the anchoring run (explicit `--base` never anchors), or a diff/rule that selects every suite — and correct any comment that says the first run is always full where the run passes `--integration-branch`. Do not change assertions that test something else.

- [ ] **Step 6: Run to verify it passes**

Run: `node --test tests/bin-lib/verify/`
Expected: PASS, 0 failures.

- [ ] **Step 7: Commit**

```bash
git add plugin/bin/lib/verify/scope.js tests/bin-lib/verify/scope.test.js tests/bin-lib/verify/cli-scope-integration.test.js
git commit -m "Anchor every verify-scope declaration on the merge-base — no stamp no longer forces full without impact (refs #6102)"
```
(add `cli.test.js` / `impact-cli.test.js` by explicit path if Step 5 changed them)

### Task 2: Correct comments and prose

**Files:**
- Modify: `plugin/bin/verify.js:745-751` (comment only)
- Modify: `plugin/skills/test/verification.md` (Re-verify scoping: Build Common Step 5 row ~line 82; anchor clause ~line 101)
- Modify: `docs/journeys/run-a-deterministic-verification-check.md:90`

**Interfaces:**
- Consumes: Task 1's behavior (any declaration anchors on the `--integration-branch` merge-base with no stamp).
- Produces: nothing code-level.

- [ ] **Step 1: Confirm the prose is still stale**

Run: `grep -n "merge-base for any declaration" plugin/skills/test/verification.md`
Expected: FAIL (no match, exit 1).

- [ ] **Step 2: `plugin/bin/verify.js` comment**

In the comment above `const fallbackBase = …` (lines ~745-751), state that with no usable stamp anchor the `--integration-branch` merge-base anchors any declaration (not only an impact one), and an explicit `--base` never does. No code change.

- [ ] **Step 3: `plugin/skills/test/verification.md`**

Record `wc -c` first. In the paragraph at ~line 101, replace the stranded-stamp clause "— or, under `impact`, anchors on `--integration-branch`'s merge-base (`impact-selection.md`)" so it states: with no usable stamp anchor (none yet, or one stranded by a rebase), a scoped run diffs against the `--integration-branch` merge-base for any declaration; with an explicit `--base` it runs full. Correct the Build Common Step 5 row so it no longer implies a first run without `impact` is full (e.g. "…full without a declaration; with no stamp yet, diffed from the merge-base"). The literal phrase `merge-base for any declaration` must appear. Trim wording in the same paragraph so `wc -c` does not grow. Leave `impact-selection.md` untouched.

- [ ] **Step 4: Journey line 90**

Replace "The first run has no prior stamp, so it is `full` and becomes the anchor (`fullSha`) every later run diffs from." with a sentence saying a first run given `--integration-branch` diffs against the merge-base (which becomes the stamp's `fullSha`), and one without it is `full` and becomes the anchor. Keep the rest of the bullet.

- [ ] **Step 5: Verify**

Run: `grep -n "merge-base for any declaration" plugin/skills/test/verification.md` → one match. `wc -c plugin/skills/test/verification.md` → ≤ 51934. Then `node --test tests/test-skill-affected-conformance.test.js tests/verification-skip-before-execute.test.js tests/pipelines-push-first-local-runs-conformance.test.js` → PASS.

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/verify.js plugin/skills/test/verification.md docs/journeys/run-a-deterministic-verification-check.md
git commit -m "Correct merge-base anchor prose — any declaration, not only impact (refs #6102)"
```
