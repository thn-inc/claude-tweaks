// tests/ledger-row-writer-conformance.test.js
// Pins #4439's prose half: _shared/ledger-format.md's `### Writer` section names `hooks.js ledger-row`
// with every flag of its usage string and states the refusal rule once, and every writing site cites that
// section (never restates the retry ladder). The code half is covered by the verb's own suites.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');
const { sectionOf } = require('./helpers/conformance-asserts');
const { VERBS } = require('../plugin/bin/hooks.js');

const SKILLS = path.join(__dirname, '..', 'plugin', 'skills');
const read = (rel) => readText(path.join(SKILLS, rel));
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const WRITER_HEADING = '### Writer';
const SITE_PATHS = [
  'ledger/SKILL.md',
  'build/SKILL.md',
  'build/operational-checklist.md',
  'build/docs-sync.md',
  'build/dispatch.md',
  'review/step3-routing.md',
  'review/code-mode-steps.md',
  'wrap-up/nothing-left-behind.md',
  'wrap-up/residue-sweep.md',
  'wrap-up/refused-proposals.md',
];

// The Writer section's literal anchors: the command, the lock, the worktree-guard clause, the text-transport
// rule, the Create/Delete carve-out, the staged-file split, and the refusal rule (round-2 answer 3 and
// round-4 answers 8, 9 and 11a).
const WRITER_ANCHORS = [
  'hooks.js" ledger-row',
  '.ledger.lock',
  'scratch-worktree.md',
  '--run "{run-dir}"',
  'Text from git or a user',
  'delete-ledger',
  'stage-item.js --ledger',
  'LEDGER',
  'LOCK_TIMEOUT',
  'resolve-ledger',
  'multiple candidate runs',
  'exactly one',
  'exit 2',
  '`; `',
  'origin repo unresolvable',
  'row not written',
  'SKIP',
];

// A flag token on its own: `--item` must not be satisfied by `--item-file`.
const flagRe = (flag) => new RegExp(`(?<![\\w-])${escapeRe(flag)}(?![\\w-])`, 'g');
const usageFlags = () => [...new Set(VERBS['ledger-row'].usage.match(/--[a-z][a-z-]*/g))];

// A block from `### Phase n` to the next `### Phase` (or the end of the file); both ends resolved.
function phaseBlock(format, n) {
  const start = format.indexOf(`\n### Phase ${n} `);
  assert.notEqual(start, -1, `ledger-format.md has no Phase ${n} section`);
  const next = format.indexOf('\n### Phase ', start + 1);
  return next === -1 ? format.slice(start) : format.slice(start, next);
}

// One shared helper: the positive test runs it on the real files, every go-red control runs it on a mutated copy.
function assertWriterSites({ format, sites }) {
  const writer = sectionOf(format, WRITER_HEADING);
  for (const flag of usageFlags()) {
    assert.match(writer, flagRe(flag), `Writer section must name flag ${flag}`);
  }
  assert.ok(usageFlags().length >= 9, 'the usage string yields the verb flags (floor)');
  for (const anchor of WRITER_ANCHORS) {
    assert.ok(writer.includes(anchor), `Writer section is missing anchor: ${anchor}`);
  }

  assert.ok(
    format.includes('file reference, or resolving PR (`PR #N` or its URL)'),
    'the fixed requirement must name the resolving PR form',
  );
  const phase3 = phaseBlock(format, 3).split('\n\n')[1];
  assert.ok(phase3.includes('ledger-row --row') && phase3.includes('Writer section'), 'Phase 3 opening paragraph must name ledger-row --row and cite the Writer section');
  for (const n of [1, 2]) {
    assert.ok(phaseBlock(format, n).includes('ledger-row --row'), `Phase ${n} must name ledger-row --row`);
  }

  for (const [file, text] of Object.entries(sites)) {
    assert.ok(text.includes('ledger-row'), `${file} must name ledger-row`);
    assert.ok(text.includes('Writer section'), `${file} must cite the Writer section`);
    assert.ok(!text.includes('LOCK_TIMEOUT'), `${file} must cite the Writer section's refusal rule, not restate it (LOCK_TIMEOUT)`);
  }
}

