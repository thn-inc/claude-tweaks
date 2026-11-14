'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runCliSync, spawnCli } = require('./helpers/run-cli');
const { validateFactsShape, validatePacket } = require('../plugin/bin/lib/wrap-up/packet-validate');
const { renderPacket } = require('../plugin/bin/lib/wrap-up/packet-render');

// #4618 Task 13: the producer's files through the real gather, the validator and the renderer,
// in a directory that is not a git checkout; the first test runs the shipped bins as real subprocesses, the others in-process.
const RISK_FLAGS_BIN = path.join(__dirname, '..', 'plugin', 'bin', 'risk-flags.js');
const PACKET_BIN = path.join(__dirname, '..', 'plugin', 'bin', 'acceptance-packet.js');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'risk-flags-packet-e2e-'));
after(() => fs.rmSync(dir, { recursive: true, force: true }));
const FLAGS = path.join(dir, 'flags.json');
const PROOFS = path.join(dir, 'proofs.json');
const FACTS = path.join(dir, 'facts.json');

function writeText(where, name, text) {
  const file = path.join(where, name);
  fs.writeFileSync(file, text);
  return file;
}
// In-process: the non-checkout condition is injected (git and gitDir report "not a git checkout"),
// and every cwd the packet hands them is recorded.
const gitCwds = [];
const notACheckout = {
  git: (args, { cwd }) => { gitCwds.push(cwd); throw new Error('not a git repository'); },
  gitDir: ({ cwd }) => { gitCwds.push(cwd); throw new Error('not a git repository'); },
};
const inProcess = (bin, args, deps = {}) => {
  const res = runCliSync(bin, args, { cwd: dir, env: { PATH: process.env.PATH }, deps });
  return { ...res, status: res.code };
};
const riskFlags = (args) => inProcess(RISK_FLAGS_BIN, args);
const packet = (args) => inProcess(PACKET_BIN, args, notACheckout);

