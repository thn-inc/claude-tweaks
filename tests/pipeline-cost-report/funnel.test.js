// tests/pipeline-cost-report/funnel.test.js
//
// #5914: tools/pipeline-cost-report/funnel.js tallies the driver's admission refusals over the open ready
// auto:build records. Fakes only — never spawns drive.js or gh.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const { reasonKey, collectFunnel, readPluginVersion } = require(path.join(ROOT, 'tools', 'pipeline-cost-report', 'funnel.js'));

const NOW = () => new Date('2026-11-19T10:00:00Z');
const gh = (count) => () => JSON.stringify(Array.from({ length: count }, (_, i) => ({ number: i + 1 })));
const verdict = (admitted, reasons = []) => JSON.stringify({ record: 0, admitted, reasons });
const deps = (verdicts) => ({
  gh: gh(verdicts.length),
  check: async (n) => {
    const v = verdicts[n - 1];
    if (v instanceof Error) throw v;
    return v;
  },
  now: NOW,
  pluginVersion: '1.2.3',
});
const run = (verdicts, simulate = []) => collectFunnel({ repo: 'o/r', simulate }, deps(verdicts));

test('reasonKey cuts only the heads that embed a value', () => {
  assert.strictEqual(reasonKey('protected path: a/b.js'), 'protected path');
  assert.strictEqual(reasonKey('merge-sensitive path: x'), 'merge-sensitive path');
  assert.strictEqual(reasonKey('typed command not accepted: launcher, x'), 'typed command not accepted');
  assert.strictEqual(reasonKey('size ceiling unreadable: ??'), 'size ceiling unreadable');
  assert.strictEqual(reasonKey('Key File limit unreadable: ??'), 'Key File limit unreadable');
  assert.strictEqual(reasonKey('express-driver value not recognised: foo'), 'express-driver value not recognised');
  assert.strictEqual(reasonKey('express-driver split: issue number is odd'), 'express-driver split: issue number is odd');
  assert.strictEqual(reasonKey('size is not low'), 'size is not low');
});

test('AC5.1: funnel prints the admitted count', async () => {
  const f = await run([verdict(true), verdict(true), verdict(false, ['size is not low']), verdict(false, ['size is not low']), verdict(false, ['size is not low'])]);
  assert.strictEqual(f.admitted, 2);
  assert.strictEqual(f.checked, 5);
  assert.strictEqual(f.runDate, '2026-11-19');
  assert.strictEqual(f.pluginVersion, '1.2.3');
});

test('AC5.2: one row per distinct refusal reason', async () => {
  const f = await run([verdict(false, ['size is not low', 'protected path: a/b.js']), verdict(false, ['protected path: c/d.js'])]);
  assert.deepStrictEqual(f.reasons, { 'size is not low': 1, 'protected path': 2 });
});

test('a record counts once per key even when a key repeats', async () => {
  const f = await run([verdict(false, ['protected path: a', 'protected path: b'])]);
  assert.deepStrictEqual(f.reasons, { 'protected path': 1 });
});

test('AC5.3: a named set admits every record whose every reason is in the set', async () => {
  const f = await run(
    [verdict(true), verdict(true), verdict(false, ['size is not low', 'protected path: a']), verdict(false, ['protected path: b']), verdict(false, ['size is not low', 'record lacks auto:build'])],
    [['size is not low', 'protected path']],
  );
  assert.deepStrictEqual(f.simulations, [{ set: ['size is not low', 'protected path'], admitted: 4 }]);
});

test('default simulations: one per distinct reason taken alone', async () => {
  const f = await run([verdict(true), verdict(false, ['a']), verdict(false, ['a', 'b']), verdict(false, ['b'])]);
  assert.deepStrictEqual(f.simulations, [{ set: ['a'], admitted: 2 }, { set: ['b'], admitted: 2 }]);
});

test('simulate names go through reasonKey', async () => {
  const f = await run([verdict(false, ['protected path: a/b.js'])], [['protected path: x']]);
  assert.deepStrictEqual(f.simulations, [{ set: ['protected path'], admitted: 1 }]);
});

test('a refused record with no reasons is never admitted by a set', async () => {
  const f = await run([verdict(false, [])], [['x']]);
  assert.strictEqual(f.simulations[0].admitted, 0);
});

test('unreadable: a check that throws, times out, or prints no admitted/reasons is unreadable', async () => {
  const timeout = Object.assign(new Error('spawn timed out'), { killed: true, signal: 'SIGTERM' });
  const f = await run([new Error('boom'), timeout, 'not json', '{"record":4}', verdict(true), verdict(false, ['a'])]);
  assert.strictEqual(f.unreadable, 4);
  assert.strictEqual(f.checked, 6);
  assert.strictEqual(f.admitted, 1);
  assert.deepStrictEqual(f.reasons, { a: 1 });
});

test('the verdict is the last non-empty stdout line', async () => {
  const f = await run(['warming up\n' + verdict(true) + '\n\n']);
  assert.strictEqual(f.admitted, 1);
});

test('at most 4 checks run at once, and all records are checked', async () => {
  let pending = 0;
  let peak = 0;
  const seen = [];
  const f = await collectFunnel({ repo: 'o/r', simulate: [] }, {
    gh: gh(12),
    check: async (n) => {
      pending++;
      peak = Math.max(peak, pending);
      seen.push(n);
      await new Promise((r) => setTimeout(r, 5));
      pending--;
      return verdict(true);
    },
    now: NOW,
    pluginVersion: 'v',
  });
  assert.strictEqual(peak, 4);
  assert.strictEqual(seen.length, 12);
  assert.strictEqual(f.admitted, 12);
});

test('gh is called with the list argv for the repo', async () => {
  let argv;
  await collectFunnel({ repo: 'o/r', simulate: [] }, { gh: (a) => { argv = a; return '[]'; }, check: async () => verdict(true), now: NOW, pluginVersion: 'v' });
  assert.deepStrictEqual(argv, ['issue', 'list', '--repo', 'o/r', '--state', 'open', '--label', 'ready', '--label', 'auto:build', '--limit', '1000', '--json', 'number']);
});

test('readPluginVersion reads .claude-plugin/plugin.json', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pcr-fn-'));
  try {
    fs.mkdirSync(path.join(dir, '.claude-plugin'));
    fs.writeFileSync(path.join(dir, '.claude-plugin', 'plugin.json'), '{"version":"9.9.9"}');
    assert.strictEqual(readPluginVersion(dir), '9.9.9');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
