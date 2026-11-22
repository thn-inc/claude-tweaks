'use strict';
// plugin/bin/lib/review-lens/select.js (#6001): the pure review lens selection — tier ceiling, history floor, diff facts.
const { test } = require('node:test');
const assert = require('node:assert');
const { scratchDir } = require('../../helpers/tmp-dir');
const {
  TIERS, TIER_LENSES, SHARE_FLOOR, FORCE_EVERY, APPLIES, CALLED_FOR, historyProblem, selectLenses,
} = require('../../../plugin/bin/lib/review-lens/select');
const { readLensHistory } = require('../../../plugin/bin/lib/review-lens/history');
const { LENS_IDS } = require('../../../plugin/bin/lib/review-lens/dispatch-record');

const FULL = ['3b', '3c', '3a', '3f', '3d', '3e', '3g', '3h'];

// computeFacts' envelope: every boolean false, kinds all false, riskFlags [] and paths [] unless overridden.
function factsOf(overrides = {}) {
  const { kinds = {}, ...rest } = overrides;
  return {
    ok: true,
    facts: {
      paths: [],
      kinds: { prose: false, source: false, test: false, config: false, workflow: false, ...kinds },
      executableContent: false,
      shellInvocationAdded: false,
      inputHandlingAdded: false,
      errorHandlingTouched: false,
      riskPathTouched: false,
      riskFlags: [],
      newFiles: false,
      newModules: false,
      perCallPath: false,
      loopSpawn: false,
      ...rest,
    },
  };
}

const proseOnly = () => factsOf({ paths: [{ path: 'docs/a.md', status: 'M', kind: 'prose' }], kinds: { prose: true } });
const sourceDiff = (over = {}) => factsOf({ paths: [{ path: 'lib/a.js', status: 'M', kind: 'source' }], kinds: { source: true }, ...over });
const allTrue = () => factsOf({
  paths: [{ path: 'lib/a.js', status: 'A', kind: 'source' }],
  kinds: { prose: true, source: true, test: true, config: true, workflow: true },
  executableContent: true, shellInvocationAdded: true, inputHandlingAdded: true, errorHandlingTouched: true,
  riskPathTouched: true, riskFlags: ['auth'], newFiles: true, newModules: true, perCallPath: true, loopSpawn: true,
});

// readLensHistory's result: every lens `runs: 20, insufficient: false`, share 0.9 unless the spec says otherwise.
function historyOf(spec = {}, errors = []) {
  const lenses = {};
  for (const id of LENS_IDS) {
    const { share = 0.9, ...rest } = spec[id] || {};
    const confirmed = typeof share === 'number' ? Math.round(share * 20) : 0;
    lenses[id] = { runs: 20, confirmed, perRun: confirmed / 20, shareWithFinding: share, insufficient: false, ...rest };
  }
  return { lenses, skipped: [], errors };
}

const streaksOf = (byLens = {}) => ({ ok: true, byLens: { ...Object.fromEntries(LENS_IDS.map((id) => [id, 0])), ...byLens } });

const sel = (over = {}) => selectLenses({ tier: 'high', facts: proseOnly(), history: historyOf(), streaks: streaksOf(), ...over });
const reasonOf = (result, lens) => (result.skipped.find((s) => s.lens === lens) || {}).reason;

test('AC1.1: TIER_LENSES reproduces the tier table', () => {
  assert.deepStrictEqual(TIERS, ['low', 'medium', 'high', 'xhigh', 'max']);
  assert.deepStrictEqual(TIER_LENSES.low, ['3b', '3c']);
  assert.deepStrictEqual(TIER_LENSES.medium, ['3b', '3c', '3a', '3f']);
  for (const t of ['high', 'xhigh', 'max']) assert.deepStrictEqual(TIER_LENSES[t], FULL, t);
  assert.deepStrictEqual(Object.keys(TIER_LENSES), TIERS);
  assert.ok(Object.isFrozen(TIER_LENSES) && Object.isFrozen(TIER_LENSES.high) && Object.isFrozen(TIERS));
  assert.ok(Object.isFrozen(APPLIES) && Object.isFrozen(CALLED_FOR));
  assert.deepStrictEqual(Object.keys(APPLIES).sort(), [...LENS_IDS]);
  assert.deepStrictEqual(Object.keys(CALLED_FOR).sort(), [...LENS_IDS]);
});

