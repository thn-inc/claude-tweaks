# verify.js Baseline Merge-Base Adjudication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `verify.js --baseline <ref>` adjudicates a failing run against `git merge-base HEAD <ref>`, not against `<ref>`'s moving tip, so a test red where the branch started (and since fixed on the integration branch) is reported "also fails at base", not `ATTRIBUTABLE`.

**Architecture:** `realGit` (plugin/bin/lib/verify/baseline.js) gains `mergeBase(a, b)`. `verify.js` resolves the merge-base once at startup beside `baseSha`, and hands the merge-base commit to `adjudicate()` as both `base` and `baseSha`, recording the ref as passed in a new `baseRef` field. `verification.md`'s prescribed invocation (`--baseline origin/{integration-branch}`) is unchanged; only its prose describing what the runner compares against changes.

**Tech Stack:** Node 18+ CommonJS, `node --test`, git CLI.

**Spec:** `.claude-tweaks/pipelines/2026-10-21T220136-record-3810/work/3810-spec.md`

Scope keywords: baselineAdjudicated, --baseline

## Global Constraints

- An unresolvable `--baseline` ref keeps exiting 2 before any check runs, with the existing message `--baseline: {ref} does not resolve to a commit`.
- `report.json`'s `baselineAdjudicated.base` names the merge-base commit actually used (full SHA).
- `verification.md` is at 51958 bytes against `RAIL_BYTES` 52500 (542 bytes headroom) — Task 2's net growth must stay under ~300 bytes; replace wording in place rather than add paragraphs.
- The invocation snippet `--baseline origin/main` in verification.md stays byte-identical (pinned by `tests/bin-lib/verify/snippet-conformance.test.js`).

## Review Focus

1. A `--baseline` ref sharing no history with HEAD (orphan branch, or a shallow clone missing the fork point) — expect "not adjudicated" with a named reason and exit 1, never exit 2 and never a crash. Test: Task 1 `no-merge-base` test.
2. A ref that contains HEAD (`--baseline HEAD`, branch already merged) — expect the existing "already contains HEAD" refusal, message unchanged. Covered by the existing `#3043 I1` test, which must stay green.
3. A SHA passed as `--baseline` that is already an ancestor of HEAD — its own merge-base, so behavior and the `vs {sha}` Status text are unchanged. Covered by every existing `baselineRepo` test.
4. A test passing at the merge-base and failing on the branch while the integration tip has moved on — still `ATTRIBUTABLE`. Test: Task 1 AC2 test.
5. The pass stamp's `baseline` marker carries `base`/`baseSha` = merge-base — `--stamp-status` acceptance unchanged. Asserted in Task 1's AC1 test.

---

### Task 1: Resolve `--baseline` to its merge-base with HEAD

**Files:**
- Modify: `plugin/bin/lib/verify/baseline.js` (`realGit`, after `isAncestor`)
- Modify: `plugin/bin/verify.js` (startup `--baseline` resolution ~L254-269; adjudication block ~L566-599; `Baseline: adjudicated against` line ~L985)
- Test: `tests/bin-lib/verify/cli.test.js` (append after the existing `--baseline` tests, reusing `baselineRepo`, `SUITE`, `PER_FILE`, `headCommit`)

**Interfaces:**
- Produces: `realGit(cwd).mergeBase(a: string, b: string) -> string | null` — `git merge-base --end-of-options a b`; the full SHA, or `null` when git exits non-zero (no common ancestor, or any failure — the caller fails closed).
- Produces: `report.json` `baselineAdjudicated` gains `baseRef: string` (the `--baseline` value as passed) on every shape (eligible and ineligible); on an adjudicated run `base` and `baseSha` both equal the merge-base SHA.

- [ ] **Step 1: Write the failing tests** (append to `tests/bin-lib/verify/cli.test.js`)

Fixture helper (in the test file): `forkedBaselineRepo()` — `baselineRepo()`, then `integ = git symbolic-ref --short HEAD`; `git checkout -q -b feature`; `headCommit(r)`; `git checkout -q {integ}`; commit a fix making `tests/env.test.js` pass (`require('node:test')('env', () => {});`); `git checkout -q feature`. Returns `{...r, integ}`.

