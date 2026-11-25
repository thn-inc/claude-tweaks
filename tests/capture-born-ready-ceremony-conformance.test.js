// tests/capture-born-ready-ceremony-conformance.test.js
//
// Pins #4118: /capture's Shaped-body branch judges ceremony inline and stamps
// `ceremony:*`, co-owning the label with /specify on that branch only. Reads
// live prose deliberately (same house pattern as
// tests/flow-manifesto-ceremony-fallback-conformance.test.js).
// FROZEN_PRE_4118_ROW is the /capture permission-matrix row at the plan's base,
// kept as a control proving the row assertion can go red.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');

const ROOT = path.join(__dirname, '..');
const read = (rel) => readText(path.join(ROOT, rel));
const collapse = (s) => s.replace(/\s+/g, ' ');
const matrixRow = (actor) => {
  const line = read('plugin/skills/_shared/work-record-permission-matrix.md')
    .split('\n').find((l) => l.startsWith('| **`' + actor + '`**'));
  assert.ok(line, 'row for ' + actor);
  return collapse(line);
};

const shapedBodyBranch = () => {
  const c = collapse(read('plugin/skills/capture/SKILL.md'));
  const start = c.indexOf('## Shaped-body branch');
  const end = c.indexOf('## Entry Format');
  assert.ok(start >= 0 && end > start, 'Shaped-body branch and Entry Format headings both present');
  return c.slice(start, end);
};

const FROZEN_PRE_4118_ROW = "| **`/capture`** | `by:capture`, Type (`type:*` only when `work-types: labels`), `needs:definition` (content judgment at filing time — see Judging Definition in `capture/SKILL.md`); `risk:*`, `size:*`, `ready` (**only** on the Shaped-body branch — structural check passed, `needs:definition` false, `via specShapedBody` footer present — see `capture/SKILL.md`); `size:*` on an **absorb target** record — a different, pre-existing record, raise-only, never lowered, on any branch (see Absorb mechanics in `capture/SKILL.md`) | nothing | `parked`, `auto:*`, `bot:*` — always; scoring and `ready` on the **new record** of any **stub** filing, at every ceiling (the Shaped-body branch is the sole exception, per Adds; the absorb-target `size:` raise is a write to a different record, not a scoring of the filing). Under `autonomy: trusted`+ with a `clean` `producer:capture` verdict the filing chains into `/claude-tweaks:specify --chained`, and *specify* stamps scoring and `ready` under its own row's authority (see `_shared/autonomy-ceiling.md`); the chain never fires alongside `needs:definition` — an undecided record cannot be born-ready |";

test('capture Shaped-body step 3 judges ceremony through the canonical pattern and passes it to recordPayload', () => {
  const branch = shapedBodyBranch();
  assert.ok(branch.includes('`_shared/ceremony-check-invocation.md`'));
  assert.ok(branch.includes('"ceremony": "<fast-lane|standard>, present only when'));
  assert.ok(!/accepted keys are wider[^)]*`ceremony`/.test(branch), 'ceremony still listed as never passed');
  assert.ok(branch.includes('never defaulted to `standard`'), 'missing-verdict clause');
  assert.ok(branch.includes('present only when the ceremony check returned a verdict — omit the key otherwise (null throws)'), 'ceremony payload key must be conditional');
});

test('the permission matrix grants /capture ceremony:* on the Shaped-body branch only', () => {
  const row = matrixRow('/capture');
  assert.ok(!FROZEN_PRE_4118_ROW.includes('`ceremony:*`'), 'control: the base row never named it');
  assert.ok(row.includes('`ceremony:*`'), 'row names ceremony:*');
  assert.ok(row.includes('`risk:*`, `size:*`, `ceremony:*`, `ready` (**only** on the Shaped-body branch'), 'Adds column');
  assert.ok(row.includes('scoring, `ceremony:*` and `ready` on the **new record** of any **stub** filing'), 'Never column');
});

test('no file still calls /specify the sole owner of ceremony:*, and the shared docs name /capture', () => {
  assert.ok(!collapse(read('plugin/skills/flow/materialize.md')).includes('remains the sole owner of `ceremony:*`'));
  const wr = collapse(read('plugin/skills/_shared/work-record.md'));
  const i = wr.indexOf('| Ceremony (2) |');
  assert.ok(i >= 0, 'Ceremony row present');
  const row = wr.slice(i, wr.indexOf(' |', wr.indexOf('stamped by', i)) + 2);
  assert.ok(row.includes("`/capture`'s Shaped-body branch"), 'work-record Ceremony row names /capture');
});

test('the presentation line carries ceremony:{c} and the no-verdict wording', () => {
  const branch = shapedBodyBranch();
  assert.ok(branch.includes('risk:{r} size:{s}, ceremony:{c}, ready)'), 'presentation line');
  assert.ok(branch.includes('ceremony check failed — filed without a ceremony label'), 'no-verdict wording');
});