test('tuned constants (#6001 build replay)', () => {
  assert.strictEqual(SHARE_FLOOR, 0.4);
  assert.strictEqual(FORCE_EVERY, 3);
  // The tuned CALLED_FOR clauses: 3b and 3c are called for by any source or test change, never by prose alone.
  for (const l of ['3b', '3c']) {
    assert.strictEqual(CALLED_FOR[l](factsOf({ kinds: { source: true } }).facts), true, `${l} source`);
    assert.strictEqual(CALLED_FOR[l](factsOf({ kinds: { test: true } }).facts), true, `${l} test`);
    assert.strictEqual(CALLED_FOR[l](proseOnly().facts), false, `${l} prose-only`);
  }
  for (const l of ['3b', '3c']) assert.strictEqual(CALLED_FOR[l](factsOf({ riskPathTouched: true }).facts), true, `${l} risk path`);
});

test('AC2.1: docs-only diff at high with 3d below the floor selects no 3d', () => {
  const r = sel({ history: historyOf({ '3d': { share: 0.1 } }) });
  assert.ok(!r.selected.includes('3d'));
  assert.strictEqual(r.fallback, null);
  const reason = reasonOf(r, '3d');
  assert.ok(reason, 'skipped names 3d');
  assert.match(reason, /share 0\.1/);
  assert.match(reason, /below floor 0\.4/);
  assert.match(reason, /no diff fact calls for it/);
  assert.strictEqual(reason, '3d: share 0.1 over its last 20 runs is below floor 0.4; no diff fact calls for it (0 of 3 reviews since it last ran)');
});

test('AC2.2: the same diff adding a git call inside a per-file loop selects 3d', () => {
  const r = sel({ facts: factsOf({ loopSpawn: true, kinds: { source: true } }), history: historyOf({ '3d': { share: 0.1 } }) });
  assert.ok(r.selected.includes('3d'));
  const p = sel({ facts: factsOf({ perCallPath: true }), history: historyOf({ '3d': { share: 0.1 } }) });
  assert.ok(p.selected.includes('3d'), 'perCallPath also calls for 3d');
});

test('AC3.1: insufficient history is always selected when the tier allows it', () => {
  const spec = Object.fromEntries(LENS_IDS.map((id) => [id, { insufficient: true, runs: 3, share: 0.1 }]));
  const r = sel({ history: historyOf(spec) });
  assert.deepStrictEqual(r.selected, FULL);
  assert.deepStrictEqual(r.skipped, []);
  assert.strictEqual(r.fallback, null);
});

test('AC4.1: a lens the tier excludes is never selected', () => {
  const r = sel({ tier: 'low', facts: allTrue() });
  assert.ok(r.selected.every((l) => ['3b', '3c'].includes(l)));
  assert.deepStrictEqual(r.selected, ['3b', '3c']);
  assert.ok(r.skipped.every((s) => ['3b', '3c'].includes(s.lens)));
  const m = sel({ tier: 'medium', facts: allTrue(), history: historyOf(Object.fromEntries(LENS_IDS.map((id) => [id, { insufficient: true }]))) });
  assert.deepStrictEqual(m.selected, ['3b', '3c', '3a', '3f']);
  // A fallback is the tier set too, never the full lens list.
  const f = sel({ tier: 'low', history: null });
  assert.deepStrictEqual(f.selected, ['3b', '3c']);
});

test('AC5.2 / AC7.2: failed facts select the full tier set with a fallback reason', () => {
  const r = sel({ facts: { ok: false, fact: 'paths', reason: 'bad revision' } });
  assert.deepStrictEqual(r.selected, [...TIER_LENSES.high]);
  assert.deepStrictEqual(r.skipped, []);
  assert.match(r.fallback, /paths/);
  assert.match(r.fallback, /bad revision/);
});

