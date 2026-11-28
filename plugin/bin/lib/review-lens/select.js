'use strict';

// Review lens selection (#6001): which of `/claude-tweaks:review` Step 3's lenses a review dispatches, decided from
// the tier's lens set, the diff facts (`facts.js`), the per-lens history (`history.js`) and the skip streaks. Pure:
// no I/O, and no model chooses — every rule below is a named constant.
//
// selectLenses({ tier, facts, history, streaks }) -> { tier, selected: [lens], skipped: [{lens, reason}], fallback }
//   tier     one of TIERS; anything else throws TypeError.
//   facts    computeFacts' envelope as returned: { ok: true, facts } | { ok: false, fact, reason }. It is unwrapped
//            once and the inner object is what every APPLIES / CALLED_FOR predicate reads.
//   history  readLensHistory's result: { lenses: {id: {runs, confirmed, perRun, shareWithFinding, insufficient}},
//            skipped, errors }.
//   streaks  { ok: true, byLens: {id: n} } | { ok: false, reason } — n is the reviews since the lens last ran.
// `selected` and `skipped` are in TIER_LENSES order; every tier lens is in exactly one of them. `fallback` is null, or
// the reason the full tier set was returned.
//
// Rules, per lens of TIER_LENSES[tier] (the tier's set is the ceiling — a lens outside it is never added):
//   1. Fallback: facts not `ok`, or a malformed envelope (a FACT_NAMES entry missing, a boolean fact or a KIND_NAMES
//      kind that is not a boolean, `paths` / `riskFlags` not arrays), or historyProblem(history) non-null -> the full
//      tier set, `skipped: []`, `fallback` = the reason (both, joined by "; ", when both fail). Never read as "no
//      facts call for anything".
//   2. The lens's history is `insufficient` -> selected.
//   3. shareWithFinding >= SHARE_FLOOR -> selected iff APPLIES[lens](facts) or CALLED_FOR[lens](facts) (a diff a fact
//      calls for the lens on is a diff it applies to); else skipped
//      "{lens}: share {s} ≥ floor {f}, but the diff has no {APPLIES_WHAT[lens]} it applies to and no diff fact calls
//      for it".
//   4. Below the floor -> selected iff CALLED_FOR[lens](facts) or the streak forces it (streaks not ok, or the lens's
//      count is not a non-negative integer, or it is >= FORCE_EVERY - 1); else skipped
//      "{lens}: share {s} over its last {runs} runs is below floor {f}; no diff fact calls for it ({k} of {FORCE_EVERY}
//      reviews since it last ran)".
//
// historyProblem(history, lenses = LENS_IDS) -> reason | null: not an object; `lenses` not an object; a lens asked
// about has no entry; an entry's `runs` is not a non-negative integer or `insufficient` not a boolean; an
// `insufficient: false` entry whose `shareWithFinding` is not a finite number in [0, 1]; `errors` not an array, an
// entry without a string `reason`, or an `unreadable root` / `unreadable archive` entry (a whole root or archive lost,
// so the 20-run window is not the real one). An `insufficient: true` entry with `shareWithFinding: null` is the
// zero-run shape, never malformed; per-run errors (`unreadable spec members`, `step-yield.json missing`, …) exclude
// only their run and leave the history usable (#6001 Review Focus 1).
//
// Constants and their sources:
//   TIERS, TIER_LENSES — `plugin/skills/review/step3-lens-dispatch.md`'s tier table, verbatim and in its order.
//   SHARE_FLOOR = 0.4 — tuned on 69 runs (2026-08-15T220143-record-472…2026-11-01T204931-record-4781), held-out 23 runs, lost 1; evidence lens-replay.txt (#6001 build replay)
//   FORCE_EVERY = 3 — tuned on 69 runs (2026-08-15T220143-record-472…2026-11-01T204931-record-4781), held-out 23 runs, lost 1; evidence lens-replay.txt (#6001 build replay)
//     A tie-break among equal tuning results (FORCE_EVERY 3, 4, 5, 6 and 8 of the grid's 2, 3, 4, 5, 6, 8, 10 gave
//     lost 0, 13 skips at floor 0.4), smallest chosen; not exercised for 3d/3e/3g/3h, which stayed insufficient
//     through the tuning slice.
//   APPLIES = Task 2's lists, not varied by the replay: over all 280 tuning configurations every lost finding was a
//     below-floor skip, none a not-applicable one; held-out 23 runs, lost 1 (below floor); evidence lens-replay.txt (#6001 build replay)
//     Rule 3's `or CALLED_FOR` (#6001 fix wave) only adds selections to the replayed rule 3 (APPLIES alone), so the
//     replay's zero not-applicable losses stand; re-run with this module, the replay's tuning and held-out results
//     are unchanged.
//   CALLED_FOR = Task 2's lists, 3b and 3c also called for by any source or test change — tuned on 69 runs (2026-08-15T220143-record-472…2026-11-01T204931-record-4781), held-out 23 runs, lost 1; evidence lens-replay.txt (#6001 build replay)
//     3b and 3c carry no `riskFlags.length > 0` clause: computeFacts folds any Risk-flag into riskPathTouched, which
//     both already read, so the replay's variants that carried it gave the same results without it.
//   The held-out loss (one medium 3d finding, a lens whose history never reached 20 runs in the tuning slice) misses
//   the zero-loss bar: this repository's opt-in waits for a retune. (3h is always applicable and always called for:
//   it keeps its own QA-data gate in Step 3.)

