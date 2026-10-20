# Review Console Ask Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deny a `"Review Console"` `AskUserQuestion` when the calling session's owned pipeline run grants `consoleAutoResolve`, so an `unattended` run can never stall on the console the way #2734's did. Record the incident's root cause.

**Architecture:** A new check in `plugin/bin/lib/hooks/pre-tool-use.js` runs first in `runInner` whenever `tool_name === 'AskUserQuestion'`. It is reached through a new `PreToolUse` matcher in `plugin/hooks/hooks.json`. It denies only when three things are all proven: the header matches, the run is provably owned, and the resolved ceiling grants `consoleAutoResolve`. Anything else is allowed, per `docs/hooks.md`'s never-break-a-session rule. A live-prose conformance test keeps the hook's exported header constant in lockstep with the two console files that pin it.

**Tech Stack:** Node 18+, CommonJS, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-10-20T152754-spec-3712/work/3712-spec.md`

**Scope keywords:** Review Console, consoleAutoResolve, AskUserQuestion

## Global Constraints

- Header match is exact: `"Review Console"` (the string both console files pin). No case folding, no trimming.
- Deny shape: the module's existing `denyResult(reason)`: `exit: 0`, `hookSpecificOutput.permissionDecision: 'deny'`. Never a non-zero exit.
- "Provably owned run" = `ctxLib.isTrustedOwnedRun(ctx.ownedRun)` AND `!ctxLib.isAdHocRunDir(ctx.ownedRun.dir)`. Never `ctx.runDir` (session-agnostic fallback).
- Ceiling = `resolveCeiling({ runConfig: <resolved 'autonomy'> })` over `resolvePolicyConfig({ git, readFile, runDir: ownedRun.dir, keys: ['autonomy'] })`, the same fold `plugin/bin/console-resolve.js`'s `readPolicy()` uses. Deny only when `bookkeepingPermissions(ceiling).consoleAutoResolve === true`.
- Fail open (allow, return `{}`) on: no owned run, ad-hoc owned run, a missing or malformed `tool_input.questions`, no matching header, a ceiling-read throw, a ceiling not granting `consoleAutoResolve`.
- Commits: `{Verb} {what} — {detail}` style, body line `Refs #3712`. Never `Fixes`/`Closes` in a commit message.
- Inside the worktree: one plain command per Bash call.

## Review Focus

1. A multi-question `AskUserQuestion` where only the *second* question carries `header: "Review Console"` must still deny. Pinned in Task 1 (`deny when any question carries the console header`).
2. A payload with `tool_input` missing, `questions` not an array, or a question entry that isn't an object must allow without throwing. Pinned in Task 1 (`malformed AskUserQuestion input allows`).
3. An owned run whose `config.yml` sets no `autonomy` resolves the project `policy.yml` value, so an `unattended` project denies with no run override. Pinned in Task 1 by injecting the ceiling reader (`ceiling comes from the injected reader, not ctx.runState`).
4. The deny must not fire for a run the session does not own: `ownedRun.attribution === 'fallback'` allows even when `ctx.runDir`'s config says `unattended`. Pinned in Task 1 (`fallback-attributed run allows`).
5. Through the real dispatcher, a garbage-stdin `pre-tool-use` call and an `AskUserQuestion` payload with no run both exit 0 with no deny. Pinned in Task 2 (`dispatcher: AskUserQuestion with no owned run exits 0 with no deny`).

---

### Task 1: Review Console ask gate in `pre-tool-use.js`

**Files:**
- Modify: `plugin/bin/lib/hooks/pre-tool-use.js`: new constant and check function near `checkPipelineShadowGuard` (~line 711); dispatch at the top of `runInner` (~line 2047); add both to `module.exports` (~line 2236)
- Test: `tests/hooks-pre-tool-use.test.js` (append a `// #3712` block)

