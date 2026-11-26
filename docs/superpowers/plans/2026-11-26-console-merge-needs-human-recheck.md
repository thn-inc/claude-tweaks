# Console Merge Needs-Human Recheck Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An unattended run never merges a PR whose `merge-check` verdict asked for a human, even when that verdict is logged after `console-resolve.js` already recorded `merge.resolution: merge` in `console.json`.

**Architecture:** Two guards. (1) `mergeResolution()` in `plugin/bin/lib/console/resolve.js` resolves `merge` only when every member has a confirmed passing `merge-check` verdict already in `decisions.md`, using the existing `confirmPassingVerdicts` from `plugin/bin/lib/dispatch/merge-verdict.js`. When it has none, it returns `leave-open`. (2) A new read-then-maybe-rewrite CLI shape, `console-resolve.js --run <dir> --recheck-merge`, re-runs `needsHumanVerdict` against the current `decisions.md` when `console.json` says `merge`. On a hit it rewrites `console.json`'s merge to `leave-open` and logs one decision line. Branch finish in `wrap-up/execution-and-verification.md` calls it right before the merge.

**Tech Stack:** Node 18+ CommonJS, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-11-26T082958-record-5833/work/5833-spec.md`

Scope keywords: needsHumanVerdict, mergeResolution, recheck-merge

## Global Constraints

- The in-order path must not change: when the verdict is logged before the resolve, `merge` still resolves with the exact reason string `every member carries auto:build with auto:merge or a matured auto:merge-pending; no needs-human verdict`. (AC3)
- A late verdict resolves to leave-open (`pending-review`) and logs exactly one decision line that names the late verdict. (Deliverable 1)
- Merge-verdict parsing goes through `plugin/bin/lib/dispatch/merge-verdict.js`, the one module that owns the marker. Never write a second regex for the pass marker.
- From the `gh-api-module-pattern` project skill's `cli-wrapper-contract.md`, quoted: "Logic lives in an exported `run(argv, deps)`; every side effect (`runner`, `ghAvailable`, `remoteUrl`, `stdout`, `stderr`) goes through `deps` so tests inject fakes. **Every** `deps` call that can throw (e.g. `remoteUrl` outside a git repo) is try/caught into the documented exit-code contract". `console-resolve.js` already follows this, so the new shape uses its `run`/`deps` seam and its existing exit vocabulary: 2 malformed, 3 unanchored or write failed, 5 refused.
- `review-console-section-addition` project skill: this change adds no section and no new resolution value. `leave-open` already exists, so none of that skill's registration sites apply.
- Do not use `**` bold inside the Branch finish paragraph of `execution-and-verification.md`. `tests/wrap-up-branch-finish-after-execution.test.js`'s `paragraph()` treats ` **` as the paragraph end.
- `plugin/skills/wrap-up/review-console.md` is 45,883 B against the 52,500 B `RAIL_BYTES` rail (87%). Keep the prose added there under 1,000 B.
- Scope and edit discipline: "Commit tests only where the task asks for them or the repo already keeps tests for this kind of change, sized like the neighboring test files; scratch checks stay scratch. Touch only what the task requires — a pre-existing bug you notice is a follow-up to report, not a fix to fold in, unless the task cannot work without it. Don't reformat or "improve" adjacent code; edit in place rather than rewrite when the result is the same."
- Project maturity `established`: "For any task modifying pre-existing behavior, write a full characterization test covering edge cases before changing it — published or external consumers may depend on them."

## Review Focus

- A latest verdict that is `needs-human` after an earlier `auto-merge`: `needsHumanVerdict` still wins, so the result is leave-open. Task 1 pins it.
- A malformed pass line (`unparsed`) is not a confirmed verdict, so the result is leave-open, fail closed. Task 1 pins it.
- A verdict for a different record (`#70` instead of `#7`) does not satisfy member `#7`. Task 1 pins it.
- `--recheck-merge` against a `console.json` that is absent, unparseable, not the `auto-resolve` shape, or has no `merge` object: exit 5, nothing written, so Branch finish does not merge. Task 2 pins it.
- Running `--recheck-merge` twice after a hit: the second run prints leave-open and writes no second decision line. Task 2 pins it.

## Consumer classification (Consumer-enumeration check)

`console.json`'s `merge.resolution` is read by:
- `plugin/bin/lib/wrap-up/engine-verify.js` `consoleMergeResolution` (pick-one). It reads the string, and `leave-open` already maps to the pending-review skip. The Task 2 rewrite keeps this consumer correct after a late verdict. No change.
- `wrap-up/execution-and-verification.md` Branch finish and its Leave-open mergeability re-check (prose). Task 3 changes these.
- `flow/multispec-review-console.md` discards per-dir `merge.resolution` by design. No change.

---

