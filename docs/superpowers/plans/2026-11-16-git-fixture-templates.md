# Git Fixture Templates for Three Remote-Heavy Test Files Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the starting git state of `prune-remote.test.js`, `pre-review-catchup/cli.test.js` and `claims-git-cas.test.js` once per process through `tests/helpers/git-template.js` and copy it per test, cutting the three files' git processes from 2,875 to at most 1,725.

**Architecture:** Each file gets a sibling fixtures module (the `tests/bin-lib/verify/cli-helpers.js` precedent) whose builders call `fromTemplate`/`fromTemplateSet`, so `tests/helpers-git-template.test.js` can require them for spawn tests without running the test file. Setup-only pushes, clones, pulls and claim writes move into named template variants; the remote operations under test stay in the tests.

**Tech Stack:** Node 18+ `node:test`, git CLI, `tests/helpers/git-template.js` (`fromTemplate`, `fromTemplateSet`, `disableReceiveAutoGc`).

**Spec:** `.claude-tweaks/pipelines/2026-11-16T183940-record-5769/work/5769-spec.md` (resume run; the record body now carries a **Decision** paragraph that settles the two plan-review questions of run 2026-11-16T160606 — see "Decisions applied" below)

Scope keywords: makeRepoWithOrigin, makeBareOriginAndClone, makeBranchlessOriginAndClone, originWithTwoClones

## Global Constraints

- "Bare origins in these templates call `disableReceiveAutoGc`." (Deliverable 1) — every bare origin a new template builds calls `disableReceiveAutoGc(originDir)` right after `git init --bare`.
- "Remote operations that are the behaviour under test stay real: `pruneRemote`'s own fetch and delete pushes, the claims compare-and-swap push and its lease, the catch-up's fetch and merge, and the tests that need a second clone to advance a branch after the fixture was built." (Deliverable 3)
- "The diff changes fixture construction only: no assertion is removed or loosened, no test is deleted, skipped or merged, and test concurrency is unchanged." (AC3) — test names, test count, `assert` lines and test options (`{ skip: STUB_SKIP }`) stay byte-identical; only the lines that build state before the first call under test change.
- Fixture builders replicate the original setup steps exactly (same branch names, file names, file contents, commit messages, prefixes passed to `mkdtemp`), so each copy carries the same refs and objects the original per-test construction produced.
- Governing skill `windows-checkout-test-parity`, quoted verbatim: "| Rewriting a file git created inside a copied or linked worktree (its `.git` pointer file) with `fs.writeFileSync` | Git for Windows marks `.git` hidden (`core.hideDotFiles=dotGitOnly`), `fs.cpSync` keeps the attribute, and recreating a hidden file fails with `EPERM` on win32 only. Open the existing file `r+`, `ftruncateSync` it to 0, then" — no fixtures module writes a git-created file itself; `git-template.js`'s `rewriteTemplatePaths` already does this.
- Governing skill `skill-prose-conformance-tests` names `tests/helpers/git-fixtures.js`, but its rules govern skill-prose suites; none of these files is one, so its rules do not apply beyond reusing the shared helper (Task 2 extends it rather than adding a second builder).
- Commit messages: `{Verb} {what} — {detail}`, body ends with `refs #5769`, never `closes`/`fixes`.

## Decisions applied

The record's Decision paragraph: "Where this record's wording leaves a choice between a literal reading and its aim (fewer git processes, with coverage kept), take the aim, say so in the PR body, and do not stop to ask." Applied to the two open questions:

- **AC1 target basis.** Pass means the HEAD total is at most 1,725 **and** at most 60% of the before count re-taken at the merge base (AC2). Today both give 1,725 (the merge-base re-take at `e5f52db` was 2,875); if main moves the before count, the stricter bound governs and the PR body states both numbers and which one governed.
- **AC3 and `writeBlob`'s assertion.** The `fixture setup: claim #N must write cleanly` assertion stays in each of the four tests (coverage kept): `makeRegistryWithClaims` records every write's result instead of asserting, and each test asserts `write.ok` per claim from those recorded results with the same message. The PR body says so.

