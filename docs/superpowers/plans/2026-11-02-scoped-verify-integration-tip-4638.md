# Scoped Verify at the Integration Tip Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge narrowing never leaves a scoped verify with zero suites over a delta whose paths map to at least one suite, and a run at the integration tip runs the suites its changed paths map to.

**Architecture:** Two guards. `mergeNarrowing` declines when HEAD has no commit ahead of `{ref}`, because `{ref}`'s tip would otherwise vouch for itself (this also covers a dirty tree at the tip, which an outcome check alone would not). `verify.js` then checks the outcome: when the narrowed set selects no suite, it drops the narrowing and re-selects over the full `anchor..HEAD` set. A delta whose paths map to no suite still selects `none` over the full set and still stamps, which is the bookkeeping exemption.

**Tech Stack:** Node 18+, `node --test`, git plumbing through the injectable `execImpl` seam.

**Spec:** `.claude-tweaks/pipelines/2026-11-03T093004-record-4638/work/4638-spec.md`. Its `## Plan Review Decisions` section overrides the Acceptance Criterion where they conflict: Reading A on scope, Reading B on bookkeeping-only deltas, and (round 2) Reading A on test-impact selection.

## Global Constraints

- Acceptance criterion, verbatim: "A scoped run at the integration tip runs the suites its changed paths map to, or reports that it verified nothing; it never stamps verifiedHead from zero suites over a non-empty delta."
- Decision, verbatim: "\"Never\" is universal: any narrowing that leaves zero suites over a non-empty delta declines or does not stamp."
- Decision, verbatim: "They are exempt: \"the suites its changed paths map to\" being none is a legitimate zero, and `none` still stamps."
- Decision (round 2), verbatim: "\"Any narrowing\" means merge narrowing only. An empty impact subset still stamps, because the traced map says no test reads the path. The plan says so explicitly and adds a test pinning it."
- Out of scope, by that decision: test-impact selection. An empty impact subset with no merge narrowing still drops the impact suite (`plugin/bin/lib/verify/scope.js:100`) and still stamps `none`/`static-only`. The outcome guard keys on `narrowing` alone and never fires for it. Task 1's `impact-cli.test.js` test pins this.
- Commit style: `{Verb} {what} — {detail}`, imperative, no conventional prefix; reference the record as `refs #4638`, never `closes`/`fixes`. End each commit message with `Claude-Session: https://claude.ai/code/session_01X7gPFCrtkzanEVAkLgp6fP`.
- `.claude/skills/gh-api-module-pattern/SKILL.md`, quoted: "A seam whose calls are *probes* runs quiet" — the new git read goes through the existing `tryGit(execImpl, …)`.
- `.claude/skills/gh-api-module-pattern/SKILL.md`, quoted: "A module that parses git's output pins that output's format against the user's and the repo's git config." The new read is `rev-list --count`, a bare integer no diff or color config rewrites.
- `changed-files.js`'s own header rule, quoted: "the fallback over-verifies, never under-verifies." A failed read in the new guard returns `null`, never a narrowed set.
- The change adds no `fs` call and no direct spawn, so `tests/path-guard-conformance.test.js` and `tests/windows-hide-spawn-conformance.test.js` stay as they are; they run with this task's focused tests.
- No `git stash` in any form.

## Review Focus

Each line is pinned by a named test in Task 1.

