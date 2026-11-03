# Anchor the declined-learning store at the main checkout (#4360) Implementation Plan

**Goal:** A decline recorded from a linked worktree lands in the main checkout's store, so it survives the worktree being reaped and is visible from every other checkout of the repo.

**Spec:** `.claude-tweaks/pipelines/2026-11-03T005332-record-4360/work/4360-spec.md` (materialized from GitHub issue #4360)

---

### Task 1: Resolve the store and lock paths under the main checkout

**Files:**
Modify: `plugin/bin/lib/declined-learning/store.js`
Test: `tests/bin-lib/declined-learning/store.test.js`

- [ ] **Step 1: Failing test** — write the test(s) the spec's `## Acceptance Criteria` describe, and run them before Step 2. A test already green at base proves nothing about this fix: add an assertion that goes red, or say in the report why none can. Build a real fixture in a fresh `fs.mkdtempSync(os.tmpdir())` directory: `git init` plus one commit, then `git worktree add` a linked worktree. Run the store in child processes (`spawnSync(process.execPath, ['-e', script], { cwd })`) so each call has its own real cwd. Cover: `recordDecline` with cwd in the linked worktree writes `{main}/.claude-tweaks/declined-learning/store.json` and leaves no `.claude-tweaks/declined-learning` under the worktree; `lookupDecline` with cwd at the main checkout finds that entry; cwd in a subdirectory of the worktree resolves to the same store; outside a git repository `storePath()` stays the relative path and `recordDecline` writes under the cwd. Give the child processes a pinned environment with `GIT_DIR`, `GIT_WORK_TREE` and `GIT_INDEX_FILE` unset for any git command the fixture runs. Compare paths after `fs.realpathSync`, because macOS `/tmp` is a symlink and the resolver returns a realpath.
- [ ] **Step 2: Implement** — satisfy every `## Deliverables` checkbox against the files above. Reuse `mainCheckoutRoot` from `plugin/bin/lib/hooks/worktree-detect.js` (the resolver `resolve-run-dir --root-only` is built on) and do not write a second one. Resolve per call, not at module load: replace the `STORE_PATH`/`LOCK_PATH` constants with relative constants plus functions that join them onto the root, and use the resolved lock path in all three `withLock` calls. A null root (no repo, or an unparseable `.git`) keeps the relative path. `process.cwd()` throws when the cwd has been deleted, which is a real state for a process inside a reaped worktree, so catch that and fall back to the relative path: the store's degrade-open contract says it never throws on a read. Add a test for that fallback if one can be written without leaving a deleted cwd behind in the test process (a child process is fine). Every exported function keeps its signature. Update the `storePath()` comment, which still says "exactly one on-disk location", and add one sentence to the header stating the anchoring. `tests/bin-lib/declined-learning/store.test.js` asserts `storePath()` equals the relative path and keys its fake store on it, and it runs from inside this repo, so it would go red and its real `withLock` calls would take a lock in the real main checkout: add a `process.chdir` to a fresh temp directory at the top of that file (`node --test` gives each file its own process) so the existing assertions stay unchanged and now pin the outside-a-repo behavior.
- [ ] **Step 3: Run** the test(s) from Step 1 — PASS. Also run `tests/bin-lib/declined-learning/store-concurrency.test.js`, `tests/bin-lib/declined-learning-cli.test.js`, `tests/bin-lib/plan-retention/cli.test.js`, `tests/path-guard-conformance.test.js` and `tests/windows-hide-spawn-conformance.test.js`.
- [ ] **Step 4: Commit** — one commit, message drawn from the spec title, `refs #4360`.

---

## Self-review

- **Spec coverage:** every `## Deliverables` item and every `## Acceptance Criteria` item is
  covered by Task 1's Files/Steps above. `npm test` runs at Common Step 5.
- **Placeholders:** none.
