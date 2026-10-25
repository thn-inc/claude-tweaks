'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  checkReviewedTip, MAX_ADVANCES, REVIEWED_TIP_RE, movedLineRe,
} = require('../../../plugin/bin/lib/release-tip/check.js');
const { originWithTwoClones } = require('../../helpers/git-fixtures.js');

const BRANCH = 'main';
const VERDICT_KEYS = [
  'verdict', 'reason', 'detail', 'branch', 'reviewedTip', 'step3Tip', 'tipSha', 'commits',
  'move', 'bound', 'source', 'advanced', 'arrived', 'arrivedLog',
].sort();

const runner = (cwd, env) => (args) => spawnSync('git', args, { cwd, env, encoding: 'utf8', windowsHide: true });

const step3Line = (tip) => `- AUTO 10:00:00 — Step 3: whole-branch review starting, base v1.0.0..main at reviewed tip ${tip}; ## /review marker: 0 existing lines. Reversibility: n/a (marker).`;
const deltaMarker = (n, of) => `- AUTO 10:10:00 — Step 5: origin/main moved aaaaaaa → bbbbbbb (1 commits) before the merge — move ${n} of ${of}; delta review starting, base ${'c'.repeat(40)}..main; ## /review marker: 3 existing lines. Reversibility: n/a (marker). [lever: release-tip-moves=${of} (default)]`;
const deltaVerdict = (tip, base = 'c'.repeat(40)) => `- AUTO 10:20:00 — Step 5: delta review base ${base}..main: review: clean. Findings staged at none; at reviewed tip ${tip}. Reversibility: n/a (gate evaluation).`;
const decisions = (lines) => ['# Decisions', '', '## /release', ...lines, ''].join('\n');

const boundOf = (value, source = 'default', extra = {}) => ({
  status: 0, stdout: JSON.stringify({ 'release-tip-moves': { value, source, ...extra } }), stderr: '',
});

function withFixture(fn) {
  const fx = originWithTwoClones('release-tip-check-');
  try {
    return fn(fx);
  } finally {
    fs.rmSync(fx.root, { recursive: true, force: true });
  }
}

const originTip = (fx) => runner(fx.work, fx.env)(['rev-parse', `origin/${BRANCH}`]).stdout.trim();

function commitMsg(fx, cwd, name, msg) {
  fs.writeFileSync(path.join(cwd, name), msg);
  fx.run(cwd, ['add', name]);
  fx.run(cwd, ['commit', '-q', '-m', msg]);
}

function pushUpstream(fx) {
  fx.commit(fx.other, 'upstream.txt');
  fx.run(fx.other, ['push', '-q', 'origin', BRANCH]);
}

function pushRunDirUpstream(fx) {
  const dir = path.join(fx.other, '.claude-tweaks', 'pipelines', 'archive', 'r2');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'y.md'), 'upstream archive\n');
  fx.run(fx.other, ['add', '.claude-tweaks/pipelines']);
  fx.run(fx.other, ['commit', '-q', '-m', '[reconcile] archive run r2']);
  fx.run(fx.other, ['push', '-q', 'origin', BRANCH]);
}

function check(fx, { decisionsText, bound = boundOf(2), asGiven = false, git } = {}) {
  const logged = [];
  const v = checkReviewedTip(
    { decisionsText, branch: BRANCH, asGiven, preMajor: false },
    { git: git || runner(fx.work, fx.env), resolveBound: () => bound, appendLog: (t) => logged.push(t) },
  );
  assert.deepStrictEqual(Object.keys(v).sort(), VERDICT_KEYS, 'a verdict always carries every key');
  return { v, logged };
}

test('MAX_ADVANCES is 20', () => {
  assert.strictEqual(MAX_ADVANCES, 20);
});

test('unmoved origin → merge', () => {
  withFixture((fx) => {
    const tip = originTip(fx);
    const { v, logged } = check(fx, { decisionsText: decisions([step3Line(tip)]) });
    assert.strictEqual(v.verdict, 'merge');
    assert.strictEqual(v.tipSha, v.reviewedTip);
    assert.strictEqual(v.tipSha, tip);
    assert.strictEqual(v.step3Tip, tip);
    assert.deepStrictEqual(v.advanced, []);
    assert.strictEqual(v.arrived, null);
    assert.strictEqual(logged.length, 0);
  });
});

