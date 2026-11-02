# Armed-merge post-merge steps (#4599) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a run arms an auto-merge and GitHub merges the PR after the session ended, run `_shared/pr-first-merge-post-merge.md`'s Step 4.0 (closing-links reopen) and Step 4.0b (close below-floor parents) exactly once from the reconciler, so a below-floor parent closes without a human approving tidy's `parent-gate` row.

**Architecture:** A new background reconcile check, `post-merge` (`plugin/bin/lib/reconcile/post-merge.js`), walks every top-level run dir (non-clean and clean) whose `run-state.json` stamps `pr.number`. It acts on a PR that is `MERGED` and whose `decisions.md` holds no Step 4.0b marker line. It runs Step 4.0 in-process through `bin/closing-links.js`'s exported `run()`, with no settle poll and a bounded reopen window. It then runs Step 4.0b through a new Node module, `plugin/bin/lib/issues/below-floor-parent-close.js`, the code mirror of `wrap-up/verification-brief-parent-gate.md`'s post-merge entry. Finally it appends a `reconcile post-merge` marker line, which makes the check run once. The in-session Step 4.0b gains an always-written summary line carrying the same marker, so a merge a session saw is never re-run. `post-merge` dispatches immediately before `archive` and is added to `archive`'s prerequisites, so every pass that can archive a merged run first runs the post-merge steps for it.

**Tech Stack:** Node 18+ CommonJS, `node --test`, `gh` CLI via injectable runners.

**Spec:** `.claude-tweaks/pipelines/2026-10-31T135734-record-4599/work/4599-spec.md`

