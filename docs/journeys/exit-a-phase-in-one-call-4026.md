---
files:
  - plugin/bin/phase-exit.js
  - plugin/bin/lib/phase-exit/phase-exit.js
  - plugin/bin/lib/log-decision/append.js
  - plugin/bin/log-decision.js
  - plugin/skills/_shared/git-discipline.md
  - plugin/skills/_shared/auto-decision-log.md
---

# Exit a Phase in One Call

**Persona:** the orchestrating agent of a `/claude-tweaks:flow` run in a worktree, at the end of its build phase with every task committed. Its context is a few hundred thousand tokens deep, so each extra tool call costs several seconds. Before #4026 it ran a separate command for each of the following at every phase exit: record-worktree, record-pr, the push, the checklist flip, and the merge-state read, then a `log-decision.js` call to narrate each result. Later in the journey a **maintainer** reads the run's `decisions.md` and PR to check what happened.
**Goal:** finish the phase with one tool call that pushes, flips the PR checklist row, backfills any missing bookkeeping, reads the PR's merge state and logs every line those steps owe. The agent only has to route the JSON the call returns.
**Entry point:** `_shared/git-discipline.md`'s Phase exit section, reached from `build/SKILL.md` Common Step 7 or any later phase's exit, with `$PIPELINE_RUN_DIR` set.
**Success state:** the branch is on origin, the phase's `- [x] {phase}` row is checked, `decisions.md` holds the same entries the old multi-call sequence wrote, and the agent moved on after reading one envelope.

## Steps

### 1. One command does the whole exit
- **URL:** `node "${CLAUDE_PLUGIN_ROOT}/bin/phase-exit.js" --run "$PIPELINE_RUN_DIR" --phase build --worktree "{worktree-path}" --fixes {n}`
- **Action:** The agent runs the command as its own Bash call. The CLI resolves the route (`pr-first`, `local-merge` or `current-branch`), checks that the branch is a run branch and the tree is committed, and backfills a missing `worktree` or `pr` stamp. It then applies the [IL-131] PR precondition, pushes with `git -C`, writes the events.jsonl push breadcrumb, flips the checklist through `pr-checklist.js`, reads `pr-merge-state.js`, and prints one JSON line.
- **Should feel:** Like closing a drawer. Nothing to compose, and nothing to remember to log afterwards.
- **Should understand:** Exit 0 means the call worked, whatever each sub-step reported; each sub-step's outcome is data in the envelope. Exit 2 (bad flags, a `--worktree` that is not a checkout) and exit 3 (a `--run` not anchored under the main checkout) are bad calls to fix and re-run.
- **Red flags:** A second `log-decision.js` call for an entry the CLI already wrote. The command chained onto another with `&&`.

### 2. Route the envelope, not the steps
- **URL:** `_shared/git-discipline.md`'s Phase exit section, the envelope routing list
- **Action:** The agent reads `push.state`. If it is `pushed`, it routes `mergeState` per the Post-push merge-state check. If it is `skipped` with no recorded PR, it opens the draft PR and re-runs the CLI. If it is `failed` or `refused`, it continues: the CLI already logged it, and the next phase exit retries. A `logFailures` element is hand-logged with `log-decision.js`.
- **Should feel:** Mechanical. Each state has one route, and every call site cites the same list.
- **Should understand:** A push from the wrong worktree is refused (`--worktree … is not the run's worktree …`) and leaves a `wd-push-mismatch` event the Review Console shows. A push killed by the 10-minute push timeout (`CLAUDE_TWEAKS_GIT_PUSH_TIMEOUT_MS`) says `timed out after {n} ms`.
- **Red flags:** A refused push "fixed" by pushing by hand from another directory. A `failed` push treated as a hard stop.

### 3. A closed run is left closed
- **URL:** `phase-exit.js --phase wrap-up --run "{archive path}"`
- **Action:** At wrap-up's exit, after cleanup item 8's `close-run`, the agent passes the archive path (or the live path, if `archive-run` refused). The CLI sees a closed run (`status: clean`, a `worktreeAtClose`, or the archive path), reports `bookkeeping` as `n/a`, and calls no hook. It still pushes, flips the row and reads the merge state.
- **Should feel:** Safe. Exiting the last phase cannot re-arm a run that cleanup already closed.
- **Should understand:** No push breadcrumb is written into a closed run. Timing's merge start comes from the console's own push.
- **Red flags:** `run-state.json` showing `status: active` again after a wrap-up exit. A later `archive-run` refusing the run as non-terminal.

### 4. Batch the model-judged lines
- **URL:** `node "${CLAUDE_PLUGIN_ROOT}/bin/log-decision.js" --run "$PIPELINE_RUN_DIR" --entries "{entries.json}"`
- **Action:** For decisions only the model can make, the agent writes the entries to one JSON array file and appends them all in one call. The CLI checks every element before writing anything, then appends them under one lock.
- **Should feel:** Cheap. Ten judged lines cost one tool call.
- **Should understand:** A malformed element rejects the whole batch with nothing written. Unknown keys and multi-line step names are rejected. The bytes are the same as ten single calls.
- **Red flags:** A partly written batch. A batch that loses entries because the session ended before the phase end flushed them (the open follow-up in the run's ledger).

### 5. The maintainer reads an unchanged trail
- **URL:** the run's `decisions.md`; the PR's `### Phases` section
- **Action:** **Maintainer** compares this run's `decisions.md` with an older run's. On the clean path the entries are the same (AC3.1's fixture pins this); the timestamps differ.
- **Should feel:** Trustworthy. Fewer turns, the same record.
- **Should understand:** Non-clean paths carry extra degrade-trace lines by design (the IL-131 skip, a refused branch, a dirty tree, the Manifesto levers path). Six classes of entry stay with the calling skill (`_shared/auto-decision-log.md`).
- **Red flags:** A clean-path entry missing that the old sequence wrote. The same entry written twice, once by the CLI and once by hand.

## Origin
- Created during `/claude-tweaks:build` of record #4026 (2026-10-25). `plugin/bin/phase-exit.js` replaces the per-step phase-exit prose at six call sites, and ten bin CLIs now log their own `decisions.md` entries.
- Related: `docs/journeys/flip-a-pr-checklist-row-at-a-phase-exit-3263.md` (the checklist flip this call runs), `docs/journeys/notice-a-run-pr-gone-conflicting-at-phase-exit-2986.md` (the merge-state read it carries), `docs/journeys/recover-from-a-bookkeeping-stamp-deny.md` (the [IL-131] gate it mirrors)
