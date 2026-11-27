// tests/bin-lib/model-profiles/resolve.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { resolve } = require('../../../plugin/bin/lib/model-profiles/profiles');

test('table default resolves with source default', () => {
  assert.deepStrictEqual(resolve('standard', {}), {
    model: 'sonnet', effort: 'high', source: 'default',
    effortLine: '[Effort: high — apply high-level reasoning depth to this task.]',
    launchEffort: null,
  });
});

const { parsePolicyModelConfig } = require('../../../plugin/bin/lib/model-profiles/policy-fragment');

const EFFORT_LINE = (e) => `[Effort: ${e} — apply ${e}-level reasoning depth to this task.]`;
test('unset key leaves the four existing fields byte-identical', () => {
  const before = { fast: ['haiku', null, ''], standard: ['sonnet', 'high'], capable: ['opus', 'high'], frontier: ['fable', 'high'] };
  for (const [p, [model, effort]] of Object.entries(before)) {
    for (const policy of [{}, { 'model-effort': 'inherit' }]) {
      assert.deepStrictEqual(resolve(p, { policy }), { model, effort, source: 'default', effortLine: effort ? EFFORT_LINE(effort) : '', launchEffort: null });
    }
  }
});
test('profile binds launchEffort to the resolved effort', () => {
  const policy = { 'model-effort': 'profile' };
  for (const p of ['standard', 'capable', 'frontier']) assert.strictEqual(resolve(p, { policy }).launchEffort, 'high');
  assert.strictEqual(resolve('fast', { policy }).launchEffort, null);
});
test('launchEffort follows a policy row and a stance', () => {
  const policy = { 'model-effort': 'profile', 'model-profiles': { capable: { effort: 'medium' } } };
  assert.deepStrictEqual([resolve('capable', { policy }).effort, resolve('capable', { policy }).launchEffort], ['medium', 'medium']);
  const econ = resolve('capable', { policy, stance: 'economy' });
  assert.deepStrictEqual([econ.effort, econ.launchEffort], ['low', 'low']);
});
test('launchEffort follows the ceiling', () => {
  const r = resolve('capable', { policy: { 'model-effort': 'profile', 'model-ceiling': 'standard' } });
  assert.strictEqual(r.model, 'sonnet'); assert.strictEqual(r.launchEffort, r.effort);
});
test('a fast row with an effort yields that effort', () => {
  assert.strictEqual(resolve('fast', { policy: { 'model-effort': 'profile', 'model-profiles': { fast: { effort: 'medium' } } } }).launchEffort, 'medium');
});
test('a trailing comment on the model-effort line still reads profile', () => {
  const policy = parsePolicyModelConfig('model-effort: profile   # note\n');
  assert.strictEqual(policy['model-effort'], 'profile');
  assert.strictEqual(resolve('standard', { policy }).launchEffort, 'high');
});
test('launchEffort follows the diff ceiling', () => {
  const r = resolve('capable', { policy: { 'model-effort': 'profile' }, diffFacts: { implFiles: 1, totalLines: 10 } });
  assert.strictEqual(r.source, 'diff-ceiling');
  assert.strictEqual(r.model, 'sonnet');
  assert.strictEqual(r.effort, 'high');
  assert.strictEqual(r.launchEffort, 'high');
});
test('launchEffort is read after the diff ceiling, not captured from the policy row', () => {
  const policy = { 'model-effort': 'profile', 'model-profiles': { capable: { effort: 'low' } } };
  const r = resolve('capable', { policy, diffFacts: { implFiles: 1, totalLines: 10 } });
  assert.strictEqual(r.model, 'sonnet');
  assert.strictEqual(r.effort, 'high');
  assert.strictEqual(r.launchEffort, 'high');
});
test('launchEffort follows session-failure step-down to fast (null)', () => {
  const r = resolve('standard', { policy: { 'model-effort': 'profile' }, failedModels: new Set(['sonnet', 'opus']) });
  assert.strictEqual(r.model, 'haiku');
  assert.strictEqual(r.launchEffort, null);
});
test('launchEffort follows max-rigor', () => {
  assert.strictEqual(resolve('capable', { policy: { 'model-effort': 'profile' }, stance: 'max-rigor' }).launchEffort, 'xhigh');
});
test('model-effort is a closed rule: any other value throws', () => {
  for (const bad of ['Profile', 'sometimes']) {
    assert.throws(() => resolve('standard', { policy: { 'model-effort': bad } }), new RegExp(`unknown model-effort "${bad}"`));
  }
});

