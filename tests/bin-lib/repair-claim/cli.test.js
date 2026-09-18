'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { run, parseArgs, realDeps } = require('../../../plugin/bin/repair-claim');
const claimsGitCas = require('../../../plugin/bin/lib/issues/claims-git-cas');
const repairLib = require('../../../plugin/bin/lib/repair-claim/repair');

const NOW = Date.parse('2026-08-16T12:00:00Z');
const RUN_DIR_NAME = '2026-08-16T100000-spec-999';

function mkRun() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'repc-'));
  const runDir = path.join(root, '.claude-tweaks', 'pipelines', RUN_DIR_NAME);
  fs.mkdirSync(runDir, { recursive: true });
  fs.mkdirSync(path.join(root, '.git'));
  return runDir;
}
// Same anchoring idiom as release-claim/cli.test.js: resolveTarget needs a
// real mainRoot injected in tests since a synthetic fixture root never
// matches what mainCheckoutRoot(process.cwd()) would resolve to.
function rootOf(runDir) { return path.dirname(path.dirname(path.dirname(runDir))); }

function deps({
  repairResult, gh = true, out, mainRoot,
}) {
  const calls = [];
  const repair = (args) => { calls.push(args); return repairResult; };
  return {
    calls,
    d: {
      repair,
      runner: () => { throw new Error('runner must not be called directly by the CLI — only forwarded'); },
      gitRunner: () => { throw new Error('gitRunner must not be called directly by the CLI — only forwarded'); },
      ghAvailable: () => gh,
      remoteUrl: () => 'git@github.com:acme/w.git',
      now: () => NOW,
      cwd: () => process.cwd(),
      mainRoot,
      sessionId: () => 'sess-1',
      host: () => 'host-1',
      stdout: (s) => out.push(['out', s]),
      stderr: (s) => out.push(['err', s]),
    },
  };
}
const streamOf = (out, kind) => out.filter((o) => o[0] === kind).map((o) => o[1]).join('');
const stderrOf = (out) => streamOf(out, 'err');
const envelope = (out) => JSON.parse(streamOf(out, 'out'));

// --- 1. Malformed invocation -> exit 2, nothing run ---

test('malformed invocation: exit 2, usage on stderr, repair never called', () => {
  const runDir = mkRun();
  const cases = [
    { argv: ['--run', runDir, '--mode', 'release', '--reason', 'r'], label: 'missing <issue>' },
    { argv: ['abc', '--run', runDir, '--mode', 'release', '--reason', 'r'], label: 'non-integer issue' },
    { argv: ['999', '--mode', 'release', '--reason', 'r'], label: 'missing --run' },
    { argv: ['999', '--run', runDir, '--mode', 'release'], label: 'missing --reason' },
    { argv: ['999', '--run', runDir, '--reason', 'r'], label: 'missing --mode' },
    { argv: ['999', '--run', runDir, '--mode', 'bogus', '--reason', 'r'], label: '--mode outside {release,reclaim}' },
    { argv: ['999', '--run', runDir, '--mode', 'release', '--reason', 'r', '--nonsense'], label: 'unknown flag' },
  ];
  for (const c of cases) {
    const out = [];
    const { calls, d } = deps({ repairResult: { outcome: 'repaired', state: 'unreadable', commentPosted: true }, out });
    const code = run(c.argv, d);
    assert.equal(code, 2, c.label);
    assert.match(stderrOf(out), /usage: repair-claim\.js/, c.label);
    assert.equal(calls.length, 0, `${c.label}: repair must never be called`);
  }
});

// --- 2. gh absent -> exit 2 with MCP path pointer ---

test('gh absent: exit 2, stderr names the manual MCP path in _shared/issue-claims.md', () => {
  const runDir = mkRun();
  const out = [];
  const { calls, d } = deps({ repairResult: { outcome: 'repaired' }, out, gh: false });
  const code = run(['999', '--run', runDir, '--mode', 'release', '--reason', 'r'], d);
  assert.equal(code, 2);
  assert.match(stderrOf(out), /issue-claims\.md/);
  assert.equal(calls.length, 0);
});

// --- 2.5. --repo flag resolution (#2444 review fix) ---
// A caller-supplied --repo can itself already be a host-qualified
// `host/owner/repo` slug (repoSlug()'s GHE output) — before this fix, --repo
// was always prefixed with `github.com/` regardless of shape, producing an
// unparseable 4-segment string for a slug like this.

