'use strict';
// tests/bin-lib/wrap-up/finish-console-cli.test.js — #2546: exercises
// `wrap-up-engine.js finish-console --run-dir <dir> --approve-all` end to
// end as a real child process. Mirrors engine-cli.test.js's anchoring setup
// (a real git repo as the "main checkout"; run dirs nest under it) since
// main()'s #790/[IL-127] guard rejects an unanchored --run-dir for every
// verb, this one included.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { skipUnderRoot } = require('../../helpers/root');

const CLI = path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'wrap-up-engine.js');
const { runVerify } = require(path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'lib', 'wrap-up', 'engine-verify'));
const { ledgerRowCells } = require(path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'lib', 'wrap-up', 'ledger-cells'));

let repoDir;

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function run(args, { cwd, input } = {}) {
  try {
    const stdout = execFileSync(process.execPath, [CLI, ...args], {
      cwd: cwd || repoDir, input: input !== undefined ? input : undefined, encoding: 'utf8',
    });
    return { status: 0, stdout, stderr: '' };
  } catch (e) {
    return { status: e.status, stdout: e.stdout || '', stderr: e.stderr || '' };
  }
}

before(() => {
  repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'finish-console-cli-'));
  git(['init', '-q'], repoDir);
  git(['config', 'user.email', 'test@example.com'], repoDir);
  git(['config', 'user.name', 'Test'], repoDir);
  fs.writeFileSync(path.join(repoDir, 'a.txt'), 'one\n');
  git(['add', '.'], repoDir);
  git(['commit', '-q', '-m', 'base'], repoDir);
});

after(() => {
  fs.rmSync(repoDir, { recursive: true, force: true });
});

function makeRunDir() {
  return fs.mkdtempSync(path.join(repoDir, 'finish-console-rundir-'));
}

// Contents of each artifact a finish-console call can write, null when absent.
function snapshotArtifacts(runDir) {
  const read = (p) => (fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null);
  return {
    expectations: read(path.join(runDir, 'verify-expectations.json')),
    decisions: read(path.join(runDir, 'decisions.md')),
    ledger: read(path.join(runDir, 'ledger.md')),
  };
}

const LEDGER_SAMPLE = [
  '# Open Items — Sample',
  '',
  '| # | Phase | Item | Status | Resolution |',
  '|---|-------|------|--------|------------|',
  '| 1 | review | Needs a memory capture | open | — |',
  '| 2 | test | Flaky selector | open | — |',
  '',
].join('\n');

test('finish-console with an empty payload writes an empty verify-expectations.json and the terminal decision line', () => {
  const runDir = makeRunDir();
  const r = run(['finish-console', '--run-dir', runDir, '--approve-all'], { input: '{}' });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /0 memory, 0 upstream, 0 ledger update/);

  const expectations = JSON.parse(fs.readFileSync(path.join(runDir, 'verify-expectations.json'), 'utf8'));
  assert.deepStrictEqual(expectations, { version: 1, memory: [], upstream: [] });

  const decisions = fs.readFileSync(path.join(runDir, 'decisions.md'), 'utf8');
  assert.match(decisions, /Approved via finish-console --approve-all/);
});

test('finish-console writes memory/upstream into verify-expectations.json and logs one decision line per outcome', () => {
  const runDir = makeRunDir();
  const payload = JSON.stringify({
    memory: [{ file: 'memory/foo.md', indexFile: 'MEMORY.md' }],
    upstream: [{ url: 'https://github.com/org/repo/issues/1' }],
  });
  const r = run(['finish-console', '--run-dir', runDir, '--approve-all'], { input: payload });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /1 memory, 1 upstream, 0 ledger update/);

  const expectations = JSON.parse(fs.readFileSync(path.join(runDir, 'verify-expectations.json'), 'utf8'));
  assert.deepStrictEqual(expectations.memory, [{ file: 'memory/foo.md', indexFile: 'MEMORY.md' }]);
  assert.deepStrictEqual(expectations.upstream, [{ url: 'https://github.com/org/repo/issues/1' }]);

  const decisions = fs.readFileSync(path.join(runDir, 'decisions.md'), 'utf8');
  assert.match(decisions, /Memory update applied: memory\/foo\.md \(index: MEMORY\.md\)/);
  assert.match(decisions, /Upstream feedback filed: https:\/\/github\.com\/org\/repo\/issues\/1/);
});

