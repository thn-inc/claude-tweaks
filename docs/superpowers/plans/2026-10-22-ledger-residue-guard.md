# Ledger Residue Guard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep a run's `docs/plans/*-ledger.md` off the integration branch when its PR merges outside the run's own teardown, by adding a reconcile convergence check that finds residue ledgers on `origin/{integration}` and opens one removal PR for them.

**Architecture:** A new check module `plugin/bin/lib/reconcile/ledger-residue.js` lists `docs/plans/*-ledger.md` on the freshly fetched `origin/{integration}` tree, derives a deterministic `build/ledger-residue-{hash8}` branch name from the residue set, checks that branch's PR state, and — when no PR exists — builds a removal commit with git plumbing on a scratch `GIT_INDEX_FILE` (no working-tree or real-index write), pushes it as a new ref, and opens a PR. It registers as a background (write-side) check in the reconcile family, dispatched after `remote-prune` and before `reap`.

**Tech Stack:** Node 18+ CommonJS, `child_process.execFileSync` for `git`/`gh`, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-10-21T233004-record-3812/work/3812-spec.md` (record #3812)

**Scope keywords:** remoteBranches, BACKGROUND_CHECKS, local-merge-model, DISPATCH_ORDER

## Global Constraints

- The chosen mechanism is the spec's candidate (b): "a reconcile/tidy convergence check that detects a merged run's ledger on the integration branch and opens a removal PR". Record the choice (Deliverable 1) in `docs/decisions/0026-ledger-residue-converges-in-reconcile.md`.
- Registration sites follow `docs/reconcile-checks.md`'s "Adding a new check" steps 1-6 (Deliverable 2).
- Never push to the integration branch, never force-push, never touch the main checkout's working tree or real index. The only remote writes are creating `refs/heads/build/ledger-residue-{hash8}` and `gh pr create`.
- A ledger is residue only when it is a file directly under `docs/plans/` whose name ends `-ledger.md`, on `origin/{integration}`. A ledger on any other branch (an in-flight run's draft PR) is never examined.
- The check is gh-dependent and pr-first only: it rides the existing preflight gate and the existing `local-merge-model` skip; it adds no MCP path (`docs/reconcile-checks.md`'s "gh-absent preflight: accepted MCP gap").
- Every error path degrades to a reported skip — never a thrown exception (`index.js` header).
- Commit style for hand-written commits: `{Verb} {what} — {detail}`, ending `refs #3812` (never `closes`/`fixes`), plus the trailer `Claude-Session: https://claude.ai/code/session_01XC28e2QW47wrx6b6uBbH2o`.
- Commit tests sized like the neighboring `tests/bin-lib/reconcile/*.test.js` files; scratch checks stay scratch.

## Review Focus

1. **Lookalike paths under `docs/plans/`** — `docs/plans/2689-visual-plan-flowchart.html`, a nested `docs/plans/sub/x-ledger.md`, or `docs/plans/ledger.md` (no `-` prefix) must not be flagged. Pinned in Task 1 (`residueLedgerPaths` test).
2. **A ledger filename with a space** — parsing must use NUL-separated `ls-tree -z` output so the path survives intact into `update-index --force-remove`. Pinned in Task 1 (the AC1.1 fixture uses one such file).
3. **A second pass racing the first** — the branch already exists on origin but no PR is visible yet: never re-push (a non-ff push would be rejected anyway), go straight to `gh pr create`. Pinned in Task 1 (`refExists: true` test).
4. **The main checkout is untouched** — after a successful open, `git status --porcelain` in the clone is empty and local `HEAD`/`main` are unchanged. Pinned in Task 1 (AC1.1 test asserts both).
5. **No `origin/{integration}` ref** — a missing ref returns `failure: 'git-failure'`, no throw, no `gh` call. Pinned in Task 1.

---

### Task 1: The `ledger-residue` check module

