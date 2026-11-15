# Remove the Unused archive-merged Wrappers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete five production-unused wrappers and the `merged` classifier branch from `plugin/bin/lib/reconcile/archive-merged.js`, with their tests repointed at `classifyRunDir`, `decideArchiveCore` and `ownEventRecency`, and every mention of the removed names reworded.

**Architecture:** Repoint, then delete. Task 1 repoints the tests on the unmodified source, so each is seen green against the function production calls and red under a scratch mutation of that function. Task 2 deletes the wrappers, the `merged` branch and the conformance scan's second allowed span in one commit. Tasks 3 and 4 reword docs, skill prose and comments. No run directory is archived, skipped or reported differently.

**Tech Stack:** Node 18+, `node --test`, no dependencies.

**Spec:** `.claude-tweaks/pipelines/2026-11-15T231130-spec-5544/work/5544-spec.md` (record #5544). Its line numbers are seven lower than this tree's for everything after `archive-merged.js:46`; this plan's line numbers are this tree's (`026e203f3`).

## Global Constraints

- Removed names: `isAdHocStandaloneSuperseded`, `isOrphanedMint`, `lastOwnEventMs`, `isAbandonedInterrupted`, `decideArchive` (the one in `archive-merged.js` only).
- Out of scope, do not touch: `isStructurallyStuck` (`archive-merged.js:1908`, called by `trackStuckSkip`); `decideArchive` in `plugin/bin/lib/reconcile/archive-branches.js:70` and its tests in `tests/bin-lib/reconcile/archive-branches.test.js`; `plugin/bin/lib/reconcile/cache.js`; `docs/incident-log.md`; `docs/superpowers/plans/**`; anything under `.claude-tweaks/pipelines/`.
- `plugin/bin/hooks.js`: edit only the two comment lines `:292` and `:1442`. Records #5376 and #5377 are in progress on that file.
- Replacement vocabulary for a removed name in prose and comments, keeping the sentence's rule: `isOrphanedMint` → the `orphaned-mint` classification; `isAbandonedInterrupted` → the `abandoned-interrupted` classification; `isAdHocStandaloneSuperseded` → the `adhoc-superseded` classification; `lastOwnEventMs` → `ownEventRecency`; `decideArchive` → `decideArchiveCore`, or "the merged-PR decision" where the sentence is about the removed `merged` kind.
- `git grep -E` with `\b` matches nothing on this machine. Use `-w`, `-F` or `-P`.
- One plain command per Bash call in this worktree session (no `&&`, no `$(...)` around git, no heredocs). Write file content with the Write or Edit tool.
- Commit style `{Verb} {what} — {detail}`, body line `refs #5544`, last line `Claude-Session: https://claude.ai/code/session_01UwjosFpW1CPUSQZtTWpCad`. Stage files by explicit path.
- Scope: "Commit tests only where the task asks for them or the repo already keeps tests for this kind of change, sized like the neighboring test files; scratch checks stay scratch. Touch only what the task requires — a pre-existing bug you notice is a follow-up to report, not a fix to fold in, unless the task cannot work without it. Don't reformat or "improve" adjacent code; edit in place rather than rewrite when the result is the same."
- Evidence: every scratch check a task runs to prove an acceptance criterion writes its full output to `/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines/2026-11-15T231130-spec-5544/evidence/{name}.txt` (create the directory first with `mkdir -p`, write with a plain Bash redirect) and the task report quotes the command and the pass/fail counts verbatim. The check's code is never committed.
- Scratch mutations run in a `git archive` extract under the session scratchpad, never in this worktree and never in a linked worktree: `git archive --format=tar --output={scratchpad}/t{N}.tar HEAD`, `mkdir -p {scratchpad}/t{N}`, `tar -xf {scratchpad}/t{N}.tar -C {scratchpad}/t{N}`, each its own call; edit the extract's copy and run `node --test` with the extract's absolute test paths. If a test file cannot run from the extract, say so in the report rather than mutating the worktree.
- Governing project skill `bin-source-scan-conformance` (applies to `tests/run-liveness-callers-conformance.test.js`), quoted:
  - "`assert.deepEqual(offenders, [])` over the walk also passes when the matcher matches nothing. For a scan that matches compliant and non-compliant sites alike, assert a lower bound on matches across the tree, and make the message say what a low count means. … Set the floor to the count at the time the scan lands. Raise it when sites are added. Never lower it to make the suite green."
  - "A floor that counts allow-listed sites drops when a change moves those sites onto the convention, and that drop is not lost recall. Lower it in the same change by exactly the number of sites moved, update the per-file exact count beside it, and name the record and the move in the floor's comment. … A floor with no exact per-file count beside it has no such proof, so it stays where it is."
  - "Changing an existing scan's matcher | Add the planted case that motivated the change to its self-test first, and watch it fail against the old code"
  - Ruling for this plan: `SCOPED_SITE_FLOOR` counts one file's allowed sites and has no per-file count beside it, and deleting `lastOwnEventMs` removes exactly one allowed site (its body's `ownEventRecency(runDir)` call, `archive-merged.js:405`), which leaves 7 and makes a floor of 8 unsatisfiable. Task 2 lowers it by exactly one, names #5544 and that site in the comment, and records the measured count before (8) and after (7) as the proof the skill asks for. The planted case that "fails against the old code" cannot name the retired function (AC1 bans the name in `tests/`), so the go-red rows use `newHelper` and `ttlReader`.