## Review Focus

- A template variant whose build runs a step in a different order than the original test (e.g. `remote set-head` after the branch push instead of before) — copies then differ in reflog/tracking state; reviewers diff each variant against the removed test lines.
- A builder that captures shas at build time (squash fixture, claim tips) and is called after a failed build — the capture must only be set when the build completed (set it as the build's last statement).
- A copy left with the template's absolute paths (remote url, worktree pointer) — `fromTemplateSet` throws on a survivor; the spawn tests and the migrated suites exercise every variant.
- A fixtures module requiring `node:test` or registering tests — requiring it from `helpers-git-template.test.js` must add no tests there beyond the spawn tests.
- Temp-dir cleanup: `claims-git-cas` and `pre-review-catchup` keep pushing every copied root onto their existing cleanup lists; `prune-remote` keeps its current (no-cleanup) behavior.

---

### Task 1: claims-git-cas fixtures on templates

**Role:** integration
**Review risk:** high

**Files:**
- Create: `tests/bin-lib/issues/claims-git-cas-fixtures.js`
- Modify: `tests/bin-lib/issues/claims-git-cas.test.js` (fixture builders at lines 85-109 and 519-533, the decoy setup in the concurrent-fetch test, the `writeBlob` setup calls in the four `readClaimBlobsGitBatch` tests that use `realRunner`)
- Test: `tests/helpers-git-template.test.js`

**Interfaces:**
- Produces (all from `tests/bin-lib/issues/claims-git-cas-fixtures.js`, no `node:test` import):
  - `makeBareOriginAndClone(): { root: string, originDir: string, cloneDir: string }` — key `claims-git-cas:registry`, prefix `claims-git-cas-`; the original steps (bare `origin.git` + `disableReceiveAutoGc`, clone `clone`, config, seed `README.md`, push `main`, push `main:claims-registry`).
  - `makeBranchlessOriginAndClone(): { root, originDir, cloneDir }` — key `claims-git-cas:branchless`, prefix `claims-git-cas-branchless-`; same minus the registry push.
  - `makeDecoyOriginAndClone(): { root, originDir, cloneDir }` — registry state plus the concurrent-fetch test's decoy steps (checkout `-b decoy`, `decoy.txt` = `decoy\n`, commit `decoy`, push `decoy`, checkout `main`).
  - `makeRegistryWithClaims(): { root, originDir, cloneDir, tipAfter: Map<number, string>, writes: Map<number, { issueNumber: number, ok: boolean }> }` — ONE shared template (key `claims-git-cas:claims`, prefix `claims-git-cas-`) holding every claim the four batch tests need, so their claim writes run once per process instead of once per test (Deliverable 2; plan review of this run). Registry state plus one `writeClaimBlobGit` per claim in this exact order, with each test's original content: 20, 21 (`{"runId":"r20"}`, `{"runId":"r21"}`), then 10, 11, 12 (`{"runId":"r10"}`…), then 30 (the pretty-printed `{ runId: 'r1', claimedAt: '2026-01-01T00:00:00.000Z', ttlHours: 72 }` JSON, `null, 2`), then 40-44 (`{"runId":"r40"}`…); 13 is never written. Message `Claim #{n}`, lease from a fresh `readClaimBlobGit`. `tipAfter.get(n)` = the `commitSha` of claim `n`'s write; `writes.get(n)` = that write's `{ issueNumber, ok }`. The order matters: the keyspace test reads at `tipAfter.get(21)`, where only 20 and 21 exist, so its `[20, 21]` assertion holds unchanged; the other three tests pass explicit `issueNumbers`. The builder never asserts or throws on `!ok` (the tests assert, see "Decisions applied"). `{ tipAfter, writes }` is kept in a module-level variable (the per-process cache — a copy whose build was skipped reads it there) set as the build's last statement, so a failed build leaves it unset and the next call rebuilds.

- [ ] **Step 1: Write the failing spawn tests** in `tests/helpers-git-template.test.js`, after the reconcile block, one per builder, named `AC4.1: claims-git-cas {builder}: a second call starts no git process` — same body as the existing `builders` loop (warm-up call, then a traced second call, `assert.deepStrictEqual(fs.readdirSync(trace), [])`), dirs to clean = `[r.root]`. For `makeRegistryWithClaims` also assert `second.tipAfter.get(44) === first.tipAfter.get(44)` and that a copy's `git rev-parse origin/claims-registry` (in `cloneDir`) equals `tipAfter.get(44)`.
- [ ] **Step 2: Run** `node --test tests/helpers-git-template.test.js` — Expected: FAIL, `Cannot find module './bin-lib/issues/claims-git-cas-fixtures'`.
- [ ] **Step 3: Implement the module** with the four builders above (its own `setupGit`/`realRunner` copies, `PIPE_ALL` stdio), then migrate the test file: all four builders get a same-named local wrapper in the test file that calls the module and pushes the copy's `root` onto `fixtureRoots` (so every copied root is cleaned up); the concurrent-fetch test takes the `makeDecoyOriginAndClone()` wrapper in place of its decoy lines; the tests `readClaimBlobsGitBatch: returns identical…`, `…with issueNumbers omitted, discovers…`, `…embedded newlines…` and `…exactly 2 subprocess invocations…` take the `makeRegistryWithClaims()` wrapper in place of their `writeBlob` calls, then, for each claim number the test originally wrote, assert `assert.equal(writes.get(n).ok, true, \`fixture setup: claim #${n} must write cleanly\`)` (the same assertion and message `writeBlob` ran), and use `tipAfter.get({the test's last claim})` (12, 21, 30, 44) where the test used `tip`. The embedded-newlines test keeps its `assert.ok(prettyContent.includes('\n'), …)` line, with `prettyContent` built as today. `writeBlob` and the `defaultRunner` test (#2852) stay as they are.
- [ ] **Step 4: Run** `node --test tests/helpers-git-template.test.js` and `node --test tests/bin-lib/issues/claims-git-cas.test.js` — Expected: both PASS; the claims file still reports 33 tests (`# tests 33`), 0 fail.
- [ ] **Step 5: Commit** `git add tests/bin-lib/issues/claims-git-cas-fixtures.js tests/bin-lib/issues/claims-git-cas.test.js tests/helpers-git-template.test.js` then `git commit -m "Build claims-git-cas test fixtures from templates — origin, clone, registry and seeded claims built once per process" -m "refs #5769"`.

