# Run Spec-Header Resolver (#3974) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One shared resolver finds a run's materialized spec header at its live path or under `archive/{run-id}/`, and all six readers use it — with no behavior change for any run that exists today.

**Architecture:** New `plugin/bin/lib/run-header.js` owns every header-location rule (run identity, live/archived candidate paths, git pathspecs, tree dirs, filesystem lookup). Git-tree readers keep their own git invocation and failure semantics and only take paths/pathspecs from the resolver; filesystem readers hand it ordered checkout roots. A source-scan conformance test keeps the rule in one place.

**Tech Stack:** Node 18+, CommonJS, `node --test`, git CLI in fixtures.

**Spec:** `.claude-tweaks/pipelines/2026-10-22T184947-spec-3974-3976-3975/spec-3974/work/3974-spec.md` (record #3974)

## Global Constraints

- Live header paths: `.claude-tweaks/pipelines/{run-id}/work/{N}-spec.md` and `.claude-tweaks/pipelines/{run-id}/spec-{N}/work/{N}-spec.md`.
- Archived header paths: `.claude-tweaks/pipelines/archive/{run-id}/work/{N}-spec.md` and `.claude-tweaks/pipelines/archive/{run-id}/spec-{N}/work/{N}-spec.md`.
- Precedence: within one root, live before archived; flat `work/` before `spec-{N}/work/`; roots in caller order.
- Git pathspecs are POSIX (`toPosix`); a wildcard directory component needs a trailing wildcard: `spec-*/work/*`, never `spec-*/work`.
- `hasMaterializeCommit` keeps its `{integration}..HEAD` range bound (#1674) and its unbounded fallback when no bound resolves.
- No file moves, no `.gitignore` change, no `materialize.md` text change (that is #3976).
- Failure postures stay exactly as today (AC 9): `isSpecCommitted`/`specOnBranch` → `null` on git error; `precondition.js` → `materialize-check-failed` on a throw; `hasMaterializeCommit` → `false` on git failure; `getMaterializedRecordNumbers` → `[]` on fs failure; `pack.js` / `first-call-artifact-check.js` treat an unreadable header as absent.
- Project maturity is `established`: characterization test first for every pre-existing behavior a task changes.
- Commit message style `{Verb} {what} — {detail}`, ending with the line `Claude-Session: https://claude.ai/code/session_01RvJg2mkTDd9HajVUvzgGs7`; `refs #3974`, never a closing keyword.

## Review Focus

1. **Per-spec run dir** (`{parent-run-id}/spec-{N}` as `runDir`, the multi-spec `PIPELINE_RUN_DIR`): the archived equivalent is `archive/{parent-run-id}/spec-{N}/work/`, not `archive/spec-{N}/...` — pinned in Task 1 (`runIdentity`) and Task 4 (per-spec `hasMaterializeCommit`).
2. **Stale live copy beside an archived one** (mid-move, or a `record:` line naming another number): live wins only when its `record:` matches — pinned in Task 1 (`findHeaderFiles` order) and Task 5 (`hasMaterializedHeader` fall-through).
3. **Another run's archived header inherited from the integration branch** must not arm the bookkeeping gate — Task 4 AC 4(b) fixture.
4. **Windows separators**: filesystem paths stay native, git pathspecs stay POSIX — Task 1 asserts both forms (apply the `windows-checkout-test-parity` skill).
5. **Git error vs. absent**: a git reader must never turn a failed probe into "not materialized" — Tasks 2–4 each keep a failure-posture test written before the change.

---

### Task 1: The resolver module

**Files:**
- Create: `plugin/bin/lib/run-header.js`
- Test: `tests/run-header.test.js`

**Interfaces:**
- Produces (all exported from `plugin/bin/lib/run-header.js`):
  - `PIPELINES_REL` = `'.claude-tweaks/pipelines'` (POSIX) and `ARCHIVE_SEGMENT` = `'archive'`.
  - `HEADER_PATH_RE` = `/(^|\/)(spec-\d+\/)?work\/\d+-spec\.md$/` (POSIX path tail of a header, either location).
  - `runIdentity(runDir: string) -> { runId: string, specN: number|null } | null` — a basename `spec-{digits}` whose parent basename matches `RUN_ID_RE` (from `./hooks/context`) yields `{ runId: parentBasename, specN }`; any other non-empty basename (not `.`/`..`) yields `{ runId: basename, specN: null }`; unusable input → `null`.
  - `checkoutRootOf(runDir: string) -> string|null` — the native path before the last `.claude-tweaks` segment that is followed by `pipelines`; `null` when absent.
  - `headerRelPaths(runId: string, n: number, { specN = null, shape = 'any' } = {}) -> string[]` — repo-relative POSIX paths in order live-flat, live-nested, archived-flat, archived-nested. `shape: 'nested'` drops the flat entries; `specN` set means the run is one spec of a parent: only `{runId}/spec-{specN}/work/{n}-spec.md` and its archived twin.
  - `headerPathspecs(runId: string, { specN = null } = {}) -> string[]` — `git log` pathspecs (no leading `--`): parent/single run → `[live/work, live/spec-*/work/*, archived/work, archived/spec-*/work/*]`; per-spec → `[live/spec-{N}/work/*, archived/spec-{N}/work/*]`.
  - `headerTreeDirs(runId: string, { specN = null } = {}) -> string[]` — repo-relative POSIX directories to `ls-tree -r`: `[live run dir, archived run dir]`, each suffixed `/spec-{N}` when `specN` is set.
  - `findHeaderFiles(roots: string[], runId: string, n: number, { specN = null, shape = 'any' } = {}) -> string[]` — absolute native paths of the existing candidates from `headerRelPaths`, root by root (each root is a checkout root), in precedence order. Never reads file content; never throws (a stat error counts as absent).
  - `listHeaderDirs(roots: string[], runId: string, { specN = null } = {}) -> Array<{ dir: string, location: 'live'|'archived', specN: number|null, root: string }>` — existing header directories root by root: live `work/`, live `spec-*/work/` (ascending N), archived `work/`, archived `spec-*/work/`; per-spec runs list only their own `spec-{N}/work/` at both locations. Never throws.

- [ ] **Step 1: Write the failing tests** in `tests/run-header.test.js`:
  - `runIdentity('/p/.claude-tweaks/pipelines/2026-10-22T184947-spec-1-2/spec-7')` deep-equals `{ runId: '2026-10-22T184947-spec-1-2', specN: 7 }`; `runIdentity('/p/.claude-tweaks/pipelines/2026-08-22T061958-record-991')` → `{ runId: '2026-08-22T061958-record-991', specN: null }`; `runIdentity('/x/spec-7')` (non-run-id parent) → `{ runId: 'spec-7', specN: null }`; `runIdentity('')` → `null`.
  - `headerRelPaths('R', 5)` deep-equals the four POSIX paths in the order above; `{ shape: 'nested' }` → the two nested ones; `{ specN: 5 }` → `['.claude-tweaks/pipelines/R/spec-5/work/5-spec.md', '.claude-tweaks/pipelines/archive/R/spec-5/work/5-spec.md']`.
  - `headerPathspecs('R')` deep-equals `['.claude-tweaks/pipelines/R/work', '.claude-tweaks/pipelines/R/spec-*/work/*', '.claude-tweaks/pipelines/archive/R/work', '.claude-tweaks/pipelines/archive/R/spec-*/work/*']`; per-spec form as specified.
  - `findHeaderFiles` over two temp roots: header present at live and archived in root 1 → `[live, archived]`; present only archived in root 1 and live in root 2 → `[root1 archived, root2 live]`; a missing root path → no entries, no throw. Returned paths use `path.sep`.
  - `listHeaderDirs` ordering and `location` tags over a fixture with live `spec-9/work`, live `spec-2/work`, archived `work`.
  - `checkoutRootOf(path.join('/a','b','.claude-tweaks','pipelines','R'))` → `path.join('/a','b')`; a path with no `.claude-tweaks/pipelines` → `null`.

- [ ] **Step 2: Run to verify failure**
  Run: `node --test tests/run-header.test.js`
  Expected: FAIL with `Cannot find module '../plugin/bin/lib/run-header'`

- [ ] **Step 3: Implement `plugin/bin/lib/run-header.js`** with the exports above. Use `toPosix` from `./shared-primitives` for repo-relative strings and `lstatType` from `./path-guard` for existence (the path-guard conformance scan bans bare `existsSync`/`realpathSync`).

- [ ] **Step 4: Run to verify pass**
  Run: `node --test tests/run-header.test.js`
  Expected: PASS

- [ ] **Step 5: Commit** `plugin/bin/lib/run-header.js` and `tests/run-header.test.js` — "Add run-header resolver — live-or-archived spec-header locations in one module (refs #3974)".

### Task 2: `verify-run-bookends.js` (`isSpecCommitted`)

**Files:**
- Modify: `plugin/bin/verify-run-bookends.js:109-155` (`specCandidatePaths`, `isSpecCommitted`)
- Test: `tests/verify-run-bookends.test.js`

**Interfaces:**
- Consumes: `runIdentity`, `headerRelPaths` (Task 1).
- Produces: `isSpecCommitted({ runDir, worktree, issue, multiTarget }, exec)` — unchanged signature and return contract (`true | false | null`).

- [ ] **Step 1: Characterization tests (pass before the change):** a git `exec` stub that throws `{ code: 'ETIMEDOUT' }` for every `cat-file` → `isSpecCommitted` returns `null`; a real repo with the live single-record header committed → `true`; with nothing committed → `false`.
- [ ] **Step 2: New failing tests:** real git repo fixtures where (a) the header is committed only at `archive/{run-id}/work/{N}-spec.md`; (b) multi-target parent, header only at `archive/{run-id}/spec-{N}/work/{N}-spec.md`; (c) per-spec `runDir` (`{run-id}/spec-{N}`), header only archived; (d) the branch's last commit is `git mv` of the live header to the archived path (AC 3). Each → `true`.
- [ ] **Step 3: Run** `node --test tests/verify-run-bookends.test.js` — Expected: the four new tests FAIL, characterization tests PASS.
- [ ] **Step 4: Implement:** replace `specCandidatePaths`' body with `headerRelPaths(runId, issue, { specN, shape: (specN || multiTarget) ? 'nested' : 'any' })` from `runIdentity(runDir)` (the spec-run-dir case maps to `specN`); keep `gitProbe` and the loop as they are. Delete the local path literals; leave the remedy text at line 182 unchanged (allowlisted in Task 6).
- [ ] **Step 5: Run** `node --test tests/verify-run-bookends.test.js` — Expected: PASS.
- [ ] **Step 6: Commit** — "Route isSpecCommitted through run-header — archived headers count as committed (refs #3974)".

### Task 3: `lib/flow/preflight.js` (`specOnBranch`)

**Files:**
- Modify: `plugin/bin/lib/flow/preflight.js:117-142`
- Test: `tests/bin-lib/flow/preflight.test.js`

**Interfaces:**
- Consumes: `runIdentity`, `headerTreeDirs`, `HEADER_PATH_RE` (Task 1).
- Produces: `specOnBranch(deps, { mainRoot, runDirReal, state })` — unchanged contract (`true | false | null`).

- [ ] **Step 1: Characterization test:** a `deps.git` that throws on `ls-tree` → `null` (pins today's posture); live flat and live multi-spec fixtures → `true`.
- [ ] **Step 2: New failing tests** (real repo, branch recorded in `state.pr.branch`): header only at archived flat path → `true`; only at archived `spec-{N}/work/` → `true`; branch whose last commit `git mv`s the header to the archive (AC 3) → `true`; no header anywhere → `false`.
- [ ] **Step 3: Run** `node --test tests/bin-lib/flow/preflight.test.js` — Expected: new tests FAIL.
- [ ] **Step 4: Implement:** derive `runIdentity(runDirReal)`; for each dir in `headerTreeDirs(runId, { specN })` run `ls-tree -r --name-only -z --end-of-options {branch} -- {dir}/` (cwd `mainRoot`); any `null` from `ls` → return `null`; any listed path matching `HEADER_PATH_RE` → `true`; else `false`. This folds the old direct-then-recursive two-step into one recursive listing per location.
- [ ] **Step 5: Run** the suite — Expected: PASS.
- [ ] **Step 6: Commit** — "Route specOnBranch through run-header — archived headers read as materialized (refs #3974)".

### Task 4: `pre-tool-use.js` (`hasMaterializeCommit`, `getMaterializedRecordNumbers`) and `precondition.js`

**Files:**
- Modify: `plugin/bin/lib/hooks/pre-tool-use.js:1162-1276` (`perSpecPathspec`, `hasMaterializeCommit`), `:1379-1410` (`getMaterializedRecordNumbers`)
- Modify: `plugin/bin/lib/pr-bookkeeping/precondition.js` (no logic change expected; only if a test shows one is needed)
- Test: `tests/hooks-bookkeeping-stamps-gate.test.js`, `tests/hooks-pre-tool-use.test.js`, `tests/bin-lib/pr-bookkeeping/precondition.test.js`

**Interfaces:**
- Consumes: `runIdentity`, `headerPathspecs`, `listHeaderDirs` (Task 1).
- Produces: unchanged signatures `hasMaterializeCommit(worktreeRoot, runDir) -> boolean`, `getMaterializedRecordNumbers(worktreeRoot, runDir) -> number[]`.

- [ ] **Step 1: Characterization tests (pass before the change):** `hasMaterializeCommit` on a non-repo directory → `false`; `getMaterializedRecordNumbers` on an unreadable/missing run dir → `[]`; `checkPrBookkeepingPrecondition` with `hasMaterializeCommit` forced to throw (stub via a module-level injection already used in its suite, or a corrupt worktree path) → `{ ok: true, reason: 'materialize-check-failed' }`.
- [ ] **Step 2: New failing tests** in `tests/hooks-bookkeeping-stamps-gate.test.js`, using a `commitMaterializedSpec` variant that writes under `archive/{run-id}/`:
  - AC 4(a): no commit at either location → `hasMaterializeCommit` `false`.
  - AC 4(b): main repo commits run A's header at `archive/{A}/work/...` on `main`; a linked worktree branched after it → `hasMaterializeCommit(wt, runDirB)` `false` and also `hasMaterializeCommit(wt, runDirA)` `false` (inherited, outside `main..HEAD`).
  - AC 4(c): run A's own branch with the materialize commit then a `git mv` to the archive → `true`.
  - AC 5: the gate's deny/allow outcome for a branch whose only in-range commit touching the run is the archived-path move equals the outcome for the same run materialized at the live path (assert both `pre.run(...)` results deep-equal).
  - Per-spec run dir (`{run-id}/spec-{N}`) with the header only at `archive/{run-id}/spec-{N}/work/` → `true`.
  - `getMaterializedRecordNumbers` returns `[N]` when the header exists only under the worktree's `archive/{run-id}/work/`, and `[2, 9]` for archived `spec-2`/`spec-9` dirs.
  - `checkPrBookkeepingPrecondition` on an archived-only materialized run with worktree + PR stamps → `{ ok: true, reason: 'pr-stamped-or-exempt' }` (reaches past `not-materialized-yet`).
- [ ] **Step 3: Run** `node --test tests/hooks-bookkeeping-stamps-gate.test.js tests/bin-lib/pr-bookkeeping/precondition.test.js` — Expected: new tests FAIL.
- [ ] **Step 4: Implement:** in `hasMaterializeCommit`, replace the `perSpec || [...]` pathspec construction with `['--', ...headerPathspecs(runId, { specN })]` from `runIdentity(runDir)` (return `false` when it is `null`); keep the range bound, fallback, and failure handling byte-for-byte. Delete `perSpecPathspec` and `PER_SPEC_SUBDIR_RE` if no other caller remains (grep first). In `getMaterializedRecordNumbers`, collect `/^(\d+)-spec\.md$/` names from every dir in `listHeaderDirs([worktreeRoot], runId, { specN })`.
- [ ] **Step 5: Run** the three suites plus `node --test tests/hooks-pre-tool-use.test.js` — Expected: PASS, with no existing expectation edited.
- [ ] **Step 6: Record consumers:** run `grep -rn hasMaterializeCommit plugin/bin` and keep the output for the PR body (expected consumers: `checkBookkeepingStampsGate` and `pr-bookkeeping/precondition.js`).
- [ ] **Step 7: Commit** — "Route hasMaterializeCommit and getMaterializedRecordNumbers through run-header — range bound unchanged (refs #3974)".

### Task 5: `wrap-up/pack.js` and `dispatch/first-call-artifact-check.js`

**Files:**
- Modify: `plugin/bin/lib/wrap-up/pack.js:152-250` (`headerEntries` callers, `resolveRecords`, `manifestRecords`)
- Modify: `plugin/bin/lib/dispatch/first-call-artifact-check.js:102-120` (`headerBases`, `hasMaterializedHeader`)
- Test: `tests/bin-lib/wrap-up/pack.test.js`, `tests/wrap-up-record-resolution-conformance.test.js`, the dispatch first-call check suite (`grep -rl checkFirstCallArtifacts tests`)

**Interfaces:**
- Consumes: `runIdentity`, `checkoutRootOf`, `findHeaderFiles`, `listHeaderDirs` (Task 1); pack's own `worktreeMirror`, `headerEntries`.
- Produces: unchanged `resolveRecords(deps, runDir, worktree) -> { records, source, parkedAtShaping }` (same `source` labels: `headers`, `worktree-headers`, `manifest`, `worktree-manifest`) and `closingRecords`; unchanged `hasMaterializedHeader(readFile, bases, n)` contract, plus the check's `materialized-header-missing` failure text.

- [ ] **Step 1: Characterization tests:** `resolveRecords` with an unreadable header file skips it (today's `catch { continue; }`); `hasMaterializedHeader` with a header whose `record:` names another number → `false`.
- [ ] **Step 2: New failing tests:**
  - `resolveRecords`: header only at `archive/{run-id}/work/` under the run dir's checkout root → `{ records: [N], source: 'headers' }`; only in the worktree mirror's archive → `source: 'worktree-headers'`; multi-spec parent with headers only at `archive/{run-id}/spec-{N}/work/` → records include `N` via the `manifest` rung; `closingRecords` yields the same `Fixes` set for the archived fixture as for the live one (AC 1).
  - `hasMaterializedHeader`/`checkFirstCallArtifacts`: header only archived (flat and `spec-{N}`) → passes check 5; a stale live copy whose `record:` names another number plus a correct archived copy → passes (AC 7 fall-through); live `work/` dir present without this record's file, header archived → passes.
- [ ] **Step 3: Run** the suites — Expected: new tests FAIL.
- [ ] **Step 4: Implement:** in `pack.js`, read the header-rung directories from `listHeaderDirs([checkoutRootOf(runDir)], runId, { specN })` (live then archived, own run's flat/per-spec dirs only) for rung (a) and the same over `[worktree]` for rung (b), merging `headerEntries` per directory with first-seen-record-wins; rung (c)'s `spec-*/work` scan reads the `spec-*` entries `listHeaderDirs` returns at both locations. Keep `worktreeMirror`'s own behavior and every `source` label. In `first-call-artifact-check.js`, `hasMaterializedHeader` becomes: for each file in `findHeaderFiles(roots, runId, n, { specN })` with roots `[checkoutRootOf(runDir), runState.worktree]` (deduplicated, nulls dropped), apply the existing `record:` check and return on the first match; keep `headerBases` exported for the failure message.
- [ ] **Step 5: Run** the suites — Expected: PASS, existing expectations unedited.
- [ ] **Step 6: Commit** — "Route pack.js and the dispatch first-call header check through run-header (refs #3974)".

### Task 6: Source-scan conformance — the rule lives in one place

**Files:**
- Test: `tests/run-header.test.js` (append the scan; follow the `bin-source-scan-conformance` skill: shared `stripComments`/`stripperVerdict` from `./helpers/strip-comments`, mis-parse is an offender, planted self-tests, a floor on matched sites)

**Interfaces:**
- Consumes: `plugin/bin/**/*.js` source text.

- [ ] **Step 1: Write the scan:**
  - Reader files (`verify-run-bookends.js`, `lib/flow/preflight.js`, `lib/hooks/pre-tool-use.js`, `lib/pr-bookkeeping/precondition.js`, `lib/wrap-up/pack.js`, `lib/dispatch/first-call-artifact-check.js`), comments stripped: contain neither `'archive'`/`"archive"` as a literal nor the text `pipelines/archive` (AC 8).
  - Header-path builders across `plugin/bin`: a template or quoted string containing `work/` followed by `-spec.md` (e.g. `` `work/${n}-spec.md` ``), or a `path.join(` / `path.posix.join(` call whose argument text contains the literal `'work'` and `-spec.md`. Allowed files: `lib/run-header.js`, `lib/reconcile/archive-merged.js`, `sweep-stray-run-dirs.js` (archive writers), `materialize.js` (the header writer), and `verify-run-bookends.js` only for its remedy-message line (allowlist keyed to the exact template text, reason: user-facing remedy text, not a read path). Any other match is an offender.
  - Floor: assert the matched-site total across allowed files is at least the count observed when the scan lands (record it in the assertion message).
  - Planted self-tests: a fixture line `const p = path.join(dir, 'work', \`${n}-spec.md\`);` is flagged; the same text inside a `//` comment is not; a regex literal `/work[/\\]\d+-spec\.md/` is not; a stripper mis-parse fixture is reported as an offender.
- [ ] **Step 2: Run** `node --test tests/run-header.test.js` — Expected: PASS on the migrated tree. Prove it can go red: temporarily restore one reader's old literal (e.g. `specCandidatePaths`' template) in a scratch copy fed to the matcher via the planted self-test, and confirm the self-test flags it.
- [ ] **Step 3: Record the reader set:** run `grep -rln "work.*-spec\.md" plugin/bin` and keep the output for the PR body (AC 8).
- [ ] **Step 4: Commit** — "Pin the spec-header location rule to run-header.js with a source scan (refs #3974)".

### Spec coverage map

| AC clause | Covered by |
|---|---|
| AC1.1 | Task 2 Step 2 (a); Task 3 Step 2; Task 4 Step 2 (`getMaterializedRecordNumbers`, precondition); Task 5 Step 2 (`resolveRecords`, `closingRecords`, `hasMaterializedHeader`) |
| AC2.1 | Task 2 Step 2 (b, c); Task 3 Step 2 (archived `spec-{N}`); Task 4 Step 2 (per-spec run dir, archived `spec-2`/`spec-9`); Task 5 Step 2 (multi-spec parent, flat and `spec-{N}`) |
| AC3.1 | Task 2 Step 2 (d); Task 3 Step 2 (`git mv` branch); Task 4 Step 2 AC 4(c) |
| AC4.1 | Task 4 Step 2 AC 4(a) |
| AC4.2 | Task 4 Step 2 AC 4(b) |
| AC4.3 | Task 4 Step 2 AC 4(c) |
| AC5.1 | Task 4 Step 2 AC 5 |
| AC5.2 | Task 4 Step 2 AC 5 (fixture in `tests/hooks-bookkeeping-stamps-gate.test.js`) |
| AC6.1 | Task 2–5 Step 5 (existing suites unedited); Task 7 Step 1 |
| AC7.1 | Task 1 Step 1 (`findHeaderFiles` live-before-archived) |
| AC7.2 | Task 5 Step 2 (stale live `record:` mismatch falls through) |
| AC7.3 | Task 5 Step 2 (live `work/` without this record, header archived) |
| AC8.1 | Task 6 Step 1 |
| AC8.2 | Task 6 Step 3 |
| AC8.3 | Task 7 Step 2 |
| AC9.1 | Task 2 Step 1; Task 3 Step 1 |
| AC9.2 | Task 4 Step 1 (`materialize-check-failed`) |
| AC9.3 | Task 4 Step 1 (`false` / `[]`) |
| AC9.4 | Task 5 Step 1 |
| AC9.5 | Task 2 Step 1; Task 3 Step 1 (`null` stays `null` after migration) |

### Task 7: Full-suite check and PR-body evidence

- [ ] **Step 1:** Run the six readers' suites plus `tests/run-header.test.js` together and confirm all pass with no edited expectation in pre-existing tests (`git diff origin/main -- tests/` shows only additions in existing files).
- [ ] **Step 2:** Hand the two grep outputs (Task 4 Step 6, Task 6 Step 3) to the orchestrator for the PR body; no commit.
