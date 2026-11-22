'use strict';
// tools/review-replay/reviews-score.js — scores every replayed lens reviewer's reply, per arm and lens: the run's
// confirmed findings it raised (recall, per slot and summed), the archived reviewer's own rows it raised, the rows no
// archived reviewer of that run raised (`new`), and the reference arm's rows it also raised; the control arms' recall of
// the archived rows is each lens's `fidelity`. Agents are identified and costed as score.js does. A reply that is
// missing, recorded at another effort than its arm's, or not a lens report is notJudged, never a found-nothing review.

const path = require('path');
const { bump } = require('./util.js');
const { replaySlots, readJson, stripTree, emptyCost, addCost } = require('./score.js');
const { parseFindings, near } = require('./counterfactual.js');
const { parseLensReport, SEVERITIES } = require('../pipeline-cost-report/reviews.js');
const {
  REVIEWS_MANIFEST_FILE, REVIEWS_FIXTURE_FILE, REPORTS_FILE, isControlArm, validateReviewsManifest,
} = require('./schema.js');

const EXIT_NOT_CLEAN = 3;
const NOTES = [
  'Confirmed recall rewards an arm that behaves like the archive: the confirmed set comes from the archived tier\'s own output.',
  'A new row is neither noise nor signal until sampled.',
  'A clean repository holds two commits, so git log and git blame differ from the archived review.',
];
const COUNT_KEYS = [...SEVERITIES, 'overflow'];

const share = (caught, of) => (of === 0 ? null : caught / of);
// How many of `targets` (each { path, line }) some row of `rows` is near.
const caughtBy = (targets, rows) => targets.filter((t) => rows.some((r) => near(r, t.path, t.line))).length;

// The scored and excluded slots per lens, as the extraction's fixture recorded them. Run-level exclusions and
// unlabelled dispatches carry no lens and are left out.
function fixtureByLens(fixture) {
  const byLens = {};
  const lens = (l) => byLens[l] || (byLens[l] = { selected: 0, excludedByReason: {} });
  for (const s of fixture.slots) lens(s.lens).selected += 1;
  for (const e of fixture.excluded) if (e.lens !== undefined) bump(lens(e.lens).excludedByReason, e.reason);
  return byLens;
}

function lensEntry(arm, reference) {
  const entry = {
    reviews: 0,
    rowsBySeverity: Object.fromEntries(COUNT_KEYS.map((k) => [k, 0])),
    confirmed: { caught: 0, of: 0, unlocated: 0 },
    // Slots whose unit had no readable decisions.md: no confirmed set to score against, so they add nothing above.
    confirmedMissingSource: 0,
    archived: { caught: 0, of: 0 },
    new: 0,
    vsReference: arm.name === reference ? null : { raised: 0, of: 0 },
    fidelity: null,
  };
  if (arm.repeat > 1) {
    entry.byRepeat = {};
    for (let r = 1; r <= arm.repeat; r += 1) entry.byRepeat[r] = { caught: 0, of: 0 };
  }
  return entry;
}

