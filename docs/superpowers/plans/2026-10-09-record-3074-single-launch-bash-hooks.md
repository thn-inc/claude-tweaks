# Single-Launch Bash Hook Dispatch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse `plugin/hooks/hooks.json`'s 28 if-gated `PreToolUse` and 18 if-gated `PostToolUse` `Bash` handlers to one unconditional handler per event. Uninteresting Bash commands are filtered by a dependency-light prefilter at the top of `plugin/bin/hooks.js`, which exits before any heavy module loads.

**Architecture:** A new leaf module, `plugin/bin/lib/hooks/bash-prefilter.js`, decides from the raw hook payload whether the full handler must run. It does a word scan over the command string and fails open to "run" on anything it can't read. `bin/hooks.js` consults it at the very top of the file, before its ~10 eager top-level `require`s, and `process.exit(0)`s on "skip". On "run" it hands the already-read stdin to `main()`. `hooks.json` then registers one handler per event with no `if`.

**Tech Stack:** Node 18+ CommonJS, `node --test`, no dependencies.

**Spec:** `.claude-tweaks/pipelines/2026-10-09T211504-record-3074/work/3074-spec.md` (record #3074)

**Scope keywords:** `if-matcher`, `Bash(git commit *)`, `matcher === 'Bash'`, `42.0 ms`

## Global Constraints

- Never break a session: every `bin/hooks.js` path exits 0, the new skip path included (`docs/hooks.md`).
- The prefilter must be a **superset** of the old `if` predicates. Ambiguity resolves to "run", never "skip". A false "run" costs one module load; a false "skip" silently drops enforcement.
- Pre-tool-use prefilter words: `git`, `env`, `mkdir`, plus every `WRITE_SHAPES` entry (`cp`, `mv`, `tee`, `sed`, `perl`, `install`, `ln`, `truncate`, `dd`). Import `WRITE_SHAPES` from `git-command.js`; never retype it. Post-tool-use words: `git`, `env`.
- Every `require` stays a string literal (payload-boundary test #419, `tests/payload-boundary.test.js`).
- The test runner is `node --test <file>`. On Windows, never gate a task on the full `npm test` (about 16 minutes, with a ~350-failure baseline). Run the named files.
- Commit style: `{Verb} {what} — {detail}`, ending with the trailer `Claude-Session: https://claude.ai/code/session_01DrpGJ6VbqXi552HbbA6sSN`.
- Work only inside the worktree `C:/repos/claude-tweaks/.claude/worktrees/record-3074`. Prefix every command with `cd "C:/repos/claude-tweaks/.claude/worktrees/record-3074" &&` or use `git -C`.

## Review Focus

1. **Compound and wrapped commands** (`cd x && git commit -m y`, `FOO=1 git push`, `timeout 5 git push`, `xargs git add`, `$(git rev-parse HEAD)`). Claude Code's own `if` matching splits compound commands and strips env-assignments; a first-word-only filter would silently drop the commit gate. Pinned in Task 1.
2. **Path-qualified / Windows git** (`/usr/bin/git commit`, `"C:\Program Files\Git\bin\git.exe" commit`): must run. Pinned in Task 1.
3. **Unreadable payloads** (empty stdin, malformed JSON, a JSON array, Bash with no `tool_input.command`): must run, and `hooks.js` still exits 0. Pinned in Tasks 1 and 2.
4. **Non-Bash tools reaching the same events** (`Edit`, `Write`, `NotebookEdit`, `ExitWorktree`, `Skill`, `AskUserQuestion`, `EnterWorktree`): must always run. A Bash-only filter must never skip them. Pinned in Tasks 1 and 2.
5. **Substring look-alikes** (`digit`, `gitk`, `sedate`, `envoy`, `--git-dir` as a value): may skip. They never matched an old predicate either. Only whole shell words (or path basenames) count, so `echo "git"` running is an acceptable false positive. Pinned in Task 1.

---

### Task 1: The Bash prefilter module

**Files:**
- Create: `plugin/bin/lib/hooks/bash-prefilter.js`
- Test: `tests/hooks-bash-prefilter.test.js`

**Interfaces:**
- Consumes: `WRITE_SHAPES` from `plugin/bin/lib/hooks/git-command.js` (frozen array of strings; that module requires only `path`).
- Produces (later tasks rely on these exact names):
  - `PRE_TOOL_USE_WORDS: readonly string[]`, `POST_TOOL_USE_WORDS: readonly string[]`
  - `commandWords(command: string): Set<string>`: basenames of every shell word, quotes stripped, a trailing `.exe` dropped
  - `shouldRunFull(event: string, input: object|null): boolean`
  - `earlyGate(event: string, readRaw?: () => string): null | { raw: string, skip: boolean }`: `null` for any event other than `pre-tool-use`/`post-tool-use` (stdin is NOT read then)

- [ ] **Step 1: Write the failing test**

Create `tests/hooks-bash-prefilter.test.js`:

```js
// tests/hooks-bash-prefilter.test.js
//
// #3074: hooks.json registers ONE unconditional Bash handler per event; this
// prefilter is what keeps an uninteresting Bash call from paying the full
// handler. It must be a SUPERSET of the old per-pattern `if` predicates —
// a false "skip" silently drops enforcement, a false "run" costs one module load.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const {
  PRE_TOOL_USE_WORDS, POST_TOOL_USE_WORDS, commandWords, shouldRunFull, earlyGate,
} = require('../plugin/bin/lib/hooks/bash-prefilter');
const { WRITE_SHAPES } = require('../plugin/bin/lib/hooks/git-command');

const bash = (command) => ({ tool_name: 'Bash', tool_input: { command } });

test('pre-tool-use words are git, env, mkdir plus every WRITE_SHAPES entry', () => {
  assert.deepStrictEqual([...PRE_TOOL_USE_WORDS].sort(), ['env', 'git', 'mkdir', ...WRITE_SHAPES].sort());
  assert.deepStrictEqual([...POST_TOOL_USE_WORDS].sort(), ['env', 'git']);
});

test('commandWords splits on whitespace and shell operators, strips quotes, takes basenames', () => {
  const w = commandWords('cd x && FOO=1 /usr/bin/git commit -m "y" | tee "out.txt"; echo $(git rev-parse HEAD)');
  for (const expected of ['cd', 'git', 'commit', 'tee', 'echo', 'rev-parse']) assert.ok(w.has(expected), expected);
  assert.ok(commandWords('"C:\\Program Files\\Git\\bin\\git.exe" status').has('git'));
});

for (const command of [
  'git commit -m x', 'cd x && git commit -m y', 'FOO=1 git push', 'timeout 5 git push',
  'env git commit -m x', 'env -i git commit -m x', 'env -C /x git commit -m y', 'env -u FOO git push',
  'git -c user.name=x commit -m y', 'git --exec-path=/x commit -m y', 'git --namespace=n push',
  'git -C . status', 'git worktree add ../w', 'git worktree remove ../w', '/usr/bin/git commit -m x',
  'for f in a b; do sed -i s/x/y/ "$f"; done', 'P=/tmp; cp a "$P/b"', 'mkdir -p "$TEMP/d"',
  'echo "$(git rev-parse HEAD)"', 'xargs git add < files.txt', 'git stash', 'git stash pop',
  ...WRITE_SHAPES.map((s) => `${s} a b`),
]) {
  test(`pre-tool-use runs the full handler for: ${command}`, () => {
    assert.strictEqual(shouldRunFull('pre-tool-use', bash(command)), true);
  });
}

for (const command of [
  'git commit -m x', 'cd x && git commit -m y', 'FOO=1 git push', 'env -C /x git commit -m y',
  'git -c user.name=x commit -m y', 'git worktree remove ../w', 'for n in 1 2; do git push; done',
]) {
  test(`post-tool-use runs the full handler for: ${command}`, () => {
    assert.strictEqual(shouldRunFull('post-tool-use', bash(command)), true);
  });
}

for (const command of ['echo hi', 'ls -la', 'node script.js', 'for i in 1; do echo probe-loop-$i; done',
  'echo digit gitk sedate envoy', 'gh issue view 3074', '']) {
  test(`pre-tool-use skips: ${JSON.stringify(command)}`, () => {
    assert.strictEqual(shouldRunFull('pre-tool-use', bash(command)), false);
  });
}

test('post-tool-use skips write shapes it never handled (cp/mkdir/sed)', () => {
  for (const command of ['cp a b', 'mkdir -p d', 'sed -i s/a/b/ f']) {
    assert.strictEqual(shouldRunFull('post-tool-use', bash(command)), false, command);
  }
});

test('fails open to "run" on anything it cannot read', () => {
  for (const event of ['pre-tool-use', 'post-tool-use']) {
    assert.strictEqual(shouldRunFull(event, null), true);
    assert.strictEqual(shouldRunFull(event, []), true);
    assert.strictEqual(shouldRunFull(event, { tool_name: 'Bash' }), true);
    assert.strictEqual(shouldRunFull(event, { tool_name: 'Bash', tool_input: { command: 42 } }), true);
  }
});

test('never skips a non-Bash tool', () => {
  for (const tool of ['Edit', 'Write', 'NotebookEdit', 'ExitWorktree', 'EnterWorktree', 'Skill', 'AskUserQuestion']) {
    for (const event of ['pre-tool-use', 'post-tool-use']) {
      assert.strictEqual(shouldRunFull(event, { tool_name: tool, tool_input: {} }), true, `${event} ${tool}`);
    }
  }
});

test('earlyGate reads stdin only for the two tool-use events', () => {
  let reads = 0;
  const reader = (raw) => () => { reads += 1; return raw; };
  assert.strictEqual(earlyGate('session-start', reader('{}')), null);
  assert.strictEqual(earlyGate('record-worktree', reader('{}')), null);
  assert.strictEqual(reads, 0);
  const raw = JSON.stringify(bash('echo hi'));
  assert.deepStrictEqual(earlyGate('pre-tool-use', reader(raw)), { raw, skip: true });
  assert.deepStrictEqual(earlyGate('pre-tool-use', reader('not json')), { raw: 'not json', skip: false });
  assert.deepStrictEqual(earlyGate('post-tool-use', () => { throw new Error('EAGAIN'); }), { raw: '', skip: false });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd "C:/repos/claude-tweaks/.claude/worktrees/record-3074" && node --test tests/hooks-bash-prefilter.test.js`
Expected: FAIL with `Cannot find module '../plugin/bin/lib/hooks/bash-prefilter'`

- [ ] **Step 3: Write minimal implementation**

Create `plugin/bin/lib/hooks/bash-prefilter.js`:

```js
// bin/lib/hooks/bash-prefilter.js — the "is this Bash call interesting?"
// decision, made BEFORE bin/hooks.js loads any of its heavy modules (#3074).
//
// hooks/hooks.json used to register the same `hooks.js pre-tool-use` command
// 28 times (and post-tool-use 18 times), each behind its own `if` predicate.
// When Claude Code cannot evaluate those predicates statically — any `$VAR`
// expansion, any for/while loop — it runs every one of them and does not
// deduplicate identical commands, so one Bash call launched the hook 46
// times. hooks.json now registers one unconditional handler per event, and
// this module is the filter the predicates used to be.
//
// It must stay a SUPERSET of those predicates: a false "skip" silently drops
// enforcement, a false "run" costs only the full handler's module load. So it
// scans the WHOLE command for a covered word in any position (Claude Code's
// own matcher also split compound commands and stripped `NAME=value`
// prefixes), takes path basenames (`/usr/bin/git`, `git.exe`), and resolves
// anything it cannot read to "run". It deliberately does not parse quoting —
// `echo "git"` running the full handler is an accepted false positive.
//
// Dependency-light by contract: fs plus git-command.js (which requires only
// path). Adding a heavier require here moves cost onto EVERY Bash call.
'use strict';
const fs = require('fs');
const { WRITE_SHAPES } = require('./git-command');

const PRE_TOOL_USE_WORDS = Object.freeze(['git', 'env', 'mkdir', ...WRITE_SHAPES]);
const POST_TOOL_USE_WORDS = Object.freeze(['git', 'env']);
const WORDS_BY_EVENT = Object.freeze({
  'pre-tool-use': PRE_TOOL_USE_WORDS,
  'post-tool-use': POST_TOOL_USE_WORDS,
});

const SEPARATORS = /[\s;&|()<>`{}]+/;

function commandWords(command) {
  const words = new Set();
  for (const piece of command.split(SEPARATORS)) {
    const unquoted = piece.replace(/^["'\\]+|["'\\]+$/g, '').replace(/\.exe$/i, '');
    if (!unquoted) continue;
    const cut = Math.max(unquoted.lastIndexOf('/'), unquoted.lastIndexOf('\\'));
    words.add(cut >= 0 ? unquoted.slice(cut + 1) : unquoted);
  }
  return words;
}

function shouldRunFull(event, input) {
  const covered = WORDS_BY_EVENT[event];
  if (!covered) return true;
  if (!input || typeof input !== 'object' || input.tool_name !== 'Bash') return true;
  const command = input.tool_input && input.tool_input.command;
  if (typeof command !== 'string') return true;
  const present = commandWords(command);
  return covered.some((word) => present.has(word));
}

// Reads stdin once — the caller must hand `raw` on to the full handler, since
// stdin cannot be read a second time. Returns null (and reads nothing) for
// every event this filter does not govern.
function earlyGate(event, readRaw = () => fs.readFileSync(0, 'utf8')) {
  if (!WORDS_BY_EVENT[event]) return null;
  let raw = '';
  try { raw = readRaw(); } catch { raw = ''; }
  let input = null;
  try { input = JSON.parse(raw); } catch { input = null; }
  return { raw, skip: !shouldRunFull(event, input) };
}

module.exports = { PRE_TOOL_USE_WORDS, POST_TOOL_USE_WORDS, commandWords, shouldRunFull, earlyGate };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd "C:/repos/claude-tweaks/.claude/worktrees/record-3074" && node --test tests/hooks-bash-prefilter.test.js`
Expected: PASS, 0 failures. Also run `node --test tests/payload-boundary.test.js` (the new file must sit inside `plugin/` with literal requires): PASS.

- [ ] **Step 5: Commit**

```bash
git -C "C:/repos/claude-tweaks/.claude/worktrees/record-3074" add plugin/bin/lib/hooks/bash-prefilter.js tests/hooks-bash-prefilter.test.js
git -C "C:/repos/claude-tweaks/.claude/worktrees/record-3074" commit -m "Add the Bash hook prefilter — word scan that fails open, superset of the old if predicates" -m "Claude-Session: https://claude.ai/code/session_01DrpGJ6VbqXi552HbbA6sSN"
```

---

### Task 2: Early prefilter exit in `bin/hooks.js`

**Files:**
- Modify: `plugin/bin/hooks.js:11-14` (insert the early gate between `'use strict';` and `const fs = require('fs');`) and `plugin/bin/hooks.js:1518` (`main()`'s stdin read)
- Test: `tests/hooks-bash-prefilter.test.js` (append e2e cases)

**Interfaces:**
- Consumes: `earlyGate(event)` from Task 1.
- Produces: a module-level `EARLY` (`null | { raw, skip }`). `main()` uses `EARLY.raw` instead of re-reading stdin, and only when `EARLY` came from this same process's own entry (`require.main === module`). An in-process `require('../plugin/bin/hooks.js').main(...)` from a test sees `EARLY === null` and keeps today's `ctxLib.readStdin()` path.

- [ ] **Step 1: Write the failing test**

Append to `tests/hooks-bash-prefilter.test.js`:

```js
// ── e2e: bin/hooks.js's early exit (#3074) ───────────────────────────────────
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { gitRepo, linkedWorktreeOf } = require('./helpers/git-fixtures');

const HOOKS = path.join(__dirname, '..', 'plugin', 'bin', 'hooks.js');
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-prefilter-'));
// A --require'd probe that records which modules this process loaded, so the
// test can prove the skip path never loaded the heavy ones.
const PROBE = path.join(SANDBOX, 'probe.js');
fs.writeFileSync(PROBE, "process.on('exit', () => { require('fs').writeFileSync(process.env.CT_PROBE_OUT, JSON.stringify(Object.keys(require.cache))); });\n");

function spawnHook(event, payload, { cwd = SANDBOX } = {}) {
  const out = path.join(SANDBOX, `loaded-${process.hrtime.bigint()}.json`);
  const stdout = execFileSync('node', ['--require', PROBE, HOOKS, event], {
    input: typeof payload === 'string' ? payload : JSON.stringify(payload),
    cwd, encoding: 'utf8',
    env: { ...process.env, PIPELINE_RUN_DIR: '', CT_HOOKS_TEST_MODE: '1', CT_PROBE_OUT: out },
  });
  return { stdout, loaded: JSON.parse(fs.readFileSync(out, 'utf8')) };
}
const loadedModule = (loaded, rel) => loaded.some((p) => p.replace(/\\/g, '/').endsWith(rel));

test('e2e: an uninteresting Bash call exits 0 with no output and never loads the heavy modules', () => {
  for (const event of ['pre-tool-use', 'post-tool-use']) {
    const { stdout, loaded } = spawnHook(event, { ...bash('echo hi'), cwd: SANDBOX });
    assert.strictEqual(stdout, '', event);
    assert.ok(!loadedModule(loaded, 'lib/hooks/context.js'), `${event} loaded context.js on the skip path`);
    assert.ok(!loadedModule(loaded, `lib/hooks/${event}.js`), `${event} loaded its event module on the skip path`);
  }
});

test('e2e (probe discriminates): a covered Bash call DOES load the event module', () => {
  const { loaded } = spawnHook('pre-tool-use', { ...bash('git status'), cwd: SANDBOX });
  assert.ok(loadedModule(loaded, 'lib/hooks/pre-tool-use.js'));
  assert.ok(loadedModule(loaded, 'lib/hooks/context.js'));
});

test('e2e: malformed stdin still reaches the full handler and exits 0', () => {
  const { loaded } = spawnHook('pre-tool-use', 'not json');
  assert.ok(loadedModule(loaded, 'lib/hooks/pre-tool-use.js'));
});

test('e2e: a non-Bash tool is never skipped', () => {
  const { loaded } = spawnHook('post-tool-use', { tool_name: 'Skill', tool_input: { skill: 'x' }, cwd: SANDBOX });
  assert.ok(loadedModule(loaded, 'lib/hooks/post-tool-use.js'));
});

// checkGitStashWarn (#1967) had no `Bash(git stash *)` predicate, so a plain
// `git stash` never spawned the hook and the warning was unreachable for its
// most common spelling (the #70 matcher/parser asymmetry). The prefilter's
// `git` word makes it reachable.
test('e2e: a plain `git stash` from a linked worktree now reaches checkGitStashWarn', () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  const { stdout } = spawnHook('pre-tool-use', { ...bash('git stash'), cwd: wt }, { cwd: wt });
  assert.match(stdout, /git stash is repository-wide/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd "C:/repos/claude-tweaks/.claude/worktrees/record-3074" && node --test tests/hooks-bash-prefilter.test.js`
Expected: FAIL on "an uninteresting Bash call ... never loads the heavy modules" (context.js is loaded today). The `git stash` case already passes when the hook is spawned directly; it pins the end-to-end path. Note in the task report that it does not go red here, and that its red case is Task 3's hooks.json side.

- [ ] **Step 3: Write minimal implementation**

In `plugin/bin/hooks.js`, insert directly after line 11 (`'use strict';`), before `const fs = require('fs');`:

```js
// #3074: Bash prefilter fast path. hooks.json registers ONE unconditional
// Bash handler per tool-use event, so every Bash call spawns this process —
// decide whether it is worth anything BEFORE the heavy requires below run.
// bash-prefilter.js reads stdin once; `EARLY.raw` is handed to main() so the
// full path never re-reads it. Only this process's own entry (require.main)
// takes the fast path — a test require()ing this file for USAGE/main never does.
const bashPrefilter = require('./lib/hooks/bash-prefilter');
const EARLY = require.main === module ? bashPrefilter.earlyGate(process.argv[2]) : null;
if (EARLY && EARLY.skip) process.exit(0);
```

In `main()`, replace line 1518:

```js
  const input = ctxLib.parseInput(ctxLib.readStdin());
```

with:

```js
  // #3074: stdin was already consumed by the early prefilter gate at the top
  // of this file when this process was spawned as a tool-use hook.
  const input = ctxLib.parseInput(EARLY ? EARLY.raw : ctxLib.readStdin());
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd "C:/repos/claude-tweaks/.claude/worktrees/record-3074" && node --test tests/hooks-bash-prefilter.test.js tests/hooks-dispatcher.test.js tests/hooks-pre-tool-use.test.js tests/hooks-help-guard.test.js tests/payload-boundary.test.js`
Expected: `hooks-bash-prefilter` PASS. The other four: the same failing test names (if any) as a baseline run of those four files captured BEFORE Step 3's edit. Capture it first; never use `git stash` to get one (the stash stack is shared across worktrees).

- [ ] **Step 5: Commit**

```bash
git -C "C:/repos/claude-tweaks/.claude/worktrees/record-3074" add plugin/bin/hooks.js tests/hooks-bash-prefilter.test.js
git -C "C:/repos/claude-tweaks/.claude/worktrees/record-3074" commit -m "Exit bin/hooks.js early for uninteresting Bash calls — prefilter runs before the heavy requires" -m "Claude-Session: https://claude.ai/code/session_01DrpGJ6VbqXi552HbbA6sSN"
```

---

### Task 3: Collapse `hooks.json` and retarget the layout pins

**Files:**
- Modify: `plugin/hooks/hooks.json` (the `PreToolUse` and `PostToolUse` `"matcher": "Bash"` groups)
- Modify: `tests/hooks-gate-coverage.test.js:117-145` (WRITE_SHAPES ↔ if-matcher), `:162-197` (env-git predicates), `:199-214` (`Bash(env -*)`), `:241-249` (post `git worktree`), `:251-267` (gitActions ↔ if-matcher)
- Modify: `tests/hooks-dispatcher.test.js:604-609` (`Bash(git worktree *)`), `:653-662` (PostToolUse Bash "pattern-filtered via if"), `:664-681` (VALUE_FLAGS patterns), `:770-800` (#750 "simulating if" loop)

**Interfaces:**
- Consumes: `shouldRunFull`, `PRE_TOOL_USE_WORDS` from Task 1.
- Produces: the invariant every retargeted test pins: each `Bash` group has exactly one entry, `{ "type": "command", "command": "node \"${CLAUDE_PLUGIN_ROOT}/bin/hooks.js\" {event}" }`, with no `if` key. Every shape a removed predicate named makes `shouldRunFull` return `true`.

- [ ] **Step 1: Write the failing tests (retarget the pins)**

Add a shared helper near the top of `tests/hooks-gate-coverage.test.js` (after the existing requires):

```js
const { shouldRunFull, PRE_TOOL_USE_WORDS } = require('../plugin/bin/lib/hooks/bash-prefilter');
const runsFull = (event, command) => shouldRunFull(event, { tool_name: 'Bash', tool_input: { command } });
function bashGroupOf(group) {
  const hooks = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'plugin', 'hooks', 'hooks.json'), 'utf8'));
  return hooks.hooks[group].find((e) => e.matcher === 'Bash');
}
```

Replace the test at `:117` (`every WRITE_SHAPES entry has a matching hooks.json if-matcher (#70)`) with:

```js
test('every WRITE_SHAPES entry is a pre-tool-use prefilter word, and the Bash group is one unconditional handler (#70, #3074)', () => {
  // The #70 hazard, restated for the single-handler layout: a shape the parser
  // handles but the prefilter skips is DEAD CODE — bin/hooks.js exits before
  // the parser runs — and reads exactly like working coverage.
  for (const group of ['PreToolUse', 'PostToolUse']) {
    const g = bashGroupOf(group);
    assert.ok(g, `${group} must carry a Bash matcher group`);
    assert.strictEqual(g.hooks.length, 1, `${group}'s Bash group must be ONE handler — per-pattern entries fan out 28x/18x when Claude Code cannot evaluate them (#3074)`);
    assert.ok(!('if' in g.hooks[0]), `${group}'s Bash handler must carry no "if" — the prefilter in bin/hooks.js replaces it`);
  }
  for (const shape of WRITE_SHAPES) {
    assert.ok(PRE_TOOL_USE_WORDS.includes(shape),
      `WRITE_SHAPES includes '${shape}' but the pre-tool-use prefilter skips it — the parser branch is dead code`);
    assert.strictEqual(runsFull('pre-tool-use', `${shape} a b`), true, shape);
  }
});
```

In the `#590` env-git test (`:162`), replace the `for (const group of ['PreToolUse', 'PostToolUse']) { ... ifs.includes(predicate) ... }` block with the following, keeping the parser-side asserts unchanged:

