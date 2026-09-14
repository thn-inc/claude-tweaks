// bin/lib/model-profiles/profiles.js
//
// Canonical work-profile data. The markdown table in
// skills/_shared/subagent-dispatch-core.md §Model Selection is pinned to
// PROFILES by tests/bin-lib/model-profiles/table-pinning.test.js — change
// them together or the suite goes red.
//
// resolve() runs seven stages in fixed order — table default, policy row,
// cliOverride, stance, model-ceiling, frontier gates, session-failure
// avoidance (#763) — with the last stage that changed the result naming
// `source`.
'use strict';

const PROFILES = {
  fast: { model: 'haiku', effort: null },
  standard: { model: 'sonnet', effort: 'high' },
  capable: { model: 'opus', effort: 'high' },
  frontier: { model: 'fable', effort: 'high', singletonOnly: true, degradeTo: 'capable' },
};

const EFFORT_SCALE = ['low', 'medium', 'high', 'xhigh', 'max'];

// The four policy.yml keys the resolver reads. #219 pins policy-schema.js
// registration against this export — the names here are authoritative.
const POLICY_KEYS_READ = ['model-profiles', 'model-stance', 'model-ceiling', 'frontier-run-cap'];

function effortLine(effort) {
  if (!effort) return '';
  return `[Effort: ${effort} — apply ${effort}-level reasoning depth to this task.]`;
}

const STANCES = ['economy', 'default', 'max-rigor'];
const PROFILE_ORDER = ['fast', 'standard', 'capable', 'frontier'];

function shiftEffort(effort, delta) {
  if (!effort) return effort; // fast has no dial
  const i = EFFORT_SCALE.indexOf(effort);
  const j = Math.min(Math.max(i + delta, 0), EFFORT_SCALE.length - 1);
  return EFFORT_SCALE[j];
}

function profileOfModel(model) {
  const name = PROFILE_ORDER.find((p) => PROFILES[p].model === model);
  if (!name) throw new Error(`unknown model "${model}" — not a profile family alias`);
  return name;
}

// Steps down PROFILE_ORDER from `model`'s own tier until it finds a model
// not in `failedModels`, floored at 'fast' (index 0) — never goes below the
// cheapest tier, even when fast's own model is also failed, since there is
// nowhere lower to fall back to.
function nextViableModel(model, failedModels) {
  let idx = PROFILE_ORDER.indexOf(profileOfModel(model));
  while (idx > 0 && failedModels.has(PROFILES[PROFILE_ORDER[idx]].model)) {
    idx -= 1;
  }
  return PROFILE_ORDER[idx];
}

// Every degrade path lands on the same profile (capable) — only the reason
// differs, so it becomes the `degraded:{reason}` source tag.
function degrade(reason) {
  return { ...PROFILES.capable, source: `degraded:${reason}` };
}