1. HEAD is the integration tip and the tree is dirty on a mapped path: the dirty path selects a suite, so only the `mergeNarrowing` guard stops it excluding everything else. Test: `AC1.1: at the tip with a dirty tree narrowing still declines`.
2. A pre-anchor commit of the branch's own, then an anchor, then a merge: `own` is non-empty but shares no path with the changed set. Test: `AC1.2 (Reading A): a pre-anchor own commit plus a merge never stamps from zero suites`.
3. One commit past the tip touching only a bookkeeping path. Test: `AC1.2 (Reading A): a bookkeeping commit past a merge does not hide the merged-in paths`.
4. The narrowed set selects only static checks (`static-only`, zero suites), which a guard keyed on `mode === 'none'` would miss. Test: `AC1.2 (Reading A): a static-only narrowed set also declines`.
5. A delta that is bookkeeping on both sides of the merge stays exempt. Test: `AC1.2 (Reading B): a bookkeeping-only delta still stamps none, unnarrowed`.
6. Test-impact selection stays outside the rule (round-2 Reading A). A delta that only deletes a test file no other test reads gives an empty impact subset, with no merge involved, and still stamps `none`. Test: `#4638 round-2 Reading A: an empty impact subset with no merge narrowing still stamps none`.

---

### Task 1: Never let merge narrowing produce a zero-suite stamp

**Review risk:** high
**Role:** integration

**Files:**
- Modify: `plugin/bin/lib/verify/changed-files.js:165-192`
- Modify: `plugin/bin/verify.js:602-632`
- Test: `tests/bin-lib/verify/changed-files.test.js`
- Test: `tests/bin-lib/verify/cli.test.js`
- Test: `tests/bin-lib/verify/impact-cli.test.js`
- Modify: `plugin/skills/test/verification.md:94`
- Modify: `docs/plugin-structure.md:58`
- Modify: `docs/plugin-structure.md:197`

`Waived docs/journeys/run-a-deterministic-verification-check.md: Common Step 6 (/claude-tweaks:journeys) owns journey edits; its step 14 "Should understand" and "Red flags" lines need the new decline rule.`

`mergeNarrowing` has one production caller. `git grep -n "mergeNarrowing(" -- plugin` lists `plugin/bin/verify.js:611` and the definition.

**Interfaces:**
- Consumes: `tryGit`, `preferOriginRef` in `changed-files.js`; `selectScope` through the existing `select` closure in `verify.js`, which reads the outer `files` and `statuses` bindings on each call.
- Produces: `mergeNarrowing({ anchor, integrationBranch, files, execImpl })` keeps its signature and return shape, and also returns `null` when HEAD has no commit ahead of `{ref}`.

- [ ] **Step 1: Write the failing tests**

In `tests/bin-lib/verify/changed-files.test.js`, after the `#3072 Important 2` test:

```js
// #4638: the anchor is on trunk's line; a side branch merges into trunk with a
// real merge commit; feat fast-forwards onto trunk, so HEAD is trunk's tip.
function tipRepo() {
  const r = mergeRepo();
  r.git('checkout', '-q', 'trunk');
  r.git('checkout', '-q', '-b', 'side');
  r.commit('src/merged.js', 'merged');
  r.git('checkout', '-q', 'trunk');
  r.git('merge', '-q', '--no-ff', '--no-edit', 'side');
  r.git('checkout', '-q', 'feat');
  r.git('merge', '-q', '--ff-only', 'trunk');
  return r;
}

test('AC1.1: at the integration tip narrowing declines, so the changed paths stay selected (#4638)', () => {
  const r = tipRepo();
  const files = changedSince(r, r.anchor);
  assert.deepStrictEqual(files, ['src/merged.js']);
  assert.strictEqual(mergeNarrowing({ anchor: r.anchor, integrationBranch: 'trunk', files, execImpl: r.exec }), null);
});

test('AC1.1: at the tip with a dirty tree narrowing still declines (#4638)', () => {
  const r = tipRepo();
  r.write('README.md', 'dirty');
  const files = changedSince(r, r.anchor);
  assert.strictEqual(mergeNarrowing({ anchor: r.anchor, integrationBranch: 'trunk', files, execImpl: r.exec }), null);
});

test('AC1.1: behind the tip on the integration line narrowing declines (#4638)', () => {
  const r = tipRepo();
  r.git('checkout', '-q', 'trunk');
  r.commit('src/later.js', 'later');
  r.git('checkout', '-q', 'feat');
  const files = changedSince(r, r.anchor);
  assert.strictEqual(mergeNarrowing({ anchor: r.anchor, integrationBranch: 'trunk', files, execImpl: r.exec }), null);
});

test('a failing ahead-count read degrades to null (#4638)', () => {
  const r = mergeRepo();
  mergeTrunkWith(r, [['ui/a.js', 'a']]);
  r.commit('src/own.py', 'own');
  const files = changedSince(r, r.anchor);
  const countFails = (cmd, args, opts) => {
    if (args[0] === 'rev-list' && args.includes('--count')) { const e = new Error('fatal: bad object'); e.status = 128; throw e; }
    return r.exec(cmd, args, opts);
  };
  assert.strictEqual(mergeNarrowing({ anchor: r.anchor, integrationBranch: 'trunk', files, execImpl: countFails }), null);
  assert.ok(mergeNarrowing({ anchor: r.anchor, integrationBranch: 'trunk', files, execImpl: r.exec }), 'control: the same repo narrows when git succeeds');
});
```

