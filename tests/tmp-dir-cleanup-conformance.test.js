'use strict';
// A test file that makes a directory under the tmpdir must clean it up. `tools/run-tests.js` hides a missing
// cleanup (its per-run TMPDIR is removed on exit), but a direct `node --test <file>` (one literal file is
// allowed by the direct-test-run guard, #5547) writes to the real tmpdir, and 597,912 top-level entries piled up
// in one dev machine's $TMPDIR that way (2026-11-18). Two checks cover the two halves of the problem:
//   - this file: a static scan; a file with a raw `mkdtemp`/`mkdtempSync` call rooted at the tmpdir needs cleanup
//     evidence (a removal call, or the self-cleaning helper `tests/helpers/tmp-dir.js`);
//   - tools/run-tests.js: after every run it counts the top-level entries the suite left in its TMPDIR and warns.
// The scan reads the file's text, so it sees a missing removal, not a removal that misses one of several
// directories; the runner's warning is the check for that.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { stripComments, stripperVerdict, STRIPPER_VERDICT_MESSAGES } = require('./helpers/strip-comments');

const REPO = path.join(__dirname, '..');
const SCAN_ROOTS = ['tests', 'perf', path.join('tools', 'upstream-drift', 'tests')];

// Not scanned: the helper itself (its mkdtemp is the implementation) and fixture files a test copies or spawns
// rather than runs as a suite.
const EXEMPT = new Set(['tests/helpers/tmp-dir.js']);
const EXEMPT_PREFIXES = ['tests/fixtures/'];

