'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { replay, RULE_SINCE, chainLength, pluginVersion, defaultDeps } = require('../../tools/guard-refusals/replay');
const { RULE_IDS } = require('../../plugin/bin/lib/hooks/guard-rewrite');

let n = 0;
function row(over) {
  return {
    toolUseId: `t${++n}`, file: '/p/s1.jsonl', tool: 'Bash', guard: 'harness-command', command: 'cat f',
    truncated: false, reason: 'too-complex', effect: 'read', readClass: 'shape',
    ts: '2026-11-01T00:00:00Z', cwd: '/wt', ...over,
  };
}
const dispOf = (res, r) => res.dispositions.rows.find((x) => x.toolUseId === r.toolUseId);
const emptyScan = { gitTargets: () => [], fileWriteTargets: () => [], mkdirTargets: () => [] };

test('AC1: plugin read row is still-denied or no-longer-denied by the scanner', () => {
  const r = row({ guard: 'plugin:worktree', command: 'git log', readClass: null });
  const denied = replay([r], { scanner: { ...emptyScan, gitTargets: () => [{ action: 'commit', dir: '/wt' }] } });
  assert.equal(dispOf(denied, r).disposition, 'still-denied');
  assert.equal(denied.dispositions.plugin['still-denied'], 1);
  const clear = replay([r], { scanner: emptyScan });
  assert.equal(dispOf(clear, r).disposition, 'no-longer-denied');
});

test('AC2: harness dispositions with the default deps', () => {
  const rows = [
    row({ command: 'ls /a\\ b/c' }),
    row({ command: 'grep -n "source" f.md' }),
    row({ command: 'cat f', reason: 'git-redirect-shared', readClass: 'other-checkout' }),
    row({ command: 'cat f' }),
    row({ command: 'cat a && cat b && cat c && cat d && cat e' }),
  ];
  const res = replay(rows);
  assert.deepEqual(rows.map((r) => dispOf(res, r).disposition),
    ['rewritten', 'refused-shape', 'other-checkout', 'unexplained', 'long-chain']);
  assert.equal(dispOf(res, rows[1]).detector, 'source-token');
  assert.deepEqual(res.dispositions.refusedShapeById, { 'source-token': 1 });
});

test('AC3: a quote-only rewrite moves no write target; a dropped cd does', () => {
  const same = replay([row({ command: 'ls /wt/a\\ b' })]);
  assert.equal(same.writeTargetsMoved, 0);
  assert.equal(same.writeTargetsChecked, 1);
  const moved = replay([row({ command: 'cd /other && git commit -m x', effect: 'write' })], {
    rewrite: () => ({ command: 'git commit -m x', applied: ['drop-redundant-cd'] }),
  });
  assert.equal(moved.writeTargetsMoved, 1);
  assert.equal(moved.writeTargetsChecked, 1);
});

const CACHE = '/Users/x/.claude/plugins/cache/m/claude-tweaks/6.160.0/bin/x.js';
test('AC4: ruleNotApplied counts a released rule after its release day, by version and agent kind', () => {
  const base = { command: `ls /a\\ b/c ${CACHE}` };
  const res = replay([row(base)]);
  assert.equal(res.ruleNotApplied.total, 1);
  assert.equal(res.ruleNotApplied.byRule['quote-escaped-space'].byVersion['6.160.0'].main, 1);
  const before = replay([row({ ...base, ts: '2026-10-20T00:00:00Z' })]);
  assert.equal(before.ruleNotApplied.total, 0);
  const sameDay = replay([row({ ...base, ts: '2026-10-25T23:00:00Z' })]);
  assert.equal(sameDay.ruleNotApplied.total, 0);
  const sub = replay([row({ ...base, file: '/p/s1/subagents/a.jsonl' })]);
  assert.equal(sub.ruleNotApplied.byRule['quote-escaped-space'].byVersion['6.160.0'].subagent, 1);
  const unreleased = replay([row({ command: 'git -C /wt log -- /a\\ b' })]);
  assert.equal(unreleased.ruleNotApplied.total, 0);
});

