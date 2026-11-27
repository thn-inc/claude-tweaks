'use strict';
const { test, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { runCliSync, spawnCli } = require('../../helpers/run-cli');
const { failurePath } = require('../../../plugin/bin/lib/model-profiles/session-failures');

const CLI = path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'resolve-profile.js');

// Every pre-#763 test predates resolve-profile.js reading
// CLAUDE_CODE_SESSION_ID at all, so none of them isolate from it. Now that a
// normal (non-record-failure) resolution reads the session's failure
// blacklist, an ambient CLAUDE_CODE_SESSION_ID (this dev session has a real
// one; per the Subagent Contract, parallel Task dispatches can share one
// parent session id) would let a genuine sibling-recorded failure make these
// tests nondeterministic. Strip it by default so these calls are hermetic
// regardless of the caller's environment.
function isolatedEnv() {
  const env = { ...process.env };
  delete env.CLAUDE_CODE_SESSION_ID;
  return env;
}

// Every directory a test makes (project dirs and failure-file dirs) is tracked here
// and removed by the afterEach below.
const madeTmpDirs = [];

function tmpProject(policyText) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mp-cli-'));
  madeTmpDirs.push(dir);
  if (policyText !== null) {
    fs.mkdirSync(path.join(dir, '.claude-tweaks'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.claude-tweaks', 'policy.yml'), policyText);
  }
  return dir;
}

// A per-test directory the CLI writes its session-failure files under (deps.tmpDir);
// removed after the test that made it.
function tmpDirFor() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mp-cli-tmp-'));
  madeTmpDirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of madeTmpDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

// One in-process call -> { code, stdout, stderr }. The failure-file directory is
// created only if the CLI asks for one, so a call that never touches it leaves none.
function call(args, cwd, { env = isolatedEnv(), tmp } = {}) {
  let dir = tmp;
  return runCliSync(CLI, args, { env, cwd, deps: { tmpDir: () => { dir = dir || tmpDirFor(); return dir; } } });
}

// A successful resolution -> the parsed JSON line.
function run(args, cwd, opts) {
  const r = call(args, cwd, opts);
  assert.strictEqual(r.code, 0, r.stderr);
  return JSON.parse(r.stdout);
}

// Skills paste this stdout into Agent calls; proves one JSON line and the flush on exit 0.
test('AC8.1: resolve-profile.js <profile> prints exactly one JSON line (script entry)', () => {
  const dir = tmpProject(null);
  const r = spawnCli(CLI, ['standard'], { env: isolatedEnv(), cwd: dir });
  assert.strictEqual(r.code, 0);
  assert.strictEqual(r.stderr, '');
  assert.strictEqual(
    r.stdout,
    '{"model":"sonnet","effort":"high","source":"default","effortLine":"[Effort: high — apply high-level reasoning depth to this task.]","launchEffort":null}\n',
  );
  const lines = r.stdout.split('\n');
  assert.strictEqual(lines.length, 2);
  assert.strictEqual(lines[1], '');
});

// Proves the refusal exit code survives the real entry, and that the in-process
// call (identical env) gives the same code, stdout and stderr as the script.
test('AC3.1, AC8.1: --stance with no value exits 1 naming the flag, in-process matching the script entry', () => {
  const dir = tmpProject(null);
  const env = isolatedEnv();
  const spawned = spawnCli(CLI, ['standard', '--stance'], { env, cwd: dir });
  assert.strictEqual(spawned.code, 1);
  assert.strictEqual(spawned.stdout, '');
  assert.strictEqual(spawned.stderr, 'resolve-profile: --stance requires a value\n');
  const r = call(['standard', '--stance'], dir, { env });
  assert.deepStrictEqual(r, { code: spawned.code, stdout: spawned.stdout, stderr: spawned.stderr });
});

test('AC2.1: a preset process.exitCode does not stop a valid --stance resolution', () => {
  const dir = tmpProject(null);
  const prior = process.exitCode;
  process.exitCode = 1;
  let r;
  try {
    r = call(['standard', '--stance', 'default'], dir);
  } finally {
    process.exitCode = prior;
  }
  assert.strictEqual(r.code, 0, r.stderr);
  assert.strictEqual(typeof JSON.parse(r.stdout).model, 'string');
});

test('AC6.1: require() prints nothing and leaves process.exitCode undefined', () => {
  delete require.cache[require.resolve(CLI)];
  const writes = [];
  const outWrite = process.stdout.write;
  const errWrite = process.stderr.write;
  const before = process.exitCode;
  process.stdout.write = (t) => { writes.push(t); return true; };
  process.stderr.write = (t) => { writes.push(t); return true; };
  try {
    require(CLI);
  } finally {
    process.stdout.write = outWrite;
    process.stderr.write = errWrite;
  }
  assert.deepStrictEqual(writes, []);
  assert.strictEqual(process.exitCode, before);
  assert.strictEqual(process.exitCode, undefined);
});

test('AC9.1: record-failure reads CLAUDE_CODE_SESSION_ID from the injected env and writes under the injected tmpDir', () => {
  const dir = tmpProject(null);
  const tmp = tmpDirFor();
  const sessionId = 'cli-test-inj';
  assert.notStrictEqual(process.env.CLAUDE_CODE_SESSION_ID, sessionId);
  const env = { ...isolatedEnv(), CLAUDE_CODE_SESSION_ID: sessionId };
  const r = call(['record-failure', 'opus'], dir, { env, tmp });
  assert.strictEqual(r.code, 0, r.stderr);
  assert.strictEqual(r.stdout, `{"recorded":true,"model":"opus","sessionId":"${sessionId}"}\n`);
  assert.ok(fs.existsSync(failurePath(sessionId, tmp)), 'the failure file lands under the injected tmpDir');
});

test('resolves from the table when no policy file exists', () => {
  const dir = tmpProject(null);
  assert.deepStrictEqual(run(['standard'], dir), {
    model: 'sonnet', effort: 'high', source: 'default',
    effortLine: '[Effort: high — apply high-level reasoning depth to this task.]',
    launchEffort: null,
  });
});

test('model-effort: profile prints launchEffort for the resolved effort', () => {
  const dir = tmpProject('model-effort: profile\n');
  assert.strictEqual(run(['standard'], dir).launchEffort, 'high');
  const r = call(['standard'], dir);
  assert.match(r.stdout, /"launchEffort":"high"/);
});

test('model-effort with an unknown value exits 1 naming it', () => {
  const dir = tmpProject('model-effort: sometimes\n');
  const r = call(['standard'], dir);
  assert.strictEqual(r.code, 1);
  assert.match(r.stderr, /sometimes/);
});

test('reads policy.yml from cwd and applies rows and stance', () => {
  const dir = tmpProject('model-profiles:\n  standard:\n    model: opus\n    effort: low\n');
  assert.strictEqual(run(['standard'], dir).model, 'opus');
  assert.strictEqual(run(['standard', '--stance', 'economy'], dir).effort, 'low'); // already at floor
});

test('frontier tally: counts prior lines, appends on frontier result only', () => {
  const dir = tmpProject(null);
  const runDir = path.join(dir, 'run');
  fs.mkdirSync(runDir);
  const tally = path.join(runDir, 'frontier-tally.log');
  const first = run(['frontier', '--run-dir', runDir], dir);
  assert.strictEqual(first.model, 'fable');
  assert.strictEqual(fs.readFileSync(tally, 'utf8').split('\n').filter(Boolean).length, 1);
  run(['frontier', '--run-dir', runDir], dir);
  run(['frontier', '--run-dir', runDir], dir);
  // fourth resolution hits the default cap of 3 → degraded, no new line
  const fourth = run(['frontier', '--run-dir', runDir], dir);
  assert.strictEqual(fourth.source, 'degraded:cap');
  assert.strictEqual(fs.readFileSync(tally, 'utf8').split('\n').filter(Boolean).length, 3);
});

// The six tests above only ever write frontier-prefixed lines, so a mutation
// probe found the `startsWith('frontier\t')` filter unguarded — counting every
// non-empty line passed all of them. Three unrelated lines must not read as
// three frontier uses against the cap.
test('frontier tally counts only frontier-prefixed lines', () => {
  const dir = tmpProject(null);
  const runDir = path.join(dir, 'run');
  fs.mkdirSync(runDir);
  fs.writeFileSync(path.join(runDir, 'frontier-tally.log'), 'note\ta\nnote\tb\nnote\tc\n');
  assert.strictEqual(run(['frontier', '--run-dir', runDir], dir).model, 'fable');
});

test('--unattended degrades frontier and appends nothing', () => {
  const dir = tmpProject(null);
  const runDir = path.join(dir, 'run');
  fs.mkdirSync(runDir);
  const r = run(['frontier', '--unattended', '--run-dir', runDir], dir);
  assert.strictEqual(r.source, 'degraded:unattended');
  assert.ok(!fs.existsSync(path.join(runDir, 'frontier-tally.log')));
});

test('unknown profile exits non-zero naming it', () => {
  const dir = tmpProject(null);
  const r = call(['turbo'], dir);
  assert.notStrictEqual(r.code, 0);
  assert.match(r.stderr, /turbo/);
});

test('a value-taking flag at end-of-args exits 1 naming the flag', () => {
  const dir = tmpProject(null);
  const stance = call(['standard', '--stance'], dir);
  assert.strictEqual(stance.code, 1);
  assert.match(stance.stderr, /--stance requires a value/);
  const runDir = call(['standard', '--run-dir'], dir);
  assert.strictEqual(runDir.code, 1);
  assert.match(runDir.stderr, /--run-dir requires a value/);
});

test('a value-taking flag does not swallow the following flag as its value', () => {
  const dir = tmpProject(null);
  const r = call(['frontier', '--stance', '--unattended', '--run-dir', '/tmp/x'], dir);
  assert.strictEqual(r.code, 1);
  assert.match(r.stderr, /--stance requires a value/);
});

test('a failing tally append exits 1 naming the problem, with no stack trace', () => {
  const dir = tmpProject(null);
  const missing = path.join(dir, 'no', 'such', 'dir');
  const r = call(['frontier', '--run-dir', missing], dir);
  assert.strictEqual(r.code, 1);
  assert.match(r.stderr, /cannot append frontier tally/);
  assert.doesNotMatch(r.stderr, /\n\s+at /); // no stack frames
});

test('AC9.1: a relative --run-dir reads and appends the tally against the injected cwd', () => {
  const dir = tmpProject(null);
  fs.mkdirSync(path.join(dir, 'run'));
  // The runner's real cwd has no `run`; only deps.cwd() can find the tally's directory.
  assert.strictEqual(run(['frontier', '--run-dir', 'run'], dir).model, 'fable');
  assert.strictEqual(fs.readFileSync(path.join(dir, 'run', 'frontier-tally.log'), 'utf8').split('\n').filter(Boolean).length, 1);
  assert.strictEqual(run(['frontier', '--run-dir', 'run'], dir).model, 'fable');
  assert.strictEqual(fs.readFileSync(path.join(dir, 'run', 'frontier-tally.log'), 'utf8').split('\n').filter(Boolean).length, 2);
});

test('output: a failing tally append prints the run-dir as typed, not the cwd-resolved path', () => {
  const dir = tmpProject(null);
  const r = call(['frontier', '--run-dir', 'no/such/dir'], dir);
  assert.strictEqual(r.code, 1);
  assert.strictEqual(r.stderr, `resolve-profile: cannot append frontier tally: ENOENT: no such file or directory, open '${path.join('no', 'such', 'dir', 'frontier-tally.log')}'\n`);
});

test('malformed policy exits non-zero naming the problem', () => {
  const dir = tmpProject('frontier-run-cap: soon\n');
  const r = call(['standard'], dir);
  assert.notStrictEqual(r.code, 0);
  assert.match(r.stderr, /soon/);
});

test('a resolution avoids a model recorded as failed this session, via CLAUDE_CODE_SESSION_ID', () => {
  const dir = tmpProject(null);
  const tmp = tmpDirFor();
  const sessionId = `cli-test-${process.pid}-fail-avoid`;
  const env = { ...process.env, CLAUDE_CODE_SESSION_ID: sessionId };
  assert.strictEqual(call(['record-failure', 'fable'], dir, { env, tmp }).code, 0);
  const r = run(['frontier'], dir, { env, tmp });
  assert.strictEqual(r.model, 'opus');
  assert.strictEqual(r.source, 'degraded:session-failure');
});

test('a resolution with no CLAUDE_CODE_SESSION_ID set is unaffected by any blacklist', () => {
  const dir = tmpProject(null);
  const r = run(['frontier'], dir);
  assert.strictEqual(r.model, 'fable');
});

test('record-failure with no model name exits 1 naming the problem', () => {
  const dir = tmpProject(null);
  const env = { ...process.env, CLAUDE_CODE_SESSION_ID: `cli-test-${process.pid}-no-model` };
  const r = call(['record-failure'], dir, { env });
  assert.strictEqual(r.code, 1);
  assert.match(r.stderr, /record-failure requires a model name/);
});

test('record-failure with no CLAUDE_CODE_SESSION_ID exits 1 naming the problem, records nothing', () => {
  const dir = tmpProject(null);
  const r = call(['record-failure', 'fable'], dir);
  assert.strictEqual(r.code, 1);
  assert.match(r.stderr, /CLAUDE_CODE_SESSION_ID/);
});

test('record-failure prints a JSON confirmation on success', () => {
  const dir = tmpProject(null);
  const sessionId = `cli-test-${process.pid}-confirm`;
  const env = { ...process.env, CLAUDE_CODE_SESSION_ID: sessionId };
  const out = run(['record-failure', 'opus'], dir, { env });
  assert.deepStrictEqual(out, { recorded: true, model: 'opus', sessionId });
});

test('record-failure rejects a model name that is not a real family alias, and records nothing', () => {
  const dir = tmpProject(null);
  const tmp = tmpDirFor();
  const sessionId = `cli-test-${process.pid}-invalid-model`;
  const env = { ...process.env, CLAUDE_CODE_SESSION_ID: sessionId };
  const bad = call(['record-failure', 'fable-5'], dir, { env, tmp });
  assert.strictEqual(bad.code, 1);
  assert.match(bad.stderr, /"fable-5" is not a known model family alias/);
  // Prove nothing was written: a subsequent frontier resolution is unaffected.
  const r = run(['frontier'], dir, { env, tmp });
  assert.strictEqual(r.model, 'fable');
  assert.strictEqual(r.source, 'default');
  assert.ok(!fs.existsSync(failurePath(sessionId, tmp)));
});

// #841 item 3: the recovery-path CLI surface for the session-failure blacklist.
test('clear-failures clears a recorded blacklist — a subsequent resolution is unaffected', () => {
  const dir = tmpProject(null);
  const tmp = tmpDirFor();
  const sessionId = `cli-test-${process.pid}-clear`;
  const env = { ...process.env, CLAUDE_CODE_SESSION_ID: sessionId };
  assert.strictEqual(call(['record-failure', 'fable'], dir, { env, tmp }).code, 0);
  const before = run(['frontier'], dir, { env, tmp });
  assert.strictEqual(before.source, 'degraded:session-failure');
  const out = run(['clear-failures'], dir, { env, tmp });
  assert.deepStrictEqual(out, { cleared: true, sessionId });
  const after = run(['frontier'], dir, { env, tmp });
  assert.strictEqual(after.model, 'fable');
  assert.strictEqual(after.source, 'default');
});

test('clear-failures with no CLAUDE_CODE_SESSION_ID exits 1 naming the problem', () => {
  const dir = tmpProject(null);
  const r = call(['clear-failures'], dir);
  assert.strictEqual(r.code, 1);
  assert.match(r.stderr, /CLAUDE_CODE_SESSION_ID/);
});

test('--diff-facts caps a capable resolution to standard on a tiny diff', () => {
  const dir = tmpProject(null);
  const r = run(['capable', '--diff-facts', JSON.stringify({ implFiles: 1, totalLines: 20 })], dir);
  assert.strictEqual(r.model, 'sonnet');
  assert.strictEqual(r.source, 'diff-ceiling');
});

test('--diff-facts is inert on a larger diff and absent entirely', () => {
  const dir = tmpProject(null);
  const larger = run(['capable', '--diff-facts', JSON.stringify({ implFiles: 3, totalLines: 20 })], dir);
  assert.strictEqual(larger.model, 'opus');
  const absent = run(['capable'], dir);
  assert.strictEqual(absent.model, 'opus');
  assert.strictEqual(absent.source, 'default');
});

test('malformed --diff-facts JSON exits 1 naming the problem, with no stack trace', () => {
  const dir = tmpProject(null);
  const r = call(['capable', '--diff-facts', '{not json'], dir);
  assert.strictEqual(r.code, 1);
  assert.match(r.stderr, /--diff-facts is not valid JSON/);
  assert.doesNotMatch(r.stderr, /\n\s+at /);
});

test('clear-failures on a session with no blacklist is a harmless no-op', () => {
  const dir = tmpProject(null);
  const tmp = tmpDirFor();
  const sessionId = `cli-test-${process.pid}-clear-absent`;
  const env = { ...process.env, CLAUDE_CODE_SESSION_ID: sessionId };
  assert.ok(!fs.existsSync(failurePath(sessionId, tmp)));
  const out = run(['clear-failures'], dir, { env, tmp });
  assert.deepStrictEqual(out, { cleared: true, sessionId });
});

// Characterization (#6351): the no-exception frontier output every installed caller reads.
test('AC5.1: no-exception frontier output is byte-identical to the pre-change CLI', () => {
  const dir = tmpProject(null);
  const runDir = path.join(dir, 'run');
  fs.mkdirSync(runDir);
  const line = (model, source) => `{"model":"${model}","effort":"high","source":"${source}","effortLine":"[Effort: high — apply high-level reasoning depth to this task.]","launchEffort":null}\n`;
  for (let i = 0; i < 3; i++) {
    const r = call(['frontier', '--run-dir', runDir], dir);
    assert.strictEqual(r.code, 0, r.stderr);
    assert.strictEqual(r.stdout, line('fable', 'default'));
    assert.strictEqual(r.stderr, '');
  }
  const fourth = call(['frontier', '--run-dir', runDir], dir);
  assert.strictEqual(fourth.code, 0, fourth.stderr);
  assert.strictEqual(fourth.stdout, line('opus', 'degraded:cap'));
});

// --- the design-reader exception (#6351) ---------------------------------

const EXC = ['frontier', '--exception', 'design-reader'];
const TALLY_FILE = 'frontier-exception-tally.log';

function sessionIn(dir, name = 'session') {
  const s = path.join(dir, name);
  fs.mkdirSync(s, { recursive: true });
  return s;
}
function tallyLines(s) {
  try { return fs.readFileSync(path.join(s, TALLY_FILE), 'utf8').split('\n').filter(Boolean); } catch { return []; }
}

test('AC1.1, AC1.2: 22 resolutions in one session dir return fable, the 23rd exits 3 with stepDown limit', () => {
  const dir = tmpProject(null);
  const s = sessionIn(dir);
  for (let i = 0; i < 22; i++) {
    const r = call([...EXC, '--session-dir', s], dir);
    assert.strictEqual(r.code, 0, `call ${i + 1}: ${r.stderr}`);
    const j = JSON.parse(r.stdout);
    assert.strictEqual(j.model, 'fable');
    assert.strictEqual(j.source, 'exception:design-reader');
  }
  assert.strictEqual(tallyLines(s).length, 22);
  const r = call([...EXC, '--session-dir', s], dir);
  assert.strictEqual(r.code, 3);
  assert.strictEqual(r.stdout, '{"stepDown":{"reason":"limit"}}\n');
  assert.strictEqual(tallyLines(s).length, 22);
});

const STEP_DOWN_CASES = [
  { reason: 'tally', setup: (dir) => ({ args: ['--session-dir', path.join(dir, 'no-such-session')] }) },
  { reason: 'policy', policy: 'model-profiles:\n  frontier:\n    model: opus\n' },
  { reason: 'stance', extra: ['--stance', 'economy'] },
  { reason: 'ceiling', policy: 'model-ceiling: capable\n' },
  { reason: 'limit', prefill: 22 },
  { reason: 'session-failure', failFable: true },
];
for (const c of STEP_DOWN_CASES) {
  test(`AC2.1, AC3.1, AC3.2: step-down reason ${c.reason} prints exactly {"stepDown":{"reason":…}} and exits 3`, () => {
    const dir = tmpProject(c.policy === undefined ? null : c.policy);
    const s = sessionIn(dir);
    if (c.prefill) fs.writeFileSync(path.join(s, TALLY_FILE), 'design-reader\tt\n'.repeat(c.prefill));
    let env = isolatedEnv();
    const tmp = tmpDirFor();
    if (c.failFable) {
      env = { ...env, CLAUDE_CODE_SESSION_ID: `cli-test-${process.pid}-exc-fail` };
      assert.strictEqual(call(['record-failure', 'fable'], dir, { env, tmp }).code, 0);
    }
    const args = c.setup ? c.setup(dir).args : ['--session-dir', s];
    const before = tallyLines(s).length;
    const r = call([...EXC, ...args, ...(c.extra || [])], dir, { env, tmp });
    assert.strictEqual(r.code, 3, r.stderr);
    assert.strictEqual(r.stdout, `{"stepDown":{"reason":"${c.reason}"}}\n`);
    assert.strictEqual(r.stderr, '');
    assert.strictEqual(JSON.parse(r.stdout).model, undefined);
    assert.strictEqual(tallyLines(s).length, before, 'a step-down uses no slot');
  });
}

test('AC4.1: --exception with --unattended exits 1 naming the refusal, nothing written', () => {
  const dir = tmpProject(null);
  const s = sessionIn(dir);
  const r = call([...EXC, '--session-dir', s, '--unattended'], dir);
  assert.strictEqual(r.code, 1);
  assert.strictEqual(r.stdout, '');
  assert.match(r.stderr, /refuses an unattended call/);
  assert.deepStrictEqual(tallyLines(s), []);
});

test('AC6.1: --exception other exits 1 naming design-reader', () => {
  const dir = tmpProject(null);
  const s = sessionIn(dir);
  const r = call(['frontier', '--exception', 'other', '--session-dir', s], dir);
  assert.strictEqual(r.code, 1);
  assert.match(r.stderr, /unknown exception "other".*"design-reader"/);
  assert.deepStrictEqual(tallyLines(s), []);
});

test('--exception with a profile other than frontier exits 1, nothing written', () => {
  const dir = tmpProject(null);
  const s = sessionIn(dir);
  const r = call(['standard', '--exception', 'design-reader', '--session-dir', s], dir);
  assert.strictEqual(r.code, 1);
  assert.match(r.stderr, /applies only to the frontier profile/);
  assert.deepStrictEqual(tallyLines(s), []);
});

test('--exception with --stance bogus exits 1 naming the stance and leaves the tally unchanged', () => {
  const dir = tmpProject(null);
  const s = sessionIn(dir);
  fs.writeFileSync(path.join(s, TALLY_FILE), 'design-reader\tt\n');
  const r = call([...EXC, '--session-dir', s, '--stance', 'bogus'], dir);
  assert.strictEqual(r.code, 1);
  assert.match(r.stderr, /unknown stance "bogus"/);
  assert.deepStrictEqual(tallyLines(s), ['design-reader\tt']);
  assert.ok(!fs.existsSync(path.join(s, '.frontier-exception-tally.lock')));
});

test('--exception without --session-dir exits 1', () => {
  const dir = tmpProject(null);
  const r = call(EXC, dir);
  assert.strictEqual(r.code, 1);
  assert.match(r.stderr, /--exception requires --session-dir/);
});

test('--session-dir without --exception exits 1', () => {
  const dir = tmpProject(null);
  const s = sessionIn(dir);
  const r = call(['frontier', '--session-dir', s], dir);
  assert.strictEqual(r.code, 1);
  assert.match(r.stderr, /--session-dir requires --exception/);
  assert.deepStrictEqual(tallyLines(s), []);
});

test('--run-dir with --exception exits 1', () => {
  const dir = tmpProject(null);
  const s = sessionIn(dir);
  const runDir = sessionIn(dir, 'run');
  const r = call([...EXC, '--session-dir', s, '--run-dir', runDir], dir);
  assert.strictEqual(r.code, 1);
  assert.match(r.stderr, /--run-dir cannot be combined with --exception/);
  assert.deepStrictEqual(tallyLines(s), []);
  assert.ok(!fs.existsSync(path.join(runDir, 'frontier-tally.log')));
});

test('the exception never reads or appends the run\'s frontier-tally.log', () => {
  const dir = tmpProject(null);
  const s = sessionIn(dir);
  const runDir = sessionIn(dir, 'run');
  const runTally = path.join(runDir, 'frontier-tally.log');
  fs.writeFileSync(runTally, 'frontier\tt\nfrontier\tt\nfrontier\tt\n');
  // The run's cap (3) is spent; the exception still resolves fable and leaves that file alone.
  for (let i = 0; i < 2; i++) assert.strictEqual(run([...EXC, '--session-dir', s], dir).model, 'fable');
  assert.strictEqual(fs.readFileSync(runTally, 'utf8'), 'frontier\tt\nfrontier\tt\nfrontier\tt\n');
  assert.strictEqual(tallyLines(s).length, 2);
});

test('session-dir: a relative path resolves against the injected cwd', () => {
  const dir = tmpProject(null);
  const s = sessionIn(dir, 'rel-session');
  // The runner's real cwd has no `rel-session`; only deps.cwd() can find it.
  assert.strictEqual(run([...EXC, '--session-dir', 'rel-session'], dir).model, 'fable');
  assert.strictEqual(tallyLines(s).length, 1);
});

test('the script entry exits 3 on a step-down', () => {
  const dir = tmpProject(null);
  const s = sessionIn(dir);
  fs.writeFileSync(path.join(s, TALLY_FILE), 'design-reader\tt\n'.repeat(22));
  const r = spawnCli(CLI, [...EXC, '--session-dir', s], { env: isolatedEnv(), cwd: dir });
  assert.strictEqual(r.code, 3);
  assert.strictEqual(r.stdout, '{"stepDown":{"reason":"limit"}}\n');
  assert.strictEqual(r.stderr, '');
});

function spawnAsync(args, cwd, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI, ...args], { cwd, env, windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

// CLI path, not the lock proof (that is exception-tally.test.js's seam test): the five
// children start together; each holds the lock for one read and one append, well inside
// TALLY_LOCK_WAIT_MS, so the outcome is deterministic.
test('five parallel CLI processes at count 20 yield exactly two fable resolutions and three limit step-downs, and the tally ends at 22 lines', async () => {
  const dir = tmpProject(null);
  const s = sessionIn(dir);
  fs.writeFileSync(path.join(s, TALLY_FILE), 'design-reader\tt\n'.repeat(20));
  const results = await Promise.all(
    [0, 1, 2, 3, 4].map(() => spawnAsync([...EXC, '--session-dir', s], dir, isolatedEnv())),
  );
  const ok = results.filter((r) => r.code === 0);
  const down = results.filter((r) => r.code === 3);
  assert.strictEqual(ok.length, 2, JSON.stringify(results));
  assert.strictEqual(down.length, 3, JSON.stringify(results));
  for (const r of ok) assert.strictEqual(JSON.parse(r.stdout).model, 'fable');
  for (const r of down) assert.strictEqual(r.stdout, '{"stepDown":{"reason":"limit"}}\n');
  assert.strictEqual(tallyLines(s).length, 22);
});
