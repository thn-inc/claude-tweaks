'use strict';

// tools/merge-shard-logs.js: test.yml's `test` job prints the shard jobs' TAP as one suite log with a
// single summary, because verify.js's CI source reads that one job's log and its extractor takes the
// first `# tests`/`# pass`/`# fail` it finds (plugin/bin/lib/verify/extract.js parseCounts).

const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const { splitSummary, mergeParsed, run } = require(path.join(ROOT, 'tools', 'merge-shard-logs.js'));
const { parseCounts, sniffFamily, extractFailingFiles } = require(path.join(ROOT, 'plugin', 'bin', 'lib', 'verify', 'extract.js'));

const summary = (c) => ['tests', 'suites', 'pass', 'fail', 'cancelled', 'skipped', 'todo', 'duration_ms']
  .map((k) => `# ${k} ${c[k]}`).join('\n');
const shardLog = (body, c, plan = c.tests) => `TAP version 13\n${body}\n1..${plan}\n${summary(c)}\n`;
const counts = (tests, pass, fail, extra = {}) => ({ tests, suites: 0, pass, fail, cancelled: 0, skipped: 0, todo: 0, duration_ms: 100, ...extra });

const GREEN_1 = shardLog('# Subtest: a\nok 1 - a\n  ---\n  duration_ms: 1\n  ...', counts(1, 1, 0, { duration_ms: 1200.5 }));
const GREEN_2 = shardLog('# Subtest: b\nok 1 - b\n# Subtest: c\nok 2 - c', counts(2, 2, 0, { skipped: 1, duration_ms: 900 }));
const FAILING_FILE = '/home/runner/work/claude-tweaks/claude-tweaks/tests/broken.test.js';
const RED_3 = shardLog(
  `# Subtest: d\nnot ok 1 - d\n  ---\n  duration_ms: 3\n  location: '${FAILING_FILE}:4:1'\n  failureType: 'testCodeFailure'\n  error: 'boom'\n  ...`,
  counts(1, 0, 1),
);

function capture(argv, files) {
  let out = '';
  let err = '';
  const code = run(argv, {
    readFile: (p) => {
      const name = path.basename(p);
      if (!(name in files)) throw Object.assign(new Error('missing'), { code: 'ENOENT' });
      return files[name];
    },
    stdout: { write: (s) => { out += s; } },
    stderr: { write: (s) => { err += s; } },
  });
  return { code, out, err };
}

test('splitSummary separates the body, the plan and the trailing summary', () => {
  const p = splitSummary(GREEN_2);
  assert.strictEqual(p.plan, 2);
  assert.deepStrictEqual(p.counts, counts(2, 2, 0, { skipped: 1, duration_ms: 900 }));
  assert.ok(p.body.endsWith('ok 2 - c'), p.body);
  assert.doesNotMatch(p.body, /^# tests /m);
});

test('splitSummary reads only the trailing summary, not a test\'s own `# tests` comment', () => {
  const p = splitSummary(shardLog('# tests 99\nok 1 - a', counts(1, 1, 0)));
  assert.strictEqual(p.counts.tests, 1);
  assert.match(p.body, /^# tests 99$/m);
});

test('splitSummary refuses a log with no summary, such as a shard killed mid-run', () => {
  assert.throws(() => splitSummary('TAP version 13\nok 1 - a\n'), /no TAP summary/);
  assert.throws(() => splitSummary(''), /no TAP summary/);
});

test('mergeParsed sums the counts and the plans, and keeps the slowest shard\'s duration', () => {
  const m = mergeParsed([splitSummary(GREEN_1), splitSummary(GREEN_2), splitSummary(RED_3)]);
  assert.deepStrictEqual(m.counts, { tests: 4, suites: 0, pass: 3, fail: 1, cancelled: 0, skipped: 1, todo: 0, duration_ms: 1200.5 });
  assert.match(m.text, /^1\.\.4$/m);
  assert.strictEqual(m.text.match(/^# tests /gm).length, 1, 'one summary only');
});

test('the merged log reads as one run to verify.js: its counts and its failing file', () => {
  const { code, out } = capture(['--expect', '3', '/shards'], { 'shard-1.tap': GREEN_1, 'shard-2.tap': GREEN_2, 'shard-3.tap': RED_3 });
  assert.strictEqual(code, 1, 'a failure in any shard is a red merge');
  const family = sniffFamily(out);
  assert.strictEqual(family, 'tap');
  const c = parseCounts(out, family);
  assert.strictEqual(c.tests, 4);
  assert.strictEqual(c.pass, 3);
  assert.strictEqual(c.fail, 1);
  const root = '/home/runner/work/claude-tweaks/claude-tweaks';
  assert.deepStrictEqual(extractFailingFiles(out, family, { cwd: root, exists: () => true }), ['tests/broken.test.js']);
});

test('an all-green merge exits 0', () => {
  assert.strictEqual(capture(['--expect', '2', '/s'], { 'shard-1.tap': GREEN_1, 'shard-2.tap': GREEN_2 }).code, 0);
});

test('a missing or unparseable shard exits 2 and says, before the summary, that the counts are partial', () => {
  const r = capture(['--expect', '3', '/s'], { 'shard-1.tap': GREEN_1, 'shard-3.tap': 'ok 1 - cut off\n' });
  assert.strictEqual(r.code, 2);
  assert.match(r.err, /shard 2\/3: .*shard-2\.tap could not be read \(ENOENT\)/);
  assert.match(r.err, /shard 3\/3: .*shard-3\.tap has no TAP summary/);
  const lines = r.out.trim().split('\n');
  const note = lines.findIndex((l) => l.startsWith('# merge-shard-logs: shard 2/3'));
  assert.ok(note !== -1 && note < lines.indexOf('# tests 1'), r.out);
  assert.match(r.out, /cover 1 of 3 shards/);
});

test('a cancelled test is a red merge too', () => {
  const cancelled = shardLog('not ok 1 - slow # cancelled', counts(1, 0, 0, { cancelled: 1 }));
  assert.strictEqual(capture(['--expect', '1', '/s'], { 'shard-1.tap': cancelled }).code, 1);
});

test('bad usage exits 2', () => {
  for (const argv of [[], ['--expect', '0', '/s'], ['--expect', 'x', '/s'], ['/s']]) {
    assert.strictEqual(capture(argv, {}).code, 2, JSON.stringify(argv));
  }
});
