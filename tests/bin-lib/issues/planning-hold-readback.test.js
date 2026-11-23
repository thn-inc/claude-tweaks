'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  readBack, READBACK_BRANCHES, NEXT_ACTIONS, OUTCOME_TEMPLATES, HELD_BY_LINE, BLOCK_START, BLOCK_END,
} = require('../../../plugin/bin/lib/issues/planning-hold');

// #6100: readBack over the re-fetched record state after the planning answer.
const trusted = { authorAssociation: 'OWNER' };
const Q2 = ['- Question: Retry?', '  Option: Yes', '  Option: No', '  Recommended: Yes'];

function hold(questionLines = Q2) {
  return [
    '<!-- needs-decision: specify -->',
    '## Decision needed',
    '**Proposed:** x',
    '**Why:** planning held',
    '**Command:** `/claude-tweaks:specify #7`',
    HELD_BY_LINE,
    BLOCK_START,
    ...questionLines,
    BLOCK_END,
  ].join('\n');
}

const PLAN = 'Plan: refs/claude-tweaks/plans/7 ' + 'a'.repeat(40) + ' spec-sha256:' + 'b'.repeat(64);
const body = (planLines = [PLAN]) => 'Overview text\n' + planLines.join('\n') + '\n\n## Overview\nx\n';
const resolvedHold = () => ({
  id: 'IC_h',
  body: '**Resolved:** answered via /claude-tweaks:specify — 2026-11-23\n<!-- needs-decision: specify -->\nold',
  authorAssociation: 'OWNER',
  createdAt: '2026-11-23T10:00:00Z',
});
const freshHold = (extra = {}) => ({ id: 'IC_f', body: hold(), createdAt: '2026-11-23T11:00:00Z', ...trusted, ...extra });

function base(overrides = {}) {
  return {
    record: 7,
    branch: 'answered',
    labels: ['ready'],
    body: body(),
    comments: [resolvedHold()],
    planLine: PLAN,
    planCheck: { valid: true, failed: null },
    resolvedIds: ['IC_h'],
    answered: 2,
    otherUnresolved: 0,
    ...overrides,
  };
}
function reheld(overrides = {}) {
  const { otherUnresolved, ...rest } = base();
  void otherUnresolved;
  return {
    ...rest, branch: 're-held', labels: ['needs:decision'], comments: [resolvedHold(), freshHold()],
    reheldQuestions: ['Retry?'], answered: 1, ...overrides,
  };
}
const keptInput = (overrides = {}) => {
  const { otherUnresolved, ...rest } = base();
  void otherUnresolved;
  return { ...rest, branch: 'kept', labels: ['needs:decision'], ...overrides };
};

const T = {
  ready: 'answered — {k} planning question(s), ready (Plan: {short commit})',
  still: 'answered — {k} planning question(s); still needs:decision ({m} other decision comment(s))',
  kept: 'answered — {k} planning question(s); needs:decision kept (decision comments could not be re-read)',
  reheld: 'held — {j} answered, {k} re-held',
  failedAfterReHold: 'failed — read-back ({what}); re-run /claude-tweaks:specify #{n}',
  failedAfterWrite: 'failed — read-back ({what}); check the decision comments and remove needs:decision by hand once none is unresolved',
};

test('AC1.1: answered → ready', () => {
  const r = readBack(base());
  assert.equal(r.ok, true);
  assert.deepEqual(r.failed, []);
  assert.equal(r.outcome, 'answered — 2 planning question(s), ready (Plan: aaaaaaa)');
  assert.equal(r.next, 'ready');
  assert.deepEqual(r.assertions.map((a) => a.id), ['labels', 'resolved', 'plan-line', 'plan-check']);
});

test('AC1.1: answered with other unresolved → still needs:decision', () => {
  const r = readBack(base({ labels: ['needs:decision'], otherUnresolved: 3 }));
  assert.equal(r.ok, true);
  assert.equal(r.outcome, 'answered — 2 planning question(s); still needs:decision (3 other decision comment(s))');
  assert.equal(r.next, 'still-needs-decision');
});

test('AC1.1: kept → needs:decision kept', () => {
  const r = readBack(keptInput());
  assert.equal(r.ok, true);
  assert.equal(r.outcome, 'answered — 2 planning question(s); needs:decision kept (decision comments could not be re-read)');
  assert.equal(r.next, 'kept-needs-decision');
});

test('AC1.1: re-held → held', () => {
  const r = readBack(reheld());
  assert.equal(r.ok, true);
  assert.equal(r.outcome, 'held — 1 answered, 1 re-held');
  assert.equal(r.next, 'held-or-failed');
  assert.deepEqual(r.assertions.map((a) => a.id), ['labels', 'rehold', 'resolved', 'plan-line', 'plan-check']);
});

