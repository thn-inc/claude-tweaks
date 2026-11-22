'use strict';
// tests/bin-lib/reproduction-log.test.js — #5595: the composer of the seven review reproduction decision-log
// lines. The expected strings below are written out by hand (copied from the seven templates review step 3 carried
// before #5595) so a drift in the composer shows as a diff here. The readers: classifyPairLine and the PAIR_FORMS
// counters on every form; lineKeys, findingKey, splitDecisionLine (console/backfill) and aggregateReproductionProblem
// on the STAGED forms (3, 4, 6); readsLocation and parseCoincidence on form 4 only; findingItems over all seven
// (form 5 makes no console item).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { formatEntry } = require('../../plugin/bin/lib/log-decision/append');
const { aggregateReproductionProblem } = require('../../plugin/bin/lib/log-decision/aggregate-reproduction');
const { categoriseReproduction } = require('../../plugin/bin/lib/coordination');
const { PAIR_FORMS, classifyPairLine } = require('../../plugin/bin/lib/timing/pair-lines');
const { readsLocation, parseCoincidence } = require('../../plugin/bin/lib/console/finding-path');
const { findingItems, findingKey, lineKeys } = require('../../plugin/bin/lib/console/resolve');
const { splitDecisionLine } = require('../../plugin/bin/lib/console/backfill');
const rl = require('../../plugin/bin/lib/reproduction-log');

const now = new Date(2026, 10, 16, 10, 0, 0);
const line = (entry) => formatEntry({ ...entry, now });
const R = 'Reversibility: high.';

test('exports: STEP and JUDGMENT_KINDS', () => {
  assert.equal(rl.STEP, 'Reproduction');
  assert.deepEqual([...rl.JUDGMENT_KINDS], ['absence-refuted', 'vacuity-downgraded', 'vacuity-reconfirmed']);
  assert.ok(Object.isFrozen(rl.JUDGMENT_KINDS));
});

test('location: path:line for an integer line, the bare path otherwise', () => {
  assert.equal(rl.location('x.js', 12), 'x.js:12');
  assert.equal(rl.location('x.js', 0), 'x.js:0');
  assert.equal(rl.location('x.js'), 'x.js');
  assert.equal(rl.location('x.js', null), 'x.js');
  assert.equal(rl.location('x.js', '12'), 'x.js');
});

// The seven forms with their literal expected line, built from the shared fixture values.
const FORMS = [
  ['reproduced', () => rl.reproduced({ lens: '3a', path: 'plugin/x.js', line: 12 }),
    `- AUTO 10:00:00 — Reproduction: lens "3a" finding plugin/x.js:12 reproduced. Confirmed. ${R}`],
  ['reproduced-severity-contested', () => rl.reproduced({ lens: '3a', path: 'plugin/x.js', line: 12, severityContested: true }),
    `- AUTO 10:00:00 — Reproduction: lens "3a" finding plugin/x.js:12 reproduced, severity contested (took the lower of the two). Confirmed. ${R}`],
  ['not-reproduced', () => rl.notReproduced({ lens: '3a', path: 'plugin/x.js', line: 12 }),
    `- STAGED 10:00:00 — Reproduction: lens "3a" finding plugin/x.js:12 not reproduced. Staged to Review Console as low-confidence. ${R}`],
  ['coincidence', () => rl.coincidence({ lens: '3a', path: 'plugin/x.js', lineA: 12, lineB: 14 }),
    `- STAGED 10:00:00 — Reproduction: lens "3a" findings plugin/x.js:12 / plugin/x.js:14 share a location but not substance; both staged unconfirmed. ${R}`],
  ['absence-refuted', () => rl.absenceRefuted({ lens: '3a', path: 'plugin/x.js', symbol: 'foo', command: 'grep -n foo plugin/x.js', foundAt: { path: 'plugin/x.js', line: 40 } }),
    `- AUTO 10:00:00 — Reproduction: lens "3a" absence claim plugin/x.js:foo refuted by ground-truth check (grep -n foo plugin/x.js found it at plugin/x.js:40). Not staged. ${R}`],
  ['vacuity-downgraded', () => rl.vacuityDowngraded({ path: 'plugin/x.js', line: 12 }),
    `- STAGED 10:00:00 — Reproduction: lens "3f" vacuity finding plugin/x.js:12 downgraded to unconfirmed — reproduction agreement overridden, no execution evidence. Staged to Review Console as low-confidence. ${R}`],
  ['vacuity-reconfirmed', () => rl.vacuityReconfirmed({ path: 'plugin/x.js', line: 12, command: 'grep -n foo plugin/x.js', output: '1 failing' }),
    `- AUTO 10:00:00 — Reproduction: lens "3f" vacuity finding plugin/x.js:12 re-confirmed by executed run: grep -n foo plugin/x.js → 1 failing. Confirmed. ${R}`],
];