## Plan-time probes (recorded output)

- Sole-site proof, `git grep -n -w -e isOrphanedMint -e isAbandonedInterrupted -e isAdHocStandaloneSuperseded -e lastOwnEventMs -- plugin`: in code, the names appear only in `archive-merged.js` (definitions `:203`, `:239`, `:404`, `:440`, export list `:2818-2820`); every other `plugin/` hit is a comment or skill prose (`background-spawn.js:47`, `index.js:111`, `probes.js:50,55`, `dispatch/SKILL.md:212`, `flow/claim-targets.md:387`, `reflect/full-mode.md:182,186,194`). No module imports any of the five.
- `git grep -c -P "(?<![A-Za-z_.])decideArchive\(" -- …` today: `archive-merged.js` 1 (the definition), `tests/reconcile.test.js` 4, `archive-merged-record-guards.test.js` 3, `archive-merged.test.js` 0, `archive-branches.test.js` 16 (must stay 16).
- `git grep -n -F "kind === 'merged'" -- plugin/bin/lib/reconcile/archive-merged.js` today: `:594` (inside `decideArchive`) and `:2025` (inside `classifyRunDir`).
- Scoped-token sites allowed today (`git grep -n -w -e ownEventRecency -e STALE_INTERRUPTED_TTL_MS`, comments excluded): `:19` import, `:400` declaration, `:405` wrapper body, `:1974`, `:1984`, `:1993` in `classifyRunDir`, two in the export list `:2819` = 8.
- `decideArchive(a, b)` equals `decideArchiveCore(a, b)` for every defined `a`: the wrapper reaches the core as `decideArchiveCore(prState, consoleState, undefined, undefined, undefined)` and drops only `hint`/`unclosed`, which a 2-argument core call never sets (`unknown-host` without a `recordCheck` returns no hint, `:487`; `archiveUnlessTiebreakGap(undefined)` returns `{ action: 'archive' }`, `:544`). An undefined `prState` differs (wrapper: `reason: undefined`; core: `no-pr`); no test passes one.
- AC7 baseline, `node plugin/bin/hooks.js reconcile --dry-run --json` at `026e203f3`: exit 0, top-level keys `background,branches,claims,console,ledgerResidue,mirror,postMerge,redTip,remoteBranches,residueErrors,residuePlan,runs,skipped,timings,worktrees`.
- Moved-prose pins: `git grep -n -F -e "sweep catches it" -e "archive sweep (" -e "uses to detect an abandoned" -e "from that mtime sweep entirely" -e "skips a run whose console was never rendered" -- tests plugin .claude/skills` hits only the four skill lines themselves; the one test pin on this prose is `tests/run-dir-timestamp-utc.test.js:61`. Absence control for its reworded regex: `/orphaned-mint` sweep reclaims after 24h if it was freshly minted here/` matches the retired sentence in its reworded form (`true`) and not today's line 387 (`false`).
- Size rail (`RAIL_BYTES` 52,500): `dispatch/SKILL.md` 52,088 B (headroom 412; this plan's edit is −1 B), `flow/claim-targets.md` 39,689, `reflect/full-mode.md` 39,731, `wrap-up/cleanup-procedures-execution.md` 47,492.

## Review Focus

1. A repointed `abandoned-interrupted` call that drops the `...ctx` spread stops injecting `runVerdict` and still passes where the real probes happen to agree. Task 1's helper carries the wrapper's exact argument and its mutation run shows the tests red.
2. A caller that still passes a `prState` or `kinds: ['merged']` to `classifyRunDir` after the branch is gone. It must read `none` with empty evidence, never throw. Task 2's `AC3` test pins it.
3. The conformance scan passing vacuously once its second span is gone. Task 2 keeps the span-exists assertion for `classifyRunDir`, the floor, and go-red rows for both tokens outside the span.
4. A deleted comment taking a kind's criterion with it. Task 2 moves each wrapper comment that explains the kind (not the wrapper) onto that kind's branch.
5. Reworded skill prose breaking a conformance pin or the size rail. Task 4 keeps `dispatch/SKILL.md` at or under its current size and rewords the one pinned regex with the prose.

---

### Task 1: Repoint the wrapper tests at the surviving functions

**Role:** integration

**Files:**
- Modify: `tests/reconcile.test.js`
- Modify: `tests/bin-lib/reconcile/archive-merged.test.js`
- Modify: `tests/bin-lib/reconcile/archive-merged-record-guards.test.js`
- Modify: `tests/bin-lib/reconcile/archive-merged-helpers.js`

**Interfaces:**
- Consumes (all exported today from `plugin/bin/lib/reconcile/archive-merged.js`): `classifyRunDir(ctx, now = Date.now()) -> { kind, ttlMs, evidence }`; `decideArchiveCore(prState, consoleState, hasStagedPending, recordCheck, coverage) -> { action: 'archive' } | { action: 'skip', reason, … }`; `ownEventRecency(runDir) -> { readable, lastOwnMs }`.
- Produces: no test file names a removed wrapper; `archive-merged.js` is not edited in this task.

- [ ] **Step 1: Repoint every call site, on the unmodified source**

Exact arguments (copy them; a call that omits a field can pass for the wrong reason):

| Old call | New call |
|---|---|
| `isOrphanedMint(dir)` / `isOrphanedMint(dir, now)` | `classifyRunDir({ dir, kinds: ['orphaned-mint'] }[, now]).kind`, asserted equal to `'orphaned-mint'` (was `true`) or `'none'` (was `false`) |
| `isAdHocStandaloneSuperseded(dir, state, worktrees[, now])` | `classifyRunDir({ dir, state, worktrees, kinds: ['adhoc-superseded'] }[, now]).kind`, asserted `'adhoc-superseded'` or `'none'` |
| `isAbandonedInterrupted(runDir, state, sessionId, now, ctx)` | one file-local helper in `archive-merged.test.js`, used by all 20 sites: `const abandoned = (runDir, state, sessionId, now = Date.now(), ctx = {}) => classifyRunDir({ ...ctx, dir: runDir, state, sessionId, kinds: ['abandoned-interrupted'] }, now).kind === 'abandoned-interrupted';` |
| `lastOwnEventMs(dir)` | `ownEventRecency(dir).lastOwnMs` |
| `decideArchive(prState, consoleState)` | `decideArchiveCore(prState, consoleState)` (same `deepStrictEqual` expectations) |

Also in this step:
- Rename every test title and comment in these four files that names a removed wrapper, using the title prefixes `classifyRunDir orphaned-mint:`, `classifyRunDir adhoc-superseded:`, `classifyRunDir abandoned-interrupted:`, `ownEventRecency:`, `decideArchiveCore:` and the Global Constraints vocabulary for comments (`archive-merged.test.js:2307-2371` and `tests/reconcile.test.js:935` name `decideArchive` in titles and comments; `archive-merged-helpers.js:151,160,255` name three wrappers in comments).
- Replace the two `merged`-kind tests at `archive-merged-record-guards.test.js:1304-1315` with one test, `decideArchiveCore: archives a merged PR with a resolved console, and carries the skip reason for gh-absent (AC5)`, asserting `decideArchiveCore({ state: 'MERGED', mergeCommit: { oid: 'a'.repeat(40) } }, 'resolved')` deep-equals `{ action: 'archive' }` and `decideArchiveCore('gh-absent', 'none')` deep-equals `{ action: 'skip', reason: 'gh-absent' }`.
- In the precedence test at `:1286-1302`, replace the two wrapper assertions (`:1299-1300`) with the scoped `classifyRunDir` forms from the table (`'none'` for `orphaned-mint`, `'adhoc-superseded'` for `adhoc-superseded`).
- Surface pin `archive-merged.test.js:1239-1243`: delete the `decideArchive` and `isOrphanedMint` assertions; keep the `readConsoleState` one.
- Remove the removed names from every `require` destructure in the four files (including the unused `isOrphanedMint` import at `archive-merged-helpers.js:13`), and add `classifyRunDir`, `decideArchiveCore`, `ownEventRecency` where a file now needs them.
- Write the old-title → new-title map (one line per renamed or replaced test) to `{evidence}/ac5-title-map.txt`.

- [ ] **Step 2: Run the four files' suites green on the unmodified source**

Run: `node --test tests/reconcile.test.js tests/bin-lib/reconcile/archive-merged.test.js tests/bin-lib/reconcile/archive-merged-record-guards.test.js`
Expected: PASS — 0 failures, and the same test count as before Step 1 minus one (two `merged`-kind tests became one).

- [ ] **Step 3: Check AC1.1 and AC2.1 for the test side**

Run: `git grep -n -w -e isOrphanedMint -e isAbandonedInterrupted -e isAdHocStandaloneSuperseded -e lastOwnEventMs -- tests/reconcile.test.js tests/bin-lib/reconcile`
Expected: no output.
Run: `git grep -n -P "(?<![A-Za-z_.])decideArchive\(" -- tests/reconcile.test.js tests/bin-lib/reconcile/archive-merged-record-guards.test.js tests/bin-lib/reconcile/archive-merged.test.js`
Expected: no output. `git grep -c -P "(?<![A-Za-z_.])decideArchive\(" -- tests/bin-lib/reconcile/archive-branches.test.js` still prints 16 (AC2.2).

- [ ] **Step 4: Commit**

Stage the four files by path and commit `Repoint the archive-merged wrapper tests — call classifyRunDir, decideArchiveCore and ownEventRecency directly`.

- [ ] **Step 5: Verify the repointed classifier tests go red under a mutation of `classifyRunDir`**

In an archive extract of the Step 4 commit, for each of the kinds `orphaned-mint`, `adhoc-superseded`, `abandoned-interrupted`, run the three test files twice against a mutated `archive-merged.js`: (a) that kind's branch never returns its kind; (b) that kind's branch returns its kind as soon as it is entered, every guard skipped. Save the six outputs to `{evidence}/task1-mutation-{kind}-{a|b}.txt`. Every repointed test for that kind must fail in (a) or (b); list any that passes both, with the reason, in the report. Report per run: command, tests, pass, fail.

- [ ] **Step 6: Verify the `decideArchiveCore` and `ownEventRecency` repoints go red the same way**

In the same extract: make `decideArchiveCore` return `{ action: 'skip', reason: 'mutated' }` first thing, and separately make `ownEventRecency` (`plugin/bin/lib/run-liveness/probes.js`) return `{ readable: true, lastOwnMs: 1 }`; save to `{evidence}/task1-mutation-core.txt` and `{evidence}/task1-mutation-recency.txt`. The seven repointed `decideArchiveCore` call sites' tests and the two `ownEventRecency` tests must fail (AC5.1). Step 1's title map is what the pull request quotes (AC5.2); put it in the report too.

---

### Task 2: Delete the wrappers and the `merged` branch, and narrow the conformance scan

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/reconcile/archive-merged.js`
- Modify: `tests/run-liveness-callers-conformance.test.js`
- Modify: `tests/bin-lib/reconcile/archive-merged-record-guards.test.js`
- Test: `tests/bin-lib/reconcile/archive-merged.test.js`

