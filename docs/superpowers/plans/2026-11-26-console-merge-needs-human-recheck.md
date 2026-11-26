# Console Merge Needs-Human Recheck Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An unattended run never merges a PR or branch whose `merge-check` verdict asked for a human, even when that verdict is logged after `console-resolve.js` already recorded `merge.resolution: merge` in `console.json`. This holds under both integration models.

**Architecture:** Two guards. (1) Deliverable 2, by its "mark it stale" option (plan-review settlement, spec `## Plan Review Clarifications`). When `mergeResolution()` in `plugin/bin/lib/console/resolve.js` would resolve `merge` but a member has no confirmed passing `merge-check` verdict in `decisions.md` yet, the merge half is marked stale. A stale merge half is not a resolved merge. `resolveAll` returns a sibling `mergeStale: { unconfirmed: [n…], reason }`, and `console-resolve.js` persists it to `console.json` beside `merge`. The `merge` object itself is unchanged, so every existing test stays green unmodified (AC3). (2) One re-check, the pure `recheckMerge()` in `resolve.js` behind one new CLI shape, `console-resolve.js --run <dir> --recheck-merge`. Under the console lock it reads `decisions.md` and `console.json`. Three things are a hit: a needs-human `merge-check` verdict, a malformed verdict line, or a stale member still unconfirmed. On a hit it first appends one decision line, then rewrites `console.json`'s stored `merge` to `leave-open` when that file holds one. Both merge sites call it right before merging: the `pr-first` Branch finish in `wrap-up/execution-and-verification.md`, and the `local-merge` no-prompt finish in `_shared/local-merge-auto-finish.md`. Both merge only on exit 0 with `recheck-merge merge`.

