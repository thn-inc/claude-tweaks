// tests/bin-lib/model-profiles/table-pinning.test.js
//
// Pins the contract's Model Selection table to PROFILES, the GATE_COVERAGE
// precedent. Reads live prose deliberately (IL-80 exception): the coverage
// table is a declared contract whose update IS the intended action.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { PROFILES, effortLine } = require('../../../plugin/bin/lib/model-profiles/profiles');

// Model Selection moved from subagent-output-contract.md to subagent-dispatch-core.md at #2019.
const CONTRACT = path.join(__dirname, '..', '..', '..', 'plugin', 'skills', '_shared', 'subagent-dispatch-core.md');

function modelSelectionSection() {
  const text = fs.readFileSync(CONTRACT, 'utf8');
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
