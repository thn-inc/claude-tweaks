# Init worktree-always Finalization — the deferred policy write

Loaded by `/claude-tweaks:init` when Step 6 (`bootstrap/step-06-worktree-configuration.md`) queued
a `worktree-always` decision, or Step 6.5 (`bootstrap/step-06-5-port-isolation.md`) queued a
`port-services` decision, or Step 21 (`bootstrap/step-21-release.md`) queued the `release-*` rows,
and this invocation is about to end. One lazy-load unit: the write(s),
plus both places they can happen — the normal Phase 9 path, and every path that exits before
Phase 9 ever runs. `port-services` rides the exact same deferral mechanism as `worktree-always` —
Step 6.5 queues it for the same reason Step 6 queues `worktree-always`: a `worktree-always: true`
write mid-run would deny this same run's own remaining direct-to-main-checkout writes (#1794).
Cited by `SKILL.md`'s Phase 0 stub (Finalizing the worktree-always Decision) and
its Phase 9 stub (Worktree Policy Finalization); both need this whole file. Section names in the
body below (Input, Actions Performed, Step 6, Step 17) name sections of `SKILL.md`; "below" and
"above" between the two halves resolve within this file.

## Every exit path (the rule)

If Step 6 (`bootstrap/step-06-worktree-configuration.md`) queued a `worktree-always` decision, and/or Step 6.5 (`bootstrap/step-06-5-port-isolation.md`) queued a `port-services` decision, and/or Step 21 (`bootstrap/step-21-release.md`) queued the two commented `release-hook` / `release-train` rows, each must be written to `.claude-tweaks/policy.yml` exactly once, as the very last filesystem action before this `/init` invocation ends — for whatever reason it ends. Phase 9's "Worktree Policy Finalization" (below) is the normal place this happens: per "Input" above, every scope reaches Phase 9 except `bootstrap`, including the goal-based Phase scopes (`config`/`skills`/`journeys`/`docs`) even though none of them list Phase 9 in their own phase subset. The known early-exit paths that stop the invocation before Phase 9 ever runs are: `$ARGUMENTS` was `bootstrap` (stops after Phase 0); the Scope Selection Gate's Option 4 ("Done"); or Option 2 (Interactive)'s own per-phase gate, if the user selects "Done" ("Stop here") after any phase. These are the known cases, not necessarily an exhaustive list of every way this invocation could ever end — whatever the actual reason this invocation is ending, write whichever decision(s) are queued right there, immediately before it ends, via the isolated-worktree write procedure below (§ "How the write itself happens") — never a direct `Edit` against the main checkout's `.claude-tweaks/policy.yml`. If the `worktree-always` decision was "Yes," tell the user: "`worktree-always` is now enforced — your next edit requires an isolated worktree; run `/superpowers:using-git-worktrees` first." If `port-services` was queued, tell the user the block Step 6.5's `allocate` call echoed. If Step 21's rows were queued, no message is needed — they are commented-out defaults.

If this invocation instead reaches Phase 9, the decision(s) are finalized there — see "Worktree Policy Finalization."

## The Phase 9 path (Worktree Policy Finalization)

Write this AFTER every write in the Actions Performed table above has completed — it must be the very last filesystem action of the entire `/init` invocation. If Step 6 queued a `worktree-always` decision and/or Step 6.5 queued a `port-services` decision and/or Step 21 queued the `release-*` rows, write whichever are queued now, bundled into the same worktree/commit/merge as this same Phase 9's own confirmed generated-file writes (the Actions Performed table above) — see "Isolated Write Step" in `SKILL.md`'s Phase 9 for that mechanism. It is still deferred to this point in the run for the same reason as before: this run's own Steps 7-17, Phases 1-8.5, and Phase 9's writes must never be blocked by a policy that turned on mid-run — but under the isolated-worktree mechanism, only Steps 7-17's *direct-to-main-checkout* writes are actually at risk; Phase 9's own writes were never at risk in the first place, since they isolate themselves in a worktree unconditionally regardless of what this policy says. (The `bootstrap`-only scope already wrote its queued decision(s) immediately after Step 17 — the last Optional Companion step Phase 0 runs through — see "Finalizing the worktree-always Decision" after Phase 0 — so there is nothing to do here for that scope.)

## How the write itself happens

Wherever in the run this write lands — bundled into Phase 9's batch, or standalone at one of the early-exit paths above — it is made via the same isolated-worktree procedure Phase 9 uses for its own writes, never a direct `Edit` against the main checkout: `_shared/scratch-worktree.md`'s provisioning (native `EnterWorktree` or git-fallback `.worktrees/`) and `_shared/worktree-setup.md`'s post-creation catch-up, requiring the valid HEAD Step 5 (`bootstrap/step-05-verify-git.md`) already guarantees. When this write is standalone (not bundled into Phase 9's batch), it still gets the full cycle for itself alone — worktree, the queued line(s) written, one commit, ff-only merge back into whatever branch was checked out when the invocation started, teardown — there is no lighter-weight path just because it's one line.

Inside the worktree: create `.claude-tweaks/` if it doesn't exist. Read `.claude-tweaks/policy.yml` if present.

- **`worktree-always`** (if queued): if the file has an existing `worktree-always:` line, replace that line; otherwise, if it has an existing pre-#602 `worktree.always:` line, replace that line in place with the new-spelling `worktree-always: {true|false}` line (migrate, never append a second key beside it — a second key beside the old one would silently make the new line win under the alias rule, leaving the stale old line to confuse the next reader); otherwise append a new `worktree-always: {true|false}` line.
- **`port-services`** (if queued): if the file has an existing `port-services:` line, replace it with the new comma-joined service list; otherwise append a new `port-services: {a,b,c}` line. Once this line lands, run the first `node "${CLAUDE_PLUGIN_ROOT}/bin/ports.js" allocate --services {a,b,c}` inside the worktree, same as Step 6.5 itself does, so the checkout's `.env.local` carries the managed region from the moment the policy takes effect rather than waiting for the next `SessionStart` firing.
- **`release-hook` / `release-train`** (if queued): append each line exactly as Step 21 rendered it (`# release-hook: …`, `# release-train: false`); skip a line whose key already appears in the file, commented or not — never rewrite an existing value, never uncomment. No follow-up command runs for these rows.

Preserve every other line in the file untouched. Commit that one change (both queued lines land in the same commit when both are queued — still one commit, one merge), then land it exactly as "Isolated Write Step" describes — ff-only merge into the checked-out branch, never pushed to `origin`.

If the `worktree-always` decision was "Yes," tell the user the same confirmation message quoted in "Finalizing the worktree-always Decision" above. If `port-services` was queued, tell the user the leased block.
