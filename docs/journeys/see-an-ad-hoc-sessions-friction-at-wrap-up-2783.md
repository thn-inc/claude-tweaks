---
files:
  - plugin/bin/lib/hooks/post-tool-use.js
  - plugin/bin/lib/hooks/post-tool-use-failure.js
  - plugin/bin/lib/hooks/harness-refusal.js
  - plugin/bin/lib/hooks/pre-tool-use.js
  - plugin/bin/lib/hooks/context.js
  - plugin/bin/lib/hooks/worktree-reap.js
  - plugin/hooks/hooks.json
  - plugin/bin/friction-events.js
  - plugin/skills/reflect/full-mode.md
  - plugin/bin/lib/reconcile/archive-merged.js
---

# See an Ad-hoc Session's Friction at Wrap-up

**Persona:** a developer in a `worktree-always` project who asks Claude to fix something directly, with no `/claude-tweaks:build` or `/claude-tweaks:flow` pipeline running. Claude calls `EnterWorktree`, does the work, and runs `/claude-tweaks:wrap-up` from the main checkout after the worktree is gone.
**Goal:** the wrap-up's reflect Friction Lens reports the guard refusals the session actually hit: claude-tweaks' own gate denials and Claude Code's own worktree-isolation Bash refusals. It should not report a clean run that wasn't.
**Entry point:** an `EnterWorktree` call in a session that owns no pipeline run dir. In a busy checkout, `resolveRun` usually has an unrelated `fallback` guess to offer (often a sibling session's `*-standalone` run).
**Success state:** `node plugin/bin/friction-events.js --run <wrap-up run dir>` (which reflect's Friction Lens runs) returns the session's `wd-guard-refusal` / `gate-denial` events tagged `_source: "adhoc"`. The developer sees the session's real friction in the reflection, and nothing was written into the sibling's run.

## Steps

### 1. Enter a worktree ad hoc: session start
- **URL:** the `EnterWorktree` tool call
- **Action:** Claude creates or enters a worktree at the developer's request. The `PostToolUse` hook (`stampAdHocRunDir`) mints a `{ts}-adhoc-standalone` run dir that records this session's id and the worktree path.
- **Should feel:** invisible. Nothing is printed and no prompt appears; it's pure bookkeeping.
- **Should understand:** an unrelated run that `resolveRun` merely *guesses* (`attribution: fallback`) never counts as "this session already owns a run" (#2783). The mint happens even in a checkout full of other sessions' runs. When the tool result doesn't expose the path, the hook finds the worktree in `git worktree list --porcelain` through worktree-reap.js's `findWorktreeEntry`. That compare also works on Windows, where porcelain prints `D:/a/x/feat` and the session's cwd is `D:\a\x\feat` (#3811).
- **Red flags:** no `*-adhoc-standalone` dir appears under `.claude-tweaks/pipelines/` after the first `EnterWorktree`, even though the session owns no run. That was #2783's original failure, and on Windows it was #3811's.

### 2. Hit a guard refusal: inside the worktree
- **URL:** any Bash call the harness's worktree-isolation guard refuses, or any claude-tweaks deny gate (worktree-required, shadow-run-dir, teardown)
- **Action:** Claude runs a command the guard can't prove isn't a git operation on another checkout, such as `d=.; sed -n 1,2p $d/README.md`. It sees "This session is isolated in the worktree … Refusing to run it", then retries with a plainer command.
- **Should feel:** the same friction as before this change. The refusal text and the retry path are unchanged; the hook only observes it.
- **Should understand:** the refusal is now recorded as a `wd-guard-refusal` event with `reason: harness-worktree-isolation` and a 200-character command excerpt. It is recorded by the `PostToolUseFailure` hook, the one event Claude Code fires for its own guard's refusals. An ordinary non-zero exit fires the same event and is ignored. A plugin gate denial logs `gate-denial` / `wd-guard-refusal` into the same session-owned dir via `resolveDenialRunDir`, never into a guessed run. On Windows too: that dir is keyed on the cwd's entry in `git worktree list`, matched with the same slash- and case-tolerant compare (#3811).
- **Red flags:**
  - an ordinary failing command (e.g. `Exit code 128`) shows up as a guard refusal;
  - a denial lands in another session's run dir (that run's `events.jsonl` grows);
  - on Windows, a denial with no owned run dir leaves no `-adhoc-standalone` dir behind (the pre-#3811 failure);
  - every failing Bash call becomes noticeably slower. The prefilter skips this hook unless the payload carries `Refusing to run it`.

### 3. Remove the worktree: same session
- **URL:** `ExitWorktree` with `action: "remove"`
- **Action:** the work is merged, so Claude removes the worktree.
- **Should feel:** a plain, allowed teardown with no deny.
- **Should understand:** the session's own ad-hoc dir holds only friction events. It never makes the worktree "assigned to a pipeline run", so the teardown gate ignores it. The dir stays non-terminal so wrap-up can still read it. A formal `/flow` run that minted its run dir before `EnterWorktree` still owns attribution after `record-worktree`, and its own teardown and IL-131 bookkeeping deny behave as before.
- **Red flags:**
  - the teardown gate denies with "still assigned to non-terminal pipeline run" and names an `-adhoc-standalone` dir;
  - following that deny's `close-run` advice closes the ad-hoc dir, after which its friction is no longer read.

### 4. Wrap up: main checkout
- **URL:** `/claude-tweaks:wrap-up`, whose reflect Friction Lens runs `node plugin/bin/friction-events.js --run <wrap-up run dir>`
- **Action:** the developer runs wrap-up after the worktree is gone. The CLI combines three sources: the wrap-up run's own events, ad-hoc dirs recorded against the current worktree path, and ad-hoc dirs owned by the current session id (`--session`, default `CLAUDE_CODE_SESSION_ID`). Each dir is read once. The worktree-path match is case-canonical (#3836): on a case-insensitive volume, a worktree path typed with different letter casing finds the same ad-hoc dirs as the on-disk spelling.
- **Should feel:** an accurate reflection. The Friction Lens names the refusals the session actually hit, with the run dir each was logged in.
- **Should understand:** the session-id match is what finds the dir once the worktree path no longer resolves. A dir bound to a still-live worktree is skipped, because session-id equality is not ownership: subagents share the id. There is one documented limit. If the session id changed between the friction and the wrap-up (for example, a resumed or account-switched session that got a new id), the earlier dir is found only by worktree path, so only from inside that still-live worktree. Wrap-up reads an ad-hoc dir only while it is still live under `.claude-tweaks/pipelines/`. Both sweeps count from the dir's last write (its mtime), not from when the session ended. Reconcile archives a linked-worktree one once it has sat untouched for 30 days and its worktree is no longer registered (`adhoc-superseded`). It archives a main-checkout one once it has sat untouched for 7 days and its session reads dead (`adhoc-session-ended`, #4179). A wrap-up later than that reads nothing from it.
- **Red flags:**
  - `friction-events.js` returns `[]` for a session that visibly hit refusals;
  - the output includes a sibling subagent's friction from a worktree that is still live.

## Origin
- Created during build of #2783 (absorbs #2813's main-checkout and session-resume reproduction cases)
- Steps 1-4 built in this session
- Related specs: #500 / #1333 (ad-hoc stamping), #2351 / #2543 (main-checkout denial coverage), #2989 (pre-claim event exclusion on the same read side)
- Updated during build of #3836: step 4's worktree-path lookup (`findRunsByWorktreePath`) compares case-canonical real paths
- Updated during build of #3304: step 2's refusal text now lives in `plugin/bin/lib/hooks/harness-refusal.js`, and a Claude Code rewording surfaces as upstream drift (see `notice-a-reworded-isolation-refusal-3304.md`)
- Updated during build of #3811: steps 1-2's porcelain worktree lookups now go through worktree-reap.js's shared `findWorktreeEntry`, so they match on Windows
- Updated during build of #4179: step 4 names the read window that reconcile's two ad-hoc sweeps bound (`adhoc-superseded` for a linked worktree, `adhoc-session-ended` for the main checkout)