### Task 2: pre-review-catchup fixture on a seeded originWithTwoClones template

**Role:** integration

**Files:**
- Modify: `tests/helpers/git-fixtures.js:123-162` (`originWithTwoClones`)
- Create: `tests/bin-lib/pre-review-catchup/fixtures.js`
- Modify: `tests/bin-lib/pre-review-catchup/cli.test.js:19-45` (`FIVE_LINES`, `fixture()`)
- Test: `tests/helpers-git-template.test.js`
- Test: `tests/adopted-branch-collision-snippet-fixture.test.js` (existing `originWithTwoClones` caller, run unchanged)
- Test: `tests/bin-lib/release-tip/arrived.test.js` (existing caller, run unchanged)
- Test: `tests/bin-lib/release-tip/check.test.js` (existing caller, run unchanged)
- Test: `tests/bin-lib/release-tip/cli.test.js` (existing caller, run unchanged)
- Test: `tests/bin-lib/worktree/remote-branch-collision-cli.test.js` (existing caller, run unchanged)
- Test: `tests/bin-lib/worktree/remote-branch-collision.test.js` (existing caller, run unchanged)
- Test: `tests/release-as-anchor-conformance.test.js` (existing caller, run unchanged)
- Test: `tests/release-review-tree-check-conformance.test.js` (existing caller, run unchanged)