test('end to end: unconfirmed and a planned proof survive the producer files, the real gather, the validator and the renderer', () => {
  const spec = writeText(dir, 'spec.md', 'Surface: infra\nRisk-flags: auth\nRisk-flags-unconfirmed: true\n\n## Acceptance Criteria\n\n1. x\n');
  const plan = writeText(dir, 'plan.md', '### Task 1: x\n\n- [ ] **Step 1: y**\n\nProof(auth): An unauthenticated request to the route still returns 401.\n');
  // real processes: the shipped bins end to end in a directory that is not a git checkout
  const flagsRun = spawnCli(RISK_FLAGS_BIN, ['facts', '--spec-file', spec, '--plan-file', plan, '--flags-out', FLAGS, '--proofs-out', PROOFS, '--repo-root', dir], { cwd: dir });
  assert.strictEqual(flagsRun.code, 0, flagsRun.stderr);
  assert.deepStrictEqual(JSON.parse(flagsRun.stdout), { status: 'ok', flags: 1, proofs: 1, plan: 'read', planParse: 'ok' });
  const gatherRun = spawnCli(PACKET_BIN, ['gather', '--record', '4618', '--out', FACTS, '--spec', spec, '--flags', FLAGS, '--proofs', PROOFS], { cwd: dir });
  assert.strictEqual(gatherRun.code, 0, gatherRun.stderr);
  const gathered = JSON.parse(gatherRun.stdout);
  assert.strictEqual(gathered.out, FACTS);
  assert.strictEqual(gathered.facts, 4);
  const facts = JSON.parse(fs.readFileSync(FACTS, 'utf8'));
  assert.deepStrictEqual(facts.facts.find((f) => f.id === 'flag:auth'), { id: 'flag:auth', kind: 'flag', status: 'passed', source: 'flags', unconfirmed: true });
  const proof = facts.facts.find((f) => f.id === 'proof:auth');
  assert.deepStrictEqual([proof.kind, proof.status, proof.reason, proof.source], ['proof', 'not-run', 'planned in the plan, not yet run', 'proofs']);
  assert.deepStrictEqual(validateFactsShape(facts).errors, []);
  const narrative = { schemaVersion: 1, claims: [{ section: 'risk-proofs', text: 'Auth verified', refs: ['flag:auth', 'proof:auth'] }] };
  const result = validatePacket(facts, narrative);
  assert.deepStrictEqual([result.kept.length, result.planned.length], [0, 1]);
  assert.match(renderPacket(facts, narrative).markdown, /### Risk proofs\n- Auth verified \(planned, not verified: cites `proof:auth` — not run: planned in the plan, not yet run\) \(flag unconfirmed\)/);
});

test('end to end: an absent or unparseable plan reaches the packet as proofs not read, never as no proof written', () => {
  const spec = writeText(dir, 'spec3.md', 'Surface: infra\nRisk-flags: auth\n\n## Acceptance Criteria\n\n1. x\n');
  const unclosed = writeText(dir, 'plan3.md', '### Task 1: x\n\n```\nProof(auth): An unauthenticated request to the route still returns 401.\n');
  for (const extra of [[], ['--plan-file', unclosed]]) {
    const out = path.join(dir, 'facts3.json');
    const flags = path.join(dir, 'flags3.json');
    const proofs = path.join(dir, 'proofs3.json');
    assert.strictEqual(riskFlags(['facts', '--spec-file', spec, ...extra, '--flags-out', flags, '--proofs-out', proofs, '--repo-root', dir]).status, 0);
    assert.strictEqual(packet(['gather', '--record', '4618', '--out', out, '--spec', spec, '--flags', flags, '--proofs', proofs]).status, 0);
    const facts = JSON.parse(fs.readFileSync(out, 'utf8'));
    assert.ok(facts.partial.includes('--proofs input not read — treated as absent'), JSON.stringify(facts.partial));
    assert.ok(!facts.partial.includes('--flags input not read — treated as absent'), JSON.stringify(facts.partial));
    const lines = renderPacket(facts, { schemaVersion: 1, claims: [] }).markdown.split('\n');
    assert.ok(lines.includes('- auth: proofs not read (the --proofs input did not read)'), extra.join(' ') || 'no --plan-file');
  }
});

test('end to end: a failed producer makes the gather state the lost input, never an empty flag list', () => {
  const spec = writeText(dir, 'spec2.md', 'Surface: infra\nRisk-flags: auth\n\n## Acceptance Criteria\n\n1. x\n');
  const out = path.join(dir, 'facts2.json');
  const flags = path.join(dir, 'flags2.json');
  const proofs = path.join(dir, 'proofs2.json');
  // An earlier run's outputs are on disk; the failed producer must take them away, not leave them to be read.
  fs.writeFileSync(flags, '[]');
  fs.writeFileSync(proofs, '[]');
  assert.strictEqual(riskFlags(['facts', '--spec-file', path.join(dir, 'absent-spec.md'), '--flags-out', flags, '--proofs-out', proofs, '--repo-root', dir]).status, 1);
  assert.strictEqual(fs.existsSync(flags), false);
  assert.strictEqual(fs.existsSync(proofs), false);

  gitCwds.length = 0;
  assert.strictEqual(packet(['gather', '--record', '4618', '--out', out, '--spec', spec, '--flags', flags, '--proofs', proofs]).status, 0);
  // AC6.1: the injected cwd reaches the packet's git calls, not the test process's own
  assert.notEqual(dir, process.cwd());
  assert.ok(gitCwds.length > 0 && gitCwds.every((cwd) => cwd === dir), JSON.stringify(gitCwds));
  const facts = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.ok(facts.partial.includes('--flags input not read — treated as absent'), JSON.stringify(facts.partial));
  assert.ok(facts.partial.includes('--proofs input not read — treated as absent'), JSON.stringify(facts.partial));
  assert.deepStrictEqual(facts.facts.filter((f) => f.kind === 'flag' || f.kind === 'proof'), []);
  assert.deepStrictEqual(validateFactsShape(facts).errors, []);
});
