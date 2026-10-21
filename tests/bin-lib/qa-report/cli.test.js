'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { run, parseArgs } = require('../../../plugin/bin/qa-report');
const { composeQaStamp } = require('../../../plugin/bin/lib/verify/qa-stamp');

const created = [];
test.after(() => { for (const d of created) fs.rmSync(d, { recursive: true, force: true }); });

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-qa-report-cli-'));
  created.push(dir);
  return { dir, out: path.join(dir, 'report.json') };
}
function deps() {
  const out = []; const err = [];
  return {
    out, err, d: { now: () => '2026-10-20T00:00:00.000Z', stdout: (s) => out.push(s), stderr: (s) => err.push(s) },
  };
}
function writeResults(fx, payload) {
  const p = path.join(fx.dir, 'story-results.json');
  fs.writeFileSync(p, typeof payload === 'string' ? payload : JSON.stringify(payload));
  return p;
}
const story = (id, status, extra = {}) => ({
  id, source_file: 'app.yaml', status, ...extra,
});

test('writes report.json whose summary agrees with its stories array', () => {
  const fx = fixture();
  const p = writeResults(fx, {
    stories: [story('s1', 'PASS'), story('s2', 'PASS_WITH_CAVEATS', { caveats: ['slow'] }),
      story('s3', 'FAIL', { error: 'assertion failed' }), story('s4', 'SKIPPED')],
  });
  const t = deps();
  assert.equal(run(['--results', p, '--out', fx.out], t.d), 0);
  const report = JSON.parse(fs.readFileSync(fx.out, 'utf8'));
  const n = (...st) => report.stories.filter((s) => st.includes(s.status)).length;
  assert.equal(report.summary.total, report.stories.length);
  assert.equal(report.summary.passed, n('PASS', 'PASS_WITH_CAVEATS'));
  assert.equal(report.summary.pass_with_caveats, n('PASS_WITH_CAVEATS'));
  assert.equal(report.summary.failed, n('FAIL'));
  assert.equal(report.summary.skipped, n('SKIPPED'));
  const line = JSON.parse(t.out.join(''));
  assert.equal(line.written, true);
  assert.equal(line.path, path.resolve(fx.out));
  assert.deepEqual(line.summary, report.summary);
});

test('qa-stamp accepts the written report', () => {
  const fx = fixture();
  const p = writeResults(fx, { stories: [story('s1', 'PASS'), story('s2', 'PASS')] });
  assert.equal(run(['--results', p, '--out', fx.out], deps().d), 0);
  const report = JSON.parse(fs.readFileSync(fx.out, 'utf8'));
  const res = composeQaStamp({
    report, head: 'c'.repeat(40), dirty: false, storyHashes: { 'app.yaml': 'a'.repeat(64) }, storiesDir: 'stories', reportPath: fx.out, at: 'x',
  });
  assert.equal(res.error, undefined);
  assert.ok(res.stamp);
});

test('payload errors exit 1 and create no out file', () => {
  const cases = [
    ['null', 'null', 'input-not-object'],
    ['array', '[]', 'input-not-object'],
    ['unparseable', 'not json{', 'results-unparseable'],
    ['unparseable names the parser reason', 'not json{', 'JSON'],
    ['lowercase status', JSON.stringify({ stories: [story('s1', 'pass')] }), 'invalid-status: s1 pass'],
  ];
  for (const [label, text, expected] of cases) {
    const fx = fixture();
    const t = deps();
    assert.equal(run(['--results', writeResults(fx, text), '--out', fx.out], t.d), 1, label);
    const msg = t.err.join('');
    assert.ok(msg.startsWith('qa-report.js: '), label);
    assert.ok(msg.includes(expected), `${label}: ${msg}`);
    assert.equal(fs.existsSync(fx.out), false, label);
  }
  const fx = fixture();
  const t = deps();
  assert.equal(run(['--results', path.join(fx.dir, 'nope.json'), '--out', fx.out], t.d), 1);
  assert.ok(t.err.join('').includes('results-unreadable'));
  assert.equal(fs.existsSync(fx.out), false);
});

test('malformed invocation exits 2 with usage', () => {
  const fx = fixture();
  const p = writeResults(fx, { stories: [] });
  const cases = [[], ['--results', p], ['--results', p, '--out'], ['--out', ''], ['--results', p, '--out', '--results'], ['--bogus'],
    ['--results', p, '--results', p, '--out', 'o'], ['--results', p, '--out', 'a', '--out', 'b']];
  for (const argv of cases) {
    const t = deps();
    assert.equal(run(argv, t.d), 2, JSON.stringify(argv));
    assert.ok(t.err.join('').includes('usage:'), JSON.stringify(argv));
  }
  assert.deepEqual(parseArgs(['--results', 'a', '--out', 'b']), { results: 'a', out: 'b' });
});

test('a throwing dependency exits 1 as compose-failed and writes nothing', () => {
  const fx = fixture();
  const p = writeResults(fx, { stories: [story('s1', 'PASS')] });
  const t = deps();
  t.d.now = () => { throw new Error('clock exploded'); };
  assert.equal(run(['--results', p, '--out', fx.out], t.d), 1);
  const msg = t.err.join('');
  assert.ok(msg.includes('compose-failed') && msg.includes('clock exploded'), msg);
  assert.equal(fs.existsSync(fx.out), false);
});

test('write failure exits 3 naming the path', () => {
  const fx = fixture();
  const p = writeResults(fx, { stories: [story('s1', 'PASS')] });
  const bad = path.join(fx.dir, 'missing-dir', 'report.json');
  const t = deps();
  assert.equal(run(['--results', p, '--out', bad], t.d), 3);
  assert.ok(t.err.join('').includes(bad));
});
