# PR-Bookkeeping Multi-Spec Regression Tests Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pin #2571's multi-spec per-spec runDir fix at the `checkPrBookkeepingPrecondition` / `check-pr-bookkeeping.js` level, and record the traced answer to where a multi-spec run's `run-state.json` lives.

**Architecture:** Two new test groups, one per existing test file in `tests/bin-lib/pr-bookkeeping/`. Each builds a real temp git repo plus a linked worktree, and a run dir nested one level deeper (`{parent-run-id}/spec-{N}/`) with a committed `spec-{N}/work/{N}-spec.md`. Each is proven red by temporarily reverting #2571's `perSpec` pathspec in `hasMaterializeCommit`. A comment above `precondition.js`'s `readRunState(runDir)` call records the traced writer path. No lookup code changes: the trace found no reader/writer mismatch, so Deliverable 3 is not triggered.

**Tech Stack:** Node 18+, `node:test`, `node:assert/strict`, real `git` via `execFileSync`.

**Spec:** `.claude-tweaks/pipelines/2026-09-30T190052-spec-2633-2664/spec-2664/work/2664-spec.md`

## Global Constraints

- Keep fixtures hermetic. Use temp dirs only (`fs.mkdtempSync(os.tmpdir() …)`), never the real `.claude-tweaks/pipelines/` of the checkout running the tests.
- Don't change `precondition.js`'s lookup. The Deliverable 2 trace (below) found no mismatch, so only the comment is added.
- Prove the test can go red before trusting it green: revert the #2571 helper fix locally, confirm the new test fails, then restore.
- `npm test` passes, except the 3 pre-existing `tests/impeccable-plugin-contract.test.js` failures (run ledger row 2, tracked in #2840).
- Commit message style: `{Verb} {what} — {detail} (refs #2664)`. Never use `closes`/`fixes` in commit messages.

### Deliverable 2 trace (already done, the input to Task 3)

> **Superseded during build:** the whole-branch review showed this trace's conclusion is wrong. Run-dir enumeration is top-level only, so a multi-spec run's shared `worktree`/`pr` stamps canonically live on the PARENT run dir, and the hook gate, `pack.js` `resolveState`, `engine-verify.js` `resolvePrNumber`, and the multispec console all read them there. Deliverable 3 WAS triggered. `precondition.js` now falls back per-spec → parent (commits 837d59fd3, c29752cb4). See the comment in `precondition.js` for the authoritative trace. The bullets below are kept as the original, disproven reasoning.

- **Writer:** `plugin/bin/lib/hooks/context.js` `writeRunState(runDir, patch)` writes `{runDir}/run-state.json`. The pipeline writers of the `worktree`/`pr` fields are `plugin/bin/hooks.js`'s `record-worktree` handler (`--run` required, #1124) and `record-pr` handler (`--run`, else `resolveImplicitRunUnambiguous`, whose first arm is `PIPELINE_RUN_DIR`).
- **Other callers (sole-site proof):** `grep -rn "writeRunState(" plugin/bin` lists 12 call sites. The rest either mint a separate ad-hoc dir (`context.js:587` `stampAdHocRunDir`, `post-tool-use.js:339`, both `standalone: 'adhoc'`) or patch only status or exemption fields onto the dir they're handed (`pre-tool-use.js:1735/1737/1845`, `close-run-state.js:109`, `session-end.js:25`, `pre-compact.js:18`, `reconcile/archive-merged.js:798/1160`). None writes to a parent dir.
- **Per-spec writes:** in a `/flow` multi-spec run, each spec's own `/build` writes its per-spec `{parent}/spec-{N}/` dir:
  - `build/worktree-setup.md` Step 4.5 `record-worktree` is still run under `MULTISPEC_SHARED_WORKTREE`.
  - Step 6 → `_shared/pr-early-run-lifecycle.md` Step 1 reuses the already-open PR and runs `record-pr` on it.
- **Parent dir:** the parent may carry its own `run-state.json` from `/flow`'s run-level steps.
- **Reader:** `precondition.js` `readRunState(runDir)` reads the same per-spec dir, so there's no mismatch.

## Review Focus

1. **Sibling spec's materialize commit.** Only `spec-8` has materialized, and the check runs for `spec-7`. Expected: `not-materialized-yet`, never a denial keyed off a sibling. Test: Task 1, "sibling".
2. **Parent stamped, per-spec not.** The parent `run-state.json` has `worktree` + `pr`, and the per-spec dir has none. Expected: still `no-worktree-stamp`. There is no parent fallback, which pins the Task 3 comment's claim. Test: Task 1, "parent-only stamps".
3. **Per-spec dir nested under the main checkout, through the CLI.** It must be accepted as anchored (exit 0 when stamped), not refused as a shadow copy (exit 3). Test: Task 2, "stamped per-spec run exits 0".
4. **Per-spec dir with no stamps at all, through the CLI.** Expected: exit 4 with the `record-worktree` remediation on stderr and nothing on stdout. Test: Task 2, "exit 4".
5. **A `spec-{N}` dir whose parent is not run-id-shaped.** Already pinned at helper level by `tests/hooks-bookkeeping-stamps-gate.test.js` ("#2571 unit … falls through unchanged"). No new test.

---

### Task 1: Precondition-level multi-spec per-spec runDir tests

**Files:**
- Test: `tests/bin-lib/pr-bookkeeping/precondition.test.js` (append at end of file)
- Reference only: `plugin/bin/lib/hooks/pre-tool-use.js` (`hasMaterializeCommit`, `perSpecPathspec`, ~line 1064-1156)

**Interfaces:**
- Consumes: the file's existing helpers `gitRepoWithCommit()`, `linkedWorktreeOf(main)`, `makeRunDir(id)` (returns `{project}/.claude-tweaks/pipelines/{id}`), `writeRunState(runDir, state)`, and `checkPrBookkeepingPrecondition({ runDir, cwd })` → `{ ok, reason, message? }`.
- Produces: new helper `commitPerSpecMaterializeFile(repo, parentId, n)`, local to this file.

- [ ] **Step 1: Append the helper and four tests**

Append to the end of `tests/bin-lib/pr-bookkeeping/precondition.test.js`:

```js
// #2664: a multi-spec /flow run hands each spec's skills a PER-SPEC
// $PIPELINE_RUN_DIR ({parent-run-id}/spec-{N}/, flow/multi-spec.md's env-var
// table), and materialize commits that spec's file at
// {parent-run-id}/spec-{N}/work/{N}-spec.md. Before #2571, hasMaterializeCommit
// keyed its pathspec off path.basename(runDir) ("spec-{N}", never a real run
// id), so the materialize commit was never found and this precondition
// silently returned not-materialized-yet for every multi-spec run.
function commitPerSpecMaterializeFile(repo, parentId, n) {
  const rel = path.join('.claude-tweaks', 'pipelines', parentId, `spec-${n}`, 'work', `${n}-spec.md`);
  const full = path.join(repo, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, 'spec\n');
  execFileSync('git', ['-C', repo, 'add', rel.split(path.sep).join('/')]);
  execFileSync('git', ['-C', repo, 'commit', '-m', `materialize ${n}`, '-q']);
}

test('checkPrBookkeepingPrecondition (#2664): a multi-spec per-spec runDir recognizes its own materialize commit -> no-worktree-stamp, not a false not-materialized-yet', () => {
  const parentId = '2026-09-17T000012-spec-7-8';
  const main = gitRepoWithCommit();
  const wt = linkedWorktreeOf(main);
  commitPerSpecMaterializeFile(wt, parentId, 7);
  const runDir = path.join(makeRunDir(parentId), 'spec-7');
  fs.mkdirSync(runDir, { recursive: true });
  // No per-spec run-state.json -- Step 4.5's record-worktree never ran for this spec.
  const r = checkPrBookkeepingPrecondition({ runDir, cwd: wt });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'no-worktree-stamp');
  assert.match(r.message, /record-worktree/);
});

test('checkPrBookkeepingPrecondition (#2664): a stamped multi-spec per-spec runDir passes as pr-stamped-or-exempt', () => {
  const parentId = '2026-09-17T000013-spec-7-8';
  const main = gitRepoWithCommit();
  const wt = linkedWorktreeOf(main);
  commitPerSpecMaterializeFile(wt, parentId, 7);
  const runDir = path.join(makeRunDir(parentId), 'spec-7');
  fs.mkdirSync(runDir, { recursive: true });
  writeRunState(runDir, { status: 'active', worktree: wt, pr: { number: 1, url: 'https://example.com/1' } });
  const r = checkPrBookkeepingPrecondition({ runDir, cwd: wt });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.reason, 'pr-stamped-or-exempt');
});

test('checkPrBookkeepingPrecondition (#2664): a per-spec runDir does NOT arm off a SIBLING spec\'s materialize commit', () => {
  const parentId = '2026-09-17T000014-spec-7-8';
  const main = gitRepoWithCommit();
  const wt = linkedWorktreeOf(main);
  // Only spec-8 has materialized; this check runs on behalf of spec-7.
  commitPerSpecMaterializeFile(wt, parentId, 8);
  const runDir = path.join(makeRunDir(parentId), 'spec-7');
  fs.mkdirSync(runDir, { recursive: true });
  const r = checkPrBookkeepingPrecondition({ runDir, cwd: wt });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.reason, 'not-materialized-yet');
});

test('checkPrBookkeepingPrecondition (#2664): parent-only stamps do not satisfy a per-spec runDir -- run-state.json is read from the per-spec dir, no parent fallback', () => {
  const parentId = '2026-09-17T000015-spec-7-8';
  const main = gitRepoWithCommit();
  const wt = linkedWorktreeOf(main);
  commitPerSpecMaterializeFile(wt, parentId, 7);
  const parentRunDir = makeRunDir(parentId);
  writeRunState(parentRunDir, { status: 'active', worktree: wt, pr: { number: 1, url: 'https://example.com/1' } });
  const runDir = path.join(parentRunDir, 'spec-7');
  fs.mkdirSync(runDir, { recursive: true });
  const r = checkPrBookkeepingPrecondition({ runDir, cwd: wt });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, 'no-worktree-stamp');
});
```

- [ ] **Step 2: Revert #2571's per-spec pathspec and run the new tests to prove red**

Apply the temporary revert, making `hasMaterializeCommit` ignore `perSpec` exactly as it did before #2571:

```bash
sed -i '' 's/const paths = perSpec || /const paths = null || /' plugin/bin/lib/hooks/pre-tool-use.js
```

Run: `node --test --test-name-pattern "#2664" tests/bin-lib/pr-bookkeeping/precondition.test.js`
Expected: FAIL after Step 1 (with the revert applied). The "no-worktree-stamp, not a false not-materialized-yet", "pr-stamped-or-exempt" and "parent-only stamps" tests fail with `reason` `'not-materialized-yet'`. The sibling test still passes, because it pins the other direction and doesn't discriminate against the revert.

- [ ] **Step 3: Restore the helper and confirm the tree is clean for that file**

```bash
git checkout -- plugin/bin/lib/hooks/pre-tool-use.js
```

Then run `git diff --exit-code -- plugin/bin/lib/hooks/pre-tool-use.js`. Expected: exit 0, no output.

- [ ] **Step 4: Run the full file on the restored helper**

Run: `node --test tests/bin-lib/pr-bookkeeping/precondition.test.js`
Expected: PASS. All tests pass, the 4 new ones included.

- [ ] **Step 5: Commit**

```bash
git add tests/bin-lib/pr-bookkeeping/precondition.test.js
git commit -m "Add multi-spec per-spec runDir tests for checkPrBookkeepingPrecondition — pins #2571's fix at the precondition level (refs #2664)"
```

---

### Task 2: CLI-level multi-spec per-spec runDir tests

**Files:**
- Test: `tests/bin-lib/pr-bookkeeping/cli.test.js` (append at end of file)

**Interfaces:**
- Consumes: the file's existing helpers `gitRepoWithCommit()`, `linkedWorktreeOf(main)`, `makeDeps({ cwd, mainRoot })` (returns `{ deps, out, err }`), and `run(argv, deps)`, which exits 0 on ok, 4 on a violation, and 3 on an unanchored or missing run dir. The ok line on stdout is `check-pr-bookkeeping.js: ok ({reason})`.
- Produces: new helper `commitPerSpecMaterializeFile(repo, parentId, n)`, local to this file with the same body as Task 1's. Test files here don't share helpers, which matches the existing duplicated `gitRepoWithCommit`/`linkedWorktreeOf`.

- [ ] **Step 1: Append the helper and two tests**

Append to the end of `tests/bin-lib/pr-bookkeeping/cli.test.js`:

```js
// #2664: the same multi-spec per-spec runDir shape as precondition.test.js's
// #2664 cases, driven end-to-end through the CLI's run() -- the run dir is
// anchored under the main checkout ({main}/.claude-tweaks/pipelines/
// {parent-run-id}/spec-{N}/), the real layout, and resolveTarget computes the
// anchor itself (mainRoot omitted) via a genuine git-worktree traversal.
function commitPerSpecMaterializeFile(repo, parentId, n) {
  const rel = path.join('.claude-tweaks', 'pipelines', parentId, `spec-${n}`, 'work', `${n}-spec.md`);
  const full = path.join(repo, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, 'spec\n');
  execFileSync('git', ['-C', repo, 'add', rel.split(path.sep).join('/')]);
  execFileSync('git', ['-C', repo, 'commit', '-m', `materialize ${n}`, '-q']);
}

test('run (#2664): an unstamped multi-spec per-spec run dir with a landed materialize commit exits 4', () => {
  const main = gitRepoWithCommit();
  const wt = linkedWorktreeOf(main);
  const parentId = '2026-09-17T000016-spec-7-8';
  commitPerSpecMaterializeFile(wt, parentId, 7);
  const runDir = path.join(main, '.claude-tweaks', 'pipelines', parentId, 'spec-7');
  fs.mkdirSync(runDir, { recursive: true });
  const { deps, err, out } = makeDeps({ cwd: wt });
  const code = run(['--run', runDir], deps);
  assert.strictEqual(code, 4);
  assert.match(err.join(''), /record-worktree/);
  assert.strictEqual(out.join(''), '', 'a violation must never print an ok result');
});

test('run (#2664): a stamped multi-spec per-spec run dir exits 0 as pr-stamped-or-exempt', () => {
  const main = gitRepoWithCommit();
  const wt = linkedWorktreeOf(main);
  const parentId = '2026-09-17T000017-spec-7-8';
  commitPerSpecMaterializeFile(wt, parentId, 7);
  const runDir = path.join(main, '.claude-tweaks', 'pipelines', parentId, 'spec-7');
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'run-state.json'), JSON.stringify({
    status: 'active', worktree: wt, pr: { number: 1, url: 'https://example.com/1' },
  }));
  const { deps, out } = makeDeps({ cwd: wt });
  const code = run(['--run', runDir], deps);
  assert.strictEqual(code, 0);
  assert.match(out.join(''), /ok \(pr-stamped-or-exempt\)/);
});
```

- [ ] **Step 2: Revert #2571's per-spec pathspec and run the new tests to prove red**

```bash
sed -i '' 's/const paths = perSpec || /const paths = null || /' plugin/bin/lib/hooks/pre-tool-use.js
```

Run: `node --test --test-name-pattern "#2664" tests/bin-lib/pr-bookkeeping/cli.test.js`
Expected: FAIL after Step 1 (with the revert applied):
- The exit-4 test fails, with `code` 0 instead of 4 (reason `not-materialized-yet`).
- The exit-0 test fails its stdout match, because stdout reads `ok (not-materialized-yet)`.

- [ ] **Step 3: Restore the helper and confirm the tree is clean for that file**

```bash
git checkout -- plugin/bin/lib/hooks/pre-tool-use.js
```

Then run `git diff --exit-code -- plugin/bin/lib/hooks/pre-tool-use.js`. Expected: exit 0, no output.

- [ ] **Step 4: Run the full file on the restored helper**

Run: `node --test tests/bin-lib/pr-bookkeeping/cli.test.js`
Expected: PASS. All tests pass, the 2 new ones included.

- [ ] **Step 5: Commit**

```bash
git add tests/bin-lib/pr-bookkeeping/cli.test.js
git commit -m "Add CLI-level multi-spec per-spec runDir tests for check-pr-bookkeeping.js — exit 4 unstamped, exit 0 stamped (refs #2664)"
```

---

### Task 3: Document where a multi-spec run's run-state.json lives

**Files:**
- Modify: `plugin/bin/lib/pr-bookkeeping/precondition.js:27-29`, adding a comment immediately above the `let runState;` line in `checkPrBookkeepingPrecondition`.

**Interfaces:**
- Consumes: nothing new. This task is comment only, and no code changes.
- Produces: nothing consumed by other tasks.

- [ ] **Step 1: Add the comment**

In `plugin/bin/lib/pr-bookkeeping/precondition.js`, replace:

```js
  if (!runDir) return { ok: true, reason: 'no-run-dir' };

  let runState;
```

with:

```js
  if (!runDir) return { ok: true, reason: 'no-run-dir' };

  // Where run-state.json lives for a /flow multi-spec run (#2664 -- traced
  // from the writers, #2571 Deliverable 2): always {runDir}/run-state.json
  // for whichever dir the writer was handed. Every write goes through
  // hooks/context.js's writeRunState(runDir, patch); the pipeline writers of
  // the `worktree`/`pr` fields read below are bin/hooks.js's record-worktree
  // handler (--run required, #1124) and record-pr handler (--run, else
  // resolveImplicitRunUnambiguous, whose first arm is PIPELINE_RUN_DIR).
  // writeRunState's other callers either mint a separate ad-hoc run dir
  // (context.js's stampAdHocRunDir, post-tool-use.js's stamp) or patch only
  // status/exemption memos (prExempt, close-run, session-end) onto the dir
  // they were handed -- none redirects a write to a parent dir. Each spec's
  // own /build stamps its
  // PER-SPEC {parent-run-id}/spec-{N}/ dir: build/worktree-setup.md Step 4.5
  // (record-worktree) still runs under MULTISPEC_SHARED_WORKTREE, and Step 6
  // (_shared/pr-early-run-lifecycle.md Step 1) reuses the already-open
  // shared PR and record-pr's it. The parent dir may carry its own
  // run-state.json from /flow's run-level steps, but it is never read here.
  // A per-spec skill's $PIPELINE_RUN_DIR is that per-spec dir, so reading
  // runDir reads the same file its writers wrote -- reader and writers
  // agree, and no parent fallback is taken: a per-spec dir missing its own
  // stamps means that spec skipped Step 4.5/6, which is exactly what this
  // check exists to report.
  let runState;
```

- [ ] **Step 2: Verify the comment names the traced writer**

Run: `node -e 'const s=require("fs").readFileSync("plugin/bin/lib/pr-bookkeeping/precondition.js","utf8");process.exit(["writeRunState","context.js","record-worktree","record-pr","spec-{N}","no parent fallback"].every(t=>s.includes(t))?0:1)'`
Expected: FAIL before Step 1 (exit 1); PASS after Step 1 (exit 0).

- [ ] **Step 3: Confirm no lookup code changed**

Run: `git diff -U0 -- plugin/bin/lib/pr-bookkeeping/precondition.js`
Expected: every added line (`+`) is a `//` comment line, and there are no removed (`-`) lines apart from the diff header.

- [ ] **Step 4: Run both pr-bookkeeping suites**

Run: `node --test tests/bin-lib/pr-bookkeeping/precondition.test.js tests/bin-lib/pr-bookkeeping/cli.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/pr-bookkeeping/precondition.js
git commit -m "Document where a multi-spec run's run-state.json lives in precondition.js — traced to writeRunState via record-worktree/record-pr, no lookup change (refs #2664)"
```