test('a malformed facts envelope is a fallback, never "no facts call for anything"', () => {
  for (const facts of [null, undefined, {}, { ok: true }, { ok: true, facts: null }]) {
    const r = sel({ facts });
    assert.deepStrictEqual(r.selected, FULL, JSON.stringify(facts));
    assert.ok(typeof r.fallback === 'string' && r.fallback.length > 0);
  }
  const missing = proseOnly();
  delete missing.facts.loopSpawn;
  assert.match(sel({ facts: missing }).fallback, /loopSpawn/);
  const noKinds = proseOnly();
  noKinds.facts.kinds = null;
  assert.match(sel({ facts: noKinds }).fallback, /kinds/);
  const badPaths = proseOnly();
  badPaths.facts.paths = 'docs/a.md';
  assert.match(sel({ facts: badPaths }).fallback, /paths/);
  const badFlags = proseOnly();
  badFlags.facts.riskFlags = null;
  assert.match(sel({ facts: badFlags }).fallback, /riskFlags/);
});

test('AC8.1: missing, unreadable or malformed history selects the full tier set', () => {
  const cases = [
    [null, /not an object/],
    [{ lenses: {} }, /3b/],
    [historyOf({ '3d': { insufficient: false, share: 'x' } }), /3d/],
    [historyOf({}, [{ path: '/r', reason: 'unreadable root (EACCES)' }]), /unreadable root/],
  ];
  for (const [history, why] of cases) {
    const r = sel({ history });
    assert.deepStrictEqual(r.selected, FULL, JSON.stringify(history));
    assert.deepStrictEqual(r.skipped, []);
    assert.match(r.fallback, why);
    assert.match(r.fallback, /history/);
  }
  // Review Focus 1: per-run errors exclude those runs; the rest is usable.
  const perRun = historyOf({ '3d': { share: 0.1 } }, [{ path: '/r/x/step-yield.json', reason: 'step-yield.json missing' }]);
  const r = sel({ history: perRun });
  assert.strictEqual(r.fallback, null);
  assert.ok(!r.selected.includes('3d'));
});

test('an unreadable archive is a fallback; unreadable spec members is not', () => {
  const arch = sel({ history: historyOf({ '3d': { share: 0.1 } }, [{ path: '/r/archive', reason: 'unreadable archive (EACCES)' }]) });
  assert.deepStrictEqual(arch.selected, FULL);
  assert.match(arch.fallback, /unreadable archive/);
  const spec = sel({ history: historyOf({ '3d': { share: 0.1 } }, [{ path: '/r/x', reason: 'unreadable spec members (EACCES)' }]) });
  assert.strictEqual(spec.fallback, null);
  assert.ok(!spec.selected.includes('3d'));
});

test('historyProblem: each malformed shape names why; a well-formed history is null', () => {
  assert.strictEqual(historyProblem(historyOf()), null);
  assert.match(historyProblem('x'), /not an object/);
  assert.match(historyProblem([]), /not an object/);
  assert.match(historyProblem({ lenses: [] }), /lenses/);
  assert.match(historyProblem({ lenses: null }), /lenses/);
  assert.match(historyProblem(historyOf({ '3a': { runs: -1 } })), /3a.*runs/);
  assert.match(historyProblem(historyOf({ '3a': { runs: 1.5 } })), /3a.*runs/);
  assert.match(historyProblem(historyOf({ '3a': { runs: '20' } })), /3a.*runs/);
  assert.match(historyProblem(historyOf({ '3a': { insufficient: 'no' } })), /3a.*insufficient/);
  assert.match(historyProblem(historyOf({ '3a': { share: 1.5 } })), /3a.*shareWithFinding/);
  assert.match(historyProblem(historyOf({ '3a': { share: -0.1 } })), /3a.*shareWithFinding/);
  assert.match(historyProblem(historyOf({ '3a': { share: NaN } })), /3a.*shareWithFinding/);
  assert.match(historyProblem(historyOf({ '3a': { share: null } })), /3a.*shareWithFinding/);
  assert.strictEqual(historyProblem(historyOf({ '3a': { share: 0 } })), null);
  assert.strictEqual(historyProblem(historyOf({ '3a': { share: 1 } })), null);
  const missing = historyOf();
  delete missing.lenses['3g'];
  assert.match(historyProblem(missing), /3g/);
  // Only the lenses asked about must be present: a low-tier selection does not need 3g's entry.
  assert.strictEqual(historyProblem(missing, ['3b', '3c']), null);
  assert.deepStrictEqual(selectLenses({ tier: 'low', facts: allTrue(), history: missing, streaks: streaksOf() }).fallback, null);
  assert.match(historyProblem({ ...historyOf(), errors: 'x' }), /errors/);
  assert.match(historyProblem(historyOf({}, [null])), /errors/);
});