**Tech Stack:** Node 18+ CommonJS, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-11-26T082958-record-5833/work/5833-spec.md`

Scope keywords: needsHumanVerdict, mergeResolution, recheck-merge

## Global Constraints

- The in-order path must not change: when the verdict is logged before the resolve, `merge` still resolves with the exact reason string `every member carries auto:build with auto:merge or a matured auto:merge-pending; no needs-human verdict`, and no `mergeStale` is set. (AC3)
- AC3, settled at plan review: no existing test is edited. Every pre-existing suite stays green as written, including the ones that resolve `merge` with no verdict line (`tests/bin-lib/console/resolve.test.js:131`, `tests/auto-merge-short-circuit-verdict-backstop.test.js:95`). The `merge` object's shape and values never change. Staleness lives only in the sibling `mergeStale`.
- A late verdict resolves to leave-open (`pending-review`) and logs exactly one decision line that names the late verdict. (Deliverable 1)
- Spec Decision, Reading B: the re-check covers every site that acts on a merge resolved earlier in the run. That means the `pr-first` Branch finish and the `local-merge` no-prompt finish. Both call the same CLI, never two copies of the logic. Settled at plan review: the `local-merge` finish parks on any needs-human verdict in `decisions.md`, in-order or late. This is an intended change.
- Spec Decision, family rule (fail-closed): when the re-check cannot prove that no needs-human verdict exists, the run does not merge. That covers an unreadable `decisions.md`, a failed decision-line append, a lock that cannot be taken, a malformed verdict line (`latest: 'unparsed'`), and a stale member still unconfirmed. "The same lock" is `{run}/.console.lock`, taken fail-closed around the whole re-check: the `decisions.md` read, the append, and the `console.json` write. The append's own nested `.decisions.lock` is a different path, so it never deadlocks. The re-check appends its decision line before it updates `console.json`, so a failed append never leaves a changed `console.json` without its line.
- Merge-verdict parsing goes through `plugin/bin/lib/dispatch/merge-verdict.js`, the one module that owns the marker. Never write a second regex for the verdict line. Export its existing `latestVerdicts` rather than re-deriving it.
- From the `gh-api-module-pattern` project skill's `cli-wrapper-contract.md`, quoted: "Logic lives in an exported `run(argv, deps)`; every side effect (`runner`, `ghAvailable`, `remoteUrl`, `stdout`, `stderr`) goes through `deps` so tests inject fakes. **Every** `deps` call that can throw (e.g. `remoteUrl` outside a git repo) is try/caught into the documented exit-code contract". `console-resolve.js` already follows this, so the new shape uses its `run`/`deps` seam and its existing exit vocabulary: 2 malformed, 3 unanchored or a read, lock or write failed, 5 refused.
- `review-console-section-addition` project skill: this change adds no section and no new resolution value. `leave-open` already exists, so none of that skill's registration sites apply.
- Do not use `**` bold inside the Branch finish paragraph of `execution-and-verification.md`. `tests/wrap-up-branch-finish-after-execution.test.js`'s `paragraph()` treats ` **` as the paragraph end.
- `plugin/skills/wrap-up/review-console.md` is 45,883 B against the 52,500 B `RAIL_BYTES` rail (87%). Keep the prose added there under 1,000 B.
- `plugin/skills/dispatch/settle-and-merge.md` is 51,128 B, which leaves 1,372 B of headroom (plan-audit `nearCeiling`). Its Task 3 reword must not grow the file by more than 200 B.
- Scope and edit discipline: "Commit tests only where the task asks for them or the repo already keeps tests for this kind of change, sized like the neighboring test files; scratch checks stay scratch. Touch only what the task requires — a pre-existing bug you notice is a follow-up to report, not a fix to fold in, unless the task cannot work without it. Don't reformat or "improve" adjacent code; edit in place rather than rewrite when the result is the same."
- Project maturity `established`: "For any task modifying pre-existing behavior, write a full characterization test covering edge cases before changing it — published or external consumers may depend on them."

## Review Focus

- A latest verdict that is `needs-human` after an earlier `auto-merge`: `needsHumanVerdict` still wins, so the result is leave-open. Task 1 pins it.
- A malformed pass line (`unparsed`) is never a confirmed verdict. `mergeResolution` marks it stale, and `recheckMerge` treats it as a hit, failing closed. Task 1 pins it.
- A verdict for a different record (`#70` instead of `#7`) does not confirm member `#7`. Task 1 pins it.
- A stale merge half whose verdict was logged after the resolve, as a pass, is no hit, so the merge proceeds. If the verdict is still missing, it is a hit. Tasks 1 and 2 pin both.
- `--recheck-merge` never matches its own `Merge re-check:` line as a verdict, so a second run after any hit kind writes no second line. Tasks 1 and 2 pin it for each hit kind.
- `--recheck-merge` with no `console.json` (an attended `local-merge` console writes none) still judges `decisions.md`. A `console.json` that will not parse is exit 5 with nothing written. Task 2 pins it.
- `--recheck-merge` with an unreadable `decisions.md`, a lock that cannot be taken, or a failed append exits 3 and leaves `console.json` unchanged. Task 2 pins it.

## Consumer classification (Consumer-enumeration check)

`console.json`'s `merge.resolution` is read by:
- `plugin/bin/lib/wrap-up/engine-verify.js` `consoleMergeResolution` (pick-one). It reads the string, and `leave-open` already maps to the pending-review skip. The Task 2 rewrite keeps this consumer correct after a hit. It ignores the new `mergeStale` key. No change.
- `wrap-up/execution-and-verification.md` Branch finish and its Leave-open mergeability re-check (prose). Task 3 changes Branch finish.
- `flow/multispec-review-console.md` discards per-dir `merge.resolution` by design. No change.

The `local-merge` merge site does not read `merge.resolution`. `_shared/local-merge-auto-finish.md` merges on its Precondition alone. That is why the re-check judges `decisions.md` and treats `console.json` only as an optional input and rewrite target. Task 3 adds the call there.

---

