'use strict';
// tools/pipeline-cost-report/reviews.js — the review-results readers of the cost report (#5925).
//
// The module holds three pure text parsers over a subagent's final report, the run walk and the collectors that feed them
// the runs' timing.json, decisions.md and transcripts. Each parser returns null only for "could not
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
// The per-run verdict figures count the lens verdict lines of a unit's decisions.md (archive.js's readRun reads them):
//   - AUTO 16:08:28 — Reproduction: lens "3a" finding plugin/skills/release/disposition.md:71 reproduced. Confirmed. Reversibility: high.
//   - AUTO 16:17:17 — Reproduction: lens "3a" finding plugin/skills/_shared/release-block.md:3 confirmed by tiebreak:2a37952f7854. Confirmed. Reversibility: high.
//
// The quoted lens is free text in some runs (`lens "3b Security" finding …`): a name whose leading token is a lens id
// (3a..3j) counts under that id, any other name (`delta`) is kept verbatim as its own lens.
//
// The decisions.md routing lines (classifyRouting) say what became of a location, one class each:
//   fixed:     - AUTO 16:20:58 — Step 3 Routing: applied medium-severity security fix at plugin/skills/release/disposition.md:71. Reversibility: high (commit e4ce36e0c).
//   staged:    - STAGED 16:21:21 — Step 3 Routing: medium-severity architecture finding at plugin/skills/_shared/release-block.md:3 (lens 3a, tiebreak-confirmed): …. Stage path: staged/build-deviation-1.md. Reversibility: high.
//   deferred:  - AUTO 23:31:55 — Step 3 Routing: materiality-floor: Test quality at tests/bin-lib/wrap-up/engine-cli.test.js:707 routed below floor (tiebreak-cant-tell) → digest. Reversibility: high.
//   dismissed: - AUTO 07:05:57 — Step 3 Routing: Don't fix (refuted by tiebreak): low Architecture at plugin/bin/lib/hooks/worktree-reap.js:91 — …. Reversibility: high.
//
// A multi-spec member's timing.json is a stub with no dispatches: {"dispatches":{"notFound":"no transcript resolved"}},
// so the dispatch figures are read from the parent's timing.json and only the decisions.md files are read per member.
//
// The run walk (walkRuns), the task-review and plan-review collectors and the human-stop count read the run's
// timing.json, decisions.md and the subagents' transcripts, read-only. A human stop is a decisions.md line of one of
// three forms, all naming `Common Step 1.6` and `needs-human`:
//   - KEPT-PROMPT 08:28:18 — Common Step 1.6 (plan review): plan review: 2 needs-human spec gap(s) asked inline. Reversibility: n/a.
//   - REFUSED 00:38:24 — Common Step 1.6 (plan review): plan review: 1 needs-human spec gap (…) — dispatched call cannot
//     ask; question posted as issuecomment-6903297698; HARD-GATE plan-review-needs-human; …. Reversibility: n/a.
//   - AUTO 23:02:28 — Common Step 1.6 (plan review): plan review returned 6 rows (1 needs-human spec gap). … the
//     needs-human gate took the dispatched-call branch: question posted on the record. Reversibility: n/a.
// (any status word may open the second and third; they match on `HARD-GATE` or `question [comment ]posted`.) A line saying the gap was settled (`1 needs-human spec gap settled in a converged round`) is not one.

const fs = require('fs');
const path = require('path');
const { resolveRun, membersOf, readTiming, readReport, parseReviewCounts } = require('./guards.js');
const { readRun, readCost, LENS_ID } = require('../review-replay/archive.js');

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

function overflowOf(cells) {
  for (const c of cells) {
    const m = OVERFLOW_RE.exec(c);
    if (m) return Number(m[1]);
  }
  return null;
}

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

function exists(file, fsImpl) {
  try {
    fsImpl.statSync(file);
    return true;
  } catch {
    return false;
  }
}

