// tests/hooks-gate-coverage.test.js
//
// Binds the worktree-always gate's actual coverage to the prose that documents
// it. The gate was widened twice on 2026-07-20 (push in c8f929e1, cp/mv/tee in
// cab6142b) and neither commit swept the prose; four skill files went on
// describing the pre-widening gate, two of them prescribing procedures the
// widened gate denies (#138). Nothing failed, because nothing checked.
//
// This suite reads live production prose, which [IL-80] warns against — a test
// asserting "this real file currently contains X" is a scheduled failure timed
// to the next migration. It is acceptable HERE, and only here, because the
// coverage block is a declared contract whose update IS the intended action
// when the gate changes. Do not generalize the pattern to prose that merely
// happens to mention the gate.
'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { GATE_COVERAGE } = require('../plugin/bin/lib/hooks/pre-tool-use');
const gitCommand = require('../plugin/bin/lib/hooks/git-command');
const { WRITE_SHAPES, fileWriteTargets, forEachShellSegment, gitTargets, mkdirTargets, stripHeredocBodies } = gitCommand;
const { shouldRunFull } = require('../plugin/bin/lib/hooks/bash-prefilter');
const { readText } = require('./helpers/read-skill');
const { shellQuote } = require('./helpers/shell-quote');

const runsFull = (event, command) => shouldRunFull(event, { tool_name: 'Bash', tool_input: { command } });
function bashGroupOf(group) {
  const hooks = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'plugin', 'hooks', 'hooks.json'), 'utf8'));
  return hooks.hooks[group].find((e) => e.matcher === 'Bash');
}

const SCHEMA = path.join(__dirname, '..', 'plugin', 'skills', '_shared', 'policy-schema-coverage.md');
const BEGIN = '<!-- gate-coverage:begin -->';
const END = '<!-- gate-coverage:end -->';
const TEARDOWN_BEGIN = '<!-- teardown-gate-coverage:begin -->';
const TEARDOWN_END = '<!-- teardown-gate-coverage:end -->';
// The main-checkout write target the tests below expect, as a native path on win32 too.
const MAIN_F = path.resolve('/main/f.js');
// #4303: every temp tree the #4303 fixtures below create, removed once the file's tests have run.
const TMP_DIRS_4303 = [];
after(() => { for (const dir of TMP_DIRS_4303) fs.rmSync(dir, { recursive: true, force: true }); });
const tmpDir4303 = (prefix) => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(require('os').tmpdir(), prefix)));
  TMP_DIRS_4303.push(dir);
  return dir;
};
// The main checkout's root: what a relative write resolves to once the walk has lost its cwd (#4303).
const MAIN_ROOT = path.resolve('/main');

// #4303: runs one scanner call in a child node killed after 10 s, so a cap that regresses into a
// loop fails its test instead of hanging the suite (node:test's `timeout` cannot stop a synchronous
// call). The call's arguments go in as JSON on stdin, never into the script source; stdin, not argv,
// because a deep-nest command escaped for argv overruns win32's 32767-character command line.
const GIT_COMMAND = path.resolve(__dirname, '..', 'plugin', 'bin', 'lib', 'hooks', 'git-command.js');
const BOUNDED_SCRIPT = [
  "const { mod, fn, command, cwd, opts } = JSON.parse(require('fs').readFileSync(0, 'utf8'));",
  'process.stdout.write(JSON.stringify(require(mod)[fn](command, cwd, opts)));',
].join('\n');
function runBounded(label, script, payload) {
  const r = spawnSync(process.execPath, ['-e', script], { input: JSON.stringify(payload), timeout: 10000, encoding: 'utf8' });
  // A killed or failed child would also fail the JSON.parse below, on empty stdout; these two run
  // first so the failure names its cause (the 10 s kill, or the child's own error) instead.
  assert.strictEqual(r.signal, null, `${label} was killed (${r.signal}): a cap no longer bounds it`);
  assert.strictEqual(r.status, 0, `${label} exited ${r.status}: ${r.error ?? r.stderr}`);
  return JSON.parse(r.stdout);
}
function boundedTargets(fn, command, cwd, opts) {
  return runBounded(fn, BOUNDED_SCRIPT, { mod: GIT_COMMAND, fn, command, cwd, opts });
}
// The same bound for a call `boundedTargets` cannot express (a `forEachShellSegment` handler, or many
// calls in one child): `fn(gitCommand, args)` runs in the child, so it must be self-contained (it
// reaches nothing in this file) and return JSON; `args` carry its data in.
const BOUNDED_RUN_SCRIPT = [
  "const { mod, src, args } = JSON.parse(require('fs').readFileSync(0, 'utf8'));",
  "process.stdout.write(JSON.stringify(eval('(' + src + ')')(require(mod), args)));",
].join('\n');
function boundedRun(fn, args) {
  return runBounded('a scanner call', BOUNDED_RUN_SCRIPT, { mod: GIT_COMMAND, src: fn.toString(), args });
}

function coverageBlock() {
  const text = readText(SCHEMA);
  const start = text.indexOf(BEGIN);
  const end = text.indexOf(END);
  assert.ok(start !== -1 && end !== -1 && end > start,
    `policy-schema-coverage.md must contain a ${BEGIN} ... ${END} block — it is the canonical statement of gate coverage`);
  return text.slice(start + BEGIN.length, end);
}

function teardownCoverageBlock() {
  const text = readText(SCHEMA);
  const start = text.indexOf(TEARDOWN_BEGIN);
  const end = text.indexOf(TEARDOWN_END);
  assert.ok(start !== -1 && end !== -1 && end > start,
    `policy-schema-coverage.md must contain a ${TEARDOWN_BEGIN} ... ${TEARDOWN_END} block — it is the canonical statement of teardown gate coverage`);
  return text.slice(start + TEARDOWN_BEGIN.length, end);
}

// Backtick-quoted tokens on a line beginning with the given label.
function tokensFor(block, label) {
  const line = block.split('\n').find((l) => l.trim().startsWith(`- ${label}:`));
  assert.ok(line, `the coverage block must carry a "- ${label}:" line`);
  return (line.match(/`([^`]+)`/g) || []).map((t) => t.slice(1, -1));
}

test('policy-schema-coverage.md\'s coverage block lists exactly the tools the gate checks', () => {
  assert.deepStrictEqual(tokensFor(coverageBlock(), 'Tools'), [...GATE_COVERAGE.tools],
    'GATE_COVERAGE.tools and the canonical prose have diverged — update the coverage block in skills/_shared/policy-schema-coverage.md');
});

test('policy-schema-coverage.md\'s coverage block lists exactly the git actions the gate checks', () => {
  assert.deepStrictEqual(tokensFor(coverageBlock(), 'Git actions'), [...GATE_COVERAGE.gitActions],
    'GATE_COVERAGE.gitActions and the canonical prose have diverged — update the coverage block in skills/_shared/policy-schema-coverage.md');
});

test('policy-schema-coverage.md\'s coverage block lists exactly the Bash write shapes the gate checks', () => {
  assert.deepStrictEqual(tokensFor(coverageBlock(), 'Bash write shapes'), [...GATE_COVERAGE.bashWriteShapes],
    'GATE_COVERAGE.bashWriteShapes and the canonical prose have diverged — update the coverage block in skills/_shared/policy-schema-coverage.md');
});

// #3080: bashRedirections is the operator-token sibling of bashWriteShapes
// (which lists command WORDS) — same prose/code pinning shape, different
// vocabulary.
test('policy-schema-coverage.md\'s coverage block lists exactly the Bash redirections the gate checks', () => {
  assert.deepStrictEqual(tokensFor(coverageBlock(), 'Bash redirections'), [...GATE_COVERAGE.bashRedirections],
    'GATE_COVERAGE.bashRedirections and the canonical prose have diverged — update the coverage block in skills/_shared/policy-schema-coverage.md');
});

test('policy-schema-coverage.md\'s coverage block lists exactly the gate\'s exemptions', () => {
  // Derived from the constant, never a hand-typed literal (spec #537): a
  // hand-typed expectation would keep passing even after the exemption's
  // shape changed underneath it, which is exactly the drift this whole
  // suite exists to catch.
  const expected = [
    ...GATE_COVERAGE.exemptions.paths,
    GATE_COVERAGE.exemptions.commit,
    GATE_COVERAGE.exemptions.push,
    GATE_COVERAGE.exemptions.target,
  ];
  assert.deepStrictEqual(tokensFor(coverageBlock(), 'Exemptions'), expected,
    'GATE_COVERAGE.exemptions and the canonical prose have diverged — update the coverage block in skills/_shared/policy-schema-coverage.md');
});

// #4149: the heredoc paragraph ("Bare shell redirection is covered (#3080).") restates the four reader
// vocabularies stripHeredocBodies decides by. Each list is sliced out of the prose between two
// anchor phrases (each must appear exactly once, so a reworded sentence fails loud rather than
// parsing nothing) and pinned equal, as a set, to the constant the code reads.
function proseList(text, from, to) {
  const at = text.indexOf(from);
  assert.ok(at !== -1 && text.indexOf(from, at + 1) === -1, `policy-schema-coverage.md must carry the phrase ${JSON.stringify(from)} exactly once`);
  const end = text.indexOf(to, at + from.length);
  assert.ok(end !== -1, `policy-schema-coverage.md must follow ${JSON.stringify(from)} with ${JSON.stringify(to)}`);
  const words = (text.slice(at + from.length, end).match(/`([^`]+)`/g) || []).map((t) => t.slice(1, -1));
  assert.ok(words.length > 0, `no backtick-quoted word between ${JSON.stringify(from)} and ${JSON.stringify(to)}`);
  return words;
}

for (const [label, name, from, to] of [
  ['data readers', 'DATA_READER_WORDS', 'every command on the opener line is a data reader: ', ' given a data subcommand ('],
  ['reader wrappers', 'READER_WRAPPER_WORDS', 'may sit behind a reader wrapper (', '; its option flags'],
  ['git data subcommands', 'GIT_DATA_SUBCOMMANDS', 'given a data subcommand (', ", found after git's global flags"],
  ['inert neighbours', 'INERT_NEIGHBOUR_WORDS', 'A neighbour command whose own program is ', ' also passes'],
]) {
  test(`#4149: policy-schema-coverage.md names exactly the heredoc ${label} git-command.js's ${name} holds`, () => {
    const words = proseList(readText(SCHEMA), from, to);
    assert.strictEqual(new Set(words).size, words.length, `the prose names a ${label} word twice: ${words.join(', ')}`);
    assert.deepStrictEqual([...words].sort(), [...gitCommand[name]].sort(),
      `${name} and the heredoc paragraph in skills/_shared/policy-schema-coverage.md have diverged`);
  });
}

test('GATE_COVERAGE is frozen, so a caller cannot mutate the contract at runtime', () => {
  assert.ok(Object.isFrozen(GATE_COVERAGE));
  for (const key of Object.keys(GATE_COVERAGE)) {
    assert.ok(Object.isFrozen(GATE_COVERAGE[key]), `GATE_COVERAGE.${key} must be frozen too`);
  }
});

test('every GATE_COVERAGE field is load-bearing, not a parallel hand-kept list', () => {
  // A constant nothing reads documents nothing. If a field stops driving the
  // gate, the assertions above keep pinning prose against a dead value — still
  // green, and no longer about the gate's behaviour at all. That is precisely
  // the failure mode [IL-78] describes: a check that would pass on any input.
  const src = readText(path.join(__dirname, '..', 'plugin', 'bin', 'lib', 'hooks', 'pre-tool-use.js'));
  // Iterate every GATE_COVERAGE key rather than a hardcoded ['tools',
  // 'gitActions'] list — a field this loop doesn't visit is exactly the
  // "constant nothing reads" gap the loop exists to catch (whole-branch
  // review MINOR 8). bashWriteShapes is the one deliberate exception: it is
  // load-bearing in git-command.js instead, checked separately below.
  for (const field of Object.keys(GATE_COVERAGE)) {
    if (field === 'bashWriteShapes') continue;
    assert.ok(src.includes(`GATE_COVERAGE.${field}`),
      `pre-tool-use.js must branch on GATE_COVERAGE.${field}, not a duplicated literal`);
  }
  // bashWriteShapes is implemented in git-command.js, so it is load-bearing
  // there instead: WRITE_SHAPES guards which command words fileWriteTargets
  // will even inspect.
  const gc = readText(path.join(__dirname, '..', 'plugin', 'bin', 'lib', 'hooks', 'git-command.js'));
  assert.ok(gc.includes('WRITE_SHAPES.includes('),
    'fileWriteTargets must gate on WRITE_SHAPES so an unlisted shape is dead code');
  assert.strictEqual(GATE_COVERAGE.bashWriteShapes, WRITE_SHAPES,
    'GATE_COVERAGE.bashWriteShapes must BE git-command.js\'s list, not a copy of it');
});

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
  // The word-set pairing itself is pinned by the differential corpus in tests/hooks-bash-prefilter.test.js (#3092).
  for (const shape of WRITE_SHAPES) {
    assert.strictEqual(runsFull('pre-tool-use', `${shape} a b`), true, shape);
  }
});

// #3080: the redirection sibling of the WRITE_SHAPES test above — a redirect
// operator the parser resolves must also reach the full handler, post-tool-use
// must stay skipped (fileWriteTargets never runs there — see "What the gate can
// see at all" in policy-schema-coverage.md), and the common cheap shapes must
// stay on the skip path in both events.
test('every GATE_COVERAGE.bashRedirections entry reaches the pre-tool-use full handler, never post-tool-use (#3080)', () => {
  for (const op of GATE_COVERAGE.bashRedirections) {
    assert.strictEqual(runsFull('pre-tool-use', `cmd ${op} a.txt`), true, op);
    assert.strictEqual(runsFull('post-tool-use', `cmd ${op} a.txt`), false,
      `${op}: post-tool-use never consumes fileWriteTargets, so widening its prefilter for this op would be pure cost`);
  }
  for (const command of ['cmd 2>&1', 'cmd > /dev/null', 'cmd 1>/dev/stdout']) {
    assert.strictEqual(runsFull('pre-tool-use', command), false, `${command} must stay on the skip path`);
  }
});

test('policy-schema-coverage.md\'s teardown coverage block lists exactly the tools the teardown gate checks', () => {
  assert.deepStrictEqual(tokensFor(teardownCoverageBlock(), 'Tools'), [...GATE_COVERAGE.teardownTools],
    'GATE_COVERAGE.teardownTools and the canonical prose have diverged — update the teardown coverage block in skills/_shared/policy-schema-coverage.md');
});

test('policy-schema-coverage.md\'s teardown coverage block lists exactly the git commands the teardown gate checks', () => {
  assert.deepStrictEqual(tokensFor(teardownCoverageBlock(), 'Git commands'), [...GATE_COVERAGE.teardownGitCommands],
    'GATE_COVERAGE.teardownGitCommands and the canonical prose have diverged — update the teardown coverage block in skills/_shared/policy-schema-coverage.md');
});

test('pre-tool-use.js branches on GATE_COVERAGE.teardownTools, not a duplicated literal', () => {
  const src = readText(path.join(__dirname, '..', 'plugin', 'bin', 'lib', 'hooks', 'pre-tool-use.js'));
  assert.ok(src.includes('GATE_COVERAGE.teardownTools'),
    'pre-tool-use.js must branch on GATE_COVERAGE.teardownTools, not a hardcoded comparison');
});

// #590: gitTargets now also recognizes `env git ...` — pin that the prefilter
// runs the full handler for each such shape in both events (the same #70
// asymmetry the WRITE_SHAPES test above guards against: a parser branch the
// handler never runs for is dead code), and that the parser really does
// resolve a target for the shapes.
//
// Note: these pin the SHAPES reaching the handler, not the word `env`. `env` is
// kept in PRE_TOOL_USE_WORDS for parity with the retired `Bash(env -*)`
// predicate, but every env-wrapped shape the handler acts on also carries a
// `git` (or write-shape) word, so removing `env` from the set would not turn
// these red — and there is no env-only shape the handler resolves to pin.
test('every env-git shape gitTargets resolves reaches the full handler, in both events (#590, #3074)', () => {
  for (const event of ['pre-tool-use', 'post-tool-use']) {
    for (const command of ['env git commit -m x', 'env git push', 'env git -C . commit -m x',
      'env git -c a=b commit -m x', 'env git --exec-path=/x commit -m x', 'env git --namespace=n push']) {
      assert.strictEqual(runsFull(event, command), true,
        `${event}'s prefilter skips '${command}' — gitTargets recognizes this 'env git' shape but the handler would never run for it`);
    }
  }

  // Parser side: the shapes these new predicates name really do resolve.
  assert.deepStrictEqual(gitTargets('env git commit -m "x"', '/repo'), [{ action: 'commit', dir: '/repo' }]);
  assert.deepStrictEqual(gitTargets('env git push', '/repo'), [{ action: 'push', dir: '/repo' }]);
});

// env's own flags ahead of git (`env -C <dir> git commit`, `env -u NAME git
// push`) sit between `env` and `git` — the prefilter must still run the full
// handler for exactly the shape findGitLead's -C/--chdir handling exists to
// resolve (same #70 matcher/parser asymmetry). As above, this pins the shapes,
// not the word `env` — each command here also carries the word `git`.
test('env-with-flags git shapes reach the full handler, in both events (#3074)', () => {
  for (const event of ['pre-tool-use', 'post-tool-use']) {
    for (const command of ['env -C /main-checkout git commit -m "x"', 'env -u FOO git push', 'env -i git commit -m x']) {
      assert.strictEqual(runsFull(event, command), true, `${event} skips '${command}'`);
    }
  }

  // Parser side: the shapes the predicate exists for really do resolve.
  // path.resolve: gitTargets resolves an -C dir to an absolute path, which on
  // Windows carries the drive letter (C:\main-checkout).
  assert.deepStrictEqual(gitTargets('env -C /main-checkout git commit -m "x"', '/repo'), [{ action: 'commit', dir: path.resolve('/main-checkout') }]);
  assert.deepStrictEqual(gitTargets('env -u FOO git push', '/repo'), [{ action: 'push', dir: '/repo' }]);
});

// #500's stampAdHocRunDir and #307's staleness backstop both hard-gate on
// tool_name === 'EnterWorktree' in post-tool-use.js — a PostToolUse group
// without an EnterWorktree matcher makes both dead at the registration seam
// (the hook process never spawns), the exact dead-branch shape
// policy-schema-coverage.md warns about.
test('PostToolUse carries an EnterWorktree matcher group for the post-tool-use EnterWorktree handlers', () => {
  const hooks = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'plugin', 'hooks', 'hooks.json'), 'utf8'));
  const group = hooks.hooks.PostToolUse.find((e) => e.matcher === 'EnterWorktree');
  assert.ok(group, 'PostToolUse has no EnterWorktree matcher group — stampAdHocRunDir (#500) and the staleness backstop (#307) never run');
  assert.ok(group.hooks.some((h) => typeof h.command === 'string' && h.command.includes('post-tool-use')),
    'the EnterWorktree PostToolUse group must invoke hooks.js post-tool-use');
});

// #703: checkPostTeardownReanchor hard-gates on tool_name === 'ExitWorktree'
// (for the action:remove shape) and on a raw `git worktree remove ...` Bash
// command — a PostToolUse registration without a matching matcher, or a
// prefilter that skips the command, makes it dead at the registration seam,
// the same #70 dead-branch shape the EnterWorktree test above guards against.
test('PostToolUse carries an ExitWorktree matcher group for the post-teardown re-anchor backstop', () => {
  const hooks = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'plugin', 'hooks', 'hooks.json'), 'utf8'));
  const group = hooks.hooks.PostToolUse.find((e) => e.matcher === 'ExitWorktree');
  assert.ok(group, 'PostToolUse has no ExitWorktree matcher group — the post-teardown re-anchor backstop (#703) never runs for ExitWorktree');
  assert.ok(group.hooks.some((h) => typeof h.command === 'string' && h.command.includes('post-tool-use')),
    'the ExitWorktree PostToolUse group must invoke hooks.js post-tool-use');
});

test('post-tool-use\'s prefilter runs the full handler for a raw `git worktree` command (#703, #3074)', () => {
  assert.strictEqual(runsFull('post-tool-use', 'git worktree remove ../w'), true,
    'post-tool-use skips a raw `git worktree remove` — checkPostTeardownReanchor would never run for it');
});

// #976 (IL-141): the general-purpose sibling of the WRITE_SHAPES #70 test
// above, for GATE_COVERAGE.gitActions instead — a git action gitTargets()
// classifies but bash-prefilter.js has no word for (hooks.json no longer names
// per-action `Bash(git {action} *)` predicates; the prefilter is the gate now)
// is the identical dead-code hazard: the full handler never runs, so the
// classifier branch never runs for real traffic. Checked for BOTH PreToolUse and
// PostToolUse (commit/push already carry entries in both; a new action must
// too, or post-tool-use.js's commit-breadcrumb loop silently never logs it).
test('every GATE_COVERAGE.gitActions entry reaches the full handler, in both events (#976, #3074)', () => {
  for (const event of ['pre-tool-use', 'post-tool-use']) {
    for (const action of GATE_COVERAGE.gitActions) {
      assert.strictEqual(runsFull(event, `git ${action} x`), true,
        `${event}'s prefilter skips 'git ${action}' — GATE_COVERAGE.gitActions includes it but the handler would never run`);
    }
  }
});

// Parser side of the same binding: each new action really does resolve a
// target, for the same shapes the AC names (git mv, git update-ref) plus the
// other two the Technical Approach lists (git rm, git apply).
test('#976: gitTargets resolves a target for each new plumbing write subcommand', () => {
  assert.deepStrictEqual(gitTargets('git mv a.txt b.txt', '/repo'), [{ action: 'mv', dir: '/repo' }]);
  assert.deepStrictEqual(gitTargets('git rm --cached a.txt', '/repo'), [{ action: 'rm', dir: '/repo' }]);
  assert.deepStrictEqual(gitTargets('git update-ref refs/heads/main HEAD', '/repo'), [{ action: 'update-ref', dir: '/repo' }]);
  assert.deepStrictEqual(gitTargets('git apply patch.diff', '/repo'), [{ action: 'apply', dir: '/repo' }]);
});

// Deliberately-excluded verbs (see PLUMBING_WRITE_SUBCOMMANDS' own header
// comment) must still resolve NO target — proving the exclusion is real,
// not accidental dead code that happens to be untested either way.
test('#976: deliberately-excluded git subcommands (stash, reset, checkout, merge) resolve no target', () => {
  for (const cmd of ['git stash list', 'git reset', 'git checkout main', 'git merge origin/main']) {
    assert.deepStrictEqual(gitTargets(cmd, '/repo'), [], `${cmd} must resolve no target — not in scope for #976`);
  }
});

// #976 AC1, end-to-end: a git-plumbing write (git mv) inside a
// worktree-always project, issued from the main checkout instead of the
// isolated worktree, must trigger the identical E1 deny a commit/push would
// — proving the classification change actually reaches the enforcement gate,
// not just gitTargets()'s own parser output.
test('#976 AC1: `git mv` inside a worktree-always project triggers the same E1 deny a commit would', () => {
  const preToolUse = require('../plugin/bin/lib/hooks/pre-tool-use');
  const fsMod = require('fs');
  const osMod = require('os');
  const { execFileSync } = require('child_process');
  const main = fsMod.mkdtempSync(path.join(osMod.tmpdir(), 'ct-976-main-'));
  execFileSync('git', ['-C', main, 'init', '-q']);
  execFileSync('git', ['-C', main, 'config', 'user.email', 't@example.com']);
  execFileSync('git', ['-C', main, 'config', 'user.name', 'T']);
  fsMod.writeFileSync(path.join(main, 'a.txt'), 'x\n');
  execFileSync('git', ['-C', main, 'add', 'a.txt']);
  execFileSync('git', ['-C', main, 'commit', '-q', '-m', 'init']);
  fsMod.mkdirSync(path.join(main, '.claude-tweaks'), { recursive: true });
  fsMod.writeFileSync(path.join(main, '.claude-tweaks', 'policy.yml'), 'worktree-always: true\n');

  const out = preToolUse.run({
    input: { tool_name: 'Bash', tool_input: { command: 'git mv a.txt b.txt' }, cwd: main },
    runDir: null,
    runState: null,
    ownedRun: {},
    cwd: main,
  });
  assert.strictEqual(out.json.hookSpecificOutput.permissionDecision, 'deny',
    'a git mv issued from the main checkout of a worktree-always project must be denied, same as a commit would be');
});

test('an unlisted Bash write shape is genuinely not detected', () => {
  // Proves the WRITE_SHAPES guard above is doing work rather than sitting
  // upstream of branches that would have matched anyway.
  assert.deepStrictEqual(fileWriteTargets('rsync a.txt /tmp/b.txt', '/tmp'), [],
    'rsync is not in WRITE_SHAPES, so it must resolve no target');
  assert.ok(fileWriteTargets('cp a.txt /tmp/b.txt', '/tmp').length > 0,
    'a listed shape must still resolve — otherwise the guard proves nothing');
});

// #3080: redirectWriteTargets (via fileWriteTargets) resolves regardless of
// command word — echo/printf/cat/a bare `> f`, not just a WRITE_SHAPES entry.
test('#3080: fileWriteTargets resolves bare redirection targets for ANY command word', () => {
  for (const [command, file, why] of [
    ['echo x > tracked-file.js', path.resolve('/r', 'tracked-file.js')],
    ['printf y >> tracked-file.js', path.resolve('/r', 'tracked-file.js')],
    ['cat a > tracked-file.js', path.resolve('/r', 'tracked-file.js')],
    ['echo x >out.js', path.resolve('/r', 'out.js'), 'a glued operator (no space before the target) must resolve the same as a spaced one'],
    ['cmd &> out.log', path.resolve('/r', 'out.log')],
    ['cmd &>> out.log', path.resolve('/r', 'out.log')],
    ['cmd >| noclobber.log', path.resolve('/r', 'noclobber.log'), 'noclobber\'s >| is still a write'],
    ['cmd 2>> err.log', path.resolve('/r', 'err.log'), 'a fd-prefixed append operator must resolve the same as the unprefixed form'],
  ]) {
    assert.deepStrictEqual(fileWriteTargets(command, '/r'), [{ action: 'write', file }], why || command);
  }
});

test('#3080: redirection resolves no target for fd duplication, process substitution, DEVNULL_LIKE, or an unresolvable RHS', () => {
  for (const command of [
    'cmd 2>&1', 'cmd >&2', 'echo x > /dev/null', 'cmd > /dev/stdout', 'cmd 1>/dev/stderr',
    'echo x > "$OUT"', 'echo x > $(mktemp)', 'cmd > ~/f',
  ]) {
    assert.deepStrictEqual(fileWriteTargets(command, '/r'), [], command);
  }
});

test('#3080: a `>` inside a quoted string is not mistaken for a redirection', () => {
  assert.deepStrictEqual(fileWriteTargets('echo "a > b"', '/r'), []);
});

// #4303: csh-style `>& file` sends stdout and stderr to the file. bash 3.2 and 5 write M/f for
// `>& M/f`, `>&M/f` and `1>&M/f`; `2>&M/f` is an ambiguous redirect and writes nothing.
// The fd prefix is read as a number, and only where the operator starts the word: bash 3.2
// and 5 write M/f for `01>&M/f` and for `"2">&M/f` (a quoted `2` is a word, not an fd), and
// `0>&M/f` is an ambiguous redirect that writes nothing, like `2>&M/f`. `x>>&M/f` is a syntax
// error in both, so nothing runs.
test('#4303: `>&` with a file target resolves the file, as bash writes it', () => {
  for (const cmd of ['echo x >& /main/f.js', 'echo x >&/main/f.js', 'echo x 1>&/main/f.js', 'cd /main && echo x >& f.js', 'echo x 01>&/main/f.js', 'echo "2">&/main/f.js']) {
    assert.deepStrictEqual(fileWriteTargets(cmd, '/r'), [{ action: 'write', file: MAIN_F }], cmd);
  }
});
// bash 3.2 and 5 write no file for any row: `>&2`, `>& 2` and `2>&1` duplicate a descriptor, `>&-`
// closes stdout, `>&3-` fails on the unopened fd 3, and the `2>&`, `0>&` and `>>&` rows are the
// ambiguous redirects and the syntax error noted above.
test('#4303: `>&` with an fd, `-`, or a non-stdout fd prefix resolves no target', () => {
  for (const cmd of ['echo x >&2', 'echo x >& 2', 'echo x >&-', 'echo x >&3-', 'echo x 2>&1', 'echo x 2>&/main/f.js', 'echo x 0>&/main/f.js', 'echo x>>&/main/f.js']) {
    assert.deepStrictEqual(fileWriteTargets(cmd, '/r'), [], cmd);
  }
});
// #4303: only a whole word of digits (or `-`) after `>&` is a descriptor: bash 3.2 and 5 write a
// file named `2x` for `echo x >&2x` and for `echo x >& 2x`.
test('#4303: `>&` with a word that starts with digits is a file target', () => {
  for (const cmd of ['echo x >&2x', 'echo x >& 2x']) {
    assert.deepStrictEqual(fileWriteTargets(cmd, '/r'), [{ action: 'write', file: path.resolve('/r/2x') }], cmd);
  }
});
// #4303: an unquoted `)` ends a word, so a target glued to the closer of the `$( )` it sits in ends
// there. bash 3.2 and 5 write nothing for `$(echo x >&2)` and `$(echo x >& 2)` (fd dups), nor for
// `$(echo x >&) M/f` (a syntax error, so the word after it is no target), and write ./f for
// `$(echo x >f)`, `$(echo x > f)`, `$(echo x >f)y`, `$(echo x >&f)` and `$(echo x >& f)`; a quoted
// or escaped `)` is word text, so `$(echo x >'f)')` and `$(echo x >f\))` write ./f).
test('#4303: a redirect target glued to a substitution\'s closer ends at the closer', () => {
  const files = (cmd) => fileWriteTargets(cmd, '/r').map((t) => t.file);
  for (const cmd of ['echo $(echo x >&2)', 'echo $(echo x >& 2)', 'echo $(echo x >&) /main/f.js']) assert.deepStrictEqual(files(cmd), [], cmd);
  for (const cmd of ['echo $(echo x >f)', 'echo $(echo x > f)', 'echo $(echo x >f)y', 'echo $(echo x >&f)', 'echo $(echo x >& f)']) {
    assert.deepStrictEqual(files(cmd), [path.resolve('/r/f')], cmd);
  }
  for (const cmd of ["echo $(echo x >'f)')", 'echo $(echo x >f\\))']) assert.deepStrictEqual(files(cmd), [path.resolve('/r/f)')], cmd);
});
// #4303: redirectWriteTargets called with no quoting (an exported entry point; every walk passes
// quoting) reads the operator from the token's start. bash 3.2 and 5 write M/f for `echo x >& M/f`
// and `echo x >&M/f`, and nothing for `echo x 2>& M/f` (ambiguous redirect) or `echo x >>&M/f`
// (syntax error).
test('#4303: redirectWriteTargets without quoting reads `>& file`, and no `2>&` or `>>&` target', () => {
  const { redirectWriteTargets } = gitCommand;
  assert.deepStrictEqual(redirectWriteTargets(['echo', 'x', '>&', '/main/f.js'], '/r'), [MAIN_F]);
  assert.deepStrictEqual(redirectWriteTargets(['echo', 'x', '>&/main/f.js'], '/r'), [MAIN_F]);
  assert.deepStrictEqual(redirectWriteTargets(['echo', 'x', '2>&', '/main/f.js'], '/r'), []);
  assert.deepStrictEqual(redirectWriteTargets(['echo', 'x', '>>&/main/f.js'], '/r'), []);
});

