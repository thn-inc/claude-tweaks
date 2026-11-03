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
const { findCredentialInText, checkLink } = require('../plugin/bin/lib/wrap-up/packet-links');
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