// The units a run's decisions are read from: its members, else the run itself. A resolved top-level run with no
// decisions.md whose archive/{name} copy holds one (a copy with no timing.json, which resolveRun leaves unresolved)
// is read from that copy.
function unitsOf(run, fsImpl) {
  let { dir, members } = run;
  const parent = path.dirname(run.dir);
  const archived = path.join(parent, 'archive', run.name);
  // Only a run still at the top level has an archive copy to fall back to; one already under archive/ (listed there, or
  // resolved to its copy by resolveRun) would otherwise look for archive/archive/{name}.
  const topLevel = path.basename(parent) !== 'archive';
  if (topLevel && members.length === 0 && !exists(path.join(dir, 'decisions.md'), fsImpl) && exists(path.join(archived, 'decisions.md'), fsImpl)) {
    dir = archived;
    members = membersOf(archived, fsImpl);
  }
  if (members.length > 0) return members.map((m) => ({ name: `${run.name}/spec-${m.id}`, dir: m.dir }));
  return [{ name: run.name, dir }];
}

function compareStrings(a, b) {
  if (a < b) return -1;
  return a > b ? 1 : 0;
}

// Walked[]: the runs dated since..until (inclusive; a null bound is open), each through resolveRun, sorted by date then
// name. A run keeps its place when its timing.json is absent ('missing') or unusable ('unparsed'), with no items. An
// agentId already seen in an earlier run of the walk, or earlier in the same file, is dropped.
function walkRuns(runs, { since, until, fsImpl = fs } = {}) {
  const inWindow = runs.filter((r) => (since == null || r.date >= since) && (until == null || r.date <= until));
  const resolved = inWindow.map((r) => resolveRun(r, fsImpl));
  resolved.sort((a, b) => compareStrings(a.date, b.date) || compareStrings(a.name, b.name));
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

// The lens names a verdict line may quote in place of the id, keyed by the lowercase hyphenated name. Source: the lens
// headings in plugin/skills/review/step3-lens-dispatch.md ("### 3a: Convention Compliance" .. "### 3g: Ownability") and
// code-mode-steps.md ("### 3h: UX Analysis"), plus "convention", the short form real decisions.md files carry. A Map, so an
// inherited key such as "constructor" never resolves.
const LENS_NAME_IDS = new Map([
  ['convention', '3a'], ['convention-compliance', '3a'],
  ['security', '3b'],
  ['error-handling', '3c'],
  ['performance', '3d'],
  ['architecture', '3e'],
  ['test-quality', '3f'],
  ['ownability', '3g'],
  ['ux-analysis', '3h'],
]);

// A verdict line quotes the lens as free text ("3b Security", "architecture", "delta"). A name whose leading token is a
// lens id (archive.js's LENS_ID, the one source of the 3a..3j range), or that is a lens's name (case, hyphens and spaces
// alike), is that id, so every collector counts it under the id; any other name is kept verbatim.
const LENS_ID_LEAD_RE = new RegExp(`^(${LENS_ID})(?![A-Za-z0-9])`);
const lensIdOf = (name) => {
  const trimmed = String(name).trim();
  const m = LENS_ID_LEAD_RE.exec(trimmed);
  if (m) return m[1];
  const byName = LENS_NAME_IDS.get(trimmed.toLowerCase().replace(/[\s_-]+/g, '-'));
  return byName || name;
};

// One unit's decisions.md: its text (null when unreadable) and the locations the lens review confirmed, refuted or
// could not judge. All three lists are empty when readRun excludes the unit. A unit whose timing.json readRun cannot read
// (it throws on a malformed dispatch item) is `excluded: 'timing-unreadable'` with its text kept: unparsed wherever the
// verdict figures count one, never a crash and never zero.
function readVerdicts(unit, fsImpl = fs) {
  const noGit = () => {
    throw new Error('reviews reads no git');
  };
  let text = null;
  try {
    text = fsImpl.readFileSync(path.join(unit.dir, 'decisions.md'), 'utf8');
  } catch {
    text = null;
  }
  let read;
  try {
    read = readRun(unit.dir, { fs: fsImpl, git: noGit });
  } catch {
    return { name: unit.name, excluded: 'timing-unreadable', text, confirmed: [], refuted: [], cantTell: [] };
  }
  const out = { name: unit.name, excluded: read.excluded, text, confirmed: [], refuted: [], cantTell: [] };
  if (read.excluded) return out;
  const named = (v) => ({ ...v, lens: lensIdOf(v.lens) });
  out.confirmed = [
    ...read.pairConfirmed.map((p) => ({ lens: lensIdOf(p.lens), path: p.path, line: p.line, how: 'pair' })),
    ...read.verdicts.filter((v) => v.verdict === 'confirmed').map((v) => ({ lens: lensIdOf(v.lens), path: v.path, line: v.line, how: 'tiebreak' })),
  ];
  out.refuted = read.verdicts.filter((v) => v.verdict === 'refuted').map(named);
  out.cantTell = read.verdicts.filter((v) => v.verdict === 'cant-tell').map(named);
  return out;
}

const HUMAN_STOP_KEPT_RE = /^- KEPT-PROMPT\b.*\bCommon Step 1\.6\b.*\bneeds-human\b/;
const HUMAN_STOP_GATED_RE = /^- (?!SKIP\b)[A-Z][A-Z-]*\b.*\bCommon Step 1\.6\b.*\bneeds-human\b.*(?:HARD-GATE|question (?:comment )?posted)/;

// A decisions.md line recording that plan review ran (Common Step 1.6): the denominator of the human-stop count, since a
// unit with no such line never had a plan review to stop in. A SKIP line records a plan review that did not run.
const PLAN_REVIEW_LINE_RE = /^- (?!SKIP\b)[A-Z][A-Z-]*\b.*\bCommon Step 1\.6\b/;

// A decisions.md line recording that plan review stopped to ask a human (or, dispatched, posted the question).
const isHumanStop = (line) => HUMAN_STOP_KEPT_RE.test(line) || HUMAN_STOP_GATED_RE.test(line);

const share = (part, whole) => (whole ? part / whole : null);

// The report of one dispatch, or null when no transcript holds one.
const reportOf = (walked, d, roots, fsImpl) => readReport({ roots, sessions: walked.sessions, agentId: d.agentId }, fsImpl);

// Task reviews by model tier. A report with no verdict line, or no transcript, is `unparsed` and in neither share.
// `items` sums the Critical/Important/Minor items of the needs-fixes reports whose items parsed; `minorOnly` is the
// count of those with no Critical or Important item and at least one Minor. Re-reviews are only counted, by tier.
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
      if (counts.critical + counts.important === 0 && counts.minor > 0) t.minorOnly += 1;
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
// decisions.md cannot be read is `unparsed`, `n` counts the units that could be, and `planReviewUnits` those of them whose
// log has a plan-review (Common Step 1.6) line (`runs` of `planReviewUnits` is the stop rate).
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
  const stops = { runs: 0, n: 0, unparsed: 0, planReviewUnits: 0 };
  for (const units of verdictsByRun) {
    for (const v of units) {
      if (v.text == null) {
        stops.unparsed += 1;
        continue;
      }
      stops.n += 1;
      const lines = v.text.split(/\r?\n/);
      if (lines.some((l) => PLAN_REVIEW_LINE_RE.test(l))) stops.planReviewUnits += 1;
      if (lines.some(isHumanStop)) stops.runs += 1;
    }
  }
  return { reviews: n, n, unparsed, withFindings: share(withFindings, n), findingsPerReview: share(findings, n), byKind, humanStops: stops };
}

