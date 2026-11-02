# Scoped Verify at the Integration Tip Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A scoped verify run with `--integration-branch` at the integration tip runs the suites its changed paths map to, instead of excluding them all as "identical to the tip" and stamping `verifiedHead: true` from zero suites.

**Architecture:** `mergeNarrowing` trusts merged-in files on the premise that `{ref}`'s tip passed its own CI. That premise only means something when the branch has work of its own to set against `{ref}`. With nothing of its own, `{ref}`'s tip vouches for itself. The function declines (returns `null`, its documented over-verifying fallback) in exactly that case, so `verify.js` needs no change: `narrowing` is `null`, the full `anchor..HEAD` set reaches `selectScope`, and the suites run.

**Tech Stack:** Node 18+, `node --test`, git plumbing through the injectable `execImpl` seam.

**Spec:** `.claude-tweaks/pipelines/2026-11-02T105933-record-4638/work/4638-spec.md`

## Global Constraints

- Acceptance criterion, verbatim: "A scoped run at the integration tip runs the suites its changed paths map to, or reports that it verified nothing; it never stamps verifiedHead from zero suites over a non-empty delta."
- Commit style: `{Verb} {what} — {detail}`, imperative, no conventional prefix; reference the record as `refs #4638`, never `closes`/`fixes`.
- `.claude/skills/gh-api-module-pattern/SKILL.md`, quoted: "A seam whose calls are *probes* runs quiet" — every new git call goes through the existing `tryGit(execImpl, …)`.
- `.claude/skills/gh-api-module-pattern/SKILL.md`, quoted: "A module that parses git's output pins that output's format against the user's and the repo's git config." The new read is `rev-list --count`, a bare integer no diff or color config rewrites.
- `changed-files.js`'s own header rule, quoted: "the fallback over-verifies, never under-verifies." A failed read in the new guard returns `null`, never a narrowed set.
- Path-containment and spawn scans: `tests/path-guard-conformance.test.js` and `tests/windows-hide-spawn-conformance.test.js` run with this task's focused tests. The change adds no `fs` call and no direct spawn.
- No `git stash` in any form.

## Review Focus

Each line is pinned by a named test in Task 1.

