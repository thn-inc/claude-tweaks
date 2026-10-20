'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { stripComments, stripperVerdict, STRIPPER_VERDICT_MESSAGES } = require('./helpers/strip-comments');

// New path-containment code ("is this resolved path inside that one") calls
// `isPathContained` in plugin/bin/lib/shared-primitives.js, a thin wrapper over
// path-guard's `isAncestorOrSelf` (#3498). A hand-rolled
// `x.startsWith(root + path.sep)` test re-derives it without the win32
// casing/drive semantics, so none may remain under plugin/bin/. This pins only
// that idiom; other `path.relative`-based re-derivations are out of scope.
const ROOT = path.join(__dirname, '..');
const BIN_ROOT = path.join(ROOT, 'plugin', 'bin');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function listJs(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listJs(full));
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

// `${rel}:${lineNo}` for every non-comment line matching the spec's own grep
// pattern. Comments are blanked (line numbers stay stable) so prose that names
// the retired idiom is not a hit.
const HAND_ROLLED = /startsWith\(.*path\.sep/;
function scanHandRolled(src, rel) {
  const hits = [];
  stripComments(src).split('\n').forEach((line, i) => {
    if (HAND_ROLLED.test(line)) hits.push(`${rel}:${i + 1}`);
  });
  return hits;
}

test('scanHandRolled flags the idiom in code but not in a comment', () => {
  const src = [
    '// candidate.startsWith(root + path.sep) in a comment',
    'const a = real.startsWith(root + path.sep);',
    '/* x.startsWith(r + path.sep) */',
  ].join('\n');
  assert.deepEqual(scanHandRolled(src, 'f.js'), ['f.js:2']);
});

test('AC1.1: no plugin/bin JS file hand-rolls a startsWith(... path.sep) containment test', () => {
  const hits = [];
  for (const file of listJs(BIN_ROOT)) {
    const rel = path.relative(ROOT, file).replace(/\\/g, '/');
    const raw = fs.readFileSync(file, 'utf8');
    const verdict = stripperVerdict(raw);
    assert.equal(verdict, 'ok', `${rel}: ${STRIPPER_VERDICT_MESSAGES[verdict]}`);
    hits.push(...scanHandRolled(raw, rel));
  }
  assert.deepEqual(hits, []);
});

test('shared-primitives.js still defines isPathContained', () => {
  assert.ok(read('plugin/bin/lib/shared-primitives.js').includes('function isPathContained('));
});

test('AC3.1: docs/donts.md [IL-161] and the pre-tool-use-gate-exemptions skill name the same containment helper', () => {
  const il161 = read('docs/donts.md').split('\n').filter((l) => l.includes('[IL-161]'));
  const bullet = read('.claude/skills/pre-tool-use-gate-exemptions/SKILL.md').split('\n').find((l) => l.startsWith('- **A containment check'));
  assert.ok(il161.length > 0, 'no [IL-161] line found in docs/donts.md');
  assert.ok(bullet, 'no "- **A containment check" bullet found in the skill');
  for (const text of [il161.join('\n'), bullet]) assert.match(text, /isAncestorOrSelf/);
  assert.doesNotMatch(bullet, /`isPathContained` stays the lexical primitive/);
});
