'use strict';
// tools/review-replay/reviews-score.js — scores every replayed lens reviewer's reply, per arm and lens: the run's
// confirmed findings it raised (recall, per slot and summed, first passes apart from re-reviews), the archived reviewer's own rows it raised, the rows no
// archived reviewer of that run raised (`new`), and the reference arm's rows it also raised; the control arms' recall of
// the archived rows is each lens's `fidelity`. Agents are identified and costed as score.js does. A reply that is
// missing, recorded at another effort than its arm's, or not a lens report is notJudged, never a found-nothing review.

const path = require('path');
const { bump } = require('./util.js');
const { replaySlots, readJson, stripTree, emptyCost, addCost } = require('./score.js');
const { parseFindings, near } = require('./counterfactual.js');
const { parseLensReport, parseTaskVerdict, SEVERITIES, locationMatches } = require('../pipeline-cost-report/reviews.js');
const { walkReviewItems } = require('../pipeline-cost-report/guards.js');
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
    // Severity rows with no `path:line`: they cannot raise a finding, so a recall of 0 beside them is not found-nothing.
    rowsUnlocated: 0,
    // First passes only (slot ordinal 1 for its unit, lens and side); a later slot re-reviews a later head, where the
    // confirmed findings may already be fixed, so it is tallied apart in confirmedRereview.
    confirmed: { caught: 0, of: 0, unlocated: 0 },
    confirmedRereview: { caught: 0, of: 0, unlocated: 0 },
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
  if (BRANCH_SCORERS[fixture.role]) return scoreBranchReviews(opts, deps, manifest, fixture);
  const ordinals = new Map(fixture.slots.map((s) => [s.name, s.ordinal]));
  const { reports, confirmed, runRows } = readJson(fsImpl, path.join(opts.out, REPORTS_FILE));
  const firstUserArm = manifest.arms.find((a) => !isControlArm(a.name)) || manifest.arms[0];
  const reference = opts.reference !== undefined ? opts.reference : firstUserArm && firstUserArm.name;
  if (!manifest.arms.some((a) => a.name === reference)) {
    deps.err(`review-replay.js: --reference: no arm "${reference}" (arms: ${manifest.arms.map((a) => a.name).join(', ')})`);
    return 2;
  }

  const { mergeUsage } = require(path.join(deps.pluginRoot, 'bin', 'lib', 'timing', 'transcript.js'));
  const { slots, unidentified, costs, efforts, unidentifiedCost } = replaySlots(fsImpl, opts.transcripts, manifest.arms, mergeUsage);
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
    const ordinal = ordinals.get(prompt.name);
    if (!Number.isInteger(ordinal)) throw new Error(`${REVIEWS_FIXTURE_FILE}: no slot ordinal for ${prompt.name}`);
    const parsed = parseFindings(text);
    const rows = parsed ? parsed.rows : [];
    const L = a.lenses[prompt.lens];
    a.scored += 1;
    L.reviews += 1;
    for (const k of COUNT_KEYS) L.rowsBySeverity[k] += counts[k];
    L.rowsUnlocated += parsed ? parsed.skipped : SEVERITIES.reduce((n, k) => n + counts[k], 0);
    if (set.confirmedSource === 'missing') {
      L.confirmedMissingSource += 1;
    } else {
      const caught = caughtBy(set.findings, rows);
      const tally = ordinal === 1 ? L.confirmed : L.confirmedRereview;
      tally.caught += caught;
      tally.of += set.findings.length;
      tally.unlocated += set.unlocated;
      if (L.byRepeat && ordinal === 1) {
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

// ---- Branch roles: one scorer per role over a shared prelude. A scorer is { key, init(), judge(text), tally(entry, ctx) }:
// `judge` parses a replay reply (null = could-not-parse); `tally` folds one judged review into the arm's `key` section.
const BRANCH_NOTES = [
  'Recall is measured against the archived reviewer\'s own items: it rewards an arm that behaves like the archive, not one that is right.',
  'A clean repository holds two commits, so git log and git blame differ from the archived review.',
];
const CI = ['critical', 'important'];
const sevCounts = () => ({ critical: 0, important: 0, minor: 0 });
const perReview = (counts, n) => Object.fromEntries(Object.keys(counts).map((k) => [k, n === 0 ? null : counts[k] / n]));
// Every location of every replay item, as the rows `near` reads.
const replayRows = (items) => items.flatMap((i) => i.locations);
// An archived item is caught when any of its locations is near any replay row.
const caughtItems = (archived, rows) => archived.filter((i) => i.locations.some((l) => rows.some((r) => near(r, l.path, l.line)))).length;
const tierCounts = () => ({ agree: 0, disagree: 0 });

const TASK_SCORER = {
  key: 'task',
  init: () => ({
    reviews: 0, verdict: { agree: 0, disagree: 0, share: null, byArchivedTier: {} },
    recall: { caught: 0, of: 0, share: null, unlocated: 0, itemsUnparsed: 0, replayItemsUnparsed: 0 }, itemsBySeverity: sevCounts(), itemsPerReview: null,
  }),
  judge: (text) => readTaskReply(text),
  tally(e, { judged, report, tier }) {
    e.reviews += 1;
    const side = e.verdict.byArchivedTier[tier] || (e.verdict.byArchivedTier[tier] = tierCounts());
    const key = judged.verdict === report.verdict ? 'agree' : 'disagree';
    e.verdict[key] += 1;
    side[key] += 1;
    for (const i of judged.items) e.itemsBySeverity[i.sev] += 1;
    e.recall.unlocated += report.items.filter((i) => i.locations.length === 0).length;
    if (judged.itemsUnparsed) e.recall.replayItemsUnparsed += 1;
    if (report.itemsUnparsed) e.recall.itemsUnparsed += 1;
    if (judged.itemsUnparsed || report.itemsUnparsed) return;
    const targets = report.items.filter((i) => CI.includes(i.sev) && i.locations.length > 0);
    e.recall.of += targets.length;
    e.recall.caught += caughtItems(targets, replayRows(judged.items));
  },
  finish(e) {
    const { verdict } = e;
    verdict.share = share(verdict.agree, verdict.agree + verdict.disagree);
    for (const t of Object.values(verdict.byArchivedTier)) t.share = share(t.agree, t.agree + t.disagree);
    e.recall.share = share(e.recall.caught, e.recall.of);
    e.itemsPerReview = perReview(e.itemsBySeverity, e.reviews - e.recall.replayItemsUnparsed);
  },
};

const WHOLE_BRANCH_SCORER = {
  key: 'wholeBranch',
  init: () => ({
    reviews: 0, recall: { caught: 0, of: 0, share: null, unlocated: 0 }, itemsBySeverity: sevCounts(), itemsPerReview: null,
    withCriticalOrImportant: { n: 0, share: null },
  }),
  judge: (text) => parseBranchReply(text),
  tally(e, { judged, report }) {
    e.reviews += 1;
    for (const i of judged.items) e.itemsBySeverity[i.sev] += 1;
    if (judged.items.some((i) => CI.includes(i.sev))) e.withCriticalOrImportant.n += 1;
    const located = report.items.filter((i) => i.locations.length > 0);
    e.recall.unlocated += report.items.length - located.length;
    e.recall.of += located.length;
    e.recall.caught += caughtItems(located, replayRows(judged.items));
  },
  finish(e) {
    e.recall.share = share(e.recall.caught, e.recall.of);
    e.itemsPerReview = perReview(e.itemsBySeverity, e.reviews);
    e.withCriticalOrImportant.share = share(e.withCriticalOrImportant.n, e.reviews);
  },
};

// task-vs-branch: the whole-branch prompt replayed at the head a Needs fixes task review reviewed (`task-head`) and, as the
// control, at the whole-branch prompt's own head (`final-head`), both scored on that task review's Critical/Important items.
const ciCounts = () => ({ critical: { caught: 0, of: 0, share: null }, important: { caught: 0, of: 0, share: null } });
const addCaught = (e, sev, hit) => {
  e.of += 1;
  e.bySeverity[sev].of += 1;
  if (hit) {
    e.caught += 1;
    e.bySeverity[sev].caught += 1;
  }
};
const finishShares = (e) => {
  e.share = share(e.caught, e.of);
  for (const b of Object.values(e.bySeverity)) b.share = share(b.caught, b.of);
};

const TASK_VS_BRANCH_SCORER = {
  key: 'taskVsBranch',
  init: () => ({
    reviews: { taskHead: 0, finalHead: 0 },
    caught: { caught: 0, of: 0, share: null, unlocated: 0, bySeverity: ciCounts(), byTaskTier: {} },
    baselineRecall: { caught: 0, of: 0, share: null, bySeverity: ciCounts() },
    notRaised: [],
  }),
  judge: (text) => parseBranchReply(text),
  tally(e, { judged, report, name, repeat }) {
    const head = report.at === 'task-head';
    e.reviews[head ? 'taskHead' : 'finalHead'] += 1;
    const sink = head ? e.caught : e.baselineRecall;
    const rows = replayRows(judged.items);
    if (head) e.caught.unlocated += report.items.filter((i) => i.locations.length === 0).length;
    const tierSink = head ? (e.caught.byTaskTier[report.taskTier] || (e.caught.byTaskTier[report.taskTier] = { caught: 0, of: 0, share: null })) : null;
    for (const i of report.items.filter((it) => CI.includes(it.sev) && it.locations.length > 0)) {
      const hit = caughtItems([i], rows) === 1;
      addCaught(sink, i.sev, hit);
      if (tierSink) {
        tierSink.of += 1;
        if (hit) tierSink.caught += 1;
      }
      if (head && !hit) e.notRaised.push({ run: report.run, taskReview: name.slice(report.run.length + 1), repeat, path: i.path, line: i.line, severity: i.sev, text: i.text });
    }
  },
  finish(e) {
    finishShares(e.caught);
    finishShares(e.baselineRecall);
    for (const t of Object.values(e.caught.byTaskTier)) t.share = share(t.caught, t.of);
  },
};

const BRANCH_SCORERS = { task: TASK_SCORER, 'whole-branch': WHOLE_BRANCH_SCORER, 'task-vs-branch': TASK_VS_BRANCH_SCORER };

// The fixture's selected slots and its excluded rows, per archived tier and per reason.
function branchFixtureSummary(fixture) {
  const excludedByReason = {};
  const excludedByTier = {};
  for (const e of fixture.excluded) {
    bump(excludedByReason, e.reason);
    bump(excludedByTier, e.tier !== undefined ? e.tier : 'unknown');
  }
  if (fixture.role === 'task-vs-branch') {
    // Selected per task review (its task-head slot), by the task reviewer's tier; each has a final-head control slot.
    const heads = fixture.slots.filter((s) => s.at === 'task-head');
    const byTaskTier = {};
    for (const s of heads) bump(byTaskTier, s.taskTier);
    const { slots, notQualifying } = fixture.totals;
    return { selected: { total: heads.length, byTaskTier, slots, notQualifying }, excludedByReason, excludedByTier };
  }
  const byArchivedTier = {};
  for (const s of fixture.slots) bump(byArchivedTier, s.archivedTier);
  return { selected: { total: fixture.slots.length, byArchivedTier }, excludedByReason, excludedByTier };
}

function scoreBranchReviews(opts, deps, manifest, fixture) {
  const scorer = BRANCH_SCORERS[fixture.role];
  const { reports } = readJson(deps.fs, path.join(opts.out, REPORTS_FILE));
  const tiers = new Map(fixture.slots.map((s) => [s.name, s.archivedTier]));
  const { mergeUsage } = require(path.join(deps.pluginRoot, 'bin', 'lib', 'timing', 'transcript.js'));
  const { slots, unidentified, costs, efforts, unidentifiedCost } = replaySlots(deps.fs, opts.transcripts, manifest.arms, mergeUsage);
  const arms = {};
  for (const arm of manifest.arms) {
    arms[arm.name] = { scored: 0, notJudged: 0, notJudgedByReason: {}, cost: emptyCost(), minutes: 0, recordedEffort: {}, effortFieldsDiffer: 0, [scorer.key]: scorer.init() };
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
    let judged = null;
    if (text === null) reason = slot.noReply;
    else if (slot.arm.effort !== null && slot.efforts.some((e) => e !== slot.arm.effort)) reason = 'effort-mismatch';
    else if ((judged = scorer.judge(text)) === null) reason = 'could-not-parse';
    if (reason !== null) {
      a.notJudged += 1;
      bump(a.notJudgedByReason, reason);
      continue;
    }
    const report = reports[prompt.name];
    if (!report) throw new Error(`${REPORTS_FILE}: no archived report for ${prompt.name}`);
    a.scored += 1;
    scorer.tally(a[scorer.key], { judged, report, tier: tiers.get(prompt.name), name: prompt.name, repeat: slot.repeat });
  }
  for (const a of Object.values(arms)) {
    a.minutes = Math.round(a.cost.seconds / 60);
    scorer.finish(a[scorer.key]);
  }
  deps.log(JSON.stringify({
    notes: BRANCH_NOTES, role: fixture.role, fixture: branchFixtureSummary(fixture), unidentifiedAgents: unidentified, unidentifiedCost, arms,
  }, null, 2));
  return Object.values(arms).some((a) => a.notJudged > 0) ? EXIT_NOT_CLEAN : 0;
}

// { items } or null exactly when parseReviewCounts is null (both ride guards.js's walkReviewItems): one Item per
// counted line, each with every `path:line` in its bare text (`path`/`line` are the first, or null).
function parseReviewItems(text) {
  const walked = walkReviewItems(text);
  if (!walked) return null;
  return {
    items: walked.map(({ sev, bare }) => {
      const locations = locationMatches(bare).map((m) => ({ path: m[1], line: Number(m[2]) }));
      return {
        sev, text: bare, path: locations.length ? locations[0].path : null, line: locations.length ? locations[0].line : null, locations,
      };
    }),
  };
}

// A task-review reply, archived or replayed -> { verdict, items, itemsUnparsed }, or null when it has no verdict line.
// A reply with a verdict but no parseable items keeps its verdict: for Needs fixes its items are unknown, never none
// (itemsUnparsed); an Approved reply without severity headings has none.
function readTaskReply(text) {
  const verdict = parseTaskVerdict(text);
  if (verdict === null) return null;
  const parsed = parseReviewItems(text);
  return { verdict, items: parsed ? parsed.items : [], itemsUnparsed: parsed === null && verdict === 'needs-fixes' };
}

// A whole-branch reply: its severity headings, else an explicit "No issues" line (at the line start, after optional
// bullets or emphasis, so "no issues with naming, but …" mid-sentence is no verdict) as an empty review, else null.
function parseBranchReply(text) {
  const parsed = parseReviewItems(text);
  if (parsed) return parsed;
  return String(text).split(/\r?\n/).some((l) => /^\W*no issues\b/i.test(l)) ? { items: [] } : null;
}

module.exports = { scoreReviews, parseReviewItems, parseBranchReply, readTaskReply, NOTES };
