'use strict';
// tools/pipeline-cost-report/reviews.js — the review-results readers of the cost report (#5925).
//
// This first slice holds three pure text parsers over a subagent's final report. Each returns null only for "could not
// parse" (a crash message, a report of another shape) and a zero-count result for "parsed, nothing found", so an
// unreadable report is counted `unparsed` by its caller and never reads as a clean one. The formats, as the build saw them:
//
//   Task review verdict (parseTaskVerdict), bold or unbolded, a trailing clause allowed:
//     **Task quality:** Needs fixes
//     Task quality: Approved
//   its items sit under `#### Critical (Must Fix)` / `#### Important (Should Fix)` / `#### Minor (Nice to Have)`
//   (counted by guards.js's parseReviewCounts). A fix-round report has `**Fix round:** …` and no `Task quality` line: null.
//
//   Plan review (parsePlanReview), a table whose Class column names the kind; `missing-review-risk` is spelled with
//   hyphens in a real report, an overflow row carries `+N more`, and a clean review is the bare sentence `No findings.`:
//     | Severity | Class | Resolution | Path:Line | Finding | Evidence | Suggested resolution |
//     | medium | missing-review-risk | — | docs/superpowers/plans/….md:148 | … | … | … |
//     | info | — | — | — | +2 more | — | — |
//
//   Lens report (parseLensReport), a four-column table, a `+N more` overflow row, or an opening `No findings` that may
//   continue in prose with no row (`No findings on the error-handling lens.`) or follow a prose paragraph:
//     | Severity | Path:Line | Finding | Evidence |
//     | medium | plugin/bin/lib/run-manifest/write.js:27 | … | … |
//
// A multi-spec member's timing.json is a stub with no dispatches: {"dispatches":{"notFound":"no transcript resolved"}},
// so the dispatch figures are read from the parent's timing.json and only the decisions.md files are read per member.
//
// The run walk (walkRuns), the task-review and plan-review collectors and the human-stop count read the run's
// timing.json, decisions.md and the subagents' transcripts, read-only. A human stop is a decisions.md line of either form:
//   - KEPT-PROMPT 08:28:18 — Common Step 1.6 (plan review): plan review: 2 needs-human spec gap(s) asked inline. Reversibility: n/a.
//   - REFUSED 00:38:24 — Common Step 1.6 (plan review): plan review: 1 needs-human spec gap (…) — dispatched call cannot
//     ask; question posted as issuecomment-6903297698; HARD-GATE plan-review-needs-human; …. Reversibility: n/a.
// A line saying the gap was settled (`1 needs-human spec gap settled in a converged round`) is not one.

const fs = require('fs');
const path = require('path');
const { resolveRun, readTiming, readReport, parseReviewCounts } = require('./guards.js');
const { readRun } = require('../review-replay/archive.js');

const SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'];
const PLAN_KINDS = ['cross-task contract', 'undecided behaviour', 'spec gap', 'missing review risk'];

const VERDICT_RE = /^\s*(?:\*\*)?Task quality:?(?:\*\*)?:?\s*(?:\*\*)?\s*(Approved|Needs fixes)\b/im;
const NO_FINDINGS_RE = /^[\s*_`>#-]*No findings?\b/im;
const OVERFLOW_RE = /^\+(\d+) more\b/;

// 'approved' | 'needs-fixes', or null when the report holds no `Task quality` verdict line.
function parseTaskVerdict(text) {
  const m = VERDICT_RE.exec(String(text));
  if (!m) return null;
  return m[1].toLowerCase() === 'approved' ? 'approved' : 'needs-fixes';
}

// The cells of a `|`-row (first and last pieces dropped, `*` and backticks removed), or null for a non-row line.
function cellsOf(line) {
  const trimmed = line.trim();
  if (!trimmed.startsWith('|')) return null;
  return trimmed
    .split('|')
    .slice(1, -1)
    .map((c) => c.replace(/[*`]/g, '').trim());
}

const overflowOf = (cells) => {
  for (const c of cells) {
    const m = OVERFLOW_RE.exec(c);
    if (m) return Number(m[1]);
  }
  return null;
};

// Case, hyphens, underscores and the US spelling `behavior` are folded before the kind is looked up.
const foldKind = (s) => s.toLowerCase().replace(/behavior/g, 'behaviour').replace(/[-_\s]+/g, ' ').trim();
const KIND_BY_FOLDED = new Map(PLAN_KINDS.map((k) => [foldKind(k), k]));