In `tests/bin-lib/verify/cli.test.js`, after the `#3072 AC3` test. `runScoped` and the rule set are local to these tests; `mergedScopedRepo`, `anchorFullPass`, `mergeTrunk`, `commitFile`, `stampOf` and `runCli` already exist in that file.

```js
// #4638: mergedScopedRepo's rules plus a bookkeeping path (no suite, no static)
// and a static-only path (no suite, static).
function zeroSuiteRepo() {
  const r = scopedRepo([
    { match: 'src/**', suites: ['unit'], static: true },
    { match: 'ui/**', suites: ['other'], static: true },
    { match: 'docs/**', suites: [] },
    { match: 'cfg/**', suites: [], static: true },
  ]);
  const trunk = r.branch;
  r.git('checkout', '-q', '-b', 'feat');
  return { ...r, trunk };
}

async function runScoped(r) {
  const run = await runCli(['--scope', r.declPath, '--integration-branch', r.trunk, '--cmd', `unit=${r.unitCmd}`, '--cmd', 'other=node -e 0', '--cmd', 'types=node -e 0', '--cmd', 'lint=node -e 0'], { cwd: r.repo });
  assert.strictEqual(run.code, 0, run.stderr);
  const stamp = stampOf(r.gitDir);
  return { run, stamp, report: JSON.parse(fs.readFileSync(stamp.reportPath, 'utf8')) };
}

test('--scope --integration-branch: AC1.1: at the integration tip the changed paths run their suites, never a zero-suite stamp (#4638)', async () => {
  const r = zeroSuiteRepo();
  await anchorFullPass(r);
  r.git('checkout', '-q', r.trunk);
  r.git('checkout', '-q', '-b', 'side');
  commitFile(r, 'src/merged.js', 'merged');
  r.git('checkout', '-q', r.trunk);
  r.git('merge', '-q', '--no-ff', '--no-edit', 'side');
  r.git('checkout', '-q', 'feat');
  r.git('merge', '-q', '--ff-only', r.trunk);
  const { run, stamp, report } = await runScoped(r);
  assert.doesNotMatch(run.stdout, /merge-narrowed/);
  assert.doesNotMatch(run.stdout, /still-verified/);
  assert.match(run.stdout, /^Scope: scoped — 1 changed file\(s\) since/m);
  assert.ok(fs.existsSync(r.marker), 'the unit suite must actually have run');
  assert.deepStrictEqual(stamp.suitesRun, ['unit']);
  assert.strictEqual(report.scope.mergeNarrowing, null);
  assert.deepStrictEqual(report.scope.changedFiles, ['src/merged.js']);
});

test('--scope --integration-branch: AC1.2 (Reading A): a pre-anchor own commit plus a merge never stamps from zero suites (#4638)', async () => {
  const r = zeroSuiteRepo();
  commitFile(r, 'src/pre.js', 'pre');
  await anchorFullPass(r);
  mergeTrunk(r, ['ui/a.js']);
  const { run, stamp, report } = await runScoped(r);
  assert.doesNotMatch(run.stdout, /still-verified/);
  assert.deepStrictEqual(stamp.suitesRun, ['other']);
  assert.strictEqual(report.scope.mergeNarrowing, null);
  assert.deepStrictEqual(report.scope.changedFiles, ['ui/a.js']);
});

test('--scope --integration-branch: AC1.2 (Reading A): a merge with nothing of its own never stamps from zero suites (#4638)', async () => {
  const r = zeroSuiteRepo();
  await anchorFullPass(r);
  mergeTrunk(r, ['ui/a.js']);
  const { stamp, report } = await runScoped(r);
  assert.deepStrictEqual(stamp.suitesRun, ['other']);
  assert.strictEqual(report.scope.mergeNarrowing, null);
});

test('--scope --integration-branch: AC1.2 (Reading A): a bookkeeping commit past a merge does not hide the merged-in paths (#4638)', async () => {
  const r = zeroSuiteRepo();
  await anchorFullPass(r);
  mergeTrunk(r, ['ui/a.js']);
  commitFile(r, 'docs/a.md', 'docs');
  const { run, stamp, report } = await runScoped(r);
  assert.doesNotMatch(run.stdout, /still-verified/);
  assert.deepStrictEqual(stamp.suitesRun, ['other']);
  assert.strictEqual(report.scope.mergeNarrowing, null);
  assert.deepStrictEqual(report.scope.changedFiles, ['docs/a.md', 'ui/a.js']);
});

test('--scope --integration-branch: AC1.2 (Reading A): a static-only narrowed set also declines (#4638)', async () => {
  const r = zeroSuiteRepo();
  await anchorFullPass(r);
  mergeTrunk(r, ['ui/a.js']);
  commitFile(r, 'cfg/a.json', '{}');
  const { stamp, report } = await runScoped(r);
  assert.deepStrictEqual(stamp.suitesRun, ['other']);
  assert.strictEqual(report.scope.mergeNarrowing, null);
});

test('--scope --integration-branch: AC1.2 (Reading B): a bookkeeping-only delta still stamps none, unnarrowed (#4638)', async () => {
  const r = zeroSuiteRepo();
  await anchorFullPass(r);
  mergeTrunk(r, ['docs/b.md']);
  commitFile(r, 'docs/a.md', 'docs');
  const { run, stamp, report } = await runScoped(r);
  assert.match(run.stdout, /^Scope: none — 2 changed file\(s\) since/m);
  assert.match(run.stdout, /still-verified: bookkeeping-only delta \(docs\/a\.md, docs\/b\.md\)/);
  assert.strictEqual(stamp.scope, 'none');
  assert.deepStrictEqual(stamp.suitesRun, []);
  assert.strictEqual(report.scope.mergeNarrowing, null);
});

test('--scope --integration-branch: AC1.2 (Reading A): narrowing that leaves a suite still narrows (#3072 stays) (#4638)', async () => {
  const r = zeroSuiteRepo();
  await anchorFullPass(r);
  mergeTrunk(r, ['ui/a.js']);
  commitFile(r, 'src/own.js', 'own');
  const { run, stamp, report } = await runScoped(r);
  assert.match(run.stdout, /^merge-narrowed: 1 merge-identical path\(s\) excluded/m);
  assert.deepStrictEqual(stamp.suitesRun, ['unit']);
  assert.deepStrictEqual(report.scope.mergeNarrowing.excludedFiles, ['ui/a.js']);
});
```

