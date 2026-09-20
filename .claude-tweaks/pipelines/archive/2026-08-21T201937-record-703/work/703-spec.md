---
record: 703
origin: capture
risk: medium
size: medium
ceremony: standard
grants: [build]
surface: backend
---
# 703: Worktree-isolation pin survives worktree removal, permanently blocking git context for the rest of the session

Surface: backend

## Current State

- Teardown gate: `bin/lib/hooks/pre-tool-use.js`'s `teardownTargets`/`checkTeardownGate` intercepts `ExitWorktree` (action: remove) and a narrow `git worktree remove` Bash shape, denying a raw Bash removal that targets the session's own live cwd (or an ancestor) and telling the caller to use `ExitWorktree` instead — but this is a PreToolUse decision only; nothing in this repo's hooks observes or reacts to what happens *after* a successful teardown.
- `ExitWorktree` and the underlying "worktree-isolation pin" that blocks git-dependent commands once a session is anchored to a worktree are native Claude Code CLI (harness) mechanisms — this plugin owns no code that sets or clears that pin (confirmed by grep: no hits for "isolation pin" anywhere in this repo outside this issue's own text). The plugin's only levers are PreToolUse (allow/deny/warn) and PostToolUse (log, or inject `additionalContext`) on tool calls it can see — it cannot mutate harness-internal pin state directly.
- `bin/lib/hooks/post-tool-use.js` already has precedent for exactly this shape of remediation: the "EnterWorktree staleness backstop" (around line 289) is a PostToolUse, warn-tier handler that reacts to a completed `EnterWorktree` call by injecting context rather than trying to change harness state.
- `skills/feedback/SKILL.md` Step 3 (`git remote get-url origin`) has no fallback when the session has no live git context — it throws, and per the observed incident this failure compounds with the underlying pin bug rather than degrading independently.

## Deliverables

- [ ] Task 0 (empirical premise check): reproduce/confirm which teardown path actually leaves the harness pin set after the worktree it points to no longer exists — (a) `ExitWorktree` with `action: remove` invoked correctly by the agent, (b) a raw Bash `git worktree remove` that hits the gate's own-cwd deny and is retried via `ExitWorktree` per the deny message, (c) a raw Bash `git worktree remove` targeting a *different* worktree than the session's own literal cwd (not caught by the own-cwd guard, which only checks the caller's own cwd) while the session was, in fact, pinned to that other path via an earlier `cd`/subshell. Confirm whether this repo's hooks even receive a distinguishable PostToolUse event for a successful removal in each case, since any fix must work through a tool call the hook layer can see.
- [ ] Add a PostToolUse handler in `bin/lib/hooks/post-tool-use.js` (reusing `bin/lib/hooks/pre-tool-use.js`'s existing `teardownTargets`/`toplevel` target-resolution helpers rather than reimplementing them) that fires on a successful `ExitWorktree` (`action: remove`) or the sanctioned own-cwd `git worktree remove` Bash call, and injects `additionalContext` instructing the agent to verify/re-anchor to `$RUN_ROOT` before issuing any further git-dependent command — the same warn-tier, inject-context pattern the EnterWorktree staleness backstop already establishes, since this repo's hooks cannot themselves clear a harness-native pin.
- [ ] Extend the teardown gate (or add an adjacent check) to deny — not just warn after the fact — a Bash `git worktree remove` that targets a worktree the session is pinned to via a path other than its literal `ctx.cwd` (the gap Task 0 identifies as case (c) above), if and only if Task 0 confirms that gap is real and reachable.
- [ ] Rework `skills/feedback/SKILL.md` Step 3's self-reference check to resolve the repo slug without requiring a live git context: prefer an already-known slug (e.g. read from the plugin's own `.claude-plugin/plugin.json` repository field, or `$RUN_ROOT`-recorded config) and pass it to `gh repo view --repo  --json nameWithOwner` instead of `git remote get-url origin`; fall back to the current `git remote get-url origin` only when no pre-known slug is available, so the check degrades to "skip with a logged assumption" rather than throwing when the pin bug (or any other broken git context) is in effect.

## Acceptance Criteria

1. A test (new or extended in `tests/bin-lib/hooks/` or `tests/teardown-gate.test.js`) simulating a successful `ExitWorktree`/`action: remove` PostToolUse event asserts the new handler's `additionalContext`/warn output fires, mirroring the existing EnterWorktree-staleness-backstop test pattern.
2. Task 0's findings are recorded in the PR/commit body, naming for each of the three initiator paths enumerated above whether it reproduces the persisted-pin failure — a case that's inconclusive or unreproducible from this repo's own hook-visible events is stated as such, not silently dropped.
3. If Task 0 confirms the case-(c) gap (a same-session `git worktree remove` targeting a pinned-but-not-`ctx.cwd` path) is real and reachable, the teardown gate denies it with a message pointing at `ExitWorktree`; if Task 0 finds it unreachable or already covered by the existing own-cwd guard, this AC is satisfied by that documented finding instead — no code change is required to close it in that case.
4. `skills/feedback/SKILL.md`'s Step 3, run with a mocked/broken git context (no `origin` remote resolvable, or `git remote get-url` erroring) but a known repo slug available, resolves via the `gh repo view --repo ` path and does not throw.
5. `npm test` (full suite) and `tests/hooks-gate-coverage.test.js` / `tests/teardown-gate.test.js` specifically still pass, with no regression to the existing own-cwd deny behavior for raw Bash `git worktree remove`.

## Technical Approach

This repo's hooks cannot clear a harness-native "worktree isolation pin" directly — PreToolUse can only allow/deny/warn a tool call before it runs, and PostToolUse can only log or inject `additionalContext` after one completes. The realistic remediation shape is therefore instructional (tell the agent, via `additionalContext`, to re-anchor) rather than structural (mutate harness state), following the precedent already in `bin/lib/hooks/post-tool-use.js`'s EnterWorktree staleness backstop (warn tier, reacts to a completed native-tool call). Reuse `pre-tool-use.js`'s `teardownTargets`/`toplevel` helpers for path resolution rather than re-deriving worktree-target detection in the PostToolUse module. The feedback Step 3 fix is independent and self-contained — a slug-resolution fallback with no dependency on the pin-clearing fix, and can land even if Task 0 finds the pin-clearing gap unreachable.

### Key Files

- `bin/lib/hooks/pre-tool-use.js` — existing teardown gate (`teardownTargets`, `checkTeardownGate`); read for target-resolution logic to reuse, and to add the case-(c) gap check if Task 0 confirms it's real.
- `bin/lib/hooks/post-tool-use.js` — add the new post-teardown `additionalContext` handler here, alongside the existing EnterWorktree staleness backstop it can pattern-match against.
- `skills/feedback/SKILL.md` — Step 3, self-reference check.
- `tests/teardown-gate.test.js`, `tests/hooks-gate-coverage.test.js` — extend with the new handler's coverage.

## Gotchas

- This repo's hooks do not own or control the harness's native worktree-isolation pin state — confirmed by grep, no plugin code sets or clears it. Any fix here is necessarily instructional (context injection to the agent), unless Task 0 turns up a structural lever this record doesn't yet know about.
- Related but distinct from #693 (immediate teardown cascade) and #644 (reconcile-side reap of a session's own cwd worktree) — coordinate on the is-this-my-cwd predicate rather than duplicating it; do not re-solve what those records already own.
- `ExitWorktree`'s real PreToolUse payload shape (`{action, discard_changes}`, no path field) was captured and pinned by spec #373's Task 0 — reuse that finding rather than re-verifying it from scratch.
- The observed incident (~250 blocked records for the rest of the session) is the evidence behind this fix direction — Task 0 exists because the *exact* reproduction path isn't yet confirmed, not because the fix direction itself is in doubt.

## Original request

Worktree-isolation pin survives worktree removal, permanently blocking git context for the rest of the session

**Related:** #693 -- a related but distinct downstream consequence: #693 covers the immediate teardown cascade, this covers the pin remaining live (and blocking all git-dependent work) for the rest of the session afterward. #644 -- reconcile-side reap of the calling session's own cwd worktree: same pin/teardown lifecycle family, coordinate the is-this-my-cwd predicate.

Context: After `git worktree remove` deleted the worktree a session was pinned to, the harness's worktree-isolation pin itself persisted -- every subsequent git-dependent command (including cd back to the shared checkout) was refused as "isolated in the worktree ...", which no longer existed, for the remaining ~250 records of the session.

Scope: Have teardown clear the pin as part of the same operation (emit an ExitWorktree/unpin and re-anchor to $RUN_ROOT immediately after a successful git worktree remove); guard against removing the session's own pinned worktree without an unpin in the same step. Separately, make /feedback's Step 3 self-reference check resolve the repo without a live git context (e.g. gh repo view --repo  from an already-known slug) so it degrades cleanly instead of failing twice.
