# Tidy --approve Forge-Only Archival Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After `/claude-tweaks:tidy --approve` resolves a run's staged items, record each item's outcome on disk so the SessionStart notice and `backlog attention` stop counting it, and give a forge-only approval run an archivable terminal state with no manual git step.

**Architecture:** One on-disk representation, read through one helper: an item still awaiting approval is a top-level file in `staged/`; a resolved item's files move into `staged/applied/` or `staged/declined/`. `plugin/bin/lib/stage-item/outcome.js` owns that rule (list actionable ids, move an item); `plugin/bin/staged-items.js` exposes it to skill prose (`--list`, `--resolve`); the code readers (`session-residue.js`, the residue `pipeline-runs` probe, `archive-run --local-trail`) call the helper, and the prose readers (`tidy/approve-mode.md`'s run resolution, `backlog/attention-mode.md`'s Tidy row) call the CLI. Deliverable 2 takes the second option: `hooks.js archive-run --local-trail` archives a closed tidy/sweep standalone run whose audit trail was never committed, by plain filesystem move, when no staged item is still actionable. Why not the housekeeping-PR option: a forge-only approval changes no tracked file, so a PR would exist only to carry its own audit log, costing a worktree, CI and a merge per approval (#3409, #3410, #4075 and #4470 are that cost paid by hand); the archive path is gitignored, so a local move loses nothing that was ever in git.

**Tech Stack:** Node 18+ CommonJS, `node --test`, markdown skill prose.

**Spec:** `.claude-tweaks/pipelines/2026-10-31T135904-record-4565/work/4565-spec.md`

Scope keywords: collectApprovableStandalone, hasStagedEntries, audit-untracked, staged/applied, staged/declined, local-trail

## Global Constraints

- Shipped code lives under `plugin/`; tests under `tests/`. `npm test` runs everything; run single files with `node --test {path}`.
- Path-guard lint (`tests/path-guard-conformance.test.js`): no new `existsSync` or `realpathSync` token in any `plugin/bin/**` file, comments excluded. Use `plugin/bin/lib/path-guard`'s `lstatType(p).type` (`'file'`/`'dir'`/`'missing'`/…) instead. Files on that test's allowlist (`archive-merged.js`, `session-residue.js`, `pipeline-runs.js`, `hooks.js`) must keep their exact counts; removing `pipeline-runs.js`'s `hasStagedEntries` does not change its count (it uses `readdirSync`).
- CLI shape (from `.claude/skills/gh-api-module-pattern/cli-wrapper-contract.md`): `run(argv, deps)` exported, `if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);` as the entry guard (the exit-code conformance scan reads this guard). A run-dir writer refuses a non-anchored `--run` through `plugin/bin/lib/stage-item/write.js`'s `resolveTarget` with exit **3** ("Import the copy that sits beside the writer you call when you add another writer instead of re-deriving the predicate"). "A CLI that reports a decision as data logs that entry itself; the skill hand-logs it only when the CLI reports the append failed."
- hooks.js flag on an existing verb (from `.claude/skills/hooks-js-verb-registration/SKILL.md`, "Adding a flag to an existing verb"): site 1 "The verb's `usage` string in `VERBS` — Always: append `[--{flag}]`"; site 2 "The handler's option parse — Always: `args.includes('--{flag}')` for a boolean … passed through to the lib call"; site 3 `KNOWN_FLAGS` "Only when the verb has an entry there" (`archive-run` has none — no change); site 5 "The doc that owns the verb's call — Always: the usage line plus one bullet on the flag's semantics" (`archive-run` has no `_shared` home doc; its caller here is `tidy/approve-mode.md`, which carries the bullet); site 6 "A CLI spawn test that the flag reaches the handler, whose negative half runs the same args without the flag and asserts the old reason, not just the exit code … and a pin on the home doc's usage line." Flag decision 1: "A verb with no `KNOWN_FLAGS` entry ignores an unknown flag, so a misspelled flag runs the verb as if the flag were absent. Keep the without-flag path the safe one and byte-for-byte unchanged for existing callers."
- Decision-log lines go through `plugin/bin/lib/log-decision/append.js` (`formatEntry` + `appendEntry`), status `AUTO`, reversibility `high`.
- Test names cite acceptance-criterion clause ids (`AC1.1` … `AC4.2`, below).

