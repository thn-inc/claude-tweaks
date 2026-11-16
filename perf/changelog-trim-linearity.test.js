// trimChangelog linearity budget (#5563) — deliberately NOT part of `npm test`.
//
// Run with: npm run test:perf
//
// changelog.js's trimChangelog cuts the gap between the last kept section and the
// `## Older releases` footer. Its input is a whole CHANGELOG.md, which nothing bounds. The
// first fix-round cut was `.replace(/(?:\n[ \t]*)+$/, '')`, which restarts at every newline of
// a run in the middle of the kept prefix and fails at the run's end: 20k newlines took about
// 1.3 s, 40k about 6.1 s and 80k about 39 s on the bare regex (27 s through trimChangelog end
// to end). A backward hand scan, cutTrailingGap, replaces it. Lives outside tests/ because a
// wall-clock assertion flakes under sibling-suite load.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { trimChangelog, parseChangelogFooter, parseChangelogVersions } = require('../plugin/bin/lib/changelog');

const N = 40000;
const SHA = 'a'.repeat(40);

function fixture(midRun) {
  return `# Changelog\n\n## v1.0.2 — b\n\nstart${midRun}end\n\n## v1.0.1 — a\n\nbody a\n`;
}

const CASES = [
  ['newline run inside the kept section', '\n'.repeat(N)],
  ['blank lines of spaces inside the kept section', '\n  '.repeat(N)],
  ['CRLF run inside the kept section', '\r\n'.repeat(N)],
  ['tab run inside one line', '\t'.repeat(N)],
];

for (const [name, run] of CASES) {
  test(`trimChangelog: ${name} (${N} repeats) stays under 1000 ms`, () => {
    const text = fixture(run);
    const start = performance.now();
    const r = trimChangelog(text, 1, { sha: SHA });
    const elapsed = performance.now() - start;
    const expectedPrefix = text.slice(0, text.indexOf('## v1.0.1')).replace(/\n\n$/, '') + '\n\n';
    const idx = parseChangelogFooter(r.text).index;
    assert.ok(r.text.slice(0, idx) === expectedPrefix, `verdict changed (prefix length ${idx}, expected ${expectedPrefix.length})`);
    assert.deepStrictEqual(r.removed, ['1.0.1']);
    assert.strictEqual(parseChangelogVersions(r.text).length, 1);
    assert.ok(elapsed < 1000, `took ${elapsed.toFixed(0)}ms — the trailing-gap cut must be one backward pass`);
  });
}

test(`trimChangelog: a trailing gap of ${N} blank lines is cut in under 1000 ms`, () => {
  const text = `# Changelog\n\n## v1.0.2 — b\n\nbody b${'\n \t'.repeat(N)}\n## v1.0.1 — a\n`;
  const start = performance.now();
  const r = trimChangelog(text, 1, { sha: SHA });
  const elapsed = performance.now() - start;
  assert.ok(r.text.startsWith('# Changelog\n\n## v1.0.2 — b\n\nbody b\n\n## Older releases\n'), 'gap not normalised');
  assert.ok(elapsed < 1000, `took ${elapsed.toFixed(0)}ms — the trailing-gap cut must be one backward pass`);
});
