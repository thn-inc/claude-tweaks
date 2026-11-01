---
files:
  - plugin/bin/lib/policy-schema.js
  - plugin/bin/lib/policy-derived-defaults.js
  - plugin/bin/resolve-policy.js
  - plugin/bin/lib/flow/manifesto-write.js
  - plugin/bin/lib/hooks/pre-tool-use.js
  - plugin/bin/lib/pr-bookkeeping/precondition.js
  - plugin/bin/lib/phase-exit/phase-exit.js
---

# Resolve the Integration Model on a Slow gh Host

**Persona:** A maintainer running `/claude-tweaks:flow #A,#B,#C` against a GitHub Enterprise origin. On this host one `gh` call routinely takes 4–14 s. `.claude-tweaks/policy.yml` sets `gh-timeout-ms: 20000` and pins no `integration-model:`. Before #4578, two reads in one run came back `local-merge` and then `pr-first`, and the bookkeeping-stamps gate denied a write until the run was fixed by hand.
**Goal:** Forge detection gives the same answer every time it is read. When it cannot decide, it says so instead of quietly picking `local-merge`.
**Entry point:** The Manifesto's `node bin/resolve-policy.js --run "$PIPELINE_RUN_DIR" --values … integration-model …` read at `/claude-tweaks:flow` Step 3, or a direct `node bin/resolve-policy.js integration-model`.
**Success state:** With the timeout raised, detection waits long enough and answers `pr-first`. If `gh` stays too slow even after one retry, the maintainer sees one `resolve-policy: degraded — integration-model: …` line naming the timeout and the two fixes. The run is never pinned to a guess. The maintainer should feel warned, not misled.

## Steps

### 1. Detection honours gh-timeout-ms — `plugin/bin/lib/policy-schema.js` `detectIntegrationModel`
- **URL:** —
- **Action:** `resolve-policy.js integration-model` runs `gh repo view` bounded by the repo's own timeout ladder. The order is an explicit `opts.timeoutMs`, then `CLAUDE_TWEAKS_GH_TIMEOUT_MS`, then `gh-timeout-ms` from `{repoRoot}/.claude-tweaks/policy.yml`, then 5000. An 8 s answer resolves `pr-first`.
- **Should feel:** Nothing visible. The slow host just works once the timeout is set.
- **Should understand:** The ladder reads the repo being detected, not `process.cwd()`. The `git remote get-url origin` probe keeps its own short 5 s bound.
- **Red flags:** `local-merge` comes back after about 5 s even though `gh-timeout-ms: 20000` is set.

### 2. A timeout is retried once, then reported as degraded — `resolve-policy.js` stderr and JSON
- **URL:** —
- **Action:** The first `gh` attempt times out (`ETIMEDOUT` or killed by a signal), so detection retries once with the same bound. If the retry fails too, the value stays `local-merge`. `policy-derived-defaults.js` carries the reason into the result, so the JSON entry gains `degraded: "timeout"` (or `"timeout-then-exit"`), and stderr gets one line per key: `resolve-policy: degraded — integration-model: forge detection timed out after 20000 ms (x2); resolved local-merge — pin integration-model in .claude-tweaks/policy.yml or raise gh-timeout-ms`. With `--values`, stdout still prints only `local-merge`.
- **Should feel:** Honest. The answer is labelled a guess, and the fix is in the message.
- **Should understand:** A definitive result is never retried or reported: `gh` absent (`ENOENT`) or an immediate non-zero exit is a real `local-merge` with no degrade line. A `merge-verification` request that runs its own detection reports the same texts, but a valid `integration-model` pin in the run's `--run` `config.yml` wins first, so a pinned run makes no `gh` call.
- **Red flags:** A degrade line for a missing `gh`. Two lines when a key is requested twice. A `degraded` field leaking into `--values` stdout.

### 3. The Manifesto refuses to pin a guess — `plugin/bin/lib/flow/manifesto-write.js`
- **URL:** —
- **Action:** At `/claude-tweaks:flow` Step 3, a degraded `integration-model` read writes no `integration-model:` pin to the run's `config.yml` and logs a `SKIP` naming the degrade. A `merge-verification` lever derived from that degraded detection is written as `wait` (source `degraded`), not `off`.
- **Should feel:** Safe. A shaky first read cannot lock the run into the wrong integration model.
- **Should understand:** A clean `local-merge` detection is still pinned as before; only a degraded one is held back. Later reads detect again, so a host that recovers mid-run gets the right answer.
- **Red flags:** `config.yml` holding `integration-model: local-merge` after a stderr degrade line.

### 4. Hooks and gates stay bounded and do not cache the guess — `pre-tool-use.js`, `precondition.js`, `phase-exit.js`
- **URL:** —
- **Action:** The PreToolUse PR-stamp gate's fallback detection passes `HOOK_FORGE_PROBE_TIMEOUT_MS` (5000 ms per attempt). That gives a worst case of 15 s with the retry and the git probe, whatever `gh-timeout-ms` says. A degraded result never caches `prExempt`. SessionStart's reconcile gets the same bound. `/claude-tweaks:test` Step 0's `check-pr-bookkeeping.js` returns `degraded-detection` (logged as a `SKIP`), never `not-pr-first`. `phase-exit.js` treats a degraded read as unresolved.
- **Should feel:** The session never hangs on a hook for a minute, and no gate passes silently on a guess.
- **Should understand:** While `gh` stays hung, an unpinned degraded run probes at most once per `FORGE_DEGRADE_MEMO_TTL_MS` (60 s) per run. Covered calls inside that window skip the probe and allow the call without a `prExempt` stamp. The first covered call after the window detects again, so a recovered `gh` is noticed within one window.
- **Red flags:** A hook call that waits on the full `gh-timeout-ms`. A `prExempt` stamp written after a degrade. The `/test` gate reporting `not-pr-first` on a degraded read. A `prExempt` written by an unpinned run while its `forgeDegradedAt` is still fresh. (A stale `forgeDegradedAt` beside `prExempt` after the user pins `integration-model` mid-run is legitimate: a pinned run never reads or clears the memo.)

### 5. Fix it for good
- **URL:** `.claude-tweaks/policy.yml`
- **Action:** Follow the stderr line's advice: pin `integration-model: pr-first` (no `gh` call at all, ever), or raise `gh-timeout-ms` (bounded 1000–60000) and re-run.
- **Should feel:** One edit, done.
- **Should understand:** A pin in `policy.yml`, or in the run's `config.yml`, wins outright over detection. An out-of-range `gh-timeout-ms` (for example 90000) silently falls back to 5000.
- **Red flags:** Still degraded at 60000 ms. The host is down, not slow.

## Origin
- Created during build of #4578 (policy-schema detectIntegrationModel: ignores gh-timeout-ms and silently falls back to local-merge)
- Steps 1-4 built in this session; step 5 is the existing pin/timeout override, now named in the degrade line
- Related: `open-a-run-pr-on-a-slow-gh-host-4554.md` (the same slow host's draft-PR path), `resolve-a-policy-key.md`
