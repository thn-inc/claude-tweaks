'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { stripComments, stripperVerdict, STRIPPER_VERDICT_MESSAGES } = require('./helpers/strip-comments');
const { readText } = require('./helpers/read-skill');

// #3922: a test that reads a tracked markdown file through a raw
// `fs.readFileSync(path, 'utf8')` breaks on a Windows `core.autocrlf=true`
// checkout, where the working copy carries CRLF line endings: heading lookups
// and newline-spanning literals stop matching. CI runs on ubuntu only, so each
// such file surfaced one at a time through the post-merge windows-regression.yml
// run (#3703, #3776, #3797, #3802, #3890, #3894). This scan fails on Linux
// instead: every text-mode read of a repo-rooted path in tests/**/*.test.js goes
// through tests/helpers/read-skill.js's `readText`, unless the path is provably a
// JSON file (a parse ignores line endings) or the file is on ALLOWLIST with a
// reason. A suite run on a `core.autocrlf=true` checkout showed the same break
// for a raw read of an HTML template and of a shell script a test extracts a
// snippet from, so the rule covers every tracked text file, not markdown alone.
//
// What counts as repo-rooted. An expression naming `__dirname`, `__filename` or
// `process.cwd()`, or an identifier whose binding is repo-rooted. A binding is
// `const|let|var X = …`, `for (const X of|in …)`, an assignment `X = …`/`X += …`
// or a parameter default `(X = …)`; its right-hand side runs to a depth-0 `;`,
// `,`, closing bracket, or line end. A name resolves to its nearest preceding
// binding in the file (else its first one), so a `dir` bound to a temp directory
// in one test and to the repo root in another is judged per use. Taint stops at a
// content-producing call (CONTENT_CALL): a variable holding a file's text or a
// spawn's output is not a path, even when the path it came from was repo-rooted.
//
// Kinds. The read's argument, plus the right-hand sides of the bindings it
// reaches, holds a `.md` or `.gitignore` string literal → `md`. It is exempt as
// `json` only when the read is the direct argument of `JSON.parse`, or when it
// holds a `.json`/`.jsonl` literal and no call other than a path builder (a walk
// helper can return any file list). Anything else — a `.js`/`.html`/`.sh` path,
// or the `read(rel)` helper shape that #3890 and #3894 fixed — is `text`.
//
// A path built only from a named function's parameters (`function read(...segments)`,
// `const read = (p) => …`) is repo-rooted when some call of that function in the file
// passes a repo-rooted argument, followed up to three helper levels.
//
// Recall limits (by design, stated so a green scan is not read as more):
//   (a) a function reached only as a value (`files.map(read)`), an anonymous
//       callback's parameter, or a method on an object literal is not followed to
//       its callers, so its read is judged by its own argument text;
//   (b) destructuring (`const { dir } = fx`) and object properties (`ctx.root`)
//       are not bindings;
//   (c) a read through an alias (`const rd = fs.readFileSync; rd(p, 'utf8')`) is
//       not matched, nor `fs.readFile` with a callback;
//   (d) only tests/**/*.test.js is walked, not tests/helpers/ or other
//       non-test modules under tests/.
const ROOT = path.join(__dirname, '..');
const TESTS_ROOT = path.join(ROOT, 'tests');

// Files whose remaining raw reads are deliberate. `count` is the exact number of
// flagged raw reads the scan reports for the file; `reason` says why each must
// stay raw. A drift either way fails, so a new raw read cannot hide behind an
// existing entry.
const ALLOWLIST = {};

// Repo-rooted text reads the live scan sees (raw + readText) when this landed.
// Fewer means the taint or the call matcher stopped matching, not that the
// reads went away — never lower it to make the suite green.
const ROOTED_READ_FLOOR = 964;

