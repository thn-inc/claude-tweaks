'use strict';
// #4620: resolveAll's carry route under control mode. Fixture helpers copied from resolve.test.js,
// which stays byte-unmodified (AC5).
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const { scratchDir } = require('../../helpers/tmp-dir');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..', '..');
const { resolveAll, CARRIED_RESOLUTION, CARRY_FROM, SDD_RULING_REASONS } = require(path.join(ROOT, 'plugin', 'bin', 'lib', 'console', 'resolve'));
const { UNRESOLVED_RESOLUTIONS } = require(path.join(ROOT, 'plugin', 'bin', 'lib', 'console', 'residue'));
const { resolveTiebreak } = require(path.join(ROOT, 'plugin', 'bin', 'lib', 'tiebreak'));
const { formatEntry } = require(path.join(ROOT, 'plugin', 'bin', 'lib', 'log-decision', 'append'));

function fixture({ decisions = '', staged = {}, headers = [] } = {}) {
  const runDir = scratchDir('console-resolve-cm-');
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
    readGrants: (numbers) => Object.fromEntries(numbers.map((n) => [n, { labels: ['auto:build', 'auto:merge'], pendingSince: null }])),
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
  assert.strictEqual(by['skills-1.md'].resolution, 'approve');
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
  assert.ok(it.reason.includes(SDD_RULING_REASONS.NEEDS_HUMAN_DECISION), `reason names the needs-human-decision hold: ${it.reason}`);
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

// #4621: control mode routes a wrap-up upstream-feedback item by the ownership of its target repo.
const { SECTION_STANCES, SECTIONS } = require(path.join(ROOT, 'plugin', 'bin', 'lib', 'console', 'resolve'));

const upstreamFile = (target, extra = '') => `<!-- upstream-target: ${target} -->\nTitle: dispatch: x\n\nbody${extra}\n`;
const UPSTREAM_STAGED = () => ({
  'wrap-up-upstream-1.md': upstreamFile('thn-inc/claude-tweaks'),
  'wrap-up-upstream-2.md': upstreamFile('obra/superpowers'),
  'wrap-up-upstream-3.md': 'body only, no target line\n',
});
const OWNED_THN = () => ({ ownerContext: { owner: 'thn-inc', host: 'github.com' }, ownedOwners: [] });
const withOwnership = (upstreamOwnership) => ({ controlMode: true, deps: deps({ upstreamOwnership }) });

test('#4621 AC4.1: an upstream item whose target owner is the origin owner files, naming the owned target', () => {
  const r = run(fixture({ staged: UPSTREAM_STAGED() }), withOwnership(OWNED_THN));
  const it = byId(r)['wrap-up-upstream-1.md'];
  assert.strictEqual(it.resolution, 'filed');
  assert.ok(!('carriedFrom' in it));
  assert.ok(it.reason.includes('thn-inc/claude-tweaks'), it.reason);
  assert.strictEqual(it.reason, 'control mode: owned target thn-inc/claude-tweaks — filed with no prompt');
});

test('#4621 AC4.2 / AC8.1: an external target is carried from filed, as a decision fact naming the target and the hold', () => {
  const dir = fixture({ staged: UPSTREAM_STAGED() });
  const r = run(dir, withOwnership(OWNED_THN));
  const it = byId(r)['wrap-up-upstream-2.md'];
  assert.strictEqual(it.resolution, CARRIED_RESOLUTION);
  assert.strictEqual(it.carriedFrom, 'filed');
  assert.strictEqual(it.reason, 'carried to the acceptance packet as decision:upstream:wrap-up-upstream-2.md — held: external');
  const fact = r.decisionFacts.find((f) => f.id === 'decision:upstream:wrap-up-upstream-2.md');
  assert.ok(fact, JSON.stringify(r.decisionFacts));
  assert.strictEqual(fact.kind, 'decision');
  assert.strictEqual(fact.origin, 'upstream');
  assert.ok(fact.summary.includes('obra/superpowers') && fact.summary.includes('external'), fact.summary);
  assert.ok(fact.text.includes('body'), 'the text carries the draft body');
  assert.ok(fact.evidenceRef.endsWith('staged/wrap-up-upstream-2.md'), fact.evidenceRef);
  assert.strictEqual(byId(r)['wrap-up-upstream-1.md'].resolution, 'filed');
});

test('#4621 Review Focus 1: a staged upstream file with no target line is external, held and never filed', () => {
  const r = run(fixture({ staged: UPSTREAM_STAGED() }), withOwnership(OWNED_THN));
  const it = byId(r)['wrap-up-upstream-3.md'];
  assert.strictEqual(it.resolution, CARRIED_RESOLUTION);
  assert.strictEqual(it.carriedFrom, 'filed');
  assert.ok(it.reason.includes('external'), it.reason);
  assert.deepStrictEqual(r.decisionFacts.map((f) => f.id).sort(), ['decision:upstream:wrap-up-upstream-2.md', 'decision:upstream:wrap-up-upstream-3.md']);
});

test('#4621: an owned-owners entry makes the filing target\'s owner owned from a foreign-owner checkout; the case of the header never matters', () => {
  const dir = fixture({ staged: { 'wrap-up-upstream-1.md': upstreamFile('THN-inc/Claude-Tweaks'), 'wrap-up-upstream-2.md': upstreamFile('mallory/x') } });
  const r = run(dir, withOwnership(() => ({ ownerContext: { owner: 'zeta', host: 'github.com' }, ownedOwners: ['thn-inc'] })));
  assert.deepStrictEqual(r.items.map((i) => [i.id, i.resolution]), [['wrap-up-upstream-1.md', 'filed'], ['wrap-up-upstream-2.md', 'carried']]);
});

test('#4621: a header naming an owned-owners entry\'s repo is held — the issue would land in the pinned filing repo, not that one', () => {
  const dir = fixture({ staged: { 'wrap-up-upstream-1.md': upstreamFile('obra/superpowers'), 'wrap-up-upstream-2.md': upstreamFile('thn-inc/other') } });
  const r = run(dir, withOwnership(() => ({ ownerContext: { owner: 'thn-inc', host: 'github.com' }, ownedOwners: ['obra'] })));
  assert.deepStrictEqual(r.items.map((i) => [i.id, i.resolution, i.reason.endsWith('held: external')]), [['wrap-up-upstream-1.md', 'carried', true], ['wrap-up-upstream-2.md', 'carried', true]]);
});

test('#4621: no upstreamOwnership dep, or one that throws, holds every target as owner-unresolved, never files', () => {
  for (const extra of [{}, { upstreamOwnership: () => { throw new Error('boom'); } }, { upstreamOwnership: () => ({ ownerContext: null, ownedOwners: [] }) }]) {
    const r = run(fixture({ staged: UPSTREAM_STAGED() }), { controlMode: true, deps: deps(extra) });
    assert.deepStrictEqual(r.items.map((i) => i.resolution), ['carried', 'carried', 'carried']);
    assert.ok(r.items[0].reason.endsWith('held: owner-unresolved'), r.items[0].reason);
    assert.ok(r.items[2].reason.endsWith('held: external'), 'a target-less file is external whatever the owner context');
  }
});

test('#4621: an origin host other than github.com makes every target external', () => {
  const r = run(fixture({ staged: UPSTREAM_STAGED() }), withOwnership(() => ({ ownerContext: { owner: 'thn-inc', host: 'git.example.com' }, ownedOwners: [] })));
  assert.ok(r.items.every((i) => i.resolution === 'carried' && i.reason.endsWith('held: external')), JSON.stringify(r.items));
});

test('#4621: an unreadable staged upstream file reads as no target and is held as external', () => {
  const dir = fixture({ staged: { 'wrap-up-upstream-1.md': upstreamFile('thn-inc/claude-tweaks') } });
  const r = run(dir, { controlMode: true, deps: deps({ upstreamOwnership: OWNED_THN, readFile: (p) => { if (p.endsWith('wrap-up-upstream-1.md')) throw new Error('EACCES'); return fs.readFileSync(p, 'utf8'); } }) });
  assert.strictEqual(r.items[0].resolution, 'carried');
  assert.ok(r.items[0].reason.endsWith('held: external'), r.items[0].reason);
});

test('#4621: upstreamOwnership is called once however many upstream items there are, and not when there are none', () => {
  let calls = 0;
  const counting = () => { calls += 1; return OWNED_THN(); };
  run(fixture({ staged: UPSTREAM_STAGED() }), withOwnership(counting));
  assert.strictEqual(calls, 1);
  calls = 0;
  run(BASIC(), withOwnership(counting));
  assert.strictEqual(calls, 0, 'no upstream item, no read');
});

test('#4621 AC6.1 / AC8.3: without controlMode every upstream item stays filed on the stance reason, with no facts and no ownership read', () => {
  const dir = fixture({ staged: UPSTREAM_STAGED() });
  let calls = 0;
  const counting = () => { calls += 1; return OWNED_THN(); };
  const stance = SECTION_STANCES[SECTIONS.UPSTREAM];
  for (const extra of [{}, { controlMode: false }, { controlMode: 'on' }]) {
    const r = run(dir, { ...extra, deps: deps({ upstreamOwnership: counting }) });
    assert.deepStrictEqual(r.items.map((i) => [i.resolution, i.reason]), [1, 2, 3].map(() => [stance.resolution, stance.reason]));
    assert.deepStrictEqual(r.decisionFacts, []);
  }
  assert.strictEqual(calls, 0, 'upstreamOwnership is never called outside control mode');
});

test('#4621: a hand-off draft stays carried from pending under control mode, with no ownership read', () => {
  let calls = 0;
  const counting = () => { calls += 1; return OWNED_THN(); };
  const r = run(fixture({ staged: { 'upstream-draft-1.md': upstreamFile('thn-inc/claude-tweaks') } }), withOwnership(counting));
  const it = byId(r)['upstream-draft-1.md'];
  assert.strictEqual(it.resolution, 'carried');
  assert.strictEqual(it.carriedFrom, 'pending');
  assert.ok(!it.reason.includes('held:'), it.reason);
  assert.strictEqual(calls, 0, 'a hand-off draft never reads ownership');
});