// Pure: no fs, no process, no I/O. The CLI owns all of that.
// Seven stages in fixed order — table default, policy row, cliOverride,
// stance, model-ceiling, frontier gates, session-failure avoidance — with
// the last transform that changed the result naming `source`.
function resolve(profile, opts = {}) {
  if (!PROFILES[profile]) throw new Error(`unknown profile "${profile}"`);
  const policy = opts.policy || {};
  const stance = opts.stance || policy['model-stance'] || 'default';
  if (!STANCES.includes(stance)) throw new Error(`unknown stance "${stance}"`);

  let model = PROFILES[profile].model;
  let effort = PROFILES[profile].effort;
  let source = 'default';

  // Stages 2 and 3 both claim `source` only when they moved the result — the
  // rule is "last transform that CHANGED it", so an inert row stays silent.
  // What counts as inert differs between them, and deliberately so.
  const row = (policy['model-profiles'] || {})[profile];
  if (row) {
    const was = { model, effort };
    if (row.model !== undefined) model = row.model;
    if (row.effort !== undefined) effort = row.effort;
    // A policy row is inert unless a value actually differs: a file that
    // redundantly restates the table's own pair changed nothing anywhere.
    if (model !== was.model || effort !== was.effort) source = 'policy';
  }

  // A cliOverride's *presence* is load-bearing in a way a policy row's is not:
  // stage 5 skips the model-ceiling clamp whenever one is supplied. So naming a
  // field changes the outcome even when it restates the value already resolved
  // — `--model opus` on `capable` under `model-ceiling: standard` resolves opus
  // precisely because it was asked for, and `source: 'cli'` is what records
  // that. Only an override naming no field at all is inert, and it is then
  // inert everywhere: `cliNames`, not `cli`, also gates the ceiling skip below.
  const cli = opts.cliOverride;
  const cliNames = !!cli && (cli.model !== undefined || cli.effort !== undefined);
  if (cliNames) {
    if (cli.model !== undefined) model = cli.model;
    if (cli.effort !== undefined) effort = cli.effort;
    source = 'cli';
  }

  // Both value sources above are external text (a policy.yml row, a caller's
  // override) and neither is schema-checked upstream. An unrecognised effort
  // would otherwise pass through shiftEffort's indexOf as -1 and resolve to the
  // scale's floor — a typo silently downgrading rigor instead of failing.
  if (effort !== null && !EFFORT_SCALE.includes(effort)) throw new Error(`unknown effort "${effort}"`);

  if (stance !== 'default') {
    const shifted = shiftEffort(effort, stance === 'economy' ? -1 : 1);
    if (shifted !== effort) { effort = shifted; source = 'stance'; }
    if (stance === 'economy' && profileOfModel(model) === 'frontier') {
      ({ model, effort, source } = degrade('stance'));
    }
  }

  const ceiling = policy['model-ceiling'];
  if (ceiling && !cliNames) {
    if (!PROFILES[ceiling]) throw new Error(`unknown model-ceiling "${ceiling}"`);
    if (PROFILE_ORDER.indexOf(profileOfModel(model)) > PROFILE_ORDER.indexOf(ceiling)) {
      ({ model, effort } = { ...PROFILES[ceiling] });
      source = 'ceiling';
    }
  }

  if (profileOfModel(model) === 'frontier') {
    const cap = policy['frontier-run-cap'] !== undefined ? policy['frontier-run-cap'] : 3;
    if (opts.unattended) {
      ({ model, effort, source } = degrade('unattended'));
    } else if ((opts.frontierUsed || 0) >= cap) {
      ({ model, effort, source } = degrade('cap'));
    }
  }

  const failedModels = opts.failedModels || new Set();
  if (failedModels.has(model)) {
    const tier = nextViableModel(model, failedModels);
    // #841 item 2: nextViableModel floors at the current tier itself when
    // there is nowhere lower to fall back to (the current tier IS 'fast',
    // whose own model is also failed) — that floored/no-change case must
    // not claim `source`, matching this function's own "last stage that
    // CHANGED the result" invariant. A genuine step-down (a different tier)
    // still claims it, same as before.
    if (tier !== profileOfModel(model)) {
      ({ model, effort } = { ...PROFILES[tier] });
      source = 'degraded:session-failure';
    }
  }

  // #1912: a downward-only bound from the run's own measured diff size —
  // never an upward risk signal (see docs/decisions/ alongside #361's
  // declined UI-surface signal). Applies only to a `capable` REQUEST
  // (the two singleton slots pinned to `resolve-profile.js capable`:
  // SDD's whole-branch review and wrap-up's full-mode reflect dispatch) —
  // never to `frontier` (a singleton-slot judgment, unchanged) and never
  // to a lens fan-out, which never requests `capable` here in the first
  // place since those already scale by `review-effort`. A tiny diff
  // (<=1 impl file, <60 total lines — `ceremony-derive.js`'s
  // `computeDiffFacts` shape) caps the resolved tier at `standard`; a
  // larger diff, an already-lower tier, or an explicit cliOverride (same
  // "an explicit ask always wins" precedent the model-ceiling stage
  // above already follows) is untouched — this can only ever lower,
  // never raise, what stages 1-7 already resolved.
  const diffFacts = opts.diffFacts;
  if (
    profile === 'capable' &&
    !cliNames &&
    diffFacts &&
    diffFacts.implFiles <= 1 &&
    diffFacts.totalLines < 60 &&
    PROFILE_ORDER.indexOf(profileOfModel(model)) > PROFILE_ORDER.indexOf('standard')
  ) {
    ({ model, effort } = { ...PROFILES.standard });
    source = 'diff-ceiling';
  }

  return { model, effort, source, effortLine: effortLine(effort) };
}

module.exports = { PROFILES, EFFORT_SCALE, POLICY_KEYS_READ, effortLine, resolve };