1. HEAD is the integration tip and the tree is dirty: the dirty path must not license excluding everything else. Expected `null`. Test: `AC1.1: at the tip with a dirty tree narrowing still declines`.
2. HEAD sits on the integration line behind its tip: no commit of its own, so `{ref}` cannot vouch for it. Expected `null`. Test: `AC1.1: behind the tip on the integration line narrowing declines`.
3. A no-ff merge commit whose tree equals `{ref}`, no own work, clean: not an ancestor of `{ref}`, but still self-vouching. Expected `null`. Test: `AC1.2: a merge-only branch with nothing of its own declines`.
4. A branch with real own work and a `--theirs` conflict resolution: tree equals `{ref}`, yet it must keep narrowing (#3072 Important 2). The existing test at `changed-files.test.js` "a conflict resolved in the integration branch's favour" stays green, unedited.
5. The count read fails: never reads as "ahead of ref". Expected `null`. Test: `a failing ahead-count read degrades to null`.

---

### Task 1: Decline merge narrowing when the branch has nothing of its own

**Review risk:** high
**Role:** integration

**Files:**
- Modify: `plugin/bin/lib/verify/changed-files.js:165-205`
- Test: `tests/bin-lib/verify/changed-files.test.js`
- Test: `tests/bin-lib/verify/cli.test.js`
- Modify: `plugin/skills/test/verification.md:94`
- Modify: `docs/plugin-structure.md:58`
- Modify: `docs/plugin-structure.md:194`

`Waived docs/journeys/run-a-deterministic-verification-check.md: Common Step 6 (/claude-tweaks:journeys) owns journey edits; its step 14 "Should understand" and "Red flags" lines need the new decline rule.`

`verify.js` is a consumer that needs no edit: line 611 assigns `narrowing`, a `null` already means "use the unnarrowed set", and line 1029 reports it as `mergeNarrowing: null`. `mergeNarrowing` has one production caller (`git grep -n "mergeNarrowing(" -- plugin` lists only `plugin/bin/verify.js:611` and the definition).

**Interfaces:**
- Consumes: `tryGit`, `preferOriginRef`, `parseNameOnlyZ` in `changed-files.js`.
- Produces: `mergeNarrowing({ anchor, integrationBranch, files, execImpl })` keeps its signature and return shape; it returns `null` in the two new cases below.

- [ ] **Step 1: Write the failing tests**

In `tests/bin-lib/verify/changed-files.test.js`, after the `#3072 Important 2` test, add the tests below. `tipRepo` builds the shape behind the incident: the anchor on the integration line, then a real merge landing on that line, then `feat` fast-forwarded onto it.

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

test('AC1.2: a merge-only branch with nothing of its own declines (#4638)', () => {
  const r = mergeRepo();
  mergeTrunkWith(r, [['ui/a.js', 'a']]);
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

Re-point two existing failure-path fixtures, or the new final guard makes them pass without reaching the read they exist to test. In `a failing working-tree status read degrades to null` and `a failing anchor merge-base or pre-anchor diff degrades to null`, add `r.commit('src/own.py', 'own');` straight after `mergeTrunkWith(...)`. Add this control as the last line of the status test:

```js
  assert.ok(mergeNarrowing({ anchor: r.anchor, integrationBranch: 'trunk', files, execImpl: r.exec }), 'control: the same repo narrows when git succeeds');
```

In `tests/bin-lib/verify/cli.test.js`, after the `#3072 AC3` test, add the end-to-end regression. It uses the `mergedScopedRepo`, `anchorFullPass`, `commitFile`, `stampOf` and `runCli` helpers already in that file. `r.marker` is the file `unitCmd` writes, and `anchorFullPass` deletes it after the anchor run.

```js
test('--scope --integration-branch: at the integration tip the changed paths run their suites, never a zero-suite stamp (#4638 AC1.1, AC1.2)', async () => {
  const r = mergedScopedRepo();
  await anchorFullPass(r);
  r.git('checkout', '-q', r.trunk);
  r.git('checkout', '-q', '-b', 'side');
  commitFile(r, 'src/merged.js', 'merged');
  r.git('checkout', '-q', r.trunk);
  r.git('merge', '-q', '--no-ff', '--no-edit', 'side');
  r.git('checkout', '-q', 'feat');
  r.git('merge', '-q', '--ff-only', r.trunk);
  const run = await runCli(['--scope', r.declPath, '--integration-branch', r.trunk, '--cmd', `unit=${r.unitCmd}`, '--cmd', 'other=node -e 0'], { cwd: r.repo });
  assert.strictEqual(run.code, 0, run.stderr);
  assert.doesNotMatch(run.stdout, /merge-narrowed/);
  assert.doesNotMatch(run.stdout, /still-verified/);
  assert.match(run.stdout, /^Scope: scoped — 1 changed file\(s\) since/m);
  assert.ok(fs.existsSync(r.marker), 'the unit suite must actually have run');
  const s = stampOf(r.gitDir);
  assert.deepStrictEqual(s.suitesRun, ['unit']);
  const report = JSON.parse(fs.readFileSync(s.reportPath, 'utf8'));
  assert.strictEqual(report.scope.mergeNarrowing, null);
  assert.deepStrictEqual(report.scope.changedFiles, ['src/merged.js']);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test --test-name-pattern "#4638" tests/bin-lib/verify/changed-files.test.js tests/bin-lib/verify/cli.test.js`
Expected: FAIL. The `AC1.1` and `AC1.2` tests fail because `mergeNarrowing` returns a narrowed object, and the CLI test fails on `/merge-narrowed/`. This appends to two already-passing files, so plan-audit reports it as append-shaped. `a failing ahead-count read` passes at this step, because no such read exists yet; it goes red only under the mutation in Step 5.

- [ ] **Step 3: Implement the two declines in `mergeNarrowing`**

Keep the signature. Add two guards:

1. After `if (!hasMergedRef) return null;` and before the `differs` read:
   ```js
   const ahead = tryGit(execImpl, ['rev-list', '--count', '--end-of-options', `${ref}..HEAD`]);
   if (ahead === null || ahead.trim() === '0') return null;
   ```
   A `rev-list --count` read rather than `merge-base --is-ancestor`, because `tryGit` flattens the latter's "no" and "could not run" into the same `null`, and this guard must fail toward not narrowing.
2. After the `ownAsOfAnchor` loop and before `const excluded = …`: `if (own.size === 0) return null;`.

Extend the block comment above the function with: "Narrowing declines (#4638) when the branch has nothing of its own to set against {ref} — HEAD has no commit ahead of {ref}, or the own set came out empty. {ref}'s tip would then vouch for itself, and the premise that it passed its own CI is exactly what the run is there to check: at 844e0d7eb this excluded all 298 changed paths and stamped a zero-suite pass."

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/bin-lib/verify/changed-files.test.js tests/bin-lib/verify/cli.test.js tests/path-guard-conformance.test.js tests/windows-hide-spawn-conformance.test.js tests/test-skill-affected-conformance.test.js`
Expected: PASS, including every pre-existing `#3072` test, with no `#3072` assertion edited.

- [ ] **Step 5: Prove each guard and each re-pointed downstream test can go red**

In a scratch checkout, per the dispatch instructions. Each mutation is applied alone, and the named test must fail:

| Mutation to `changed-files.js` | Test that must fail |
|---|---|
| Delete the `ahead.trim() === '0'` clause | `AC1.1: at the tip with a dirty tree narrowing still declines`, `AC1.1: behind the tip on the integration line narrowing declines` |
| Delete the `ahead === null` clause | `a failing ahead-count read degrades to null` |
| Delete `if (own.size === 0) return null;` | `AC1.2: a merge-only branch with nothing of its own declines` |
| Delete both guards | `--scope --integration-branch: at the integration tip the changed paths run their suites` |
| Delete the `status === null` return | `a failing working-tree status read degrades to null` |
| Delete the `mb === null` return | `a failing anchor merge-base or pre-anchor diff degrades to null` |
| Delete the `ownAsOfAnchor === null` return | `a failing anchor merge-base or pre-anchor diff degrades to null` |

Report each mutation's result. A surviving mutant is a finding, not a pass. The clean HEAD-at-tip test alone does not separate the two guards, since either one declines there; the dirty and behind-tip tests are what isolate the first, and the merge-only test isolates the second.

- [ ] **Step 6: Update the prose that describes the old behavior**

In `plugin/skills/test/verification.md:94`, insert this sentence directly after the sentence ending "(e.g. a merge conflict resolved in `{ref}`'s favour).":

"Narrowing also needs something of the branch's own to set against `{ref}`: when HEAD has no commit ahead of `{ref}` — the integration tip itself, or behind it on that line — or the branch's own set comes out empty, it declines and every changed path selects its suites as usual, since `{ref}`'s tip would otherwise vouch for itself (#4638)."

In the same paragraph, change "`null` when no qualifying merge was found" to "`null` when no qualifying merge was found or narrowing declined".

In `docs/plugin-structure.md:58`, in the `#3072 mergeNarrowing` clause, after "keeping working-tree edits and every path the branch touched before its anchor, `--no-renames` throughout —", add: "declining when HEAD has no commit ahead of the ref or the branch's own set is empty (#4638) —". In `docs/plugin-structure.md:194`, change "null when no qualifying merge)" to "null when no qualifying merge, or when HEAD has no commit ahead of that branch or nothing of its own (#4638))".

Headroom: `verification.md` is 42,277 B against the 52,500 B rail; this adds about 300 B.

- [ ] **Step 7: Run the affected suites**

Run: `node --test tests/bin-lib/verify/changed-files.test.js tests/bin-lib/verify/cli.test.js tests/test-skill-affected-conformance.test.js tests/skill-size-single-source.test.js`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add plugin/bin/lib/verify/changed-files.js tests/bin-lib/verify/changed-files.test.js tests/bin-lib/verify/cli.test.js plugin/skills/test/verification.md docs/plugin-structure.md
git commit -m "Decline merge narrowing when the branch has nothing of its own — refs #4638"
```
