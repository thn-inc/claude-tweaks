'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { validateFactsShape, validatePacket } = require('../plugin/bin/lib/wrap-up/packet-validate');
const { renderPacket } = require('../plugin/bin/lib/wrap-up/packet-render');

// #4618 Task 13: the producer's files through the real gather, the validator and the renderer,
// every step a real subprocess of the shipped bins in a directory that is not a git checkout.
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
const spawn = (bin, args) => execFileSync(process.execPath, [bin, ...args], { cwd: dir, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
const riskFlags = (args) => spawn(RISK_FLAGS_BIN, args);
const packet = (args) => spawn(PACKET_BIN, args);

test('end to end: unconfirmed and a planned proof survive the producer files, the real gather, the validator and the renderer', () => {
  const spec = writeText(dir, 'spec.md', 'Surface: infra\nRisk-flags: auth\nRisk-flags-unconfirmed: true\n\n## Acceptance Criteria\n\n1. x\n');
  const plan = writeText(dir, 'plan.md', '### Task 1: x\n\n- [ ] **Step 1: y**\n\nProof(auth): An unauthenticated request to the route still returns 401.\n');
  riskFlags(['facts', '--spec-file', spec, '--plan-file', plan, '--flags-out', FLAGS, '--proofs-out', PROOFS, '--repo-root', dir]);
  packet(['gather', '--record', '4618', '--out', FACTS, '--spec', spec, '--flags', FLAGS, '--proofs', PROOFS]);
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

test('end to end: a failed producer makes the gather state the lost input, never an empty flag list', () => {
  const spec = writeText(dir, 'spec2.md', 'Surface: infra\nRisk-flags: auth\n\n## Acceptance Criteria\n\n1. x\n');
  const out = path.join(dir, 'facts2.json');
  const flags = path.join(dir, 'flags2.json');
  const proofs = path.join(dir, 'proofs2.json');
  // An earlier run's outputs are on disk; the failed producer must take them away, not leave them to be read.
  fs.writeFileSync(flags, '[]');
  fs.writeFileSync(proofs, '[]');
  assert.throws(
    () => riskFlags(['facts', '--spec-file', path.join(dir, 'absent-spec.md'), '--flags-out', flags, '--proofs-out', proofs, '--repo-root', dir]),
    (error) => error.status === 1,
  );
  assert.strictEqual(fs.existsSync(flags), false);
  assert.strictEqual(fs.existsSync(proofs), false);

  packet(['gather', '--record', '4618', '--out', out, '--spec', spec, '--flags', flags, '--proofs', proofs]);
  const facts = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.ok(facts.partial.includes('--flags input not read — treated as absent'), JSON.stringify(facts.partial));
  assert.ok(facts.partial.includes('--proofs input not read — treated as absent'), JSON.stringify(facts.partial));
  assert.deepStrictEqual(facts.facts.filter((f) => f.kind === 'flag' || f.kind === 'proof'), []);
  assert.deepStrictEqual(validateFactsShape(facts).errors, []);
});