### Task 1: mergeResolution marks an unconfirmed merge half stale; recheckMerge

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/console/resolve.js`. In `mergeResolution`, ~line 442, compute the stale set. `resolveAll` returns `mergeStale`. Add `recheckMerge` and export it.
- Modify: `plugin/bin/lib/dispatch/merge-verdict.js` (add `latestVerdicts` to `module.exports`; no behavior change)
- Test: `tests/bin-lib/console/resolve.test.js` (new tests only; no existing test is edited)

**Interfaces:**
- Consumes: `confirmPassingVerdicts(content, members)`, `latestVerdicts(content) -> Map<number, string>` and `verdictText(n)` from `plugin/bin/lib/dispatch/merge-verdict.js`; `parseEntry` (already imported).
- Produces, part 1: `resolveAll(...)` gains a top-level `mergeStale`. It is `null` unless `merge.resolution === 'merge'` and `confirmPassingVerdicts(snapshot.decisions, snapshot.members)` leaves at least one member unconfirmed. Then it is `{ unconfirmed: [n…] (snapshot.members order), reason: '#<first n>: no confirmed merge-check verdict in decisions.md yet (latest: <latest || none>) — the Auto-merge short-circuit applies, so the merge site re-checks before merging' }`. The returned `merge` object is byte-identical to today's.
- Produces, part 2: `recheckMerge(merge, decisions, mergeStale) -> { hit, kind, changed, lateVerdict, merge }`, exported from `resolve.js`. The inputs are `merge: {resolution, reason, ...}|null`, `decisions: string` and `mergeStale: {unconfirmed}|null`. Before judging, drop every `decisions` line whose `parseEntry(...).location` is `Merge re-check`, so the re-check never matches its own line. The hit is the first of these:
  - (a) `kind: 'needs-human'`. `needsHumanVerdict(filtered)` returns a line, and `lateVerdict` is that line without the leading `- `.
  - (b) `kind: 'unparsed'`. `latestVerdicts(filtered)` holds a record whose latest verdict is `'unparsed'`, and `lateVerdict` is `#${n} merge-check verdict line unparsed`.
  - (c) `kind: 'unconfirmed'`. `mergeStale` lists a member that `confirmPassingVerdicts(filtered, mergeStale.unconfirmed)` still leaves unconfirmed, and `lateVerdict` is `#${n} has no confirmed merge-check verdict at merge time (latest: ${latest || 'none'})`.
  - On a hit with `merge && merge.resolution === 'merge'`: `changed: true`, and `merge` becomes `{ resolution: 'leave-open', reason: 'merge withheld at merge time (' + kind + '): ' + lateVerdict, recheckedFrom: 'merge' }`.
  - On a hit with any other `merge` (null, leave-open): `changed: false`, `merge` unchanged.
  - No hit: `hit: false, kind: null, changed: false, lateVerdict: null`, `merge` unchanged.

- [ ] **Step 1: Write the failing tests** in `tests/bin-lib/console/resolve.test.js` (new tests only):
  - `AC2.1: with the short-circuit applicable and no merge-check verdict logged yet, the merge half is marked stale, not resolved`. Fixture: `headers: [7]`, `decisions: ''`, default grants (`auto:build`,`auto:merge`). Assert `r.mergeStale.unconfirmed` deep-equals `[7]` and `r.mergeStale.reason` matches `/#7: no confirmed merge-check verdict in decisions\.md yet \(latest: none\)/`. Also assert that `recheckMerge(r.merge, '', r.mergeStale)` is a hit of kind `unconfirmed`, so a stale half never merges.
  - `AC3.1: a passing verdict logged before the resolve still resolves merge, reason unchanged, no mergeStale`. Fixture: the decisions line `formatEntry({status:'AUTO', now, step:'Auto-merge short-circuit', text: verdictText(7), reversibility:'n/a'})`. Assert `deepStrictEqual(r.merge, { resolution: 'merge', reason: 'every member carries auto:build with auto:merge or a matured auto:merge-pending; no needs-human verdict' })` and `r.mergeStale === null`.
  - `an unparsed pass line, or a verdict for another record, leaves member #7 unconfirmed`. Two fixtures: a pass line with a trailing tail (`… verdict auto-merge — extra. Reversibility: n/a.`), and the pass line for `#70`. Both set `mergeStale.unconfirmed` to `[7]`. The first's reason says `latest: unparsed`.
  - `a bundle is stale until every member has a confirmed verdict`. `headers: [7, 8]` with a pass line for #7 only gives `unconfirmed: [8]`. With pass lines for both, `mergeStale === null`.
  - `recheckMerge: a needs-human line logged after merge flips it to leave-open and names the line` (kind `needs-human`).
  - `recheckMerge: an unparsed verdict line is a hit` (kind `unparsed`).
  - `recheckMerge: a stale member whose pass verdict was logged after the resolve is no hit`, and one still missing is a hit (kind `unconfirmed`).
  - `recheckMerge ignores its own Merge re-check line`. For each hit kind, append the `Merge re-check:` line Task 2 would write. Assert that `recheckMerge` still returns the same `lateVerdict`. After an unparsed hit, the appended line must not turn the result into a `needs-human` hit.
  - `recheckMerge: a hit with no stored merge (null) or a stored leave-open reports hit:true, changed:false`.
  - `recheckMerge: a clean merge (only a pass line) and empty decisions with no mergeStale are no hit`.
