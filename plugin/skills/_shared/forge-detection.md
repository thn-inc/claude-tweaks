# Forge Detection Ladder (fail-open)

Canonical home of the three-check GitHub reachability gate, extracted out of `_shared/github-pr-scan.md` (which owns the PR/issue scan scopes that build on top of it). A consumer that needs only these three booleans — `/claude-tweaks:dispatch` Preflight chief among them — never has to load that file's full 39 KB to get them.

Run these checks in order before any scan or `gh`/MCP call. On the first failure, emit the single info row shown and stop — a skipped GitHub scan is normal, never a `BLOCKED` status, never a hard gate.

| # | Check | Command | On failure, emit Finding / Evidence |
|---|-------|---------|-------------------------------------|
| 1 | GitHub remote exists | `git -C "{REPO_ROOT}" remote get-url origin` exits 0 (any host — no longer string-matched against `github.com`, which false-negated on GitHub Enterprise hosts like `github.mycompany.com`) | `GitHub scan skipped` / `no GitHub remote` |
| 2 | gh CLI installed | `command -v gh` exits 0 | `GitHub scan skipped` / `gh CLI not installed` |
| 3 | gh authenticated + repo reachable | `gh repo view --json owner,name` exits 0 (resolves the host from the remote automatically — works identically for github.com and GitHub Enterprise once authenticated for that host; replaces the old bare `gh auth status` check) | `GitHub scan skipped` / `gh not authenticated or repo unreachable` |

The skip row uses severity `info` and Path:Line `(github)`.

Individual `gh` command failures mid-scan degrade to a `DONE_WITH_CONCERNS` status line with whatever partial results exist — never `BLOCKED`. Recognize and classify a rate-limit failure per `_shared/github-rate-limit.md`; network and other transient API errors degrade the same way without needing that classification.

`{REPO_ROOT}` resolves via `git rev-parse --show-toplevel` in the dispatcher before the agent fires (see Working Directory Discipline in `_shared/subagent-dispatch-core.md`).

**Check 2 does not gate on its own for a transport-aware consumer.** `gh` present → proceed via the `gh` CLI. `gh` absent → a consumer with a documented MCP fallback (e.g. `/claude-tweaks:dispatch`'s `dispatch/mcp-transport.md`, `/claude-tweaks:backlog`'s `backlog/mcp-transport.md`) proceeds via that path instead of stopping; a consumer with no MCP fallback still stops at check 2. Checks 1 and 3 stay hard gates on either transport — there is no meaningful degraded mode for a skill whose job is reading or writing GitHub state.

**Code twin.** `bin/lib/policy-schema.js`'s `detectIntegrationModel` replicates checks 1 and 3 of this ladder in code (`integration-model`'s computed default — see `_shared/integration-model.md`) — a resolution difference between the two is a bug in one of them, not an intentional divergence. The one sanctioned exception: a caller-supplied `mcpReachable: true` short-circuits past check 3 (the `gh repo view` probe) when a remote exists. That is still not "a resolution difference being a bug" — it's an explicit, caller-authorized signal standing in for the probe, not an independent computation drifting from the ladder.

**Dispatcher-inlining note (IL-82).** For a parallel Task-agent dispatch site (`/claude-tweaks:help`'s scan agents, `/claude-tweaks:tidy`'s `scan-procedures.md`), inline this whole file into the agent's prompt — subagents cannot read sibling files. This file's small size is the point: a dispatch site inlining only these three checks previously had to load all of `_shared/github-pr-scan.md` to extract them.
