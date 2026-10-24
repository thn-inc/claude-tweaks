'use strict';

// Pins every /claude-tweaks:flow command form dispatch hands to a headless Task call to
// carry an explicit `auto` mode token after its step list (#3335). Without it, a project
// with `auto-mode: default-off` resolves each dispatched /flow call to `interactive`, which
// a headless call cannot honor. Covers the 4 forms in task-prompt.md's two fenced blocks
// and the 4 restated forms on SKILL.md's Singleton/Bundle group lines.
// Live-file read, not a frozen fixture: the command text IS the contract being enforced
// (skill-prose-conformance-tests' declared-contract carve-out).

const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');

const TASK_PROMPT = path.join(__dirname, '..', 'plugin', 'skills', 'dispatch', 'task-prompt.md');
const SKILL = path.join(__dirname, '..', 'plugin', 'skills', 'dispatch', 'SKILL.md');
const FIRST_HEADING = '## First call — build,test';
const SECOND_HEADING = '## Second call — review,polish,wrap-up';

function read(file) {
  return readText(file);
}

// The first fenced block in a section — the operative template inlined verbatim into
// that call's Task() prompt.
function fencedBlock(section) {
  const m = section.match(/^```\n([\s\S]*?)^```$/m);
  if (!m) throw new Error('no fenced template block in section');
  return m[1];
}

// Each /claude-tweaks:flow form's step list, plus the ` auto` token when it follows it.
// \s+ spans the second call's singleton line break between #{issue} and its step list.
const FORM = /\/claude-tweaks:flow\s+\S+\s+(build,test|review,polish,wrap-up)(\s+auto\b)?/g;

function forms(text) {
  return [...text.matchAll(FORM)];
}

function assertTwoFormsAllWithAuto(text, label) {
  const found = forms(text);
  assert.strictEqual(found.length, 2, `expected exactly 2 flow forms ${label}`);
  for (const m of found) {
    assert.ok(m[2], `flow form lacks auto after its step list: ${m[0]}`);
  }
}

// --- Proof the extractor can go red (synthetic fixture) ---

test('forms() flags a step list that is not followed by auto', () => {
  const bare = forms('`/claude-tweaks:flow #1 build,test`');
  assert.strictEqual(bare.length, 1);
  assert.strictEqual(bare[0][2], undefined);
  const explicit = forms('`/claude-tweaks:flow "#1,#2" build,test auto`');
  assert.strictEqual(explicit.length, 1);
  assert.strictEqual(explicit[0][2], ' auto');
});

// --- Live files ---

test('task-prompt.md: each fenced Task-scope block carries 2 flow forms, all ending their step list with auto', () => {
  const text = read(TASK_PROMPT);
  const a = text.indexOf(FIRST_HEADING);
  const b = text.indexOf(SECOND_HEADING);
  assert.ok(a !== -1 && b !== -1 && b > a, 'first/second call headings not found in order');
  for (const section of [text.slice(a, b), text.slice(b)]) {
    assertTwoFormsAllWithAuto(fencedBlock(section), 'per fenced block');
  }
});

test('SKILL.md: Singleton group and Bundle group lines each carry 2 flow forms, all with auto', () => {
  const lines = read(SKILL).split('\n').filter((l) => /^\*\*(Singleton|Bundle) group\*\*/.test(l));
  assert.strictEqual(lines.length, 2, 'expected exactly the Singleton and Bundle group lines');
  for (const line of lines) {
    assertTwoFormsAllWithAuto(line, `on: ${line.slice(0, 40)}`);
  }
});

test('task-prompt.md: rationale paragraph sits right after the Before-substituting paragraph, outside the fence', () => {
  const text = read(TASK_PROMPT);
  const a = text.indexOf(FIRST_HEADING);
  const prose = text.slice(a, text.indexOf('\n```\n', a));
  const paras = prose.split('\n\n');
  const before = paras.findIndex((p) => p.startsWith('**Before substituting this template**'));
  assert.ok(before !== -1, 'Before-substituting paragraph not found');
  const rationale = paras[before + 1] || '';
  assert.match(rationale, /headless and cannot answer `interactive` prompts, so both calls pass `auto` explicitly/);
  assert.match(rationale, /an explicit mode argument outranks the project's `auto-mode` policy/);
  assert.match(rationale, /`autonomy` ceiling still bounds what the run may do/);
});