**Interfaces:**
- Consumes: Task 1's repointed tests (no test names a removed wrapper).
- Produces: `archive-merged.js` no longer exports or defines the five removed names; `classifyRunDir`'s `kind` is one of `'orphaned-mint' | 'abandoned-interrupted' | 'adhoc-superseded' | 'adhoc-session-ended' | 'structurally-stuck' | 'none'`; `CLASSIFY_ORDER` has five entries; the scan's only allowed function span is `classifyRunDir`, hit message `{token} outside classifyRunDir`.

- [ ] **Step 1: Add the failing test for the removed kind**

In `archive-merged-record-guards.test.js`, after the Task 1 `decideArchiveCore` test, add `AC3: classifyRunDir has no merged kind — a prState reads none, with or without kinds: ['merged']`: `classifyRunDir({ prState: { state: 'MERGED' }, consoleState: 'resolved' })` and `classifyRunDir({ prState: { state: 'MERGED' }, consoleState: 'resolved', kinds: ['merged'] })` each deep-equal `{ kind: 'none', ttlMs: null, evidence: {} }`.

- [ ] **Step 2: Run it and see it fail**

Run: `node --test --test-name-pattern "AC3: classifyRunDir has no merged kind" tests/bin-lib/reconcile/archive-merged-record-guards.test.js`
Expected: FAIL after Step 1 — `kind` is `'merged'` on the unmodified source.

