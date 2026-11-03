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

// A file with several writing sentences names the verb once per sentence, so a file-level presence check
// lets one sentence lose it unseen. These are the counts of `ledger-row` today (the Phase 2 count is the
// narrowing and route-remainder steps' `ledger-row --row`).
const SITE_VERB_MIN = { 'ledger/SKILL.md': 4, 'review/step3-routing.md': 5, 'wrap-up/residue-sweep.md': 2, 'wrap-up/refused-proposals.md': 2 };
const PHASE_VERB_MIN = { 1: 1, 2: 2 };
// Sites whose pipe guidance is "raw with a run dir" must keep the by-hand escape for the standalone path.
const STANDALONE_QUALIFIED = { 'ledger/SKILL.md': 'standalone no-run-dir path', 'build/dispatch.md': 'standalone no-run-dir path' };
const countOf = (text, literal) => text.split(literal).length - 1;

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
    const need = PHASE_VERB_MIN[n];
    assert.ok(countOf(phaseBlock(format, n), 'ledger-row --row') >= need, `Phase ${n} must name ledger-row --row at least ${need} time(s)`);
  }

  for (const [file, text] of Object.entries(sites)) {
    const need = SITE_VERB_MIN[file] ?? 1;
    assert.ok(countOf(text, 'ledger-row') >= need, `${file} must name ledger-row at least ${need} time(s)`);
    if (file in STANDALONE_QUALIFIED) {
      assert.ok(text.includes(STANDALONE_QUALIFIED[file]), `${file} must say the standalone no-run-dir path escapes a pipe by hand`);
    }
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

// Drop exactly one occurrence of the verb (the first) from a multi-sentence site: the file still names it, a
// file-level presence check stays green, and only the per-site count can see the lost sentence.
test('go-red: helper throws when one sentence of a multi-site file loses the verb', () => {
  for (const site of ['review/step3-routing.md', 'ledger/SKILL.md', 'wrap-up/residue-sweep.md']) {
    const sites = realSites();
    assert.ok(countOf(sites[site], 'ledger-row') >= 2, `${site} control needs a file naming the verb more than once`);
    const mutated = sites[site].replace('ledger-row', 'ledger-writer');
    assert.notEqual(mutated, sites[site]);
    assert.ok(mutated.includes('ledger-row'), `${site} control must still name the verb elsewhere, so only the count can catch it`);
    assert.throws(
      () => assertWriterSites({ format: realFormat(), sites: { ...sites, [site]: mutated } }),
      { name: 'AssertionError', message: new RegExp(`${escapeRe(site)} must name ledger-row at least`) },
    );
  }
});

test('go-red: helper throws when one of the resolve gate Phase 2 steps loses ledger-row --row', () => {
  const format = realFormat();
  const phase2 = phaseBlock(format, 2);
  const mutatedPhase = phase2.replace('ledger-row --row', 'ledger-writer --row');
  assert.notEqual(mutatedPhase, phase2);
  assert.throws(
    () => assertWriterSites({ format: format.replace(phase2, () => mutatedPhase), sites: realSites() }),
    { name: 'AssertionError', message: /Phase 2 must name ledger-row --row at least 2 time\(s\)/ },
  );
});

test('go-red: helper throws when a pipe-guidance site loses its standalone no-run-dir escape', () => {
  for (const site of Object.keys(STANDALONE_QUALIFIED)) {
    const sites = realSites();
    const mutated = sites[site].split(STANDALONE_QUALIFIED[site]).join('standalone path');
    assert.notEqual(mutated, sites[site]);
    assert.throws(
      () => assertWriterSites({ format: realFormat(), sites: { ...sites, [site]: mutated } }),
      { name: 'AssertionError', message: new RegExp(`${escapeRe(site)} must say the standalone no-run-dir path escapes`) },
    );
  }
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
