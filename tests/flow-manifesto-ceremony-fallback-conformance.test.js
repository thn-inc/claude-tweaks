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
const path = require('node:path');
const { readText, crlfCheckoutRead } = require('./helpers/read-skill');

const ROOT = path.join(__dirname, '..');
const read = (rel) => readText(path.join(ROOT, rel));
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

// --- Final-review gaps (#3160): case-1 adoption exemption, log timing, label stand-in ---

// The paragraph exactly as shipped before the final-review fix wave (HEAD 0d773f14a), collapsed.
// It is the control for the AC2.x pins: they must come back red on it.
const FROZEN_PRE_FIX_WAVE = '**Ceremony profile computation.** Unlike the other levers (policy preferences resolved via the precedence chain above), `ceremony-profile`\'s value is computed by folding every record\'s `ceremony:*` label (`facets.ceremony`, from Step 1\'s resolution fetch) with a logical AND: `fast-lane` only when every record in this run has `ceremony:fast-lane`; any record carrying an explicit `standard` sends the whole run\'s `ceremony-profile` to `standard` — mirrors the auto-merge gate\'s existing "every member of the group must carry `auto:merge`" rule (`dispatch/SKILL.md`\'s Auto-merge gate). A record that carries no `ceremony:*` label is judged here, before the fold: run the canonical pattern (`_shared/ceremony-check-invocation.md`) with `#{n}`, using Step 1\'s fetched body and labels, then log once per record: `node "${CLAUDE_PLUGIN_ROOT}/bin/log-decision.js" --run "$PIPELINE_RUN_DIR" --section "/flow" --status AUTO --step "Manifesto ceremony-check" --text "#{n} carries no ceremony:* label -> CEREMONY: {verdict}" --reversibility n/a`. This is the run\'s only verdict for that record: Step 4\'s materialize passes it through as `--ceremony` (cite `materialize.md`\'s `ceremony` bullet). Why here: the materialized header this lever used to read does not exist at Step 3, so `standard` was the only possible outcome for an unlabeled record (#3160). Output with no `CEREMONY:` line stops the pipeline before Step 4 with the generic failure card (`failure-cards.md`, gate `ceremony-check`); it is never defaulted to `standard`. Source is always `header`.';
const FROZEN_PRE_FIX_APPROVAL = 'Initialize `decisions.md` in the same directory with the config snapshot header (see `_shared/auto-decision-log.md`). Create the `staged/` subdirectory.';

// Returns the pins a (paragraph, approval-tail) pair fails; empty means all hold.
const gapPinsMissing = (para, approval) => {
  const missing = [];
  // Important 1: a case-1 adoption reads preflight.levers and must not re-judge or re-log.
  if (!para.includes('`preflight.adoption.value.case === 1`) omit this judgment and its log line')) missing.push('case-1 adoption exemption');
  if (!para.includes('the call that wrote `config.yml` already logged the verdict')) missing.push('case-1 reason (earlier call logged)');
  // Important 2: the verdict is held in memory and logged only once decisions.md exists.
  if (!para.includes('hold each verdict in memory')) missing.push('hold verdict in memory during Compute');
  if (!para.includes("log once per record only after the Approval flow section's write has created them")) missing.push('log deferred to the Approval flow write');
  if (!approval.includes('log the held ceremony-check verdicts')) missing.push('Approval flow logs the held verdicts');
  // Minor 6: a judged verdict stands in for the label in the logical AND.
  if (!para.includes('which stands in for the label')) missing.push('verdict stands in for the label');
  return missing;
};
const APPROVAL_LEAD = 'Initialize `decisions.md` in the same directory';

test('AC2.1: the verdict is held in memory and logged after the Approval flow write; a case-1 adoption neither re-judges nor re-logs', () => {
  const p = paragraph(MANIFESTO, LEAD);
  const a = paragraph(MANIFESTO, APPROVAL_LEAD);
  assert.ok(p, 'Ceremony profile computation paragraph missing');
  assert.ok(a, 'Approval flow decisions.md initialization paragraph missing');
  assert.deepStrictEqual(gapPinsMissing(p, a), []);
});

test('control: the frozen pre-fix-wave paragraph fails every AC2.x pin', () => {
  assert.deepStrictEqual(gapPinsMissing(FROZEN_PRE_FIX_WAVE, FROZEN_PRE_FIX_APPROVAL), [
    'case-1 adoption exemption',
    'case-1 reason (earlier call logged)',
    'hold verdict in memory during Compute',
    'log deferred to the Approval flow write',
    'Approval flow logs the held verdicts',
    'verdict stands in for the label',
  ]);
});

test('flow-manifesto: the paragraph search still finds its break under CRLF line endings (#3574)', () => {
  const FILE = path.join(ROOT, MANIFESTO);
  const { raw, text } = crlfCheckoutRead(FILE);
  assert.ok(raw.includes('\r\n'), 'the CRLF input must contain \\r\\n line breaks');
  assert.ok(!raw.includes('\r\r\n'), 'the CRLF input must not contain \\r\\r\\n');
  assert.strictEqual(raw.indexOf('\n\n'), -1, 'a raw CRLF read has no LF paragraph break');
  assert.strictEqual(text, readText(FILE));
  const at = text.indexOf(LEAD);
  assert.notStrictEqual(at, -1, 'the paragraph lead must be found');
  const para = collapse(text.slice(at, text.indexOf('\n\n', at)));
  assert.match(para, /\*\*Ceremony profile computation\.\*\*/);
  assert.ok(para.length < collapse(text).length);
});