// #4303: GNU getopt reads `-t` inside a short-option cluster: its value is the rest of the
// cluster, else the next word, and `--target-directory` may be abbreviated (cp, mv, install and
// ln have no other `--t…` option). bash 3.2 and 5 with GNU cp: `cp -rt M src` writes M/src;
// `cp -tM src`, `cp -vtM src` and `cp --target=M src` target M; `cp -tr M src` targets r.
for (const [cmd, dir] of [
  ['cp -rt /main a', '/main'], ['cp -tM a', 'M'], ['cp -vt/main a', '/main'], ['cp --target=/main a', '/main'],
  ['cp --targ /main a', '/main'], ['mv -vt /main a', '/main'], ['install -Dt /main f', '/main'], ['ln -st /main a', '/main'],
  ['cp -tr /main a', 'r'],
]) {
  test(`#4303: \`${cmd}\` resolves its -t directory`, () => {
    assert.deepStrictEqual(fileWriteTargets(cmd, '/r').map((t) => t.file), [path.resolve('/r', dir)]);
  });
}
// #4303: the -t forms that resolved before the cluster reading still resolve. bash 3.2 and 5 with
// GNU coreutils write M/a or M/f for `cp -t M a`, `mv -t M a`, `cp --target-directory=M a`,
// `cp --target-directory M a`, `install -t M f`, `install -m644 -t M f`, `install -m 644 -t M f`
// and `ln -t M a`, and for `cp a -tM` (getopt permutes, so an option after the operands counts).
// The first value-taking letter ends the cluster: `cp -St M/g a` and `cp -S -t M/g a` copy M/g
// to a (`t`, then the word `-t`, is -S's backup suffix), `cp -S -tfoo a M/g` writes M/g, and
// `cp -S .bak -t M a` writes M/a; `install -m -t M/g h` writes h (`-t` is the mode), and
// `ln -St M/g a` links a to M/g.
for (const [cmd, file] of [
  ['cp -t /main a', '/main'], ['mv -t /main a', '/main'], ['cp --target-directory=/main a', '/main'],
  ['cp --target-directory /main a', '/main'], ['install -t /main f', '/main'], ['install -m644 -t /main f', '/main'],
  ['install -m 644 -t /main f', '/main'], ['ln -t /main a', '/main'], ['cp a -t/main', '/main'],
  ['cp -St /main/f.js a', 'a'], ['cp -S -t /main/f.js a', 'a'], ['cp -S -tfoo a /main/f.js', '/main/f.js'],
  ['cp -S .bak -t /main a', '/main'], ['install -m -t /main/f.js g', 'g'], ['ln -St /main/f.js a', 'a'],
]) {
  test(`#4303: \`${cmd}\` resolves the file it writes`, () => {
    assert.deepStrictEqual(fileWriteTargets(cmd, '/r').map((t) => t.file), [path.resolve('/r', file)]);
  });
}
// #4303: `--` ends option parsing, so a `-t…` word after it is a source file and the last
// operand is the destination. bash 3.2 and 5 with GNU coreutils: `cp -- a -t M`, `install -- a
// -t M` and `ln -- a -t M` write M/a (each fails to stat `-t` and still writes a); `cp -- -tfoo
// M/g` and `mv -- -tfoo M/g` write M/g; `cp -tM -- -tfoo` writes M/-tfoo.
for (const [cmd, file] of [
  ['cp -- a -t /main', '/main'], ['install -- a -t /main', '/main'], ['ln -- a -t /main', '/main'],
  ['cp -- -tfoo /main/f.js', '/main/f.js'], ['mv -- -tfoo /main/f.js', '/main/f.js'], ['cp -t/main -- -tfoo', '/main'],
]) {
  test(`#4303: \`${cmd}\` reads -- as the end of options`, () => {
    assert.deepStrictEqual(fileWriteTargets(cmd, '/r').map((t) => t.file), [path.resolve('/r', file)]);
  });
}
// #4303: a GNU long option that takes a value takes the next word when no `=` follows, abbreviated
// or not, so a `-t` there is that value and no option. bash 3.2 and 5 with GNU coreutils 9.12 write
// M/g for each row (`cp --suffix -t a M/g` copies a to M/g); `install --strip -t M g` writes M/g
// (`--strip` is an exact name, so it takes no value though it abbreviates `--strip-program`), and
// `cp --backup -t M a` writes M/a (`--backup` takes a value only after `=`). macOS's BSD tools
// reject each long option and write nothing.
for (const [cmd, file] of [
  ['cp --suffix -t a /main/f.js', '/main/f.js'], ['cp --suf -t a /main/f.js', '/main/f.js'], ['mv --suffix -t a /main/f.js', '/main/f.js'],
  ['ln --suffix -t a /main/f.js', '/main/f.js'], ['install --suffix -t a /main/f.js', '/main/f.js'], ['install --mode -t a /main/f.js', '/main/f.js'],
  ['install --strip-program -t a /main/f.js', '/main/f.js'], ['install --suf -t a /main/f.js', '/main/f.js'], ['ln --suf -t a /main/f.js', '/main/f.js'],
  ['install --strip -t /main g', '/main'], ['cp --backup -t /main a', '/main'],
]) {
  test(`#4303: \`${cmd}\` reads a long option's value as no operand`, () => {
    assert.deepStrictEqual(fileWriteTargets(cmd, '/r').map((t) => t.file), [path.resolve('/r', file)]);
  });
}
// #4303: after an operand, macOS's BSD install and ln read every word as an operand, so an
// abbreviated long option there takes no value: bash 3.2 and 5 with /usr/bin/install and /bin/ln
// write M/a and M/b for `install a b --suf M` and `ln -s a b --suf M` (GNU writes b).
for (const cmd of ['install a b --suf /main', 'ln -s a b --suf /main']) {
  test(`#4303: \`${cmd}\` keeps the BSD reading of a long option after an operand`, () => {
    assert.ok(fileWriteTargets(cmd, '/r').some((t) => t.file === MAIN_ROOT), JSON.stringify(fileWriteTargets(cmd, '/r')));
  });
}
// #4303: a digit or a backup suffix in a cluster does not hide -i. bash 3.2 and 5: perl -0pi,
// -00pi and -l0pi edit M/g; perl -pi.bak edits M/g and writes M/g.bak.
for (const cmd of ["perl -0pi -e 's/a/b/' /main/f.js", "perl -00pi -e 's/a/b/' /main/f.js", "perl -l0pi -e 's/a/b/' /main/f.js",
  "perl -0777pi -e 's/a/b/' /main/f.js", "perl -pi.bak -e 's/a/b/' /main/f.js", "sed -ni.bak 's/a/b/p' /main/f.js"]) {
  test(`#4303: \`${cmd}\` is an in-place edit`, () => {
    assert.deepStrictEqual(fileWriteTargets(cmd, '/r'), [{ action: 'edit', file: MAIN_F }]);
  });
}
// A value-taking letter before i ends the cluster, so in `perl -Mi` the i is -M's module name, not
// -i; `perl -0p` and `sed -n -e p` hold no i at all, so nothing marks them in-place. bash 3.2 and 5
// write nothing for any row (`-Mi` fails, finding no i.pm; the other two print the file).
for (const cmd of ["perl -Mi -e 'print' /main/f.js", "perl -0p -e 's/a/b/' /main/f.js", "sed -n -e 'p' /main/f.js"]) {
  test(`#4303: \`${cmd}\` is a read, not an edit`, () => {
    assert.deepStrictEqual(fileWriteTargets(cmd, '/r'), []);
  });
}
// #4303: every letter that is not a value-taking option is a plain switch, so an i after it is
// still -i. bash 3.2 and 5 (Homebrew perl 5.44, macOS sed): perl -pi, -i -pe, -wpi, -0api,
// -lapi, and `-dpi` and `-pdi` under PERLDB_OPTS=NonStop edit M/g (perl's -d takes a value only
// when a `:` or `=` follows it, so d is a plain switch here; see the -d:MOD rows below); macOS
// sed -i.bak, -i.bak -n, -Ei.bak and -li.bak edit M/g (BSD sed's -l is a
// plain switch; where GNU sed's -l takes a value instead, reading l as a plain switch can only
// add a target, the fail-closed side). `sed -ni` is #70's GNU form: macOS sed takes the next
// word as its suffix and fails without writing, so the edit pinned here is GNU's (no GNU sed on
// the oracle machine) and the fail-closed side on macOS.
for (const cmd of ["perl -pi -e 's/a/b/' /main/f.js", "perl -i -pe 's/a/b/' /main/f.js", "perl -wpi -e 's/a/b/' /main/f.js",
  "perl -0api -e 's/a/b/' /main/f.js", "perl -lapi -e 's/a/b/' /main/f.js", "perl -dpi -e 's/a/b/' /main/f.js",
  "perl -pdi -e 's/a/b/' /main/f.js", "sed -i.bak 's/a/b/' /main/f.js", "sed -ni 's/a/b/p' /main/f.js",
  "sed -i.bak -n 's/a/b/p' /main/f.js", "sed -Ei.bak 's/a/b/' /main/f.js", "sed -li.bak 's/a/b/' /main/f.js"]) {
  test(`#4303: \`${cmd}\` is an in-place edit, its other letters plain switches`, () => {
    assert.deepStrictEqual(fileWriteTargets(cmd, '/r'), [{ action: 'edit', file: MAIN_F }]);
  });
}
// #4303: a `:` or `=` after perl's -d (or after its `t`) makes the rest of the cluster a debugger
// module and its arguments, so an i there is no -i. bash 3.2 and 5 (Homebrew perl 5.44, a
// Devel::Wiki module on -Ilib) leave M/g unchanged for `-d:Wiki -pe`, `-dt:Wiki -pe`, `-d=Wiki
// -pe`, `-wd:Wiki -pe` and `-d:Wiki=pi -pe`, and write nothing for `-d:Tiny -e 1` (no Devel::Tiny).
for (const cmd of ["perl -Ilib -d:Wiki -pe 's/a/b/' /main/f.js", "perl -Ilib -dt:Wiki -pe 's/a/b/' /main/f.js",
  "perl -Ilib -d=Wiki -pe 's/a/b/' /main/f.js", "perl -Ilib -wd:Wiki -pe 's/a/b/' /main/f.js",
  "perl -Ilib -d:Wiki=pi -pe 's/a/b/' /main/f.js", 'perl -d:Tiny -e 1 /main/f.js']) {
  test(`#4303: \`${cmd}\` is a read, its i inside a -d module`, () => {
    assert.deepStrictEqual(fileWriteTargets(cmd, '/r'), []);
  });
}
// The controls: a -i beside the module still edits. bash 3.2 and 5 edit M/g for `-d:Wiki -pi -e`,
// and for `-pid:Wiki -e`, whose -i reads first and takes `d:Wiki` as its backup suffix (also
// writing M/gd:Wiki).
for (const cmd of ["perl -Ilib -d:Wiki -pi -e 's/a/b/' /main/f.js", "perl -Ilib -pid:Wiki -e 's/a/b/' /main/f.js"]) {
  test(`#4303: \`${cmd}\` is an in-place edit beside a -d module`, () => {
    assert.deepStrictEqual(fileWriteTargets(cmd, '/r'), [{ action: 'edit', file: MAIN_F }]);
  });
}
// #4303: each of perl's -e -E -I -m -M -F -x -D -C and sed's -e -f takes the rest of the cluster.
// bash 3.2 and 5 write nothing for perl -Ilib, -Ipi, -Fpi, -Cpi (an unknown Unicode letter),
// -Dpi (no -DDEBUGGING), -xpi (no script found), -mpi (no pi.pm), and `-ei -e 1` and `-Epi -e 1`
// (a syntax error), nor for macOS sed `-ei.bak -e p` and `-fi.bak -e p` (each an error). The
// separate `-e` makes every positional a file, so a reading of e, E or f as a plain switch would
// report M/g.
for (const cmd of ["perl -Ilib -e 'print 1' /main/f.js", "perl -Ipi -e 's/a/b/' /main/f.js", "perl -Fpi -e 's/a/b/' /main/f.js",
  "perl -Cpi -e 's/a/b/' /main/f.js", "perl -Dpi -e 's/a/b/' /main/f.js", "perl -xpi -e 's/a/b/' /main/f.js",
  "perl -mpi -e 's/a/b/' /main/f.js", 'perl -ei -e 1 /main/f.js', 'perl -Epi -e 1 /main/f.js', 'sed -ei.bak -e p /main/f.js',
  'sed -fi.bak -e p /main/f.js']) {
  test(`#4303: \`${cmd}\` is a read, its i inside a value`, () => {
    assert.deepStrictEqual(fileWriteTargets(cmd, '/r'), []);
  });
}
// #4303: macOS sed's -I edits in place, taking its suffix as the next word. bash 3.2 and 5 with
// /usr/bin/sed: `sed -I '' 's/a/b/' M/a`, `cd M; sed -I .bak 's/a/b/' a` (also writing M/a.bak) and
// `cd M; sed -nI '' 's/a/b/' a` each edit M/a. GNU sed has no -I and rejects it, so reading -I as
// in-place there is the fail-closed side. The suffix word is read as the program, as for -i.
for (const cmd of ["sed -I '' 's/a/b/' /main/a", "cd /main; sed -I .bak 's/a/b/' a", "cd /main; sed -nI '' 's/a/b/' a"]) {
  test(`#4303: \`${cmd}\` is a BSD in-place edit`, () => {
    const files = fileWriteTargets(cmd, '/r').map((t) => t.file);
    assert.ok(files.includes(path.resolve('/main/a')), JSON.stringify(files));
  });
}

// #4015: bash ends a word at an unquoted `>`, so a redirect glued to a
// preceding word writes its target just like a spaced one.
test('AC1.1 AC2.1 #4015: a redirect glued to a preceding unquoted word resolves its target', () => {
  for (const [command, file] of [
    ['echo foo>x', 'x'], ['cat a.txt>b.txt', 'b.txt'], ['echo foo>>x', 'x'], ['echo foo>|x', 'x'],
    ['echo foo&>x', 'x'], ['echo foo2>x', 'x'], ['echo foo> x', 'x'], ['WT=/w; echo foo>$WT/x', '/w/x'],
    ['(cd sub; ls)>out.txt', 'out.txt'], // a group's redirect runs in the outer cwd, not the inner `cd`'s
    ['[[ a ]] >out', 'out'], ['(( x > y )) >out', 'out'], // a redirect after the comparison's closer still counts
    ['if (( x > y )) >out', 'out'], ['if (( x>y )); then echo hi > out; fi', 'out'],
  ]) {
    assert.deepStrictEqual(fileWriteTargets(command, '/r'), [{ action: 'write', file: path.resolve('/r', file) }], command);
  }
});

test('AC1.2 AC2.1 #4015: a `>` that is quoted, escaped, expanded, an fd dup, a sink, in a heredoc body, or in a [[ ]] / (( )) comparison resolves no target', () => {
  for (const command of [
    'echo "foo>x"', "echo 'foo>x'", 'echo foo\\>x', 'echo foo">"x', 'node -e "x>y"', 'git commit -m "a>b"',
    'V="a>b"; echo $V', 'echo foo>&2', 'echo foo>/dev/null', 'node x.js <<EOF\nif (a>0) b();\nEOF',
    '((i>0))', 'if ((n>0)); then echo hi; fi', 'while ((i>0)); do echo x; done',
    'exec 3>&-', 'cmd >&-', 'echo foo>&-',
    '[[ a>b ]]', '[[ a > b ]]', '[[ $x =~ a>b ]]', '(( x>y ))', '(( x > y ))', '(( x>y))',
    // #4210 review: a control keyword before the compound command does not make its body a redirect
    'if (( x>y )); then echo hi; fi', 'while (( i>0 )); do echo x; done', 'if [[ a>b ]]; then echo x; fi', 'if ! (( x>y ))',
  ]) {
    assert.deepStrictEqual(fileWriteTargets(command, '/r'), [], command);
  }
});

// #4149 with #4015: the glued shape is read through the shell walk, so it resolves inside a kept
// heredoc body chunk, after a lone `&`, and inside a `( )` group against that group's `cd`; and an
// arithmetic `((…))` stays one piece (no `>` in it is a target) while a `((` that bash reads as two
// subshells keeps its `cd` scope.
test('#4149: a glued redirect resolves through kept heredoc bodies, lone `&` cuts, groups and arithmetic `((…))`', () => {
  const at = (...files) => files.map((f) => ({ action: 'write', file: path.resolve(f) }));
  assert.deepStrictEqual(fileWriteTargets("bash <<'EOF'\ncd /m;echo x>f\nEOF", '/r'), at('/m/f'));
  assert.deepStrictEqual(fileWriteTargets('cd /m; true & echo x>f', '/r'), at('/m/f'));
  assert.deepStrictEqual(fileWriteTargets('cd /m & echo x>f', '/r'), at('/r/f'));
  assert.deepStrictEqual(fileWriteTargets('(cd /m; echo x>f)>out', '/r'), at('/m/f', '/r/out'));
  assert.deepStrictEqual(fileWriteTargets('((cd /m && echo hi>f) | cat)', '/r'), at('/m/f'));
  assert.deepStrictEqual(fileWriteTargets('cd /m; if ((2>1)); then echo x>f; fi', '/r'), at('/m/f'));
  assert.deepStrictEqual(fileWriteTargets('((1>0)) && echo hi>/m/f', '/r'), at('/m/f'));
});

// #4210: the word before a glued `>` may hold a quoted span — only the `>`
// itself has to be bare. A `>` inside any quote, or escaped, stays literal.
test('AC1.1 #4210: a redirect glued to a word that holds a quoted span resolves its target', () => {
  for (const [command, file] of [
    ['echo "hi">x', 'x'], ['printf "%s\\n" "$v">out.txt', 'out.txt'], ['echo foo>"x y"', 'x y'],
    ["echo 'hi'>>x", 'x'], ['echo "hi">\'x\'', 'x'], ['echo "hi"> x', 'x'], ['WT=/w; echo "hi">$WT/x', '/w/x'],
  ]) {
    assert.deepStrictEqual(fileWriteTargets(command, '/r'), [{ action: 'write', file: path.resolve('/r', file) }], command);
  }
});

test('AC1.1 #4210: a quoted, escaped, or unterminated `>` beside a bare span resolves no target', () => {
  for (const command of [
    'echo "foo>x"', "echo 'foo>x'", 'echo foo">"x', 'node -e "x>y"',
    'echo "a\\">x"', 'echo "hi"\\>x', 'echo "hi>x', 'echo "hi">x"',
  ]) {
    assert.deepStrictEqual(fileWriteTargets(command, '/r'), [], command);
  }
});

test('#4210: a mid-word quote merges the way bash does, so `cd foo"bar"` changes into foobar', () => {
  assert.deepStrictEqual(fileWriteTargets('cd foo"bar"; echo x > a', '/r'), [{ action: 'write', file: path.resolve('/r', 'foobar', 'a') }]);
});

// #4210: a one-word subshell, command substitution, or process substitution
// ends at its `)`, so a `>` right after it is a redirect. `((` is arithmetic.
test('AC2.1 #4210: a redirect after a balanced one-word subshell or substitution resolves its target', () => {
  for (const [command, file] of [
    ['(ls)>out', 'out'], ['(ls)>>out', 'out'], ['diff <(a) <(b)>out', 'out'], ['echo $(date)>x', 'x'],
    ['(ls)2>err', 'err'], ['(ls)2>>err', 'err'], // an fd number after the group: a subshell with a `2>` redirect
  ]) {
    assert.deepStrictEqual(fileWriteTargets(command, '/r'), [{ action: 'write', file: path.resolve('/r', file) }], command);
  }
});

test('AC2.1 #4210: arithmetic and nested groups stay target-free', () => {
  for (const command of ['((i>0))', '(( x>y ))', '((i>0))>x', '$((1))>x', '"a"(ls)>x']) {
    assert.deepStrictEqual(fileWriteTargets(command, '/r'), [], command);
  }
});

// #4303: `||`, `&&`, `|`, `;` and a newline inside an arithmetic `(( ))` are operators of the
// expression, so nothing cuts there and the `>` stays a comparison. bash 3.2 and 5 write no file for
// any row (a and b are 0, so the second row's cp never runs; the scanner keeps its target, which
// does not depend on the arithmetic's value: the next test). A `((` glued after `(`, `;`, `&&` or
// `|` is at a word start too.
for (const cmd of [
  '(( a>1 || b>2 ))', '(( a>1 && b>2 )) && cp a /main/f.js', '(( a>1 ||\n b>2 ))',
  '((( a>1 || b>2 )) )', 'true;(( a>1 || b>2 ))', 'true&&(( a>1 || b>2 ))', 'true|(( a>1 || b>2 ))',
]) {
  test(`AC2.1 #4303: \`${cmd}\` resolves no comparison target`, () => {
    const files = fileWriteTargets(cmd, '/r').map((t) => t.file);
    assert.ok(!files.includes(path.resolve('/r/1')) && !files.includes(path.resolve('/r/2')), JSON.stringify(files));
  });
}
test('#4303: a write after an arithmetic command is still read', () => {
  assert.deepStrictEqual(fileWriteTargets('(( a>1 && b>2 )) && cp a /main/f.js', '/r'), [{ action: 'copy', file: MAIN_F }]);
});
// An arithmetic `$(( ))` is kept whole the same way; bash 3.2 and 5 write no file for either row. A
// spaced `a>1` inside `$(( ))` still resolves `/r/1` today, as `echo $(( a>1 ))` with no separator
// does: the redirect scan reads only a leading `((` as arithmetic. That is a pre-existing spurious
// deny, which a follow-up covers, so these rows pin only that nothing cuts inside the `$(( ))`.
for (const cmd of ['echo $(( a>1 || b>2 ))', 'x=$(( a>1 | b>2 ))']) {
  test(`#4303: \`${cmd}\` keeps $(( )) whole`, () => {
    assert.deepStrictEqual(gitCommand.splitSegments(cmd), [cmd]);
  });
}
// Arithmetic that holds a command substitution runs it, so its separators still cut: bash 3.2 and 5
// write /main/f.js for each row except the `<(`/`>(` ones (noted on them). The last row resolves /r/f.js,
// the same as before #4303, though bash writes /main/f.js: the cd inside the substitution is not
// followed (a pre-existing gap with a record of its own).
for (const [cmd, file] of [
  ['echo $(( $(true; cp a /main/f.js) + 1 ))', MAIN_F],
  ['(( x = $(true; cp a /main/f.js) ))', MAIN_F],
  ['x=$(( a[$(true; cp a /main/f.js)] ))', MAIN_F],
  // bash 3.2 writes /main/f.js for a process substitution in a subscript, bash 5 does not; these
  // pins side with 3.2.
  ['(( a[<(true; cp a /main/f.js)] ))', MAIN_F],
  ['echo $(( a[>(true; cp a /main/f.js)] ))', MAIN_F],
  ['echo $(( $(cd /main; cp a f.js) + 1 ))', path.resolve('/r/f.js')],
]) {
  test(`#4303: \`${cmd}\` still reads the write inside the arithmetic's substitution`, () => {
    assert.ok(fileWriteTargets(cmd, '/r').some((t) => t.file === file), JSON.stringify(fileWriteTargets(cmd, '/r')));
  });
}
// #4303: a `$((` whose inner `(` closes at a `)` not doubled (the test groupEvents applies) is a `$(`
// holding a subshell, so arithmetic around it holds a substitution and is cut as before #4303.
// Bash 3.2 and 5 write /main/f.js for each row but the fourth, which writes /main/a (its target is
// the -t directory, as for every `cp -t`).
test('#4303: arithmetic holding a $((…) …) substitution still reads the substitution\'s write', () => {
  for (const [cmd, file] of [
    ['echo $(( $((true); cp a /main/f.js) ))', MAIN_F],
    ['(( $(((1)); cp a /main/f.js) ))', MAIN_F],
    ['echo $(( $(((1)); cp a /main/f.js) + 1 ))', MAIN_F],
    ['y=$(( $((( a>1 || b>2 )) ; cp -t /main a) + 1 ))', path.resolve('/main')],
    ['echo $(( $((cd /main; cp a f.js) ) + 1 ))', MAIN_F],
  ]) {
    assert.ok(fileWriteTargets(cmd, '/r').some((t) => t.file === file), `${cmd}: ${JSON.stringify(fileWriteTargets(cmd, '/r'))}`);
  }
  // Arithmetic, and arithmetic holding an inner `$((` that is arithmetic, stays one piece: bash 3.2
  // and 5 write nothing for the first three, and M/f.js for the last (an `&` with an inner `$((`).
  assert.deepStrictEqual(fileWriteTargets('(( a>1 || b>2 ))', '/r'), []);
  for (const cmd of ['echo $(( a>1 || b>2 ))', 'echo $(( a>1 || $(( b>2 )) ))']) assert.deepStrictEqual(gitCommand.splitSegments(cmd), [cmd]);
  assert.deepStrictEqual(fileWriteTargets('cd /main && y=$(( (1 & 3) + $((2)) )) && cp a f.js', '/r'), [{ action: 'copy', file: MAIN_F }]);
});
// A backtick inside arithmetic is an opener too: bash 3.2 and 5 write /main/f.js. Before #4303 and
// here alike, the walk resolves a malformed target from it (a write inside a backtick is the same
// pre-existing gap), so this pins only that the cut keeps a target, and the deny with it.
test('#4303: arithmetic holding a backtick keeps the target its cut resolved', () => {
  assert.notDeepStrictEqual(fileWriteTargets('echo $(( `true; cp a /main/f.js` + 1 ))', '/r'), []);
});
// A quoted `)` inside `(( ))` closes nothing (parenMatches skips quoted spans): bash 3.2 and 5 report
// an arithmetic error, then run the cp and write /main/f.js.
test('#4303: a quoted ) inside (( )) leaves the command after it visible', () => {
  assert.ok(fileWriteTargets('(( "a)" || 1 )); cp a /main/f.js', '/r').some((t) => t.file === MAIN_F));
});
// `$((true); …)` is a `$(` holding a subshell, not arithmetic: bash 3.2 and 5 write M/f.
test('#4303: a $(( that is a substitution holding a subshell still cuts its commands', () => {
  assert.ok(fileWriteTargets('x=$((true); cd /main; cp a f.js)', '/r').some((t) => t.file === MAIN_F));
});
// A `((` or `$((` whose inner `(` closes directly before a `)` is arithmetic even when it holds
// commands: bash 3.2 and 5 report an arithmetic syntax error and write nothing for each row.
test('#4303: an arithmetic (( or $(( that holds command text runs none of it', () => {
  for (const cmd of ['((cd /main; cp a f.js))', '((cd /main && cp a f.js)) || true', 'x=$((cd /main; cp a f.js))', 'echo $((cd /main\ncp a f.js))']) {
    assert.deepStrictEqual(fileWriteTargets(cmd, '/r'), [], cmd);
  }
});
// A `((` glued to `<` or `>` is a process substitution holding a subshell: bash 3.2 and 5 write
// files 1 and 2 for each `a>1 || b>2` row, and /main/f.js for each `cd` row.
test('#4303: a (( right after < or > is no arithmetic', () => {
  for (const cmd of ['<((a>1 || b>2))', 'cat <((a>1 || b>2))', 'echo >((a>1 || b>2))']) {
    assert.deepStrictEqual(fileWriteTargets(cmd, '/r').map((t) => t.file), [path.resolve('/r/1'), path.resolve('/r/2')], cmd);
  }
  for (const cmd of ['cat <((cd /main; cp a f.js))', 'echo >((cd /main; cp a f.js))']) {
    assert.deepStrictEqual(fileWriteTargets(cmd, '/r'), [{ action: 'copy', file: MAIN_F }], cmd);
  }
});
// A `$((` whose inner `(` closes at a `)` not directly followed by `)` is a `$(` holding a subshell,
// so the subshell's commands run: bash 3.2 and 5 write /main/f.js for each row (and g.js in the
// outer cwd for the fourth). The last three hold no separator, so only the walk's own reading of
// the `$((` places their command.
for (const [cmd, expected] of [
  ['x=$((cd /main; cp a f.js) )', [MAIN_F]],
  ['x=$((cd /main && cp a f.js) || true)', [MAIN_F]],
  ['echo $((cd /main; cp a f.js) )', [MAIN_F]],
  ['x=$((cd /main; cp a f.js) ); cp a g.js', [MAIN_F, path.resolve('/r/g.js')]],
  ['echo $((cp a /main/f.js) )', [MAIN_F]],
  ['x=$((cp a /main/f.js) )', [MAIN_F]],
  ['echo $((echo x > /main/f.js) )', [MAIN_F]],
]) {
  test(`#4303: \`${cmd}\` runs the subshell inside its $((`, () => {
    assert.deepStrictEqual(fileWriteTargets(cmd, '/r').map((t) => t.file), expected);
  });
}
// Its neighbours: the subshell's cd ends at its `)` (bash 3.2 and 5 write f.js in the outer cwd), and
// an arithmetic `$(( ))` holding single parens stays arithmetic (bash 3.2 and 5 write no file, and
// M/f.js after the cd).
test('#4303: a $(( subshell scopes its cd, and $(( (1+2)*3 )) stays arithmetic', () => {
  assert.deepStrictEqual(fileWriteTargets('x=$((cd /main) ; cp a f.js)', '/r'), [{ action: 'copy', file: path.resolve('/r/f.js') }]);
  assert.deepStrictEqual(fileWriteTargets('echo $(( (1+2)*3 ))', '/r'), []);
  assert.deepStrictEqual(fileWriteTargets('cd /main; echo $(( (1+2)*3 )); cp a f.js', '/r'), [{ action: 'copy', file: MAIN_F }]);
});

// #4149 with #4210: `(a(b))>x` is a syntax error in bash 3.2 and 5, which write nothing. The shell
// walk reads a `(` at command position as a subshell, so its `)>x` is the group's redirect, the same
// reading that gives `(cd /m; echo x>f)>out` its `/r/out` target (deliberate fail-closed tradeoff:
// a spurious deny on a command bash refuses to run).
test('#4149: a nested-group syntax error at command position keeps its group redirect (deliberate fail-closed tradeoff)', () => {
  assert.deepStrictEqual(fileWriteTargets('(a(b))>x', '/r'), [{ action: 'write', file: path.resolve('/r', 'x') }]);
});

// #4210 F1: a `$(`, `${` or backtick inside double quotes opens a nested context whose
// own quotes the tokenizer flips, so a `>` there looks bare though bash keeps it quoted.
test('#4210 F1: a `>` inside a nested "$( … )", "${ … }" or backtick context resolves no target', () => {
  for (const command of [
    'echo "$(jq -r ".a>1" f.json)"', 'echo "Count: $(grep -c "foo>" file)"',
    'echo "$(node -p "process.argv.length>2")"', 'echo "${x:-"a>b"}"', 'echo "$(echo "a>b")"',
    'echo "$(cmd "x y>z")"', 'echo "$(cmd "x y >z")"', 'echo "`cmd "a>b c"`"',
    "gh pr create --body \"$(cat <<'EOF'\n- treat \"x>y\" as literal\nEOF\n)\"",
    'echo "$(echo \\) "x>y")"', 'echo "$(echo \')\' "a>b")"', 'echo "$( { a; } "x>y")"',
  ]) {
    assert.deepStrictEqual(fileWriteTargets(command, '/r'), [], command);
  }
});

// #4210 F1 residual: splitSegments cuts at a `|`, `;`, `&&` or newline inside an inner
// quote of "$( … )", so the nesting state must carry across segments, not reset.
test('#4210 F1: a nested "$( … )" stays nested across a `|`, `;`, `&&` or newline segment break', () => {
  for (const command of [
    "git commit -m \"$(cat <<'EOF'\nfix: treat \"a | b>c\" as literal\nEOF\n)\"",
    "git commit -m \"$(cat <<'EOF'\nfix: treat \"a; b>c\" as literal\nEOF\n)\"",
    "gh pr create --body \"$(cat <<'EOF'\n- quote \"x\nand y>z\"\nEOF\n)\"",
    "gh pr create --body \"$(cat <<'EOF'\n- the 12\" screen\n- x>y works\nEOF\n)\"",
    'echo "$(jq -r ".a | .b > 1" f.json)"', 'echo "$(jq -r ".items | length>0" f.json)"',
    'echo "$(jq -r ".[] | select(.n > 1) | .name" f.json)"',
    'msg="$(git log -1 --format="%s | %an>")"', 'echo "$(echo "a;b>c")"', 'echo "$(grep -c "a && b>c" f)"',
    'echo "${x:-"a | b>c"}"', 'echo "$(awk -F"|" "\\$2>5" f)"',
  ]) {
    assert.deepStrictEqual(fileWriteTargets(command, '/r'), [], command);
  }
});

test('#4210 F1: a closed "$( … )" or "${ … }" still lets a later redirect resolve', () => {
  for (const [command, file] of [
    ['"$(date)">x', 'x'], ['echo "$(date)" foo>x', 'x'], ['echo "${x:-a}">y', 'y'], ['echo "\\$(" foo>x', 'x'],
    ['echo "$(jq ".a | .b" f)" > out.js', 'out.js'], ['echo "$(a | b)" > out.js', 'out.js'], ['echo "$(a)"; echo y>z', 'z'],
  ]) {
    assert.deepStrictEqual(fileWriteTargets(command, '/r'), [{ action: 'write', file: path.resolve('/r', file) }], command);
  }
});