// A removal call in the file, or the helper. Matched on comment-blanked text.
const REMOVAL = /\b(?:rmSync|rmdirSync|rimraf|removeSync)\s*\(|\bfs(?:\.promises)?\.rm\s*\(|\bfsp\.rm\s*\(|\bscratchDir\s*\(|\bisolateTmpdir\s*\(/;

// End index (exclusive) of the balanced `(...)` opening at `open`, string and template aware; -1 if unbalanced.
function matchParen(src, open) {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === "'" || c === '"') {
      for (i++; i < src.length && src[i] !== c; i++) if (src[i] === '\\') i++;
    } else if (c === '`') {
      for (i++; i < src.length && src[i] !== '`'; i++) if (src[i] === '\\') i++;
    } else if (c === '(') depth++;
    else if (c === ')' && --depth === 0) return i + 1;
  }
  return -1;
}

// The raw `mkdtemp(Sync)(...)` call sites in `src` whose argument names the tmpdir, as `{ line, call }`. Call
// sites are located on text with comments and literal bodies blanked (so `mkdtempSync(` inside a string or
// comment is not one) and read from the comment-stripped text at the same offsets.
function tmpRootedMkdtempCalls(src) {
  const kept = stripComments(src);
  const blanked = stripComments(src, { literals: 'blank' });
  const calls = [];
  const re = /\bmkdtemp(?:Sync)?\s*\(/g;
  let m;
  while ((m = re.exec(blanked))) {
    const open = m.index + m[0].length - 1;
    const end = matchParen(kept, open);
    const call = kept.slice(m.index, end < 0 ? kept.length : end);
    if (/tmpdir|\bTMPDIR\b/i.test(call)) calls.push({ line: kept.slice(0, m.index).split('\n').length, call });
  }
  return calls;
}

// Does the file give any evidence its tmp directories are removed?
function hasCleanup(src) {
  return REMOVAL.test(stripComments(src, { literals: 'blank' }));
}

// `[{ file, why }]` for each of `files` (`{ rel, text }`) that makes a tmpdir-rooted directory without cleanup
// evidence, or whose text the comment stripper cannot be trusted on.
function uncleanedTmpDirFiles(files) {
  const out = [];
  for (const { rel, text } of files) {
    if (EXEMPT.has(rel) || EXEMPT_PREFIXES.some((p) => rel.startsWith(p))) continue;
    const verdict = stripperVerdict(text);
    if (verdict === 'misparsed') { out.push({ file: rel, why: STRIPPER_VERDICT_MESSAGES.misparsed }); continue; }
    if (verdict === 'unparseable') continue;
    const calls = tmpRootedMkdtempCalls(text);
    if (calls.length > 0 && !hasCleanup(text)) {
      out.push({ file: rel, why: `${calls.length} tmpdir mkdtemp call(s) (first at line ${calls[0].line}) and no removal call` });
    }
  }
  return out;
}

function liveFiles() {
  const out = [];
  const walk = (dir) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (ent.name === 'node_modules') continue;
      const abs = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(abs);
      else if (ent.isFile() && ent.name.endsWith('.js')) {
        out.push({ rel: path.relative(REPO, abs).split(path.sep).join('/'), text: fs.readFileSync(abs, 'utf8') });
      }
    }
  };
  for (const root of SCAN_ROOTS) {
    if (fs.existsSync(path.join(REPO, root))) walk(path.join(REPO, root));
  }
  return out;
}

// --- go-red proofs for the matcher -----------------------------------------------------------------------

const planted = (text) => uncleanedTmpDirFiles([{ rel: 'tests/planted.test.js', text }]);

test('a raw tmpdir mkdtempSync with no removal is flagged', () => {
  const out = planted("const fs = require('fs'); const os = require('os'); const path = require('path');\nconst d = fs.mkdtempSync(path.join(os.tmpdir(), 'x-'));\n");
  assert.equal(out.length, 1);
  assert.match(out[0].why, /line 2/);
});

test('the same call is accepted with a removal call, or through the self-cleaning helper', () => {
  assert.deepEqual(planted("const d = fs.mkdtempSync(path.join(os.tmpdir(), 'x-'));\nafter(() => fs.rmSync(d, { recursive: true }));\n"), []);
  assert.deepEqual(planted("const { scratchDir } = require('./helpers/tmp-dir');\nconst d = scratchDir('x-');\nconst e = fs.mkdtempSync(path.join(os.tmpdir(), 'y-'));\n"), []);
});

test('a removal that exists only in a comment or a string does not count', () => {
  assert.equal(planted("const d = fs.mkdtempSync(path.join(os.tmpdir(), 'x-'));\n// fs.rmSync(d)\nconst s = 'fs.rmSync(d)';\n").length, 1);
});

test('mkdtemp in a comment or string, or rooted outside the tmpdir, is not a tmp directory', () => {
  assert.deepEqual(planted("// fs.mkdtempSync(path.join(os.tmpdir(), 'x-'))\nconst s = \"fs.mkdtempSync(path.join(os.tmpdir(), 'x-'))\";\n"), []);
  assert.deepEqual(planted("const d = fs.mkdtempSync(path.join(repoDir, 'x-'));\n"), []);
});

test('the other tmpdir spellings are matched', () => {
  for (const spelling of ["require('os').tmpdir()", 'osMod.tmpdir()', 'fs.realpathSync(os.tmpdir())', 'process.env.TMPDIR']) {
    assert.equal(planted(`const d = fsMod.mkdtempSync(path.join(${spelling}, 'x-'));\n`).length, 1, spelling);
  }
});

// --- the live scan ---------------------------------------------------------------------------------------

test('every test file that makes a tmpdir directory removes it', () => {
  const files = liveFiles();
  const bad = uncleanedTmpDirFiles(files);
  assert.deepEqual(bad, [], `these files make a directory under the tmpdir and never remove it: use scratchDir() or isolateTmpdir() from tests/helpers/tmp-dir.js, or remove it in after()\n${bad.map((b) => `  ${b.file}: ${b.why}`).join('\n')}`);
});

test('the scan sees the suite: hundreds of files use a tmp directory', () => {
  const files = liveFiles();
  const users = files.filter(({ text }) => /\bscratchDir\s*\(|\bmkdtemp(?:Sync)?\s*\(/.test(text));
  assert.ok(files.length > 1000, `scanned ${files.length} files`);
  assert.ok(users.length > 300, `only ${users.length} files make tmp directories; the scan has lost its input`);
});
