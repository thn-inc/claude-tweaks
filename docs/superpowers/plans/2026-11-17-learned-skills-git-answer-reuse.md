# Learned-skills git answer reuse Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Inside one learned-skills `capture()` or `land()`/`stage()` call, stop asking git a read-only question whose answer cannot have changed since the last identical ask.

**Architecture:** `land()`/`stage()` never move the worktree's HEAD (plumbing on a temp index, fetches into `refs/remotes/`, pushes), so the staged files' `Staged-at:` short HEAD is read once per call through a lazy memo threaded into `stageEntry`. `capture()` wraps its deps in a per-call read cache: `diff`, `status` and `hash-object` answers are reused until any state-changing git call or any fs write naming the target discards them all; known read-only calls (`apply --check`, `rev-parse`, `cat-file`) pass through without discarding.

**Tech Stack:** Node 18+ CommonJS, `node --test`, real git fixtures.

**Spec:** `.claude-tweaks/pipelines/2026-11-17T074410-record-5790/work/5790-spec.md`

Scope keywords: headShortReader, withReadCache

## Global Constraints

- Keep every existing test and assertion under `tests/bin-lib/learned-skills/` unchanged; they must pass, including the `core.autocrlf=true` variants and every fault-matrix file (`capture-matrix-*.test.js`).
- Failure handling is unchanged: every re-check that follows a step that can change tree or index state still reads git.
- A cache must be invalidated by every state-changing call, not keyed only by argv.
- Single writer during one `capture()` (spec Plan Review Clarifications, Reading A): invalidation covers state-changing git calls and writes through capture's own `deps` seams; a write to the target by another process is out of scope, so every cached question, the durability re-checks included, uses the one uniform cache rule.
- No new `execFileSync` site; every git call still goes through `deps.git` (source-scan suites over `plugin/bin/` stay green).
- Release note: no user-visible change.

## Review Focus

