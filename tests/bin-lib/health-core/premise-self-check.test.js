'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  premiseReadsUnresolved, defaultRunner, posixShell, PREMISE_SELF_CHECK_TIMEOUT_MS,
} = require('../../../plugin/bin/lib/health-core/premise-self-check');
const { buildPremiseCheck } = require('../../../plugin/bin/lib/harness-health/issue-payload');
const { readText } = require('../../helpers/read-skill');

// Temp dir name deliberately contains a space — the composed command
// shQuotes the target path, and this proves the quoting survives a real shell.
function tmpWithSpace() { return fs.mkdtempSync(path.join(os.tmpdir(), 'premise self-check-')); }

test('exit 0 reads as unresolved (keep the line)', () => {
  assert.strictEqual(premiseReadsUnresolved('cmd', { root: '/', runner: () => 0 }), true);
});

test('a non-zero exit reads as resolved (drop the line)', () => {
  assert.strictEqual(premiseReadsUnresolved('cmd', { root: '/', runner: () => 1 }), false);
  assert.strictEqual(premiseReadsUnresolved('cmd', { root: '/', runner: () => 2 }), false);
});

test('a timeout drops the line, never keeps it', () => {
  const runner = () => { const e = new Error('spawnSync /bin/sh ETIMEDOUT'); e.code = 'ETIMEDOUT'; e.signal = 'SIGTERM'; throw e; };
  assert.strictEqual(premiseReadsUnresolved('cmd', { root: '/', runner }), false);
});

test('a spawn error drops the line, never keeps it', () => {
  const runner = () => { const e = new Error('spawnSync /bin/sh ENOENT'); e.code = 'ENOENT'; throw e; };
  assert.strictEqual(premiseReadsUnresolved('cmd', { root: '/', runner }), false);
});

test('the runner receives the command, the root as cwd, and the timeout', () => {
  const calls = [];
  premiseReadsUnresolved('echo hi', { root: '/some/root', runner: (c, o) => { calls.push([c, o]); return 0; } });
  assert.deepStrictEqual(calls, [['echo hi', { cwd: '/some/root', timeoutMs: PREMISE_SELF_CHECK_TIMEOUT_MS }]]);
});