### Task 1: mergeResolution requires a confirmed merge-check verdict

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/console/resolve.js` (`mergeResolution`, ~line 442; add `recheckMerge`; export it)
- Test: `tests/bin-lib/console/resolve.test.js`
- Modify (fixtures only): every existing test in `tests/bin-lib/console/resolve.test.js`, `tests/bin-lib/console/cli.test.js` and any other suite that expects `merge` with no verdict line in `decisions.md`. Find them by running the suites after Step 3. Each fixture gets an in-order pass verdict line built with `formatEntry` (step `Auto-merge short-circuit`, text `verdictText(7)`, reversibility `n/a`), so it is the in-order path AC3 keeps unchanged.

**Interfaces:**
- Consumes: `confirmPassingVerdicts(content: string, members: number[]) -> { [n]: { confirmed: boolean, latest: string|null } }` and `verdictText(n)` from `plugin/bin/lib/dispatch/merge-verdict.js`.
- Produces: `recheckMerge(merge: {resolution, reason}|null, decisions: string) -> { changed: boolean, merge: {resolution, reason, ...} , lateVerdict: string|null }`, exported from `resolve.js`. When `merge.resolution === 'merge'` and `needsHumanVerdict(decisions)` returns a line, it returns `changed: true`, `lateVerdict: <line without the leading "- ">` and `merge: { resolution: 'leave-open', reason: 'late merge-check verdict needs-human logged after the console resolved merge: <lateVerdict>', recheckedFrom: 'merge' }`. Otherwise it returns `changed: false` and the input merge unchanged.

- [ ] **Step 1: Write the failing tests** in `tests/bin-lib/console/resolve.test.js`:
  - `AC2.1: with the short-circuit applicable and no merge-check verdict logged yet, the merge half does not resolve merge`. Fixture: `headers: [7]`, `decisions: ''`, default grants (`auto:build`,`auto:merge`). Assert `r.merge.resolution === 'leave-open'` and `r.merge.reason` matches `/#7: no confirmed merge-check verdict in decisions\.md yet \(latest: none\)/`.
  - `AC3.1: a passing verdict logged before the resolve still resolves merge, reason unchanged`. Fixture: the decisions line `formatEntry({status:'AUTO', now, step:'Auto-merge short-circuit', text: verdictText(7), reversibility:'n/a'})`. Assert `deepStrictEqual(r.merge, { resolution: 'merge', reason: 'every member carries auto:build with auto:merge or a matured auto:merge-pending; no needs-human verdict' })`.
  - `an unparsed pass line, or a verdict for another record, does not confirm member #7`. Two fixtures: a pass line with a trailing tail (`… verdict auto-merge — extra. Reversibility: n/a.`), and the pass line for `#70`. Both assert leave-open. The first asserts `latest: unparsed`.
  - `a bundle resolves merge only when every member has a confirmed verdict`. `headers: [7, 8]` with a pass line for #7 only: leave-open naming `#8`. With pass lines for both: merge.
  - `recheckMerge: a needs-human line logged after merge flips it to leave-open and names the line`, plus `recheckMerge leaves leave-open and a clean merge unchanged` (changed:false for `{resolution:'leave-open'}`, for `null`, and for merge with only a pass line).
- [ ] **Step 2: Run** `node --test tests/bin-lib/console/resolve.test.js`. Expected: the new tests FAIL (`recheckMerge` is not a function, and merge resolves without a verdict).
- [ ] **Step 3: Implement.** In `mergeResolution`, after the maturation loop and before the final `return { resolution: 'merge', … }`, call `confirmPassingVerdicts(snapshot.decisions, snapshot.members)`. For the first member (in `snapshot.members` order) whose `confirmed` is false, return `{ resolution: 'leave-open', reason: `#${n}: no confirmed merge-check verdict in decisions.md yet (latest: ${latest || 'none'}) — the Auto-merge short-circuit applies, so its verdict must be logged before the console resolves merge` }`. Add `recheckMerge` per Interfaces and export it.
- [ ] **Step 4: Run** `node --test tests/bin-lib/console/resolve.test.js tests/bin-lib/console/cli.test.js tests/bin-lib/console/recheck.test.js tests/console-on-pr.test.js tests/bin-lib/wrap-up/engine-verify.test.js tests/auto-merge-short-circuit-verdict-backstop.test.js`. For every pre-existing test that now fails only because it expected `merge` with no verdict line, add the in-order pass line to its fixture (Files above). Never change an asserted expectation. Expected: all PASS.
- [ ] **Step 5: Revert check.** Temporarily remove the new `confirmPassingVerdicts` block, re-run `resolve.test.js`, and confirm the AC2.1 test goes red. Restore the block.
- [ ] **Step 6: Commit** `resolve.js` and the touched tests: `Require a logged merge-check verdict before the console resolves merge — refs #5833`.

