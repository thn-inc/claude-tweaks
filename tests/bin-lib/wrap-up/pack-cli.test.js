'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const CLI = path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'wrap-up-pack.js');
const { run, parseArgs } = require(CLI);

// A throwaway "main checkout" (a git repo) with a run dir under its .claude-tweaks/pipelines.
function mainCheckoutWithRun() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'wrap-up-pack-cli-')));
  const git = (...a) => execFileSync('git', a, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  git('init', '-q'); git('config', 'user.email', 't@example.invalid'); git('config', 'user.name', 't'); git('commit', '-q', '--allow-empty', '-m', 'init');
  // work-backend lives in CLAUDE.md, not policy.yml (#1930 review E1).
  fs.writeFileSync(path.join(root, 'CLAUDE.md'), '# Fixture\n\nwork-backend: github-issues\n');
  const runDir = path.join(root, '.claude-tweaks', 'pipelines', '2026-09-06T000000-record-7');
  fs.mkdirSync(path.join(runDir, 'work'), { recursive: true });
  fs.writeFileSync(path.join(runDir, 'run-state.json'), JSON.stringify({ worktree: root, status: 'active', pr: { number: 42 } }));
  fs.writeFileSync(path.join(runDir, 'work', '7-spec.md'), '---\nrecord: 7\n---\n');
  return { root, runDir };
}

const POLICY = { 'integration-branch': 'main', 'work-backend': 'github-issues', 'work-links': 'body-text' };
const okProbeDeps = {
  resolvePolicy: (keys) => Object.fromEntries(keys.map((k) => [k, POLICY[k] || ''])),
  computeBlastRadius: () => ({ summary: {} }),
  readClaimBlob: () => ({ content: null, failure: null, absent: true, via: 'git' }), classifyClaimBlob: () => ({ state: 'absent', reclaimable: true }),
  execFile: async (cmd, args) => (cmd === 'gh' ? { stdout: args[0] === 'pr' ? '{"state":"OPEN"}' : args[1] === 'list' ? '[]' : '{"labels":[]}', stderr: '' } : { stdout: '{"suite":{"ran":false}}', stderr: '' }),
};

test('parseArgs: --run is required; --only is a comma list of known probes; unknown flags are usage errors (#1930)', () => {
  assert.deepStrictEqual(parseArgs(['--run', '/r', '--only', 'residue,pr']).only, ['residue', 'pr']);
  assert.throws(() => parseArgs([]), /--run/);
  assert.throws(() => parseArgs(['--run', '/r', '--only', 'nope']), /unknown probe/);
  assert.throws(() => parseArgs(['--run', '/r', '--bogus']), /unknown flag/);
});

test('parseArgs: --only , (empty after filtering) names no probes — a usage error, mirroring release-preflight.js (#2325)', () => {
  assert.throws(() => parseArgs(['--run', '/r', '--only', ',']), /names no probes/);
});

test('run: --only , exits 2 with the usage text and writes nothing (#2325 AC)', async () => {
  const { root, runDir } = mainCheckoutWithRun();
  let err = '';
  const code = await run(['--run', runDir, '--only', ','], { cwd: () => root, mainRoot: root, stdout: () => {}, stderr: (s) => { err += s; }, packDeps: okProbeDeps });
  assert.strictEqual(code, 2);
  assert.match(err, /names no probes/);
  assert.ok(!fs.existsSync(path.join(runDir, 'wrap-up-pack.json')));
});

test('run: an anchored run dir → exit 0, the pack on stdout, wrap-up-pack.json written with the eight probe keys (#1930 AC2)', async () => {
  const { root, runDir } = mainCheckoutWithRun();
  let out = '';
  const code = await run(['--run', runDir], { cwd: () => root, mainRoot: root, stdout: (s) => { out += s; }, stderr: () => {}, packDeps: okProbeDeps });
  assert.strictEqual(code, 0);
  const pack = JSON.parse(out);
  const file = JSON.parse(fs.readFileSync(path.join(runDir, 'wrap-up-pack.json'), 'utf8'));
  assert.deepStrictEqual(Object.keys(pack).sort(), ['blastRadius', 'claim', 'durationMs', 'generatedAt', 'inputs', 'ledger', 'pr', 'recordLabels', 'residue', 'state', 'unblocked']);
  assert.deepStrictEqual(Object.keys(file).sort(), Object.keys(pack).sort());
});