AC clause ids: AC1.1 — forge-only approval → next SessionStart omits the run and `backlog attention`'s tidy row omits it. AC2.1 — the run reaches an archived (or documented terminal) state without a manual git step. AC3.1 — a run with at least one actionable item is still listed by both readers. AC4.1 — an item excluded at the prompt or skipped `stale — skipped` moves to `staged/declined/` with one `decisions.md` line. AC4.2 — neither reader counts a declined item, and `archive-run --local-trail` treats it as resolved.

## Review Focus

1. A partially tracked trail (one staged file merged through an earlier PR, one not) under `--local-trail`: a plain move would strand the tracked blob at the old path (#593). Expected: refuse `audit-untracked` exactly as today. Test in Task 4.
2. An item id that is a prefix of another (`tidy-delete-1` vs `tidy-delete-10`): resolving one must not move the other's files. Test in Task 1.
3. Resolving an item already moved (a re-run of `--approve` after a partial failure): expected exit 4 `not-found`, nothing moved, nothing logged. Test in Task 2.
4. A staged/ holding only `applied/` and `declined/` subdirectories plus a dotfile: zero actionable ids, so both readers omit the run. Test in Task 1 (helper) and Task 3 (readers).
5. `--local-trail` on a run with an actionable item left: refuse with a reason naming the ids, run dir untouched, archive twin removed. Test in Task 4.

---

### Task 1: The staged-outcome helper

**Role:** integration

**Files:**
- Create: `plugin/bin/lib/stage-item/outcome.js`
- Test: `tests/bin-lib/stage-item/outcome.test.js`

**Interfaces:**
- Produces:
  - `OUTCOMES` — frozen `['applied', 'declined']`.
  - `listActionableStaged(runDir: string) -> string[]` — sorted unique item ids: for each top-level entry of `{runDir}/staged/` that is a regular file (`withFileTypes`, `isFile()`) and whose name does not start with `.`, the id is `path.basename(name, path.extname(name))`. Subdirectories (including `applied/`, `declined/`) are never items. Missing `staged/` → `[]`; any other read error → `[]` (readers are advisory; matches `session-residue.js`'s existing `catch { continue; }`).
  - `listResolvedStaged(runDir: string, outcome: 'applied'|'declined') -> string[]` — same id rule over `staged/{outcome}/`.
  - `resolveStagedItem({ runDir, id, outcome }) -> { ok: true, moved: string[] } | { ok: false, reason: 'not-found'|'destination-exists'|'move-failed', detail?: string }` — `moved` holds the moved files' names relative to `staged/` (e.g. `applied/tidy-delete-1.md`). Matches files whose computed id equals `id` exactly. Checks every destination with `lstatType` before moving any file — any `type` other than `'missing'` is `destination-exists`, which moves nothing; `fs.mkdirSync(staged/{outcome}, { recursive: true })`, then `fs.renameSync` per file; a rename failure after an earlier rename renames the earlier ones back and returns `move-failed` with the error message. Throws `TypeError` for an `outcome` not in `OUTCOMES`.

- [ ] **Step 1: Write the failing tests** in `tests/bin-lib/stage-item/outcome.test.js`, each in a fresh `fs.mkdtempSync` dir, staging items with the real writer (`writeStagedItem` + `writeStagedSidecar` from `plugin/bin/lib/stage-item/write.js`) so the fixture is what tidy writes:
  - `AC3.1: listActionableStaged returns each staged item id once` — stage `tidy-delete-1` (.md + .json) and `digest-promotion-2` (.md + .json) → `['digest-promotion-2', 'tidy-delete-1']`.
  - `AC4.2: resolved items and dotfiles are not actionable` — after `resolveStagedItem` of `tidy-delete-1` to `applied` and `digest-promotion-2` to `declined`, plus a `staged/.DS_Store` file → `listActionableStaged` is `[]`, `listResolvedStaged(dir,'applied')` is `['tidy-delete-1']`, `listResolvedStaged(dir,'declined')` is `['digest-promotion-2']`.
  - `resolveStagedItem moves every file of the id and only that id` — stage `tidy-delete-1` and `tidy-delete-10`; resolve `tidy-delete-1` → `moved` deep-equals `['applied/tidy-delete-1.json', 'applied/tidy-delete-1.md']` (sorted); `tidy-delete-10.md`/`.json` still top-level.
  - `resolveStagedItem refuses not-found and destination-exists without moving` — unknown id → `{ ok: false, reason: 'not-found' }`; pre-create `staged/declined/tidy-delete-1.md`, resolve `tidy-delete-1` to `declined` → `destination-exists` and both top-level files still present.
  - `listActionableStaged on a missing staged/ is empty`.
  - `resolveStagedItem rejects an unknown outcome` — `assert.throws(..., TypeError)` for `'skipped'`.

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/bin-lib/stage-item/outcome.test.js`
Expected: FAIL with `Cannot find module '../../../plugin/bin/lib/stage-item/outcome'`

- [ ] **Step 3: Implement `plugin/bin/lib/stage-item/outcome.js`** per the Interfaces block. Header comment: the representation rule (top-level file = actionable; `applied/`/`declined/` = resolved), #4565, and the reader roster (session-residue.js, residue/probes/pipeline-runs.js, archive-merged.js `--local-trail`, staged-items.js). No `existsSync`/`realpathSync` tokens.

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/bin-lib/stage-item/outcome.test.js`
Expected: PASS

- [ ] **Step 5: Real-input probe.** Copy `"/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines/archive/2026-10-28T172007-sweep-standalone"` to a scratchpad dir (`cp -R`), run `node -e` requiring the helper's `listActionableStaged` on the copy, and independently count `ls {copy}/staged/*.json | wc -l`. Expected: 5 ids (`digest-promotion-1` … `-4`, `tidy-delete-1`) and the independent count 5. Record both numbers in the task report.

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/lib/stage-item/outcome.js tests/bin-lib/stage-item/outcome.test.js
git commit -m "Add staged-outcome helper — one actionable/applied/declined rule for staged/ (refs #4565)"
```

### Task 2: `staged-items.js` CLI

**Role:** integration

**Files:**
- Create: `plugin/bin/staged-items.js`
- Modify: `docs/plugin-structure.md` (the `plugin/bin/lib/stage-item/` line 39: add `outcome.js` — the actionable/resolved rule and `resolveStagedItem`, consumed by staged-items.js, hooks/session-residue.js, residue/probes/pipeline-runs.js and reconcile/archive-merged.js; and one CLI line beside the `stage-item.js` line ~196)
- Test: `tests/bin-lib/stage-item/staged-items-cli.test.js`

**Interfaces:**
- Consumes: Task 1's `listActionableStaged`, `listResolvedStaged`, `resolveStagedItem`; `resolveTarget` and `sanitizeId` from `plugin/bin/lib/stage-item/write.js`; `formatEntry`, `appendEntry` from `plugin/bin/lib/log-decision/append.js`.
- Produces (the command lines Task 5's prose uses verbatim):
  - `node plugin/bin/staged-items.js --run <run-dir> --list` → stdout one JSON line `{"actionable":[…],"applied":[…],"declined":[…]}`, exit 0.
  - `node plugin/bin/staged-items.js --run <run-dir> --resolve <id> --outcome applied` and `… --resolve <id> --outcome declined --reason excluded|stale` → moves the item, appends one `decisions.md` line, prints one JSON line `{"id":…,"outcome":…,"moved":[…],"logged":true|false}`, exit 0.
  - Exit codes: 0 done; 2 malformed invocation (missing `--run`; neither or both of `--list`/`--resolve`; `--outcome` missing or not `applied|declined`; `--reason` missing with `declined`, present with `applied`, or not `excluded|stale`; an id `sanitizeId` rejects; an unknown flag; a value flag given last with no value); 3 run dir missing or not anchored (`resolveTarget`); 4 the item refusal from `resolveStagedItem` (stderr `staged-items.js: refused ({reason}): …`). A failed `appendEntry` after a successful move is not an exit code: `logged: false` on stdout plus a stderr line, exit 0 — the caller then hand-logs.
  - Log line: `formatEntry({ status: 'AUTO', now: deps.now(), step: 'tidy --approve', text, reversibility: 'high' })` appended under section `'/tidy'`, where `text` is `staged item {id} applied → staged/applied/` or `staged item {id} declined ({excluded at the approval prompt | stale — skipped by re-verify}) → staged/declined/`.

- [ ] **Step 1: Write the failing tests**, spawning the real CLI (`execFileSync('node', [CLI, …])`) against a `git init` main-checkout fixture with the run dir at `{root}/.claude-tweaks/pipelines/2026-10-31T120000-tidy-standalone/` (staged via the real writer), plus `run(argv, deps)` calls for the log-failure case:
  - `--list prints actionable, applied and declined ids` — two staged items, one pre-resolved → exact JSON.
  - `AC4.1: --resolve … --outcome declined --reason excluded moves the item and logs one decisions.md line` — exit 0; files under `staged/declined/`; `decisions.md` contains exactly one line matching `/AUTO .* — tidy --approve: staged item tidy-delete-1 declined \(excluded at the approval prompt\) → staged\/declined\/\. Reversibility: high\./`.
  - `AC4.1: --reason stale logs the stale-skipped wording` — `/declined \(stale — skipped by re-verify\)/`.
  - `--outcome applied moves into staged/applied/ and logs` — exit 0, `logged: true`.
  - `resolving an already-moved item exits 4 not-found and logs nothing` — second identical call → exit 4, stderr `/refused \(not-found\)/`, `decisions.md` line count unchanged.
  - `usage errors exit 2` — one assertion each: no `--run`; `--list --resolve x`; `--outcome skipped`; `declined` without `--reason`; `applied --reason stale`; `--resolve ../x`; `--bogus`; `--outcome` as the last token.
  - `a worktree-local shadow run dir exits 3 and leaves the shadow byte-unchanged` — fixture with a linked worktree (`git worktree add`) holding a copy of the run dir; `--resolve` against the shadow path → exit 3, shadow `staged/` listing unchanged.
  - `a failed decisions.md append reports logged:false and still exits 0` — `run(argv, { ...realDeps, appendEntry: () => { throw new Error('disk full'); } })` → returns 0, stdout JSON `logged: false`, files moved.

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/bin-lib/stage-item/staged-items-cli.test.js`
Expected: FAIL (CLI file absent: `Cannot find module` / ENOENT)

- [ ] **Step 3: Implement `plugin/bin/staged-items.js`** with `parseArgs(argv)` (render-tidy-report.js's `next()` shape, rejecting an `undefined` value), `realDeps = { resolveTarget, listActionableStaged, listResolvedStaged, resolveStagedItem, appendEntry, now: () => new Date(), stdout, stderr }`, and the exit codes above. Header comment documents usage, every exit code, the `logged: false` contract, and that `--list` is a read that still refuses an unanchored `--run` (exit 3) so a worktree shadow never yields a confident wrong count. Then add the two `docs/plugin-structure.md` entries.

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/bin-lib/stage-item/staged-items-cli.test.js tests/path-guard-conformance.test.js tests/bin-lib/exit-code-conformance.test.js tests/windows-hide-spawn-conformance.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/staged-items.js tests/bin-lib/stage-item/staged-items-cli.test.js docs/plugin-structure.md
git commit -m "Add staged-items.js — list and resolve a run's staged items (refs #4565)"
```

### Task 3: Both code readers count only actionable items

**Role:** integration

**Files:**
- Modify: `plugin/bin/lib/hooks/session-residue.js:111-129` (`collectApprovableStandalone`: replace the `readdirSync` + `staged.length` test with `listActionableStaged(dir).length === 0 → continue`; update its comment to "still carry actionable `staged/` proposals")
- Modify: `plugin/bin/lib/residue/probes/pipeline-runs.js` (lines 62-70 and 104-111: delete `hasStagedEntries`; the #4138 exemption calls `listActionableStaged(dir).length > 0`; update the comment's "still holds staged items" to "still holds actionable staged items")
- Test: `tests/bin-lib/hooks/session-residue.test.js`
- Test: `tests/bin-lib/residue/probes-pipeline-runs.test.js`
- No change (checked): `plugin/bin/lib/hooks/session-start.js` only prints `collectApprovableStandalone`'s lines; its banner text stays.

**Interfaces:**
- Consumes: Task 1's `listActionableStaged`, `resolveStagedItem`.

Consumer classification for the other `staged/` readers (no change, recorded so review can check it): `render-tidy-report/render.js` already reads only top-level `*.json` files (`isFile()`), so resolved items drop out of a re-rendered Approve section by construction; `reconcile/archive-merged.js`'s `listStagedItems` serves only the console-less auto-merge guard, which a tidy/sweep standalone run never trips (no auto-merge line in its `decisions.md`); `hooks/staged-inventory.js` checks pipeline runs' `STAGED` lines on `/flow` resume and never reads a tidy/sweep standalone run; `stage-item/write.js`'s `listExistingNumbers` (`--allocate`) is not used by tidy's Step 6 staging call; `hooks/context.js:131`'s best-effort empty-`staged/` `rmdir` simply no-ops on a dir holding `applied/`.

- [ ] **Step 1: Write the failing tests.** In `session-residue.test.js`, using the file's `tmpProject`/`mkRun` helpers but staging through `writeStagedItem` and resolving through `resolveStagedItem`:
  - `AC1.1: a clean sweep-standalone run whose every staged item was applied or declined is not listed` → `collectApprovableStandalone(project)` deep-equals `[]`.
  - `AC3.1: a run with one actionable item beside resolved ones is still listed` → one entry whose `line` contains `tidy --approve`.
  - `AC4.2: a run whose only items are declined is not listed`.
  In `probes-pipeline-runs.test.js` (follow the file's existing #4138 fixture):
  - `AC4.2: a clean tidy-standalone run with only applied/declined items is no longer exempt` → it appears in `findings`.
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
- Modify: `plugin/bin/lib/reconcile/archive-merged.js` — `archiveRunDir(root, runDir, { localTrail = false } = {})` (line ~1260) and the standalone audit block (~1438-1467)
- Modify: `plugin/bin/hooks.js` — `VERBS['archive-run'].usage` (line 131) → `'archive-run [--run <dir>] [--local-trail]'`; `runArchiveRun` (line ~1236): `const localTrail = argv.slice(3).includes('--local-trail');` and `archiveRunDir(mainRoot, runDir, { localTrail })`
- Test: `tests/bin-lib/reconcile/archive-merged.test.js`
- Test: `tests/archive-run-verb.test.js`

**Interfaces:**
- Consumes: Task 1's `listActionableStaged`.
- Produces: `archiveRunDir(root, runDir, { localTrail })`; new refusal reason `local-trail-actionable` with `{ actionable: string[], hint }`. Every existing caller passes no third argument and is byte-for-byte unchanged.

Behaviour, in the `/-(tidy|sweep)-standalone/` block, after `untrackedAuditFiles` is computed and before the existing `audit-untracked` return:
1. `localTrail` false → unchanged.
2. `localTrail` true and at least one audit entry (`decisions.md`, `report.md`, `staged`) is tracked or partially tracked → unchanged `audit-untracked` refusal (a partly committed trail belongs to a PR; moving it by hand strands the tracked blob, #593). "Partially tracked" for `staged`: `git ls-files -z -- {runDir}/staged` (the existing `runGit` helper) prints anything.
3. `localTrail` true, nothing tracked, `listActionableStaged(runDir)` non-empty → `refuseAfterMarker('local-trail-actionable', { actionable, hint: 'staged item(s) still awaiting approval: {ids} — run /claude-tweaks:tidy --approve "{runDir}" first' })`.
4. Otherwise skip the refusal: the untracked audit entries were never pushed to `workMoves`, so the existing top-level move loop moves them with `moveArchiveEntry` like every other untracked entry; with no `work/`, no git command runs.

Also append to the `audit-untracked` hint: ` If this trail was never committed by design (a tidy --approve run whose approved set made no commit), re-run with --local-trail.` — keep the existing sentence so `/sync this checkout with origin/` still matches.

- [ ] **Step 1: Write the failing tests.** In `archive-merged.test.js` (reuse `makeRepo`, `commitPath`, `trackedFiles`; write run-state with the real writer `closeRunState(runDir)` from `plugin/bin/lib/hooks/close-run-state.js` after seeding `{status:'active'}`):
  - `AC2.1: localTrail archives an untracked forge-only trail whose items are all resolved` — untracked `decisions.md`, `report.md`, `staged/applied/tidy-delete-1.md` → `ok: true`; run dir gone; `archive/{runId}/staged/applied/tidy-delete-1.md` and `archive/{runId}/decisions.md` exist; `git log --oneline` count unchanged (no commit made).
  - `AC4.2: localTrail treats declined items as resolved` — only `staged/declined/…` → `ok: true`.
  - `AC3.1: localTrail refuses local-trail-actionable while an item is actionable` — one top-level `staged/tidy-delete-2.md` → `reason: 'local-trail-actionable'`, `actionable` deep-equals `['tidy-delete-2']`, `staged/tidy-delete-2.md` still at the run dir, `archive/{runId}/decisions.md` absent.
  - `localTrail still refuses audit-untracked for a partially tracked staged/` — `commitPath` one `staged/applied/a.md`, leave `staged/applied/b.md` untracked → `reason: 'audit-untracked'`. Deleting rule 2 must turn this red (state it in the test comment).
  - `without localTrail the forge-only trail still refuses audit-untracked, and the hint names --local-trail` — same fixture as the first test, no option → `audit-untracked`, `hint` matches `/--local-trail/` and `/sync this checkout with origin/`.
  In `archive-run-verb.test.js` (spawn, mirroring the existing sweep-standalone audit-untracked test):
  - `AC2.1: archive-run --local-trail archives a closed forge-only sweep-standalone run` — stdout matches `/claude-tweaks: archived 2026-08-14T120000-sweep-standalone/`; same args without `--local-trail` → stdout matches `/archival refused — audit-untracked/` (the old reason, not just the exit code).
  - `archive-run --local-trail with an actionable item prints local-trail-actionable` — `/archival refused — local-trail-actionable — staged item\(s\) still awaiting approval: tidy-delete-2/`.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/bin-lib/reconcile/archive-merged.test.js tests/archive-run-verb.test.js`
Expected: FAIL after Step 1 — the new cases get `audit-untracked`.

- [ ] **Step 3: Implement** the four rules and the hooks.js changes. Guard discrimination: rule 2's test and rule 3's test each fail when only that rule is deleted.

- [ ] **Step 4: Run to verify they pass**

Run: `node --test tests/bin-lib/reconcile/archive-merged.test.js tests/archive-run-verb.test.js tests/hooks-help-guard.test.js tests/hooks-dispatcher.test.js tests/path-guard-conformance.test.js tests/reconcile.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/reconcile/archive-merged.js plugin/bin/hooks.js tests/bin-lib/reconcile/archive-merged.test.js tests/archive-run-verb.test.js
git commit -m "Add archive-run --local-trail — archive a never-committed tidy trail once nothing is actionable (refs #4565)"
```

### Task 5: Skill prose — approve-mode, Step 7.5, attention row

**Role:** integration

**Files:**
- Modify: `plugin/skills/tidy/approve-mode.md` (5,598 B; rail 52,500 B — ample headroom)
- Modify: `plugin/skills/tidy/step-7-5-worktree-always.md` (9,939 B) — first paragraph only
- Modify: `plugin/skills/backlog/attention-mode.md` (24,140 B) — `### Tidy row` only
- Modify: `plugin/skills/tidy/SKILL.md:218` — "a closed directory that still holds staged items stays approvable" → "still holds actionable staged items"
- Modify: `tests/tidy-residue-markers.test.js:194-229` — re-point the two pinned sentences to their new wording
- Create: `tests/tidy-approve-staged-outcome-conformance.test.js`
- No change (checked): `plugin/skills/sweep/SKILL.md:79` renders staged/ before any approval exists; `tests/worktree-forge-api-carve-out.test.js`'s `assertStep75Gate` phrases (`provision no worktree`, `skip the commit`, `working-tree write`, the provisioning sentence) must survive the Step 7.5 edit; `tests/tidy-plan-retention-conformance.test.js`'s decline-sentence ordering must survive the approve-mode edit; `tests/backlog-attention-rows.test.js` and `tests/sweep-orchestrator.test.js` pins (`run /claude-tweaks:tidy --approve`, `tidy proposal(s) staged awaiting approval`, an IL-127/Anchoring citation) must survive.

**Interfaces:**
- Consumes: Task 2's command lines and Task 4's `--local-trail`, written with `${CLAUDE_PLUGIN_ROOT}` like the file's existing commands.

Edits:
1. `approve-mode.md` "Resolving the target run": the no-arg default and walk-back select runs with one or more **actionable** staged items — `node "${CLAUDE_PLUGIN_ROOT}/bin/staged-items.js" --run "{dir}" --list`'s `actionable` array non-empty (top-level files of `staged/`; `staged/applied/` and `staged/declined/` hold resolved items). An explicit target with no actionable item reports `nothing staged in {run-dir}`.
2. After "Re-entering the Approve rendering": a new `## Recording each item's outcome` section. An item (one `staged/{id}.*` pair) whose every Approve row the human excluded → `staged-items.js --run "{run-dir}" --resolve {id} --outcome declined --reason excluded`; an item re-verify reports `stale — skipped` (all its rows) → `--reason stale`; an item whose Step 7 action landed and passed Step 7.5's verification checklist → `--outcome applied`; an item whose action failed is left in `staged/` (still actionable, so both notices keep showing it). These calls run after Step 7.5's verification checklist and before its commit — before `adopt-run-dir` under `pr-first` — so a committed trail carries the outcomes. Each call logs its own `decisions.md` line; only on `"logged":false` log the same text by hand with `log-decision.js`. A non-zero exit is reported and stops archival (exit 4 names the item and reason).
3. "Archiving the run": when no commit of this approval carries the run's trail (`adopt-run-dir` did not run — the forge-only set Step 7.5 skips, see `step-7-5-worktree-always.md`'s first paragraph), archive right after the outcome calls with `close-run` then `node "${CLAUDE_PLUGIN_ROOT}/bin/hooks.js" archive-run --run "{run-dir}" --local-trail`; otherwise archive once Step 7.5's commit lands, as today, without the flag. One bullet on the flag: `--local-trail` moves a never-committed `decisions.md`/`report.md`/`staged/` into `archive/` by plain move; it refuses `local-trail-actionable` while any staged item is still actionable and `audit-untracked` when any of the trail is tracked.
4. `step-7-5-worktree-always.md` first paragraph: after "The run dir's audit files then stay uncommitted at `$RUN_ROOT`, exactly as when `worktree-always` is off." append "`approve-mode.md`'s Archiving the run archives such a run with `archive-run --local-trail`."
5. `attention-mode.md` Tidy row: "When `node "${CLAUDE_PLUGIN_ROOT}/bin/staged-items.js" --run "{dir}" --list` reports one or more `actionable` ids, render … with `{count}` the number of actionable ids"; omit the row when the directory is absent or `actionable` is empty (a run whose items were all applied or declined, or a refused/failed `--list`). Keep the accepted-limitation paragraph, reworded from "non-empty `staged/`"/"empty-`staged/`" to "actionable"/"no actionable".

- [ ] **Step 1: Write the failing conformance test** `tests/tidy-approve-staged-outcome-conformance.test.js` (read files with `tests/helpers/read-skill`'s `readText`). Factor each file's assertions into one function; each go-red control runs that same function on a mutated copy and expects it to throw:
  - `AC4.1: approve-mode records excluded and stale items as declined` — contains `--outcome declined --reason excluded` and `--outcome declined --reason stale` and `--outcome applied`; the `## Recording each item's outcome` heading precedes `## Archiving the run`; the outcome section names `adopt-run-dir` (ordering before the commit).
  - `AC2.1: approve-mode archives a forge-only run with --local-trail` — contains `archive-run --run "{run-dir}" --local-trail` and `local-trail-actionable`.
  - `AC1.1: attention-mode's Tidy row counts actionable ids from staged-items.js --list` — the `### Tidy row` section contains `bin/staged-items.js" --run "{dir}" --list` and `actionable`, and no longer contains `holds one or more files`.
  - `step-7-5 points forge-only archival at --local-trail` — contains `archive-run --local-trail`.
  - Go-red controls: removing `--local-trail` from approve-mode, and replacing `--list` in attention-mode's row with `--lst`, each make the shared assertion function throw.

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/tidy-approve-staged-outcome-conformance.test.js`
Expected: FAIL (phrases absent)

- [ ] **Step 3: Make edits 1-5**, the `SKILL.md:218` wording, and re-point `tests/tidy-residue-markers.test.js`'s two pinned sentences to the new text.

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/tidy-approve-staged-outcome-conformance.test.js tests/tidy-residue-markers.test.js tests/worktree-forge-api-carve-out.test.js tests/tidy-plan-retention-conformance.test.js tests/backlog-attention-rows.test.js tests/sweep-orchestrator.test.js tests/raw-markdown-read-conformance.test.js tests/skill-fence-guard-shapes.test.js`
Expected: PASS

- [ ] **Step 5: Behavior-change sweep.** Run `git grep -n -i -E "holds one or more files|non-empty .?staged|empty-.?staged|staged/.? (holds|is empty)" -- plugin/skills/tidy plugin/skills/backlog` and confirm every remaining hit is either reworded or a pre-approval site (`sweep/SKILL.md:79` is outside this grep's paths by design).

- [ ] **Step 6: Commit**

```bash
git add plugin/skills/tidy/approve-mode.md plugin/skills/tidy/step-7-5-worktree-always.md plugin/skills/tidy/SKILL.md plugin/skills/backlog/attention-mode.md tests/tidy-approve-staged-outcome-conformance.test.js tests/tidy-residue-markers.test.js
git commit -m "Record tidy --approve outcomes and archive forge-only runs with --local-trail (refs #4565)"
```
