'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { makeCmdStatus } = require('../../../plugin/bin/lib/health-core/remembered-status');

function captureStdout(fn) {
  const orig = process.stdout.write;
  let out = '';
  process.stdout.write = (chunk) => { out += chunk; return true; };
  try { fn(); } finally { process.stdout.write = orig; }
  return out;
}

test('cmdStatus prints the remembered count from readDurableState', () => {
  const readDurableState = (root) => {
    assert.strictEqual(root, '/some/root');
    return { remembered: { a: {}, b: {}, c: {} } };
  };
  const cmdStatus = makeCmdStatus({ readDurableState });
  const out = captureStdout(() => cmdStatus({ root: '/some/root' }));
  assert.strictEqual(out, 'remembered:3\n');
});

test('cmdStatus writes through an injected io, defaults root to io.cwd(), and returns 0', () => {
  const roots = [];
  let out = '';
  const cmdStatus = makeCmdStatus({
    readDurableState: (r) => { roots.push(r); return { remembered: { a: {} } }; },
    io: { stdout: (t) => { out += t; }, stderr: () => {}, cwd: () => '/injected/cwd' },
  });
  assert.strictEqual(cmdStatus({}), 0);
  assert.deepStrictEqual(roots, ['/injected/cwd']);
  assert.strictEqual(out, 'remembered:1\n');
});

test('cmdStatus prints 0 when remembered is empty', () => {
  const readDurableState = () => ({ remembered: {} });
  const cmdStatus = makeCmdStatus({ readDurableState });
  const out = captureStdout(() => cmdStatus({}));
  assert.strictEqual(out, 'remembered:0\n');
});

test('cmdStatus defaults root to process.cwd() when omitted', () => {
  let seenRoot;
  const readDurableState = (root) => { seenRoot = root; return { remembered: {} }; };
  const cmdStatus = makeCmdStatus({ readDurableState });
  captureStdout(() => cmdStatus({}));
  assert.strictEqual(seenRoot, process.cwd());
});
