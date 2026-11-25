# Scoped-Pass Stamp Anchor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After a passing scoped verify at S, a later `verify.js --scope` whose delta since S is bookkeeping-only resolves to `none` and re-stamps HEAD without running a suite.

**Architecture:** `plugin/bin/verify.js`'s `--scope` path gains one pre-check ahead of today's anchor-based selection. When the prior stamp is a clean, non-full pass whose own `sha` is an ancestor of HEAD and differs from its `fullSha` anchor, the runner classifies the delta since that `sha` with the existing `selectScope`. If that selection is `none`, the runner uses it. `fullSha` stays the anchor and `base` is the scoped pass's `sha`. Any other outcome runs today's code unchanged, so the delta is measured from `fullSha` again. The git probe sits beside `usableAnchor` in `plugin/bin/lib/verify/changed-files.js`.

**Tech Stack:** Node 18+ CommonJS, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-11-25T074303-record-5075/work/5075-spec.md` (record #5075; its Decision paragraph picks Reading B: any clean, passing non-full stamp may anchor the shortcut, so `none` stamps chain)

Scope keywords: scopedPassBase, stays at the earlier full pass, their mapped suites run again

## Global Constraints

- Keep `fullSha` as the base for every delta that contains a non-bookkeeping path, so the scoped set never narrows below the last full pass (spec Deliverable 2).
- A bookkeeping-only delta prints `still-verified: bookkeeping-only delta` (the existing line at `plugin/bin/verify.js` ~1593, unchanged), and `--stamp-status` reports `verifiedHead: true` at HEAD (spec AC1).
- `plugin/skills/test/verification.md` is 51,934 B against `RAIL_BYTES` 52,500 B (headroom 566 B). Task 2's edit to it must leave the file at or under 52,500 B. Measure it with `wc -c`.
- From `.claude/skills/suite-slot-test-env/SKILL.md`, quoted verbatim: "A helper that spawns `verify.js` and is given no env defaults the child to `{ ...process.env, CT_TEST_SUITE_SLOT_HELD: '1' }`, never bare `process.env` (`runCli` in `cli.test.js` and `impact-cli.test.js` …)." The new tests use `runCli` from `tests/bin-lib/verify/cli-helpers.js`, which already applies that default. They assert nothing about slots, so `slotEnv` is not needed.
- `.claude/skills/verify-scope-rule-kind`, `git-ground-truth-test-env`, `node-test-output-evidence` and `windows-checkout-test-parity` do not apply. This change adds no rule kind or declaration key, takes no git ground truth through an env parameter, parses no test-runner output, and has no platform-specific path or line-ending behavior.
- "Commit tests only where the task asks for them or the repo already keeps tests for this kind of change, sized like the neighboring test files; scratch checks stay scratch. Touch only what the task requires — a pre-existing bug you notice is a follow-up to report, not a fix to fold in, unless the task cannot work without it. Don't reformat or "improve" adjacent code; edit in place rather than rewrite when the result is the same."

## Review Focus

- A scoped stamp whose `sha` was amended away (it is not an ancestor of HEAD): the short-delta shortcut must not apply. A diff from a stranded `sha` can look bookkeeping-only while HEAD still carries unverified code (test `guard: an amended scoped pass…`, Task 1).
- A scoped stamp written on a dirty tree (`dirty: true`): that pass never verified the committed tree at `sha`, so it must not anchor a `none` (test `guard: a dirty scoped stamp…`, Task 1).
- A prior `full` stamp: unchanged behavior, already pinned by `tests/bin-lib/verify/cli.test.js`'s `full → none → scoped` AC4 test (its `s2.base === s1.fullSha` assertion).
- A baseline-adjudicated anchor: the `none` stamp written by the shortcut still carries the `baseline` marker forward, because `sel.base` (the anchor) still equals `priorStamp.fullSha` (test `carry-forward: …`, Task 1).
- A repeat scoped run at an unchanged HEAD after a scoped pass: the short delta is empty, so it resolves to `none` with `still-verified: no changes since {sha}`. `cli.test.js`'s #1923 repeat-run test accepts either outcome and stays green.

---

### Task 1: Anchor a bookkeeping-only delta on the prior scoped pass

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/verify/changed-files.js` (add `scopedPassBase` beside `usableAnchor`, export it)
- Modify: `plugin/bin/verify.js` (~684-772: the `--scope` anchor/selection block; header comment at ~1457-1458)
- Modify: `plugin/bin/lib/verify/scope.js:6-9` (header comment: the "never a prior scoped sha, so scoped runs never chain" invariant now has one stated exception)
- Create: `tests/bin-lib/verify/cli-scoped-pass-anchor.test.js`

