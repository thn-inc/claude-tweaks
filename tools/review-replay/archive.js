'use strict';
// tools/review-replay/archive.js — reads an archived review run: the verdict lines in decisions.md, the findings
// artifact, the fix commit the review head derives from, the recorded base and the agent cost in timing.json.

const path = require('path');

const SPLIT = /\r?\n/;
const CONSOLE_ITEM = /Console item/;
const LOCATION = '"([^"]+)" finding (\\S+):(\\d+)';
const TIEBREAK_ID = /\bTiebreak tiebreak:([0-9a-f]{12}):/;
const PAIR_RE = new RegExp(`Reproduction: lens ${LOCATION} reproduced\\b`);
const NOT_REPRODUCED_RE = new RegExp(`lens ${LOCATION} not reproduced`);
const CONFIRMED_RE = new RegExp(`lens ${LOCATION} confirmed by tiebreak(?::([0-9a-f]{12}))?`);
const REFUTED_RE = new RegExp(`lens ${LOCATION} dropped: refuted by tiebreak`);
const DIGESTED_RE = new RegExp(`Tiebreak tiebreak:([0-9a-f]{12}): lens ${LOCATION} (?:digested|console): (\\S+)`);
const FIX_COMMIT_RE = /Step 3 Routing: applied .*\(commit ([0-9a-f]{7,40})\)/;
const CANT_TELL_REASONS = new Set(['verdict:cant-tell', 'evidence-unverified']);

// decisions.md text -> the verdict lines, failed-judge lines, reproduced pairs, fix commits and whether a review ran.
function parseDecisions(text) {
  const out = { verdicts: [], failedJudges: [], pairConfirmed: [], fixCommits: [], hasReview: false };
  for (const line of String(text).split(SPLIT)) {
    const fix = FIX_COMMIT_RE.exec(line);
    if (fix) out.fixCommits.push(fix[1]);
    if (CONSOLE_ITEM.test(line)) continue;
    const idOf = (m) => (m ? m[1] : null);
    let m;
    if ((m = PAIR_RE.exec(line))) {
      out.pairConfirmed.push({ lens: m[1], path: m[2], line: Number(m[3]) });
      out.hasReview = true;
    } else if (NOT_REPRODUCED_RE.test(line)) {
      out.hasReview = true;
    } else if ((m = CONFIRMED_RE.exec(line))) {
      out.verdicts.push({ id: m[4] || null, lens: m[1], path: m[2], line: Number(m[3]), verdict: 'confirmed' });
      out.hasReview = true;
    } else if ((m = REFUTED_RE.exec(line))) {
      out.verdicts.push({ id: idOf(TIEBREAK_ID.exec(line)), lens: m[1], path: m[2], line: Number(m[3]), verdict: 'refuted' });
      out.hasReview = true;
    } else if ((m = DIGESTED_RE.exec(line))) {
      const reason = m[5].replace(/[.,;]+$/, '');
      const entry = { id: m[1], lens: m[2], path: m[3], line: Number(m[4]) };
      if (CANT_TELL_REASONS.has(reason)) {
        out.verdicts.push({ ...entry, verdict: 'cant-tell' });
        out.hasReview = true;
      } else {
        out.failedJudges.push({ ...entry, reason });
      }
    }
  }
  return out;
}

const sameLocation = (a, b) => a.lens === b.lens && a.path === b.path && a.line === b.line;