- `test('--baseline <branch>: a failure inherited from the merge-base and fixed on the integration tip is baseline, not attributable (#3810 AC1, AC3)')` (covers AC1.1, AC3.1) — `runCli(['--cmd', SUITE, '--baseline', r.integ, '--baseline-cmd', PER_FILE], r.opts)`; assert `code === 0`; `report.baselineAdjudicated.verdict === 'pass'`; `deepStrictEqual(report.baselineAdjudicated.baselineFailing, ['tests/env.test.js'])`; `deepStrictEqual(report.baselineAdjudicated.attributable, [])`; `report.baselineAdjudicated.base === r.baseSha`; `report.baselineAdjudicated.baseSha === r.baseSha`; `report.baselineAdjudicated.baseRef === r.integ`; stamp `claude-tweaks-verify-pass.json`'s `baseline.base === r.baseSha`; stdout matches `` new RegExp(`Baseline: adjudicated against ${r.baseSha.slice(0, 9)} \\(merge-base of HEAD and ${r.integ}\\)`) ``.
- `test('--baseline <branch>: a file passing at the merge-base and failing on the branch stays attributable while the integration tip has moved (#3810 AC2)')` (covers AC2.1) — `baselineRepo()`, `integ`, `checkout -b feature`, break `tests/ok.test.js` (`throw new Error('regressed')`) and commit; `checkout {integ}`, commit an unrelated `README.md`; `checkout feature`; run with `--baseline integ`; assert `code === 1`, stdout matches `/ATTRIBUTABLE: tests\/ok\.test\.js/`, `report.baselineAdjudicated.base === r.baseSha`.
- `test('--baseline: a ref sharing no merge-base with HEAD is not adjudicated and exits 1, never 2 (#3810)')` — `baselineRepo()`, `headCommit(r)`, `integ`; `git checkout -q --orphan other`, `git commit -q --allow-empty -m orphan`, `git checkout -q {integ}`; run with `--baseline other`; assert `code === 1`; stdout includes `Baseline: not adjudicated — no merge-base between HEAD and other`; `report.baselineAdjudicated.eligible === false`; `report.baselineAdjudicated.baseRef === 'other'`; no `claude-tweaks-verify-pass.json`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test --test-name-pattern "3810" tests/bin-lib/verify/cli.test.js`
Expected: FAIL — AC1 test exits 1 with `ATTRIBUTABLE: tests/env.test.js` (adjudicated against the fixed tip); the no-merge-base test fails on the missing `no merge-base` reason.

- [ ] **Step 3: Implement**

- `baseline.js` `realGit`: add `mergeBase(a, b)` per the Interfaces block (try/catch → `null`, same `git()` helper, `--end-of-options` before the refs).
- `verify.js` startup: after `baseSha` resolves, `mergeBaseSha = bgit.mergeBase('HEAD', baseSha)`. The exit-2 path for an unresolvable ref is untouched.
- `verify.js` adjudication: keep the `isAncestor('HEAD', baseSha)` refusal first (message unchanged). Then, when `mergeBaseSha === null`, ineligible with `reason: \`no merge-base between HEAD and ${parsed.baseline} — nothing to compare against\``. Otherwise call `adjudicate` with `base: mergeBaseSha, baseSha: mergeBaseSha`. Every `baselineAdjudicated` shape (the two ineligible literals, the error catch, and the adjudicate result) carries `baseRef: parsed.baseline`.
- `verify.js` render: `Baseline: adjudicated against ${String(b.baseSha).slice(0, 9)} (merge-base of HEAD and ${b.baseRef}) — …` (rest of the line unchanged). The table Status reads `vs ${baselineAdjudicated.baseRef}` (the ref as passed — `vs origin/main` stays readable; for an ancestor-SHA ref, as every existing test passes, the text is byte-identical to today).
- Update the comment at the adjudication block to say the base is the merge-base (#3810).

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/verify/cli.test.js tests/bin-lib/verify/baseline.test.js tests/bin-lib/verify/report.test.js`
Expected: PASS (all, including the pre-existing `#3043` baseline tests).

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/verify/baseline.js plugin/bin/verify.js tests/bin-lib/verify/cli.test.js
git commit -m "Adjudicate --baseline against the merge-base with HEAD — refs #3810"
```

### Task 2: verification.md describes merge-base adjudication

**Files:**
- Modify: `plugin/skills/test/verification.md` (Baseline adjudication section: the "adjudicates a failing run against the integration branch itself" sentence ~L139; the ineligible-reason list ~L145; the Status text and `report.json` shape ~L164)
- Modify: `docs/journeys/run-a-deterministic-verification-check.md` (Step 11: name the merge-base as what is compared against; the `Baseline:` line wording)
- Test: `tests/bin-lib/verify/snippet-conformance.test.js` (append)

**Interfaces:**
- Consumes: Task 1's `baseRef` field and merge-base semantics.

- [ ] **Step 1: Write the failing test** (append to `tests/bin-lib/verify/snippet-conformance.test.js`)

`test('verification.md states --baseline adjudicates against the merge-base with HEAD (#3810)')` — slice the `### Baseline adjudication` … `### Declared pre-existing failures` section as the #3511 test does; assert it includes `` `git merge-base HEAD {ref}` `` and `baseRef`.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test --test-name-pattern "3810" tests/bin-lib/verify/snippet-conformance.test.js`
Expected: FAIL — the section names neither.

- [ ] **Step 3: Edit the prose in place**

- L139: "adjudicates a failing run against the integration branch itself" → against the commit the branch forked from: the runner resolves the `--baseline` ref to `git merge-base HEAD {ref}`, so a test red at the fork point that the integration branch has since fixed stays baseline.
- L145 ineligible list: add "a ref sharing no merge-base with HEAD" beside "a base that already contains HEAD".
- L164 Status text `pass (baseline-adjudicated vs {base}: …)` → `vs {baseRef}`; report shape: `baselineAdjudicated: {base, baseRef, baseSha, …}` and ineligible `{base, baseRef, baseSha, eligible: false, reason}`; one clause: `base`/`baseSha` name the merge-base commit used, `baseRef` the ref as passed.
- Do not touch the `node ".../verify.js" ... --baseline origin/main ...` snippet.
- Journey Step 11: say the run is adjudicated against the merge-base of HEAD and `origin/main` (one clause in the Action/Should-understand text), so a failure already present where the branch forked stays baseline even after `origin/main` fixes it.
- Measure: `wc -c plugin/skills/test/verification.md` must stay < 52500.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/verify/snippet-conformance.test.js tests/bin-lib/skill-audit/context-cost.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/test/verification.md docs/journeys/run-a-deterministic-verification-check.md tests/bin-lib/verify/snippet-conformance.test.js
git commit -m "Describe merge-base baseline adjudication in verification.md — refs #3810"
```