// { findings, byKind } | null. `findings` is the table's rows plus every `+N more` overflow count; the overflow rows'
// kind is unknown, so they land in `other` with every row whose Class is not one of PLAN_KINDS. A finding row is a row
// after the `Severity` header whose first cell is a severity word; the table ends at the first non-`|` line, so a later
// table is not read. A header with no row after it is null unless the text states `No findings`.
function parsePlanReview(text) {
  const byKind = { other: 0 };
  for (const k of PLAN_KINDS) byKind[k] = 0;
  let findings = 0;
  let classCol = -1;
  let header = false;
  let rows = false;
  for (const line of String(text).split(/\r?\n/)) {
    const cells = cellsOf(line);
    if (!cells) {
      if (header) break;
      continue;
    }
    if (!header) {
      if (cells[0] && cells[0].toLowerCase() === 'severity') {
        header = true;
        classCol = cells.findIndex((c) => c.toLowerCase() === 'class');
      }
      continue;
    }
    const more = overflowOf(cells);
    if (more !== null) {
      findings += more;
      byKind.other += more;
      rows = true;
      continue;
    }
    if (!SEVERITIES.includes((cells[0] || '').toLowerCase())) continue;
    findings += 1;
    rows = true;
    const kind = classCol >= 0 ? KIND_BY_FOLDED.get(foldKind(cells[classCol] || '')) : undefined;
    byKind[kind || 'other'] += 1;
  }
  if (rows) return { findings, byKind };
  if (NO_FINDINGS_RE.test(String(text))) return { findings: 0, byKind };
  return null;
}

// { critical, high, medium, low, info, overflow } | null. The finding table starts at the `| Severity | …` header row and
// ends at the first non-`|` line after it, so a later table is not read. A finding row is a row whose first cell is a
// severity word; a row with a `+N more` cell adds N to `overflow` and is never counted as a finding. Rows win over a
// `No findings` opening; with no finding row (no header, or a header and nothing after it, as in a reply cut off) the
// report is parsed only when it states `No findings`, else null.
function parseLensReport(text) {
  const counts = { critical: 0, high: 0, medium: 0, low: 0, info: 0, overflow: 0 };
  let header = false;
  let rows = false;
  for (const line of String(text).split(/\r?\n/)) {
    const cells = cellsOf(line);
    if (!cells) {
      if (header) break;
      continue;
    }
    if (!header) {
      if (cells[0] && cells[0].toLowerCase() === 'severity') header = true;
      continue;
    }
    const more = overflowOf(cells);
    if (more !== null) {
      counts.overflow += more;
      rows = true;
      continue;
    }
    const first = (cells[0] || '').toLowerCase();
    if (SEVERITIES.includes(first)) {
      counts[first] += 1;
      rows = true;
    }
  }
  if (rows || NO_FINDINGS_RE.test(String(text))) return counts;
  return null;
}

const MEMBER_RE = /^spec-(\d+)$/;

function exists(file, fsImpl) {
  try {
    fsImpl.statSync(file);
    return true;
  } catch {
    return false;
  }
}

// The spec-{N} member directories of a run directory; empty when it cannot be read.
function membersOf(dir, fsImpl) {
  const members = [];
  try {
    for (const e of fsImpl.readdirSync(dir, { withFileTypes: true })) {
      const m = MEMBER_RE.exec(e.name);
      if (m && e.isDirectory()) members.push({ id: Number(m[1]), dir: path.join(dir, e.name) });
    }
  } catch {
    // An unreadable directory has no members.
  }
  return members;
}

// The units a run's decisions are read from: its members, else the run itself. A resolved top-level run with no
// decisions.md whose archive/{name} copy holds one (a copy with no timing.json, which resolveRun leaves unresolved)
// is read from that copy.
function unitsOf(run, fsImpl) {
  let { dir, members } = run;
  const archived = path.join(path.dirname(run.dir), 'archive', run.name);
  if (!run.archived && members.length === 0 && archived !== dir && !exists(path.join(dir, 'decisions.md'), fsImpl) && exists(path.join(archived, 'decisions.md'), fsImpl)) {
    dir = archived;
    members = membersOf(archived, fsImpl);
  }
  if (members.length > 0) return members.map((m) => ({ name: `${run.name}/spec-${m.id}`, dir: m.dir }));
  return [{ name: run.name, dir }];
}