test('code move within the bound → delta, move 1 of 2', () => {
  withFixture((fx) => {
    const tip = originTip(fx);
    pushUpstream(fx);
    const { v } = check(fx, { decisionsText: decisions([step3Line(tip)]) });
    const newTip = originTip(fx);
    assert.strictEqual(v.verdict, 'delta');
    assert.strictEqual(v.move, 1);
    assert.strictEqual(v.bound, 2);
    assert.strictEqual(v.source, 'default');
    assert.strictEqual(v.commits, 1);
    assert.notStrictEqual(newTip, tip);
    assert.strictEqual(v.tipSha, newTip);
    assert.strictEqual(v.reviewedTip, tip);
  });
});

test('run-dir-only move advances, logs, and re-compares to merge', () => {
  withFixture((fx) => {
    const tip = originTip(fx);
    pushRunDirUpstream(fx);
    const { v, logged } = check(fx, { decisionsText: decisions([step3Line(tip)]) });
    const newTip = originTip(fx);
    assert.strictEqual(v.verdict, 'merge');
    assert.strictEqual(v.advanced.length, 1);
    assert.deepStrictEqual(v.advanced[0], { from: tip, to: newTip, commits: 1 });
    assert.strictEqual(v.reviewedTip, newTip);
    assert.strictEqual(v.tipSha, newTip);
    assert.strictEqual(logged.length, 1);
    const m = REVIEWED_TIP_RE.exec(logged[0]);
    assert.ok(m, `the advance line must record a reviewed tip: ${logged[0]}`);
    assert.strictEqual(m[1], newTip);
    assert.ok(!movedLineRe(BRANCH).test(logged[0]), 'an advance is never a counted move');
  });
});

test('run-dir-only then code move → delta from the advanced tip', () => {
  withFixture((fx) => {
    const tip = originTip(fx);
    pushRunDirUpstream(fx);
    const inner = runner(fx.work, fx.env);
    let pushed = false;
    // A sibling's code commit lands after the run-dir-only advance was taken.
    const git = (args) => {
      const r = inner(args);
      if (args[0] === 'diff' && r.status === 0 && !pushed) {
        pushed = true;
        pushUpstream(fx);
      }
      return r;
    };
    const { v, logged } = check(fx, { decisionsText: decisions([step3Line(tip)]), git });
    assert.ok(pushed, 'fixture must have taken the run-dir-only advance');
    assert.strictEqual(v.verdict, 'delta');
    assert.strictEqual(v.advanced.length, 1);
    assert.strictEqual(logged.length, 1);
    const advancedTip = v.advanced[0].to;
    assert.strictEqual(v.reviewedTip, advancedTip);
    assert.strictEqual(v.tipSha, originTip(fx));
    assert.strictEqual(v.commits, 1, 'the delta is counted from the advanced tip');
    assert.strictEqual(v.move, 1);
  });
});

test('bound exceeded → held, integration branch kept moving', () => {
  withFixture((fx) => {
    const tip = originTip(fx);
    pushUpstream(fx);
    const { v } = check(fx, { decisionsText: decisions([step3Line(tip), deltaMarker(1, 2), deltaMarker(2, 2)]) });
    assert.strictEqual(v.verdict, 'held');
    assert.strictEqual(v.reason, 'integration branch kept moving');
    assert.strictEqual(v.move, 3);
    assert.strictEqual(v.bound, 2);
    assert.match(v.arrivedLog, /upstream\.txt/);
  });
  withFixture((fx) => {
    const tip = originTip(fx);
    pushUpstream(fx);
    const { v } = check(fx, { decisionsText: decisions([step3Line(tip)]), bound: boundOf(0, 'policy') });
    assert.strictEqual(v.verdict, 'held', 'bound 0 holds on the first move');
    assert.strictEqual(v.move, 1);
    assert.strictEqual(v.bound, 0);
    assert.strictEqual(v.source, 'policy');
  });
});

