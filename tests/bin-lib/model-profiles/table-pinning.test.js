// tests/bin-lib/model-profiles/table-pinning.test.js
//
// Pins the contract's Model Selection table to PROFILES, the GATE_COVERAGE
// precedent. Reads live prose deliberately (IL-80 exception): the coverage
// table is a declared contract whose update IS the intended action.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { PROFILES, effortLine } = require('../../../plugin/bin/lib/model-profiles/profiles');
const { readText } = require('../../helpers/read-skill');

// Model Selection moved from subagent-output-contract.md to subagent-dispatch-core.md at #2019.
const CONTRACT = path.join(__dirname, '..', '..', '..', 'plugin', 'skills', '_shared', 'subagent-dispatch-core.md');

function modelSelectionSection() {
  const text = readText(CONTRACT);
  const start = text.indexOf('## Model Selection');
  assert.ok(start !== -1, 'subagent-dispatch-core.md must contain a ## Model Selection section');
  const end = text.indexOf('\n## ', start + 1);
  return text.slice(start, end === -1 ? undefined : end);
}

function tableRows(section) {
  return section.split('\n')
    .filter((l) => /^\| (Fast|Standard|Capable|Frontier) \|/.test(l))
    .map((l) => l.split('|').map((c) => c.trim()).filter(Boolean));
}

test('the contract table rows match PROFILES exactly', () => {
  const rows = tableRows(modelSelectionSection());
  assert.strictEqual(rows.length, 4, 'exactly four profile rows');
  for (const [name, model, effort] of rows) {
    const key = name.toLowerCase();
    assert.ok(PROFILES[key], `row "${name}" has a PROFILES entry`);
    assert.strictEqual(model, PROFILES[key].model, `${name}: model`);
    assert.strictEqual(effort === '—' ? null : effort, PROFILES[key].effort, `${name}: effort`);
  }
});

test('the Frontier row states its constraints', () => {
  const rows = tableRows(modelSelectionSection());
  const frontier = rows.find((r) => r[0] === 'Frontier');
  assert.match(frontier[3], /Singleton-only/);
  assert.match(frontier[3], /degrades to Capable/i);
});

// The prose template the Dispatching paragraph publishes. Pinning it as a
// literal here is what stops prose and function drifting apart: the first
// assertion below fails if the contract's wording moves, the second if
// effortLine's does. Neither passes on its own.
const EFFORT_TEMPLATE = '[Effort: {level} — apply {level}-level reasoning depth to this task.]';

test('the section cites the resolver CLI and the effortLine template shape', () => {
  const section = modelSelectionSection();
  assert.match(section, /node "\$\{CLAUDE_PLUGIN_ROOT\}\/bin\/resolve-profile\.js"/);
  assert.match(section, /\[Use: \{Profile\}\]/);
  assert.ok(section.includes(EFFORT_TEMPLATE),
    'the Dispatching paragraph must publish effortLine\'s literal template');
  // Substituting the placeholder must reproduce what the function emits.
  assert.strictEqual(EFFORT_TEMPLATE.replaceAll('{level}', 'high'), effortLine('high'));
  // effortLine's rendered form for high, derived independently of the template.
  assert.strictEqual(effortLine('high'), '[Effort: high — apply high-level reasoning depth to this task.]');
});


// The named fan-out exception has two prose twins of FRONTIER_EXCEPTIONS and
// STEP_DOWN_REASONS: one row in the dispatch core's enumerated-slots table and
// the paragraph in _shared/frontier-exception.md. Each is pinned to the code
// constants, with a go-red control that runs the same assertion on a mutated copy.
const { FRONTIER_EXCEPTIONS, STEP_DOWN_REASONS } = require('../../../plugin/bin/lib/model-profiles/profiles');

const EXCEPTION_FILE = path.join(__dirname, '..', '..', '..', 'plugin', 'skills', '_shared', 'frontier-exception.md');

function exceptionRow(section) {
  const row = section.split('\n').find((l) => l.startsWith('| Named fan-out exception'));
  assert.ok(row, 'the enumerated-slots table has a Named fan-out exception row');
  return row;
}

function assertExceptionRow(section) {
  const row = exceptionRow(section);
  for (const [name, { limit }] of Object.entries(FRONTIER_EXCEPTIONS)) {
    assert.ok(row.includes(`--exception ${name}`), `row names --exception ${name}`);
    assert.ok(row.includes(String(limit)), `row states the limit ${limit}`);
  }
  assert.match(row, /stops and asks/);
  assert.ok(row.includes('_shared/frontier-exception.md'), 'row points at the full rules');
}

function exceptionParagraph(text) {
  const para = text.split('\n\n').find((p) => p.startsWith('**Named fan-out exception.**'));
  assert.ok(para, 'frontier-exception.md has a **Named fan-out exception.** paragraph');
  return para;
}

function assertExceptionParagraph(text) {
  const para = exceptionParagraph(text);
  const reasons = para.match(/`(tally|policy|stance|ceiling|limit|session-failure)`/g).map((s) => s.slice(1, -1));
  assert.deepStrictEqual(reasons, [...STEP_DOWN_REASONS], 'reasons in precedence order');
  assert.match(para, /exits 3/);
  assert.match(para, /`\{"stepDown":\{"reason":/);
  assert.ok(para.includes('--session-dir'), 'names --session-dir');
  for (const [name, { limit }] of Object.entries(FRONTIER_EXCEPTIONS)) {
    assert.ok(para.includes(`\`--exception ${name}\``), `paragraph names --exception ${name}`);
    assert.ok(para.includes(String(limit)), `paragraph states the limit ${limit}`);
  }
}

test('the enumerated-slots row names every FRONTIER_EXCEPTIONS entry with its limit', () => {
  assertExceptionRow(modelSelectionSection());
});

test('the exception row pin fails on a row missing the limit', () => {
  const section = modelSelectionSection();
  const row = exceptionRow(section);
  assert.ok(row.includes('22'), 'the row carries the limit to corrupt');
  assert.throws(() => assertExceptionRow(section.replace(row, row.replaceAll('22', '21'))));
  assert.throws(() => assertExceptionRow(section.replace(row, row.replace('stops and asks', 'stops'))));
});

test('frontier-exception.md lists STEP_DOWN_REASONS in precedence order and states the exit codes', () => {
  assertExceptionParagraph(readText(EXCEPTION_FILE));
});

test('the exception paragraph pin fails on swapped reasons and a missing exit code', () => {
  const text = readText(EXCEPTION_FILE);
  assert.throws(() => assertExceptionParagraph(text.replace('`policy`, `stance`', '`stance`, `policy`')));
  assert.throws(() => assertExceptionParagraph(text.replace('exits 3', 'exits 2')));
  assert.throws(() => assertExceptionParagraph(text.replaceAll('--session-dir', '--dir')));
});
