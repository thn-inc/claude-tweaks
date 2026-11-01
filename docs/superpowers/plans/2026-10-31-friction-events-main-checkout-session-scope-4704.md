# friction-events.js main-checkout union scoped to the current session (#4704) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When `friction-events.js` runs against the main checkout, stop it from unioning other sessions' ad-hoc run dirs into the current run's Friction lens.

**Architecture:** `run()` in `plugin/bin/friction-events.js` asks a new injected `repoInfo` dep whether the resolved `--worktree` path is the main checkout. If it is, the path siblings `findRunsByWorktreePath` returns are filtered down to ad-hoc run dirs (`ctxLib.isAdHocRunDir`) whose `state.sessionId` equals the resolved session id. A linked worktree or an indeterminate answer keeps today's path-only union. `plugin/bin/lib/hooks/context.js` is **not modified**: `findRunsByWorktreePath` has other callers, and the scoping is a Friction-lens read rule, not a lookup rule.

**Tech Stack:** Node 18+ CommonJS, `node --test`, deps-injection seam (`run(argv, deps)`).

**Spec:** `.claude-tweaks/pipelines/2026-10-31T145027-spec-4704/work/4704-spec.md`

## Global Constraints

- Restrict the union only when the resolved worktree path is the main checkout (not a linked worktree); keep today's path-only union for linked worktrees, as #2783/#1333 require.
- With cwd = main checkout, `friction-events.js` returns no event from an ad-hoc dir whose `sessionId` differs from the current session's.
- The new regression test is shown red against the current union before the fix.
- Every existing test in `tests/friction-events-cli.test.js` keeps passing with its body unchanged (only the shared `fakeDeps` helper gains a default).
- Commit messages: `{Verb} {what} — {detail}`, `refs #4704` (never closes/fixes), trailer `Claude-Session: https://claude.ai/code/session_01Ngy9oZztnE8eNLWpJkKk7g`.

## Review Focus

- No session id resolvable (neither `--session` nor `CLAUDE_CODE_SESSION_ID`) from the main checkout: ownership cannot be proven, so no path sibling is kept. Pinned by test 3.
- `repoInfo` indeterminate (git timed out under load): never treated as "main checkout". The union falls back to path-only. Pinned by test 4.
- A formal (non-ad-hoc) run dir in the main checkout that carries the current session's id: dropped by the ad-hoc-only rule. That matches Deliverable 1's "ad-hoc dirs owned by the current session id". Pinned in test 1 by a third fixture.
- `--worktree` given explicitly versus defaulting to cwd: `repoInfo` must be asked about the same resolved path `findRunsByWorktreePath` receives. Pinned by the call-argument assertion in test 1.
- An ad-hoc dir found by both lookups is still read once. Existing test "an ad-hoc dir found by BOTH…" covers it; no new test.

---

