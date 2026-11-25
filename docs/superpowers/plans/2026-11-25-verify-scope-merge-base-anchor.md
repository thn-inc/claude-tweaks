# Merge-base anchor for CI-declared verify-scope declarations — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A scoped `verify.js --scope … --integration-branch {ref}` run with no stamp anchor diffs the branch against the merge-base when the declaration has an `impact` block **or a `ci` block** (record #6102, Decision: Reading B); a declaration with neither stays `full`.

**Architecture:** One condition in `selectScope` (`plugin/bin/lib/verify/scope.js:53`) widens from `decl.impact` to `decl.impact || decl.ci`. `verify.js` already computes `fallbackBase` for every declaration. Tests whose fixtures carry a `ci` block and relied on the old no-stamp full fallback get fixtures that reach `full` by their own diff; comments and prose that say only an impact declaration anchors are corrected.

**Tech Stack:** Node 18+, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-11-25T090555-record-6102/work/6102-spec.md` (record #6102)

Scope keywords: fallbackBase

## Global Constraints

- Family rule (spec Decision): the merge-base fallback applies iff no usable stamp anchor, `--integration-branch` given, no explicit `--base`, and `decl.impact || decl.ci`. Everything else behaves exactly as today. Never key it on policy (`integration-model`) — `verify.js` does not read policy.
- Explicit `--base` never anchors: `verify.js` passes `fallbackBase: null` then; do not change that.
- `decl: null` stays `full`. `stamp: null` with `fallbackBase: null` stays `full` for any declaration. A declaration with neither `impact` nor `ci` stays `full` with no stamp.
- An `impact` declaration's unanchored `no-anchor` fallback reason is unchanged.
- `verify.js` changes are comment-only (lane ct-verify-ci is editing its CI-source code concurrently).
- `plugin/skills/test/verification.md` is 51934 bytes against the 52500-byte `RAIL_BYTES` rail: its edit must not grow the file (net delta ≤ 0). `plugin/skills/test/impact-selection.md`'s `no-anchor` row stays as is.
- `tools/run-tests.js:577` also calls `selectScope` with `fallbackBase`, but `selectChangedTests` returns before it for a declaration without `impact` (line 571), so it needs no change (plan audit Check B, reviewed).
- Intermediate commits reference the record as `refs #6102`, never `closes`/`fixes`.

Waived tests/bin-lib/verify/impact-cli.test.js: read only, for the existing merge-base-anchor CLI pattern; its declarations carry `impact`, which already anchored, so no change.

## Review Focus

- **Fixtures whose integration branch is HEAD's own branch.** `tests/bin-lib/verify/ci-cli.test.js`'s `repoWith` declares `ci` (by default) and passes `--integration-branch r.branch` where `r.branch` is the branch HEAD is on, with no stamp. After this change the merge-base equals HEAD, the changed set is empty, the selection is `none`, and CI is never consulted — every CI-answer case would break. Task 1 Step 5 moves the `head` commit onto a feature branch so the diff (the declaration + `extraFiles`, matched by the `'**' → '*'` rule) reaches `full` by rule.
- A declaration with a `ci` block whose branch diff is bookkeeping-only selects `none`; `verify.js`'s CI consult is guarded by `sel.mode !== 'none'` (line ~977), so no `gh` call happens (AC 4 asserts no suite spawned).
- An empty `ci: {}` block parses to a non-null object, so it anchors too — consistent with "the declaration carries a `ci` block".
- Scoped selections sort suite names (`[...selected].sort()`), while `suites: '*'` keeps declaration order. The #3511 fixture must keep `unit` (failing at base) before `other`, so it selects both via a `'*'` rule, never `['unit','other']`.
- The stamp written for a non-full first pass records `fullSha` = the merge-base, so the following `--stamp-status` reports `verifiedHead: true` (AC 4).

---

### Task 1: Anchor `impact` or `ci` declarations on the merge-base, with its tests

