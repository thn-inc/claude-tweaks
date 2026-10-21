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
// casing/drive semantics, so none may remain under plugin/bin/. The scan also
// flags any literal `startsWith('..')` under plugin/bin outside lib/path-guard/
// (#3642), since such a test is the `path.relative`-derived containment idiom;
// other re-derivations are out of scope.
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

// The bare `rel.startsWith('..')` test on a `path.relative` result, in any quote
// style. `'...'` and `'../'` do not match (the closing quote must follow `..`).
const REL_DOT_DOT = /startsWith\(\s*(['"`])\.\.\1\s*\)/;
function scanRelDotDot(src, rel) {
  const hits = [];
  stripComments(src).split('\n').forEach((line, i) => {
    if (REL_DOT_DOT.test(line)) hits.push(`${rel}:${i + 1}`);
  });
  return hits;
}

// The one assertion the real-corpus test and the planted go-red control share.
function assertNoRelDotDot(entries) {
  const hits = [];
  for (const { rel, raw } of entries) {
    const verdict = stripperVerdict(raw);
    assert.equal(verdict, 'ok', `${rel}: ${STRIPPER_VERDICT_MESSAGES[verdict]}`);
    hits.push(...scanRelDotDot(raw, rel));
  }
  assert.deepEqual(hits, []);
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

test('#3642 scanRelDotDot flags a bare startsWith(\'..\') in any quote style, but not \'...\', \'../\' or a comment', () => {
  const src = [
    "if (rel.startsWith('..')) return null;",
    'const out = r.startsWith("..");',
    'const tpl = r.startsWith(`..`);',
    "if (e.startsWith('...')) continue;",
    "const esc = p.startsWith('../');",
    "// rel.startsWith('..') in a comment",
  ].join('\n');
  assert.deepEqual(scanRelDotDot(src, 'f.js'), ['f.js:1', 'f.js:2', 'f.js:3']);
});

test('#3642 AC1.1: no plugin/bin JS file outside lib/path-guard/ tests containment with startsWith(\'..\')', () => {
  assertNoRelDotDot(listJs(BIN_ROOT)
    .map((file) => ({ rel: path.relative(ROOT, file).replace(/\\/g, '/'), raw: fs.readFileSync(file, 'utf8') }))
    .filter(({ rel }) => !rel.startsWith('plugin/bin/lib/path-guard/')));
});

test('#3642 AC3.1: the scan fails on a planted rel.startsWith(\'..\') containment check', () => {
  const planted = { rel: 'plugin/bin/lib/planted.js', raw: "const rel = path.relative(root, p);\nreturn !rel.startsWith('..');\n" };
  assert.throws(() => assertNoRelDotDot([planted]), /planted\.js:2/);
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