test('finish-console preserves oversightExempt and re-writes memory/upstream on an existing verify-expectations.json', () => {
  const runDir = makeRunDir();
  fs.writeFileSync(
    path.join(runDir, 'verify-expectations.json'),
    JSON.stringify({ version: 1, memory: [], upstream: [], oversightExempt: [42] }),
  );
  const r = run(['finish-console', '--run-dir', runDir, '--approve-all'], { input: '{"memory":[{"file":"m.md","indexFile":"MEMORY.md"}]}' });
  assert.strictEqual(r.status, 0, r.stderr);
  const expectations = JSON.parse(fs.readFileSync(path.join(runDir, 'verify-expectations.json'), 'utf8'));
  assert.deepStrictEqual(expectations.oversightExempt, [42]);
  assert.deepStrictEqual(expectations.memory, [{ file: 'm.md', indexFile: 'MEMORY.md' }]);
});

test('finish-console flips a {run-dir}/ledger.md row\'s Status/Resolution cells and logs the outcome', () => {
  const runDir = makeRunDir();
  fs.writeFileSync(path.join(runDir, 'ledger.md'), LEDGER_SAMPLE);
  const payload = JSON.stringify({ ledger: [{ item: 1, status: 'deferred', resolution: 'Filed as #456' }] });
  const r = run(['finish-console', '--run-dir', runDir, '--approve-all'], { input: payload });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /0 memory, 0 upstream, 1 ledger update/);

  const ledgerText = fs.readFileSync(path.join(runDir, 'ledger.md'), 'utf8');
  assert.match(ledgerText, /\| 1 \| review \| Needs a memory capture \| deferred \| Filed as #456 \|/);
  assert.match(ledgerText, /\| 2 \| test \| Flaky selector \| open \| — \|/, 'row 2 untouched');

  const decisions = fs.readFileSync(path.join(runDir, 'decisions.md'), 'utf8');
  assert.match(decisions, /Ledger item #1 -> deferred: Filed as #456/);
});

test('finish-console applies multiple ledger updates in one call', () => {
  const runDir = makeRunDir();
  fs.writeFileSync(path.join(runDir, 'ledger.md'), LEDGER_SAMPLE);
  const payload = JSON.stringify({
    ledger: [
      { item: 1, status: 'deferred', resolution: 'Filed as #456' },
      { item: 2, status: 'accepted', resolution: 'Flake confirmed environmental' },
    ],
  });
  const r = run(['finish-console', '--run-dir', runDir, '--approve-all'], { input: payload });
  assert.strictEqual(r.status, 0, r.stderr);
  const ledgerText = fs.readFileSync(path.join(runDir, 'ledger.md'), 'utf8');
  assert.match(ledgerText, /\| 1 \| review \| Needs a memory capture \| deferred \| Filed as #456 \|/);
  assert.match(ledgerText, /\| 2 \| test \| Flaky selector \| accepted \| Flake confirmed environmental \|/);
});

test('finish-console with a ledger update but no ledger file anywhere exits 1 naming the failure and writes nothing', () => {
  const runDir = makeRunDir();
  const before = snapshotArtifacts(runDir);
  const payload = JSON.stringify({ memory: [{ file: 'memory/foo.md', indexFile: 'MEMORY.md' }], ledger: [{ item: 1, status: 'fixed', resolution: 'x' }] });
  const r = run(['finish-console', '--run-dir', runDir, '--approve-all'], { input: payload });
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /ledger pre-flight failed: no ledger found/);
  assert.match(r.stderr, /nothing written/);
  assert.deepStrictEqual(snapshotArtifacts(runDir), before, 'verify-expectations.json, decisions.md and the ledger must be byte-identical (absent stays absent)');
});

test('finish-console --ledger overrides resolution to an explicit path', () => {
  const runDir = makeRunDir();
  const explicitPath = path.join(repoDir, 'explicit-ledger.md');
  fs.writeFileSync(explicitPath, LEDGER_SAMPLE);
  const payload = JSON.stringify({ ledger: [{ item: 1, status: 'fixed', resolution: 'Fixed directly' }] });
  const r = run(['finish-console', '--run-dir', runDir, '--approve-all', '--ledger', explicitPath], { input: payload });
  assert.strictEqual(r.status, 0, r.stderr);
  const ledgerText = fs.readFileSync(explicitPath, 'utf8');
  assert.match(ledgerText, /\| 1 \| review \| Needs a memory capture \| fixed \| Fixed directly \|/);
});

test('finish-console rejects an unknown ledger item number, and writes none of its artifacts', () => {
  const runDir = makeRunDir();
  fs.writeFileSync(path.join(runDir, 'ledger.md'), LEDGER_SAMPLE);
  const before = snapshotArtifacts(runDir);
  const payload = JSON.stringify({ memory: [{ file: 'memory/foo.md', indexFile: 'MEMORY.md' }], ledger: [{ item: 99, status: 'fixed', resolution: 'x' }] });
  const r = run(['finish-console', '--run-dir', runDir, '--approve-all'], { input: payload });
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /ledger pre-flight failed at ledger\[0\]: no ledger row for item #99/);
  assert.match(r.stderr, /nothing written/);
  assert.deepStrictEqual(snapshotArtifacts(runDir), before, 'verify-expectations.json, decisions.md and the ledger must be byte-identical — nothing partially written');
});

test('finish-console refuses a ledger row with an unescaped raw pipe before writing any artifact', () => {
  const runDir = makeRunDir();
  fs.writeFileSync(path.join(runDir, 'ledger.md'), LEDGER_SAMPLE.replace('Needs a memory capture', 'match a|b'));
  const before = snapshotArtifacts(runDir);
  const payload = JSON.stringify({ memory: [{ file: 'memory/foo.md', indexFile: 'MEMORY.md' }], ledger: [{ item: 1, status: 'accepted', resolution: 'ratified' }] });
  const r = run(['finish-console', '--run-dir', runDir, '--approve-all'], { input: payload });
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /ledger pre-flight failed at ledger\[0\]: .*5-column shape/);
  assert.match(r.stderr, /nothing written/);
  assert.deepStrictEqual(snapshotArtifacts(runDir), before, 'verify-expectations.json, decisions.md and the ledger must be byte-identical');
});