- [ ] **Step 3: Edit `archive-merged.js`**

- Delete the functions `isAdHocStandaloneSuperseded` (`:203`), `isOrphanedMint` (`:239`), `lastOwnEventMs` (`:404`), `isAbandonedInterrupted` (`:440`), `decideArchive` (`:592`), and their five export entries (`:2816-2820`).
- Comments: delete each `#1732: thin wrapper …` sentence (`:201-202`, `:233-238`, `:402-403`, `:431-439`). A wrapper comment that explains the kind's criterion, not the wrapper (`:229-232` on what an orphaned mint is; `:408-430` on the ownership half of abandoned-interrupted), moves onto that kind's branch inside `classifyRunDir`, reworded so it no longer says "this function". Make `isStructurallyStuck`'s comment (`:1906-1907`) self-contained: it scopes the classifier to its one kind with `kinds: ['structurally-stuck']`.
- `classifyRunDir`: delete the `merged` branch (`:2025-2038`); drop `prState` and `consoleState` from the destructure (`:1956`); remove `'merged'` from `CLASSIFY_ORDER` (`:1952`) and from the return-type docblock (`:1949-1951`); rewrite the header comment (`:1912-1947`) to say: four TTL kinds plus `structurally-stuck`, first-match in `CLASSIFY_ORDER`; `ctx.kinds` scopes a call to a subset, and every caller passes one (the main loop four kinds, its companion re-classify two, `isStructurallyStuck` one); the merged-PR decision is `decideArchiveCore`'s, called by `archiveMergedRun`, and never routed through the classifier.
- `decideArchiveCore`'s comment (`:465-469`): it is the merged-PR decision, called by `archiveMergedRun`'s two paths (`:2229`, `:2278`); no wrapper.
- Reword every other mention of a removed name in the file with the Global Constraints vocabulary (`:65`, `:90`, `:96`, `:101`, `:257`, `:388`, `:1115`, `:1120`, `:1852`, `:2270`, `:2446`, `:2606`; `:2028` goes with the branch). `hasStagedItems`, `runTiebreakCoverage` and `decideArchiveCore` keep their other callers and stay.

