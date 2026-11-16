'use strict';
// #4620: resolveAll's carry route under control mode. Fixture helpers copied from resolve.test.js,
// which stays byte-unmodified (AC5).
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..', '..');
const { resolveAll, CARRIED_RESOLUTION, CARRY_FROM } = require(path.join(ROOT, 'plugin', 'bin', 'lib', 'console', 'resolve'));
const { UNRESOLVED_RESOLUTIONS } = require(path.join(ROOT, 'plugin', 'bin', 'lib', 'console', 'residue'));
const { resolveTiebreak } = require(path.join(ROOT, 'plugin', 'bin', 'lib', 'tiebreak'));
const { formatEntry } = require(path.join(ROOT, 'plugin', 'bin', 'lib', 'log-decision', 'append'));

function fixture({ decisions = '', staged = {}, headers = [] } = {}) {
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'console-resolve-cm-'));
  fs.mkdirSync(path.join(runDir, 'staged'), { recursive: true });
  fs.mkdirSync(path.join(runDir, 'work'), { recursive: true });
  fs.writeFileSync(path.join(runDir, 'decisions.md'), decisions);
  for (const [name, body] of Object.entries(staged)) fs.writeFileSync(path.join(runDir, 'staged', name), body);
  for (const n of headers) fs.writeFileSync(path.join(runDir, 'work', `${n}-spec.md`), `---\nrecord: ${n}\n---\n`);
  return runDir;
}

function deps(overrides = {}) {
  return {
    readFile: (p) => fs.readFileSync(p, 'utf8'),
    readdir: (p) => { try { return fs.readdirSync(p); } catch { return []; } },
    gitApplyCheck: () => ({ ok: true }),
    readGrants: (numbers) => Object.fromEntries(numbers.map((n) => [n, { labels: ['auto:merge'], pendingSince: null }])),
    now: () => Date.parse('2026-09-06T12:00:00Z'),
    sensitivePaths: [],
    ...overrides,
  };
}

const byId = (r) => Object.fromEntries(r.items.map((i) => [i.id, i]));
const run = (runDir, extra = {}) => resolveAll({ runDir, policy: 'console-auto', deps: deps(), ...extra });
const BASIC = () => fixture({ staged: { 'skills-1.md': 'x', 'wrap-up-skill-1.md': 'skill', 'review-contested-1.md': 'contested' }, headers: [7] });

test('#4620 AC1.1: control mode resolves the policy item and carries the contested finding', () => {
  const r = run(BASIC(), { controlMode: true });
  const by = byId(r);
  assert.strictEqual(by['wrap-up-skill-1.md'].resolution, 'approve');
  assert.strictEqual(by['review-contested-1.md'].resolution, 'carried');
  assert.strictEqual(by['review-contested-1.md'].carriedFrom, 'keep-staged');
  assert.deepStrictEqual(r.decisionFacts.map((f) => f.id), ['decision:review:review-contested-1.md']);
  assert.match(by['review-contested-1.md'].reason, /^carried to the acceptance packet as decision:review:review-contested-1\.md — /);
  assert.deepStrictEqual(r.items.filter((i) => UNRESOLVED_RESOLUTIONS.has(i.resolution)), []);
  assert.strictEqual(CARRIED_RESOLUTION, 'carried');
  assert.deepStrictEqual([...CARRY_FROM], ['pending', 'keep-staged', 'refused']);
});

test('#4620 AC7.1: a needs-human-decision sdd ruling is carried, never applied', () => {
  const ruling = 'Title: ruling\nKind: sdd-ruling\nRuling: Task 2: Ruling: wait on a human — cheaper — costs a re-read\nDefers: yes\nDefer-reason: needs-human-decision\nStaged-at: abc123\nLedger: docs/plans/x-ledger.md#5\n\nratify / reverse\n';
  const r = run(fixture({ staged: { 'sdd-ruling-1.md': ruling }, headers: [7] }), { controlMode: true });
  const it = byId(r)['sdd-ruling-1.md'];
  assert.strictEqual(it.resolution, 'carried');
  assert.strictEqual(it.carriedFrom, 'pending');
  assert.strictEqual(r.decisionFacts[0].origin, 'console');
  assert.ok(!r.items.some((i) => i.resolution === 'apply'));
});