test('finish-console refuses a ledger with duplicate row numbers before writing any artifact (#3834)', () => {
  const runDir = makeRunDir();
  fs.writeFileSync(path.join(runDir, 'ledger.md'), LEDGER_SAMPLE.replace('| 2 | test | Flaky selector', '| 1 | test | Flaky selector'));
  const before = snapshotArtifacts(runDir);
  const payload = JSON.stringify({ memory: [{ file: 'memory/foo.md', indexFile: 'MEMORY.md' }], ledger: [{ item: 1, status: 'accepted', resolution: 'ratified' }] });
  const r = run(['finish-console', '--run-dir', runDir, '--approve-all'], { input: payload });
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /ledger pre-flight failed at ledger\[0\]: .*duplicate row number\(s\) #1/);
  assert.match(r.stderr, /nothing written/);
  assert.deepStrictEqual(snapshotArtifacts(runDir), before, 'verify-expectations.json, decisions.md and the ledger must be byte-identical');
});

test('finish-console rejects an invalid ledger status (e.g. "open") at payload validation, before any write', () => {
  const runDir = makeRunDir();
  fs.writeFileSync(path.join(runDir, 'ledger.md'), LEDGER_SAMPLE);
  const payload = JSON.stringify({ ledger: [{ item: 1, status: 'open', resolution: 'x' }] });
  const r = run(['finish-console', '--run-dir', runDir, '--approve-all'], { input: payload });
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /ledger\[0\]\.status must be one of fixed, deferred, accepted, acknowledged, observation/);
  assert.ok(!fs.existsSync(path.join(runDir, 'verify-expectations.json')), 'validation failure must precede any write, including step 1');
});

