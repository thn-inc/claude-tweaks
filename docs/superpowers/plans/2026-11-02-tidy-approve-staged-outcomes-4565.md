# Tidy --approve Staged Outcomes and Forge-Only Archival Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After `/claude-tweaks:tidy --approve` settles a run's staged items, record each item's outcome on disk so the SessionStart notice and `backlog attention` stop counting it, and give a forge-only approval run an archivable terminal state with no manual git step.

**Architecture:** One on-disk representation, read through one helper: an item still awaiting approval is a top-level file in `staged/`; a resolved item's files move into `staged/applied/` or `staged/declined/`. `plugin/bin/lib/stage-item/outcome.js` owns that rule, the per-row outcome derivation, and the move (a plain rename for an untracked file; for a tracked file, `git mv` inside the scratch worktree, so the commit settles it and the main checkout's index is never touched); `plugin/bin/staged-items.js` exposes it to skill prose (`--list`, `--find`, `--settle`); the code readers (`session-residue.js`, the residue `pipeline-runs` probe, `archive-run --local-trail`) call the helper and the prose readers (`tidy/approve-mode.md`, `backlog/attention-mode.md`'s Tidy row) call the CLI. Deliverable 2 takes `archive-run --local-trail` per the record's Trail ruling, not the housekeeping PR: a run's trail lands in git only when its environment disappears afterwards (#4850 owns that case), and the archive path is gitignored, so a local move loses nothing that was ever in git. `audit-untracked` stays the refusal without the flag.

**Tech Stack:** Node 18+ CommonJS, `node --test`, markdown skill prose.

**Spec:** `.claude-tweaks/pipelines/2026-11-02T041625-record-4565/work/4565-spec.md`

Scope keywords: collectApprovableStandalone, hasStagedEntries, audit-untracked, staged/applied, staged/declined, local-trail, trailAdoption

## Global Constraints

- Shipped code lives under `plugin/`; tests under `tests/`. Run single files with `node --test {path}`; never the full suite in a task (Common Step 5 runs it once).
- Path-guard lint (`tests/path-guard-conformance.test.js`): no new `existsSync` or `realpathSync` token in any `plugin/bin/**` file, comments excluded. Use `plugin/bin/lib/path-guard`'s `lstatType(p).type` (`'file'`/`'dir'`/`'missing'`/…). Allowlisted files (`archive-merged.js`, `session-residue.js`, `pipeline-runs.js`, `hooks.js`) keep their exact counts.
- Git calls go through `plugin/bin/lib/hooks/git-exec.js`'s `runGit(args, cwd, { env: repoPinnedEnv() })` (`.failure`, `.stdout`, `.stderr`), the shape `archive-merged.js` lines 42-44 wrap; a non-path-list `ls-files` carries the file's existing `// git-path-read: not a path list (exit code only)` marker. `git mv` retries a held index lock via `plugin/bin/lib/git-retry.js`'s `withIndexLockRetry(runGit)`. A repo-relative path handed to git uses `/` separators (`path.relative(...).split(path.sep).join('/')`).
- `gh` calls go through `execFileSync('gh', args, ghOptions(args, { encoding: 'utf8', timeout: GH_TIMEOUT_MS, windowsHide: true, cwd }))` (`plugin/bin/lib/repo-resolve`'s `ghOptions`, `plugin/bin/lib/shared-primitives`'s `GH_TIMEOUT_MS`), behind an injectable `gh` parameter, the shape `worktree/remote-branch-collision.js` lines 46-48 use.
- CLI shape (from `.claude/skills/gh-api-module-pattern/cli-wrapper-contract.md`): `run(argv, deps)` exported, `if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);` as the entry guard (the exit-code conformance scan reads this guard). A run-dir writer refuses a non-anchored `--run` through `plugin/bin/lib/stage-item/write.js`'s `resolveTarget` with exit **3**. "A CLI that reports a decision as data logs that entry itself; the skill hand-logs it only when the CLI reports the append failed."
- hooks.js new verb (from `.claude/skills/hooks-js-verb-registration/SKILL.md`, "The registration set"): "A verb is not shipped until every row lands in the same change." Row 1 `VERBS`: "One entry, `'{verb}': { usage: '{verb} --run <dir> [...]', run: run{Verb} }`." Row 2 `KNOWN_FLAGS`: "Every `VERBS` verb gets an entry: its declared flags". Row 4 `tests/hooks-help-guard.test.js`: "Add the verb to the `runAccepting` list". Row 6 `docs/plugin-structure.md`'s `plugin/bin/hooks.js` line: "Add the verb to the subcommand list and renumber any ordinal prose". Row 5's anchored-`--run` count covers `resolveRunArg` verbs; `record-trail`, like `adopt-run-dir`, does its own anchored check, so it is the seventeenth in `docs/plugin-structure.md`'s ordinal prose and is not added to `docs/hooks.md`'s fourteen. "Then add a dedicated `tests/hooks-{verb}.test.js` (spawn the CLI, assert stdout, stderr and the exit code separately)". Decision 4: "Flush before returning." Decision 5: "land a spawn test that runs an undeclared flag in both argument orders and asserts the usage stdout, exit 0, and that nothing moved or committed".
- hooks.js flag on an existing verb (from `.claude/skills/hooks-js-verb-registration/SKILL.md`, "Adding a flag to an existing verb"): site 1 "The verb's `usage` string in `VERBS` — Always: append `[--{flag}]`"; site 2 "The handler's option parse — Always: `args.includes('--{flag}')` for a boolean … passed through to the lib call"; site 3 "`KNOWN_FLAGS` — Always: append the flag to the verb's entry. Without it the unknown-flag guard refuses the new flag."; site 5 "The doc that owns the verb's call — Always: the usage line plus one bullet on the flag's semantics" (`archive-run` has no `_shared` home doc; its caller here is `tidy/approve-mode.md`, which carries the bullet); site 6 "A CLI spawn test that the flag reaches the handler, whose negative half runs the same args without the flag and asserts the old reason, not just the exit code … and a pin on the home doc's usage line." Flag decision 1: "Keep the without-flag path safe and byte-for-byte unchanged for existing callers." Flag decision 2: "Refuse bad combinations first."
- Decision-log lines go through `plugin/bin/lib/log-decision/append.js` (`formatEntry` + `appendEntry`), status `AUTO`, reversibility `high`.
- Test names cite acceptance-criterion clause ids (below).

AC clause ids: AC1.1 — forge-only approval → next SessionStart omits the run and `backlog attention`'s tidy row omits it. AC2.1 — the run reaches an archived (or documented terminal) state without a manual git step. AC3.1 — a run with at least one actionable item is still listed by both readers. AC4.1 — an item excluded at the prompt or skipped `stale — skipped` moves to `staged/declined/` with one `decisions.md` line. AC4.2 — neither reader counts it, and `archive-run --local-trail` treats it as resolved. AC5.1 — at least one row applied and none failed resolves `applied`, excluded or stale rows named on the same `decisions.md` line. AC5.2 — every row excluded or stale, in any mix, moves it to `staged/declined/`. AC5.3 — any failed row leaves it actionable in `staged/`.

The record's `## Decisions` bind this plan: Reading B for unapplied items, Reading A for split rows, the local-by-default Trail ruling, Reading A for the Tidy row (Task 2's `--find`, Task 6), Landing trails (Tasks 4, 5), When an item settles (Task 6 Edit 3), Retry route (Task 2's `settledRuns`, Task 6 Edit 1), Tracked items (Task 1), Items with no sidecar (Task 1, Task 6 Edit 2), Tracked item listing Reading B (Task 3's notice, Task 6 Edit 3's report), `--approve` during landing (Task 4's `--landing`, Task 6 Edit 1), Merged but unsynced trail (Task 4 rule 4's hint), Commit order (Task 6 Edits 3, 5), `worktree-always` off (Task 6 Edits 3, 5), PR lookup scope (Task 4's `trailLanding`, Task 5's `record-trail`), Older settled runs (Task 1's `settledRuns`, Task 6 Edit 1).