**Interfaces:**
- Produces: `scopedPassBase({ stamp, anchor, execImpl = execFileSync }) -> string | null` in `plugin/bin/lib/verify/changed-files.js`. It returns the canonical 40-hex `stamp.sha` only when all of these hold, else `null`: `stamp` is non-null, `anchor` is a non-null string, `stamp.scope !== 'full'`, `stamp.dirty === false`, `stamp.sha !== anchor`, and `git merge-base --is-ancestor --end-of-options {stamp.sha} HEAD` succeeds. Canonicalize it with `rev-parse --verify --end-of-options {sha}^{commit}`, the same `tryGit` pattern `usableAnchor` uses.

- [ ] **Step 1: Write the failing tests** in `tests/bin-lib/verify/cli-scoped-pass-anchor.test.js`

Header: `'use strict';`, then `node:test`, `node:assert`, `fs`, `path`, and `{ runCli, scopedRepo, stampOf, commitFile }` from `./cli-helpers`. Module constants: `const RULES = [{ match: 'src/**', suites: ['unit'], static: true }, { match: 'docs/plans/*-ledger.md', suites: [], static: false }];` and `const args = (r) => ['--scope', r.declPath, '--integration-branch', r.branch, '--cmd', `unit=${r.unitCmd}`, '--cmd', 'other=node -e 0'];`. Every test starts from `scopedRepo(RULES)`. Shared setup `scopedPassAt(r)`: run `args` (full, anchor F = HEAD), unlink `r.marker`, `commitFile(r, 'src/a.js', 'module.exports = 1;')`, run `args` again (scoped, S = HEAD), unlink `r.marker`. It returns `{ F, S }`.

```js
test('AC1.1: a ledger-only delta since a passing scoped stamp runs no suite, prints still-verified, and verifies HEAD', async () => {
  const r = scopedRepo(RULES);
  const { F, S } = await scopedPassAt(r);
  assert.strictEqual(stampOf(r.gitDir).scope, 'scoped');
  commitFile(r, 'docs/plans/2026-01-01-x-ledger.md', '| row |');
  const run = await runCli(args(r), { cwd: r.repo });
  assert.strictEqual(run.code, 0, run.stderr);
  assert.match(run.stdout, /^Scope: none — 1 changed file\(s\) since/m);
  assert.match(run.stdout, /still-verified: bookkeeping-only delta \(docs\/plans\/2026-01-01-x-ledger\.md\)/);
  assert.ok(!fs.existsSync(r.marker), 'no suite may spawn');
  const s = stampOf(r.gitDir);
  assert.strictEqual(s.scope, 'none');
  assert.strictEqual(s.sha, r.git('rev-parse', 'HEAD').trim());
  assert.strictEqual(s.fullSha, F);
  assert.strictEqual(s.base, S);
  assert.deepStrictEqual(s.changedFiles, ['docs/plans/2026-01-01-x-ledger.md']);
  const status = JSON.parse((await runCli(['--stamp-status'], { cwd: r.repo })).stdout);
  assert.strictEqual(status.verifiedHead, true);
});

test('AC2.1: a delta since the scoped stamp holding one src path scopes over the delta since fullSha, as today', async () => {
  // scopedPassAt, then commit docs/plans/…-ledger.md and src/b.js, then run args
  // expect: /^Scope: scoped — 3 changed file\(s\) since/m; r.marker exists;
  // stamp.scope 'scoped', stamp.base === F, stamp.fullSha === F,
  // stamp.changedFiles deepEqual ['docs/plans/2026-01-01-x-ledger.md', 'src/a.js', 'src/b.js'], suitesRun ['unit']
});

test('guard: an amended scoped pass (sha no longer an ancestor of HEAD) falls back to the fullSha delta', async () => {
  // scopedPassAt; then write docs/plans/2026-01-01-x-ledger.md, git add it, git commit --amend --no-edit -q
  // (S is now stranded; diff S..HEAD would be ledger-only). Run args.
  // expect: Scope: scoped; r.marker exists; stamp.base === F; changedFiles includes 'src/a.js'
});

test('guard: a dirty scoped stamp never anchors a none', async () => {
  // scopedPassAt; rewrite claude-tweaks-verify-pass.json in r.gitDir with the same stamp but dirty: true;
  // commit the ledger file; run args.
  // expect: Scope: scoped; r.marker exists; stamp.base === F
});

test('carry-forward: a none written on a scoped-pass base keeps the anchor\'s baseline marker', async () => {
  // scopedPassAt; rewrite the stamp adding baseline: { base: 'origin/main', baseSha: 'b'.repeat(40), baselineFailing: ['tests/env.test.js'], flakyPassed: [] }
  // (fullSha F unchanged, dirty false); commit the ledger file; run args.
  // expect: stamp.scope 'none'; deepEqual(stamp.baseline, marker); --stamp-status baselineAdjudicated true, verifiedHead true
});
```

