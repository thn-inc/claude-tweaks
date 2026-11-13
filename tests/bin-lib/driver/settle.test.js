'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { stripComments, stripperVerdict, STRIPPER_VERDICT_MESSAGES } = require('../../helpers/strip-comments');
const SETTLE = path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'lib', 'driver', 'settle.js');
const {
  DRIVER_ESCALATION_MARKER: MARKER, reduceDetail, commentFor, escalateDetailText, hasDriverEscalationMarker,
} = require(SETTLE);

const HOSTILE = '@octocat see [here](https://evil.example/x) /Users/alice/.ssh/id_rsa ghp_' + 'a'.repeat(36)
  + ' C:\\Users\\bob\\x ' + 'f'.repeat(40) + ' closes #12 <!-- hi --> `code`';

test('AC10.1, AC10.2: reduceDetail strips a hostile detail', () => {
  const out = reduceDetail(HOSTILE);
  for (const bad of ['@', '[', '](', '/Users/', 'ghp_', 'f'.repeat(40), '#', 'C:/Users', '`']) {
    assert.ok(!out.includes(bad), `output contains ${bad}: ${out}`);
  }
  assert.ok(!/<!--/.test(out));
  assert.ok(!out.includes('C:'), `drive letter survived: ${out}`);
  assert.ok(out.includes('at octocat'));
  assert.ok(out.includes('<path>'));
  assert.ok(out.includes('<redacted>'));
  assert.ok(out.length <= 200);
});

test('AC10.1: reduceDetail keeps only the allowed characters', () => {
  assert.match(reduceDetail('a\tb\nc$%^&*=+!?~|{}"\'é'), /^[A-Za-z0-9 .,:;_()/-]*$/);
});

test('AC10.1: reduceDetail caps at 200 and never ends in a partial placeholder', () => {
  const out = reduceDetail('x '.repeat(150) + '/abs/path');
  assert.ok(out.length <= 200);
  assert.ok(!/<[a-z]*$/.test(out));
  // Cut lands inside a placeholder: 195 filler chars then a path.
  const cut = reduceDetail('x'.repeat(196) + ' /abs/path');
  assert.ok(!/<[a-z]*$/.test(cut), cut);
  assert.equal(reduceDetail(''), 'none');
  assert.equal(reduceDetail(null), 'none');
});

test('AC10.1: every comment kind is built from the template plus a reduced detail', () => {
  for (const kind of ['escalated', 'blocked-record', 'blocked-pr', 'claim']) {
    const out = commentFor(kind, { step: 'push', outcome: 'blocked', reason: 'express-error', exitCode: 4, detail: HOSTILE });
    for (const bad of ['@', '/Users/', 'ghp_', '#12']) assert.ok(!out.includes(bad), `${kind} contains ${bad}`);
    assert.ok(out.includes(reduceDetail(HOSTILE)), kind);
  }
});

test('commentFor: template details per kind', () => {
  const f = { step: 'test', outcome: 'blocked', detail: 'red' };
  assert.match(commentFor('blocked-record', { ...f, kept: true }), /Labelled bot:blocked and the claim released\. The draft PR, branch and worktree were kept for a human\. Clear/);
  assert.match(commentFor('blocked-record', { ...f, kept: false }), /released\. Clear bot:blocked/);
  assert.match(commentFor('claim', { ...f, exitCode: 4 }), /failed \(claim-targets\.js exit 4\)\. Detail/);
  assert.match(commentFor('claim', { ...f, exitCode: 'x' }), /failed\. Detail/);
  assert.throws(() => commentFor('nope', f));
});

test('AC11.1: the escalated comment ends with the marker, no other kind contains it', () => {
  const f = { step: 'push', outcome: 'express-escalated', reason: 'r', detail: 'd' };
  assert.ok(commentFor('escalated', f).endsWith(MARKER));
  for (const kind of ['blocked-record', 'blocked-pr', 'claim']) {
    assert.ok(!commentFor(kind, f).includes(MARKER), kind);
  }
});

test('AC11.1: hasDriverEscalationMarker trusts only OWNER/MEMBER/COLLABORATOR', () => {
  const body = 'x\n\n' + MARKER;
  assert.equal(hasDriverEscalationMarker([{ authorAssociation: 'MEMBER', body }]), true);
  assert.equal(hasDriverEscalationMarker([{ authorAssociation: 'NONE', body }]), false);
  assert.equal(hasDriverEscalationMarker([{ body }]), false);
  assert.equal(hasDriverEscalationMarker([]), false);
  for (const bad of ['x', null, {}]) assert.equal(hasDriverEscalationMarker(bad), null);
  assert.equal(hasDriverEscalationMarker([{ authorAssociation: 'MEMBER', body: MARKER + ' later text' }]), false);
});

test('escalate detail names the removal', () => {
  const yes = escalateDetailText({ step: 'test', detail: 'red tests', removes: true });
  assert.equal(yes, 'drive.js stopped at step test: red tests. The driver removed the worktree and local branch this run created.');
  assert.ok(!escalateDetailText({ step: 'test', detail: 'red tests', removes: false }).includes('removed'));
});

test('AC6.1: settle.js requires no model module', () => {
  const raw = fs.readFileSync(SETTLE, 'utf8');
  const stripped = stripComments(raw);
  assert.equal(stripperVerdict(raw, stripped), 'ok', STRIPPER_VERDICT_MESSAGES[stripperVerdict(raw, stripped)]);
  const bad = (s) => /require\([^)]*\b(worker|roles)\b/.test(s) || /['"]\.\/(worker|roles)(\.js)?['"]/.test(s);
  assert.ok(!bad(stripped));
  assert.ok(bad("const w = require('./worker');"), 'go-red control');
});
