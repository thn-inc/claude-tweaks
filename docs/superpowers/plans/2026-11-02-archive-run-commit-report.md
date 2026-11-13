# archive-run commit report Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `archiveRunDir`'s silent `[reconcile] archive run` commit visible: in its return value (success and refusal), in `hooks.js archive-run`'s stdout, and in the reconcile `--json` run entry.

**Architecture:** `archiveRunDir` captures `{ sha, branch }` right after its commit succeeds and returns it on the success result and on every later refusal. A new exported formatter in `archive-merged.js` builds the stdout line, so its git probes share that module's repo-pinned `runGit` (#4178) rather than re-deriving a pinned spawn in `hooks.js`. `archiveMerged` collects a `dir -> commit` map beside its unchanged `archived`/`skipped` arrays, and `reconcile/index.js` copies the entry into the run row, archived or skipped.

**Tech Stack:** Node 18+, `node --test`, git CLI.

**Spec:** `.claude-tweaks/pipelines/2026-11-02T205944-record-3721/work/3721-spec.md`

**Scope keywords:** archiveRunDir, archiveMerged

## Global Constraints

- Line format, verbatim from Deliverable 2: `claude-tweaks: committed {sha} on {branch} (not pushed — {n} ahead of {upstream})`; no upstream: `(no upstream configured)`; ahead-count probe failed: `(push state unknown)`. The line never fails the verb.
- `commit` is absent when no tracked content moved and no commit ran.
- Plan Review Decisions, Reading B: a commit followed by a refusal is reported. `refuseAfterMarker` carries `archiveCommit`, `archive-run` prints the committed line on refusal too, and reconcile's `skipped` entries copy it.
- Plan Review Decisions, Reading A: AC2 stays as written, so no placeholder sha may reach the line. A failed sha or branch probe stores `null` in that field and prints a different line. `detached` is used only when `symbolic-ref` answers `exitCode === 1`; any other failure is an unanswered question, per `plugin/bin/lib/hooks/git-exec.js`'s `FAILURE` comment ("Only `git-error` is a real ANSWER from git").
- Resolve every probe from `mainRoot`, not `process.cwd()`.
- Out of scope (#3396): pushing, or skipping the commit on the integration branch.
- `result.archived` stays an array of strings and `result.skipped` keeps its entry shape: `tests/bin-lib/reconcile/archive-merged-record-guards.test.js` (pre-split `archive-merged.test.js:6062,6079,6101,6268` and `:5686,5706,5748,5764,5874,5891,6267`) deep-equal them (return-shape widening check). The new data is a separate additive key.
- From `.claude/skills/gh-api-module-pattern/SKILL.md`, verbatim: "**An argv array stops shell injection, not flag injection.** A caller-supplied value that begins with `-` is still read as an *option* by the command itself". The one interpolated value here is the full ref `symbolic-ref` printed (`refs/heads/...`), so no separator is owed.
- From `.claude/skills/parse-signal-discipline/SKILL.md`, verbatim: "`grep` exits 1 for no match and 2 for an error; `git grep` exits 1 for no match and 128 when it cannot run. Reading empty output as \"no match\" collapses the two." Applied: `git for-each-ref` exit 0 with empty stdout is the only "no upstream" signal; a non-zero exit is `push state unknown`.
- `.claude/skills/hooks-js-verb-registration`: no verb or flag changes here, so its registration sites do not apply. `.claude/skills/merge-shape-landed-proof` and the other skills naming `hooks.js`: no rule applies to a stdout line.
- Read HEAD with `git symbolic-ref --quiet HEAD` (the full ref), never `--short`: with a tag of the same name as the branch, `--short` prints `heads/{name}`, which names no branch in `refs/heads/heads/{name}` and reads as "no upstream". The spec's Technical Approach names `--short`; `commit.branch` is the full ref minus `refs/heads/`, which yields the same value for every unambiguous name. Probed on this branch: prints `refs/heads/worktree-dispatch-record-3721`; `git for-each-ref "--format=%(upstream:short)" refs/heads/worktree-dispatch-record-3721` prints `origin/main`.

The spec's line numbers (`:1302`, `:1503`, `hooks.js:1249-1252`) are stale; the current sites are `archive-merged.js:1548`, `:1749` and `hooks.js:1388-1401`, the same code.

## Review Focus

- Upstream configured but its remote ref is gone: expect `(push state unknown)`, not a count and not `no upstream configured`. Test in Task 1.
- A real branch literally named `detached` that has an upstream: expect the real push state, since the formatter re-reads HEAD rather than trusting the `branch` string. Test in Task 1.
- A tag with the same name as the checked-out branch: `commit.branch` is the plain name and the push state is real. Test in Task 1.
- `archive-run` invoked from a linked worktree whose HEAD differs from the main checkout's: the line names the main checkout's branch and commit. Test in Task 1.
- A reconcile pass that archives one tracked and one untracked run: only the tracked run's entry carries `commit`. Test in Task 2.

---

### Task 1: `archiveRunDir` reports its commit; `archive-run` prints it

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/reconcile/archive-merged.js` (`archiveRunDir`, `refuseAfterMarker`, comment at `:241`, exports)
- Modify: `plugin/bin/hooks.js` (`runArchiveRun` import at `:1260`, refusal branch at `:1389-1397`, print after `:1401`)
- Test: `tests/archive-run-verb.test.js`
- Test: `tests/reconcile.test.js`

**Interfaces:**
- Produces: `archiveRunDir(root, runDir)` result (success, and any refusal after the commit landed) gains optional `commit: { sha: string|null, branch: string|null }`. `branch` is `'detached'` only on a definite detached answer; `null` means a probe went unanswered.
- Produces: exported `readArchiveCommit(root, git = runGit) -> { sha, branch }`.
- Produces: exported `archiveCommitLine(root, commit, git = runGit) -> string`.

- [ ] **Step 1: Write the failing tests**

Every new test name in this plan starts `#3721 `.

In `tests/reconcile.test.js`, after the `archiveRunDir: the git mv of work/ is committed` test, using the existing `runDirFixture()`:

```js
test('#3721 AC1.1: archiveRunDir returns the commit it made', () => {
  const { archiveRunDir } = require('../plugin/bin/lib/reconcile/archive-merged');
  const { root, runDir } = runDirFixture();
  const result = archiveRunDir(root, runDir);
  assert.strictEqual(result.commit.sha, git(['rev-parse', '--short', 'HEAD'], root).trim());
  assert.strictEqual(result.commit.branch, 'main');
});

test('#3721 AC1.2: archiveRunDir with nothing tracked returns no commit field', () => {
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

test('#3721 archiveRunDir on a detached HEAD reports branch detached', () => {
  const { archiveRunDir } = require('../plugin/bin/lib/reconcile/archive-merged');
  const { root, runDir } = runDirFixture();
  git(['checkout', '-q', '--detach'], root);
  assert.strictEqual(archiveRunDir(root, runDir).commit.branch, 'detached');
});

test('#3721 a commit followed by a refusal still returns the commit', () => {
  const { archiveRunDir } = require('../plugin/bin/lib/reconcile/archive-merged');
  const { root, runDir } = runDirFixture();
  fs.writeFileSync(path.join(runDir, 'tracked-stray.md'), 'oops\n');
  git(['add', path.relative(root, path.join(runDir, 'tracked-stray.md'))], root);
  git(['commit', '-q', '-m', 'accidentally track a stray file'], root);
  const result = archiveRunDir(root, runDir);
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.reason, 'tracked-entry');
  assert.strictEqual(result.commit.sha, git(['rev-parse', '--short', 'HEAD'], root).trim());
  assert.strictEqual(result.commit.branch, 'main');
});

test('#3721 a refusal before any commit carries no commit field', () => {
  // Nothing tracked under work/, so no commit runs; the stray file then refuses.
  const { archiveRunDir } = require('../plugin/bin/lib/reconcile/archive-merged');
  const { root, runDir } = runDirFixture();
  git(['rm', '-rq', '--cached', '--', path.join(runDir, 'work')], root);
  fs.rmSync(path.join(runDir, 'work'), { recursive: true });
  fs.writeFileSync(path.join(runDir, 'tracked-stray.md'), 'oops\n');
  git(['add', path.relative(root, path.join(runDir, 'tracked-stray.md'))], root);
  git(['commit', '-q', '-m', 'stray only'], root);
  const result = archiveRunDir(root, runDir);
  assert.strictEqual(result.reason, 'tracked-entry');
  assert.ok(!('commit' in result));
});
```

Unit tests for the probe seam, same file, with a fake `git(args)`:

- `#3721 readArchiveCommit: a failed sha probe stores null` — fake fails `rev-parse` with `{ stdout: null, failure: 'timeout', exitCode: null }` and answers `symbolic-ref` with `refs/heads/main`; `deepStrictEqual` to `{ sha: null, branch: 'main' }`.
- `#3721 readArchiveCommit: symbolic-ref exit 1 is detached` — fake fails `symbolic-ref` with `{ failure: 'git-error', exitCode: 1 }`; `branch === 'detached'`.
- `#3721 readArchiveCommit: an unanswered symbolic-ref is not detached` — one case each for `{ failure: 'timeout', exitCode: null }` and `{ failure: 'git-error', exitCode: 128 }`; `branch === null`.
- `#3721 archiveCommitLine: a null sha never prints a placeholder` — `archiveCommitLine(root, { sha: null, branch: 'main' }, fake)` with a fake that fails every probe; `assert.doesNotMatch(line, /unknown on|on unknown/)`, `assert.match(line, /^claude-tweaks: committed the archive move but could not read its sha \(push state unknown\)$/)`. Delete the `sha` guard and this goes red.
- `#3721 archiveCommitLine: a null branch never prints detached` — `{ sha: 'abc1234', branch: null }`, same fake; `assert.match(line, /could not read its branch \(push state unknown\)$/)`, `assert.doesNotMatch(line, /detached/)`.
- `#3721 archiveCommitLine: a throwing probe degrades instead of throwing` — fake that throws on every call, `{ sha: 'abc1234', branch: 'main' }`; `assert.match(line, / \(push state unknown\)$/)`.

In `tests/archive-run-verb.test.js`, add a `trackedRunFixture()` helper: `runDirFixture('clean')` plus a `work/999-spec.md` written, `git add`ed and committed. Pin `const COMMITTED = /^claude-tweaks: committed [0-9a-f]{7,} on \S+ \((not pushed — \d+ ahead of \S+|no upstream configured|push state unknown)\)$/m;`. Tests:

- `#3721 AC2.1: tracked work prints the committed line` — `assert.match(stdout, COMMITTED)`; also matches `(no upstream configured)` (no remote in this fixture), and the sha in the line equals `git rev-parse --short HEAD`.
- `#3721 AC2.2: an untracked-only run prints no committed line` — `runDirFixture('clean')`; `assert.doesNotMatch(stdout, /committed/)`.
- `#3721 AC3.1: a branch tracking an upstream at the pre-archive commit reports 1 ahead` — add a bare repo as `origin` (`git init --bare`, `git remote add origin`, `git push -q -u origin main`) after the tracked commit; `assert.match(stdout, /\(not pushed — 1 ahead of origin\/main\)$/m)`.
- `#3721 upstream ref gone reports push state unknown` — after the push above, `git update-ref -d refs/remotes/origin/main` so `branch.main.*` config still names it; `assert.match(stdout, /\(push state unknown\)$/m)`, `result.code === 0`.
- `#3721 detached HEAD reads no upstream configured` — `git checkout -q --detach`; `assert.match(stdout, / on detached \(no upstream configured\)$/m)`.
- `#3721 a real branch named detached keeps its push state` — `git checkout -q -b detached`, push with `-u` to a bare origin before archiving; `assert.match(stdout, / on detached \(not pushed — 1 ahead of origin\/detached\)$/m)`.
- `#3721 a tag named like the branch keeps the plain name and push state` — bare origin as in AC3.1, then `git tag main`; `assert.match(stdout, / on main \(not pushed — 1 ahead of origin\/main\)$/m)`.
- `#3721 invoked from a linked worktree names the main checkout's branch` — `git worktree add -q -b other {tmp}` from the fixture root, `runHook(['archive-run', '--run', runDir], { cwd: tmp })`; `assert.match(stdout, / on main \(/m)`.
- `#3721 a refusal after the commit prints the refusal and the committed line` — `trackedRunFixture()` plus a tracked `tracked-stray.md`; `assert.match(stdout, /archival refused — tracked-entry/)`, `assert.match(stdout, COMMITTED)`, `result.code === 0`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test --test-name-pattern="#3721 AC2.1" tests/archive-run-verb.test.js`
Expected: FAIL after Step 1, no `committed` line. `#3721 AC2.2` and `#3721 a refusal before any commit` pass before the change: they are negative halves, proved by `#3721 AC2.1` and `#3721 a commit followed by a refusal`.

- [ ] **Step 3: Implement**

In `archive-merged.js`:
- Add `readArchiveCommit(root, git = runGit) -> { sha, branch }`: `git(['rev-parse', '--short', 'HEAD'], root)` (failure: `sha: null`); `git(['symbolic-ref', '--quiet', 'HEAD'], root)`: success → the output minus its `refs/heads/` prefix; `exitCode === 1` → `'detached'`; any other failure → `null`.
- In `archiveRunDir`: declare `let archiveCommit = null;` beside `movedEntries`, ahead of `refuseAfterMarker`. Set it right after the `commit.failure` block at `:1549-1559`. `refuseAfterMarker` returns `archiveCommit ? { ...refusal(reason, extra), commit: archiveCommit } : refusal(reason, extra)`. The success return becomes `{ ok: true, movedEntries, ...(archiveCommit ? { commit: archiveCommit } : {}) }`. The two bare `return refusal(` sites inside `archiveRunDir` (`:1293`, `:1302`) run before the commit and stay as they are.
- Add and export `archiveCommitLine(root, commit, git = runGit)`, wrapped in try/catch so any throw yields `push state unknown`:
  1. `git(['symbolic-ref', '--quiet', 'HEAD'], root)`: `exitCode === 1` is detached → `no upstream configured`; any other failure → `push state unknown`. The live value is used for step 2, never `commit.branch`, which is what keeps a branch literally named `detached` correct.
  2. `git(['for-each-ref', '--format=%(upstream:short)', fullRef], root)`: failure → `push state unknown`; empty stdout → `no upstream configured`; else `upstream`.
  3. `git(['rev-list', '--count', '@{upstream}..HEAD'], root)`: failure → `push state unknown`; else `not pushed — ${n} ahead of ${upstream}`.
  When `commit.sha` and `commit.branch` are both non-null, return `claude-tweaks: committed ${sha} on ${branch} (${state})`. Otherwise return `claude-tweaks: committed the archive move but could not read its ${sha|branch|sha and branch} (${state})`.
- Update the `:241` comment to list `commit` among the fields the verb reads.

In `hooks.js`: destructure `archiveCommitLine` at `:1260`. In the refusal branch, after the `archival refused` write and before `return 0`, and after the `archived` line, `if (result.commit) process.stdout.write(`${archiveCommitLine(mainRoot, result.commit)}\n`);`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/archive-run-verb.test.js`
Expected: PASS, including every pre-existing `moved:` case unchanged (AC5.1).

Run: `node --test --test-name-pattern="archiveRunDir|#3721" tests/reconcile.test.js`
Expected: PASS.

Run: `node --test tests/bin-lib/reconcile/archive-merged.test.js tests/bin-lib/reconcile/archive-merged-record-guards.test.js tests/path-guard-conformance.test.js tests/windows-hide-spawn-conformance.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/reconcile/archive-merged.js plugin/bin/hooks.js tests/archive-run-verb.test.js tests/reconcile.test.js
git commit -m "Report archive-run's commit and push state on stdout — refs #3721"
```

### Task 2: Reconcile run entries carry `commit`

**Role:** integration

**Files:**
- Modify: `plugin/bin/lib/reconcile/archive-merged.js` (`archiveMergedRun`, `archiveMerged`)
- Modify: `plugin/bin/lib/reconcile/index.js:575-584`
- Test: `tests/reconcile-archive-residue.test.js` (`archiveAsyncMergedRun` fixture)

**Interfaces:**
- Consumes: `archiveRunDir`'s `commit` from Task 1.
- Produces: `archiveMerged(...)` return gains `archiveCommits: { [runDir]: { sha, branch } }`, one key per run whose attempt committed, whether it then archived or refused. `reconcile()`'s `runs` entries, `action: 'archived'` or `'skipped'`, gain optional `commit`.

Sole-site grep for call sites, output recorded: `git grep -n "archiveRunDir(" -- plugin/bin` lists `archive-merged.js` lines 2207, 2367, 2383, 2423, 2450, 2530, 2607, 2635 , `hooks.js:1388` (the verb, Task 1) and `sweep-stray-run-dirs.js:163` (a CLI outside both surfaces the spec names, classified no-change: it reads only `ok`/`reason`). All eight in `archive-merged.js` route through the new wrapper. `result.runs` is produced only at `index.js:575-584`.

Behavior-change prose sweep, output classified no-change: `plugin/skills/tidy/SKILL.md:135,209`, `plugin/skills/release/SKILL.md:287` and `docs/journeys/tidy-standalone-auto-report.md:40` read `claude-tweaks: archived {run-id}` as the only success line, which stays true because a refusal's committed line never contains it. `release/SKILL.md:287`'s "commits only a tracked `work/`" stays true.

- [ ] **Step 1: Write the failing tests**

Extend `archiveAsyncMergedRun` with `extra.trackedWork`: before the `async merge` commit, write and `git add` `.claude-tweaks/pipelines/2026-10-17T062549-spec-3630/work/3630-spec.md` in `seedDir`, so `mainDir` receives it through the fast-forward. Extend it with `extra.trackedStray` the same way, adding `.claude-tweaks/pipelines/2026-10-17T062549-spec-3630/tracked-stray.md`. Tests:

```js
test('#3721 AC4.1: a reconcile run entry for an archived tracked-work run includes the commit', { skip: STUB_SKIP }, async () => {
  const { r, mainDir } = await archiveAsyncMergedRun(['archive'], { trackedWork: true });
  const [entry] = r.runs;
  assert.strictEqual(entry.action, 'archived');
  assert.deepStrictEqual(entry.commit, { sha: git(['rev-parse', '--short', 'HEAD'], mainDir).trim(), branch: 'main' });
});

test('#3721 an archived run with nothing tracked has no commit in its reconcile entry', { skip: STUB_SKIP }, async () => {
  const { r } = await archiveAsyncMergedRun(['archive']);
  assert.strictEqual(r.runs[0].action, 'archived');
  assert.ok(!('commit' in r.runs[0]));
});

test('#3721 a skipped reconcile entry carries the commit its refused attempt made', { skip: STUB_SKIP }, async () => {
  const { r, mainDir } = await archiveAsyncMergedRun(['archive'], { trackedWork: true, trackedStray: true });
  const [entry] = r.runs;
  assert.strictEqual(entry.action, 'skipped');
  assert.strictEqual(entry.reason, 'tracked-entry');
  assert.deepStrictEqual(entry.commit, { sha: git(['rev-parse', '--short', 'HEAD'], mainDir).trim(), branch: 'main' });
});
```

Plus `#3721 a mixed pass names only the tracked run` over `archiveMerged` directly with one tracked and one untracked orphaned mint (`hasTrackedContent` routes them; age both past `ORPHAN_MINT_TTL_MS` with `fs.utimesSync`), asserting `Object.keys(result.archiveCommits)` equals only the tracked dir while `result.archived` lists both.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test --test-name-pattern="#3721 AC4.1" tests/reconcile-archive-residue.test.js`
Expected: FAIL after Step 1, `entry.commit` undefined.

- [ ] **Step 3: Implement**

In `archiveMerged`: `const archiveCommits = {};` and a local `const archive = (r, d) => { const res = archiveRunDir(r, d); if (res.commit) archiveCommits[d] = res.commit; return res; };`, keyed on `res.commit` alone so a refused attempt is recorded. Replace the seven direct calls in `archiveMerged`, and give `archiveMergedRun` an `archive` parameter passed from both callers (its one call at `:2207`). Add `archiveCommits` to the final return (`:2707`) and to the early return at `:2310`.

In `index.js:575`: `const commits = r.archiveCommits || {};` (stubbed `archiveMerged`s return none); the `archived` map becomes `({ runDir: d, action: 'archived', ...(commits[d] ? { commit: commits[d] } : {}) })`, and the `skipped` map gains `...(commits[s.runDir] ? { commit: commits[s.runDir] } : {})`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/reconcile*.test.js tests/bin-lib/reconcile/archive-merged.test.js tests/bin-lib/reconcile/archive-merged-record-guards.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/reconcile/archive-merged.js plugin/bin/lib/reconcile/index.js tests/reconcile-archive-residue.test.js
git commit -m "Carry the archive commit into reconcile run entries — refs #3721"
```