FORMS.forEach(([id, make, want], i) => {
  test(`AC1.1 form ${i + 1} (${id})`, () => {
    assert.equal(line(make()), want);
    assert.equal(make().step, 'Reproduction');
    assert.equal(make().reversibility, 'high');
  });
});

test('absenceRefuted: foundAt in another file prints that file', () => {
  const e = rl.absenceRefuted({ lens: '3a', path: 'plugin/x.js', symbol: 'foo', command: 'grep -n foo plugin/y.js', foundAt: { path: 'plugin/y.js', line: 7 } });
  assert.match(e.text, /found it at plugin\/y\.js:7\)\./);
  assert.match(e.text, /absence claim plugin\/x\.js:foo /);
});

// --- pairEntries ---

const fx = (path, line, text, severity) => ({ path, line, text, ...(severity ? { severity } : {}) });
const texts = (entries) => entries.map((e) => e.text);

test('pairEntries: confirmed order and severity', () => {
  const confirmed = [{ path: 'a.js', line: 1 }, { path: 'b.js', line: 2, severityContested: true }];
  const { entries, unlocated } = rl.pairEntries({ confirmed, unconfirmed: [] }, { lens: '3a', only: 'confirmed' });
  assert.deepEqual(texts(entries), [
    'lens "3a" finding a.js:1 reproduced. Confirmed.',
    'lens "3a" finding b.js:2 reproduced, severity contested (took the lower of the two). Confirmed.',
  ]);
  assert.deepEqual(unlocated, []);
});

test('pairEntries: an `only` other than confirmed or unconfirmed throws TypeError', () => {
  assert.throws(() => rl.pairEntries({ confirmed: [], unconfirmed: [] }, { lens: '3a', only: 'both' }), TypeError);
  assert.throws(() => rl.pairEntries({ confirmed: [], unconfirmed: [] }, { lens: '3a' }), TypeError);
});

// A real categoriseReproduction output: one confirmed pair at x.js:10/11 and one coincidence at x.js:30/31.
const realPairs = () => categoriseReproduction(
  [fx('x.js', 10, 'missing null check on input'), fx('x.js', 30, 'unused import')],
  [fx('x.js', 11, 'missing null check on input'), fx('x.js', 31, 'loop is quadratic in n')],
);

test('pairEntries: the fixture is one confirmed and one coincidence pair', () => {
  const r = realPairs();
  assert.equal(r.confirmed.length, 1);
  assert.deepEqual(r.unconfirmed.map((f) => [f.source, f.line, f.nearLocation && f.nearLocation.line]), [['A', 30, 31], ['B', 31, 30]]);
});

test('AC4.1: no hold gives one coincidence line for the pair', () => {
  const { entries } = rl.pairEntries(realPairs(), { lens: '3a', only: 'unconfirmed', hold: [] });
  assert.deepEqual(texts(entries), ['lens "3a" findings x.js:30 / x.js:31 share a location but not substance; both staged unconfirmed.']);
  assert.equal(entries[0].status, 'STAGED');
});

test('AC4.2: holding the A side stages the B side alone', () => {
  const r = realPairs();
  const { entries } = rl.pairEntries(r, { lens: '3a', only: 'unconfirmed', hold: [r.unconfirmed[0]] });
  assert.deepEqual(texts(entries), ['lens "3a" finding x.js:31 not reproduced. Staged to Review Console as low-confidence.']);
});

