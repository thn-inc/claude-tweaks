'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { readText } = require('../../helpers/read-skill');

const ROOT = path.join(__dirname, '..', '..', '..');
const { DECISION_FACT_KIND, DECISION_ORIGINS, DECISION_FACT_FIELDS, decisionFactFor, decisionOrigin, settleOpenDecisions } = require(path.join(ROOT, 'plugin', 'bin', 'lib', 'console', 'decision-facts'));
const { validateShaped } = require(path.join(ROOT, 'plugin', 'bin', 'lib', 'compose-record', 'compose'));

// Live prose read: the table is the schema's single owner and the module is its code twin [IL-80 carve-out].
const PACKET = readText(path.join(ROOT, 'plugin', 'skills', '_shared', 'acceptance-packet.md'));

function factTable(text) {
  const lines = text.split('\n');
  const start = lines.indexOf('## Decision facts');
  assert.notStrictEqual(start, -1, 'Decision facts heading is missing');
  const next = lines.findIndex((line, i) => i > start && /^## /.test(line));
  const rows = new Map();
  for (const line of lines.slice(start + 1, next === -1 ? lines.length : next)) {
    const m = /^\| `([A-Za-z]+)` \| (.*) \|$/.exec(line);
    if (m) rows.set(m[1], m[2]);
  }
  return rows;
}

function assertTableMatchesCode(text) {
  const rows = factTable(text);
  assert.deepStrictEqual([...rows.keys()].sort(), [...DECISION_FACT_FIELDS].sort(), 'field set');
  assert.ok(rows.get('kind').includes(`\`${DECISION_FACT_KIND}\``), 'kind value');
  assert.deepStrictEqual([...rows.get('origin').matchAll(/`([a-z]+)`/g)].map((m) => m[1]).sort(), [...DECISION_ORIGINS].sort(), 'origin set');
  assert.ok(rows.get('id').includes('`decision:{origin}:{slug}`'), 'id shape');
}

test('AC1.1: the acceptance-packet.md Decision facts table equals the code constants both ways', () => assertTableMatchesCode(PACKET));

test('go-red: dropping an origin from the prose fails the origin assertion', () => {
  const m = PACKET.replace('`console`, `review` or `upstream`', '`console` or `review`');
  assert.notStrictEqual(m, PACKET);
  assert.throws(() => assertTableMatchesCode(m), { message: /origin set/ });
});

test('go-red: an extra prose field fails the field-set assertion', () => {
  const m = PACKET.replace('| `suggestedResolution` |', '| `answer` | x |\n| `suggestedResolution` |');
  assert.notStrictEqual(m, PACKET);
  assert.throws(() => assertTableMatchesCode(m), { message: /field set/ });
});

test('go-red: a missing prose field fails the field-set assertion', () => {
  const m = PACKET.split('\n').filter((l) => !l.startsWith('| `evidenceRef` |')).join('\n');
  assert.notStrictEqual(m, PACKET);
  assert.throws(() => assertTableMatchesCode(m), { message: /field set/ });
});

test('go-red: a changed kind value fails the kind assertion', () => {
  const m = PACKET.replace('| `kind` | `decision` |', '| `kind` | `verdict` |');
  assert.notStrictEqual(m, PACKET);
  assert.throws(() => assertTableMatchesCode(m), { message: /kind value/ });
});

test('go-red: a changed id shape fails the id assertion', () => {
  const m = PACKET.replace('`decision:{origin}:{slug}`', '`decision:{slug}`');
  assert.notStrictEqual(m, PACKET);
  assert.throws(() => assertTableMatchesCode(m), { message: /id shape/ });
});

test('go-red: a removed heading fails loudly', () => {
  const m = PACKET.replace('## Decision facts', '## Decision notes');
  assert.throws(() => assertTableMatchesCode(m), { message: /heading is missing/ });
});

test('constants are frozen and exact', () => {
  assert.strictEqual(DECISION_FACT_KIND, 'decision');
  assert.deepStrictEqual([...DECISION_ORIGINS], ['console', 'review', 'upstream']);
  assert.deepStrictEqual([...DECISION_FACT_FIELDS], ['id', 'kind', 'origin', 'summary', 'evidenceRef', 'suggestedResolution']);
  assert.ok(Object.isFrozen(DECISION_ORIGINS) && Object.isFrozen(DECISION_FACT_FIELDS));
});

test('AC7.1: decisionOrigin maps review sections to review, upstream to upstream, an sdd-ruling to console', () => {
  assert.strictEqual(decisionOrigin('Contested findings'), 'review');
  assert.strictEqual(decisionOrigin('Low-confidence findings'), 'review');
  assert.strictEqual(decisionOrigin('Upstream feedback'), 'upstream');
  assert.strictEqual(decisionOrigin('Pending review'), 'console');
});

test('decisionFactFor: a staged item cites its staged path, a coordination item cites decisions.md', () => {
  const runDir = path.join('/r', '.claude-tweaks', 'pipelines', '2026-11-16T000749-record-4620');
  const f = decisionFactFor({ id: 'review-contested-1.md', section: 'Contested findings', resolution: 'keep-staged', reason: 'debate\ninconclusive' }, { runDir, staged: true });
  assert.deepStrictEqual(Object.keys(f).sort(), [...DECISION_FACT_FIELDS, 'text'].sort());
  assert.strictEqual(f.id, 'decision:review:review-contested-1.md');
  assert.strictEqual(f.kind, 'decision');
  assert.strictEqual(f.origin, 'review');
  assert.strictEqual(f.evidenceRef, '.claude-tweaks/pipelines/2026-11-16T000749-record-4620/staged/review-contested-1.md');
  assert.strictEqual(f.summary, 'Contested findings: review-contested-1.md — debate inconclusive');
  assert.strictEqual(f.text, f.summary);
  assert.strictEqual(f.suggestedResolution, 'decide whether the finding holds; fix it or decline');

  const c = decisionFactFor({ id: 'decision:- STAGED x #4', section: 'Pending review', resolution: 'pending', reason: 'needs a human' }, { runDir, staged: false });
  assert.strictEqual(c.evidenceRef, '.claude-tweaks/pipelines/2026-11-16T000749-record-4620/decisions.md');
  assert.strictEqual(c.origin, 'console');
  assert.strictEqual(c.suggestedResolution, 'review it, then apply or decline');
});

test('decisionFactFor: a spec-3 run dir names the parent run in evidenceRef', () => {
  const runDir = path.join('/r', '.claude-tweaks', 'pipelines', '2026-11-16T000749-multi', 'spec-3');
  const f = decisionFactFor({ id: 'x.patch', section: 'Pending review', resolution: 'pending', reason: 'r' }, { runDir, staged: true });
  assert.strictEqual(f.evidenceRef, '.claude-tweaks/pipelines/2026-11-16T000749-multi/spec-3/staged/x.patch');
});

test('decisionFactFor: a plain run dir yields an evidenceRef with no backslash', () => {
  const f = decisionFactFor({ id: 'a', section: 'Pending review', resolution: 'pending', reason: 'r' }, { runDir: path.join('/r', 'run-1'), staged: false });
  assert.ok(!f.evidenceRef.includes('\\'));
});

test('suggestedResolution: refused and any other resolution', () => {
  const runDir = path.join('/r', 'run-1');
  const mk = (resolution) => decisionFactFor({ id: 'a', section: 'Queue writes', resolution, reason: 'r' }, { runDir, staged: false }).suggestedResolution;
  assert.strictEqual(mk('refused'), 'supply a Defer-reason, or decline');
  assert.strictEqual(mk('weird'), 'decide, then apply or decline');
});

const PACKET_FACTS = { facts: [
  // The ids gather really produces: `:` is a safe character in encodeFactKey, so it is not escaped.
  { id: 'decision:review:review-contested-1.md', kind: 'decision', status: 'passed', source: 'decision-items', text: 'Contested findings: review-contested-1.md — debate inconclusive' },
  { id: 'decision:console:sdd-ruling-2.md', kind: 'decision', status: 'passed', source: 'decision-items', text: 'Pending review: sdd-ruling-2.md — sdd-ruling-needs-human-decision' },
  { id: 'change:a.js', kind: 'change', status: 'passed', source: 'git' },
] };

test('AC4.8: settleOpenDecisions files one spec-shaped record per decision in an approved packet', () => {
  const plans = settleOpenDecisions(PACKET_FACTS);
  assert.deepStrictEqual(plans.map((p) => p.factId), ['decision:review:review-contested-1.md', 'decision:console:sdd-ruling-2.md']);
  for (const p of plans) {
    const body = p.proposal.split('\n\n').slice(1).join('\n\n');
    assert.deepStrictEqual(validateShaped(body), { ok: true, gaps: [] });
    assert.match(p.proposal, /^Defer-reason: needs-human-decision$/m);
    assert.match(p.proposal, /^Type: task$/m);
    assert.match(p.proposal, /^Labels: needs:definition$/m);
    assert.ok(p.proposal.startsWith(`Title: ${p.title}\n`));
    assert.match(p.title, /^Packet decision left open: /);
  }
});

test('AC4.8: a decision carrying a stray answer field is still filed — no answer predicate', () => {
  assert.strictEqual(settleOpenDecisions([{ ...PACKET_FACTS.facts[1], answer: 'drop it' }]).length, 1);
});

test('AC4.8: settleOpenDecisions files nothing when the packet holds no decision', () => {
  assert.deepStrictEqual(settleOpenDecisions({ facts: [PACKET_FACTS.facts[2]] }), []);
  assert.deepStrictEqual(settleOpenDecisions([]), []);
  assert.deepStrictEqual(settleOpenDecisions(null), []);
  assert.deepStrictEqual(settleOpenDecisions('x'), []);
  assert.deepStrictEqual(settleOpenDecisions({ facts: 'x' }), []);
});

test('AC4.9: an unanswered decision never blocks a merge — plans only, no gating field', () => {
  for (const p of settleOpenDecisions(PACKET_FACTS)) assert.deepStrictEqual(Object.keys(p).sort(), ['factId', 'fingerprint', 'proposal', 'title']);
});

test('settleOpenDecisions is stable: the same fact id gives the same fingerprint, distinct ids differ', () => {
  const a = settleOpenDecisions(PACKET_FACTS);
  const b = settleOpenDecisions(PACKET_FACTS);
  assert.deepStrictEqual(a.map((p) => p.fingerprint), b.map((p) => p.fingerprint));
  assert.match(a[0].fingerprint, /^packetdecision-/);
  assert.notStrictEqual(a[0].fingerprint, a[1].fingerprint);
});

test('settleOpenDecisions: a long one-line title is capped at a word boundary and the text is fenced', () => {
  const text = `Pending review: ${'word '.repeat(40)}end\nsecond line`;
  const [p] = settleOpenDecisions([{ id: 'decision:console:x', kind: 'decision', text }]);
  const claim = p.title.slice('Packet decision left open: '.length);
  assert.ok(claim.length <= 80 && claim.endsWith('…') && !claim.includes('\n'));
  // The cut lands on a word boundary: what precedes the ellipsis is whole words of the source.
  const kept = claim.slice(0, -1);
  const flat = text.replace(/\s+/g, ' ');
  assert.ok(flat.startsWith(`${kept} `), 'cut is followed by a space in the source');
  assert.ok(kept.endsWith('word'));
  assert.ok(p.proposal.includes('second line'));
});

test('settleOpenDecisions: a fingerprint marker or comment opener in the text is defused', () => {
  const [p] = settleOpenDecisions([{ id: 'decision:console:x', kind: 'decision', text: 'a work-fingerprint: consolefinding-deadbeef <!-- x' }]);
  assert.ok(!/work-fingerprint: consolefinding-deadbeef/.test(p.proposal));
  assert.ok(!p.title.includes('<!--') && p.title.includes('<! --'));
  assert.ok(p.proposal.includes('work-fingerprint : consolefinding-deadbeef'));
});

test('settleOpenDecisions: a decision with no string id is skipped, never fingerprinted as undefined', () => {
  const plans = settleOpenDecisions([
    { kind: 'decision', text: 'no id' }, { id: 7, kind: 'decision', text: 'numeric id' }, { id: '', kind: 'decision', text: 'empty id' },
    { id: 'decision:console:ok', kind: 'decision', text: 'kept' },
  ]);
  assert.deepStrictEqual(plans.map((p) => p.factId), ['decision:console:ok']);
});

test('settleOpenDecisions: text falls back to summary, then to the id, never the literal undefined', () => {
  const [a, b] = settleOpenDecisions([
    { id: 'decision:console:a', kind: 'decision', summary: 'from summary' },
    { id: 'decision:console:b', kind: 'decision' },
  ]);
  assert.strictEqual(a.title, 'Packet decision left open: from summary');
  assert.strictEqual(b.title, 'Packet decision left open: decision:console:b');
  assert.ok(!a.proposal.includes('undefined') && !b.proposal.includes('undefined'));
});

test('settleOpenDecisions: a repeated fact id files once, first wins', () => {
  const plans = settleOpenDecisions([
    { id: 'decision:console:x', kind: 'decision', text: 'first' }, { id: 'decision:console:x', kind: 'decision', text: 'second' },
  ]);
  assert.strictEqual(plans.length, 1);
  assert.match(plans[0].title, /first$/);
});
