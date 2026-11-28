# verify.js CI sourcing on an inert-dirty tree — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `verify.js --scope` takes CI-declared suites' verdicts from CI when the only dirty paths are inert (declared `generated`, or first matching rule `suites: []` + `static: false`), instead of falling back to a local run with `dirty-tree`.

**Architecture:** A pure `inertDirtyPaths(decl, paths)` in `plugin/bin/lib/verify/scope.js`, sharing a new `firstRuleIndex(decl, file)` with `selectScope`. `verify.js` computes `ciDirtyExempt` once before the CI loop from the porcelain read it already holds, relaxes the `skipCi` dirty guard when it is non-null, and threads `dirtyExempt` onto every CI attempt entry (report.json and the verify event). The pass stamp is untouched.

**Tech Stack:** Node 18+ CommonJS, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-11-25T094433-record-5234/work/5234-spec.md` (record #5234)

Scope keywords: skipCi, ciEventEntries, inertDirtyPaths

## Global Constraints

- `inertDirtyPaths` returns the sorted, de-duplicated `paths` when every path is inert, and `null` otherwise, including for an empty or `null` list (spec Deliverable 1).
- A path no rule matches is never inert: it fails closed, as in `selectScope` (spec Deliverable 1).
- When the dirty path list cannot be read (`null`), the precondition stays `dirty-tree`. `tree-state-unreadable` is unchanged (spec Deliverable 2).
- stdout line, exact: `CI: tree dirty only in inert paths ({paths, comma-joined}) — taking CI verdicts on HEAD` (spec Deliverable 3; comma-joined means `paths.join(', ')`).
- The pass stamp is unchanged: it still records the tree's real `dirty` state (spec Deliverable 4). The stamp-write gate's own `generatedExemption` use (verify.js ~L910 and ~L1533) is not touched.
- Gotcha: #5800 edits the same CI loop; keep the edit to the `skipCi` guard and the entry fields (spec Gotchas).
- `.claude/skills/verify-scope-rule-kind/SKILL.md` (quoted): "`plugin/bin/verify.js` (orchestration, the `report.json` fields, the stdout line, and the `verify` event's hand-listed `impact` subset that `plugin/bin/lib/timing/derive.js` copies into `timing.json`, pinned field-for-field by `tests/bin-lib/verify/impact-cli.test.js`)" — the `ci` event subset (`ciEventEntries`) is hand-listed the same way; `derive.js` copies `v.ci` through unchanged, so no derive edit is needed.
- `.claude/skills/suite-slot-test-env/SKILL.md` (quoted): "A helper that spawns `verify.js` and is given no env defaults the child to `{ ...process.env, CT_TEST_SUITE_SLOT_HELD: '1' }`, never bare `process.env` (... `fakeGhEnv` in `ci-cli.test.js` ...)" — new CLI tests use `fakeGhEnv`, never a hand-built env.
- No other project skill under `.claude/skills/` governs `scope.js`, `verify.js`'s CI loop, `ci-source.md` or `verification.md` (grep for `verify/scope`, `bin/verify.js`, `ci-source` matched only the two above plus skills about slots, Windows paths and node-test output parsing, none of which apply to this change).
- Byte rail: `plugin/skills/test/verification.md` is 52,187 B against `RAIL_BYTES` 52,500 — **313 B headroom**. Task 3's qualifier must add at most ~120 B there; `ci-source.md` is 8,366 B (ample).

## Review Focus

1. A rename where only one side is inert — `dirtyFilePaths` lists both sides; one non-inert side must keep `dirty-tree`. Covered by the AC4 mixed test's principle; unit test "mix returns null" pins it.
2. An `impact: true` rule (its parsed `suites` is `null`) matching a dirty path — must not be inert. Task 1 test `impact rule is not inert`.
3. `startGit.dirty === null` (unreadable) — must stay `tree-state-unreadable`, never exempted. Task 2 keeps the guard order (exempt only when `startGit.dirty === true`).
4. A dirty path matching both a `generated` glob and a selecting rule — inert (generated wins, as `generatedExemption` treats it). Task 1 test `generated glob wins over a selecting rule`.
5. Under `localRuns: "on-request"`, an inert-only dirty tree must not exit 3 (AC5).

---

### Task 1: `inertDirtyPaths` in scope.js

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/verify/scope.js` (add `firstRuleIndex`, use it in `selectScope`'s loop at the `decl.rules.findIndex(...)` line, add and export `inertDirtyPaths`)
- Test: `tests/bin-lib/verify/scope.test.js`

**Interfaces:**
- Produces: `firstRuleIndex(decl, file) -> number` (index into `decl.rules`, `-1` when none) and `inertDirtyPaths(decl, paths: string[]|null) -> string[]|null`, both exported: `module.exports = { selectScope, inertDirtyPaths, firstRuleIndex }`.

- [ ] **Step 1: Write the failing tests** in `tests/bin-lib/verify/scope.test.js`, importing `inertDirtyPaths` beside `selectScope`, using the file's `decl()` helper. Fixture declaration `INERT`:
  `checks: { tests: 'npm test' }`, `generated: ['gen/**']`, `rules: [{ match: 'src/**', suites: '*', static: true }, { match: 'docs/plans/*-ledger.md', suites: [], static: false }, { match: 'lintme/**', suites: [], static: true }, { match: 'docs/**', suites: [], static: false }]`.
  For the "first match wins" case add a separate decl with rules `[{ match: 'docs/special.md', suites: '*', static: false }, { match: 'docs/**', suites: [], static: false }]`. For the impact case, a decl with an `impact` block and rule `{ match: 'lib/**', impact: true, static: false }` (shape per existing impact tests in this file).
  Tests (names carry the AC clause id):
  - `AC1.1: a single path whose first matching rule is suites [] static false is inert` — `inertDirtyPaths(INERT, ['docs/plans/x-ledger.md'])` deepEquals `['docs/plans/x-ledger.md']`.
  - `AC1.2: a path matching a generated glob is inert` — `['gen/out.json']` → `['gen/out.json']`.
  - `AC1.3: one inert path and one selecting path is not inert` — `['docs/plans/x-ledger.md', 'src/a.js']` → `null`.
  - `AC1.4: an unmatched path is not inert` — `['other/x.js']` → `null`.
  - `AC1.5: the first matching rule decides, not a later inert one` — `['docs/special.md']` on the first-match decl → `null`.
  - `AC1.6: a static true rule with suites [] is not inert` — `['lintme/a.js']` → `null`.
  - `AC1.7: an empty or null list is not inert` — `[]` → `null` and `null` → `null`.
  - `an impact rule is not inert` — `['lib/a.js']` on the impact decl → `null`.
  - `generated glob wins over a selecting rule` — `['gen/x.js']` on a decl whose `generated: ['gen/**']` and rule `{ match: '**', suites: '*', static: true }` → `['gen/x.js']`.
  - `result is sorted and de-duplicated` — `['docs/b.md', 'docs/a.md', 'docs/b.md']` → `['docs/a.md', 'docs/b.md']`.

- [ ] **Step 2: Run to verify failure**

Run: `node --test tests/bin-lib/verify/scope.test.js`
Expected: FAIL (`inertDirtyPaths is not a function`).

- [ ] **Step 3: Implement** in `plugin/bin/lib/verify/scope.js`:
  - `firstRuleIndex(decl, file)` = `decl.rules.findIndex((r) => globToRegExp(r.match).test(file))`; `selectScope` calls it in place of its inline `findIndex` (pure refactor, no behavior change).
  - `inertDirtyPaths(decl, paths)`: `null` for a falsy `decl`, `null`/empty `paths`; a path is inert when it matches any `decl.generated` glob (`globToRegExp`), or its `firstRuleIndex` rule is not `-1` and has `Array.isArray(rule.suites) && rule.suites.length === 0 && rule.static === false && !rule.impact`. All inert → `[...new Set(paths)].sort()`, else `null`. Add a short header-comment line naming #5234.

- [ ] **Step 4: Run to verify pass**

Run: `node --test tests/bin-lib/verify/scope.test.js`
Expected: PASS, all prior tests still green.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/verify/scope.js tests/bin-lib/verify/scope.test.js
git commit -m "Add inertDirtyPaths to verify scope — refs #5234"
```

### Task 2: CI-source precondition exemption in verify.js

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/verify.js` (require of `./lib/verify/scope` at L50; `ciEventEntries` at ~L222; the CI loop at ~L1017-1045)
- Test: `tests/bin-lib/verify/ci-cli.test.js` (new tests + existing `ev.ci`/`noVerdict.ci`/`local.ci` deepStrictEqual pins at L238, L253, L449-452, L610-613, L693-696, L744, L747 gain `dirtyExempt: null`)
- Modify: `tests/bin-lib/verify/impact-cli.test.js` (the `report().ci` deepStrictEqual at ~L627-630 gains `dirtyExempt: null`)

**Interfaces:**
- Consumes: `inertDirtyPaths(decl, paths)` from Task 1; `dirtyFilePaths(execImpl, status)` from `./lib/verify/report` (already imported); `scopeStatusRead` (already held, L569/L760).
- Produces: every CI attempt object in `ciAttempts` carries `dirtyExempt: string[]|null`; `ciEventEntries` returns `{ suite, used, fallback, dirtyExempt }`.

- [ ] **Step 1: Write the failing tests** in `tests/bin-lib/verify/ci-cli.test.js`, using `repoWith`, `fakeGhEnv`, `ciLogOf`, `SCOPE`, `KEY`, `ciRunDir`, `eventsOf`, `reportOf` as the neighbouring tests do. Inert declaration: `declExtra: { rules: [{ match: 'notes.md', suites: [], static: false }, { match: '**', suites: '*', static: false }] }` with `extraFiles: { 'notes.md': 'a\n' }` (committed by `repoWith`). The fake gh is `fakeGhEnv('green', ciLogOf(r, ['tests/ok.test.js']))`; the local-run marker is `localMarkerCmd(marker)`.
  - `AC2.1: a tree dirty only in an inert tracked path takes the CI verdict and prints the inert line (#5234)` — edit `notes.md`; run with `--run ciRunDir(r)`; assert `code === 0`, marker absent, `fs.existsSync(calls)` true, stdout matches `/^CI: tree dirty only in inert paths \(notes\.md\) — taking CI verdicts on HEAD$/m` and `/^CI: tests — taken from test\.yml/m`; `reportOf(r).ci[0].used === true`.
  - `AC2.2: its report.json CI entry and verify event carry dirtyExempt (#5234)` — may be the same test as AC2.1 (cite both ids in its name): `reportOf(r).ci[0].dirtyExempt` deepEquals `['notes.md']`; event `ci` deepEquals `[{ suite: 'tests', used: true, fallback: null, dirtyExempt: ['notes.md'] }]`.
  - `AC3.1: an untracked inert path behaves the same (#5234)` — declaration without `notes.md` in `extraFiles`; after `repoWith`, write `notes.md` untracked; same assertions as AC2.1 (code 0, marker absent, CI used, line printed, `dirtyExempt: ['notes.md']`).
  - `AC4.1: an inert path plus a dirty source file still records dirty-tree and runs locally (#5234)` — edit `notes.md` and `tests/ok.test.js`; assert marker present, `reportOf(r).ci[0].fallback === 'dirty-tree'`, `reportOf(r).ci[0].dirtyExempt === null`, `fs.existsSync(calls)` false, stdout does not match `/tree dirty only in inert paths/`.
  - `AC5.1: under localRuns on-request an inert-only dirty tree does not exit 3 (#5234)` — `declExtra` = the inert rules plus `...KEY`; edit `notes.md`; assert `code === 0`, CI used, marker absent.
  - Update the seven existing event-`ci` pins and the impact-cli report pin listed in Files to include `dirtyExempt: null`.

- [ ] **Step 2: Run to verify failure**

Run: `node --test tests/bin-lib/verify/ci-cli.test.js`
Expected: FAIL — the new tests (CI not consulted, `fallback: 'dirty-tree'`) and the updated pins (`dirtyExempt` missing).

- [ ] **Step 3: Implement** in `plugin/bin/verify.js`:
  - Import `inertDirtyPaths` with `selectScope`.
  - `ciEventEntries`: add `dirtyExempt: a.dirtyExempt ?? null`.
  - Inside `if (decl && decl.ci && sel && !parsed.stampSuite && sel.mode !== 'none')`, before the loop: `const ciDirtyExempt = startGit.dirty === true ? inertDirtyPaths(decl, startDirtyPaths && startDirtyPaths.length ? startDirtyPaths : dirtyFilePaths(undefined, scopeStatusRead)) : null;` — reusing `startDirtyPaths` (L910) when that read already ran, so no second `git status`. Under an `impact` declaration `scopeStatusRead` is `null` and this is a fresh read after `impact.fetch`, exactly as L910's generated-path read already is (#5773); it fails closed, since any non-inert path present at that read keeps `dirty-tree`. State that in a one-line comment.
  - The inert line is printed lazily, once, immediately before the first `fetchCiVerdict` call the exemption let through (a `let announced = false` flag), never before the loop — so a selection with no CI-declared suite in `cmds`, a `--local` run, or a `stopped` run prints nothing: `process.stdout.write(\`CI: tree dirty only in inert paths (${ciDirtyExempt.join(', ')}) — taking CI verdicts on HEAD\n\`)`.
  - `skipCi`'s entry gains `dirtyExempt: null`.
  - Guard becomes `if (startGit.dirty !== false && ciDirtyExempt === null)` (body unchanged).
  - After `fetchCiVerdict`: `verdict.ci.dirtyExempt = ciDirtyExempt;` before `ciAttempts.push(verdict.ci)`.
  - Extend the #4347 block comment above the loop by one sentence: a tree dirty only in inert paths (`inertDirtyPaths`, #5234) counts as clean for CI sourcing; the stamp still records the real dirty state.

- [ ] **Step 4: Run to verify pass**

Run: `node --test tests/bin-lib/verify/ci-cli.test.js tests/bin-lib/verify/impact-cli.test.js tests/bin-lib/verify/scope.test.js tests/bin-lib/timing/derive.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/verify.js tests/bin-lib/verify/ci-cli.test.js tests/bin-lib/verify/impact-cli.test.js
git commit -m "Take CI verdicts on a tree dirty only in inert paths — refs #5234"
```

### Task 3: Prose — ci-source.md, verification.md, 4347 journey

**Role:** integration

**Files:**
- Modify: `plugin/skills/test/ci-source.md` (requirement 1 at L27 "A clean tree at the start…"; the `dirty-tree` row at L56; the stdout paragraph after the table)
- Modify: `plugin/skills/test/verification.md` (L103 CI source paragraph: "on a clean tree")
- Modify: `docs/journeys/take-the-full-suite-verdict-from-ci-4347.md` (L24 "a dirty tree … runs the suite locally")
- No-change (classified): `docs/journeys/keep-ci-declared-suites-off-this-machine-5369.md` L31 lists `dirty-tree` as an example reason — still true.

- [ ] **Step 1: Edit `ci-source.md`:** requirement 1 becomes a clean tree at the start, where a tree dirty only in inert paths counts as clean — every dirty path (tracked, untracked, both sides of a rename) matches a declared `generated` glob or has a first matching rule with `suites: []` and `static: false` (and no `impact`); an unmatched path is never inert. The `dirty-tree` row's Cause gains: "…dirty at the start in a path that is not inert (requirement 1)…". The stdout paragraph gains the line `CI: tree dirty only in inert paths ({paths}) — taking CI verdicts on HEAD`, printed once before the CI wait, and states that each `ci` entry in `report.json` and the verify event carries `dirtyExempt` (the inert paths when the exemption applied, else `null`), and that the pass stamp still records the tree as dirty.
- [ ] **Step 2: Edit `verification.md` L103:** replace "on a clean tree" with "on a clean tree (or one dirty only in inert paths, [ci-source.md](ci-source.md))" or an equally short form; confirm `wc -c plugin/skills/test/verification.md` ≤ 52,500.
- [ ] **Step 3: Edit the 4347 journey's L24:** "a dirty tree" → "a tree dirty in a path that is not inert (#5234: declared `generated`, or a first matching rule running no checks)".
- [ ] **Step 4: Verify**

Run: `node --test tests/bin-lib/skill-audit/context-cost.test.js` and `git grep -n -F "on a clean tree" -- plugin/skills/test`
Expected: PASS; the grep shows only the qualified form in `verification.md` (control: `git show HEAD:plugin/skills/test/verification.md | grep -c -F "on a clean tree"` prints 1 before the edit).

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/test/ci-source.md plugin/skills/test/verification.md docs/journeys/take-the-full-suite-verdict-from-ci-4347.md
git commit -m "Document the inert-path CI-source exemption — refs #5234"
```

## Spec coverage

| Spec item | Task |
|---|---|
| Deliverable 1 (`inertDirtyPaths`) | 1 |
| Deliverables 2, 3 (precondition, `dirtyExempt`, stdout line) | 2 |
| Deliverable 4 (stamp unchanged) | 2 (no stamp edit; Global Constraints) |
| Deliverable 5 (prose) | 3 |
| AC1 clauses | Task 1 tests |
| AC2–AC5 | Task 2 tests |
| AC6 (`npm test -- --full`) | Common Step 5 final verification (folded: runner check only) |

Waived AC6.1: a whole-suite runner check, not a test step — Common Step 5's final verification and the PR's CI run it.
