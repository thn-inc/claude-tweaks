'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { stripComments, stripperVerdict, STRIPPER_VERDICT_MESSAGES } = require('./helpers/strip-comments');

// `git worktree list --porcelain` prints forward-slash paths on win32 (`D:/a/x/feat`) while a hook's
// cwd is native (`D:\a\x\feat`), so a strict `entry.path === cwd` never matches there (#3695, #3811).
// Every porcelain-vs-cwd lookup goes through `findWorktreeEntry` (worktree-reap.js), so no plugin/bin
// module may compare a `.path` to a cwd with a strict operator. Both operand orders and both
// operators (`===`, `!==`, and the loose pair) are matched; other path-compare idioms are out of scope.
const ROOT = path.join(__dirname, '..');
const BIN_ROOT = path.join(ROOT, 'plugin', 'bin');

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

const PATH_VS_CWD = /\.path\s*[!=]==?\s*[\w.]*cwd\b/;
const CWD_VS_PATH = /\bcwd\s*[!=]==?\s*\w+\.path\b/;

// `${rel}:${lineNo}` for every non-comment line comparing a `.path` to a cwd. Comments are blanked
// (line numbers stay stable) so prose that names the retired idiom is not a hit.
function scanPorcelainCwdCompare(raw, rel) {
  const hits = [];
  stripComments(raw).split('\n').forEach((line, i) => {
    if (PATH_VS_CWD.test(line) || CWD_VS_PATH.test(line)) hits.push(`${rel}:${i + 1}`);
  });
  return hits;
}

// The one assertion the real-corpus test and the planted go-red control share.
function assertNoPorcelainCwdCompare(entries) {
  const hits = [];
  for (const { rel, raw } of entries) {
    const verdict = stripperVerdict(raw);
    assert.equal(verdict, 'ok', `${rel}: ${STRIPPER_VERDICT_MESSAGES[verdict]}`);
    hits.push(...scanPorcelainCwdCompare(raw, rel));
  }
  assert.deepEqual(hits, []);
}

test('scanPorcelainCwdCompare flags a strict compare in either operand order and operator, but not a comment', () => {
  const src = [
    'const a = entries.find((e) => e.path === cwd);',
    'const b = entries.findIndex((e) => e.path === ctx.cwd);',
    'const c = entries.some((e) => cwd === e.path);',
    'const d = entries.filter((e) => e.path !== process.cwd());',
    'const e = entries.find((e) => e.path == cwd);',
    '// entries.find((e) => e.path === cwd) in a comment',
    'const ok = findWorktreeEntry(entries, cwd);',
    "const msg = 'worktree path';",
  ].join('\n');
  assert.deepEqual(scanPorcelainCwdCompare(src, 'f.js'), ['f.js:1', 'f.js:2', 'f.js:3', 'f.js:4', 'f.js:5']);
});

test('scanPorcelainCwdCompare still sees a compare after a string holding a comment opener', () => {
  const src = [
    "const glob = 'staged/**';",
    'const hit = entries.find((e) => e.path === cwd);',
  ].join('\n');
  assert.deepEqual(scanPorcelainCwdCompare(src, 'f.js'), ['f.js:2']);
});

test('#3811 AC3: no plugin/bin JS file compares a porcelain .path to a cwd with a strict operator', () => {
  const files = listJs(BIN_ROOT);
  assert.ok(files.length >= 400, `scanned only ${files.length} plugin/bin files — the walk stopped reaching the tree, so a zero-offender result proves nothing`);
  assertNoPorcelainCwdCompare(files.map((file) => ({
    rel: path.relative(ROOT, file).replace(/\\/g, '/'),
    raw: fs.readFileSync(file, 'utf8'),
  })));
});

test('#3811 AC3: the scan fails on a planted strict compare', () => {
  const planted = { rel: 'plugin/bin/lib/planted.js', raw: 'function find(entries, cwd) {\n  return entries.find((e) => e.path === cwd);\n}\n' };
  assert.throws(() => assertNoPorcelainCwdCompare([planted]), /planted\.js:2/);
});