The implementer writes the bodies outlined in the comments. Each guard test must go red when its guard is deleted from `scopedPassBase` (the `isAncestor` probe, and the `dirty === false` check). Prove it in Step 4.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test --test-name-pattern="AC1.1" tests/bin-lib/verify/cli-scoped-pass-anchor.test.js`
Expected: FAIL. Today the run prints `Scope: scoped — 2 changed file(s)` and spawns `unit`.

- [ ] **Step 3: Implement**

In `changed-files.js`, add `scopedPassBase` per the Interfaces block and export it. In `verify.js`'s `--scope` block, right after the H4 `--base` conflict check (~line 722) and before `changedFiles({ base: resolvedBase, … })`:

1. Compute `const passBase = scopedPassBase({ stamp: priorStamp, anchor: anchorSha });`.
2. When `passBase` is non-null, read `changedFiles({ base: passBase })` and classify it with `selectScope({ decl, files: short.files, stamp: priorStamp })`. Pass no `impact` context and no statuses. An impact-rule path then falls back to `map-missing`, which selects its suite, so the result is never `none` and no test-impact map is loaded.
3. When that selection's `mode === 'none'`: set `resolvedBase = passBase`, `files = short.files`, `sel =` that selection, and skip the rest of the block: merge narrowing, the impact context, the `#4638` re-select, the impact subset and the command assembly. `sel.base` is `anchorOf(priorStamp)` (the anchor), so the stamp writer's `fullSha: sel.base` keeps F and `base: resolvedBase` records S. The `baseline`/`preExisting` carry-forward (`priorStamp.fullSha === sel.base`) holds unchanged.
4. Otherwise, run today's code byte-for-byte.

The `none` mode's existing downstream handling (H2 skip, `emptyNonNoneRun`, the `still-verified:` line) needs no change. Add a `#5075` comment naming the rule. Then amend `scope.js`'s header invariant sentence and the `only a full run advances fullSha (#1922)` comment at `verify.js` ~1457. They should say that a `none` selected over a clean scoped pass's own delta takes that pass's `sha` as `base`, while `fullSha` still never moves.

Proof(medium-risk): the AC2.1 test and the two guard tests pin that every delta holding a non-bookkeeping path, and every stranded or dirty scoped stamp, still measures from `fullSha`. Deleting either guard turns its test red (Step 4).

- [ ] **Step 4: Run the tests and prove the guards discriminate**