test('a zero-run lens is insufficient, not malformed', () => {
  const real = readLensHistory({ roots: [scratchDir('lens-select-')], liveness: () => 'dead' });
  assert.deepStrictEqual(real.errors, []);
  assert.strictEqual(real.lenses['3h'].shareWithFinding, null, 'fixture tracks the real zero-run shape');
  assert.strictEqual(historyProblem(real), null);
  const all = sel({ history: real });
  assert.strictEqual(all.fallback, null);
  assert.deepStrictEqual(all.selected, FULL);
  // 3h's usual state beside a sufficient history for the others.
  const mixed = historyOf({ '3d': { share: 0.1 } });
  mixed.lenses['3h'] = real.lenses['3h'];
  const r = sel({ history: mixed });
  assert.strictEqual(r.fallback, null);
  assert.ok(r.selected.includes('3h'));
  assert.ok(!r.selected.includes('3d'));
});

test('above-floor lens runs on every diff it applies to', () => {
  const r = sel({ history: historyOf({ '3a': { share: 0.9 } }) });
  assert.ok(r.selected.includes('3a'), '3a applies to any non-empty diff');
  const d = sel({ history: historyOf({ '3d': { share: 0.9 } }) });
  assert.ok(!d.selected.includes('3d'));
  assert.strictEqual(reasonOf(d, '3d'), '3d: share 0.9 ≥ floor 0.4, but the diff has no source change it applies to and no diff fact calls for it');
  const s = sel({ facts: sourceDiff(), history: historyOf({ '3d': { share: 0.9 } }) });
  assert.ok(s.selected.includes('3d'));
  // At exactly the floor the lens is above it.
  const at = sel({ facts: sourceDiff(), history: historyOf({ '3d': { share: SHARE_FLOOR } }) });
  assert.ok(at.selected.includes('3d'));
  const atProse = sel({ history: historyOf({ '3d': { share: SHARE_FLOOR } }) });
  assert.match(reasonOf(atProse, '3d'), /≥ floor/);
  // An empty diff: nothing applies to 3a, so it is skipped with the applies reason.
  const empty = sel({ facts: factsOf() });
  assert.match(reasonOf(empty, '3a'), /^3a: share 0\.9 ≥ floor 0\.4, but the diff has no changed path it applies to and no diff fact calls for it$/);
});

test('I1: an above-floor lens runs on a diff a fact calls for it on, as a below-floor one does', () => {
  // A prose-only change to a protected path: 3b, 3c and 3e are called for by riskPathTouched, but do not apply.
  const risky = factsOf({ paths: [{ path: 'plugin/skills/_shared/a.md', status: 'M', kind: 'prose' }], kinds: { prose: true }, riskPathTouched: true });
  const high = sel({ facts: risky, history: historyOf() });
  const low = sel({ facts: risky, history: historyOf(Object.fromEntries(LENS_IDS.map((id) => [id, { share: 0.1 }]))) });
  assert.deepStrictEqual(low.selected, ['3b', '3c', '3e', '3h']);
  for (const l of low.selected) assert.ok(high.selected.includes(l), `${l} at share 0.9`);
  // A workflow change on a risk path: 3e is called for, and applies to no source or new file.
  const wf = factsOf({ paths: [{ path: '.github/workflows/ci.yml', status: 'M', kind: 'workflow' }], kinds: { workflow: true }, executableContent: true, riskPathTouched: true });
  assert.ok(sel({ facts: wf }).selected.includes('3e'));
});