const realFormat = () => read('_shared/ledger-format.md');
const realSites = () => Object.fromEntries(SITE_PATHS.map((rel) => [rel, read(rel)]));

// Apply `mutate` to the Writer section only, splice it back, and prove the splice changed something.
function mutateWriter(format, mutate) {
  const writer = sectionOf(format, WRITER_HEADING);
  const mutatedWriter = mutate(writer);
  assert.notEqual(mutatedWriter, writer, 'control mutation must change the Writer section');
  return format.replace(writer, () => mutatedWriter);
}
const removeAll = (re) => (writer) => writer.replace(re, '');
const removeLiteral = (literal) => removeAll(new RegExp(escapeRe(literal), 'g'));

test('writer section names the verb with its full flag set and the citing sites point at it', () => {
  assertWriterSites({ format: realFormat(), sites: realSites() });
});

test('go-red: helper throws when --resolution is removed from a copy of the Writer section', () => {
  const format = mutateWriter(realFormat(), removeAll(flagRe('--resolution')));
  assert.throws(() => assertWriterSites({ format, sites: realSites() }), { name: 'AssertionError', message: /Writer section must name flag --resolution$/ });
});

test('go-red: helper throws when the refusal rule\'s LOCK_TIMEOUT clause is removed from a copy of the Writer section', () => {
  const format = mutateWriter(realFormat(), removeLiteral('LOCK_TIMEOUT'));
  assert.throws(() => assertWriterSites({ format, sites: realSites() }), { name: 'AssertionError', message: /missing anchor: LOCK_TIMEOUT/ });
});

test('go-red: helper throws when the text-transport rule is removed from a copy of the Writer section', () => {
  const format = mutateWriter(realFormat(), removeLiteral('Text from git or a user'));
  assert.throws(() => assertWriterSites({ format, sites: realSites() }), { name: 'AssertionError', message: /missing anchor: Text from git or a user/ });
});

test('go-red: helper throws when the exit-2 clause is removed from a copy of the Writer section (round-4 answer 8)', () => {
  const format = mutateWriter(realFormat(), removeLiteral('exit 2'));
  assert.throws(() => assertWriterSites({ format, sites: realSites() }), { name: 'AssertionError', message: /missing anchor: exit 2/ });
});

test('go-red: helper throws when the own-run clause (`exactly one`) is removed from a copy of the Writer section (round-4 answer 9)', () => {
  const format = mutateWriter(realFormat(), removeLiteral('exactly one'));
  assert.throws(() => assertWriterSites({ format, sites: realSites() }), { name: 'AssertionError', message: /missing anchor: exactly one/ });
});

test('go-red: helper throws when a site loses the verb', () => {
  const sites = realSites();
  const site = 'review/code-mode-steps.md';
  const mutated = sites[site].replace(/ledger-row/g, 'ledger-writer');
  assert.notEqual(mutated, sites[site]);
  assert.throws(() => assertWriterSites({ format: realFormat(), sites: { ...sites, [site]: mutated } }), { name: 'AssertionError', message: new RegExp(`${escapeRe(site)} must name ledger-row`) });
});

test('go-red: helper throws when a site restates LOCK_TIMEOUT', () => {
  const sites = realSites();
  const site = 'wrap-up/residue-sweep.md';
  const mutated = `${sites[site]}\nA \`LOCK_TIMEOUT\` is retried once.\n`;
  assert.throws(() => assertWriterSites({ format: realFormat(), sites: { ...sites, [site]: mutated } }), { name: 'AssertionError', message: new RegExp(`${escapeRe(site)} must cite the Writer section's refusal rule`) });
});

const PRE_ESCAPE_SENTENCE = 'Escape every `|` in a carried one-liner';
function assertNoPreEscape(dispatch) {
  assert.ok(!dispatch.includes(PRE_ESCAPE_SENTENCE), 'dispatch.md still tells a writer to pre-escape a carried one-liner');
}

test('dispatch.md no longer tells a writer to pre-escape a carried one-liner', () => {
  const dispatch = read('build/dispatch.md');
  assertNoPreEscape(dispatch);
  assert.throws(() => assertNoPreEscape(`${dispatch}\n${PRE_ESCAPE_SENTENCE} as \`\\|\`.\n`), { name: 'AssertionError', message: /still tells a writer to pre-escape/ });
});
