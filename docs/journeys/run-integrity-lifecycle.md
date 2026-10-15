---
files:
  - plugin/bin/lib/hooks/skill-invocation.js
  - plugin/bin/lib/hooks/run-integrity.js
  - plugin/bin/lib/hooks/pre-tool-use.js
  - plugin/bin/lib/hooks/session-start.js
  - plugin/bin/lib/hooks/close-run-state.js
  - plugin/bin/lib/hooks/context.js
  - plugin/bin/hooks.js
  - plugin/bin/lib/hooks/post-tool-use.js
---

# Run-Integrity Lifecycle: Detect, Remediate, and Gate Bypassed Pipeline Closures

**Persona:** claude-tweaks maintainer or Claude session working a repo where a prior pipeline run shipped its work without ever closing its bookkeeping (the #364 shape: PR merged, `run-state.json` stuck `active`), or about to tear down a worktree a live run still owns.
**Goal:** The runtime itself surfaces shipped-but-unclosed runs at session start, names the remediation, and refuses a teardown that would destroy an open run's state — no manual `.claude-tweaks/pipelines/` spelunking.
**Entry point:** Starting any session in the repo (detection), or attempting `ExitWorktree` / `git worktree remove` (gate), or running `close-run` (warn).
**Success state:** A shipped-unclosed run is flagged with both remediations at SessionStart; a teardown of an assigned worktree is denied until `close-run` clears the assignment; a raw Bash `git worktree remove` targeting the session's own cwd (or an ancestor of it) is denied independent of any run assignment, with `ExitWorktree` as the unaffected remediation; a wrap-up-less close still succeeds but records `close-without-wrapup`.

## Steps

### 1. Work happens — the ledger writes itself
- **Action:** Run any pipeline (`/claude-tweaks:flow`, `/claude-tweaks:build`): every model-initiated Skill-tool call is appended to the owned run's `events.jsonl` as `{"skill": ..., "ts": ..., "type": "skill_invoked"}` by the PostToolUse hook.
- **Expect:** No visible output — log tier. Boundary (measured): user-typed slash commands and failed calls leave no event; subagent Skill calls do land, so a flow-driven wrap-up always registers. Since `#1410` there is a third boundary: the event never lands in a *sibling worktree's* run. A run dir provably bound to a different, still-live worktree than the session's own cwd is skipped when the runtime has to guess an owner, so the event is appended to this session's own run or to none at all — never to an unrelated concurrent run's `events.jsonl`. A run with no provable worktree binding is still guessed into exactly as before.

### 2. A bypassed closure is flagged — next SessionStart
- **Action:** Start a session in a repo whose newest non-terminal run's branch has actually merged (ancestry or squash/rebase patch-equivalence) while its ledger holds skill activity but no wrap-up event.
- **Expect:** The unfinished-runs block's line for that run reads "work appears shipped … no wrap-up recorded" and names both remediations: `/claude-tweaks:wrap-up`, or bookkeeping-only `node ".../bin/hooks.js" close-run --run "<dir>"`. A genuinely in-progress run's line is unchanged; every indeterminate answer (deleted branch, no worktree, pre-ledger run) stays quiet — fail-open by design. Since `#1463` the **ancestry** half of that evidence carries one extra condition: a branch is an ancestor of the integration branch trivially when it has simply never diverged, so a freshly created, zero-commit worktree produced byte-identical evidence to a genuinely fast-forward-merged branch and was flagged as shipped while its build was still starting. Ancestry now also requires at least one commit on the branch dated at or after the run directory's own `YYYY-MM-DDTHHMMSS` name prefix; without one the run stays "in progress". The squash/rebase (`git cherry`) half is unchanged — it already reports only commits the branch actually has. An unparseable run-dir name or an indeterminate git result resolves the same way every other field here does: quiet, in-progress.
- **Expect (torn-down worktree, since `#1672`):** the run's branch is normally read out of `git worktree list --porcelain`, so it went unresolvable — and the verdict went permanently quiet — the moment a finished run's worktree was torn down, which is that run's *normal* end state. Two artifacts outlive the worktree and are now tried in order when that read comes back empty: the `record-pr` stamp's own `branch` field in `run-state.json` (recorded at stamp time, while the worktree is still live — `hooks.js`'s `record-pr` verb), then a branch name parsed from `decisions.md`'s mandatory PR-early-lifecycle log lines. Whichever resolves must **exist as a local ref** before it counts; a stale stamp or a bad parse that names nothing (or names some unrelated merged branch) is discarded rather than believed, which is what keeps the added coverage from buying false "shipped" verdicts. Neither artifact resolving leaves the run `in-progress`, exactly as before. The live-worktree path is unchanged and still wins whenever it can answer.

### 3. Teardown while the run is open — denied with the path out
- **Action:** Attempt `ExitWorktree` (`action: "remove"`) or `git worktree remove <path>` targeting a worktree recorded by an `active`/`interrupted` run.
- **Expect:** Deny naming the run dir and `cleanup-procedures-execution.md` Section C. Non-destructive exits (`action: "keep"`), unassigned worktrees, and unparseable commands pass. A worktree owned by a *different* session's run allows with a warning and a `wd-foreign-teardown` event instead.

### 4. Close, then tear down — the sanctioned exit
- **Action:** Run `node ".../bin/hooks.js" close-run --run "<dir>"` (wrap-up's Section C step 3.6 does this for you), then retry the teardown.
- **Expect:** The removal now passes. If the run's ledger never recorded a wrap-up invocation, close-run still closes but prints an informational warning (expected for hand-typed wrap-ups) and appends `close-without-wrapup` as the run's final event — the audit trail of how the run ended. Exception (#2553): a run whose `run-state.json` already reads `status: clean` at this close (e.g. a second `close-run` reached while wrap-up is mid-archival) does not get this event — it is already closed, and re-emitting it would be a false terminal-state signal, not a new finding.

### 5. A second, independent deny — a raw `git worktree remove` on your own cwd
- **Action:** From inside a worktree, run a raw Bash `git worktree remove <that-worktree-path>` (never `ExitWorktree`) whose target is the session's own cwd, or a directory containing it — including via a `cd <elsewhere> && git worktree remove <own-cwd>` compound.
- **Expect:** Denied, naming `ExitWorktree` as the sanctioned remediation. This own-cwd guard fires independent of any pipeline-run assignment: unlike Step 3's deny, Step 4's `close-run` does NOT lift it — `close-run` only clears the run-assignment deny, and deleting the shell's own live working directory is the failure regardless of whether a run owns it. The `cd` in the compound form does not launder the target; it is still denied. The same raw `git worktree remove` targeting a *different* worktree from elsewhere (e.g. the main checkout) is unaffected and allowed, and `ExitWorktree` removing the session's own cwd is unaffected by this guard — it remains the one sanctioned way to do exactly that.

### 6. After an allowed teardown — a re-anchor reminder, not a deny
- **Action:** After any of Steps 3-5's *allowed* teardown paths actually completes (`ExitWorktree` `action: "remove"`, or the sanctioned own-cwd Bash `git worktree remove`).
- **Expect:** A warn-tier `systemMessage` names the removed worktree path and instructs re-anchoring to the main checkout (`cd {path}`, or a generic pointer when the root can't be resolved) before any further git-dependent command — because this repo's hooks cannot themselves clear the harness's native worktree-isolation pin, which can otherwise outlive the worktree it pointed to and refuse subsequent commands as still "isolated" (#703).

## Origin
- Updated during build of #703 — a post-teardown re-anchor backstop (warn tier) now fires on every allowed teardown path Steps 3/5 already document; Step 6 added.