test('finish-console validates the stdin payload shape before writing anything (malformed memory entry)', () => {
  const runDir = makeRunDir();
  const r = run(['finish-console', '--run-dir', runDir, '--approve-all'], { input: '{"memory":[{"file":"m.md"}]}' });
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /memory\[0\] must be \{file, indexFile\}/);
  assert.ok(!fs.existsSync(path.join(runDir, 'verify-expectations.json')), 'validation failure must precede any write');
});

test('finish-console with malformed stdin JSON exits 1, not 2', () => {
  const runDir = makeRunDir();
  const r = run(['finish-console', '--run-dir', runDir, '--approve-all'], { input: 'not json' });
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /not valid JSON/);
});

test('finish-console without --approve-all exits 2 with usage', () => {
  const runDir = makeRunDir();
  const r = run(['finish-console', '--run-dir', runDir], { input: '{}' });
  assert.strictEqual(r.status, 2);
  assert.match(r.stderr, /usage: wrap-up-engine\.js/);
});

test('finish-console without --run-dir exits 2 with usage', () => {
  const r = run(['finish-console', '--approve-all'], { input: '{}' });
  assert.strictEqual(r.status, 2);
});

test('AC1.1: finish-console writes an issues array into verify-expectations.json, preserving every other field', () => {
  const runDir = makeRunDir();
  fs.writeFileSync(
    path.join(runDir, 'verify-expectations.json'),
    JSON.stringify({ version: 1, memory: [], upstream: [], oversightExempt: [42], deferred: ['worktree'] }),
  );
  const r = run(['finish-console', '--run-dir', runDir, '--approve-all'], { input: '{"issues":[3394]}' });
  assert.strictEqual(r.status, 0, r.stderr);
  const expectations = JSON.parse(fs.readFileSync(path.join(runDir, 'verify-expectations.json'), 'utf8'));
  assert.deepStrictEqual(expectations.issues, [3394]);
  assert.deepStrictEqual(expectations.oversightExempt, [42]);
  assert.deepStrictEqual(expectations.deferred, ['worktree']);
  assert.match(r.stdout, /issues: \[3394\]/);
  assert.match(fs.readFileSync(path.join(runDir, 'decisions.md'), 'utf8'), /issues: \[3394\]/);
});

test('finish-console without an issues key leaves a stored issues array untouched', () => {
  const runDir = makeRunDir();
  fs.writeFileSync(
    path.join(runDir, 'verify-expectations.json'),
    JSON.stringify({ version: 1, memory: [], upstream: [], issues: [77] }),
  );
  const r = run(['finish-console', '--run-dir', runDir, '--approve-all'], { input: '{}' });
  assert.strictEqual(r.status, 0, r.stderr);
  const expectations = JSON.parse(fs.readFileSync(path.join(runDir, 'verify-expectations.json'), 'utf8'));
  assert.deepStrictEqual(expectations.issues, [77]);
});

test('finish-console treats a null issues key like an absent one (stored array untouched)', () => {
  const runDir = makeRunDir();
  fs.writeFileSync(
    path.join(runDir, 'verify-expectations.json'),
    JSON.stringify({ version: 1, memory: [], upstream: [], issues: [77] }),
  );
  const r = run(['finish-console', '--run-dir', runDir, '--approve-all'], { input: '{"issues":null}' });
  assert.strictEqual(r.status, 0, r.stderr);
  const expectations = JSON.parse(fs.readFileSync(path.join(runDir, 'verify-expectations.json'), 'utf8'));
  assert.deepStrictEqual(expectations.issues, [77]);
});