- [ ] **Step 2: Run** `node --test tests/bin-lib/console/resolve.test.js`. Expected: the new tests FAIL (`recheckMerge` is not a function, and `mergeStale` is undefined).
- [ ] **Step 3: Implement.** In `mergeResolution`, or in `resolveAll` right after it, compute `mergeStale` per Interfaces. Leave the `merge` return values untouched. Export `latestVerdicts` from `merge-verdict.js`. Add `recheckMerge` per Interfaces and export it.
- [ ] **Step 4: Run** `node --test tests/bin-lib/console/resolve.test.js tests/bin-lib/console/cli.test.js tests/console-on-pr.test.js tests/bin-lib/wrap-up/engine-verify.test.js tests/auto-merge-short-circuit-verdict-backstop.test.js`, plus every suite that requires `merge-verdict.js` (`git grep -l "merge-verdict" -- tests`). Expected: all PASS with no existing test edited. If a pre-existing test fails, the change broke the `merge` object or a pinned shape. Fix the implementation, never the test.
- [ ] **Step 5: Revert check.** Temporarily make `mergeStale` always `null`, re-run `resolve.test.js`, and confirm the AC2.1 test goes red. Restore it.
- [ ] **Step 6: Commit** `resolve.js`, `merge-verdict.js` and the test: `Mark the console merge half stale until a merge-check verdict is logged — refs #5833`.

