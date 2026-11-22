---
files:
  - plugin/bin/wait-for.js
  - plugin/bin/lib/wait-for/index.js
  - plugin/bin/lib/wait-for/marker.js
  - plugin/bin/lib/hooks/subagent-stop.js
  - docs/hooks.md
---

# Block on a Child Agent, a PR's CI, or a Process Instead of Polling With Sleep

**Persona:** An orchestrating agent: a dispatched subagent, or a context-handoff child, running a claude-tweaks pipeline step. It has launched async `Agent` children, pushed a pull request, or started a background process, and must keep its turn alive until one of them changes state. A Bash call longer than 180 s is moved to the background in this seat (`docs/reference/blocking-wait-probe.md`). The plugin maintainer reads the same output when debugging a stalled wait.
**Goal:** Wait for exactly the thing it is waiting on, a child's final stop, the PR's checks or a process exiting, with one bounded foreground call per wait, and learn which thing changed.
**Entry point:** `node "<plugin root>/bin/wait-for.js" agents --ids <a,b>` (or `ci --pr <n>`, `ci --run <id>`, `pid --pid <n>`) as a plain Bash call with no `timeout`.
**Success state:** Exit 0 with one JSON line naming what changed: `reported` ids, the classifier `state`, or `state: "gone"`. Or exit 3 with `bound: "call"` (call again, joining the same window) or `bound: "deadline"` (the wave's window ran out: judge it per the wait rule).

## Steps

### 1. Start the wait — `wait-for.js agents --ids <a,b>`
- **URL:** `node "<plugin root>/bin/wait-for.js" agents --ids a1b2,c3d4 --max-seconds 150`. Flags: `--max-seconds <n>` (default 100, at most 150), `--window-seconds <n>` (default 1200, at most 3600), `--session <id>` (default `CLAUDE_CODE_SESSION_ID`), `--help`.
- **Action:** Pass the `agentId`s from the async `Agent` launch results. The first call opens a per-session window. A later identical call, or one listing a subset of its ids, joins that window.
- **Should feel:** One command that holds the turn for up to 150 s with no `sleep` loop, and comes back early as soon as a child truly finishes.
- **Should understand:** A child counts as reported only on a final stop (`blocked` false, `pending` 0). A child that ended its turn with its own children still running is not reported. The `SubagentStop` hook writes these stops to `ct-agent-stops-{session}.jsonl` under the OS temp dir (`docs/hooks.md`, "SubagentStop stop marker"). The stop's `pending` is the marker's own count (#5706): a `<task-notification>` quoted in the child's own prompt, in a tool result or in a call the child wrote does not make it `null`, so a child whose instructions quote the wait rule is still reported when it finishes. Each final stop is returned to one call only, so a resumed child can be waited on again by the same id. When two overlapping calls see the same stop, each appends a claim-tagged `delivered` line, the first line for that stop wins, and the other call keeps waiting.
- **Red flags:** Exit 2 naming `CLAUDE_CODE_SESSION_ID` (no session id in the shell; pass `--session`). `stops: 0` at a bound in a session where children have already finished: the hook wrote nothing, so check the probe file and the hook's temp dir. A finished child that stays in `pending` until the deadline while its stops show `pending: null`: its transcript still holds an indeterminate shape. The known one is an `api-request-blob` line that echoes a prompt quoting `<task-notification>` with no `<task-id>`, which #5706 measured on about 4.6% of real final stops and left in place.

### 2. Read the result and decide — exit 0, 3 or 2
- **URL:** the one JSON line: `target`, `state`, `changed`, `elapsedSeconds`, `deadlineEpoch`, `window`, and `bound` on exit 3, plus `reported`/`pending`/`stops` for `agents`
- **Action:** Exit 0: act on `reported` and keep waiting on the ids still `pending`. Exit 3 with `bound: "call"`: repeat the call, which joins the same window and keeps the same `deadlineEpoch`. Exit 3 with `bound: "deadline"`: the window (20 minutes by default) is spent, so treat the remaining children per the wait rule. Exit 2: a malformed call or an unreadable marker file. Fix the call; never retry it in another form.
- **Should feel:** Mechanical. The exit code alone says whether to act, repeat or give up, and `window` counts how many windows of this target already ran out.
- **Should understand:** The caller passes no deadline back. The command keeps the window itself, so repeating the same call cannot reset the bound.
- **Red flags:** Exit 2 with `marker file <path> refused: not-owned` on stderr: another user created that session's stops or waits file in the shared temp dir, so it is refused rather than read or appended to. No other form of the call fixes this; remove the foreign file or wait for the OS to clear it. The same `reported` id returned twice for one stop (the delivered record regressed). A `deadlineEpoch` that changes between identical back-to-back calls (the window join regressed).

### 3. Wait on CI or a process — `ci --pr <n>`, `ci --run <id>`, `pid --pid <n>`
- **URL:** `wait-for.js ci --pr 5615`, `wait-for.js ci --run 123456789`, `wait-for.js pid --pid 4242`
- **Action:** `ci --pr` returns when the PR's checks leave `pending`, classified the way `pr-checks.js --pr` classifies them (`green`, `red`, `inherited-red`, `no-ci`). `ci --run` returns when the run's status is `completed`, with its `conclusion`. `pid` returns when the process is gone.
- **Should feel:** The same contract as `agents`: one line, exit 0, 3 or 2. CI polls every 30 s, and agents and pids every second.
- **Should understand:** Each CI read is a child process killed 20 s after the nearer bound, so a `ci` call lasts at most `--max-seconds` + 20 s (170 s at the cap). A read that fails on the first poll exits 2. A failed read after a good one counts as `pending` and increments `readFailures`. A verify run and a suite slot are not targets: `verify.js` waits on both itself.
- **Red flags:** `readFailures` climbing on every call (gh is failing; check `pr-checks.js --pr` directly). A `ci` call that runs past 170 s.

## Outcome

A keep-alive wait that took up to 60 twenty-second sleep calls per wave becomes a handful of bounded `wait-for.js` calls. The agent notices a finished child within a second instead of 20, and each call stays under the 180-second foreground ceiling the probe measured. The keep-alive rule in `_shared/subagent-dispatch-core.md` names it since #5604.

_Origin: record #5602 (Deliverables 3-6: the `SubagentStop` stop marker, `plugin/bin/lib/wait-for/marker.js`, `plugin/bin/wait-for.js`, docs), built 2026-11-16 after the probe-result Decision. Related: `measure-sleep-poll-waits-5602.md`, which measured the sleeps this command replaces. Updated by record #5706 (2026-11-16): the stop marker's own pending count, beside the unchanged #3015 gate count._
