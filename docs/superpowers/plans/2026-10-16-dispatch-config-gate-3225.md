# Dispatch config.yml commit gate (#3225) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `/claude-tweaks:dispatch` run is bound to its group's worktree before call 1, with `dispatched: true` set (`hooks.js record-worktree --dispatch`). A new PreToolUse gate (`checkDispatchConfigGate`) then denies any Bash git write in that bound worktree until `/claude-tweaks:flow` Step 3 has written `{runDir}/config.yml`.

**Architecture:** There are two halves. The first is a `--dispatch` flag on the existing `record-worktree` CLI verb, which adds `dispatched: true` to the same single `run-state.json` read-modify-write. The second is a new deny gate in `pre-tool-use.js`, wired immediately before `checkBookkeepingStampsGate`. The gate resolves the run through `ctx.ownedRun` (session id AND worktree binding) plus `classifyOwnership === 'mine'`. It never uses `ctx.runDir`. Prose wiring goes into `dispatch/sibling-session-check.md`, and the gate is documented in `docs/hooks.md`.

**Tech Stack:** Node 18+, CommonJS, `node --test` (built-in, no deps).

**Spec:** `.claude-tweaks/pipelines/2026-10-16T190603-record-3225/work/3225-spec.md` (record #3225)

## Build-time facts (already established — do not re-derive)

- **Premise probe: CONFIRMED (with one sub-claim reversed)**, run live at plan time and logged in `decisions.md`. A throwaway Task subagent in this worktree reported the same `CLAUDE_CODE_SESSION_ID` and cwd as the dispatching session. From both of them, `ctxLib.resolveRun(cwd, env, sessionId)` resolved run `2026-10-16T190603-record-3225` with attribution `session`, and `findRunByWorktreePath` agreed. **Reversed:** the session-agnostic `ctx.runDir` (`resolveRunDir(cwd, env)` with no session id, which is what `checkBookkeepingStampsGate` keys on) resolved an **unrelated newer sibling run** (`2026-10-16T191151-record-3028`) from both callers. The new gate MUST read `ctx.ownedRun`, never `ctx.runDir`.
- **Named-location drift:** the record says dispatch Step 5 "already issues" a `record-worktree` call. It does not. The only `record-worktree` in `plugin/skills/dispatch/` is `task-prompt.md`'s re-stamp on a denied commit. The `--dispatch` bind is therefore a **new** call in `sibling-session-check.md`, not a flag on an existing call.
- **Behavioral-claim reversal:** the record says reusing `commandGitTargets` "also catches `--amend`, a merge, or a `rebase --continue`". `gitTargetsFrom` (`plugin/bin/lib/hooks/git-command.js:435-441`) classifies only `commit` (which includes `--amend`), `push`, `mv`, `rm`, `update-ref`, and `apply`. It does **not** classify `merge` or `rebase`. This plan reuses the classification unchanged, as the record instructs, for the same scope `checkBookkeepingStampsGate` has. The docs must state the real scope.
- `bin/hooks.js` `main()` builds `ctx.ownedRun = ctxLib.resolveRun(cwd, process.env, input.session_id)` (`plugin/bin/hooks.js` ~line 1584) and passes it into `pre-tool-use.js`'s `run(ctx)`.

## Global Constraints

- Node 18+, no new dependencies; tests use `node:test` + `node:assert` only.
- Never-break-a-session: every PreToolUse path exits 0; a deny is only `hookSpecificOutput.permissionDecision: 'deny'` via the existing `denyResult(reason)` helper.
- The gate is purely additive. A run without `dispatched: true` must see byte-identical behavior.
- Hand-written commit message style: `{Verb} {what} — {detail} (refs #3225)`. Never write `closes`/`fixes #3225`.
- Working directory discipline: before every commit run `pwd` and `git rev-parse --show-toplevel`. Both must be `/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude/worktrees/record-3225`. Use `git -C "<that path>" …`, stage specific files only, and never `git stash`.
- Deny reason cause literal, verbatim: `` `/claude-tweaks:flow` Step 3 (Manifesto) has not written config.yml ``.

## Review Focus

1. **Sibling run wins `ctx.runDir`.** With a dispatched run bound to the worktree, `ctx.runDir` points at an unrelated sibling run. The gate must still deny based on `ctx.ownedRun`. This is pinned in Task 2 (sibling-runDir test).
2. **Re-stamp after bind.** `task-prompt.md`'s plain `record-worktree` re-stamp runs after a denied commit. It must not clear `dispatched`, because the marker is permanent. Pinned in Task 1 (permanence test).
3. **Git write targeting a different repo.** `git -C /other/repo commit` issued from inside the bound worktree is not this run's work, so the gate allows it. Pinned in Task 2.
4. **Caller in a different linked worktree of the same project.** A caller whose cwd is a different linked worktree than the binding gets `classifyOwnership` 'foreign', so the gate allows. Pinned in Task 2.
5. **Out-of-order first call self-corrects.** The commit is denied, `config.yml` is then written, and the identical command is allowed with nothing about the commit changed. Pinned in Task 2's ordering fixture.

(Known, accepted limit, not tested: a cwd-pinned dispatching session (#447) runs Task calls via a `cd {worktree} &&` prefix. Their hook payload cwd is the pinned session cwd, not the worktree, so the gate fails open there. The #2837 artifact check remains the backstop.)

---

### Task 1: `record-worktree --dispatch` flag

**Files:**
- Modify: `plugin/bin/hooks.js:103` (USAGE entry), `plugin/bin/hooks.js:137` (KNOWN_FLAGS entry), `plugin/bin/hooks.js:636-700` (the `record-worktree` handler)
- Test: `tests/hooks-dispatcher.test.js` (append new tests at end of file; update the exact-string usage pin at line 283)

**Interfaces:**
- Consumes: `ctxLib.writeRunState(runDir, patch)` (shallow-merges `patch` over the existing state, adds `updatedAt`).
- Produces: CLI `node plugin/bin/hooks.js record-worktree --run <dir> <worktree-path> [--dispatch]`. With `--dispatch`, `run-state.json` gains `dispatched: true` in the same write as `worktree`/`status`/`sessionId`. The flag may appear anywhere in the argument list. Without it the patch is unchanged and no `dispatched` key is written (a plain re-stamp never clears an existing `dispatched: true`). Task 2 reads the field `dispatched` (boolean `true`).

- [ ] **Step 1: Write the failing tests** — append to the end of `tests/hooks-dispatcher.test.js`:

```js
// #3225: record-worktree --dispatch — dispatch Step 5 binds the minted run to
// the group's worktree BEFORE call 1 and marks it dispatched, in ONE
// read-modify-write of run-state.json (sibling-session-check.md).
test('#3225: record-worktree --dispatch writes dispatched: true in the same call as the worktree assignment', () => {
  const project = tmpProject();
  const run = path.join(project, '.claude-tweaks', 'pipelines', '2026-07-01T090000-spec-1');
  const r = runHook(['record-worktree', '--run', run, '/tmp/wt-3225', '--dispatch'], { cwd: project });
  assert.strictEqual(r.code, 0);
  assert.match(r.stdout, /claude-tweaks: worktree recorded for 2026-07-01T090000-spec-1/);
  const s = readRunState(run);
  assert.strictEqual(s.worktree, path.resolve('/tmp/wt-3225'));
  assert.strictEqual(s.status, 'active');
  assert.strictEqual(s.dispatched, true);
});

test('#3225: --dispatch is accepted before the worktree positional too, and never read as the worktree path', () => {
  const project = tmpProject();
  const run = path.join(project, '.claude-tweaks', 'pipelines', '2026-07-01T090000-spec-1');
  const r = runHook(['record-worktree', '--run', run, '--dispatch', '/tmp/wt-3225b'], { cwd: project });
  assert.strictEqual(r.code, 0);
  const s = readRunState(run);
  assert.strictEqual(s.worktree, path.resolve('/tmp/wt-3225b'));
  assert.strictEqual(s.dispatched, true);
});

test('#3225: --dispatch preserves every pre-existing field and writes exactly what a plain record-worktree writes, plus dispatched', () => {
  const project = tmpProject();
  const seed = {
    status: 'interrupted',
    pr: { number: 7, url: 'https://example.invalid/pull/7', branch: 'b-7' },
    claimExempt: true,
    prExempt: false,
    lastEvent: 'seeded',
  };
  const mk = (name) => {
    const run = path.join(project, '.claude-tweaks', 'pipelines', name);
    fs.mkdirSync(run, { recursive: true });
    fs.writeFileSync(path.join(run, 'run-state.json'), JSON.stringify(seed));
    return run;
  };
  const plainRun = mk('2026-07-01T090001-spec-2');
  const dispRun = mk('2026-07-01T090002-spec-3');
  const env = { CLAUDE_CODE_SESSION_ID: 'sess-3225' };
  assert.strictEqual(runHook(['record-worktree', '--run', plainRun, '/tmp/wt-same'], { cwd: project, env }).code, 0);
  assert.strictEqual(runHook(['record-worktree', '--run', dispRun, '/tmp/wt-same', '--dispatch'], { cwd: project, env }).code, 0);
  const plain = readRunState(plainRun);
  const disp = readRunState(dispRun);
  assert.strictEqual(plain.dispatched, undefined, 'a plain record-worktree must not write a dispatched key');
  assert.strictEqual(disp.dispatched, true);
  const strip = (s) => { const { updatedAt, dispatched, ...rest } = s; return rest; };
  assert.strictEqual(JSON.stringify(strip(disp)), JSON.stringify(strip(plain)),
    'apart from dispatched/updatedAt, --dispatch must write byte-for-byte what a plain call writes');
  assert.deepStrictEqual(disp.pr, seed.pr);
  assert.strictEqual(disp.claimExempt, true);
  assert.strictEqual(disp.prExempt, false);
  assert.strictEqual(disp.lastEvent, 'seeded');
  assert.strictEqual(disp.sessionId, 'sess-3225');
});

test('#3225: dispatched is permanent — a later plain record-worktree re-stamp (task-prompt.md) never clears it', () => {
  const project = tmpProject();
  const run = path.join(project, '.claude-tweaks', 'pipelines', '2026-07-01T090000-spec-1');
  assert.strictEqual(runHook(['record-worktree', '--run', run, '/tmp/wt-perm', '--dispatch'], { cwd: project }).code, 0);
  assert.strictEqual(runHook(['record-worktree', '--run', run, '/tmp/wt-perm'], { cwd: project }).code, 0);
  assert.strictEqual(readRunState(run).dispatched, true);
});
```

Also update the existing exact-string pin at `tests/hooks-dispatcher.test.js:283`, because the USAGE string gains `[--dispatch]`:

```js
  assert.strictEqual(result.stdout, 'claude-tweaks: usage: record-worktree --run <dir> <worktree-path> [--dispatch]\n');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test --test-name-pattern="3225|KNOWN_FLAGS guard" tests/hooks-dispatcher.test.js`
Expected: FAIL. The `#3225` tests fail because `--dispatch` is an undeclared flag: the KNOWN_FLAGS guard prints usage, exits 0, and writes nothing, so the `readRunState` assertions fail. The updated line-283 pin fails on the old usage string.

- [ ] **Step 3: Write minimal implementation** in `plugin/bin/hooks.js`:

USAGE (line 103):
```js
  'record-worktree': 'record-worktree --run <dir> <worktree-path> [--dispatch]',
```

KNOWN_FLAGS (line 137). `--dispatch` is boolean, so it is deliberately NOT added to `VALUE_FLAGS`:
```js
  'record-worktree': ['--run', '--dispatch'],
```

In the `record-worktree` handler, replace `const worktreeArg = rest[0];` with:
```js
    // #3225: `--dispatch` (boolean, any position) marks the run as bound by
    // /claude-tweaks:dispatch before call 1 — checkDispatchConfigGate
    // (bin/lib/hooks/pre-tool-use.js) then denies git writes in this worktree
    // until /claude-tweaks:flow Step 3 writes config.yml. Stripped before the
    // positional lookup so it can never be read as the worktree path.
    const dispatch = rest.includes('--dispatch');
    const positional = rest.filter((a) => a !== '--dispatch');
    const worktreeArg = positional[0];
```

and, in the write branch, directly after the `sessionId` line:
```js
      if (process.env.CLAUDE_CODE_SESSION_ID) patch.sessionId = process.env.CLAUDE_CODE_SESSION_ID;
      // Permanent for the run's lifetime: only ever written true, never
      // false, so a later plain re-stamp (no --dispatch) cannot clear it.
      if (dispatch) patch.dispatched = true;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/hooks-dispatcher.test.js tests/hooks-help-guard.test.js`
Expected: PASS (all tests, including the pre-existing record-worktree and help-guard suites).

- [ ] **Step 5: Commit**

```bash
git -C "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude/worktrees/record-3225" add plugin/bin/hooks.js tests/hooks-dispatcher.test.js
git -C "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude/worktrees/record-3225" commit -m "Add record-worktree --dispatch — one run-state write binds the worktree and marks the run dispatched (refs #3225)"
```

---

### Task 2: `checkDispatchConfigGate` in `pre-tool-use.js`

**Files:**
- Modify: `plugin/bin/lib/hooks/pre-tool-use.js`. Add the new function directly above `function runInner(` (~line 1936), wire it in `runInner` immediately before the `checkBookkeepingStampsGate` call (~line 1960), and export it (~line 2120 `module.exports`).
- Test: `tests/hooks-pre-tool-use.test.js` (append at end of file)

**Interfaces:**
- Consumes: the `run-state.json` field `dispatched: true` (Task 1); `ctx.ownedRun = { dir, attribution }` (built by `bin/hooks.js` `main()`); existing in-file helpers `denyResult(reason)`, `toplevel(dir)`, `safeReal(p)`; `wtDetect.repoInfo(cwd)` → `{ repoRoot, isLinkedWorktree, indeterminate }`; `ctxLib.readRunState(dir)` (returns `null` on a missing or malformed file); `ctxLib.classifyOwnership({ sessionId, cwd }, state)` → `'mine' | 'foreign' | 'indeterminate'`; `ctxLib.appendEvent(dir, type, data, attribution)`.
- Produces: `checkDispatchConfigGate(ctx, commandGitTargets)` → `{}` (allow) or `denyResult(...)`. It is exported from `pre-tool-use.js`. The deny reason contains the literal `` `/claude-tweaks:flow` Step 3 (Manifesto) has not written config.yml `` (Task 3's conformance test pins this literal in the source).

Reachability: the tests drive `pre.run(ctx)`, not the function directly. The gate is reached past `checkTeardownGate`, `checkPipelineShadowGuard`, `checkWorktreeRequired`, and `checkPowershellOpaqueCommand`, and it runs before `checkBookkeepingStampsGate` and E1. Fixtures pass `runDir: null, runState: null` (or an unrelated sibling run). That matches the probe-measured shape, where the session-agnostic resolution does not name this run, so E1 and the stamps gate stay no-ops and any deny observed is this gate's own.

- [ ] **Step 1: Write the failing tests** — append to the end of `tests/hooks-pre-tool-use.test.js`:

```js
// #3225: checkDispatchConfigGate — a dispatched run (record-worktree
// --dispatch) bound to a REAL linked worktree denies git writes there until
// /claude-tweaks:flow Step 3 writes {runDir}/config.yml. Every fixture hands
// the gate its run via ctx.ownedRun ONLY (runDir null or an unrelated
// sibling): #3225's premise probe measured the session-agnostic ctx.runDir
// resolving an unrelated sibling run from inside a bound worktree.
const DISPATCH_SID = 'sess-3225';
const DISPATCH_CAUSE = /`\/claude-tweaks:flow` Step 3 \(Manifesto\) has not written config\.yml/;
function dispatchedRun(wt, { marked = true, config = false, status = 'active', sessionId = DISPATCH_SID, rawState } = {}) {
  const project = tmpProject();
  const run = path.join(project, '.claude-tweaks', 'pipelines', '2026-10-16T190603-record-3225');
  fs.mkdirSync(run, { recursive: true });
  const state = { status, worktree: wt, sessionId, ...(marked ? { dispatched: true } : {}) };
  fs.writeFileSync(path.join(run, 'run-state.json'), rawState !== undefined ? rawState : JSON.stringify(state));
  if (config) fs.writeFileSync(path.join(run, 'config.yml'), 'mode: auto\n');
  return run;
}
const dispatchInput = (cwd, command = 'git commit -m "Materialize #3225 spec"') => ({ ...bashInput(command, cwd), session_id: DISPATCH_SID });
const dispatchCtx = (run, cwd, input, extra = {}) => ({
  input, runDir: null, runState: null, ownedRun: { dir: run, attribution: 'session' }, cwd, ...extra,
});
const isDeny = (out) => Boolean(out && out.json && out.json.hookSpecificOutput
  && out.json.hookSpecificOutput.permissionDecision === 'deny');

test('#3225 dispatch config gate: dispatched run, no config.yml, git write in the bound worktree -> deny naming cause and remedy', () => {
  const { wt } = mainAndWorktree();
  const run = dispatchedRun(wt);
  for (const command of ['git commit -m "Materialize #3225 spec"', 'git commit --amend --no-edit', `git -C "${wt}" push origin HEAD`]) {
    const out = pre.run(dispatchCtx(run, wt, dispatchInput(wt, command)));
    assert.ok(isDeny(out), `expected a deny for: ${command}`);
    const reason = out.json.hookSpecificOutput.permissionDecisionReason;
    assert.match(reason, DISPATCH_CAUSE);
    assert.match(reason, /Skill tool/);
    assert.match(reason, /retry this same command unchanged/);
    assert.ok(reason.includes(path.join(run, 'config.yml')), 'reason names the missing config.yml path');
  }
});

test('#3225 dispatch config gate: config.yml exists -> allow', () => {
  const { wt } = mainAndWorktree();
  const run = dispatchedRun(wt, { config: true });
  assert.deepStrictEqual(pre.run(dispatchCtx(run, wt, dispatchInput(wt))), {});
});

test('#3225 dispatch config gate: run-state.json has no dispatched marker -> allow (standalone /build record-mode run)', () => {
  const { wt } = mainAndWorktree();
  const run = dispatchedRun(wt, { marked: false });
  assert.deepStrictEqual(pre.run(dispatchCtx(run, wt, dispatchInput(wt))), {});
});

test('#3225 dispatch config gate: clean run -> allow', () => {
  const { wt } = mainAndWorktree();
  const run = dispatchedRun(wt, { status: 'clean' });
  assert.deepStrictEqual(pre.run(dispatchCtx(run, wt, dispatchInput(wt))), {});
});

test('#3225 dispatch config gate: caller outside any linked worktree (main checkout) -> allow', () => {
  const { main, wt } = mainAndWorktree();
  const run = dispatchedRun(wt);
  assert.deepStrictEqual(pre.run(dispatchCtx(run, main, dispatchInput(main))), {});
});

test('#3225 dispatch config gate: unreadable or malformed run-state.json -> fail open (no deny, no throw)', () => {
  const { wt } = mainAndWorktree();
  const malformed = dispatchedRun(wt, { rawState: '{"dispatched": true, not json' });
  assert.deepStrictEqual(pre.run(dispatchCtx(malformed, wt, dispatchInput(wt))), {});
  const unreadable = dispatchedRun(wt);
  fs.rmSync(path.join(unreadable, 'run-state.json'));
  fs.mkdirSync(path.join(unreadable, 'run-state.json')); // a directory: readFileSync throws EISDIR
  assert.deepStrictEqual(pre.run(dispatchCtx(unreadable, wt, dispatchInput(wt))), {});
});

test('#3225 dispatch config gate: keys on ctx.ownedRun, not ctx.runDir — an unrelated sibling run in ctx.runDir does not disarm it', () => {
  const { wt } = mainAndWorktree();
  const run = dispatchedRun(wt);
  const sibling = path.join(tmpProject(), '.claude-tweaks', 'pipelines', '2026-10-16T191151-record-3028');
  fs.mkdirSync(sibling, { recursive: true });
  fs.writeFileSync(path.join(sibling, 'decisions.md'), '');
  const out = pre.run(dispatchCtx(run, wt, dispatchInput(wt), { runDir: sibling, runState: null }));
  assert.ok(isDeny(out));
  assert.match(out.json.hookSpecificOutput.permissionDecisionReason, DISPATCH_CAUSE);
});

test('#3225 dispatch config gate: git write targeting an unrelated repo from inside the bound worktree -> allow', () => {
  const { wt } = mainAndWorktree();
  const other = gitRepoWithCommit();
  const run = dispatchedRun(wt);
  const out = pre.run(dispatchCtx(run, wt, dispatchInput(wt, `git -C "${other}" commit --allow-empty -m x`)));
  assert.ok(!isDeny(out), 'a foreign-repo target is not this run\'s work');
});

test('#3225 dispatch config gate: caller in a different linked worktree than the binding -> allow (classifyOwnership foreign)', () => {
  const { main, wt } = mainAndWorktree();
  const otherWt = linkedWorktreeOf(main);
  const run = dispatchedRun(wt);
  assert.deepStrictEqual(pre.run(dispatchCtx(run, otherWt, dispatchInput(otherWt))), {});
});

test('#3225 dispatch config gate: non-write Bash (git status) and file tools are out of scope -> allow', () => {
  const { wt } = mainAndWorktree();
  const run = dispatchedRun(wt);
  assert.deepStrictEqual(pre.run(dispatchCtx(run, wt, dispatchInput(wt, 'git status'))), {});
  const edit = { tool_name: 'Edit', tool_input: { file_path: path.join(wt, 'x.js'), old_string: 'a', new_string: 'b' }, cwd: wt, session_id: DISPATCH_SID };
  assert.ok(!isDeny(pre.run(dispatchCtx(run, wt, edit))));
});

test('#3225 ordering fixture: documented order (Step 3 writes config.yml, then Step 4 materialize commit) is never denied', () => {
  const { wt } = mainAndWorktree();
  const run = dispatchedRun(wt);
  fs.writeFileSync(path.join(run, 'config.yml'), 'mode: auto\n'); // Step 3 Manifesto
  const rel = path.join('.claude-tweaks', 'pipelines', '2026-10-16T190603-record-3225', 'work', '3225-spec.md');
  fs.mkdirSync(path.dirname(path.join(wt, rel)), { recursive: true });
  fs.writeFileSync(path.join(wt, rel), '---\nrecord: 3225\n---\nbody\n');
  execFileSync('git', ['-C', wt, 'add', '-f', rel]);
  const out = pre.run(dispatchCtx(run, wt, dispatchInput(wt))); // Step 4 materialize commit
  assert.deepStrictEqual(out, {});
  execFileSync('git', ['-C', wt, 'commit', '-q', '-m', 'Materialize #3225 spec']);
});

test('#3225 ordering fixture: out-of-order first call (#3064/#3066 shape — commit before config.yml) is denied, then the same command passes once Step 3 writes config.yml', () => {
  const { wt } = mainAndWorktree();
  const run = dispatchedRun(wt);
  const input = dispatchInput(wt);
  const denied = pre.run(dispatchCtx(run, wt, input));
  assert.ok(isDeny(denied));
  const reason = denied.json.hookSpecificOutput.permissionDecisionReason;
  assert.match(reason, DISPATCH_CAUSE);
  assert.match(reason, /Step 3/);
  assert.match(reason, /retry this same command unchanged/);
  fs.writeFileSync(path.join(run, 'config.yml'), 'mode: auto\n'); // the remedy
  assert.deepStrictEqual(pre.run(dispatchCtx(run, wt, input)), {}, 'the identical, unchanged command now passes');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test --test-name-pattern="3225" tests/hooks-pre-tool-use.test.js`
Expected: FAIL. The deny-expecting tests (first, sibling-runDir, out-of-order) fail because no gate exists yet and `pre.run` returns `{}`.

- [ ] **Step 3: Write minimal implementation** in `plugin/bin/lib/hooks/pre-tool-use.js`.

Add directly above `function runInner(`:

```js
// #3225: dispatch config gate (block tier). /claude-tweaks:dispatch Step 5
// binds the group's minted run dir to its worktree BEFORE call 1 with
// `hooks.js record-worktree --run <dir> <wt> --dispatch`
// (dispatch/sibling-session-check.md), stamping a permanent `dispatched: true`.
// Until /claude-tweaks:flow Step 3's Manifesto writes {runDir}/config.yml,
// every Bash git write (the same commandGitTargets classification
// checkBookkeepingStampsGate uses: commit incl. --amend, push, mv, rm,
// update-ref, apply — not merge/rebase) in that bound worktree is denied, so a
// first call that bypassed /flow is stopped at its first commit instead of
// after a full build. The #2837 post-hoc first-call artifact check
// (dispatch/two-call-gate.md) stays the backstop for a call that hand-writes
// config.yml.
//
// Resolution is ctx.ownedRun (resolveRun: session id AND recorded worktree
// binding, #1098/#1099) plus classifyOwnership === 'mine' — NEVER ctx.runDir.
// #3225's premise probe measured ctx.runDir (the session-agnostic newest
// non-terminal run) resolving an unrelated sibling run from inside a bound
// worktree, from both the dispatching session and its Task subagent.
//
// A deny needs positive evidence on every axis; anything unprovable is a
// no-op (never-break-a-session): no owned run, an unreadable or malformed
// run-state.json, no `dispatched: true` marker (every non-dispatched run,
// including a standalone /build record-mode run that legitimately has no
// config.yml), a `clean` run, a caller outside a linked worktree or an
// indeterminate git answer, a binding that is not provably the caller's own
// worktree, or no git-write target inside that worktree.
function dispatchConfigDenyReason(configPath) {
  return 'claude-tweaks: git write blocked — `/claude-tweaks:flow` Step 3 (Manifesto) has not written config.yml '
    + `for this dispatched run (${configPath} is missing). This worktree is bound to a /claude-tweaks:dispatch run `
    + '(run-state.json `dispatched: true`), so its first call must run /claude-tweaks:flow, whose Step 3 writes '
    + 'config.yml before Step 4\'s materialize commit. Remedy: invoke /claude-tweaks:flow via the Skill tool and let '
    + 'its Step 3 write config.yml (never hand-write config.yml or edit run-state.json), then retry this same command '
    + 'unchanged — nothing about the commit itself needs to change.';
}

function checkDispatchConfigGate(ctx, commandGitTargets) {
  const toolName = ctx.input && ctx.input.tool_name;
  if (toolName !== 'Bash' || !Array.isArray(commandGitTargets) || commandGitTargets.length === 0) return {};
  const owned = ctx.ownedRun || {};
  if (typeof owned.dir !== 'string' || !owned.dir) return {};
  const state = ctxLib.readRunState(owned.dir);
  if (!state || typeof state !== 'object' || state.dispatched !== true) return {};
  if (state.status === 'clean') return {};
  const cwd = typeof ctx.cwd === 'string' ? ctx.cwd : '';
  if (!cwd || !path.isAbsolute(cwd)) return {};
  const { repoRoot: wtRoot, isLinkedWorktree, indeterminate } = wtDetect.repoInfo(cwd);
  if (indeterminate || !wtRoot || !isLinkedWorktree) return {};
  const sessionId = ctx.input && typeof ctx.input.session_id === 'string' ? ctx.input.session_id : null;
  if (ctxLib.classifyOwnership({ sessionId, cwd }, state) !== 'mine') return {};
  const bound = safeReal(wtRoot);
  if (!bound) return {};
  const hitsBound = commandGitTargets.some((t) => {
    const top = t && t.dir ? toplevel(t.dir) : null;
    return Boolean(top) && safeReal(top) === bound;
  });
  if (!hitsBound) return {};
  const configPath = path.join(owned.dir, 'config.yml');
  if (fs.existsSync(configPath)) return {};
  const testTag = process.env.CT_HOOKS_TEST_MODE === '1' ? { test: true } : null;
  ctxLib.appendEvent(owned.dir, 'gate-denial', { tool: 'Bash', gate: 'dispatch-config', worktree: bound, ...testTag }, owned.attribution);
  return denyResult(dispatchConfigDenyReason(configPath));
}
```

In `runInner`, immediately before `const stamps = checkBookkeepingStampsGate(ctx, commandGitTargets, deps, warnings);`:

```js
  // #3225: before the stamps gate — config.yml is Step 3's write, which the
  // documented order puts ahead of every stamp-bearing commit.
  const dispatchConfig = checkDispatchConfigGate(ctx, commandGitTargets);
  if (dispatchConfig.json) return dispatchConfig;
```

In `module.exports`, directly after `checkBookkeepingStampsGate,`:

```js
  checkDispatchConfigGate,
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/hooks-pre-tool-use.test.js tests/hooks-bookkeeping-stamps-gate.test.js`
Expected: PASS (all tests, including every pre-existing gate test).

- [ ] **Step 5: Prove discrimination (revert-to-red).** Comment out the two wiring lines in `runInner`, re-run `node --test --test-name-pattern="3225" tests/hooks-pre-tool-use.test.js`, and confirm only the deny-expecting `#3225` tests fail. Then restore the wiring and re-run to green. Never use `git stash`.

- [ ] **Step 6: Commit**

```bash
git -C "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude/worktrees/record-3225" add plugin/bin/lib/hooks/pre-tool-use.js tests/hooks-pre-tool-use.test.js
git -C "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude/worktrees/record-3225" commit -m "Add checkDispatchConfigGate — deny git writes in a dispatched run's worktree until flow Step 3 writes config.yml (refs #3225)"
```

---

### Task 3: Dispatch bind instruction + `docs/hooks.md` entry + prose-conformance test

**Files:**
- Modify: `plugin/skills/dispatch/sibling-session-check.md` (append to the end of its final section, `## Worktree-resume check (Step 5, #2838)`; the file is 2,989 bytes, no file-specific byte pin, and far below the shared 46,080-byte ceiling)
- Modify: `docs/hooks.md` (insert one new top-level bullet directly after the `checkBookkeepingStampsGate` bullet's last sub-bullet, "Diagnostic fields on `bookkeeping-stamp-deny` (#1798)", which is the line just before the blank line and `## Ownership`)
- Create: `tests/dispatch-config-gate-conformance.test.js`

**Interfaces:**
- Consumes: the CLI shape from Task 1 (`record-worktree --run <dir> <worktree-path> [--dispatch]`) and the deny-reason literal from Task 2.
- Produces: prose only, plus a conformance test.

- [ ] **Step 1: Write the failing test** — create `tests/dispatch-config-gate-conformance.test.js`:

```js
// tests/dispatch-config-gate-conformance.test.js — #3225 prose pins.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const CAUSE = /`\/claude-tweaks:flow` Step 3 \(Manifesto\) has not written config\.yml/;

function section(text, heading) {
  const start = text.indexOf(heading);
  assert.ok(start !== -1, `missing heading: ${heading}`);
  const next = text.indexOf('\n## ', start + heading.length);
  return text.slice(start, next === -1 ? text.length : next);
}

test('#3225: sibling-session-check.md Worktree-resume check carries the bind-before-call-1 instruction, after the resumed-worktree skip rule', () => {
  const sec = section(read('plugin/skills/dispatch/sibling-session-check.md'), '## Worktree-resume check');
  assert.match(sec, /record-worktree --run "\$GROUP_RUN_DIR" "\{worktree\}" --dispatch/);
  assert.match(sec, /before dispatching this group's first Task call/);
  const skipIdx = sec.indexOf('skip this group entirely');
  const bindIdx = sec.indexOf('--dispatch');
  assert.ok(skipIdx !== -1 && bindIdx > skipIdx,
    'the bind must follow the resumed-worktree skip rule so a sibling-owned (resumed) worktree is never bound');
  assert.match(sec, /never blocks|dispatch anyway/, 'a failed bind is logged, never a dispatch blocker');
});

test('#3225: docs/hooks.md documents checkDispatchConfigGate — trigger, resolution, scope, and cause/remedy', () => {
  const doc = read('docs/hooks.md');
  assert.match(doc, /checkDispatchConfigGate/);
  assert.match(doc, CAUSE);
  assert.match(doc, /dispatched: true/);
  assert.match(doc, /ctx\.ownedRun/);
  assert.match(doc, /retry the same command unchanged/);
  assert.match(doc, /not `merge`\/`rebase`/);
});

test('#3225: the deny reason in pre-tool-use.js carries the documented cause literal', () => {
  assert.match(read('plugin/bin/lib/hooks/pre-tool-use.js'), CAUSE);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/dispatch-config-gate-conformance.test.js`
Expected: FAIL. `sibling-session-check.md` has no `--dispatch` instruction yet, and `docs/hooks.md` does not mention `checkDispatchConfigGate`. The third test passes once Task 2 has landed.

- [ ] **Step 3: Write the prose.**

Append this to the end of `plugin/skills/dispatch/sibling-session-check.md` (a new paragraph at the end of the `## Worktree-resume check` section, after the existing "skip this group entirely" paragraph):

````markdown

**Bind the run before call 1 (#3225).** When the worktree is fresh — the resume check above did
not fire — bind this group's minted run to it from this dispatching session before dispatching this group's first Task call:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/hooks.js" record-worktree --run "$GROUP_RUN_DIR" "{worktree}" --dispatch
```

`{worktree}` is the group's worktree path — the `EnterWorktree(path:)` target, or the
`git worktree add` path for a cwd-pinned session (`sequential-execution.md`, #447). One call writes
the worktree assignment, this session's id, and a permanent `dispatched: true` marker into the
run's `run-state.json`; from then on `bin/lib/hooks/pre-tool-use.js`'s `checkDispatchConfigGate`
denies any git write in this worktree until `/claude-tweaks:flow` Step 3's Manifesto has written
`$GROUP_RUN_DIR/config.yml` — a first call that bypasses `/flow` is stopped at its first commit,
not after a full build. Expect the `claude-tweaks: worktree recorded for` confirmation line. A
failed bind never blocks dispatch: log it to this firing's own `decisions.md` and dispatch anyway —
the run then lacks the early checkpoint, and #2837's first-call artifact check (`two-call-gate.md`)
still applies.
````

Insert this bullet into `docs/hooks.md` directly after the line beginning `  - **Diagnostic fields on \`bookkeeping-stamp-deny\` (#1798).**` (as a new top-level `- ` bullet, before the blank line preceding `## Ownership`):

```markdown
- **Dispatch config gate (block tier, #3225):** `pre-tool-use.js`'s `checkDispatchConfigGate`, checked immediately before `checkBookkeepingStampsGate`, denies a Bash git write — the same `commandGitTargets` classification that gate uses (`commit` incl. `--amend`, `push`, `mv`, `rm`, `update-ref`, `apply`; not `merge`/`rebase`) — in a dispatched run's bound linked worktree while `{runDir}/config.yml` does not exist. The run is marked by `/claude-tweaks:dispatch` Step 5, which binds its minted run dir before call 1: `hooks.js record-worktree --run "$GROUP_RUN_DIR" "{worktree}" --dispatch` (`dispatch/sibling-session-check.md`'s Worktree-resume check) writes the worktree assignment, the session id, and a permanent `dispatched: true` in one `run-state.json` read-modify-write; a later plain `record-worktree` re-stamp never clears it. **Resolution:** `ctx.ownedRun` (`resolveRun` — session id AND worktree binding) plus `classifyOwnership(...) === 'mine'`, never the session-agnostic `ctx.runDir` — #3225's premise probe measured `ctx.runDir` resolving an unrelated sibling run from inside a bound worktree, from both the dispatching session and its Task subagent (which share `CLAUDE_CODE_SESSION_ID`). **Scope (each a no-op, never a deny):** no owned run; an unreadable or malformed `run-state.json`; no `dispatched: true` marker (every non-dispatched run, including a standalone `/build` record-mode run that legitimately has no `config.yml`); a `clean` run; a caller outside a linked worktree or an indeterminate git answer; a binding that is not provably the caller's own worktree; no git-write target inside that worktree. **Deny message:** names the cause — "`/claude-tweaks:flow` Step 3 (Manifesto) has not written config.yml" — and the remedy: invoke `/claude-tweaks:flow` via the Skill tool so its Step 3 writes `config.yml` (never hand-write it or edit `run-state.json`), then retry the same command unchanged. The documented order (Step 3's Manifesto before Step 4's materialize commit) never trips it; an out-of-order first call (#3064 and #3066 both committed before writing `config.yml`) is denied once and self-corrects. Logs a `gate-denial` event (`gate: 'dispatch-config'`) to the owned run. #2837's post-hoc first-call artifact check (`dispatch/two-call-gate.md`) stays the backstop for a call that hand-writes `config.yml`.
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/dispatch-config-gate-conformance.test.js tests/dispatch-sequential-execution-conformance.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git -C "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude/worktrees/record-3225" add plugin/skills/dispatch/sibling-session-check.md docs/hooks.md tests/dispatch-config-gate-conformance.test.js
git -C "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude/worktrees/record-3225" commit -m "Document the dispatch bind-before-call-1 and checkDispatchConfigGate — dispatch prose, docs/hooks.md, conformance pins (refs #3225)"
```
