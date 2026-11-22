---
files:
  - plugin/bin/lib/policy-schema.js
  - plugin/bin/lib/shared-primitives.js
  - plugin/bin/lib/wrap-up/engine-verify.js
  - plugin/bin/residue.js
  - plugin/bin/console-resolve.js
  - plugin/bin/lib/flow/preflight.js
  - plugin/bin/lib/release-preflight/pack.js
  - plugin/bin/lib/wrap-up/pack.js
  - plugin/bin/lib/policy-file.js
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
- **Should understand:** The ladder is one implementation, `ghTimeoutMsAt(repoRoot)` in `plugin/bin/lib/shared-primitives.js`, shared with the process-wide `GH_TIMEOUT_MS` getter. An env value only counts when it is a positive integer inside the `gh-timeout-ms` key's 1000–60000 bounds, otherwise the ladder falls through to the policy rung. The ladder reads the repo being detected, not `process.cwd()`. From a linked worktree with no `policy.yml` of its own (a project that keeps `.claude-tweaks/` out of git), the `gh-timeout-ms` rung reads the main checkout's file, found through `plugin/bin/lib/policy-file.js`'s `locatePolicyFile` (#4492). The `git remote get-url origin` probe keeps its own short 5 s bound.
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

### 4. Hooks and gates stay bounded and never persist the guess — `pre-tool-use.js`, `precondition.js`, `phase-exit.js`
- **URL:** —
- **Action:** The PreToolUse PR-stamp gate's fallback detection passes `HOOK_FORGE_PROBE_TIMEOUT_MS` (5000 ms per attempt). That gives a worst case of 15 s with the retry and the git probe, whatever `gh-timeout-ms` says. A degraded result never caches `prExempt`. SessionStart's reconcile gets the same bound. `/claude-tweaks:test` Step 0's `check-pr-bookkeeping.js` returns `degraded-detection` (logged as a `SKIP`), never `not-pr-first`. `phase-exit.js` treats a degraded read as unresolved.
- **Should feel:** The session never hangs on a hook for a minute, and no gate passes silently on a guess.
- **Should understand:** While `gh` stays hung, an unpinned degraded run probes at most about once per `FORGE_DEGRADE_MEMO_TTL_MS` (60 s) per run. Covered calls inside that window skip the probe and allow the call without a `prExempt` stamp. The first covered call after the window detects again, so a recovered `gh` is usually noticed within one window. Two hook processes that start with no fresh memo can both probe, and a late degraded writer can re-arm a cleared memo, so recovery can take up to one more window.
- **Red flags:** A hook call that waits on the full `gh-timeout-ms`. A `prExempt` stamp written after a degrade. The `/test` gate reporting `not-pr-first` on a degraded read. A `prExempt` written by an unpinned run while its `forgeDegradedAt` is still fresh, except through the concurrent-probe race (harmless for a covered call that is not an all-push call, because `prExempt` short-circuits it before the memo is read; since #4344 an all-push call no longer short-circuits on `prExempt` and reads the memo like an unstamped call). (A stale `forgeDegradedAt` beside `prExempt` after the user pins `integration-model` mid-run is legitimate: a pinned run never reads or clears the memo.)

### 5. Fix it for good
- **URL:** `.claude-tweaks/policy.yml`
- **Action:** Follow the stderr line's advice: pin `integration-model: pr-first` (no `gh` call at all, ever), or raise `gh-timeout-ms` (bounded 1000–60000) and re-run.
- **Should feel:** One edit, done.
- **Should understand:** A pin in `policy.yml`, or in the run's `config.yml`, wins outright over detection. An out-of-range `gh-timeout-ms` (for example 90000) silently falls back to 5000.
- **Red flags:** Still degraded at 60000 ms. The host is down, not slow. From a linked worktree that reads the main checkout's `policy.yml`, the edit landing in a new worktree-local `.claude-tweaks/policy.yml`: that file wins outright and hides every other main-checkout key (#4492). Edit the main checkout's file instead.

### 6. Wrap-up's gh calls follow the same ladder — `plugin/bin/lib/wrap-up/engine-verify.js`, `plugin/bin/residue.js`
- **URL:** —
- **Action:** With `gh-timeout-ms: 20000` in `policy.yml` (or `CLAUDE_TWEAKS_GH_TIMEOUT_MS=20000` in the environment), the wrap-up verify engine's `gh` calls and `residue.js`'s forge probe both run bounded at 20 s through the memoized `GH_TIMEOUT_MS` getter. A `gh` call that takes 8 s completes instead of being killed.
- **Should feel:** Nothing visible. The close-out sweep behaves like detection did in step 1.
- **Should understand:** Only `gh` calls take the ladder. `git` calls never do: `engine-verify.js` keeps its own fixed 5 s bound for them, and `residue.js` leaves its git calls on their own bounds. A `timeout` that a caller passes to `residue.js`'s runner still wins over the ladder. The getter is read once per process, so a changed env var or policy value takes effect on the next command, not mid-run.
- **Red flags:** A wrap-up `gh` call killed after about 5 s while `gh-timeout-ms: 20000` is set. A `git` call that waits on the `gh` bound.

### 7. The preflight packs and console-resolve read through the batched bound — `plugin/bin/console-resolve.js`, `plugin/bin/lib/flow/preflight.js`, `plugin/bin/lib/release-preflight/pack.js`, `plugin/bin/lib/wrap-up/pack.js`
- **URL:** —
- **Action:** With `gh-timeout-ms: 45000` in `policy.yml` (or `CLAUDE_TWEAKS_GH_TIMEOUT_MS=45000`), every `gh` spawn these four seams make runs bounded at 45 s, where each used to be killed at a fixed 30 s. With `gh-timeout-ms: 20000` the bound stays 30 s, because the batched bound is `max(30000, gh-timeout-ms)`.
- **Should feel:** Nothing visible. The `/claude-tweaks:flow` second-call preflight, the release preflight, the wrap-up fact pack and the console's grant reads wait as long as the host needs.
- **Should understand:** The bound follows the command, through `execTimeoutMsFor(cmd)` in `plugin/bin/lib/shared-primitives.js`: `gh` takes `GH_BATCH_TIMEOUT_MS`, `git` takes `GIT_TIMEOUT_MS` (`git-timeout-ms`, so `console-resolve.js` and `release-preflight/pack.js` follow it), and a `node` spawn such as `verify.js` keeps a fixed 30 s. A timeout kill in the wrap-up pack reads `timeout after 45000ms: gh …`, naming the bound the killed call carried. Spawns that carried no timeout before (some `git` and `gh` helpers in `flow/preflight.js` and `wrap-up/pack.js`) are unchanged; #5870 tracks bounding them, and #5657 and #5658 own the other timeout-less runners.
- **Red flags:** A pack `gh` call killed at 30 s while `gh-timeout-ms: 45000` is set. A `node verify.js` spawn that follows the `gh` bound. A `git` call that follows `gh-timeout-ms`.

## Origin
- Created during build of #4578 (policy-schema detectIntegrationModel: ignores gh-timeout-ms and silently falls back to local-merge)
- Steps 1-4 built in this session; step 5 is the existing pin/timeout override, now named in the degrade line
- Step 4 extended during build of #4830 (run-scoped forge degrade memo): a hung `gh` now costs the PR-stamp gate one probe per `FORGE_DEGRADE_MEMO_TTL_MS` window instead of one per covered call
- Steps 1 and 5 updated at the wrap-up of #4492 (policy locator): from a linked worktree without its own `policy.yml`, the `gh-timeout-ms` rung reads the main checkout's file, and step 5's red flag warns against a worktree-local copy; `files:` gains `plugin/bin/lib/policy-file.js`
- Step 1 extended and step 6 added during build of #4856 (route every gh call's timeout through GH_TIMEOUT_MS): the ladder moved into `ghTimeoutMsAt`, and `engine-verify.js` and `residue.js` now honour it
- Step 7 added during build of #5050 (decide the gh bound for the four generic exec seams): the four seams' fixed 30 s became a per-command bound (`gh` batched, `git` its own key, `node` fixed); `files:` gains the four seam files
- Related: `open-a-run-pr-on-a-slow-gh-host-4554.md` (the same slow host's draft-PR path), `resolve-a-policy-key.md`