### Task 2: `console-resolve.js --recheck-merge`

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/console-resolve.js` (header comment as the eighth shape; `USAGE`; `parseArgs` adds boolean `--recheck-merge`, which takes no other flag than `--run`; `run` dispatches to a new `recheckMergeShape(runDir, { stdout, stderr, now })` before the `readPolicy` call)
- Test: `tests/bin-lib/console/cli.test.js`
- Modify: `docs/plugin-structure.md` (one CLI line beside the other `console-resolve.js` lines, ~line 300, plus `recheckMerge` in the `lib/console/` resolve.js entry, line 63)

**Interfaces:**
- Consumes: `recheckMerge` (Task 1), `appendEntry`/`formatEntry` (already imported), `writeFileAtomic`, `withLock`.
- Produces: the CLI contract Task 3 cites. It needs no ceiling and reads `{run}/console.json` and `{run}/decisions.md`.
  - `console.json` absent, unparseable, `mode !== 'auto-resolve'`, or no `merge` object: stderr `console-resolve.js: recheck-merge refused ({why}) — nothing written`, exit 5.
  - Unchanged: stdout `console-resolve.js: recheck-merge {resolution} — {reason}`, exit 0, nothing written.
  - Changed: under `withLock(path.join(runDir, '.console.lock'), …, { failClosed: true, env: process.env })`, re-read `console.json` and write it back with `merge` replaced by `{ ...recheck.merge, recheckedAt: <ISO now> }`. Then `appendEntry({ runDir, section: '/wrap-up', entry: formatEntry({ status: 'AUTO', now: now(), step: 'Branch finish', text: `merge half re-checked: late needs-human merge-check verdict after console-resolve recorded merge — resolved leave-open (pending-review): ${lateVerdict}`, reversibility: 'n/a' }) })`. Print `console-resolve.js: recheck-merge leave-open — {reason}` and exit 0. A thrown write or append prints to stderr and exits 3.

- [ ] **Step 1: Write the failing tests** in `cli.test.js`, using `mainCheckoutWithRun` and `baseDeps`:
  - `AC1.1: a needs-human verdict logged after console.json recorded merge — --recheck-merge resolves leave-open, rewrites console.json, logs one line`. Seed `consoleJson` = `{resolved:true, mode:'auto-resolve', merge:{resolution:'merge', reason:'…'}}` and a decisions line `- AUTO 20:13:22 — Auto-merge short-circuit: #7 assess-agent-autonomy verdict needs-human — Review Console renders normally. Reversibility: n/a.`. Assert exit 0, stdout matches `/recheck-merge leave-open — late merge-check verdict needs-human/`, `console.json` `merge.resolution === 'leave-open'` with `recheckedFrom === 'merge'`, and exactly one `Branch finish:` line in `decisions.md`.
  - `--recheck-merge is idempotent: a second run prints leave-open and logs nothing more`.
  - `--recheck-merge with no late verdict prints merge and writes nothing` (assert the `console.json` bytes are unchanged and no `Branch finish:` line exists).
  - `--recheck-merge refuses (exit 5, nothing written) on an absent, unparseable, non-auto-resolve, or merge-less console.json`. Use four fixtures.
  - `parseArgs: --recheck-merge takes no other flag than --run` (`--recheck-merge --policy console-auto` throws a UsageError, so `run` returns 2).
- [ ] **Step 2: Run** `node --test tests/bin-lib/console/cli.test.js`. Expected: the new tests FAIL with `unknown flag: --recheck-merge`.
- [ ] **Step 3: Implement** per Interfaces.
- [ ] **Step 4: Run** `node --test tests/bin-lib/console/cli.test.js tests/bin-lib/console/resolve.test.js`. Expected: PASS. Also run any suite that pins `USAGE` or `docs/plugin-structure.md` CLI lines: `git grep -l "console-resolve" -- tests`, run each hit.
- [ ] **Step 5: Revert check.** Make `recheckMergeShape` always print the stored merge. Confirm the AC1.1 test goes red, then restore it.
- [ ] **Step 6: Commit**: `Add console-resolve.js --recheck-merge so Branch finish re-reads a late needs-human verdict — refs #5833`.

### Task 3: Branch finish re-checks before merging; the console states the enforced order

**Role:** integration

