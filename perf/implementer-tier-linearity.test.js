// Implementer-tier keyFileCount linearity budget (#5996) — deliberately NOT part of `npm test`.
//
// Run with: npm run test:perf
//
// keyFileCount runs a brace-list test over every Key Files entry of a record body, which no caller bounds. The first
// regex, /\{[^}]*,[^}]*\}/, backtracked super-linearly on a token with no closing brace (`{` + 60000 commas about
// 1.7 s, `{,` x 2000 about 2.7 s). The fix, /\{[^{},]*,[^{}]*\}/, is linear. Lives outside tests/ because a
// wall-clock assertion flakes under sibling-suite load.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { keyFileCount } = require('../plugin/bin/lib/model-profiles/implementer-tier');

const BUDGET_MS = 750;
const body = (entry) => `# T\n\n### Key Files\n\n- \`${entry}\`\n`;

for (const [label, entry, expected] of [
  ['a "{," run repeated 5000 times with no closing brace', '{,'.repeat(5000), 1],
  ['a "{" followed by 60000 commas with no closing brace', `{${','.repeat(60000)}`, 1],
  ['a "{" followed by 60000 commas and a closing brace', `a/{${','.repeat(60000)}}/x`, 3],
]) {
  test(`keyFileCount: ${label} stays linear`, () => {
    const start = performance.now();
    const value = keyFileCount(body(entry));
    const ms = performance.now() - start;
    assert.strictEqual(value, expected);
    assert.ok(ms < BUDGET_MS, `took ${ms.toFixed(0)} ms`);
  });
}
