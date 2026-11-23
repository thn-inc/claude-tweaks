# In-Flight Run Merge Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop another session from marking a pipeline run's draft PR ready or merging it while the run is still building, and stop reconcile from settling such a mid-build ("hollow") merge as shipped.

**Architecture:** A new lazily-loaded PreToolUse gate module (`inflight-pr-gate.js`, wired into `pre-tool-use.js`'s `runInner`) parses `gh pr ready|merge` calls out of a Bash command with a new `git-command.js` parser, reads the PR body via `gh pr view`, resolves the run its first-line `claude-tweaks-run:` marker names in the main checkout, and denies when that run is non-terminal, the caller is not its owner, and the body's phases checklist has `build` or `test` unchecked. On the reconcile side, a new `detectHollowMerges` in `post-merge.js` runs before `release`, finds merged PRs of non-terminal runs whose checklist has `build` or `test` unchecked, posts one comment per run on its record, and hands the held run set to `releaseMerged` (no release, no `auto:build` strip), `postMerge` (no Steps 4.0/4.0b) and `archiveMerged` (kept in place, via `postMergeDeferred`); the summary reports each held run.

**Tech Stack:** Node 18+ CommonJS, `node --test`, `gh` CLI.

**Spec:** `.claude-tweaks/pipelines/2026-11-23T154946-record-6143/work/6143-spec.md` (record #6143)

Scope keywords: hollow-merge, phaseRowStates, detectHollowMerges, inflight-pr

(The literal `gh pr merge` / `gh pr ready` appear in ~90 prose and test files that describe owner-side merges; they are classified by Task 3 Step 6's prose sweep, not listed as planned edits.)

## Global Constraints

- Deliverable 1 trigger (verbatim from spec): "A Bash call running `gh pr ready <n>` or `gh pr merge <n>` (any flags) is denied when PR n's body carries a `claude-tweaks-run: {id}` marker naming a run under `$RUN_ROOT/.claude-tweaks/pipelines/` whose `run-state.json` is non-terminal and whose phases checklist still has `build` or `test` unchecked."
- "The deny reason names the run and its owning session. The owning session (`run-state.json` `sessionId`) is allowed. The gate fails open when the PR body or run state cannot be read, per `docs/hooks.md`'s never-break-a-session invariant."
- Deliverable 2 (verbatim): "When a merged PR's marker names a run that was non-terminal at merge time, or the PR's phases checklist has `build` unchecked, it does not release the claim as merged, strip `auto:build` or archive the run. Instead it posts one comment on the record naming the merge, and reconcile's summary reports it."
- **Decision — "non-terminal at merge time" is read as "non-terminal now, with `build` or `test` unchecked".** A run's own wrap-up merges its PR while `run-state.json` is still non-terminal, so "non-terminal" alone would hold every normal pr-first merge (AC4 forbids that). Every legitimate merge happens after the build and test phase exits checked their rows (`phase-exit.js` → `pr-checklist.js`), so the shared predicate is: run non-terminal (`status !== 'clean'`) AND a phases span whose `build` or `test` row is unchecked. A terminal (`clean`) run is not scanned by the reconcile side. Express-lane bodies carry no phases span (`pr-body.js` `composeExpressBody`) and are never hollow. A skipped phase's row is removed, not left unchecked (`setPhaseRow --remove`), so an absent row is never "unchecked".
- "Non-terminal" means `run-state.json` `status !== 'clean'` (the only terminal status `closeRunState` writes).
- Owner = caller `session_id` equals the run-state's `sessionId` or its `dispatchSessionId` (the dispatching session settles and merges a dispatched run, `dispatch/settle-and-merge.md`). Any other caller is denied when the predicate holds.
- Commit style: `{Verb} {what} — {detail}`, ending with `refs #6143` (never `closes`/`fixes`), plus the line `Claude-Session: https://claude.ai/code/session_019fFofVFgBteo3LWVg8iJ9W`.
- Project maturity is `established`: "For any task modifying pre-existing behavior, write a full characterization test covering edge cases before changing it — published or external consumers may depend on them."
- Run tests with `node --test <file>` per file; never `git stash`; one plain command per Bash call; `git -C "<worktree>"` with absolute paths.

Governing project skills (quoted verbatim; read each named SKILL.md under `.claude/skills/` before starting the task that touches its file):

- `pre-tool-use-gate-exemptions` (Tasks 3): "**A deny about a run the tool input names reads that run from the main checkout, through neither `ctx.runDir` nor `ctx.ownedRun`.** `checkDispatchPromptGate` (`dispatch-prompt-gate.js`, #4589) is the shipped instance: the dispatching session's cwd is the group's worktree and its owned run is not necessarily the group's run, so rule (A) reads the run id the prompt's first-line marker names and rule (B) the run ids the prompt mentions. Treat a named id as untrusted input. Require `ctxLib.RUN_ID_RE`; resolve `{mainCheckoutRoot}/.claude-tweaks/pipelines` through `canonicalRealpath` (a null or throwing `mainCheckoutRoot` allows); and read the run dir only when it canonicalizes, is a directory, and is a direct child of that pipelines dir (`isPathContained` plus `path.dirname(real) === pipes`; rule (B) checks each entry with `lstatType`, so a symlinked entry is skipped). A symlink out or a traversal then allows instead of reading a foreign file. Do not reach for `context.js`'s `iterRunDirsWithState` here: it reads every run's `run-state.json` and falls back to the cwd's own, possibly worktree-local, pipelines dir when the main checkout is unresolved, which a deny must not read. Read a run-state only for an entry the input names, and state which runs the gate reads in its header, as that file's "Runs read" paragraph does."
- `pre-tool-use-gate-exemptions` (Task 3): "**A deny on a call that skill prose prescribes fails OPEN on every unprovable answer, and the same change sweeps every prose route into that call.** … It returns `{}` on no owned run, `fallback` attribution, an ad-hoc dir, any `classifyOwnership` verdict other than `'mine'`, a malformed `questions`, and a ceiling read that throws …, and it denies only when every one of those is proven. State the direction in the gate's header comment and give each fail-open condition its own test in `tests/hooks-pre-tool-use.test.js`. Then, because shipped prose tells the model to make the denied call, grep `plugin/skills/` for every route that reaches it (the call with the keyed field, and every link into the section that makes it) and either reroute or pin each one in the same change."
- `pre-tool-use-gate-exemptions` (Task 3): "**A gate that reads the shell scanner's targets decides what a `lost` target means for its own concern, and records that choice where the others are stated.** … A new gate that reads `fileWriteTargets`, `gitTargets`, `mkdirTargets` or a `forEachShellSegment` walk picks a reading before writing its first condition: deny on the marker, or check the stand-in and the `reading` targets as ordinary ones. … Pin the choice with a case past the cap, and add the gate's reading to `_shared/policy-schema-coverage.md`'s "Where a relative target resolves" paragraph, the one place a gate's reading is recorded." — This gate's reading: a call whose segment cwd differs from `ctx.cwd`, or is `lost`, is not checked (allow): `gh` would resolve its repo from a cwd the hook cannot prove.
- `pre-tool-use-gate-exemptions` (Task 3): "**Every new exemption needs a regression test proven to go red on revert.**"
- `hook-event-in-process-tests` (Task 3): "**Who calls a helper decides how it takes `env`.** A function only hook events reach takes `env` with no default and throws `TypeError` without it: `ctxLib.assertEnvObject` … Every call from an event module passes `env`." and "**Keep both guards green by fixing, never by widening.** `tests/hooks-event-env-conformance.test.js` scans each module in `EVENT_MODULES` for `process.env` and `process.cwd()` (Scan A) … with a floor per call name per module: raise the floor when you add a call."
- `shell-scanner-bash-differential` (Task 2): applies to the new parser in `git-command.js` and the prefilter that shares it — read its Key Patterns and Anti-Patterns sections. The prefilter rule from `bash-prefilter.js`'s header: "It must stay a SUPERSET of those predicates: a false "skip" silently drops enforcement, a false "run" costs only the full handler's module load."
- `gh-api-module-pattern` (Tasks 3, 4): "**Every real spawn passes `windowsHide: true` in a form `tests/windows-hide-spawn-conformance.test.js` can see.**" / "**Inside `plugin/bin/lib/reconcile/`, a runner spawns through `timing.js`'s `execFileSyncTimed` / `execFileAsyncTimed`, never `child_process` directly.**" / "**Every `gh` spawn wraps its options in `plugin/bin/lib/repo-resolve.js`'s `ghOptions(args, …)`.**" / "**Bound every remote-contacting call on the seam; a local-only call owes no bound.** … which shared timeout to import (`GH_TIMEOUT_MS`, `GH_BATCH_TIMEOUT_MS`, `GIT_TIMEOUT_MS`, never a retyped literal)". "**Text a module writes into a PR body names no record it does not mean to close.**" applies to the record comment too: route it through `neutralizeClosingPhrases` if it interpolates any free text.

## Review Focus

1. `gh pr merge` with no selector (current branch's PR), a URL selector, or `-R owner/repo` — the gate must read the same PR `gh` would act on (selector-less: `gh pr view` in `ctx.cwd`; `--repo` passed through), or allow. Owned by Task 3 (tests listed there).
2. `gh pr ready --undo` (back to draft) and `gh pr view 5` / `gh pr merge --help` — must never be denied. Task 2 parser test + Task 3 test.
3. A PR body whose marker is not on the first line, names a run id with `/` or `..`, or names a run absent from this checkout — allow (no foreign read). Task 3.
4. A hollow merge seen on two reconcile passes — exactly one comment total, held both times. Task 4.
5. A merged PR whose body could not be read on this pass — held this pass (not released, not archived), no comment, retried next pass; never "not hollow". Task 4.

---

### Task 1: Phase-row reader

**Role:** integration

**Files:**
- Modify: `plugin/bin/lib/flow/pr-checklist.js` (add export)
- Test: `tests/bin-lib/flow/pr-checklist.test.js`

**Interfaces:**
- Produces: `phaseRowStates(body: string) -> { span: boolean, rows: { [phase: string]: 'checked' | 'unchecked' } }` — `span` false when `locatePhasesSpan` finds no span; `rows` holds only rows present inside the span (`- [ ] build` → `'unchecked'`, `- [x]`/`- [X]` → `'checked'`), exact phase-name match per `CANONICAL_PHASES`, `\r` tolerated. Also `hasUnfinishedBuildOrTest(body: string) -> string | null` — the first of `'build'`, `'test'` whose row is `'unchecked'`, else null.

- [ ] **Step 1: Write the failing tests**: `phaseRowStates reads checked and unchecked rows inside the span only` (a body from `composePrEarlyBody` — the real writer — has all five `'unchecked'`; after `setPhaseRow({phase:'build'})` build is `'checked'`; a `- [ ] build` line outside the span is ignored; a CRLF body reads the same); `phaseRowStates: no span → span false, rows {}` (an express body from `composeExpressBody`); `hasUnfinishedBuildOrTest` returns `'build'` on a fresh body, `'test'` after build is checked, null after both are checked, null when the build row was removed with `setPhaseRow({phase:'build', remove:true})` and test checked.
- [ ] **Step 2: Run** `node --test tests/bin-lib/flow/pr-checklist.test.js` — expect FAIL (`phaseRowStates is not a function`).
- [ ] **Step 3: Implement** both functions in `pr-checklist.js` reusing `locatePhasesSpan` and `bare`; export them.
- [ ] **Step 4: Run** the same command — expect PASS.
- [ ] **Step 5: Commit** `Add phase-row reader to pr-checklist — build/test unchecked detection, refs #6143`.

### Task 2: `gh pr ready|merge` parser and prefilter reach

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/hooks/git-command.js` (new parser + exported constant)
- Modify: `plugin/bin/lib/hooks/bash-prefilter.js` (pre-tool-use only reach rule)
- Test: `tests/hooks-gh-pr-lifecycle-parser.test.js` (create), `tests/hooks-bash-prefilter.test.js`

**Interfaces:**
- Produces: `GH_PR_LIFECYCLE = Object.freeze({ program: 'gh', group: 'pr', verbs: Object.freeze(['merge', 'ready']) })` and `ghPrLifecycleCalls(command: string, cwd: string) -> Array<{ verb: 'merge'|'ready', selector: string|null, repo: string|null, undo: boolean, cwd: string, lost: boolean }>`, both exported from `git-command.js`. Walk with `forEachShellSegment` and the module's own command-word resolution (`commandWord`, so `sudo`/`env`/assignment prefixes are read past as for other shapes); match a segment whose program basename is `gh` (`.exe` stripped), next word `pr`, then `merge` or `ready`. `selector` = first positional after the verb, skipping value flags — merge: `-A --author-email -b --body -F --body-file --match-head-commit -t --subject -R --repo`; ready: `-R --repo` — and `--flag=value` forms; `repo` = the `-R`/`--repo` value; `undo` = `--undo` present. `cwd`/`lost` are the walk's segment cwd and lost marker.

- [ ] **Step 1: Write failing parser tests** in the new file: `gh pr merge 123 --squash` → `[{verb:'merge', selector:'123', repo:null, undo:false}]`; `gh pr merge --squash -b "x y" 123` → selector `'123'`; `gh pr merge -R o/r https://github.com/o/r/pull/9 --auto` → selector the URL, repo `'o/r'`; `gh pr merge --repo=o/r` → selector null, repo `'o/r'`; `gh pr ready 7` and `gh pr ready --undo 7` (undo true); `cd /x && gh pr merge 5` → `cwd` `/x`; `echo ok; /usr/local/bin/gh pr merge 5` found; `gh pr view 5`, `gh issue view 3`, `gh pr merge-queue`-like non-verbs, and `echo gh pr merge 5` → `[]`.
- [ ] **Step 2: Add prefilter corpus lines** in `tests/hooks-bash-prefilter.test.js`: pre-tool-use runs the full handler for `gh pr merge 123 --squash`, `gh pr ready 7`, `cd x && gh pr merge 5`; still skips `gh issue view 3074` (existing line, unchanged) and `gh pr view 5`.
- [ ] **Step 3: Run** both files — expect FAIL.
- [ ] **Step 4: Implement** `ghPrLifecycleCalls` and `GH_PR_LIFECYCLE` in `git-command.js`; in `bash-prefilter.js`, for `pre-tool-use` only, return true when some reading's `commandWords` contains `GH_PR_LIFECYCLE.program`, `GH_PR_LIFECYCLE.group` and one of `GH_PR_LIFECYCLE.verbs` (a superset of the parser; `gh` is NOT added to `GUARDED_PROGRAM_WORDS`, so other `gh` calls keep the skip path). Update the prefilter header comment to name the rule.
- [ ] **Step 5: Run** both files plus `node --test tests/hooks-bash-prefilter-differential*.test.js` if present (find with `ls tests | grep prefilter`) — expect PASS.
- [ ] **Step 6: Commit** `Parse gh pr ready/merge calls and reach them from the prefilter — refs #6143`.

### Task 3: In-flight PR gate

**Role:** judgment
**Review risk:** high

**Files:**
- Create: `plugin/bin/lib/hooks/named-run.js` — move `pipelinesDir` out of `dispatch-prompt-gate.js` and add `namedRunDir`
- Modify: `plugin/bin/lib/hooks/dispatch-prompt-gate.js` (import `pipelinesDir`/`namedRunDir` instead of its local copy; behavior unchanged)
- Create: `plugin/bin/lib/hooks/inflight-pr-gate.js`
- Modify: `plugin/bin/lib/hooks/pre-tool-use.js` (`runInner`: lazy-require the gate inside a `try` for `tool_name === 'Bash'`, placed after `checkPowershellOpaqueCommand`, before `checkDispatchConfigGate`; update `run()`'s `deps` comment)
- Modify: `docs/hooks.md` (gate entry: trigger, owner exemption, fail-open list, "Runs read"), `plugin/skills/_shared/policy-schema-coverage.md` ("Where a relative target resolves": this gate's reading)
- Modify: `tests/hooks-event-env-conformance.test.js` only if its Scan floors require it (raise, never lower)
- Test: `tests/hooks-inflight-pr-gate.test.js` (create); `tests/hooks-dispatch-prompt-gate.test.js` must stay green unchanged

**Interfaces:**
- Consumes: Task 1 `hasUnfinishedBuildOrTest(body)`; `pr-checklist.js` `firstLineRunId(body)`; Task 2 `ghPrLifecycleCalls(command, cwd)`.
- Produces: `named-run.js`: `pipelinesDir(cwd, d) -> string|null` (moved verbatim) and `namedRunDir(cwd, runId, d) -> string|null` (RUN_ID_RE, canonicalizes, directory, direct child of pipelines — the checks `checkMismatch` does today; `checkMismatch` switches to it). `inflight-pr-gate.js`: `checkInflightPrGate(ctx, deps = {}, deny) -> {} | denyResult`, exported with `GATE = 'inflight-pr'`. `deps` seams: `readPrBody(call, ctx) -> { body: string, number: number } | null`, `mainCheckoutRoot`, `readRunState`, `fsImpl`. The default `readPrBody` runs `gh pr view [selector] [--repo repo] --json body,number` with `execFileSync('gh', args, ghOptions(args, { cwd: ctx.cwd, env: ctx.env, encoding: 'utf8', stdio: ['ignore','pipe','pipe'], timeout: GH_TIMEOUT_MS, windowsHide: true }))`, returning null on any throw or unparseable output.

Decision per call (deny only when every step is proven; any throw → `{}`; `ctxLib.requireEnv(ctx)` before the `try`): skip `undo`; skip a call whose `lost` is true or whose `cwd` differs from `ctx.cwd`; body null → allow; `firstLineRunId` null → allow; `namedRunDir` null → allow; run-state null or `status === 'clean'` → allow; caller `session_id` equals `sessionId` or `dispatchSessionId` → allow; `hasUnfinishedBuildOrTest(body)` null → allow; else append a `gate-denial` event (`{ tool: 'Bash', gate: GATE, pr: number, phase, ...testTag }`) to the run dir and deny with:
`claude-tweaks: PR #{number} is the draft PR of pipeline run {runId}, which is still running ({phase} phase not finished) and is owned by session {sessionId}. Marking it ready or merging it now would ship a half-built change (#6143). Leave it to that run's own wrap-up. If the run is abandoned, settle it first (/claude-tweaks:dispatch resume, or /claude-tweaks:wrap-up {target} cleanup-only), then retry.` — `{sessionId}` is the run-state `sessionId` (or `unknown` when absent).

- [ ] **Step 1: Characterize** — run `node --test tests/hooks-dispatch-prompt-gate.test.js` and record it green before moving `pipelinesDir`.
- [ ] **Step 2: Write failing tests** in `tests/hooks-inflight-pr-gate.test.js`, through `pre-tool-use.js`'s `run(ctx, deps)` (ctx built as `tests/hooks-dispatch-prompt-gate.test.js` builds it; run-state written by the real `hooks.js record-worktree` writer via `runCli`, session `S`; PR body from `composePrEarlyBody` — the real writer — with `deps.readPrBody` returning it):
  - `AC1.1: gh pr merge 123 --squash on an active run with build unchecked is denied` — deny JSON, reason names the run id and session `S`; a `gate-denial` event in the run's `events.jsonl`.
  - `AC1.2: the same command from the owning session is allowed` (caller session `S`); plus a `dispatchSessionId` owner case (record-worktree `--dispatch`).
  - `AC1.3: an unreadable PR is allowed` (`readPrBody` → null) — and the default runner path: `readPrBody` omitted with `PATH` in the passed env pointing at a stub `gh` that exits 1 → allowed.
  - `AC2.1: gh pr ready 123 behaves the same way as the merge case` — deny for a foreign session, allow for owner, allow for unreadable.
  - test unchecked (build checked) → denied; both checked → allowed; express body (no span) → allowed; `run-state` status `clean` (written by the real `close-run` writer or `closeRunState`) → allowed; marker on line 2 only → allowed; marker naming a missing run / `../x` / a symlinked run dir → allowed; `gh pr ready --undo 123` → allowed and `readPrBody` never called; `cd /elsewhere && gh pr merge 5` → allowed, `readPrBody` never called; selector-less `gh pr merge --squash` → `readPrBody` called with `selector: null`; `-R o/r 5` → called with `repo: 'o/r'`; a load fault (require cache stub throwing) → allowed.
  - Revert check: for the owner test, the `dispatchSessionId` test and the `--undo` test, revert only that clause in `inflight-pr-gate.js` and confirm only that test goes red; record the observed failure in the commit message body.
- [ ] **Step 3: Run** the new file — expect FAIL (module not found).
- [ ] **Step 4: Implement** `named-run.js`, switch `dispatch-prompt-gate.js` to it, implement `inflight-pr-gate.js` with a header comment stating direction (fails OPEN), the fail-open list, and "Runs read: neither ctx.runDir nor ctx.ownedRun — the run the PR body's first-line marker names, in the main checkout", then wire `runInner`.
- [ ] **Step 5: Run** `node --test tests/hooks-inflight-pr-gate.test.js tests/hooks-dispatch-prompt-gate.test.js tests/hooks-pre-tool-use.test.js tests/hooks-event-env-conformance.test.js tests/hooks-bash-prefilter.test.js` — expect PASS. Run the new file once more under `npx -y node@20 --test tests/hooks-inflight-pr-gate.test.js`.
- [ ] **Step 6: Prose sweep** — `grep -rn "gh pr merge\|gh pr ready" plugin/skills/`; for each hit, confirm the caller is the run's owner (its own wrap-up / dispatch settle) or a merge of a finished run; list every hit and its classification in the commit body. Reroute none unless a hit sends a non-owner session to merge an in-flight run.
- [ ] **Step 7: Update** `docs/hooks.md` and `_shared/policy-schema-coverage.md` as listed above.
- [ ] **Step 8: Commit** `Deny gh pr ready/merge on a PR whose run is still building — owner allowed, fails open; refs #6143`.

### Task 4: Hollow-merge detection in reconcile post-merge

**Role:** judgment
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/reconcile/post-merge.js` (new export `detectHollowMerges`; `postMerge` gains `hollowRunDirs` and skips them)
- Test: `tests/bin-lib/reconcile/post-merge.test.js`

**Interfaces:**
- Consumes: Task 1 `hasUnfinishedBuildOrTest`, `firstLineRunId`.
- Produces: `detectHollowMerges({ cwd, prStates, dryRun = false, deps = {} }) -> Promise<{ entries: Array<{ runDir, runId, pr, action: 'held', reason: 'hollow-merge'|'hollow-check-failed', phase?: string, commented?: number[], records?: number[] }>, hollowRunDirs: string[], failure?: string }>`. Same `setupContext` (failure codes unchanged), candidate set = `listRunDirsWithState(root)` (non-terminal only) with an integer `state.pr.number`; `prStates.byNumberAsync(pr)` must be `MERGED` (anything else → no entry); then `ctx.timedGh(['pr','view', String(pr), '--json', 'body,closingIssuesReferences,mergedAt'])` (a `deps.gh` fake in tests). Body read failure → entry `hollow-check-failed`, run held this pass, no comment. `firstLineRunId(body) !== basename(runDir)` → no entry. `hasUnfinishedBuildOrTest(body)` null → no entry. Otherwise hollow: `records` = closing references in this repo (number+owner/name match, as `prClosesIssue` does), else the run's `config.yml` `spec:` single number (`readSpecNumber`); unless `decisions.md` already holds a `reconcile hollow-merge` marker line (`HOLLOW_STEP = 'reconcile hollow-merge'`) or `dryRun`, post one `gh issue comment {n} --body-file -` per record (body on stdin) and append one `AUTO` marker line to the run's `decisions.md` via `appendEntry` naming PR, merge time and commented records. Comment text: `Reconcile: PR #{pr} (run {runId}) was merged at {mergedAt} while the run's {phase} phase was unfinished — a hollow merge. The claim, the auto:build grant and the run directory are left in place; the code this record asked for may not have landed. Reopen this record if the merge closed it, then resume or settle the run.` `postMerge({..., hollowRunDirs = []})`: a candidate in that set yields entry `{ action:'skipped', reason:'hollow-merge' }` and is deferred.

- [ ] **Step 1: Write failing tests** using the file's `mainCheckout`/`addRun`/`fakePrStates` builders (run-state status `in-progress`; one real-writer case uses `hooks.js record-worktree` for run-state and `composePrEarlyBody` for the body):
  - `AC3.1 (detection): a merged PR whose marker names an active run with build unchecked is held, commented once, and marked` — one `issue comment` call on the closing record, one marker line, entry `{action:'held', reason:'hollow-merge', phase:'build'}`, run dir in `hollowRunDirs`.
  - a second `detectHollowMerges` call on the same fixture: held again, zero new comments.
  - `AC4.1 (detection): a merged PR whose phases are all checked yields no entry` — and a `clean` run is never read (no `gh` call).
  - body read throws → `hollow-check-failed`, held, no comment, no marker; `dryRun` → held, no comment, no marker; marker naming another run → no entry; express body → no entry; OPEN PR → no entry, no body read.
  - `postMerge` with `hollowRunDirs` containing the run: no Step 4.0/4.0b fake call, entry `hollow-merge`, run in `deferred`.
- [ ] **Step 2: Run** `node --test tests/bin-lib/reconcile/post-merge.test.js` — expect FAIL.
- [ ] **Step 3: Implement** in `post-merge.js` (spawns only through `ctx.timedGh`, i.e. `execFileSyncTimed` + `ghOptions` + `GH_TIMEOUT_MS`); update the file header with a `detectHollowMerges` paragraph.
- [ ] **Step 4: Run** the file — expect PASS; also `node --test tests/bin-lib/reconcile/subprocess-timing-conformance.test.js`.
- [ ] **Step 5: Commit** `Detect hollow merges in reconcile post-merge — hold and comment once; refs #6143`.

### Task 5: Hold hollow runs through release, archive and the summary

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/reconcile/release-merged.js` (`releaseMerged({..., hollowRunIds = []})`: a candidate whose `runId` is listed is skipped with reason `hollow-merge` before `decideRelease` — no tombstone, no `bot:in-progress` removal, no grant strip)
- Modify: `plugin/bin/lib/reconcile/index.js` (call `detectHollowMerges` before the `release` block whenever `release`, `post-merge` or `archive` is in `checks`; pass `hollowRunIds` (basenames) to `releaseMerged`, `hollowRunDirs` to `postMerge`, and append `hollowRunDirs` to `postMergeDeferred` for `archiveMerged`; set `result.hollowMerges = entries`; a `failure` goes to `result.skipped` as `{ check: 'hollow-merge', reason }`)
- Modify: `plugin/bin/lib/reconcile/format-summary.js` (`formatSummary(result)`, the summary `hooks.js reconcile` prints: one line per held run: `hollow merge held: PR #{pr} (run {runId}) — {phase} unfinished; claim, auto:build and run dir kept` plus `commented on #{n}` when commented; `hollow-check-failed` reads `hollow-merge check failed for run {runId}; held this pass`)
- Test: `tests/bin-lib/reconcile/release-merged.test.js`, `tests/reconcile.test.js` (or the existing index-level test file that drives `reconcile()` with stubbed checks — find with `grep -ln "releaseMerged\|archiveMerged" tests/reconcile*.test.js`)

**Interfaces:**
- Consumes: Task 4 `detectHollowMerges` and `postMerge({ hollowRunDirs })`.
- Produces: `result.hollowMerges` on `reconcile()`'s result.

- [ ] **Step 1: Characterize** `releaseMerged`: confirm an existing test (or add one) asserting a MERGED+closing claim is released with grant strip — the AC4 baseline.
- [ ] **Step 2: Write failing tests:**
  - release-merged: `hollow-merge: a listed runId is skipped, no tombstone write, no label edit` (assert the fake `ghApi`/runner saw no write); an unlisted run releases exactly as before.
  - index level: `AC3.1: a merged PR whose marker names an active run with build unchecked leaves the claim, auto:build and the run directory in place, posts one comment, and appears in the summary` — drive `reconcile()` with the existing stub seams so detection reports the run hollow; assert `releaseMerged` received `hollowRunIds`, the run dir still exists unarchived, `result.hollowMerges` has the entry, and `format-summary.js`'s `formatSummary(result)` contains `hollow merge held: PR #`.
  - `AC4.1: a merged PR whose run is clean and whose phases are all checked settles exactly as today` — same harness, detection finds nothing; release, post-merge and archive receive empty hollow sets and the summary has no hollow line.
- [ ] **Step 3: Run** the touched test files — expect FAIL.
- [ ] **Step 4: Implement** the three modifications.
- [ ] **Step 5: Run** `node --test tests/bin-lib/reconcile/release-merged.test.js tests/bin-lib/reconcile/post-merge.test.js tests/bin-lib/reconcile/archive-merged.test.js tests/reconcile-dispatch.test.js` plus the index-level file — expect PASS.
- [ ] **Step 6: Commit** `Hold hollow-merged runs through release, archive and the reconcile summary — refs #6143`.

## Spec coverage

| Spec item | Task |
|---|---|
| Deliverable 1 / AC1.1, AC1.2, AC1.3, AC2.1 | Tasks 1-3 |
| Deliverable 2 / AC3.1 | Tasks 4-5 |
| AC4.1 | Tasks 4-5 |