In `tests/bin-lib/verify/impact-cli.test.js`, at the end of the file. `impactRepo`, `writeMap`, `runCli` and `ARGS` already exist there. The base map traces `tests/a.test.js` reading `src/x.js` and `tests/b.test.js` reading `src/y.js`, so nothing reads `tests/b.test.js` itself:

```js
// #4638 round 2, Reading A: "any narrowing" means merge narrowing only. Deleting a
// test file no other test reads gives an empty impact subset with no merge
// involved; the suite drops, nothing runs, and the run still stamps `none`.
test('#4638 round-2 Reading A: an empty impact subset with no merge narrowing still stamps none', async () => {
  const r = impactRepo();
  writeMap(r);
  r.git('rm', '-q', 'tests/b.test.js');
  r.git('commit', '-q', '-m', 'delete b');
  const run = await runCli(ARGS, r.repo);
  assert.strictEqual(run.code, 0, run.stderr + run.stdout);
  assert.strictEqual(fs.existsSync(path.join(r.gitDir, 'impact-marker')), false, 'no test command ran');
  const report = r.report();
  assert.strictEqual(report.scope.mode, 'none');
  assert.deepStrictEqual(report.scope.suites, []);
  assert.deepStrictEqual(report.scope.changedFiles, ['tests/b.test.js']);
  assert.strictEqual(report.scope.mergeNarrowing, null);
  assert.deepStrictEqual(report.scope.impact.files, []);
  const stamp = r.stamp();
  assert.strictEqual(stamp.scope, 'none');
  assert.deepStrictEqual(stamp.suitesRun, []);
});
```

