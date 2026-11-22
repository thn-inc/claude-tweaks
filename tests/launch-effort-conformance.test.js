'use strict';

// #5941: a launched agent runs at the effort its work profile names. The contract paragraph
// (`_shared/subagent-dispatch-core.md`'s **Dispatching.**) binds the resolver's `launchEffort` to
// the Agent tool's `effort` parameter, and every skill that restates "pass the returned model"
// beside resolve-profile.js must name `launchEffort` too.
//
// Live-corpus scan, deliberately not a frozen fixture: this is the declared-contract carve-out
// (skill-prose-conformance-tests), the prose IS the convention, and a future dispatch site that
// restates the model rule without launchEffort is exactly what the site sweep must catch.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');
const { missingFactsOf, assertEachPatternGoesRed } = require('./helpers/conformance-asserts');

const SKILLS_DIR = path.join(__dirname, '..', 'plugin', 'skills');

// The phrasings by which a skill restates "pass the resolved model on the Agent call". One regex,
// so the sweep and the detector cannot drift; each alternative has a fixture below.
const MODEL_RESTATEMENT = /Agent tool's `model`|`model` parameter|pass `model` explicitly|pass the resolved `model`|returned `model` value|passed as `model`|pass the printed `model` field/;

// Sites that match MODEL_RESTATEMENT beside resolve-profile.js and are exempt by name. The workflow
// script's agents are a Non-Goal of #5941: the script receives `model` per lens and sets no effort.
const WORKFLOW_SCRIPT_EXEMPT = new Set(['_shared/subagent-output-contract.md']);

function markdownUnder(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...markdownUnder(full));
    else if (entry.name.endsWith('.md')) out.push(full);
  }
  return out;
}

const SKILL_FILES = markdownUnder(SKILLS_DIR);
const rel = (file) => path.relative(SKILLS_DIR, file).split(path.sep).join('/');

const CORE = readText(path.join(SKILLS_DIR, '_shared', 'subagent-dispatch-core.md'));
const DISPATCHING = CORE.split(/\n\n/).filter((p) => p.startsWith('**Dispatching.**'));

// Non-overlapping claims, each matching once in the paragraph.
const BINDING = [
  [/returned `launchEffort` is not `null`, set the Agent tool's `effort` parameter/, 'launchEffort binds to the Agent tool\'s effort parameter'],
  [/is the instruction the Agent tool's description asks for/, 'it is the instruction the Agent tool\'s description asks for'],
];
const EXEMPTIONS = [
  [/a `fork` launch \(`subagent_type: "fork"`\)/, 'fork exemption by subagent_type'],
  [/`effort:` frontmatter[^;]*`plugin\/agents\/qa-agent\.md`/, 'effort: frontmatter exemption naming qa-agent'],
  [/a session whose Agent tool schema has no `effort` parameter/, 'no-effort-parameter session exemption'],
];

test('the Dispatching paragraph is found exactly once', () => {
  assert.equal(DISPATCHING.length, 1);
});

test('contract Dispatching paragraph binds launchEffort to the effort parameter', () => {
  const missing = missingFactsOf(BINDING);
  assert.deepEqual(missing(DISPATCHING[0]), []);
  assertEachPatternGoesRed(DISPATCHING[0], BINDING, missing);
});

test('contract names all three exemptions', () => {
  const missing = missingFactsOf(EXEMPTIONS);
  assert.deepEqual(missing(DISPATCHING[0]), []);
  assertEachPatternGoesRed(DISPATCHING[0], EXEMPTIONS, missing);
});

test('no skill says the Agent tool lacks an effort parameter (AC7)', () => {
  assert.ok(SKILL_FILES.length > 50, 'skill walk reached the corpus');
  const offenders = SKILL_FILES.filter((f) => /no per-dispatch effort parameter|adopt a per-dispatch effort parameter/.test(readText(f))).map(rel);
  assert.deepEqual(offenders, []);
});

test('the restatement detector matches each of its seven phrasings', () => {
  for (const fixture of [
    "into the Agent tool's `model` parameter",
    'the returned `model` is a `model` parameter',
    'and pass `model` explicitly on every call',
    'pass the resolved `model` on that dispatch',
    'Pass the returned `model` value as',
    'the profile, passed as `model` on the `Agent` call',
    'and pass the printed `model` field. `reviewers` is 2',
  ]) {
    assert.match(fixture, MODEL_RESTATEMENT, fixture);
  }
  assert.doesNotMatch('the model profile is resolved once', MODEL_RESTATEMENT);
});

function matchesSweep(text) {
  return text.includes('resolve-profile.js') && MODEL_RESTATEMENT.test(text);
}

// (relativePath, text) pairs -> the paths that restate the model rule beside resolve-profile.js
// without naming launchEffort. File-level granularity, workflow-script exemption applied.
function offendersOf(pairs) {
  return pairs
    .filter(([p, text]) => matchesSweep(text) && !WORKFLOW_SCRIPT_EXEMPT.has(p) && !text.includes('launchEffort'))
    .map(([p]) => p);
}

test('every site naming the Agent tool\'s model parameter beside resolve-profile.js names launchEffort (AC8)', () => {
  const sites = SKILL_FILES.filter((f) => matchesSweep(readText(f)) && !WORKFLOW_SCRIPT_EXEMPT.has(rel(f)));
  assert.ok(sites.length >= 5, `site sweep found ${sites.length} sites, expected at least the five known`);
  const missing = offendersOf(SKILL_FILES.map((f) => [rel(f), readText(f)]));
  assert.deepEqual(missing, [], 'these files restate the model rule beside resolve-profile.js without launchEffort');
});

test('the AC8 sweep flags a restating text without launchEffort and passes one that has it', () => {
  const restating = 'run resolve-profile.js and pass the resolved `model` on that dispatch';
  assert.deepEqual(offendersOf([['a.md', restating]]), ['a.md']);
  assert.deepEqual(offendersOf([['a.md', `${restating}, and launchEffort as effort`]]), []);
  assert.deepEqual(offendersOf([['a.md', 'pass the resolved `model` with no resolver named']]), []);
  assert.deepEqual(offendersOf([['_shared/subagent-output-contract.md', restating]]), []);
});

test('each workflow-script exemption still matches the sweep (stale-check)', () => {
  for (const p of WORKFLOW_SCRIPT_EXEMPT) {
    const text = readText(path.join(SKILLS_DIR, p));
    assert.ok(matchesSweep(text), `${p} no longer matches the sweep predicates; drop it from WORKFLOW_SCRIPT_EXEMPT`);
  }
});

module.exports = { MODEL_RESTATEMENT };
