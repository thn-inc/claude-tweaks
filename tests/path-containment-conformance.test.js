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
// flags the variable-mediated form (#3892): `startsWith(<identifier bound to an
// expression naming path.sep>)`, which a same-line match cannot see when the
// binding and the test sit on different lines (its recall limits are listed at
// `SEP_BINDING` below). It also flags any literal
// `startsWith('..')` under plugin/bin outside lib/path-guard/ (#3642), since
// such a test is the `path.relative`-derived containment idiom; other
// re-derivations are out of scope.
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

// The plugin/bin tree, walked and read once; the real-tree assertions share it.
let binSourcesCache = null;
function binSources() {
  if (binSourcesCache === null) {
    binSourcesCache = listJs(BIN_ROOT).map((file) => ({
      rel: path.relative(ROOT, file).replace(/\\/g, '/'),
      raw: fs.readFileSync(file, 'utf8'),
    }));
  }
  return binSourcesCache;
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

// The variable-mediated form (#3892). A binding is an identifier (or dotted
// chain) followed by `=`, `+=`, `??=` or `||=`; `==`, `===`, `!=`, `<=`, `>=`
// and `=>` are not bindings. Its right-hand side runs to the next binding on the
// line or to a `;`; it counts when it names `sep` (`path.sep`, `pathImpl.sep`,
// a destructured `sep`).
//
// Scope: the bound-name set is file-wide, not per function. A name bound to a
// sep expression in one function and passed to `startsWith(name)` in another
// function of the same file is flagged; that is a possible false positive the
// scan accepts for a conservative match.
//
// Limits (recall gaps, by design; the matcher is not widened for them):
//   (a) a right-hand side that starts on the next line (`const r =\n  root + path.sep;`)
//       is not seen, because bindings are read one line at a time;
//   (b) an object-property binding (`{ rs: root + path.sep }`, then `startsWith(o.rs)`)
//       is not collected;
//   (c) a helper-function return (`startsWith(pre(root))`) is not flagged: the scan
//       matches only an identifier or dotted-identifier argument, so a call argument
//       is never matched, even when the helper builds a sep-suffixed value.
// Read per line over the comment-stripped text.
const SEP_BINDING = /(?<![\w$.!<>=+\-*\/%&|^?])([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*(?:\+|\?\?|\|\|)?=(?![=>])/g;
const STARTS_WITH_ARG = /\.startsWith\(\s*([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*[,)]/g;
function sepBoundNames(line) {
  const bindings = [...line.matchAll(SEP_BINDING)];
  const names = [];
  bindings.forEach((m, i) => {
    const from = m.index + m[0].length;
    const to = i + 1 < bindings.length ? bindings[i + 1].index : line.length;
    if (/\bsep\b/.test(line.slice(from, to).split(';')[0])) names.push(m[1]);
  });
  return names;
}
function scanVariableHandRolled(src, rel) {
  const lines = stripComments(src).split('\n');
  const bound = new Set();
  for (const line of lines) for (const name of sepBoundNames(line)) bound.add(name);
  const hits = [];
  lines.forEach((line, i) => {
    if ([...line.matchAll(STARTS_WITH_ARG)].some((m) => bound.has(m[1]))) hits.push(`${rel}:${i + 1}`);
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

// Every plugin/bin file's hits from `scan`, after confirming the comment
// stripper parsed the file cleanly.
function scanBinTree(scan) {
  const hits = [];
  for (const { rel, raw } of binSources()) {
    const verdict = stripperVerdict(raw);
    assert.equal(verdict, 'ok', `${rel}: ${STRIPPER_VERDICT_MESSAGES[verdict]}`);
    hits.push(...scan(raw, rel));
  }
  return hits;
}

test('AC1.1: no plugin/bin JS file hand-rolls a startsWith(... path.sep) containment test', () => {
  assert.deepEqual(scanBinTree(scanHandRolled), []);
});

test('#3892 scanVariableHandRolled flags each variable-mediated binding shape at its startsWith line', () => {
  const src = [
    'const t = root.endsWith(path.sep) ? root : root + path.sep;',
    'if (p.startsWith(t)) return;',
    'let c = path.resolve(p) + path.sep;',
    'if (q.startsWith(c)) return;',
    'var tpl = `${root}${path.sep}`;',
    'if (r.startsWith(tpl)) return;',
    'let re; re = root + path.sep;',
    'if (s.startsWith(re)) return;',
    'let cc = root; cc += path.sep;',
    'if (u.startsWith(cc)) return;',
    'function f(pre = root + path.sep) { return v.startsWith(pre); }',
    'this.sepRoot = root + path.sep; if (w.startsWith(this.sepRoot)) return;',
    'const trail = root + pathImpl.sep;',
    'if (x.startsWith(trail)) return;',
  ].join('\n');
  assert.deepEqual(scanVariableHandRolled(src, 'f.js'), ['f.js:2', 'f.js:4', 'f.js:6', 'f.js:8', 'f.js:10', 'f.js:11', 'f.js:12', 'f.js:14']);
});

test('#3892 scanVariableHandRolled ignores a comment, an indexOf/split use, a non-sep startsWith and a comparison', () => {
  const src = [
    '// const x = root + path.sep; if (p.startsWith(x)) return;',
    '/* const y = root + path.sep; */ if (p.startsWith(y)) return;',
    'const WORKTREE_ADMIN_MARKER = `${path.sep}.git${path.sep}`;',
    'if (p.indexOf(WORKTREE_ADMIN_MARKER) >= 0 || parts.split(WORKTREE_ADMIN_MARKER)) return;',
    'const prefix = root + "/";',
    'if (p.startsWith(prefix)) return;',
    'if (leading === path.sep && p.startsWith(leading)) return;',
    'items.forEach(x => keep(x, path.sep));',
    'if (p.startsWith(x)) return;',
  ].join('\n');
  assert.deepEqual(scanVariableHandRolled(src, 'f.js'), []);
});

test('#3892 go-red: the scan flags the old sweep-shadow rootWithSep guard, verbatim, on its startsWith line', () => {
  const planted = 'const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;\nif (!runDir.startsWith(rootWithSep)) {\n';
  assert.deepEqual(scanVariableHandRolled(planted, 'plugin/bin/lib/planted.js'), ['plugin/bin/lib/planted.js:2']);
});

test('#3892 AC1.2: no plugin/bin JS file tests containment with startsWith(<identifier bound to a path.sep expression>)', () => {
  assert.deepEqual(scanBinTree(scanVariableHandRolled), []);
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
  assertNoRelDotDot(binSources().filter(({ rel }) => !rel.startsWith('plugin/bin/lib/path-guard/')));
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