This test was run against the pre-change tree while the plan was being written, and it passed. It pins behavior that the change must leave alone.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test --test-name-pattern "#4638" tests/bin-lib/verify/changed-files.test.js tests/bin-lib/verify/cli.test.js tests/bin-lib/verify/impact-cli.test.js`
Expected: FAIL. The `AC1.1` unit tests fail because `mergeNarrowing` returns a narrowed object. The CLI `AC1.1` and `AC1.2` zero-suite tests fail on `still-verified`, `suitesRun` or `mergeNarrowing`. Three pass at this step, because they pin behavior that must survive. `a failing ahead-count read` goes red only under Step 5's mutation. `narrowing that leaves a suite still narrows` holds before and after. `an empty impact subset with no merge narrowing still stamps none` holds before and after too. This appends to three already-passing files, so plan-audit reports it as append-shaped.

- [ ] **Step 3: Implement both guards**

In `plugin/bin/lib/verify/changed-files.js`, after `if (!hasMergedRef) return null;` and before the `differs` read:

```js
const ahead = tryGit(execImpl, ['rev-list', '--count', '--end-of-options', `${ref}..HEAD`]);
if (ahead === null || ahead.trim() === '0') return null;
```

A `rev-list --count` read rather than `merge-base --is-ancestor`, because `tryGit` flattens the latter's "no" and "could not run" into the same `null`, and this guard must fail toward not narrowing. Extend the block comment above the function with: "Narrowing declines (#4638) when HEAD has no commit ahead of {ref}: {ref}'s tip would then vouch for itself, and the premise that it passed its own CI is exactly what the run is there to check. At 844e0d7eb this excluded all 298 changed paths and stamped a zero-suite pass. verify.js also drops a narrowing whose result selects no suite."

In `plugin/bin/verify.js`, capture the full set before the `parsed.integrationBranch && anchorSha` narrowing block (`const unnarrowed = { files, statuses };`). Right after `sel = select(impactCtx);`, before the impact-subset block, add the outcome guard:

```js
// #4638: narrowing never earns a zero-suite stamp. Re-select over the full set;
// a delta whose paths map to no suite still reads none there and still stamps.
if (narrowing && sel.suites.length === 0) {
  ({ files, statuses } = unnarrowed);
  narrowing = null;
  sel = select(impactCtx);
}
```

`sel.suites` is either an array or the string `'*'`, whose length is 1, so `length === 0` means zero suites in every mode, `static-only` included.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/bin-lib/verify/changed-files.test.js tests/bin-lib/verify/cli.test.js tests/bin-lib/verify/impact-cli.test.js tests/path-guard-conformance.test.js tests/windows-hide-spawn-conformance.test.js tests/test-skill-affected-conformance.test.js`
Expected: PASS, including every pre-existing `#3072` and `#4024` test with no pre-existing assertion edited.