// #4210 review: two shapes the nesting walk used to leave nested for the rest of the
// command, hiding a later genuine redirect that main resolved. A heredoc opened inside
// "$( … )" is found by stripHeredocBodies, so its body's `'` or backtick is data; a `(`,
// `)` or `'` inside "${ … }" is literal word text, so only the `}` closes it.
test('#4210 review: a heredoc body inside "$( … )" does not leave the nesting state open', () => {
  for (const [command, file] of [
    ["git commit -m \"$(cat <<'EOF'\nDon't merge yet\nEOF\n)\" && echo x > out.js", 'out.js'],
    ["git commit -m \"$(cat <<'EOF'\nfix: it's done\nEOF\n)\" && git push && echo ok > status.txt", 'status.txt'],
    ["git commit -m \"$(cat <<'EOF'\nuse `x` here (and (this\nEOF\n)\" && echo y > o.js", 'o.js'],
    ["git commit -m \"$(cat <<'EOF'\nDon't\nEOF\n)\" > out.js", 'out.js'],
    ["gh pr create --body \"$(cat <<'EOF'\n- treat \"x>y\" as literal\nEOF\n)\" && echo a > b.js", 'b.js'],
  ]) {
    assert.deepStrictEqual(fileWriteTargets(command, '/r'), [{ action: 'write', file: path.resolve('/r', file) }], command);
  }
  assert.deepStrictEqual(fileWriteTargets("git commit -m \"$(cat <<'EOF'\nfoo > bar\nEOF\n)\"", '/r'), []);
});

// #4149 with #4210: a heredoc opened inside a quoted "$( … )" is planned against the
// substitution's own text, not the outer line, so the reader allowlist judges the command that
// reads the body. bash 3.2 and 5 write f (and g) for each shell case; the cat message writes nothing.
test('#4149 with #4210: a heredoc inside a quoted "$( … )" is judged by the substitution\'s own command', () => {
  const at = (...files) => files.map((f) => ({ action: 'write', file: path.resolve('/r', f) }));
  for (const [command, files] of [
    ["echo \"$(bash <<'EOF'\necho x > f\nEOF\n)\"", ['f']],
    ["echo \"$(sh <<'EOF'\necho x > f\nEOF\n)\" && echo y > g", ['f', 'g']],
    ["echo \"$(make -f - <<'EOF'\nall:\n\techo x > f\nEOF\n)\"", ['f']],
    ["echo \"$(cat <<'EOF' | sh\necho x > f\nEOF\n)\"", ['f']],
    ["echo \"$(cat <<'EOF'\nx>y\nEOF\n)\" \"$(bash <<'EOF'\necho z > f\nEOF\n)\"", ['f']],
  ]) {
    assert.deepStrictEqual(fileWriteTargets(command, '/r'), at(...files), command);
  }
  assert.deepStrictEqual(fileWriteTargets("git commit -m \"$(cat <<'EOF'\nfix: a > b, it's done\nEOF\n)\"", '/r'), []);
});

// #4149 with #4210: a command nested past NEST_LEVEL_CAP re-reads flat, and the flat split cuts at
// a `|` or `;` inside "$( … )"; the walk carries the nesting state across that cut, so the inner `>`
// stays quoted. bash 3.2 and 5 write only out.js and z.
test('#4149 with #4210: a capped pass carries the "$( … )" nesting state across a piece cut', () => {
  const deep = `: "${'$('.repeat(40)}true${')'.repeat(40)}"; `;
  for (const [command, files] of [
    ['echo "$(jq -r ".a | .b > 1" f.json)"', []],
    ['echo "$(jq -r ".a | .b > 1" f.json)" > out.js', ['out.js']],
    ['echo "$(echo "a;b>c")"', []],
    ['echo "$(grep -c "a && b>c" f)"; echo y > z', ['z']],
  ]) {
    assert.deepStrictEqual(fileWriteTargets(deep + command, '/r'), files.map((f) => ({ action: 'write', file: path.resolve('/r', f) })), command);
  }
});

test('#4210 review: a literal `(`, `)` or `\'` inside "${ … }" does not leave the nesting state open', () => {
  for (const [command, file] of [
    ['echo "${x:-(}" > out.js', 'out.js'], ['echo "${x//(/y}" > out.js', 'out.js'], ['echo "${x:-it\'s}" > out.js', 'out.js'],
  ]) {
    assert.deepStrictEqual(fileWriteTargets(command, '/r'), [{ action: 'write', file: path.resolve('/r', file) }], command);
  }
  for (const command of ['echo "${x:-a>b}"', 'echo "${x:-"a>b"}"', 'echo "${x:-(}"; echo "${y:-"a>b"}"']) {
    assert.deepStrictEqual(fileWriteTargets(command, '/r'), [], command);
  }
});

// #4210 review: the single-quote guard on `$NAME` substitution reads the `$`'s own span, so a
// quoted span elsewhere in the token no longer hides a bare reference, and a `$` that sits in
// single quotes (or is backslash-escaped) is still literal.
test('#4210 review: a bare $NAME beside a single-quoted span expands; a quoted or escaped one does not', () => {
  for (const [command, file] of [
    ["WT=/w; echo 'hi'>$WT/x", '/w/x'], ['WT=/w; echo "hi">$WT/x', '/w/x'], ["WT=/w; echo '$WT'>x", 'x'],
    ["WT=/w; cd 'a'$WT && echo x > y", 'a/w/y'],
  ]) {
    assert.deepStrictEqual(fileWriteTargets(command, '/r'), [{ action: 'write', file: path.resolve('/r', file) }], command);
  }
  for (const command of ["WT=/w; echo hi > '$WT/x'", 'WT=/w; echo hi > \\$WT/x']) {
    assert.deepStrictEqual(fileWriteTargets(command, '/r'), [], command);
  }
});

// #4210 F2: an escaped character before the `>` is part of the word, as in bash; an
// escaped `>` itself stays literal.
test('#4210 F2: an escaped character before a glued `>` still resolves its target', () => {
  for (const [command, file] of [
    ['echo foo\\ bar>out.txt', 'out.txt'], ['cat My\\ File.txt>out.txt', 'out.txt'], ['echo a\\\\>x', 'x'], ['echo \\"hi\\">x', 'x'],
  ]) {
    assert.deepStrictEqual(fileWriteTargets(command, '/r'), [{ action: 'write', file: path.resolve('/r', file) }], command);
  }
  for (const command of ['echo foo\\>x', 'echo "$(awk "{print \\$1>2}" f)"']) {
    assert.deepStrictEqual(fileWriteTargets(command, '/r'), [], command);
  }
});

// #4210 F3: a token that starts with `>` is a redirect only when the operator itself is
// bare on the token as typed; a quoted `>` or one a `$VAR` expands to is a word.
test('#4210 F3: a quoted or expanded leading `>` resolves no target', () => {
  for (const command of ['echo ">x"', 'echo ">"x', 'gh issue comment 1 --body "> quoted reply"', 'V=">x"; echo $V']) {
    assert.deepStrictEqual(fileWriteTargets(command, '/r'), [], command);
  }
});

test('#4210 F3: a bare leading operator still resolves, with a quoted or $VAR target', () => {
  for (const [command, file] of [
    ['echo x > tracked.js', 'tracked.js'], ['echo x >out.js', 'out.js'], ['cmd 2>> err.log', 'err.log'],
    ['cmd &> f', 'f'], ['cmd >| f', 'f'], ['WT=/w; echo x >$WT/a', '/w/a'], ['echo hi >"x y"', 'x y'],
    ['echo ">"x>y', 'y'],
  ]) {
    assert.deepStrictEqual(fileWriteTargets(command, '/r'), [{ action: 'write', file: path.resolve('/r', file) }], command);
  }
});

// #3989: a heredoc body is data for the reading program, not shell — its `>`
// is not a redirection. The opener line and whatever follows the closing
// delimiter still are scanned.
test('#3989: a heredoc body is not scanned for redirections (bare, quoted, and tab-stripped delimiters)', () => {
  // The trailing redirect proves the body ended at its closing delimiter: an
  // unterminated body (run to end of string) would also resolve no body target.
  const after = [{ action: 'write', file: path.resolve('/r', 'after.js') }];
  assert.deepStrictEqual(fileWriteTargets('node x.js <<EOF\nif (a.length > 0) b();\nEOF\necho x > after.js', '/r'), after);
  for (const opener of ["<<'EOF'", '<<"EOF"']) {
    assert.deepStrictEqual(fileWriteTargets(`node x.js ${opener}\nif (a.length > 0) b();\nEOF\necho x > after.js`, '/r'), after, opener);
  }
  assert.deepStrictEqual(fileWriteTargets('node x.js <<-EOF\nif (a.length > 0) b();\n\tEOF\necho x > after.js', '/r'), after, '<<- with a tab-indented closing delimiter');
});

test('#3989: the opener-line redirect survives, the body redirect does not', () => {
  assert.deepStrictEqual(fileWriteTargets('node x.js > out.js <<EOF\nif (a > 0) b();\nEOF', '/r'),
    [{ action: 'write', file: path.resolve('/r', 'out.js') }]);
});

test('#3989: commands after the closing delimiter are still scanned', () => {
  assert.deepStrictEqual(fileWriteTargets('node x.js <<EOF\na > b\nEOF\necho x > after.js', '/r'),
    [{ action: 'write', file: path.resolve('/r', 'after.js') }]);
});

test('#3989: a CRLF closing delimiter still ends the body, and two openers on one line consume their bodies in order', () => {
  const after = [{ action: 'write', file: path.resolve('/r', 'after.js') }];
  assert.deepStrictEqual(fileWriteTargets('node x.js <<EOF\na > b\r\nEOF\r\necho x > after.js', '/r'), after);
  assert.deepStrictEqual(fileWriteTargets('node x.js <<A <<B\nx > a\nA\ny > b\nB\necho x > after.js', '/r'), after);
});

test('#3989: a body fed to a shell is still scanned (bash, pipe into sh, unresolvable program word)', () => {
  const expected = [{ action: 'write', file: path.resolve('/r', 'f.js') }];
  assert.deepStrictEqual(fileWriteTargets('bash <<EOF\necho x > f.js\nEOF', '/r'), expected);
  assert.deepStrictEqual(fileWriteTargets('cat <<EOF | sh\necho x > f.js\nEOF', '/r'), expected);
  assert.deepStrictEqual(fileWriteTargets('$SHELL <<EOF\necho x > f.js\nEOF', '/r'), expected);
});

// Fix round 1 (#3989): bash expands `$(...)` and backticks in an unquoted body, so
// those bodies stay visible; a quoted delimiter's body is never expanded.
// The parser is token-based, so the closing `)` stays on the target name (`f.js)`),
// exactly as a one-line `echo $(echo x > f.js)` already does on main. The gate
// needs the write to resolve inside the repo, which it does.
// A redirect inside backticks is not resolved, before or after #3989: a token that
// carries a backtick is unresolvable by isUnresolvable. The backtick case below
// therefore uses a backtick command that is its own word and a plain redirect.
test('#3989: an unquoted heredoc body with a command substitution still resolves its redirect', () => {
  const targets = fileWriteTargets('cat <<EOF\n$(echo x > f.js)\nEOF', '/r');
  assert.strictEqual(targets.length, 1);
  assert.ok(targets[0].file.startsWith(path.resolve('/r', 'f.js')), targets[0].file);
});

test('#3989: an unquoted heredoc body with a backtick keeps its plain redirect', () => {
  assert.deepStrictEqual(fileWriteTargets('cat <<EOF\n`true`; echo x > g.js\nEOF', '/r'), [{ action: 'write', file: path.resolve('/r', 'g.js') }]);
});

test('#3989: a quoted heredoc delimiter is never expanded, so its body command substitution resolves nothing', () => {
  assert.deepStrictEqual(fileWriteTargets("node x.js <<'EOF'\n$(echo x > f.js)\nEOF", '/r'), []);
  assert.deepStrictEqual(fileWriteTargets('node x.js <<"EOF"\n$(echo x > f.js)\nEOF', '/r'), []);
});

// Fix round 1 (#3989): an opener bash reads differently from this parser (or a
// body with no closing line) must not swallow the commands after it. Each opener
// below is a real command in bash; the trailing redirect must still resolve.
test('#3989: a body with no closing delimiter keeps the text from its opener on, so a trailing redirect resolves', () => {
  const f = [{ action: 'write', file: path.resolve('/r', 'f.js') }];
  for (const opener of [
    '(#<<EOF', 'echo $[1<<2]', 'echo ${x:-<<y}', '(( x = 1 +\n1 << 2 ))',
    "cat <<'E\\F'", 'cat <<"E\\F"', "cat <<$'EOF'",
  ]) {
    assert.deepStrictEqual(fileWriteTargets(`${opener}\nbody\necho x > f.js`, '/r'), f, JSON.stringify(opener));
  }
});

test('#3989: a delimiter with a backslash ends at its own spelling, as bash reads it', () => {
  const f = [{ action: 'write', file: path.resolve('/r', 'f.js') }];
  assert.deepStrictEqual(fileWriteTargets("cat <<'E\\F'\nx > a\nE\\F\necho x > f.js", '/r'), f);
  assert.deepStrictEqual(fileWriteTargets('cat <<"E\\F"\nx > a\nE\\F\necho x > f.js', '/r'), f);
});

// Fix round 1 (#3989): a line ending in a continuation operator hands its bodies to
// the next command, so they stay visible.
test('#3989: an opener line ending in |, && or || keeps its bodies, since the next command receives them', () => {
  const f = [{ action: 'write', file: path.resolve('/r', 'f.js') }];
  assert.deepStrictEqual(fileWriteTargets('cat <<EOF |\necho x > f.js\nEOF\nsh', '/r'), f);
  assert.deepStrictEqual(fileWriteTargets('cat <<EOF &&\necho x > f.js\nEOF\nsh', '/r'), f);
  assert.deepStrictEqual(fileWriteTargets('cat <<EOF ||   # piped on\necho x > f.js\nEOF\nsh', '/r'), f);
});

// Fix round 1 (#3989): the shell carve-out covers the wider shell family and the
// wrappers that run a program, and a backslash no longer hides a shell's name.
test('#3989: the shell carve-out covers su, tcsh, versioned shells, backslash-escaped names, and wrapped shells', () => {
  const f = [{ action: 'write', file: path.resolve('/r', 'f.js') }];
  for (const opener of [
    'sudo -s', 'sudo -i', 'sudo --login', 'su', 'tcsh', 'csh', 'rbash', 'pwsh', '/opt/bin/bash5',
    'bas\\h', 'C:\\bin\\sh', 'sudo $SHELL', 'env $SHELL', 'env -i $SHELL', 'sudo -u root $SHELL', 'nohup $X',
  ]) {
    assert.deepStrictEqual(fileWriteTargets(`${opener} <<EOF\necho x > f.js\nEOF`, '/r'), f, opener);
  }
  assert.deepStrictEqual(fileWriteTargets('sudo node x.js <<EOF\nif (a > 0) b();\nEOF', '/r'), [], 'a wrapper running a non-shell program is not widened');
});

// Fix round 2 (#3989): a shell reader the carve-out must still recognize, in the shapes
// a glued operator, a group, or a process substitution gives it. Each body runs as
// shell in bash, so its `echo x > f.js` must still resolve.
test('#3989: a shell glued to its heredoc operator (`sh<<EOF`, `bash<<-EOF`) keeps its body visible', () => {
  const f = [{ action: 'write', file: path.resolve('/r', 'f.js') }];
  assert.deepStrictEqual(fileWriteTargets('sh<<EOF\necho x > f.js\nEOF', '/r'), f);
  assert.deepStrictEqual(fileWriteTargets('bash<<-EOF\necho x > f.js\nEOF', '/r'), f);
});

test('#3989: a shell in a group or process substitution (`(bash)`, `| (bash)`, `tee >(bash)`) keeps its body visible', () => {
  const f = [{ action: 'write', file: path.resolve('/r', 'f.js') }];
  assert.deepStrictEqual(fileWriteTargets('(bash) <<EOF\necho x > f.js\nEOF', '/r'), f);
  assert.deepStrictEqual(fileWriteTargets('cat <<EOF | (bash)\necho x > f.js\nEOF', '/r'), f);
  // `tee` names every non-flag argument as a file, so the `>(bash)` word also
  // resolves, as it did before #3989; the body's real write must be among them.
  assert.ok(fileWriteTargets('cat <<EOF | tee >(bash)\necho x > f.js\nEOF', '/r').some((t) => t.file === path.resolve('/r', 'f.js')));
});

// Fix round 2 (#3989): bash decodes `$'...'`/`$"..."`, which this parser does not, so
// a terminator here is unprovable. The text from the opener on stays visible.
test('#3989: a `$\'...\'` heredoc delimiter is unprovable, so a planted terminator cannot strip a real command', () => {
  assert.deepStrictEqual(fileWriteTargets("cat <<$'EOF'\nEOF\necho x > f.js\n$EOF", '/r'), [{ action: 'write', file: path.resolve('/r', 'f.js') }]);
  assert.deepStrictEqual(fileWriteTargets('cat <<$"EOF"\nEOF\necho x > f.js\n$EOF', '/r'), [{ action: 'write', file: path.resolve('/r', 'f.js') }]);
});

// Fix round 3 (#3989): bash decodes `$'...'`/`$"..."` anywhere in the delimiter word,
// not only at its start, so `a$'EOF'` ends at `aEOF`. Any `$'`/`$"` is unprovable.
test('#3989: a `$\'...\'` or `$"..."` delimiter mid-word is unprovable too, so the trailing redirect resolves', () => {
  const f = [{ action: 'write', file: path.resolve('/r', 'f.js') }];
  assert.deepStrictEqual(fileWriteTargets("cat <<a$'EOF'\naEOF\necho x > f.js\na$EOF", '/r'), f);
  assert.deepStrictEqual(fileWriteTargets('cat <<a$"EOF"\naEOF\necho x > f.js\na$EOF', '/r'), f);
  assert.deepStrictEqual(fileWriteTargets("cat <<'a'$'EOF'\naEOF\necho x > f.js\na$EOF", '/r'), f);
});

test('#3989 sanity: a plain quoted-free heredoc body is still stripped, so the stripping still works', () => {
  assert.deepStrictEqual(fileWriteTargets('node x.js <<EOF\nif (a > 0) b();\nEOF', '/r'), []);
});

test('#3989: a here-string, an arithmetic shift, a quoted `<<`, and a comment are not heredoc openers', () => {
  const expected = [{ action: 'write', file: path.resolve('/r', 'f.js') }];
  assert.deepStrictEqual(fileWriteTargets('cat <<< "a > b"', '/r'), []);
  assert.deepStrictEqual(fileWriteTargets('cat <<<x > f.js', '/r'), expected);
  assert.deepStrictEqual(fileWriteTargets('echo $((1<<2))\necho x > f.js', '/r'), expected);
  assert.deepStrictEqual(fileWriteTargets('echo "<<EOF"\necho x > f.js', '/r'), expected);
  assert.deepStrictEqual(fileWriteTargets('echo "<<EOF x"\necho x > f.js', '/r'), expected, 'a complete word inside double quotes is still not an opener');
  assert.deepStrictEqual(fileWriteTargets('echo hi # <<EOF\necho x > f.js', '/r'), expected);
  // #4149: with a closing `EOF` line, only the comment rule keeps `echo x > f.js` out of a body.
  assert.deepStrictEqual(fileWriteTargets('echo hi # <<EOF\necho x > f.js\nEOF', '/r'), expected);
});

// #4303: heredoc bodies are planned to MAX_HEREDOC_NESTING (8) levels; deeper, a body is
// walked whole, so a data body there stays visible (fail closed). One level less still strips.
// bash 3.2 and 5 write nothing at either depth (the inner cat prints its body), so the past-cap
// target is a deliberate spurious deny.
{
  const nest = (levels, inner) => {
    let s = inner;
    for (let k = levels; k >= 1; k -= 1) s = `bash <<'E${k}'\n${s}\nE${k}`;
    return s;
  };
  const dataBody = "cat <<'X'\necho x > /main/f.js\nX";
  test('#4303: a data body below the heredoc nesting cap is stripped', () => {
    assert.deepStrictEqual(fileWriteTargets(nest(7, dataBody), '/r'), []);
  });
  test('#4303: a data body past the heredoc nesting cap stays visible (deliberate fail-closed tradeoff)', () => {
    assert.deepStrictEqual(fileWriteTargets(nest(8, dataBody), '/r'), [{ action: 'write', file: MAIN_F }]);
  });
}

// #4149: a body is stripped only when the opener line feeds it to a known data reader
// (an allowlist), not whenever no shell name shows up (a denylist). Each case is its
// own test, so one regression going red never hides the others.
{
  const f = [{ action: 'write', file: path.resolve('/r', 'f.js') }];
  const keepCases = [
    ['a non-shell executor (make -f -)', 'make -f - <<EOF\nall:\n\techo x > f.js\nEOF', f],
    ['a non-shell executor (at now)', 'at now <<EOF\necho x > f.js\nEOF', f],
    ['a glob-named shell (/bin/ba[s]h)', '/bin/ba[s]h <<EOF\necho x > f.js\nEOF', f],
    ['xargs running a shell', 'xargs sh -c x <<EOF\necho x > f.js\nEOF', f],
    ['a brace group whose consumer is on a later line', '{ cat <<EOF\necho x > f.js\nEOF\n} | sh', f],
    ['a subshell group whose consumer is on a later line', '(cat <<EOF\necho x > f.js\nEOF\n) | sh', f],
    ['sudo with an option value (sudo -u bob node)', 'sudo -u bob node x.js <<EOF\necho x > f.js\nEOF', f],
    ['a program name spelled two ways (ca\\t)', 'ca\\t <<EOF\necho x > f.js\nEOF', f],
    ['a non-reader segment before a reader (xargs x && node)', 'xargs x && node y.js <<EOF\necho x > f.js\nEOF', f],
    ['an inert word behind a wrapper (env echo)', 'env echo <<EOF\necho x > f.js\nEOF', f],
    ['an inert neighbour that runs a command substitution (| echo $(bash))', "cat <<'EOF' | echo $(bash)\necho x > f.js\nEOF", f],
    ['an inert neighbour that runs a backtick (| echo `bash`)', "cat <<'EOF' | echo `bash`\necho x > f.js\nEOF", f],
    ['git bisect run sh (git running a shell)', 'git bisect run sh <<EOF\necho x > f.js\nEOF', f],
    ['git rebase -x sh (git running a shell)', 'git rebase -x sh HEAD~1 <<EOF\necho x > f.js\nEOF', f],
    ['a path-qualified relative program (./cat)', './cat <<EOF\necho x > f.js\nEOF', f],
    ['a path-qualified relative wrapper (./sudo node)', './sudo node x.js <<EOF\necho x > f.js\nEOF', f],
    ['a path-qualified relative wrapper (./env node)', './env node x.js <<EOF\necho x > f.js\nEOF', f],
    ['a program path with a variable directory (/$D/cat)', '/$D/cat <<EOF\necho x > f.js\nEOF', f],
    // #4149: `&` ends a command, so an inert word or a reader before it
    // never vouches for the backgrounded program after it.
    ['a shell after an inert echo and a lone & (echo hi & bash)', "echo hi & bash <<'EOF'\necho x > f.js\nEOF\nwait", f],
    ['a shell after an inert true and a lone & (true & sh)', "true & sh <<'EOF'\necho x > f.js\nEOF", f],
    ['a shell after an inert mkdir and a lone & (mkdir -p d & sh)', "mkdir -p d & sh <<'EOF'\necho x > f.js\nEOF", f],
    ['a shell after an inert cd and a lone & (cd . & bash)', "cd . & bash <<'EOF'\necho x > f.js\nEOF", f],
    ['a shell after a reader and a lone & (cat x & bash)', "cat x & bash <<'EOF'\necho x > f.js\nEOF", f],
    // #4149: `git add` is an inert neighbour only on its own, so these stay kept.
    ['git add reading pathspecs from stdin (--pathspec-from-file=-)', "cat <<'EOF' | git add --pathspec-from-file=-\necho x > f.js\nEOF", f],
    ['git add behind a wrapper (sudo git add)', "sudo git add . && cat <<'EOF'\necho x > f.js\nEOF", f],
    ['git add that runs a command substitution (| git add $(bash))', "cat <<'EOF' | git add $(bash)\necho x > f.js\nEOF", f],
    // bash + git: `git -c core.fsmonitor='sh -s' add` runs its stdin as a script, so config makes it no neighbour.
    ['git add with a -c config flag (git -c core.fsmonitor=… add)', "cat <<'EOF' | git -c core.fsmonitor=x add .\necho x > f.js\nEOF", f],
    ['git add with a --config-env flag', "cat <<'EOF' | git --config-env=core.fsmonitor=V add .\necho x > f.js\nEOF", f],
    ['git add after an assignment (GIT_CONFIG_COUNT=1 git add)', "cat <<'EOF' | GIT_CONFIG_COUNT=1 git add .\necho x > f.js\nEOF", f],
    // #4149: configuration can make any git subcommand run a command that reads stdin
    // (bash + git: `git -c core.fsmonitor='sh -s' commit -F -` runs the body), so git behind a
    // -c/--config-env flag or a NAME=value prefix is no reader, commit included.
    ['git commit with a -c config flag, piped', "cat <<'EOF' | git -c core.fsmonitor='sh -s' commit -F -\necho x > f.js\nEOF", f],
    ['git commit with a -c config flag', "git -c core.fsmonitor='sh -s' commit -F - <<'EOF'\necho x > f.js\nEOF", f],
    ['git commit with a --config-env flag', "git --config-env=core.fsmonitor=V commit -F - <<'EOF'\necho x > f.js\nEOF", f],
    ['git commit after an assignment (GIT_CONFIG_COUNT=1 git commit)', "GIT_CONFIG_COUNT=1 git commit -F - <<'EOF'\necho x > f.js\nEOF", f],
    ['git commit after an assignment behind env (env GIT_CONFIG_COUNT=1 git commit)', "env GIT_CONFIG_COUNT=1 git commit -F - <<'EOF'\necho x > f.js\nEOF", f],
    // #4149: a reader that a pipe feeds is no reader when it carries `$(` or a backtick:
    // the substitution runs with that element's stdin (bash 3.2 and 5 run these bodies). The
    // heredoc's own command is refused too when a pipe feeds it, since its substitution reads the pipe.
    ['a reader piped on whose quoted argument runs $( ) (| jq "$(bash)")', "cat <<'EOF' | jq \"$(bash)\"\necho x > f.js\nEOF", f],
    ['a reader piped on whose argument runs $( ) (| jq $(bash))', "cat <<'EOF' | jq $(bash)\necho x > f.js\nEOF", f],
    ['a reader piped on whose quoted argument runs a backtick (| jq "`bash`")', "cat <<'EOF' | jq \"`bash`\"\necho x > f.js\nEOF", f],
    ['node piped on with a $( ) argument (| node "$(bash)")', "cat <<'EOF' | node \"$(bash)\"\necho x > f.js\nEOF", f],
    ['a reader piped on with a $( ) inside a ${ } default (| jq "${x:-$(bash)}")', "cat <<'EOF' | jq \"${x:-$(bash)}\"\necho x > f.js\nEOF", f],
    ['a piped-to reader with its own heredoc whose argument runs $( ) (| jq "$(sh)" <<B)', "cat <<'EOF' | jq \"$(sh)\" <<'B'\necho x > f.js\nEOF\nb\nB", f],
    ['a reader piped on with |&, with its own heredoc, whose argument runs $( ) (|& jq "$(sh)" <<B)', "cat <<'EOF' |& jq \"$(sh)\" <<'B'\necho x > f.js\nEOF\nb\nB", f],
    // #4149: a redirection word after the heredoc's `<<` is expanded with the body already
    // on fd 0 (bash 3.2 and 5 run each of these bodies), so the own command is exempt only for a
    // substitution before its first `<<`.
    ['its own command, with a quoted $( ) redirect after the << (> "$(bash)")', "cat <<'EOF' > \"$(bash)\"\necho x > f.js\nEOF", f],
    ['its own command, with an unquoted $( ) redirect after the << (>$(bash))', "cat <<'EOF' >$(bash)\necho x > f.js\nEOF", f],
    ['its own command, with a backtick redirect after the << (> "`bash`")', "cat <<'EOF' > \"`bash`\"\necho x > f.js\nEOF", f],
    ['its own command, with a stderr $( ) redirect after the << (jq . 2>"$(bash)")', "jq . <<'EOF' 2>\"$(bash)\"\necho x > f.js\nEOF", f],
    ['its own command, with an appending $( ) redirect after the << (>>"$(bash)")', "tee -a /dev/null <<'EOF' >>\"$(bash)\"\necho x > f.js\nEOF", f],
    ['its own command, with an input $( ) redirect after the << (<"$(bash)")', "cat <<'EOF' <\"$(bash)\"\necho x > f.js\nEOF", f],
    ['its own command, with a $( ) here-string after the << (3<<<"$(bash)")', "cat <<'EOF' 3<<<\"$(bash)\"\necho x > f.js\nEOF", f],
    ['its own command, with a $( ) redirect after a dup after the << (2>&1 >"$(bash)")', "cat <<'EOF' 2>&1 >\"$(bash)\"\necho x > f.js\nEOF", f],
    ['git commit as its own command, with a $( ) redirect after the <<', "git commit -F - <<'EOF' 2>\"$(bash)\"\necho x > f.js\nEOF", f],
    ['gh as its own command, with a $( ) redirect after the <<', "gh issue comment 1 --body-file - <<'EOF' >\"$(sh)\"\necho x > f.js\nEOF", f],
    ['env cat as its own command, with a $( ) redirect after the <<', "env cat <<'EOF' >\"$(bash)\"\necho x > f.js\nEOF", f],
    // #4149: `$((cmd) )` is a `$(` holding a `(cmd)` subshell, not arithmetic (bash 3.2 and 5 run
    // these bodies): a `$((` is arithmetic only when it closes as `))` past its own balanced parens.
    ['a reader piped on whose quoted argument is $((cmd) ) (| jq "$((bash) )")', "cat <<'EOF' | jq \"$((bash) )\"\necho x > f.js\nEOF", f],
    ['a reader piped on whose argument is $((cmd) ) (| jq $((bash) ))', "cat <<'EOF' | jq $((bash) )\necho x > f.js\nEOF", f],
    ['a reader piped on whose argument is $((cmd) | cat)', "cat <<'EOF' | jq \"$((bash) | cat)\"\necho x > f.js\nEOF", f],
    ['a reader piped on whose argument is $((cmd); true)', "cat <<'EOF' | jq \"$((bash); true)\"\necho x > f.js\nEOF", f],
    ['node piped on whose argument is $((cmd) ) (| node "$((sh) )")', "cat <<'EOF' | node \"$((sh) )\"\necho x > f.js\nEOF", f],
    ['its own command, with a $((cmd) ) redirect after the << (>"$((bash) )")', "cat <<'EOF' >\"$((bash) )\"\necho x > f.js\nEOF", f],
    ['a reader piped on whose argument runs $( ) before a quoted ) (| jq "$(bash))")', "cat <<'EOF' | jq \"$(bash))\"\necho x > f.js\nEOF", f],
  ];
  for (const [label, cmd, expected] of keepCases) {
    test(`#4149: a body fed to ${label} stays visible`, () => {
      assert.deepStrictEqual(fileWriteTargets(cmd, '/r'), expected);
    });
  }

  const stripCases = [
    ['sudo node', 'sudo node x.js <<EOF\nif (a > 0) b();\nEOF'],
    ['env FOO=1 node', 'env FOO=1 node x.js <<EOF\nif (a > 0) b();\nEOF'],
    ['git commit -F -', 'git commit -F - <<EOF\nfix: a > b\nEOF'],
    ['git -C x commit -F -', 'git -C x commit -F - <<EOF\nfix: a > b\nEOF'],
    ['gh pr create --body-file -', 'gh pr create --body-file - <<EOF\na > b\nEOF'],
    ['python3 -', 'python3 - <<EOF\nif a > 0: pass\nEOF'],
    ['bare cat', 'cat <<EOF\nnothing here\nEOF'],
    ['an absolute-path reader (/bin/cat)', '/bin/cat <<EOF\na > b\nEOF'],
    ['a quoted jq filter with parentheses', 'jq "(.a)" <<EOF\na > b\nEOF'],
    ['a quoted node -e with parentheses', "node -e '(async()=>{})()' <<EOF\na > b\nEOF"],
    // #4149: cd, mkdir, true, :, echo and printf neither read
    // stdin nor run an argument, so as stand-alone neighbour segments they pass. `cd x && node`
    // was a deliberate keep before this ruling; it now strips.
    ['a reader after a cd neighbour (cd x && node)', 'cd x && node y.js <<EOF\nif (a > 0) b();\nEOF'],
    ['a reader after a cd neighbour (cd x && node, quoted delimiter)', "cd x && node <<'EOF'\na > b\nEOF"],
    ['a reader after true, printf, echo and : neighbours', "true && printf x && echo y && : && cat <<'EOF'\na > b\nEOF"],
    // #4149: the `&` of `|&` pipes on, so the program after it is the one checked.
    ['a reader piped on with |& (cat |& cat)', "cat <<'EOF' |& cat\na > b\nEOF"],
  ];
  for (const [label, cmd] of stripCases) {
    test(`#4149: a body fed to ${label} is still stripped`, () => {
      assert.deepStrictEqual(fileWriteTargets(cmd, '/r'), []);
    });
  }
}

