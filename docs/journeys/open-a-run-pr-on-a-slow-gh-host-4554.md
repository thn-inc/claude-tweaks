---
files:
  - plugin/bin/lib/repo-resolve.js
  - plugin/bin/pr-early-open.js
  - plugin/bin/lib/shared-primitives.js
---

# Open a Run's Draft PR on a Slow gh Host

**Persona:** Maintainer running a `pr-first` claude-tweaks pipeline against a GitHub Enterprise host where a single `gh` call can take ~18 s, with `gh` installed and authenticated. In #4554's report the first `pr-early-open.js` call exited 2 ("gh is not available") and was routed to the MCP path, and retries exited 1 with a bare `spawnSync gh ETIMEDOUT`.
**Goal:** A slow `gh` reads as slow, not missing, and the error names the knob that fixes it.
**Entry point:** `/claude-tweaks:build` (or `/claude-tweaks:flow`) Spec Step 1 runs `node bin/pr-early-open.js --run … --target "#N" --fixes N --title … --summary-file …` with `GH_HOST` set and no `CLAUDE_TWEAKS_GH_TIMEOUT_MS`.
**Success state:** The run stays on the `gh` path. If `gh` is too slow for the bound, the CLI exits 1 with a line naming the timeout in ms, the `gh-timeout-ms` policy key and the `CLAUDE_TWEAKS_GH_TIMEOUT_MS` env var; one override later, the draft PR opens. The maintainer should feel told exactly what to change, not misdirected.

## Steps

### 1. The availability probe times out — `plugin/bin/lib/repo-resolve.js` `ghAvailable`
- **URL:** —
- **Action:** `gh --version` exceeds `GH_TIMEOUT_MS` (5000 ms by default) on a cold start. `ghAvailable` sees a timeout-shaped error (`ETIMEDOUT`, `killed`, or `SIGTERM`, via `isTimeoutError`) and returns `true`.
- **Should feel:** Nothing visible: the run does not swerve to the MCP fallback for a tool that is installed.
- **Should understand:** A timed-out probe proves the binary spawned. Only a timeout reads as present; `ENOENT` (not installed) and a non-zero exit (a broken install) still read as absent, exit 2, MCP path. The same probe backs ~20 `plugin/bin` CLIs, so all of them stop misrouting a slow `gh`.
- **Red flags:** `pr-early-open.js: gh is not available — open the draft PR through mcp__github__create_pull_request` on a machine where `gh --version` works.

### 2. A real gh call times out — `plugin/bin/pr-early-open.js` outer `catch`
- **URL:** —
- **Action:** `gh repo view` (or a later `gh` call that reaches the outer catch) is killed at the bound. The CLI exits 1 and prints the error plus `gh timed out after {ms} ms — override via the gh-timeout-ms policy key or the CLAUDE_TWEAKS_GH_TIMEOUT_MS env var (max 60000)`.
- **Should feel:** Actionable: the fix is in the message, no source reading needed.
- **Should understand:** Exit 1 still routes the caller to "finish by hand", as before. The hint fires only for a `gh` call; a `git` call that times out on the same path keeps its own bare error, since it has different knobs (`CLAUDE_TWEAKS_GIT_TIMEOUT_MS`).
- **Red flags:** A bare `spawnSync gh ETIMEDOUT` with no hint; the gh hint printed for a git timeout.

### 3. Raise the bound and re-run
- **URL:** `https://{ghe-host}/{owner}/{repo}/pull/{pr}`
- **Action:** Set `CLAUDE_TWEAKS_GH_TIMEOUT_MS=60000` for the session (or `gh-timeout-ms: 60000` in `.claude-tweaks/policy.yml`) and re-run the same command. It prints `{"outcome":"opened",…}`.
- **Should feel:** One change, one retry, done.
- **Should understand:** The policy key is bounded 1000-60000; the env var wins over it.
- **Red flags:** Still timing out at 60000 ms — the host itself is down, not merely slow.

## Origin
- Created during build of #4554 (pr-early-open: a gh timeout is reported as "gh is not available" and routed to the MCP path)
- Steps 1-2 built in this session; step 3 is the existing override path, now named in the error
- Related: `resume-a-run-on-a-pr-an-earlier-run-opened-4580.md` (the same CLI's PR-reuse path)