**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/verify/scope.js` (line 53 condition; header comment lines 6-9 and 17-19)
- Test: `tests/bin-lib/verify/scope.test.js` (replace the `no impact block is unchanged: no impact key, fallbackBase ignored` test, line 300)
- Test: `tests/bin-lib/verify/cli-scope-integration.test.js` (`scopedBaselineRepo` rule + AC1.1 comment; new AC 4 CLI case)
- Test: `tests/bin-lib/verify/ci-cli.test.js` (`repoWith` fixture, lines 76-101)
- Modify only if Step 6 shows them relying on the old fallback: any other test file the run names

**Interfaces:**
- Consumes: `selectScope({ decl, files, stamp, statuses, impact, fallbackBase })` — unchanged signature.
- Produces: same return shape; only the anchoring rule widens to `decl.impact || decl.ci`.

- [ ] **Step 1: Write the failing tests in `tests/bin-lib/verify/scope.test.js`**

Covers AC1.1, AC1.2, AC2.1, AC2.2, AC3.1, AC3.2.

`const MB = 'fedcba9876543210fedcba9876543210fedcba98'`; `EXAMPLE_WITH_CI` = `decl(...)` over the same JSON as `EXAMPLE` plus `ci: { api: { workflow: 'test.yml', job: 'api' } }` (parsed through `readDeclaration`, like `EXAMPLE`; hoist the JSON into a const both share). Replace the `no impact block is unchanged: no impact key, fallbackBase ignored` test with:
- `test('no impact block: no impact key in any result', …)` keeping the existing `decl: null` + `STAMP` deepStrictEqual and the `'impact' in …` loop.
- `test('no stamp + fallbackBase anchors a declaration with a ci block on the merge-base (#6102 AC1-2)', …)`:
  - `selectScope({ decl: EXAMPLE_WITH_CI, files: ['docs/x.md'], stamp: null, fallbackBase: MB })` → `mode === 'none'`, `base === MB`.
  - `files: ['apps/api/src/a.ts']` → `mode === 'scoped'`, `suites` deepStrictEqual `['api']`, `base === MB`.
  - `files: ['unknown/path.txt']` → `mode === 'full'`, `suites === '*'`.
- `test('no stamp: a declaration with neither impact nor ci, decl null, or no fallbackBase stays full (#6102 AC1, AC3)', …)`:
  - `selectScope({ decl: EXAMPLE, files: ['docs/x.md'], stamp: null, fallbackBase: MB })` → `mode === 'full'`, `base === null`.
  - `selectScope({ decl: null, files: ['a.js'], stamp: null, fallbackBase: MB }).mode === 'full'`.
  - `selectScope({ decl: EXAMPLE_WITH_CI, files: ['docs/x.md'], stamp: null, fallbackBase: null })` → `mode === 'full'`, `base === null`.

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/bin-lib/verify/scope.test.js`
Expected: FAIL — the AC1-2 test gets `mode: 'full'`, `base: null`.

- [ ] **Step 3: Implement in `plugin/bin/lib/verify/scope.js`**

Line 53 becomes `if (base === null && decl && (decl.impact || decl.ci)) base = fallbackBase || null;`. Rewrite the header comment's sentences (lines 7-8, 17-19) so they say the fallback anchors a declaration with an `impact` or a `ci` block (one with neither runs full; an explicit `--base` never anchors). Leave the unanchored-impact `no-anchor` block unchanged.

- [ ] **Step 4: Fix the #3511 fixture in `tests/bin-lib/verify/cli-scope-integration.test.js`**

In `scopedBaselineRepo`, change the `src/**` rule to `{ match: 'src/**', suites: '*', static: true }` so the branch's own diff selects every suite by rule (`suites` in declared order `unit`, `other`; `types`/`lint` are undeclared, so `static: true` adds no check). Update the AC1.1 comment ("No prior stamp anchor → selectScope forces mode full") to say the `src/**` rule selects every suite. Keep every existing assertion, including `report.scope.suites` deepStrictEqual `['unit', 'other']`.

- [ ] **Step 5: AC 4 CLI case, and the `ci-cli.test.js` fixture**

Add to `cli-scope-integration.test.js` `test('--scope --integration-branch: no stamp, a ci declaration without impact, a bookkeeping-only branch diff runs no suite and stamps the merge-base (#6102 AC4)', …)`:
- `const r = scopedRepo([{ match: 'src/**', suites: ['unit'], static: false }, { match: 'docs/plans/*-ledger.md', suites: [], static: false }], { ci: { unit: { workflow: 'test.yml', job: 'unit' } } });` then `r.git('checkout', '-q', '-b', 'feat')`, `commitFile(r, 'docs/plans/x-ledger.md', 'x')`.
- `runCli(['--scope', r.declPath, '--integration-branch', r.branch, '--cmd', \`unit=${r.unitCmd}\`, '--cmd', 'other=node -e 0'], { cwd: r.repo })`.
- Assert: exit 0; stdout matches `/still-verified: bookkeeping-only delta \(docs\/plans\/x-ledger\.md\)/`; `fs.existsSync(r.marker) === false`; `stampOf(r.gitDir).fullSha === r.git('merge-base', 'HEAD', r.branch).trim()`.
- Then `runCli(['--stamp-status'], { cwd: r.repo })` → parsed stdout `verifiedHead === true`.