// An escaped quote opens no span, so the process substitution after it is still seen as a group.
for (const [label, cmd] of [
  ['an escaped single quote', "cat <<EOF | tee \\' >(bash) \\'\necho x > f.js\nEOF"],
  ['an escaped double quote', 'cat <<EOF | tee \\" >(bash) \\"\necho x > f.js\nEOF'],
]) {
  test(`#4149: a process substitution after ${label} keeps the body visible`, () => {
    const targets = fileWriteTargets(cmd, '/r');
    assert.ok(targets.some((t) => t.file === path.resolve('/r', 'f.js')), JSON.stringify(targets));
  });
}

// ANSI-C quoting honours `\'` inside `$'...'`, which the quote scan does not parse: any `$'` on
// the opener line keeps the body visible (fail closed, like a `$'` delimiter).
test("#4149: a process substitution after an ANSI-C $'\\'' quote keeps the body visible", () => {
  const targets = fileWriteTargets("cat <<EOF | tee $'\\'' >(bash) '\n'\necho x > f.js\nEOF", '/r');
  assert.ok(targets.some((t) => t.file === path.resolve('/r', 'f.js')), JSON.stringify(targets));
});

test("#4149: a data-only body on a line with $'...' is deliberately kept visible (fail closed)", () => {
  const targets = fileWriteTargets("cat $'a' <<EOF\na > b\nEOF", '/r');
  assert.ok(targets.some((t) => t.file === path.resolve('/r', 'b')), JSON.stringify(targets));
});

test('#4149: the word after a bare << is the delimiter, not a copy destination', () => {
  assert.deepStrictEqual(fileWriteTargets('cp a.js /main/f.js << EOF\nx\nEOF', '/r'), [{ action: 'copy', file: MAIN_F }]);
});

test('#4149: a quoted << argument is a file argument, not a heredoc operator', () => {
  const tee = fileWriteTargets("tee '<<' /main/f.js", '/r');
  assert.ok(tee.some((t) => t.action === 'write' && t.file === MAIN_F), JSON.stringify(tee));
  assert.deepStrictEqual(fileWriteTargets("cp a.js '<<' /main/f.js", '/r'), [{ action: 'copy', file: MAIN_F }]);
  const dq = fileWriteTargets('tee "<<x" /main/f.js', '/r');
  assert.ok(dq.some((t) => t.action === 'write' && t.file === MAIN_F), JSON.stringify(dq));
  // An unquoted operator with a quoted delimiter is still a heredoc operator.
  assert.deepStrictEqual(fileWriteTargets("tee out.txt <<'EOF'\na > b\nEOF", '/r'), [{ action: 'write', file: path.resolve('/r', 'out.txt') }]);
});

test('#4149: a shell loop on the opener line keeps its body (deliberate fail-closed tradeoff)', () => {
  const targets = fileWriteTargets('while read l; do echo "$l"; done <<EOF\na > b\nEOF', '/r');
  assert.ok(targets.some((t) => t.file === path.resolve('/r', 'b')),
    'a non-reader segment (`while read l`) keeps the body visible even though this loop only reads it: the fail-closed side of the allowlist');
});

test('#4149: tee with a heredoc reports only its file, not the heredoc operator', () => {
  assert.deepStrictEqual(fileWriteTargets('tee out.txt <<EOF\na > b\nEOF', '/r'), [{ action: 'write', file: path.resolve('/r', 'out.txt') }]);
});

test('#4149: an unquoted heredoc joins a backslash-continued line before matching the delimiter', () => {
  const f = [{ action: 'write', file: path.resolve('/r', 'f.js') }];
  // Bash joins `E\` + `OF` into `EOF`, ends the body there, and runs the next line.
  assert.deepStrictEqual(fileWriteTargets('cat <<EOF\nE\\\nOF\necho x > f.js\nEOF', '/r'), f);
  // A quoted delimiter takes no continuation: the whole body is data.
  assert.deepStrictEqual(fileWriteTargets("cat <<'EOF'\nE\\\nOF\necho x > f.js\nEOF", '/r'), []);
  // `E\\` is a literal backslash (even run), not a continuation.
  assert.deepStrictEqual(fileWriteTargets('cat <<EOF\nE\\\\\nOF\necho x > f.js\nEOF', '/r'), []);
  // ...so the next line is its own line and may close the body (a join on any backslash would swallow it).
  assert.deepStrictEqual(fileWriteTargets('cat <<EOF\nx\\\\\nEOF\necho x > f.js\nEOF', '/r'), f);
  // `<<-` strips leading tabs from the joined line.
  assert.deepStrictEqual(fileWriteTargets('cat <<-EOF\n\tE\\\nOF\necho x > f.js\nEOF', '/r'), f);
});

// Bash continues only on backslash-LF: backslash-CR-LF is a literal backslash and CR, so nothing joins.
test('#4149: a backslash before CRLF is not a continuation', () => {
  // No line equals the delimiter before the last one, so the whole body is data.
  assert.deepStrictEqual(fileWriteTargets('cat <<EOF\r\nE\\\r\nOF\r\necho x > f.js\r\nEOF', '/r'), []);
  assert.deepStrictEqual(fileWriteTargets('cat <<EOF\r\nE\\\\\r\nOF\r\necho x > f.js\r\nEOF', '/r'), []);
});

test('#4149: mixed line endings - backslash-CRLF does not swallow the LF-terminated delimiter', () => {
  const f = [{ action: 'write', file: path.resolve('/r', 'f.js') }];
  assert.deepStrictEqual(fileWriteTargets('cat <<EOF\na\\\r\nEOF\necho x > f.js\nEOF\n', '/r'), f);
});

test('#4149: an unterminated heredoc ending in an odd backslash stays visible, with or without a final LF', () => {
  const f = [{ action: 'write', file: path.resolve('/r', 'f.js') }];
  assert.deepStrictEqual(fileWriteTargets('cat <<EOF\necho x > f.js\nfoo\\', '/r'), f);
  assert.deepStrictEqual(fileWriteTargets('cat <<EOF\necho x > f.js\nfoo\\\n', '/r'), f);
});

test('#4149: `<<` inside `$[ … ]` arithmetic is not a heredoc opener, even on a reader line', () => {
  assert.deepStrictEqual(fileWriteTargets('cat $[1<<3]\necho x > f.js\n3]', '/r'), [{ action: 'write', file: path.resolve('/r', 'f.js') }]);
});

test('#4149: an array subscript inside `$[ … ]` nests and does not close the arithmetic early', () => {
  const f = [{ action: 'write', file: path.resolve('/r', 'f.js') }];
  assert.deepStrictEqual(fileWriteTargets('cat $[ a[1]<<3 ]\necho x > f.js\n3', '/r'), f);
  // Nested `$[ ]` still balances, so the `<<` is arithmetic and the next line runs.
  assert.deepStrictEqual(fileWriteTargets('cat $[ $[1] <<3 ]\necho x > f.js\n3', '/r'), f);
  assert.deepStrictEqual(fileWriteTargets('cat $[ $[1<<2] <<3 ]\necho x > f.js\n3', '/r'), f);
});

test('#4149: only an unquoted `$[` opens arithmetic, and a stray `]` never goes negative', () => {
  // A `$[` inside quotes opens nothing, so the following `<<EOF` is a real opener and its body is data.
  assert.deepStrictEqual(fileWriteTargets("cat '$[' <<EOF\na > b\nEOF", '/r'), []);
  assert.deepStrictEqual(fileWriteTargets('cat "$[" <<EOF\na > b\nEOF', '/r'), []);
  // A `]` with no open `$[` is ignored: the heredoc after it still opens.
  assert.deepStrictEqual(fileWriteTargets('cat ] <<EOF\na > b\nEOF', '/r'), []);
  // #4149: bash's `$[` spans lines, so the depth carries over the newline and the
  // `<<` on the next line is no opener; the body text stays visible.
  assert.deepStrictEqual(fileWriteTargets('cat $[1\ncat <<EOF\na > b\nEOF', '/r'), [{ action: 'write', file: path.resolve('/r', 'b') }]);
});

test('#3989: stripHeredocBodies keeps the opener line and its newline, and drops the body and closing delimiter', () => {
  assert.deepStrictEqual(stripHeredocBodies('cat <<EOF\nbody\nEOF\nB'), { outer: 'cat <<EOF\nB', bodies: [] });
  // #4149: a program that is not a known data reader keeps its body, as its own chunk anchored at its `<<`.
  // #4149: `shell` says the opener line names a known shell, so the chunk's own
  // openers are trusted; any other kept chunk is also scanned whole.
  assert.deepStrictEqual(stripHeredocBodies('A <<EOF\nbody\nEOF\nB'), { outer: 'A <<EOF\nB', bodies: [{ at: 2, text: 'body\n', shell: false }] });
  assert.deepStrictEqual(stripHeredocBodies('bash <<EOF\nbody\nEOF'), { outer: 'bash <<EOF\n', bodies: [{ at: 5, text: 'body\n', shell: true }] });
  assert.deepStrictEqual(stripHeredocBodies('cat <<<x'), { outer: 'cat <<<x', bodies: [] });
});

// #4149: a kept body is scanned as its own chunk, from fresh quote state and the
// cwd in effect at its opener; the outer text resumes after the delimiter with the outer cwd.
// So an odd quote in body prose never swallows a later command, and a body `cd` never moves it.
{
  const r = (action, file) => ({ action, file: path.resolve('/r', file) });
  const m = (action) => ({ action, file: MAIN_F });
  for (const [label, cmd, expected] of [
    ['an apostrophe in a body fed to grep', "grep -c x <<'EOF'\ndon't\nEOF\ncp cmd.sh /main/f.js", [m('copy')]],
    ['an apostrophe in a body after a mkdir neighbour', "mkdir -p d && cat > d/n <<'EOF'\nit's\nEOF\nsed -i s/a/b/ /main/f.js", [r('write', 'd/n'), m('edit')]],
    ['a double quote in a body piped to head', "cat <<'EOF' | head -1\na 5\" screen\nEOF\ncp cmd.sh /main/f.js", [m('copy')]],
    ['a cd line in a body after a mkdir neighbour', "mkdir -p d && cat > d/n <<'EOF'\n    cd /tmp\nEOF\ncp cmd.sh f.js", [r('write', 'd/n'), r('copy', 'f.js')]],
    ['a cd line in a body read by `read … || true`', "IFS= read -r X <<'EOF' || true\n    cd /tmp\nEOF\ncp cmd.sh f.js", [r('copy', 'f.js')]],
    ['a cd line in a body fed to grep', "grep -c x <<'EOF'\ncd /tmp\nEOF\ncp cmd.sh f.js", [r('copy', 'f.js')]],
    ['a cd line in a body fed to bash', "bash <<'EOF'\ncd /tmp\nEOF\ncp cmd.sh f.js", [r('copy', 'f.js')]],
    ['a body whose opener runs before a later cd on its line', "cd /main && bash <<'EOF' && cd /r\necho x > f.js\nEOF", [m('write')]],
    // #4149: a nested `<<` inside a kept body never plans an outer heredoc.
    ['a nested opener inside a kept body', "sh <<'EOF'\ncat <<'X'\nEOF\necho x > f.js\nX", [r('write', 'f.js')]],
    // A kept body's own openers are planned within the chunk, so its reader-fed inner body is data.
    ['an inner reader-fed body inside a kept body', "bash <<'EOF'\ncat > s.txt <<'X'\na > /main/b\nX\necho y > f.js\nEOF", [r('write', 's.txt'), r('write', 'f.js')]],
  ]) {
    test(`#4149: ${label} is scanned as its own chunk`, () => {
      assert.deepStrictEqual(fileWriteTargets(cmd, '/r'), expected);
    });
  }
}

// #4149: a group, compound command or substitution left open on an earlier line can
// hand a later body to a consumer that line cannot show, so every later body is kept (sticky).
{
  const W = "cat <<'EOF'\necho x > f.js\nEOF";
  for (const [label, cmd] of [
    ['a brace group', `{\n${W}\n} | bash`],
    ['a subshell', `(\n${W}\n) | bash`],
    ['if … fi', `if true; then\n${W}\nfi | bash`],
    ['for … done', `for i in 1; do\n${W}\ndone | bash`],
    ['while … done', `while true; do\n${W}\nbreak; done | bash`],
    ['until … done', `until false; do\n${W}\nbreak; done | bash`],
    ['select … done', `select v in a; do\n${W}\nbreak; done | bash`],
    ['case … esac', `case x in x)\n${W}\n;; esac | bash`],
    ['a function body', `f() {\n${W}\n}\nf | bash`],
    ['a process substitution', `bash <(\n${W}\n)`],
    ['a command substitution', `x=$(\n${W}\n)\neval "$x"`],
    ['a backtick substitution', `x=\`\n${W}\n\`\neval "$x"`],
    ['a subshell whose case pattern `)` closes nothing', `( case x in a) true;; esac\n${W}\n) | bash`],
    ['a subshell with a `}` argument', `( echo }\n${W}\n) | bash`],
    ['a multi-line (( arithmetic', '(( x = 1 +\ncat << 2 ))\necho x > f.js\n2'],
    // #4149: a closer word outside closer position closes nothing.
    ['a brace group whose `}` argument closes nothing', `{ true }\n${W}\n} | bash`],
    ['if … fi with a `fi` argument', `if true; then true fi\n${W}\nfi | bash`],
    ['for … done with a `done` argument', `for i in 1; do true done\n${W}\ndone | bash`],
    ['case … esac with an `esac` argument', `case x in x) true esac\n${W}\n;; esac | bash`],
  ]) {
    test(`#4149: a body after ${label} opened on an earlier line stays visible`, () => {
      const targets = fileWriteTargets(cmd, '/r');
      assert.ok(targets.some((t) => t.file === path.resolve('/r', 'f.js')), JSON.stringify(targets));
    });
  }

  test('#4149: an unclosed $( on the opener line itself keeps its body', () => {
    const targets = fileWriteTargets("cat <<'EOF' $(\necho x > f.js\nEOF\n)", '/r');
    assert.ok(targets.some((t) => t.file === path.resolve('/r', 'f.js')), JSON.stringify(targets));
  });

  test('#4149: a structure opened and closed on one earlier line does not keep a later body', () => {
    assert.deepStrictEqual(fileWriteTargets("if true; then echo; fi\ngit commit -F - <<'EOF'\na > /main/x\nEOF", '/r'), []);
    assert.deepStrictEqual(fileWriteTargets("for v in a b; do echo $v; done\ncat > f <<'EOF'\na > /main/x\nEOF", '/r'), [{ action: 'write', file: path.resolve('/r', 'f') }]);
    assert.deepStrictEqual(fileWriteTargets("x=$(git rev-parse HEAD)\ngit commit -F - <<'EOF'\na > /main/x\nEOF", '/r'), []);
  });

  // `((` also opens nested subshells in bash (`((cd . && true) | cat)`): single parens inside it are
  // counted, so it closes at its final `)` and a later line's opener still opens.
  test('#4149: a one-line nested subshell spelled (( does not suppress a later opener', () => {
    const targets = fileWriteTargets("((cd . && true) | cat)\ncat <<'EOF'\ndon't\nEOF\necho x > f.js", '/r');
    assert.deepStrictEqual(targets, [{ action: 'write', file: path.resolve('/r', 'f.js') }]);
  });
}

test("#4149: an unquoted $' on an earlier line keeps every later body visible", () => {
  const targets = fileWriteTargets("echo $'\\'\ncat <<EOF\n' ; echo x > f.js\nEOF", '/r');
  assert.ok(targets.some((t) => t.file === path.resolve('/r', 'f.js')), JSON.stringify(targets));
});

test('#4149: `$[` arithmetic spans lines, so a `<<` on its next line is no opener', () => {
  const targets = fileWriteTargets('echo $[1 +\ncat <<3]\necho x > f.js\n3]', '/r');
  assert.ok(targets.some((t) => t.file === path.resolve('/r', 'f.js')), JSON.stringify(targets));
});

// #4149: `((` and `$((` count the single parens inside them and span lines, so a
// `<<` on a later line before the closing `))` is a shift, and `((…) …)` closes at its final `)`.
for (const [label, cmd] of [
  ['a multi-line (( whose shift would hide a later cd', '(( x = 1 +\n1 << 2 ))\ncd /main\n2\ncp /etc/hosts f.js'],
  ['a multi-line (( whose shift would hide a later quote', '(( x = 1 +\n1 << 2 ))\necho "\n2\n"; cp /etc/hosts /main/f.js'],
  ['a multi-line $(( whose shift would hide a later cd', 'echo $((1 +\n1 << 2))\ncd /main\n2\ncp /etc/hosts f.js'],
  ['a one-line ((…) …) nested subshell before a reader-fed body', "((cd . && true) | cat)\ncat <<'EOF'\ndon't\nEOF\ncp /etc/hosts /main/f.js"],
  ['a multi-line (( holding single parens', '(( (1) + (2) +\n1 << 2 ))\ncd /main\n2\ncp /etc/hosts f.js'],
  ['a multi-line $(( holding single parens', 'echo $(( (1) + (2) +\n1 << 2 ))\ncd /main\n2\ncp /etc/hosts f.js'],
]) {
  test(`#4149: ${label} reports the write`, () => {
    assert.deepStrictEqual(fileWriteTargets(cmd, '/r'), [{ action: 'copy', file: MAIN_F }]);
  });
}

// #4149: a `cd` behind `(` or `{` is a `cd`. A subshell's cwd ends at its
// `)`; a brace group's `cd` may outlive its `}` (unless the group is piped), so after a `}` a
// relative target resolves under both the inner and the outer cwd. #4303: a group is one command
// of the and-or list around it, so `&&` after it runs where it succeeded and `||` where it failed;
// a piped group runs in a subshell, so the command after the pipeline runs from where it began.
{
  const main = (action) => ({ action, file: MAIN_F });
  for (const [label, cmd, expected] of [
    ['(cd … && bash <<EOF … )', "(cd /main && bash <<'EOF'\necho x > f.js\nEOF\n)", [main('write')]],
    ['{ cd … && bash <<EOF … }', "{ cd /main && bash <<'EOF'\necho x > f.js\nEOF\n}", [main('write')]],
    ['(cd … && cp a f.js)', '(cd /main && cp a f.js)', [main('copy')]],
    ['( cd … && cp a f.js ) with separate parens', '( cd /main && cp a f.js )', [main('copy')]],
    ['(FOO=1 cd … && cp a f.js), an assignment-prefixed cd', '(FOO=1 cd /main && cp a f.js)', [main('copy')]],
    ['a nested subshell that closes before the outer write', '(cd /main && (cd /tmp && true) && cp a f.js)', [main('copy')]],
    ['a subshell whose case pattern `)` closes nothing', 'cd /main; (case x in x) cd /tmp;; esac; true); cp a f.js', [main('copy')]],
    ['a subshell whose $( … ) closes nothing', 'cd /main; (x=$(pwd); cd /tmp && true); cp a f.js', [main('copy')]],
    // The `)` of a case pattern cuts the text, so the arm's command is read as a command.
    ['a case arm', 'case x in x) cp a /main/f.js;; esac', [main('copy')]],
    // The body feeds the subshell, so a shell inside it runs the body from the subshell's cwd.
    ['a body fed to a subshell running a shell', "(cd /main; bash) <<'EOF'\necho x > f.js\nEOF", [main('write')]],
  ]) {
    test(`#4149 group cd: ${label} reports the main-checkout write`, () => {
      assert.deepStrictEqual(fileWriteTargets(cmd, '/r'), expected);
    });
  }

  test('#4149 group cd: a subshell cd ends at its `)`', () => {
    assert.deepStrictEqual(fileWriteTargets('(cd /tmp && true); cp a f.js', '/r'), [{ action: 'copy', file: path.resolve('/r', 'f.js') }]);
  });

  test('#4149 group cd: after a brace group closes, a relative target resolves under both cwds', () => {
    const targets = fileWriteTargets('{ cd /main; }; cp a f.js', '/r').map((t) => t.file);
    assert.ok(targets.includes(MAIN_F) && targets.includes(path.resolve('/r', 'f.js')), JSON.stringify(targets));
  });
}

// #4303: an assignment word holding a `$( … )` or backtick with spaces is one word to bash, so
// the `cd` after it changes the shell's cwd. bash 3.2 and 5 write M/f for each.
for (const cmd of ['x=$(cd /tmp) cd /main; echo hi | tee f.js', 'x=`cd /tmp` cd /main; cp a f.js', 'x=$(cd /tmp)y cd /main; cp a f.js',
  'a=1 x=$(echo a b) cd /main; cp a f.js']) {
  test(`#4303: \`${cmd}\` changes into the cd after the assignment`, () => {
    assert.ok(fileWriteTargets(cmd, '/r').some((t) => t.file === MAIN_F), JSON.stringify(fileWriteTargets(cmd, '/r')));
  });
}
// #4303: an appending assignment is an assignment word too. bash 3.2 and 5 write M/f.js for each.
for (const cmd of ['x+=1 cd /main; cp a f.js', 'x+=1 y=2 cd /main; cp a f.js', 'x=1 y+=2 cd /main; cp a f.js', 'x+=1 cd /main && cp a f.js']) {
  test(`#4303: \`${cmd}\` changes into the cd after the appending assignment`, () => {
    assert.deepStrictEqual(fileWriteTargets(cmd, '/r'), [{ action: 'copy', file: MAIN_F }]);
  });
}
// The control: an appending assignment on its own changes no cwd. bash 3.2 and 5 write f.js in the
// start cwd for `x+=1; cp a f.js`, and M/f.js for `x+=1; cp a M/f.js`.
test('#4303: an appending assignment alone leaves the cwd as it was', () => {
  assert.deepStrictEqual(fileWriteTargets('x+=1; cp a f.js', '/r'), [{ action: 'copy', file: path.resolve('/r/f.js') }]);
  assert.deepStrictEqual(fileWriteTargets('x+=1; cp a /main/f.js', '/r'), [{ action: 'copy', file: MAIN_F }]);
});
// bash 3.2 and 5 refuse to parse this ("unexpected EOF") and write nothing; the scanner keeps
// the trailing write as a deliberate fail-closed tradeoff, which this pin holds.
test('#4303: an assignment whose substitution never closes is no cd lead (deliberate fail-closed tradeoff)', () => {
  assert.deepStrictEqual(fileWriteTargets('x=$(cd /tmp cd /main; cp a /r2/f.js', '/r').map((t) => t.file), [path.resolve('/r2/f.js')]);
});
// #4303: a quoted or escaped paren, or one inside a backtick span, is not the word's own, so the
// word ends at its closing paren or backtick (bash 3.2 and 5 write M/f.js); and it ends there, so a
// `cd` that is an argument, or glued onto the word, changes nothing (bash 3.2 and 5 write f.js).
test('#4303: the assignment word ends at its closing backtick or paren', () => {
  for (const cmd of ['x=`echo (` cd /main; cp a f.js', 'x=$(echo "(") cd /main; cp a f.js', 'x=$(echo \\() cd /main; cp a f.js']) {
    assert.deepStrictEqual(fileWriteTargets(cmd, '/r'), [{ action: 'copy', file: MAIN_F }], cmd);
  }
  for (const cmd of ['x=$(echo a b) echo cd /main; cp a f.js', 'x=$(echo a b)cd /main; cp a f.js']) {
    assert.deepStrictEqual(fileWriteTargets(cmd, '/r'), [{ action: 'copy', file: path.resolve('/r/f.js') }], cmd);
  }
});
// #4303: a bare `cd` after such a word is followed too. It goes to $HOME, a cwd the walk cannot read,
// so nothing after it resolves, as for a bare `cd` alone (bash 3.2 and 5 write $HOME/f.js for both
// rows). Before the word was read whole, the first row's `cd` was missed and /r/f.js resolved.
test('#4303: a bare cd after an assignment word is followed as a bare cd is', () => {
  for (const cmd of ['x=$(echo a b) cd; cp a f.js', 'cd; cp a f.js']) {
    assert.deepStrictEqual(fileWriteTargets(cmd, '/r'), [], cmd);
  }
});
// #4303: the assignment word is read before substitution, so `$V=1` is a command name and the
// `cd` after it an argument (bash 3.2 and 5: "x=1: command not found", and write f.js).
test('#4303: an expanded `$V=1` is no assignment, so the cd after it changes nothing', () => {
  assert.deepStrictEqual(fileWriteTargets('V=x; $V=1 cd /main; cp a f.js', '/r'), [{ action: 'copy', file: path.resolve('/r/f.js') }]);
});
// #4303: a `${ … }` or `$[ … ]` with a space is one word to bash too. Inside `${ … }` a `(`, `)` or
// `{` is word text and the first bare `}` closes it; `$[ … ]` closes at its own `]`, past any
// `[ … ]` or `$( … )` inside; a quoted `{` after `$` opens nothing, and a `]` closes no `$(`.
// bash 3.2 and 5 write M/f.js for each, except `$(echo ${a:-) c})`: bash 3.2 cannot parse it,
// bash 5 writes M/f.js, and the pin sides with bash 5.
for (const cmd of ['x=${a:-b c} cd /main; echo x > f.js', 'x=${a:+b c} cd /main; echo x > f.js', 'x=${a:-(} cd /main; echo x > f.js',
  'x=$[1 + 2] cd /main; echo x > f.js', 'x=${a:-$(echo b c)} cd /main; echo x > f.js', 'x=${a:-) b} cd /main; echo x > f.js',
  'x=${a:-\\} b} cd /main; echo x > f.js', 'x=$(echo ${a:-) c}) cd /main; echo x > f.js',
  'a=(1 2); x=$[a[1] + 2] cd /main; echo x > f.js', 'x=$[ $(echo 1) + 2 ] cd /main; echo x > f.js',
  'x=$"{" cd /main; echo x > f.js', 'x=$(echo ] b) cd /main; echo x > f.js',
  'x=${a:-${b:-c d} e} cd /main; echo x > f.js', 'x=${a:-$[1 + 2] b} cd /main; echo x > f.js']) {
  test(`#4303: \`${cmd}\` changes into the cd after the assignment`, () => {
    assert.deepStrictEqual(fileWriteTargets(cmd, '/r'), [{ action: 'write', file: MAIN_F }]);
  });
}
// #4303: the first bare `}` closes `${ … }`, so in `${a:-{b c} d}` the `d}` is the command and the
// `cd` its argument (bash 3.2 and 5: "d}: command not found", and write f.js).
test('#4303: `${ … }` in an assignment word closes at its first bare `}`', () => {
  assert.deepStrictEqual(fileWriteTargets('x=${a:-{b c} d} cd /main; echo x > f.js', '/r'), [{ action: 'write', file: path.resolve('/r/f.js') }]);
});
// #4303: bash 3.2 and 5 refuse to parse these ("unexpected EOF") and write nothing; the scanner
// keeps the trailing write as a deliberate fail-closed tradeoff.
test('#4303: an assignment whose `${` or `$[` never closes is no cd lead (deliberate fail-closed tradeoff)', () => {
  for (const cmd of ['x=${a:-b c cd /main; echo x > /r2/f.js', 'x=$[1 + 2 cd /main; echo x > /r2/f.js']) {
    assert.deepStrictEqual(fileWriteTargets(cmd, '/r').map((t) => t.file), [path.resolve('/r2/f.js')], cmd);
  }
});
// #4303: a word that never closes swallows the `cd` after it, which is then no command: bash 3.2 and
// 5 refuse each row and write nothing, and the walk never follows that `cd` (before #4303 each row
// resolved /main/f.js, reading the `cd` as one).
test('#4303: the cd after an assignment word that never closes is not followed', () => {
  for (const cmd of ['x=$(true cd /main; cp a f.js', 'x=${a:-b cd /main; echo x > f.js', 'x=$[1 cd /main; echo x > f.js']) {
    assert.ok(!fileWriteTargets(cmd, '/r').some((t) => t.file === MAIN_F), cmd);
  }
});

// #4149: the write walk cuts at an unquoted lone `&`, so the command after it is
// read as a command; the backgrounded and-or list runs in a subshell, so its `cd` does not move the
// cwd for what follows. `&&`, `&>`, `>&`, `<&`, `|&` and an `&` inside `$( )` are not cuts.
{
  const main = (action) => ({ action, file: MAIN_F });
  const here = (action) => ({ action, file: path.resolve('/r', 'f.js') });
  for (const [label, cmd, expected] of [
    ['a write after a backgrounded command (true & cp)', 'true & cp /etc/hosts /main/f.js', [main('copy')]],
    ['a write after a backgrounded cd (cd /tmp & cp)', 'cd /tmp & cp a f.js', [here('copy')]],
    ['a write after a backgrounded and-or list (cd /tmp && true & cp)', 'cd /tmp && true & cp a f.js', [here('copy')]],
    ['a write after |&, which pipes on', 'cd /main && echo |& cp a f.js', [main('copy')]],
    ['a write after an & inside $( )', 'cd /main && echo $(true & true) && cp a f.js', [main('copy')]],
    ['a write after an & inside a subshell, from the subshell cwd', 'cd /main && (true & cp a f.js)', [main('copy')]],
    // A group inside the backgrounded list: the list began before the group, so its cd is undone too.
    ['a write after a backgrounded list holding a subshell', 'cd /tmp && (true) & cp a f.js', [here('copy')]],
    ['a write after a backgrounded list holding a brace group', 'cd /tmp && { true; } & cp a f.js', [here('copy')]],
    ['a write after &>', 'cd /main && true &>/dev/null && cp a f.js', [main('copy')]],
    ['a write after >&', 'cd /main && true >&2 && cp a f.js', [main('copy')]],
    ['a write after <&', 'cd /main && true <&0 && cp a f.js', [main('copy')]],
  ]) {
    test(`#4149 lone & walk: ${label} resolves as bash runs it`, () => {
      assert.deepStrictEqual(fileWriteTargets(cmd, '/r'), expected);
    });
  }
}

