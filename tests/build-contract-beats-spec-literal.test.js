'use strict';
// tests/build-contract-beats-spec-literal.test.js — pins #3557: /build's SDD invocation (dispatch.md)
// tells /superpowers:subagent-driven-development that spec-mandated literal text never overrides a
// project contract (_shared/*.md). When the two conflict, every ruling conforms to the contract and the
// departure is recorded as a build-deviation — the instruction directs a ruling, not a question.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { readText } = require('./helpers/read-skill');
const ROOT = path.join(__dirname, '..');
const DISPATCH = readText(path.join(ROOT, 'plugin', 'skills', 'build', 'dispatch.md'));

const LABEL = '**Project contract beats spec-mandated literal text (#3557).**';
const REVIEW_LABEL = '**Review findings go through the deferral gate (#3004).**';
const CARRY_LABEL = '**Carry forward surviving SDD ledger residue';

function instructionSlice() {
  const start = DISPATCH.indexOf(LABEL);
  assert.ok(start !== -1, 'the contract-beats-spec-literal label is not in dispatch.md');
  const end = DISPATCH.indexOf(CARRY_LABEL, start);
  assert.ok(end > start, 'no following bold label after the contract-beats-spec-literal label');
  return DISPATCH.slice(start, end);
}

function assertInstruction(text) {
  assert.match(
    text,
    /also direct `\/superpowers:subagent-driven-development`/,
    'the instruction does not direct /superpowers:subagent-driven-development'
  );
  assert.match(text, /_shared\/\*\.md/, 'the instruction does not name the _shared/*.md contract');
  assert.match(text, /conforms to the contract/, 'the instruction does not require rulings to conform to the contract');
  assert.match(text, /update-the-spec deviation/, 'the instruction does not record the departure as an update-the-spec deviation');
  assert.match(text, /build-deviation-/, 'the instruction does not stage the departure as build-deviation-{N}');
  assert.match(text, /Ruling: contract-beats-spec —/, 'the instruction does not name the ledgered Ruling: line shape');
  assert.match(text, /in place of `sdd-ruling-\{N\}`/, 'the instruction does not route the deviation in place of sdd-ruling-{N}');
  assert.match(text, /every `sdd-ruling` name in that procedure/, 'the instruction does not rename the sdd-ruling names in the carry-forward procedure');
  assert.match(text, /dispositions read apply \/ decline rather than ratify \/ reverse/, 'the instruction does not set apply / decline dispositions');
  assert.match(
    text,
    /never kept on the grounds that the spec spelled it out/,
    'the instruction does not forbid keeping the spec text because the spec spelled it out'
  );
}

function assertRuling(text) {
  assert.match(text, /ruling/, 'the instruction does not direct a ruling');
  assert.doesNotMatch(text, /AskUserQuestion/, 'the instruction routes the conflict to a question instead of a ruling');
}

test('AC2.1: build/dispatch.md carries the contract-beats-spec-literal instruction', () => {
  assertInstruction(instructionSlice());
});

test('AC3.1 + AC3.2: the build instruction directs a ruling, not a question', () => {
  assertRuling(instructionSlice());
});

test('AC2.1: the instruction sits in the SDD subagent paragraph, after the deferral gate and before the ledger carry-forward, on the same line', () => {
  const start = DISPATCH.indexOf(LABEL);
  assert.ok(start !== -1, 'the contract-beats-spec-literal label is not in dispatch.md');
  assert.ok(DISPATCH.indexOf(REVIEW_LABEL) !== -1, 'the review-findings deferral-gate (#3004) label is not in dispatch.md');
  assert.ok(start > DISPATCH.indexOf(REVIEW_LABEL), 'the label is not after the review-findings deferral-gate label');
  assert.ok(start < DISPATCH.indexOf(CARRY_LABEL), 'the label is not before the carry-forward label');
  const lineStart = DISPATCH.lastIndexOf('\n', start - 1) + 1;
  const lineEnd = DISPATCH.indexOf('\n', start);
  const line = DISPATCH.slice(lineStart, lineEnd === -1 ? DISPATCH.length : lineEnd);
  assert.ok(line.includes('**subagent** (default):'), 'the label is not on the same line as the SDD subagent paragraph');
});

test('AC2.1: architecture-alignment.md does not re-stage a contract-beats-spec deviation', () => {
  const alignment = readText(path.join(ROOT, 'plugin', 'skills', 'build', 'architecture-alignment.md'));
  const start = alignment.indexOf('## Check');
  const end = alignment.indexOf('## Classification');
  assert.ok(start !== -1 && end > start, 'architecture-alignment.md lacks ## Check followed by ## Classification');
  const check = alignment.slice(start, end);
  assert.match(check, /contract-beats-spec ruling \(#3557/, 'the ## Check section does not cite the contract-beats-spec ruling');
  assert.match(check, /in any mode/, 'the ## Check section does not apply the exclusion in any mode');
});