const OPEN = '([{';
const CLOSE = ')]}';
const SEED = /(?<![\w$.])(?:__dirname|__filename)(?![\w$])|(?<![\w$])process\s*\.\s*cwd\s*\(\s*\)/;
const CONTENT_CALL = /(?<![\w$])(?:readFileSync|readFile|readText|JSON\s*\.\s*parse|spawnSync|execFileSync|execSync|spawn|execFile|exec)\s*\(/g;
const BINDING = /(?<![\w$])(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=(?![=>])|(?<![\w$])for\s*\(\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s+(?:of|in)\s+|(?<![\w$.])([A-Za-z_$][\w$]*)\s*\+?=(?![=>])/g;
const NOT_A_NAME = new Set(['const', 'let', 'var', 'return', 'if', 'else', 'typeof', 'await', 'yield']);
const RAW_READ = /(?<![\w$])(?:readFileSync|promises\s*\.\s*readFile)\s*\(/g;
const HELPER_READ = /(?<![\w$.])readText\s*\(/g;
const MD_LITERAL = /\.md['"`]|['"`/]\.gitignore['"`]/;
const JSON_LITERAL = /\.jsonl?['"`]/;
const OTHER_EXT_LITERAL = /\.(?:js|cjs|mjs|ya?ml|sh|txt|ts|toml|html|css|svg|patch|diff|lock|log)['"`]/;
const PATH_BUILDER = /(?<![\w$])path\s*\.\s*(?:posix\s*\.\s*|win32\s*\.\s*)?(?:join|resolve|dirname|normalize)\s*\(|(?<![\w$])require\s*\.\s*resolve\s*\(/g;

// Index of the bracket closing the one opened just before `i` (or the end).
function closeOf(code, i) {
  let depth = 0;
  for (let k = i; k < code.length; k++) {
    const c = code[k];
    if (OPEN.includes(c)) depth++;
    else if (CLOSE.includes(c)) {
      if (depth === 0) return k;
      depth--;
    }
  }
  return code.length;
}

// End of the expression starting at `i`: a depth-0 `;` or `,`, the bracket that
// closes the enclosing one, or a line end that no operator continues.
function exprEnd(code, i) {
  while (i < code.length && /\s/.test(code[i])) i++;
  let depth = 0;
  for (let k = i; k < code.length; k++) {
    const c = code[k];
    if (OPEN.includes(c)) depth++;
    else if (CLOSE.includes(c)) {
      if (depth === 0) return k;
      depth--;
    } else if (depth === 0 && (c === ';' || c === ',')) return k;
    else if (depth === 0 && c === '\n') {
      const prev = code.slice(i, k).trimEnd().slice(-1);
      const next = code.slice(k + 1).trimStart()[0];
      if (prev && '+=(,?:|&.'.includes(prev)) continue;
      if (next && '.+?:|&'.includes(next)) continue;
      return k;
    }
  }
  return code.length;
}

// Blank the argument span of every content-producing call, in both views.
function dropContentCalls(keep, code) {
  const k = keep.split('');
  const c = code.split('');
  const re = new RegExp(CONTENT_CALL.source, 'g');
  let m;
  while ((m = re.exec(code))) {
    const end = closeOf(code, re.lastIndex);
    for (let i = re.lastIndex; i < end; i++) {
      if (k[i] !== '\n') k[i] = ' ';
      if (c[i] !== '\n') c[i] = ' ';
    }
  }
  return { keep: k.join(''), code: c.join('') };
}

const nameRe = (name) => new RegExp(`(?<![\\w$.])${name.replace(/\$/g, '\\$')}(?![\\w$])`);

function collectBindings(keep, code) {
  const byName = new Map();
  const all = [];
  const re = new RegExp(BINDING.source, 'g');
  let m;
  while ((m = re.exec(code))) {
    const name = m[1] || m[2] || m[3];
    if (!name || NOT_A_NAME.has(name)) continue;
    const end = exprEnd(code, re.lastIndex);
    const rhs = dropContentCalls(keep.slice(re.lastIndex, end), code.slice(re.lastIndex, end));
    const b = { name, at: m.index, keep: rhs.keep, code: rhs.code, rooted: false, refs: [] };
    all.push(b);
    if (!byName.has(name)) byName.set(name, []);
    byName.get(name).push(b);
  }
  const names = [...byName.keys()];
  for (const b of all) b.refs = names.filter((n) => nameRe(n).test(b.code));
  return { all, byName };
}

// The binding a use of `name` at offset `at` refers to: the nearest one before it,
// else the first one in the file (a module constant used above its declaration).
function resolveBinding(byName, name, at) {
  const list = byName.get(name);
  if (!list) return null;
  let best = null;
  for (const b of list) if (b.at < at) best = b;
  return best || list[0];
}

function markRooted({ all, byName }) {
  for (const b of all) b.rooted = SEED.test(b.code);
  let changed = true;
  while (changed) {
    changed = false;
    for (const b of all) {
      if (b.rooted) continue;
      const hit = b.refs.some((n) => {
        const r = resolveBinding(byName, n, b.at);
        return r && r !== b && r.rooted;
      });
      if (hit) {
        b.rooted = true;
        changed = true;
      }
    }
  }
}

function isRooted(argCode, at, byName) {
  if (SEED.test(argCode)) return true;
  for (const n of byName.keys()) {
    if (!nameRe(n).test(argCode)) continue;
    const r = resolveBinding(byName, n, at);
    if (r && r.rooted) return true;
  }
  return false;
}

// The argument's text plus every binding it reaches; a `require(...)` binding is a
// module, not a path, and contributes nothing.
function evidence(argKeep, argCode, at, byName) {
  let keep = argKeep;
  let code = argCode;
  const seen = new Set();
  const stack = [];
  for (const n of byName.keys()) if (nameRe(n).test(argCode)) stack.push(resolveBinding(byName, n, at));
  while (stack.length) {
    const b = stack.pop();
    if (!b || seen.has(b)) continue;
    seen.add(b);
    if (/^\s*require\s*\(/.test(b.code)) continue;
    keep += '\n' + b.keep;
    code += '\n' + b.code;
    for (const n of b.refs) stack.push(resolveBinding(byName, n, b.at));
  }
  return { keep, code };
}

function classify(ev, before) {
  if (MD_LITERAL.test(ev.keep)) return 'md';
  if (/(?<![\w$])JSON\s*\.\s*parse\s*\(\s*(?:[\w$]+\s*\.\s*|require\s*\([^)]*\)\s*\.\s*)?$/.test(before)) return 'json';
  const opaqueCall = /[\w$]\s*\(/.test(ev.code.replace(new RegExp(PATH_BUILDER.source, 'g'), ''));
  if (JSON_LITERAL.test(ev.keep) && !OTHER_EXT_LITERAL.test(ev.keep) && !opaqueCall) return 'json';
  return 'text';
}

const lineAt = (code, i) => code.slice(0, i).split('\n').length;

// Named functions — `function f(…) {…}`, `const f = (…) => …`, `const f = x => …`,
// `const f = function (…) {…}` — with their parameter names and body span.
const FUNCTION_DEF = /(?<![\w$.])function\s*\*?\s*([A-Za-z_$][\w$]*)\s*\(|(?<![\w$.])(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?(?:function\s*\*?\s*(?:[A-Za-z_$][\w$]*)?\s*(\()|(\()|([A-Za-z_$][\w$]*)\s*=>)/g;

function paramNames(text) {
  const names = [];
  let depth = 0;
  let seg = '';
  const flush = () => {
    const head = seg.split('=')[0];
    for (const id of head.match(/[A-Za-z_$][\w$]*/g) || []) names.push(id);
    seg = '';
  };
  for (const c of text) {
    if (OPEN.includes(c)) depth++;
    else if (CLOSE.includes(c)) depth--;
    if (c === ',' && depth === 0) flush();
    else seg += c;
  }
  flush();
  return names;
}

function collectFunctions(code) {
  const out = [];
  const re = new RegExp(FUNCTION_DEF.source, 'g');
  let m;
  while ((m = re.exec(code))) {
    const name = m[1] || m[2];
    let params;
    let after;
    if (m[5]) {
      params = [m[5]];
      after = re.lastIndex;
    } else {
      const close = closeOf(code, re.lastIndex);
      params = paramNames(code.slice(re.lastIndex, close));
      after = close + 1;
      const arrow = /^\s*=>/.exec(code.slice(after));
      if (m[4] && !arrow) continue; // `const x = (a + b) * c` is not a function
      if (arrow) after += arrow[0].length;
    }
    while (after < code.length && /\s/.test(code[after])) after++;
    const bodyEnd = code[after] === '{' ? closeOf(code, after + 1) : exprEnd(code, after);
    out.push({ name, params, defAt: m.index, bodyStart: after, bodyEnd });
  }
  return out;
}

// Where a read's path comes from: the evidence ({ keep, code }) of a repo-rooted
// origin, or null. A path rooted in its own text or bindings is direct; a path
// built only from an enclosing function's parameters is rooted when some call of
// that function passes a rooted argument — the `function read(...segments)` and
// `const read = (p) => …` helpers whose callers hand in the repo directory.
function pathOrigin(argKeep, argCode, at, ctx, depth = 0) {
  if (isRooted(argCode, at, ctx.byName)) return evidence(argKeep, argCode, at, ctx.byName);
  if (depth >= 3) return null;
  const enclosing = ctx.functions.filter((f) => f.bodyStart <= at && at < f.bodyEnd).sort((a, b) => b.bodyStart - a.bodyStart);
  for (const fn of enclosing) {
    if (!fn.params.some((p) => nameRe(p).test(argCode))) continue;
    let found = null;
    const calls = new RegExp(`(?<![\\w$.])${fn.name.replace(/\$/g, '\\$')}\\s*\\(`, 'g');
    let c;
    while ((c = calls.exec(ctx.code))) {
      if (c.index === fn.defAt || /function\s*\*?\s*$/.test(ctx.code.slice(Math.max(0, c.index - 12), c.index))) continue;
      const close = closeOf(ctx.code, calls.lastIndex);
      const origin = pathOrigin(ctx.keep.slice(calls.lastIndex, close), ctx.code.slice(calls.lastIndex, close), c.index, ctx, depth + 1);
      if (origin) found = found ? { keep: found.keep + '\n' + origin.keep, code: found.code + '\n' + origin.code } : origin;
    }
    if (found) return found;
  }
  return null;
}

// Every repo-rooted text read in `raw` (a test file's source):
// { verdict, sites: [{ line, kind: 'md'|'text'|'json', via: 'raw'|'readText' }] }.
// A `via: 'raw'` site whose kind is not 'json' is an offender.
function scanRawMarkdownReads(raw) {
  const keep = stripComments(raw);
  // A spread's `...` is blanked (same length) so `...segments` reads as the name
  // `segments`, not a property access.
  const code = stripComments(raw, { literals: 'blank' }).replace(/\.\.\./g, '   ');
  const verdict = stripperVerdict(raw, keep);
  const bindings = collectBindings(keep, code);
  markRooted(bindings);
  const ctx = { keep, code, byName: bindings.byName, functions: collectFunctions(code) };
  const sites = [];
  const raws = new RegExp(RAW_READ.source, 'g');
  let m;
  while ((m = raws.exec(code))) {
    const open = raws.lastIndex;
    const close = closeOf(code, open);
    const firstEnd = Math.min(exprEnd(code, open), close);
    const argCode = code.slice(open, firstEnd);
    const restCode = code.slice(firstEnd, close).replace(/^\s*,/, '').trim();
    const textMode = (restCode !== '' && !/^(?:null|undefined)$/.test(restCode)) || /^\s*\.\s*toString\s*\(/.test(code.slice(close + 1));
    if (!textMode) continue;
    const ev = pathOrigin(keep.slice(open, firstEnd), argCode, m.index, ctx);
    if (!ev) continue;
    const before = code.slice(Math.max(0, m.index - 40), m.index).replace(/(?:[\w$]+\s*\.\s*)+$/, '');
    sites.push({ line: lineAt(code, m.index), kind: classify(ev, before), via: 'raw' });
  }
  const helpers = new RegExp(HELPER_READ.source, 'g');
  while ((m = helpers.exec(code))) {
    if (/function\s+$/.test(code.slice(Math.max(0, m.index - 12), m.index))) continue;
    const open = helpers.lastIndex;
    const argEnd = Math.min(exprEnd(code, open), closeOf(code, open));
    if (pathOrigin(keep.slice(open, argEnd), code.slice(open, argEnd), m.index, ctx)) sites.push({ line: lineAt(code, m.index), kind: 'md', via: 'readText' });
  }
  sites.sort((a, b) => a.line - b.line);
  return { verdict, sites };
}

const offenderLines = (src) =>
  scanRawMarkdownReads(src).sites.filter((s) => s.via === 'raw' && s.kind !== 'json').map((s) => s.line);

function listTestFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listTestFiles(full));
    else if (entry.name.endsWith('.test.js')) out.push(full);
  }
  return out;
}

let corpusCache = null;
function corpus() {
  if (corpusCache === null) {
    corpusCache = listTestFiles(TESTS_ROOT).map((file) => {
      const rel = path.relative(ROOT, file).split(path.sep).join('/');
      return { rel, ...scanRawMarkdownReads(readText(file)) };
    });
  }
  return corpusCache;
}

// ── Matcher self-tests ───────────────────────────────────────────────────────

const PRELUDE = "'use strict';\nconst fs = require('node:fs');\nconst os = require('node:os');\nconst path = require('node:path');\n";
const src = (...lines) => PRELUDE + lines.join('\n') + '\n';
const L = (n) => n + 4; // line n of the planted body, after the 4-line prelude

test('AC1.1 go-red: a raw read of a repo markdown file is flagged; the same read through readText is not', () => {
  const rawRead = src("const t = fs.readFileSync(path.join(__dirname, '..', 'plugin', 'skills', 'x', 'SKILL.md'), 'utf8');");
  assert.deepEqual(offenderLines(rawRead), [L(1)]);
  assert.equal(scanRawMarkdownReads(rawRead).sites[0].kind, 'md');
  const helperRead = src("const t = readText(path.join(__dirname, '..', 'plugin', 'skills', 'x', 'SKILL.md'));");
  assert.deepEqual(offenderLines(helperRead), []);
  assert.deepEqual(scanRawMarkdownReads(helperRead).sites, [{ line: L(1), kind: 'md', via: 'readText' }]);
});

test('AC1.1 go-red on the live tree: reverting a migrated readText call back to a raw read is flagged', () => {
  const rel = 'tests/materiality-floor-conformance.test.js';
  const live = readText(path.join(ROOT, rel));
  const helper = 'const read = (rel) => readText(path.join(REPO_ROOT, rel));';
  assert.ok(live.includes(helper), `${rel} no longer carries the migrated helper this control reverts`);
  assert.deepEqual(offenderLines(live), [], `${rel} should be clean before the revert`);
  const reverted = live.replace(helper, "const read = (rel) => require('fs').readFileSync(path.join(REPO_ROOT, rel), 'utf8');");
  const line = reverted.slice(0, reverted.indexOf('const read = (rel)')).split('\n').length;
  assert.deepEqual(offenderLines(reverted), [line]);
});

test('the read(rel) helper shape #3890 and #3894 fixed is flagged as text', () => {
  const s = src("const ROOT = path.join(__dirname, '..');", "const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');");
  assert.deepEqual(scanRawMarkdownReads(s).sites, [{ line: L(2), kind: 'text', via: 'raw' }]);
});

test('a helper whose path arrives only through its parameters is flagged when a caller passes a repo path', () => {
  const s = src(
    "const SKILL_DIR = path.join(__dirname, '..', 'plugin', 'skills', 'backlog');",
    'function read(...segments) {',
    "  return fs.readFileSync(path.join(...segments), 'utf8');",
    '}',
    "const read2 = (p) => fs.readFileSync(p, 'utf8');",
    "const a = read(SKILL_DIR, 'attention-mode.md');",
    "const b = read2(path.join(SKILL_DIR, 'refine-mode.md'));",
  );
  assert.deepEqual(scanRawMarkdownReads(s).sites, [
    { line: L(3), kind: 'md', via: 'raw' },
    { line: L(5), kind: 'md', via: 'raw' },
  ]);
});

test('a parameter-only helper called only with temp paths is not flagged', () => {
  const s = src(
    "const readLog = (dir) => fs.readFileSync(path.join(dir, 'decisions.md'), 'utf8');",
    "const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'x-'));",
    'const log = readLog(tmp);',
  );
  assert.deepEqual(offenderLines(s), []);
});

test('a path bound to a variable first, then read, is flagged through the binding chain', () => {
  const s = src(
    "const ROOT = path.join(__dirname, '..');",
    "const SKILLS = path.join(ROOT, 'plugin', 'skills');",
    "const SKILL = path.join(SKILLS, 'flow', 'SKILL.md');",
    '',
    "const text = fs.readFileSync(SKILL, 'utf8');",
  );
  assert.deepEqual(scanRawMarkdownReads(s).sites, [{ line: L(5), kind: 'md', via: 'raw' }]);
});

test('a for…of over a repo walk is flagged, and a walk list with one .json path is not exempt', () => {
  const s = src(
    "const DIR = path.join(__dirname, '..', 'plugin');",
    "for (const file of [...findAllMdFiles(DIR), path.join(DIR, 'hooks', 'hooks.json')]) {",
    "  const text = fs.readFileSync(file, 'utf8');",
    '}',
  );
  assert.deepEqual(offenderLines(s), [L(3)]);
});

test('a multi-line read, a .toString() read and an fs.promises read are flagged', () => {
  const s = src(
    'const a = fs.readFileSync(',
    "  path.join(__dirname, 'a.md'),",
    "  'utf8',",
    ');',
    "const b = fs.readFileSync(path.join(__dirname, 'b.md')).toString();",
    "const c = await fs.promises.readFile(path.join(__dirname, 'c.md'), 'utf8');",
  );
  assert.deepEqual(offenderLines(s), [L(1), L(5), L(6)]);
});

test('negatives: temp-dir reads, Buffer reads, JSON reads, comments and strings are not flagged', () => {
  const s = src(
    "const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'x-'));",
    "const decisions = fs.readFileSync(path.join(tmp, 'decisions.md'), 'utf8');",
    "const bytes = fs.readFileSync(path.join(__dirname, 'a.md'));",
    "const hooks = fs.readFileSync(path.join(__dirname, '..', 'plugin', 'hooks', 'hooks.json'), 'utf8');",
    "const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'policy.yml'), 'utf8'));",
    "// fs.readFileSync(path.join(__dirname, 'a.md'), 'utf8')",
    "const msg = \"fs.readFileSync(path.join(__dirname, 'a.md'), 'utf8')\";",
  );
  assert.deepEqual(offenderLines(s), []);
  assert.deepEqual(
    scanRawMarkdownReads(s).sites.map((x) => [x.line, x.kind]),
    [[L(4), 'json'], [L(5), 'json']],
  );
});

test('a raw read of other tracked text (a .js source, an .html template, a .sh script) is flagged as text', () => {
  const s = src(
    "const a = fs.readFileSync(path.join(__dirname, '..', 'plugin', 'bin', 'verify.js'), 'utf8');",
    "const b = fs.readFileSync(path.join(__dirname, '..', 'plugin', 'skills', 'x', 'template.html'), 'utf8');",
    "const c = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'claude-cloud-setup.sh'), 'utf8');",
    "const d = fs.readFileSync(path.join(__dirname, 'mixed.json.txt'), 'utf8');",
  );
  assert.deepEqual(
    scanRawMarkdownReads(s).sites.map((x) => [x.line, x.kind]),
    [[L(1), 'text'], [L(2), 'text'], [L(3), 'text'], [L(4), 'text']],
  );
});

test('a name reused for a temp dir and the repo root is judged by its nearest preceding binding', () => {
  const s = src(
    "test('a', () => { const dir = path.join(__dirname, '..', 'plugin');",
    "  fs.readFileSync(path.join(dir, 'x.md'), 'utf8'); });",
    "test('b', () => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'x-'));",
    "  fs.readFileSync(path.join(dir, 'decisions.md'), 'utf8'); });",
  );
  assert.deepEqual(offenderLines(s), [L(2)]);
});

test('taint stops at a content call: a value read from a repo file is not a repo path', () => {
  const s = src(
    "const log = readText(path.join(__dirname, 'fixtures', 'a.txt'));",
    'const repo = makeFixtureRepo({ log });',
    "const runDir = path.join(repo, 'run');",
    "const decisions = fs.readFileSync(path.join(runDir, 'decisions.md'), 'utf8');",
  );
  assert.deepEqual(offenderLines(s), []);
});

test('a CRLF test source reports the same lines as its LF form', () => {
  const lf = src("const ROOT = path.join(__dirname, '..');", '', "const t = fs.readFileSync(path.join(ROOT, 'x.md'), 'utf8');");
  const crlf = lf.replace(/\n/g, '\r\n');
  assert.ok(crlf.includes('\r\n') && !crlf.includes('\r\r\n'));
  assert.deepEqual(offenderLines(crlf), offenderLines(lf));
  assert.deepEqual(offenderLines(lf), [L(3)]);
});

test('a planted stripper mis-parse is reported, not read as a clean file', () => {
  // `if (x) /[/*]/` — a regex after `)` is read as division, so its `/*` opens a
  // comment that blanks the raw read on the next line.
  const s = src('if (x) /[/*]/.test(x);', "const t = fs.readFileSync(path.join(__dirname, 'a.md'), 'utf8'); /* c */");
  const result = scanRawMarkdownReads(s);
  assert.equal(result.verdict, 'misparsed');
  assert.deepEqual(result.sites, [], 'the blanked read is invisible to the matcher, which is why the verdict must be an offender');
});

// ── Live corpus ──────────────────────────────────────────────────────────────

test('the walk covers the tests tree (floor on files walked)', () => {
  assert.ok(corpus().length > 800, `walked only ${corpus().length} test files — the walk lost part of tests/`);
});

test('every test file strips to compilable code, so no read is hidden by a mis-parse', () => {
  const bad = corpus().filter((f) => f.verdict !== 'ok').map((f) => `${f.rel}: ${STRIPPER_VERDICT_MESSAGES[f.verdict]}`);
  assert.deepEqual(bad, []);
});

test('no test file reads a repo-rooted markdown path through a raw readFileSync (route it through tests/helpers/read-skill.js readText)', () => {
  const drift = [];
  for (const f of corpus()) {
    const lines = f.sites.filter((s) => s.via === 'raw' && s.kind !== 'json').map((s) => s.line);
    const allowed = ALLOWLIST[f.rel] ? ALLOWLIST[f.rel].count : 0;
    if (lines.length !== allowed) drift.push(`${f.rel}: ${lines.length} raw read(s) at line(s) ${lines.join(', ')}; allowlisted ${allowed}`);
  }
  assert.deepEqual(drift, []);
});

test('every allowlist entry names an existing test file and a reason', () => {
  const rels = new Set(corpus().map((f) => f.rel));
  for (const [rel, entry] of Object.entries(ALLOWLIST)) {
    assert.ok(rels.has(rel), `ALLOWLIST names ${rel}, which the walk did not find`);
    assert.ok(Number.isInteger(entry.count) && entry.count > 0, `ALLOWLIST ${rel}: count must be a positive integer`);
    assert.ok(typeof entry.reason === 'string' && entry.reason.trim().length > 20, `ALLOWLIST ${rel}: reason missing`);
  }
});

test('the scan still sees the repo-rooted reads it saw when it landed (floor on matched sites)', () => {
  const total = corpus().reduce((n, f) => n + f.sites.length, 0);
  assert.ok(total >= ROOTED_READ_FLOOR, `matched ${total} repo-rooted reads, floor ${ROOTED_READ_FLOOR}: the taint or the call matcher stopped matching`);
});
