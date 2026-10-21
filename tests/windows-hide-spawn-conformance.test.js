'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { stripComments, stripperVerdict, STRIPPER_VERDICT_MESSAGES } = require('./helpers/strip-comments');

// Every child_process call under plugin/bin/ must pass `windowsHide: true`.
// Node defaults the flag to FALSE, and on Windows a console child of a parent
// that has no console to inherit (the detached `reconcile-background` pass,
// visual-decide's detached daemon, a statusline or hook launched by a host
// with no console) is given a visible console of its own — with Windows
// Terminal as the default terminal, one Terminal window flashing open and shut
// per spawn. The flag was fixed one funnel at a time twice (v6.98.0's runGit,
// then cbc2bd544's reconcile spawn sites) and both passes missed sites — this
// test makes the rule mechanical instead of a per-site memory.
//
// A call satisfies the rule when its argument text names `windowsHide`, or its
// last argument is a bare identifier whose own `const|let|var X = { ... }`
// object literal in the same file does (policy-schema.js's shared execOpts).
//
// A call counts as a child_process call when it goes through an identifier bound
// to a child_process function too — a parameter default or alias assignment such
// as `execImpl = execFileSync` or `run = cp.execFileSync` (the injected-runner
// seam, e.g. report.js's `gitInfo(execImpl = execFileSync)`).
const BIN_ROOT = path.join(__dirname, '..', 'plugin', 'bin');
const FNS = ['execFileSync', 'execSync', 'spawnSync', 'spawn', 'execFile', 'exec', 'fork'];

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

// Comments blanked in one literal-aware pass — see tests/helpers/strip-comments.js
// — so a comment that mentions windowsHide — or a call shape — never counts either way.

// Text between the paren at `open` and its matching close paren.
function balanced(src, open, openCh = '(', closeCh = ')') {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === openCh) depth++;
    else if (src[i] === closeCh && --depth === 0) return src.slice(open + 1, i);
  }
  return src.slice(open + 1);
}

function lastTopLevelArg(args) {
  let depth = 0;
  let start = 0;
  for (let i = 0; i < args.length; i++) {
    const c = args[i];
    if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) depth--;
    else if (c === ',' && depth === 0) start = i + 1;
  }
  return args.slice(start).trim();
}

function identifierHidesWindow(src, name) {
  const m = new RegExp(`(?:const|let|var)\\s+${name}\\s*=\\s*\\{`).exec(src);
  if (!m) return false;
  return /windowsHide/.test(balanced(src, m.index + m[0].length - 1, '{', '}'));
}