// #4303: inside `$(( ))` or `$[ ]`, `&` is bitwise and, also inside a bare `(` there, so the cd
// before it holds. The first four rows put the arithmetic `&` inside `x=$(true; … )`, where it would
// otherwise cut that substitution's own list; the later rows put it in the outer list and in an
// assignment word (the last two are the ones that reach a bare `(`'s frame check). bash 3.2 and 5
// write M/f for `cd M; y=$(( (1 & 3) )); echo x > f` and `x=$[1 & 3]; cd M; echo x > f`, M/f.js for
// each row, `x=$[1 & 3] cd /main; cp a f.js` among them, and run the S49 shape's `git commit` in M.
for (const [cmd, expected] of [
  ['x=$(true; cd /main && y=$(( (1 & 3) )) && cp a f.js)', [{ action: 'copy', file: MAIN_F }]],
  ['x=$(true; cd /main && y=$[1 & 3] && cp a f.js)', [{ action: 'copy', file: MAIN_F }]],
  ['x=$(true; cd /main && y=$[ (1 & 3) + a[1] ] && cp a f.js)', [{ action: 'copy', file: MAIN_F }]],
  ['x=$(true; cd /main && (( (1 & 3) )) && cp a f.js)', [{ action: 'copy', file: MAIN_F }]],
  ['cd /main && y=$[1 & 3] && cp a f.js', [{ action: 'copy', file: MAIN_F }]],
  // A subscript before the `&`: `$[` closes at its own `]`, past the subscript's.
  ['cd /main && y=$[ a[1] & 3 ] && cp a f.js', [{ action: 'copy', file: MAIN_F }]],
  // An assignment holding `$[ … & … ]` is one word, so the cd after it changes the shell's cwd.
  ['x=$[1 & 3] cd /main; cp a f.js', [{ action: 'copy', file: MAIN_F }]],
  // So is one holding a bare `(` with an `&` inside arithmetic: that `(` takes its frame's no-list
  // reading, so nothing cuts the word (cutting it leaves `y cd /main` a tail on its own, which
  // misses M). These are the rows that reach a bare `(`'s frame check: a cut inside a deeper level
  // resets only that level's list.
  ['x=$(( (1 & 3) )) cd /main; cp a f.js', [{ action: 'copy', file: MAIN_F }]],
  ['x=$(( (a & 3) ))y cd /main; cp a f.js', [{ action: 'copy', file: MAIN_F }]],
]) {
  test(`#4303: \`${cmd}\` keeps the cd past an arithmetic &`, () => {
    assert.deepStrictEqual(fileWriteTargets(cmd, '/r'), expected);
  });
}
test('#4303: the S49 shape commits in the main checkout', () => {
  assert.ok(gitTargets('x=$(true; cd /main && y=$(( (1 & 3) )) && git commit -am x)', '/r').some((t) => t.dir === path.resolve('/main')));
});
// #4303: an `&` after the `]` still backgrounds, and the text after a `]` that closes a piece cut
// inside it is the outer command's (its redirect writes from the outer cwd). bash 3.2 and 5 write
// f.js in the starting directory for both.
test('#4303: the `]` of `$[ … ]` ends the arithmetic', () => {
  assert.deepStrictEqual(fileWriteTargets('cd /main && y=$[1 & 3] & cp a f.js', '/r'), [{ action: 'copy', file: path.resolve('/r/f.js') }]);
  assert.deepStrictEqual(fileWriteTargets('y=$[ $(true; cd /tmp; true & true) + 1 ] > f.js', '/r'), [{ action: 'write', file: path.resolve('/r/f.js') }]);
  // The cd after such a `]` is read as the outer command's (a tail, so the start cwd stays too):
  // bash 3.2 and 5 write M/f.js.
  assert.ok(fileWriteTargets('x=$[ $(true; true) + 1 ] cd /main; cp a f.js', '/r').some((t) => t.file === MAIN_F));
});
// #4303: a `$[` opened on an earlier line keeps its subscript count across a segment whose pass is
// read again flat (a `${` nest past NEST_LEVEL_CAP), so the second pass starts from the count the
// first began with and the `] ]` on the next line still closes the `$[`. bash 3.2 and 5 write f.js
// in the starting directory for both rows (the `&` backgrounds the cd).
test('#4303: a flat second pass inside a multi-line `$[ … ]` restarts its subscript count', () => {
  const deep = `"${'${x:-'.repeat(40)}x${'}'.repeat(40)}"`;
  for (const cmd of [`y=$[ 1 +\na[${deep}\n] ]; cd /tmp & cp a f.js`, 'y=$[ 1 +\na[1\n] ]; cd /tmp & cp a f.js']) {
    assert.deepStrictEqual(fileWriteTargets(cmd, '/r'), [{ action: 'copy', file: path.resolve('/r/f.js') }], cmd.slice(0, 40));
  }
});
// #4303: a process substitution is a command list, and a bare `(` outside arithmetic may be a
// subshell (a function body, `coproc`), so an `&` in either still cuts and the command after it is
// read. bash 3.2 and 5 write M/f.js for the `<( )` and /r2/f.js for the function body; bash 3.2
// cannot parse `coproc`, and bash 5 writes /r2/f.js (the pin sides with 5).
test('#4303: an & in a process substitution or a bare ( outside arithmetic still cuts', () => {
  assert.deepStrictEqual(fileWriteTargets('cd /main && cat <(true & cp a f.js) >/dev/null', '/r'), [{ action: 'copy', file: MAIN_F }]);
  for (const cmd of ['f() ( true & cp a /r2/f.js ); f', 'coproc ( true & cp a /r2/f.js )']) {
    assert.deepStrictEqual(fileWriteTargets(cmd, '/r'), [{ action: 'copy', file: path.resolve('/r2/f.js') }], cmd);
  }
});
// #4303: an `&` inside a top-level backtick backgrounds only the backtick's own list.
// bash 3.2 and 5 write M/f.js.
test('#4303: an & inside a top-level backtick does not undo the outer cd', () => {
  assert.deepStrictEqual(fileWriteTargets('cd /main && x=`true | true & true` && echo x > f.js', '/r'), [{ action: 'write', file: MAIN_F }]);
});

// #4303: `&&` and `||` make a cd's effect depend on whether it succeeds, and a pipeline element
// runs in a subshell. Each verdict is bash 3.2 and 5 (M = /main, T = /tmp, start = /r).
{
  const here = path.resolve('/r/f.js');
  const files = (cmd) => fileWriteTargets(cmd, '/r').map((t) => t.file).sort();
  for (const [cmd, mustHold] of [
    ['cd /main || cd /tmp; echo x > f.js', [MAIN_F]],              // bash: M/f
    ['cd /nope && cd /tmp; echo x > f.js', [here]],                 // bash: ./f
    ['cd /main || cd /tmp && echo x > f.js', [MAIN_F]],             // bash: M/f
    ['cd /nope && true || echo x > f.js', [here]],                  // bash: ./f
    ['cd /nope && cd /tmp || echo x > f.js', [here]],               // bash: ./f
    ['true | cd /main; echo x > f.js', [here]],                     // bash: ./f
    ['{ cd /main; } | cat; echo x > f.js', [here]],                 // bash: ./f
  ]) {
    test(`#4303 and-or: \`${cmd}\` keeps the cwd bash may write from`, () => {
      for (const f of mustHold) assert.ok(files(cmd).includes(f), JSON.stringify(files(cmd)));
    });
  }
  // bash: ./f
  test('#4303 and-or: a pipeline element\'s cd never reaches the next list', () => {
    assert.deepStrictEqual(files('cd /main | true; echo x > f.js'), [here]);
  });
  // bash: M/f (and nothing when the cd fails)
  test('#4303 and-or: the command after cd && runs only where the cd went', () => {
    assert.deepStrictEqual(files('cd /main && cp a f.js'), [MAIN_F]);
  });
  // bash: ./f when the cd fails (and nothing when it succeeds)
  test('#4303 and-or: the command after cd || runs only where a failed cd left it', () => {
    assert.deepStrictEqual(files('cd /main || cp a f.js'), [here]);
  });
  // bash: M/f
  test('#4303 and-or: a substitution\'s separators leave the outer list alone', () => {
    assert.deepStrictEqual(files('cd /main && echo $(true; cd /tmp; true) > f.js'), [MAIN_F]);
  });
  // Deliberate fail-closed tradeoff: after the list ends, a failed cd would have left the start
  // cwd, so a later write resolves under both. bash: M/f, and ./f when the cd fails.
  test('#4303 and-or: after `cd X && cmd;` a later write resolves under X and the start cwd (deliberate fail-closed tradeoff)', () => {
    assert.deepStrictEqual(files('cd /main && true; cp a f.js'), [MAIN_F, here].sort());
  });
  // bash: git runs in M for both (in T for the first when M is missing).
  test('#4303 and-or: gitTargets follows the same rules', () => {
    assert.ok(gitTargets('cd /main || cd /tmp; git commit -m x', '/r').some((t) => t.dir === path.resolve('/main')));
    assert.deepStrictEqual(gitTargets('cd /main && git commit -m x', '/r').map((t) => t.dir), [path.resolve('/main')]);
  });
  // One pin per rule. A pipeline element runs from where the pipeline began; a lone `&` ends the
  // list, its pipeline and what it was skipping; a group is one command of the list around it, which
  // may fail where the group left the cwd, and its own list never leaks out. bash 3.2 and 5 write
  // the file each row names (`./f` is the start cwd, and `when the cd fails` is with /main absent).
  for (const [cmd, expected] of [
    ['cd /main | cp a f.js', [here]],                                    // bash: ./f
    ['cd /main || true & true; cp a f.js', [here]],                      // bash: ./f
    ['cd /main && true & cd /nope || cp a f.js', [here]],                // bash: ./f
    ['cd /main && true & cd /tmp; cp a f.js', [path.resolve('/tmp/f.js')]], // bash: T/f
    // A list's end ends what it was skipping too, so the next list starts clean.
    ['cd /main || cd /tmp; cd /var; echo x > f.js', [path.resolve('/var/f.js')]], // bash: V/f
    ['true | true & cd /main; cp a f.js', [MAIN_F]],                     // bash: M/f
    ['{ cd /main; false; } || cp a f.js', [MAIN_F, here].sort()],        // bash: M/f, ./f when the cd fails
    ['( cd /main || true ) && cp a f.js', [here]],                       // bash: ./f
    ['echo $(true; ( cd /main || true ) && cp a f.js)', [here]],         // bash: ./f
    ['echo $(true; { cd /main; false; } || cp a f.js)', [MAIN_F, here].sort()], // bash: M/f, ./f when the cd fails
    // A substitution keeps its own and-or list, and so does a top-level backtick.
    ['echo $(true; cd /nope && cd /tmp; cp a f.js)', [path.resolve('/tmp/f.js'), here].sort()], // bash: ./f
    ['echo `true; cd /nope && cd /tmp; cp a f.js; true`', [path.resolve('/tmp/f.js'), here].sort()], // bash: ./f
    ['echo `true; cd /main; cd /tmp & cp a f.js; true`', [MAIN_F]],     // bash: M/f
    ['cd /main && echo `true; true` && cp a f.js', [MAIN_F]],            // bash: M/f
    // `||` moves the list's current command on, so the command after it fails where it began.
    // bash 3.2 and 5: V/f, M/f when /var is absent, ./f when /var and /main both are.
    ['cd /var && true || cd /main && true; cp a f.js', [MAIN_F, path.resolve('/var/f.js'), here].sort()],
  ]) {
    test(`#4303 and-or: \`${cmd}\` resolves where bash writes`, () => {
      assert.deepStrictEqual(files(cmd), expected);
    });
  }
  // A lone `&` inside a substitution backgrounds that substitution's own list only: inside a deeper
  // `$( )` it never resets an enclosing one's list. bash 3.2 and 5 write M/f.js for each.
  for (const cmd of ['x=$(true; cd /main && y=$(true & true) && cp a f.js)', 'x=$(true; cd /main && y=`true & true` && cp a f.js)',
    'cd /main && x=$(true & true) && cp a f.js', 'x=$(true; echo $(true; true); cd /main && y=$(true & true) && cp a f.js)']) {
    test(`#4303 and-or: \`${cmd}\` keeps the cd past an & in a deeper substitution`, () => {
      assert.deepStrictEqual(files(cmd), [MAIN_F]);
    });
  }
  // A deeper `$( )`, `<( )` or a `$( )` inside a top-level backtick runs in its own subshell, so its
  // cd never reaches the level around it: leaving a level restores the cwd that level began at.
  // bash 3.2 and 5 write the file each row names.
  for (const [cmd, expected] of [
    ['x=$(true; cd /main; echo $(true; cd /tmp); cp a f.js)', [MAIN_F]],                       // bash: M/f
    ['x=$(echo $(true; cd /tmp); cp a f.js)', [here]],                                         // bash: ./f
    ['x=$(true; cd /main; cat <(true; cd /tmp) >/dev/null; cp a f.js)', [MAIN_F]],             // bash: M/f
    ['x=$(true; cd /main; echo $(true; cd /tmp) x; cp a f.js)', [MAIN_F]],                     // bash: M/f
    ['x=$(true; cd /main; echo $(true; cd /tmp) && cp a f.js)', [MAIN_F]],                     // bash: M/f
    ['x=$(true; cd /main; echo $(true; echo $(true; cd /tmp); cd /var); cp a f.js)', [MAIN_F]], // bash: M/f
    ['x=$(true; cd /main; echo $(true; echo $(true; cd /tmp); cp a f.js))', [MAIN_F]],         // bash: M/f
    // Two levels end at once: the cwd returns to the shallower one's start, not the deeper one's.
    ['x=$(true; cd /main; echo $(true; cd /var; echo $(true; cd /tmp)); cp a f.js)', [MAIN_F]], // bash: M/f
    ['echo `true; cd /main; echo $(true; cd /tmp); cp a f.js; true`', [MAIN_F]],               // bash: M/f
    ['echo `true; echo $(true; cd /tmp); cp a f.js; true`', [here]],                           // bash: ./f
    // The segment's last piece (` > f.js $(true`) begins after the deeper `$( )` closes and ends
    // inside the next one: its level is where it begins, so the redirect writes from the level
    // around the first `$( )`.
    ['x=$(true; cd /main; echo $(true; cd /tmp; true) > f.js $(true; true))', [MAIN_F]],       // bash: M/f
  ]) {
    test(`#4303 and-or: \`${cmd}\` keeps a deeper substitution's cd inside it`, () => {
      assert.deepStrictEqual(files(cmd), expected);
    });
  }
}

// #4303: a `|` between case patterns separates patterns, no pipeline elements, so the arm runs in
// the current shell and its cd reaches the commands after it, as base d9aa6b82d read it. Bash 3.2
// and 5 (M = /main, start = /r) write the file each row names; bash 3.2 cannot parse `;&`, `;;&` or
// an unparenthesized pattern inside `$( )`, and bash 5 writes M/f for each (the pins side with 5).
{
  const here = path.resolve('/r/f.js');
  const files = (cmd) => fileWriteTargets(cmd, '/r').map((t) => t.file).sort();
  for (const [cmd, expected] of [
    ['case x in a|x) cd /main;; esac; echo x > f.js', [MAIN_F]],                                // bash: M/f
    ['case x in x|y) cd /main; echo x > f.js;; esac', [MAIN_F]],                                // bash: M/f
    ['case x in *|x) cd /main;; esac; echo x > f.js', [MAIN_F]],                                // bash: M/f
    ['case x in x|a) cd /main;; *) true;; esac; echo x > f.js', [MAIN_F]],                      // bash: M/f
    ['for i in 1; do case x in a|x) cd /main;; esac; done; echo x > f.js', [MAIN_F]],           // bash: M/f
    ['if true; then case x in a|x) cd /main;; esac; fi; echo x > f.js', [MAIN_F]],              // bash: M/f
    ['case x in a|x) cd /main && echo x > f.js;; esac', [MAIN_F]],                              // bash: M/f
    ['case x in a|x) cd /main\n;; esac; echo x > f.js', [MAIN_F]],                              // bash: M/f
    ['case x in a|x) cd /main\n echo x > f.js;; esac', [MAIN_F]],                               // bash: M/f
    ['case $(echo a | cat) in a|x) cd /main;; esac; echo x > f.js', [MAIN_F]],                  // bash: M/f
    ['case x in a|x) case y in b|y) cd /main;; esac;; esac; echo x > f.js', [MAIN_F]],          // bash: M/f
    ['( case x in a|x) cd /main;; esac; echo x > f.js )', [MAIN_F]],                            // bash: M/f
    // A `;;`, `;&` or `;;&` opens the next arm's pattern list.
    ['case x in a) true;; b|x) cd /main;; esac; echo x > f.js', [MAIN_F]],                      // bash: M/f
    ['case x in a) true;& b|x) cd /main;; esac; echo x > f.js', [MAIN_F]],                      // bash 5: M/f
    ['case x in a) true;;& b|x) cd /main;; esac; echo x > f.js', [MAIN_F]],                     // bash 5: M/f
    ['x=$(case x in a|x) cd /main;; esac; echo x > f.js)', [MAIN_F]],                           // bash 5: M/f
    // A pipe is still a pipe: in an arm, after `esac`, around the case, and where `case` is no
    // command word.
    ['cd /main | true; echo x > f.js', [here]],                                                 // bash: ./f
    ['case x in a|x) cd /main | true;; esac; echo x > f.js', [here]],                           // bash: ./f
    ['case x in x) true;; esac; cd /main | true; echo x > f.js', [here]],                       // bash: ./f
    ['echo case x in a | cd /main; echo x > f.js', [here]],                                     // bash: ./f
    // A parenthesized pattern list ends at its `)`, so a pipe in the arm after it is a pipe.
    ['case x in (x) true; cd /main | true;; esac; echo x > f.js', [here]],                      // bash: ./f
    // A function body is a compound command, so the `case` in it is read too; the brace group's
    // close also keeps the cwd before it (bash: M/f for each).
    ['g() { case x in a|x) cd /main;; esac; }; g; echo x > f.js', [MAIN_F, here].sort()],
    ['function g { case x in a|x) cd /main;; esac; }; g; echo x > f.js', [MAIN_F, here].sort()],
    ['g() { cd /main; }; g; echo x > f.js', [MAIN_F, here].sort()],
    ['function g { cd /main; }; g; echo x > f.js', [MAIN_F, here].sort()],
  ]) {
    test(`#4303 case: \`${cmd}\` reads a pattern-list | as no pipe and resolves where bash writes`, () => {
      assert.deepStrictEqual(files(cmd), expected);
    });
  }
  // Deliberate fail-closed tradeoff: a parenthesized pattern list (`(a|x)`) is read as a nest, so
  // the arm after its `)` is read as a tail and the write resolves under the arm's cd and the
  // start. bash: M/f.
  test('#4303 case: the arm after a parenthesized pattern list keeps the start cwd too (deliberate fail-closed tradeoff)', () => {
    assert.deepStrictEqual(files('case x in (a|x) cd /main;; esac; echo x > f.js'), [MAIN_F, here].sort());
  });
  // Deliberate fail-closed tradeoff: a case compound as a pipeline element is one subshell, whose
  // own `;;` and `;` end no pipeline, and the walk cannot place its `esac`, so the pipeline ends
  // under both its start and the arm's cwd. bash: M/f for the first two, ./f for the third.
  test("#4303 case: a pipeline holding a case compound ends under its start and the arm's cwd (deliberate fail-closed tradeoff)", () => {
    for (const cmd of ['true | case x in a|x) cd /main; echo x > f.js;; esac', 'true | case x in (a|x) cd /main; echo x > f.js;; esac']) {
      assert.ok(files(cmd).includes(MAIN_F), `${cmd}: ${JSON.stringify(files(cmd))}`);
    }
    assert.deepStrictEqual(files('true | case x in a|x) cd /main;; esac; echo x > f.js'), [MAIN_F, here].sort());
  });
  // Deliberate fail-closed tradeoff: the walk never reads the case structure inside a top-level
  // backtick, so once a `case` word shows there, a `|` in it is read both as a pipe and as no
  // separator. bash: M/f for the first, ./f for the second.
  test('#4303 case: a | inside a top-level backtick that holds a case keeps both readings (deliberate fail-closed tradeoff)', () => {
    assert.deepStrictEqual(files('echo `case x in a|x) cd /main; echo x > f.js;; esac`'), [MAIN_F, here].sort());
    assert.ok(files('case `true; cd /main | echo x > f.js; true` in x) true;; esac').includes(here));
  });
  // bash: git runs in M.
  test('#4303 case: gitTargets reads a pattern-list | the same way', () => {
    assert.deepStrictEqual(gitTargets('case x in a|x) cd /main;; esac; git commit -m x', '/r').map((t) => t.dir), [path.resolve('/main')]);
  });
}