**Population (spec's Plan Review Decisions, Reading B):** every top-level run whose recorded PR is `MERGED` and whose `decisions.md` carries no Step 4.0b marker line, keyed on the run's recorded PR, exactly once. No separate canonical `armed` marker is added. The one-time catch-up of legacy and older-build runs on the first reconcile after deploy is intended and documented (Task 4), bounded by the 10-minute reopen window (Task 1) and Step 4.0b's idempotence checks (Task 2).

## Global Constraints

- Only under `work-backend: github-issues` (`readWorkBackend(root) === 'github-issues'`, `plugin/bin/lib/work-backend.js`); any other value or null skips the whole check (`not-github-issues`) and writes nothing.
- Exactly once per run: a run is done when `decisions.md` has an entry (parsed with `parseEntry`, `plugin/bin/lib/log-decision/append.js`) whose location matches `/(?:^|— )pr-first-merge Step 4\.0b\b/` or equals `reconcile post-merge`.
- Concurrency (two guards, both in Task 3):
  - **Merging-session race.** A session that sees its own merge runs Steps 4.0 and 4.0b within seconds of `mergedAt` (Step 4.0's poll is at most 15 s) and then writes the marker. The reconciler skips a run whose PR `mergedAt` is less than `MERGE_GRACE_MS` (10 minutes) before `now`, with entry `skipped`/`merge-grace` and nothing written, so it never races that session. A later pass picks the run up. A missing or unparseable `mergedAt` is treated as inside the grace window (skip, retry later), never as old.
  - **Pass-versus-pass race.** Background passes already serialize on `background-lock.js`, but inline passes (Step 4.2's `--checks mirror,release,archive`, tidy's explicit list) do not. Before running Step 4.0 for a run, take a per-run claim by creating `{runDir}/.post-merge.lock` with `fs.openSync(path, 'wx')`. On `EEXIST`, if the lock file's mtime is under `CLAIM_STALE_MS` (10 minutes) old, skip with entry `skipped`/`in-flight`; otherwise remove it and retry the create once. Any other I/O error skips with `claim-failed`. Remove the lock in a `finally` after the marker write. A dotfile name keeps it out of archive's non-dotfile `staged/` checks.
- Archive defers what post-merge deferred. Archived runs are never walked again, so a run that `post-merge` skipped with a retryable reason must not be archived in the same pass, or the "later pass" never comes. `postMerge` returns `deferred`: the run dirs it skipped for `merge-grace`, `in-flight`, `claim-failed`, or the transient `prStates` failure `network-failure`. A definitive lookup failure (`pr-not-found`, `invalid-arguments`, `no-pr-state`, any other non-network string) is skipped and not deferred, so archive keeps tracking that run as structurally stuck (#3543). This was amended by the build's Ruling R5; the original wording deferred every failure string other than `gh-absent`. `reconcile/index.js` passes that set to `archiveMerged` as `postMergeDeferred`. `archiveMerged` skips each listed run with reason `post-merge-pending`, without calling its stuck-skip `track`, because the skip is transient and must never escalate as residue. The guard is per-pass and bounded by construction: a run leaves the set once `post-merge` acts on it, which happens within one grace window for `merge-grace`. Reasons that are not retryable (`marker-write-failed`, `gh-absent`, `dry-run`) are not deferred, so they never hold a run back from archiving.
- Marker-write failure: when the marker append fails, the entry is `skipped`/`marker-write-failed` and the run is not deferred. The same pass's `archive` archives it, and archived runs are never walked again, so Steps 4.0 and 4.0b do not run twice. If archive leaves the run in place for its own reasons, the next pass retries, which is safe because Task 2 is idempotent. Either way, any parent left open falls to tidy's backstop.
- `gh` absent: the check is `gh`-only. The `#4602` MCP transport covers in-session calls, not the reconciler. When `prStates` or the `gh` runner reports `gh` absent, the run gets entry `skipped`/`gh-absent`, no marker is written, and tidy's backstop stays the recovery.
- Tidy's `parent-gate` backstop is unchanged and stays the last resort: every fail-open path below leaves the parent open for it.
- Comment copy is the prose template in `verification-brief-parent-gate.md`'s **Close the parent below the floor** step 2, byte-for-byte (heading `## Closed below the oversight floor`).
- Every subprocess under `plugin/bin/lib/reconcile/` goes through `timing.js`'s `execFileSyncTimed`/`execFileAsyncTimed` (`subprocess-timing-conformance.test.js`).
- `--dry-run` writes nothing: no GitHub write, no `decisions.md` line.
- Commits reference the record as `refs #4599`, never `closes`/`fixes`.

## Acceptance coverage

| Clause | Covered by |
|---|---|
| AC1.1 — an armed-merge below-floor parent closes with the heading comment, no tidy approval | Task 2 happy-path test (the close), Task 3 merged-unmarked-run test (the reconciler runs it), Task 4 ordering test (it runs before archive) |
| AC2.1 — idempotent with a later tidy approval: one comment, one close | Task 2 idempotence tests (already `CLOSED` → no-op; trusted heading comment → close only), Task 3 second-call test (run-once marker); tidy's own action re-reads and no-ops on `CLOSED` (unchanged) |

## Review Focus

1. A human closes a `Refs #N` keep-open record hours after the merge, before the reconciler runs. The late Step 4.0 must not reopen it (bounded window). Pinned in Task 1.
2. Two reconcile passes over the same merged run (or a pass after tidy already closed the parent) must produce one comment and one close: marker, per-run claim, and idempotence. A pass must never race the merging session (merge grace window). Pinned in Tasks 2 and 3.
3. A run whose session already ran Step 4.0b in-session (its marker line written by the real `formatEntry`) must never be re-run by the reconciler. Pinned in Task 3.
4. A PR merged into a non-default integration branch leaves its sub-issues open. Step 4.0b is a no-op there. Pinned in Task 2.
5. A sub-issue with no `risk:*` label makes the parent unscored (`exceeds: true`), so it is not closed. A `gh` failure on one parent skips only that parent, and the run is still marked. Pinned in Task 2.

---

### Task 1: Bounded reopen window for a late Step 4.0

**Review risk:** high

**Files:**
- Modify: `plugin/bin/closing-links.js` (`parseArgs`, `USAGE`, header comment, step 8b)
- Test: `tests/bin-lib/flow/closing-links-cli.test.js`

**Interfaces:**
- Produces: `--close-window-ms <n>` (post-merge only; a non-negative integer, default absent = unbounded, today's behavior). `parseArgs` returns `{ run, mode, settleMs, closeWindowMs, help }`, with `closeWindowMs: null` when the flag is absent. In post-merge mode with the flag set, a candidate whose `closedAt` is later than `mergedAt + closeWindowMs` is not reopened. It is listed in the envelope's `closedAfterWindow: number[]` (present only when the flag was given), stays in `closingSet` (it is closed), and gets no decisions line. Passing it with `--mode pre-merge` is a usage error (exit 2).

- [ ] **Step 1: Write the failing tests** in `closing-links-cli.test.js`:
  - Update the existing `parseArgs` deepEqual (line 132) to expect `closeWindowMs: null`.
  - `parseArgs(['--run','r','--mode','post-merge','--close-window-ms','600000']).closeWindowMs === 600000`; `'--close-window-ms','-1'` and `'abc'` return `{ error }`.
  - `run([... '--mode','pre-merge','--close-window-ms','5'])` returns 2.
  - Post-merge with `--settle-ms 0 --close-window-ms 600000`: a keep-open candidate closed at `MERGED_AT + 2 s` is reopened (`reopened: [2724]`). The same candidate closed at `MERGED_AT + 3 h` is not reopened: `reopened: []`, `closedAfterWindow: [2724]`, no `issue reopen` call, and `closingSet` still contains it when it is linked.
  - Without the flag, the envelope has no `closedAfterWindow` key (existing tests unchanged).
- [ ] **Step 2: Run** `node --test tests/bin-lib/flow/closing-links-cli.test.js`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement** the flag in `parseArgs` (`VALUE_FLAGS` entry `--close-window-ms: 'closeWindowMs'`, same digits-only validation as `--settle-ms`, no cap), the pre-merge rejection after mode validation, the step-8b check placed after the `closedBefore` test, and the `USAGE` line plus header comment naming the flag and `closedAfterWindow`.
- [ ] **Step 4: Run** `node --test tests/bin-lib/flow/closing-links-cli.test.js tests/closing-links-prose-conformance.test.js`. Expected: PASS.
- [ ] **Step 5: Commit** `Bound closing-links post-merge reopens to a merge window — a late run never reopens a human close (refs #4599)`.

### Task 2: Node mirror of Step 4.0b's parent close

**Review risk:** high

**Files:**
- Create: `plugin/bin/lib/issues/below-floor-parent-close.js`
- Test: `tests/bin-lib/issues/below-floor-parent-close.test.js`

**Interfaces:**
- Consumes: `fetchNativeParent` (`issues/native-dependencies.js`), `parseSubIssues` (`issues/record-dependencies.js`, through `issues/record.js`), `parseRecordFacets` (`issues/record-vocabulary.js`), `parentGateState` (`issues/acceptance.js`), `maxRiskTier` and `exceedsOversightFloor` (`issues/oversight-floor.js`), `isTrustedComment` (`issues/comment-trust.js`).
- Produces:
  - `CLOSE_HEADING = '## Closed below the oversight floor'`.
  - `composeCloseComment({ maxTier, riskFloor, notPlanned, lines }) -> string`, where `lines` are already-rendered `- #{n} {title}[ — closed by PR #{pr}]` strings.
  - `closeBelowFloorParents({ closingSet, unsettled, mergingPr, owner, repo, workLinks, riskFloor, integrationBranch, gh }) -> { closed: [{ parent, maxTier }], skipped: [{ parent?, issue?, reason }] }`. `gh(args, input?)` returns stdout and throws on failure. Never throws itself.

- [ ] **Step 1: Write the failing tests** with a fake `gh` keyed on argv (the `closing-links-cli.test.js` style):
  - `composeCloseComment` output equals the template text read live from `plugin/skills/wrap-up/verification-brief-parent-gate.md` step 2 (heading line plus first paragraph, with `{maxTier}`/`{riskFloor}` substituted). With `notPlanned: true`, the line `No sub-issue closed as completed, so this parent closes as not planned.` follows the first paragraph. This is the prose-code twin pin.
  - Default branch `main` != `integrationBranch: 'develop'` (`gh repo view --json defaultBranchRef -q .defaultBranchRef.name`): `closed: []`, `skipped: [{ reason: 'non-default-branch' }]`, and no other `gh` call.
  - Happy path, `workLinks: 'native'`: closing set `[11]`, parent 10, siblings 11 (OPEN live but counted CLOSED by self-inclusion) and 12 (CLOSED, COMPLETED). All `risk:low`, `riskFloor: 'high'`, parent labels `['parent-issue']`. Asserts one `issue comment 10 --body-file -` call whose input starts with `CLOSE_HEADING`, lists `- #11 {title} — closed by PR #{mergingPr}` and `- #12 {title} — closed by PR #{its closedByPullRequestsReferences last number}` in number order, then `issue close 10 --reason completed`, and the result `closed: [{ parent: 10, maxTier: 'low' }]`.
  - `workLinks: 'body-text'`: the parent comes from the sub-issue body's `^Parent: #(\d+)` line; sub-issues come from `parseSubIssues(parent body)`.
  - Idempotence (AC2): parent already `CLOSED` → no comment, no close, `skipped: [{ parent: 10, reason: 'already-closed' }]`. A trusted (`MEMBER`) comment carrying the heading → no second comment, close only. A `CONTRIBUTOR` comment carrying the heading reads as absent (the comment is posted).
  - Parent `stateReason: 'REOPENED'` → `reopened-by-human`, no write.
  - A sibling with no `risk:*` label → `exceeds` (`above-floor`), no write. `maxTier` at or above `riskFloor` → `above-floor`.
  - A parent without the `parent-issue` label → `not-parent-issue-labeled`. A `needs:*` label → `needs-label`.
  - A sibling still OPEN and not in the closing set → `incomplete`. A sibling in `unsettled` → `sibling-unsettled`.
  - Two closing records sharing a parent → that parent is evaluated once.
  - A thrown `gh` call while handling one parent → that parent is skipped `gh-failed`, and the next closing record's parent is still processed.
  - Every sub-issue closed `NOT_PLANNED` and none in the closing set → `--reason not planned`.
- [ ] **Step 2: Run** `node --test tests/bin-lib/issues/below-floor-parent-close.test.js`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement** the module. It follows the prose order exactly: default-branch check once; then per closing record in ascending order: resolve parent, skip parents already handled, enumerate sub-issues, fetch each sub-issue (`issue view {n} --repo {owner}/{repo} --json state,stateReason,labels,title,closedByPullRequestsReferences`), fetch parent labels, apply the label skips, apply self-inclusion (closing-set members count `CLOSED`/`COMPLETED`), apply the unsettled skip, call `parentGateState`, then `exceedsOversightFloor({ risk: maxTier }, { riskFloor, sizeFloor: null })`. On `due` + `exceeds: false`, run the idempotence read (`issue view {parent} --json state,stateReason,comments` and `api user --jq .login`), then comment via stdin, then close. Native enumeration uses `api --paginate repos/{owner}/{repo}/issues/{parent}/sub_issues --jq .[].number`. No resolvable parent is a silent no-op. Header comment: name the prose it mirrors and the `#205` default-set rule it does not need (the set is always explicit here).
- [ ] **Step 4: Run** the Step 2 command. Expected: PASS.
- [ ] **Step 5: Commit** `Add a Node mirror of Step 4.0b's below-floor parent close (refs #4599)`.

### Task 3: The `post-merge` reconcile check

**Review risk:** high

**Files:**
- Create: `plugin/bin/lib/reconcile/post-merge.js`
- Test: `tests/bin-lib/reconcile/post-merge.test.js`

**Interfaces:**
- Consumes: Task 1's `run` (`require('../../closing-links').run`) with `--close-window-ms`, and Task 2's `closeBelowFloorParents`. Also `listRunDirsWithState` (`hooks/context.js`), `readWorkBackend`, `repoSlugOf` (`hooks/git-exec.js`), `resolvePolicyKeys` (`policy-schema.js`, keys `work-links` and `risk-floor` read from `.claude-tweaks/policy.yml`, defaults on a missing file), `appendEntry`/`formatEntry`/`parseEntry` (`log-decision/append.js`), `execFileSyncTimed` (`./timing`).
- Produces:
  - `MARKER_STEP = 'reconcile post-merge'`, `CLOSE_WINDOW_MS = 600000`, `MERGE_GRACE_MS = 600000`, `CLAIM_STALE_MS = 600000`, `CLAIM_FILENAME = '.post-merge.lock'`.
  - `hasPostMergeMarker(decisionsText) -> boolean` (the Global Constraints rule).
  - `async postMerge({ cwd, integration, prStates, dryRun, now, deps }) -> { entries: [{ runDir, pr, action: 'ran' | 'skipped', reason?, closingLinks?, parentsClosed? }], deferred: string[], failure? }`. `deferred` holds the absolute run dirs skipped with a retryable reason (Global Constraints' archive rule). It is always an array, empty on `failure`. `deps` overrides `{ gh, closingLinksRun, closeParents }` for tests. `failure` is `'no-remote'` or `'not-github-issues'`. `now` is a function returning epoch ms (default `Date.now`).
  - Per run, in this order: skip silently when `pr.number` is absent, the marker is present, or the PR is `OPEN`/`CLOSED`. A failure string from `prStates.byNumberAsync` gives an entry `skipped` with that reason (`gh-absent` included). A `MERGED` PR whose `mergedAt` is missing, unparseable, or less than `MERGE_GRACE_MS` before `now()` gives `skipped: 'merge-grace'`. Under `dryRun` a merged, unmarked run past the grace window gives `skipped: 'dry-run'` and nothing is written, the claim file included. Otherwise take the per-run claim (Global Constraints): a live claim gives `skipped: 'in-flight'`, a create error other than `EEXIST` gives `skipped: 'claim-failed'`, and the claim is removed in a `finally`. Re-read `decisions.md` for the marker after taking the claim, so a pass that finished between the first read and the claim is seen.
  - Otherwise: call `closingLinksRun(['--run', dir, '--mode', 'post-merge', '--settle-ms', '0', '--close-window-ms', String(CLOSE_WINDOW_MS)], { cwd: () => root, mainRoot: root, ghAvailable: () => true, gh: timedGh, stdout, stderr })` and parse its JSON.
    - No `closingSet` (non-zero exit or any other action): append `SKIP` `MARKER_STEP` with the text `condition: Step 4.0 returned {action or exit N}, no closingSet → fallback: no parent closed; the tidy parent-gate backstop recovers them`. Entry `ran`.
    - Else call `closeParents` with `closingSet`, `unsettled = reopened + pendingClose + failed[].issue`, `mergingPr: pr`. Log one `AUTO` line per closed parent (`closed parent #{p} below the oversight floor (risk:{t}, risk-floor {f})`, reversibility `high (gh issue reopen)`). Then log the summary `AUTO` marker: `ran Steps 4.0 and 4.0b for PR #{pr}, merged after its session: closing links {action}; {k} parent(s) closed` plus `; skipped #{p} ({reason})` for each skip carrying a parent. Reversibility `n/a`.
    - A failed marker append gives an entry `skipped: 'marker-write-failed'` (Global Constraints: archive may still archive the run, and nothing runs twice).

- [ ] **Step 1: Write the failing tests** on a temp main checkout: a `.git` dir, a `CLAUDE.md` with `work-backend: github-issues`, and run dirs under `.claude-tweaks/pipelines/{RUN_ID}` holding `run-state.json` with `pr: { number }`. Use a fake `prStates` (`{ byNumberAsync }`) and fake `closingLinksRun`/`closeParents`. Tests:
  - Merged unmarked run (fake `prStates` returns `{ state: 'MERGED', mergedAt }` one hour before a fixed `now()`, used by every test below unless stated) → `closingLinksRun` is called with the argv above, `closeParents` gets the closing set and the unsettled set, `decisions.md` gains the parent line plus the summary marker, and the entry is `ran`.
  - A second `postMerge` call on the same fixture → neither fake is called (exactly once).
  - A run whose `decisions.md` already holds a line written by `formatEntry({ status: 'AUTO', step: 'pr-first-merge Step 4.0b', ... })`, and a separate run holding only the `SKIP` `pr-first-merge Step 4.0b (skipped)` line → no fake is called.
  - A clean-status run (`status: 'clean'`) is processed too.
  - `OPEN` PR → no entry, no call. `prStates` returning `'network-failure'` → entry `skipped`/`network-failure`, no marker.
  - Merge grace: `mergedAt` 2 minutes before `now()` → `skipped`/`merge-grace`, no fake called, `decisions.md` unchanged, and the run dir is in `deferred`. `mergedAt` absent → `merge-grace` too. `mergedAt` 11 minutes before → runs, not in `deferred`.
  - `deferred` membership: `in-flight` and `network-failure` runs are listed; `marker-write-failed`, `gh-absent`, `dry-run`, marked, and `OPEN` runs are not.
  - Claim: a fresh `.post-merge.lock` already in the run dir → `skipped`/`in-flight`, no fake called, the lock file left in place. A lock file with mtime 11 minutes old → taken over, the run proceeds, and no lock file remains afterwards. After a normal run no `.post-merge.lock` remains. A `closingLinksRun` that throws still leaves no lock file.
  - Marker re-read under the claim: a fake `closingLinksRun` is never reached when the marker line is appended to `decisions.md` between the first read and the claim. Simulate it with a `deps.beforeClaim` hook that appends the marker; the hook exists for tests only.
  - `closingLinksRun` returning exit 5 → `SKIP` marker naming `exit 5`, `closeParents` not called.
  - `dryRun: true` → entry `dry-run`, `decisions.md` byte-identical before and after.
  - No `CLAUDE.md` → `failure: 'not-github-issues'`, no calls.
  - `hasPostMergeMarker` unit cases: the `spec #N — pr-first-merge Step 4.0b` location matches; `pr-first-merge Step 4.1` does not.
- [ ] **Step 2: Run** `node --test tests/bin-lib/reconcile/post-merge.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement** `post-merge.js` with the pattern of `release-merged.js`: pure helpers (`hasPostMergeMarker`, the summary-text composer), I/O at the edges, a timed `gh` default (`execFileSyncTimed('gh', args, { cwd: root, input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: GH_TIMEOUT_MS, windowsHide: true })`), and owner/repo split from `repoSlugOf(root)`. Run dirs are processed serially.
- [ ] **Step 4: Run** `node --test tests/bin-lib/reconcile/post-merge.test.js tests/bin-lib/reconcile/subprocess-timing-conformance.test.js`. Expected: PASS.
- [ ] **Step 5: Commit** `Add the post-merge reconcile check — Steps 4.0 and 4.0b once for an armed PR GitHub merged later (refs #4599)`.

### Task 4: Register `post-merge` across the reconcile family

**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/reconcile/index.js`. Add `'post-merge'` to `ALL_CHECKS`; insert it into `DISPATCH_ORDER` between `release` and `archive` and shift every later `DISPATCH_ORDER.slice(k)` index by one. `PREREQUISITES.archive` becomes an array `[{ check: 'mirror', satisfiedBy: ['remote-prune'] }, { check: 'post-merge', satisfiedBy: [] }]`; `expandChecks` accepts an entry or an array of entries. Add `postMerge: null` to the result literal and the header comment's shape line. Add the dispatch block (`timePhase('post-merge', …)`; `failure` goes to `skipped`; otherwise `result.postMerge = r.entries`), passing `integration`, `prStates`, `dryRun`. Keep `r.deferred` in a pass-local variable (empty array when post-merge did not run or failed) and pass it to the `archiveMerged` call as `postMergeDeferred`. Add `post-merge` to the `local-merge-model` skip list string.
- Modify: `plugin/bin/lib/reconcile/archive-merged.js`. `archiveMerged` accepts `postMergeDeferred = []`. Inside its run-dir loop, before any other per-run work, a dir whose resolved path is in that set is pushed to `skipped` as `{ runDir, reason: 'post-merge-pending' }`, with no `track` call, and the loop continues. Name the reason in the function's header comment.
- Modify: `plugin/bin/hooks.js`. Add `'post-merge'` to `BACKGROUND_CHECKS` (not `CLI_DEFERRED_CHECKS`) and `postMerge: null` to the `reconcile-threw` fallback literal.
- Modify: `plugin/bin/lib/reconcile/format-summary.js`. Add the `CATEGORIES` row `{ key: 'postMerge', unit: 'merged run', verb: 'post-merge steps run', takenActions: ['ran'], skipActions: ['skipped'] }`.
- Modify: `plugin/skills/tidy/scan-procedures.md`'s explicit reconcile `--checks` list; add `post-merge`.
- Modify: `docs/reconcile-checks.md`. Update the dispatch-order bullet, the prerequisites table (an archive row for `post-merge`), the `release,archive,reap` expansion example, and the Timing contract phase names, and add a `## Post-merge closes (#4599)` section. It states:
  - the population (Reading B: every top-level run whose recorded PR is `MERGED` with no Step 4.0b marker, keyed on the recorded PR, exactly once);
  - the marker rule;
  - the one-time catch-up: on the first reconcile after this ships, legacy runs and runs merged in-session by an older installed build (which writes no summary marker) get a late Step 4.0 and Step 4.0b pass once, bounded by the 10-minute reopen window after `mergedAt` and by Step 4.0b's idempotence checks (parent already `CLOSED` means no-op; an existing trusted heading comment means close only);
  - the two concurrency guards (merge grace window, per-run claim file), and archive's `post-merge-pending` skip for runs post-merge deferred in the same pass;
  - the `gh`-absent skip and the fail-open-to-tidy posture;
  - why the archive guard is bounded: only same-pass retryable skips defer archiving, and a marker-write failure cannot cause a second run.
- Modify: `docs/hooks.md` (the Background convergence bullet's two check lists) and `docs/plugin-structure.md` (the `plugin/bin/lib/reconcile/` and `issues/` inventory lines).
- Test: `tests/bin-lib/reconcile/archive-merged.test.js` (the direct `archiveMerged` guard test) and `tests/reconcile.test.js` (expandChecks expectations, the same-pass archive-guard test, `INLINE_UNSCOPED_CHECKS` gains `post-merge`, the `local-merge-model` skip string, dispatch-order assertions), `tests/bin-lib/hooks/reconcile-background.test.js` and `tests/hooks-session-start.test.js` partition, and the `format-summary` test.

- [ ] **Step 1: Write the failing tests.**
  - `expandChecks(['release','archive','reap'])` deepEquals `['release','mirror','post-merge','archive','reap']`.
  - `expandChecks(['archive','remote-prune'])` deepEquals `['post-merge','archive','remote-prune']`.
  - `expandChecks(ALL_CHECKS)` deepEquals `ALL_CHECKS`.
  - A `reconcile({ checks: ['archive'], … })` fixture with a stubbed `post-merge` module records that `post-merge` ran before `archive` (monkeypatch through `require.cache`, as the tests near line 2100 do).
  - `formatReconcileSummary` renders `1 merged run post-merge steps run`.
  - Archive guard, as a same-pass test: a `reconcile({ checks: ['archive'], … })` fixture whose stubbed `post-merge` returns `deferred: [runDir]` gives `result.runs` an entry `{ runDir, action: 'skipped', reason: 'post-merge-pending' }`, and the run dir still exists at its top-level path. With `deferred: []`, the same merged run is archived.
  - `archiveMerged({ postMergeDeferred: [dir], … })` directly: the dir is skipped `post-merge-pending`, and the stuck-skip cache gains no entry for it.
  - Run `git grep -n "remote-prune', 'ledger-residue', 'reap'\|'release', 'archive'" tests plugin docs` first and update every hard-coded order you find.
- [ ] **Step 2: Run** `node --test tests/reconcile.test.js tests/bin-lib/hooks/reconcile-background.test.js tests/hooks-session-start.test.js "tests/bin-lib/reconcile/*.test.js"` with output redirected to a scratch `.txt` file. Expected: the new assertions FAIL.
- [ ] **Step 3: Implement** every registration site above.
- [ ] **Step 4: Run** the Step 2 command. Expected: PASS. Any pre-existing archive or reconcile fixture that now fails: confirm its cause is the new check (a fixture with no `CLAUDE.md` skips `not-github-issues` and must stay unaffected) before changing the fixture.
- [ ] **Step 5: Commit** `Register the post-merge check before archive and as its prerequisite (refs #4599)`.

### Task 5: Prose — the reconciler, not the backstop, now catches an unseen merge

**Files:**
- Modify: `plugin/skills/_shared/pr-first-merge-post-merge.md`
  - Step 4.0: replace "An `armed` outcome never reaches this step, and the reconciler does not run the CLI;" with a sentence saying the reconciler's `post-merge` check runs the CLI for that run once GitHub merges it (no settle poll, reopens bounded to 10 minutes after `mergedAt`). Keep the `--keep-open` clause.
  - Step 4.0b: replace the sentence "A merge no session sees land (an `armed` PR that GitHub merges later) never reaches it either, by design: `/claude-tweaks:tidy`'s `parent-gate` backstop recovers that parent." with: "A merge no session sees land (an `armed` PR that GitHub merges later) never reaches it either: the reconciler's `post-merge` check runs Steps 4.0 and 4.0b for that run once, keyed on its recorded PR (`docs/reconcile-checks.md`'s Post-merge closes), and `/claude-tweaks:tidy`'s `parent-gate` backstop stays the last resort."
  - After **Log each parent closed**: add an always-written summary line (whatever happened above, once Step 4.0b is reached after a PR merge, the non-default-branch no-op included):
    `node "${CLAUDE_PLUGIN_ROOT}/bin/log-decision.js" --run "$PIPELINE_RUN_DIR" --status AUTO --step "pr-first-merge Step 4.0b" --reversibility n/a --text "evaluated PR #{pr-number}'s closing records: {k} parent(s) closed"`
    with one sentence explaining that this line is how the reconciler knows the step already ran. Under `local-files`, or with exit 3, there is no line.
- Modify: `plugin/skills/wrap-up/verification-brief-parent-gate.md`, the **Sub-issue-side entry, `work-backend: github-issues`** bullet under `exceeds: false` (about line 312). Replace "`/claude-tweaks:tidy`'s `parent-gate` backstop catches a merge no session saw land." with: "A merge no session saw land is closed by the reconciler's `post-merge` check, a code mirror of this entry (`bin/lib/issues/below-floor-parent-close.js`); `/claude-tweaks:tidy`'s `parent-gate` backstop catches whatever that leaves open."
- Modify: `docs/journeys/close-a-below-floor-decomposition-parent-4466.md` step 3. The tidy row now appears only for a parent the reconciler could not close (a `gh` failure, a Step 4.0 result with no closing set); an armed merge GitHub completed later is closed by the next reconcile pass.
- Test: `tests/below-floor-parent-close-conformance.test.js` line 245. Update the pinned sentence to the new Step 4.0b text, and add assertions for the summary log command's `--step "pr-first-merge Step 4.0b"` literal (the marker the reconciler parses) and for Step 4.0's `post-merge` mention.
- Deliberately unchanged: `docs/decisions/0028-below-floor-parents-close-autonomously-after-the-merge.md` (historical decision record). Tidy's own files (its backstop behavior does not change).

- [ ] **Step 1: Update the pin and add the new assertions** in `below-floor-parent-close-conformance.test.js`, including one that `hasPostMergeMarker` (Task 3) returns true for a line built by `formatEntry` from the prose command's `--step` value. That ties the prose marker to the parser.
- [ ] **Step 2: Run** `node --test tests/below-floor-parent-close-conformance.test.js`. Expected: FAIL.
- [ ] **Step 3: Edit** the three files as specified, checking each skill file stays under the `RAIL_BYTES` rail (`wc -c`).
- [ ] **Step 4: Run** `node --test tests/below-floor-parent-close-conformance.test.js tests/closing-links-prose-conformance.test.js`, then the full `npm test` redirected to a scratch file. Expected: PASS.
- [ ] **Step 5: Commit** `State that the reconciler runs Step 4.0b for an armed merge — tidy stays the last resort (refs #4599)`.