test('AC2.1: finish-console rejects a non-integer issues entry before any write', () => {
  const runDir = makeRunDir();
  const r = run(['finish-console', '--run-dir', runDir, '--approve-all'], { input: '{"issues":[1,"2"]}' });
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /issues\[1\] must be a positive integer/);
  assert.ok(!fs.existsSync(path.join(runDir, 'verify-expectations.json')), 'validation failure must precede any write');
});

test('AC3.1: finish-console issues reach carrier-commit on a header-less run dir (never skip)', () => {
  const runDir = makeRunDir();
  const r = run(['finish-console', '--run-dir', runDir, '--approve-all'], { input: '{"issues":[900]}' });
  assert.strictEqual(r.status, 0, r.stderr);
  const withCommit = (args) => (args[0] === 'log' ? 'x\n\nFixes #900\n' : '');
  const passing = runVerify({ runDir, base: 'main', deps: { git: withCommit, gh: () => '' } });
  assert.strictEqual(passing.rows.find((row) => row.check === 'carrier-commit').result, 'pass');
  const failing = runVerify({ runDir, base: 'main', deps: { git: () => '', gh: () => '' } });
  const failRow = failing.rows.find((row) => row.check === 'carrier-commit');
  assert.strictEqual(failRow.result, 'fail');
  assert.match(failRow.detail, /900/);
});

test('AC1.1: finish-console --approve-all flips a row whose Item carries an escaped pipe, completing all three steps', () => {
  const runDir = makeRunDir();
  fs.writeFileSync(path.join(runDir, 'ledger.md'), LEDGER_SAMPLE.replace('Needs a memory capture', String.raw`SDD ruling — match a\|b`));
  const payload = JSON.stringify({ memory: [{ file: 'memory/foo.md', indexFile: 'MEMORY.md' }], ledger: [{ item: 1, status: 'accepted', resolution: 'ratified — keep a|b' }] });
  const r = run(['finish-console', '--run-dir', runDir, '--approve-all'], { input: payload });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /1 memory, 0 upstream, 1 ledger update/);
  assert.ok(fs.existsSync(path.join(runDir, 'verify-expectations.json')), 'step 1');
  assert.match(fs.readFileSync(path.join(runDir, 'decisions.md'), 'utf8'), /Ledger item #1 -> accepted/, 'step 2');
  const row = fs.readFileSync(path.join(runDir, 'ledger.md'), 'utf8').split('\n').find((l) => l.startsWith('| 1 |'));
  assert.deepStrictEqual(ledgerRowCells(row), ['1', 'review', 'SDD ruling — match a|b', 'accepted', 'ratified — keep a|b'], 'step 3');
});

// ---- ledger pre-flight branches (#3684): each resolution/read refusal reports
// its own detail and writes none of the three artifacts. ---------------------

const PREFLIGHT_PAYLOAD = JSON.stringify({
  memory: [{ file: 'memory/foo.md', indexFile: 'MEMORY.md' }],
  ledger: [{ item: 1, status: 'fixed', resolution: 'x' }],
});

// A throwaway git repo on `branch` (no remote), so resolveLedgerPath's docs/plans
// ownership read sees the same inputs a linked worktree would: `main` resolves a
// merge base, any other name leaves it unavailable.
function makeScratchRepo(t, branch) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'finish-console-scratch-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  git(['init', '-q'], dir);
  git(['checkout', '-q', '-b', branch], dir);
  git(['config', 'user.email', 'test@example.com'], dir);
  git(['config', 'user.name', 'Test'], dir);
  fs.writeFileSync(path.join(dir, 'a.txt'), 'one\n');
  git(['add', '.'], dir);
  git(['commit', '-q', '-m', 'base'], dir);
  fs.mkdirSync(path.join(dir, 'docs', 'plans'), { recursive: true });
  return { dir, runDir: fs.mkdtempSync(path.join(dir, 'finish-console-rundir-')) };
}