test('AC1.1: each assertion mis-decided goes red', () => {
  const cases = [
    ['answered with needs:decision present', base({ labels: ['ready', 'needs:decision'] }), ['labels']],
    ['answered m=0 without ready', base({ labels: [] }), ['labels']],
    ['kept with ready', keptInput({ labels: ['ready'] }), ['labels']],
    ['kept with both labels', keptInput({ labels: ['ready', 'needs:decision'] }), ['labels']],
    ['re-held with ready', reheld({ labels: ['needs:decision', 'ready'] }), ['labels']],
    ['re-held with other questions', reheld({ reheldQuestions: ['Other?'] }), ['rehold']],
    ['re-held, fresh hold resolved', reheld({ comments: [resolvedHold(), freshHold({ body: '**Resolved:** x\n' + hold() })] }), ['rehold']],
    ['resolved id missing', base({ resolvedIds: ['IC_missing'] }), ['resolved']],
    ['hold comment not resolved', base({ comments: [{ ...resolvedHold(), body: '<!-- needs-decision: specify -->\nold' }] }), ['resolved']],
    ['no resolved ids', base({ resolvedIds: [] }), ['resolved']],
    ['two Plan lines', base({ body: body([PLAN, PLAN]) }), ['plan-line']],
    ['zero Plan lines', base({ body: 'Overview text\n\n## Overview\nx\n' }), ['plan-line']],
    ['body commit differs', base({ body: body([PLAN.replace('a'.repeat(40), 'c'.repeat(40))]) }), ['plan-line']],
    ['unparseable plan line', base({ planLine: 'Plan: nonsense', body: body(['Plan: nonsense']) }), ['plan-line']],
    ['plan-check invalid', base({ planCheck: { valid: false, failed: 'hash' } }), ['plan-check']],
    ['plan-check null', base({ planCheck: null }), ['plan-check']],
    ['plan-check valid is a string', base({ planCheck: { valid: 'true' } }), ['plan-check']],
  ];
  for (const [name, input, failed] of cases) {
    const r = readBack(input);
    assert.equal(r.ok, false, name);
    assert.deepEqual(r.failed, failed, name);
  }
});

test('AC1.1: failed outcome keys its guidance on the branch', () => {
  const guide = 'failed — read-back (plan-check); check the decision comments and remove needs:decision by hand once none is unresolved';
  const a = readBack(base({ planCheck: null }));
  assert.equal(a.outcome, guide);
  assert.equal(a.next, 'kept-needs-decision');
  const k = readBack(keptInput({ planCheck: null }));
  assert.equal(k.outcome, guide);
  assert.equal(k.next, 'kept-needs-decision');
  const h = readBack(reheld({ reheldQuestions: ['Other?'] }));
  assert.equal(h.outcome, 'failed — read-back (rehold); re-run /claude-tweaks:specify #7');
  assert.equal(h.next, 'held-or-failed');
  const two = readBack(base({ labels: [], body: 'no plan\n' }));
  assert.deepEqual(two.failed, ['labels', 'plan-line']);
  assert.match(two.outcome, /^failed — read-back \(labels, plan-line\);/);
});

test('resolved: matches a REST comment by node_id or numeric id', () => {
  const comments = [{ id: 4242, node_id: 'IC_r', body: '**Resolved:** done\n<!-- needs-decision: specify -->', ...trusted }];
  assert.equal(readBack(base({ comments, resolvedIds: ['IC_r'] })).ok, true);
  assert.equal(readBack(base({ comments, resolvedIds: ['4242'] })).ok, true);
});

test('plan-line: a fenced Plan: line is not counted', () => {
  const b = body() + '```\n' + PLAN + '\n```\n';
  assert.equal(readBack(base({ body: b })).ok, true);
});

test('plan-line: CRLF and trailing spaces tolerated', () => {
  const b = body([PLAN + '  ']).replace(/\n/g, '\r\n');
  assert.equal(readBack(base({ body: b, planLine: PLAN + ' \r' })).ok, true);
});

test('input validation throws TypeError', () => {
  const bad = [
    base({ branch: 'nope' }),
    base({ record: 0 }),
    base({ answered: -1 }),
    base({ answered: 1.5 }),
    base({ otherUnresolved: undefined }),
    keptInput({ otherUnresolved: 0 }),
    reheld({ reheldQuestions: undefined }),
    reheld({ reheldQuestions: [] }),
    base({ reheldQuestions: ['Retry?'] }),
    base({ labels: 'ready' }),
  ];
  for (const input of bad) assert.throws(() => readBack(input), TypeError);
});

test('OUTCOME_TEMPLATES and NEXT_ACTIONS are the documented constants', () => {
  assert.deepEqual(OUTCOME_TEMPLATES, T);
  assert.deepEqual(NEXT_ACTIONS, ['ready', 'still-needs-decision', 'kept-needs-decision', 'held-or-failed']);
  assert.deepEqual(READBACK_BRANCHES, ['answered', 'kept', 're-held']);
});