**Interfaces:**
- Consumes: `denyResult(reason)` (same file), `ctxLib.isTrustedOwnedRun`, `ctxLib.isAdHocRunDir`, `ctxLib.appendEvent` (`./context`), `runGit(args, cwd)` → `{ stdout, failure }` (`./git-exec`), `resolvePolicyConfig` (`../policy-schema`), `resolveCeiling`, `bookkeepingPermissions` (`../issues/autonomy`).
- Produces:
  - `REVIEW_CONSOLE_HEADER = 'Review Console'` (exported string constant)
  - `readConsoleCeiling(runDir: string, cwd: string) -> string` (exported; resolves the ceiling the way `console-resolve.js` does; may throw)
  - `checkReviewConsoleAskGate(ctx, deps = {}) -> {} | denyResult` (exported). `deps.readConsoleCeiling` overrides the reader (test seam, same pattern as `checkBookkeepingStampsGate`'s `deps`).

- [ ] **Step 1: Write the failing tests** (append to `tests/hooks-pre-tool-use.test.js`)

Helpers: `const askInput = (questions, cwd) => ({ tool_name: 'AskUserQuestion', tool_input: { questions }, session_id: 'sess-1', cwd });`, plus `ownedRunAt(dir, attribution = 'session') => ({ dir, attribution })`. Each test makes its run dir with `tmpProject()` + a `2026-07-01T090000-spec-1` dir, writes `config.yml` with `autonomy: {tier}`, and calls `pre.run({ input, runDir: dir, runState: { status: 'active' }, ownedRun, cwd: dir })`.

- `AC1.1: unattended owned run denies a Review Console question`: `autonomy: unattended`, questions `[{ header: 'Review Console', question: 'How do you want to handle the Review Console items?', options: [] }]`. Assert `out.json.hookSpecificOutput.permissionDecision === 'deny'` and the reason matches `/console-resolve\.js/` and `/consoleAutoResolve/`.
- `#3712: deny when any question carries the console header`: two questions, the first headed `'Divergence'`, the second `'Review Console'`. Expect deny.
- `AC2.1: trusted and supervised ceilings allow`: loop over `['trusted', 'supervised']` and assert `deepStrictEqual(out, {})`.
- `AC3.1: other headers allow at unattended`: header `'Shape check'` → `{}`.
- `AC4.1: no owned run allows`: `ownedRun: { dir: null, attribution: null }` → `{}`.
- `#3712: fallback-attributed run allows`: `ownedRun` attribution `'fallback'`, config `unattended` → `{}`.
- `#3712: ad-hoc owned run allows`: dir basename `2026-07-01T090000-adhoc-standalone`, config `unattended` → `{}`.
- `AC4.1: ceiling read failure allows`: `pre.run(ctx, { readConsoleCeiling: () => { throw new Error('boom'); } })` → `{}`.
- `#3712: ceiling comes from the injected reader, not ctx.runState`: no `config.yml` written; `deps.readConsoleCeiling = () => 'unattended'` → deny.
- `#3712: malformed AskUserQuestion input allows`: for each `tool_input` of `undefined`, `{}`, `{ questions: 'x' }`, `{ questions: [null, 7] }`, assert `{}` and no throw.
- `#3712: REVIEW_CONSOLE_HEADER is exported as the pinned string`: `assert.strictEqual(pre.REVIEW_CONSOLE_HEADER, 'Review Console')`.

- [ ] **Step 2: Run the tests and verify they fail**

Run: `node --test tests/hooks-pre-tool-use.test.js`
Expected: FAIL. The `#3712` deny tests fail (no deny returned) and the export test fails (`undefined`).

- [ ] **Step 3: Implement**

- `readConsoleCeiling(runDir, cwd)`: `git = (args) => { const r = runGit(args, cwd); if (r.failure) throw new Error(r.failure); return r.stdout; }`, `readFile` = try `fs.readFileSync(p, 'utf8')` else `null`; `resolvePolicyConfig({ git, readFile, runDir, keys: ['autonomy'] })`; value = the `autonomy` entry's `value` when it has no `error`, else `null`; return `resolveCeiling({ runConfig: value })`. Note that `resolvePolicyConfig`'s own catch falls back to `process.cwd()` when git throws, so it reads *some* policy.yml. Accept that: it is the same behavior `console-resolve.js` has.
- `checkReviewConsoleAskGate(ctx, deps)`: return `{}` unless `ctx.input.tool_name === 'AskUserQuestion'`, `tool_input.questions` is an array containing an object whose `header === REVIEW_CONSOLE_HEADER`, and the owned run passes the Global Constraints ownership test. Then `try { ceiling = (deps.readConsoleCeiling || readConsoleCeiling)(ownedRun.dir, ctx.cwd || process.cwd()) } catch { return {}; }`. Return `{}` unless `bookkeepingPermissions(ceiling).consoleAutoResolve`. On deny, call `ctxLib.appendEvent(ownedRun.dir, 'console-ask-deny', { ceiling })`, then `return denyResult(...)` with this exact text, where `{dir}` is `ownedRun.dir` and `{root}` is `pluginRoot()`:
  `claude-tweaks: this run's autonomy ceiling is ${ceiling}, which grants consoleAutoResolve — the Review Console resolves with zero AskUserQuestion calls (wrap-up/review-console.md's Auto-resolution short-circuit). Resolve it instead: node "${root}/bin/console-resolve.js" --run "${dir}" --policy console-auto`
- `runInner`: first statement, `if (ctx.input && ctx.input.tool_name === 'AskUserQuestion') return checkReviewConsoleAskGate(ctx, deps);`. No other gate applies to this tool.
- Header comment on the new function: why it exists (#2734's stall, IL-167), the fail-open list, and that the header string is pinned against the console prose by `tests/review-console-header-conformance.test.js`.

- [ ] **Step 4: Run the tests and verify they pass**

Run: `node --test tests/hooks-pre-tool-use.test.js`
Expected: PASS, every test, the pre-existing ones included.

- [ ] **Step 5: Prove the deny test discriminates**

Temporarily change `REVIEW_CONSOLE_HEADER` to `'Review Consol'`, run `node --test tests/hooks-pre-tool-use.test.js`, confirm the `#3712` deny tests go red, then restore it and rerun to green. Do not commit the mutation.

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/lib/hooks/pre-tool-use.js tests/hooks-pre-tool-use.test.js
git commit -m "Add Review Console ask gate to pre-tool-use — deny the console question when consoleAutoResolve is granted" -m "Refs #3712"
```

### Task 2: Register the matcher, and document the gate

**Files:**
- Modify: `plugin/hooks/hooks.json`: add a `PreToolUse` entry `{ "matcher": "AskUserQuestion", "hooks": [{ "type": "command", "command": "node \"${CLAUDE_PLUGIN_ROOT}/bin/hooks.js\" pre-tool-use" }] }` after the `ExitWorktree` entry, matching its formatting
- Modify: `docs/hooks.md`: in the top "Tiered posture" bullet's block-tier list, add the Review Console ask gate. State what it keys on (`header: "Review Console"`, exact match), what it requires (provably owned run, which excludes fallback attribution and ad-hoc dirs, plus a ceiling granting `consoleAutoResolve`), that it fails open otherwise, and where the full rationale lives (`[IL-167]`)
- Test: `tests/hooks-dispatcher.test.js`

**Interfaces:**
- Consumes: Task 1's `checkReviewConsoleAskGate` through the real `plugin/bin/hooks.js pre-tool-use` dispatcher.
- Produces: the registration later conformance relies on.

- [ ] **Step 1: Write the failing tests** (in `tests/hooks-dispatcher.test.js`, next to the existing PreToolUse matcher tests ~line 640)

- `AC6.1: hooks.json registers a PreToolUse matcher for AskUserQuestion`: find `config.hooks.PreToolUse` entry with `matcher === 'AskUserQuestion'`; assert it exists and its single command ends with `bin/hooks.js" pre-tool-use`.
- `dispatcher: AskUserQuestion with no owned run exits 0 with no deny`: spawn `plugin/bin/hooks.js pre-tool-use` the way the neighboring dispatcher tests do (same helper), stdin `JSON.stringify({ tool_name: 'AskUserQuestion', tool_input: { questions: [{ header: 'Review Console', question: 'q', options: [] }] }, session_id: 'no-such-session', cwd: <fresh tmp dir> })`, env without `PIPELINE_RUN_DIR`. Assert exit 0 and stdout does not contain `permissionDecision`.

- [ ] **Step 2: Run them and verify they fail**

Run: `node --test tests/hooks-dispatcher.test.js`
Expected: FAIL on the matcher test (no entry). The dispatcher test may already pass; that's fine, it pins never-break-a-session.

- [ ] **Step 3: Add the hooks.json entry and the docs/hooks.md bullet text** (as described under Files)

- [ ] **Step 4: Run the tests and verify they pass**

Run: `node --test tests/hooks-dispatcher.test.js`
Expected: PASS.

Run: `node --test tests/hooks-gate-coverage.test.js` (AC6.2: existing registration conformance still passes)
Expected: PASS. That file pins `GATE_COVERAGE`, which this task does not change. Confirm it still passes rather than assuming it.

- [ ] **Step 5: Commit**

```bash
git add plugin/hooks/hooks.json docs/hooks.md tests/hooks-dispatcher.test.js
git commit -m "Register AskUserQuestion PreToolUse matcher — route the Review Console ask gate through hooks.js" -m "Refs #3712"
```

### Task 3: Header conformance test

**Files:**
- Create: `tests/review-console-header-conformance.test.js`

**Interfaces:**
- Consumes: `REVIEW_CONSOLE_HEADER` from `plugin/bin/lib/hooks/pre-tool-use.js`.
- Produces: the lockstep pin AC5 requires.

- [ ] **Step 1: Write the test**

Header comment: this reads live skill prose deliberately, per the skill-prose-conformance-tests convention. The header string is a declared contract between two prose files and one hook constant, and updating all three together is the intended action when it changes (the `[IL-80]` exception, same reasoning as `tests/hooks-gate-coverage.test.js`'s header).

For each of `plugin/skills/wrap-up/review-console-interactive.md` and `plugin/skills/flow/multispec-review-console.md`:
- `AC5.1/AC5.2: {file} pins the console AskUserQuestion header the gate keys on`: read the file; find the line containing both `AskUserQuestion` and `` `header`: ``; assert that line contains `` `header`: `"${REVIEW_CONSOLE_HEADER}"` ``. The assertion message names the file and says the hook constant and the prose must change together.

- [ ] **Step 2: Run it and verify it passes**

Run: `node --test tests/review-console-header-conformance.test.js`
Expected: PASS (2 tests).

- [ ] **Step 3: Prove it can go red**

Temporarily edit the header in `plugin/skills/flow/multispec-review-console.md` to `"Review Console X"`, run the test, confirm that file's test fails, then restore it and rerun to green. Do not commit the mutation.

- [ ] **Step 4: Commit**

```bash
git add tests/review-console-header-conformance.test.js
git commit -m "Pin the Review Console header against the ask gate — conformance over both console prompts" -m "Refs #3712"
```

### Task 4: IL-167 incident-log entry

**Files:**
- Modify: `docs/incident-log.md`: append `## IL-167 — An unattended Review Console asked anyway, and the stall was misdiagnosed as a policy gap`
- Modify: `docs/donts.md`: one tagged rule, matching the file's existing one-line style. Proposed: never rely on skill prose alone to keep an `unattended` console from prompting; the `PreToolUse` ask gate is the enforcement `[IL-167]`.

**Interfaces:**
- Consumes: the spec's Current State (all facts below are quoted from it).
- Produces: the `[IL-167]` tag Task 2's docs/hooks.md bullet cites.

- [ ] **Step 1: Write the entry**

Follow IL-165's shape (prose paragraphs, ending with a Cost paragraph). It must name:
- the session `b41eb7b0-a507-4837-b6da-1f3b3564aa30`, plugin 6.128.0, and the runs `2026-09-20T185343-spec-2670-2681` and `2026-09-20T193353-spec-2682`
- that the ceiling resolved `unattended` in both, and that #2682 carried `auto:merge` (labeled 19:20:28Z)
- that the model never invoked `/claude-tweaks:wrap-up`, never read `wrap-up/review-console.md`, and never ran `console-resolve.js` for #2682; it asked with header `"Review Console"` at 19:58:28Z and got the answer at 2026-09-21T03:22:55Z
- that run 1 read `multispec-review-console.md` and asked anyway (no grants, so the correct outcome was a zero-click park)
- the misdiagnosis: #2734 blamed `merge-authorization: ask` and shipped `pre-authorize-merge` (PR #3709); the token stays, since it's useful for `auto:build`-only records
- how it was found: a transcript audit at `/claude-tweaks:specify` time, 2026-10-20
- the fix: the ask gate in this PR

Cost paragraph: ~7.4h stall, plus a misdirected fix (#2734's build) shipped against the wrong cause.

- [ ] **Step 2: Add the donts.md rule**

- [ ] **Step 3: Verify**

Run: `grep -c "IL-167" docs/incident-log.md`
Expected: `1` or more.

Run: `grep -c "b41eb7b0" docs/incident-log.md` (AC7.1)
Expected: `1` or more.

- [ ] **Step 4: Commit**

```bash
git add docs/incident-log.md docs/donts.md
git commit -m "Record IL-167 — unattended Review Console asked anyway and #2734 misdiagnosed the stall" -m "Refs #3712"
```

### Task 5 (orchestrator, not a subagent): Correct #2734's record

- [ ] **Step 1:** After Task 4's commit is pushed, post one comment on #2734 with `gh issue comment 2734 --body-file <session tmp file>`. The comment says the diagnosis was wrong. It links #3712, PR #3749, and the IL-167 entry on the branch, and says the `pre-authorize-merge` token stays rather than being reverted.
- [ ] **Step 2 (AC8.1):** Verify with `gh issue view 2734 --json comments --jq '.comments[-1].body'` that the comment contains `#3712` and `IL-167`. Log it to `decisions.md`.

### Final verification

Run (AC9.1): `npm test > {session-tmp}/npm-test-3712.txt 2>&1; echo exit=$?`, then read the summary from the file.
Expected: `exit=0`. Any failure gets checked against `main`'s own CI red (reconcile reported main's tip red at run start) before it's treated as this branch's.

Waived AC8.1: an orchestrator gh comment, not code — verified by Task 5 Step 2 reading the comment back.
Waived AC9.1: the full suite itself, not a test step — verified by the Final verification run above.
