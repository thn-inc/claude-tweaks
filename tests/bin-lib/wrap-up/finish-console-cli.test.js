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

const CLI = path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'wrap-up-engine.js');

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

test('finish-console with a ledger update but no ledger file anywhere exits 1 naming the failure, verify-expectations.json still written (step 1 already completed)', () => {
  const runDir = makeRunDir();
  const payload = JSON.stringify({ ledger: [{ item: 1, status: 'fixed', resolution: 'x' }] });
  const r = run(['finish-console', '--run-dir', runDir, '--approve-all'], { input: payload });
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /step 3 \(ledger flips\) failed/);
  assert.match(r.stderr, /steps 1-2 already completed/);
  assert.ok(fs.existsSync(path.join(runDir, 'verify-expectations.json')), 'step 1 should have already landed');
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

test('finish-console rejects an unknown ledger item number, nothing in the ledger file changes', () => {
  const runDir = makeRunDir();
  fs.writeFileSync(path.join(runDir, 'ledger.md'), LEDGER_SAMPLE);
  const payload = JSON.stringify({ ledger: [{ item: 99, status: 'fixed', resolution: 'x' }] });
  const r = run(['finish-console', '--run-dir', runDir, '--approve-all'], { input: payload });
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /no ledger row for item #99/);
  const ledgerText = fs.readFileSync(path.join(runDir, 'ledger.md'), 'utf8');
  assert.strictEqual(ledgerText, LEDGER_SAMPLE, 'ledger file must be byte-identical — nothing partially written');
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
