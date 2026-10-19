# Phase-Exit Merge-State Check Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After every pr-first phase-exit push, read the run PR's merge state mechanically; on a conflict, say so, log one `AUTO` entry, and (in `auto`) catch the branch up with the integration branch before the next phase.

**Architecture:** A new status-as-data CLI, `plugin/bin/pr-merge-state.js`, mirrors `plugin/bin/pr-checks.js`'s shape (run-dir anchoring via `resolveTarget`, `run-state.json` `pr.number` via `readRunStateWithParent`, injectable deps, exit 0 in every state) and reads the PR through `plugin/bin/lib/reconcile/pr-state.js`'s existing `resolvePrStateByNumber` — no new `gh` call shape. On `conflicting` it writes its own `AUTO` decision line (`lib/log-decision/append.js`'s `formatEntry` + `appendEntry`), so the log is mechanical. `_shared/git-discipline.md`'s Phase-exit push section gains a "Post-push merge-state check" subsection that runs the CLI and owns the routing and the auto-mode catch-up; every phase's exit already cites that section, so no caller changes.

**Tech Stack:** Node 18+ CommonJS, `node --test`, markdown skill prose.

**Spec:** `.claude-tweaks/pipelines/2026-10-19T150249-record-2986/work/2986-spec.md`

Scope keywords: resolvePrStateByNumber, Phase-exit push, pr-merge-state

Premise-refs: plugin/bin/lib/reconcile/pr-state.js
Premise-refs: plugin/bin/pr-checks.js
Premise-refs: plugin/skills/_shared/pr-check-gate.md

## Global Constraints

- Reuse `resolvePrStateByNumber(repoRoot, number)` (returns the parsed `gh pr view --json number,state,mergedAt,updatedAt,mergeCommit,mergeable,mergeStateStatus,closingIssuesReferences` object, `null` for a falsy number, or one of the strings `'gh-absent'` / `'network-failure'` / `'invalid-arguments'`). Never add a second merge-state `gh` read.
- Best-effort, fail-open: a failed read or `UNKNOWN` logs nothing alarming and changes nothing.
- `UNKNOWN` is no signal, never a conflict, and is never re-read (AC4: "never stops or slows a phase beyond the one read").
- Degrade per attempt, never persist — nothing written to `run-state.json`.
- Catch-up uses the worktree-scoped form `git -C {worktree} ...` / `git -C {worktree} push origin {branch}` and never runs with uncommitted changes.
- No new mid-flow stop in `interactive`/`hybrid` (CLAUDE.md auto-mode strict rule).
- Reuse the existing catch-up/merge-conflict procedures; no second merge procedure.
- Commit style: `{Verb} {what} — {detail}`, "refs #2986", never "closes/fixes".

## Review Focus

- A PR that reports `mergeable: CONFLICTING` but `mergeStateStatus` something other than `DIRTY` (or vice versa) — must still classify `conflicting` (Task 1 test `conflicting via mergeable alone`).
- `run-state.json` with `pr` present but `pr.number` not a positive integer (`"7"`, `0`, `null`) — must read `no-pr`, make no gh call (Task 1 test `non-integer pr.number`).
- A multi-spec per-spec run dir (`{parent}/spec-{N}/`) whose own `run-state.json` has no `pr` but the parent's does — must read the parent's PR, the same `readRunStateWithParent` behavior pr-checks.js relies on (Task 1 test `spec subdirectory reads parent pr`).
- `decisions.md` append fails (read-only run dir) — CLI must still print the `conflicting` state and exit 0 with `logged: false` (Task 1 test `append failure`).
- A forge-stale `DIRTY` where the local merge brings in nothing — prose must say HEAD-unchanged means no push (Task 2 conformance pin `stale`).

---

### Task 1: `pr-merge-state.js` CLI

**Files:**
- Create: `plugin/bin/pr-merge-state.js`
- Create: `tests/bin-lib/pr-merge-state/cli.test.js`
- Modify: `docs/plugin-structure.md` (CLI line directly after the `node plugin/bin/pr-checks.js` line, ~line 177)

**Interfaces:**
- Produces: `run(argv: string[], overrides?: object) -> exitCode:number`, `parseArgs(argv) -> {run, phase, help} | {error}`, `classifyMergeState(view: object) -> 'conflicting'|'no-conflict'|'unknown'`, `PHASE_SECTIONS: {build:'/build', test:'/test', review:'/review', polish:'/flow', wrap-up:'/wrap-up'}`. CLI: `node plugin/bin/pr-merge-state.js --run <run-dir> --phase <build|test|review|polish|wrap-up> [--help]`.
- stdout: one JSON line `{state, pr, mergeable, mergeStateStatus, phase, logged, reason?}`; `state` ∈ `conflicting | no-conflict | unknown | no-pr | read-failed | gh-absent`. `pr`/`mergeable`/`mergeStateStatus` default `null`, `logged` default `false`.
- Exit: 0 every state; 2 malformed invocation (unknown flag, missing `--run`, missing/invalid `--phase`); 3 run dir missing or not anchored (same messages/shape as pr-checks.js).
- Deps seam (`realDeps`, overridable): `cwd`, `mainRoot` (undefined), `readRunState(runDir)` (= `readRunStateWithParent(runDir, {requireRunIdParent:true}).state`), `resolvePrState(repoRoot, n)` (= `resolvePrStateByNumber`), `appendDecision({runDir, section, entry})` (= `appendEntry`), `now()` (= `Date.now`), `stdout`, `stderr`. `repoRoot` passed to `resolvePrState` is `deps.cwd()`.
- Classification: `conflicting` when `view.mergeStateStatus === 'DIRTY'` or `view.mergeable === 'CONFLICTING'`; `unknown` when either field is `'UNKNOWN'`, missing, or not a string; else `no-conflict`. Resolver string `'gh-absent'` → `gh-absent`; `'network-failure'`/`'invalid-arguments'` → `read-failed` with `reason` = that string; non-object result → `read-failed` (`reason: 'unparseable'`); `null` → `no-pr`.
- On `conflicting` only: append one entry, `formatEntry({status:'AUTO', now, step:`Phase-exit merge-state check (${phase})`, text:`PR #${n} conflicts with the integration branch at ${phase} exit (mergeStateStatus ${mss}, mergeable ${m}) — GitHub runs no pull_request workflows on it until the branch is caught up`, reversibility:'n/a'})`, under section `PHASE_SECTIONS[phase]`; `logged: true` on success, `false` (plus one stderr line) if the append throws.

- [ ] **Step 1: Write the failing tests** in `tests/bin-lib/pr-merge-state/cli.test.js`, reusing pr-checks' cli.test.js fixture shape (tmp main dir with `.git/` dir, run dir `.claude-tweaks/pipelines/2026-10-19T000001-record-1`, `mainRoot` injected, resolver faked and call-counted, real `appendEntry` against the fixture run dir unless overridden). Tests:
  - `AC1.1: DIRTY prints conflicting and writes exactly one AUTO entry naming PR and phase` — resolver returns `{number:7, mergeable:'CONFLICTING', mergeStateStatus:'DIRTY'}`, `--phase build`; exit 0; JSON `state==='conflicting'`, `pr===7`, `logged===true`; `decisions.md` contains exactly one line matching `/^- AUTO \d{2}:\d{2}:\d{2} — Phase-exit merge-state check \(build\): PR #7 conflicts with the integration branch at build exit/m`, under `## /build`.
  - `conflicting via mergeable alone` — `{mergeable:'CONFLICTING', mergeStateStatus:'BLOCKED'}` → `conflicting`; and `{mergeable:'MERGEABLE', mergeStateStatus:'DIRTY'}` → `conflicting`.
  - `polish logs under /flow` — `--phase polish`, DIRTY → entry under `## /flow`.
  - `AC4.1: UNKNOWN is no signal — one resolver call, no decisions write` — `{mergeable:'UNKNOWN', mergeStateStatus:'UNKNOWN'}` → `unknown`, resolver called exactly once, `decisions.md` absent.
  - `AC4.1: failed read fails open — read-failed, no write` — resolver returns `'network-failure'` → `read-failed`, `reason==='network-failure'`, one call, no `decisions.md`; `'invalid-arguments'` likewise.
  - `gh-absent` — resolver returns `'gh-absent'` → `gh-absent`, no write.
  - `no-conflict` — `{mergeable:'MERGEABLE', mergeStateStatus:'CLEAN'}` and `'BEHIND'` → `no-conflict`, no write.
  - `AC3.1: no pr object reads no-pr with no gh call` — run-state `{status:'active'}` (and no run-state at all) → `no-pr`, resolver never called.
  - `non-integer pr.number` — `{pr:{number:'7'}}`, `{pr:{number:0}}`, `{pr:{number:null}}` → `no-pr`, resolver never called.
  - `spec subdirectory reads parent pr` — parent run-state `{pr:{number:9}}`, spec-1 `{status:'active'}` → resolver called with `9`.
  - `append failure` — `appendDecision` override throws → still `conflicting`, `logged===false`, exit 0, one stderr line.
  - `classifyMergeState` unit cases: `{}` → `unknown`; `{mergeable:'MERGEABLE'}` (no mss) → `unknown`.
  - Invocation: `--help` exit 0 printing `usage: pr-merge-state.js --run <run-dir> --phase`; missing `--run` → 2; missing `--phase` → 2; `--phase deploy` → 2; unknown flag → 2; nonexistent run dir → 3; run dir under a worktree-shaped path (`.git` file, not dir) → 3 (copy pr-checks' unanchored fixture approach).

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/bin-lib/pr-merge-state/cli.test.js`
Expected: FAIL with `Cannot find module '../../../plugin/bin/pr-merge-state'`

- [ ] **Step 3: Implement `plugin/bin/pr-merge-state.js`** per the Interfaces block. Header comment in pr-checks.js's style: purpose (#2986), routed by `_shared/git-discipline.md`'s Post-push merge-state check, the state vocabulary, exit codes, "UNKNOWN is never re-read". `#!/usr/bin/env node`, `'use strict'`, `module.exports = { run, parseArgs, classifyMergeState, PHASE_SECTIONS }`, `if (require.main === module) process.exitCode = run(process.argv.slice(2), realDeps);`. Run-dir anchoring and the two exit-3 stderr messages copied from pr-checks.js with the `pr-merge-state.js:` prefix.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/pr-merge-state/cli.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 5: Real-input probes (read-only, record output in the task report).**
  - This run's own PR (#3606): `node plugin/bin/pr-merge-state.js --run "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines/2026-10-19T150249-record-2986" --phase build` → expected `state: "no-conflict"` (authoring probe at plan time: `gh pr view 3606 --json mergeable,mergeStateStatus` printed `MERGEABLE CLEAN`). This probe writes nothing on `no-conflict`.
  - A real DIRTY PR, without touching any run dir: `node -e` calling `classifyMergeState(require('./plugin/bin/lib/reconcile/pr-state.js').resolvePrStateByNumber(process.cwd(), 2822))` → expected `conflicting` (authoring probe: `gh pr view 2822 --json mergeable,mergeStateStatus` printed `{"mergeStateStatus":"DIRTY","mergeable":"CONFLICTING"}` on its second read; the first bulk `gh pr list` read of the same PR printed `UNKNOWN UNKNOWN` — the asynchronous-mergeability gotcha, observed live). Independent count: the same `gh pr view 2822 --json mergeStateStatus -q .mergeStateStatus` must print `DIRTY`; reconcile the two.

- [ ] **Step 6: Document the CLI** — add after the pr-checks.js line in `docs/plugin-structure.md`:
`node plugin/bin/pr-merge-state.js --run <run-dir> --phase <build|test|review|polish|wrap-up> [--help]   # Merge-state CLI — reads run-state.json's pr.number, reads the PR's mergeable/mergeStateStatus through bin/lib/reconcile/pr-state.js's resolvePrStateByNumber (one read, UNKNOWN never re-read), prints {state, pr, mergeable, mergeStateStatus, phase, logged, reason?} (#2986); state conflicting | no-conflict | unknown | no-pr | read-failed | gh-absent; on conflicting it appends one AUTO entry to decisions.md naming the PR and phase; status-as-data: exit 0 in every state, 2 malformed invocation, 3 run dir missing or not anchored. Routed by plugin/skills/_shared/git-discipline.md's Post-push merge-state check (tests in tests/bin-lib/pr-merge-state/)`

- [ ] **Step 7: Commit**

```bash
git add plugin/bin/pr-merge-state.js tests/bin-lib/pr-merge-state/cli.test.js docs/plugin-structure.md
git commit -m "Add pr-merge-state.js — mechanical post-push PR merge-state read, refs #2986"
```

### Task 2: Phase-exit push prose — Post-push merge-state check

**Files:**
- Modify: `plugin/skills/_shared/git-discipline.md` (new `### Post-push merge-state check` subsection at the END of the `## Phase-exit push` section — after the "Standalone `/build` (no run dir): list the skip…" line, before `## Catching a branch up with \`main\``)
- Modify: `plugin/skills/_shared/pr-early-run-lifecycle.md:7-10` (cross-reference)
- Test: `tests/git-discipline-merge-state-conformance.test.js`

**Interfaces:**
- Consumes: Task 1's CLI invocation and state vocabulary (`conflicting | no-conflict | unknown | no-pr | read-failed | gh-absent`).

Byte headroom: `git-discipline.md` is 13,040 bytes against the shared 51,200 ceiling; no file-specific byte pin (grep of `tests/` for `git-discipline` next to `byteLength`/`wc -c` found none; it is in no composed bundle). `pr-early-run-lifecycle.md` 30,079 bytes; the edit adds <120 bytes. Existing pins to keep intact (do not reword these lines): `tests/pr-early-run-lifecycle.test.js:125-134` (`## Phase-exit push (\`integration-model: pr-first\` only)`, `≥50× headroom`, the never-a-flag sentence, the local-merge sentence) and `tests/build-skip-degrade-trace-adoption.test.js:141` (`the existing failure-degrade warning above is\nunaffected`). The new subsection is appended below them, so no deictic in existing text changes.

- [ ] **Step 1: Write the failing conformance test** `tests/git-discipline-merge-state-conformance.test.js` reading both files; one shared assertion function `assertMergeStateSection(text)` used by the positive test and a go-red control (control: delete the `--phase` CLI line from a copy of the text and `assert.throws(() => assertMergeStateSection(mutated))`). Assertions, each a literal/regex pin:
  - `AC1.1:` subsection heading `### Post-push merge-state check` present and positioned after `## Phase-exit push` and before `## Catching a branch up with \`main\``.
  - `AC1.1:` the invocation `node "${CLAUDE_PLUGIN_ROOT}/bin/pr-merge-state.js" --run "$PIPELINE_RUN_DIR" --phase` and the phrase `After every successful phase-exit push`.
  - `AC1.1:` `resolvePrStateByNumber` named; the conflicting bullet names both `DIRTY` and `CONFLICTING` and says the CLI already wrote the `AUTO` entry.
  - `AC2.1:` the auto catch-up names, in order: `status --porcelain`, `fetch origin {integration-branch}`, `merge origin/{integration-branch}`, `push origin {branch}`, each in `git -C "{worktree-path}"` form; contains `never rebase`; contains `before the next phase starts`.
  - `AC2.1:` interactive/hybrid bullet contains `no new stop`.
  - stale-forge pin: contains `HEAD is unchanged` and `nothing to push`.
  - `AC3.1:` contains the literals `` `local-merge` and `current-branch` runs never reach this
    check `` (whitespace-tolerant regex) and `` a run with no `pr` in `run-state.json` reads `no-pr` ``.
  - `AC4.1:` contains `never re-read` and `fail open`, and the SKIP command carries `--step "Post-push merge-state check"`.
  - wrap-up pin: names `_shared/pr-first-merge.md`'s Conflict path.
  - Cross-ref: `pr-early-run-lifecycle.md` contains `Post-push merge-state check`.
  - Waived AC2.1's second half ("the re-push triggers the PR's `pull_request` workflows"): forge behavior, not code — evidenced by the record's own scrubbed trace (push at A: no pull_request runs, DIRTY; merge + push at B: all pull_request jobs run). The prose states it; the test pins the push step, not GitHub.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/git-discipline-merge-state-conformance.test.js`
Expected: FAIL (heading `### Post-push merge-state check` not found)

- [ ] **Step 3: Write the subsection** (exact copy; adjust only line wrapping to the file's ~100-col style):

````markdown
### Post-push merge-state check

After every successful phase-exit push — never after a failed one — read the run PR's merge
state. A PR that conflicts with the integration branch gets no `pull_request` workflow runs from
GitHub, so its checks list shows nothing at all, which reads exactly like "CI pending" (#2986);
the cheapest point to learn it is the first phase exit after the base moved, not the merge
decision. One plain command:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/pr-merge-state.js" --run "$PIPELINE_RUN_DIR" --phase {build|test|review|polish|wrap-up}
```

It reads `run-state.json`'s `pr.number` and the PR through `bin/lib/reconcile/pr-state.js`'s
`resolvePrStateByNumber` — one read — prints `{state, pr, mergeable, mergeStateStatus, phase,
logged, reason?}`, and exits 0 in every state; exit 2 or 3 is a tooling problem with the read
itself — route it like `read-failed`. `local-merge` and `current-branch` runs never reach this
check (no phase-exit push), and a run with no `pr` in `run-state.json` reads `no-pr`.

- **`conflicting`** (`mergeStateStatus: DIRTY` or `mergeable: CONFLICTING`) — the CLI has
  already written one `AUTO` entry to `decisions.md` naming the PR and the phase. Say it in the
  phase output: "PR #{pr} conflicts with `{integration-branch}` at {phase} exit — no
  `pull_request` CI runs until the branch is caught up." Then route on the run's mode
  (`_shared/auto-mode-contract.md`):
  - **`auto`** — run the catch-up below before the next phase starts.
  - **`interactive` / `hybrid`** — surface that line and the catch-up commands below, and
    continue: no new stop — the next phase starts as it would have.
  - **At wrap-up's exit** there is no next phase; a conflict at merge time is
    `_shared/pr-first-merge.md`'s Conflict path, unchanged.
- **`no-conflict`**, **`unknown`**, **`no-pr`** — nothing to do, nothing to log. `unknown` is
  GitHub's asynchronous mergeability computation not finished yet (common straight after a
  push): no signal, never read as a conflict, and never re-read — this check costs the phase one
  read and no more.
- **`read-failed`**, **`gh-absent`** (and exit 2/3) — fail open: the phase proceeds unchanged.
  Write one `SKIP` entry per `_shared/auto-decision-log.md`'s degrade-trace rule, the convention
  `_shared/pr-check-gate.md` applies to its own failed read:
  `node "${CLAUDE_PLUGIN_ROOT}/bin/log-decision.js" --run "$PIPELINE_RUN_DIR" --status SKIP --section "{/build|/test|/review|/flow|/wrap-up}" --step "Post-push merge-state check" --reversibility n/a --text "condition: pr-merge-state.js {state}{: reason} → fallback: no merge-state signal this phase"`.

Like the push itself, this degrades per attempt and never persists — nothing is written to
`run-state.json`, so the next phase exit's check runs regardless.

**Catch-up (`auto`).** Merge the integration branch in; never rebase — the run branch is already
public behind its PR, and a rebase would need the force push the Git Rules forbid. Merging into
a PR branch does not invert `main`'s first-parent chain the way "Catching a branch up with
`main`" below warns about: that happens only when a branch is pushed *as* `main`, and this one
lands through its PR's own merge. Resolve `{integration-branch}` per
`_shared/integration-branch.md`. One plain command per Bash call:

1. `git -C "{worktree-path}" status --porcelain` — any output: do not catch up. Surface the
   conflict line and the commands as `interactive` does, and log one `SKIP` (`--text "condition:
   uncommitted changes in the worktree → fallback: catch-up not run"`).
2. `git -C "{worktree-path}" fetch origin {integration-branch}`
3. `git -C "{worktree-path}" merge origin/{integration-branch}` — a conflict is resolved per
   "Merge conflict resolution" below (never reset or discard; verify after resolving — when the
   next phase is `test`, its own verification is that run).
4. If HEAD is unchanged, the forge's conflict state was stale and there is nothing to push; log
   it and stop. Otherwise `git -C "{worktree-path}" push origin {branch}` — the re-push is what
   lets GitHub run the PR's `pull_request` workflows — and log:
   `node "${CLAUDE_PLUGIN_ROOT}/bin/log-decision.js" --run "$PIPELINE_RUN_DIR" --status AUTO --section "{/build|/test|/review|/flow|/wrap-up}" --step "Post-push merge-state check" --reversibility high --text "caught PR #{pr}'s branch up with origin/{integration-branch} before the next phase ({before short} → {after short}); re-pushed"`.

A failed fetch, merge command, or push here degrades exactly like a failed phase-exit push: log
it and let the next phase start; the next phase exit's check reads the state again.
````

Then in `pr-early-run-lifecycle.md` lines 7-10 replace
`Every later phase exit pushes\n(\`_shared/git-discipline.md\`'s Phase-exit push section) and updates the PR's phase checklist, so`
with
`Every later phase exit pushes\n(\`_shared/git-discipline.md\`'s Phase-exit push section, including its Post-push merge-state\ncheck) and updates the PR's phase checklist, so`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/git-discipline-merge-state-conformance.test.js tests/pr-early-run-lifecycle.test.js tests/build-skip-degrade-trace-adoption.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 5: Discrimination check** — with the Edit tool, temporarily delete the `pr-merge-state.js --run … --phase` invocation line from `git-discipline.md`, re-run `node --test tests/git-discipline-merge-state-conformance.test.js` and confirm it fails on the invocation pin, then restore the line with the Edit tool and confirm green again. Never `git stash`/`git checkout` for this.

- [ ] **Step 6: Commit**

```bash
git add plugin/skills/_shared/git-discipline.md plugin/skills/_shared/pr-early-run-lifecycle.md tests/git-discipline-merge-state-conformance.test.js
git commit -m "Check the run PR's merge state at every phase-exit push — auto mode catches the branch up, refs #2986"
```

## Spec coverage map

| Spec item | Task |
|---|---|
| Deliverable 1 (read via resolvePrStateByNumber after each push, best-effort, fail-open) | Task 1 (CLI), Task 2 (where it runs) |
| Deliverable 2 (state it + one AUTO entry naming PR and phase) | Task 1 (entry), Task 2 (phase output line) |
| Deliverable 3 (auto catch-up; interactive/hybrid surface, no stop) | Task 2 |
| Deliverable 4 (failure / UNKNOWN changes nothing) | Task 1 tests AC4.1, Task 2 bullets |
| AC1.1 | Task 1 `AC1.1`, Task 2 `AC1.1` pins |
| AC2.1 | Task 2 `AC2.1` pins (second half waived — forge behavior) |
| AC3.1 | Task 1 `AC3.1`, Task 2 `AC3.1` pin |
| AC4.1 | Task 1 `AC4.1` ×2, Task 2 `AC4.1` pin |

## Build deviations (Common Step 4.5, Beneficial — applied)

1. `not-open` state: a PR whose `state` is not `OPEN` is no signal (a CLOSED PR can still report `DIRTY`; acting on it would merge and push to a dead branch). Final review #5.
2. Unresolvable auto catch-up: spec D3 says resolve per the merge-conflict procedure, whose fallback asks the user; in `auto` that is a forbidden mid-flow stop, so an unresolvable conflict is aborted (`merge --abort`), logged, and left for the merge path. Task 2 review.
3. `unknown` writes a non-alarming `SKIP` degrade trace (spec D4 forbids alarming logs, not degrade traces) so "checked, clean" and "no signal" stay distinguishable. Final review #1.
4. The CLI is a standalone `bin/pr-merge-state.js` (sibling of `bin/pr-checks.js`), the spec's "small CLI" option, so `plugin/bin/hooks.js` and `docs/hooks.md` are untouched.