Decided here (spec silent, no criterion changes):
- An item absent from the settle file stays actionable.
- A partly settled run is not archived: approve-mode archives only when `--settle` reports `actionable: []`. A later `--approve` retries the rest.
- `--approve` commits in two steps so that "a failed commit leaves it actionable" holds: the tidy-up commit first (a failure stops here, nothing settled), then `--settle`, then under `pr-first` `adopt-run-dir`, then a trail commit. A forge-only set with no tracked item has no commit at all and settles right after verification. A set whose only working-tree write is settling a tracked item provisions the scratch worktree for that one trail commit.
- A tracked item is settled in the scratch worktree's index, so the main checkout still lists it top-level until the commit lands and syncs (the record's Tracked item listing ruling, which amends AC1.1 for tracked items). After the sync, `--approve` finds no actionable item and takes the Retry route.
- The trail commit's sha and PR reach `run-state.json` through a new `hooks.js record-trail` call after Step 7.5 has the PR, before `ExitWorktree`. `adopt-run-dir` cannot record them: it runs before the commit exists. An adoption with no recorded sha (the session stopped between commit and `record-trail`) matches any OPEN PR on the recorded branch and no merged one, failing closed on the state a landing trail is in, and never stranding the run on an old merged PR of a reused branch.
- `archive-run --local-trail` refuses a run whose adopted trail's PR is open, and also a merged one whose trail this checkout has not synced yet (`audit-untracked`, with the exact sync command): the merge will deliver tracked copies at the old path, and a local move ahead of it would resurrect the run dir. A closed-unmerged PR does not block: nothing lands.
- `--approve` refuses a landing run in the same three states `--local-trail` does (open, merged and unsynced, or unreadable): each would report the tracked item `stale` and record it as declined. A no-arg `--approve` then walks on to the next actionable run, so a landing run hides none. A merged trail this checkout has synced is `none`: a failed item left in it stays retryable.
- The SessionStart notice reads `trailAdoption.pr` only, with no git or `gh` call and no per-item record (the record's "No pending-record mechanism is added"). Its suffix is a conditional sentence, true whether or not the PR has since merged.
- approve-mode always archives with `--local-trail`. On a never-committed trail it moves locally; on a fully tracked trail the flag changes nothing (the tracked path runs); on a landing trail it refuses by name, and the Retry route finishes later. Non-approve callers (the tidy Archive row, reconcile) stay flag-free.
- A closed run with zero actionable items loses the residue probe's #4138 exemption. A sibling session's tidy Archive row then calls `archive-run` without the flag, which refuses `audit-untracked` on an untracked trail. The hint names `--local-trail` for the never-committed case. No new liveness marker.
- The Retry route on an explicit target closes and archives even when the target has no `staged/` at all: the human named that run, and `close-run` and `archive-run`'s own gates stay in force.

Probed on 2026-11-02:
- `gh pr list --head worktree-dispatch-record-4565 --state all --json number,url,state,isCrossRepository,commits` printed five rows with `state` `OPEN`/`CLOSED`, `isCrossRepository: false`, and each row's `commits[].oid` (#4924: `c8fdeca23…`; #4923: `76e58986c…`, `69d24e615…`). This is the lookup Task 4 uses: the sha filter separates #4924 from the earlier PRs on the same branch name.
- The same command with `--limit 100` fails: `GraphQL: By the time this query traverses to the authors connection, it is requesting up to 1,000,000 possible nodes which exceeds the maximum limit of 500,000.` So Task 4 passes no `--limit` (default 30 rows). A failure of this call is `unknown`, never `none`.
- `gh api repos/{owner}/{repo}/commits/69d24e615/pulls` printed nothing for a commit whose PR #4923 was closed with its branch deleted, so that endpoint is not used.
- `--head ""` matches every PR (`plan-authoring-checks.md`'s Empty-value probe), so a null branch never reaches the lookup.
- Sync command shape, unverified live because it mutates the main checkout: `git -C "{root}" pull --ff-only origin {integration}`. `{integration}` comes from `hooks/worktree-reap.js`'s `bareIntegrationName(resolveIntegrationBranch(root))`, as `reconcile/index.js:217` does, never a literal `main`.

## Review Focus

1. A partially tracked trail (one staged file merged through an earlier PR, one not) under `--local-trail`: a plain move would strand the tracked blob at the old path (#593). Expected: refuse `audit-untracked`. Test in Task 4.
2. An item id that is a prefix of another (`tidy-delete-1` vs `tidy-delete-10`): settling one must not move the other's files. Test in Task 1.
3. Re-running `--settle` for an item already moved (a retry after a partial failure): per-item refusal `not-found`, other items still settled, exit 4, nothing logged for the refused item. Test in Task 2.
4. `adopt-run-dir` after a tracked item was settled in the worktree: the main checkout's copy still sits top-level, so a plain mirror would undo the `git mv`. Expected: the worktree's settled copy wins. Test in Task 5.
5. A `staged/` holding only `applied/` and `declined/` plus a dotfile: zero actionable ids, so both readers omit the run. Test in Tasks 1 and 3.
6. An open PR on the trail's reused branch that does not contain the trail commit: `--local-trail` and `--approve` must not refuse on it. Test in Task 4.
7. `--approve` on a run with a merged trail this checkout has synced, and one failed item left: it proceeds. Test in Task 4.

---

### Task 1: The staged-outcome helper

**Role:** integration
**Review risk:** high

**Files:**
- Create: `plugin/bin/lib/stage-item/outcome.js`
- Test: `tests/bin-lib/stage-item/outcome.test.js`

**Interfaces:**
- Produces:
  - `listActionableStaged(runDir: string) -> string[]` — sorted unique item ids: each top-level regular file (`withFileTypes`, `isFile()`) of `{runDir}/staged/` not starting with `.`; the id is the file stem `path.basename(name, path.extname(name))`, with or without a `.json` sidecar. Subdirectories are never items. Missing `staged/` or any read error → `[]`.
  - `listResolvedStaged(runDir, outcome: 'applied'|'declined') -> string[]` — same rule over `staged/{outcome}/`.
  - `listTrackedStaged(runDir) -> string[]` — the actionable ids with at least one file `git ls-files -z -- {staged/}` lists at `mainCheckoutRoot(runDir)`. No main root → `[]`. A failed git call → every actionable id (a needless worktree costs less than a refused settle).
  - `findStandaloneRuns(root) -> { actionableRuns: { run: string, actionable: string[] }[], settledRuns: string[] }` — top-level `{root}/.claude-tweaks/pipelines/` directories matching `/-(tidy|sweep)-standalone/`, basename-sorted newest first. `actionableRuns`: every one with actionable ids, with those ids. `settledRuns`: every one with no actionable id and at least one resolved id. `archive/` is never scanned.
  - `itemOutcome(rows: {row: string, outcome: 'applied'|'excluded'|'stale'|'failed'}[]) -> 'applied'|'declined'|'actionable'` — any `failed` → `actionable`; else any `applied` → `applied`; else `declined`. Throws `TypeError` on an empty array or an unknown row outcome.
  - `resolveStagedItem({ runDir, id, outcome: 'applied'|'declined', worktree?: string }) -> { ok: true, moved: string[], pendingCommit: boolean } | { ok: false, reason: 'not-found'|'destination-exists'|'tracked-needs-worktree'|'move-failed', detail?: string }` — `moved` holds sorted names relative to `staged/` (`applied/tidy-delete-1.md`). Matches files whose stem equals `id` exactly and moves whichever exist. Checks every destination with `lstatType` before moving (any `type` other than `'missing'` → `destination-exists`, nothing moved). Per file: tracked at the main root (`git ls-files --error-unmatch` exits 0) → with no `worktree`, `tracked-needs-worktree` before anything moves; with one, `mkdirSync(staged/{outcome})` under the worktree's copy and `git mv` run with the worktree as cwd on the repo-relative paths, the main checkout untouched, `pendingCommit: true`. Untracked → `mkdirSync` then `fs.renameSync` in `runDir`. A failure after an earlier move moves the earlier ones back the same way, and returns `move-failed` with the message. Throws `TypeError` for an `outcome` outside the two.

- [ ] **Step 1: Write the failing tests** in `tests/bin-lib/stage-item/outcome.test.js`, each in a fresh `fs.mkdtempSync` dir, staging with the real writers (`writeStagedItem` + `writeStagedSidecar` from `plugin/bin/lib/stage-item/write.js`):
  - `AC3.1: listActionableStaged returns each staged item id once` — stage `tidy-delete-1` and `digest-promotion-2` (.md + .json) → `['digest-promotion-2', 'tidy-delete-1']`.
  - `AC4.2: resolved items and dotfiles are not actionable` — resolve one to `applied`, one to `declined`, add `staged/.DS_Store` → actionable `[]`, `listResolvedStaged` returns each id.
  - `resolveStagedItem moves every file of the id and only that id` — `tidy-delete-1` and `tidy-delete-10`; `moved` deep-equals `['applied/tidy-delete-1.json', 'applied/tidy-delete-1.md']`; `tidy-delete-10.*` stay top-level.
  - `an item with no sidecar has its stem as id and settles` — only `staged/a.patch` → id `a`; `moved` deep-equals `['declined/a.patch']`.
  - `resolveStagedItem refuses not-found and destination-exists without moving`.
  - `listActionableStaged on a missing staged/ is empty`.
  - `resolveStagedItem rejects an unknown outcome` — `TypeError` for `'skipped'`.
  - `AC5.1: one applied row with excluded and stale rows resolves applied` — `itemOutcome` → `'applied'`.
  - `AC5.2: excluded and stale in any mix resolves declined` — `[excluded, stale]`, `[stale, stale]`, `[excluded]` → `'declined'`.
  - `AC5.3: any failed row leaves the item actionable` — `[applied, failed]`, `[excluded, failed]` → `'actionable'`.
  - `itemOutcome rejects empty rows and an unknown outcome`.
  - `a tracked item with no worktree is refused and nothing moves` — `git init` fixture under `{root}/.claude-tweaks/pipelines/2026-11-02T120000-tidy-standalone/`, commit `staged/tidy-delete-1.md`, leave `tidy-delete-1.json` untracked → `tracked-needs-worktree`, both files top-level, `git status --porcelain` shows only the untracked sidecar. `listTrackedStaged` → `['tidy-delete-1']`.
  - `a tracked item settles in the worktree's index and leaves the main checkout clean` — same fixture plus `git worktree add`; resolve with `worktree` → `pendingCommit: true`; worktree `git status --porcelain` shows one `R ` entry; main `git status --porcelain` shows the moved sidecar only (no `R `, no ` D`), main's `staged/tidy-delete-1.md` still exists. Deleting the tracked branch of the mover turns this red (test comment says so).
  - `findStandaloneRuns walks back past a settled newer run` — newer `…-sweep-standalone` with only `staged/applied/x.md`, older `…-tidy-standalone` with `staged/y.md`, plus a `…-record-1` dir with `staged/z.md` and `archive/…-tidy-standalone/staged/q.md` → `actionableRuns` deep-equals `[{ run: {older dir}, actionable: ['y'] }]`, `settledRuns` deep-equals `[{newer dir}]`. Fails if selection stops at the newest.
  - `Older settled runs: findStandaloneRuns lists every settled run newest first` — two settled runs and one actionable run older than both → `settledRuns` holds both in order. Fails if only the newest settled run is returned.

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/bin-lib/stage-item/outcome.test.js`
Expected: FAIL with `Cannot find module '../../../plugin/bin/lib/stage-item/outcome'`

- [ ] **Step 3: Implement `plugin/bin/lib/stage-item/outcome.js`** per the Interfaces block. Header comment: the representation rule, #4565, the row rule, the tracked-item rule, and the reader roster (session-residue.js, residue/probes/pipeline-runs.js, archive-merged.js `--local-trail`, staged-items.js).

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/bin-lib/stage-item/outcome.test.js`
Expected: PASS

- [ ] **Step 5: Real-input probe.** Copy `"/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines/archive/2026-10-28T172007-sweep-standalone"` to a scratchpad dir (`cp -R`), run `listActionableStaged` on the copy, and independently count its `staged/*.json` files. Expected: 5 ids (`digest-promotion-1` … `-4`, `tidy-delete-1`) and the independent count 5. Record both in the task report.

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/lib/stage-item/outcome.js tests/bin-lib/stage-item/outcome.test.js
git commit -m "Add staged-outcome helper — one actionable/applied/declined rule for staged/ (refs #4565)"
```

### Task 2: `staged-items.js` CLI

**Role:** integration
**Review risk:** high

**Files:**
- Create: `plugin/bin/staged-items.js`
- Modify: `docs/plugin-structure.md` (the `plugin/bin/lib/stage-item/` line: add `outcome.js`; one CLI line beside the `stage-item.js` line)
- Test: `tests/bin-lib/stage-item/staged-items-cli.test.js`

**Interfaces:**
- Consumes: Task 1's exports; `resolveTarget`, `sanitizeId` from `stage-item/write.js`; `formatEntry`, `appendEntry` from `log-decision/append.js`; `wtDetect.repoInfo`, `wtDetect.mainCheckoutRoot` from `hooks/worktree-detect.js`.
- Produces (the command lines Task 6's prose uses verbatim):
  - `node plugin/bin/staged-items.js --run <run-dir> --list` → one JSON line `{"actionable":[…],"applied":[…],"declined":[…],"tracked":[…]}`, exit 0.
  - `node plugin/bin/staged-items.js --find` → one JSON line, Task 1's `findStandaloneRuns` over `mainCheckoutRoot(cwd)`, exit 0. No determinable main root → exit 3.
  - `node plugin/bin/staged-items.js --run <run-dir> --settle --rows-file <path> [--worktree <path>]` — the file is `{ "<id>": [ { "row": "<label>", "outcome": "applied|excluded|stale|failed" } ] }`. Whole file validated first; each item then derives `itemOutcome`, moves (unless `actionable`), and appends one `decisions.md` line. Prints one JSON line `{"results":[{"id":…,"outcome":…,"moved":[…],"pendingCommit":bool,"logged":true|false,"reason"?:…}],"actionable":[…]}`, where `actionable` is `listActionableStaged` after the pass.
  - Exit codes: 0 done; 2 malformed invocation (not exactly one of `--list`/`--find`/`--settle`; `--list` or `--settle` without `--run`; `--settle` without `--rows-file`; `--worktree` without `--settle`; unreadable or malformed file: non-object top level, empty rows, blank `row`, unknown outcome, an id `sanitizeId` rejects; an unknown flag; a value flag given last), nothing moved; 3 run dir missing or not anchored, or `--worktree` not a linked worktree of the run dir's repo; 4 at least one item refused by `resolveStagedItem` (`results[i].reason`, stderr `staged-items.js: refused ({reason}): {id}`), the other items still settled and stdout still printed. A failed `appendEntry` after a move is `logged: false` plus a stderr line, exit 0.
  - Log line: `formatEntry({ status: 'AUTO', now, step: 'tidy --approve', text, reversibility: 'high' })` under section `'/tidy'`. A row label has whitespace runs collapsed to one space. `{notes}` is the item's excluded and stale rows joined by `, `, each `{label} (excluded at the approval prompt)` or `{label} (stale — skipped by re-verify)`. `text`: `staged item {id} applied → staged/applied/` plus `; not applied: {notes}` when any; `staged item {id} declined → staged/declined/: {notes}`; `staged item {id} left actionable in staged/: {failed labels joined by ", "} failed`.

- [ ] **Step 1: Write the failing tests**, spawning the real CLI against a `git init` main-checkout fixture with the run dir at `{root}/.claude-tweaks/pipelines/2026-11-02T120000-tidy-standalone/` (staged via the real writers), plus `run(argv, deps)` for the log-failure case:
  - `--list prints actionable, applied, declined and tracked ids` — exact JSON.
  - `--find prints every actionable run and every settled run, newest first` — exact JSON, run from a linked worktree of the fixture, so a shadow cwd still reads the anchored dirs.
  - `AC4.1: an excluded item moves to declined with one decisions.md line` — exit 0; files under `staged/declined/`; exactly one line matching `/AUTO .* — tidy --approve: staged item tidy-delete-1 declined → staged\/declined\/: r1 \(excluded at the approval prompt\)\. Reversibility: high\./`.
  - `AC4.1: a stale item logs the stale-skipped wording` — `/r1 \(stale — skipped by re-verify\)/`.
  - `AC5.1: a split item resolves applied and names its other rows on one line` — rows applied/excluded/stale → `staged/applied/`, one line containing `not applied: r2 (excluded at the approval prompt), r3 (stale — skipped by re-verify)`.
  - `AC5.2: an excluded-and-stale item moves to declined on one line`.
  - `AC5.3: a failed row leaves the item in staged/` — files top-level; JSON `outcome: 'actionable'`, `actionable` contains the id; one `left actionable` line naming `r2 failed`.
  - `an item absent from the settle file stays actionable`.
  - `re-settling an already-moved item exits 4 not-found, settles the others, logs nothing for it` — stderr `/refused \(not-found\): tidy-delete-1/`, the other item moved, `decisions.md` gains one line.
  - `a tracked item without --worktree exits 4 tracked-needs-worktree, logging nothing for it`; with a linked `--worktree`: exit 0, `pendingCommit: true`, and `actionable` still names the id because the main checkout's copy is unmoved.
  - `usage and malformed files exit 2, nothing moved` — one assertion each: no `--run` with `--list`; `--list --find`; `--list --settle --rows-file f`; `--settle` alone; `--bogus`; `--rows-file` last; `--list --worktree w`; rows `{"x":[]}`; `{"../x":[…]}`; outcome `skipped`; a non-JSON file.
  - `a worktree-local shadow run dir exits 3 and leaves the shadow byte-unchanged` — linked worktree fixture; `--settle` against the shadow path.
  - `a --worktree that is the main checkout or a foreign repo exits 3, nothing moved`.
  - `a failed decisions.md append reports logged:false and still exits 0` — `run(argv, { ...realDeps, appendEntry: () => { throw new Error('disk full'); } })`.

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/bin-lib/stage-item/staged-items-cli.test.js`
Expected: FAIL (CLI file absent)

- [ ] **Step 3: Implement `plugin/bin/staged-items.js`** with `parseArgs(argv)` (render-tidy-report.js's `next()` shape, rejecting an `undefined` value), `realDeps = { resolveTarget, listActionableStaged, listResolvedStaged, listTrackedStaged, findStandaloneRuns, resolveStagedItem, appendEntry, readFile, cwd, now: () => new Date(), stdout, stderr }`, and the exit codes above. The `--worktree` check mirrors `runAdoptRunDir`'s (`hooks.js` lines 898-906). Header comment documents usage, every exit code, the `logged: false` contract, and that `--list` still refuses an unanchored `--run` so a worktree shadow never yields a confident wrong count. Then add the two `docs/plugin-structure.md` entries.

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/bin-lib/stage-item/staged-items-cli.test.js tests/path-guard-conformance.test.js tests/bin-lib/exit-code-conformance.test.js tests/windows-hide-spawn-conformance.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/staged-items.js tests/bin-lib/stage-item/staged-items-cli.test.js docs/plugin-structure.md
git commit -m "Add staged-items.js — list, find and settle a run's staged items (refs #4565)"
```

### Task 3: Both code readers count only actionable items

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/hooks/session-residue.js:111-129` (`collectApprovableStandalone`: replace the `readdirSync` + `staged.length` test with `listActionableStaged(dir).length === 0 → continue`; comment reads "still carry actionable `staged/` proposals"; destructure `{ dir, state }` from the iterator and, when `state.trailAdoption.pr` is set, append to the line ` (trail adopted for PR #{number}, {url}: a tracked item stays listed until that PR merges and syncs)`; no git or `gh` call)
- Modify: `plugin/bin/lib/residue/probes/pipeline-runs.js` (lines 62-70 and 104-112: delete `hasStagedEntries`; the #4138 exemption calls `listActionableStaged(dir).length > 0`; comment reads "still holds actionable staged items")
- Test: `tests/bin-lib/hooks/session-residue.test.js`
- Test: `tests/bin-lib/residue/probes-pipeline-runs.test.js`
- No change (checked): `plugin/bin/lib/hooks/session-start.js` and `hooks.js:1536` only print `collectApprovableStandalone`'s lines.

**Interfaces:**
- Consumes: Task 1's `listActionableStaged`, `resolveStagedItem`.

Consumer classification for the other `staged/` readers, from `git grep -n -E "readdirSync\(.*staged|'staged'\)" -- plugin/bin` (no change, recorded so review can check it): `render-tidy-report/render.js` reads only top-level `*.json` (`isFile()`), so resolved items drop out by construction; `reconcile/archive-merged.js`'s `listStagedItems` serves only the console-less auto-merge guard, which a tidy/sweep standalone run never trips (no auto-merge line in its `decisions.md`); `hooks/staged-inventory.js` checks pipeline runs' `STAGED` lines on `/flow` resume and never reads a tidy/sweep standalone run; `stage-item/write.js`'s `listExistingNumbers` only reads `{kind}-{digits}` names at the top level; `hooks/context.js:131`'s best-effort `rmdir` no-ops on a dir holding `applied/`; `console/reflect-apply.js`, `console/residue.js` and `console/resolve.js` serve console runs, which tidy/sweep standalone runs do not render; `sweep-shadow.js` and `shadow-dup-proposal.js` read shadow copies, not settled items; `check-staged-stack.js` orders `.patch` proposals of pipeline runs. `hooks.js:668` is Task 5's.

- [ ] **Step 1: Write the failing tests.** In `session-residue.test.js`, using the file's `tmpProject`/`mkRun` helpers, staging through `writeStagedItem` and resolving through `resolveStagedItem`:
  - `AC1.1: a clean sweep-standalone run whose every staged item was applied or declined is not listed` → `[]`.
  - `AC3.1: a run with one actionable item beside resolved ones is still listed` → one entry whose `line` contains `tidy --approve`.
  - `AC4.2: a run whose only items are declined is not listed`.
  - `Tracked item listing: a listed run with a recorded landing PR names it` — state `trailAdoption: { branch: 'b', sha: 'x', pr: { number: 42, url: 'https://example.test/pull/42' }, at: 'now' }` → the `line` contains `PR #42` and the url; the same run with no `trailAdoption` has a `line` byte-identical to today's. Deleting the suffix turns the first half red.
  In `probes-pipeline-runs.test.js` (follow the existing #4138 fixture):
  - `AC4.2: a clean tidy-standalone run with only applied/declined items is no longer exempt` → in `findings`.
  - `AC3.1: one actionable item keeps the #4138 exemption` → not in `findings`.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/bin-lib/hooks/session-residue.test.js tests/bin-lib/residue/probes-pipeline-runs.test.js`
Expected: FAIL after Step 1 — the AC1.1/AC4.2 cases list or exempt the run (an `applied/` subdirectory is a `readdirSync` entry).

- [ ] **Step 3: Implement** the two replacements named in Files.

- [ ] **Step 4: Run to verify they pass**

Run: `node --test tests/bin-lib/hooks/session-residue.test.js tests/bin-lib/residue/probes-pipeline-runs.test.js tests/path-guard-conformance.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/hooks/session-residue.js plugin/bin/lib/residue/probes/pipeline-runs.js tests/bin-lib/hooks/session-residue.test.js tests/bin-lib/residue/probes-pipeline-runs.test.js
git commit -m "Count only actionable staged items in the SessionStart notice and residue probe (refs #4565)"
```

### Task 4: `archive-run --local-trail`

**Role:** integration
**Review risk:** high

**Files:**
- Create: `plugin/bin/lib/reconcile/trail-landing.js`
- Modify: `plugin/bin/lib/reconcile/archive-merged.js` — `archiveRunDir(root, runDir, { localTrail = false, trailLanding = defaultTrailLanding } = {})` (line 1260) and the standalone audit block (lines 1438-1467)
- Modify: `plugin/bin/hooks.js` — `VERBS['archive-run'].usage` (line 131) → `'archive-run [--run <dir>] [--local-trail]'`; `KNOWN_FLAGS['archive-run']` (line 171) → `['--run', '--local-trail']`; `runArchiveRun` (line 1254, call at line 1384): parse `argv.slice(3).includes('--local-trail')`, pass `archiveRunDir(mainRoot, runDir, { localTrail })`
- Modify: `plugin/bin/staged-items.js` — add `--landing`
- Test: `tests/bin-lib/reconcile/trail-landing.test.js`
- Test: `tests/bin-lib/reconcile/archive-merged.test.js`
- Test: `tests/archive-run-verb.test.js`
- Test: `tests/bin-lib/stage-item/staged-items-cli.test.js`

**Interfaces:**
- Consumes: Task 1's `listActionableStaged`; Task 5's `run-state.json` field `trailAdoption: { branch: string|null, sha: string|null, pr: { number, url }|null, at: string }` (Task 5 writes it; here it is only read, via `readRunState`).
- Produces:
  - `trailLanding(state, { root, runDir, gh = defaultGh }) -> { status: 'none' } | { status: 'open'|'merged', pr: { number, url } } | { status: 'unknown', detail: string }`. No `state.trailAdoption` → `none`, with no `gh` call. `branch` null or empty → `unknown`, with no `gh` call. Otherwise `gh pr list --head {branch} --state all --json number,url,state,isCrossRepository,commits` with no `--limit` (Probed above), cwd `root`; cross-repository rows ignored. With `sha` set, only rows whose `commits[].oid` includes `sha` count (the record's PR lookup scope ruling); a row with no `commits` array makes the result `unknown`. Any counted `OPEN` → `open`; else any counted `MERGED` → `merged`; else `none`. With `sha` null: any `OPEN` → `open`; else `none`, merged rows ignored ("Decided here"). `merged` with `{runDir}/decisions.md` tracked at `root` (`git ls-files --error-unmatch`, exit 0) is reported as `none`: the trail is synced here. A `gh` throw or unparseable output → `unknown`.
  - `syncCommand(root) -> string` — `git -C "{root}" pull --ff-only origin {integration}`, `{integration}` per "Probed".
  - `archiveRunDir(root, runDir, { localTrail, trailLanding })`; refusals `local-trail-not-standalone`, `local-trail-actionable` (`{ actionable: string[], hint }`), `local-trail-landing` (`{ pr, hint }`), `local-trail-landing-unknown` (`{ hint }`). Every existing caller passes no third argument and is unchanged.
  - `node plugin/bin/staged-items.js --run <run-dir> --landing` → one JSON line, `trailLanding`'s result over the run's `run-state.json`, plus `syncCommand` on `merged`; exit 0. It joins `--list`/`--find`/`--settle` in Task 2's exactly-one rule and exit-code table; `--run` is required (exit 2); an unanchored run dir exits 3.

Behaviour, rules 1-3 run first, before the `archiveDirPreexisted` capture and the `archiving` marker, only when `localTrail` is true:
1. A run id not matching `/-(tidy|sweep)-standalone/` → `local-trail-not-standalone`.
2. `listActionableStaged(runDir)` non-empty → `local-trail-actionable`, hint `staged item(s) still awaiting approval: {ids} — run /claude-tweaks:tidy --approve "{runDir}" first`.
3. `trailLanding(readRunState(runDir), { root, runDir })`: `open` → `local-trail-landing`, hint `this trail was adopted for PR #{number} ({url}), still open — merge or close it, then re-run`; `unknown` → `local-trail-landing-unknown`, hint naming the detail and `re-run once the PR state can be read`. `merged` is kept for rule 4.
4. In the audit block, with `untrackedAuditFiles` non-empty: `localTrail` false → the unchanged `audit-untracked`. `localTrail` true and rule 3 said `merged` → `audit-untracked` whose hint leads with `this trail merged through PR #{number} — sync this checkout, then re-run: {syncCommand(root)}` (the record's Merged but unsynced ruling). `localTrail` true and `git ls-files -z -- {decisions.md} {report.md} {staged}` prints anything or fails → the same `audit-untracked` with today's hint (a partly committed trail: moving it by hand strands the tracked blob, #593; fail closed). Otherwise skip the refusal: those entries were never pushed to `workMoves`, so the top-level move loop moves them with `moveArchiveEntry`; with no `work/`, no git command runs and no commit is made.
5. `untrackedAuditFiles` empty (a fully tracked trail, settled items included): the existing tracked path, flag or no flag.

Append to the `audit-untracked` hint: ` If this trail was never committed by design (a tidy --approve run whose approved set made no commit), re-run with --local-trail.` — keep the existing sentence so `/sync this checkout with origin/` still matches. Register the new reasons wherever `archive-merged.js`'s reason roster requires them (the `refusal()` constructor's hints, lines ~240-255).

- [ ] **Step 1: Write the failing tests.** `trail-landing.test.js`, with a fake `gh` counting calls:
  - `no trailAdoption is none, without calling gh`.
  - `a null or empty branch is unknown, without calling gh` — deleting that guard makes the fake `gh` be called and this test red.
  - `an OPEN row containing the sha wins over CLOSED and MERGED rows` → `open`, with its `pr`.
  - `PR lookup scope: an OPEN row without the trail commit is not this trail` → `none`, and a MERGED row without it → `none`. Deleting the sha filter turns both red.
  - `a cross-repository OPEN row is ignored` → `none`.
  - `only MERGED and CLOSED rows are merged; only CLOSED rows are none`.
  - `a merged trail tracked at root is none: it is synced` — `git init` fixture with `decisions.md` committed at the run dir, one MERGED row with the sha → `none`; the same with it untracked → `merged`. Deleting the tracked check turns the first red.
  - `a null sha matches any OPEN row and no merged one` — OPEN row with other commits → `open`; only MERGED rows → `none`.
  - `a row with no commits array is unknown when a sha is set`.
  - `a gh throw and unparseable output are both unknown`.
  - `syncCommand names the resolved integration branch` — a fixture whose integration branch is `trunk` → contains `origin trunk`, not `main`.
  In `archive-merged.test.js` (reuse `makeRepo`, `commitPath`, `trackedFiles`; seed `{status:'active'}` then the real writer `closeRunState(runDir)` from `plugin/bin/lib/hooks/close-run-state.js`; inject `trailLanding` except where noted):
  - `AC2.1: localTrail archives an untracked forge-only trail whose items are all resolved` — untracked `decisions.md`, `report.md`, `staged/applied/tidy-delete-1.md` → `ok: true`; run dir gone; both archived paths exist; `git log --oneline` count unchanged.
  - `AC4.2: localTrail treats declined items as resolved` — only `staged/declined/…` → `ok: true`.
  - `AC3.1: localTrail refuses local-trail-actionable while an item is actionable` — top-level `staged/tidy-delete-2.md` → reason, `actionable` deep-equals `['tidy-delete-2']`, file still at the run dir, no archive twin. Deleting rule 2 turns this red.
  - `localTrail refuses local-trail-landing while the adopted trail's PR is open, naming it` — `writeRunState(runDir, { trailAdoption: { branch: 'x', at: 'now' } })` and an injected `open` (Task 5's test covers the real writer) → reason, hint contains `#42`, nothing moved, no archive twin. Deleting rule 3 turns this red.
  - `localTrail refuses local-trail-landing-unknown when the PR lookup fails` — injected `unknown`.
  - `Merged but unsynced trail: localTrail refuses audit-untracked and prints the sync command` — injected `merged` with `pr.number` 42, all-untracked trail → reason `audit-untracked`, hint contains `PR #42` and `pull --ff-only origin`. Deleting the `merged` half of rule 4 turns this red.
  - `localTrail with a closed-unmerged attempt archives` — injected `none`, `trailAdoption` present → `ok: true`.
  - `localTrail still refuses audit-untracked for a partially tracked staged/` — `commitPath` one `staged/applied/a.md`, leave `staged/applied/b.md` and `decisions.md` untracked; `decisions.md` keeps `untrackedAuditFiles` non-empty, so only the `git ls-files` half of rule 4 decides. Deleting it turns this red.
  - `localTrail refuses local-trail-not-standalone on a record run`.
  - `AC2.1: a fully tracked trail whose item settled through a commit archives through its tracked path` — commit `decisions.md`, `report.md`, `staged/applied/tidy-delete-1.md` in a sweep-standalone run, `archiveRunDir(root, runDir, { localTrail: true, trailLanding: () => ({ status: 'none' }) })` → `ok: true`; `trackedFiles` lists `archive/{runId}/staged/applied/tidy-delete-1.md` and nothing under the live run dir.
  - `without localTrail the forge-only trail still refuses audit-untracked, and the hint names --local-trail` — `hint` matches `/--local-trail/` and `/sync this checkout with origin/`.
  In `archive-run-verb.test.js` (spawn, mirroring the existing sweep-standalone audit-untracked test; no fixture carries `trailAdoption`, so no `gh` runs):
  - `AC2.1: archive-run --local-trail archives a closed forge-only sweep-standalone run` — stdout `/claude-tweaks: archived 2026-08-14T120000-sweep-standalone/`; the same args without the flag on a twin fixture → `/archival refused — audit-untracked/`.
  - `archive-run --local-trail with an actionable item prints local-trail-actionable` — `/archival refused — local-trail-actionable — staged item\(s\) still awaiting approval: tidy-delete-2/`.
  - `archive-run --local-trial is refused with the usage line and moves nothing` — stdout `claude-tweaks: usage: archive-run [--run <dir>] [--local-trail]`.
  In `staged-items-cli.test.js` (`run(argv, deps)` with an injected `trailLanding`):
  - `--approve during landing: --landing prints open with the PR` — exact JSON.
  - `--landing on merged prints the sync command` — JSON holds `syncCommand`.
  - `--landing without --run exits 2; an unanchored --run exits 3`.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/bin-lib/reconcile/trail-landing.test.js tests/bin-lib/reconcile/archive-merged.test.js tests/archive-run-verb.test.js tests/bin-lib/stage-item/staged-items-cli.test.js`
Expected: FAIL after Step 1 — `trail-landing` module absent; the new cases get `audit-untracked` or the usage refusal.

- [ ] **Step 3: Implement** `trail-landing.js`, rules 1-5, the hooks.js changes, and `--landing`.

- [ ] **Step 4: Run to verify they pass**

Run: `node --test tests/bin-lib/reconcile/trail-landing.test.js tests/bin-lib/reconcile/archive-merged.test.js tests/archive-run-verb.test.js tests/bin-lib/stage-item/staged-items-cli.test.js tests/hooks-help-guard.test.js tests/hooks-js-flag-strict.test.js tests/hooks-dispatcher.test.js tests/path-guard-conformance.test.js tests/windows-hide-spawn-conformance.test.js tests/reconcile.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/reconcile/trail-landing.js plugin/bin/lib/reconcile/archive-merged.js plugin/bin/hooks.js plugin/bin/staged-items.js tests/bin-lib/reconcile/trail-landing.test.js tests/bin-lib/reconcile/archive-merged.test.js tests/archive-run-verb.test.js tests/bin-lib/stage-item/staged-items-cli.test.js
git commit -m "Add archive-run --local-trail — archive a never-committed tidy trail once nothing is actionable or landing (refs #4565)"
```

### Task 5: `adopt-run-dir` mirrors `staged/`; `record-trail` stamps the commit and PR

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/hooks.js` — `copyRunDirAuditFiles` (lines 650-675), `runAdoptRunDir` (after line 913's copy report), and a new `record-trail` verb (`VERBS` beside `adopt-run-dir`, line 123; `KNOWN_FLAGS` beside line 191; `runRecordTrail`)
- Modify: `docs/plugin-structure.md` — the `plugin/bin/hooks.js` line: add `record-trail` to the subcommand list and one sentence after adopt-run-dir's "sixteenth"
- Modify: `tests/hooks-help-guard.test.js` — add `record-trail` to `runAccepting` (line 80)
- Test: `tests/hooks-adopt-run-dir.test.js`
- Test: `tests/hooks-record-trail.test.js`
- Test: `tests/bin-lib/reconcile/archive-merged.test.js` — one real-writer case
- Test: `tests/bin-lib/hooks/session-residue.test.js` — one real-writer case

**Interfaces:**
- Produces:
  - `run-state.json`'s `trailAdoption: { branch: string|null, sha: string|null, pr: { number, url }|null, at: string }`, read by Task 4's `trailLanding` and Task 3's notice. `adopt-run-dir` writes `branch` (`git branch --show-current` run in `--worktree`, null when empty or failed), `sha: null`, `pr: null`, `at`. Its stdout is unchanged.
  - `node plugin/bin/hooks.js record-trail --run <main-checkout-run-dir> --worktree <worktree-path> <pr-number> <pr-url>` — the same anchored `--run` and linked-`--worktree` checks as `adopt-run-dir` (refusal: stderr line, exit 3). Reads `git rev-parse HEAD` in `--worktree`, sets `trailAdoption.sha` and `trailAdoption.pr` keeping the other fields, prints `claude-tweaks: trail recorded for {run-id}`, exit 0. Exit 3 with no change: no `trailAdoption` to update, a failed `rev-parse`, a failed `writeRunState`, or a non-integer `<pr-number>`; exit 2 on missing arguments. Task 6's Step 7.5 edit is the only caller.

`copyRunDirAuditFiles`' `staged/` step, replacing the plain `cpSync`: (a) `settled` = the names under the destination's `staged/applied/` and `staged/declined/`. (b) Remove each top-level destination `staged/` file whose name is absent from the source's top level (an item moved in the main checkout must not survive at its old worktree path, #4565). (c) `fs.cpSync` with a `filter` skipping a top-level source file whose name is in `settled` (a tracked item settled in the worktree stays settled, though the main checkout's copy is still top-level until the commit lands). Comment says so. `runAdoptRunDir`: after a non-empty copy, `ctxLib.writeRunState(runDir, { trailAdoption: { branch, sha: null, pr: null, at: new Date().toISOString() } })`; a falsy result prints `claude-tweaks: adopt-run-dir: could not record the adoption in run-state.json` to stderr and returns 3, since an unrecorded adoption would let `--local-trail` move a landing trail. A `nothing to copy` adoption records nothing.

- [ ] **Step 1: Write the failing tests** in `tests/hooks-adopt-run-dir.test.js`:
  - `adopt-run-dir mirrors staged/: a file gone from the source is gone from the worktree copy, a nested applied/ item is copied` — pre-create `staged/tidy-delete-1.md` in the worktree copy; source holds only `staged/applied/tidy-delete-1.md`; after the verb, the worktree's old path is absent and the nested one present.
  - `adopt-run-dir keeps an item settled in the worktree` — the worktree holds `staged/applied/tidy-delete-1.md`; source holds top-level `staged/tidy-delete-1.md` and `staged/other.md` → the worktree has no top-level `tidy-delete-1.md`, has `applied/tidy-delete-1.md` and `other.md`. Deleting the `filter` turns this red.
  - `adopt-run-dir records the worktree's branch in run-state.json` — `trailAdoption.branch` equals the fixture worktree's branch; `at` parses as a date.
  - `a nothing-to-copy adoption records no trailAdoption`.
  - `a detached worktree records a null branch` — `git checkout --detach` in the worktree.
  In `tests/hooks-record-trail.test.js` (spawn; a real `adopt-run-dir` first):
  - `record-trail stamps the worktree HEAD and the PR, keeping branch and at` — stdout, exit 0, `trailAdoption.sha` equals the fixture worktree's `git rev-parse HEAD`.
  - `record-trail with no adoption exits 3 and writes nothing`.
  - `record-trail refuses a worktree-local shadow --run and a non-linked --worktree with exit 3`.
  - `record-trail with a non-integer PR number exits 3, and with a missing PR argument exits 2`.
  - `record-trail refuses an undeclared flag in both argument orders` — usage stdout, exit 0, `run-state.json` byte-unchanged.
  In `tests/bin-lib/reconcile/archive-merged.test.js`:
  - `Landing trails: a real adopt-run-dir and record-trail stamp blocks --local-trail while its PR is open` — spawn both verbs against a real linked-worktree fixture, close the run with `closeRunState`, then `archiveRunDir` with `localTrail: true` and a `trailLanding` wrapping Task 4's real function with a fake `gh` returning one `OPEN` row for exactly the recorded branch whose `commits` hold the recorded sha → `local-trail-landing`; a `gh` returning `[]` → `ok: true`.
  In `tests/bin-lib/hooks/session-residue.test.js`:
  - `Tracked item listing: the notice names the PR a real record-trail wrote` — spawn both verbs against a linked-worktree fixture with an actionable item, close with `closeRunState`, `collectApprovableStandalone` → `line` contains `PR #{number}`.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/hooks-adopt-run-dir.test.js tests/hooks-record-trail.test.js`
Expected: FAIL after Step 1 — the stale worktree file survives, no `trailAdoption` is written, and `record-trail` is an unknown verb.

- [ ] **Step 3: Implement** the Files change.

- [ ] **Step 4: Run to verify they pass**

Run: `node --test tests/hooks-adopt-run-dir.test.js tests/hooks-record-trail.test.js tests/hooks-help-guard.test.js tests/hooks-js-flag-strict.test.js tests/bin-lib/reconcile/archive-merged.test.js tests/bin-lib/hooks/session-residue.test.js tests/path-guard-conformance.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/hooks.js docs/plugin-structure.md tests/hooks-help-guard.test.js tests/hooks-adopt-run-dir.test.js tests/hooks-record-trail.test.js tests/bin-lib/reconcile/archive-merged.test.js tests/bin-lib/hooks/session-residue.test.js
git commit -m "Mirror staged/ in adopt-run-dir and add record-trail for --local-trail's PR lookup (refs #4565)"
```

### Task 6: Skill prose — approve-mode, Step 7.5, attention row

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/skills/tidy/approve-mode.md` (5,598 B; rail 52,500 B)
- Modify: `plugin/skills/tidy/step-7-5-worktree-always.md` (9,939 B) — first paragraph only
- Modify: `plugin/skills/backlog/attention-mode.md` (24,140 B) — `### Tidy row` only
- Modify: `plugin/skills/tidy/SKILL.md:218` (43,329 B) and `plugin/skills/sweep/SKILL.md:82` (14,604 B) — "a closed directory that still holds staged items stays approvable" → "still holds actionable staged items"
- Modify: `plugin/skills/tidy/step-6-auto.md:119` (50,615 B, 1,885 B of headroom; this adds 11 B) — "still holding `staged/` items" → "still holding actionable `staged/` items"
- Modify: `tests/tidy-residue-markers.test.js:194-229` — re-point the two pinned sentences to their new wording
- Create: `tests/tidy-approve-staged-outcome-conformance.test.js`
- No change (checked): `tests/worktree-forge-api-carve-out.test.js`'s `assertStep75Gate` phrases (`provision no worktree`, `skip the commit`, `working-tree write`, the provisioning sentence) must survive the Step 7.5 edit; `tests/tidy-plan-retention-conformance.test.js`'s decline-sentence ordering must survive the approve-mode edit; `tests/backlog-attention-rows.test.js` and `tests/sweep-orchestrator.test.js` pins (`run /claude-tweaks:tidy --approve`, `tidy proposal(s) staged awaiting approval`, an IL-127/Anchoring citation) must survive. `tidy/SKILL.md`'s Archive row stays flag-free: reconcile-side archival keeps the `audit-untracked` refusal (the record's Trail ruling).

**Interfaces:**
- Consumes: Task 2's command lines, Task 4's `--local-trail`, `--landing` and refusal reasons, Task 5's `record-trail`, written with `${CLAUDE_PLUGIN_ROOT}` like the file's existing commands.

Edits:
1. `approve-mode.md` "Resolving the target run": **No-arg default:** `node "${CLAUDE_PLUGIN_ROOT}/bin/staged-items.js" --find` (top-level `*-tidy-standalone*` and `*-sweep-standalone*` directories under `$RUN_ROOT`, newest first; an item is actionable while it is a top-level file of `staged/`; `staged/applied/` and `staged/declined/` hold resolved items). The target is the first `actionableRuns` entry the landing check below does not refuse; each refused run is reported. With none, every `settledRuns` entry takes the Retry route below, newest first, each reporting its own result, so an older settled run is never hidden; with neither, report `no staged tidy proposals found` and stop. After a target run finishes, `settledRuns` takes the Retry route the same way. Delete the sentences contrasting this with the attention row's newest-only rule: both now read the same `--find`. **Explicit `[run-dir]`:** same anchoring and name validation; drop the "and that has a `staged/` subdirectory" clause. An explicit target with no actionable id (`--list`) reports `nothing staged in {run-dir}` and takes the Retry route. A new **Landing check:** paragraph: before rendering, `node "${CLAUDE_PLUGIN_ROOT}/bin/staged-items.js" --run "{run-dir}" --landing`. `open` refuses the run, naming the PR: `{run-dir} is landing through PR #{number} ({url}) — merge or close it, then re-run`. `merged` refuses it with the printed `syncCommand`: this checkout has not synced the merged trail yet. `unknown` refuses it with the printed `detail`. A refused run's tracked item is never reported `stale`, so it is never recorded as declined. `none` proceeds. A new **Retry route:** paragraph: a target with no actionable item runs `## Archiving the run`'s `close-run` and `archive-run` commands and reports `archive-run`'s output, so a settled but unarchived run can always finish.
2. "Re-entering the Approve rendering": add one sentence — an actionable id with no `.json` sidecar renders no row; show it by id beside the section, as one row labelled by its id.
3. A new `## Recording each item's outcome` section, after "Executing the approved set". Each Approve row is one element of a staged item's `staged/{id}.json` array (render order: filename-sorted files, array order). An item settles only after Step 7.5's verification of that item passed, and after the tidy-up commit when the set has one: a failed verification or commit leaves the item actionable in `staged/`. Write the settle file with the Write tool to the path `node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" --value tidy-approve-rows-{run-id}.json` prints: `{ "{id}": [ { "row": "{row title}", "outcome": "applied|excluded|stale|failed" } ] }`, one entry per row of every item the Approve section showed — `excluded` when the human excluded it, `stale` when re-verify reported `stale — skipped`, `failed` when its action failed or its checklist line did not pass, `applied` otherwise. Then `node "${CLAUDE_PLUGIN_ROOT}/bin/staged-items.js" --run "{run-dir}" --settle --rows-file "{path}" [--worktree "{worktree-path}"]`, passing `--worktree` whenever this run provisioned the scratch worktree. An untracked item moves as a plain file; a tracked one settles in the scratch worktree's index and lands with the commit, never as a rename left in the main checkout's index. The row rule, stated once: at least one row applied and none failed resolves the item `applied` (`staged/applied/`), its excluded or stale rows named on the same `decisions.md` line; every row excluded or stale, in any mix, moves it to `staged/declined/`; any failed row leaves it actionable in `staged/`. The CLI logs each item's line; only on `"logged":false` log that item by hand with `log-decision.js`. Exit 4 is reported per item and stops archival; exit 2 or 3 is fixed and re-run. **Commit order under `--approve`,** the exception to Step 7.5's adopt-before-`git add` order: the tidy-up commit first when the set has one, then `--settle`, then under `pr-first` `adopt-run-dir`, then the trail commit in the scratch worktree, before Step 7.5's push, so the committed trail carries the outcomes. Under `local-merge`, commit the staged moves the same way when there are any. **A tracked item needs the scratch worktree whatever `worktree-always` says:** when `--list`'s `tracked` names an item in the approved set, provision it per `_shared/scratch-worktree.md` and follow `step-7-5-worktree-always.md` for how the result lands, also with `worktree-always` off. The report names each `pendingCommit: true` item as `applied, landing through PR #{number} ({url}) — stays listed until it merges and syncs`.
4. "Archiving the run": archive only when `--settle`'s `actionable` is empty; otherwise report the actionable ids and stop — the run stays listed and a later `--approve` retries them. `close-run`, then `node "${CLAUDE_PLUGIN_ROOT}/bin/hooks.js" archive-run --run "{run-dir}" --local-trail`, right after `--settle` when no commit exists and once Step 7.5's commit lands otherwise. One bullet on the flag: `--local-trail` moves a never-committed `decisions.md`/`report.md`/`staged/` into `archive/` by plain move and carries a fully tracked trail through its usual `git mv` commit; it refuses `local-trail-actionable` while any staged item is actionable, `local-trail-landing` (naming the PR) while the trail `adopt-run-dir` adopted has an open PR, `local-trail-landing-unknown` when that PR's state cannot be read, `audit-untracked` when the trail is partly tracked or merged but not yet synced here (the merged case prints the exact sync command), and `local-trail-not-standalone` on any other run. A refusal is reported, not worked around; the Retry route finishes the run later. Keep the sentence on stale items surviving archival, re-pointed at `staged/declined/`. In "Executing the approved set", change "run exactly as they would for a same-session batch approval" to say they do so except for the commit order `## Recording each item's outcome` states.
5. `step-7-5-worktree-always.md`. First paragraph: after the sentence defining a working-tree write, add "Under `--approve`, settling a staged item git already tracks (`staged-items.js --list`'s `tracked` ids) is a working-tree write too (`approve-mode.md`)." After "The run dir's audit files then stay uncommitted at `$RUN_ROOT`, exactly as when `worktree-always` is off." append "`approve-mode.md`'s Archiving the run archives such a run with `archive-run --local-trail`." "Skip this entirely when `worktree-always` isn't set" sentence: add "except for a tracked `--approve` item (`approve-mode.md`)". The adopt-run-dir sentence: after "then add/commit the worktree copies", add "`--approve` commits in its own order: `approve-mode.md`'s Recording each item's outcome". The `pr-first` bullet: once the PR exists, new or reused, and before `ExitWorktree`, run `node "${CLAUDE_PLUGIN_ROOT}/bin/hooks.js" record-trail --run "$RUN_ROOT/.claude-tweaks/pipelines/{run-id}" --worktree "{worktree-path}" {number} "{url}"` as its own Bash call, stating that this is what lets `archive-run --local-trail` and `--approve` tell this PR from an earlier one on the same branch name. A failed call is logged to `decisions.md`, never a stop: the PR already exists, and the null-sha lookup still refuses while it is open.
6. `attention-mode.md` Tidy row: replace the glob, newest-directory and non-empty rules with: run `node "${CLAUDE_PLUGIN_ROOT}/bin/staged-items.js" --find` (it scans `*-tidy-standalone*` and `*-sweep-standalone*` under `$RUN_ROOT`, anchored per `_shared/pipeline-run-dir.md`'s Anchoring section, never a bare relative path, `[IL-127]`, and lists runs with actionable ids newest first, the walk-back `tidy --approve` uses). When `actionableRuns` is non-empty, render the row with `{count}` the number of ids in its first entry's `actionable`. Omit the row when `actionableRuns` is empty or the command fails. Remove the whole **Accepted limitation** paragraph.

- [ ] **Step 1: Write the failing conformance test** `tests/tidy-approve-staged-outcome-conformance.test.js` (read files with `tests/helpers/read-skill`'s `readText`). Factor each file's assertions into one function; each go-red control runs that same function on a mutated copy and expects it to throw:
  - `AC4.1: approve-mode records outcomes through --settle` — contains `--settle --rows-file`, `--worktree`, each of `excluded`, `stale`, `failed`; `## Recording each item's outcome` precedes `## Archiving the run`; in the outcome section, `--settle` precedes `adopt-run-dir`.
  - `When an item settles: approve-mode settles after verification and leaves a failed one actionable` — contains `only after Step 7.5's verification`, `a failed verification or commit leaves the item actionable`.
  - `AC5.1, AC5.2, AC5.3: approve-mode states the row rule` — contains `at least one row applied and none failed`, `every row excluded or stale, in any mix`, `any failed row leaves it actionable`.
  - `Tracked items: approve-mode settles a tracked item through the commit` — contains `never as a rename left in the main checkout's index`.
  - `AC2.1: approve-mode archives with --local-trail, only with nothing actionable` — contains `archive-run --run "{run-dir}" --local-trail`, `local-trail-actionable`, `local-trail-landing`, `archive only when`.
  - `Retry route: approve-mode finishes a run with no actionable item` — contains `**Retry route:**`, `settledRuns`; the sentence with `nothing staged in {run-dir}` also names the Retry route and no longer says `stops`.
  - `--approve during landing: approve-mode refuses a landing run and names the PR` — contains `**Landing check:**`, `--landing`, `is landing through PR #{number}`, `syncCommand`, `never reported \`stale\``; the Landing check precedes `## Re-entering the Approve rendering`.
  - `Tracked item listing: approve-mode's report names the pending state and PR` — contains `stays listed until it merges and syncs`.
  - `Commit order: approve-mode and step-7-5 state the --approve exception` — approve-mode contains `Commit order under \`--approve\``, and its `Executing the approved set` section no longer says `exactly as they would` without `except`; step-7-5 contains `\`--approve\` commits in its own order`.
  - `worktree-always off: approve-mode provisions for a tracked item` — approve-mode contains `whatever \`worktree-always\` says`; step-7-5 contains `except for a tracked \`--approve\` item`.
  - `PR lookup scope: step-7-5 stamps the trail after the PR exists` — step-7-5 contains `bin/hooks.js" record-trail --run`, and it precedes the `On success, tear the scratch worktree down via \`ExitWorktree\`` sentence.
  - `AC1.1, AC3.1: attention-mode's Tidy row reads --find and has no limitation paragraph` — the `### Tidy row` section contains `bin/staged-items.js" --find`, `actionableRuns`, `Anchoring`, `IL-127`, and contains neither `Accepted limitation` nor `holds one or more files`.
  - `step-7-5 points forge-only archival at --local-trail and names the tracked-settle write` — contains `archive-run --local-trail`, `tracked`.
  - Go-red controls: removing `--local-trail` from approve-mode, and replacing `--find` in attention-mode's row with `--fnd`, each make the shared assertion function throw.

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/tidy-approve-staged-outcome-conformance.test.js`
Expected: FAIL (phrases absent)

- [ ] **Step 3: Make edits 1-6**, the `SKILL.md:218`, `sweep/SKILL.md:82` and `step-6-auto.md:119` wording, and re-point `tests/tidy-residue-markers.test.js`'s two pinned sentences: the no-arg default test pins `**No-arg default:** \`node "${CLAUDE_PLUGIN_ROOT}/bin/staged-items.js" --find\``, and the walk-back test pins `actionableRuns` and `With none, every \`settledRuns\` entry takes the Retry route`.

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/tidy-approve-staged-outcome-conformance.test.js tests/tidy-residue-markers.test.js tests/worktree-forge-api-carve-out.test.js tests/tidy-plan-retention-conformance.test.js tests/backlog-attention-rows.test.js tests/sweep-orchestrator.test.js tests/raw-markdown-read-conformance.test.js tests/skill-fence-guard-shapes.test.js`
Expected: PASS

- [ ] **Step 5: Behavior-change sweep.** Run `git grep -n -i -E "holds one or more files|non-empty .?staged|empty-.?staged|holds staged items|holding .?staged|accepted limitation|single newest" -- plugin/skills/tidy plugin/skills/backlog plugin/skills/sweep` and confirm every remaining hit is reworded or a pre-approval site. A rule that describes the old `tidy --approve` order (`git grep -n -E "adopt-run-dir" -- plugin/skills`) is reworded only if it describes the `--approve` path; Step 7.5's same-session commit keeps its own single commit.

- [ ] **Step 6: Commit**

```bash
git add plugin/skills/tidy/approve-mode.md plugin/skills/tidy/step-7-5-worktree-always.md plugin/skills/tidy/SKILL.md plugin/skills/tidy/step-6-auto.md plugin/skills/sweep/SKILL.md plugin/skills/backlog/attention-mode.md tests/tidy-approve-staged-outcome-conformance.test.js tests/tidy-residue-markers.test.js
git commit -m "Record tidy --approve outcomes and archive forge-only runs with --local-trail (refs #4565)"
```