test('an empty model-effort is unset: inherit, launchEffort null, no throw', () => {
  const r = resolve('standard', { policy: { 'model-effort': '' } });
  assert.strictEqual(r.launchEffort, null);
});

test('policy row overrides the table; partial rows merge field-wise', () => {
  const policy = { 'model-profiles': { standard: { model: 'opus', effort: 'low' } } };
  const r = resolve('standard', { policy });
  assert.strictEqual(r.model, 'opus');
  assert.strictEqual(r.effort, 'low');
  assert.strictEqual(r.source, 'policy');
  const partial = resolve('standard', { policy: { 'model-profiles': { standard: { effort: 'low' } } } });
  assert.strictEqual(partial.model, 'sonnet'); // default model kept
  assert.strictEqual(partial.effort, 'low');
});

test('cliOverride beats policy', () => {
  const policy = { 'model-profiles': { standard: { model: 'opus' } } };
  const r = resolve('standard', { policy, cliOverride: { model: 'haiku' } });
  assert.strictEqual(r.model, 'haiku');
  assert.strictEqual(r.source, 'cli');
});

test('economy stance drops effort one notch; max-rigor raises capped at max; fast is stance-invariant', () => {
  assert.strictEqual(resolve('standard', { stance: 'economy' }).effort, 'medium');
  assert.strictEqual(resolve('standard', { stance: 'max-rigor' }).effort, 'xhigh');
  assert.strictEqual(resolve('standard', {
    policy: { 'model-profiles': { standard: { effort: 'max' } } }, stance: 'max-rigor',
  }).effort, 'max'); // clamped
  assert.deepStrictEqual(resolve('fast', { stance: 'economy' }),
    resolve('fast', {}));
});

test('stance comes from policy model-stance when opts.stance is absent, and opts.stance wins', () => {
  const policy = { 'model-stance': 'economy' };
  assert.strictEqual(resolve('standard', { policy }).effort, 'medium');
  assert.strictEqual(resolve('standard', { policy, stance: 'default' }).effort, 'high');
});

test('economy resolves frontier as capable with degraded:stance', () => {
  const r = resolve('frontier', { stance: 'economy' });
  assert.strictEqual(r.model, 'opus');
  assert.strictEqual(r.source, 'degraded:stance');
});

test('model-ceiling clamps non-cli resolutions and never a cliOverride', () => {
  const policy = { 'model-ceiling': 'standard' };
  const clamped = resolve('capable', { policy });
  assert.strictEqual(clamped.model, 'sonnet');
  assert.strictEqual(clamped.source, 'ceiling');
  const cli = resolve('capable', { policy, cliOverride: { model: 'opus' } });
  assert.strictEqual(cli.model, 'opus');
  assert.strictEqual(cli.source, 'cli');
});

test('frontier gates: unattended and cap degrade to capable with named sources', () => {
  const un = resolve('frontier', { unattended: true });
  assert.strictEqual(un.model, 'opus');
  assert.strictEqual(un.source, 'degraded:unattended');
  const cap = resolve('frontier', { frontierUsed: 3 });
  assert.strictEqual(cap.source, 'degraded:cap');
  const under = resolve('frontier', { frontierUsed: 2 });
  assert.strictEqual(under.model, 'fable');
  const raised = resolve('frontier', { frontierUsed: 3, policy: { 'frontier-run-cap': 5 } });
  assert.strictEqual(raised.model, 'fable');
  const disabled = resolve('frontier', { frontierUsed: 0, policy: { 'frontier-run-cap': 0 } });
  assert.strictEqual(disabled.source, 'degraded:cap');
});