**Files:**
- Create: `plugin/bin/lib/reconcile/ledger-residue.js`
- Test: `tests/bin-lib/reconcile/ledger-residue.test.js`
- Create: `docs/decisions/0026-ledger-residue-converges-in-reconcile.md`

**Interfaces:**
- Consumes: `resolvePrState(repoRoot, branch, opts)` from `plugin/bin/lib/reconcile/pr-state.js` (returns the governing PR `{number, state, ...}`, `null`, `'gh-absent'` or `'network-failure'`); `defaultRefExists(root, branch, timeoutMs)` from `plugin/bin/lib/reconcile/prune-remote.js` (returns `true`/`false`/`null`); `DEFAULT_TIMEOUT_MS` from `plugin/bin/lib/hooks/git-exec.js`.
- Produces (exported from `ledger-residue.js`):
  - `LEDGER_RESIDUE_MARKER = '<!-- ledger-residue-pr -->'`
  - `residueLedgerPaths(lsTreeZ: string) -> string[]` — sorted repo-relative paths (`docs/plans/{name}-ledger.md`) from NUL-separated `git ls-tree --name-only -z` output.
  - `removalBranchName(paths: string[]) -> string` — `'build/ledger-residue-' + sha1(sorted paths joined by '\n').hex.slice(0, 8)`; order-independent.
  - `decideLedgerResidue({ paths: string[], prState, refExists: boolean|null, dryRun: boolean }) -> { action: 'none'|'skip'|'open', reason: string|null, push: boolean }`
  - `ledgerResidue({ cwd, integration, dryRun, skipFetch, resolvePr, refExists, createPr, git }) -> { entries: Entry[], failure: null|'fetch-failed'|'git-failure' }` where `Entry = { path, kind: 'ledger', action: 'pr-opened'|'skip', reason, branch, prNumber?, prUrl? }` — one entry per residue path.

- [ ] **Step 1: Write the failing tests**

Build fixtures the way `tests/bin-lib/reconcile/prune-remote.test.js`'s `makeRepoWithOrigin()` does (a bare `origin` plus a clone on `main`, `user.email`/`user.name` configured). Inject `resolvePr`, `refExists` and `createPr` fakes in every `ledgerResidue` test so no test shells to a real `gh`.

```js
test('residueLedgerPaths: keeps only direct docs/plans/*-ledger.md entries, sorted', () => {
  const z = ['docs/plans/b-ledger.md', 'docs/plans/2689-visual-plan-flowchart.html', 'docs/plans/sub/x-ledger.md',
    'docs/plans/ledger.md', 'docs/plans/a b-ledger.md', ''].join('\0');
  assert.deepStrictEqual(residueLedgerPaths(z), ['docs/plans/a b-ledger.md', 'docs/plans/b-ledger.md']);
});
test('removalBranchName: deterministic, order-independent, build/ namespace', () => {
  const a = removalBranchName(['docs/plans/a-ledger.md', 'docs/plans/b-ledger.md']);
  assert.strictEqual(a, removalBranchName(['docs/plans/b-ledger.md', 'docs/plans/a-ledger.md']));
  assert.match(a, /^build\/ledger-residue-[0-9a-f]{8}$/);
  assert.notStrictEqual(a, removalBranchName(['docs/plans/a-ledger.md']));
});
test('decideLedgerResidue: decision table', () => {
  const p = ['docs/plans/a-ledger.md'];
  assert.deepStrictEqual(decideLedgerResidue({ paths: [], prState: null, refExists: false, dryRun: false }), { action: 'none', reason: null, push: false });
  assert.strictEqual(decideLedgerResidue({ paths: p, prState: 'gh-absent', refExists: false, dryRun: false }).reason, 'gh-absent');
  assert.strictEqual(decideLedgerResidue({ paths: p, prState: 'network-failure', refExists: false, dryRun: false }).reason, 'network-failure');
  assert.strictEqual(decideLedgerResidue({ paths: p, prState: { number: 5, state: 'OPEN' }, refExists: true, dryRun: false }).reason, 'removal-pr-open');
  assert.strictEqual(decideLedgerResidue({ paths: p, prState: { number: 5, state: 'CLOSED' }, refExists: true, dryRun: false }).reason, 'removal-pr-declined');
  assert.strictEqual(decideLedgerResidue({ paths: p, prState: { number: 5, state: 'MERGED' }, refExists: true, dryRun: false }).reason, 'removal-pr-merged');
  assert.strictEqual(decideLedgerResidue({ paths: p, prState: null, refExists: null, dryRun: false }).reason, 'ref-check-failed');
  assert.strictEqual(decideLedgerResidue({ paths: p, prState: null, refExists: false, dryRun: true }).reason, 'dry-run');
  assert.deepStrictEqual(decideLedgerResidue({ paths: p, prState: null, refExists: false, dryRun: false }), { action: 'open', reason: null, push: true });
  assert.deepStrictEqual(decideLedgerResidue({ paths: p, prState: null, refExists: true, dryRun: false }), { action: 'open', reason: null, push: false });
});
```