function assertNothingWritten(runDir, r, detail) {
  assert.strictEqual(r.status, 1, r.stderr);
  assert.match(r.stderr, detail);
  assert.match(r.stderr, /nothing written/);
  assert.deepStrictEqual(
    snapshotArtifacts(runDir),
    { expectations: null, decisions: null, ledger: null },
    'verify-expectations.json, decisions.md and the ledger must all stay absent',
  );
}

test('finish-console refuses an ambiguous docs/plans ledger before writing any artifact', (t) => {
  const { dir, runDir } = makeScratchRepo(t, 'main');
  fs.writeFileSync(path.join(dir, 'docs', 'plans', 'a-ledger.md'), LEDGER_SAMPLE);
  fs.writeFileSync(path.join(dir, 'docs', 'plans', 'b-ledger.md'), LEDGER_SAMPLE);
  const r = run(['finish-console', '--run-dir', runDir, '--approve-all'], { cwd: dir, input: PREFLIGHT_PAYLOAD });
  assertNothingWritten(runDir, r, /ledger pre-flight failed: 2 candidate ledgers found, cannot pick one/);
});

test('finish-console refuses a docs/plans ledger it cannot attribute to this run before writing any artifact', (t) => {
  const { dir, runDir } = makeScratchRepo(t, 'feature');
  fs.writeFileSync(path.join(dir, 'docs', 'plans', 'a-ledger.md'), LEDGER_SAMPLE);
  const r = run(['finish-console', '--run-dir', runDir, '--approve-all'], { cwd: dir, input: PREFLIGHT_PAYLOAD });
  assertNothingWritten(runDir, r, /ledger pre-flight failed: cannot attribute docs\/plans ledgers to this run/);
});

test('finish-console refuses a --ledger whose name is not a ledger file before writing any artifact', () => {
  const runDir = makeRunDir();
  fs.writeFileSync(path.join(runDir, 'notes.md'), LEDGER_SAMPLE);
  const r = run(['finish-console', '--run-dir', runDir, '--approve-all', '--ledger', path.join(runDir, 'notes.md')], { input: PREFLIGHT_PAYLOAD });
  assertNothingWritten(runDir, r, /ledger pre-flight failed: --ledger .*notes\.md rejected \(not a ledger file name/);
});

test('finish-console refuses a --ledger outside the run directory and worktree before writing any artifact', (t) => {
  const runDir = makeRunDir();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'finish-console-outside-'));
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  fs.writeFileSync(path.join(outside, 'ledger.md'), LEDGER_SAMPLE);
  const r = run(['finish-console', '--run-dir', runDir, '--approve-all', '--ledger', path.join(outside, 'ledger.md')], { input: PREFLIGHT_PAYLOAD });
  assertNothingWritten(runDir, r, /ledger pre-flight failed: --ledger .*ledger\.md rejected \(outside the run directory and worktree\)/);
});

// chmod cannot make a file unreadable on win32 or for root, where the read would succeed.
const unreadableSkip = process.platform === 'win32' ? { skip: 'chmod cannot make a file unreadable on win32' } : skipUnderRoot('root ignores file permissions');
test('finish-console refuses a ledger it cannot read before writing any artifact', unreadableSkip, (t) => {
  const runDir = makeRunDir();
  const unreadable = path.join(runDir, 'locked-ledger.md');
  fs.writeFileSync(unreadable, LEDGER_SAMPLE);
  fs.chmodSync(unreadable, 0o000);
  t.after(() => fs.chmodSync(unreadable, 0o644));
  const r = run(['finish-console', '--run-dir', runDir, '--approve-all', '--ledger', unreadable], { input: PREFLIGHT_PAYLOAD });
  assertNothingWritten(runDir, r, /ledger pre-flight failed: could not read .*locked-ledger\.md/);
});