**Interfaces:**
- Produces: `originWithTwoClones(prefix: string, opts?: { key?: string, seed?: (ops: { root, work, other, env, run, commit }) => void })` — without `opts` exactly today's behavior and key; with `seed`, a `TypeError('originWithTwoClones: seed needs a key')` unless `key` is a non-empty string, template key `git-fixtures:origin-two-clones:${key}`, and `seed` runs as the template build's last step with the build's own ops and template-side paths.
- Produces: `tests/bin-lib/pre-review-catchup/fixtures.js` exports `FIVE_LINES` and `catchupFixture(): { ...originWithTwoClones result, editLine(dir, name, n, value, msg), pushUpstream(), head() }` — prefix `ct-precatchup-`, key `pre-review-catchup`, seed = the original steps (write `a.txt` and `b.txt` from `FIVE_LINES` with messages `a`, `b`; push `main` from `work`; `pull -q origin main` in `other`; `checkout -q -b feat` in `work`). `editLine`/`pushUpstream`/`head` keep their current bodies, bound to the copy.
- Produces (same module): `catchupFixture(shape?: string)` — with a `shape` name, a further seeded variant (key `pre-review-catchup:${shape}`) whose seed also runs that shape's pre-call setup (the `editLine` calls in `work` and `other`, any extra `other` commit, and the `pushUpstream()` push) in the original order. A shape is defined only for a setup sequence that two or more tests run identically before their first `invoke`/`run` call with no assertion in between (for example `work a.txt:1 F1 'feat edit'` + `other a.txt:5 O5 'upstream edit'` + push, used by the AC1.1 and AC1.2 tests); each such test calls `catchupFixture('{shape}')` and drops exactly those setup lines. A setup sequence used by one test only, and every `pushUpstream()` after the first call under test, stays in the test unchanged — a single-use template costs a build plus a copy, no saving (Deliverable 2 asks for something cheaper). The PR body lists the shapes and states that single-use `pushUpstream` calls were kept and why.

- [ ] **Step 1: Write the failing tests** in `tests/helpers-git-template.test.js`: add `'pre-review-catchup catchupFixture': [() => catchupFixture(), (r) => [r.root]]` to the `builders` map, plus one entry `'pre-review-catchup catchupFixture {shape}'` per shape Step 3 defines (export the shape names from the module as `CATCHUP_SHAPES` so the spawn tests loop over them) (its loop names the test `… : a second call starts no git process`; rename nothing else), plus `test('AC4.1: originWithTwoClones with a seed and no key throws', …)` asserting `assert.throws(() => gitFixtures.originWithTwoClones('ct-gt-otc-', { seed: () => {} }), /seed needs a key/)`, plus a test that a `catchupFixture()` copy is on branch `feat` with `origin/main` equal to `main` in `work` and `other`.
- [ ] **Step 2: Run** `node --test tests/helpers-git-template.test.js` — Expected: FAIL, `Cannot find module './bin-lib/pre-review-catchup/fixtures'`.
- [ ] **Step 3: Implement** the `originWithTwoClones` option and the fixtures module, then make the test file's `fixture()` call `catchupFixture()`, push `f.root` onto `roots`, and return it; import `FIVE_LINES` from the module.
- [ ] **Step 4: Run** `git grep -l originWithTwoClones -- 'tests/*.test.js' 'tests/**/*.test.js'` into a list file (`run-tests.js --files-from` rejects any entry that is not a `*.test.js` file, so helper and fixtures modules must not be in it), add `tests/helpers-git-template.test.js` and `tests/bin-lib/pre-review-catchup/cli.test.js`, and run `node tools/run-tests.js --files-from <list>` — every existing caller (`tests/bin-lib/release-tip/{arrived,check,cli}.test.js`, `tests/bin-lib/worktree/remote-branch-collision{,-cli}.test.js`, `tests/adopted-branch-collision-snippet-fixture.test.js`, `tests/release-as-anchor-conformance.test.js`, `tests/release-review-tree-check-conformance.test.js`) is unchanged and must still pass. Expected: all PASS; the catch-up file still reports 30 tests.
- [ ] **Step 5: Commit** the four files with `git commit -m "Seed the pre-review-catchup fixture in its template — the per-test commit, push and pull run once per process" -m "refs #5769"`.

