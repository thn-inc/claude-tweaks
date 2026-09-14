'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { parseFrontmatterListField, splitFrontmatterFence } = require('../../../plugin/bin/lib/health-core/frontmatter-list');

// --- splitFrontmatterFence: the canonical fence-boundary detector other
// modules (e.g. bin/lib/issues/local-store.js's splitFrontmatter) reuse
// instead of hand-rolling their own copy. ---

test('splitFrontmatterFence returns null when there is no opening fence', () => {
  assert.strictEqual(splitFrontmatterFence('# no frontmatter here'), null);
});

test('splitFrontmatterFence returns null when the fence never closes', () => {
  assert.strictEqual(splitFrontmatterFence('---\npaths:\n  - src/a.ts\n'), null);
});

test('splitFrontmatterFence splits frontmatter lines from the content after the closing fence', () => {
  const result = splitFrontmatterFence('---\ntype: task\nrisk: low\n---\n\n# Title\n\nbody\n');
  assert.deepStrictEqual(result.frontmatter, ['type: task', 'risk: low']);
  assert.deepStrictEqual(result.afterLines, ['', '# Title', '', 'body', '']);
});

test('splitFrontmatterFence returns an empty frontmatter array for an empty fenced block', () => {
  const result = splitFrontmatterFence('---\n---\nbody\n');
  assert.deepStrictEqual(result.frontmatter, []);
  assert.deepStrictEqual(result.afterLines, ['body', '']);
});

test('parseFrontmatterListField returns [] when there is no frontmatter', () => {
  assert.deepStrictEqual(parseFrontmatterListField('# no frontmatter here', 'paths'), []);
});

test('parseFrontmatterListField returns [] when the frontmatter has no closing ---', () => {
  const content = '---\npaths:\n  - src/a.ts\n';
  assert.deepStrictEqual(parseFrontmatterListField(content, 'paths'), []);
});

test('parseFrontmatterListField returns [] when the named field key is absent', () => {
  const content = '---\nother: value\n---\n# Doc\n';
  assert.deepStrictEqual(parseFrontmatterListField(content, 'paths'), []);
});

test('parseFrontmatterListField extracts a bullet list under the named key', () => {
  const content = '---\npaths:\n  - src/api/**\n  - src/routes/**\n---\n# Doc\n';
  assert.deepStrictEqual(parseFrontmatterListField(content, 'paths'), ['src/api/**', 'src/routes/**']);
});

test('parseFrontmatterListField reads a different field name from the same shape', () => {
  const content = '---\nfiles:\n  - src/checkout/Cart.tsx\n  - src/checkout/Payment.tsx\n---\n';
  assert.deepStrictEqual(
    parseFrontmatterListField(content, 'files'),
    ['src/checkout/Cart.tsx', 'src/checkout/Payment.tsx'],
  );
});

test('parseFrontmatterListField stops at the first non-list-item line after the field', () => {
  const content = '---\nfiles:\n  - src/a.ts\nother: value\n  - src/b.ts\n---\n';
  assert.deepStrictEqual(parseFrontmatterListField(content, 'files'), ['src/a.ts']);
});

test('parseFrontmatterListField matches a dash with no space before the item (union of the three prior implementations\' regexes)', () => {
  // harness-health's parseRulePaths and journey-health's parseJourneyFiles
  // both used `\s*` (zero or more spaces) after the dash; docs-health's
  // parseFilesField required `\s+` (at least one). The shared parser uses
  // the more permissive form, a strict widening for docs-health's former
  // callers only (every `\s+` match is also a `\s*` match).
  const content = '---\nfiles:\n  -src/a.ts\n---\n';
  assert.deepStrictEqual(parseFrontmatterListField(content, 'files'), ['src/a.ts']);
});

test('parseFrontmatterListField treats the field name as a literal, not a regex', () => {
  const content = '---\nfil.s:\n  - src/a.ts\n---\n';
  assert.deepStrictEqual(parseFrontmatterListField(content, 'files'), []);
});

// --- CRLF regression (#1882) — constructs CRLF content directly rather
// than relying on the checkout's own core.autocrlf setting, so this test
// exercises the bug regardless of how CI or a contributor's checkout is
// configured. ---

test('splitFrontmatterFence parses CRLF content identically to its LF equivalent', () => {
  const lf = '---\ntype: task\nrisk: low\n---\n\n# Title\n\nbody\n';
  const crlf = lf.replace(/\n/g, '\r\n');
  const lfResult = splitFrontmatterFence(lf);
  const crlfResult = splitFrontmatterFence(crlf);
  assert.deepStrictEqual(crlfResult.frontmatter, ['type: task', 'risk: low']);
  assert.deepStrictEqual(crlfResult.afterLines, ['', '# Title', '', 'body', '']);
  assert.deepStrictEqual(crlfResult, lfResult);
});

test('parseFrontmatterListField parses CRLF content identically to its LF equivalent', () => {
  const lf = '---\nfiles:\n  - src/checkout/Cart.tsx\n  - src/checkout/Payment.tsx\n---\n';
  const crlf = lf.replace(/\n/g, '\r\n');
  const lfResult = parseFrontmatterListField(lf, 'files');
  const crlfResult = parseFrontmatterListField(crlf, 'files');
  assert.deepStrictEqual(crlfResult, ['src/checkout/Cart.tsx', 'src/checkout/Payment.tsx']);
  assert.deepStrictEqual(crlfResult, lfResult);
});