1. A git read that throws must not be cached: the fault matrix and `gate-once`-style faults rely on a second ask reaching git (Task 2 test `a failed read is asked again`).
2. A cached Buffer handed to two callers must not let one caller's mutation reach the other (Task 2 test `a cached Buffer answer is a copy`).
3. A failed `rev-parse --short HEAD` must not pin `unknown` for the rest of the call (Task 1 test `a failed HEAD read is asked again for the next entry`).
4. A git call carrying `opts.env` (land's `GIT_INDEX_FILE` plumbing) must never be served from the cache (Task 2 test `an env-carrying call is never cached`).
5. `hash-object` of different bytes under one argv must not share an answer (Task 2 test `hash-object keys on the input bytes`).

---

### Task 1: Read HEAD once per land()/stage() call for staging

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/learned-skills/learned-skills.js` (`writeStage` ~:242-268, `stageEntry` ~:223-238, exports)
- Modify: `plugin/bin/lib/learned-skills/land.js` (`stageOne`, `stageAll`, `stage()`, `land()`)
- Test: `tests/bin-lib/learned-skills/land.test.js`

**Interfaces:**
- Produces: `headShortReader(worktree: string, deps: { git }) -> () => string` exported from `learned-skills.js`. The returned function asks `git -C <worktree> rev-parse --short HEAD` on its first call, returns the trimmed answer, and memoizes it only when the ask succeeded with a non-empty answer; a throw or empty answer returns `'unknown'` and is not memoized (the next call asks again).
- Produces: `stageEntry({ runDir, worktree, entry, reason, headShort? }, overrides)` and `writeStage({ runDir, worktree, entry, headShort? }, deps)` — `headShort` is an optional `() => string`; when absent, `writeStage` uses `headShortReader(worktree, deps)` (one ask, today's behavior).
- Produces: `stageOne`/`stageAll` take `headShort` in their argument object and pass it to `stageEntry`.

- [ ] **Step 1: Write the failing tests** in `land.test.js`

```js
const isHeadShort = (c) => JSON.stringify(c.args.slice(2)) === JSON.stringify(['rev-parse', '--short', 'HEAD']);

test('AC2.1: land() with two staged entries runs rev-parse --short HEAD once', (t) => {
  const f = fixture(t); // two captured targets, X and Z
  sh(f.repo, ['remote', 'set-url', 'origin', path.join(f.root, 'missing.git')]);
  const g = deps(fakeGh().gh);
  const res = land(landArgs(f), g.deps);
  assert.equal(res.staged.length, 2);
  assert.equal(g.gitCalls.filter(isHeadShort).length, 1);
  const short = sh(f.repo, ['rev-parse', '--short', 'HEAD']).trim();
  for (const s of res.staged) assert.match(fs.readFileSync(s.stagePath, 'utf8'), new RegExp(`^Staged-at: ${short}$`, 'm'));
});

test('stage() with two captured entries runs rev-parse --short HEAD once', (t) => {
  // same shape through stage({ runDir, worktree, mergeBase, reason: 'integration-model is local-merge' }, g.deps)
  // asserts: res.staged.length === 2, isHeadShort count === 1, both Staged-at lines equal the real short HEAD
});

test('a failed HEAD read is asked again for the next entry', (t) => {
  // stage() with deps.git throwing on the FIRST isHeadShort ask only (counter), real git otherwise.
  // asserts: isHeadShort count === 2; the first staged file's Staged-at is 'unknown',
  // the second's is the real short HEAD.
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test --test-name-pattern="rev-parse --short HEAD|failed HEAD read" tests/bin-lib/learned-skills/land.test.js`
Expected: FAIL after Step 1 — the two `runs rev-parse --short HEAD once` tests fail with `2 !== 1`; `a failed HEAD read is asked again` already passes (it pins today's retry behavior, which the memo must keep).

- [ ] **Step 3: Implement** `headShortReader` and the optional `headShort` parameter in `learned-skills.js`; in `land.js`, create one `const headShort = headShortReader(worktree, deps)` at the top of `land()` and of `stage()` (lazy — no ask unless something is staged) and pass it through every `stageAll` call (`downgradeAll`, the per-entry build-loop fallback, the push-failure path) and `stageOne` into `stageEntry`. `capture()`'s own `writeStage` calls are unchanged.

- [ ] **Step 4: Run to verify they pass, plus the whole land file**

Run: `node --test tests/bin-lib/learned-skills/land.test.js`
Expected: PASS, every test.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/learned-skills/learned-skills.js plugin/bin/lib/learned-skills/land.js tests/bin-lib/learned-skills/land.test.js
git commit -m "Read HEAD once per learned-skills land or stage call — one rev-parse for N staged entries (#5790)"
```

### Task 2: Per-call read cache for capture()

**Role:** judgment
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/learned-skills/learned-skills.js` (new `withReadCache`, `capture()` ~:427-441, exports)
- Test: `tests/bin-lib/learned-skills/capture.test.js`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `withReadCache(deps: object, target: string /* absolute path */) -> object` exported from `learned-skills.js` — returns a new deps object (every other seam copied as-is) whose seams behave as follows:
  - `git(args, opts = {})`: the subcommand is the first argv element after any leading `-C <dir>`, `-c <k=v>` pairs and `--no-optional-locks`.
    - Cached questions: subcommand `diff`, `status`, or `hash-object` without `-w`, and no `opts.env`. Key = argv + `opts.encoding` + a sha256 of `opts.input` when given. A hit returns the stored answer (a Buffer answer is returned as a fresh copy, `Buffer.from(stored)`). A miss calls the wrapped `git`; only a successful return is stored; a throw is rethrown and nothing is stored.
    - Pass-through read-only calls (no discard, no caching): `apply` carrying `--check`, `rev-parse`, `cat-file`.
    - Every other call (including any call carrying `opts.env`): discard every stored answer, then call the wrapped `git`.
  - `unlink(p)`, `writeFile(p, d)`, `writeFileExclusive(p, d)`, `rename(from, to)`, `rmdir(p)`: discard every stored answer when the path (either side of a rename) is `target`, or for `rmdir` an ancestor directory of `target` (`isAncestorOrSelf`), then call the wrapped seam. Writes to any other path discard nothing.
- `capture()` builds `deps` as `withReadCache({ ...realDeps, ...overrides }, abs)` once `rel`/`abs` are known (after `normalizeTarget`), so `statusOf`, the `git` closure, `cx.git`, `sameContent`, `writeStage` and `gateStage` all go through it.

- [ ] **Step 1: Write the failing tests** in `capture.test.js`

Unit tests of `withReadCache` with a fake `git` that records argv and returns a fresh answer per call (`{ count, git }`), `target = '/wt/.claude/skills/x/SKILL.md'`:

```js
const DIFF = ['-C', '/wt', 'diff', '--binary', 'HEAD', '--', '.claude/skills/x/SKILL.md'];
for (const sub of [['apply', '-'], ['checkout', 'HEAD', '--', 'x'], ['add', '--', 'x'], ['rm', '--cached', '--quiet', '--', 'x']]) {
  test(`AC3.1: withReadCache discards a cached answer after git ${sub[0]}`, () => {
    // ask DIFF twice -> fake called once; d.git(['-C', '/wt', ...sub]); ask DIFF -> fake called for DIFF twice in total
  });
}
test('withReadCache: apply --check, rev-parse and cat-file between two asks keep the answer', () => { /* DIFF calls === 1 */ });
test('withReadCache: a failed read is asked again', () => { /* fake throws on first DIFF; second ask reaches git: DIFF calls === 2 */ });
test('withReadCache: a cached Buffer answer is a copy', () => { /* encoding 'buffer'; mutate the first result; second result equals the original bytes */ });
test('withReadCache: an env-carrying call is never cached', () => { /* DIFF with { env: {} } twice -> 2 calls */ });
test('withReadCache: hash-object keys on the input bytes', () => { /* same argv, input A, B, A -> 2 calls; the third returns A's answer */ });
test('withReadCache: a write naming the target discards the answers; a write elsewhere does not', () => {
  // unlink(target) between asks -> 2 DIFF calls; unlink('/run/learned-skills/1.patch') -> 1; rmdir('/wt/.claude/skills/x') -> discards
});
```

An integration test through `capture()`:

```js
test('AC1.1: one resetToHead() on a tree already at HEAD runs diff HEAD -- <rel> once', (t) => {
  const f = fixture(t);
  const original = read(f.repo, X);
  write(f.repo, X, original + 'will be staged\n');
  let after = false; // set once the promote rename has failed: resetToHead runs next
  const diffs = [];
  const res = capture(args(f, X), {
    now: () => Date.UTC(2026, 10, 13, 12, 0, 0),
    git: (a, o) => { if (after && a.includes('diff') && a.includes('--binary')) diffs.push(a); return realDeps.git(a, o); },
    rename: () => { after = true; throw new Error('simulated promote failure'); },
  });
  // The checkout ran before the failed rename, so the tree is at HEAD when resetToHead runs.
  assert.equal(res.route, 'staged');
  assert.equal(status(f.repo, X), '');
  assert.equal(read(f.repo, X), original);
  assert.equal(diffs.length, 1);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test --test-name-pattern="AC1\.1|withReadCache" tests/bin-lib/learned-skills/capture.test.js`
Expected: FAIL after Step 1 — `withReadCache is not a function` for the unit tests, and `AC1.1` fails with `4 !== 1` (today `resetToHead` asks `atHead` four times).

- [ ] **Step 3: Implement `withReadCache(deps, target)` and wire it into `capture()`** as the Interfaces block states. Use `crypto.createHash('sha256')` for the input key. The wrapped seams keep the wrapped seam's `this`-free call shape (`deps.git(args, opts)`).

- [ ] **Step 4: Run the new tests, then every learned-skills file, through the runner**

Run: `node --test tests/bin-lib/learned-skills/capture.test.js`
Expected: PASS.
Run: `node tools/run-tests.js --files-from <a list of every tests/bin-lib/learned-skills/*.test.js>` (or `npm test -- tests/bin-lib/learned-skills/`)
Expected: every file passes, the fault-matrix files and both `core.autocrlf=true` variants included, with no edit to any existing test.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/learned-skills/learned-skills.js tests/bin-lib/learned-skills/capture.test.js
git commit -m "Reuse unchanged read-only git answers within one learned-skills capture call — discarded at every state change (#5790)"
```

### Task 3: Measure git processes before and after (controller-run, no code)

**Role:** integration

**Files:** none committed.

- [ ] **Step 1:** From `git archive` extracts of the merge base and of this branch's final commit, each snapshot-committed as its own repo, run every `tests/bin-lib/learned-skills/*.test.js` file alone as `GIT_TRACE2_EVENT=<fresh empty dir> CT_TEST_CONCURRENCY=6 node tools/run-tests.js --files-from <one-file list>` and count the files in the trace dir (one per git process), with each file's test and pass counts.
- [ ] **Step 2:** Write the full per-file output to `$PIPELINE_RUN_DIR/evidence/git-process-counts.txt` and log one `AC evidence` line naming AC5.1, the command shape and the totals.
- [ ] **Step 3:** Put the per-file before/after table in the PR body (AC5.1), noting which added tests contribute processes to the after count.

Waived AC4.1: met by running the unchanged existing files (Task 2 Step 4 and the final verification), not by a new test.
Waived AC5.1: a PR-body report, produced by Task 3's controller-run measurement, not by a test.