// Pairs the review-findings.json findings with the verdict lines: by id first, then (for a verdict line carrying no
// id, or an id no finding has) by lens/path/line. A finding with no verdict but a failed-judge line is counted under
// the failed judge's reason, not as a finding without a verdict.
function matchVerdicts(findings, verdicts, failedJudges = []) {
  const ids = new Set(findings.map((f) => f.id));
  const used = new Set();
  const byId = new Map();
  const unmatched = [];
  for (const f of findings) {
    const hits = verdicts.filter((v) => v.id === f.id);
    if (hits.length === 0) {
      unmatched.push(f);
      continue;
    }
    hits.forEach((v) => used.add(v));
    byId.set(f.id, hits[hits.length - 1].verdict);
  }
  let fallbackMatched = 0;
  const stillUnmatched = [];
  for (const f of unmatched) {
    const hits = verdicts.filter((v) => !used.has(v) && (v.id === null || !ids.has(v.id)) && sameLocation(v, f));
    if (hits.length === 0) {
      stillUnmatched.push(f);
      continue;
    }
    hits.forEach((v) => used.add(v));
    byId.set(f.id, hits[hits.length - 1].verdict);
    fallbackMatched += 1;
  }
  const failedJudgeByReason = {};
  const failedJudgeIds = new Set();
  let findingsWithoutVerdict = 0;
  for (const f of stillUnmatched) {
    const byFindingId = failedJudges.filter((j) => j.id === f.id);
    const hits = byFindingId.length > 0 ? byFindingId : failedJudges.filter((j) => (j.id === null || !ids.has(j.id)) && sameLocation(j, f));
    if (hits.length === 0) {
      findingsWithoutVerdict += 1;
      continue;
    }
    const reason = hits[hits.length - 1].reason;
    failedJudgeByReason[reason] = (failedJudgeByReason[reason] || 0) + 1;
    failedJudgeIds.add(f.id);
  }
  return { byId, fallbackMatched, verdictsWithoutFinding: verdicts.length - used.size, findingsWithoutVerdict, failedJudgeByReason, failedJudgeIds };
}

function readText(deps, file) {
  return deps.fs.readFileSync(file, 'utf8');
}

function readJson(deps, file) {
  try {
    return JSON.parse(readText(deps, file));
  } catch {
    return null;
  }
}

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const sum = (items, pick) => items.reduce((s, x) => s + pick(x), 0);
const LENS_RE = /^(?:Review )?[Ll]ens (3[a-j])/;
const SIDE_RE = /\b(?:agent |reviewer )?\(?([AB])\)?\s*$/;
const TIEBREAK_DESC_RE = /^Tiebreak/i;

// timing.json -> the lens agents and the tiebreak cost; null when the file cannot be read.
function readCost(deps, dir) {
  const timing = readJson(deps, path.join(dir, 'timing.json'));
  const items = timing && timing.dispatches && Array.isArray(timing.dispatches.items) ? timing.dispatches.items : null;
  if (!items) return null;
  const tokens = (x) => x.tokens || {};
  const lensAgents = [];
  const tiebreaks = [];
  for (const x of items) {
    const desc = String(x.description || '');
    const lens = LENS_RE.exec(desc);
    if (lens) {
      const side = SIDE_RE.exec(desc);
      lensAgents.push({ agentId: x.agentId || null, lens: lens[1], side: side ? side[1] : null, out: num(tokens(x).output), cc: num(tokens(x).cacheCreate) });
    } else if (TIEBREAK_DESC_RE.test(desc)) {
      tiebreaks.push({ out: num(tokens(x).output), cc: num(tokens(x).cacheCreate), cr: num(tokens(x).cacheRead), ms: num(x.wallClockMs) });
    }
  }
  return {
    lensAgents,
    cost: {
      lensAgents: lensAgents.length,
      tiebreakAgents: tiebreaks.length,
      lensOut: sum(lensAgents, (a) => a.out),
      lensCc: sum(lensAgents, (a) => a.cc),
      tbOut: sum(tiebreaks, (t) => t.out),
      tbCc: sum(tiebreaks, (t) => t.cc),
      tbCr: sum(tiebreaks, (t) => t.cr),
      tbSeconds: Math.round(sum(tiebreaks, (t) => t.ms) / 1000),
    },
  };
}

const EMPTY_COST = { lensAgents: 0, tiebreakAgents: 0, lensOut: 0, lensCc: 0, tbOut: 0, tbCc: 0, tbCr: 0, tbSeconds: 0 };

