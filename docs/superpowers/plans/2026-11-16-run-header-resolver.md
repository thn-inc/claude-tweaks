# Run-Header Resolver Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One shared resolver (`plugin/bin/lib/run-header.js`) that locates a run's materialized spec header at the live path or the archived path, and all eight header readers migrated onto it, with no behavior change for any run that exists today.

**Architecture:** The resolver is pure path arithmetic plus one injectable directory listing. Git-tree readers get POSIX repo-relative candidate paths and pathspecs (live first, then archived) and keep their own `git` call and failure semantics. Filesystem readers pass the run dirs they already read today (run dir, then worktree mirror, in each reader's existing order); the resolver adds each one's archived sibling (`.../pipelines/{run-id}` -> `.../pipelines/archive/{run-id}`) and returns ordered candidates; the caller reads them with its own injected `readFile`/`readdir` and keeps its own `record:` check.

**Tech Stack:** Node 18+ CommonJS, `node --test`, real `git` in fixture repos.

**Spec:** `.claude-tweaks/pipelines/2026-11-16T023906-record-3974/work/3974-spec.md` (record #3974, re-materialized with the three 2026-11-16 Decisions)

## Global Constraints

- Archived layout (from `archiveRunDir`, `plugin/bin/lib/reconcile/archive-merged.js`): `.claude-tweaks/pipelines/archive/{run-id}/work/{N}-spec.md` and `.claude-tweaks/pipelines/archive/{run-id}/spec-{N}/work/{N}-spec.md`. The archive dir is named after `path.basename(runDir)`.
- Precedence (spec Technical Approach): "root by root: within a root, live before archived and flat `work/` before `spec-{N}/work/`." The caller supplies the roots; the resolver does no mirror discovery.
- The reader set is eight (spec Decision, reader set): the six under Current State plus "the `spec` probe in `plugin/bin/lib/flow/preflight.js` (lines 273-290) and `resolveTargetRecords` in `plugin/bin/lib/timing/context-gauge.js` (line 311)". "Where the criteria say 'six readers', read eight; AC8's file list gains `plugin/bin/lib/timing/context-gauge.js`."
- No reader file may contain the path segment `'archive'` or the text `pipelines/archive` in code (AC8). Only `run-header.js` spells it.
- AC8 stays strict (spec Decision, AC8 and message text): the two messages at `plugin/bin/context-gauge.js` line 242 and `plugin/bin/verify-run-bookends.js` line 191 "are reworded so they no longer build a header path in text … The scan stays strict and gains no per-file exemption."
- Further gaps (spec Decision rule): take the reading that "keeps a run on the previous plugin release working; puts the rule in code and not in skill prose; stays inside this record's Key Files. It states the choice in the PR body." No task stops for a further reading choice.
- Git pathspecs (spec Gotcha, verbatim): "`spec-*/work` does not match; `spec-*/work/*` does … Keep the trailing wildcard in the archived spec pathspec as well: `pipelines/archive/{run-id}/spec-*/work/*`."
- "`git cat-file -e HEAD:<path>` cannot glob; the resolver must hand it concrete candidate paths, not pathspecs."
- The `{integration}..HEAD` range bound in `hasMaterializeCommit` (#1674) and its unbounded fallback are not changed; only the pathspec list grows.
- Failure postures are unchanged in every reader (AC9).
- The dual-path rule is permanent, not a compatibility shim — no removal condition, no `TODO`.
- Governing skill `bin-source-scan-conformance` (verbatim): "Import it: `const { stripComments, stripperVerdict, STRIPPER_VERDICT_MESSAGES } = require('./helpers/strip-comments');`." / "A scan reports `misparsed` and `unparseable` as an offender, with `STRIPPER_VERDICT_MESSAGES[verdict]` as the text." / "assert a lower bound on matches across the tree, and make the message say what a low count means." / "Assert the exact flagged line numbers, not just a count, because the right count can come from the wrong lines." / "A new suite that imports the stripper is itself a caller, and two hand-written lists must name it by test-file stem: the header comment of `tests/helpers/strip-comments.js` and `parse-signal-discipline` item 15." / "If the suite reads a source file as text, read it through `readText` from `tests/helpers/read-skill.js`, not a raw `fs.readFileSync`." / "Walking `plugin/bin` with `fs.readdirSync(dir, { recursive: true })` … use the manual `withFileTypes` walk … and a floor on files walked."
- Governing skill `windows-checkout-test-parity` (`display-ids-and-native-paths.md`, verbatim): "A path the code shows or compares as an ID (a JSON report row, a git-style repo-relative name, a glob) is a repo-display ID and uses `/` on every OS. A path the code then opens with `fs` stays native." Git pathspecs/candidate paths are POSIX literals built with `/` templates; filesystem candidates use `path.join`.
- Governing skill `git-ground-truth-test-env` (verbatim): "A git child that supplies ground truth about refusal or trust runs hermetic. Set `GIT_CONFIG_NOSYSTEM=1` and `GIT_CONFIG_GLOBAL` to the null device" and "Prove both under the runner. Run `node tools/run-tests.js --files-from <list>`, never only a bare `node --test`".
- Governing skill `pre-tool-use-gate-exemptions` (verbatim): "Every new exemption needs a regression test proven to go red on revert." `hasMaterializeCommit` arms `checkBookkeepingStampsGate` (its only deny-gate consumer); widening what counts as materialized widens what that gate sees, so AC5 pins it. `precondition.js` is the file's named fail-open sibling: "Do not apply this skill's 'every unprovable answer fails CLOSED' rule to that file."
- Source-scan lint: no bare `fs.existsSync`/`fs.realpathSync` in `plugin/bin` (`tests/path-guard-conformance.test.js`); the resolver needs neither — it lists directories through an injected `readdir` that defaults to a try/catch `fs.readdirSync`.
- Scope and edit discipline: "Commit tests only where the task asks for them or the repo already keeps tests for this kind of change, sized like the neighboring test files; scratch checks stay scratch. Touch only what the task requires — a pre-existing bug you notice is a follow-up to report, not a fix to fold in, unless the task cannot work without it. Don't reformat or "improve" adjacent code; edit in place rather than rewrite when the result is the same."

## Plan decisions (departures from the spec text)

- **Filesystem resolver takes run dirs, not checkout roots.** The spec names `findHeaderFiles(roots, runId, n)` / `listHeaderDirs(roots, runId)` over checkout roots. Every filesystem reader already holds run dirs (`runDir`, `worktreeMirror(runDir, worktree)`, `resolveTargetRecords`'s `roots`), and their existing suites build run dirs that are not under a `.claude-tweaks/pipelines` parent; deriving a checkout root would change what those suites read (AC6). So the functions take an ordered list of live run dirs and derive each archived sibling with `archivedRunDir(runDir)`; the run id is each dir's basename, the same basename `archiveRunDir` uses. Named `headerFileCandidates` (it returns ordered candidates and never touches the filesystem; the caller's `readFile` decides existence) and `listHeaderDirs`. PR body states this choice (decision rule: keeps the previous release's runs reading identically).
- **`listHeaderDirs` entry shape carries both `specDir` and `specN`.** The spec's shape is `{ dir, location, specN: number | null }`. `pack.js`'s `manifestRecords` scans every `/^spec-/` subdirectory today, numeric or not, while `context-gauge.js` counts only `/^spec-([1-9]\d*)$/` directories; a `specN`-only shape would narrow the pack's scan (AC6). Each entry is `{ dir, location, specDir: string|null, specN: number|null }` — `specDir` the subdirectory name (`null` for flat `work/`), `specN` its parsed number when it matches `/^spec-([1-9]\d*)$/`, else `null`.
- **Per-spec child run dirs.** Two readers already special-case a `spec-{N}` run dir whose parent is run-id-shaped (`perSpecPathspec`, `specCandidatePaths`). The resolver's git functions take `{ specDir }` for that case; callers keep deriving `runId`/`specDir` exactly as today. `specOnBranch` derives its archived rel from `archivedRunDir(runDirReal)`, never from `runRelDirs(path.basename(runDirReal))`, so a per-spec `runDirReal` (`.../pipelines/{id}/spec-{N}`) gets `.../pipelines/archive/{id}/spec-{N}` (plan-review row: cross-task contract, Task 3 per-spec run id).
- **Message rewording (Decision, AC8).** `verify-run-bookends.js:191` remedy ends `then commit the spec file it writes (its JSON \`file\` field)`; `context-gauge.js:242` reads `handoff.json not written: no target records (no spec-{N}/ dir and no spec header for ${runDir}${worktree ? ' or its worktree copy' : ''})`. Neither text holds both `work` and `-spec.md`. Pre-change grep: no test pins either message (`git grep -n -e "then commit work/" -e "no work/{n}-spec.md" -- tests` prints nothing).
- **Enumerating readers merge by record, within a root (spec Plan Review Clarifications, settled row 1).** `listHeaderDirs` returns directories, not records, so the record-level "earlier in precedence wins" rule is applied by each enumerating reader as it reads names: within one run dir (root), the live and archived headers are merged by record, the live copy winning a duplicate; across roots the reader keeps its existing first-non-empty order. Tasks 3, 4, 5 and 7 each say how. (Plan-review row 6, low: the dedup lives in the readers because only they list file names; logged, not amended further.)
- **Header only (spec Plan Review Clarifications, settled row 2).** `manifest.yml` and `config.yml` stay read at the live run dir; every archived-only fixture keeps them live. PR body states this.
- **`preflight.js` `spec` probe return shape.** For a header found at the archived flat location the probe returns the same `{ path: 'work/{name}', present: true, record, records: [record] }` it returns for live: `path` stays relative to the header's own run dir (no consumer reads `spec.path` — `git grep -n "spec\.path" -- plugin` prints nothing), so AC1's "same answer" holds.

Waived AC8.3: a PR-body content requirement, not testable code — Task 8 Step 1 runs the grep and the build's PR-body update carries its output.

Waived _shared/pipeline-run-dir.md: read only for the IL-127 anchoring rule the Technical Approach cites; no task changes run-dir anchoring — the filesystem readers keep supplying their own run dirs (Tasks 3, 5, 6, 7).

## Review Focus

- A record whose header exists at **both** locations (a stale live copy, a mid-move state): single-record lookups must return the live copy, and enumerating readers must count the record once (Task 1, Task 5, Task 6, Task 7 tests).
- A **git error** while probing the archived candidate after the live candidate answered "absent": `isSpecCommitted`/`specOnBranch` must still report `null`, never `false` (Task 2, Task 3 tests).
- An **inherited archived header** from another run reachable from the integration branch must not arm the bookkeeping gate for a run that never materialized (Task 4, AC4(b)).
- A **live `work/` directory without this record's header** plus an archived header: lookup returns archived (Task 1 candidate order, Task 6 test).
- A **run dir not under a `pipelines` parent** (test fixtures, ad-hoc dirs): no archived candidate is invented, behavior identical to today (Task 1 test; Task 7 reuses the existing non-pipelines fixtures unchanged).

---

### Task 1: The resolver module

**Role:** integration
**Review risk:** high

**Files:**
- Create: `plugin/bin/lib/run-header.js`
- Create: `tests/run-header.test.js`
- Modify: `docs/plugin-structure.md` (one row for the new module beside `plugin/bin/lib/strip-comments.js`, under 4000 chars)

**Interfaces:**
- Produces (all exported from `plugin/bin/lib/run-header.js`):
  - `PIPELINES_REL = '.claude-tweaks/pipelines'` (POSIX literal).
  - `runRelDirs(runId: string, { specDir = null } = {}) -> [string, string]` — `[live, archived]` POSIX repo-relative dirs: `${PIPELINES_REL}/${runId}` and `${PIPELINES_REL}/archive/${runId}`, each suffixed `/${specDir}` when `specDir` is given.
  - `headerRelPaths(runId: string, recordNumber: number, { specDir = null, layout = 'any' } = {}) -> string[]` — concrete POSIX paths. With `specDir`: `[live/{specDir}/work/{n}-spec.md, archived/{specDir}/work/{n}-spec.md]`. Otherwise in order live flat, live `spec-{n}`, archived flat, archived `spec-{n}`; `layout: 'flat'` keeps only the flat ones, `'nested'` only the `spec-{n}` ones.
  - `headerPathspecs(runId: string, { specDir = null } = {}) -> string[]` — for `git log`: with `specDir`: `[live/{specDir}/work/*, archived/{specDir}/work/*]`; otherwise `[live/work, live/spec-*/work/*, archived/work, archived/spec-*/work/*]` (no leading `--`).
  - `archivedRunDir(runDir: string, pathImpl = path) -> string|null` — native path. Parent basename `pipelines` -> `join(parent, 'archive', base)`. Basename `/^spec-/` with a parent matching `RUN_ID_RE` (`require('./hooks/context').RUN_ID_RE`) whose own parent basename is `pipelines` -> `join(grandparent, 'archive', parentId, base)`. Anything else, or a dir already under an `archive` parent, -> `null`.
  - `headerFileCandidates(runDirs: string[], recordNumber: number, pathImpl = path) -> string[]` — native paths, run dir by run dir: `{d}/work/{n}-spec.md`, `{d}/spec-{n}/work/{n}-spec.md`, then the same two under `archivedRunDir(d)` when non-null. Falsy entries in `runDirs` are skipped.
  - `listHeaderDirs(runDirs: string[], { readdir = defaultReaddir, pathImpl = path } = {}) -> Array<{ dir: string, location: 'live'|'archived', specDir: string|null, specN: number|null }>` — per run dir, for `live` then `archived` (when non-null): `{base}/work` with `specDir: null, specN: null`, then `{base}/{name}/work` for each `readdir(base)` name starting `spec-`, sorted by name, `specN` = the number when the name matches `/^spec-([1-9]\d*)$/`, else `null`. No existence check on the returned dirs — the caller's own listing decides. `defaultReaddir` returns `[]` on any error. Falsy run dirs are skipped.

- [ ] **Step 1: Write the failing tests** in `tests/run-header.test.js`:
  - `headerRelPaths('R', 7)` deep-equals `['.claude-tweaks/pipelines/R/work/7-spec.md', '.claude-tweaks/pipelines/R/spec-7/work/7-spec.md', '.claude-tweaks/pipelines/archive/R/work/7-spec.md', '.claude-tweaks/pipelines/archive/R/spec-7/work/7-spec.md']`; `layout: 'nested'` keeps entries 2 and 4; `specDir: 'spec-9'` gives the two `spec-9/work/7-spec.md` paths.
  - `headerPathspecs('R')` deep-equals `['.claude-tweaks/pipelines/R/work', '.claude-tweaks/pipelines/R/spec-*/work/*', '.claude-tweaks/pipelines/archive/R/work', '.claude-tweaks/pipelines/archive/R/spec-*/work/*']`; with `specDir: 'spec-9'` it is `['.claude-tweaks/pipelines/R/spec-9/work/*', '.claude-tweaks/pipelines/archive/R/spec-9/work/*']`.
  - `archivedRunDir`: `/m/.claude-tweaks/pipelines/2026-11-16T020801-record-1` -> `/m/.claude-tweaks/pipelines/archive/2026-11-16T020801-record-1`; `/m/.claude-tweaks/pipelines/2026-11-16T020801-record-1/spec-4` -> `/m/.claude-tweaks/pipelines/archive/2026-11-16T020801-record-1/spec-4`; `/tmp/x/run` -> `null`; `/m/.claude-tweaks/pipelines/archive/R` -> `null`; with `path.win32` on `C:\\m\\.claude-tweaks\\pipelines\\R` -> `C:\\m\\.claude-tweaks\\pipelines\\archive\\R` (exact string).
  - `test('AC7.1: precedence — live before archived, root by root', …)`: `headerFileCandidates([runDir, mirror], 7)` equals the eight native paths in the order run-dir live flat, live nested, archived flat, archived nested, then the mirror's four.
  - `listHeaderDirs` with a fake `readdir` returning `['spec-2', 'work', 'spec-10', 'spec-x']` for both bases yields eight entries in order (live `work`, live `spec-10`, live `spec-2`, live `spec-x`, archived …), `specN` `10`/`2`/`null` and `specDir` the name.
  - A real-tmpdir case for `listHeaderDirs` with the default `readdir` over an archived-only layout returns the archived `work` dir among its entries.
- [ ] **Step 2: Run test to verify it fails**
  Run: `node --test tests/run-header.test.js`
  Expected: FAIL with "Cannot find module '../plugin/bin/lib/run-header'" (or equivalent require path)
- [ ] **Step 3: Implement `plugin/bin/lib/run-header.js`** with the exports above; a header comment states the dual-path rule is permanent (live phase, then archived after wrap-up's move in #3976 or `archiveRunDir`), names both writers, and lists the eight readers.
- [ ] **Step 4: Run test to verify it passes**
  Run: `node --test tests/run-header.test.js`
  Expected: PASS
- [ ] **Step 5: Commit** `git add plugin/bin/lib/run-header.js tests/run-header.test.js docs/plugin-structure.md` and `git commit -m "Add run-header resolver — live and archived spec header locations (refs #3974)"`

### Task 2: `verify-run-bookends.js` onto the resolver

**Role:** integration

**Files:**
- Modify: `plugin/bin/verify-run-bookends.js` (`specCandidatePaths`, lines 118-131; `materializeRemedy`, line 191)
- Test: `tests/verify-run-bookends.test.js`

**Interfaces:**
- Consumes: `headerRelPaths(runId, n, { specDir, layout })` from Task 1.
- Produces: `specCandidatePaths(runDir, issue, multiTarget)` keeps its signature; per-spec run dir -> `headerRelPaths(parent, issue, { specDir: base })`; otherwise `headerRelPaths(base, issue, { layout: multiTarget ? 'nested' : 'any' })`. `isSpecCommitted` body unchanged. `materializeRemedy(n)` ends `then commit the spec file it writes (its JSON \`file\` field)` in place of `then commit work/${n}-spec.md`.

- [ ] **Step 1: Write the failing tests** in `tests/verify-run-bookends.test.js`:
  - `AC1.1/AC2.1 isSpecCommitted: archived-only header reads as committed` — injected `exec` that exits 0 only for `HEAD:.claude-tweaks/pipelines/archive/{runId}/work/{n}-spec.md` (and in a second case only for `.../archive/{runId}/spec-{n}/work/{n}-spec.md` with `multiTarget: true`); assert `true`.
  - `AC3.1 isSpecCommitted on a real repo whose last commit git-mv'd the header to the archive path` — tmp repo (hermetic env `GIT_CONFIG_NOSYSTEM=1`, `GIT_CONFIG_GLOBAL` = `os.devNull`), commit a live header, `git mv` it to the archived path, commit; assert `true`.
  - `AC9.1/AC9.5 isSpecCommitted stays null when the archived probe times out after a live miss` — exec throws exit-1 for the live candidates and an `ETIMEDOUT` error for an archived one; assert `null`.
  - `AC8 materialize remedy names no header path` — a missing-spec bookend's `remedy` contains `then commit the spec file it writes` and does not match `/work\/\d+-spec\.md/`.
- [ ] **Step 2: Run test to verify it fails**
  Run: `node --test tests/verify-run-bookends.test.js`
  Expected: FAIL (the archived-only cases return `false`; the remedy still names `work/{n}-spec.md`)
- [ ] **Step 3: Implement** the `specCandidatePaths` delegation and the remedy text above; remove the local `root` literal.
- [ ] **Step 4: Run test to verify it passes**
  Run: `node --test tests/verify-run-bookends.test.js`
  Expected: PASS, with every pre-existing test unchanged (AC6.1)
- [ ] **Step 5: Commit** `git add plugin/bin/verify-run-bookends.js tests/verify-run-bookends.test.js` and `git commit -m "Resolve archived headers in verify-run-bookends — isSpecCommitted via run-header (refs #3974)"`

### Task 3: `lib/flow/preflight.js` — `specOnBranch` and the `spec` probe

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/flow/preflight.js` (`specOnBranch`, lines 118-143; `buildProbes`' `spec` probe, lines 273-291)
- Test: `tests/bin-lib/flow/preflight.test.js`

**Interfaces:**
- Consumes: `archivedRunDir(runDir)`, `listHeaderDirs(runDirs, { readdir })` from Task 1.
- Produces:
  - `specOnBranch` keeps its signature and `true | false | null` return. `rels` = `[toPosix(path.relative(mainRoot, runDirReal))]`, plus `toPosix(path.relative(mainRoot, archivedRunDir(runDirReal)))` when that is non-null. For each `rel` in order: the existing non-recursive `${rel}/work/` listing, then the existing recursive `${rel}/` listing, each with the same regexes; any listing returning `null` returns `null`; first match returns `true`; otherwise `false`. The live rel is byte-identical to today's, so the existing argv pins (`preflight.test.js` lines 301-326) keep passing.
  - `spec` probe keeps its return shape. `dirs = listHeaderDirs([runDirReal], { readdir: deps.readdir })`. First pass: merge the `/^\d+-spec\.md$/` names of every `specDir === null` dir (live and archived of the one root), de-duplicated by record, live winning; when any, the lowest-sorted name returns `{ path: 'work/{that name}', present: true, record, records: [record] }` (today's "first sorted name" rule, over the merged set). Otherwise collect `/^\d+-spec\.md$/` record numbers from the dirs whose `specDir` matches `/^spec-\d+$/` (today's filter), de-duplicated (live wins), sorted -> `{ path: null, present: true, record: null, records }`; none -> `{ path: null, present: false, record: null, records: [] }`.

- [ ] **Step 1: Write the failing tests**:
  - `AC1.1 specOnBranch finds an archived-only flat header` — fake `git` returns `''` for both live listings and `.claude-tweaks/pipelines/archive/{id}/work/7-spec.md\0` for the archived `work/` listing; `computeAdoption(...).specMaterialized === true`, and the third ls-tree call's last arg is `.claude-tweaks/pipelines/archive/{id}/work/`.
  - `AC2.1 specOnBranch finds an archived-only spec-{N} header` via the archived recursive listing.
  - `specOnBranch: per-spec run dir probes its own archived sibling` — `runDirReal` = `{main}/.claude-tweaks/pipelines/{id}/spec-4`; the archived listings' pathspecs start `.claude-tweaks/pipelines/archive/{id}/spec-4/`.
  - `AC3.1 specOnBranch on a real repo branch whose last commit git-mv'd the header` — real tmp main checkout, hermetic git env, branch with the move commit, `state.pr.branch` set; asserts `true`.
  - `AC9.1/AC9.5 specOnBranch returns null when the archived listing throws` — live listings `''`, archived listing throws; asserts `specMaterialized === null`.
  - `AC1.1 spec probe: archived-only flat header gives the live answer` — fake `readdir` serving `7-spec.md` only under `{main}/.claude-tweaks/pipelines/archive/{id}/work`; probe value deep-equals the value for the same header served under the live `work` (`{ path: 'work/7-spec.md', present: true, record: 7, records: [7] }`).
  - `AC2.1 spec probe: archived-only spec-{N} headers give the live answer` — headers only under `archive/{id}/spec-9/work/` and `archive/{id}/spec-12/work/`; `{ path: null, present: true, record: null, records: [9, 12] }`, equal to the live-layout value.
  - `AC7.1 spec probe: the merged set's lowest name answers` — live `work/` holds `8-spec.md`, archived `work/` holds `7-spec.md`; `record === 7` (merge, not live-hides-archived); and with `7-spec.md` at both, `record === 7` once.
  - `AC9.4 spec probe: an unreadable archived dir is absent` — `readdir` returns `[]` for the archived base (today's `deps.readdir` posture); `present: false`.
- [ ] **Step 2: Run test to verify it fails**
  Run: `node --test tests/bin-lib/flow/preflight.test.js`
  Expected: FAIL (archived-only fixtures report `false` / `present: false`)
- [ ] **Step 3: Implement** both changes above.
- [ ] **Step 4: Run test to verify it passes**
  Run: `node --test tests/bin-lib/flow/preflight.test.js tests/flow-preflight-conformance.test.js`
  Expected: PASS
- [ ] **Step 5: Commit** `git add plugin/bin/lib/flow/preflight.js tests/bin-lib/flow/preflight.test.js` and `git commit -m "Resolve archived headers in flow preflight — specOnBranch and the spec probe via run-header (refs #3974)"`

### Task 4: `pre-tool-use.js` (`hasMaterializeCommit`, `getMaterializedRecordNumbers`) and `precondition.js`

**Role:** judgment
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/hooks/pre-tool-use.js` (`perSpecPathspec`, `hasMaterializeCommit` — the `paths` line only, `getMaterializedRecordNumbers`)
- Modify: `plugin/bin/lib/pr-bookkeeping/precondition.js` (expected no code change: it reads through `hasMaterializeCommit`, so no second copy of the dual-path rule; modify only if a test shows otherwise)
- Test: `tests/hooks-bookkeeping-stamps-gate.test.js`, `tests/hooks-pre-tool-use.test.js`, `tests/bin-lib/pr-bookkeeping/precondition.test.js`

**Interfaces:**
- Consumes: `headerPathspecs(runId, { specDir })`, `listHeaderDirs(runDirs, { readdir })` from Task 1.
- Produces: `perSpecPathspec(runDir, runId)` returns `['--', ...headerPathspecs(parentId, { specDir: runId })]` (still `null` for every non-per-spec shape); `hasMaterializeCommit` uses `perSpec || ['--', ...headerPathspecs(runId)]`, range bound and fallback untouched; `getMaterializedRecordNumbers(worktreeRoot, runDir)` collects `/^(\d+)-spec\.md$/` names from every dir of `listHeaderDirs([path.join(worktreeRoot, PIPELINE_STATE_DIR, runId)])`, same `[]`-on-error posture. Consumer list at build (`grep -rn hasMaterializeCommit plugin/bin`): re-run it and record the output in the PR body (last plan-time run: `checkBookkeepingStampsGate`, the only deny gate, and `pr-bookkeeping/precondition.js`).

- [ ] **Step 1: Write the characterization tests for current failure values** (AC9): write `AC9.3 hasMaterializeCommit returns false when git cannot run` and `AC9.3 getMaterializedRecordNumbers returns [] on an unreadable run dir` and `AC9.2 precondition returns materialize-check-failed when hasMaterializeCommit throws` against the unchanged code, run them, confirm green, and keep them.
- [ ] **Step 2: Write the failing tests** (real git repos, hermetic env, an `origin/main`-style integration ref as the existing gate tests build it):
  - `AC1.1 hasMaterializeCommit: a commit touching only the archived flat header counts`; `AC2.1` the same for `archive/{id}/spec-{N}/work/{N}-spec.md`; `AC1.1 getMaterializedRecordNumbers reads archived-only headers` (flat and `spec-{N}`).
  - `AC3.1 hasMaterializeCommit: branch whose last commit git-mv'd the header live -> archived`.
  - `AC4.1 (a) never-materialized run returns false`; `AC4.2 (b) run A's archived header reachable from the integration branch does not arm run B` (run A's live materialize and its archived-move commits are merged into the integration ref; run B's worktree branch is cut from that ref; `hasMaterializeCommit(wtB, runDirA)` and `hasMaterializeCommit(wtB, runDirB)` both return `false`); `AC4.3 (c) run A's own branch with materialize + move commits returns true`.
  - In `tests/hooks-bookkeeping-stamps-gate.test.js`: `AC5.1/AC5.2 checkBookkeepingStampsGate arms identically for an archived-path move and a live materialize` — the same fixture twice (header committed at live path vs. only the archived-move commit in range), missing `pr` stamp under pr-first, both deny with the same reason.
  - `AC1.1 precondition.js reports no-pr-stamp for an archived-only materialize` (proves it reads through `hasMaterializeCommit`).
- [ ] **Step 3: Run tests to verify they fail**
  Run: `node --test tests/hooks-bookkeeping-stamps-gate.test.js tests/bin-lib/pr-bookkeeping/precondition.test.js`
  Expected: FAIL (archived-only fixtures read as not materialized)
- [ ] **Step 4: Implement** the three changes above. Check every deny gate consuming `hasMaterializeCommit` (only `checkBookkeepingStampsGate`) for an exemption-scope change and note the result in the commit message body.
- [ ] **Step 5: Run tests to verify they pass, and prove discrimination**
  Run: `node --test tests/hooks-bookkeeping-stamps-gate.test.js tests/hooks-bookkeeping-stamps-gate-claim-memo.test.js tests/hooks-pre-tool-use.test.js tests/bin-lib/pr-bookkeeping/precondition.test.js`
  Expected: PASS. Then revert only `pre-tool-use.js` (`git show HEAD:plugin/bin/lib/hooks/pre-tool-use.js` redirected to a scratch file and copied back — never `git stash`), re-run, confirm only the new archived tests go red, restore.
- [ ] **Step 6: Commit** `git add plugin/bin/lib/hooks/pre-tool-use.js tests/hooks-bookkeeping-stamps-gate.test.js tests/hooks-pre-tool-use.test.js tests/bin-lib/pr-bookkeeping/precondition.test.js` and `git commit -m "Count archived headers as materialized in the bookkeeping gate — range bound unchanged (refs #3974)"`

### Task 5: `lib/wrap-up/pack.js` (`resolveRecords`, `closingRecords`, `manifestRecords`)

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/wrap-up/pack.js` (`resolveRecords` rungs (a)/(b), `manifestRecords`' `spec-*` scan; `headerEntries` and `closingRecords` unchanged)
- Test: `tests/bin-lib/wrap-up/pack.test.js`

**Interfaces:**
- Consumes: `listHeaderDirs(runDirs, { readdir: deps.readdir })` from Task 1.
- Produces: a local `flatEntries(deps, runDir)` returning the union of `headerEntries` over the `specDir === null` dirs of `listHeaderDirs([runDir], { readdir: deps.readdir })`, first occurrence of a record winning (its `parkedAtShaping` with it), sorted by record. Rung (a) = `flatEntries(deps, runDir)`, rung (b) = `flatEntries(deps, mirror)`; source names `'headers'`/`'worktree-headers'` unchanged, so `closingRecords` decides `Fixes #N` exactly as for the live fixture. `manifestRecords(deps, dir)` reads its header numbers from the `specDir !== null` dirs of `listHeaderDirs([dir], …)` (every `spec-` name, numeric or not — today's `/^spec-/` filter) instead of its own readdir loop.

- [ ] **Step 1: Write the failing tests**:
  - `AC1.1 resolveRecords: archived-only flat header resolves the same record and source as live` — two fixtures under a real `.claude-tweaks/pipelines/{id}` layout in a tmpdir (header live vs. only at `.../archive/{id}/work/7-spec.md`); assert identical `records`, `source: 'headers'`, and `closingRecords(...)` deep-equal `[7]`. Repeat for the worktree mirror (`source: 'worktree-headers'`).
  - `enumerating merge: live work/8 and archived work/7 resolve [7, 8]` — rung (a) returns both records, `source: 'headers'` (settled row 1).
  - `AC2.1 resolveRecords: archived-only spec-{N} headers resolve through rung (c) like live` — two variants: with `manifest.yml` (kept at the live run dir, settled row 2) listing 9 plus headers only at `archive/{id}/spec-9/work/9-spec.md`, and manifest-free (no `manifest.yml`, headers only at `archive/{id}/spec-9/work/9-spec.md` and `archive/{id}/spec-11/work/11-spec.md`); each asserts the same `records`/`source` as its live-layout twin (`[9]` / `[9, 11]`, `source: 'manifest'`).
  - `AC7.1 a record present at both locations is counted once, the live copy's parked flag wins`.
  - `AC9.4 an unreadable archived header is skipped as absent` (fake `readFile` throws for it; the record does not resolve from it).
- [ ] **Step 2: Run test to verify it fails**
  Run: `node --test tests/bin-lib/wrap-up/pack.test.js`
  Expected: FAIL
- [ ] **Step 3: Implement** the changes above.
- [ ] **Step 4: Run test to verify it passes**
  Run: `node --test tests/bin-lib/wrap-up/pack.test.js tests/bin-lib/wrap-up/pack-cli.test.js tests/wrap-up-pack-conformance.test.js tests/bin-lib/console/resolve.test.js`
  Expected: PASS
- [ ] **Step 5: Commit** `git add plugin/bin/lib/wrap-up/pack.js tests/bin-lib/wrap-up/pack.test.js` and `git commit -m "Resolve archived headers in the wrap-up pack's record ladder (refs #3974)"`

### Task 6: `lib/dispatch/first-call-artifact-check.js`

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/dispatch/first-call-artifact-check.js` (`hasMaterializedHeader`)
- Test: `tests/bin-lib/dispatch/first-call-artifact-check.test.js`

**Interfaces:**
- Consumes: `headerFileCandidates(bases, n)` from Task 1; `headerBases` unchanged.
- Produces: `hasMaterializedHeader(readFile, bases, n)` iterates `headerFileCandidates(bases, n)`; unreadable -> next; `record:` absent or equal to `n` -> `true`; otherwise next. Same signature and export.

- [ ] **Step 1: Write the failing tests**:
  - `AC1.1 hasMaterializedHeader accepts an archived-only flat header` and `AC2.1 … an archived-only spec-{n} header` — fake `readFile` serving only `{main}/.claude-tweaks/pipelines/archive/{id}/work/7-spec.md` (resp. `spec-7/work/7-spec.md`) with `record: 7`, `runDir = {main}/.claude-tweaks/pipelines/{id}`.
  - `AC7.1 live copy wins when both exist`; `AC7.2 live copy naming another record falls through to the archived copy`; `AC7.3 live work/ lacking this record + archived header -> true`.
  - `archived header naming another record does not count` (spec Gotcha: "a header at the archived path whose `record:` line names another number must not count either") -> `false`.
  - `AC9.4 an unreadable archived header is absent` (readFile throws for every candidate) -> `false`.
- [ ] **Step 2: Run test to verify it fails**
  Run: `node --test tests/bin-lib/dispatch/first-call-artifact-check.test.js`
  Expected: FAIL
- [ ] **Step 3: Implement** the loop above.
- [ ] **Step 4: Run test to verify it passes**
  Run: `node --test tests/bin-lib/dispatch/first-call-artifact-check.test.js`
  Expected: PASS
- [ ] **Step 5: Commit** `git add plugin/bin/lib/dispatch/first-call-artifact-check.js tests/bin-lib/dispatch/first-call-artifact-check.test.js` and `git commit -m "Accept archived headers in the dispatch first-call check (refs #3974)"`

### Task 7: `lib/timing/context-gauge.js` `resolveTargetRecords` and the CLI message

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/timing/context-gauge.js` (`resolveTargetRecords`, lines 294-315)
- Modify: `plugin/bin/context-gauge.js` (message at line 242)
- Test: `tests/bin-lib/timing/context-gauge.test.js`

**Interfaces:**
- Consumes: `listHeaderDirs(runDirs, { readdir })` from Task 1.
- Produces: `resolveTargetRecords` keeps its signature, return shape and ordering rules. `roots` is built exactly as today (worktree copy first when contained, then `runDir`). `dirs = listHeaderDirs(roots, { readdir: (d) => fsImpl.readdirSync(d) wrapped to return [] on error })`. Multi-spec branch: spec records = `specN` of every entry with `specN !== null` whose `path.dirname(entry.dir)` has `lstatType(...).type === 'directory'` (today's `numberedEntries` test); manifest ordering unchanged. Single-record branch: root by root (today's order), the union of `numberedEntries(entry.dir, /^([1-9]\d*)-spec\.md$/, 'file', fsImpl)` over that root's `specDir === null` entries (live and archived); the first root with a non-empty union returns `format(union)` (settled row 1: merge within a root, first-non-empty across roots). `manifest.yml` is still read from `runDir` (settled row 2). The CLI message reads `handoff.json not written: no target records (no spec-{N}/ dir and no spec header for ${runDir}${worktree ? ' or its worktree copy' : ''})`.

- [ ] **Step 1: Write the failing tests** in `tests/bin-lib/timing/context-gauge.test.js`:
  - `AC1.1 resolveTargetRecords: archived-only work/ header gives the live answer` — tmp layout `{root}/.claude-tweaks/pipelines/{id}` with no `work/`, header only at `{root}/.claude-tweaks/pipelines/archive/{id}/work/4027-spec.md`; result deep-equals the live-layout result `['#4027']`; repeat with the header archived only under the worktree copy (`worktree`, `gitRoot` set).
  - `AC2.1 resolveTargetRecords: archived-only spec-{N} dirs give the live answer` — only `archive/{id}/spec-945/work/945-spec.md` and `archive/{id}/spec-3817/work/3817-spec.md`; result `['#945', '#3817']` with no manifest, equal to the live-layout twin.
  - `AC7.1 resolveTargetRecords: a record live and archived is listed once` — `#7` at both; result `['#7']`.
  - `enumerating merge: live work/8 and archived work/7 in one root give ['#7', '#8']`; a worktree-copy root with `#5` beside a run-dir root with `#6` still gives `['#5']` (first-non-empty across roots unchanged).
  - `AC9.4 resolveTargetRecords: an unreadable archived base is absent` — fake `fsImpl.readdirSync` throws for the archived base; result equals the no-archive result (`null` with nothing live).
  - `AC8 context-gauge no-target message names no header path` — the CLI's no-targets reason contains `no spec header for` and does not match `/work\/\{?n\}?-spec\.md/`.
- [ ] **Step 2: Run test to verify it fails**
  Run: `node --test tests/bin-lib/timing/context-gauge.test.js`
  Expected: FAIL (archived-only fixtures return `null`; the message still names `work/{n}-spec.md`)
- [ ] **Step 3: Implement** both changes above.
- [ ] **Step 4: Run test to verify it passes**
  Run: `node --test tests/bin-lib/timing/context-gauge.test.js tests/flow-context-handoff-conformance.test.js tests/dispatch-handoff-continuation-conformance.test.js`
  Expected: PASS, with the existing `resolveTargetRecords` tests (lines 530-582) unchanged (AC6.1).
- [ ] **Step 5: Commit** `git add plugin/bin/lib/timing/context-gauge.js plugin/bin/context-gauge.js tests/bin-lib/timing/context-gauge.test.js` and `git commit -m "Resolve archived headers in the context gauge's target records (refs #3974)"`

### Task 8: Conformance scan — one place builds a header path

**Role:** judgment

**Files:**
- Modify: `tests/run-header.test.js` (add the scan)
- Modify: `tests/helpers/strip-comments.js` (header caller list: add `run-header`)
- Modify: `.claude/skills/parse-signal-discipline/SKILL.md` (item 15 caller list: add `run-header`)

**Interfaces:**
- Consumes: `stripComments`, `stripperVerdict`, `STRIPPER_VERDICT_MESSAGES` from `tests/helpers/strip-comments`; `readText` from `tests/helpers/read-skill.js`.
- Produces: two scans over a manual `withFileTypes` walk of `plugin/bin/**/*.js`.
  - **Reader scan** over the eight reader files (`plugin/bin/verify-run-bookends.js`, `plugin/bin/lib/flow/preflight.js`, `plugin/bin/lib/hooks/pre-tool-use.js`, `plugin/bin/lib/pr-bookkeeping/precondition.js`, `plugin/bin/lib/wrap-up/pack.js`, `plugin/bin/lib/dispatch/first-call-artifact-check.js`, `plugin/bin/lib/timing/context-gauge.js`, plus `plugin/bin/context-gauge.js` as the gauge's CLI): comment-stripped (keep-mode) text contains no `'archive'`/`"archive"`/`` `archive` `` literal and no `pipelines/archive`; each of the seven library/CLI readers that resolve headers must also `require` `run-header` (`plugin/bin/context-gauge.js` reads through the lib and is scanned for the literals only; `precondition.js` reads through `hasMaterializeCommit` and is scanned for the literals only).
  - **Builder scan** over every walked file: flag a `path.join(`/`path.resolve(` argument list, or a template literal, whose text holds a `work` path segment (`'work'`, `"work"`, or `work/` / `/work` inside literal text) and `-spec.md`. Allowed by exact per-file count, each with a one-line reason, and nothing else: `plugin/bin/lib/run-header.js` (the resolver), `plugin/bin/lib/reconcile/archive-merged.js` and `plugin/bin/sweep-stray-run-dirs.js` (archive writers). No message-text exemption (Decision, AC8: Tasks 2 and 7 reworded the two messages). `plugin/bin/materialize.js` (the writer) builds its path from `workDir`, which the matcher does not see; name that and the multi-line split shapes (`path.join(dir, name, 'work')` then a separate filename regex — the shape that hid the two extra readers) as recall limits in the header comment.
  - `stripperVerdict` mis-parse is an offender in both scans; floors: files walked `>=` the count at landing, builder sites matched `>=` the count at landing, each assertion message saying a low count means the walk or matcher stopped matching.

- [ ] **Step 1: Run the spec's grep and record it** — `grep -rln "work.*-spec\.md" plugin/bin` (output into the PR body per AC8.3) and classify each hit: reader (one of the eight), writer, archive writer, glob, comment-only. Plan-time classification (16 hits): readers `verify-run-bookends.js`, `lib/flow/preflight.js`, `lib/hooks/pre-tool-use.js`, `lib/wrap-up/pack.js`, `lib/dispatch/first-call-artifact-check.js`, `lib/timing/context-gauge.js`, `context-gauge.js` (message, reworded in Task 7); writer `materialize.js`; archive writers `lib/reconcile/archive-merged.js`, `sweep-stray-run-dirs.js`; glob `lib/issues/blast-radius.js` (`.claude-tweaks/pipelines/**/work/*-spec.md` — `**` already covers `archive/`); comment-only `hooks.js`, `lib/dispatch/ceremony-derive.js`, `lib/hooks/close-run-state.js`, `lib/hooks/sweep-shadow.js`, `lib/hooks/context.js`. A live-code reader outside the eight found at build is migrated onto the resolver in this task when it sits in a Key File, else filed via `/claude-tweaks:capture` as a record blocking #3976 — per the spec's decision rule, never a stop — and named in the PR body.
- [ ] **Step 2: Write the scans and their self-tests** — planted rows asserting exact line numbers: a `path.join('work', \`${n}-spec.md\`)` line (flagged), a template `` `${r}/work/${n}-spec.md` `` (flagged), the same text inside a `//` comment (not flagged), a plain non-template message string (not flagged), the pre-change remedy template `` `… then commit work/${n}-spec.md` `` (flagged — proves the reword was needed), a planted `'archive'` literal in reader-scan input (flagged), and a planted mis-parse (`if (b) /'/.test(b); const c = 'x';`) reported as an offender. Name them `AC8.1 …`/`AC8.2 …`.
- [ ] **Step 3: Run test to verify it passes over the tree, then go red**
  Run: `node --test tests/run-header.test.js`
  Expected: PASS. Then temporarily re-add `const root = '.claude-tweaks/pipelines'; … \`${root}/${base}/work/${issue}-spec.md\`` to a reader copy fed to the matcher (in-test fixture, not the tree) and confirm the builder scan flags it.
- [ ] **Step 4: Run the caller-twin pin**
  Run: `node --test tests/strip-comments-callers-twin.test.js tests/path-guard-conformance.test.js tests/windows-hide-spawn-conformance.test.js`
  Expected: PASS
- [ ] **Step 5: Commit** `git add tests/run-header.test.js tests/helpers/strip-comments.js .claude/skills/parse-signal-discipline/SKILL.md` and `git commit -m "Pin one builder of spec-header paths — run-header conformance scan (refs #3974)"`

## Real-input probe (before the whole-branch review)

Run against real recorded runs on this checkout's `origin/main` (archived headers are tracked there), record the printed values in `decisions.md` via `log-decision.js --step "AC evidence"`, full output to `{PIPELINE_RUN_DIR}/evidence/real-input-probe.txt`:
- `isSpecCommitted({ runDir: '<main>/.claude-tweaks/pipelines/2026-11-13T000404-record-5269', worktree: '<this worktree>', issue: 5269, multiTarget: false })` -> `true` (was `false` before Task 2); independent count: `git cat-file -e HEAD:.claude-tweaks/pipelines/archive/2026-11-13T000404-record-5269/work/5269-spec.md` exits 0.
- `hasMaterializedHeader(fs read, headerBases('<main>/.claude-tweaks/pipelines/2026-11-14T153732-spec-5414-5415', null), 5414)` -> `true`; independent: `ls` of the archived `spec-5414/work/5414-spec.md` on the main checkout.
- `hasMaterializeCommit('<this worktree>', '<main>/.claude-tweaks/pipelines/2026-11-13T000404-record-5269')` -> `false` (record 5269's archived header is inherited from the integration branch — AC4(b) on real data).
- `resolveTargetRecords({ runDir: '<this worktree>/.claude-tweaks/pipelines/2026-11-13T000404-record-5269' })` -> `['#5269']` (the live dir is absent; the archived header answers); independent: `ls` of `<this worktree>/.claude-tweaks/pipelines/archive/2026-11-13T000404-record-5269/work/`.