```js
  for (const event of ['pre-tool-use', 'post-tool-use']) {
    for (const command of ['env git commit -m x', 'env git push', 'env git -C . commit -m x',
      'env git -c a=b commit -m x', 'env git --exec-path=/x commit -m x', 'env git --namespace=n push']) {
      assert.strictEqual(runsFull(event, command), true,
        `${event}'s prefilter skips '${command}' — gitTargets recognizes this 'env git' shape but the handler would never run for it`);
    }
  }
```

and delete its now-unused `ENV_GIT_PREDICATES` constant. Retitle it to `every env-git shape gitTargets resolves reaches the full handler, in both events (#590, #3074)`.

In the `Bash(env -*)` test (`:199`), replace the hooks.json loop with:

```js
  for (const event of ['pre-tool-use', 'post-tool-use']) {
    for (const command of ['env -C /main-checkout git commit -m "x"', 'env -u FOO git push', 'env -i git commit -m x']) {
      assert.strictEqual(runsFull(event, command), true, `${event} skips '${command}'`);
    }
  }
```

and retitle it `env-with-flags git shapes reach the full handler, in both events (#3074)`.

Replace the post `git worktree` test (`:241`) body with:

```js
  assert.strictEqual(runsFull('post-tool-use', 'git worktree remove ../w'), true,
    'post-tool-use skips a raw `git worktree remove` — checkPostTeardownReanchor would never run for it');
```

retitled `post-tool-use's prefilter runs the full handler for a raw \`git worktree\` command (#703, #3074)`.

Replace the gitActions test (`:258`) body's hooks.json loop with:

```js
  for (const event of ['pre-tool-use', 'post-tool-use']) {
    for (const action of GATE_COVERAGE.gitActions) {
      assert.strictEqual(runsFull(event, `git ${action} x`), true,
        `${event}'s prefilter skips 'git ${action}' — GATE_COVERAGE.gitActions includes it but the handler would never run`);
    }
  }
