// `parseLensReply` linearity budget (#5598) — deliberately NOT part of `npm test`.
//
// Run with: npm run test:perf
//
// A lens reply is untrusted text of unbounded length: a runaway reviewer can return several hundred kilobytes.
// Each table row is cut by one forward scan, so a long run of the characters the scan treats specially (backticks,
// pipes, escaped pipes) or of what the line regexes accept must stay linear, and so must many short rows. Lives
// outside tests/ for the reason the other perf/ files do: a wall-clock assertion flakes under sibling-suite load
// (tests/wall-clock-budget-conformance.test.js). The verdict is asserted next to every clock.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { parseLensReply } = require('../plugin/bin/lib/lens-reply');

const BUDGET_MS = 250;
const N = 200000;

const CASES = [
  ['a 200k-backtick row', `| high | a.js:1 | ${'`'.repeat(N)}`, (got) => {
    assert.equal(got.findings.length, 1);
    assert.equal(got.findings[0].text, '`'.repeat(N));
  }],
  ['a 200k-pipe row', `| high | a.js:1 | ${'|'.repeat(N)}`, (got) => {
    assert.equal(got.findings.length, 1);
    assert.equal(got.findings[0].text, '');
  }],
  ['a 200k escaped-pipe run', `| high | a.js:1 | ${'\\|'.repeat(N)}`, (got) => {
    assert.equal(got.findings.length, 1);
    assert.equal(got.findings[0].text, '|'.repeat(N));
  }],
  ['200k spaces before No findings text with no match', `${' '.repeat(N)}No findings`, (got) => {
    assert.equal(got.parse, 'unparseable');
    assert.equal(got.noFindings, false);
  }],
  ['an overflow line with long space runs and no "more"', `+${' '.repeat(N)}1${' '.repeat(N)}x`, (got) => {
    assert.equal(got.overflow, 0);
    assert.equal(got.parse, 'unparseable');
  }],
  ['a lenient status prefix with a long space run and no word', `-${' '.repeat(N)}x`, (got) => {
    assert.equal(got.status, 'missing');
  }],
  ['40000 table rows', '| high | a.js:1 | x | y |\n'.repeat(40000), (got) => {
    assert.equal(got.findings.length, 40000);
    assert.equal(got.parse, 'ok');
  }],
];

for (const [label, reply, check] of CASES) {
  test(`parseLensReply reads ${label} in linear time`, () => {
    const start = performance.now();
    const got = parseLensReply(reply);
    const ms = performance.now() - start;
    check(got);
    assert.ok(ms < BUDGET_MS, `${label}: ${reply.length} chars took ${ms.toFixed(1)} ms (budget ${BUDGET_MS} ms)`);
  });
}
