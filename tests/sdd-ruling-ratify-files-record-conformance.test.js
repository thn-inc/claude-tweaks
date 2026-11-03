'use strict';
// #3942: ratifying a deferral sdd-ruling-* item files a backlog record. The rule
// is stated once, in wrap-up/review-console-appendix.md's sdd-ruling-* bullet,
// and its code twin is console/sdd-ruling.js's SDD_RULING_RATIFY_ACTIONS /
// sddRulingRatifyAction. This pins the two equal (prose-code-twin-pin: iterate
// the frozen object, with a floor, never name its members one by one), and pins
// every other console surface to the deferral ratify's outcome.
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { readText } = require('./helpers/read-skill');

const ROOT = path.join(__dirname, '..');
const SKILLS = path.join(ROOT, 'plugin', 'skills');
const { SDD_RULING_RATIFY_ACTIONS, sddRulingRatifyAction, sddRulingDeferralReason } = require(path.join(ROOT, 'plugin', 'bin', 'lib', 'console', 'sdd-ruling'));
const { RATIFY_FILES_RECORD_REASON } = require(path.join(ROOT, 'plugin', 'bin', 'lib', 'console', 'resolve'));

const ws = (s) => new RegExp(s.trim().split(/\s+/).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+'));
const read = (rel) => readText(path.join(SKILLS, rel));
const APPENDIX = read('wrap-up/review-console-appendix.md');

function assertRatifyRule(text) {
  const actions = Object.values(SDD_RULING_RATIFY_ACTIONS);
  assert.ok(actions.length >= 2, 'SDD_RULING_RATIFY_ACTIONS must not be emptied');
  for (const action of actions) assert.match(text, ws(`\`${action}\``), `appendix names ratify action ${action}`);
  assert.match(text, ws('Resolution `ratified → #{new record}`'));
  assert.match(text, ws('stages it as `staged/ledger-record-sdd-ruling-{N}.md`'));
  assert.match(text, ws('never `accepted`, never `deferred` without a record number'));
  assert.match(text, ws("the staged file's own `Defer-reason:`"));
}

test('AC1.1 AC2.1 AC3.1: the appendix states the ratify-files-a-record rule for every SDD_RULING_RATIFY_ACTIONS member', () => {
  assertRatifyRule(APPENDIX);
});

test('go-red: the rule check fails when the appendix drops the file-record action', () => {
  assert.throws(() => assertRatifyRule(APPENDIX.split('`file-record`').join('`filed`')));
});

test('go-red: the rule check fails when the appendix drops the ratified → #{new record} outcome', () => {
  assert.throws(() => assertRatifyRule(APPENDIX.split('ratified → #{new record}').join('ratified')));
});

test('AC1.1: a Defers: yes + valid reason header classifies as file-record, a Defers: no header as accept', () => {
  assert.strictEqual(sddRulingRatifyAction('Ruling: x — why\nDefers: yes\nDefer-reason: genuinely-larger\n\nbody'), SDD_RULING_RATIFY_ACTIONS.FILE_RECORD);
  assert.strictEqual(sddRulingRatifyAction('Ruling: x — why\nDefers: no\n\nbody'), SDD_RULING_RATIFY_ACTIONS.ACCEPT);
});

test('AC1.1: every console surface that ratifies a ruling states or cites the deferral ratify outcome', () => {
  for (const rel of [
    'wrap-up/review-console.md',
    'wrap-up/review-console-interactive.md',
    'flow/multispec-review-console.md',
    '_shared/console-execution.md',
    '_shared/console-on-pr.md',
  ]) {
    assert.match(read(rel), ws('ratified → #'), `${rel} names the deferral ratify outcome`);
  }
});

test('AC3.1: console-execution.md routes a failed ratify filing through --filing-failed', () => {
  assert.match(read('_shared/console-execution.md'), ws('When a deferral ratify\'s record was refused or never created, pass that ruling\'s id in `--filing-failed` instead, per Execution routing above'));
});

const EXECUTION = read('_shared/console-execution.md');
const routingSlice = () => {
  const start = EXECUTION.indexOf('## Execution routing');
  const end = EXECUTION.indexOf('## Write order after execution');
  assert.ok(start >= 0 && end > start, 'console-execution.md keeps its Execution routing and Write order sections');
  return EXECUTION.slice(start, end);
};
// Removes every occurrence of a phrase, however the prose wraps it; the phrase must be
// present first, so a go-red control never passes on a mutation that removed nothing.
const without = (text, phrase) => {
  const re = new RegExp(ws(phrase).source, 'g');
  assert.match(text, re, `the control's phrase is present before it is removed: ${phrase}`);
  return text.replace(re, '');
};

function assertGateWithheldRatify(text) {
  assert.match(text, ws('a human ratify of a gate-withheld ruling files the record too'));
  assert.match(text, ws('`needs-human-decision` included — the human\'s tick is the decision'));
}

test('AC5.1: the appendix states a human ratify of a gate-withheld deferral files a record, carrying needs-human-decision', () => {
  assertGateWithheldRatify(APPENDIX);
});

test('go-red: the gate-withheld ratify check fails when the appendix drops its rule sentence', () => {
  const mutated = without(APPENDIX, 'a human ratify of a gate-withheld ruling files the record too');
  assert.throws(() => assertGateWithheldRatify(mutated));
});

test('AC5.1 AC5.2: a gate-withheld header (Defers: yes, no reason) is file-record yet held', () => {
  const text = 'Ruling: x — why\nDefers: yes\n\nbody';
  assert.strictEqual(sddRulingRatifyAction(text), SDD_RULING_RATIFY_ACTIONS.FILE_RECORD);
  assert.strictEqual(sddRulingDeferralReason(text), 'sdd-ruling-deferral-no-defer-reason');
});

test('AC5.1: console-execution.md gives a gapped ruling row its ratifyAction', () => {
  assert.match(EXECUTION, ws('A withheld ruling row still carries its `ratifyAction`'));
});

test('AC3.1: console-execution.md\'s Execution routing sends a failed ratify filing to --filing-failed', () => {
  assert.match(routingSlice(), ws('A ticked deferral ruling whose record was refused or not created goes in `resolve-console --filing-failed`'));
});

test('AC3.1: the Write order outcome list names filing-failed for a ruling row', () => {
  assert.match(EXECUTION, ws('filing-failed for a finding or ruling row'));
});

test('AC3.1: a console-auto failed ratify filing rewrites the ruling item, not the derived proposal', () => {
  assert.match(APPENDIX, ws('failed-execution rewrite with `{name}` = the ruling item `sdd-ruling-{N}.md`'));
});

function assertAgreeingDefersNo(text) {
  assert.match(text, ws('or several `Defers:` lines, every one `no`, with no `Defer-reason:` line'));
}

test('AC6.1: the appendix accept sub-bullet names agreeing Defers: no lines, matching the code', () => {
  assertAgreeingDefersNo(APPENDIX);
  assert.strictEqual(sddRulingRatifyAction('Ruling: x — why\nDefers: no\nDefers: no\n\nbody'), SDD_RULING_RATIFY_ACTIONS.ACCEPT);
});

test('go-red: the agreeing Defers: no check fails when the appendix drops the phrase', () => {
  const mutated = without(APPENDIX, 'or several `Defers:` lines, every one `no`, with no `Defer-reason:` line');
  assert.throws(() => assertAgreeingDefersNo(mutated));
});

function assertNotRatifiable(text) {
  assert.match(text, ws('a ruling whose staged file is empty, blank, or cannot be read'));
}

test('AC6.3: the appendix names an empty, blank or unreadable staged file not ratifiable, matching the code', () => {
  assertNotRatifiable(APPENDIX);
  assert.strictEqual(sddRulingRatifyAction(''), null);
  assert.strictEqual(sddRulingRatifyAction('  \n'), null);
});

test('go-red: the not-ratifiable check fails when the appendix drops the phrase', () => {
  const mutated = without(APPENDIX, 'a ruling whose staged file is empty, blank, or cannot be read');
  assert.throws(() => assertNotRatifiable(mutated));
});

// The sentence runs from the ruling's subject to its routing; a sentence break
// (a period followed by whitespace) between them means the routing is not its own.
test('AC6.3: an unratifiable ticked ruling is routed to --filing-failed', () => {
  const slice = routingSlice();
  const m = ws('A ticked ruling with no `ratifyAction`').exec(slice);
  assert.ok(m, 'Execution routing names a ticked ruling with no ratifyAction');
  const rest = slice.slice(m.index);
  const at = rest.search(ws('`resolve-console --filing-failed`'));
  assert.ok(at >= 0, 'the routing slice names resolve-console --filing-failed after it');
  assert.doesNotMatch(rest.slice(0, at), /\.\s/, 'resolve-console --filing-failed sits in the same sentence');
});

const NO_RATIFY_ACTION = 'a ruling with no ratify action files nothing — its row stays `open`';
function assertCitesNotRatifiable(text) {
  assert.match(text, ws(NO_RATIFY_ACTION));
}

test('AC6.3: every accept-or-deferral console surface cites the not-ratifiable rule', () => {
  for (const rel of [
    'wrap-up/review-console.md',
    'wrap-up/review-console-interactive.md',
    'flow/multispec-review-console.md',
  ]) {
    assertCitesNotRatifiable(read(rel));
  }
});

test('go-red: the not-ratifiable citation check fails when review-console.md drops the phrase', () => {
  const mutated = without(read('wrap-up/review-console.md'), NO_RATIFY_ACTION);
  assert.throws(() => assertCitesNotRatifiable(mutated));
});

// The appendix quotes the apply reason a console-auto file-record ruling resolves under; the
// quote, up to its ellipsis, is a prefix of resolve.js's RATIFY_FILES_RECORD_REASON.
function assertQuotedApplyReason(text) {
  const m = /with the reason\s+`([^`]+?)\s*…`/.exec(text);
  assert.ok(m, 'the appendix quotes the file-record apply reason');
  const quoted = m[1].replace(/\s+/g, ' ');
  assert.ok(RATIFY_FILES_RECORD_REASON.startsWith(quoted), `"${quoted}" is a prefix of RATIFY_FILES_RECORD_REASON`);
}

test('AC1.1: the appendix\'s quoted apply reason is a prefix of RATIFY_FILES_RECORD_REASON', () => {
  assertQuotedApplyReason(APPENDIX);
});

test('go-red: the quoted apply reason check fails when the appendix quote drifts from the code', () => {
  const quote = '`ratify files a deferral record …`';
  assert.ok(APPENDIX.includes(quote), 'the control\'s quote is present before it is changed');
  assert.throws(() => assertQuotedApplyReason(APPENDIX.replace(quote, '`ratify files a backlog record …`')));
});