Run: `node --test tests/bin-lib/verify/cli-scoped-pass-anchor.test.js tests/bin-lib/verify/cli.test.js tests/bin-lib/verify/cli-scope-integration.test.js tests/bin-lib/verify/changed-files.test.js tests/bin-lib/verify/scope.test.js`
Expected: PASS, 0 failures.

Then, in scratch only (never committed): delete the `isAncestor` check from `scopedPassBase` and re-run the new file. The `guard: an amended…` test must FAIL. Restore it, then delete the `dirty === false` check. The `guard: a dirty…` test must FAIL. Restore it. Quote both red outputs in the task report.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/verify/changed-files.js plugin/bin/verify.js plugin/bin/lib/verify/scope.js tests/bin-lib/verify/cli-scoped-pass-anchor.test.js
git commit -m "Anchor a bookkeeping-only scoped re-verify on the prior scoped pass — refs #5075"
```

### Task 2: Document the scoped-pass anchor rule

**Role:** integration

**Files:**
- Modify: `plugin/skills/test/verification.md:27` (Mismatch bullet: the parenthetical `(the stamp's fullSha: only a full run advances it, so after a scoped Common Step 5 it stays at the earlier full pass and the delta is the larger diff since then)`)
- Modify: `plugin/skills/test/impact-selection.md:75` (`Changed paths are diffed from the stamp's fullSha, as every scoped run is.`)
- Modify: `docs/journeys/pass-the-review-test-gate-after-a-ledger-commit-4395.md` (lines 13 and 21)
- Modify: `docs/journeys/get-one-full-suite-run-on-a-docs-touching-build-3060.md:36`
- Modify: `docs/journeys/verify-a-build-once-after-the-base-moved-4343.md` (lines 17 and 54)
- No change (still true, swept): `docs/plugin-structure.md:342` (`only a full run advances fullSha`), `docs/journeys/run-a-deterministic-verification-check.md:90-91` (it describes a full → none sequence, whose base is still the anchor), `docs/journeys/declare-a-verify-scope-1924.md:46`, `plugin/skills/test/verification.md:34,85,216,222`, `plugin/skills/review/code-mode-steps.md:75,85,114`

**Interfaces:**
- Consumes: Task 1's behavior. A clean, passing non-full stamp at S, an ancestor of HEAD, whose delta since S selects `none`, stamps `none` with `base` S and `fullSha` unchanged. Any other delta is measured from `fullSha`.

- [ ] **Step 1: Rewrite each listed sentence** so it states the new rule. Every line that today says a scoped build pass makes a later ledger-only commit re-run the build's mapped suites must now say that the ledger-only commit resolves to `none` against the scoped pass and re-stamps HEAD. A delta with a code path still re-selects from `fullSha`. In `verification.md`, replace the parenthetical with a shorter one, e.g. `(the stamp's fullSha — only a full run advances it — except that a delta since a clean scoped pass that is bookkeeping-only is measured from that pass)`, and keep the file at or under 52,500 B.

- [ ] **Step 2: Verify**

Run: `wc -c plugin/skills/test/verification.md`
Expected: at most 52500.

Run: `git grep -n -i -e "stays at the earlier full pass" -e "re-runs their mapped suites instead of resolving" -e "their mapped suites run again" -e "as every scoped run is" -- plugin docs`
Expected: no output.

Run: `node tools/run-tests.js tests/argument-hint-mirrors.test.js tests/plan-citations-resolve.test.js tests/test-skill-affected-conformance.test.js tests/build-pre-verify-catchup-conformance.test.js`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add plugin/skills/test/verification.md plugin/skills/test/impact-selection.md docs/journeys/pass-the-review-test-gate-after-a-ledger-commit-4395.md docs/journeys/get-one-full-suite-run-on-a-docs-touching-build-3060.md docs/journeys/verify-a-build-once-after-the-base-moved-4343.md
git commit -m "Document the scoped-pass anchor for bookkeeping-only re-verify — refs #5075"
```