function readFindings(deps, dir) {
  const raw = readJson(deps, path.join(dir, 'review-findings.json'));
  if (!Array.isArray(raw)) return null;
  return raw.map((f) => ({
    id: f.id, lens: f.lens, path: f.path, line: f.line, claim: f.claim,
    severity: f.reporterSeverity == null ? 'unknown' : f.reporterSeverity, kind: f.kind,
  }));
}

// The review head: the parent of the earliest fix commit the clone knows. { head, why }.
function resolveHead(deps, fixCommits) {
  if (fixCommits.length === 0) return { head: null, why: 'no-fix-commit' };
  const known = [];
  for (const c of fixCommits) {
    try {
      const ts = Number(String(deps.git(['log', '-1', '--format=%ct', c])).trim());
      if (ts > 0) known.push({ ts, c });
    } catch {
      // a commit the clone does not know is not a candidate
    }
  }
  if (known.length === 0) return { head: null, why: 'fix-commit-not-in-clone' };
  known.sort((a, b) => a.ts - b.ts);
  try {
    return { head: String(deps.git(['rev-parse', `${known[0].c}^`])).trim(), why: null };
  } catch {
    return { head: null, why: 'fix-commit-not-in-clone' };
  }
}

function resolveBase(deps, dir) {
  const manifest = readJson(deps, path.join(dir, 'packet-inputs', 'manifest.json'));
  if (manifest && manifest.mergeBase) return manifest.mergeBase;
  const pack = readJson(deps, path.join(dir, 'wrap-up-pack.json'));
  return pack && pack.inputs && pack.inputs.base ? pack.inputs.base : null;
}

function readSpecFiles(deps, dir) {
  try {
    return deps.fs.readdirSync(path.join(dir, 'work')).filter((n) => n.endsWith('.md')).sort().map((n) => `work/${n}`);
  } catch {
    return [];
  }
}

// One archived run directory -> everything the replay and the baseline need from it. A run that cannot be replayed
// carries `excluded` (a reason string); `why` lists what is missing without excluding the run.
function readRun(dir, deps) {
  const base = {
    run: path.basename(dir), dir, excluded: null, why: [], findings: null, verdicts: [], failedJudges: [], pairConfirmed: [],
    head: null, base: null, dispatchBundle: null, lensAgents: [], cost: { ...EMPTY_COST }, specFiles: [],
  };
  let text;
  try {
    text = readText(deps, path.join(dir, 'decisions.md'));
  } catch (e) {
    return { ...base, excluded: e && e.code === 'ENOENT' ? 'no-decisions' : 'decisions-unreadable' };
  }
  const parsed = parseDecisions(text);
  const { fixCommits, hasReview, ...lines } = parsed;
  if (!hasReview) return { ...base, ...lines, excluded: 'no-review' };
  const why = [];
  const { head, why: headWhy } = resolveHead(deps, fixCommits);
  if (headWhy) why.push(headWhy);
  const recordedBase = resolveBase(deps, dir);
  if (!recordedBase) why.push('no-recorded-base');
  const timing = readCost(deps, dir);
  if (!timing) why.push('no-timing');
  let dispatchBundle = null;
  try {
    dispatchBundle = readText(deps, path.join(dir, 'context', 'review-dispatch.md'));
  } catch {
    dispatchBundle = null;
  }
  return {
    ...base, ...lines, why, findings: readFindings(deps, dir), head, base: recordedBase, dispatchBundle,
    lensAgents: timing ? timing.lensAgents : [], cost: timing ? timing.cost : { ...EMPTY_COST }, specFiles: readSpecFiles(deps, dir),
  };
}

// Run directories directly under `root` and under `root/archive`, sorted by basename.
function listRuns(root, fs) {
  const dirs = [];
  const collect = (parent, skipArchive) => {
    let entries;
    try {
      entries = fs.readdirSync(parent, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) if (e.isDirectory() && !(skipArchive && e.name === 'archive')) dirs.push(path.join(parent, e.name));
  };
  collect(root, true);
  collect(path.join(root, 'archive'), false);
  return dirs.sort((a, b) => path.basename(a).localeCompare(path.basename(b)));
}

module.exports = { parseDecisions, matchVerdicts, readRun, listRuns };