// -> [{ line, args }] for every child_process call in `raw` lacking the flag.
function unhiddenCalls(raw) {
  if (!/child_process/.test(raw)) return [];
  const src = stripComments(raw);
  const verdict = stripperVerdict(raw, src);
  const local = new Set();
  for (const m of src.matchAll(/(?:const|let|var)\s*\{([^}]*)\}\s*=\s*require\(\s*['"](?:node:)?child_process['"]\s*\)/g)) {
    for (const part of m[1].split(',')) {
      const [orig, alias] = part.split(':').map((s) => s.trim());
      if (FNS.includes(orig)) local.add(alias || orig);
    }
  }
  const objs = new Set();
  for (const m of src.matchAll(/(?:const|let|var)\s+(\w+)\s*=\s*require\(\s*['"](?:node:)?child_process['"]\s*\)/g)) objs.add(m[1]);
  // A parameter default or alias bound to a child_process function (`execImpl = execFileSync`,
  // `run = cp.execFileSync`, `exec = deps.execFileSync || execFileSync`,
  // `spawnImpl = require('child_process').spawn`) spawns the same way, so its identifier joins
  // the bare-name alternation. A line end also terminates the binding (a semicolon-less alias).
  const refs = [...local, ...[...objs].map((o) => `${o}\\.(?:${FNS.join('|')})`),
    `require\\(\\s*['"](?:node:)?child_process['"]\\s*\\)\\.(?:${FNS.join('|')})`];
  const binding = new RegExp(`([A-Za-z_$][\\w$]*)\\s*=\\s*(?:[^=;,\\n]*?(?:\\|\\||\\?\\?)\\s*)?(?:${refs.join('|')})\\s*[,)};\\n]`, 'g');
  for (const m of src.matchAll(binding)) local.add(m[1]);
  const alts = [`require\\(\\s*['"](?:node:)?child_process['"]\\s*\\)\\.(?:${FNS.join('|')})`];
  if (objs.size) alts.push(`\\b(?:${[...objs].join('|')})\\.(?:${FNS.join('|')})`);
  if (local.size) alts.push(`(?<![.\\w])(?:${[...local].join('|')})`);
  const re = new RegExp(`(?:${alts.join('|')})\\s*\\(`, 'g');
  const out = [];
  for (const m of src.matchAll(re)) {
    if (/function\s*$/.test(src.slice(Math.max(0, m.index - 9), m.index))) continue; // a declaration, not a call
    const args = balanced(src, m.index + m[0].length - 1);
    if (/windowsHide/.test(args)) continue;
    const last = lastTopLevelArg(args);
    if (/^[A-Za-z_$][\w$]*$/.test(last) && identifierHidesWindow(src, last)) continue;
    out.push({ line: src.slice(0, m.index).split('\n').length, args: args.replace(/\s+/g, ' ').slice(0, 100) });
  }
  if (verdict !== 'ok') out.push({ line: 0, args: STRIPPER_VERDICT_MESSAGES[verdict] });
  return out;
}

test('scanner flags an unhidden call and accepts the hidden shapes (proves it can go red)', () => {
  const flagged = unhiddenCalls([
    "const { execFileSync, spawn: sp } = require('child_process');",
    "execFileSync('git', ['status'], { encoding: 'utf8' });",
    "sp(process.execPath, [f], { detached: true, stdio: 'ignore' }); // windowsHide mentioned only in a comment",
  ].join('\n'));
  assert.deepEqual(flagged.map((f) => f.line), [2, 3]);

  // A `/*` inside a string literal or a // comment must not open a fake block
  // comment that blanks the unhidden call after it; nor may a regex literal
  // ending in an escaped slash blank the rest of its line.
  const afterFakeOpeners = unhiddenCalls([
    "const cp = require('child_process');",
    '// see staged/** here',
    "cp.execFileSync('git', ['a'], { encoding: 'utf8' });",
    '// */',
    "const g = '/*';",
    "cp.execFileSync('git', ['x'], { encoding: 'utf8' });",
    "const n = ref.replace(/^origin\\//, ''); cp.execFileSync('git', ['y'], {});",
  ].join('\n'));
  assert.deepEqual(afterFakeOpeners.map((f) => f.line), [3, 6, 7]);

  assert.deepEqual(unhiddenCalls([
    "const cp = require('child_process');",
    "const opts = { cwd: root, windowsHide: true };",
    "cp.execFileSync('git', ['status'], opts);",
    "cp.execFileSync('gh', args, {",
    "  encoding: 'utf8',",
    "  windowsHide: true,",
    "});",
    "require('child_process').execSync('git --version', { stdio: 'ignore', windowsHide: true });",
    "function execFile(x) { return x; }",
    "const m = /x/.exec(text);",
  ].join('\n')), []);
});

test('a comment-stripper mis-parse is reported, not passed as a file with no calls', () => {
  assert.deepEqual(unhiddenCalls([
    "const cp = require('child_process');",
    "if (cp) /'/.test(cp); const b = 'p//q'; cp.execFileSync('git', [b], {});",
  ].join('\n')), [{ line: 0, args: 'the comment stripper mis-parsed this file: the stripped text no longer compiles, so live code was blanked and cannot be scanned — see tests/helpers/strip-comments.js' }]);
  assert.deepEqual(unhiddenCalls("const cp = require('child_process'); const = ;"),
    [{ line: 0, args: 'this file does not compile as a CommonJS module, so the comment-stripper check cannot judge it — see tests/helpers/strip-comments.js' }]);
});

test('scanner sees a child_process function reached through a parameter default or alias (#3854)', () => {
  const lines = (src) => unhiddenCalls(src).map((f) => f.line);
  const defaulted = "const { execFileSync } = require('child_process');\nfunction gitInfo(execImpl = execFileSync) { execImpl('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }); }";
  assert.deepEqual(lines(defaulted), [2]);
  assert.deepEqual(lines(defaulted.replace("{ encoding: 'utf8' }", "{ encoding: 'utf8', windowsHide: true }")), []);
  assert.deepEqual(lines("const cp = require('child_process');\nfunction f(run = cp.execFileSync) { run('git', []); }"), [2]);
  assert.deepEqual(lines("const { execFileSync } = require('child_process');\nconst run = execFileSync;\nrun('git', ['x']);"), [3]);
  // `exec` aliased to a child_process function: method calls on other objects
  // (`/x/.exec(`, `other.exec(`) must not match the bare alias.
  assert.deepEqual(lines("const { execFileSync } = require('child_process');\nconst exec = execFileSync;\nconst m = /x/.exec(text);\nother.exec('a', {});\nexec('git', ['x'], {});"), [5]);
  // An injectable fallback (`deps.x || fn`, `deps.x ?? fn`), a require-expression
  // default, and a semicolon-less alias bind the same way.
  assert.deepEqual(lines("const { execFileSync } = require('child_process');\nfunction g(deps = {}) {\n  const exec = deps.execFileSync || execFileSync;\n  exec('gh', ['--version'], { stdio: 'ignore' });\n}"), [4]);
  assert.deepEqual(lines("const { execFileSync } = require('child_process');\nconst run = deps.run ?? execFileSync;\nrun('git', []);"), [3]);
  assert.deepEqual(lines("function r({ spawnImpl = require('child_process').spawn } = {}) {\n  spawnImpl('npm test', { shell: true });\n}"), [2]);
  assert.deepEqual(lines("const { execFileSync } = require('child_process')\nconst run = execFileSync\nrun('git', ['x'])"), [3]);
});

test('report.js carries windowsHide on all three git spawns, and removing any one is caught (#3854)', () => {
  const raw = fs.readFileSync(path.join(BIN_ROOT, 'lib', 'verify', 'report.js'), 'utf8');
  const needle = 'windowsHide: true';
  const at = [];
  for (let i = raw.indexOf(needle); i !== -1; i = raw.indexOf(needle, i + 1)) at.push(i);
  assert.strictEqual(at.length, 3);
  for (const i of at) {
    const variant = raw.slice(0, i).replace(/,\s*$/, '') + raw.slice(i + needle.length);
    assert.strictEqual(unhiddenCalls(variant).length, 1, `removing the occurrence at offset ${i} must leave exactly one unhidden call`);
  }
});

test('every child_process call under plugin/bin/ passes windowsHide', () => {
  const offenders = [];
  for (const file of walk(BIN_ROOT)) {
    for (const call of unhiddenCalls(fs.readFileSync(file, 'utf8'))) {
      offenders.push(`${path.relative(BIN_ROOT, file).replace(/\\/g, '/')}:${call.line}  (${call.args})`);
    }
  }
  assert.deepEqual(offenders, [],
    'add `windowsHide: true` to these spawns — without it a console-less parent opens a visible console window per spawn on Windows');
});
