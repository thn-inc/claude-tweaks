// Acceptance-packet credential screen and local-record upsert linearity budget (#4611) — deliberately NOT part of `npm test`.
//
// Run with: npm run test:perf
//
// packet-links.js screens text and link parts of unbounded length for credential keys. The review fix wave made it split
// camelCase and bracket forms before matching, and every pattern added there must stay linear; packet-post.js's local-files
// upsert used a trailing `[\r\n]+$` that rescanned a long newline run from every start of it (about 6 s at 100k newlines).
// Lives outside tests/ for the same reason the other perf/ files do: a wall-clock assertion flakes under sibling-suite load.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { findCredentialInText, checkLink, hasBearerUrl } = require('../plugin/bin/lib/wrap-up/packet-links');
const { upsertLocalPacket } = require('../plugin/bin/lib/wrap-up/packet-post');

const BUDGET_MS = 2000;
const timed = (run) => {
  const start = performance.now();
  const value = run();
  return { value, ms: performance.now() - start };
};

test('credential screen stays linear on long adversarial input', () => {
  const inputs = [
    'A'.repeat(200000),
    'aB'.repeat(100000),
    'token['.repeat(50000),
    `${'['.repeat(100000)}token=`,
    '1a'.repeat(100000),
    '_'.repeat(200000),
  ];
  const { ms } = timed(() => {
    for (const input of inputs) {
      findCredentialInText(input);
      checkLink(`http://localhost:3000/?${input}`, { allowedHosts: ["localhost"] });
      checkLink(`http://localhost:3000/#${input}`, { allowedHosts: ["localhost"] });
    }
  });
  assert.ok(ms < 10000, `took ${ms.toFixed(0)} ms`);
});

test('the URL-token scan stays linear on long adversarial input (#4612), and keeps its verdict', () => {
  for (const [input, expected] of [
    ['a'.repeat(200000), false],
    ['a.'.repeat(100000), false],
    ['a:'.repeat(100000), false],
    ['a:1 '.repeat(50000), false],
    ['a '.repeat(100000), false],
    [`https://${'/'.repeat(200000)}`, false],
    [`https://h/${')'.repeat(100000)}a`, false],
    ['https://h/a '.repeat(20000), false],
    [`${'https://h/a '.repeat(20000)}https://h/Xk3j9f8s7d6f5g4h3j2k1`, true],
    // A scheme may now start after `-` or `+`, so a dashed word restarts once per dash, each try bounded.
    ['a-'.repeat(100000), false],
    ['a+'.repeat(100000), false],
    ['-'.repeat(200000), false],
    ['+'.repeat(200000), false],
    [`${'a-'.repeat(100000)}https://h/Xk3j9f8s7d6f5g4h3j2k1`, true],
    ['localhost'.repeat(20000), false],
    ['localhost '.repeat(20000), false],
    ['[::1]:'.repeat(30000), false],
    ['[::1]:3000 '.repeat(20000), false],
    [`https://h/a;${';'.repeat(200000)}`, false],
  ]) {
    const { value, ms } = timed(() => hasBearerUrl(input));
    assert.ok(ms < BUDGET_MS, `took ${ms.toFixed(0)} ms`);
    assert.strictEqual(value, expected);
  }
});

test('local record upsert trims a long newline run in linear time', () => {
  for (const eol of ['\n', '\r\n']) {
    const run = eol.repeat(200000);
    const { ms } = timed(() => {
      upsertLocalPacket(`${run}x`, 'PACKET');
      upsertLocalPacket(`x${run}`, 'PACKET');
    });
    assert.ok(ms < BUDGET_MS * 2, `took ${ms.toFixed(0)} ms`);
  }
});