// Walked[]: the runs dated since..until (inclusive; a null bound is open), each through resolveRun, sorted by date then
// name. A run keeps its place when its timing.json is absent ('missing') or unusable ('unparsed'), with no items. An
// agentId already seen in an earlier run of the walk, or earlier in the same file, is dropped.
function walkRuns(runs, { since, until, fsImpl = fs } = {}) {
  const inWindow = runs.filter((r) => (since == null || r.date >= since) && (until == null || r.date <= until));
  const resolved = inWindow.map((r) => resolveRun(r, fsImpl));
  resolved.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const seen = new Set();
  return resolved.map((run) => {
    let timing = 'ok';
    let items = [];
    let sessions = [];
    try {
      const read = readTiming(run.dir, fsImpl);
      if (read === null) timing = 'missing';
      else {
        sessions = read.sessions;
        items = read.items.filter((d) => {
          if (!d || d.agentId == null) return true;
          if (seen.has(d.agentId)) return false;
          seen.add(d.agentId);
          return true;
        });
      }
    } catch {
      timing = 'unparsed';
    }
    return { run, items, sessions, timing, units: unitsOf(run, fsImpl) };
  });
}

// One unit's decisions.md: its text (null when unreadable) and the locations the lens review confirmed, refuted or
// could not judge. All three lists are empty when readRun excludes the unit.
function readVerdicts(unit, fsImpl = fs) {
  const noGit = () => {
    throw new Error('reviews reads no git');
  };
  const read = readRun(unit.dir, { fs: fsImpl, git: noGit });
  let text = null;
  try {
    text = fsImpl.readFileSync(path.join(unit.dir, 'decisions.md'), 'utf8');
  } catch {
    text = null;
  }
  const out = { name: unit.name, excluded: read.excluded, text, confirmed: [], refuted: [], cantTell: [] };
  if (read.excluded) return out;
  out.confirmed = [
    ...read.pairConfirmed.map((p) => ({ lens: p.lens, path: p.path, line: p.line, how: 'pair' })),
    ...read.verdicts.filter((v) => v.verdict === 'confirmed').map((v) => ({ lens: v.lens, path: v.path, line: v.line, how: 'tiebreak' })),
  ];
  out.refuted = read.verdicts.filter((v) => v.verdict === 'refuted');
  out.cantTell = read.verdicts.filter((v) => v.verdict === 'cant-tell');
  return out;
}

const HUMAN_STOP_KEPT_RE = /^- KEPT-PROMPT\b.*\bCommon Step 1\.6\b.*\bneeds-human\b/;
const HUMAN_STOP_GATED_RE = /^- [A-Z][A-Z-]*\b.*\bCommon Step 1\.6\b.*\bneeds-human\b.*(?:HARD-GATE|question (?:comment )?posted)/;

// A decisions.md line recording that plan review stopped to ask a human (or, dispatched, posted the question).
const isHumanStop = (line) => HUMAN_STOP_KEPT_RE.test(line) || HUMAN_STOP_GATED_RE.test(line);

const share = (part, whole) => (whole ? part / whole : null);

// The report of one dispatch, or null when no transcript holds one.
const reportOf = (walked, d, roots, fsImpl) => readReport({ roots, sessions: walked.sessions, agentId: d.agentId }, fsImpl);

