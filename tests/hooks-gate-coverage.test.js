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
const { WRITE_SHAPES, fileWriteTargets, gitTargets } = require('../plugin/bin/lib/hooks/git-command');
const { shouldRunFull, PRE_TOOL_USE_WORDS } = require('../plugin/bin/lib/hooks/bash-prefilter');

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
  const text = fs.readFileSync(SCHEMA, 'utf8');
  const start = text.indexOf(BEGIN);
  const end = text.indexOf(END);
  assert.ok(start !== -1 && end !== -1 && end > start,
    `policy-schema-coverage.md must contain a ${BEGIN} ... ${END} block — it is the canonical statement of gate coverage`);
  return text.slice(start + BEGIN.length, end);
}

function teardownCoverageBlock() {
  const text = fs.readFileSync(SCHEMA, 'utf8');
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
  const src = fs.readFileSync(path.join(__dirname, '..', 'plugin', 'bin', 'lib', 'hooks', 'pre-tool-use.js'), 'utf8');
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
  const gc = fs.readFileSync(path.join(__dirname, '..', 'plugin', 'bin', 'lib', 'hooks', 'git-command.js'), 'utf8');
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
  for (const shape of WRITE_SHAPES) {
    assert.ok(PRE_TOOL_USE_WORDS.includes(shape),
      `WRITE_SHAPES includes '${shape}' but the pre-tool-use prefilter skips it — the parser branch is dead code`);
    assert.strictEqual(runsFull('pre-tool-use', `${shape} a b`), true, shape);
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
  const src = fs.readFileSync(path.join(__dirname, '..', 'plugin', 'bin', 'lib', 'hooks', 'pre-tool-use.js'), 'utf8');
  assert.ok(src.includes('GATE_COVERAGE.teardownTools'),
    'pre-tool-use.js must branch on GATE_COVERAGE.teardownTools, not a hardcoded comparison');
});

// #590: gitTargets now also recognizes `env git ...` — pin that the prefilter
// runs the full handler for each such shape in both events (the same #70
// asymmetry the WRITE_SHAPES test above guards against: a parser branch the
// handler never runs for is dead code), and that the parser really does
// resolve a target for the shapes.
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
// resolve (same #70 matcher/parser asymmetry).
test('env-with-flags git shapes reach the full handler, in both events (#3074)', () => {
  for (const event of ['pre-tool-use', 'post-tool-use']) {
    for (const command of ['env -C /main-checkout git commit -m "x"', 'env -u FOO git push', 'env -i git commit -m x']) {
      assert.strictEqual(runsFull(event, command), true, `${event} skips '${command}'`);
    }
  }

  // Parser side: the shapes the predicate exists for really do resolve.
  assert.deepStrictEqual(gitTargets('env -C /main-checkout git commit -m "x"', '/repo'), [{ action: 'commit', dir: '/main-checkout' }]);
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
// (for the action:remove shape) and on a Bash(git worktree remove ...)
// command — a PostToolUse group without matching matchers/predicates makes
// it dead at the registration seam, the same #70 dead-branch shape the
// EnterWorktree test above guards against.
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
// classifies but hooks.json names no `Bash(git {action} *)` predicate for is
// the identical dead-code hazard: the hook never spawns, so the classifier
// branch never runs for real traffic. Checked for BOTH PreToolUse and
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