- [ ] **Step 5: Prove each guard can go red**

In a scratch copy of the two source files (never `git stash`), or by editing and restoring with `git show HEAD:{path}`, apply each mutation alone. The named test must fail:

| Mutation | Test that must fail |
|---|---|
| Delete the `ahead.trim() === '0'` clause | `AC1.1: at the tip with a dirty tree narrowing still declines` |
| Delete the `ahead === null` clause | `a failing ahead-count read degrades to null` |
| Delete the `verify.js` outcome guard | `AC1.2 (Reading A): a pre-anchor own commit plus a merge never stamps from zero suites` |
| Change the guard's condition to `sel.mode === 'none'` | `AC1.2 (Reading A): a static-only narrowed set also declines` |
| Make the guard always fire when `narrowing` is set | `AC1.2 (Reading A): narrowing that leaves a suite still narrows` |
| Restore only `files`, not `statuses`, in the guard | none expected on this fixture: `statuses` is `null` without an `impact` block; report it as a known survivor |
| In `scope.js:100`, make an empty impact subset keep the suite (`selected.add(suite)` unconditionally) | `#4638 round-2 Reading A: an empty impact subset with no merge narrowing still stamps none` |

The new `ahead` guard sits ahead of the `differs`, `status` and `mb` reads. Their existing failure-path tests still reach them, because `mergeTrunkWith`'s merge commit is one commit ahead of trunk. Prove that: delete the `status === null` return and confirm `a failing working-tree status read degrades to null` fails, and delete the `mb === null` return and confirm `a failing anchor merge-base or pre-anchor diff degrades to null` fails.

Report each mutation's result. A surviving mutant other than the one named above is a finding, not a pass.

- [ ] **Step 6: Update the prose that describes the old behavior**

In `plugin/skills/test/verification.md:94`, insert directly after the sentence ending "(e.g. a merge conflict resolved in `{ref}`'s favour).":

"Narrowing declines when HEAD has no commit ahead of `{ref}` (the integration tip itself, or behind it on that line), and the runner drops it when the narrowed set selects no suite: `{ref}`'s tip must not vouch for itself, and narrowing never earns a zero-suite stamp. A delta whose paths map to no suite at all still selects `none` over the full set and still stamps. So does an empty test-impact subset, since the rule covers merge narrowing only (#4638)."

In the same paragraph, change "`null` when no qualifying merge was found" to "`null` when no qualifying merge was found or narrowing declined".

In `docs/plugin-structure.md:58`, in the `#3072 mergeNarrowing` clause, after "keeping working-tree edits and every path the branch touched before its anchor, `--no-renames` throughout —", add: "declining when HEAD has no commit ahead of the ref (#4638) —". In `docs/plugin-structure.md:197`, change "null when no qualifying merge)" to "null when no qualifying merge or when narrowing declined — HEAD has no commit ahead of that branch, or the narrowed set selects no suite, #4638)".

Headroom: `verification.md` is about 42,300 B against the 52,500 B rail; this adds about 430 B.

- [ ] **Step 7: Run the affected suites**

Run: `node --test tests/bin-lib/verify/changed-files.test.js tests/bin-lib/verify/cli.test.js tests/bin-lib/verify/impact-cli.test.js tests/test-skill-affected-conformance.test.js tests/skill-size-single-source.test.js`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add plugin/bin/lib/verify/changed-files.js plugin/bin/verify.js tests/bin-lib/verify/changed-files.test.js tests/bin-lib/verify/cli.test.js tests/bin-lib/verify/impact-cli.test.js plugin/skills/test/verification.md docs/plugin-structure.md
git commit -m "Keep merge narrowing from earning a zero-suite stamp — refs #4638"
```