test('stance never promotes a model upward', () => {
  assert.strictEqual(resolve('capable', { stance: 'max-rigor' }).model, 'opus');
});

// Beyond the plan's ten: the ten leave the stage-3 -> stage-4 ordering unpinned.
// A build with stance applied before cliOverride passes all ten, yet lets a
// cli-requested frontier survive economy stance — the guard's whole purpose.
test('stance applies after cliOverride, not before', () => {
  const cliFrontier = resolve('standard', { cliOverride: { model: 'fable' }, stance: 'economy' });
  assert.strictEqual(cliFrontier.model, 'opus');
  assert.strictEqual(cliFrontier.source, 'degraded:stance');
  const cliEffort = resolve('standard', { cliOverride: { effort: 'high' }, stance: 'max-rigor' });
  assert.strictEqual(cliEffort.effort, 'xhigh');
  assert.strictEqual(cliEffort.source, 'stance');
});

test('a failed model is skipped — resolution steps down to the next viable tier', () => {
  const r = resolve('frontier', { failedModels: new Set(['fable']) });
  assert.strictEqual(r.model, 'opus');
  assert.strictEqual(r.effort, 'high');
  assert.strictEqual(r.source, 'degraded:session-failure');
});

test('session-failure check runs after frontier gates — a cap-degraded capable that is also failed steps down again', () => {
  // The frontier gate alone (no failedModels) would degrade this to opus —
  // confirm that baseline first, so the next assertion is proven to be
  // session-failure avoidance catching a model the frontier gate itself
  // produced, not some other stage.
  const baseline = resolve('frontier', { frontierUsed: 3 });
  assert.strictEqual(baseline.model, 'opus');
  assert.strictEqual(baseline.source, 'degraded:cap');
  const r = resolve('frontier', { frontierUsed: 3, failedModels: new Set(['opus']) });
  assert.strictEqual(r.model, 'sonnet');
  assert.strictEqual(r.source, 'degraded:session-failure');
});

test('a failed model with every tier below it also failed floors at fast, never throws', () => {
  const r = resolve('frontier', { failedModels: new Set(['fable', 'opus', 'sonnet']) });
  assert.strictEqual(r.model, 'haiku');
  assert.strictEqual(r.source, 'degraded:session-failure');
});

// #841 item 2: when the profile is ALREADY at the floor (fast) and fast's
// own model is also failed, nextViableModel has nowhere lower to go and
// returns the same tier — a genuine no-change case, not a step-down. Source
// must stay 'default', matching this function's own "last stage that
// CHANGED the result" invariant instead of falsely claiming a degrade.
test('a failed model already at the floor claims no source — genuinely unchanged, not a step-down', () => {
  const r = resolve('fast', { failedModels: new Set(['haiku']) });
  assert.strictEqual(r.model, 'haiku');
  assert.strictEqual(r.effort, null);
  assert.strictEqual(r.source, 'default');
});

test('a model not in failedModels is unaffected — no source claimed', () => {
  const r = resolve('standard', { failedModels: new Set(['fable']) });
  assert.strictEqual(r.model, 'sonnet');
  assert.strictEqual(r.source, 'default');
});

test('an absent failedModels option behaves exactly as before (byte-identical to omitting it)', () => {
  assert.deepStrictEqual(resolve('frontier', {}), resolve('frontier', { failedModels: new Set() }));
});

test('session-failure avoidance runs after cliOverride and stance too', () => {
  const r = resolve('standard', {
    cliOverride: { model: 'opus' }, failedModels: new Set(['opus']),
  });
  assert.strictEqual(r.model, 'sonnet');
  assert.strictEqual(r.source, 'degraded:session-failure');
});

