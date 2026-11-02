# Tidy --approve Staged Outcomes and Forge-Only Archival Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After `/claude-tweaks:tidy --approve` settles a run's staged items, record each item's outcome on disk so the SessionStart notice and `backlog attention` stop counting it, and give a forge-only approval run an archivable terminal state with no manual git step.

**Architecture:** One on-disk representation, read through one helper: an item still awaiting approval is a top-level file in `staged/`; a resolved item's files move into `staged/applied/` or `staged/declined/`. `plugin/bin/lib/stage-item/outcome.js` owns that rule, the per-row outcome derivation, and the move (`git mv` for a tracked file, plain rename otherwise); `plugin/bin/staged-items.js` exposes it to skill prose (`--list`, `--settle`); the code readers (`session-residue.js`, the residue `pipeline-runs` probe, `archive-run --local-trail`) call the helper and the prose readers (`tidy/approve-mode.md`, `backlog/attention-mode.md`'s Tidy row) call the CLI. Deliverable 2 takes `archive-run --local-trail` per the record's Trail ruling, not the housekeeping PR: a run's trail lands in git only when its environment disappears afterwards (#4850 owns that case), and the archive path is gitignored, so a local move loses nothing that was ever in git. `audit-untracked` stays the refusal without the flag.

**Tech Stack:** Node 18+ CommonJS, `node --test`, markdown skill prose.

**Spec:** `.claude-tweaks/pipelines/2026-11-02T034109-record-4565/work/4565-spec.md`

Scope keywords: collectApprovableStandalone, hasStagedEntries, audit-untracked, staged/applied, staged/declined, local-trail

## Global Constraints

- Shipped code lives under `plugin/`; tests under `tests/`. Run single files with `node --test {path}`; never the full suite in a task (Common Step 5 runs it once).
- Path-guard lint (`tests/path-guard-conformance.test.js`): no new `existsSync` or `realpathSync` token in any `plugin/bin/**` file, comments excluded. Use `plugin/bin/lib/path-guard`'s `lstatType(p).type` (`'file'`/`'dir'`/`'missing'`/…). Allowlisted files (`archive-merged.js`, `session-residue.js`, `pipeline-runs.js`, `hooks.js`) keep their exact counts.
- Git calls go through `plugin/bin/lib/hooks/git-exec.js`'s `runGit(args, cwd, { env: repoPinnedEnv() })` (`.failure`, `.stdout`, `.stderr`), the shape `archive-merged.js` lines 42-44 wrap; a non-path-list `ls-files` carries the file's existing `// git-path-read: not a path list (exit code only)` marker. `git mv` retries a held index lock via `plugin/bin/lib/git-retry.js`'s `withIndexLockRetry(runGit)`.
- CLI shape (from `.claude/skills/gh-api-module-pattern/cli-wrapper-contract.md`): `run(argv, deps)` exported, `if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);` as the entry guard (the exit-code conformance scan reads this guard). A run-dir writer refuses a non-anchored `--run` through `plugin/bin/lib/stage-item/write.js`'s `resolveTarget` with exit **3**. "A CLI that reports a decision as data logs that entry itself; the skill hand-logs it only when the CLI reports the append failed."
- hooks.js flag on an existing verb (from `.claude/skills/hooks-js-verb-registration/SKILL.md`, "Adding a flag to an existing verb"): site 1 "The verb's `usage` string in `VERBS` — Always: append `[--{flag}]`"; site 2 "The handler's option parse — Always: `args.includes('--{flag}')` for a boolean … passed through to the lib call"; site 3 "`KNOWN_FLAGS` — Always: append the flag to the verb's entry. Without it the unknown-flag guard refuses the new flag."; site 5 "The doc that owns the verb's call — Always: the usage line plus one bullet on the flag's semantics" (`archive-run` has no `_shared` home doc; its caller here is `tidy/approve-mode.md`, which carries the bullet); site 6 "A CLI spawn test that the flag reaches the handler, whose negative half runs the same args without the flag and asserts the old reason, not just the exit code … and a pin on the home doc's usage line." Flag decision 1: "Keep the without-flag path safe and byte-for-byte unchanged for existing callers." Flag decision 2: "Refuse bad combinations first."
- Decision-log lines go through `plugin/bin/lib/log-decision/append.js` (`formatEntry` + `appendEntry`), status `AUTO`, reversibility `high`.
- Test names cite acceptance-criterion clause ids (below).

AC clause ids: AC1.1 — forge-only approval → next SessionStart omits the run and `backlog attention`'s tidy row omits it. AC2.1 — the run reaches an archived (or documented terminal) state without a manual git step. AC3.1 — a run with at least one actionable item is still listed by both readers. AC4.1 — an item excluded at the prompt or skipped `stale — skipped` moves to `staged/declined/` with one `decisions.md` line. AC4.2 — neither reader counts it, and `archive-run --local-trail` treats it as resolved. AC5.1 — at least one row applied and none failed resolves `applied`, excluded or stale rows named on the same `decisions.md` line. AC5.2 — every row excluded or stale, in any mix, moves it to `staged/declined/`. AC5.3 — any failed row leaves it actionable in `staged/`.

Decided here (spec silent, no criterion changes):
- An item absent from the settle file stays actionable. A staged item with no `.json` sidecar has no rendered Approve row; approve-mode shows it by id and it counts as one row labelled by its id.
- A partly settled run (an item left actionable) is not archived: approve-mode archives only when `--settle` reports `actionable: []`. A later `--approve` retries the rest.
- A tracked staged file (the run's original Step 7.5 committed its trail through `adopt-run-dir`) moves with `git mv`, left staged in the main checkout's index; `archiveRunDir`'s tracked path carries it into its pathspec-scoped `[reconcile] archive run` commit. Nothing else commits it.
- `adopt-run-dir` mirrors `staged/` (removes the worktree copy before copying), so a tracked trail's moved item does not survive at its old path in the PR.
- A closed run with zero actionable items loses the residue probe's #4138 exemption. A sibling session's tidy Archive row then calls `archive-run` without the flag, which refuses `audit-untracked` on an untracked trail — the record's own ruling ("a trail with a landing PR still waiting is never moved early"). The hint names `--local-trail` for the never-committed case. No new liveness marker.

## Review Focus

1. A partially tracked trail (one staged file merged through an earlier PR, one not) under `--local-trail`: a plain move would strand the tracked blob at the old path (#593). Expected: refuse `audit-untracked`. Test in Task 4.
2. An item id that is a prefix of another (`tidy-delete-1` vs `tidy-delete-10`): settling one must not move the other's files. Test in Task 1.
3. Re-running `--settle` for an item already moved (a retry after a partial failure): per-item refusal `not-found`, other items still settled, exit 4, nothing logged for the refused item. Test in Task 2.
4. A malformed settle file (empty rows, unknown outcome, unsafe id): exit 2 before anything moves. Test in Task 2.
5. A `staged/` holding only `applied/` and `declined/` plus a dotfile: zero actionable ids, so both readers omit the run. Test in Tasks 1 and 3.

---

### Task 1: The staged-outcome helper

**Role:** integration
**Review risk:** high

**Files:**
- Create: `plugin/bin/lib/stage-item/outcome.js`
- Test: `tests/bin-lib/stage-item/outcome.test.js`

**Interfaces:**
- Produces:
  - `listActionableStaged(runDir: string) -> string[]` — sorted unique item ids: each top-level regular file (`withFileTypes`, `isFile()`) of `{runDir}/staged/` not starting with `.`; the id is `path.basename(name, path.extname(name))`. Subdirectories are never items. Missing `staged/` or any read error → `[]`.
  - `listResolvedStaged(runDir, outcome: 'applied'|'declined') -> string[]` — same rule over `staged/{outcome}/`.
  - `itemOutcome(rows: {row: string, outcome: 'applied'|'excluded'|'stale'|'failed'}[]) -> 'applied'|'declined'|'actionable'` — any `failed` → `actionable`; else any `applied` → `applied`; else `declined`. Throws `TypeError` on an empty array or an unknown row outcome.
  - `resolveStagedItem({ runDir, id, outcome: 'applied'|'declined' }) -> { ok: true, moved: string[] } | { ok: false, reason: 'not-found'|'destination-exists'|'move-failed', detail?: string }` — `moved` holds sorted names relative to `staged/` (`applied/tidy-delete-1.md`). Matches files whose computed id equals `id` exactly. Checks every destination with `lstatType` before moving (any `type` other than `'missing'` → `destination-exists`, nothing moved). `fs.mkdirSync(staged/{outcome}, { recursive: true })`, then per file: when `mainCheckoutRoot(runDir)` resolves and `git ls-files --error-unmatch {file}` exits 0, `git mv {src} {dest}`; otherwise `fs.renameSync`. A failure after an earlier move moves the earlier ones back the same way, and returns `move-failed` with the message. Throws `TypeError` for an `outcome` outside the two.

- [ ] **Step 1: Write the failing tests** in `tests/bin-lib/stage-item/outcome.test.js`, each in a fresh `fs.mkdtempSync` dir, staging with the real writers (`writeStagedItem` + `writeStagedSidecar` from `plugin/bin/lib/stage-item/write.js`):
  - `AC3.1: listActionableStaged returns each staged item id once` — stage `tidy-delete-1` and `digest-promotion-2` (.md + .json) → `['digest-promotion-2', 'tidy-delete-1']`.
  - `AC4.2: resolved items and dotfiles are not actionable` — resolve one to `applied`, one to `declined`, add `staged/.DS_Store` → actionable `[]`, `listResolvedStaged` returns each id.
  - `resolveStagedItem moves every file of the id and only that id` — `tidy-delete-1` and `tidy-delete-10`; `moved` deep-equals `['applied/tidy-delete-1.json', 'applied/tidy-delete-1.md']`; `tidy-delete-10.*` stay top-level.
  - `resolveStagedItem refuses not-found and destination-exists without moving`.
  - `listActionableStaged on a missing staged/ is empty`.
  - `resolveStagedItem rejects an unknown outcome` — `TypeError` for `'skipped'`.
  - `AC5.1: one applied row with excluded and stale rows resolves applied` — `itemOutcome` → `'applied'`.
  - `AC5.2: excluded and stale in any mix resolves declined` — `[excluded, stale]`, `[stale, stale]`, `[excluded]` → `'declined'`.
  - `AC5.3: any failed row leaves the item actionable` — `[applied, failed]`, `[excluded, failed]` → `'actionable'`.
  - `itemOutcome rejects empty rows and an unknown outcome`.
  - `a tracked staged file moves with git mv, leaving no unstaged deletion` — `git init` fixture under `{root}/.claude-tweaks/pipelines/2026-11-02T120000-tidy-standalone/`, commit `staged/tidy-delete-1.md`, resolve to `applied` → `git status --porcelain` shows one `R ` entry and no ` D`/`??`. Deleting the tracked branch of the mover turns this red (test comment says so).

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/bin-lib/stage-item/outcome.test.js`
Expected: FAIL with `Cannot find module '../../../plugin/bin/lib/stage-item/outcome'`

- [ ] **Step 3: Implement `plugin/bin/lib/stage-item/outcome.js`** per the Interfaces block. Header comment: the representation rule, #4565, the row rule, and the reader roster (session-residue.js, residue/probes/pipeline-runs.js, archive-merged.js `--local-trail`, staged-items.js).

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

**Files:**
- Create: `plugin/bin/staged-items.js`
- Modify: `docs/plugin-structure.md` (the `plugin/bin/lib/stage-item/` line: add `outcome.js`; one CLI line beside the `stage-item.js` line)
- Test: `tests/bin-lib/stage-item/staged-items-cli.test.js`

**Interfaces:**
- Consumes: Task 1's exports; `resolveTarget`, `sanitizeId` from `stage-item/write.js`; `formatEntry`, `appendEntry` from `log-decision/append.js`.
- Produces (the command lines Task 6's prose uses verbatim):
  - `node plugin/bin/staged-items.js --run <run-dir> --list` → one JSON line `{"actionable":[…],"applied":[…],"declined":[…]}`, exit 0.
  - `node plugin/bin/staged-items.js --run <run-dir> --settle --rows-file <path>` — the file is `{ "<id>": [ { "row": "<label>", "outcome": "applied|excluded|stale|failed" } ] }`. Whole file validated first; each item then derives `itemOutcome`, moves (unless `actionable`), and appends one `decisions.md` line. Prints one JSON line `{"results":[{"id":…,"outcome":…,"moved":[…],"logged":true|false,"reason"?:…}],"actionable":[…]}`, where `actionable` is `listActionableStaged` after the pass.
  - Exit codes: 0 done; 2 malformed invocation (missing `--run`; neither or both of `--list`/`--settle`; `--settle` without `--rows-file`; unreadable or malformed file: non-object top level, empty rows, blank `row`, unknown outcome, an id `sanitizeId` rejects; an unknown flag; a value flag given last), nothing moved; 3 run dir missing or not anchored; 4 at least one item refused by `resolveStagedItem` (`results[i].reason`, stderr `staged-items.js: refused ({reason}): {id}`), the other items still settled and stdout still printed. A failed `appendEntry` after a move is `logged: false` plus a stderr line, exit 0.
  - Log line: `formatEntry({ status: 'AUTO', now, step: 'tidy --approve', text, reversibility: 'high' })` under section `'/tidy'`. A row label has whitespace runs collapsed to one space. `{notes}` is the item's excluded and stale rows joined by `, `, each `{label} (excluded at the approval prompt)` or `{label} (stale — skipped by re-verify)`. `text`: `staged item {id} applied → staged/applied/` plus `; not applied: {notes}` when any; `staged item {id} declined → staged/declined/: {notes}`; `staged item {id} left actionable in staged/: {failed labels joined by ", "} failed`.

- [ ] **Step 1: Write the failing tests**, spawning the real CLI against a `git init` main-checkout fixture with the run dir at `{root}/.claude-tweaks/pipelines/2026-11-02T120000-tidy-standalone/` (staged via the real writers), plus `run(argv, deps)` for the log-failure case:
  - `--list prints actionable, applied and declined ids` — exact JSON.
  - `AC4.1: an excluded item moves to declined with one decisions.md line` — exit 0; files under `staged/declined/`; exactly one line matching `/AUTO .* — tidy --approve: staged item tidy-delete-1 declined → staged\/declined\/: r1 \(excluded at the approval prompt\)\. Reversibility: high\./`.
  - `AC4.1: a stale item logs the stale-skipped wording` — `/r1 \(stale — skipped by re-verify\)/`.
  - `AC5.1: a split item resolves applied and names its other rows on one line` — rows applied/excluded/stale → `staged/applied/`, one line containing `not applied: r2 (excluded at the approval prompt), r3 (stale — skipped by re-verify)`.
  - `AC5.2: an excluded-and-stale item moves to declined on one line`.
  - `AC5.3: a failed row leaves the item in staged/` — files top-level; JSON `outcome: 'actionable'`, `actionable` contains the id; one `left actionable` line naming `r2 failed`.
  - `an item absent from the settle file stays actionable`.
  - `re-settling an already-moved item exits 4 not-found, settles the others, logs nothing for it` — stderr `/refused \(not-found\): tidy-delete-1/`, the other item moved, `decisions.md` gains one line.
  - `usage and malformed files exit 2, nothing moved` — one assertion each: no `--run`; `--list --settle --rows-file f`; `--settle` alone; `--bogus`; `--rows-file` last; rows `{"x":[]}`; `{"../x":[…]}`; outcome `skipped`; a non-JSON file.
  - `a worktree-local shadow run dir exits 3 and leaves the shadow byte-unchanged` — linked worktree fixture; `--settle` against the shadow path.
  - `a failed decisions.md append reports logged:false and still exits 0` — `run(argv, { ...realDeps, appendEntry: () => { throw new Error('disk full'); } })`.

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/bin-lib/stage-item/staged-items-cli.test.js`
Expected: FAIL (CLI file absent)

- [ ] **Step 3: Implement `plugin/bin/staged-items.js`** with `parseArgs(argv)` (render-tidy-report.js's `next()` shape, rejecting an `undefined` value), `realDeps = { resolveTarget, listActionableStaged, listResolvedStaged, resolveStagedItem, appendEntry, readFile, now: () => new Date(), stdout, stderr }`, and the exit codes above. Header comment documents usage, every exit code, the `logged: false` contract, and that `--list` still refuses an unanchored `--run` so a worktree shadow never yields a confident wrong count. Then add the two `docs/plugin-structure.md` entries.

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/bin-lib/stage-item/staged-items-cli.test.js tests/path-guard-conformance.test.js tests/bin-lib/exit-code-conformance.test.js tests/windows-hide-spawn-conformance.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/staged-items.js tests/bin-lib/stage-item/staged-items-cli.test.js docs/plugin-structure.md
git commit -m "Add staged-items.js — list and settle a run's staged items (refs #4565)"
```

### Task 3: Both code readers count only actionable items

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/hooks/session-residue.js:111-129` (`collectApprovableStandalone`: replace the `readdirSync` + `staged.length` test with `listActionableStaged(dir).length === 0 → continue`; comment reads "still carry actionable `staged/` proposals")
- Modify: `plugin/bin/lib/residue/probes/pipeline-runs.js` (lines 62-70 and 104-111: delete `hasStagedEntries`; the #4138 exemption calls `listActionableStaged(dir).length > 0`; comment reads "still holds actionable staged items")
- Test: `tests/bin-lib/hooks/session-residue.test.js`
- Test: `tests/bin-lib/residue/probes-pipeline-runs.test.js`
- No change (checked): `plugin/bin/lib/hooks/session-start.js` and `hooks.js:1536` only print `collectApprovableStandalone`'s lines.

**Interfaces:**
- Consumes: Task 1's `listActionableStaged`, `resolveStagedItem`.

Consumer classification for the other `staged/` readers (no change, recorded so review can check it): `render-tidy-report/render.js` reads only top-level `*.json` (`isFile()`), so resolved items drop out by construction; `reconcile/archive-merged.js`'s `listStagedItems` serves only the console-less auto-merge guard, which a tidy/sweep standalone run never trips (no auto-merge line in its `decisions.md`); `hooks/staged-inventory.js` checks pipeline runs' `STAGED` lines on `/flow` resume and never reads a tidy/sweep standalone run; `stage-item/write.js`'s `listExistingNumbers` only reads `{kind}-{digits}` names at the top level; `hooks/context.js:131`'s best-effort `rmdir` no-ops on a dir holding `applied/`.

- [ ] **Step 1: Write the failing tests.** In `session-residue.test.js`, using the file's `tmpProject`/`mkRun` helpers, staging through `writeStagedItem` and resolving through `resolveStagedItem`:
  - `AC1.1: a clean sweep-standalone run whose every staged item was applied or declined is not listed` → `[]`.
  - `AC3.1: a run with one actionable item beside resolved ones is still listed` → one entry whose `line` contains `tidy --approve`.
  - `AC4.2: a run whose only items are declined is not listed`.
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
- Modify: `plugin/bin/lib/reconcile/archive-merged.js` — `archiveRunDir(root, runDir, { localTrail = false } = {})` (line 1260) and the standalone audit block (lines 1438-1467)
- Modify: `plugin/bin/hooks.js` — `VERBS['archive-run'].usage` (line 131) → `'archive-run [--run <dir>] [--local-trail]'`; `KNOWN_FLAGS['archive-run']` (line 171) → `['--run', '--local-trail']`; `runArchiveRun` (line 1254): parse `argv.slice(3).includes('--local-trail')`, pass `archiveRunDir(mainRoot, runDir, { localTrail })`
- Test: `tests/bin-lib/reconcile/archive-merged.test.js`
- Test: `tests/archive-run-verb.test.js`

**Interfaces:**
- Consumes: Task 1's `listActionableStaged`.
- Produces: `archiveRunDir(root, runDir, { localTrail })`; refusals `local-trail-actionable` (`{ actionable: string[], hint }`) and `local-trail-not-standalone`. Every existing caller passes no third argument and is unchanged.

Behaviour:
1. `localTrail` true on a run id not matching `/-(tidy|sweep)-standalone/` → refuse `local-trail-not-standalone` before the `archiving` marker is written.
2. `localTrail` true and `listActionableStaged(runDir)` non-empty → refuse `local-trail-actionable`, hint `staged item(s) still awaiting approval: {ids} — run /claude-tweaks:tidy --approve "{runDir}" first`, before the marker too.
3. In the audit block, with `untrackedAuditFiles` non-empty: `localTrail` false → the unchanged `audit-untracked`. `localTrail` true and `git ls-files -z -- {decisions.md} {report.md} {staged}` prints anything or fails → the same `audit-untracked` (a partly committed trail belongs to a PR; moving it by hand strands the tracked blob, #593; fail closed). Otherwise skip the refusal: those entries were never pushed to `workMoves`, so the top-level move loop moves them with `moveArchiveEntry`; with no `work/`, no git command runs and no commit is made.
4. `untrackedAuditFiles` empty (a fully tracked trail, moved items included): the existing tracked path, flag or no flag.

Append to the `audit-untracked` hint: ` If this trail was never committed by design (a tidy --approve run whose approved set made no commit), re-run with --local-trail.` — keep the existing sentence so `/sync this checkout with origin/` still matches.

- [ ] **Step 1: Write the failing tests.** In `archive-merged.test.js` (reuse `makeRepo`, `commitPath`, `trackedFiles`; seed `{status:'active'}` then the real writer `closeRunState(runDir)` from `plugin/bin/lib/hooks/close-run-state.js`):
  - `AC2.1: localTrail archives an untracked forge-only trail whose items are all resolved` — untracked `decisions.md`, `report.md`, `staged/applied/tidy-delete-1.md` → `ok: true`; run dir gone; both archived paths exist; `git log --oneline` count unchanged.
  - `AC4.2: localTrail treats declined items as resolved` — only `staged/declined/…` → `ok: true`.
  - `AC3.1: localTrail refuses local-trail-actionable while an item is actionable` — top-level `staged/tidy-delete-2.md` → reason, `actionable` deep-equals `['tidy-delete-2']`, file still at the run dir, no archive twin. Deleting rule 2 turns this red.
  - `localTrail still refuses audit-untracked for a partially tracked staged/` — `commitPath` one `staged/applied/a.md`, leave `staged/applied/b.md` untracked. Deleting rule 3's `ls-files` branch turns this red.
  - `localTrail refuses local-trail-not-standalone on a record run`.
  - `AC2.1: a fully tracked trail whose item moved with git mv archives through its tracked path` — commit `decisions.md`, `report.md`, `staged/tidy-delete-1.md` in a sweep-standalone run, append to `decisions.md`, `resolveStagedItem` to `applied`, `archiveRunDir(root, runDir, { localTrail: true })` → `ok: true`; `trackedFiles` lists `archive/{runId}/staged/applied/tidy-delete-1.md` and nothing under the live run dir; `git status --porcelain` empty for those paths; the archived `decisions.md` holds the appended line.
  - `without localTrail the forge-only trail still refuses audit-untracked, and the hint names --local-trail` — `hint` matches `/--local-trail/` and `/sync this checkout with origin/`.
  In `archive-run-verb.test.js` (spawn, mirroring the existing sweep-standalone audit-untracked test):
  - `AC2.1: archive-run --local-trail archives a closed forge-only sweep-standalone run` — stdout `/claude-tweaks: archived 2026-08-14T120000-sweep-standalone/`; the same args without the flag on a twin fixture → `/archival refused — audit-untracked/`.
  - `archive-run --local-trail with an actionable item prints local-trail-actionable` — `/archival refused — local-trail-actionable — staged item\(s\) still awaiting approval: tidy-delete-2/`.
  - `archive-run --local-trial is refused with the usage line and moves nothing` — stdout `claude-tweaks: usage: archive-run [--run <dir>] [--local-trail]`.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/bin-lib/reconcile/archive-merged.test.js tests/archive-run-verb.test.js`
Expected: FAIL after Step 1 — the new cases get `audit-untracked` or the usage refusal.

- [ ] **Step 3: Implement** the four rules and the hooks.js changes.

- [ ] **Step 4: Run to verify they pass**

Run: `node --test tests/bin-lib/reconcile/archive-merged.test.js tests/archive-run-verb.test.js tests/hooks-help-guard.test.js tests/hooks-js-flag-strict.test.js tests/hooks-dispatcher.test.js tests/path-guard-conformance.test.js tests/reconcile.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/reconcile/archive-merged.js plugin/bin/hooks.js tests/bin-lib/reconcile/archive-merged.test.js tests/archive-run-verb.test.js
git commit -m "Add archive-run --local-trail — archive a never-committed tidy trail once nothing is actionable (refs #4565)"
```

### Task 5: `adopt-run-dir` mirrors `staged/`

**Role:** integration

**Files:**
- Modify: `plugin/bin/hooks.js` — `copyRunDirAuditFiles` (lines 650-675): before `fs.cpSync`, `fs.rmSync(path.join(destDir, 'staged'), { recursive: true, force: true })`; extend its comment (a tracked trail's resolved item must not survive at its old worktree path, #4565)
- Test: `tests/hooks-adopt-run-dir.test.js`

**Interfaces:** none new; the verb's stdout is unchanged.

- [ ] **Step 1: Write the failing test** `adopt-run-dir mirrors staged/: a file gone from the source is gone from the worktree copy, a nested applied/ item is copied` — pre-create `staged/tidy-delete-1.md` in the worktree copy; source holds only `staged/applied/tidy-delete-1.md`; after the verb, the worktree's old path is absent and the nested one present.

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/hooks-adopt-run-dir.test.js`
Expected: FAIL after Step 1 — the stale worktree file survives.

- [ ] **Step 3: Implement** the Files change.

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/hooks-adopt-run-dir.test.js tests/hooks-js-flag-strict.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/hooks.js tests/hooks-adopt-run-dir.test.js
git commit -m "Mirror staged/ in adopt-run-dir so a resolved item leaves its old worktree path (refs #4565)"
```

### Task 6: Skill prose — approve-mode, Step 7.5, attention row

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/skills/tidy/approve-mode.md` (5,598 B; rail 52,500 B)
- Modify: `plugin/skills/tidy/step-7-5-worktree-always.md` (9,939 B) — first paragraph only
- Modify: `plugin/skills/backlog/attention-mode.md` (24,140 B) — `### Tidy row` only
- Modify: `plugin/skills/tidy/SKILL.md:218` and `plugin/skills/sweep/SKILL.md:82` — "a closed directory that still holds staged items stays approvable" → "still holds actionable staged items"
- Modify: `plugin/skills/tidy/step-6-auto.md:119` — "still holding `staged/` items" → "still holding actionable `staged/` items"
- Modify: `tests/tidy-residue-markers.test.js:194-229` — re-point the two pinned sentences to their new wording
- Create: `tests/tidy-approve-staged-outcome-conformance.test.js`
- No change (checked): `tests/worktree-forge-api-carve-out.test.js`'s `assertStep75Gate` phrases (`provision no worktree`, `skip the commit`, `working-tree write`, the provisioning sentence) must survive the Step 7.5 edit; `tests/tidy-plan-retention-conformance.test.js`'s decline-sentence ordering must survive the approve-mode edit; `tests/backlog-attention-rows.test.js` and `tests/sweep-orchestrator.test.js` pins (`run /claude-tweaks:tidy --approve`, `tidy proposal(s) staged awaiting approval`, an IL-127/Anchoring citation) must survive. `tidy/SKILL.md`'s Archive row stays flag-free: reconcile-side archival keeps the `audit-untracked` refusal (the record's Trail ruling).

**Interfaces:**
- Consumes: Task 2's command lines and Task 4's `--local-trail`, written with `${CLAUDE_PLUGIN_ROOT}` like the file's existing commands.

Edits:
1. `approve-mode.md` "Resolving the target run": the no-arg default and walk-back select runs with one or more **actionable** staged items — `node "${CLAUDE_PLUGIN_ROOT}/bin/staged-items.js" --run "{dir}" --list`'s `actionable` array non-empty (top-level files of `staged/`; `staged/applied/` and `staged/declined/` hold resolved items). An explicit target with no actionable item reports `nothing staged in {run-dir}`.
2. "Re-entering the Approve rendering": add one sentence — an actionable id with no `.json` sidecar renders no row; show it by id beside the section, as one row labelled by its id.
3. A new `## Recording each item's outcome` section, after "Executing the approved set". Each Approve row is one element of a staged item's `staged/{id}.json` array (render order: filename-sorted files, array order). Once Step 7.5's verification checklist has run and before its commit — before `adopt-run-dir` under `pr-first`, so a committed trail carries the outcomes — write the settle file with the Write tool to the path `node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" --value tidy-approve-rows-{run-id}.json` prints: `{ "{id}": [ { "row": "{row title}", "outcome": "applied|excluded|stale|failed" } ] }`, one entry per row of every item the Approve section showed — `excluded` when the human excluded it, `stale` when re-verify reported `stale — skipped`, `failed` when its action failed or its checklist line did not pass, `applied` otherwise. Then `node "${CLAUDE_PLUGIN_ROOT}/bin/staged-items.js" --run "{run-dir}" --settle --rows-file "{path}"`. The row rule, stated once: at least one row applied and none failed resolves the item `applied` (`staged/applied/`), its excluded or stale rows named on the same `decisions.md` line; every row excluded or stale, in any mix, moves it to `staged/declined/`; any failed row leaves it actionable in `staged/`. The CLI logs each item's line; only on `"logged":false` log that item by hand with `log-decision.js`. Exit 4 is reported per item and stops archival; exit 2 or 3 is fixed and re-run.
4. "Archiving the run": archive only when `--settle`'s `actionable` is empty; otherwise report the actionable ids and stop — the run stays listed and a later `--approve` retries them. When no commit of this approval carries the run's trail (`adopt-run-dir` did not run — the forge-only set Step 7.5 skips, see `step-7-5-worktree-always.md`'s first paragraph), archive right after `--settle` with `close-run` then `node "${CLAUDE_PLUGIN_ROOT}/bin/hooks.js" archive-run --run "{run-dir}" --local-trail`; otherwise archive once Step 7.5's commit lands, as today, without the flag. One bullet on the flag: `--local-trail` moves a never-committed `decisions.md`/`report.md`/`staged/` into `archive/` by plain move and carries a fully tracked trail through its usual `git mv` commit; it refuses `local-trail-actionable` while any staged item is actionable, `audit-untracked` when the trail is partly tracked, and `local-trail-not-standalone` on any other run. Keep the sentence on stale items surviving archival, re-pointed at `staged/declined/`.
5. `step-7-5-worktree-always.md` first paragraph: after "The run dir's audit files then stay uncommitted at `$RUN_ROOT`, exactly as when `worktree-always` is off." append "`approve-mode.md`'s Archiving the run archives such a run with `archive-run --local-trail`."
6. `attention-mode.md` Tidy row: "When `node "${CLAUDE_PLUGIN_ROOT}/bin/staged-items.js" --run "{dir}" --list` reports one or more `actionable` ids, render … with `{count}` the number of actionable ids"; omit the row when the directory is absent or `actionable` is empty (a run whose items were all applied or declined, or a refused `--list`). Keep the accepted-limitation paragraph, reworded from "non-empty `staged/`"/"empty-`staged/`" to "actionable"/"no actionable".

- [ ] **Step 1: Write the failing conformance test** `tests/tidy-approve-staged-outcome-conformance.test.js` (read files with `tests/helpers/read-skill`'s `readText`). Factor each file's assertions into one function; each go-red control runs that same function on a mutated copy and expects it to throw:
  - `AC4.1: approve-mode records outcomes through --settle` — contains `--settle --rows-file`, each of `excluded`, `stale`, `failed`; `## Recording each item's outcome` precedes `## Archiving the run`; the outcome section names `adopt-run-dir`.
  - `AC5.1, AC5.2, AC5.3: approve-mode states the row rule` — contains `at least one row applied and none failed`, `every row excluded or stale, in any mix`, `any failed row leaves it actionable`.
  - `AC2.1: approve-mode archives a forge-only run with --local-trail, only with nothing actionable` — contains `archive-run --run "{run-dir}" --local-trail`, `local-trail-actionable`, `archive only when`.
  - `AC1.1: attention-mode's Tidy row counts actionable ids from staged-items.js --list` — the `### Tidy row` section contains `bin/staged-items.js" --run "{dir}" --list` and `actionable`, and no longer contains `holds one or more files`.
  - `step-7-5 points forge-only archival at --local-trail` — contains `archive-run --local-trail`.
  - Go-red controls: removing `--local-trail` from approve-mode, and replacing `--list` in attention-mode's row with `--lst`, each make the shared assertion function throw.

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/tidy-approve-staged-outcome-conformance.test.js`
Expected: FAIL (phrases absent)

- [ ] **Step 3: Make edits 1-6**, the `SKILL.md:218`, `sweep/SKILL.md:82` and `step-6-auto.md:119` wording, and re-point `tests/tidy-residue-markers.test.js`'s two pinned sentences.

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/tidy-approve-staged-outcome-conformance.test.js tests/tidy-residue-markers.test.js tests/worktree-forge-api-carve-out.test.js tests/tidy-plan-retention-conformance.test.js tests/backlog-attention-rows.test.js tests/sweep-orchestrator.test.js tests/raw-markdown-read-conformance.test.js tests/skill-fence-guard-shapes.test.js`
Expected: PASS

- [ ] **Step 5: Behavior-change sweep.** Run `git grep -n -i -E "holds one or more files|non-empty .?staged|empty-.?staged|holds staged items|holding .?staged" -- plugin/skills/tidy plugin/skills/backlog plugin/skills/sweep` and confirm every remaining hit is reworded or a pre-approval site.

- [ ] **Step 6: Commit**

```bash
git add plugin/skills/tidy/approve-mode.md plugin/skills/tidy/step-7-5-worktree-always.md plugin/skills/tidy/SKILL.md plugin/skills/tidy/step-6-auto.md plugin/skills/sweep/SKILL.md plugin/skills/backlog/attention-mode.md tests/tidy-approve-staged-outcome-conformance.test.js tests/tidy-residue-markers.test.js
git commit -m "Record tidy --approve outcomes and archive forge-only runs with --local-trail (refs #4565)"
```