- [ ] **Step 4: Narrow the scan in `tests/run-liveness-callers-conformance.test.js`**

- Header comment (`:64-66`), `allowedRegions` (`:154`), the hit message (`:194`) and `assertSiteFloor` (`:211`): one allowed function span, `classifyRunDir`; message `${m[1]} outside classifyRunDir`.
- `SCOPED_SITE_FLOOR`: 8 → 7, comment naming #5544 and the removed site (the deleted wrapper body's `ownEventRecency(runDir)` call), per the Global Constraints ruling.
- `AC4.1` test (`:376-385`): keep the `classifyRunDir` rename assertion, delete the second one.
- Self-test fixture (`:392-393`): the fixture is `require` line, `STALE_INTERRUPTED_TTL_MS` declaration, `classifyRunDir` (lines 3-6, body reading both tokens), `function newHelper(d) { return ownEventRecency(d); }` (lines 7-9), `function ttlReader() { return STALE_INTERRUPTED_TTL_MS; }` (lines 10-12), then the export list; expected hits exactly `['8:ownEventRecency outside classifyRunDir', '11:STALE_INTERRUPTED_TTL_MS outside classifyRunDir']`.
- Update the remaining expected strings (`:412-420`) to the new message.
- `AC2.1` test (`:423-432`): the existing inject expects `/archive-merged\.js:\d+ ownEventRecency outside classifyRunDir/`; add a second inject, `'\nfunction ttlReader() {\n  return STALE_INTERRUPTED_TTL_MS;\n}\n'`, expecting `/archive-merged\.js:\d+ STALE_INTERRUPTED_TTL_MS outside classifyRunDir/` (the committed form of AC6.1's scratch edit, for both tokens).

- [ ] **Step 5: Run the tests**

Run: `node --test tests/reconcile.test.js tests/bin-lib/reconcile/archive-merged.test.js tests/bin-lib/reconcile/archive-merged-record-guards.test.js tests/run-liveness-callers-conformance.test.js tests/bin-lib/reconcile/archive-branches.test.js`
Expected: PASS, 0 failures (AC6.1's first half; AC4.2 — the `isStructurallyStuck` tests in `archive-merged.test.js` pass with that file unedited by this task).

- [ ] **Step 6: Verify the acceptance greps**

- `git grep -n -w -e isOrphanedMint -e isAbandonedInterrupted -e isAdHocStandaloneSuperseded -e lastOwnEventMs -- plugin/bin/lib/reconcile/archive-merged.js tests/run-liveness-callers-conformance.test.js` prints nothing.
- `git grep -n -P "(?<![A-Za-z_.])decideArchive\(" -- plugin/bin/lib/reconcile/archive-merged.js` prints nothing (AC2.1).
- `git grep -n -F "kind === 'merged'" -- plugin/bin/lib/reconcile/archive-merged.js` prints nothing, and `CLASSIFY_ORDER` has five entries, none `'merged'` (AC3.1).
- AC3.2: the same grep printed `:594` and `:2025` before this task (the spec's `:2018`, seven lines lower in this tree), recorded under Plan-time probes.
- `git grep -n -w -e isStructurallyStuck -- plugin/bin/lib/reconcile/archive-merged.js` still shows the definition and the `trackStuckSkip` call (AC4.1).

- [ ] **Step 7: Verify with scratch proofs, saved as evidence**

- Floor proof: in an archive extract of the pre-task commit and of the working tree, print `scopedSites(ARCHIVE, raw).allowed` (a scratch script requiring nothing from the test file: copy the four functions it needs, or temporarily log from an extract's copy of the test). Expected 8 before, 7 after. Save to `{evidence}/task2-floor-count.txt`.
- AC6.1's second half: in an extract of the edited tree, add `function scratchHelper(d) { return ownEventRecency(d); }` to `archive-merged.js` outside `classifyRunDir` and run `node --test {extract}/tests/run-liveness-callers-conformance.test.js`. Expected: FAIL, naming `ownEventRecency outside classifyRunDir`. Save to `{evidence}/task2-ac6-scratch.txt`.
- AC7.1: `node plugin/bin/hooks.js reconcile --dry-run --json > {evidence}/task2-reconcile-after.json`, then print its exit code and sorted top-level keys. Expected: exit 0 and the 15 keys recorded under Plan-time probes.

- [ ] **Step 8: Commit**

Stage the three edited files by path and commit `Remove the unused archive-merged wrappers — delete five wrappers and the merged classifier branch`.

---

### Task 3: Rewrite the docs that describe the wrappers as seams

**Role:** integration

**Files:**
- Modify: `docs/reconcile-checks.md`
- Modify: `docs/hooks.md`
- Modify: `docs/donts.md`

**Interfaces:**
- Consumes: Task 2's shape (five kinds, no wrappers, `decideArchiveCore` is the merged-PR decision).
- Produces: no doc under `docs/reconcile-checks.md`, `docs/hooks.md`, `docs/donts.md` names a removed wrapper.

- [ ] **Step 1: Edit**

- `docs/reconcile-checks.md:260`: replace the parenthetical about the wrapper with the mechanism that is true now: a `decideArchiveCore` call that passes no `coverage` skips the guard (`archiveUnlessTiebreakGap` returns `archive` for an absent `coverage`).
- `docs/reconcile-checks.md:309-326`: the kind set loses `'merged'`; replace the "five pre-consolidation predicates … are now thin wrappers" sentences and "Only `archiveMerged()`'s own main loop passes the full, ordered kind set" with: `classifyRunDir` and `decideArchiveCore` are the two seams tests and production both call; every caller scopes `ctx.kinds` — the main loop passes `['orphaned-mint', 'abandoned-interrupted', 'adhoc-superseded', 'adhoc-session-ended']`, its companion re-classify (when the `checkRunIntegrity` gate fails) passes `['adhoc-superseded', 'adhoc-session-ended']`, and `isStructurallyStuck`, the one remaining wrapper, passes `['structurally-stuck']` for `trackStuckSkip`; the merged-PR decision is `decideArchiveCore`, called by `archiveMergedRun`, and is not a classifier kind. Keep the `adhoc-session-ended` (#4179) sentence without "has no wrapper predicate".
- `docs/hooks.md:32` (two names) and `:39` (one name), `docs/donts.md:185` (`decideArchive` → the merged-PR decision, `decideArchiveCore`): Global Constraints vocabulary, sentence rule kept.

- [ ] **Step 2: Verify**

Run: `git grep -n -w -e isOrphanedMint -e isAbandonedInterrupted -e isAdHocStandaloneSuperseded -e lastOwnEventMs -e decideArchive -- docs/reconcile-checks.md docs/hooks.md docs/donts.md`
Expected: no output (AC1.1 for the docs).
Run: `npm test > {scratchpad}/task3-npm-test.txt 2>&1` (impact-selected), then read the file's summary.
Expected: PASS — 0 failures; quote the summary lines.

- [ ] **Step 3: Commit**

Stage the three files by path and commit `Describe classifyRunDir and decideArchiveCore as the archive seams — drop the removed wrappers from the docs`.

---

### Task 4: Reword the wrapper names in skill prose and comments [batch]

**Role:** transcription

**Files:**
- Modify: `plugin/skills/dispatch/SKILL.md`
- Modify: `plugin/skills/flow/claim-targets.md`
- Modify: `plugin/skills/reflect/full-mode.md`
- Modify: `plugin/skills/wrap-up/cleanup-procedures-execution.md`
- Modify: `plugin/bin/hooks.js`
- Modify: `plugin/bin/lib/reconcile/background-spawn.js`
- Modify: `plugin/bin/lib/reconcile/index.js`
- Modify: `plugin/bin/lib/run-liveness/probes.js`
- Modify: `tests/run-dir-timestamp-utc.test.js`
- Modify: `tests/bin-lib/hooks/reconcile-background.test.js`
- Modify: `tests/hooks-session-start.test.js`
- Modify: `tests/archive-run-verb.test.js`

**Interfaces:**
- Consumes: the Global Constraints vocabulary.
- Produces: AC1's grep prints nothing repo-wide.

- [ ] **Step 1: Apply the replacements (each is a name replacement; no sentence changes its rule)**

| Site | Old | New |
|---|---|---|
| `plugin/skills/dispatch/SKILL.md:212` | `` `isOrphanedMint` `` | `` `orphaned-mint` `` (the next line's "criterion" stays; file shrinks by 1 byte) |
| `plugin/skills/flow/claim-targets.md:387` | `` `isOrphanedMint` sweep `` | `` `orphaned-mint` sweep `` |
| `plugin/skills/reflect/full-mode.md:182` | `` `isOrphanedMint`) `` | `` `orphaned-mint` classification) `` |
| `plugin/skills/reflect/full-mode.md:186` | `` `isOrphanedMint` exempts `` | ``The `orphaned-mint` classification exempts`` |
| `plugin/skills/reflect/full-mode.md:194` | ``(`isAdHocStandaloneSuperseded`, #1604)`` | ``(the `adhoc-superseded` classification, #1604)`` |
| `plugin/skills/wrap-up/cleanup-procedures-execution.md:34` | `(decideArchive)` | `(decideArchiveCore)` |
| `tests/run-dir-timestamp-utc.test.js:61` | ``/isOrphanedMint` sweep reclaims after 24h if it was freshly minted here/`` | ``/orphaned-mint` sweep reclaims after 24h if it was freshly minted here/`` (still `doesNotMatch`) |
| `plugin/bin/hooks.js:292`, `:1442` | `decideArchive` | `decideArchiveCore` (these two comment lines only) |
| `plugin/bin/lib/reconcile/background-spawn.js:47`, `plugin/bin/lib/reconcile/index.js:111`, `plugin/bin/lib/run-liveness/probes.js:50,55`, `tests/hooks-session-start.test.js:1068` | `isAbandonedInterrupted` | the `abandoned-interrupted` classification (fit the comment's grammar) |
| `tests/bin-lib/hooks/reconcile-background.test.js:160` | `lastOwnEventMs'` | `ownEventRecency's` |
| `tests/archive-run-verb.test.js:154` | `decideArchive's` | `decideArchiveCore's` |

- [ ] **Step 2: Verify the sweep and the suites**

Run: `git grep -n -w -e isOrphanedMint -e isAbandonedInterrupted -e isAdHocStandaloneSuperseded -e lastOwnEventMs -- plugin tests docs/reconcile-checks.md docs/hooks.md docs/donts.md`
Expected: no output (AC1.1). Each name matched before this branch (AC1.2, recorded under Plan-time probes).
Run: `git grep -n -w -e decideArchive -- plugin tests docs/reconcile-checks.md docs/hooks.md docs/donts.md`
Expected: only `plugin/bin/lib/reconcile/archive-branches.js` and `tests/bin-lib/reconcile/archive-branches.test.js`.
Run: `wc -c plugin/skills/dispatch/SKILL.md`
Expected: 52087 (under the 52,500 rail).
Run: `npm test > {scratchpad}/task4-npm-test.txt 2>&1` (impact-selected), then read the file's summary.
Expected: PASS — 0 failures; quote the summary lines.

- [ ] **Step 3: Commit**

Stage the twelve files by path and commit `Reword the removed wrapper names in skill prose and comments — name the classifier kind each stood for`.

---

Waived AC8.1: `npm test -- --full` is `/claude-tweaks:build` Common Step 5's verification run (and PR CI), run by the controller after Task 4, not by a task.
Waived AC7.2: a statement of what AC7 does and does not prove, not a checkable behavior; AC5.1's repointed tests and AC8.1's full run carry the evidence it names.
Waived docs/incident-log.md: the spec's Gotchas say to leave it; no step reads or edits it.
