// Derives a `/claude-tweaks:backlog refine` run's closing tally directly from
// its own `decisions.md` entries, rather than a hand-composed count that can
// disagree with the audit trail it is supposed to summarize (#2729). The
// enumerated fields below are `refine-closing-summary.md`'s documented
// vocabulary for the Per-type tally line — the single source of truth for
// what a closing summary may claim a count for; a new field belongs there
// first, then here.
'use strict';

// Canonical field order — matches refine-closing-summary.md's tally-line
// example ("34 priority set · 2 Related updated · 7 granted · 5 flagged
// back · 1 dependency-repair · 1 needs-decision · 0 skipped · 0 failed").
const FIELDS = ['priority', 'related', 'granted', 'flaggedBack', 'dependencyRepair', 'needsDecision', 'skipped', 'failed'];

// One label per field, exactly as refine-closing-summary.md's tally-line
// template renders it.
const LABELS = {
  priority: 'priority set',
  related: 'Related updated',
  granted: 'granted',
  flaggedBack: 'flagged back',
  dependencyRepair: 'dependency-repair',
  needsDecision: 'needs-decision',
  skipped: 'skipped',
  failed: 'failed',
};

// Matched against a decisions.md line's text after its `- {STATUS} {HH:MM:SS}
// — ` prefix (if any) — order matters only in that each pattern is tried in
// turn and the first match wins; the patterns are mutually exclusive by
// construction (each names a distinct fixed phrase from
// refine-closing-summary.md's templates), so ordering never changes a result.
const PATTERNS = [
  { field: 'priority', re: /Backlog refine: set priority:/ },
  { field: 'related', re: /Backlog refine: updated \*\*Related:\*\*/ },
  { field: 'granted', re: /Backlog refine: granted auto:build/ },
  { field: 'granted', re: /Backlog refine: re-authorized #/ },
  { field: 'flaggedBack', re: /Backlog refine: flagged back #/ },
  { field: 'dependencyRepair', re: /Backlog refine: repaired dependency on/ },
  { field: 'needsDecision', re: /Backlog refine: stamped needs:decision on/ },
  { field: 'skipped', re: /Backlog refine: skipped #/ },
  { field: 'failed', re: /Backlog refine: .* write failed on #/ },
];

// bin/apply-refine-labels.js's own per-action lines (#3267). That CLI logs by
// label, not by lane — its actions JSON has no lane field — so the write
// type is derived from the labels it applied. One action can carry two writes
// (a grant row that also sets a priority: `applied +auto:build +priority:medium`).
const APPLY_EDIT_RE = /apply-refine-labels: #(\d+): applied (.+?)\. Reversibility:/;
const APPLY_FAILED_RE = /^- FAILED .*apply-refine-labels: #(\d+): .*failed: /;

// Lines under `## /backlog` (or anywhere, for the "Backlog refine:" prefix)
// written by OTHER steps of the same skill, not per-write outcome lines this
// tally counts — recognized and excluded so they don't surface as false
// `unclassified` drift: refine-lanes.md's unattended batch-summary line,
// merge-lane-reset.md's circuit-breaker reset, apply-refine-labels' own
// `comment posted` line (the second half of a flag-back/needs-decision write
// its label line already counts), and refine-record.md Step 5's Resolve-lane
// per-record line (`Backlog refine #{n}: …` — no tally field exists for it).
const IGNORED_PATTERNS = [
  /Backlog refine: batch auto-applied/,
  /Backlog refine: merge-lane circuit breaker RESET/,
  /apply-refine-labels: #\d+: comment posted/,
  /Backlog refine #\d+:/,
];

function isIgnoredLine(line) {
  return IGNORED_PATTERNS.some((re) => re.test(line));
}

// `+a +b, -c` (apply-refine-labels' label summary) -> the tally fields it
// represents. Empty when the labels name no known write type.
function fieldsForLabels(summary) {
  const tokens = summary.match(/[+-][^\s,]+/g) || [];
  const added = tokens.filter((t) => t[0] === '+').map((t) => t.slice(1));
  const removed = tokens.filter((t) => t[0] === '-').map((t) => t.slice(1));
  const fields = [];
  if (added.includes('auto:build') || added.includes('auto:merge')) fields.push('granted');
  if (added.some((l) => l.startsWith('priority:'))) fields.push('priority');
  if (added.includes('needs:decision')) fields.push('needsDecision');
  if (removed.includes('ready')) fields.push('flaggedBack');
  return fields;
}

// One decisions.md line -> [{field, issue}] — empty when the line is not a
// recognized tally line. `issue` is the record the write targeted (the first
// `#N` after the template prefix), or null when the line names none.
function classifyLine(line) {
  const template = line.indexOf('Backlog refine:');
  if (template !== -1) {
    for (const { field, re } of PATTERNS) {
      if (re.test(line)) {
        const m = line.slice(template).match(/#(\d+)/);
        return [{ field, issue: m ? Number(m[1]) : null }];
      }
    }
    return [];
  }
  const failed = line.match(APPLY_FAILED_RE);
  if (failed) return [{ field: 'failed', issue: Number(failed[1]) }];
  const edit = line.match(APPLY_EDIT_RE);
  if (edit) return fieldsForLabels(edit[2]).map((field) => ({ field, issue: Number(edit[1]) }));
  return [];
}

// decisions.md text -> { counts: {field: n, ...}, unclassified: [line, ...] }.
// A write is counted once per (field, record), so the template line and the
// apply-refine-labels line for the same write collapse into one (#3267).
// `unclassified` carries every line that reads as a Backlog-refine entry
// ("Backlog refine:" anywhere) or is an AUTO/FAILED line under `## /backlog`,
// and matched no known pattern — a vocab drift signal (AC 2: no tally field
// may appear outside this file's own enumerated set without this file being
// updated first), never silently dropped.
function computeClosingTally(decisionsText) {
  const seen = Object.fromEntries(FIELDS.map((f) => [f, new Set()]));
  const anonymous = Object.fromEntries(FIELDS.map((f) => [f, 0]));
  const unclassified = [];
  let section = null;
  const lines = String(decisionsText || '').split('\n');
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const heading = line.match(/^## (.+)$/);
    if (heading) { section = heading[1].trim(); continue; }
    if (isIgnoredLine(line)) continue;
    const hits = classifyLine(line);
    if (hits.length) {
      for (const { field, issue } of hits) {
        if (issue === null) anonymous[field] += 1;
        else seen[field].add(issue);
      }
      continue;
    }
    const backlogWrite = section === '/backlog' && /^- (AUTO|FAILED) /.test(line);
    if (backlogWrite || /Backlog refine:/.test(line)) unclassified.push(line);
  }
  const counts = Object.fromEntries(FIELDS.map((f) => [f, seen[f].size + anonymous[f]]));
  return { counts, unclassified };
}

// counts -> the canonical tally-line string, e.g.
// "34 priority set · 2 Related updated · 7 granted · 5 flagged back ·
// 1 dependency-repair · 1 needs-decision · 0 skipped · 0 failed".
function renderTallyLine(counts) {
  return FIELDS.map((f) => `${counts[f] || 0} ${LABELS[f]}`).join(' · ');
}

module.exports = {
  FIELDS, LABELS, computeClosingTally, renderTallyLine,
};