### Task 2: `console-resolve.js --recheck-merge`, and persisting `mergeStale`

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/console-resolve.js`:
  - Add a header comment for the new shape after the last existing shape, and update `USAGE`.
  - The resolve shape writes `resolveAll`'s `mergeStale` into `console.json` beside `merge`, only when it is non-null. When it is set, it also writes one stderr line: `console-resolve.js: merge half stale — {reason}`. Stdout is unchanged, so existing stdout pins stay green.
  - `parseArgs` adds boolean `--recheck-merge`, which takes no other flag than `--run`.
  - `run` dispatches to a new `recheckMergeShape(runDir, { stdout, stderr, now })` before the `readPolicy` call.
- Test: `tests/bin-lib/console/cli.test.js` (new tests only)
- Modify: `docs/plugin-structure.md` (one CLI line beside the other `console-resolve.js` lines, ~line 300, plus `recheckMerge` in the `lib/console/` resolve.js entry, line 63)

**Interfaces:**
- Consumes: `recheckMerge` and `mergeStale` (Task 1), `appendEntry`/`formatEntry` (already imported), `writeFileAtomic`, `withLock`.
- Produces: the CLI contract Task 3 cites. It needs no ceiling. It reads `{run}/decisions.md` and `{run}/console.json`.
  - Everything below runs inside `withLock(path.join(runDir, '.console.lock'), …, { failClosed: true, env: process.env })`. When the lock cannot be taken: stderr `console-resolve.js: recheck-merge failed (lock: {message}) — not merging`, exit 3, nothing written.
  - Read `decisions.md`. An absent file is empty content (no verdict logged). Any other read error: stderr `console-resolve.js: recheck-merge failed (decisions.md unreadable: {message}) — not merging`, exit 3, nothing written.
  - Read `console.json`. Absent: `merge = null`, `mergeStale = null`, and the file is never created. Present but unparseable: stderr `console-resolve.js: recheck-merge refused (console.json unparseable) — nothing written`, exit 5. Present and parsed: `merge = data.merge` only when `data.mode === 'auto-resolve'` and `data.merge` is an object, else `null`. `mergeStale = data.mergeStale` when it is an object with an array `unconfirmed`, else `null`.
  - Call `recheckMerge(merge, decisions, mergeStale)`.
  - No hit: stdout `console-resolve.js: recheck-merge merge — no needs-human, malformed or unconfirmed merge-check verdict in decisions.md`, exit 0, nothing written.
  - Hit, step 1, the append. Skip it when `decisions.md` already holds a `Merge re-check:` entry naming the same `lateVerdict`. Otherwise call `appendEntry({ runDir, section: '/wrap-up', entry: formatEntry({ status: 'AUTO', now: now(), step: 'Merge re-check', text: TEXT[kind] + ': ' + lateVerdict, reversibility: 'n/a' }) })`. `TEXT` is `{ 'needs-human': 'merge withheld — a merge-check verdict asked for a human', unparsed: 'merge withheld — a merge-check verdict line did not parse', unconfirmed: 'merge withheld — no confirmed merge-check verdict at merge time' }`. A thrown append: stderr, exit 3, `console.json` untouched.
  - Hit, step 2, the rewrite. Only when `changed`, write `console.json` back with `merge` replaced by `{ ...recheck.merge, recheckedAt: <ISO now> }` via `writeFileAtomic`. A thrown write: stderr, exit 3, and the line has already landed.
  - Hit, step 3: stdout `console-resolve.js: recheck-merge leave-open — {lateVerdict}`, exit 0.

- [ ] **Step 1: Write the failing tests** in `cli.test.js`, using `mainCheckoutWithRun` and `baseDeps` (new tests only):
  - `AC1.1: a needs-human verdict logged after console.json recorded merge — --recheck-merge resolves leave-open, rewrites console.json, logs one line`. Seed `consoleJson` = `{resolved:true, mode:'auto-resolve', merge:{resolution:'merge', reason:'…'}}` and a decisions line `- AUTO 20:13:22 — Auto-merge short-circuit: #7 assess-agent-autonomy verdict needs-human — Review Console renders normally. Reversibility: n/a.`. Assert exit 0. Assert stdout matches `/recheck-merge leave-open — /`. Assert `console.json` `merge.resolution === 'leave-open'` with `recheckedFrom === 'merge'`. Assert exactly one `Merge re-check:` line in `decisions.md`.
  - `AC2.1 (CLI): the resolve shape persists mergeStale to console.json and names it on stderr when no verdict is logged`, and `--recheck-merge` on that `console.json` prints leave-open.
  - `--recheck-merge is idempotent for every hit kind: a second run prints leave-open and logs nothing more` (needs-human, unparsed and unconfirmed fixtures).
  - `--recheck-merge with no late verdict prints merge and writes nothing` (assert the `console.json` bytes are unchanged and no `Merge re-check:` line exists).
  - `--recheck-merge with no console.json (local-merge) judges decisions.md alone`. On no hit it prints `merge`. On a needs-human line it prints `leave-open`, logs one line, and creates no `console.json`.
  - `--recheck-merge fails closed`. An unparsable `console.json` is exit 5 with nothing written. A `decisions.md` that is a directory, so the read throws, is exit 3 with nothing written.
  - `parseArgs: --recheck-merge takes no other flag than --run` (`--recheck-merge --policy console-auto` throws a UsageError, so `run` returns 2).