test('#4620 AC2.1: unmapped, refused and coordination items are all carried', () => {
  const decisions = '## /wrap-up\n- REFUSED 10:00:00 — Queue write Q1: no valid Defer-reason on staged/leftover-1.md; kept staged.\n'
    + '## /review\n- STAGED 10:00:01 — Single-read (low tier): lens "3b" finding src/a.js:4 not directly verified. Staged to Review Console as low-confidence. Reversibility: high.\n';
  const r = run(fixture({ decisions, staged: { 'mystery-9.md': 'unmapped', 'leftover-1.md': 'x' }, headers: [7] }), { controlMode: true });
  assert.strictEqual(r.items.length, 3);
  assert.deepStrictEqual(r.items.map((i) => i.resolution), ['carried', 'carried', 'carried']);
  assert.deepStrictEqual(r.items.map((i) => i.carriedFrom).sort(), ['keep-staged', 'pending', 'refused']);
  assert.strictEqual(r.decisionFacts.length, 3);
  const refused = r.decisionFacts.find((f) => f.id === 'decision:console:leftover-1.md');
  assert.strictEqual(refused.suggestedResolution, 'supply a Defer-reason, or decline');
  assert.match(refused.evidenceRef, /\/staged\/leftover-1\.md$/);
  const coord = r.decisionFacts.find((f) => /\/decisions\.md$/.test(f.evidenceRef));
  assert.ok(coord, 'the coordination fact points at decisions.md');
});

test('#4620 AC2.1: an unattended can\'t-tell item still resolves filed under control mode', () => {
  const now = new Date(2026, 9, 24, 10, 0, 0);
  const file = Array.from({ length: 300 }, () => 'quote text here').join('\n');
  const f = { lens: '3a', path: 'src/a.js', line: 9, claim: 'claim one', reporterSeverity: 'medium', kind: 'unconfirmed' };
  const v = resolveTiebreak(f, 'Verdict: cant-tell\nSeverity: medium\nRecommendation: file\nSTATUS: DONE', { readFile: () => file, now });
  const entry = formatEntry({ status: v.logStatus, now, step: v.logStep, text: v.logText, reversibility: 'high' });
  const staged = '- STAGED 09:59:00 — Reproduction: lens "3a" finding src/a.js:9 not reproduced. Staged to Review Console as low-confidence. Reversibility: high.';
  const r = run(fixture({ decisions: `${staged}\n${entry}\n`, headers: [7] }), { controlMode: true });
  assert.deepStrictEqual(r.items.map((i) => [i.id, i.resolution]), [[`tiebreak:${v.id}`, 'filed']]);
  assert.strictEqual(r.filings.length, 1);
  assert.deepStrictEqual(r.decisionFacts, []);
});

test('#4620 AC5.1: without controlMode resolveAll is byte-identical and decisionFacts is []', () => {
  const dir = BASIC();
  const base = run(dir);
  const off = run(dir, { controlMode: false });
  for (const k of ['items', 'merge', 'filings', 'table']) assert.deepStrictEqual(off[k], base[k], k);
  assert.deepStrictEqual(base.decisionFacts, []);
  assert.deepStrictEqual(off.decisionFacts, []);
  assert.strictEqual(byId(base)['review-contested-1.md'].resolution, 'keep-staged');
  assert.ok(!('carriedFrom' in byId(base)['review-contested-1.md']));
  const truthy = run(dir, { controlMode: 'on' });
  assert.deepStrictEqual(truthy.decisionFacts, [], 'only exactly true carries');
});
