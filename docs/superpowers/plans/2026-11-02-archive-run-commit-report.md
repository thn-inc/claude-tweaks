# archive-run commit report Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `archiveRunDir`'s silent `[reconcile] archive run` commit visible: in its return value, in `hooks.js archive-run`'s stdout, and in the reconcile `--json` run entry.

**Architecture:** `archiveRunDir` captures `{ sha, branch }` right after its commit succeeds. A new exported formatter in `archive-merged.js` builds the stdout line, so its git probes share that module's repo-pinned `runGit` (#4178) rather than re-deriving a pinned spawn in `hooks.js`. `archiveMerged` collects a `dir -> commit` map beside its unchanged `archived` string array, and `reconcile/index.js` copies the entry into the run row.

**Tech Stack:** Node 18+, `node --test`, git CLI.

**Spec:** `.claude-tweaks/pipelines/2026-11-02T131043-record-3721/work/3721-spec.md`

**Scope keywords:** archiveRunDir, archiveMerged

## Global Constraints

- Line format, verbatim from Deliverable 2: `claude-tweaks: committed {sha} on {branch} (not pushed — {n} ahead of {upstream})`; no upstream: `(no upstream configured)`; ahead-count probe failed: `(push state unknown)`. The line never fails the verb.
- `commit` is absent when no tracked content moved and no commit ran.
- An unborn or detached HEAD reports the branch as `detached` rather than throwing.
- Resolve every probe from `mainRoot`, not `process.cwd()`.
- Out of scope (#3396): pushing, or skipping the commit on the integration branch.
- `result.archived` stays an array of strings: `tests/bin-lib/reconcile/archive-merged.test.js:6062,6079,6101,6268` deep-equal it (return-shape widening check). The new data is a separate additive key.
- From `.claude/skills/gh-api-module-pattern/SKILL.md`, verbatim: "**An argv array stops shell injection, not flag injection.** A caller-supplied value that begins with `-` is still read as an *option* by the command itself". The one interpolated value here is prefixed (`refs/heads/{branch}`), so no separator is owed.
- From `.claude/skills/parse-signal-discipline/SKILL.md`, verbatim: "`grep` exits 1 for no match and 2 for an error; `git grep` exits 1 for no match and 128 when it cannot run. Reading empty output as \"no match\" collapses the two." Applied: `git for-each-ref` exit 0 with empty stdout is the only "no upstream" signal; a non-zero exit is `push state unknown`.
- `.claude/skills/hooks-js-verb-registration`: no verb or flag changes here, so its registration sites do not apply. `.claude/skills/merge-shape-landed-proof` and the other skills naming `hooks.js`: no rule applies to a stdout line.

Waived `plugin/bin/lib/reconcile/archive-merged.js:1302`, `:1503`, `plugin/bin/hooks.js:1249-1252`: the spec's line numbers are stale (current sites are `:1548`, `:1749`, `hooks.js:1398-1401`); same code.

## Review Focus

- Upstream configured but its remote ref is gone: expect `(push state unknown)`, not a count and not `no upstream configured`. Test in Task 1.
- A real branch literally named `detached` that has an upstream: expect the real push state, since the formatter re-reads HEAD rather than trusting the `branch` string. Test in Task 1.
- Detached HEAD at archive time: `commit.branch === 'detached'`, line reads `(no upstream configured)`, verb exits 0. Test in Task 1.
- `archive-run` invoked from a linked worktree whose HEAD differs from the main checkout's: the line names the main checkout's branch and commit. Test in Task 1.
- A reconcile pass that archives one tracked and one untracked run: only the tracked run's entry carries `commit`. Test in Task 2.

---

### Task 1: `archiveRunDir` reports its commit; `archive-run` prints it

**Files:**
- Modify: `plugin/bin/lib/reconcile/archive-merged.js` (`archiveRunDir`, comment at `:241`, exports)
- Modify: `plugin/bin/hooks.js` (`runArchiveRun` import at `:1260`, print after `:1401`)
- Test: `tests/archive-run-verb.test.js`
- Test: `tests/reconcile.test.js`

**Interfaces:**
- Produces: `archiveRunDir(root, runDir)` success result gains optional `commit: { sha: string, branch: string }`.
- Produces: exported `archiveCommitLine(root, commit) -> string`.

- [ ] **Step 1: Write the failing tests**

In `tests/reconcile.test.js`, after the `archiveRunDir: the git mv of work/ is committed` test, using the existing `runDirFixture()`:

```js
test('AC1.1 AC1.2: archiveRunDir returns the commit it made', () => {
  const { archiveRunDir } = require('../plugin/bin/lib/reconcile/archive-merged');
  const { root, runDir } = runDirFixture();
  const result = archiveRunDir(root, runDir);
  assert.strictEqual(result.commit.sha, git(['rev-parse', '--short', 'HEAD'], root).trim());
  assert.strictEqual(result.commit.branch, 'main');
});

test('AC1.3: archiveRunDir with nothing tracked returns no commit field', () => {
  const { archiveRunDir } = require('../plugin/bin/lib/reconcile/archive-merged');
  const { root, runDir } = runDirFixture();
  git(['rm', '-rq', '--cached', '--', path.join(runDir, 'work')], root);
  git(['commit', '-q', '-m', 'untrack'], root);
  fs.rmSync(path.join(runDir, 'work'), { recursive: true });
  const before = git(['rev-parse', 'HEAD'], root).trim();
  const result = archiveRunDir(root, runDir);
  assert.strictEqual(result.ok, true);
  assert.ok(!('commit' in result));
  assert.strictEqual(git(['rev-parse', 'HEAD'], root).trim(), before);
});

test('archiveRunDir on a detached HEAD reports branch detached', () => {
  const { archiveRunDir } = require('../plugin/bin/lib/reconcile/archive-merged');
  const { root, runDir } = runDirFixture();
  git(['checkout', '-q', '--detach'], root);
  assert.strictEqual(archiveRunDir(root, runDir).commit.branch, 'detached');
});
```

In `tests/archive-run-verb.test.js`, add a `trackedRunFixture()` helper: `runDirFixture('clean')` plus a `work/999-spec.md` written, `git add`ed and committed. Pin `const COMMITTED = /^claude-tweaks: committed [0-9a-f]{7,} on \S+ \((not pushed — \d+ ahead of \S+|no upstream configured|push state unknown)\)$/m;`. Tests:

- `AC2.1: tracked work prints the committed line` — `assert.match(stdout, COMMITTED)`; also matches `(no upstream configured)` (no remote in this fixture), and the sha in the line equals `git rev-parse --short HEAD`.
- `AC2.2: an untracked-only run prints no committed line` — `runDirFixture('clean')`; `assert.doesNotMatch(stdout, /committed/)`.
- `AC3.1: a branch tracking an upstream at the pre-archive commit reports 1 ahead` — add a bare repo as `origin` (`git init --bare`, `git remote add origin`, `git push -q -u origin main`) after the tracked commit; `assert.match(stdout, /\(not pushed — 1 ahead of origin\/main\)$/m)`.
- `upstream ref gone reports push state unknown` — after the push above, `git update-ref -d refs/remotes/origin/main` so `branch.main.*` config still names it; `assert.match(stdout, /\(push state unknown\)$/m)`, `result.code === 0`.
- `detached HEAD reads no upstream configured` — `git checkout -q --detach`; `assert.match(stdout, / on detached \(no upstream configured\)$/m)`.
- `a real branch named detached keeps its push state` — `git checkout -q -b detached`, push with `-u` to a bare origin before archiving; `assert.match(stdout, / on detached \(not pushed — 1 ahead of origin\/detached\)$/m)`.
- `invoked from a linked worktree names the main checkout's branch` — `git worktree add -q -b other {tmp}` from the fixture root, `runHook(['archive-run', '--run', runDir], { cwd: tmp })`; `assert.match(stdout, / on main \(/m)`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test --test-name-pattern="#3721 AC2.1" tests/archive-run-verb.test.js`
Expected: FAIL after Step 1, no `committed` line. Every new test name in this plan starts `#3721 ` (add the prefix to the names above). `#3721 AC2.2` passes before the change: it is the negative half and is proved by the `#3721 AC2.1` fixture printing the line.

- [ ] **Step 3: Implement**

In `archive-merged.js`:
- Add `readArchiveCommit(root) -> { sha, branch }`: `runGit(['rev-parse', '--short', 'HEAD'], root)` (failure: `sha: 'unknown'`) and `runGit(['symbolic-ref', '--quiet', '--short', 'HEAD'], root)` (failure: `branch: 'detached'`).
- In `archiveRunDir`: declare `let archiveCommit = null;` beside `movedEntries`; set it right after the `commit.failure` block at `:1549-1559`; return `{ ok: true, movedEntries, ...(archiveCommit ? { commit: archiveCommit } : {}) }`.
- Add and export `archiveCommitLine(root, commit)`, wrapped in try/catch so any throw yields `(push state unknown)`:
  1. `runGit(['symbolic-ref', '--quiet', '--short', 'HEAD'], root)`: `exitCode === 1` is detached → `no upstream configured`; any other failure → `push state unknown`. The live value `current` is used for step 2, never `commit.branch`, which is what keeps a branch literally named `detached` correct.
  2. `runGit(['for-each-ref', '--format=%(upstream:short)', `refs/heads/${current}`], root)`: failure → `push state unknown`; empty stdout → `no upstream configured`; else `upstream`.
  3. `runGit(['rev-list', '--count', '@{upstream}..HEAD'], root)`: failure → `push state unknown`; else `not pushed — ${n} ahead of ${upstream}`.
- Update the `:241` comment to list `commit` among the fields the verb reads.

In `hooks.js`: destructure `archiveCommitLine` at `:1260`; after the `archived` line, `if (result.commit) process.stdout.write(`${archiveCommitLine(mainRoot, result.commit)}\n`);`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/archive-run-verb.test.js`
Expected: PASS, including every pre-existing `moved:` case unchanged (AC5.1).

Run: `node --test --test-name-pattern="archiveRunDir" tests/reconcile.test.js`
Expected: PASS.

Run: `node --test tests/path-guard-conformance.test.js tests/windows-hide-spawn-conformance.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/reconcile/archive-merged.js plugin/bin/hooks.js tests/archive-run-verb.test.js tests/reconcile.test.js
git commit -m "Report archive-run's commit and push state on stdout — refs #3721"
```

### Task 2: Reconcile run entries carry `commit`

**Files:**
- Modify: `plugin/bin/lib/reconcile/archive-merged.js` (`archiveMergedRun`, `archiveMerged`)
- Modify: `plugin/bin/lib/reconcile/index.js:575`
- Test: `tests/reconcile.test.js` (`archiveAsyncMergedRun` fixture)

**Interfaces:**
- Consumes: `archiveRunDir`'s `commit` from Task 1.
- Produces: `archiveMerged(...)` return gains `archivedCommits: { [runDir]: { sha, branch } }`; `reconcile()`'s `runs` entries with `action: 'archived'` gain optional `commit`.

Sole-site grep for call sites, output recorded: `grep -n "archiveRunDir(root, dir)" plugin/bin/lib/reconcile/archive-merged.js` lists lines 2207, 2367, 2383, 2423, 2450, 2530, 2607, 2635. All eight route through the new wrapper. `action: 'archived'` is produced only at `index.js:575`.

- [ ] **Step 1: Write the failing tests**

Extend `archiveAsyncMergedRun` with `extra.trackedWork`: before the `async merge` commit, write and `git add` `.claude-tweaks/pipelines/2026-10-17T062549-spec-3630/work/3630-spec.md` in `seedDir`, so `mainDir` receives it through the fast-forward. Tests:

```js
test('AC4.1: a reconcile run entry for an archived tracked-work run includes the commit', { skip: STUB_SKIP }, async () => {
  const { r, mainDir } = await archiveAsyncMergedRun(['archive'], { trackedWork: true });
  const [entry] = r.runs;
  assert.strictEqual(entry.action, 'archived');
  assert.deepStrictEqual(entry.commit, { sha: git(['rev-parse', '--short', 'HEAD'], mainDir).trim(), branch: 'main' });
});

test('an archived run with nothing tracked has no commit in its reconcile entry', { skip: STUB_SKIP }, async () => {
  const { r } = await archiveAsyncMergedRun(['archive']);
  assert.strictEqual(r.runs[0].action, 'archived');
  assert.ok(!('commit' in r.runs[0]));
});
```

Plus a mixed-pass test over `archiveMerged` directly with one tracked and one untracked orphaned mint (`hasTrackedContent` routes them; age both past `ORPHAN_MINT_TTL_MS` with `fs.utimesSync`), asserting `Object.keys(result.archivedCommits)` equals only the tracked dir while `result.archived` lists both.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test --test-name-pattern="#3721 AC4.1" tests/reconcile.test.js`
Expected: FAIL after Step 1, `entry.commit` undefined.

- [ ] **Step 3: Implement**

In `archiveMerged`: `const archivedCommits = {};` and a local `const archive = (r, d) => { const res = archiveRunDir(r, d); if (res.ok && res.commit) archivedCommits[d] = res.commit; return res; };`. Replace the seven direct calls in `archiveMerged`, and give `archiveMergedRun` an `archive` parameter passed from both callers (its one call at `:2207`). Add `archivedCommits` to the final return (`:2707`).

In `index.js:575`: `const commits = r.archivedCommits || {};` (stubbed `archiveMerged`s return none) and `r.archived.map((d) => ({ runDir: d, action: 'archived', ...(commits[d] ? { commit: commits[d] } : {}) }))`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/reconcile.test.js tests/bin-lib/reconcile/archive-merged.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/reconcile/archive-merged.js plugin/bin/lib/reconcile/index.js tests/reconcile.test.js
git commit -m "Carry the archive commit into reconcile run entries — refs #3721"
```