**Files:**
- Modify: `plugin/skills/wrap-up/execution-and-verification.md` (Branch finish paragraph, ~lines 71-89)
- Modify: `plugin/skills/wrap-up/review-console.md` (Auto-resolution short-circuit, the Needs-human carve-out bullet ~line 91 or the resolve paragraph ~line 101)
- Modify: `plugin/skills/wrap-up/review-console-appendix.md` (line ~60, "computes the merge half with both carve-outs")
- Modify: `plugin/skills/dispatch/settle-and-merge.md` line ~268. The sentence "finds no verdict to honour and resolves the merge half to `merge`" becomes false once Task 1 lands, because an unlogged verdict now resolves leave-open. Reword it to the new behavior: an unlogged verdict leaves the merge half unconfirmed, and the console resolves leave-open. Logging the needs-human line stays required, since it is what names the reason.
- Test: `tests/wrap-up-branch-finish-after-execution.test.js`
- No change (classified, from plan-audit Check B): `docs/journeys/multi-spec-review-console.md` (history of #2299), `docs/journeys/trust-a-singleton-auto-merge-to-refuse-without-a-verdict-2941.md` (its needsHumanVerdict claim still holds), `plugin/skills/dispatch/drain-pr-overlap.md` (its mergeResolution reader claim still holds), `plugin/bin/lib/wrap-up/engine-verify.js` (Consumer classification above), `tests/followup-recheck-conformance.test.js` (an unrelated `recheck-merge-mode` id).
- No change (classified): `_shared/pr-first-merge.md`. It runs only after Branch finish has routed to merge, and the re-check lives at that routing point. `flow/multispec-review-console.md` never reads per-dir `merge.resolution`.

- [ ] **Step 1: Write the failing test** in `tests/wrap-up-branch-finish-after-execution.test.js`: `AC1.1: Branch finish re-checks the merge half with --recheck-merge before running pr-first-merge`. Inside `paragraph(exec, FINISH_H)`, assert that the literal `console-resolve.js" --run "$PIPELINE_RUN_DIR" --recheck-merge` appears before `MERGE`, and that the paragraph contains `prints \`recheck-merge merge\`` and `skips the merge`. Add a go-red control: delete the recheck sentence from the text and assert that the order check throws. Every existing `FINISH_CLAUSES` entry stays byte-identical.
- [ ] **Step 2: Run** `node --test tests/wrap-up-branch-finish-after-execution.test.js`. Expected: FAIL.
- [ ] **Step 3: Edit the prose.**
  - `execution-and-verification.md` Branch finish: after "`console.json`'s `merge.resolution` `merge`" and its parenthetical, before "runs `_shared/pr-first-merge.md`'s procedure", insert a sentence. Before merging on a stored `merge`, run `node "${CLAUDE_PLUGIN_ROOT}/bin/console-resolve.js" --run "$PIPELINE_RUN_DIR" --recheck-merge` (#5833). It re-reads `decisions.md` for a needs-human `merge-check` verdict logged after the console resolved. Merge only when it exits 0 and prints `recheck-merge merge`. When it prints `recheck-merge leave-open`, the CLI has already rewritten `console.json` and logged the late verdict, so the run skips the merge and lands on `pending-review` as leave-open does. Any other exit skips the merge too, with one `SKIP` line via `log-decision.js` naming the exit. Keep the existing pinned clause text intact.
  - `review-console.md`: one sentence (under 1,000 B) in the Auto-resolution short-circuit stating that the order is enforced, not only prescribed. `console-resolve.js` resolves the merge half to `merge` only when every member's passing `merge-check` verdict is already logged, so the Auto-merge short-circuit above must log it first. Branch finish's `--recheck-merge` catches a needs-human verdict logged after the resolve (#5833).
  - `review-console-appendix.md` line ~60: state that the merge half also requires a confirmed passing verdict per member, and name `--recheck-merge` as Branch finish's late-verdict re-check.
- [ ] **Step 4: Run** `node --test tests/wrap-up-branch-finish-after-execution.test.js`, then every suite reading these three files: `git grep -l -e "execution-and-verification.md" -e "review-console.md" -e "review-console-appendix.md" -- tests`, run each. Then run `node --test tests/bin-lib/skill-audit/context-cost.test.js` for the rail. Expected: PASS.
- [ ] **Step 5: Commit**: `Re-check a late needs-human verdict at Branch finish and state the enforced console order — refs #5833`.

## Spec coverage

| Spec item | Task |
|---|---|
| Deliverable 1 (Branch finish re-evaluates needsHumanVerdict, leave-open + one log line) | Tasks 1 (`recheckMerge`), 2 (CLI), 3 (prose) |
| Deliverable 2 (console-resolve refuses merge without a verdict) | Task 1 |
| AC1.1 | Task 2 Step 1 (CLI), Task 3 Step 1 (prose pin) |
| AC2.1 | Task 1 Step 1 |
| AC3.1 | Task 1 Step 1, plus Task 1 Step 4 (existing suites green) |
| Key File `plugin/bin/console-resolve.js` — surface the stale merge half | Task 2 |
| Key File `review-console.md` — state the ordering as enforced | Task 3 |