// Every combination of the boolean facts, plus an empty or non-empty `paths`. `riskFlags` is left empty: computeFacts
// folds a Risk-flag into riskPathTouched, which the combinations already cover.
function* everyFactCombination() {
  const bools = ['executableContent', 'shellInvocationAdded', 'inputHandlingAdded', 'errorHandlingTouched', 'riskPathTouched', 'newFiles', 'newModules', 'perCallPath', 'loopSpawn'];
  const kinds = ['prose', 'source', 'test', 'config', 'workflow'];
  const bits = bools.length + kinds.length + 1;
  for (let n = 0; n < 2 ** bits; n++) {
    const on = (i) => Boolean(n & (1 << i));
    yield factsOf({
      ...Object.fromEntries(bools.map((b, i) => [b, on(i)])),
      kinds: Object.fromEntries(kinds.map((k, i) => [k, on(bools.length + i)])),
      paths: on(bits - 1) ? [{ path: 'x', status: 'M', kind: 'config' }] : [],
    });
  }
}

test('I1: CALLED_FOR implies selected, at any share, over every combination of facts', () => {
  const above = historyOf();
  const below = historyOf(Object.fromEntries(LENS_IDS.map((id) => [id, { share: 0.1 }])));
  let checked = 0;
  for (const facts of everyFactCombination()) {
    const called = LENS_IDS.filter((l) => CALLED_FOR[l](facts.facts));
    if (called.length === 0) continue;
    for (const history of [above, below]) {
      const r = sel({ facts, history });
      const missed = called.filter((l) => !r.selected.includes(l));
      if (missed.length > 0) assert.fail(`${missed} called for but skipped: ${JSON.stringify(facts.facts)}`);
    }
    checked++;
  }
  assert.ok(checked > 1000, `${checked} combinations checked`);
});

test('a fact or kind that is present but not a boolean is a fallback, never read as false', () => {
  for (const name of ['executableContent', 'riskPathTouched', 'loopSpawn']) {
    for (const bad of [undefined, null, 'true', 1]) {
      const facts = proseOnly();
      facts.facts[name] = bad;
      const r = sel({ facts, history: historyOf({ '3d': { share: 0.1 } }) });
      assert.deepStrictEqual(r.selected, FULL, `${name}=${bad}`);
      assert.strictEqual(r.fallback, `facts unavailable: ${name} is not a boolean`);
    }
  }
  const noSource = proseOnly();
  delete noSource.facts.kinds.source;
  assert.strictEqual(sel({ facts: noSource }).fallback, 'facts unavailable: kinds.source is not a boolean');
  const strKind = proseOnly();
  strKind.facts.kinds.test = 'yes';
  assert.strictEqual(sel({ facts: strKind }).fallback, 'facts unavailable: kinds.test is not a boolean');
});

test('failed facts and a malformed history are both named, facts first', () => {
  const r = sel({ facts: { ok: false, fact: 'paths', reason: 'bad revision' }, history: null });
  assert.strictEqual(r.fallback, 'facts unavailable: paths: bad revision; history is not an object');
});

test('fallback text never prints undefined', () => {
  assert.strictEqual(sel({ facts: { ok: false } }).fallback, 'facts unavailable: unnamed fact: no reason given');
  assert.strictEqual(sel({ facts: { ok: false, fact: 'paths', reason: '' } }).fallback, 'facts unavailable: paths: no reason given');
  assert.strictEqual(sel({ history: historyOf({}, [{ reason: 'unreadable root (EACCES)' }]) }).fallback, 'history unreadable root (EACCES)');
  assert.strictEqual(sel({ history: historyOf({}, [{ path: '/r', reason: 'unreadable root (EACCES)' }]) }).fallback, 'history unreadable root (EACCES) at /r');
});