Then the fixture tests:

- `AC1.1: a ledger merged onto origin/main is reported and a removal PR is opened` — commit `docs/plans/2026-10-20-a b-ledger.md` and `docs/plans/keep.html` on `main`, push. Run `ledgerResidue({ cwd, integration: 'main', resolvePr: () => null, refExists: () => false, createPr: fake })` where `fake` records its argument and returns `{ number: 77, url: 'https://github.com/o/r/pull/77' }`. Assert:
  - `failure === null`; `entries` deep-equals `[{ path: 'docs/plans/2026-10-20-a b-ledger.md', kind: 'ledger', action: 'pr-opened', reason: 'removal-pr-opened', branch, prNumber: 77, prUrl: 'https://github.com/o/r/pull/77' }]` with `branch === removalBranchName(['docs/plans/2026-10-20-a b-ledger.md'])`.
  - On the bare origin, `refs/heads/{branch}` exists; its commit's single parent is `origin/main`'s tip; `git ls-tree -r --name-only {branch}` lacks the ledger and still lists `docs/plans/keep.html`.
  - `fake` was called once with `{ base: 'main', head: branch, title, body }` where `body` includes `LEDGER_RESIDUE_MARKER` and the ledger path.
  - In the clone, `git status --porcelain` is `''`, and `git rev-parse HEAD` equals its pre-run value.