test('rows without cwd or truncated are never rewritten', () => {
  const always = { rewrite: () => ({ command: 'cat f', applied: ['quote-escaped-space'] }) };
  const rows = [
    row({ command: 'ls /a\\ b', cwd: undefined }),
    row({ command: 'ls /a\\ b', cwd: 'rel/dir' }),
    row({ command: 'ls /a\\ b', truncated: true, effect: 'unknown' }),
    row({ guard: 'plugin:worktree', command: 'git log', truncated: true }),
    row({ guard: 'plugin:worktree', command: 'git log', cwd: 'rel' }),
  ];
  const res = replay(rows, { ...always, scanner: emptyScan });
  assert.equal(res.dispositions.harness.rewritten, 0);
  assert.equal(res.writeTargetsChecked, 0);
  assert.equal(res.writeTargetsMoved, 0);
  assert.equal(res.ruleNotApplied.total, 0);
  assert.equal(dispOf(res, rows[3]).disposition, 'scanner-failed');
  assert.equal(dispOf(res, rows[4]).disposition, 'no-longer-denied');
});

test('ruleNotApplied splits main and subagent', () => {
  const cmd = `ls /a\\ b/c ${CACHE}`;
  const main = row({ command: cmd });
  const sub = row({ command: cmd, file: '/p/s1/subagents/agent-1.jsonl' });
  const res = replay([main, sub]);
  assert.deepEqual(res.ruleNotApplied.byRule['quote-escaped-space'].byVersion['6.160.0'], { main: 1, subagent: 1 });
  assert.equal(res.ruleNotApplied.total, 2);
  assert.equal(dispOf(res, main).disposition, 'rewritten');
  assert.equal(dispOf(res, sub).disposition, 'rewritten');
});

test('git-C-own needs an unquoted git word; file-less rows are separate sessions; a bad pattern is reported', () => {
  const res = replay([
    row({ command: 'echo "git -C . log"' }),
    row({ command: 'my-git -C . log' }),
    row({ command: './git -C . log' }),
    row({ command: 'git -C . log', file: undefined }),
    row({ command: `node ${CACHE}`, file: undefined }),
  ]);
  assert.equal(res.byClass['git-C-own'].total, 1);
  assert.equal(res.byClass['git-C-own'].unknownVersion, 1);
  const bad = replay([row({ command: 'cat f' })], { patterns: [{ id: 'bad', pattern: '(' }, { id: 'ok', pattern: 'cat' }] });
  assert.deepEqual(bad.byPattern, { bad: { error: 'invalid pattern' }, ok: { count: 1, rewritten: 0 } });
});

test('a throwing scanner does not abort the replay', () => {
  const p = row({ guard: 'plugin:worktree', command: 'git log' });
  const h = row({ command: 'ls /a\\ b' });
  const res = replay([p, h], {
    scanner: { ...emptyScan, gitTargets: () => { throw new Error('x'); } },
    rewrite: () => { throw new Error('y'); },
  });
  assert.equal(dispOf(res, p).disposition, 'scanner-failed');
  assert.equal(dispOf(res, h).disposition, 'unexplained');
  assert.equal(res.writeTargetsChecked, 0);
});

test('byClass keys by session version: a cache path elsewhere in the file, else unknownVersion', () => {
  const shared = [row({ command: `git -C . log` }), row({ command: `node ${CACHE}` })];
  const res = replay(shared);
  assert.equal(res.byClass['git-C-own'].total, 1);
  assert.equal(res.byClass['git-C-own'].byVersion['6.160.0'], 1);
  const alone = replay([row({ command: 'git -C . log', file: '/p/other.jsonl' })]);
  assert.equal(alone.byClass['git-C-own'].unknownVersion, 1);
});

test('byClass hits each class; git-C-own takes the row cwd and ignores a longer sibling path', () => {
  const rows = [
    row({ command: 'git -C "/wt/" log' }),
    row({ command: 'git -C /wt/sub log' }),
    row({ command: 'echo $?' }),
    row({ command: "echo '$?'" }),
    row({ command: 'node node-eval-file.js remote-branch-collision', effect: 'write' }),
  ];
  const { byClass } = replay(rows);
  assert.equal(byClass['git-C-own'].total, 1);
  assert.equal(byClass['exit-status'].total, 1);
  assert.equal(byClass['collision-fence'].total, 1);
});

test('byPattern counts matches and the rows a rule changes; null without patterns', () => {
  const rows = [row({ command: 'ls /a\\ b' }), row({ command: 'ls /c\\ d' }), row({ command: 'cat f' })];
  const res = replay(rows, { patterns: [{ id: 'esc', pattern: 'ls /' }] });
  assert.deepEqual(res.byPattern, { esc: { count: 2, rewritten: 2 } });
  assert.equal(replay(rows).byPattern, null);
});