test('bound equal to move is not exceeded', () => {
  withFixture((fx) => {
    const tip = originTip(fx);
    pushUpstream(fx);
    const { v } = check(fx, { decisionsText: decisions([step3Line(tip)]), bound: boundOf(1) });
    assert.strictEqual(v.verdict, 'delta');
    assert.strictEqual(v.move, 1);
    assert.strictEqual(v.bound, 1);
  });
});

test('unreadable lever → failed', () => {
  const cases = [
    ['non-zero exit', { status: 1, stdout: '', stderr: 'boom' }, /^boom$/],
    ['non-zero exit, silent', { status: 3, stdout: '', stderr: '' }, /exited 3/],
    ['not JSON', { status: 0, stdout: 'nope', stderr: '' }, /not JSON/],
    ['entry missing', { status: 0, stdout: '{}', stderr: '' }, /missing from the resolver output/],
    ['invalid: true', boundOf(2, 'policy', { invalid: true }), /invalid value/],
    ['negative', boundOf(-1), /non-negative integer/],
    ['fractional', boundOf(1.5), /non-negative integer/],
  ];
  withFixture((fx) => {
    const tip = originTip(fx);
    pushUpstream(fx);
    for (const [name, bound, detail] of cases) {
      const { v } = check(fx, { decisionsText: decisions([step3Line(tip)]), bound });
      assert.strictEqual(v.verdict, 'failed', name);
      assert.strictEqual(v.reason, 'release-tip-moves unreadable', name);
      assert.strictEqual(v.bound, null, name);
      assert.match(v.detail, detail, name);
    }
  });
});

test('a non-string source is carried as null, not passed through', () => {
  withFixture((fx) => {
    const tip = originTip(fx);
    pushUpstream(fx);
    const { v } = check(fx, { decisionsText: decisions([step3Line(tip)]), bound: boundOf(2, 42) });
    assert.strictEqual(v.verdict, 'delta');
    assert.strictEqual(v.source, null);
  });
});

test('no reviewed tip → failed, and no git call runs', () => {
  const git = () => { throw new Error('git must not run'); };
  const texts = [
    decisions(['- AUTO 09:00:00 — Step 1: preflight read. Reversibility: n/a.']),
    decisions([deltaVerdict('d'.repeat(40))]), // a tip, but no Step 3 marker
    '# Decisions\n',
  ];
  for (const decisionsText of texts) {
    const { v } = check(null, { decisionsText, git });
    assert.strictEqual(v.verdict, 'failed');
    assert.strictEqual(v.reason, 'no reviewed tip recorded');
    assert.match(v.detail, /Step 3 whole-branch-review marker/);
  }
});

test('a malformed delta verdict line → failed before any git call, unless --as exempts the arrived check', () => {
  const short = `- AUTO 10:20:00 — Step 5: delta review base ${'c'.repeat(9)}..main: review: clean. Findings staged at none; at reviewed tip ${'d'.repeat(40)}. Reversibility: n/a (gate evaluation).`;
  const text = decisions([step3Line('a'.repeat(40)), short]);
  const refuse = () => { throw new Error('no git call may run'); };
  const { v } = check(null, { decisionsText: text, git: refuse });
  assert.strictEqual(v.verdict, 'failed');
  assert.strictEqual(v.reason, 'delta verdict line unparseable');
  assert.strictEqual(v.detail, short);
  const exempt = check(null, { decisionsText: text, git: stubGit({ diffStatus: 1 }), asGiven: true });
  assert.notStrictEqual(exempt.v.reason, 'delta verdict line unparseable', '--as never reads the delta, so a malformed line is not its concern');
});

test('fetch failure → failed with stderr', () => {
  withFixture((fx) => {
    const tip = originTip(fx);
    fx.run(fx.work, ['remote', 'set-url', 'origin', path.join(fx.root, 'missing.git')]);
    const { v } = check(fx, { decisionsText: decisions([step3Line(tip)]) });
    assert.strictEqual(v.verdict, 'failed');
    assert.strictEqual(v.reason, 'fetch failed');
    assert.ok(typeof v.detail === 'string' && v.detail.trim() !== '', 'git stderr must be carried verbatim');
  });
});