// #4149: inside a double-quoted span, `$( … )`, backticks and `${ … }` nest as in
// bash, and a quote inside `$(` starts a fresh quoting context; an unquoted `${ … }` nests too. So no
// `&`, `;`, `(`, `)` or newline inside them is structural, and an earlier `cd` survives. Every case
// was checked under bash 3.2 and 5 (bash 3.2 cannot parse the odd-quote heredoc one).
{
  const main = (action) => ({ action, file: MAIN_F });
  const here = (action) => ({ action, file: path.resolve('/r', 'f.js') });
  const B = "<<'EOF'";
  for (const [label, cmd, expected] of [
    ['an & in a quoted string inside "$( )"', 'cd /main && echo "$(echo "a&b")" && cp a f.js', [main('copy')]],
    ['... followed by ; cp', 'cd /main && echo "$(echo "a&b")"; cp a f.js', [main('copy'), here('copy')]], // #4303: bash 3.2 and 5 write ./f.js when the cd fails
    ['... followed by a newline and cp', 'cd /main && echo "$(echo "a&b")"\ncp a f.js', [main('copy'), here('copy')]], // #4303: bash 3.2 and 5 write ./f.js when the cd fails
    ['... with a redirect after it', 'cd /main && echo "$(echo "a&b")" > f.js', [main('write')]],
    ['an & in a URL inside an assigned "$( )"', 'cd /main && X="$(printf %s "http://h/?a=1&b=2")" && cp a f.js', [main('copy')]],
    ['an & inside "$( )" ahead of a tee file', 'echo hi | tee "$(echo "x&y")" /main/f.js >/dev/null', [main('write')]],
    ['an & in a backtick inside double quotes', 'cd /main && echo "`echo "a&b"`" && cp a f.js', [main('copy')]],
    ['an & two "$( )" levels deep', 'cd /main && echo "$(echo "$(echo "a&b")")" && cp a f.js', [main('copy')]],
    ['an unquoted ${ } holding an &', 'x=a; cd /main && echo ${x//&/y} && cp a f.js', [main('copy')]],
    ['a heredoc body with an apostrophe inside "$( )"', `cd /main && gh pr create --body "$(cat ${B}\nIt's the "Q&A" page\nEOF\n)" && cp a f.js`, [main('copy')]],
    ['a heredoc body with an odd double quote inside "$( )"', `cd /main && gh pr create --body "$(cat ${B}\nA 5" screen & more\nEOF\n)" && cp a f.js`, [main('copy')]],
    // One pin per skipper rule.
    ['a quoted ${ } default holding an & inside double quotes', 'x=; cd /main && echo "${x:-"a&b"}" && cp a f.js', [main('copy')]],
    ['a single-quoted ) inside "$( )"', "cd /main && echo \"$(echo ')\"&\"')\" && cp a f.js", [main('copy')]],
    ['a comment holding a quote inside "$( )"', 'cd /main && echo "$(echo a # say "hi\n)" && cp a f.js', [main('copy')]],
    ['an ANSI-C quote inside "$( )"', "cd /main && echo \"$(echo $'a\\'b')\" && cp a f.js", [main('copy')]],
    // #4149: `$'…'` inside "$( )" honours its `\'`, so a later `)"` closes nothing early.
    ['an ANSI-C \\\' inside "$( )", with a quoted )" later', "echo \"$(echo $'a\\'b')\" && cp a /main/f.js; echo ')\"'", [main('copy')]],
    // #4149: a ${ } honours its single quotes when it finds its closing brace.
    ['a quoted } inside an unquoted ${ }', "x=; echo ${x:-'}'} && cp a /main/f.js", [main('copy')]],
    ['a double quote inside single quotes inside a quoted ${ }', "x=; cd /main && echo \"${x:-'\"'}\" && cp a f.js", [main('copy')]],
    ['an ANSI-C \\\' inside an unquoted ${ }', "x=; echo ${x:-$'a\\'b'} && cp a /main/f.js", [main('copy')]],
    // A construct this scan reads as unclosed falls back to the plain quote end (bash rejects this
    // one; the fallback keeps the trailing write visible, failing closed).
    ['a construct read as unclosed, which falls back to the plain quote end', 'echo "${x:-$(echo)" && cp a /main/f.js', [main('copy')]],
    // #4149: a cd inside a backtick or $( ) runs in a subshell; the outer cwd stays.
    ['a cd inside a top-level backtick', 'cd /main && echo `true; cd /tmp`; cp a f.js', [main('copy'), here('copy')]], // #4303: bash 3.2 and 5 write ./f.js when the cd fails
    ['a cd inside an assigned backtick', 'cd /main && x=`true && cd /tmp` && cp a f.js', [main('copy')]],
    ['a cd inside an unquoted $( )', 'cd /main && echo $(true; cd /tmp); cp a f.js', [main('copy'), here('copy')]], // #4303: bash 3.2 and 5 write ./f.js when the cd fails
    ['a cd after a lone & that follows a $( )', 'echo $(true; true) & cd /main; cp a f.js', [main('copy')]],
    ['a cd after a $( ) in a pass read again flat', `echo $(true) ${'"$('.repeat(40)}x${')"'.repeat(40)}; cd /main; true & cp a f.js`, [main('copy')]],
    ['a quoted ) inside "$( )", in a fresh quoting context', 'cd /main && echo "$(echo ")")" && cp a f.js', [main('copy')]],
    ['a subshell inside "$( )", whose ) closes only it', 'cd /main && echo "$( (true) ; echo "&" )" && cp a f.js', [main('copy')]],
    ['a quoted } inside a ${ } default', 'x=; cd /main && echo "${x:-"a}b"}" && cp a f.js', [main('copy')]],
    ['a $(( )) shift across a line, then a "$( )"', 'cd /main && echo "$((1<<2 +\n3)) $(echo "&")" && cp a f.js', [main('copy')]],
    // One pin per scanner seam.
    ['a ; inside quotes inside "$( )" (segmentSpans)', 'cp "$(echo "a;b" | tr -d ";b")" /main/f.js', [main('copy')]],
    ['a ; inside an unquoted ${ } (segmentSpans)', "x='a;'; cp ${x//;/} /main/f.js", [main('copy')]],
    ['an odd quote in a heredoc body inside "$( )", before a later body (scanHeredocs)', "cd /main && echo \"$(cat <<'X'\n5\" x\nX\n)\" && cat <<'EOF'\ndon't\nEOF\ncp a f.js", [main('copy'), here('copy')]], // #4303: bash 3.2 cannot parse it; bash 5 writes ./f.js when the cd fails
    // A top-level backtick substitution is its own command text: a quote inside it opens nothing
    // past its closing backtick.
    ['an odd quote inside a top-level backtick', 'cd /main && echo `echo "a&b` && cp a f.js', [main('copy')]],
    ['an odd quote inside a top-level backtick, then a newline', 'cd /main && echo `echo "$(`\ncp a f.js', [main('copy'), here('copy')]], // #4303: bash 3.2 and 5 write ./f.js when the cd fails
    ['a backtick inside double quotes, then a top-level backtick', 'cd /main && echo "`"`"`"`\ncp a f.js', [main('copy'), here('copy')]], // #4303: bash 3.2 and 5 write ./f.js when the cd fails
    ['a top-level backtick, then a backtick inside double quotes', 'cd /main && echo `"`"`"`"\ncp a f.js', [main('copy'), here('copy')]], // #4303: bash 3.2 and 5 write ./f.js when the cd fails
    ['a heredoc opener inside a top-level backtick', 'cd /main && echo `cat <<EOF`\ncp a f.js\nEOF', [main('copy'), here('copy')]], // #4303: bash 3.2 and 5 write ./f.js when the cd fails
    ['an odd quote inside a top-level backtick, before a body holding a quote (scanHeredocs)', "cd /main && echo `echo \"x` && cat <<'EOF'\n\"\nEOF\ncp a f.js", [main('copy'), here('copy')]], // #4303: bash 3.2 and 5 write ./f.js when the cd fails
    // A pass that nests past the cap is read again flat, as before #4149, from its start.
    ['a nest past the cap holding backticks', `cd /main && echo ${'` "$('.repeat(33)}x${')"`'.repeat(33)} && cp a f.js`, [main('copy')]],
    ['a nest past the cap whose fallback would restart the nested reading', `cd /main && echo ${'"\'$('.repeat(31)}x${')"'.repeat(31)}; cp a f.js`, [main('copy'), here('copy')]], // #4303: bash 3.2 and 5 write ./f.js when the cd fails
    ['a ${ } nest past the cap (the flat pass takes ${ plainly)', `cd /main && echo ${'"\'${x:-'.repeat(31)}x${'}"'.repeat(31)}; cp a f.js`, [main('copy'), here('copy')]], // #4303: bash 3.2 and 5 write ./f.js when the cd fails
    ['a quoted ${ } nest past the cap before a lone & (the flat pass takes ${ plainly)', `echo ${'\'"${x:-'.repeat(36)}x${'}"'.repeat(36)} & cp a /main/f.js`, [main('copy')]],
    ['a nest past the cap before a lone & (the flat pass takes a backtick plainly)', `echo ${'"$(;`'.repeat(34)}x${'`)"'.repeat(34)} & cp a /main/f.js`, [main('copy')]],
    ['a nest past the cap before a lone & (groupEvents re-reads from its starting group state)', `echo ${'$(`"'.repeat(36)}x${'"`)'.repeat(36)} & cp a /main/f.js`, [main('copy')]],
  ]) {
    test(`#4149 nesting: ${label} keeps the earlier cd`, () => {
      assert.deepStrictEqual(fileWriteTargets(cmd, '/r'), expected);
    });
  }

  // The skippers cap nesting depth: uncapped, a nest of unclosed "$( re-reads its chain without end
  // (the fallback re-descends) and a deep closed nest overflows the stack; a nest past the cap takes
  // the plain quote reading, so the trailing write still shows.
  test('#4149 nesting: a nest of unclosed "$( stays bounded', () => {
    const targets = boundedTargets('fileWriteTargets', `echo ${'"$('.repeat(40)}\ncp a /main/f.js`, '/r');
    assert.deepStrictEqual(targets, [main('copy')]);
  });
  // #4149: a cd inside a $( ) holds for the commands after it in the same substitution only.
  test('#4149 nesting: a cd inside a $( ) moves the commands after it there, not the outer walk', () => {
    assert.deepStrictEqual(fileWriteTargets('cd /main && echo $(true; cd /tmp; cp a b.js)', '/r'), [{ action: 'copy', file: path.resolve('/tmp/b.js') }]);
  });
  // #4149: a group inside a substitution is scoped within it, so the cd before the group holds
  // for the commands after it there, and the substitution's `)` ends its piece: the closer is part
  // of no word, and the rest of the command runs out there. A cd or an assignment inside a
  // substitution ends at the next outer piece. bash 3.2 and 5 write /main/f.js for each.
  for (const [label, cmd, expected] of [
    ['a brace group inside a $( ), after its cd', 'echo $(true; cd /main; { cp a f.js; } )', [main('copy')]],
    ['a brace group inside a <( ), between its cd and the write', 'cat <(true; cd /main; { true; }; cp a f.js ) >/dev/null', [main('copy')]],
    ['a subshell inside a $( ), between its cd and a write glued to the closer', 'echo $(true; cd /main; (true); cp a f.js)', [main('copy')]],
    ['a brace group inside a backtick, between its cd and a write', 'echo `true; cd /main; { true; }; cp a f.js; true`', [main('copy')]],
    ['a brace group inside a backtick, then an outer write', 'cd /main; echo `true; cd /tmp; { true; }`; cp a f.js', [main('copy')]],
    ['a cd inside a brace group inside a $( ) (it persists past the })', 'echo $(true; { cd /main; }; cp a f.js )', [here('copy'), main('copy')]],
    ['a cd inside a subshell inside a $( ) (it ends at the ))', 'cd /main && echo $(true; (cd /tmp); cp a f.js )', [main('copy')]],
    ['a brace group after a nest left open inside a backtick', 'echo `true; echo $(`; cd /main; { cp a f.js; }', [main('copy')]],
    ['a subshell after a nest left open inside a backtick', 'echo `true; echo $(`; cd /main; (cp a f.js)', [main('copy')]],
    ['a redirect after a $( ) holding a cd', 'cd /main && echo $(true; cd /tmp; true) > f.js', [main('write')]],
    ['a command after a $( ) holding a subshell', 'cd /main && x=$( (true) ) cp a f.js', [main('copy')]],
    ['a cd word after a $( ), as an argument (both cwds stay)', 'cd /main; echo $(true; true) cd /tmp; cp a f.js', [main('copy'), { action: 'copy', file: path.resolve('/tmp/f.js') }]],
    ['a cd word after a $( ) assignment, run (both cwds stay)', 'x=$(true; true) cd /main; cp a f.js', [here('copy'), main('copy')]],
    ['an assignment word after a $( ), as an argument', 'D=/main; echo $(true; true) D=/tmp; cp a $D/f.js', [main('copy')]],
    ['an outer cd between two $( ), the first holding a cd', 'echo $(true; cd /tmp); cd /main; echo $(true; cp a f.js )', [main('copy')]],
    ['an assignment inside a $( ), shadowing an outer one', 'D=/main; echo $(true; D=/tmp); cp a $D/f.js', [main('copy')]],
  ]) {
    test(`#4149 nesting: ${label} is read as bash runs it`, () => {
      assert.deepStrictEqual(fileWriteTargets(cmd, '/r'), expected);
    });
  }
  // #4149: a line whose quote scan spends the step budget (each "$( # comments to the line end,
  // so every span rescans the rest of the line) leaves the structure open, failing closed, so the
  // next line's body stays kept. Without the comment's charge, or with the line's quotes read
  // outside the budget, the line reads closed, the body strips, and 1 MB of the line takes seconds.
  test('#4149 nesting: a line that spends the step budget keeps later bodies (lineLeavesStructureOpen)', () => {
    const targets = fileWriteTargets(`echo ${'"$( #"'.repeat(2000)}\ncat <<'EOF'\ncp a /main/f.js\nEOF\n`, '/r');
    assert.deepStrictEqual(targets, [main('copy')]);
  });
  // #4149: a lone `&` inside a substitution, or in a group inside one, backgrounds that
  // subshell's own list: it resets the sub run, never the outer cwd (bash 3.2 and 5 write
  // /main/f.js for each); inside `$(( ))` it is arithmetic. A group's assignment inside a
  // substitution stays there too.
  for (const [label, cmd, expected] of [
    ['a & in a subshell inside a $( ), after an outer cd in the same list', 'cd /main && pid=$( (sleep 0 & echo $!) ) && cp a f.js', [main('copy')]],
    ['a & in a subshell inside a <( ), after an outer cd in the same list', 'cd /main && cat <( (true &) ) >/dev/null && cp a f.js', [main('copy')]],
    ['a & directly inside a $( ), backgrounding its cd', 'cd /main && echo $(cd /tmp & cp a f.js)', [main('copy')]],
    ['a & in a brace group inside a $( ), backgrounding the group\'s list only', 'echo $(true; cd /main; { cd /tmp & true; }; cp a f.js )', [main('copy')]],
    ['a & inside $(( )) in a $( ) list (arithmetic, no background)', 'echo $(true; cd /main && echo $((1 & 3)) > f.js )', [main('write')]],
    ['an assignment in a brace group inside a $( )', 'D=/main; echo $( { D=/tmp; } ); cp a $D/f.js', [main('copy')]],
    // The sub run keeps its own and-or list start: a `;` inside it starts a new list, a group inside
    // it starts one and its close restores the one before it.
    ['a & after a ; inside a $( ), backgrounding only the cd after it', 'echo $(true; cd /main; cd /tmp & cp a f.js )', [main('copy')]],
    ['a & in a subshell inside a $( ), after a cd in the same list', 'echo $(true; cd /main && ( cd /tmp & cp a f.js ) )', [main('copy')]],
    ['a & after a brace group inside a $( ), backgrounding the list the group began', 'cd /main && echo $(true; { cd /tmp; } && cd /var & cp a f.js )', [main('copy')]],
  ]) {
    test(`#4149 nesting: ${label} is read as bash runs it`, () => {
      assert.deepStrictEqual(fileWriteTargets(cmd, '/r'), expected);
    });
  }
  // #4149: each brace group's `}`, each sub group's `}` and each tail can add a cwd, and every
  // later piece is visited once per cwd, so many distinct `cd` paths were quadratic. Past
  // CWD_SET_CAP the set collapses to `overflowCwd` (pre-tool-use passes the main checkout) plus the
  // walk's own cwd: a relative target past the cap resolves there (#4303: to the main checkout's
  // root itself), an absolute one stays put, and a handful of groups never collapses.
  {
    const distinct = (f, k) => Array.from({ length: k }, (_, i) => f(i)).join('');
    const routes = [
      ['brace groups', (k, last) => distinct((i) => `{ cd /a${i}; }; true; `, k) + last],
      ['substitution tails', (k, last) => distinct((i) => `echo $(true; true) cd /a${i}; true; `, k) + last],
      ['brace groups inside a $( )', (k, last) => `echo $(true; ${distinct((i) => `{ cd /a${i}; }; true; `, k)}${last} )`],
    ];
    const opts = { overflowCwd: '/main' };
    for (const [route, build] of routes) {
      test(`#4149 cwd cap: ${route} past the cap resolve a relative write in the overflow cwd and the walk's own`, () => {
        const files = fileWriteTargets(build(20, 'cp a f.js'), '/r', opts).map((t) => t.file);
        assert.ok(files.includes(MAIN_ROOT) && files.includes(path.resolve('/r/f.js')), JSON.stringify(files));
        assert.ok(files.length <= 9, JSON.stringify(files));
      });
      test(`#4149 cwd cap: ${route} past the cap leave an absolute write as written`, () => {
        assert.deepStrictEqual(fileWriteTargets(build(20, 'cp a /x/f.js'), '/r', opts), [{ action: 'copy', file: path.resolve('/x/f.js') }]);
      });
      test(`#4149 cwd cap: ${route} below the cap keep every cwd`, () => {
        const files = fileWriteTargets(build(4, 'cp a f.js'), '/r', opts).map((t) => t.file);
        assert.deepStrictEqual(files, ['/r', '/a0', '/a1', '/a2', '/a3'].map((d) => path.resolve(d, 'f.js')));
      });
      // Timing-free: the handler runs once per cwd per piece, so the visit count is the cost. Each
      // repetition holds at most four visited pieces (a cd piece is visited too, #4281), each visited
      // under at most the cap's 16 cwds plus one (head: 5,400 to 10,800 visits; uncapped: 91,000 to 181,000).
      test(`#4149 cwd cap: ${route} stay linear (visits per group bounded by the cap)`, () => {
        let visits = 0;
        forEachShellSegment(build(300, 'true'), '/r', () => { visits += 1; }, opts);
        assert.ok(visits < 300 * 4 * 17, `${visits} visits`);
      });
    }
    test('#4149 cwd cap: a push and a mkdir past the cap resolve in the overflow cwd', () => {
      const cmd = (last) => distinct((i) => `{ cd /a${i}; }; `, 20) + last;
      assert.ok(gitTargets(cmd('git push'), '/r', opts).some((t) => t.dir === path.resolve('/main')));
      assert.ok(mkdirTargets(cmd('mkdir d'), '/r', opts).some((t) => t.file === MAIN_ROOT));
    });
    test('#4149 cwd cap: four groups with relative cds (2^4 cwds) stay below the cap', () => {
      const files = fileWriteTargets('{ cd a; ls; }; { cd b; ls; }; { cd c; ls; }; { cd d; ls; }; cp x y', '/r', opts).map((t) => t.file);
      assert.strictEqual(files.length, 16, JSON.stringify(files));
      assert.ok(!files.includes(path.resolve('/main/y')) && files.includes(path.resolve('/r/a/b/c/d/y')), JSON.stringify(files));
    });
    test('#4149 cwd cap: a kept shell body past the cap collapses to the overflow cwd too', () => {
      const body = distinct((i) => `{ cd /a${i}; }; `, 20) + 'cp a f.js';
      const files = fileWriteTargets(`bash <<'EOF'\n${body}\nEOF`, '/r', opts).map((t) => t.file);
      assert.ok(files.includes(MAIN_ROOT), JSON.stringify(files));
    });
    test('#4149 cwd cap: without an overflowCwd the set collapses to the walk\'s own cwd', () => {
      const files = fileWriteTargets(distinct((i) => `{ cd /a${i}; }; `, 20) + 'cp a f.js', '/r').map((t) => t.file);
      assert.ok(files.includes(path.resolve('/r/f.js')) && !files.includes(path.resolve('/a0/f.js')), JSON.stringify(files));
    });
    // #4303: without an overflowCwd (the pipeline shadow guard) the collapse is a lost cwd at the
    // start, so a relative target resolves under the start, never above it. With every /aN and
    // /r/sub present, bash 3.2 and 5 create /r/.claude-tweaks/pipelines/2026-x and write /r/ok.out;
    // an earlier revision of this branch collapsed to the real start and reported
    // /.claude-tweaks/pipelines/2026-x and /ok.out. The && chain is the walk's own branching: base d9aa6b82d took every cd to succeed and never
    // collapsed there, so base's own reading of the command, a known target marked `reading`, is
    // the path bash writes, beside the lost one.
    test('#4303 cwd cap: without an overflowCwd a relative target past the cap resolves under the start, never above it', () => {
      const chain = distinct((i) => `cd /a${i + 1} && `, 16);
      const shape = (ts) => ts.map((t) => [t.file, !!t.lost, !!t.reading]);
      assert.deepStrictEqual(shape(mkdirTargets(`${chain}cd /r/sub; mkdir -p ../.claude-tweaks/pipelines/2026-x`, '/r')),
        [[path.resolve('/r/.claude-tweaks/pipelines/2026-x'), true, false], [path.resolve('/r/.claude-tweaks/pipelines/2026-x'), false, true]]);
      assert.deepStrictEqual(shape(fileWriteTargets(`${chain}cd /r/sub; echo x > ../ok.out`, '/r')),
        [[path.resolve('/r/ok.out'), true, false], [path.resolve('/r/ok.out'), false, true]]);
    });
    // #4303: past the cap the walk has lost the cwd bash is in, so it collapses to a lost cwd
    // rooted at the overflow cwd and at its own: a relative target from the overflow one is the
    // main checkout's root, so a `../` that climbs out of the overflow cwd still lands in the main
    // checkout. Each row's step overflows the cap; bash 3.2 and 5 write M/s0/f.js for each (a
    // sibling-layout worktree; the and-or rows as noted), and the scanner reports M (denied).
    for (const [label, cmd] of [
      ['the group that overflows the cap', distinct((i) => `{ cd /a${i}; }; `, 15) + '{ cd /main/s0/deep; }; cp a ../f.js'],
      // every /aN present: each cd succeeds, the last one into M/s0/deep (the list-end join)
      ['an && chain whose last cd overflows', distinct((i) => `cd /a${i + 1} && `, 16) + 'cd /main/s0/deep; cp a ../f.js'],
      // no /aN present: each cd fails until the last (the `ok` join)
      ['an || chain whose last cd overflows', distinct((i) => `cd /a${i + 1} || `, 16) + 'cd /main/s0/deep; cp a ../f.js'],
      // every /aN present, /nope absent: the failed cd leaves the shell in M/s0/deep (the `fail` join)
      ['an && chain whose overflowing command fails', distinct((i) => `cd /a${i + 1} && `, 15) + 'cd /main/s0/deep && cd /nope && true; cp a ../f.js'],
      // every /bN present: the first cd succeeds and the rest are skipped
      ['an || list whose overflowing cd lands on a cwd it already holds', distinct((i) => `{ cd /b${i}; }; `, 14) + '{ cd /main/s0; }; cd /main/s0/deep || cd /z || cd deep; cp a ../f.js'],
      // every /bN, M/s0, M/s0/deep and M/s0/q present
      ['a relative group after the collapse', distinct((i) => `{ cd /b${i}; }; `, 14) + '{ cd /main/s0; }; { cd deep; }; { cd ../q; }; cp a ../f.js'],
      // every /bN, M/s0 and M/s0/deep present (M/s0/deep/s0 and M/s0/deep/d1 absent)
      ['an and-or list of relative cds after the collapse', distinct((i) => `{ cd /b${i}; }; `, 13) + '{ cd /main; }; cd s0 && cd deep || cd .. && cd s0; { cd d1; }; cp a ../f.js'],
    ]) {
      test(`#4303 cwd cap: ${label} resolves its ../ write into the main checkout`, () => {
        const files = fileWriteTargets(cmd, '/r', opts).map((t) => t.file);
        assert.ok(files.includes(MAIN_ROOT), JSON.stringify(files));
      });
    }
    // #4303: a second collapse keeps the walk lost. Each row: every /bN, M/s0 and M/s0/deep
    // present, q (and q2, q3) absent.
    for (const [label, cmd] of [
      // bash 3.2 and 5 write M/s0/f.js
      ['a relative group after a relative group', distinct((i) => `{ cd /b${i}; }; `, 14) + '{ cd /main/s0; }; { cd deep; }; { cd q; }; cp a ../f.js'],
      // bash 3.2 and 5 write M/s0/f.js
      ['an || chain of relative cds after a relative group', distinct((i) => `{ cd /b${i}; }; `, 14) + '{ cd /main/s0; }; { cd deep; }; cd q || cd q2 || cd q3; cp a ../f.js'],
      // bash 3.2 and 5 write M/f.js (the tail's cd is an echo argument)
      ['a relative group after a relative-cd tail', distinct((i) => `{ cd /b${i}; }; `, 14) + '{ cd /main/s0; }; echo $(true; true) cd deep; { cd q; }; cp a ../f.js'],
    ]) {
      test(`#4303 cwd cap: ${label} past a second collapse still resolves into the main checkout`, () => {
        const files = fileWriteTargets(cmd, '/r', opts).map((t) => t.file);
        assert.ok(files.includes(MAIN_ROOT), JSON.stringify(files));
      });
    }
    // #4303: a list-end join past the cap drops the cwds where an earlier `&&` failed; the lost
    // cwd covers them. With every /bN and M/s0/q present and M/s0/s0 absent, bash 3.2 and 5 write
    // M/f.js (`cd s0` fails in M/s0/q). Base d9aa6b82d reported only /f.js (allowed).
    test('#4303 cwd cap: a list-end collapse still resolves into the main checkout where an earlier && failed', () => {
      const cmd = distinct((i) => `{ cd /b${i}; }; `, 14) + '{ cd /main/s0; }; { cd s0; }; { cd q; }; cd s0 && cd /main/s0 && cd ..; cp a ../../f.js';
      const files = fileWriteTargets(cmd, '/r', opts).map((t) => t.file);
      assert.ok(files.includes(MAIN_ROOT), JSON.stringify(files));
    });
    // #4303: an `||` ok-join past the cap drops the cwd an earlier `cd` in the list succeeded
    // in. With every /bN and M/q present, bash 3.2 and 5 write M/f.js (`cd q` succeeds in M and
    // `cd ../q` is skipped; with M/q absent they write /f.js). Base d9aa6b82d never collapses here and
    // denies; an earlier revision of this branch reported only /f.js (allowed).
    test('#4303 cwd cap: an || ok-join collapse still resolves into the main checkout where an earlier cd succeeded', () => {
      const cmd = distinct((i) => `{ cd /b${i}; }; `, 14) + '{ cd /main; }; cd q || cd ../q; echo x > ../f.js';
      const files = fileWriteTargets(cmd, '/r', opts).map((t) => t.file);
      assert.ok(files.includes(MAIN_ROOT), JSON.stringify(files));
    });
    // #4303: the lost cwd's rules, exactly. A relative target from the one rooted at the overflow cwd
    // is that root itself; from the one rooted at the start it resolves under the start with the `..`
    // that would climb above it dropped. A relative cd or `git -C` keeps it lost (a git command from
    // there runs in the root); an absolute cd makes the cwd known again, and a target from there
    // resolves as written (/t/../f.js is /f.js).
    test('#4303 cwd cap: a lost cwd resolves a relative target to the overflow root and under the start, never above it', () => {
      const past = distinct((i) => `{ cd /a${i}; }; `, 16); // the 16th group overflows, leaving only the lost cwd
      // (A lost target's command also comes back with base's readings, known targets checked apart.)
      const lostOnly = (ts) => ts.filter((t) => t.lost);
      assert.deepStrictEqual(lostOnly(fileWriteTargets(`${past}cd ..; cd q; cp a ../../x/f.js`, '/r', opts)).map((t) => t.file),
        [MAIN_ROOT, path.resolve('/r/x/f.js')]);
      assert.deepStrictEqual(fileWriteTargets(`${past}cd /t; cp a ../f.js`, '/r', opts).map((t) => t.file), [path.resolve('/f.js')]);
      assert.deepStrictEqual(lostOnly(gitTargets(`${past}git -C ../x commit -m m`, '/r', opts)).map((t) => t.dir), [MAIN_ROOT, path.resolve('/r')]);
      assert.deepStrictEqual(lostOnly(mkdirTargets(`${past}cd ../..; mkdir -p ../d`, '/r', opts)).map((t) => t.file), [MAIN_ROOT, path.resolve('/r/d')]);
    });
    // #4303: those paths are stand-ins, so every target resolved from a lost cwd also carries an
    // additive marker, `lost: true` (a write or mkdir target also `rel`, its text as written), beside
    // the fields it always had, with an overflowCwd and without one. An absolute target, and a git
    // command after an absolute cd or `-C`, is known and carries none. A command with a lost target also comes back with base d9aa6b82d's own readings of it: the
    // targets base's walk resolves, as this branch's other scanner fixes correct them (every command taken to succeed; past the cap the set
    // collapses to the overflow cwd and the start, as real paths), each a known target marked
    // `reading`, after the walk's own and once each, unless the walk already resolved it (after
    // `cd q`, ../w/f.js reads /main/w/f.js and /r/w/f.js; from /r alone, /w/f.js). Accepted gap, user
    // decision 2026-10-26 (base parity): an earlier revision of this branch also read every cwd the
    // collapse dropped (each /aN), moved and unmoved, and kept them on each lost target; the scanner
    // now marks only base's readings `reading: true`. A lost commit also carries its message's `subject`.
    test('#4303 cwd cap: a target resolved from a lost cwd carries lost: true beside its stand-in path', () => {
      const past = distinct((i) => `{ cd /a${i}; }; `, 16);
      const lostAt = (file, rel, action = 'write') => ({ action, file, lost: true, rel });
      const reading = (action, file) => ({ action, file: path.resolve(file), reading: true });
      assert.deepStrictEqual(fileWriteTargets(`${past}cd q; echo x > ../w/f.js; cp a /x/f.js`, '/r', opts), [
        lostAt(MAIN_ROOT, '../w/f.js'), lostAt(path.resolve('/r/w/f.js'), '../w/f.js'), { action: 'copy', file: path.resolve('/x/f.js') },
        reading('write', '/main/w/f.js'), reading('write', '/r/w/f.js'),
      ]);
      assert.deepStrictEqual(fileWriteTargets(`${past}tee ../w/f.js`, '/r'), [lostAt(path.resolve('/r/w/f.js'), '../w/f.js'), reading('write', '/w/f.js')]);
      assert.deepStrictEqual(mkdirTargets(`${past}mkdir -p ../wt2/.claude-tweaks/pipelines/2026-x /x/d`, '/r/wt'), [
        lostAt(path.resolve('/r/wt/wt2/.claude-tweaks/pipelines/2026-x'), '../wt2/.claude-tweaks/pipelines/2026-x', 'mkdir'),
        { action: 'mkdir', file: path.resolve('/x/d') },
        reading('mkdir', '/r/wt2/.claude-tweaks/pipelines/2026-x'),
      ]);
      const dirReading = (action, dir) => ({ action, dir: path.resolve(dir), reading: true });
      assert.deepStrictEqual(gitTargets(`${past}git commit -m m; git -C ../x push; git -C /t commit -m m`, '/r', opts), [
        { action: 'commit', dir: MAIN_ROOT, lost: true, subject: 'm' }, { action: 'commit', dir: path.resolve('/r'), lost: true, subject: 'm' },
        { action: 'push', dir: MAIN_ROOT, lost: true }, { action: 'push', dir: path.resolve('/r'), lost: true },
        { action: 'commit', dir: path.resolve('/t') },
        dirReading('commit', '/main'), dirReading('commit', '/r'), dirReading('push', '/x'),
      ]);
      assert.deepStrictEqual(gitTargets(`${past}cd /t; git commit -m m`, '/r', opts), [{ action: 'commit', dir: path.resolve('/t') }]);
      assert.deepStrictEqual(gitTargets(`${past}git commit -m m`, '/r'), [{ action: 'commit', dir: path.resolve('/r'), lost: true, subject: 'm' }, dirReading('commit', '/r')]);
      // A relative cd from the lost cwd that spells `.claude-tweaks` and then `pipelines` (here split
      // across two cds, with other components between) is kept in `rel`, so `mkdir 2026-x` names it.
      // An earlier revision of this branch also kept each cd's failing (unmoved) variant: `2026-x`,
      // `.claude-tweaks/2026-x` and `pipelines/2026-x` beside it (accepted gap, user decision
      // 2026-10-26, base parity).
      const lostRels = (cmd) => mkdirTargets(cmd, '/r').filter((t) => t.lost).map((t) => t.rel);
      assert.deepStrictEqual(lostRels(`${past}cd ../w/.Claude-Tweaks; cd x/../Pipelines; mkdir 2026-x`), ['.claude-tweaks/pipelines/2026-x']);
      assert.deepStrictEqual(lostRels(`${past}cd ../w/pipelines/.claude-tweaks; mkdir pipelines/2026-x`), ['.claude-tweaks/pipelines/2026-x']);
    });
    // #4303: a collapse that drops a cwd the walk could not read (`cd $(x)` leaves it unknown) drops it
    // as base d9aa6b82d's collapse did: the readings are base's own (from the overflow cwd and the
    // start), and no target is marked `capped`. Accepted gap, user decision 2026-10-26 (base parity):
    // an earlier revision of this branch marked both lost targets `capped: true` and denied on them
    // whatever the session's policy. Now: the two lost targets and the readings /main/f and /r/f
    // (base: /main/f and /r/f as plain targets).
    test('#4303 cwd cap: a collapse that drops a cwd the walk could not read gives base\'s readings, uncapped', () => {
      const past = distinct((i) => `{ cd /a${i}; }; `, 16);
      assert.deepStrictEqual(fileWriteTargets(`cd $(x); ${past}echo x > f`, '/r', opts), [
        { action: 'write', file: MAIN_ROOT, lost: true, rel: 'f' },
        { action: 'write', file: path.resolve('/r/f'), lost: true, rel: 'f' },
        { action: 'write', file: path.resolve('/main/f'), reading: true },
        { action: 'write', file: path.resolve('/r/f'), reading: true },
      ]);
    });
    // #4303: however many cwds the walk drops, the readings are base's own and no target is capped.
    // 140 groups `{ cd /mN; }`, `{ cd /q/sub; }` and 16 more, then `cd .. && echo x > f`: base's
    // collapse leaves /main and /r, both / after `..`, so f reads /f (the walk's own known /aN reach
    // it too). 70 groups, then `echo x > f` or `cd s; echo x > f`: /main/f and /r/f, or /main/s/f
    // and /r/s/f. Accepted gap, user decision 2026-10-26 (base parity): an earlier revision of this
    // branch read every dropped cwd and capped the first and third past 128 readings. Now, for the
    // three commands in turn, beside the two lost targets: /f, then readings /main/f and /r/f, then
    // /main/s/f and /r/s/f (base: the same as plain targets).
    test('#4303 cwd cap: a command with a lost target carries base\'s readings however many cwds the walk dropped', () => {
      const shape = (cmd) => fileWriteTargets(cmd, '/r', opts).filter((t) => t.lost || t.reading || t.file === path.resolve('/f'))
        .map((t) => [t.file, !!t.lost, t.capped]);
      const many = distinct((i) => `{ cd /m${i}; }; `, 140);
      const after = distinct((i) => `{ cd /a${i}; }; `, 16);
      assert.deepStrictEqual(shape(`${many}{ cd /q/sub; }; ${after}cd .. && echo x > f`),
        [[MAIN_ROOT, true, undefined], [path.resolve('/r/f'), true, undefined], [path.resolve('/f'), false, undefined]]);
      const seventy = distinct((i) => `{ cd /m${i}; }; `, 70);
      assert.deepStrictEqual(shape(`${seventy}echo x > f`),
        [[MAIN_ROOT, true, undefined], [path.resolve('/r/f'), true, undefined], [path.resolve('/main/f'), false, undefined], [path.resolve('/r/f'), false, undefined]]);
      assert.deepStrictEqual(shape(`${seventy}cd s; echo x > f`),
        [[MAIN_ROOT, true, undefined], [path.resolve('/r/f'), true, undefined], [path.resolve('/main/s/f'), false, undefined], [path.resolve('/r/s/f'), false, undefined]]);
    });
    // #4303: a lost commit carries the subject its own `-m`/`--message` text gives, which
    // post-tool-use matches to the fresh commit it made. Real git (run by bash 3.2 and 5 in a fresh
    // repo) gives each subject below; a message read from elsewhere (`-F`, `-C`, `--fixup`), an
    // unset variable, an abbreviated long option (git took `--mess=x` as `--message`) and no
    // message at all give none, so post-tool-use falls back to a lone fresh commit. `-F`'s value is
    // read even when it looks like an option: `-F -mx` takes the message from a file named `-mx`.
    test('#4303 cwd cap: a lost commit carries the subject of its own -m text', () => {
      const past = distinct((i) => `{ cd /a${i}; }; `, 16);
      const subjectOf = (form) => gitTargets(`${past}${form}`, '/r').filter((t) => t.lost).map((t) => t.subject);
      for (const [form, subject] of [
        ['git commit -qm "a b"', 'a b'], ['git commit -m x -m y', 'x'], ['git commit -m "" -m z', 'z'], ['git commit --message=w', 'w'],
        ['git commit --message v', 'v'], ['git commit -am u', 'u'], ['git commit -mt', 't'], ['git commit --amend --no-edit -m "s  "', 's'],
        ['git commit -F f', undefined], ['git commit -C HEAD', undefined], ['git commit -m "$X"', undefined], ['git commit --mess=x', undefined],
        ['git commit --fixup=HEAD -m y', undefined], ['git commit', undefined], ['git commit -F -mx', undefined],
      ]) assert.deepStrictEqual(subjectOf(form), [subject], form);
      assert.deepStrictEqual(subjectOf('git push'), [undefined]);
    });
    // #4303: a lost entry is never folded into a known entry for the same path, so the marker
    // survives the dedupe: here the known /r/w/f.js comes first and the lost one after it.
    test('#4303 cwd cap: a lost target is kept beside a known one for the same path', () => {
      const past = distinct((i) => `{ cd /a${i}; }; `, 16);
      assert.deepStrictEqual(fileWriteTargets(`cp a w/f.js; ${past}cp a w/f.js`, '/r').map((t) => !!t.lost), [false, true]);
      assert.deepStrictEqual(mkdirTargets(`mkdir w/d; ${past}mkdir w/d`, '/r').map((t) => !!t.lost), [false, true]);
    });
    // #4303: base's readings follow every way base's walk branches after the loss. From /r with
    // every /aN absent (each cd fails) and /r/a, /r/b present, `G16 { cd a; }; { cd b; }; echo x >
    // ../f.js`: bash 3.2 and 5 write /r/f.js; with /r/a/b present instead, /r/a/f.js. The readings hold
    // both and /f.js (no cd taken), and the same from /main, unclamped, each once. A relative `git -C`
    // or `env -C` moves the reading as it moves bash: `{ cd a; }; git -C ../M commit` runs in /r/M
    // with /r/a present and in /M without. Accepted gap, user decision 2026-10-26 (base parity):
    // An earlier revision of this branch also read every /aN the collapse dropped (bash writes
    // /a15/f.js with /a15 present). Now, for the write and the commit: the two lost targets with
    // readings /f.js, /main/f.js, /r/f.js, /main/a/f.js and /r/a/f.js, and /M, /main/M and /r/M
    // (base: the five write paths and the three commit dirs as plain targets).
    test('#4303 cwd cap: a command with a lost target carries base\'s reading under every cwd base\'s walk may be in', () => {
      const past = distinct((i) => `{ cd /a${i}; }; `, 16);
      const abs = (...ps) => ps.map((p) => path.resolve(p));
      const files = (ts, pick) => ts.filter(pick).map((t) => t.file);
      const w = fileWriteTargets(`${past}{ cd a; }; { cd b; }; echo x > ../f.js`, '/r', opts);
      assert.deepStrictEqual(files(w, (t) => t.lost), [MAIN_ROOT, path.resolve('/r/f.js')]);
      assert.deepStrictEqual(files(w, (t) => t.reading), abs('/f.js', '/main/f.js', '/r/f.js', '/main/a/f.js', '/r/a/f.js'));
      for (const cmd of [`${past}{ cd a; }; git -C ../M commit -m m`, `${past}{ cd a; }; env -C ../M git commit -m m`]) {
        assert.deepStrictEqual(gitTargets(cmd, '/r', opts), [
          { action: 'commit', dir: MAIN_ROOT, lost: true, subject: 'm' }, { action: 'commit', dir: path.resolve('/r'), lost: true, subject: 'm' },
          ...abs('/M', '/main/M', '/r/M').map((dir) => ({ action: 'commit', dir, reading: true })),
        ], cmd.slice(-40));
      }
    });
    // #4303: a later collapse keeps the furthest trail the collapsing set had spelled. From /r with
    // /r/.claude-tweaks/pipelines present, `G16 cd .claude-tweaks/pipelines; G16 mkdir 2026-x`, and
    // the split `cd .claude-tweaks; G16 mkdir pipelines/2026-x`: bash 3.2 and 5 create
    // /r/.claude-tweaks/pipelines/2026-x. An earlier revision of this branch restarted the trail at
    // the second collapse and reported `2026-x` and `pipelines/2026-x`, naming no segment.
    test('#4303 cwd cap: a second collapse keeps the .claude-tweaks/pipelines trail spelled before it', () => {
      const past = distinct((i) => `{ cd /a${i}; }; `, 16);
      const lostRels = (cmd) => mkdirTargets(cmd, '/r').filter((t) => t.lost).map((t) => t.rel);
      assert.deepStrictEqual(lostRels(`${past}cd .claude-tweaks/pipelines; ${past}mkdir 2026-x`), ['.claude-tweaks/pipelines/2026-x']);
      assert.deepStrictEqual(lostRels(`${past}cd .claude-tweaks; ${past}mkdir pipelines/2026-x`), ['.claude-tweaks/pipelines/2026-x']);
    });
    // #4303: a known cwd in the collapsing set seeds the trail with what its own path spells. From
    // /r with /r/.claude-tweaks/pipelines and /r/sub present and every /aN absent, bash 3.2 and 5
    // create /r/.claude-tweaks/pipelines/2026-x for `cd .claude-tweaks/pipelines; G16 mkdir 2026-x`
    // and for the split `cd .claude-tweaks; G16 mkdir pipelines/2026-x`. From /r/.claude-tweaks with
    // /w/.claude-tweaks/pipelines present, `{ cd /w/.claude-tweaks/pipelines; }; G16 mkdir 2026-x`
    // creates /w/.claude-tweaks/pipelines/2026-x: each lost cwd keeps the highest trail in the set,
    // the group's two steps over the start's one. A pipelines cwd the command left by an absolute
    // cd before the loss seeds nothing (`cd .claude-tweaks/pipelines; cd /r/sub; G16 mkdir 2026-x`
    // creates /r/sub/2026-x), and a `.claude-tweaks` cwd alone names no `pipelines` for a target
    // that adds none (`cd .claude-tweaks; G16 mkdir other-x` creates /r/.claude-tweaks/other-x).
    // An earlier revision of this branch seeded no trail from a known cwd: it reported `2026-x`,
    // `pipelines/2026-x`, `2026-x` and `.claude-tweaks/2026-x` for the first four rows below, and
    // `other-x` for the sixth.
    test('#4303 cwd cap: a known cwd in the collapsing set seeds the .claude-tweaks/pipelines trail its path spells', () => {
      const past = distinct((i) => `{ cd /a${i}; }; `, 16);
      const lostRels = (cmd, cwd = '/r') => mkdirTargets(cmd, cwd).filter((t) => t.lost).map((t) => t.rel);
      assert.deepStrictEqual(lostRels(`cd .claude-tweaks/pipelines; ${past}mkdir 2026-x`), ['.claude-tweaks/pipelines/2026-x']);
      assert.deepStrictEqual(lostRels(`cd .claude-tweaks; ${past}mkdir pipelines/2026-x`), ['.claude-tweaks/pipelines/2026-x']);
      assert.deepStrictEqual(lostRels(`{ cd /w/.claude-tweaks/pipelines; }; ${past}mkdir 2026-x`, '/r/.claude-tweaks'), ['.claude-tweaks/pipelines/2026-x']);
      // A lost cwd's own lower trail never lowers a known cwd's seed either: after one loss, `cd
      // .claude-tweaks` (one step), then `{ cd /w/.claude-tweaks/pipelines; }` (two) and a second
      // loss; bash 3.2 and 5 create /w/.claude-tweaks/pipelines/2026-x.
      assert.deepStrictEqual(lostRels(`${past}cd .claude-tweaks; { cd /w/.claude-tweaks/pipelines; }; ${past}mkdir 2026-x`), ['.claude-tweaks/pipelines/2026-x']);
      assert.deepStrictEqual(lostRels(`cd .claude-tweaks/pipelines; cd /r/sub; ${past}mkdir 2026-x`), ['2026-x']);
      assert.deepStrictEqual(lostRels(`cd .claude-tweaks; ${past}mkdir other-x`), ['.claude-tweaks/other-x']);
      // The seed reaches the overflow cwd's lost target too, so every lost cwd of the collapse agrees
      // (bash 3.2 and 5 write /r/.claude-tweaks/pipelines/f; an earlier revision of this branch
      // reported `f` for both).
      assert.deepStrictEqual(fileWriteTargets(`cd .claude-tweaks/pipelines; ${past}echo x > f`, '/r', opts).filter((t) => t.lost).map((t) => t.rel),
        ['.claude-tweaks/pipelines/f', '.claude-tweaks/pipelines/f']);
    });
    // #4303: any other handler is never handed a lost cwd. The set collapses to real paths, the
    // overflow cwd and the start, and a relative cd moves them, exactly as base d9aa6b82d did, so the
    // handler contract (a cwd string, or null) and the teardown gate's decisions hold.
    test('#4303 cwd cap: a handler outside the module is handed base\'s real collapse paths, moved by a relative cd', () => {
      const seen = boundedRun((g, a) => {
        const out = new Set();
        g.forEachShellSegment(a.cmd, '/r', (t, cwd) => { if (t[0] === 'true') out.add(cwd); }, a.opts);
        return [...out];
      }, { cmd: distinct((i) => `{ cd /a${i}; }; `, 16) + 'cd q; true', opts });
      assert.deepStrictEqual(seen, [path.resolve('/main/q'), path.resolve('/r/q')]);
    });
    // The handler's fourth argument is true on every visit of a piece after the first, so the run
    // length of visits is the piece's cwd count. Self-contained: it runs in the bounded child.
    const largestCwdSet = (g, a) => {
      let most = 0;
      let n = 0;
      g.forEachShellSegment(a.cmd, '/r', (t, cwd, q, repeat) => {
        n = repeat ? n + 1 : 1;
        most = Math.max(most, n);
      }, a.opts);
      return most;
    };
    test('#4303 cwd cap: a set past the cap holds at most CWD_SET_CAP + 2 cwds', () => {
      const most = boundedRun(largestCwdSet, { cmd: distinct((i) => `{ cd /a${i}; }; `, 40) + 'true', opts });
      assert.ok(most <= 18, `${most} cwds`);
    });
    // The relative cd in each tail moves every known cwd, and a lost one stays lost, so the set stays
    // within 18 however many tails follow.
    test('#4303 cwd cap: relative-cd tails after the collapse stay within CWD_SET_CAP + 2 cwds', () => {
      const cmd = distinct((i) => `{ cd /a${i}; }; `, 15) + '{ cd s; }; ' + 'echo $(true; true) cd t; '.repeat(200) + 'true';
      const most = boundedRun(largestCwdSet, { cmd, opts });
      assert.ok(most <= 18, `${most} cwds`);
    });
    // #4303: a lost cwd never grows, so a relative cd costs nothing however many follow (a kept
    // real path grew one segment per step: 78 s through the hook at 44 KB). With no aN present every
    // cd fails, and bash 3.2 and 5 write ../f.js from the start cwd (R/f.js); the walk resolves it
    // to the overflow root and under the start, failing closed into the main checkout.
    test('#4303 cwd cap: 4,000 relative-cd groups finish inside the bound and resolve into the main checkout', () => {
      const cmd = distinct((i) => `{ cd a${i}; }; `, 4000) + 'cp a ../f.js';
      const files = boundedTargets('fileWriteTargets', cmd, '/r/w', opts).filter((t) => t.lost).map((t) => t.file);
      assert.deepStrictEqual(files, [MAIN_ROOT, path.resolve('/r/w/f.js')]);
    });
    // #4303: the walk follows a cwd past 4,096 characters and back. From a tree of 2,100 nested `d`
    // directories in the worktree, seven 300-level descents, seven 300-level climbs and `cd ../M`
    // (10.6 KB) end in M: bash 5 writes M/leak.out (bash 3.2 did not finish within 1,000 s on the
    // oracle machine; it was later seen to write M/leak.out too). A length bound that collapsed the
    // cwd onto the overflow path started the climbs from M and missed it.
    test('#4303 cwd cap: a cwd that descends past 4,096 characters and climbs back resolves where bash is', () => {
      const cmd = `cd ${'d/'.repeat(300)}; `.repeat(7) + `cd ${'../'.repeat(300)}; `.repeat(7) + 'cd ../M; echo x > leak.out';
      assert.deepStrictEqual(boundedTargets('fileWriteTargets', cmd, '/s/wt', { overflowCwd: '/s/M' }).map((t) => t.file), [path.resolve('/s/M/leak.out')]);
    });
    // #4303: however many collapses come first, the write after them resolves into the main
    // checkout. N groups `{ cd /nonexistK; }` (each cd fails, so bash stays in the worktree) then
    // `{ cd OTHER; }; echo x > ../../M/leak.out`: bash 3.2 and 5 write M/leak.out for N = 20, 2002,
    // 2017, 3007, 3022, 4012 and 4027. A cap on the number of collapses that fell back to the overflow
    // path alone dropped OTHER at some phases and allowed it. Now the phase only decides whether
    // OTHER is still known (M/leak.out) or the group overflowed the cap and the lost cwd stands for
    // it (M itself, the overflow root); every N from 1 to 60 is checked.
    test('#4303 cwd cap: a write after any number of collapses resolves into the main checkout', () => {
      const M = path.resolve('/s/M');
      const ns = [...Array.from({ length: 60 }, (_, i) => i + 1), 2002, 2017, 3007, 3022, 4012, 4027];
      // One bounded child runs every N; the commands are built here and the targets come back in order.
      const filesByN = boundedRun((g, a) => a.commands.map((command) => g.fileWriteTargets(command, '/s/wt', { overflowCwd: '/s/M' }).map((t) => t.file)), {
        commands: ns.map((n) => `${distinct((i) => `{ cd /nonexist${i}; }; `, n)}{ cd /s/other/deep; }; echo x > ../../M/leak.out`),
      });
      ns.forEach((n, k) => {
        const files = filesByN[k];
        assert.ok(files.some((f) => f === M || f.startsWith(M + path.sep)), `N=${n}: ${JSON.stringify(files)}`);
      });
      const files20 = filesByN[ns.indexOf(20)];
      assert.ok(files20.includes(path.resolve('/s/M/leak.out')), JSON.stringify(files20));
    });
  }
  // #4149: a pass's nested scans share a step budget, so a shape whose "$( runs off the end from
  // every top-level span (each falls back to the plain quote end and the next one rescans the same
  // text: here an unterminated heredoc) stays linear. The timing budget lives in
  // perf/heredoc-scan-linearity.test.js (a wall-clock assertion flakes under load); this pins the read.
  test('#4149 nesting: a "$( that runs off the end from every span still reports the later write', () => {
    const targets = fileWriteTargets(`echo ${'"$(<<X\n"'.repeat(7500)} && cp a /main/f.js`, '/r');
    assert.deepStrictEqual(targets, [main('copy')]);
  });
  test('#4149 nesting: a closed nest deeper than the cap takes the plain quote reading', () => {
    const targets = boundedTargets('fileWriteTargets', `echo ${'"$('.repeat(5000)}${')"'.repeat(5000)} && cp a /main/f.js`, '/r');
    assert.deepStrictEqual(targets, [main('copy')]);
  });
  // #4303: the walk keeps one and-or list per substitution level, and reaching a level drops the
  // deeper ones in amortized constant time, so a deep closed nest stays linear (scanning every open
  // level on each event was quadratic: 9 s at 20,000 levels). bash 3.2 and 5 crash on this nest
  // (SIGSEGV) and write nothing; the scanner keeps the write (fail closed).
  test('#4303 nesting: a 40,000-deep closed $( ) nest finishes inside the bound', () => {
    const cmd = `${'x=$(true; '.repeat(40000)}cp a f.js${')'.repeat(40000)}`;
    assert.deepStrictEqual(boundedTargets('fileWriteTargets', cmd, '/r'), [{ action: 'copy', file: path.resolve('/r/f.js') }]);
  });

  // lineLeavesStructureOpen: a `)` inside a quoted "$( )" closes no subshell, so the later body stays kept.
  test('#4149 nesting: a ) inside a quoted "$( )" leaves the subshell open (lineLeavesStructureOpen)', () => {
    const targets = fileWriteTargets("( echo \"$(echo \")\")\" >/dev/null\ncat <<'EOF'\necho x > f.js\nEOF\n) | bash", '/r');
    assert.ok(targets.some((t) => t.file === path.resolve('/r', 'f.js')), JSON.stringify(targets));
  });

  // The reader check reads a quoted "${ }" and an unquoted ${ } whole, so data bodies still strip
  // (a "$( )" argument makes its command no reader at all, so it cannot pin these seams).
  for (const [label, cmd] of [
    ['a quoted "${ }" with an & inside (splitOnLoneAmpersand)', "cat <<'EOF' | jq \"${x:-\"a&b\"}\"\na > b\nEOF"],
    ['a quoted "${ }" with a ( inside (removeQuotedSpans)', "cat <<'EOF' | jq \"${x:-\"(a)\"}\"\na > b\nEOF"],
    ['an unquoted ${ } with an & inside (splitOnLoneAmpersand)', "cat <<'EOF' | jq ${x//&/y}\na > b\nEOF"],
  ]) {
    test(`#4149 nesting: a reader whose argument is ${label} still strips its body`, () => {
      assert.deepStrictEqual(fileWriteTargets(cmd, '/r'), []);
    });
  }

  // The reader check reads a top-level backtick in its own quoting context, so a quote inside it
  // hides no lone `&` and no process substitution after it (bash 5 runs both bodies).
  for (const [label, cmd] of [
    ['a single quote inside a top-level backtick, before a lone & and a shell (splitOnLoneAmpersand)', "cat `'x` & bash <<'EOF'\necho x > f.js\nEOF"],
    ['an odd quote inside a top-level backtick, before a process substitution (removeQuotedSpans)', "tee `echo \"x` >(bash) \"y\" >/dev/null <<'EOF'\necho x > f.js\nEOF"],
    // #4149: the same seams read a single-quoted span whole, so a `"` inside one opens nothing.
    ['a double quote inside single quotes, before a lone & and a shell (splitOnLoneAmpersand)', "jq '\"' & bash <<'EOF'\necho x > f.js\nEOF"],
    ['a double quote inside single quotes, around a process substitution (removeQuotedSpans)', "tee '\"' >(bash) '\"' >/dev/null <<'EOF'\necho x > f.js\nEOF"],
  ]) {
    test(`#4149 nesting: ${label} keeps the body visible`, () => {
      const targets = fileWriteTargets(cmd, '/r');
      assert.ok(targets.some((t) => t.file === path.resolve('/r', 'f.js')), JSON.stringify(targets));
    });
  }
}