- [ ] **Step 2: Run** `node --test tests/bin-lib/console/cli.test.js`. Expected: the new tests FAIL with `unknown flag: --recheck-merge`.
- [ ] **Step 3: Implement** per Files and Interfaces.
- [ ] **Step 4: Run** `node --test tests/bin-lib/console/cli.test.js tests/bin-lib/console/resolve.test.js`. Expected: PASS, with no existing test edited. Also run any suite that pins `USAGE` or `docs/plugin-structure.md` CLI lines: `git grep -l "console-resolve" -- tests`, run each hit.
- [ ] **Step 5: Revert check.** Make `recheckMergeShape` always print `merge`. Confirm the AC1.1 test goes red, then restore it.
- [ ] **Step 6: Commit**: `Add console-resolve.js --recheck-merge so a merge site re-reads a late or missing merge-check verdict — refs #5833`.

### Task 3: Both merge sites re-check before merging; the console states the enforced order

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/skills/wrap-up/execution-and-verification.md` (Branch finish paragraph, ~lines 71-89)
- Modify: `plugin/skills/_shared/local-merge-auto-finish.md` (Procedure: a new re-check between step 2 and step 3, so a hit parks before `close-run`. The Park branch's opening list names it.)
- Modify: `plugin/skills/wrap-up/review-console.md` (Auto-resolution short-circuit, the Needs-human carve-out bullet ~line 91 or the resolve paragraph ~line 101)
- Modify: `plugin/skills/wrap-up/review-console-appendix.md` (line ~60, "computes the merge half with both carve-outs")
- Modify: `plugin/skills/dispatch/settle-and-merge.md` line ~268. The sentence "finds no verdict to honour and resolves the merge half to `merge`" becomes incomplete once Task 1 lands. Reword it: the console still resolves `merge`, but marks the half stale (`mergeStale`), and the merge site's `--recheck-merge` then leaves the PR open. Logging the needs-human line stays required, since it is what names the reason.
- Test: `tests/wrap-up-branch-finish-after-execution.test.js`, plus the existing suite that pins `local-merge-auto-finish.md`'s Procedure (`git grep -l "local-merge-auto-finish" -- tests`). Add the local-merge pin to it, sized like its neighbors.
- No change (classified, from plan-audit Check B): `docs/journeys/multi-spec-review-console.md` (history of #2299), `docs/journeys/trust-a-singleton-auto-merge-to-refuse-without-a-verdict-2941.md` (its needsHumanVerdict claim still holds), `plugin/skills/dispatch/drain-pr-overlap.md` (its mergeResolution reader claim still holds), `plugin/bin/lib/wrap-up/engine-verify.js` (Consumer classification above), `tests/followup-recheck-conformance.test.js` (an unrelated `recheck-merge-mode` id).
- No change (classified): `_shared/pr-first-merge.md`. It runs only after Branch finish has routed to merge, and the re-check lives at that routing point. `flow/multispec-review-console.md` never reads per-dir `merge.resolution`. `_shared/local-merge-sequence.md` is the mechanical sequence `local-merge-auto-finish.md` drives, and the re-check sits in the driver before step 3.

- [ ] **Step 1: Write the failing tests.**
  - In `tests/wrap-up-branch-finish-after-execution.test.js`: `AC1.1: Branch finish re-checks the merge half with --recheck-merge before running pr-first-merge`. Inside `paragraph(exec, FINISH_H)`, assert three things: the literal `console-resolve.js" --run "$PIPELINE_RUN_DIR" --recheck-merge` appears before `MERGE`; the paragraph contains `prints \`recheck-merge merge\``; and it contains `skips the merge`. Add a go-red control: delete the recheck sentence from the text and assert that the order check throws. Every existing `FINISH_CLAUSES` entry stays byte-identical.
  - In the `local-merge-auto-finish.md` suite: `AC1.1 (local-merge): the no-prompt finish re-checks with --recheck-merge before the pre-merge checks`. Assert that `--recheck-merge` appears in the Procedure before the step 3 heading (`**Pre-merge checks**`), and that the re-check names the Park branch with no re-stamp.