test('run: --json inside the anchored target writes there instead of the run dir (#1930 review M3)', async () => {
  const { root, runDir } = mainCheckoutWithRun();
  const dest = path.join(root, 'pack-copy.json');
  const code = await run(['--run', runDir, '--json', dest], { cwd: () => root, mainRoot: root, stdout: () => {}, stderr: () => {}, packDeps: okProbeDeps });
  assert.strictEqual(code, 0);
  assert.ok(fs.existsSync(dest), '--json destination written');
  assert.ok(!fs.existsSync(path.join(runDir, 'wrap-up-pack.json')), 'the default destination is not also written');
});

test('run: a --json through a symlinked directory inside the run dir that points outside the anchor exits 3 and writes nothing (#1930 review lens 3b, [IL-150])', async () => {
  const { root, runDir } = mainCheckoutWithRun();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'wrap-up-pack-escape-'));
  fs.symlinkSync(outside, path.join(runDir, 'escape'));
  const dest = path.join(runDir, 'escape', 'pack.json');
  let err = '';
  const code = await run(['--run', runDir, '--json', dest], { cwd: () => root, mainRoot: root, stdout: () => {}, stderr: (s) => { err += s; }, packDeps: okProbeDeps });
  assert.strictEqual(code, 3);
  assert.match(err, /--json .* refused/);
  assert.ok(!fs.existsSync(path.join(outside, 'pack.json')), 'nothing written outside the anchor');
  assert.ok(!fs.existsSync(path.join(runDir, 'wrap-up-pack.json')), 'the default destination is not written either');
});

test('run: a --json outside the anchored target exits 3 and writes nothing (#1930 review M3)', async () => {
  const { root, runDir } = mainCheckoutWithRun();
  const outside = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wrap-up-pack-elsewhere-')), 'pack.json');
  let err = '';
  const code = await run(['--run', runDir, '--json', outside], { cwd: () => root, mainRoot: root, stdout: () => {}, stderr: (s) => { err += s; }, packDeps: okProbeDeps });
  assert.strictEqual(code, 3);
  assert.match(err, /--json .* refused/);
  assert.ok(!fs.existsSync(outside));
  assert.ok(!fs.existsSync(path.join(runDir, 'wrap-up-pack.json')), 'the refusal happens before any pack is produced');
});

test('run: --only residue,pr writes only those probe keys plus inputs/generatedAt/durationMs (#1930 AC2)', async () => {
  const { root, runDir } = mainCheckoutWithRun();
  const code = await run(['--run', runDir, '--only', 'residue,pr'], { cwd: () => root, mainRoot: root, stdout: () => {}, stderr: () => {}, packDeps: okProbeDeps });
  assert.strictEqual(code, 0);
  const file = JSON.parse(fs.readFileSync(path.join(runDir, 'wrap-up-pack.json'), 'utf8'));
  assert.deepStrictEqual(Object.keys(file).sort(), ['durationMs', 'generatedAt', 'inputs', 'pr', 'residue']);
});

test('run: every probe failing still exits 0 — the pack was produced (#1930)', async () => {
  const { root, runDir } = mainCheckoutWithRun();
  const failing = { ...okProbeDeps, execFile: async () => { throw new Error('down'); }, computeBlastRadius: () => { throw new Error('down'); }, readClaimBlob: () => { throw new Error('down'); } };
  let out = '';
  const code = await run(['--run', runDir], { cwd: () => root, mainRoot: root, stdout: (s) => { out += s; }, stderr: () => {}, packDeps: failing });
  assert.strictEqual(code, 0);
  const pack = JSON.parse(out);
  assert.strictEqual(pack.residue.ok, false);
  assert.strictEqual(pack.ledger.ok, true, 'a pure fs probe still succeeds');
});

test('run: a --run outside the main checkout exits 3 with a stderr message and writes nothing (#1930 AC3)', async () => {
  const { root } = mainCheckoutWithRun();
  const shadow = fs.mkdtempSync(path.join(os.tmpdir(), 'wrap-up-pack-shadow-'));
  fs.writeFileSync(path.join(shadow, 'run-state.json'), '{}');
  let err = '';
  const code = await run(['--run', shadow], { cwd: () => root, mainRoot: root, stdout: () => {}, stderr: (s) => { err += s; }, packDeps: okProbeDeps });
  assert.strictEqual(code, 3);
  assert.match(err, /not anchored|missing/);
  assert.ok(!fs.existsSync(path.join(shadow, 'wrap-up-pack.json')));
});

test('run: a missing --run is exit 2 with usage (#1930)', async () => {
  let err = '';
  const code = await run([], { cwd: () => process.cwd(), stdout: () => {}, stderr: (s) => { err += s; } });
  assert.strictEqual(code, 2);
  assert.match(err, /usage: wrap-up-pack\.js --run/);
});