In `ci-cli.test.js`'s `repoWith`: record `const branch = git('symbolic-ref', '--short', 'HEAD').trim()` after the base commit, then `git('checkout', '-q', '-b', 'feature')` before writing the declaration and `extraFiles`, and return that base `branch` (the integration branch). The `head` commit's diff (`.claude-tweaks/verify-scope.json` + `extraFiles`) then matches the `'**' → '*'` rule, so every CI case still reaches `full` by rule. `baseSha` is unchanged. Do not change assertions. Right after this fixture change, run `node --test tests/bin-lib/verify/ci-cli.test.js` and confirm the #4347 AC2 case (`--baseline r.baseSha`) still adjudicates `tests/env.test.js` as baseline — the merge-base and the `--baseline` tip now coincide, so re-confirm the fork-point premise rather than assume it.

- [ ] **Step 6: Run to verify it passes**

Covers AC4.1 (Step 5's CLI case), AC5.1 (Step 4's #3511 fixture), AC5.2 (every other existing test).

Run: `node --test tests/bin-lib/verify/`
Expected: PASS, 0 failures. For any other failure caused by the widened anchor (a `ci` declaration expecting a no-stamp `full` with `--integration-branch`), make the fixture reach that result by its own diff or by `--base {trunk}` (which never anchors), and correct any comment that says the first run is always full. Then run `node --test tests/bin-lib/init/ci-workflow-review.test.js tests/bin-lib/dispatch/artifact-verdict.test.js tests/bin-lib/residue/cli.test.js` (the other `ci`-declaring suites) → PASS.

- [ ] **Step 7: Commit**

```bash
git add plugin/bin/lib/verify/scope.js tests/bin-lib/verify/scope.test.js tests/bin-lib/verify/cli-scope-integration.test.js tests/bin-lib/verify/ci-cli.test.js
git commit -m "Anchor a ci-declared verify scope on the merge-base — no stamp no longer forces full (refs #6102)"
```
(add any other test file Step 6 changed by explicit path)

### Task 2: Correct comments and prose

**Files:**
- Modify: `plugin/bin/verify.js:745-751` (comment only)
- Modify: `plugin/skills/test/verification.md` (Build Common Step 5 row line 82; stranded-stamp clause line 101)
- Modify: `docs/journeys/run-a-deterministic-verification-check.md:90`

**Interfaces:**
- Consumes: Task 1's behavior (an `impact` or `ci` declaration anchors on the `--integration-branch` merge-base with no stamp).
- Produces: nothing code-level.

- [ ] **Step 1: Confirm the prose is still stale**

Run: `grep -n "an \`impact\` or a \`ci\` block" plugin/skills/test/verification.md`
Expected: FAIL (no match, exit 1).

- [ ] **Step 2: `plugin/bin/verify.js` comment**

In the comment above `const fallbackBase = …` (lines ~745-751), state that with no usable stamp anchor the `--integration-branch` merge-base anchors a declaration with an `impact` or a `ci` block (`selectScope` decides), and an explicit `--base` never does. No code change.

- [ ] **Step 3: `plugin/skills/test/verification.md`**

Record `wc -c` first. In line 101, replace "— or, under `impact`, anchors on `--integration-branch`'s merge-base (`impact-selection.md`)" with a clause saying: with no usable stamp anchor (none yet, or one stranded by a rebase), a run whose declaration has an `impact` or a `ci` block diffs against `--integration-branch`'s merge-base instead; an explicit `--base` runs full. In the line 82 Build Common Step 5 row, add that with no stamp yet an `impact`/`ci` declaration diffs from the merge-base. Trim wording in the same paragraph so `wc -c` does not grow. Leave `impact-selection.md` untouched.

- [ ] **Step 4: Journey line 90**

Replace "The first run has no prior stamp, so it is `full` and becomes the anchor (`fullSha`) every later run diffs from." with: a first run whose declaration has an `impact` or a `ci` block and is given `--integration-branch` diffs against the merge-base (which becomes the stamp's `fullSha`); otherwise the first run is `full` and becomes the anchor. Keep the rest of the bullet.

- [ ] **Step 5: Verify**

Run: `grep -n "an \`impact\` or a \`ci\` block" plugin/skills/test/verification.md` → at least one match. `wc -c plugin/skills/test/verification.md` → ≤ 51934. Then `node --test tests/test-skill-affected-conformance.test.js tests/verification-skip-before-execute.test.js tests/pipelines-push-first-local-runs-conformance.test.js` → PASS.

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/verify.js plugin/skills/test/verification.md docs/journeys/run-a-deterministic-verification-check.md
git commit -m "Correct merge-base anchor prose — impact or ci declarations (refs #6102)"
```