test('#2444 fix: a host-qualified --repo slug resolves to its own host, not github.com', () => {
  const runDir = mkRun();
  const out = [];
  const { calls, d } = deps({ repairResult: { outcome: 'repaired', state: 'unreadable', commentPosted: true }, out, mainRoot: rootOf(runDir) });
  const code = run(['999', '--run', runDir, '--mode', 'release', '--reason', 'r', '--repo', 'ghe.example.com/acme/widgets'], d);
  assert.equal(code, 0);
  assert.equal(calls[0].owner, 'acme');
  assert.equal(calls[0].repo, 'widgets');
  assert.equal(calls[0].ghHost, 'ghe.example.com');
});

test('#2444 fix: a bare --repo owner/repo still resolves to host: github.com (unchanged)', () => {
  const runDir = mkRun();
  const out = [];
  const { calls, d } = deps({ repairResult: { outcome: 'repaired', state: 'unreadable', commentPosted: true }, out, mainRoot: rootOf(runDir) });
  const code = run(['999', '--run', runDir, '--mode', 'release', '--reason', 'r', '--repo', 'someone/else'], d);
  assert.equal(code, 0);
  assert.equal(calls[0].owner, 'someone');
  assert.equal(calls[0].repo, 'else');
  assert.equal(calls[0].ghHost, 'github.com');
});

// --- 3. Exit map ---

test('exit map: repaired->0, cas-rejected->3, refused->4, failed->1', () => {
  const table = [
    ['repaired', 0],
    ['cas-rejected', 3],
    ['refused', 4],
    ['failed', 1],
  ];
  for (const [outcome, expectedCode] of table) {
    const runDir = mkRun();
    const out = [];
    const { d } = deps({
      repairResult: {
        outcome, state: outcome === 'refused' ? 'live' : 'unreadable', commentPosted: outcome === 'repaired', error: outcome === 'failed' ? 'boom' : null,
      },
      out,
      mainRoot: rootOf(runDir),
    });
    const code = run(['999', '--run', runDir, '--mode', 'release', '--reason', 'r'], d);
    assert.equal(code, expectedCode, `outcome ${outcome} -> exit ${expectedCode}`);
  }
});

// --- 4. Decision log line + JSON envelope ---