// Whether archive.js's readCost (whose LENS_RE is the lens identity) takes one timing item for a lens reviewer.
function isLensItem(d) {
  const one = { readFileSync: () => JSON.stringify({ dispatches: { items: [d] } }) };
  const cost = readCost({ fs: one }, '.');
  return cost !== null && cost.lensAgents.length > 0;
}

// The lens reviewers of one walked run, from its timing.json through readCost. An agent with an agentId is kept only
// when that agentId survived the walk's dedupe (is in `walked.items`), its tier from that item; one with no agentId is
// kept, its tier from the item carrying the same description (readCost drops the description, so the k-th such agent
// pairs with the k-th lens item that has no agentId, both in timing.json order). `unknown` when no item names a tier.
// A repeated agentId in one file matches once (its entry is consumed), as the walk keeps one item. A run whose
// timing.json exists but cannot be read is `unreadable`, not an empty run: either the walk could not parse it (`timing` is
// 'unparsed', readCost returning null) or readCost threw on its items (a null entry). `unreadable` is never a run with no
// timing.json (the walk's 'missing' state), which has no agents and is not unreadable.
function readLensAgents(walked, fsImpl) {
  let cost;
  try {
    cost = readCost({ fs: fsImpl }, walked.run.dir);
  } catch {
    return { agents: [], unreadable: true };
  }
  if (!cost) return { agents: [], unreadable: walked.timing === 'unparsed' };
  const byId = new Map();
  for (const d of walked.items) if (d && d.agentId != null) byId.set(d.agentId, d);
  const anonymous = walked.items.filter((d) => d && d.agentId == null && isLensItem(d));
  let k = 0;
  const agents = [];
  for (const a of cost.lensAgents) {
    const source = a.agentId != null ? byId.get(a.agentId) : anonymous[k++];
    if (a.agentId != null && !source) continue;
    if (a.agentId != null) byId.delete(a.agentId);
    agents.push({ agentId: a.agentId, lens: a.lens, side: a.side, tier: (source && source.tier) || 'unknown' });
  }
  return { agents, unreadable: false };
}