// `other` pushes a commit with `msg`, which `work` fetches; returns the new tip.
function pushArrived(fx, name, msg) {
  const before = originTip(fx);
  commitMsg(fx, fx.other, name, msg);
  fx.run(fx.other, ['push', '-q', 'origin', BRANCH]);
  fx.run(fx.work, ['fetch', '-q', 'origin']);
  const tip = originTip(fx);
  assert.notStrictEqual(tip, before);
  return tip;
}

// Step 3 reviewed `base`; a delta then reviewed a commit `other` pushed with
// `msg`, which `work` has fetched.
function arrivedAfterDelta(fx, msg) {
  const base = originTip(fx);
  const arrivedTip = pushArrived(fx, 'arrived.txt', msg);
  return {
    base, arrivedTip,
    decisionsText: decisions([step3Line(base), deltaMarker(1, 2), deltaVerdict(arrivedTip, base)]),
  };
}

test('arrived major is reported, not a held verdict', () => {
  withFixture((fx) => {
    const { base, arrivedTip, decisionsText } = arrivedAfterDelta(fx, 'feat!: y');
    const { v } = check(fx, { decisionsText });
    assert.strictEqual(v.verdict, 'merge', 'origin is unmoved since the delta: the comparison still runs');
    assert.strictEqual(v.reason, null);
    assert.strictEqual(v.arrived.part, 'major');
    assert.strictEqual(v.arrived.base, base);
    assert.strictEqual(v.arrived.tip, arrivedTip);
    assert.strictEqual(v.arrived.shas.length, 1);
    assert.strictEqual(v.step3Tip, base);
    assert.strictEqual(v.reviewedTip, arrivedTip);
    assert.strictEqual(v.tipSha, arrivedTip);
  });
});

test('arrived is per-delta: only the last delta\'s range is folded', () => {
  withFixture((fx) => {
    const base = originTip(fx);
    const tip1 = pushArrived(fx, 'a1.txt', 'feat!: y');
    const tip2 = pushArrived(fx, 'a2.txt', 'chore: x');
    const decisionsText = decisions([
      step3Line(base), deltaMarker(1, 2), deltaVerdict(tip1, base), deltaMarker(2, 2), deltaVerdict(tip2, tip1),
    ]);
    const { v } = check(fx, { decisionsText });
    assert.strictEqual(v.verdict, 'merge');
    assert.strictEqual(v.arrived.part, 'none', 'the major accepted at delta 1 is not re-gated');
    assert.strictEqual(v.arrived.base, tip1);
    assert.strictEqual(v.arrived.tip, tip2);
  });
});

test('no delta since Step 3 → arrived null', () => {
  withFixture((fx) => {
    const base = originTip(fx);
    const tip = pushArrived(fx, 'arrived.txt', 'feat!: y');
    // A delta verdict from before this Step 3 review is not a delta of it.
    const { v } = check(fx, { decisionsText: decisions([deltaVerdict(tip, base), step3Line(tip)]) });
    assert.strictEqual(v.verdict, 'merge');
    assert.strictEqual(v.arrived, null);
  });
});

test('asGiven exempts the arrived major', () => {
  withFixture((fx) => {
    const { decisionsText } = arrivedAfterDelta(fx, 'feat!: y');
    const { v } = check(fx, { decisionsText, asGiven: true });
    assert.strictEqual(v.verdict, 'merge');
    assert.strictEqual(v.arrived, null);
  });
});

test('chore-only arrived range is none and does not hold', () => {
  withFixture((fx) => {
    const { decisionsText } = arrivedAfterDelta(fx, 'chore: x');
    const { v } = check(fx, { decisionsText });
    assert.strictEqual(v.verdict, 'merge');
    assert.strictEqual(v.arrived.part, 'none');
  });
});

test('an unresolvable delta base → failed, git error with stderr, before any fetch', () => {
  withFixture((fx) => {
    const tip = originTip(fx);
    const calls = [];
    const inner = runner(fx.work, fx.env);
    const git = (args) => { calls.push(args[0]); return inner(args); };
    const { v } = check(fx, { decisionsText: decisions([step3Line(tip), deltaVerdict(tip, 'e'.repeat(40))]), git });
    assert.strictEqual(v.verdict, 'failed');
    assert.strictEqual(v.reason, 'git error');
    assert.ok(typeof v.detail === 'string' && v.detail.trim() !== '');
    assert.ok(!calls.includes('fetch'), `the arrived read runs before the fetch: ${calls.join(' ')}`);
  });
});