test('repaired outcome appends an AUTO decisions.md line and the envelope carries the documented fields', () => {
  const runDir = mkRun();
  const out = [];
  const { calls, d } = deps({
    repairResult: {
      outcome: 'repaired', state: 'unreadable', commentPosted: true, note: null, error: null,
    },
    out,
    mainRoot: rootOf(runDir),
  });
  const code = run(['999', '--run', runDir, '--mode', 'release', '--reason', 'corrupt blob', '--link', 'https://example.com/run/1'], d);
  assert.equal(code, 0);
  const log = fs.readFileSync(path.join(runDir, 'decisions.md'), 'utf8');
  assert.match(log, /repaired unreadable claim blob on #999 \(mode release/);
  assert.match(log, /corrupt blob/);
  const env = envelope(out);
  assert.deepEqual(
    { issue: env.issue, runId: env.runId, mode: env.mode, outcome: env.outcome, state: env.state, commentPosted: env.commentPosted, logged: env.logged },
    {
      issue: 999, runId: RUN_DIR_NAME, mode: 'release', outcome: 'repaired', state: 'unreadable', commentPosted: true, logged: true,
    },
  );
  // Pin the CLI->module argument contract: a renamed or dropped field here
  // must fail this test, not silently reach repairClaim as undefined.
  assert.equal(calls.length, 1, 'repair called exactly once');
  const call = calls[0];
  assert.equal(typeof call.issueNumber, 'number');
  assert.equal(call.issueNumber, 999);
  assert.equal(call.runId, RUN_DIR_NAME, 'runId is the basename of --run');
  assert.equal(call.mode, 'release');
  assert.equal(call.reason, 'corrupt blob');
  assert.equal(call.link, 'https://example.com/run/1');
  assert.equal(call.sessionId, 'sess-1');
  assert.equal(call.host, 'host-1');
  assert.equal(typeof call.runner, 'function', 'runner is forwarded');
  assert.equal(typeof call.gitRunner, 'function', 'gitRunner is forwarded');
  assert.equal(call.now, NOW, 'now is forwarded');
});

test('refused outcome logs a line naming "refused" and the blocking state', () => {
  const runDir = mkRun();
  const out = [];
  const { d } = deps({
    repairResult: {
      outcome: 'refused', state: 'live', commentPosted: false, note: null, error: null,
    },
    out,
    mainRoot: rootOf(runDir),
  });
  const code = run(['999', '--run', runDir, '--mode', 'reclaim', '--reason', 'r'], d);
  assert.equal(code, 4);
  const log = fs.readFileSync(path.join(runDir, 'decisions.md'), 'utf8');
  assert.match(log, /refused/);
  assert.match(log, /live/);
});

test('cas-rejected outcome logs a line naming the compare-and-swap rejection and re-read instruction', () => {
  const runDir = mkRun();
  const out = [];
  const { d } = deps({
    repairResult: {
      outcome: 'cas-rejected', state: 'unreadable', commentPosted: false, note: null, error: 'HTTP 409/422 sha mismatch',
    },
    out,
    mainRoot: rootOf(runDir),
  });
  const code = run(['999', '--run', runDir, '--mode', 'release', '--reason', 'r'], d);
  assert.equal(code, 3);
  const log = fs.readFileSync(path.join(runDir, 'decisions.md'), 'utf8');
  assert.match(log, /claim repair on #999 rejected by compare-and-swap \(sha changed since read\)/);
  assert.match(log, /nothing written; re-read and reassess/);
});

test('failed outcome logs a line naming the failure and its error text', () => {
  const runDir = mkRun();
  const out = [];
  const { d } = deps({
    repairResult: {
      outcome: 'failed', state: null, commentPosted: false, note: null, error: 'ECONNRESET: network blip',
    },
    out,
    mainRoot: rootOf(runDir),
  });
  const code = run(['999', '--run', runDir, '--mode', 'release', '--reason', 'r'], d);
  assert.equal(code, 1);
  const log = fs.readFileSync(path.join(runDir, 'decisions.md'), 'utf8');
  assert.match(log, /claim repair of #999 FAILED \(r\): ECONNRESET: network blip/);
});

// --- 5. Log failure never changes exit code ---

test('nonexistent --run dir: stderr warns decisions.md not written, exit still per outcome', () => {
  const out = [];
  const { d } = deps({
    repairResult: {
      outcome: 'repaired', state: 'unreadable', commentPosted: true, note: null, error: null,
    },
    out,
  });
  const missingRunDir = path.join(os.tmpdir(), 'repc-none-' + process.pid, RUN_DIR_NAME);
  const code = run(['999', '--run', missingRunDir, '--mode', 'release', '--reason', 'r'], d);
  assert.equal(code, 0, 'log failure never changes the exit code');
  assert.match(stderrOf(out), /decisions\.md not written/);
  assert.equal(envelope(out).logged, false);
});

// --- 6. Wiring test ---

test('realDeps wires the real git-CAS runner, the real gh runner, and the real repairClaim module function', () => {
  assert.equal(realDeps.gitRunner, claimsGitCas.defaultRunner, 'gitRunner is claims-git-cas.js\'s defaultRunner export');
  assert.equal(realDeps.runner, repairLib.defaultRunner, 'runner is repair.js\'s defaultRunner export (a dropped runner would silently fall back to repairClaim\'s own default parameter)');
  assert.equal(realDeps.repair, repairLib.repairClaim, 'repair is repair.js\'s repairClaim export');
});

// --- parseArgs sanity (does not itself validate --mode; run() is the gate) ---

test('parseArgs does not validate --mode value — run() is the designated gate', () => {
  const o = parseArgs(['999', '--run', '/x', '--mode', 'bogus', '--reason', 'r']);
  assert.equal(o.mode, 'bogus', 'parseArgs passes the raw value through unvalidated');
});

test('--help exits 0 and prints usage', () => {
  const out = [];
  const { d } = deps({ repairResult: { outcome: 'repaired' }, out });
  assert.equal(run(['--help'], d), 0);
  assert.match(streamOf(out, 'out'), /usage: repair-claim\.js/);
});