const lensAgentsOf = (walked, fsImpl = fs) => readLensAgents(walked, fsImpl).agents;

const MEAN_KEYS = [...SEVERITIES, 'overflow'];

// Lens reviewers by model tier and by lens. `agents` is every lens agent, `n` those whose report parsed (an agent with no
// agentId is always unparsed), `noFinding` the share of the parsed with no row at all, `perAgent` the mean per parsed
// agent of each severity, of `overflow` and of `total` (their sum); null when nothing parsed. `unreadable` counts the
// runs whose timing.json exists but cannot be read, whether the walk or readCost failed on it (their agents are in no
// figure, never counted as zero); a run with no timing.json is not one.
function collectLensAgents(walkedRuns, { roots, fsImpl = fs } = {}) {
  const groups = { byTier: {}, byLens: {} };
  const slot = (map, key) => (map[key] = map[key] || { agents: 0, n: 0, unparsed: 0, zero: 0, sums: Object.fromEntries(MEAN_KEYS.map((k) => [k, 0])) });
  let unreadable = 0;
  for (const w of walkedRuns) {
    const read = readLensAgents(w, fsImpl);
    if (read.unreadable) unreadable += 1;
    for (const a of read.agents) {
      const text = a.agentId == null ? null : reportOf(w, a, roots, fsImpl);
      const counts = text == null ? null : parseLensReport(text);
      for (const [map, key] of [[groups.byTier, a.tier], [groups.byLens, a.lens]]) {
        const g = slot(map, key);
        g.agents += 1;
        if (!counts) {
          g.unparsed += 1;
          continue;
        }
        g.n += 1;
        const total = MEAN_KEYS.reduce((s, k) => s + counts[k], 0);
        if (total === 0) g.zero += 1;
        for (const k of MEAN_KEYS) g.sums[k] += counts[k];
      }
    }
  }
  const finish = (map) => {
    const out = {};
    for (const [key, g] of Object.entries(map)) {
      const total = MEAN_KEYS.reduce((s, k) => s + g.sums[k], 0);
      const perAgent = g.n === 0 ? null : { total: total / g.n, ...Object.fromEntries(MEAN_KEYS.map((k) => [k, g.sums[k] / g.n])) };
      out[key] = { agents: g.agents, n: g.n, unparsed: g.unparsed, noFinding: share(g.zero, g.n), perAgent };
    }
    return out;
  };
  return { byTier: finish(groups.byTier), byLens: finish(groups.byLens), unreadable };
}

const VERDICT_KEYS = ['confirmed', 'pair', 'tiebreak', 'refuted', 'cantTell'];
const zeroVerdicts = () => Object.fromEntries(VERDICT_KEYS.map((k) => [k, 0]));

// One row per readable unit (`excluded === null`) with its confirmed (pair + tiebreak), refuted and can't-tell locations,
// whole and by lens; an excluded unit is `unparsed`, never a zero row. A unit is excluded when readRun reports
// `no-decisions` (no decisions.md) or `no-review` (no review line in it), `decisions-unreadable` (decisions.md could
// not be read), or readVerdicts reports `timing-unreadable` (its timing.json holds a malformed dispatch item).
// `verdictsByRun[i]` holds readVerdicts for each unit of a walked run.
function collectPerRun(verdictsByRun) {
  const rows = [];
  const totals = zeroVerdicts();
  const byLens = {};
  let unparsed = 0;
  for (const units of verdictsByRun) {
    for (const v of units) {
      if (v.excluded !== null) {
        unparsed += 1;
        continue;
      }
      const row = { run: v.name, ...zeroVerdicts(), byLens: {} };
      const add = (lensName, key) => {
        row[key] += 1;
        totals[key] += 1;
        for (const target of [row.byLens, byLens]) {
          if (!target[lensName]) target[lensName] = zeroVerdicts();
          target[lensName][key] += 1;
        }
      };
      for (const c of v.confirmed) {
        add(c.lens, 'confirmed');
        add(c.lens, c.how);
      }
      for (const r of v.refuted) add(r.lens, 'refuted');
      for (const c of v.cantTell) add(c.lens, 'cantTell');
      rows.push(row);
    }
  }
  return { rows, totals, byLens, n: rows.length, unparsed };
}

