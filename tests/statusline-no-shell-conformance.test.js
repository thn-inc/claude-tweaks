'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { stripComments, stripperVerdict, STRIPPER_VERDICT_MESSAGES } = require('./helpers/strip-comments');
const { readText } = require('./helpers/read-skill');

// #5266 AC 4: the status line runs on every prompt render and launches no shell,
// so plugin/bin/claude-tweaks-statusline.js calls neither `execSync` nor `exec`.
// tests/statusline.test.js's spawn-recording test sees only what renderProject and
// renderGit launch; this scan reads the whole file.
//
// Over the file with comments blanked (literals kept), it flags:
// - every `execSync` token: a bare or destructured call, `cp.execSync`,
//   `child_process.execSync`, `require('child_process').execSync`, the bracket
//   string `['execSync']` and an alias. A message string naming it flags too.
// - an `exec` token not preceded by `.`: a bare call, `{ exec }`, `{ exec: run }`,
//   `['exec']`.
// - `.exec` on a name bound to `require('child_process')`, or on that require
//   expression itself. `.exec` on anything else, such as a RegExp, is not flagged.
// - a `shell` option, which makes execFileSync and spawn* run through a shell: a
//   `shell` key or property assigned anything but a falsy literal (`false`, `null`,
//   `undefined`, `0`, an empty string) that ends the value (`,`, `}`, `;` or `)` follows), quoted keys included, and the `{ shell }`
//   shorthand. A message string holding `shell:` flags too.
// Recall limits: `.exec` on a child_process object reached through another name (a
// parameter, a property, a deps seam) is not seen, nor a computed key such as
// `['ex' + 'ec']` or `['sh' + 'ell']`, nor a `shell` option arriving inside a spread
// (`{ ...opts }`) or an options object built in another file.
const FILE = path.join(__dirname, '..', 'plugin', 'bin', 'claude-tweaks-statusline.js');
// The import and the three git calls when this scan landed. Fewer means the read or
// the strip lost code, not that the calls went away. Raise it when sites are added.
const FLOOR = 4;
const SHELL_OPTION = /(?<![\w$])['"]?shell['"]?\s*(?::|=(?![=>]))(?!\s*(?:false|null|undefined|0|''|""|``)\s*(?=[,};)]))|(?<=[{,]\s*)shell(?=\s*[,}])/;

// -> { offenders: [{ line, text }], execFileSites }
function shellCalls(raw) {
  const src = stripComments(raw);
  const verdict = stripperVerdict(raw, src);
  const objs = [...src.matchAll(/([A-Za-z_$][\w$]*)\s*=\s*require\(\s*['"](?:node:)?child_process['"]\s*\)/g)].map((m) => m[1]);
  const owners = [`require\\(\\s*['"](?:node:)?child_process['"]\\s*\\)`, ...objs.map((o) => `(?<![\\w$.])${o}`)];
  const re = new RegExp(`\\bexecSync\\b|(?<![\\w$.])exec\\b|(?:${owners.join('|')})\\s*\\.\\s*exec\\b|${SHELL_OPTION.source}`, 'g');
  const offenders = [];
  for (const m of src.matchAll(re)) {
    const line = src.slice(0, m.index).split('\n').length;
    offenders.push({ line, text: src.split('\n')[line - 1].trim().slice(0, 100) });
  }
  if (verdict !== 'ok') offenders.push({ line: 0, text: STRIPPER_VERDICT_MESSAGES[verdict] });
  return { offenders, execFileSites: (src.match(/\bexecFileSync\b/g) || []).length };
}

const lines = (src) => shellCalls(src).offenders.map((o) => o.line);

test('scanner flags every execSync and exec call shape (proves it can go red)', () => {
  assert.deepEqual(lines([
    "const cp = require('child_process');",
    "const { execSync } = require('child_process');",
    "execSync('git status');",
    "cp.execSync('git status');",
    "child_process.execSync('git status');",
    "require('child_process').exec('git status', cb);",
    "const { exec: run } = require('node:child_process');",
    "exec('git status', cb);",
    "cp['execSync']('git status');",
    "cp.exec('git status', cb);",
    "cp . exec('git status', cb);",
    "const { exec } = require('child_process');",
  ].join('\n')), [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
});

test('scanner ignores comments, RegExp#exec, other objects and execFileSync', () => {
  assert.deepEqual(lines([
    "const cp = require('child_process');",
    "// execSync('git status') in a comment",
    "/* exec('git status') */",
    'const m = /x/.exec(text);',
    "other.exec('a');",
    "notcp.exec('a');",
    "cp.execFileSync('git', ['status'], { windowsHide: true });",
    'const executor = 1; noexec(); execute(); execFile();',
  ].join('\n')), []);
});

test('scanner flags `.exec` on a child_process binding or require expression, never on a RegExp', () => {
  assert.deepEqual(lines([
    "const child_process = require('child_process');",
    "child_process.exec('git status', cb);",
    "const m = /x/.exec(text); child_process.exec('git status', cb);",
    "require('node:child_process').exec('git status', cb);",
    'const n = /y/.exec(text);',
  ].join('\n')), [2, 3, 4]);
});

test('scanner flags a shell option set to anything but a falsy literal', () => {
  assert.deepEqual(lines([
    "execFileSync('git', ['status'], { shell: true });",
    "spawn('git', [], { 'shell': '/bin/sh' });",
    'const o = { cwd, shell: useShell };',
    'opts.shell = true;',
    'const p = { cwd, shell };',
    "spawnSync('git', [], { \"shell\" : 1 });",
    "const q = { shell: null ?? '/bin/sh' };",
    'const r = { shell: false || x };',
  ].join('\n')), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual(lines([
    "execFileSync('git', ['status'], { shell: false, windowsHide: true });",
    'const a = { shell: null, b: undefined, c: 0 };',
    "const d = { shell: '' };",
    'const shellOut = 1; const noshell = { shellish: true };',
    'if (x.shell === true) f(shell => shell);',
    'opts.shell = false;',
    'const e = { shell: false };',
    '// { shell: true } in a comment',
  ].join('\n')), []);
});

test('scanner still sees a call after a literal holding a comment opener', () => {
  assert.deepEqual(lines([
    "const g = '/*';",
    "execSync('git status');",
    "const n = ref.replace(/^origin\\//, ''); exec('git status');",
  ].join('\n')), [2, 3]);
});

test('a comment-stripper mis-parse is reported, not passed as a file with no calls', () => {
  assert.deepEqual(shellCalls([
    "const cp = require('child_process');",
    "if (cp) /'/.test(cp); const b = 'p//q'; cp.execSync(b);",
  ].join('\n')).offenders, [{ line: 0, text: STRIPPER_VERDICT_MESSAGES.misparsed }]);
  assert.deepEqual(shellCalls("const cp = require('child_process'); const = ;").offenders,
    [{ line: 0, text: STRIPPER_VERDICT_MESSAGES.unparseable }]);
});

test('claude-tweaks-statusline.js calls neither execSync nor exec, and passes no shell option', () => {
  const raw = readText(FILE);
  const { offenders, execFileSites } = shellCalls(raw);
  assert.deepEqual(offenders, [], 'the status line must launch no shell: use execFileSync with an argv array and no shell option');
  assert.ok(execFileSites >= FLOOR, `expected at least ${FLOOR} execFileSync sites, saw ${execFileSites}: the scan lost code`);
  // The same text with one exec call added goes red at that line.
  const added = `${raw}\nrequire('child_process').execSync('git status');\n`;
  assert.deepEqual(shellCalls(added).offenders.map((o) => o.line), [added.split('\n').length - 1]);
});
