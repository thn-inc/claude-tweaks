'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..', '..');
const { DECISION_FACT_KIND, DECISION_ORIGINS, DECISION_FACT_FIELDS, decisionFactFor, decisionOrigin } = require(path.join(ROOT, 'plugin', 'bin', 'lib', 'console', 'decision-facts'));

// Live prose read: the table is the schema's single owner and the module is its code twin [IL-80 carve-out].
const PACKET = fs.readFileSync(path.join(ROOT, 'plugin', 'skills', '_shared', 'acceptance-packet.md'), 'utf8');

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

test('decisionFactFor: POSIX separators even when the run dir uses backslashes in its base name handling', () => {
  const f = decisionFactFor({ id: 'a', section: 'Pending review', resolution: 'pending', reason: 'r' }, { runDir: path.join('/r', 'run-1'), staged: false });
  assert.ok(!f.evidenceRef.includes('\\'));
});

test('suggestedResolution: refused and any other resolution', () => {
  const runDir = path.join('/r', 'run-1');
  const mk = (resolution) => decisionFactFor({ id: 'a', section: 'Queue writes', resolution, reason: 'r' }, { runDir, staged: false }).suggestedResolution;
  assert.strictEqual(mk('refused'), 'supply a Defer-reason, or decline');
  assert.strictEqual(mk('weird'), 'decide, then apply or decline');
});