const FIXED_RE = /Step 3 Routing: applied .*fix at/i;
const STAGED_RE = /^- STAGED .*Step 3 Routing: .*finding/i;
const CONSOLE_ITEM_RE = /Console item/;
const DEFERRED_RE = /→ digest|routed to digest|materiality-floor|routed below floor/i;
const DISMISSED_RE = /dropped: refuted by tiebreak|→ declined|Don't fix|not fixed/i;
const LOCATION_RE = /([\w./@-]+\.[\w]+):(\d+)/;
const ROUTING_CLASSES = ['fixed', 'dismissed', 'staged', 'deferred'];
const ROUTING_PRECEDENCE = ['fixed', 'staged', 'deferred', 'dismissed'];

// What one decisions.md line says became of a finding: 'fixed' | 'staged' | 'deferred' | 'dismissed', or null for a
// line that routes nothing (a Review Console item line included).
function classifyRouting(line) {
  if (FIXED_RE.test(line)) return 'fixed';
  if (STAGED_RE.test(line)) return 'staged';
  if (CONSOLE_ITEM_RE.test(line)) return null;
  if (DEFERRED_RE.test(line)) return 'deferred';
  if (DISMISSED_RE.test(line)) return 'dismissed';
  return null;
}

// Map of `path:line` to its highest class (fixed, staged, deferred, dismissed): a classified line belongs to the first
// location named on it.
function routedLocations(text) {
  const routed = new Map();
  for (const line of text.split(/\r?\n/)) {
    const cls = classifyRouting(line);
    const loc = cls && LOCATION_RE.exec(line);
    if (!loc) continue;
    const key = `${loc[1]}:${loc[2]}`;
    const have = routed.get(key);
    if (!have || ROUTING_PRECEDENCE.indexOf(cls) < ROUTING_PRECEDENCE.indexOf(have)) routed.set(key, cls);
  }
  return routed;
}

const zeroCounts = () => Object.fromEntries(ROUTING_CLASSES.map((k) => [k, 0]));

// { fixed, dismissed, staged, deferred (shares of n, null when n is 0), counts, n }.
function routingShares(counts) {
  const n = ROUTING_CLASSES.reduce((s, k) => s + counts[k], 0);
  return { ...Object.fromEntries(ROUTING_CLASSES.map((k) => [k, share(counts[k], n)])), counts, n };
}