- [ ] **Step 2: Run** both suites. Expected: FAIL.
- [ ] **Step 3: Edit the prose.**
  - `execution-and-verification.md` Branch finish: after "`console.json`'s `merge.resolution` `merge`" and its parenthetical, before "runs `_shared/pr-first-merge.md`'s procedure", insert a sentence. Before merging on a stored `merge`, run `node "${CLAUDE_PLUGIN_ROOT}/bin/console-resolve.js" --run "$PIPELINE_RUN_DIR" --recheck-merge` (#5833). It re-reads `decisions.md` for a needs-human, malformed or still-missing `merge-check` verdict. Merge only when it exits 0 and prints `recheck-merge merge`. When it prints `recheck-merge leave-open`, the CLI has already logged the verdict and rewritten `console.json`, so the run skips the merge and lands on `pending-review` as leave-open does. Any other exit skips the merge too, with one `SKIP` line via `log-decision.js` naming the exit. Keep the existing pinned clause text intact.
  - `local-merge-auto-finish.md`: a new step between 2 and 3, "Re-check the merge-check verdict" (#5833). Run `node "${CLAUDE_PLUGIN_ROOT}/bin/console-resolve.js" --run "{run-dir}" --recheck-merge` as its own call. Proceed only on exit 0 with `recheck-merge merge`. On `recheck-merge leave-open`, go to the Park branch with no re-stamp and the reason `merge-check verdict withheld the merge`. On any other exit, go to the Park branch with the reason `merge re-check failed (exit {code})`. Renumbering the later steps is not allowed, because other files cite them by number. Use a sub-step label such as `2a.` instead. Add the re-check to the Park branch's heading list of reasons.
  - `review-console.md`: one sentence (under 1,000 B) in the Auto-resolution short-circuit stating that the order is enforced, not only prescribed. When a member's passing `merge-check` verdict is not yet logged, `console-resolve.js` marks the merge half stale (`mergeStale`). Each merge site's `--recheck-merge` then refuses to merge until the verdict confirms, and catches a needs-human verdict logged after the resolve (#5833).
  - `review-console-appendix.md` line ~60: state that `console.json` carries `mergeStale` when a member's verdict is unconfirmed, and name `--recheck-merge` as the merge sites' re-check.
  - `settle-and-merge.md` line ~268: reword per Files.
- [ ] **Step 4: Run** both suites from Step 1, then every suite reading these files: `git grep -l -e "execution-and-verification.md" -e "review-console.md" -e "review-console-appendix.md" -e "local-merge-auto-finish" -e "settle-and-merge.md" -- tests`, and run each. Then run `node --test tests/bin-lib/skill-audit/context-cost.test.js` for the rail. Expected: PASS.
- [ ] **Step 5: Commit**: `Re-check the merge-check verdict at both merge sites and state the enforced console order — refs #5833`.

## Spec coverage

| Spec item | Task |
|---|---|
| Deliverable 1 (re-evaluate needsHumanVerdict before acting on merge, leave-open + one log line) | Tasks 1 (`recheckMerge`), 2 (CLI), 3 (both merge sites) |
| Deliverable 2 (refuse or mark stale; settled: mark stale) | Task 1 (`mergeStale`), Task 2 (persisted and surfaced on stderr) |
| Decision, Reading B (pr-first and local-merge sites, one shared re-check) | Task 2 (one CLI), Task 3 (both call sites) |
| Decision, family rule (fail-closed; append before console.json) | Task 1 (unparsed and unconfirmed are hits), Task 2 (lock, read and append failures exit 3; append before write) |
| AC1.1 | Task 2 Step 1 (CLI), Task 3 Step 1 (both prose pins) |
| AC2.1 | Task 1 Step 1, Task 2 Step 1 |
| AC3.1 | Task 1 Step 1, plus Task 1/2 Step 4 (existing suites green, unedited) |
| Key File `plugin/bin/console-resolve.js` — surface the stale merge half | Task 2 |
| Key File `review-console.md` — state the ordering as enforced | Task 3 |
| Key File `_shared/local-merge-auto-finish.md` — local-merge finish re-checks | Task 3 |