- `AC2.1: an in-flight draft PR branch carrying its ledger is not flagged` — `main` has no ledger; a branch `worktree-record-9` pushed to origin adds `docs/plans/2026-10-22-y-ledger.md`. With `resolvePr` and `createPr` fakes that throw if called, assert `entries` deep-equals `[]` and `failure === null`.
- `an open removal PR for the same set skips without pushing` — ledger on main; `resolvePr: () => ({ number: 5, state: 'OPEN' })`; assert one entry `{ action: 'skip', reason: 'removal-pr-open', prNumber: 5 }` (other fields as above), no `refs/heads/build/*` on origin, `createPr` not called.
- `resolvePr is asked about the derived branch with preferOpen` — the fake records `(root, branch, opts)`; assert `branch === removalBranchName(paths)` and `opts.preferOpen === true`.
- `branch already on origin without a PR: no re-push, PR still created` — `refExists: () => true`; assert `createPr` called once and no new ref was created on origin by this run.
- `dry-run reports without writing` — `dryRun: true`; one entry `{ action: 'skip', reason: 'dry-run' }`; no origin ref; `createPr` not called; `resolvePr` still called once.
- `pr create failure is a reported skip` — `createPr` returns `'network-failure'`; one entry `{ action: 'skip', reason: 'pr-create-failed' }`.
- `missing origin/{integration} is a git-failure, not a throw` — `integration: 'no-such-branch'`, `skipFetch: true`; `{ entries: [], failure: 'git-failure' }`, `resolvePr` not called.
- `fetch failure fails the whole check closed` — point `origin` at `/no/such/path`, no `skipFetch`; `failure === 'fetch-failed'`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/bin-lib/reconcile/ledger-residue.test.js`
Expected: FAIL with `Cannot find module '../../../plugin/bin/lib/reconcile/ledger-residue'`

- [ ] **Step 3: Implement `plugin/bin/lib/reconcile/ledger-residue.js`**

Header comment in the family's style: what the check converges, why a teardown-only delete cannot cover a merge made outside the run (#3812, #3595, #3420), the write posture (new ref + PR only), and a pointer to `docs/reconcile-checks.md`'s Ledger residue section.

`ledgerResidue` flow, each git call through an injectable `git(args, opts) -> stdout` runner (default: `execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['pipe','pipe','pipe'], timeout: DEFAULT_TIMEOUT_MS, windowsHide: true, ...opts })`), each throw mapped to a skip or failure:

1. Unless `skipFetch`: `fetch origin {integration}` — a throw returns `{ entries: [], failure: 'fetch-failed' }`.
2. `rev-parse --verify origin/{integration}^{commit}` → `tip`; then `ls-tree --name-only -z {tip} -- docs/plans/` → `residueLedgerPaths`. A throw on either returns `failure: 'git-failure'`.
3. No paths → `{ entries: [], failure: null }` (no `gh` call).
4. `branch = removalBranchName(paths)`; `prState = resolvePr(root, branch, { preferOpen: true })` (default `resolvePrState`); `exists = refExists(root, branch)` (default `defaultRefExists(root, branch, DEFAULT_TIMEOUT_MS)`), computed only when `prState` is `null`.
5. `decideLedgerResidue(...)`. `skip` → one skip entry per path (carry `prNumber` when `prState` is a PR object). `open` → step 6.
6. When `push`: build the commit on a scratch index `path.join(os.tmpdir(), 'ledger-residue-index-{pid}-{Date.now()}-{random}')` passed as `env: { ...process.env, GIT_INDEX_FILE }`: `read-tree {tip}`, `update-index --force-remove -- ...paths`, `write-tree`, `commit-tree {tree} -p {tip} -m "Remove residue pipeline ledgers from docs/plans — reconcile ledger-residue check"`, then `push origin {commit}:refs/heads/{branch}` (no force, no lease). Remove the scratch index in a `finally` with `fs.rmSync(..., { force: true })` inside its own try. A throw before the push → skip `commit-failed`; a push throw → skip `push-failed`.
7. `createPr({ root, base: integration, head: branch, title, body })` — default runs `gh pr create --base --head --title --body` with `cwd: root` and parses `number` from the trailing path segment of the printed URL; returns `{ number, url }`, or `'gh-absent'`/`'network-failure'` (classify with `classifyGhApiError` from `../issues/claim-store`, as `pr-state.js` does). Title: `` `Remove ${n} residue ledger${n === 1 ? '' : 's'} from docs/plans` ``. Body: `LEDGER_RESIDUE_MARKER`, a sentence that these ledgers reached the integration branch through PRs merged before their run's teardown deleted them, the path list as a bullet list, and a pointer to `docs/reconcile-checks.md`. A non-object return → skip `pr-create-failed`; success → one `pr-opened` entry per path, reason `removal-pr-opened`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/bin-lib/reconcile/ledger-residue.test.js`
Expected: PASS, 0 failures

- [ ] **Step 5: Write the decision record**