### Task 3: prune-remote fixtures on templates

**Role:** integration
**Review risk:** high

**Files:**
- Create: `tests/bin-lib/reconcile/prune-remote-fixtures.js`
- Modify: `tests/bin-lib/reconcile/prune-remote.test.js` (`makeRepoWithOrigin`, `buildTwoPrunableBranchesFixture`, `buildSquashMergedFixture`, `buildScreenFixture`, and the inline branch setup of the tests named below)
- Test: `tests/helpers-git-template.test.js`

**Interfaces:**
- Produces from `tests/bin-lib/reconcile/prune-remote-fixtures.js`: `PRUNE_REMOTE_FIXTURES: string[]` and `pruneRemoteFixture(name): { origin: string, dir: string, wt?: string, preSquash?: string, squash?: string }`, one `fromTemplateSet` key `prune-remote:${name}`, layout `origin` prefix `prune-remote-origin-`, `dir` prefix `prune-remote-` (plus `wt` prefix `prune-remote-wt-` for `worktree`). Every variant starts with the `makeRepoWithOrigin` steps (bare origin + `disableReceiveAutoGc`, init `dir` on `main`, local user config, `a.txt`, commit `init`, `remote add`, `push -u origin main`), then:
  - `base`: nothing more.
  - `merged`: the first `pruneRemote` test's `build/merged` / `b.txt` / `change` steps through `branch -D`.
  - `stale`: the refresh test's `build/stale` / `h.txt` / `merged part` steps through `branch -D` (the second clone stays in the test).
  - `unmerged-and-out-of-scope`: that test's `build/unmerged` and `feature/out-of-scope` steps.
  - `squashed`: `buildSquashMergedFixture`'s steps; returns `preSquash`, `squash` captured at build, kept in a module-level `Map` keyed by variant name (the per-process cache a copy whose build was skipped reads) and set as the build's last statement, so a failed build leaves no entry and the next call rebuilds.
  - `b1-deleted` (or the batch-fails test's own variant name): that test's branch setup, then the deletion of `build/b1` on the origin done with `git -C <origin> update-ref -d refs/heads/build/b1` in place of its second-clone `clone` + `push origin --delete build/b1` — the same refs result (origin lacks `build/b1`, the repo's `origin/build/b1` tracking ref stays stale), with no second clone and no push. This delete only arranges state; Deliverable 3 protects second clones that advance a branch.
  - `trunk`: the integration-excluded test's `build/trunk` steps.
  - `origin-head`: `remote set-head origin main`, then the `build/merged2` / `f.txt` / `change2` steps.
  - `worktree`: the live-worktree test's `build/wt` steps plus `worktree add <wt>/w build/wt`.
  - `two-prunable`: `buildTwoPrunableBranchesFixture`'s loop.
  - `reused`: the `build/reused` / `r.txt` / `change` steps (both tests that use them).
  - `screened`: `buildScreenFixture`'s steps.

- [ ] **Step 1: Write the failing spawn tests** in `tests/helpers-git-template.test.js`: `for (const name of PRUNE_REMOTE_FIXTURES)` a test `AC4.1: prune-remote ${name}: a second call starts no git process` (dirs `[r.dir, r.origin, r.wt].filter(Boolean)`), plus one asserting a `squashed` copy's `git rev-parse main` equals its `squash` and `git rev-parse main~1` equals `preSquash`.
- [ ] **Step 2: Run** `node --test tests/helpers-git-template.test.js` — Expected: FAIL, `Cannot find module './bin-lib/reconcile/prune-remote-fixtures'`.
- [ ] **Step 3: Implement the module**, then migrate the test file: `makeRepoWithOrigin()` returns `pruneRemoteFixture('base').dir`; the three `build*Fixture` functions return the same shapes as today from their variants; each named test replaces its inline setup with `const dir = pruneRemoteFixture('{variant}').dir` (the live-worktree test drops its `mkdtemp`/`worktree add` lines for the `worktree` variant). Kept in the tests: every `pruneRemote` call, the second-clone advance steps (refresh test, F1 test), `git branch -f main` (AC5 test), `fetch --prune` + `set-url` (skipFetch test — the fetch simulates the caller's shared fetch that the `skipFetch` path then trusts, so it stays; the PR body says so), every `set-url`, `ls-remote` and `symbolic-ref` assertion.
- [ ] **Step 4: Run** `node --test tests/helpers-git-template.test.js` and `node --test tests/bin-lib/reconcile/prune-remote.test.js` — Expected: both PASS; prune-remote still reports its current test count.
- [ ] **Step 5: Commit** `git add` the three files, `git commit -m "Build prune-remote test fixtures from templates — origin, repo and pushed branches built once per process per variant" -m "refs #5769"`.

### Task 4: Measure and report (central, not dispatched)

**Files:** none committed.

- [ ] **Step 1: AC2.1** — extract the merge base (`git merge-base HEAD origin/main`) with `git archive` into a scratch dir, then run the scratch counter (`count-git.js`) against it and against HEAD back to back: each file alone and the three together, each run `GIT_TRACE2_EVENT=<absolute empty dir> CT_TEST_CONCURRENCY=6 node tools/run-tests.js --files-from <list>`, counting one trace2 file per process, split top-level vs child and by subcommand.
- [ ] **Step 2: AC1.1 / AC1.2** — total at HEAD ≤ 1,725 and ≤ 60% of Step 1's merge-base total (the stricter governs, per "Decisions applied"; the PR body states both numbers); otherwise name the shortfall, attributing it to fixture setup or to git run by the code under test.
- [ ] **Step 3: AC3.1 / AC3.2** — for each file, the TAP test-name list (`node --test --test-reporter=tap <file>`, `ok N - name` lines) at the merge base and at HEAD is identical and all pass; `git diff <merge-base> HEAD -- <file>` shows no removed `assert` line and no changed test option.
- [ ] **Step 4: Evidence** — write each run's output to `$PIPELINE_RUN_DIR/evidence/git-counts.txt` and `$PIPELINE_RUN_DIR/evidence/test-names.txt` (plain Bash redirect, `mkdir -p` first) and log one `AC evidence` decision per criterion; put the before/after table with the subcommand split in the PR body (Deliverable 5).
- [ ] **Step 5: AC5.1** — the full suite passes through `/claude-tweaks:test`; the Windows regression job is dispatched on the PR head and its result recorded.

## Spec coverage map

| AC clause | Where |
|---|---|
| AC1.1 | Task 4 Step 2 (count at HEAD ≤ 1,725) |
| AC1.2 | Task 4 Step 2 (shortfall named in the PR body if any) |
| AC2.1 | Task 4 Step 1 (trace2 dir around `run-tests.js --files-from`, merge base then HEAD, back to back) |
| AC3.1 | Task 4 Step 3 (TAP name lists identical, all pass); Tasks 1-3 Step 4 counts |
| AC3.2 | Task 4 Step 3 (diff review: no removed assert, no changed option); Global Constraints |
| AC4.1 | Tasks 1-3 Step 1 spawn tests |
| AC5.1 | Task 4 Step 5 (full suite via `/claude-tweaks:test`, Windows regression job) |