test('AC4.2: holding the B side stages the A side alone', () => {
  const r = realPairs();
  const { entries } = rl.pairEntries(r, { lens: '3a', only: 'unconfirmed', hold: [r.unconfirmed[1]] });
  assert.deepEqual(texts(entries), ['lens "3a" finding x.js:30 not reproduced. Staged to Review Console as low-confidence.']);
});

test('AC4.3: holding both sides writes nothing', () => {
  const r = realPairs();
  const { entries } = rl.pairEntries(r, { lens: '3a', only: 'unconfirmed', hold: [...r.unconfirmed] });
  assert.deepEqual(entries, []);
});

test('pairEntries: a plain single-reviewer finding gives form 3, and a hold of it gives none', () => {
  const r = categoriseReproduction([fx('x.js', 5, 'only A saw this')], []);
  const { entries } = rl.pairEntries(r, { lens: '3b', only: 'unconfirmed' });
  assert.deepEqual(texts(entries), ['lens "3b" finding x.js:5 not reproduced. Staged to Review Console as low-confidence.']);
  assert.deepEqual(rl.pairEntries(r, { lens: '3b', only: 'unconfirmed', hold: [r.unconfirmed[0]] }).entries, []);
});

test('pairEntries: a hold matches by holdKey, so an equal copy of the finding holds it', () => {
  const r = realPairs();
  const copy = JSON.parse(JSON.stringify(r.unconfirmed[0]));
  const { entries } = rl.pairEntries(r, { lens: '3a', only: 'unconfirmed', hold: [copy] });
  assert.equal(entries.length, 1);
  assert.match(entries[0].text, /^lens "3a" finding x\.js:31 not reproduced\./);
});

test('holdKey: JSON of source, path, line and text with nulls for absent fields', () => {
  assert.equal(rl.holdKey({ source: 'A', path: 'x.js', line: 30, text: 'unused import' }), '["A","x.js",30,"unused import"]');
  assert.equal(rl.holdKey({ path: 'x.js' }), '[null,"x.js",null,null]');
});

test('unlocated: an unconfirmed finding with no line gets a bare-path form 3 and is listed', () => {
  const unconfirmed = [{ source: 'A', path: 'x.js', text: 'no line given' }, { source: 'B', path: 'y.js', line: 3 }];
  const { entries, unlocated } = rl.pairEntries({ confirmed: [], unconfirmed }, { lens: '3c', only: 'unconfirmed' });
  assert.deepEqual(texts(entries), [
    'lens "3c" finding x.js not reproduced. Staged to Review Console as low-confidence.',
    'lens "3c" finding y.js:3 not reproduced. Staged to Review Console as low-confidence.',
  ]);
  assert.deepEqual(unlocated, [unconfirmed[0]]);
  // Reported in both modes.
  assert.deepEqual(rl.pairEntries({ confirmed: [], unconfirmed }, { lens: '3c', only: 'confirmed' }).unlocated, [unconfirmed[0]]);
});

test('unlocated form 3 is a pair line: classifyPairLine gives not-reproduced with line null', () => {
  const [e] = rl.pairEntries({ confirmed: [], unconfirmed: [{ source: 'A', path: 'x.js' }] }, { lens: '3c', only: 'unconfirmed' }).entries;
  assert.deepEqual(classifyPairLine(line(e)), { form: 'not-reproduced', lens: '3c', path: 'x.js', line: null });
});

// --- AC7: the lines pass the aggregate guard and every reader reads them like the hand-written line ---

const PATHS = ['plugin/x.js', 'docs/a b.md', 'Makefile'];
for (const p of PATHS) {
  test(`AC7.1 every STAGED form passes aggregateReproductionProblem (path ${p})`, () => {
    const staged = [
      rl.notReproduced({ lens: '3a', path: p, line: 12 }),
      rl.coincidence({ lens: '3a', path: p, lineA: 12, lineB: 14 }),
      rl.vacuityDowngraded({ path: p, line: 12 }),
      rl.notReproduced({ lens: '3a', path: p }),
    ];
    for (const e of staged) {
      assert.equal(e.status, 'STAGED');
      assert.equal(aggregateReproductionProblem({ status: e.status, step: e.step, text: e.text }), null, e.text);
    }
  });
}