test('materialize.js runs Premise-check commands through this module, not a copy of it', () => {
  // Structural parity: the filing-time self-check reads a command "the way
  // materialize will" only while both use one runner and one timeout.
  const src = readText(path.join(__dirname, '../../../plugin/bin/materialize.js'));
  assert.match(src, /require\('\.\/lib\/health-core\/premise-self-check'\)/);
  assert.doesNotMatch(src, /PREMISE_CHECK_TIMEOUT_MS\s*=/);
  assert.doesNotMatch(src, /execFileSync\('\/bin\/sh'/);
  assert.strictEqual(PREMISE_SELF_CHECK_TIMEOUT_MS, 5000);
});

test('real shell: an additive check whose anchor already appears in the target file is dropped', () => {
  const dir = tmpWithSpace();
  const target = path.join(dir, 'auth.md');
  fs.writeFileSync(target, '# auth\n\nSee `src/auth/session.js`.\n');
  const command = buildPremiseCheck({ kind: 'patch', newString: 'See `src/auth/session.js`.' }, target);
  assert.strictEqual(defaultRunner(command, { cwd: dir, timeoutMs: 5000 }), 1);
  assert.strictEqual(premiseReadsUnresolved(command, { root: dir }), false);
});

test('real shell: an additive check whose anchor is absent reads unresolved and is kept', () => {
  const dir = tmpWithSpace();
  const target = path.join(dir, 'auth.md');
  fs.writeFileSync(target, '# auth\n\nSee `src/auth/login.js`.\n');
  const command = buildPremiseCheck({ kind: 'patch', newString: 'See `src/auth/session.js`.' }, target);
  assert.strictEqual(premiseReadsUnresolved(command, { root: dir }), true);
});

test('real shell: a hung command is killed at the timeout and dropped', () => {
  const dir = tmpWithSpace();
  const start = Date.now();
  assert.strictEqual(premiseReadsUnresolved('sleep 5', { root: dir, timeoutMs: 100 }), false);
  assert.ok(Date.now() - start < 4000, 'must not wait for the full sleep');
});

// #3716: on win32 the composed command crosses Node's argv quoting into MSYS
// sh.exe, where a double quote or a backslash in the anchor is what a mangled
// command would misread. The absent-case file holds the anchor with every quote
// and backslash stripped, so a mangle that drops them reads "resolved" and fails.
const QUOTING_ANCHORS = [
  ['a double quote', 'Run "npm test" first.'],
  ['a backslash', 'Paths look like C:\\Users\\me\\repo.'],
  ['a single quote', "Don't skip the hook."],
  ['a backslash before a double quote', 'Escape it as \\" inside strings.'],
  ['a trailing backslash', 'The line continues with \\'],
];

for (const [label, anchor] of QUOTING_ANCHORS) {
  test(`AC1.1/AC2.1/AC2.2: real shell: an anchor containing ${label} reads unresolved while absent and resolved once present`, () => {
    const dir = tmpWithSpace();
    const target = path.join(dir, 'guide.md');
    fs.writeFileSync(target, `# guide\n\n${anchor.replace(/["'\\]/g, '')}\n`);
    const command = buildPremiseCheck({ kind: 'patch', newString: anchor }, target, dir);
    assert.strictEqual(defaultRunner(command, { cwd: dir, timeoutMs: 5000 }), 0);
    assert.strictEqual(premiseReadsUnresolved(command, { root: dir }), true);
    fs.writeFileSync(target, `# guide\n\n${anchor}\n`);
    assert.strictEqual(defaultRunner(command, { cwd: dir, timeoutMs: 5000 }), 1);
    assert.strictEqual(premiseReadsUnresolved(command, { root: dir }), false);
  });
}

test('defaultRunner returns the exit code of a command that ran', () => {
  assert.strictEqual(defaultRunner('exit 0', { cwd: os.tmpdir(), timeoutMs: 5000 }), 0);
  assert.strictEqual(defaultRunner('exit 3', { cwd: os.tmpdir(), timeoutMs: 5000 }), 3);
});

test('AC4.1: real shell: a repo-relative command composed with root resolves at filing time (cwd: root)', () => {
  const dir = tmpWithSpace();
  fs.mkdirSync(path.join(dir, '.claude', 'skills'), { recursive: true });
  const target = path.join(dir, '.claude', 'skills', 'auth.md');
  fs.writeFileSync(target, '# auth\n\nSee `src/auth/login.js`.\n');
  const command = buildPremiseCheck({ kind: 'patch', newString: 'See `src/auth/session.js`.' }, target, dir);
  assert.ok(!command.includes(dir), 'the command carries no absolute root');
  assert.strictEqual(premiseReadsUnresolved(command, { root: dir }), true);
  fs.writeFileSync(target, '# auth\n\nSee `src/auth/session.js`.\n');
  assert.strictEqual(premiseReadsUnresolved(command, { root: dir }), false);
});

test('AC3.1: posixShell picks sh from PATH on win32 and exactly /bin/sh elsewhere', () => {
  assert.strictEqual(posixShell('win32'), 'sh');
  assert.strictEqual(posixShell('linux'), '/bin/sh');
  assert.strictEqual(posixShell('darwin'), '/bin/sh');
});

test('AC3.1: defaultRunner spawns posixShell(platform) through the injected exec, with windowsHide', () => {
  for (const [platform, shell] of [['win32', 'sh'], ['linux', '/bin/sh']]) {
    const calls = [];
    const exec = (...args) => { calls.push(args); };
    assert.strictEqual(defaultRunner('echo hi', { cwd: '/r', timeoutMs: 7, platform, exec }), 0);
    assert.deepStrictEqual(calls, [[shell, ['-c', 'echo hi'], { cwd: '/r', stdio: 'ignore', timeout: 7, windowsHide: true }]]);
  }
});

test('defaultRunner returns a thrown numeric status and re-throws a spawn error with no status (injected exec)', () => {
  const exitExec = () => { throw Object.assign(new Error('exit'), { status: 3 }); };
  assert.strictEqual(defaultRunner('cmd', { cwd: '/r', timeoutMs: 7, platform: 'linux', exec: exitExec }), 3);
  const spawnExec = () => { throw Object.assign(new Error('spawn sh ENOENT'), { code: 'ENOENT' }); };
  assert.throws(() => defaultRunner('cmd', { cwd: '/r', timeoutMs: 7, platform: 'win32', exec: spawnExec }), { code: 'ENOENT' });
});