// #4149: a redirection (`>/dev/null`, `2>&1`, `>>f`, `<in`, or an
// operator and its target word) is never a write shape's positional; its own target is still
// reported by the redirection scan.
for (const [label, cmd, expected] of [
  ['tee -a f >/dev/null', 'tee -a f >/dev/null', [{ action: 'write', file: path.resolve('/r', 'f') }]],
  ['tee a >>f', 'tee a >>f', [{ action: 'write', file: path.resolve('/r', 'f') }, { action: 'write', file: path.resolve('/r', 'a') }]],
  ['cp a /main/f.js 2>/dev/null', 'cp a /main/f.js 2>/dev/null', [{ action: 'copy', file: MAIN_F }]],
  ['cp a /main/f.js 2>&1', 'cp a /main/f.js 2>&1', [{ action: 'copy', file: MAIN_F }]],
  ['cp a /main/f.js > /dev/null', 'cp a /main/f.js > /dev/null', [{ action: 'copy', file: MAIN_F }]],
  ['cp a /main/f.js <in', 'cp a /main/f.js <in', [{ action: 'copy', file: MAIN_F }]],
  // A process substitution is a file argument (bash copies `<(…)`), never a redirection to drop.
  ['cp <(true) /main/f.js', 'cp <(true) /main/f.js', [{ action: 'copy', file: MAIN_F }]],
]) {
  test(`#4149 redirect tokens: \`${label}\` reads no redirection as a positional`, () => {
    assert.deepStrictEqual(fileWriteTargets(cmd, '/r'), expected);
  });
}

// #4149: a kept body whose opener line names no known shell (make, at, ...) may
// not run as one bash script, so it is also scanned whole, with no inner opener planned.
test('#4149: a make recipe heredoc inside a kept make body is scanned whole', () => {
  const targets = fileWriteTargets("make -s -f - <<'EOF'\nall:\n\tcat <<-X\n\techo x > f.js\n\tX\nEOF", '/r');
  assert.ok(targets.some((t) => t.file === path.resolve('/r', 'f.js')), JSON.stringify(targets));
});

// ...while its planned reading is kept too, so an odd quote in an inner body cannot swallow a later
// line of a body whose consumer may be a shell after all (`"$BASH"`, a group piped to bash). The
// later line is a `cp`: a swallowed `>` would still surface through tokenize's `\S+` fallback.
for (const [label, cmd] of [
  ['a shell named by a variable ("$BASH")', `"$BASH" <<'EOF'\ncat <<'X'\ndon't\nX\ncp a f.js\nEOF`],
  ['a brace group piped to bash', "{\ncat <<'EOF'\ncat <<'X'\ndon't\nX\ncp a f.js\nEOF\n} | bash"],
]) {
  test(`#4149: an inner apostrophe in a body fed to ${label} does not hide a later line`, () => {
    const targets = fileWriteTargets(cmd, '/r');
    assert.ok(targets.some((t) => t.action === 'copy' && t.file === path.resolve('/r', 'f.js')), JSON.stringify(targets));
  });
}

for (const opener of ["env -S'bash -s' cat", 'env -S"bash -s" cat', "env -S 'bash -s' cat", "env --split-string='bash -s' cat", 'env -P/x cat', 'env -P /x cat', "env -iS'bash -s' cat"]) {
  test(`#4149: \`${opener}\` is not a reader`, () => {
    assert.deepStrictEqual(fileWriteTargets(`${opener} <<'EOF'\necho x > f.js\nEOF`, '/r'), [{ action: 'write', file: path.resolve('/r', 'f.js') }]);
  });
}

// Routine commands whose bodies must stay data: a false keep here denies everyday work. Each body
// carries write-shaped lines (a redirect, a cp, a cd) and an apostrophe, and only the opener line's
// own target is reported.
{
  const BODY = "a > /main/x\nit's done\ncp a /main/y\ncd /main\n";
  const own = (file) => [{ action: 'write', file: path.resolve('/r', file) }];
  for (const [opener, expected] of [
    ["git commit -F - <<'EOF'", []],
    ["git -C /wt/x commit -F - <<'EOF'", []],
    ["git -C \"/wt/with space\" commit -F - <<'EOF'", []],
    ["git -C \"$WT\" commit -F - <<'EOF'", []],
    ["gh pr create --body-file - <<'EOF'", []],
    ["gh issue comment 1 --body-file - <<'EOF'", []],
    ["cat > f <<'EOF'", own('f')],
    ["cat >> f <<'EOF'", own('f')],
    ["node - <<'EOF'", []],
    ["tee f <<'EOF'", own('f')],
    ["python3 - <<'EOF'", []],
    ["cat <<'EOF' | jq .", []],
    ["git commit --file=- <<'EOF'", []],
    ["gh api repos/o/r/issues/1/comments -F body=@- <<'EOF'", []],
    ["cat <<'EOF' > \"$TMPDIR/x\"", []],
    ["node <<'EOF'", []],
    ["node \"${CLAUDE_PLUGIN_ROOT}/bin/x.js\" <<'EOF'", []],
    ["tee -a f >/dev/null <<'EOF'", own('f')],
    ["cat <<'EOF' | gh issue comment 1 --body-file -", []],
    ["cat <<'EOF' | node", []],
    ["mkdir -p d && cat > d/f <<'EOF'", own('d/f')],
    ["git add -A && git commit -F - <<'EOF'", []],
    ["git -C x add f && git -C x commit -F - <<'EOF'", []],
    // #4149: a substitution on the heredoc's own command, before its `<<`, reads the
    // shell's stdin (bash expands those words before it attaches the heredoc), so it refuses
    // nothing; `$((` is arithmetic.
    ["gh pr create --title \"$(git log -1 --format=%s)\" --body-file - <<'EOF'", []],
    ["gh pr create --title \"`date`\" --body-file - <<'EOF'", []],
    ["git -C \"$(git rev-parse --show-toplevel)\" commit -F - <<'EOF'", []],
    ["jq '.a | \"$(x)\"' <<'EOF'", []],
    ["jq \"$(sh)\" <<'EOF'", []],
    ["node \"$(bash)\" <<'EOF'", []],
    ["cat `sh` <<'EOF'", []],
    ["cat <<'EOF' | jq \"$((1))\"", []],
    // #4149: only a substitution at or after the `<<` refuses the own command, and arithmetic
    // with parens of its own still closes as `))`.
    ["node \"$(git rev-parse --show-toplevel)/x.js\" <<'EOF'", []],
    ["cat <<'EOF' | jq \"$((1+2))\"", []],
    ["cat <<'EOF' | jq \"$(( (1+2)*3 ))\"", []],
  ]) {
    test(`#4149 routine: \`${opener}\` still strips its body`, () => {
      assert.deepStrictEqual(fileWriteTargets(`${opener}\n${BODY}EOF`, '/r'), expected);
    });
  }
  // #4149: after `||` (not a pipe), the next heredoc's own command reads no body through its
  // substitution, so both bodies strip.
  test("#4149 routine: `cat <<'A' || jq \"$(sh)\" <<'B'` strips both bodies", () => {
    assert.deepStrictEqual(fileWriteTargets(`cat <<'A' || jq "$(sh)" <<'B'\n${BODY}A\n${BODY}B`, '/r'), []);
  });
  // The message read from a quoted "$(cat <<'EOF' … EOF)": the inner cat is the reader, and the outer
  // command, whose segment carries the substitution, receives no heredoc stdin.
  for (const outer of ['git commit -m', 'git -C /wt/x commit -m', 'gh pr create --title t --body']) {
    test(`#4149 routine: \`${outer} "$(cat <<'EOF' … EOF)"\` still strips its body`, () => {
      assert.deepStrictEqual(fileWriteTargets(`${outer} "$(cat <<'EOF'\n${BODY}EOF\n)"`, '/r'), []);
    });
  }
}

test('e2e #3080: bare redirection from a worktree-always main checkout is DENIED, matching cp/tee', () => {
  const preToolUse = require('../plugin/bin/lib/hooks/pre-tool-use');
  const os = require('os');
  const { execFileSync } = require('child_process');
  const main = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-3080-main-'));
  execFileSync('git', ['-C', main, 'init', '-q']);
  fs.mkdirSync(path.join(main, '.claude-tweaks'), { recursive: true });
  fs.writeFileSync(path.join(main, '.claude-tweaks', 'policy.yml'), 'worktree-always: true\n');
  const decisionFor = (command) => {
    const out = preToolUse.run({
      input: { tool_name: 'Bash', tool_input: { command }, cwd: main },
      runDir: null, runState: null, ownedRun: {}, cwd: main,
    });
    return out.json && out.json.hookSpecificOutput && out.json.hookSpecificOutput.permissionDecision;
  };

  for (const command of ['echo x > tracked-file.js', 'printf y >> tracked-file.js', 'cat a > tracked-file.js']) {
    assert.strictEqual(decisionFor(command), 'deny', command);
  }
  for (const command of ['echo x > /dev/null', 'cmd 2>&1']) {
    assert.notStrictEqual(decisionFor(command), 'deny', command);
  }
});