// The readers, over each form, with hand-written lines for two paths (one holding a space).
const HAND = {
  'reproduced': (p) => `- AUTO 10:00:00 — Reproduction: lens "3a" finding ${p}:12 reproduced. Confirmed. ${R}`,
  'reproduced-severity-contested': (p) => `- AUTO 10:00:00 — Reproduction: lens "3a" finding ${p}:12 reproduced, severity contested (took the lower of the two). Confirmed. ${R}`,
  'not-reproduced': (p) => `- STAGED 10:00:00 — Reproduction: lens "3a" finding ${p}:12 not reproduced. Staged to Review Console as low-confidence. ${R}`,
  'coincidence': (p) => `- STAGED 10:00:00 — Reproduction: lens "3a" findings ${p}:12 / ${p}:14 share a location but not substance; both staged unconfirmed. ${R}`,
  'absence-refuted': (p) => `- AUTO 10:00:00 — Reproduction: lens "3a" absence claim ${p}:foo refuted by ground-truth check (grep -n foo ${p} found it at ${p}:40). Not staged. ${R}`,
  'vacuity-downgraded': (p) => `- STAGED 10:00:00 — Reproduction: lens "3f" vacuity finding ${p}:12 downgraded to unconfirmed — reproduction agreement overridden, no execution evidence. Staged to Review Console as low-confidence. ${R}`,
  'vacuity-reconfirmed': (p) => `- AUTO 10:00:00 — Reproduction: lens "3f" vacuity finding ${p}:12 re-confirmed by executed run: grep -n foo ${p} → 1 failing. Confirmed. ${R}`,
};
const COMPOSE = {
  'reproduced': (p) => rl.reproduced({ lens: '3a', path: p, line: 12 }),
  'reproduced-severity-contested': (p) => rl.reproduced({ lens: '3a', path: p, line: 12, severityContested: true }),
  'not-reproduced': (p) => rl.notReproduced({ lens: '3a', path: p, line: 12 }),
  'coincidence': (p) => rl.coincidence({ lens: '3a', path: p, lineA: 12, lineB: 14 }),
  'absence-refuted': (p) => rl.absenceRefuted({ lens: '3a', path: p, symbol: 'foo', command: `grep -n foo ${p}`, foundAt: { path: p, line: 40 } }),
  'vacuity-downgraded': (p) => rl.vacuityDowngraded({ path: p, line: 12 }),
  'vacuity-reconfirmed': (p) => rl.vacuityReconfirmed({ path: p, line: 12, command: `grep -n foo ${p}`, output: '1 failing' }),
};

// What each reader must yield for a composed line, written out (not derived from the hand-written line):
// the console keys (console/resolve.js lineKeys, the `{lens}|{path}:{line}` a STAGED line is settled by) and the
// one counter #5556's pair-line reader (PAIR_FORMS[].counts) adds the line to.
const SHORT_PATH = { 'plugin/x.js': 'plugin/x.js', 'docs/a b.md': 'b.md' };
const EXPECT = {
  'reproduced': { counter: 'both' },
  'reproduced-severity-contested': { counter: 'both' },
  'not-reproduced': { counter: 'one', keys: (p) => [`3a|${p}:12`] },
  'coincidence': { counter: 'one', keys: (p) => [`3a|${p}:12`, `3a|${p}:14`] },
  'absence-refuted': { counter: 'one' },
  'vacuity-downgraded': { counter: 'relabel', keys: (p) => [`3f|${p}:12`] },
  'vacuity-reconfirmed': { counter: 'one' },
};