const { FACT_NAMES, KIND_NAMES } = require('./facts');
const { LENS_IDS } = require('./dispatch-record');

const TIERS = Object.freeze(['low', 'medium', 'high', 'xhigh', 'max']);
const FULL_SET = Object.freeze(['3b', '3c', '3a', '3f', '3d', '3e', '3g', '3h']);
const TIER_LENSES = Object.freeze({
  low: Object.freeze(['3b', '3c']),
  medium: Object.freeze(['3b', '3c', '3a', '3f']),
  high: FULL_SET,
  xhigh: FULL_SET,
  max: FULL_SET,
});

const SHARE_FLOOR = 0.4;
const FORCE_EVERY = 3;

const APPLIES = Object.freeze({
  '3a': (f) => f.paths.length > 0,
  '3b': (f) => f.executableContent,
  '3c': (f) => f.executableContent,
  '3d': (f) => f.kinds.source,
  '3e': (f) => f.kinds.source || f.newFiles,
  '3f': (f) => f.kinds.source || f.kinds.test,
  '3g': (f) => f.kinds.source || f.kinds.test || f.executableContent,
  '3h': () => true,
});

// What each APPLIES predicate looks for, named in the rule-3 skip reason.
const APPLIES_WHAT = Object.freeze({
  '3a': 'changed path',
  '3b': 'executable content',
  '3c': 'executable content',
  '3d': 'source change',
  '3e': 'source change or new file',
  '3f': 'source or test change',
  '3g': 'source, test or executable content',
  '3h': 'change',
});