```

retitled `every GATE_COVERAGE.gitActions entry reaches the full handler, in both events (#976, #3074)`.

In `tests/hooks-dispatcher.test.js`, add `const { shouldRunFull } = require('../plugin/bin/lib/hooks/bash-prefilter');` to the requires. Then:

- `:604` test becomes `"hooks.json's PreToolUse Bash handler is unconditional and the prefilter covers git worktree"`:
  ```js
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'plugin', 'hooks', 'hooks.json'), 'utf8'));
  const bashEntry = config.hooks.PreToolUse.find((e) => e.matcher === 'Bash');
  assert.strictEqual(bashEntry.hooks.length, 1);
  assert.ok(!('if' in bashEntry.hooks[0]));
  assert.strictEqual(shouldRunFull('pre-tool-use', { tool_name: 'Bash', tool_input: { command: 'git worktree add ../w' } }), true);
  ```
- `:653` test becomes `'hooks.json registers ONE unconditional PostToolUse handler for Bash (#3074)'`: assert `bashEntry.hooks.length === 1`, `type === 'command'`, `!('if' in hook)`, command matches `/bin\/hooks\.js" post-tool-use$/`.
- `:664` VALUE_FLAGS test: replace the `ifs.includes(pattern)` loop with `shouldRunFull` over `['git -c user.name=x commit -m y', 'git --exec-path=/x commit -m y', 'git --namespace=n push']` for both `pre-tool-use` and `post-tool-use`, each asserted `true`. Keep the explanatory comment and amend its last sentence to say the prefilter now plays the matcher's role.
- `:770` #750 test: replace `assert.ok(bashEntry.hooks.length > 10, ...)` and the `for (const { if: ifPattern } of bashEntry.hooks)` loop with a single invocation (the one handler) plus an explicit repeat count of 28. That reproduces the old worst-case fan-out, so the invariant "no burst of gate-denial events" stays pinned:
  ```js
  assert.strictEqual(bashEntry.hooks.length, 1, 'one unconditional handler (#3074)');
  for (let i = 0; i < 28; i += 1) { // the pre-#3074 fan-out count, kept as a stress repeat
    const result = runHook(['pre-tool-use'], {
      input: JSON.stringify({ tool_name: 'Bash', tool_input: { command: compoundCommand } }),
      cwd: project,
    });
    assert.strictEqual(result.code, 0);
    assert.doesNotMatch(result.stdout, /"permissionDecision":"deny"/);
  }
  ```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd "C:/repos/claude-tweaks/.claude/worktrees/record-3074" && node --test tests/hooks-gate-coverage.test.js tests/hooks-dispatcher.test.js`
Expected: FAIL on the length-1/no-`if` asserts (hooks.json still has 28/18 entries).

- [ ] **Step 3: Collapse hooks.json**

Replace the whole `PreToolUse` `"matcher": "Bash"` group's `hooks` array with:

```json
        "hooks": [
          { "type": "command", "command": "node \"${CLAUDE_PLUGIN_ROOT}/bin/hooks.js\" pre-tool-use" }
        ]
```

and the `PostToolUse` `"matcher": "Bash"` group's `hooks` array with:

```json
        "hooks": [
          { "type": "command", "command": "node \"${CLAUDE_PLUGIN_ROOT}/bin/hooks.js\" post-tool-use" }
        ]
```

Touch no other group. Verify: `grep -c '"if"' plugin/hooks/hooks.json` prints `0`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd "C:/repos/claude-tweaks/.claude/worktrees/record-3074" && node --test tests/hooks-gate-coverage.test.js tests/hooks-dispatcher.test.js tests/hooks-bash-prefilter.test.js tests/payload-boundary.test.js tests/claude-plugin-root-require-conformance.test.js tests/bin-lib/code-health/candidates-dead-code.test.js`
Expected: PASS, or failures identical by test name to the pre-change baseline for files this task does not own (capture that baseline before Step 3).

- [ ] **Step 5: Commit**

```bash
git -C "C:/repos/claude-tweaks/.claude/worktrees/record-3074" add plugin/hooks/hooks.json tests/hooks-gate-coverage.test.js tests/hooks-dispatcher.test.js
git -C "C:/repos/claude-tweaks/.claude/worktrees/record-3074" commit -m "Collapse the Bash hook groups to one unconditional handler — no more 28x/18x fan-out on \$VAR and loop commands (#3074)" -m "Claude-Session: https://claude.ai/code/session_01DrpGJ6VbqXi552HbbA6sSN"
```

---

### Task 4: Measure, and pin the skip-path budget

**Files:**
- Create: `perf/hooks-prefilter.test.js`
- Scratch (not committed): a measurement script under the session temp dir

**Interfaces:**
- Consumes: Tasks 1-3 landed.
- Produces: four numbers reported verbatim in the task report, each as best-of-30 and median-of-30 ms. They are the skip path (`echo hi` Bash payload) and the full path (`git commit -m x` Bash payload, cwd a fresh non-policy git repo), each measured idle and under contention (three concurrent `node --test tests/hooks-dispatcher.test.js` runs), plus a bare `node -e ""` control for each condition. Task 5 writes these into the docs.

- [ ] **Step 1: Write the perf test**

Create `perf/hooks-prefilter.test.js`, mirroring `perf/statusline-render.test.js`'s control-subtraction shape:

```js
// Bash hook prefilter skip-path budget (#3074) — deliberately NOT part of `npm test`.
//
// Run with: npm run test:perf
//
// hooks.json registers ONE unconditional Bash handler per tool-use event, so
// EVERY Bash tool call now spawns bin/hooks.js twice (pre + post). What keeps
// that affordable is the skip path: bash-prefilter.js decides before
// bin/hooks.js's heavy requires load. This pins that the skip path stays a thin
// layer over bare Node startup. Lives outside tests/ for the same reason
// perf/statusline-render.test.js does (wall-clock under sibling-suite load).
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const HOOKS = path.resolve(__dirname, '..', 'plugin', 'bin', 'hooks.js');
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-perf-prefilter-'));
const SKIP_PAYLOAD = JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'echo hi' }, cwd: SANDBOX });

const runControl = () => execFileSync('node', ['-e', ''], { cwd: SANDBOX });
const runSkip = () => execFileSync('node', [HOOKS, 'pre-tool-use'], {
  input: SKIP_PAYLOAD, cwd: SANDBOX, env: { ...process.env, PIPELINE_RUN_DIR: '' },
});

function bestOf(attempts, fn) {
  let best = Infinity;
  for (let i = 0; i < attempts; i += 1) {
    const start = Date.now();
    fn();
    best = Math.min(best, Date.now() - start);
  }
  return best;
}

test('bin/hooks.js skip path stays under 60ms above bare-Node startup', () => {
  // Budget basis: Task 4's measurement (record the numbers here when filling
  // in this comment). 60ms is ~10x the skip path's own measured share.
  const control = bestOf(5, runControl);
  const skip = bestOf(5, runSkip);
  const cost = skip - control;
  assert.ok(cost < 60, `skip path cost ${cost}ms above bare Node (${skip}ms absolute, ${control}ms control)`);
});
```

- [ ] **Step 2: Prove it discriminates**

Temporarily change `if (EARLY && EARLY.skip) process.exit(0);` in `plugin/bin/hooks.js` to `if (false) process.exit(0);`, then run `cd "C:/repos/claude-tweaks/.claude/worktrees/record-3074" && node --test perf/hooks-prefilter.test.js`. Expected: FAIL; the full path pays the heavy requires. If it still passes, lower the budget toward the measured skip-path share × 3 until the stalled variant fails, and record both numbers. Revert the temporary edit, and confirm with `git diff --stat plugin/bin/hooks.js` that it is empty.

- [ ] **Step 3: Measure**

Write a scratch script (outside the repo) that spawns each of the four configurations 30 times sequentially and prints best and median for each. Run it idle, then again while three `node --test tests/hooks-dispatcher.test.js` processes run in the background. Report the raw printed output verbatim in the task report. Then replace the "Budget basis" comment's placeholder sentence in `perf/hooks-prefilter.test.js` with the measured idle numbers.

- [ ] **Step 4: Run the perf test**

Run: `cd "C:/repos/claude-tweaks/.claude/worktrees/record-3074" && node --test perf/hooks-prefilter.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git -C "C:/repos/claude-tweaks/.claude/worktrees/record-3074" add perf/hooks-prefilter.test.js
git -C "C:/repos/claude-tweaks/.claude/worktrees/record-3074" commit -m "Pin the Bash prefilter skip-path cost — perf budget over bare Node startup" -m "Claude-Session: https://claude.ai/code/session_01DrpGJ6VbqXi552HbbA6sSN"
```

---

### Task 5: Rewrite the cost rationale in the docs

**Files:**
- Modify: `plugin/skills/_shared/policy-schema-coverage.md:18` ("The cost that buys"), `:24` (Bare shell redirection bullet), `:27` (the "do not add a `fileWriteTargets` branch without the matching `hooks.json` if-matcher" sentence), `:31-33` (env/path-qualified bullets)
- Modify: `plugin/bin/lib/hooks/git-command.js:446-460` and `:515-521` (the `WRITE_SHAPES`/`fileWriteTargets` header comments)
- Modify: `docs/hooks.md` (one new bullet in the top Rules list)

**Interfaces:**
- Consumes: Task 4's four measured numbers (best/median, idle/contention, skip/full).

- [ ] **Step 1: Rewrite `policy-schema-coverage.md`**

Keep the `<!-- gate-coverage:begin/end -->` block byte-identical (`tests/hooks-gate-coverage.test.js` pins it). Rewrite only:

- `:18` "The cost that buys." Say that `hooks.json` registers one unconditional `Bash` handler per tool-use event, and `bin/lib/hooks/bash-prefilter.js` keys on a command *word*, not its flags. So every `sed` reaches the full handler, read-only invocations included, where it resolves no target and allows. Cite Task 4's full-path figure, then keep the "breadth over precision" sentences unchanged.
- `:24` Bare shell redirection. The reason is no longer "the matcher can't see it" (every Bash call now spawns the hook). The reason is that `>`/`>>` has no command word for the prefilter, and widening the prefilter to all redirections moves the full-handler cost onto every redirecting command. Cite the measured skip vs. full numbers. State it is still declined, now pending the follow-up record (Task 6) rather than on the old 42/68 ms per-call-spawn argument.
- `:27`. Replace "without the matching `hooks.json` if-matcher — the hook never spawns" with "without the matching prefilter word in `bin/lib/hooks/bash-prefilter.js` — the full handler never runs". Keep the pointer to `tests/hooks-gate-coverage.test.js` (it now asserts the prefilter word set).
- `:29-33`. The env-assignment and bare `env git` bullets are now covered by the prefilter's anywhere-in-the-string `git`/`env` word scan. Say so in one clause each. Path-qualified `/usr/bin/git` is now **reached** by the prefilter (basename match), so the remaining gap is parser-side only: `gitTargets` recognizes it, so correct the bullet to say it is covered end to end. `env -i git` / `env FOO=1 git`: likewise reached via `env`/`git`. Verify both claims before writing them, by running `node -e` (or a scratch `.js` file, since `node -e` is unreliable on this Windows box) against `gitTargets('/usr/bin/git commit -m x', '/r')` and `gitTargets('env -i git commit -m x', '/r')`. Write "covered" only for shapes that return a target; keep "declined" wording, with the measured cost, for any that do not.
- Add one sentence of arithmetic to the rewritten `:18` paragraph: before #3074, about 17% of Bash calls in one day of transcripts had a `$VAR`/loop shape and fanned out to 28 + 18 launches (≈ 8 launches per call on average). After it, every Bash call costs 2 launches, one per event. This is the trade the issue measured.

- [ ] **Step 2: Rewrite the `git-command.js` comments**

At `:446-460`, change "Every shape here is one hooks.json can ALSO gate structurally via an if-matcher (`Bash(cp *)`, `Bash(sed *)`, ...) — that pairing is the whole design constraint. A branch here without a matcher there is dead code, because the hook process never spawns" to say the pairing is now with `bash-prefilter.js`'s `PRE_TOOL_USE_WORDS` (which imports this list), so a shape added to `WRITE_SHAPES` is covered by construction. Remove the "Measured at 42 ms idle / 68 ms under three-way contention per call" line, or replace it with Task 4's full-path figures, and point at `skills/_shared/policy-schema-coverage.md` for the rationale. At `:515-521`, keep the load-bearing note, and add that `bash-prefilter.js` imports this list too.

- [ ] **Step 3: Add the `docs/hooks.md` bullet**

Insert after the "Git-stash worktree-hazard gate" bullet:

```markdown
- **Bash prefilter (#3074):** `hooks.json` registers ONE unconditional handler per tool-use event for `Bash` — never per-pattern `if` entries, which Claude Code runs all of (undeduplicated) whenever it cannot evaluate them statically (any `$VAR`, any loop), launching the hook 28 + 18 times for one call. `bin/hooks.js` instead consults `bin/lib/hooks/bash-prefilter.js` before any heavy `require`: it exits 0 silently unless the command contains a covered word (`PRE_TOOL_USE_WORDS` / `POST_TOOL_USE_WORDS`) anywhere, as a shell word or path basename, and it fails open to the full handler on anything unreadable or any non-`Bash` tool. A new Bash write shape or git action must be reachable through that word set — `tests/hooks-gate-coverage.test.js` pins the pairing. A side effect: `checkGitStashWarn` is now reachable for a plain `git stash`, which no predicate ever named.
```

- [ ] **Step 4: Verify**

Run: `cd "C:/repos/claude-tweaks/.claude/worktrees/record-3074" && node --test tests/hooks-gate-coverage.test.js tests/hooks-git-command.test.js tests/policy-schema-metadata.test.js tests/teardown-gate.test.js tests/merge-verification-gate-conformance.test.js`
Expected: PASS (or baseline-identical failures by name). Then run all three of these. Each must print only the expected survivors, which are the incident-log and any historical citation; paste the output in the report:
`grep -rn "42 ms\|42\.0 ms\|67\.9\|68 ms" plugin docs --include=*.md --include=*.js | grep -v incident-log`
`grep -rn "if-matcher" plugin docs --include=*.md --include=*.js | grep -v incident-log`
`grep -rn "unconditional .Bash. matcher" plugin docs --include=*.md --include=*.js`

- [ ] **Step 5: Commit**

```bash
git -C "C:/repos/claude-tweaks/.claude/worktrees/record-3074" add plugin/skills/_shared/policy-schema-coverage.md plugin/bin/lib/hooks/git-command.js docs/hooks.md
git -C "C:/repos/claude-tweaks/.claude/worktrees/record-3074" commit -m "Rewrite the Bash hook cost rationale for the single-handler layout — measured skip vs full path, prefilter pairing" -m "Claude-Session: https://claude.ai/code/session_01DrpGJ6VbqXi552HbbA6sSN"
```

---

### Task 6 (controller-owned, not dispatched): Follow-up record for the newly-cheap gaps

Stage, never create, a backlog record proposal at `{run-dir}/staged/` for the Review Console. Work-record creation is on `_shared/auto-mode-contract.md`'s "not silenced" list. Content: close bare redirection (`>`, `>>`) coverage now that every Bash call already spawns the hook, plus any shape Task 5 Step 1 left "declined". The `Defer-reason:` comes from `_shared/deferral-gate.md`.

### Live verification (controller-owned)

The AC's `Win32_Process` launch-count probe needs a Claude Code session loading this branch's plugin build, and the session running this pipeline loads the installed 6.138.0 cache instead. Record it in the ledger as `live-verification` (`_shared/ledger-format.md`). The structural proof that ships with this plan is that `hooks.json` carries exactly one `Bash` handler per event, so Claude Code cannot launch more than one per event (Task 3's pins).
