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
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { GATE_COVERAGE } = require('../plugin/bin/lib/hooks/pre-tool-use');
const gitCommand = require('../plugin/bin/lib/hooks/git-command');
const { WRITE_SHAPES, fileWriteTargets, forEachShellSegment, gitTargets, mkdirTargets, stripHeredocBodies } = gitCommand;
const { shouldRunFull } = require('../plugin/bin/lib/hooks/bash-prefilter');
const { readText } = require('./helpers/read-skill');

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
// relative target resolves under both the inner and the outer cwd.
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

// #4149: inside a double-quoted span, `$( … )`, backticks and `${ … }` nest as in
// bash, and a quote inside `$(` starts a fresh quoting context; an unquoted `${ … }` nests too. So no
// `&`, `;`, `(`, `)` or newline inside them is structural, and an earlier `cd` survives. Every case
// was checked under bash 3.2 and 5 (bash 3.2 cannot parse the odd-quote heredoc one).
{
  const main = (action) => ({ action, file: MAIN_F });
  const B = "<<'EOF'";
  for (const [label, cmd, expected] of [
    ['an & in a quoted string inside "$( )"', 'cd /main && echo "$(echo "a&b")" && cp a f.js', [main('copy')]],
    ['... followed by ; cp', 'cd /main && echo "$(echo "a&b")"; cp a f.js', [main('copy')]],
    ['... followed by a newline and cp', 'cd /main && echo "$(echo "a&b")"\ncp a f.js', [main('copy')]],
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
    ['a cd inside a top-level backtick', 'cd /main && echo `true; cd /tmp`; cp a f.js', [main('copy')]],
    ['a cd inside an assigned backtick', 'cd /main && x=`true && cd /tmp` && cp a f.js', [main('copy')]],
    ['a cd inside an unquoted $( )', 'cd /main && echo $(true; cd /tmp); cp a f.js', [main('copy')]],
    ['a cd after a lone & that follows a $( )', 'echo $(true; true) & cd /main; cp a f.js', [main('copy')]],
    ['a cd after a $( ) in a pass read again flat', `echo $(true) ${'"$('.repeat(40)}x${')"'.repeat(40)}; cd /main; true & cp a f.js`, [main('copy')]],
    ['a quoted ) inside "$( )", in a fresh quoting context', 'cd /main && echo "$(echo ")")" && cp a f.js', [main('copy')]],
    ['a subshell inside "$( )", whose ) closes only it', 'cd /main && echo "$( (true) ; echo "&" )" && cp a f.js', [main('copy')]],
    ['a quoted } inside a ${ } default', 'x=; cd /main && echo "${x:-"a}b"}" && cp a f.js', [main('copy')]],
    ['a $(( )) shift across a line, then a "$( )"', 'cd /main && echo "$((1<<2 +\n3)) $(echo "&")" && cp a f.js', [main('copy')]],
    // One pin per scanner seam.
    ['a ; inside quotes inside "$( )" (segmentSpans)', 'cp "$(echo "a;b" | tr -d ";b")" /main/f.js', [main('copy')]],
    ['a ; inside an unquoted ${ } (segmentSpans)', "x='a;'; cp ${x//;/} /main/f.js", [main('copy')]],
    ['an odd quote in a heredoc body inside "$( )", before a later body (scanHeredocs)', "cd /main && echo \"$(cat <<'X'\n5\" x\nX\n)\" && cat <<'EOF'\ndon't\nEOF\ncp a f.js", [main('copy')]],
    // A top-level backtick substitution is its own command text: a quote inside it opens nothing
    // past its closing backtick.
    ['an odd quote inside a top-level backtick', 'cd /main && echo `echo "a&b` && cp a f.js', [main('copy')]],
    ['an odd quote inside a top-level backtick, then a newline', 'cd /main && echo `echo "$(`\ncp a f.js', [main('copy')]],
    ['a backtick inside double quotes, then a top-level backtick', 'cd /main && echo "`"`"`"`\ncp a f.js', [main('copy')]],
    ['a top-level backtick, then a backtick inside double quotes', 'cd /main && echo `"`"`"`"\ncp a f.js', [main('copy')]],
    ['a heredoc opener inside a top-level backtick', 'cd /main && echo `cat <<EOF`\ncp a f.js\nEOF', [main('copy')]],
    ['an odd quote inside a top-level backtick, before a body holding a quote (scanHeredocs)', "cd /main && echo `echo \"x` && cat <<'EOF'\n\"\nEOF\ncp a f.js", [main('copy')]],
    // A pass that nests past the cap is read again flat, as before #4149, from its start.
    ['a nest past the cap holding backticks', `cd /main && echo ${'` "$('.repeat(33)}x${')"`'.repeat(33)} && cp a f.js`, [main('copy')]],
    ['a nest past the cap whose fallback would restart the nested reading', `cd /main && echo ${'"\'$('.repeat(31)}x${')"'.repeat(31)}; cp a f.js`, [main('copy')]],
    ['a ${ } nest past the cap (the flat pass takes ${ plainly)', `cd /main && echo ${'"\'${x:-'.repeat(31)}x${'}"'.repeat(31)}; cp a f.js`, [main('copy')]],
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
  test('#4149 nesting: a nest of unclosed "$( stays bounded', { timeout: 10000 }, () => {
    const targets = fileWriteTargets(`echo ${'"$('.repeat(40)}\ncp a /main/f.js`, '/r');
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
  const here = (action) => ({ action, file: path.resolve('/r', 'f.js') });
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
  // walk's own cwd: a relative target past the cap resolves there, an absolute one stays put, and
  // a handful of groups never collapses.
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
        assert.ok(files.includes(MAIN_F) && files.includes(path.resolve('/r/f.js')), JSON.stringify(files));
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
      // repetition holds at most three visited pieces, each visited under at most the cap's 16 cwds
      // plus one (head: 2,700 to 8,100 visits; uncapped: 45,000 to 136,000).
      test(`#4149 cwd cap: ${route} stay linear (visits per group bounded by the cap)`, () => {
        let visits = 0;
        forEachShellSegment(build(300, 'true'), '/r', () => { visits += 1; }, opts);
        assert.ok(visits < 300 * 3 * 17, `${visits} visits`);
      });
    }
    test('#4149 cwd cap: a push and a mkdir past the cap resolve in the overflow cwd', () => {
      const cmd = (last) => distinct((i) => `{ cd /a${i}; }; `, 20) + last;
      assert.ok(gitTargets(cmd('git push'), '/r', opts).some((t) => t.dir === path.resolve('/main')));
      assert.ok(mkdirTargets(cmd('mkdir d'), '/r', opts).some((t) => t.file === path.resolve('/main/d')));
    });
    test('#4149 cwd cap: four groups with relative cds (2^4 cwds) stay below the cap', () => {
      const files = fileWriteTargets('{ cd a; ls; }; { cd b; ls; }; { cd c; ls; }; { cd d; ls; }; cp x y', '/r', opts).map((t) => t.file);
      assert.strictEqual(files.length, 16, JSON.stringify(files));
      assert.ok(!files.includes(path.resolve('/main/y')) && files.includes(path.resolve('/r/a/b/c/d/y')), JSON.stringify(files));
    });
    test('#4149 cwd cap: a kept shell body past the cap collapses to the overflow cwd too', () => {
      const body = distinct((i) => `{ cd /a${i}; }; `, 20) + 'cp a f.js';
      const files = fileWriteTargets(`bash <<'EOF'\n${body}\nEOF`, '/r', opts).map((t) => t.file);
      assert.ok(files.includes(MAIN_F), JSON.stringify(files));
    });
    test('#4149 cwd cap: without an overflowCwd the set collapses to the walk\'s own cwd', () => {
      const files = fileWriteTargets(distinct((i) => `{ cd /a${i}; }; `, 20) + 'cp a f.js', '/r').map((t) => t.file);
      assert.ok(files.includes(path.resolve('/r/f.js')) && !files.includes(path.resolve('/a0/f.js')), JSON.stringify(files));
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
  test('#4149 nesting: a closed nest deeper than the cap takes the plain quote reading', { timeout: 10000 }, () => {
    const targets = fileWriteTargets(`echo ${'"$('.repeat(5000)}${')"'.repeat(5000)} && cp a /main/f.js`, '/r');
    assert.deepStrictEqual(targets, [main('copy')]);
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
