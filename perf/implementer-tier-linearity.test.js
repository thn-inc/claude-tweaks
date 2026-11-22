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
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { keyFileCount } = require('../plugin/bin/lib/model-profiles/implementer-tier');
const { run } = require('../plugin/bin/implementer-tier');

const BUDGET_MS = 750;
const body = (entry) => `# T\n\n### Key Files\n\n- \`${entry}\`\n`;

for (const [label, entry, expected] of [
  ['a "{," run repeated 5000 times with no closing brace', '{,'.repeat(5000), 1],
  ['a "{" followed by 60000 commas with no closing brace', `{${','.repeat(60000)}`, 1],
  ['verdict stability: a closed brace list of 60000 commas', `a/{${','.repeat(60000)}}/x`, 3],
]) {
  test(`keyFileCount: ${label} stays linear`, () => {
    const start = performance.now();
    const value = keyFileCount(body(entry));
    const ms = performance.now() - start;
    assert.strictEqual(value, expected);
    assert.ok(ms < BUDGET_MS, `took ${ms.toFixed(0)} ms`);
  });
}

// The spec-header read matched `^size:\s*(.*?)\s*$`, quadratic on a value of `a`, a long whitespace run, then `b`
// (40000 spaces about 1.0 to 1.2 s end to end, so the case uses 80000 for margin). Header matching is now a prefix test plus trim.
test('implementer-tier CLI: a header value with a 80000-space run inside stays linear', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'impl-tier-perf-'));
  try {
    const file = path.join(dir, 'spec.md');
    fs.writeFileSync(file, `size: a${' '.repeat(80000)}b\n\n# T\n`);
    const err = [];
    const start = performance.now();
    const code = run(['--spec-file', file, '--rule', 'lane'], { stderr: (m) => err.push(m), stdout: () => {}, cwd: () => dir });
    const ms = performance.now() - start;
    assert.strictEqual(code, 1, err.join(''));
    assert.ok(ms < BUDGET_MS, `took ${ms.toFixed(0)} ms`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
