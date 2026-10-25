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
const { WRITE_SHAPES, fileWriteTargets, gitTargets, stripHeredocBodies } = require('../plugin/bin/lib/hooks/git-command');
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
  for (const command of ['((i>0))', '(( x>y ))', '((i>0))>x', '(a(b))>x', '$((1))>x', '"a"(ls)>x']) {
    assert.deepStrictEqual(fileWriteTargets(command, '/r'), [], command);
  }
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
});

test('#3989: stripHeredocBodies keeps the opener line and its newline, and drops the body and closing delimiter', () => {
  assert.strictEqual(stripHeredocBodies('A <<EOF\nbody\nEOF\nB'), 'A <<EOF\nB');
  assert.strictEqual(stripHeredocBodies('cat <<<x'), 'cat <<<x');
});

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