test('forced run every FORCE_EVERY reviews', () => {
  const history = historyOf({ '3d': { share: 0.1 } });
  assert.ok(sel({ history, streaks: streaksOf({ '3d': FORCE_EVERY - 1 }) }).selected.includes('3d'));
  assert.ok(sel({ history, streaks: streaksOf({ '3d': FORCE_EVERY + 3 }) }).selected.includes('3d'));
  const below = sel({ history, streaks: streaksOf({ '3d': FORCE_EVERY - 2 }) });
  assert.ok(!below.selected.includes('3d'));
  assert.match(reasonOf(below, '3d'), /\(1 of 3 reviews since it last ran\)$/);
  assert.ok(sel({ history, streaks: { ok: false } }).selected.includes('3d'));
  assert.ok(sel({ history, streaks: { ok: false, reason: 'x' } }).selected.includes('3d'));
  assert.ok(sel({ history, streaks: null }).selected.includes('3d'));
  // A count the streak reader did not give is never read as 0 (safe direction).
  const noEntry = streaksOf();
  delete noEntry.byLens['3d'];
  assert.ok(sel({ history, streaks: noEntry }).selected.includes('3d'));
  assert.ok(sel({ history, streaks: streaksOf({ '3d': 'x' }) }).selected.includes('3d'));
});

test('APPLIES and CALLED_FOR: each predicate reads its named facts', () => {
  const f = (o) => factsOf(o).facts;
  const nonEmpty = { paths: [{ path: 'x', status: 'M', kind: 'config' }] };
  assert.strictEqual(APPLIES['3a'](f()), false);
  assert.strictEqual(APPLIES['3a'](f(nonEmpty)), true);
  for (const l of ['3b', '3c']) {
    assert.strictEqual(APPLIES[l](f({ kinds: { source: true } })), false, l);
    assert.strictEqual(APPLIES[l](f({ executableContent: true })), true, l);
  }
  assert.strictEqual(APPLIES['3d'](f({ kinds: { test: true } })), false);
  assert.strictEqual(APPLIES['3d'](f({ kinds: { source: true } })), true);
  assert.strictEqual(APPLIES['3e'](f({ newFiles: true })), true);
  assert.strictEqual(APPLIES['3e'](f({ kinds: { source: true } })), true);
  assert.strictEqual(APPLIES['3e'](f({ kinds: { test: true } })), false);
  assert.strictEqual(APPLIES['3f'](f({ kinds: { test: true } })), true);
  assert.strictEqual(APPLIES['3f'](f({ kinds: { source: true } })), true);
  assert.strictEqual(APPLIES['3f'](f({ executableContent: true })), false);
  assert.strictEqual(APPLIES['3g'](f({ executableContent: true })), true);
  assert.strictEqual(APPLIES['3g'](f({ kinds: { test: true } })), true);
  assert.strictEqual(APPLIES['3g'](f({ kinds: { source: true } })), true);
  assert.strictEqual(APPLIES['3g'](f({ kinds: { config: true } })), false);
  assert.strictEqual(APPLIES['3h'](f()), true);

  assert.strictEqual(CALLED_FOR['3a'](f({ kinds: { source: true } })), true);
  assert.strictEqual(CALLED_FOR['3a'](f({ kinds: { test: true } })), true);
  assert.strictEqual(CALLED_FOR['3a'](f({ kinds: { prose: true } })), false);
  assert.strictEqual(CALLED_FOR['3b'](f({ riskPathTouched: true })), true);
  // computeFacts folds any Risk-flag into riskPathTouched (facts.test.js), so 3b and 3c read only that fact.
  assert.strictEqual(CALLED_FOR['3b'](f({ riskFlags: ['auth'], riskPathTouched: true })), true);
  for (const l of ['3b', '3c']) assert.strictEqual(CALLED_FOR[l](f({ riskFlags: ['auth'] })), false, `${l} reads riskPathTouched, not riskFlags`);
  assert.strictEqual(CALLED_FOR['3b'](f({ executableContent: true, shellInvocationAdded: true })), true);
  assert.strictEqual(CALLED_FOR['3b'](f({ executableContent: true, inputHandlingAdded: true })), true);
  assert.strictEqual(CALLED_FOR['3b'](f({ shellInvocationAdded: true, inputHandlingAdded: true })), false);
  assert.strictEqual(CALLED_FOR['3b'](f({ executableContent: true })), false);
  assert.strictEqual(CALLED_FOR['3c'](f({ shellInvocationAdded: true })), true);
  assert.strictEqual(CALLED_FOR['3c'](f({ inputHandlingAdded: true })), true);
  assert.strictEqual(CALLED_FOR['3c'](f({ errorHandlingTouched: true })), true);
  assert.strictEqual(CALLED_FOR['3c'](f({ executableContent: true })), false);
  assert.strictEqual(CALLED_FOR['3d'](f({ perCallPath: true })), true);
  assert.strictEqual(CALLED_FOR['3d'](f({ loopSpawn: true })), true);
  assert.strictEqual(CALLED_FOR['3d'](f({ kinds: { source: true } })), false);
  assert.strictEqual(CALLED_FOR['3e'](f({ newModules: true })), true);
  assert.strictEqual(CALLED_FOR['3e'](f({ riskPathTouched: true })), true);
  assert.strictEqual(CALLED_FOR['3e'](f({ newFiles: true })), false);
  assert.strictEqual(CALLED_FOR['3f'](f({ kinds: { test: true } })), true);
  assert.strictEqual(CALLED_FOR['3f'](f({ newModules: true })), true);
  assert.strictEqual(CALLED_FOR['3f'](f({ kinds: { source: true } })), false);
  assert.strictEqual(CALLED_FOR['3g'](f({ newModules: true })), true);
  assert.strictEqual(CALLED_FOR['3g'](f({ kinds: { source: true } })), false);
  assert.strictEqual(CALLED_FOR['3h'](f()), true);
});

