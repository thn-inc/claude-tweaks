// tests/hooks-bash-prefilter.test.js
//
// #3074: hooks.json registers ONE unconditional Bash handler per event; this
// prefilter is what keeps an uninteresting Bash call from paying the full
// handler. It must be a SUPERSET of the old per-pattern `if` predicates —
// a false "skip" silently drops enforcement, a false "run" costs one module load.
'use strict';
const { test, after } = require('node:test');
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
  // $VAR program indirection (substituteVars) and adjacent-span quoting reach a covered word.
  'G=git; $G commit -m x', 'C=cp; $C a b', 'M=mkdir; $M -p d', '"g"it commit -m x',
  // A program name CONCATENATED from an assignment and literal text: substituteVars
  // rewrites prefix + value + suffix, so the handler resolves these too.
  'G=gi; ${G}t commit -m x', 'X=it; g$X commit', 'X=c; ${X}p a.txt b.txt', 'X=mk; ${X}dir d',
  'X=t; gi$X push', 'A=tr; ${A}uncate -s 0 f', 'G=gi\n${G}t push',
  ...WRITE_SHAPES.map((s) => `${s} a b`),
]) {
  test(`pre-tool-use runs the full handler for: ${command}`, () => {
    assert.strictEqual(shouldRunFull('pre-tool-use', bash(command)), true);
  });
}

for (const command of [
  'git commit -m x', 'cd x && git commit -m y', 'FOO=1 git push', 'env -C /x git commit -m y',
  'git -c user.name=x commit -m y', 'git worktree remove ../w', 'for n in 1 2; do git push; done',
  'G=git; $G push', 'G=gi; ${G}t push',
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

test('an event name that is an Object.prototype key is not a governed event', () => {
  let reads = 0;
  assert.strictEqual(earlyGate('toString', () => { reads += 1; return '{}'; }), null);
  assert.strictEqual(reads, 0);
  assert.strictEqual(shouldRunFull('constructor', bash('echo hi')), true);
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

// ── e2e: bin/hooks.js's early exit (#3074) ───────────────────────────────────
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { gitRepo, linkedWorktreeOf } = require('./helpers/git-fixtures');

const HOOKS = path.join(__dirname, '..', 'plugin', 'bin', 'hooks.js');
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-prefilter-'));
after(() => { fs.rmSync(SANDBOX, { recursive: true, force: true }); });
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

// The handler substitutes same-command literal assignments into the program word
// (git-command.js substituteVars), so `G=git; $G commit` resolves to a commit
// target. The prefilter must see the assigned value, or the deny is dropped.
test('e2e: $VAR program indirection reaches the worktree-always deny, same as the literal spelling', () => {
  const project = gitRepo();
  fs.mkdirSync(path.join(project, '.claude-tweaks'), { recursive: true });
  fs.writeFileSync(path.join(project, '.claude-tweaks', 'policy.yml'), 'worktree-always: true\n');
  for (const command of ['git commit -m x', 'G=git; $G commit -m x']) {
    const { stdout } = spawnHook('pre-tool-use', { ...bash(command), cwd: project }, { cwd: project });
    assert.match(stdout, /"permissionDecision":"deny"/, command);
  }
});

// substituteVars also rewrites a token that merely CONTAINS a reference
// (prefix + value + suffix), so `${G}t` is the program `git` to the handler even
// though no single word of the command spells it.
test('e2e: a CONCATENATED program name reaches the worktree-always deny too', () => {
  const project = gitRepo();
  fs.mkdirSync(path.join(project, '.claude-tweaks'), { recursive: true });
  fs.writeFileSync(path.join(project, '.claude-tweaks', 'policy.yml'), 'worktree-always: true\n');
  const command = 'G=gi; ${G}t commit -m x';
  const { stdout } = spawnHook('pre-tool-use', { ...bash(command), cwd: project }, { cwd: project });
  assert.match(stdout, /"permissionDecision":"deny"/, command);
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