function scoreReviews(opts, deps) {
  const fsImpl = deps.fs;
  const manifestFile = path.join(opts.out, REVIEWS_MANIFEST_FILE);
  const manifest = readJson(fsImpl, manifestFile);
  const problems = validateReviewsManifest(manifest);
  if (problems.length > 0) {
    deps.err(`review-replay.js: ${manifestFile}: ${problems[0]}`);
    return 1;
  }
  const fixture = readJson(fsImpl, path.join(opts.out, REVIEWS_FIXTURE_FILE));
  const { reports, confirmed, runRows } = readJson(fsImpl, path.join(opts.out, REPORTS_FILE));
  const firstUserArm = manifest.arms.find((a) => !isControlArm(a.name)) || manifest.arms[0];
  const reference = opts.reference !== undefined ? opts.reference : firstUserArm && firstUserArm.name;
  if (!manifest.arms.some((a) => a.name === reference)) {
    deps.err(`review-replay.js: --reference: no arm "${reference}" (arms: ${manifest.arms.map((a) => a.name).join(', ')})`);
    return 2;
  }

  const { slots, unidentified, costs, efforts, unidentifiedCost } = replaySlots(fsImpl, opts.transcripts, manifest.arms);
  const arms = {};
  // Per arm, per prompt name: its lens and the rows of each scored repeat, for vsReference.
  const rowsByArm = {};
  for (const arm of manifest.arms) {
    const lenses = {};
    for (const p of arm.prompts) if (!lenses[p.lens]) lenses[p.lens] = lensEntry(arm, reference);
    arms[arm.name] = { scored: 0, notJudged: 0, notJudgedByReason: {}, lenses, cost: emptyCost(), minutes: 0, recordedEffort: {}, effortFieldsDiffer: 0 };
    rowsByArm[arm.name] = new Map();
  }
  for (const { arm, cost } of costs) addCost(arms[arm].cost, cost);
  for (const { arm, effort, fieldsDiffer } of efforts) {
    bump(arms[arm].recordedEffort, effort);
    if (fieldsDiffer) arms[arm].effortFieldsDiffer += 1;
  }

  for (const slot of slots.values()) {
    const a = arms[slot.arm.name];
    const { prompt } = slot;
    const text = typeof slot.reply === 'string' ? stripTree(slot.reply, prompt.repo) : null;
    let reason = null;
    let counts = null;
    if (text === null) reason = slot.noReply;
    // An arm that sets an effort is only scored from reviewers whose every turn recorded exactly that effort.
    else if (slot.arm.effort !== null && slot.efforts.some((e) => e !== slot.arm.effort)) reason = 'effort-mismatch';
    else if ((counts = parseLensReport(text)) === null) reason = 'could-not-parse';
    if (reason !== null) {
      a.notJudged += 1;
      bump(a.notJudgedByReason, reason);
      continue;
    }
    const report = reports[prompt.name];
    if (!report) throw new Error(`${REPORTS_FILE}: no archived report for ${prompt.name}`);
    const set = confirmed[report.unitKey] && confirmed[report.unitKey][prompt.lens];
    if (!set) throw new Error(`${REPORTS_FILE}: no confirmed set for ${report.unitKey} lens ${prompt.lens}`);
    const parsed = parseFindings(text);
    const rows = parsed ? parsed.rows : [];
    const L = a.lenses[prompt.lens];
    a.scored += 1;
    L.reviews += 1;
    for (const k of COUNT_KEYS) L.rowsBySeverity[k] += counts[k];
    if (set.confirmedSource === 'missing') {
      L.confirmedMissingSource += 1;
    } else {
      const caught = caughtBy(set.findings, rows);
      L.confirmed.caught += caught;
      L.confirmed.of += set.findings.length;
      L.confirmed.unlocated += set.unlocated;
      if (L.byRepeat) {
        L.byRepeat[slot.repeat].caught += caught;
        L.byRepeat[slot.repeat].of += set.findings.length;
      }
    }
    L.archived.caught += caughtBy(report.rows, rows);
    L.archived.of += report.rows.length;
    const runArchived = runRows[prompt.run] || [];
    L.new += rows.filter((r) => !runArchived.some((x) => near(r, x.path, x.line))).length;
    const own = rowsByArm[slot.arm.name];
    if (!own.has(prompt.name)) own.set(prompt.name, { lens: prompt.lens, repeats: [] });
    own.get(prompt.name).repeats.push(rows);
  }

  // Repeats are samples of one reviewer, so every repeat of this arm is paired with every repeat of the reference.
  const ref = rowsByArm[reference];
  for (const arm of manifest.arms) {
    if (arm.name === reference) continue;
    for (const [name, mine] of rowsByArm[arm.name]) {
      const v = arms[arm.name].lenses[mine.lens].vsReference;
      const theirs = ref.has(name) ? ref.get(name).repeats : [];
      for (const rows of mine.repeats) {
        for (const refRows of theirs) {
          v.of += refRows.length;
          v.raised += caughtBy(refRows, rows);
        }
      }
    }
  }

  const fidelity = {};
  for (const arm of manifest.arms) {
    if (!isControlArm(arm.name)) continue;
    for (const [lens, L] of Object.entries(arms[arm.name].lenses)) {
      const f = fidelity[lens] || (fidelity[lens] = { caught: 0, of: 0 });
      f.caught += L.archived.caught;
      f.of += L.archived.of;
    }
  }
  for (const f of Object.values(fidelity)) f.share = share(f.caught, f.of);
  for (const a of Object.values(arms)) {
    a.minutes = Math.round(a.cost.seconds / 60);
    for (const [lens, L] of Object.entries(a.lenses)) L.fidelity = fidelity[lens] ? { ...fidelity[lens] } : null;
  }

  deps.log(JSON.stringify({
    notes: NOTES, reference, fixture: { byLens: fixtureByLens(fixture) }, fidelity, unidentifiedAgents: unidentified, unidentifiedCost, arms,
  }, null, 2));
  return Object.values(arms).some((a) => a.notJudged > 0) ? EXIT_NOT_CLEAN : 0;
}

module.exports = { scoreReviews, NOTES };