### Task 1: Scope the main-checkout path union to the current session

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/friction-events.js` (header comment block lines 13-24; `realDeps` ~line 199; `run()` ~lines 220-232)
- Test: `tests/friction-events-cli.test.js` (`fakeDeps` helper lines 17-31; new tests appended after the #2783 block ending ~line 512)
- Modify: `plugin/skills/reflect/full-mode.md` (the read-side sentence at ~lines 109-113, "finds that ad-hoc run dir back by its recorded `worktree` field … and merges its events") — add one sentence for the main-checkout rule (behavior-change prose sweep; file is 39,266 B, well under the rail)
- Modify: `docs/plugin-structure.md:227` (the `friction-events.js` command row, "every OTHER non-terminal run dir recorded against the same worktree") — add one clause for the main-checkout rule
- No change: `plugin/bin/lib/hooks/context.js` (`findRunsByWorktreePath` keeps its contract for its other callers); `docs/journeys/see-an-ad-hoc-sessions-friction-at-wrap-up-2783.md` is left to `/build` Common Step 6's journey pass

**Interfaces:**
- Consumes: `ctxLib.isAdHocRunDir(dir) -> boolean` (exported by `plugin/bin/lib/hooks/context.js`, a basename `-adhoc-standalone` test, called directly — not a dep); `require('./lib/hooks/worktree-detect').repoInfo(p) -> { repoRoot: string|null, isLinkedWorktree: boolean, indeterminate: boolean }`.
- Produces: new `deps.repoInfo(worktreePath)` seam on `run(argv, deps)`; `realDeps.repoInfo = wtDetect.repoInfo`.

- [ ] **Step 1: Write the failing tests**

In `fakeDeps`, add a default `repoInfo: (p) => { calls.repoInfo.push(p); return { repoRoot: '/wt/current', isLinkedWorktree: true, indeterminate: false }; }` and add `repoInfo: []` to `calls`. The default is a linked worktree, so every existing test keeps today's behavior.

Append a `// --- #4704: main-checkout union scoped to the current session ---` block with four tests. Use fixture dirs `/run/2026-10-31T100000-adhoc-standalone` (mine), `/run/2026-10-31T110000-adhoc-standalone` (other), and `/run/2026-10-31T120000-spec-9` (formal). `readEvents` returns one `wd-deny` event tagged with the `runDir` for each of them:

1. `#4704: from the main checkout only this session's ad-hoc dirs are unioned by path`. Set `repoInfo` to `{ repoRoot: '/main', isLinkedWorktree: false, indeterminate: false }` and `cwd: () => '/main'`. `findRunsByWorktreePath` returns all three fixtures with `state.sessionId` `'S1'`, `'S2'`, `'S1'` and `state.worktree: '/main'`. Run `['--run', '/run/primary', '--session', 'S1']`. Assert the `_runDir` set of the output's `adhoc` events deep-equals `['/run/2026-10-31T100000-adhoc-standalone']`. Also assert `deps.calls.repoInfo` deep-equals `['/main']`.
2. `#4704: a linked worktree still unions another session's ad-hoc dir by path (#2783/#1333)`. Keep the default `repoInfo` (linked). `findRunsByWorktreePath` returns the other-session fixture (`sessionId: 'S2'`). Run with `--session S1`. Assert its event is present with `_source: 'adhoc'`.
3. `#4704: from the main checkout with no session id, no path sibling is unioned`. Use the main-checkout `repoInfo`, keep the default `sessionId: () => null`, and pass no `--session`. `findRunsByWorktreePath` returns the mine fixture. Assert the output holds only the primary fixture event, with no `adhoc` entry.
4. `#4704: an indeterminate repoInfo keeps the path-only union`. Set `repoInfo` to `{ repoRoot: null, isLinkedWorktree: false, indeterminate: true }`. `findRunsByWorktreePath` returns the other-session fixture. Run with `--session S1`. Assert its event is present.
5. `#4704: the real CLI from a real main checkout drops another session's ad-hoc dir (real writer)`. This is the real-writer fixture check: no hand-written run-state. `fs.mkdtempSync` a repo and `git init` it via `execFileSync('git', ['init', '-q'], { cwd })`. Take `root = fs.realpathSync(repo)`. Under `root/.claude-tweaks/pipelines/`, create `2026-10-31T100000-adhoc-standalone` and `2026-10-31T110000-adhoc-standalone`, and stamp each through the real `writeRunState(dir, { worktree: root, status: 'active', sessionId })` from `plugin/bin/lib/hooks/context.js`, with sessionIds `'S1'` and `'S2'`. Give each an `events.jsonl` with one `wd-deny` line. Also create a primary dir `2026-10-31T120000-spec-9` with no events. Spawn `process.execPath` on `plugin/bin/friction-events.js --run <primary>` with `cwd: root`, `env: { ...process.env, CLAUDE_CODE_SESSION_ID: 'S1' }` and `windowsHide: true`. Assert the parsed stdout's `_runDir` basenames deep-equal `['2026-10-31T100000-adhoc-standalone']`. Clean up in `finally`.