const CALLED_FOR = Object.freeze({
  '3a': (f) => f.kinds.source || f.kinds.test,
  '3b': (f) => f.kinds.source || f.kinds.test || f.riskPathTouched || (f.executableContent && (f.shellInvocationAdded || f.inputHandlingAdded)),
  '3c': (f) => f.kinds.source || f.kinds.test || f.riskPathTouched || f.shellInvocationAdded || f.inputHandlingAdded || f.errorHandlingTouched,
  '3d': (f) => f.perCallPath || f.loopSpawn,
  '3e': (f) => f.newModules || f.riskPathTouched,
  '3f': (f) => f.kinds.test || f.newModules,
  '3g': (f) => f.newModules,
  '3h': () => true,
});

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const own = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
const textOr = (v, fallback) => (typeof v === 'string' && v !== '' ? v : fallback);
// The FACT_NAMES entries that are not booleans; unwrapFacts checks their shapes one by one.
const NON_BOOLEAN_FACTS = Object.freeze(['paths', 'kinds', 'riskFlags']);
const WHOLE_WINDOW_LOST_RE = /^unreadable (?:root|archive) \(/;

function historyProblem(history, lenses = LENS_IDS) {
  if (!isObject(history)) return 'history is not an object';
  if (!isObject(history.lenses)) return 'history lenses is not an object';
  for (const lens of lenses) {
    if (!own(history.lenses, lens) || !isObject(history.lenses[lens])) return `history has no entry for lens ${lens}`;
    const e = history.lenses[lens];
    if (!Number.isInteger(e.runs) || e.runs < 0) return `history lens ${lens}: runs is not a non-negative integer`;
    if (typeof e.insufficient !== 'boolean') return `history lens ${lens}: insufficient is not a boolean`;
    if (!e.insufficient) {
      const s = e.shareWithFinding;
      if (typeof s !== 'number' || !Number.isFinite(s) || s < 0 || s > 1) {
        return `history lens ${lens}: shareWithFinding is not a number in [0, 1]`;
      }
    }
  }
  if (history.errors !== undefined && !Array.isArray(history.errors)) return 'history errors is not an array';
  for (const err of history.errors || []) {
    if (!isObject(err) || typeof err.reason !== 'string') return 'history errors holds an entry without a reason';
    if (WHOLE_WINDOW_LOST_RE.test(err.reason)) return `history ${err.reason}${typeof err.path === 'string' && err.path ? ` at ${err.path}` : ''}`;
  }
  return null;
}

// The inner facts object, or { problem } when the envelope cannot be read as computed facts.
function unwrapFacts(envelope) {
  if (!isObject(envelope)) return { problem: 'facts unavailable: no facts envelope' };
  if (envelope.ok === false) return { problem: `facts unavailable: ${textOr(envelope.fact, 'unnamed fact')}: ${textOr(envelope.reason, 'no reason given')}` };
  const f = envelope.facts;
  if (envelope.ok !== true || !isObject(f)) return { problem: 'facts unavailable: malformed facts envelope' };
  for (const name of FACT_NAMES) {
    if (!own(f, name)) return { problem: `facts unavailable: ${name} missing` };
    if (!NON_BOOLEAN_FACTS.includes(name) && typeof f[name] !== 'boolean') return { problem: `facts unavailable: ${name} is not a boolean` };
  }
  if (!isObject(f.kinds)) return { problem: 'facts unavailable: kinds is not an object' };
  for (const kind of KIND_NAMES) {
    if (typeof f.kinds[kind] !== 'boolean') return { problem: `facts unavailable: kinds.${kind} is not a boolean` };
  }
  if (!Array.isArray(f.paths)) return { problem: 'facts unavailable: paths is not an array' };
  if (!Array.isArray(f.riskFlags)) return { problem: 'facts unavailable: riskFlags is not an array' };
  return { facts: f };
}

// The count the streak reader gave, or null when it gave none usable (the safe direction: forced).
function streakOf(streaks, lens) {
  if (!isObject(streaks) || streaks.ok !== true || !isObject(streaks.byLens)) return null;
  const k = own(streaks.byLens, lens) ? streaks.byLens[lens] : undefined;
  return Number.isInteger(k) && k >= 0 ? k : null;
}

function selectLenses({ tier, facts, history, streaks } = {}) {
  if (typeof tier !== 'string' || !TIERS.includes(tier)) throw new TypeError(`tier must be one of ${TIERS.join(', ')}`);
  const lenses = TIER_LENSES[tier];
  const unwrapped = unwrapFacts(facts);
  const problem = [unwrapped.problem, historyProblem(history, lenses)].filter(Boolean).join('; ');
  if (problem) return { tier, selected: [...lenses], skipped: [], fallback: problem };

  const f = unwrapped.facts;
  const selected = [];
  const skipped = [];
  for (const lens of lenses) {
    const h = history.lenses[lens];
    if (h.insufficient) { selected.push(lens); continue; }
    const s = h.shareWithFinding;
    if (s >= SHARE_FLOOR) {
      if (APPLIES[lens](f) || CALLED_FOR[lens](f)) selected.push(lens);
      else skipped.push({ lens, reason: `${lens}: share ${s} ≥ floor ${SHARE_FLOOR}, but the diff has no ${APPLIES_WHAT[lens]} it applies to and no diff fact calls for it` });
      continue;
    }
    const k = streakOf(streaks, lens);
    if (CALLED_FOR[lens](f) || k === null || k >= FORCE_EVERY - 1) { selected.push(lens); continue; }
    skipped.push({
      lens,
      reason: `${lens}: share ${s} over its last ${h.runs} runs is below floor ${SHARE_FLOOR}; no diff fact calls for it (${k} of ${FORCE_EVERY} reviews since it last ran)`,
    });
  }
  return { tier, selected, skipped, fallback: null };
}

module.exports = { TIERS, TIER_LENSES, SHARE_FLOOR, FORCE_EVERY, APPLIES, APPLIES_WHAT, CALLED_FOR, historyProblem, selectLenses };