`docs/decisions/0026-ledger-residue-converges-in-reconcile.md`, in `0025`'s shape (Status accepted, Date 2026-10-22, Context #3812). Content to carry:
- **Context:** #3595 moved single-spec cleanup item 2's ledger delete ahead of `gh pr merge`; the multi-spec Shared teardown step 0 has done so since #3420. Residue still landed through PRs merged outside the run's teardown (#3584 for run `2026-10-19T100244-record-3507`, #3715 for run `2026-10-20T102130-record-3564`), and `origin/main` carried three more at the time of writing (`2026-10-20-decision-line-status-word-ledger.md`, `2026-10-20-qa-report-json-writer-ledger.md`, `2026-10-20-skill-description-trim-audit-ledger.md`).
- **Decision:** candidate (b) — reconcile's `ledger-residue` check; the residue definition, the deterministic branch, the PR-state table, the plumbing write.
- **Alternatives considered:** (a) a PR check failing a non-draft PR that adds its own ledger — it lives in `.github/workflows/`, which is maintainer-side and never ships (decision 0015), so consumer projects on `pr-first` get nothing; with no branch protection on this repo a red check does not stop a human or fleet merge; and it reads red during the legitimate window between a run's ready-flip and its own teardown delete push. Deleting directly on the integration branch from reconcile — rejected: the family never pushes to the integration branch.
- **Consequences:** the removal PR is not auto-armed (the `repo-wide` sweep's item 9 recognizes only the tidy and wrap-up housekeeping markers), so a human or the fleet merges it; a removal PR closed unmerged reads as declined and that residue set is never re-proposed, while a changed set gets a new branch; `gh`-absent and `local-merge` runs skip the check; after merge `remote-prune` deletes the `build/` branch on its own merged-proof bar.

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/lib/reconcile/ledger-residue.js tests/bin-lib/reconcile/ledger-residue.test.js docs/decisions/0026-ledger-residue-converges-in-reconcile.md
git commit -m "Add the ledger-residue reconcile check — opens a removal PR for docs/plans ledgers on the integration branch (refs #3812)" -m "Claude-Session: https://claude.ai/code/session_01XC28e2QW47wrx6b6uBbH2o"
```

### Task 2: Register the check in the reconcile family

**Files:**
- Modify: `plugin/bin/lib/reconcile/index.js` (require, `ALL_CHECKS`, `result` literal, `DISPATCH_ORDER`, the `local-merge-model` skip string, a new dispatch block between `remote-prune` and `reap`, the `overBudget` slice indices and the "8 dispatch blocks" comment)
- Modify: `plugin/bin/hooks.js` (`BACKGROUND_CHECKS`; the `reconcile-threw` fallback literal)
- Modify: `plugin/bin/lib/reconcile/format-summary.js` (`CATEGORIES` row; header comment's result-shape list)
- Modify: `tests/reconcile.test.js` (four `local-merge-model` skip-string assertions, near lines 900, 989, 1081, 1151)
- Modify: `tests/console-execute.test.js` (the `local-merge-model` skip-string assertion near line 617)
- Modify: `tests/console-execution.test.js` (the `local-merge-model` regex near line 163)
- Modify: `docs/reconcile-checks.md` (dispatch-order bullet, fast/background bullet, step 4's result-shape list, new `## Ledger residue (#3812)` section)
- Modify: `docs/plugin-structure.md` (the `plugin/bin/lib/reconcile/` inventory line)
- Test: `tests/bin-lib/reconcile/ledger-residue.test.js` (append)

**Interfaces:**
- Consumes: `ledgerResidue({ cwd, integration, dryRun, skipFetch })` from Task 1.
- Produces: `reconcile()` result key `ledgerResidue: Entry[] | null`; check name `'ledger-residue'` in `ALL_CHECKS` and `BACKGROUND_CHECKS`.

- [ ] **Step 1: Write the failing wiring tests (append to `tests/bin-lib/reconcile/ledger-residue.test.js`)**

```js
test("index: ALL_CHECKS and BACKGROUND_CHECKS include 'ledger-residue'; dispatch sits between remote-prune and reap", () => {
  assert.ok(ALL_CHECKS.includes('ledger-residue'));
  assert.ok(require('../../../plugin/bin/hooks.js').BACKGROUND_CHECKS.includes('ledger-residue'));
  const src = fs.readFileSync(path.join(__dirname, '../../../plugin/bin/lib/reconcile/index.js'), 'utf8');
  const iBranches = src.indexOf("checks.includes('archive-branches')");
  const iRemote = src.indexOf("checks.includes('remote-prune')", iBranches);
  const iLedger = src.indexOf("checks.includes('ledger-residue')", iBranches);
  const iReap = src.indexOf("checks.includes('reap')", iBranches);
  assert.ok(iRemote > iBranches && iLedger > iRemote && iReap > iLedger, 'dispatch order: remote-prune < ledger-residue < reap');
});
```

Plus `index: requesting ledger-residue under pr-first sets result.ledgerResidue to an array; not requesting it leaves null` — the same fixture and `preflight.ghHealthCheck` stub as `prune-remote.test.js`'s "actually reaches the remote-prune dispatch" test (policy `integration-model: pr-first\nintegration-branch: main\n`, no ledger on main so no `gh` call happens), asserting `Array.isArray(r.ledgerResidue)` for `checks: ['ledger-residue']` and `r.ledgerResidue === null` for `checks: ['mirror']`.

Plus `formatSummary renders ledger-residue taken and skipped lines` — `formatSummary` from `plugin/bin/lib/reconcile/format-summary.js` on a result with every other key `null`, `skipped: null`, and `ledgerResidue: [two { kind: 'ledger', action: 'pr-opened', reason: 'removal-pr-opened' }, one { kind: 'ledger', action: 'skip', reason: 'removal-pr-open' }]`; assert the output contains the line `removal PR opened: 2 residue ledgers` and the line `skipped: 1 residue ledger (removal-pr-open 1)`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/bin-lib/reconcile/ledger-residue.test.js`
Expected: FAIL — the three new tests fail (`ALL_CHECKS.includes('ledger-residue')` is false; `ledgerResidue` is `undefined`; the summary has no `removal PR opened` line); Task 1's tests still pass.

- [ ] **Step 3: Wire it in**

- `index.js`: `ALL_CHECKS` gains `'ledger-residue'` (before `'console'`); `result` gains `ledgerResidue: null`; `DISPATCH_ORDER = ['mirror', 'red-tip', 'console', 'release', 'archive', 'archive-branches', 'remote-prune', 'ledger-residue', 'reap']`; the new block guards with `overBudget(DISPATCH_ORDER.slice(7))`, reap's guard becomes `slice(8)`; the block calls `ledgerResidue({ cwd: root, integration, dryRun, skipFetch: fetchRan && sharedFetchOk })` and maps `r.failure` to `result.skipped.push({ check: 'ledger-residue', reason: r.failure })`, else `result.ledgerResidue = r.entries`; a comment says why it sits after remote-prune (it reads the ref the shared fetch refreshed) and before reap (reap stays last). The local-merge skip string becomes exactly `'mirror,release,archive,archive-branches,remote-prune,ledger-residue,console'`.
- `hooks.js`: `BACKGROUND_CHECKS = ['release', 'archive', 'archive-branches', 'remote-prune', 'ledger-residue', 'reap']`; the `reconcile-threw` literal gains `ledgerResidue: null` after `remoteBranches: null`.
- `format-summary.js`: append `{ key: 'ledgerResidue', unit: 'residue ledger', verb: 'removal PR opened', takenActions: ['pr-opened'], skipActions: ['skip'] }`.
- The six skip-string assertions in `tests/reconcile.test.js`, `tests/console-execute.test.js` and `tests/console-execution.test.js` move to the new string.
- `docs/reconcile-checks.md`: dispatch-order bullet reads `mirror → red-tip → console → release → archive → archive-branches → remote-prune → ledger-residue → reap`; `BACKGROUND_CHECKS` list in the fast/background bullet gains `ledger-residue`; step 4's result-shape list gains `ledgerResidue`; a new `## Ledger residue (#3812)` section (before `## Referenced by`) states the residue definition, why an in-flight run's ledger is never examined, the PR-state table (`OPEN` → `removal-pr-open`, `CLOSED` → `removal-pr-declined`, `MERGED` → `removal-pr-merged`, none → open), the plumbing write and its no-force/no-integration-push posture, and cites decision 0026.
- `docs/plugin-structure.md`: the `plugin/bin/lib/reconcile/` inventory line gains `ledger-residue.js (opens one removal PR for docs/plans/*-ledger.md residue found on origin/{integration}, #3812)` after `prune-remote.js`'s entry.

- [ ] **Step 4: Run the affected suites to verify they pass**

Run: `node --test tests/bin-lib/reconcile/ledger-residue.test.js tests/reconcile.test.js tests/console-execute.test.js tests/console-execution.test.js tests/bin-lib/hooks/reconcile-background.test.js tests/hooks-session-start.test.js tests/bin-lib/reconcile/prune-remote.test.js`
Expected: PASS, 0 failures (the FAST/BACKGROUND partition test in `reconcile-background.test.js` passes with `ledger-residue` on the background side).

- [ ] **Step 5: Real-input probe (read-only)**

Run: `node plugin/bin/hooks.js reconcile --checks ledger-residue --dry-run --json`
Independent count: `git ls-tree --name-only origin/main docs/plans/` piped to `grep -c -- '-ledger.md$'` (3 at authoring time, the three paths named in Task 1 Step 5).
Expected: the JSON's `ledgerResidue` has exactly that many entries, one per path, each `action: 'skip'`, `reason: 'dry-run'`, all sharing one `build/ledger-residue-*` branch — unless an open removal PR already exists, in which case `removal-pr-open`. Record the printed entries in the task report. `--dry-run` makes no ref or PR write.

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/lib/reconcile/index.js plugin/bin/hooks.js plugin/bin/lib/reconcile/format-summary.js tests/bin-lib/reconcile/ledger-residue.test.js tests/reconcile.test.js tests/console-execute.test.js tests/console-execution.test.js docs/reconcile-checks.md docs/plugin-structure.md
git commit -m "Register the ledger-residue check in reconcile — background pass, after remote-prune, before reap (refs #3812)" -m "Claude-Session: https://claude.ai/code/session_01XC28e2QW47wrx6b6uBbH2o"
```

## As-built deviations (Common Step 4.5)

Both deviations below are Beneficial. They came from the whole-branch review's fix wave, and ADR 0026 records the reasoning (commit fe113fe05).

1. **A removable ledger is narrower than "any `*-ledger.md` on the integration branch."** A ledger is kept and reported as a per-path skip, never removed, when any of these holds: it lacks the ledger signature, it has an `open` row, it has an unrecognized status, or its run directory is still live. This matches tidy's shipped keep rule in `plugin/skills/tidy/scan-procedures.md` (commit 117badd40). AC1 still holds, since the ledger is reported. The skip reasons are `not-a-ledger`, `ledger-has-open-rows`, `ledger-status-unrecognized` and `run-live`.
2. **The removal-PR state comes from one list of every `build/ledger-residue-*` head, not from one branch's PR.** An open removal PR governs. A path that a closed removal PR named stays declined, and a path that a merged one named is reported (commit 117badd40). The result is surfaced in the background SessionStart summary and in tidy Step 6 (commit 8e8f737e2).

## Acceptance-criteria coverage

| Clause | Covered by |
|---|---|
| AC1.1 | Task 1 `AC1.1: a ledger merged onto origin/main is reported and a removal PR is opened` |
| AC2.1 | Task 1 `AC2.1: an in-flight draft PR branch carrying its ledger is not flagged` |
| AC3.1 | Waived AC3.1: `npm test` is the build's Common Step 5 verification, not a test step |