Guard discrimination: test 1 is the input on which only the session-id clause decides (the S2 ad-hoc dir), and its formal fixture is decided only by the ad-hoc clause. Test 3 is decided only by the "no session id" clause. Deleting any one of the three clauses turns its test red.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/friction-events-cli.test.js`
Expected: FAIL. Test 1 fails because both ad-hoc dirs and the formal dir are unioned, and the `deps.calls.repoInfo` assertion fails because `repoInfo` is never called. Test 3 fails because the path sibling is unioned. Test 5 fails because both real ad-hoc dirs are returned. Tests 2 and 4 pass, since they pin today's behavior that must survive. Every pre-existing test passes.

Before Step 3, record the **real-input baseline** with the unchanged CLI against this repo's real main checkout. Run `node plugin/bin/friction-events.js --run "<main checkout>/.claude-tweaks/pipelines/2026-10-31T145027-spec-4704" --worktree "<main checkout>" --session 4a6882a8-3793-428f-83d4-1490460bf843`, where `<main checkout>` is `/Users/thomasholknielsen/Code Workspaces/claude-tweaks`. Record the event count and the distinct `_runDir` count, and the `sessionId` of each `_runDir`'s `run-state.json`.

- [ ] **Step 3: Implement the scoping in `plugin/bin/friction-events.js`**

- Require `./lib/hooks/worktree-detect` as `wtDetect` and add `repoInfo: wtDetect.repoInfo` to `realDeps`.
- In `run()`, move the `sessionId` resolution above the `siblings` line. Then compute `const info = deps.repoInfo(worktreePath) || {};` and `const inMainCheckout = !info.indeterminate && Boolean(info.repoRoot) && !info.isLinkedWorktree;`.
- When `inMainCheckout`, filter `siblings` to entries where `ctxLib.isAdHocRunDir(runDir)` is true and `sessionId` is set and `state && state.sessionId === sessionId`.
- The `bySession` lookup and the read-once loop are unchanged.
- Add a `// #4704: …` comment at the filter, then extend the header comment block, in the existing prose style, by one paragraph. It must say: from the main checkout every main-checkout session's ad-hoc dir records that same path, so the path union keeps only this session's ad-hoc dirs there; a linked worktree's path identifies one session's work, and its union is unchanged.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/friction-events-cli.test.js`
Expected: PASS (all tests, including the five new ones)

Then re-run the Step 2 real-input command and record the same three figures. Expected: every remaining `adhoc` `_runDir` is an `-adhoc-standalone` dir whose `run-state.json` `sessionId` is `4a6882a8-3793-428f-83d4-1490460bf843`. Put the before and after counts in the report.

- [ ] **Step 4.5: Update the prose that describes the old union**

In `plugin/skills/reflect/full-mode.md`, after the sentence ending "…merges its events into the output alongside this run's own.", add one sentence. It says that from the main checkout, where every main-checkout session's ad-hoc dir records the same path, the path match keeps only ad-hoc dirs owned by the current session id, and that a linked worktree's match is unchanged (#4704). In `docs/plugin-structure.md:227`, after "recorded against the same worktree (`plugin/bin/lib/hooks/context.js`'s `findRunsByWorktreePath`)", add "— from the main checkout, only ad-hoc dirs owned by the current session id (#4704) —". Then run `node --test tests/hooks-post-tool-use-adhoc-rundir.test.js tests/friction-main-checkout-denial-coverage.test.js tests/reflect-friction-lens-vocab.test.js`. Expected: PASS (these suites read `full-mode.md`).

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/friction-events.js tests/friction-events-cli.test.js plugin/skills/reflect/full-mode.md docs/plugin-structure.md
git commit -m "Scope friction-events' main-checkout path union to the current session — other sessions' ad-hoc dirs no longer leak into the Friction lens (refs #4704)" -m "Claude-Session: https://claude.ai/code/session_01Ngy9oZztnE8eNLWpJkKk7g"
```
