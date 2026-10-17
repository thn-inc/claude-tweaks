// tests/flow-manifesto-ceremony-fallback-conformance.test.js
//
// Pins #3160: flow's Manifesto (Step 3) folds `ceremony-profile` from each
// record's `ceremony:*` label, and a record that carries no such label is
// judged there by the ceremony-check fallback. Build-time materialize reuses
// that verdict through `--ceremony` instead of judging the record again.
//
// This suite reads live prose deliberately: the Ceremony profile computation
// paragraph is the contract this record changes, so the assertions are about
// what the shipped text says. Same house pattern as
// tests/manifesto-lever-conformance.test.js. FROZEN_PRE_3160 is the pre-#3160
// paragraph, kept as a control that proves the AC1.1/AC1.2 pins can go red.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const collapse = (s) => s.replace(/\s+/g, ' ');
const paragraph = (rel, lead) => {
  const raw = read(rel);
  const start = raw.indexOf(lead);
  if (start === -1) return null;
  const end = raw.indexOf('\n\n', start);
  return collapse(end === -1 ? raw.slice(start) : raw.slice(start, end));
};

const FROZEN_PRE_3160 = '**Ceremony profile computation.** Unlike the other levers (policy preferences resolved via the precedence chain above), `ceremony-profile`\'s value is computed by folding every record\'s materialized `ceremony:` header field (`materialize.md`) with a logical AND: `fast-lane` only when every record in this run has `ceremony: fast-lane`; any record missing the field (defaults to `standard`) or carrying an explicit `standard` sends the whole run\'s `ceremony-profile` to `standard` — mirrors the auto-merge gate\'s existing "every member of the group must carry `auto:merge`" rule (`dispatch/SKILL.md`\'s Auto-merge gate). Source is always `header`. The computed value still becomes this lever\'s Recommended value, overridable via the normal `9=value` mechanism below — unlike Design intent (locked in from `/specify`), `ceremony-check`\'s verdict is a fresh automated judgment call, and this Manifesto is the first point a human sees it.';

const MANIFESTO = 'plugin/skills/flow/manifesto.md';
const LEAD = '**Ceremony profile computation.**';

test('AC1.1: an unlabeled record is judged by ceremony-check at the Manifesto', () => {
  const p = paragraph(MANIFESTO, LEAD);
  assert.ok(p, 'Ceremony profile computation paragraph missing');
  assert.ok(p.includes('carries no `ceremony:*` label'), 'unlabeled-record condition missing');
  assert.ok(p.includes('`_shared/ceremony-check-invocation.md`'), 'canonical invocation pointer missing');
  assert.ok(p.includes('#{n} carries no ceremony:* label -> CEREMONY: {verdict}'), 'per-record verdict log line missing');
});

test('AC1.2: the fold never defaults an unlabeled record to standard', () => {
  const p = paragraph(MANIFESTO, LEAD);
  assert.ok(!p.includes('missing the field (defaults to `standard`)'), 'pre-#3160 missing-field default still present');
  assert.ok(p.includes('never defaulted to `standard`'), 'missing-verdict stop clause missing');
  assert.ok(!collapse(read(MANIFESTO)).includes('so the header always has a value'), 'lever-9 footnote still claims every record is labeled');
});

test('AC1.3: materialize reuses the Manifesto verdict instead of judging again', () => {
  const b = paragraph('plugin/skills/flow/materialize.md', '- `ceremony` — `facets.ceremony`');
  assert.ok(b, 'materialize.md ceremony bullet missing');
  assert.ok(b.includes('pass that verdict as `--ceremony`'), 'verdict pass-through missing');
  assert.ok(b.includes('#{n} carries no ceremony:* label -> CEREMONY: {verdict}'), 'materialize must name the line it reads');
  assert.ok(b.includes('Only a materialize with no such line'), 'standalone-build fallback clause missing');
  assert.ok(collapse(read('plugin/skills/flow/SKILL.md')).includes('Manifesto-time ceremony verdict as `--ceremony`'), 'flow Step 4 must pass the verdict to materialize');
});

test('control: the frozen pre-#3160 paragraph fails the AC1.1/AC1.2 pins', () => {
  assert.ok(!FROZEN_PRE_3160.includes('carries no `ceremony:*` label'));
  assert.ok(FROZEN_PRE_3160.includes('missing the field (defaults to `standard`)'));
});
