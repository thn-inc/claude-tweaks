---
files:
  - plugin/bin/lib/hooks/pre-tool-use.js
  - plugin/hooks/hooks.json
  - plugin/bin/console-resolve.js
  - plugin/skills/wrap-up/review-console.md
  - plugin/skills/wrap-up/review-console-interactive.md
  - plugin/skills/flow/multispec-review-console.md
  - tests/hooks-pre-tool-use.test.js
  - tests/review-console-header-conformance.test.js
---

# Follow a Review Console Ask Deny

**Persona:** the agent session running `/claude-tweaks:wrap-up` (or `/claude-tweaks:flow`'s multi-spec console) at `autonomy: unattended`, which reaches for `AskUserQuestion` with `header: "Review Console"` instead of running the auto-resolution short-circuit. Secondary persona: the operator who later reads the run's friction events to see that the gate fired.
**Goal:** when the model asks a Review Console question it was never supposed to ask, the ask is refused before it reaches a human, and the model resolves the console the way the skill already says to, in the same turn. The run does not park for hours on a question nobody is watching for (IL-167).
**Entry point:** an `AskUserQuestion` call whose `questions` include one with `header: "Review Console"`, issued by a session whose own run (`ctx.ownedRun`, session- or env-attributed, not an ad-hoc twin, and classified `mine` by `classifyOwnership`) resolves the `unattended` ceiling, so `consoleAutoResolve` is granted.
**Success state:** the tool call is denied with a reason naming `console-resolve.js` and the right console file; the model runs the CLI, executes its resolutions, and the run ends in a merged PR or a `pending-review` report, with no question asked. `{run-dir}/events.jsonl` holds one `gate-denial` event with `gate: "review-console-ask"`.

## Steps

### 1. Ask the console question by mistake
- **URL:** `AskUserQuestion` with `header: "Review Console"`, the header both `wrap-up/review-console-interactive.md` and `flow/multispec-review-console.md` prescribe
- **Action:** the model skips the short-circuit and presents the console as if a human were present.
- **Should feel:** invisible on every run where asking is correct. At `supervised` or `trusted`, with no owned run, from an ad-hoc run dir, or when the ceiling cannot be read, the ask goes through unchanged.
- **Should understand:** the gate keys on the literal header, so the header in the two skill files is pinned to `REVIEW_CONSOLE_HEADER` by `tests/review-console-header-conformance.test.js`. A console question asked under a different header is not caught, which is why that pin exists. Whether a human is present does not matter: under `unattended` the console never asks.
- **Red flags:**
  - a deny at `supervised` or `trusted`;
  - a deny for an unrelated `AskUserQuestion` (any other header);
  - a deny when the ceiling read failed (a git error, an unreadable policy) — those fail open.

### 2. Read the deny reason
- **URL:** the tool call's `permissionDecisionReason`, starting `claude-tweaks: this run's autonomy ceiling is unattended, which grants consoleAutoResolve`
- **Action:** read which console file to follow and the exact `console-resolve.js` command.
- **Should feel:** redirected, not stonewalled. The reason names the section to follow and the command to run.
- **Should understand:** the reason depends on run shape. A run dir with `manifest.yml` is a multi-spec parent, so the reason points at `flow/multispec-review-console.md` and asks for one CLI call per `spec-{N}/` and then one over the parent. Any other run points at `wrap-up/review-console.md` and a single call. Both say to append `--dry-run` on a dry-run wrap-up.
- **Red flags:** retrying the same `AskUserQuestion` with a reworded header to get past the gate; reporting BLOCKED instead of running the command.

### 3. Run the resolver and act on its exit code
- **URL:** `node "${CLAUDE_PLUGIN_ROOT}/bin/console-resolve.js" --run "<run-dir>" --policy console-auto`
- **Action:** run it as the reason directs, then execute every returned resolution and the merge half, per `resolve-the-unattended-console-in-one-process-1932.md`.
- **Should feel:** like resuming at the step that was skipped.
- **Should understand:** the CLI re-checks the ceiling itself, using the same resolution the hook used (`tests/hooks-pre-tool-use.test.js`'s readPolicy parity case pins the two). Exits `4` and `5` route to that section's non-zero-exit rules. Exit `5` never asks, human present or not: a console already rendered on the PR and waiting for a human follows `_shared/console-on-pr.md`'s Headless conclusion (report `pending-review` with the PR URL), and a `console.json` that will not parse stops and reports the CLI's stderr. The deny reason states both branches.
- **Red flags:** an `AskUserQuestion` issued after exit `5`; the merge computed but never executed on a record carrying `auto:merge`.

### 4. Find the gate in the run's friction record
- **URL:** `{run-dir}/events.jsonl`
- **Action:** at wrap-up or afterwards, read the friction events.
- **Should feel:** traceable. The model's slip is recorded even though the run recovered from it.
- **Should understand:** the event type is `gate-denial`, which the friction lens and the timing tool already read, with `gate: "review-console-ask"` and the ceiling.
- **Red flags:** a denied ask with no `gate-denial` event in the owned run's `events.jsonl`.

## Known limit

When the session's cwd is the main checkout while its worktree is live, or the worktree has been removed, `ctx.ownedRun` can resolve to the session's ad-hoc twin (#2783) or classify `indeterminate`, and the gate allows the ask. The skill prose remains the only guard on that path. Whether the harness honours a PreToolUse deny for `AskUserQuestion` has not been probed live; the first real unattended console after release is that probe.

## Origin
- Created during build of #3712: `pre-tool-use.js`'s `checkReviewConsoleAskGate`, registered on a new `PreToolUse` `AskUserQuestion` matcher in `plugin/hooks/hooks.json`. The record found the real cause of the stall #2734 was filed for: an `unattended` session read the console prose and asked anyway (IL-167). The whole-branch review hardened the event type, the run-shape-aware reason, and the git-failure fail-open.