test('AC7.3 reader table: each form reads as its own form, adds to one counter, and keys the console as written', () => {
  const seen = [];
  for (const id of Object.keys(HAND)) {
    for (const p of ['plugin/x.js', 'docs/a b.md']) {
      const composed = line(COMPOSE[id](p));
      assert.equal(composed, HAND[id](p), `${id} ${p}`);
      const pair = classifyPairLine(composed);
      assert.ok(pair, `${id} ${p} classifies`);
      assert.equal(pair.form, id, `${id} ${p}`);
      assert.equal(pair.path, p, `${id} ${p} path`);
      const counts = PAIR_FORMS.find((f) => f.id === id).counts;
      const nonzero = Object.entries(counts).filter(([, n]) => n > 0).map(([k]) => k);
      assert.deepEqual(nonzero, [EXPECT[id].counter], `${id} counter`);
      if (EXPECT[id].keys) {
        const want = EXPECT[id].keys(p);
        // `known` names the settled key whole, so a path holding a space keys whole as the console writes it (#4632).
        assert.deepEqual(lineKeys(composed, new Set(want)), want, `${id} ${p} console keys`);
        // findingKey (the prose settlers' key) stops a path at its first space, for the composed and the hand-written line alike.
        const first = `${want[0].split('|')[0]}|${SHORT_PATH[p]}:12`;
        assert.equal(findingKey(composed), first, `${id} ${p} findingKey`);
        assert.equal(findingKey(HAND[id](p)), first, `${id} ${p} findingKey (hand-written)`);
        // splitDecisionLine (console/backfill.js, the legacy line splitter): the claim-less forms carry no finding, the
        // vacuity form one located finding.
        const split = id === 'vacuity-downgraded'
          ? { findings: [['3f', SHORT_PATH[p], 12]], noClaim: null }
          : { findings: [], noClaim: 'claim-empty' };
        for (const l of [composed, HAND[id](p)]) {
          const got = splitDecisionLine(l);
          assert.deepEqual({ findings: got.findings.map((f) => [f.lens, f.path, f.line]), noClaim: got.noClaim }, split, `${id} ${p} splitDecisionLine`);
        }
      }
      if (p === 'plugin/x.js') seen.push(pair.form);
    }
  }
  assert.deepEqual([...seen].sort(), Object.keys(HAND).sort());
  assert.equal(new Set(seen).size, 7);
});

test('AC7.3 coincidence reader: parseCoincidence reads both sides of the composed clause', () => {
  const co = parseCoincidence(line(COMPOSE.coincidence('docs/a b.md')));
  assert.equal(co.lens, '3a');
  assert.equal(co.first, 'docs/a b.md:12');
  assert.equal(co.second, 'docs/a b.md:14 share a location');
  assert.equal(readsLocation(co.first), true);
});

test('AC7.3 console: only the STAGED forms become console items, and form 5 makes none', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reproduction-log-'));
  try {
    // Distinct lines per form: a confirmed line at a location settles a STAGED line at the same one.
    const p = 'plugin/x.js';
    const composed = [
      rl.reproduced({ lens: '3a', path: p, line: 12 }), rl.reproduced({ lens: '3a', path: p, line: 14, severityContested: true }),
      rl.notReproduced({ lens: '3a', path: p, line: 16 }), rl.coincidence({ lens: '3a', path: p, lineA: 20, lineB: 22 }),
      rl.absenceRefuted({ lens: '3a', path: p, symbol: 'foo', command: 'grep -n foo plugin/x.js', foundAt: { path: p, line: 40 } }),
      rl.vacuityDowngraded({ path: p, line: 30 }), rl.vacuityReconfirmed({ path: p, line: 32, command: 'c', output: 'o' }),
    ];
    fs.writeFileSync(path.join(dir, 'decisions.md'), `${composed.map(line).join('\n')}\n`);
    const deps = { readFile: (f) => fs.readFileSync(f, 'utf8'), readdir: (f) => { try { return fs.readdirSync(f); } catch { return []; } } };
    const { items } = findingItems({ runDir: dir, deps });
    assert.equal(items.length, 3);
    assert.ok(items.every((i) => i.section === 'Low-confidence findings' && i.id.startsWith('decision:STAGED ')));
    assert.deepEqual(items.map((i) => /Reproduction: (lens "3[af]" (?:vacuity finding|findings|finding))/.exec(i.id)[1]),
      ['lens "3a" finding', 'lens "3a" findings', 'lens "3f" vacuity finding']);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