test('a log write that throws → failed, log write failed', () => {
  withFixture((fx) => {
    const tip = originTip(fx);
    pushRunDirUpstream(fx);
    const v = checkReviewedTip(
      { decisionsText: decisions([step3Line(tip)]), branch: BRANCH, asGiven: false, preMajor: false },
      { git: runner(fx.work, fx.env), resolveBound: () => boundOf(2), appendLog: () => { throw new Error('disk full'); } },
    );
    assert.strictEqual(v.verdict, 'failed');
    assert.strictEqual(v.reason, 'log write failed');
    assert.match(v.detail, /disk full/);
  });
});

// A stub origin that moved once, from REVIEWED to MOVED: `diffStatus` picks
// run-dir-only (0) or code (1), and `fail` names the one git command that
// exits 128 with STUB_STDERR.
const REVIEWED = 'a'.repeat(40);
const MOVED = 'b'.repeat(40);
const STUB_STDERR = 'fatal: stub failure 4152\n';
function stubGit({ diffStatus, fail }) {
  return (args) => {
    if (args[0] === fail) return { status: 128, stdout: '', stderr: STUB_STDERR };
    if (args[0] === 'fetch') return { status: 0, stdout: '', stderr: '' };
    if (args[0] === 'rev-parse') return { status: 0, stdout: `${MOVED}\n`, stderr: '' };
    if (args[0] === 'diff') return { status: diffStatus, stdout: '', stderr: '' };
    if (args[0] === 'rev-list') return { status: 0, stdout: '1\n', stderr: '' };
    if (args[0] === 'log') return { status: 0, stdout: 'bbbbbbb upstream.txt\n', stderr: '' };
    throw new Error(`unexpected git ${args.join(' ')}`);
  };
}

for (const [name, stub, bound] of [
  ['rev-parse of origin/<branch> fails', { diffStatus: 1, fail: 'rev-parse' }, boundOf(2)],
  ['diff --quiet exits neither 0 nor 1', { diffStatus: 128, fail: 'diff' }, boundOf(2)],
  ['rev-list --count fails on a run-dir-only advance', { diffStatus: 0, fail: 'rev-list' }, boundOf(2)],
  ['rev-list --count fails on a delta', { diffStatus: 1, fail: 'rev-list' }, boundOf(2)],
  ['git log --first-parent fails on a held move', { diffStatus: 1, fail: 'log' }, boundOf(0)],
]) {
  test(`${name} → failed, git error, stderr verbatim`, () => {
    const { v, logged } = check(null, { decisionsText: decisions([step3Line(REVIEWED)]), git: stubGit(stub), bound });
    assert.strictEqual(v.verdict, 'failed');
    assert.strictEqual(v.reason, 'git error');
    assert.strictEqual(v.detail, STUB_STDERR);
    assert.strictEqual(logged.length, 0, 'nothing is logged on a failed git call');
  });
}

test('non-converging advances → failed', () => {
  const ok = (stdout) => ({ status: 0, stdout, stderr: '' });
  let n = 0;
  const git = (args) => {
    if (args[0] === 'fetch') return ok('');
    if (args[0] === 'rev-parse') { n += 1; return ok(`${n.toString(16).padStart(40, '0')}\n`); }
    if (args[0] === 'diff') return ok('');
    if (args[0] === 'rev-list') return ok('1\n');
    throw new Error(`unexpected git ${args.join(' ')}`);
  };
  const { v, logged } = check(null, { decisionsText: decisions([step3Line('a'.repeat(40))]), git });
  assert.strictEqual(v.verdict, 'failed');
  assert.strictEqual(v.reason, 'run-dir-only advances did not converge');
  assert.strictEqual(logged.length, MAX_ADVANCES);
  assert.strictEqual(v.advanced.length, MAX_ADVANCES);
});