function setsMatch(map, ids) {
  return JSON.stringify(Object.keys(map).sort()) === JSON.stringify([...ids].sort());
}
test('AC11: RULE_SINCE names exactly the rewriter rules', () => {
  assert.ok(setsMatch(RULE_SINCE, RULE_IDS));
  const { 'quote-exit-status': _drop, ...short } = RULE_SINCE;
  assert.ok(!setsMatch(short, RULE_IDS));
});

test('chainLength counts top-level simple commands', () => {
  assert.equal(chainLength('a | b'), 2);
  assert.equal(chainLength('a && b; c || d'), 4);
  assert.equal(chainLength('echo "a;b"'), 1);
  assert.equal(chainLength('x=$(a; b)'), 1);
  assert.equal(chainLength('cat <<EOF\na; b\nc && d\nEOF\necho x'), 2);
  assert.equal(chainLength('a 2>&1 | b'), 2);
});

test('pluginVersion reads the cache version, else unknown', () => {
  assert.equal(pluginVersion(CACHE), '6.160.0');
  assert.equal(pluginVersion('ls'), 'unknown');
});

test('writeTargetsLost counts rows where a before-target is missing after; a gained target is moved, not lost', () => {
  const lost = replay([row({ command: 'cd /other && git commit -m x', effect: 'write' })], {
    rewrite: () => ({ command: 'git commit -m x', applied: ['drop-redundant-cd'] }),
  });
  assert.equal(lost.writeTargetsMoved, 1);
  assert.equal(lost.writeTargetsLost, 1);
  const gain = replay([row({ command: 'a' })], {
    rewrite: () => ({ command: 'b', applied: ['drop-redundant-cd'] }),
    scanner: { ...emptyScan, gitTargets: (c) => (c === 'b' ? [{ action: 'commit', dir: '/wt' }] : []) },
  });
  assert.equal(gain.writeTargetsMoved, 1);
  assert.equal(gain.writeTargetsLost, 0);
  const same = replay([row({ command: 'ls /wt/a\\ b' })]);
  assert.equal(same.writeTargetsLost, 0);
});

test('unexplainedByReason counts unexplained harness reads by reason, null as none', () => {
  const res = replay([
    row({ command: 'cat f', reason: 'runs-complete' }),
    row({ command: 'cat g', reason: 'runs-complete' }),
    row({ command: 'cat h', reason: null }),
    row({ command: 'ls /a\\ b/c', reason: 'too-complex' }),
  ]);
  assert.equal(res.dispositions.harness.unexplained, 3);
  assert.deepEqual(res.dispositions.unexplainedByReason, { 'runs-complete': 2, none: 1 });
});

test('ruleNotApplied counts only harness-command rows', () => {
  const res = replay([row({ guard: 'plugin:worktree-always', command: `ls /a\\ b/c ${CACHE}` })], { scanner: emptyScan });
  assert.equal(res.ruleNotApplied.total, 0);
  assert.deepEqual(res.ruleNotApplied.byRule, {});
});

test('a plugin read row is still-denied only for a GATE_COVERAGE git action', () => {
  const r = row({ guard: 'plugin:worktree', command: 'git log', readClass: null });
  const res = replay([r], { scanner: { ...emptyScan, gitTargets: () => [{ action: 'not-a-gate-action', dir: '/wt' }] } });
  assert.equal(dispOf(res, r).disposition, 'no-longer-denied');
});

test('a plugin read row with a relative cwd is scanned from /', () => {
  const seen = [];
  const rec = (c, cwd) => { seen.push(cwd); return []; };
  replay([row({ guard: 'plugin:worktree', command: 'git log', cwd: 'wt/rel', readClass: null })], {
    scanner: { gitTargets: rec, fileWriteTargets: rec, mkdirTargets: rec },
  });
  assert.deepEqual(seen, ['/', '/', '/']);
});

test('defaultDeps wires the real rewrite, scanner and detector', () => {
  const d = defaultDeps();
  assert.equal(typeof d.rewrite, 'function');
  assert.deepEqual(Object.keys(d.scanner).sort(), ['fileWriteTargets', 'gitTargets', 'mkdirTargets']);
  assert.deepEqual(d.detect('cat f'), []);
});