test('an empty row claims no source at either stage', () => {
  assert.strictEqual(
    resolve('standard', { policy: { 'model-profiles': { standard: {} } } }).source, 'default');
  assert.strictEqual(resolve('standard', { cliOverride: {} }).source, 'default');
});

test('a policy row restating the table values exactly claims no source', () => {
  const policy = { 'model-profiles': { standard: { model: 'sonnet', effort: 'high' } } };
  assert.strictEqual(resolve('standard', { policy }).source, 'default');
  // Only the unchanged field is inert — a row changing one field still claims.
  const half = { 'model-profiles': { standard: { model: 'sonnet', effort: 'low' } } };
  assert.strictEqual(resolve('standard', { policy: half }).source, 'policy');
});

test('an empty cliOverride is inert at the ceiling stage too, not just for source', () => {
  const r = resolve('capable', { policy: { 'model-ceiling': 'standard' }, cliOverride: {} });
  assert.strictEqual(r.model, 'sonnet');
  assert.strictEqual(r.source, 'ceiling');
});

test('unknown profile and unknown stance throw with the name in the message', () => {
  assert.throws(() => resolve('turbo', {}), /turbo/);
  assert.throws(() => resolve('standard', { stance: 'frugal' }), /frugal/);
});

test('an unknown effort throws from either value source, and never resolves silently', () => {
  assert.throws(
    () => resolve('standard', { policy: { 'model-profiles': { standard: { effort: 'hgih' } } } }),
    /hgih/);
  assert.throws(() => resolve('standard', { cliOverride: { effort: 'turbo' } }), /turbo/);
  // Regression for the documented probe: a typo'd effort under max-rigor used to
  // resolve `low` — shiftEffort's indexOf returned -1 and the clamp floored it,
  // so a typo asking for MORE rigor delivered the least. It must throw instead.
  assert.throws(() => resolve('standard', {
    policy: { 'model-profiles': { standard: { effort: 'hgih' } } }, stance: 'max-rigor',
  }), /hgih/);
});

// #1912: diff-facts ceiling — downward-only bound on `capable` requests.
test('diff-facts ceiling caps a capable request to standard on a tiny diff', () => {
  const r = resolve('capable', { diffFacts: { implFiles: 1, totalLines: 40 } });
  assert.strictEqual(r.model, 'sonnet');
  assert.strictEqual(r.effort, 'high');
  assert.strictEqual(r.source, 'diff-ceiling');
});

test('diff-facts ceiling is inert on a larger diff (either threshold exceeded)', () => {
  const overFiles = resolve('capable', { diffFacts: { implFiles: 2, totalLines: 40 } });
  assert.strictEqual(overFiles.model, 'opus');
  assert.strictEqual(overFiles.source, 'default');
  const overLines = resolve('capable', { diffFacts: { implFiles: 1, totalLines: 60 } });
  assert.strictEqual(overLines.model, 'opus');
  assert.strictEqual(overLines.source, 'default');
});

test('diff-facts ceiling is inert when --diff-facts is absent', () => {
  const r = resolve('capable', {});
  assert.strictEqual(r.model, 'opus');
  assert.strictEqual(r.source, 'default');
});

test('diff-facts ceiling never applies to frontier, even on a tiny diff', () => {
  const r = resolve('frontier', { diffFacts: { implFiles: 1, totalLines: 10 } });
  assert.strictEqual(r.model, 'fable');
  assert.strictEqual(r.source, 'default');
});

test('diff-facts ceiling never raises a tier already below standard', () => {
  const r = resolve('fast', { diffFacts: { implFiles: 1, totalLines: 10 } });
  assert.strictEqual(r.model, 'haiku');
  assert.strictEqual(r.source, 'default');
});

