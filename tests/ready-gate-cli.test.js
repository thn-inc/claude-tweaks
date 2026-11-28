'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runCliSync } = require('./helpers/run-cli');
const { SYMBOLIC_LINE, SYMBOLIC_REF, symbolicBody } = require('./helpers/symbolic-blocker-fixture');

// #6374: bin/ready-gate.js — exit 0 the body may carry `ready`, 1 it must not, 2 malformed invocation.
const BIN = path.join(__dirname, '..', 'plugin', 'bin', 'ready-gate.js');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ready-gate-cli-'));
after(() => fs.rmSync(TMP, { recursive: true, force: true }));

const write = (name, text) => { const f = path.join(TMP, name); fs.writeFileSync(f, text); return f; };

test('a symbolic blocker keeps ready off: exit 1 and the reason', () => {
  const r = runCliSync(BIN, [write('sym.md', symbolicBody())]);
  assert.equal(r.code, 1);
  assert.deepEqual(JSON.parse(r.stdout), { ready: false, reasons: ['symbolic-blocker: ' + SYMBOLIC_REF] });
});

test('a shaped body whose symbolic line moved into ## Original request still keeps ready off: exit 1', () => {
  // Shaping rewrites the authored sections and keeps the sub-issue's original body, line included,
  // only under `## Original request`.
  const shaped = `${symbolicBody().replace(`${SYMBOLIC_LINE}\n`, '')}\n## Original request\n\nSkill steps\n\n- ${SYMBOLIC_LINE}\n`;
  const r = runCliSync(BIN, [write('shaped.md', shaped)]);
  assert.equal(r.code, 1);
  assert.deepEqual(JSON.parse(r.stdout), { ready: false, reasons: ['symbolic-blocker: ' + SYMBOLIC_REF] });
});

test('a rewritten blocker line may carry ready: exit 0', () => {
  const r = runCliSync(BIN, [write('ok.md', symbolicBody().replace(SYMBOLIC_LINE, 'Blocked by thn-inc/other#7004'))]);
  assert.equal(r.code, 0);
  assert.equal(r.stdout.trim(), '{"ready":true,"reasons":[]}');
});

test('no argument and a missing file exit 2', () => {
  assert.equal(runCliSync(BIN, []).code, 2);
  assert.equal(runCliSync(BIN, [path.join(TMP, 'missing.md')]).code, 2);
});

test('a relative path resolves against the injected cwd', () => {
  write('rel.md', symbolicBody());
  const r = runCliSync(BIN, ['rel.md'], { deps: { cwd: () => TMP } });
  assert.equal(r.code, 1);
});

test('realDeps carries every key', () => {
  const { realDeps } = require(BIN);
  for (const k of ['readFile', 'stdout', 'stderr', 'cwd']) assert.equal(typeof realDeps[k], 'function', k);
});