// Task reviews by model tier. A report with no verdict line, or no transcript, is `unparsed` and in neither share.
// `items` sums the Critical/Important/Minor items of the needs-fixes reports whose items parsed; `minorOnly` is the
// count of those with no Critical or Important item. Re-reviews are only counted, by tier.
function collectTaskReview(walkedRuns, { roots, fsImpl = fs } = {}) {
  const tiers = {};
  const reReviews = { n: 0, byTier: {} };
  for (const w of walkedRuns) {
    for (const d of w.items) {
      if (!d) continue;
      const tier = d.tier || 'unknown';
      if (d.role === 're-review') {
        reReviews.n += 1;
        reReviews.byTier[tier] = (reReviews.byTier[tier] || 0) + 1;
        continue;
      }
      if (d.role !== 'task review') continue;
      if (!tiers[tier]) tiers[tier] = { n: 0, unparsed: 0, approved: 0, needsFixes: 0, critical: 0, important: 0, minor: 0, itemsN: 0, itemsUnparsed: 0, minorOnly: 0 };
      const t = tiers[tier];
      const text = reportOf(w, d, roots, fsImpl);
      const verdict = text == null ? null : parseTaskVerdict(text);
      if (!verdict) {
        t.unparsed += 1;
        continue;
      }
      t.n += 1;
      if (verdict === 'approved') {
        t.approved += 1;
        continue;
      }
      t.needsFixes += 1;
      const counts = parseReviewCounts(text);
      if (!counts) {
        t.itemsUnparsed += 1;
        continue;
      }
      t.itemsN += 1;
      t.critical += counts.critical;
      t.important += counts.important;
      t.minor += counts.minor;
      if (counts.critical + counts.important === 0) t.minorOnly += 1;
    }
  }
  const byTier = {};
  for (const [tier, t] of Object.entries(tiers)) {
    byTier[tier] = {
      n: t.n,
      unparsed: t.unparsed,
      approved: share(t.approved, t.n),
      needsFixes: share(t.needsFixes, t.n),
      items: { critical: t.critical, important: t.important, minor: t.minor, n: t.itemsN, unparsed: t.itemsUnparsed },
      minorOnly: { count: t.minorOnly, of: t.itemsN, share: share(t.minorOnly, t.itemsN) },
    };
  }
  return { byTier, reReviews };
}

// Plan reviews: the parsed reports, the share with a finding, findings per review and by kind, and the runs whose
// decisions.md records a human stop. `verdictsByRun[i]` holds readVerdicts for each unit of walkedRuns[i]; a unit whose
// decisions.md cannot be read is `unparsed`, and `n` counts the units that could be.
function collectPlanReview(walkedRuns, verdictsByRun, { roots, fsImpl = fs } = {}) {
  let n = 0;
  let unparsed = 0;
  let withFindings = 0;
  let findings = 0;
  const byKind = { other: 0 };
  for (const k of PLAN_KINDS) byKind[k] = 0;
  for (const w of walkedRuns) {
    for (const d of w.items) {
      if (!d || d.role !== 'plan review') continue;
      const text = reportOf(w, d, roots, fsImpl);
      const parsed = text == null ? null : parsePlanReview(text);
      if (!parsed) {
        unparsed += 1;
        continue;
      }
      n += 1;
      findings += parsed.findings;
      if (parsed.findings > 0) withFindings += 1;
      for (const [k, v] of Object.entries(parsed.byKind)) byKind[k] += v;
    }
  }
  const stops = { runs: 0, n: 0, unparsed: 0 };
  for (const units of verdictsByRun) {
    for (const v of units) {
      if (v.text == null) {
        stops.unparsed += 1;
        continue;
      }
      stops.n += 1;
      if (v.text.split(/\r?\n/).some(isHumanStop)) stops.runs += 1;
    }
  }
  return { reviews: n, n, unparsed, withFindings: share(withFindings, n), findingsPerReview: share(findings, n), byKind, humanStops: stops };
}

// The reviews section over the since..until window: the run walk is done once and the decisions.md files are read once
// for every collector. `n` (the yield's slot count) is used by the yield walk, not here.
function collectReviews({ runs, since, until, roots }, { fsImpl = fs } = {}) {
  const walked = walkRuns(runs, { since, until, fsImpl });
  const verdictsByRun = walked.map((w) => w.units.map((u) => readVerdicts(u, fsImpl)));
  return {
    window: {
      since,
      until,
      runs: walked.length,
      units: walked.reduce((s, w) => s + w.units.length, 0),
      noTiming: walked.filter((w) => w.timing === 'missing').length,
      timingUnparsed: walked.filter((w) => w.timing === 'unparsed').length,
    },
    taskReview: collectTaskReview(walked, { roots, fsImpl }),
    planReview: collectPlanReview(walked, verdictsByRun, { roots, fsImpl }),
  };
}

module.exports = { SEVERITIES, PLAN_KINDS, parseTaskVerdict, parsePlanReview, parseLensReport, walkRuns, readVerdicts, isHumanStop, collectTaskReview, collectPlanReview, collectReviews };