// What became of the confirmed locations. Per readable unit, a confirmed location (distinct `path:line` of its
// `confirmed`) with a classified routing line is routed by that line's class, else `unrouted`; the top-level shares are
// over the routed ones (`n`). `allRouted` is the same four shares over every distinct location of a readable unit with a
// classified line, refuted ones included. An excluded unit is `unparsed`. `verdictsByRun[i]` holds readVerdicts for each
// unit of a walked run.
function collectOutcomes(verdictsByRun) {
  const counts = zeroCounts();
  const allCounts = zeroCounts();
  let unrouted = 0;
  let unparsed = 0;
  for (const units of verdictsByRun) {
    for (const v of units) {
      if (v.excluded !== null || v.text == null) {
        unparsed += 1;
        continue;
      }
      const routed = routedLocations(v.text);
      for (const cls of routed.values()) allCounts[cls] += 1;
      const seen = new Set();
      for (const c of v.confirmed) {
        const key = `${c.path}:${c.line}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const cls = routed.get(key);
        if (cls) counts[cls] += 1;
        else unrouted += 1;
      }
    }
  }
  const { counts: c, n, ...shares } = routingShares(counts);
  return { ...shares, counts: c, unrouted, n, unparsed, allRouted: routingShares(allCounts) };
}

// The yield per lens over the latest `n` runs in which the lens ran. `yieldWalked` is walkRuns(runs, { since: null,
// until }), sorted oldest first and read newest first. For each lens a run is a candidate when it has at least one agent
// for the lens; a candidate whose units are all readable takes a slot (its agents for the lens, its units' confirmed
// verdicts for the lens) until `n` are filled, and an unreadable one adds 1 to `unparsed`. A run whose lens agents
// cannot be read is unparsed for every lens the walk saw. A run with no usable timing.json adds 1 to `unparsed` for a lens
// one of its readable units records a confirmed, refuted or can't-tell verdict for, and is otherwise passed over. A lens
// with no agent in the walk is absent unless a run with no usable timing.json records a verdict for it (then it is
// `{ runs: 0, agents: 0, confirmed: 0, rate: null, unparsed: k }`); the decisions.md files are read at most once per unit:
// for every run with no usable timing.json (whether or not a lens slot is still open), and for a run with usable timing
// only when it holds agents for a lens whose slots are open. `n` must be a positive integer, else a TypeError (an empty yield would read as "no lens ran").
function collectYield(yieldWalked, { n, fsImpl = fs } = {}) {
  if (!Number.isInteger(n) || n < 1) throw new TypeError(`collectYield: n must be a positive integer, got ${n}`);
  const byLens = {};
  const entry = (lensName) => (byLens[lensName] = byLens[lensName] || { runs: 0, agents: 0, confirmed: 0, unparsed: 0 });
  const open = (lensName) => !byLens[lensName] || byLens[lensName].runs < n;
  const reads = yieldWalked.map((w) => ({ w, read: readLensAgents(w, fsImpl) }));
  const seenLenses = new Set(reads.flatMap(({ read }) => read.agents.map((a) => a.lens)));
  for (const { w, read } of reads.reverse()) {
    let verdicts = null;
    const units = () => verdicts || (verdicts = w.units.map((u) => readVerdicts(u, fsImpl)));
    if (w.timing !== 'ok') {
      const ran = new Set();
      for (const v of units()) {
        for (const x of [...v.confirmed, ...v.refuted, ...v.cantTell]) ran.add(x.lens);
      }
      for (const lensName of ran) if (open(lensName)) entry(lensName).unparsed += 1;
      continue;
    }
    if (read.unreadable) {
      for (const lensName of seenLenses) if (open(lensName)) entry(lensName).unparsed += 1;
      continue;
    }
    const agentsBy = {};
    for (const a of read.agents) agentsBy[a.lens] = (agentsBy[a.lens] || 0) + 1;
    for (const [lensName, agents] of Object.entries(agentsBy)) {
      if (!open(lensName)) continue;
      const all = units();
      const slot = entry(lensName);
      if (all.some((v) => v.excluded !== null)) {
        slot.unparsed += 1;
        continue;
      }
      slot.runs += 1;
      slot.agents += agents;
      slot.confirmed += all.reduce((s, v) => s + v.confirmed.filter((c) => c.lens === lensName).length, 0);
    }
  }
  for (const slot of Object.values(byLens)) slot.rate = share(slot.confirmed, slot.agents);
  return { runs: n, byLens };
}

// The reviews section over the since..until window: the window walk and its decisions.md reads are shared by the window
// collectors; the yield does its own walk (it ignores `since` and stops at `until`) and its own decisions reads. `n` is
// the yield's slot count.
function collectReviews({ runs, since, until, roots, n }, { fsImpl = fs } = {}) {
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
    lens: {
      ...collectLensAgents(walked, { roots, fsImpl }),
      perRun: collectPerRun(verdictsByRun),
      outcomes: collectOutcomes(verdictsByRun),
      yield: collectYield(walkRuns(runs, { since: null, until, fsImpl }), { n, fsImpl }),
    },
  };
}

module.exports = { lensIdOf, compareStrings, SEVERITIES, PLAN_KINDS, parseTaskVerdict, parsePlanReview, parseLensReport, walkRuns, readVerdicts, isHumanStop, collectTaskReview, collectPlanReview, lensAgentsOf, collectLensAgents, collectPerRun, classifyRouting, collectOutcomes, collectYield, collectReviews };