test('diff-facts ceiling defers to an explicit cliOverride (cliOverride already resolved before this stage runs, and the ceiling only fires on a resolved tier above standard)', () => {
  const r = resolve('capable', {
    diffFacts: { implFiles: 1, totalLines: 10 },
    cliOverride: { model: 'opus' },
  });
  assert.strictEqual(r.model, 'opus');
  assert.strictEqual(r.source, 'cli');
});

// ---- design-reader frontier exception (#6351) ----
const DR = { exception: 'design-reader' };
const { STEP_DOWN_REASONS } = require('../../../plugin/bin/lib/model-profiles/profiles');

test('AC1.1: under design-reader, resolutions 1 to 22 return fable with source exception:design-reader', () => {
  for (let used = 0; used < 22; used += 1) {
    const r = resolve('frontier', { ...DR, exceptionUsed: used });
    assert.strictEqual(r.model, 'fable');
    assert.strictEqual(r.source, 'exception:design-reader');
    assert.strictEqual(r.effort, 'high');
  }
});

test('AC1.2: under design-reader, resolution 23 returns stepDown limit', () => {
  assert.deepStrictEqual(resolve('frontier', { ...DR, exceptionUsed: 22 }), { stepDown: { reason: 'limit' } });
});

const GATES = {
  policy: { policy: { 'model-profiles': { frontier: { model: 'opus' } } } },
  stance: { stance: 'economy' },
  ceiling: { policy: { 'model-ceiling': 'capable' } },
  limit: { exceptionUsed: 22 },
  'session-failure': { failedModels: new Set(['fable']) },
};
function mergeGates(...names) {
  const out = {};
  for (const n of names) {
    const g = GATES[n];
    if (g.policy) out.policy = { ...(out.policy || {}), ...g.policy };
    for (const k of Object.keys(g)) if (k !== 'policy') out[k] = g[k];
  }
  return out;
}

test('AC2.1: each step-down reason is reported with no model', () => {
  for (const reason of Object.keys(GATES)) {
    const r = resolve('frontier', { ...DR, ...mergeGates(reason) });
    assert.deepStrictEqual(r, { stepDown: { reason } });
    assert.ok(!('model' in r));
  }
});

test('AC2.2: precedence — with every gate firing, the first reason in STEP_DOWN_REASONS order wins', () => {
  const order = STEP_DOWN_REASONS.filter((x) => x !== 'tally');
  for (let i = 0; i < order.length; i += 1) {
    const r = resolve('frontier', { ...DR, ...mergeGates(...order.slice(i)) });
    assert.deepStrictEqual(r, { stepDown: { reason: order[i] } });
  }
});

test('effort-only changes are not step-downs under the exception', () => {
  const a = resolve('frontier', { ...DR, stance: 'max-rigor' });
  assert.strictEqual(a.model, 'fable');
  assert.strictEqual(a.effort, 'xhigh');
  assert.strictEqual(a.source, 'exception:design-reader');
  const b = resolve('frontier', { ...DR, policy: { 'model-profiles': { frontier: { effort: 'medium' } } } });
  assert.strictEqual(b.model, 'fable');
  assert.strictEqual(b.effort, 'medium');
  assert.strictEqual(b.source, 'exception:design-reader');
});

test('AC4.1: design-reader with unattended throws the refusal', () => {
  assert.throws(() => resolve('frontier', { ...DR, unattended: true }), /refuses an unattended call/);
});

test('AC6.1: an unknown exception throws naming design-reader', () => {
  assert.throws(() => resolve('frontier', { exception: 'other' }), /unknown exception "other" — the one exception is "design-reader"/);
});

test('the exception applies only to frontier', () => {
  assert.throws(() => resolve('capable', DR), /applies only to the frontier profile/);
});

test('AC5.1: without an exception the fourth frontier resolution still degrades with degraded:cap', () => {
  const r = resolve('frontier', { frontierUsed: 3 });
  assert.strictEqual(r.model, 'opus');
  assert.strictEqual(r.source, 'degraded:cap');
});