// #4149: past the walk's cwd cap, pre-tool-use collapses the cwds to the main checkout (and
// the worktree), so from a linked worktree a relative write, a push and a shadow mkdir after many
// distinct `cd`s are DENIED; an absolute write outside the repo and a handful of groups are not.
test('e2e #4149: a command past the cwd cap from a linked worktree is DENIED for a relative write, a push and a shadow mkdir', () => {
  const preToolUse = require('../plugin/bin/lib/hooks/pre-tool-use');
  const os = require('os');
  const { execFileSync } = require('child_process');
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ct-4149-cap-')));
  const main = path.join(tmp, 'main');
  const wt = path.join(tmp, 'wt');
  fs.mkdirSync(path.join(main, '.claude-tweaks'), { recursive: true });
  fs.writeFileSync(path.join(main, '.claude-tweaks', 'policy.yml'), 'worktree-always: true\n');
  const git = (...args) => execFileSync('git', ['-C', main, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { stdio: 'pipe' });
  git('init', '-q');
  git('add', '-A');
  git('commit', '-qm', 'init');
  git('worktree', 'add', '-q', wt);
  const decisionFor = (command) => {
    const out = preToolUse.run({
      input: { tool_name: 'Bash', tool_input: { command }, cwd: wt },
      runDir: null, runState: null, ownedRun: {}, cwd: wt,
    });
    return out.json && out.json.hookSpecificOutput && out.json.hookSpecificOutput.permissionDecision;
  };
  const many = Array.from({ length: 20 }, (_, i) => `{ cd /tmp/ct-4149-a${i}; }; `).join('');
  const few = Array.from({ length: 4 }, (_, i) => `{ cd /tmp/ct-4149-a${i}; }; `).join('');
  for (const command of [`${many}cp a f.js`, `${many}git push`, `${many}git commit -m x`, `${many}mkdir -p .claude-tweaks/pipelines/2026-x`]) {
    assert.strictEqual(decisionFor(command), 'deny', command.slice(-40));
  }
  for (const command of [`${many}cp a /tmp/ct-4149-f.js`, `${few}cp a f.js`]) {
    assert.notStrictEqual(decisionFor(command), 'deny', command.slice(-40));
  }
  // The teardown gate's walk resolves a relative `worktree remove` path in the main checkout too.
  const removed = preToolUse.teardownTargets({ input: { tool_name: 'Bash', tool_input: { command: `${many}git worktree remove x` } }, cwd: wt }).map((t) => t.path);
  assert.ok(removed.includes(path.join(main, 'x')) && removed.includes(path.join(wt, 'x')), JSON.stringify(removed));
});

// #4303: a main checkout with a linked worktree beside it (as e2e #4149 sets up), or nested in it at
// `.claude/worktrees/x` (this repo's layout), and the hook's decision for a command run from `cwd`
// (the worktree by default); `outputFor` returns the whole hookSpecificOutput. The main checkout
// ignores `.claude/worktrees/`, as this repo does. `policy` is its worktree-always value.
function linkedWorktree4303({ nested = false, policy = true } = {}) {
  const preToolUse = require('../plugin/bin/lib/hooks/pre-tool-use');
  const { execFileSync } = require('child_process');
  const tmp = tmpDir4303('ct-4303-e2e-');
  const main = path.join(tmp, 'main');
  const wt = nested ? path.join(main, '.claude', 'worktrees', 'x') : path.join(tmp, 'wt');
  fs.mkdirSync(path.join(main, '.claude-tweaks'), { recursive: true });
  fs.writeFileSync(path.join(main, '.claude-tweaks', 'policy.yml'), `worktree-always: ${policy}\n`);
  fs.writeFileSync(path.join(main, '.gitignore'), '.claude/worktrees/\n');
  const git = (...args) => execFileSync('git', ['-C', main, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { stdio: 'pipe' });
  git('init', '-q');
  git('add', '-A');
  git('commit', '-qm', 'init');
  git('worktree', 'add', '-q', wt);
  const outputFor = (command, cwd = wt) => {
    const out = preToolUse.run({
      input: { tool_name: 'Bash', tool_input: { command }, cwd },
      runDir: null, runState: null, ownedRun: {}, cwd,
    });
    return (out.json && out.json.hookSpecificOutput) || {};
  };
  const decisionFor = (command, cwd = wt) => outputFor(command, cwd).permissionDecision;
  return { main, wt, decisionFor, outputFor, teardownTargets: preToolUse.teardownTargets };
}

// #4303: one shape per fix, run from a linked worktree with the main checkout's absolute path in
// it. Bash 3.2 and 5, started in the worktree with every directory present, write into the main
// checkout for each: U1 and U2 `main/f.js` (U2's tee row too), U3 `main/a` (cp -rt, mv -vt, GNU
// install -Dt), U4 and U6 `main/f.js`, S49 runs `git commit` in main, S50 writes `main/s0/f.js`;
// `cd ${wt} && cp a f.js` writes `wt/f.js`. The commands carry the native temp path unquoted, which
// on win32 holds backslashes: bash removes an unquoted `\`, and so does the scanner (#4281), so the
// rows would name a drive-relative path there, which says nothing about the walk. Skipped on win32.
test('AC1.1 e2e #4303: every #4303 shape from a linked worktree into the main checkout is DENIED', {
  skip: process.platform === 'win32' && 'win32: the commands splice a native temp path, whose backslashes the scanner reads as escapes',
}, () => {
  const { main, wt, decisionFor } = linkedWorktree4303();
  const groups = Array.from({ length: 15 }, (_, i) => `{ cd /tmp/ct-4303-a${i}; }; `).join('');
  const denied = [
    ['U1', `cd ${main} || cd /tmp; echo x > f.js`],
    ['U2', `x=$(cd /tmp) cd ${main}; cp a f.js`],
    ['U2', `x=$(cd /tmp) cd ${main}; echo hi | tee f.js`],
    ['U3', `cp -rt ${main} a`],
    ['U3', `mv -vt ${main} a`],
    ['U3', `install -Dt ${main} a`],
    ['U4', `perl -0pi -e 's/a/b/' ${main}/f.js`],
    ['U6', `echo x >& ${main}/f.js`],
    ['U6', `echo x >&${main}/f.js`],
    ['S49', `x=$(true; cd ${main} && y=$(( (1 & 3) )) && git commit -am x)`],
    ['S50', `${groups}{ cd ${main}/s0/deep; }; cp a ../f.js`],
  ];
  for (const [shape, command] of denied) assert.strictEqual(decisionFor(command), 'deny', `${shape}: ${command.slice(-60)}`);
  assert.notStrictEqual(decisionFor(`cd ${wt} && cp a f.js`), 'deny');
});
// #4303: a `|` between case patterns is no pipe, so the arm's cd into the main checkout reaches the
// write after `esac`. Bash 3.2 and 5, started in the worktree, write `main/f.js` for each; base
// d9aa6b82d denied both. The path is single-quoted, so this runs on every platform.
test('e2e #4303: a write after a case arm whose pattern list holds a | and cds into the main checkout is DENIED', () => {
  const { main, decisionFor } = linkedWorktree4303();
  const m = shellQuote(main);
  for (const command of [`case x in a|x) cd ${m};; esac; echo x > f.js`, `case x in x|y) cd ${m}; echo x > f.js;; esac`]) {
    assert.strictEqual(decisionFor(command), 'deny', command);
  }
});
// #4303: bash 3.2 and 5 write nothing for `(( a>1 || b>2 ))`. From the main checkout it
// resolved `main/1` and `main/2` before #4303, a spurious deny there. No path is spliced in, so
// this runs on every platform.
test('AC2.1 e2e #4303: `(( a>1 || b>2 ))` is not denied from the main checkout or a linked worktree', () => {
  const { main, decisionFor } = linkedWorktree4303();
  assert.notStrictEqual(decisionFor('(( a>1 || b>2 ))', main), 'deny');
  assert.notStrictEqual(decisionFor('(( a>1 || b>2 ))'), 'deny');
});

// #4303: `groups4303(n)` is n groups `{ cd /tmp/ct-4303-nK; }`. No such directory exists, so every
// cd fails and bash stays in the worktree, while the walk passes its cwd cap and loses the cwd.
const groups4303 = (n) => Array.from({ length: n }, (_, i) => `{ cd /tmp/ct-4303-n${i}; }; `).join('');

// #4303: past the cwd cap, a relative target or `git -C` from the lost cwd is the main checkout's
// root itself. Run from a worktree nested at M/.claude/worktrees/x, bash 3.2 and 5 write:
//   A (20 and 50 groups)  M/.claude/.claude/worktrees/x/leak.out
//   B                     M/.claude/.claude-tweaks/pipelines/r/leak.out
//   C                     M/.claude/.claude/worktrees/x, then `git commit` in M
// An earlier revision of this branch clamped each one to a single path under M, which landed in the
// linked worktree (A, C) or the exempt `.claude-tweaks/pipelines/` (B), and allowed all four; base
// d9aa6b82d denies each. An absolute write into the worktree, or a write after an absolute cd back
// into it, stays allowed at every version (bash writes only the worktree).
test('e2e #4303: past the cwd cap, a relative write or git -C aimed at a nested worktree or the pipelines dir is DENIED', () => {
  const { wt, decisionFor } = linkedWorktree4303({ nested: true });
  const wtPath = '../../.claude/worktrees/x';
  const denied = [
    ['A', `${groups4303(20)}mkdir -p ${wtPath} && echo x > ${wtPath}/leak.out`],
    ['A', `${groups4303(50)}mkdir -p ${wtPath} && echo x > ${wtPath}/leak.out`],
    ['B', `${groups4303(20)}mkdir -p ../../.claude-tweaks/pipelines/r && echo x > ../../.claude-tweaks/pipelines/r/leak.out`],
    ['C', `${groups4303(20)}mkdir -p ${wtPath} && git -C ${wtPath} commit --allow-empty -qm leak`],
  ];
  for (const [shape, command] of denied) assert.strictEqual(decisionFor(command), 'deny', `${shape}: ${command.slice(-70)}`);
  // Quoted (#4281): an unquoted native path loses its backslashes to bash on win32 and names
  // a drive-relative path instead of the worktree file.
  assert.notStrictEqual(decisionFor(`${groups4303(20)}echo x > ${shellQuote(path.join(wt, 'ok.out'))}`), 'deny');
});
// #4303: the same from a group that overflows the cap with an absolute cd into the main checkout,
// which the collapse drops. Bash 3.2 and 5 write, nested and sibling layout alike:
//   A2  M/sub/.claude/worktrees/x/leak.out     C2  M/sub/.claude/worktrees/x, then `git commit` in M
//   B2  M/sub/.claude-tweaks/pipelines/r/leak.out
//   S50 M/sub/f.js (15 and 50 groups before it)
// Base d9aa6b82d allows A2 and B2 in both layouts and C2 nested; in the sibling layout
// M/.claude/worktrees/x, where an earlier revision of this branch resolved C2's `git -C`, is no
// worktree, and every version denies C2. S50 with 15 groups: base allows, now denies; with 50
// groups every version denies. Skipped on win32, as AC1.1 is: the commands splice the native temp
// path.
test('e2e #4303: past the cwd cap, a write after an overflowing group that cds into the main checkout is DENIED', {
  skip: process.platform === 'win32' && 'win32: the commands splice a native temp path, whose backslashes the scanner reads as escapes',
}, () => {
  for (const nested of [true, false]) {
    const { main, decisionFor } = linkedWorktree4303({ nested });
    const denied = [
      ['A2', `${groups4303(15)}{ cd ${main}/sub; }; mkdir -p .claude/worktrees/x && echo x > .claude/worktrees/x/leak.out`],
      ['B2', `${groups4303(15)}{ cd ${main}/sub/deep; }; mkdir -p ../.claude-tweaks/pipelines/r && echo x > ../.claude-tweaks/pipelines/r/leak.out`],
      ['C2', `${groups4303(15)}{ cd ${main}/sub; }; mkdir -p .claude/worktrees/x && git -C .claude/worktrees/x commit --allow-empty -qm leak`],
      ['S50', `${groups4303(15)}{ cd ${main}/sub/deep; }; echo x > ../f.js`],
      ['S50', `${groups4303(50)}{ cd ${main}/sub/deep; }; echo x > ../f.js`],
    ];
    for (const [shape, command] of denied) assert.strictEqual(decisionFor(command), 'deny', `${shape} nested=${nested}: ${command.slice(-70)}`);
  }
});
// #4303: from the main checkout itself the overflow cwd is the start, and the one lost cwd is still
// the overflow root. `groups4303(15)` then `{ cd M/sub; }` and a write to `.claude-tweaks/pipelines/r/
// leak.out` or `.claude/worktrees/x/leak.out`: bash 3.2 and 5 write it under M/sub (nested and sibling
// layout alike). Base d9aa6b82d resolved it to the exempt M/.claude-tweaks/pipelines/ or the
// gitignored M/.claude/worktrees/ and allowed it; now it is denied. Skipped on win32: the commands
// splice the native temp path.
test('e2e #4303: past the cwd cap from the main checkout, a relative write aimed at an exempt path is DENIED', {
  skip: process.platform === 'win32' && 'win32: the commands splice a native temp path, whose backslashes the scanner reads as escapes',
}, () => {
  const { main, decisionFor } = linkedWorktree4303({ nested: true });
  for (const dir of ['.claude-tweaks/pipelines/r', '.claude/worktrees/x']) {
    const command = `${groups4303(15)}{ cd ${main}/sub; }; mkdir -p ${dir} && echo x > ${dir}/leak.out`;
    assert.strictEqual(decisionFor(command, main), 'deny', dir);
  }
});
// #4303: from a session cwd outside any repo (a directory beside the main checkout), after
// `groups4303(16)` (every cd fails), bash 3.2 and 5 write M/leak.out for `echo x > ../main/leak.out`
// and commit in M for `git -C ../main commit`. The overflow cwd is then the session cwd itself, which
// is no repo, so the lost cwd's stand-in named no worktree-always repo: earlier revisions of this
// branch allowed both, base d9aa6b82d denies. The gate now denies a lost target
// whose stand-in proves no repo opted out. A worktree-always repo that opted out (policy off) has
// nothing to enforce, so the same lost write from its worktree stays allowed, as at every version.
// No path is spliced in, so this runs on every platform.
test('e2e #4303: past the cwd cap from a cwd outside any repo, a relative write or git -C into the main checkout is DENIED', () => {
  const { main, decisionFor } = linkedWorktree4303();
  const outside = path.join(path.dirname(main), 'a0');
  fs.mkdirSync(outside);
  for (const command of [`${groups4303(16)}echo x > ../main/leak.out`, `${groups4303(16)}git -C ../main commit --allow-empty -qm leak`]) {
    assert.strictEqual(decisionFor(command, outside), 'deny', command.slice(-50));
  }
  const off = linkedWorktree4303();
  fs.writeFileSync(path.join(off.main, '.claude-tweaks', 'policy.yml'), 'worktree-always: false\n');
  assert.notStrictEqual(off.decisionFor(`${groups4303(16)}echo x > ../main/leak.out`), 'deny');
});
// #4303: the lost target's opt-out reads the stand-in's own repo, so a session in a repo with no
// policy proved nothing about the worktree-always main checkout its relative path climbs into. From
// N, an unrelated repo beside the main checkout, and from VN, a repo nested at main/vendor/N, after
// `groups4303(16)` (every cd fails), bash 3.2 and 5 write main/leak.out, main/f or the main/tmp link,
// or commit in main, for each row. Earlier revisions of this branch allowed every row; base
// d9aa6b82d denies each, having read the path from the real start cwd. A lost target now
// also carries that reading (base's), checked as an ordinary target. Each command spells only
// relative paths, so this runs on every platform.
test('e2e #4303: past the cwd cap from a repo with no policy, a relative write or git -C into a worktree-always main checkout is DENIED', () => {
  const { main, decisionFor } = linkedWorktree4303();
  const { execFileSync } = require('child_process');
  const repoAt = (dir) => {
    fs.mkdirSync(dir, { recursive: true });
    execFileSync('git', ['-C', dir, 'init', '-q']);
    return dir;
  };
  const N = repoAt(path.join(path.dirname(main), 'N'));
  const VN = repoAt(path.join(main, 'vendor', 'N'));
  for (const [shape, command, cwd] of [
    ['A1w', `${groups4303(16)}echo x > ../main/leak.out`, N],
    ['A1g', `${groups4303(16)}git -C ../main commit --allow-empty -qm leak`, N],
    ['A1c', `${groups4303(16)}cd ../main && git commit --allow-empty -qm leak`, N],
    ['A1t', `${groups4303(16)}truncate -s0 ../main/f`, N],
    ['A1dd', `${groups4303(16)}dd if=/dev/null of=../main/f`, N],
    ['A1ln', `${groups4303(16)}ln -s /tmp ../main/tmp`, N],
    ['A1nw', `${groups4303(16)}echo x > ../../leak.out`, VN],
    ['A1ng', `${groups4303(16)}git -C ../.. commit --allow-empty -qm leak`, VN],
  ]) assert.strictEqual(decisionFor(command, cwd), 'deny', `${shape}: ${command.slice(-50)}`);
  // A write that stays in N is N's own business (bash 3.2 and 5 write N/ok.out), at every version.
  assert.notStrictEqual(decisionFor(`${groups4303(16)}echo x > ok.out`, N), 'deny');
});
// #4303: the stand-in says nothing about the cwds the collapse dropped. From N (a repo with no
// policy) and from a cwd outside any repo, 15 groups `{ cd P/aK; }` (every aK present, each cd
// succeeding) and `{ cd main/sub; }` overflow the cap, and the collapse drops main/sub; then
// `echo x > leak.out` or `git commit`: bash 3.2 and 5 write main/sub/leak.out or commit in main.
// Base d9aa6b82d allows both, from N and from outside any repo. Accepted gap, user decision
// 2026-10-26 (base parity): neither session's own repo has worktree-always on, so the lost target
// is checked by base's readings alone (N/leak.out, x0/…), and the write or commit stays allowed
// wherever base allowed it (earlier revisions of this branch denied some of these). Skipped on
// win32: the commands splice the native temp path.
test('e2e #4303: past the cwd cap, a relative write or commit after the collapse dropped a cwd in the main checkout stays allowed from a session not opted in, as at base', {
  skip: process.platform === 'win32' && 'win32: the commands splice a native temp path, whose backslashes the scanner reads as escapes',
}, () => {
  const { main, decisionFor } = linkedWorktree4303();
  const { execFileSync } = require('child_process');
  const parent = path.dirname(main);
  const N = path.join(parent, 'N');
  fs.mkdirSync(N);
  execFileSync('git', ['-C', N, 'init', '-q']);
  const outside = path.join(parent, 'x0');
  fs.mkdirSync(outside);
  fs.mkdirSync(path.join(main, 'sub'));
  const ok15 = Array.from({ length: 15 }, (_, i) => {
    fs.mkdirSync(path.join(parent, `a${i}`));
    return `{ cd ${parent}/a${i}; }; `;
  }).join('');
  for (const cwd of [N, outside]) {
    for (const tail of ['echo x > leak.out', 'git commit --allow-empty -qm leak']) {
      assert.notStrictEqual(decisionFor(`${ok15}{ cd ${main}/sub; }; ${tail}`, cwd), 'deny', `${path.basename(cwd)}: ${tail}`);
    }
  }
  // With no reading in a worktree-always checkout (N/sub is N's), the same write stays allowed.
  assert.notStrictEqual(decisionFor(`${ok15}{ cd ${N}/sub; }; echo x > leak.out`, N), 'deny');
});
// #4303: bash may be in any cwd the collapse dropped, at any depth. From a cwd outside any repo
// (a0, beside the main checkout and N, a repo with no policy), `{ cd ../N/sub; }` then
// `groups4303(16)` (every one of those cds failing) leaves bash in N/sub, and
// `echo x > ../../main/leak.out`, `git -C ../../main commit` and `cd ../../main && git commit`: bash
// 3.2 and 5 write main/leak.out or commit in main. Base d9aa6b82d allows all three (no policy above
// the stand-in a0, and base's reading from a0 lands above main). The same from N itself
// (`{ cd sub; }` first) is allowed at base too. Accepted gap, user decision 2026-10-26 (base
// parity): neither a0 nor N has worktree-always on, so the lost target is checked by base's
// readings alone, and all four stay allowed, as at base (earlier revisions of this branch denied
// some of them). Only relative paths are spliced in, so this runs on every platform.
test('e2e #4303: past the cwd cap, a write or commit from a dropped cwd in another repo into the main checkout stays allowed from a session not opted in, as at base', () => {
  const { main, decisionFor } = linkedWorktree4303();
  const { execFileSync } = require('child_process');
  const parent = path.dirname(main);
  const N = path.join(parent, 'N');
  fs.mkdirSync(path.join(N, 'sub'), { recursive: true });
  execFileSync('git', ['-C', N, 'init', '-q']);
  const a0 = path.join(parent, 'a0');
  fs.mkdirSync(a0);
  for (const [shape, command, cwd] of [
    ['write from a0', `{ cd ../N/sub; }; ${groups4303(16)}echo x > ../../main/leak.out`, a0],
    ['git -C from a0', `{ cd ../N/sub; }; ${groups4303(16)}git -C ../../main commit --allow-empty -qm leak`, a0],
    ['cd && commit from a0', `{ cd ../N/sub; }; ${groups4303(16)}cd ../../main && git commit --allow-empty -qm leak`, a0],
    ['write from N', `{ cd sub; }; ${groups4303(16)}echo x > ../../main/leak.out`, N],
  ]) assert.notStrictEqual(decisionFor(command, cwd), 'deny', `${shape}: ${command.slice(-50)}`);
});
// #4303: a plain relative cd after the loss may fail, and bash then stays where it was. From a0,
// `{ cd ../N/sub/d; }`, `groups4303(16)` and `cd nope` (no such directory), then
// `echo x > ../../../main/leak.out` or `git -C ../../../main commit`: bash 3.2 and 5 stay in N/sub/d
// and write main/leak.out or commit in main. Base d9aa6b82d allows both: the readings moved by
// `nope` all land outside main (N/main, above the parent). Accepted gap, user decision 2026-10-26
// (base parity): a0 is no repo, so the lost target is checked by base's readings alone and both
// stay allowed, as at base (an earlier revision of this branch denied them). Only relative paths
// are spliced in, so this runs on every platform.
test('e2e #4303: past the cwd cap, a write or commit after a relative cd that fails stays allowed from a session not opted in, as at base', () => {
  const { main, decisionFor } = linkedWorktree4303();
  const { execFileSync } = require('child_process');
  const parent = path.dirname(main);
  const N = path.join(parent, 'N');
  fs.mkdirSync(path.join(N, 'sub', 'd'), { recursive: true });
  execFileSync('git', ['-C', N, 'init', '-q']);
  const a0 = path.join(parent, 'a0');
  fs.mkdirSync(a0);
  for (const tail of ['echo x > ../../../main/leak.out', 'git -C ../../../main commit --allow-empty -qm leak']) {
    assert.notStrictEqual(decisionFor(`{ cd ../N/sub/d; }; ${groups4303(16)}cd nope; ${tail}`, a0), 'deny', tail);
  }
});
// #4303: from a0 (outside any repo) and from N (a repo with no policy), `cd $(echo ../main)` (a cwd
// the walk cannot read), `groups4303(16)` and `echo x > leak.out`: bash 3.2 and 5 write
// main/leak.out. Base d9aa6b82d allows it from both. Accepted gap, user decision 2026-10-26 (base
// parity): the unreadable cwd is dropped by the collapse as base dropped it, and neither session's
// own repo has worktree-always on, so it stays allowed, as at base (an earlier revision of this
// branch denied it from a0). Only relative paths are spliced in, so this runs on every platform.
test('e2e #4303: past the cwd cap after a cd the walk cannot read, a relative write stays allowed from a session not opted in, as at base', () => {
  const { main, decisionFor } = linkedWorktree4303();
  const { execFileSync } = require('child_process');
  const a0 = path.join(path.dirname(main), 'a0');
  fs.mkdirSync(a0);
  const N = path.join(path.dirname(main), 'N');
  fs.mkdirSync(N);
  execFileSync('git', ['-C', N, 'init', '-q']);
  for (const cwd of [a0, N]) assert.notStrictEqual(decisionFor(`cd $(echo ../main); ${groups4303(16)}echo x > leak.out`, cwd), 'deny', path.basename(cwd));
});
// #4303: from a0, 140 failing groups, then either `{ cd main/sub; }` and 16 more failing groups
// (the dropped cwd comes after the 140), or `{ cd main/sub; }` first (it comes before them), then
// `echo x > leak.out`: bash 3.2 and 5 write main/sub/leak.out for both. Base d9aa6b82d allows both.
// Accepted gap, user decision 2026-10-26 (base parity): a0 is no repo, so the lost target is
// checked by base's readings alone (a0/leak.out) and both stay allowed, as at base (earlier
// revisions of this branch denied both). Skipped on win32: the commands splice the native temp path.
test('e2e #4303: past the cwd cap after many dropped cwds, a relative write stays allowed from a session not opted in, as at base', {
  skip: process.platform === 'win32' && 'win32: the command splices a native temp path, whose backslashes the scanner reads as escapes',
}, () => {
  const { main, decisionFor } = linkedWorktree4303();
  const a0 = path.join(path.dirname(main), 'a0');
  fs.mkdirSync(a0);
  fs.mkdirSync(path.join(main, 'sub'));
  const many = Array.from({ length: 140 }, (_, i) => `{ cd /tmp/ct-4303-m${i}; }; `).join('');
  assert.notStrictEqual(decisionFor(`${many}{ cd ${main}/sub; }; ${groups4303(16)}echo x > leak.out`, a0), 'deny', 'the dropped cwd comes after the 140 groups');
  assert.notStrictEqual(decisionFor(`{ cd ${main}/sub; }; ${many}${groups4303(16)}echo x > leak.out`, a0), 'deny', 'the dropped cwd comes before the 140 groups');
});
// #4303: from a subdirectory of a repo with no policy (N/sub), 16 groups `{ cd P/aK; }` (every
// aK beside the main checkout present, each cd succeeding) overflow the cap with the cwd lost from
// N, the overflow cwd: bash is in a15, and `echo x > ../main/leak.out`, `git -C ../main commit` and
// `cd ../main && git commit` write main/leak.out or commit in main (bash 3.2 and 5). Earlier
// revisions of this branch allowed all three, the lost cwd at the overflow root carrying no
// reading; base d9aa6b82d denies. Each lost target now carries base's readings, the
// overflow cwd's (N/../main) among them. Skipped on win32: the commands splice the native temp path.
test('e2e #4303: past the cwd cap from a subdirectory of a repo with no policy, a write or commit into the main checkout is DENIED', {
  skip: process.platform === 'win32' && 'win32: the commands splice a native temp path, whose backslashes the scanner reads as escapes',
}, () => {
  const { main, decisionFor } = linkedWorktree4303();
  const { execFileSync } = require('child_process');
  const parent = path.dirname(main);
  const N = path.join(parent, 'N');
  fs.mkdirSync(path.join(N, 'sub'), { recursive: true });
  execFileSync('git', ['-C', N, 'init', '-q']);
  const ok16 = Array.from({ length: 16 }, (_, i) => {
    fs.mkdirSync(path.join(parent, `a${i}`));
    return `{ cd ${parent}/a${i}; }; `;
  }).join('');
  for (const [shape, tail] of [
    ['write', 'echo x > ../main/leak.out'],
    ['git -C', 'git -C ../main commit --allow-empty -qm leak'],
    ['cd && commit', 'cd ../main && git commit --allow-empty -qm leak'],
  ]) assert.strictEqual(decisionFor(`${ok16}${tail}`, path.join(N, 'sub')), 'deny', shape);
});
// #4303: a cwd the collapse drops is checked by its base reading too. From N, beside the main
// checkout, `G16 cd ../main/sub; G16 echo x > leak.out` (every group's cd failing): bash 3.2 and 5
// write main/sub/leak.out. The relative cd moves the lost cwd's base reading into main/sub, and the
// second collapse drops it. Base d9aa6b82d allows it. Accepted gap, user decision 2026-10-26 (base
// parity): N has no policy, so the lost target is checked by base's readings alone (N/leak.out) and
// it stays allowed, as at base (an earlier revision of this branch denied it). Only relative paths
// are spliced in, so this runs on every platform.
test('e2e #4303: past a second cwd-cap collapse, a write after a relative cd into the main checkout stays allowed from a session not opted in, as at base', () => {
  const { main, decisionFor } = linkedWorktree4303();
  const { execFileSync } = require('child_process');
  const N = path.join(path.dirname(main), 'N');
  fs.mkdirSync(N);
  execFileSync('git', ['-C', N, 'init', '-q']);
  fs.mkdirSync(path.join(main, 'sub'));
  assert.notStrictEqual(decisionFor(`${groups4303(16)}cd ../main/sub; ${groups4303(16)}echo x > leak.out`, N), 'deny');
});
// #4303: an && chain is this walk's own branching: base d9aa6b82d took every cd to succeed and never
// collapsed there. From N (a repo with no policy) beside the main checkout (worktree-always on), 16
// `cd P/okK &&` (every okK present, each cd succeeding), then `cd main/sub; echo x > leak.out`,
// `cd main/sub; git commit` or `cd main; cd sub; echo x > leak.out`: bash 3.2 and 5 write
// main/sub/leak.out or commit in main. Base reads main/sub and denies each. This walk's failure
// branches overflow the cap where base's walk never did; base's own reading of the command, a known
// target, still names main/sub, so a session that has not opted in never turns base's deny into an
// allow (an earlier revision of this branch, checking the collapse's readings alone from N, allowed
// all three). Now and at base: deny. Skipped on win32: the commands splice the native temp path.
test('e2e #4303: past the cwd cap in an && chain, a write or commit into the main checkout is DENIED from a session not opted in, as at base', {
  skip: process.platform === 'win32' && 'win32: the commands splice a native temp path, whose backslashes the scanner reads as escapes',
}, () => {
  const { main, decisionFor } = linkedWorktree4303();
  const { execFileSync } = require('child_process');
  const parent = path.dirname(main);
  const N = path.join(parent, 'N');
  fs.mkdirSync(N);
  execFileSync('git', ['-C', N, 'init', '-q']);
  fs.mkdirSync(path.join(main, 'sub'));
  const chain = Array.from({ length: 16 }, (_, i) => {
    fs.mkdirSync(path.join(parent, `ok${i}`));
    return `cd ${parent}/ok${i} && `;
  }).join('');
  for (const [shape, tail] of [
    ['AOw', `cd ${main}/sub; echo x > leak.out`],
    ['AOg', `cd ${main}/sub; git commit --allow-empty -qm leak`],
    ['AOrel', `cd ${main}; cd sub; echo x > leak.out`],
  ]) assert.strictEqual(decisionFor(`${chain}${tail}`, N), 'deny', shape);
});
// #4303: in a project whose policy is off or absent, a lost target is checked by base's readings
// alone, so realistic commands past the cap stay allowed. Each from the worktree, the main checkout,
// N (a repo with no policy) and a0 (outside any repo), nested and sibling layout, policy off and
// absent:
//   SPnull     `cd "$(git rev-parse --show-toplevel 2>/dev/null || pwd)" || exit 1;` (a cwd the walk
//              cannot read), four groups `{ cd pkg-X && ls >/dev/null; }`, then `echo done > results.txt`
//   SPnullGit  the same with `git commit --allow-empty -qm "work on #12"` (from the worktree, M and N)
//   SPmany     five such groups, then `cd build; cd ..; cd docs; cd ..; cd src; cd ..; cd build;
//              echo x > out.txt`
// Bash 3.2 and 5 write X/pkg-a/results.txt, commit in X, or write X/build/out.txt, for each session
// cwd X. An earlier revision of this branch capped the first two (a dropped cwd it could not read)
// and the third (past 128 readings), and denied every one whatever the policy. Now and at base:
// allow. Skipped on win32: the fixture's paths are native.
test('e2e #4303: past the cwd cap with the policy off or absent, realistic writes and commits are not denied', {
  skip: process.platform === 'win32' && 'win32: the fixture splices native temp paths',
}, () => {
  const { execFileSync } = require('child_process');
  const groups4 = '{ cd pkg-a && ls >/dev/null; }; { cd pkg-b && ls >/dev/null; }; { cd pkg-c && ls >/dev/null; }; { cd pkg-d && ls >/dev/null; }; ';
  const shapes = [
    ['SPnull', `cd "$(git rev-parse --show-toplevel 2>/dev/null || pwd)" || exit 1; ${groups4}echo done > results.txt`, ['wt', 'main', 'N', 'a0']],
    ['SPnullGit', `cd "$(git rev-parse --show-toplevel)" || exit 1; ${groups4}git commit --allow-empty -qm "work on #12"`, ['wt', 'main', 'N']],
    ['SPmany', `${groups4}{ cd pkg-e && ls >/dev/null; }; cd build; cd ..; cd docs; cd ..; cd src; cd ..; cd build; echo x > out.txt`, ['wt', 'main', 'N', 'a0']],
  ];
  for (const nested of [false, true]) {
    for (const policy of ['off', 'absent']) {
      const { main, wt, decisionFor } = linkedWorktree4303({ nested });
      for (const root of [main, wt]) {
        const file = path.join(root, '.claude-tweaks', 'policy.yml');
        if (policy === 'off') fs.writeFileSync(file, 'worktree-always: false\n');
        else fs.rmSync(file);
      }
      const parent = path.dirname(main);
      const N = path.join(parent, 'N');
      fs.mkdirSync(N);
      execFileSync('git', ['-C', N, 'init', '-q']);
      const at = { wt, main, N, a0: path.join(parent, 'a0') };
      for (const dir of Object.values(at)) {
        for (const p of ['pkg-a', 'pkg-b', 'pkg-c', 'pkg-d', 'pkg-e', 'build', 'docs', 'src']) fs.mkdirSync(path.join(dir, p), { recursive: true });
      }
      for (const [shape, command, cwds] of shapes) {
        for (const k of cwds) assert.notStrictEqual(decisionFor(command, at[k]), 'deny', `${shape} from ${k}, nested=${nested}, policy ${policy}`);
      }
    }
  }
});
// #4303: a lost target's readings ask git no more than base's did. From N (a repo with no policy)
// beside the main checkout (worktree-always on), 16 groups `{ cd main/vendor/dK; }`, one failing
// group, then 400 `echo x > fK;` (a vendor-heavy cost shape): bash 3.2 and 5 write fK in
// main/vendor/d15. Base d9aa6b82d read each write from N alone and asked git nothing for them;
// an earlier revision of this branch also read each from every dropped main/vendor/dK and asked git
// about each reading, about 112 s against base's 7 s. The gate now asks git about the session's own
// repo once. The write stays allowed, as at base, whose readings from N land in N: accepted gap,
// user decision 2026-10-26 (base parity). Timing-free: the pin counts repoInfo calls, each a git spawn. Skipped on win32: the
// command splices the native temp path.
test('#4303: past the cwd cap, a lost target\'s readings ask git no more than base\'s', {
  skip: process.platform === 'win32' && 'win32: the command splices a native temp path, whose backslashes the scanner reads as escapes',
}, () => {
  const { main, decisionFor } = linkedWorktree4303();
  const { execFileSync } = require('child_process');
  const wtDetect = require('../plugin/bin/lib/hooks/worktree-detect');
  const N = path.join(path.dirname(main), 'N');
  fs.mkdirSync(N);
  execFileSync('git', ['-C', N, 'init', '-q']);
  const groups = Array.from({ length: 16 }, (_, i) => {
    fs.mkdirSync(path.join(main, 'vendor', `d${i}`), { recursive: true });
    return `{ cd ${main}/vendor/d${i}; }; `;
  }).join('');
  const command = `${groups}{ cd /tmp/ct-4303-nx0; }; ${Array.from({ length: 400 }, (_, i) => `echo x > f${i}; `).join('')}`;
  const real = wtDetect.repoInfo;
  let calls = 0;
  wtDetect.repoInfo = (...args) => {
    calls += 1;
    return real(...args);
  };
  let decision;
  try {
    decision = decisionFor(command, N);
  } finally {
    wtDetect.repoInfo = real;
  }
  assert.notStrictEqual(decision, 'deny');
  assert.ok(calls <= 4, `repoInfo calls: ${calls}`);
});
// #4303: with no policy file anywhere above a session cwd outside any repo, a lost target has
// nothing to enforce. `groups4303(16)` then `echo x > out.txt`: bash 3.2 and 5 write out.txt in the
// session cwd. An earlier revision of this branch denied it, citing a worktree-always policy that
// does not exist; base d9aa6b82d allows it.
test('e2e #4303: past the cwd cap with no policy file anywhere, a relative write is not denied', () => {
  const preToolUse = require('../plugin/bin/lib/hooks/pre-tool-use');
  const plain = tmpDir4303('ct-4303-plain-');
  const out = preToolUse.run({
    input: { tool_name: 'Bash', tool_input: { command: `${groups4303(16)}echo x > out.txt` }, cwd: plain },
    runDir: null, runState: null, ownedRun: {}, cwd: plain,
  });
  assert.notStrictEqual(out.json && out.json.hookSpecificOutput && out.json.hookSpecificOutput.permissionDecision, 'deny', JSON.stringify(out));
});
// #4303: without an overflowCwd (the pipeline shadow guard) the collapse is a lost cwd at the
// walk's start, so a relative target resolves under the start. An && chain of 16 cds
// (`cd /tmp/ct-4303-aK && …`), then `cd WT/sub; mkdir -p ../.claude-tweaks/pipelines/2026-x`: with
// every aK present (each cd succeeds), bash 3.2 and 5 create the shadow run dir
// WT/.claude-tweaks/pipelines/2026-x (b3 also writes
// decisions.md in it), nested and sibling layout alike. An earlier revision of this branch collapsed
// to the real start and resolved `../` above it, so the shadow guard allowed both; base d9aa6b82d
// denies. Skipped on win32: the commands splice the native temp path.
test('e2e #4303: the pipeline shadow guard denies a shadow run dir made after an && chain past the cwd cap', {
  skip: process.platform === 'win32' && 'win32: the commands splice a native temp path, whose backslashes the scanner reads as escapes',
}, () => {
  const chain = Array.from({ length: 16 }, (_, i) => `cd /tmp/ct-4303-a${i + 1} && `).join('');
  for (const nested of [true, false]) {
    const { wt, outputFor } = linkedWorktree4303({ nested });
    for (const [shape, command] of [
      ['b', `${chain}cd ${wt}/sub; mkdir -p ../.claude-tweaks/pipelines/2026-x`],
      ['b3', `${chain}cd ${wt}/sub; mkdir -p ../.claude-tweaks/pipelines/2026-x && echo x > ../.claude-tweaks/pipelines/2026-x/decisions.md`],
    ]) {
      const out = outputFor(command);
      assert.strictEqual(out.permissionDecision, 'deny', `${shape} nested=${nested}`);
      assert.match(String(out.permissionDecisionReason), /a NEW pipeline run directory inside a linked worktree/, `${shape} nested=${nested}`);
    }
  }
});
// #4303: a cwd inside a `.claude-tweaks/pipelines` directory that the walk knew when it collapsed seeds
// the lost cwd's trail, so the pipeline shadow guard still sees the segment. Every groups4303 cd fails
// and the worktree has `.claude-tweaks/pipelines/` and `sub/`; bash 3.2 and 5 create
// wt/.claude-tweaks/pipelines/2026-x, a NEW run dir in the linked worktree, for each row (nested and
// sibling layout alike, worktree-always on or off):
//   from the worktree   `cd .claude-tweaks/pipelines; G16 mkdir 2026-x`, and the split
//                       `cd .claude-tweaks; G16 mkdir pipelines/2026-x`
//   from the main checkout  `cd ../wt/.claude-tweaks/pipelines; G16 mkdir 2026-x` (sibling), or
//                       `cd .claude/worktrees/x/.claude-tweaks/pipelines; G16 mkdir 2026-x` (nested)
// Decisions, now / base, for every row in every layout and policy: deny / allow. The guard is
// unconditional, so the policy changes nothing: the same commands without the loss
// (`cd .claude-tweaks/pipelines; mkdir 2026-x`) are denied at every version, base included, with
// worktree-always on or off.
// A deliberate fail-closed deny: from wt/sub, `cd .claude-tweaks/pipelines` fails and bash creates
// wt/sub/2026-x, no run dir, but the walk takes the plain cd to succeed and the trail is seeded
// (now deny; base allows). Lost targets with no trail stay allowed, as at base:
// `cd .claude-tweaks/pipelines; cd ../../sub; G16 mkdir 2026-x` (bash creates wt/sub/2026-x) and
// `cd .claude-tweaks; G16 mkdir other-x` (wt/.claude-tweaks/other-x).
test('e2e #4303: the pipeline shadow guard denies a run dir made from a pipelines cwd the walk knew before the cwd cap', () => {
  const lostShadow = /cannot tell whether this relative path creates a NEW pipeline run directory/;
  for (const policy of [true, false]) {
    for (const nested of [true, false]) {
      const { main, wt, outputFor } = linkedWorktree4303({ nested, policy });
      fs.mkdirSync(path.join(wt, '.claude-tweaks', 'pipelines'), { recursive: true });
      fs.mkdirSync(path.join(wt, 'sub'));
      const fromMain = nested ? '.claude/worktrees/x/.claude-tweaks/pipelines' : '../wt/.claude-tweaks/pipelines';
      const label = (row) => `${row} nested=${nested} policy=${policy}`;
      for (const [row, command, cwd] of [
        ['pipelines cwd', `cd .claude-tweaks/pipelines; ${groups4303(16)}mkdir 2026-x`, wt],
        ['split', `cd .claude-tweaks; ${groups4303(16)}mkdir pipelines/2026-x`, wt],
        ['from main', `cd ${fromMain}; ${groups4303(16)}mkdir 2026-x`, main],
        ['fail-closed from wt/sub', `cd .claude-tweaks/pipelines; ${groups4303(16)}mkdir 2026-x`, path.join(wt, 'sub')],
      ]) {
        const out = outputFor(command, cwd);
        assert.strictEqual(out.permissionDecision, 'deny', label(row));
        assert.match(String(out.permissionDecisionReason), lostShadow, label(row));
      }
      assert.notStrictEqual(outputFor(`cd .claude-tweaks/pipelines; cd ../../sub; ${groups4303(16)}mkdir 2026-x`).permissionDecision, 'deny', label('left'));
      assert.notStrictEqual(outputFor(`cd .claude-tweaks; ${groups4303(16)}mkdir other-x`).permissionDecision, 'deny', label('no pipelines'));
    }
  }
});
// #4303: from a worktree nested at M/.claude/worktrees/x, `G20 cd ..; git worktree remove [--force]
// x`: bash 3.2 and 5 run it in M/.claude/worktrees, and the --force one removes the session's own
// worktree. An earlier revision of this branch handed the lost cwd's root, resolved M/x and
// M/.claude/worktrees/x/x, and allowed both; base d9aa6b82d denies both through the own-cwd guard (#693).
// The teardown walk now keeps the lost cwd, so the relative path from it is marked lost (its path
// only the lost cwd's stand-in) and the gate denies it as unprovable. The groups after the 16th are
// known again (each an absolute cd), so `/tmp/x` is resolved from them as before.
test('e2e #4303: past the cwd cap, a relative `git worktree remove` of the session\'s own nested worktree is DENIED', () => {
  const { wt, decisionFor, teardownTargets } = linkedWorktree4303({ nested: true });
  for (const command of [`${groups4303(20)}cd ..; git worktree remove --force x`, `${groups4303(20)}cd ..; git worktree remove x`]) {
    assert.strictEqual(decisionFor(command), 'deny', command.slice(-50));
    const removed = teardownTargets({ input: { tool_name: 'Bash', tool_input: { command } }, cwd: wt });
    assert.ok(removed.some((t) => t.lost === true), JSON.stringify(removed));
  }
});

test('e2e #3989: a `>` in a heredoc body from a worktree-always main checkout is ALLOWED; a top-level redirect after the delimiter is DENIED', () => {
  const preToolUse = require('../plugin/bin/lib/hooks/pre-tool-use');
  const os = require('os');
  const { execFileSync } = require('child_process');
  const main = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-3989-main-'));
  execFileSync('git', ['-C', main, 'init', '-q']);
  fs.mkdirSync(path.join(main, '.claude-tweaks'), { recursive: true });
  fs.writeFileSync(path.join(main, '.claude-tweaks', 'policy.yml'), 'worktree-always: true\n');
  const decisionFor = (command) => {
    const out = preToolUse.run({
      input: { tool_name: 'Bash', tool_input: { command }, cwd: main },
      runDir: null, runState: null, ownedRun: {}, cwd: main,
    });
    return out.json && out.json.hookSpecificOutput && out.json.hookSpecificOutput.permissionDecision;
  };

  assert.notStrictEqual(decisionFor('node x.js <<EOF\nif (openIds.length > 0) b();\nEOF'), 'deny');
  assert.strictEqual(decisionFor('node x.js <<EOF\nif (openIds.length > 0) b();\nEOF\necho x > tracked-file.js'), 'deny');
});