test('AC9.1: a bookkeeping-only diff gets the rules as written', () => {
  const facts = factsOf({
    paths: [
      { path: '.claude-tweaks/pipelines/r/work/1-spec.md', status: 'M', kind: 'prose' },
      { path: 'docs/plans/x-ledger.md', status: 'M', kind: 'prose' },
    ],
    kinds: { prose: true },
  });
  const r = selectLenses({ tier: 'high', facts, history: historyOf({ '3b': { share: 0.1 }, '3d': { share: 0.1 } }), streaks: streaksOf() });
  assert.deepStrictEqual(r, {
    tier: 'high',
    selected: ['3a', '3h'],
    skipped: [
      { lens: '3b', reason: '3b: share 0.1 over its last 20 runs is below floor 0.4; no diff fact calls for it (0 of 3 reviews since it last ran)' },
      { lens: '3c', reason: '3c: share 0.9 ≥ floor 0.4, but the diff has no executable content it applies to and no diff fact calls for it' },
      { lens: '3f', reason: '3f: share 0.9 ≥ floor 0.4, but the diff has no source or test change it applies to and no diff fact calls for it' },
      { lens: '3d', reason: '3d: share 0.1 over its last 20 runs is below floor 0.4; no diff fact calls for it (0 of 3 reviews since it last ran)' },
      { lens: '3e', reason: '3e: share 0.9 ≥ floor 0.4, but the diff has no source change or new file it applies to and no diff fact calls for it' },
      { lens: '3g', reason: '3g: share 0.9 ≥ floor 0.4, but the diff has no source, test or executable content it applies to and no diff fact calls for it' },
    ],
    fallback: null,
  });
});

test('output shape is exactly {tier, selected, skipped, fallback}', () => {
  for (const r of [sel(), sel({ history: null }), sel({ tier: 'xhigh', facts: allTrue() })]) {
    assert.deepStrictEqual(Object.keys(r), ['tier', 'selected', 'skipped', 'fallback']);
    const order = TIER_LENSES[r.tier];
    assert.deepStrictEqual(r.selected, order.filter((l) => r.selected.includes(l)), 'selected in TIER_LENSES order');
    assert.deepStrictEqual(r.skipped.map((s) => s.lens), order.filter((l) => r.skipped.some((s) => s.lens === l)));
    for (const s of r.skipped) assert.deepStrictEqual(Object.keys(s), ['lens', 'reason']);
    assert.deepStrictEqual([...r.selected, ...r.skipped.map((s) => s.lens)].sort(), [...order].sort(), 'every tier lens is selected or skipped');
  }
  assert.strictEqual(sel({ tier: 'max' }).tier, 'max');
  assert.ok(!Object.isFrozen(sel().selected), 'result arrays are fresh, not the frozen constant');
});

test('an unknown tier throws', () => {
  assert.throws(() => sel({ tier: 'ultra' }), TypeError);
  assert.throws(() => sel({ tier: 'toString' }), TypeError);
});
