'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

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

// Blank out comments (preserving offsets and newlines) so a comment that
// mentions windowsHide — or a call shape — never counts either way.
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:'"`\\])\/\/[^\n]*/g, (m, lead) => lead + ' '.repeat(m.length - lead.length));
}

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
  const local = new Set();
  for (const m of src.matchAll(/(?:const|let|var)\s*\{([^}]*)\}\s*=\s*require\(\s*['"](?:node:)?child_process['"]\s*\)/g)) {
    for (const part of m[1].split(',')) {
      const [orig, alias] = part.split(':').map((s) => s.trim());
      if (FNS.includes(orig)) local.add(alias || orig);
    }
  }
  const objs = new Set();
  for (const m of src.matchAll(/(?:const|let|var)\s+(\w+)\s*=\s*require\(\s*['"](?:node:)?child_process['"]\s*\)/g)) objs.add(m[1]);
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
  return out;
}

test('scanner flags an unhidden call and accepts the hidden shapes (proves it can go red)', () => {
  const flagged = unhiddenCalls([
    "const { execFileSync, spawn: sp } = require('child_process');",
    "execFileSync('git', ['status'], { encoding: 'utf8' });",
    "sp(process.execPath, [f], { detached: true, stdio: 'ignore' }); // windowsHide mentioned only in a comment",
  ].join('\n'));
  assert.deepEqual(flagged.map((f) => f.line), [2, 3]);

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
