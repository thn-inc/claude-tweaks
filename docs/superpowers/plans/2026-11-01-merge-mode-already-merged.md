# Merge Mode Already-Merged Path Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When `/claude-tweaks:wrap-up #N merge` finds the PR already `MERGED`, merge mode finishes the post-merge work itself on the run it adopted (live or archived) instead of naming `cleanup-only`, and `cleanup-only` states a run-dir lookup that never mints.

**Architecture:** Extract `post-merge.js`'s per-run loop body into one exported single-run function, `postMergeOne`, that `postMerge`'s loop also calls, so the reconciler and merge mode share one guarded code path (marker, merge grace, `.post-merge.lock` claim, late-merge `closing-links` arguments). Expose it through a new standalone CLI, `plugin/bin/post-merge-run.js --run <dir>`, a sibling of `bin/closing-links.js` (`docs/hooks.md`'s standalone-vs-`hooks.js` rule: a same-purpose precedent CLI exists). Merge mode's new `## Already merged` section calls the CLI, falls back to the in-session Steps 4.0/4.0b inside the merge grace, then runs the teardown and reconcile.

**Tech Stack:** Node 18+ CommonJS, `node --test`, markdown skill prose.

**Spec:** `.claude-tweaks/pipelines/2026-11-01T182340-spec-4692/work/4692-spec.md`

## Global Constraints

- Commit style: `{Verb} {what} — {detail}`, each commit ending with the line `Claude-Session: https://claude.ai/code/session_01JHXvgVY1gbatdE1MkN7JQw`.
- Run every git/node command as one plain command per Bash call from the worktree root `/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude/worktrees/flow-spec-4692` (`git -C "<worktree>"` or the cwd; never `cd … &&`).
- New CLI follows the `gh-api-module-pattern` project skill's CLI wrapper contract: `run(argv, deps)` seam, `require.main === module` guard assigning `process.exitCode` (never `process.exit`, `tests/bin-lib/exit-code-conformance.test.js`), `windowsHide: true` on every spawn.
- `postMerge`'s observable behavior is unchanged: the existing `tests/bin-lib/reconcile/post-merge.test.js`, `tests/reconcile.test.js` and `tests/bin-lib/hooks/reconcile-background.test.js` stay green unmodified.
- Archived is terminal for every resolver except merge mode's read-only `--archived` path: `cleanup-only` does not learn `--archived`.
- Every new test is proven red by reverting the code/prose it pins, then restored.
- Governing skill `gh-api-module-pattern` (`cli-wrapper-contract.md`), quoted verbatim for Task 2:
  - "Logic lives in an exported `run(argv, deps)`; every side effect (`runner`, `ghAvailable`, `remoteUrl`, `stdout`, `stderr`) goes through `deps` so tests inject fakes. **Every** `deps` call that can throw (e.g. `remoteUrl` outside a git repo) is try/caught into the documented exit-code contract"
  - "`require.main === module` guard sets `process.exitCode = run(...)` (never `process.exit`, which can truncate piped stdout). `--help` short-circuits before any availability probe."
  - "Exit codes are a documented contract … pick the one the CLI's sibling and its consuming prose already use, then spell it out in the file's header comment and `USAGE`" … "Never mix them inside one family". Sibling: `bin/closing-links.js` (0 status-as-data, 2 malformed, 3 run dir missing or not anchored).
  - "Every malformed-input class must actually reach its malformed code"
  - "A value-taking flag given as the last argv element reads `undefined` … Validate the value inside `parseArgs` … and pin both the trailing bare flag and the empty-string value with their own test cases."
- Governing skill `skill-prose-conformance-tests`, quoted verbatim for Tasks 3-4: "`[IL-105]` says prove the assertion can go red". `tests/wrap-up-merge-mode-conformance.test.js` already does this with `assertEachFactGoesRed` (strip one fact's match, exactly that fact goes missing); new facts join the existing maps so that test covers them.
- Byte headroom (RAIL_BYTES 52,500): `merge-mode.md` 8,813 B → ~11 KB; `flags.md` 3,705 B → ~4.3 KB; `pr-first-merge-post-merge.md` 21,163 B → ~21.4 KB. No file nears the rail.
- Step position: the Already merged section runs in whatever checkout the human typed `merge` from (the main checkout once an archived run's worktree is reaped), with `$PIPELINE_RUN_DIR` = the run dir Resolve-the-run adopted, live or `archive/{run-id}`; `{worktree-path}` may no longer exist, which Section C's steps then report `already done`.
- Verbatim command probed read-only (2026-11-01): `gh pr view 4742 --json mergeCommit,mergedAt,mergedBy,state` printed `{"mergeCommit":{"oid":"ba69ced9…"},"mergedAt":"2026-10-31T17:04:31Z","mergedBy":{…"login":"thomasholknielsen"…},"state":"MERGED"}`; `{mergedBy}` is `mergedBy.login`.
- Waived AC8.1: npm test runs in full at /build Common Step 5 (verify.js), not as a plan task.
- Waived plugin/bin/hooks.js: no verb is added — the single-run entry point is the standalone bin/post-merge-run.js per docs/hooks.md's standalone-vs-hooks.js rule (closing-links.js is the same-purpose precedent CLI).
- Waived tests/reconcile.test.js: read-only — Task 1 Step 4 runs it unmodified to prove postMerge's behavior is unchanged.

## Review Focus

1. A merge older than the grace whose reconciler already ran: the run's `decisions.md` holds the `reconcile post-merge` marker → `postMergeOne` returns `already-done`, no `closing-links` call (Task 1 test).
2. A multi-spec run whose marker sits only in `spec-*/decisions.md` → `already-done` (Task 1 test).
3. An `archive/{run-id}` dir with `worktree: null` and a `pr` object → processed, marker written under `archive/{run-id}/decisions.md`, no new entry under `pipelines/` (Task 2 test).
4. `gh` absent → the CLI prints a `skipped`/`gh-absent` entry with exit 0, and merge mode reports it as a `cleanup:` failure line naming the re-run, never silently (Task 2 test, Task 3 facts `already-retry`).
5. A live background reconcile pass holds `.post-merge.lock` → `in-flight`, no `closing-links` call, and merge mode reports it as `in-flight`, not `ran` (Task 1 test, Task 3 fact).
6. A merge seconds old (inside the 10-minute grace) → the single-run path still takes the claim and runs Step 4.0 with the settle poll, so a reconcile pass after the grace reads `in-flight` or the marker and never double-runs (Task 1 test).
7. Step 4.0 ran but could not reopen or close a record → the entry stays `ran` with `step40Failed`/`records`; merge mode reports a failure line naming the records, never a clean success (Task 1, Task 2 tests; Task 3 fact `already-step40-failed`).

---

### Task 1: `postMergeOne` — one guarded single-run path in `post-merge.js`

**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/reconcile/post-merge.js` (the `postMerge` loop body, lines ~291-346; header comment; `module.exports`)
- Test: `tests/bin-lib/reconcile/post-merge.test.js`

**Interfaces:**
- Produces: `async function postMergeOne({ runDir, cwd, prStates, now = Date.now, deps = {} })` → one entry object `{ runDir, pr, action: 'ran' | 'skipped', reason?, detail?, closingLinks?, parentsClosed?, attempt?, step40Failed?, records? }`. New skip reasons, used only by the single-run path: `no-pr` (run-state has no positive integer `pr.number`), `already-done` (`runHasMarker` true, before or after the claim), `not-merged` (`prState.state !== 'MERGED'`, `detail` = the state). Every existing reason keeps its spelling. A setup failure returns `{ runDir, pr: null, action: 'skipped', reason: 'not-github-issues' | 'no-remote' | 'no-pr-states' }`.
- **No merge-grace skip on the single-run path (plan review, cross-task finding).** `postMergeOne` never returns `merge-grace`: inside `MERGE_GRACE_MS` it takes the same claim and runs `processRun` with the in-session parameters — `closing-links` argv `['--run', dir, '--mode', 'post-merge']` (its default 15 s settle poll, no `--close-window-ms`) and `closeParents(… selfInclude: true)`, the in-session Step 4.0b's self-inclusion; past the grace it runs today's late-merge parameters (`--settle-ms 0 --close-window-ms CLOSE_WINDOW_MS`, `selfInclude: false`). So every Steps 4.0/4.0b run merge mode triggers holds `.post-merge.lock` and writes the `reconcile post-merge` marker, and the reconciler (which defers inside the grace and reads a held claim as `in-flight`) never runs them concurrently. `processRun` gains one parameter object `{ settleMs: '0' | null, closeWindowMs: number | null, selfInclude: boolean }` (null = flag omitted); `postMerge`'s call passes today's values, so its argv and `closeParents` call are unchanged.
- **`records` (plan review, cross-task finding):** `postMergeOne` passes `includeRecords: true` to `processRun`, which then adds `records: { failed, closeFailed, pendingClose, unchecked }` (each an array of issue numbers from Step 4.0's envelope; `failed`/`closeFailed` mapped from their `{issue}` objects; omitted when there is no envelope) to a `ran` entry. `postMerge` never sets it, so its entries stay byte-identical (the exact-shape `deepEqual` asserts at `tests/bin-lib/reconcile/post-merge.test.js:101`, `:447`, `:464` stay green).
- **Archived retry text (user decision, plan review):** when `runDir`'s real path sits under `.claude-tweaks/pipelines/archive/`, the `ATTEMPT_STEP` line's fallback text reads `the next /claude-tweaks:wrap-up #{n} merge retries Steps 4.0 and 4.0b; after 3 attempts the tidy parent-gate backstop recovers the parent` instead of naming the reconcile pass (which never walks `archive/`). `{n}` is the run's `config.yml` `spec:` value; when it is unreadable the text names `/claude-tweaks:wrap-up merge` with no number. A `retryHint` string passed into `processRun` carries this; `postMerge` passes none and keeps today's text.
- `postMerge` keeps its signature and return shape `{ entries, deferred, failure? }`; it calls the same per-run helper and **does not push** `no-pr`, `already-done` or `not-merged` entries (today those runs are silently `continue`d), so its output is byte-for-byte unchanged.
- Shared internals (module-private): a `setupContext({ cwd, deps })` returning `{ root, owner, repo, host, workLinks, riskFloor, policySkip, timedGh, runClosingLinks, closeParents, writeEntries }` or `{ failure }`, and `processCandidate({ dir, state, ctx, prStates, dryRun, now, budgetExceeded, deps, single })` holding today's loop body in today's order (marker → PR state → MERGED → grace → dry-run → budget → claim → marker re-check → `processRun` → release); `single: true` (from `postMergeOne`) replaces the grace skip with the in-session parameters above. `postMergeOne` reads the run's state with `readRunState(runDir)` from `../hooks/context` (the same reader `archive-merged.js` imports); `postMerge` keeps passing `listRunDirsWithState`'s `state`.
- Export `postMergeOne` alongside the existing exports.

- [ ] **Step 1: Write the failing tests** — add a `describe`-free block of `test(...)` calls in `tests/bin-lib/reconcile/post-merge.test.js` reusing its `mainCheckout`/`addRun` helpers and fake deps (`closingLinksRun`, `closeParents`, `appendEntries`, `takeClaim` as the existing postMerge tests fake them):
  - `postMergeOne processes an archive/{run-id} dir postMerge never walks` — create `.claude-tweaks/pipelines/archive/2026-01-01T000000-spec-9/` with `run-state.json` `{status:'clean', worktree:null, pr:{number:11}}`; fake `prStates.byNumberAsync` → `merged()` (one hour old); assert the entry is `{action:'ran'}`, the fake `closingLinksRun` received `['--run', <archived dir>, '--mode', 'post-merge', '--settle-ms', '0', '--close-window-ms', String(CLOSE_WINDOW_MS)]`, `hasPostMergeMarker(read(archived/decisions.md))` is true, and `postMerge({ cwd: root, prStates, now, deps })` on the same checkout returns no entry for that dir.
  - `AC5.1: postMergeOne returns already-done when the marker is present` — top-level `decisions.md` holds a `formatEntry({ status:'AUTO', step: MARKER_STEP, … })` line; assert `reason: 'already-done'` and the fake `closingLinksRun` was never called.
  - `postMergeOne reads a multi-spec spec-*/decisions.md marker` — marker only in `spec-4/decisions.md`; assert `already-done`.
  - `postMergeOne runs inside MERGE_GRACE_MS under the claim with the in-session parameters` — `merged(new Date(NOW - 60 * 1000).toISOString())`; a counting fake `takeClaim`; assert `action: 'ran'`, the claim was taken once, `closingLinksRun` received exactly `['--run', dir, '--mode', 'post-merge']`, the fake `closeParents` saw `selfInclude: true`, and the marker is written. Delete-the-branch proof: make `single` behave like the loop (skip `merge-grace`) and this test goes red.
  - `postMergeOne surfaces Step 4.0's record lists` — fake `closingLinksRun` envelope `{action:'reopen-failed', closingSet:[101], failed:[{issue:105, error:'x'}], closeFailed:[], pendingClose:[106], reopened:[]}`; assert `entry.records` deep-equals `{ failed:[105], closeFailed:[], pendingClose:[106], unchecked:[] }`; and the same envelope through `postMerge` yields an entry with no `records` key.
  - `postMergeOne names the merge re-run in an archived run's retry line` — archived dir, `config.yml` `spec: 9`, fake `closingLinksRun` returns exit 5; assert the entry's `reason: 'transient-failure'` and the archived `decisions.md`'s `ATTEMPT_STEP` line contains `/claude-tweaks:wrap-up #9 merge` and not `reconcile pass`.
  - `postMergeOne returns in-flight when the claim is held` — fake `takeClaim` → `{ ok:false, reason:'in-flight' }`; assert `reason: 'in-flight'`, no `closingLinksRun` call.
  - `postMergeOne returns no-pr and not-merged` — one run with no `pr`; one whose fake state is `{state:'OPEN'}`; assert `no-pr` and `not-merged` (`detail: 'OPEN'`).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/bin-lib/reconcile/post-merge.test.js`
Expected: FAIL — `postMergeOne is not a function` on the eight new tests; every existing test PASS.

- [ ] **Step 3: Implement `postMergeOne` in `plugin/bin/lib/reconcile/post-merge.js`** — move the loop body into `processCandidate` unchanged, hoist the setup into `setupContext`, have `postMerge` drop the three new skip reasons before pushing, add `processRun`'s parameter object, `includeRecords` and `retryHint` (defaults reproduce today's behavior exactly), and add one header paragraph naming `postMergeOne`, its caller (`bin/post-merge-run.js`, merge mode's Already merged section), and why the single-run path runs inside the grace (it holds the claim, so the two never race).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/bin-lib/reconcile/post-merge.test.js`
Expected: PASS (all, old and new)

Run: `node --test tests/reconcile.test.js`
Expected: PASS

Run: `node --test tests/bin-lib/hooks/reconcile-background.test.js`
Expected: PASS

- [ ] **Step 5: Prove the new tests discriminate** — temporarily make `postMergeOne` skip the `runHasMarker` check; run the file; expect the two `already-done` tests to FAIL; restore (`git -C "<worktree>" diff --stat` shows only the intended change).

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/lib/reconcile/post-merge.js tests/bin-lib/reconcile/post-merge.test.js
git commit -m "Extract postMergeOne from the reconciler's post-merge loop — one guarded path for a single run, archived included"
```

### Task 2: `bin/post-merge-run.js` — the single-run CLI

**Files:**
- Create: `plugin/bin/post-merge-run.js`
- Test: `tests/post-merge-run-cli.test.js`
- Modify: `docs/plugin-structure.md` (command reference: one line after the `closing-links.js` line, ~190)
- Modify: `docs/reconcile-checks.md` (`## Post-merge closes (#4599)` section: one paragraph)

**Interfaces:**
- Consumes: `postMergeOne` (Task 1); `resolveTarget` from `./lib/log-decision/append`; `ghAvailable` from `./lib/repo-resolve`; `resolvePrStateByNumberAsync(root, n)` from `./lib/reconcile/pr-state`.
- Produces: `node plugin/bin/post-merge-run.js --run <run-dir> [--help]`; `module.exports = { run, parseArgs }` where `async function run(argv, overrides = {}) → exitCode`. Stdout: exactly one JSON line, the `postMergeOne` entry (with `gh` absent: `{ runDir, pr: null, action: 'skipped', reason: 'gh-absent' }`, no lookup made). Exit `0` an entry was printed (every action and reason is data), `2` malformed invocation (unknown flag, missing `--run`, `--run` without a value), `3` run dir missing or not anchored under the main checkout (`resolveTarget` refusal; an `archive/{run-id}` dir in the main checkout passes). The `overrides` seam takes `cwd`, `mainRoot`, `ghAvailable`, `prStates`, `now`, `stdout`, `stderr`, and `postMergeDeps` (passed through as `postMergeOne`'s `deps`).
- `USAGE` text names the exit codes and the outcomes merge mode routes on: `ran` (with `step40Failed` and `records` when Step 4.0 did not finish cleanly), `already-done`, `in-flight`, and "any other reason is a failure to report".

- [ ] **Step 1: Write the failing tests** in `tests/post-merge-run-cli.test.js` (build a temp main checkout the way `tests/bin-lib/reconcile/post-merge.test.js`'s `mainCheckout` does; call `run(argv, overrides)` in-process; one spawn test for the guard):
  - `--help prints usage and exits 0`; `no --run exits 2`; `an unknown flag exits 2`; `a trailing bare --run exits 2`; `an empty --run value exits 2`.
  - `a run dir outside the main checkout exits 3` — a temp dir in another git repo, `mainRoot` the checkout.
  - `AC4.1 AC4.2 AC4.3 AC4.4: an archived run is processed and nothing is minted` — build the run dir with the real writers, not hand-written JSON: create `.claude-tweaks/pipelines/{run-id}/` holding `run-state.json` `{status:'active', worktree:'<a temp dir>', pr:{number:11}}`, call `closeRunState(dir, { explicit: true, checkLiveWorktree: false })` (`plugin/bin/lib/hooks/close-run-state.js`, the writer that produces `status:'clean', worktree:null, worktreeAtClose`), then `fs.renameSync` it to `archive/{run-id}` (archival's own move). Fake `prStates` merged an hour ago, fake `postMergeDeps.closingLinksRun` returning a `nothing-closed` envelope with `closingSet: []`; assert exit 0, the stdout JSON's `action === 'ran'`, `archive/{run-id}/decisions.md` holds the marker (`hasPostMergeMarker`), and `fs.readdirSync('<root>/.claude-tweaks/pipelines')` equals `['archive']`.
  - `a failed Step 4.0 prints step40Failed and the record lists` — fake `postMergeDeps.closingLinksRun` returning an exit-0 `reopen-failed` envelope with `failed:[{issue:105, error:'x'}]`; assert the printed entry's `closingLinks === 'reopen-failed'` and `records.failed` deep-equals `[105]` (merge mode's failure routing reads exactly these keys).
  - `gh absent prints a gh-absent skip and makes no lookup` — `ghAvailable: () => false`, a `prStates.byNumberAsync` that throws if called; assert exit 0 and `reason === 'gh-absent'`.
  - `the CLI exits through process.exitCode` — spawn `node plugin/bin/post-merge-run.js` with no args; assert status 2 and the usage text on stderr.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/post-merge-run-cli.test.js`
Expected: FAIL — `Cannot find module '../plugin/bin/post-merge-run'`

- [ ] **Step 3: Implement `plugin/bin/post-merge-run.js`** mirroring `bin/closing-links.js`'s header/USAGE/`parseArgs`/`realDeps`/`run` layout: parse → `--help` → `resolveTarget` (exit 3 with closing-links' two stderr messages, renamed) → `ghAvailable` → `postMergeOne({ runDir: <resolved real path>, cwd: deps.cwd(), prStates: deps.prStates || { byNumberAsync: (n) => resolvePrStateByNumberAsync(root, n) }, now: deps.now, deps: deps.postMergeDeps })` → print. The guard awaits `run(process.argv.slice(2))` and assigns `process.exitCode`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/post-merge-run-cli.test.js`
Expected: PASS

Run: `node --test tests/bin-lib/exit-code-conformance.test.js`
Expected: PASS

- [ ] **Step 5: Document the CLI** — add the command-reference line to `docs/plugin-structure.md` (usage, what it runs, stdout shape, the reason vocabulary, exit codes, test file), and one paragraph to `docs/reconcile-checks.md`'s Post-merge closes section: the reconciler walks live run dirs only; `postMergeOne` is the same guarded path for one named dir, archived included, run by `bin/post-merge-run.js` from `wrap-up/merge-mode.md`'s Already merged section; marker and claim keep the two from double-running.

- [ ] **Step 6: Prove the archived-run test discriminates** — temporarily make `run` call `postMerge({ cwd })` (the live-only walk) instead of `postMergeOne` on the `--run` dir; expect the `AC4.1 …` test to FAIL; restore.

- [ ] **Step 7: Real-input probe** — run the finished CLI once against a real archived run whose `decisions.md` already holds a post-merge marker, so it exits before any `gh` write (marker is checked first):

Run: `node plugin/bin/post-merge-run.js --run "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines/archive/2026-10-30T045550-spec-4469-4466"`
Expected: exit 0, one JSON line with `"reason":"already-done"`. Independent count: `grep -c -E "reconcile post-merge|pr-first-merge Step 4\.0b" "<that dir>/decisions.md"` prints ≥ 1. Record both outputs in the Task 2 report; a different reason is a defect to fix before commit.

- [ ] **Step 8: Commit**

```bash
git add plugin/bin/post-merge-run.js tests/post-merge-run-cli.test.js docs/plugin-structure.md docs/reconcile-checks.md
git commit -m "Add post-merge-run.js — run the reconciler's guarded post-merge closes for one named run dir, archived included"
```

### Task 3: Merge mode's `## Already merged` section

**Review risk:** high

**Files:**
- Modify: `plugin/skills/wrap-up/merge-mode.md` (Preconditions paragraph line 21; new `## Already merged` section placed immediately before `## Step 3's branch 5 under merge mode`; Outcomes paragraph)
- Modify: `plugin/skills/_shared/pr-first-merge-post-merge.md` (Step 4.0's "An `armed` outcome never reaches this step in-session" sentence, ~line 33)
- Test: `tests/wrap-up-merge-mode-conformance.test.js`
- Test (keep green, no edit): `tests/below-floor-parent-close-conformance.test.js`, `tests/closing-links-prose-conformance.test.js`

**Interfaces:**
- Consumes: `node "${CLAUDE_PLUGIN_ROOT}/bin/post-merge-run.js" --run "$PIPELINE_RUN_DIR"` and its stdout vocabulary (Task 2).

- [ ] **Step 1: Write the failing tests** in `tests/wrap-up-merge-mode-conformance.test.js`: delete the `'merged-pr-next'` entry from `MERGE_MODE_FACTS` (AC7.1) and add these entries (each pattern pins one sentence of the prose in Step 3; `merged-routes-already` covers AC2.1 and AC2.2, the `already-*` facts cover AC3.1, `already-done-word` covers AC5.1's teardown half, and the existing `archived-fallback` fact plus Task 2's archived-run test cover AC4.1; the file's existing `merge-mode.md facts each go red when stripped` test covers AC7.2 for every new entry):
  - **Collision rule (plan review, cross-task finding):** `assertEachFactGoesRed` strips only a pattern's first match, so no new sentence may contain text an existing `MERGE_MODE_FACTS` regex matches — in particular not `Section C steps 3.5-5.5` (`section-c`), `and Section E's claim release` (`section-e`), `Step 4.2's reconcile runs last` (`reconcile-last`), `with no \`--create\`` (`no-create`), `When \`{run-dir}/wrap-up-pack.json\` is absent, produce it before any teardown` (`pack-before-teardown`), the `release-reason` sentence, or the `cleanup-failure` sentence. The Already merged section points at Procedure step 3 for those instead of restating them; the existing go-red test fails if this rule is broken.
  - `'precondition-open'` (replace the existing entry): `/the PR is neither `OPEN` nor `MERGED`/` — the stop list now names only a closed-unmerged PR, so MERGED is no longer among the stops (AC2.1).
  - `'merged-routes-already'`: `/A `MERGED` PR — an `armed` run's auto-merge, or a merge on GitHub, landing before the human types this — skips Procedure steps 1-2 and runs the Already merged section below/`
  - `'already-cli'`: `/node "\$\{CLAUDE_PLUGIN_ROOT\}\/bin\/post-merge-run\.js" --run "\$PIPELINE_RUN_DIR"/`
  - `'already-claim'`: `/runs Step 4\.0 and Step 4\.0b once under the run's `\.post-merge\.lock` claim, choosing the in-session or the late-merge arguments by the merge's age/`
  - `'already-in-flight'`: `/`in-flight` — a reconcile pass holds the run's claim and is running them now: report `in-flight`, never `ran`/`
  - `'already-step40-failed'`: `/a `ran` entry carrying `step40Failed`, or a `closingLinks` other than `nothing-closed`, `closed` or `reopened`, is a failure: one `cleanup: post-merge closes failed — \{closingLinks\}` line naming every record in its `records` lists/`
  - `'already-retry'`: `/every failure line here names `\/claude-tweaks:wrap-up #\{n\} merge` as the next step: with no marker written yet, a re-run tries the closes again/`
  - `'already-done-word'`: `/A target that is already gone — worktree reaped, branch deleted, claim released — reports `already done`, never `failed`/`
  - `'already-link'`: `/`\$LINK` is the PR's `mergeCommit\.oid` from `gh pr view \{pr\} --json mergeCommit,mergedAt,mergedBy`/`
  - `'already-teardown'`: `/then the rest of Procedure step 3 from Step 4\.1 on, in its order, with the reconcile call last/`
  - `'already-outcome'`: `/`already merged \{mergedAt\} by \{mergedBy\} — merge mode ran only the post-merge steps`/`
  - `'already-no-next'`: `/names no next step when every line reads `ran`, `already done` or `in-flight`/`
  - and add one standalone test: `AC1.1 AC1.2: merge-mode.md names cleanup-only only in its Token rules rejection` — `flat(read('plugin/skills/wrap-up/merge-mode.md')).match(/cleanup-only/g).length === 1` and that one match sits inside the `` `merge` with `cleanup-only` is rejected`` sentence.
  - In `pr-first-merge-post-merge.md`'s pins (add a `POST_MERGE_EXCEPTION` fact in the same file): `/merge mode's Already merged section \(`wrap-up\/merge-mode\.md`\) runs this step in-session for an already-merged PR/`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/wrap-up-merge-mode-conformance.test.js`
Expected: FAIL — the facts test lists the twelve new or replaced names as missing; the `cleanup-only` count test fails (2 matches).

- [ ] **Step 3: Write the prose** — exact sentences the facts pin, in the doc's existing register, under the collision rule above:
  - Preconditions: the stop list's third item becomes "the PR is neither `OPEN` nor `MERGED`" (`precondition-open`), and the MERGED sentence becomes the `merged-routes-already` sentence. An `OPEN` PR's path is byte-unchanged.
  - `## Already merged`: (1) the CLI paragraph: `already-cli`, then `already-claim` (the CLI, not this prose, decides the arguments and holds the claim — cite `bin/post-merge-run.js`, never restate the numbers), then route on stdout: a clean `ran` reports `closingLinks` and `parentsClosed`; `already-done` reports `already done`; `already-in-flight`; `already-step40-failed`; any other `reason` adds one `cleanup: post-merge closes failed — {reason}` line; then `already-retry`. (2) the teardown paragraph: `already-teardown` (Step 4.1, the claim pack, Section C, Section E and Step 4.2 exactly as Procedure step 3 lists them — by reference, not restated), `already-link`, `already-done-word`.
  - Outcomes: add the already-merged report shape: outcome `merged`, a leading `already-outcome` line, one line per step (`ran`, `already done`, `in-flight`, or a `cleanup:` failure line), and `already-no-next`.
  - `pr-first-merge-post-merge.md` Step 4.0: add the `POST_MERGE_EXCEPTION` sentence, citing merge-mode.md (do not restate its routing), right after the paragraph's last sentence ("… so they no longer wait for a human (#4599)."). Leave the sentence "An `armed` outcome never reaches this step in-session: the reconciler's `post-merge` check (`gh` only) runs the CLI … with `--keep-open` on the composer," byte-unchanged: `tests/below-floor-parent-close-conformance.test.js:381` pins it verbatim.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/wrap-up-merge-mode-conformance.test.js`
Expected: PASS

Run: `node --test tests/closing-links-prose-conformance.test.js`
Expected: PASS

Run: `node --test tests/below-floor-parent-close-conformance.test.js`
Expected: PASS

- [ ] **Step 5: Prove each new fact goes red** — the file's existing `merge-mode.md facts each go red when stripped` test covers the `MERGE_MODE_FACTS` entries; for `POST_MERGE_EXCEPTION` and the count test, strip the sentence / re-add a `cleanup-only` next-step sentence in a scratch copy and confirm FAIL, then restore.

- [ ] **Step 6: Commit**

```bash
git add plugin/skills/wrap-up/merge-mode.md plugin/skills/_shared/pr-first-merge-post-merge.md tests/wrap-up-merge-mode-conformance.test.js
git commit -m "Finish an already-merged PR in merge mode — post-merge closes, teardown and reconcile instead of naming cleanup-only"
```

### Task 4: `cleanup-only` states its run-dir lookup

**Files:**
- Modify: `plugin/skills/wrap-up/flags.md` (the `cleanup-only` bullet, line 6)
- Test: `tests/wrap-up-merge-mode-conformance.test.js`

**Interfaces:**
- Consumes: nothing new. The `/claude-tweaks:wrap-up #{n} merge` route from Task 3.

- [ ] **Step 1: Write the failing tests** — in `tests/wrap-up-merge-mode-conformance.test.js`, add a `CLEANUP_ONLY_FACTS` map plus two tests, `AC6.1: flags.md states cleanup-only's run-dir lookup` and `AC6.1: cleanup-only facts each go red when stripped` (reuse `missingFactsOf`/`assertEachFactGoesRed`), over `flat(read('plugin/skills/wrap-up/flags.md'))`:
  - `'lookup-order'`: `/`cleanup-only` resolves its run dir from an inherited `PIPELINE_RUN_DIR` first, else `resolve-run-dir --spec-slug \{slug\}` with no `--create`/`
  - `'never-mints'`: `/it never mints a run dir/`
  - `'stops-naming-record'`: `/When nothing resolves it stops and names the record/`
  - `'merged-pointer'`: `/when that record's PR is `MERGED`, the stop names `\/claude-tweaks:wrap-up #\{n\} merge`/`

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/wrap-up-merge-mode-conformance.test.js`
Expected: FAIL — the four `CLEANUP_ONLY_FACTS` names missing.

- [ ] **Step 3: Write the prose** — append the four pinned sentences to the `cleanup-only` bullet, after "runs only `cleanup-procedures.md`'s cleanup items (A-E)", with one clause on why it never mints: a stray `-standalone` dir could shadow the real run on retry (the reason merge-mode.md's Resolve-the-run gives). It does not adopt an archived run.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/wrap-up-merge-mode-conformance.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/wrap-up/flags.md tests/wrap-up-merge-mode-conformance.test.js
git commit -m "State cleanup-only's run-dir lookup — inherited run dir or a no-create resolve, never a minted dir"
```
