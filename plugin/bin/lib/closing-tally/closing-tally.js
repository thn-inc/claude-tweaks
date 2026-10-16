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
// Anchored to the producer's exact prefix (Minor 2) so an error message that
// itself contains the literal text "apply-refine-labels: #N:" can never win
// the issue capture — only the line's own leading `- {STATUS} {HH:MM:SS} —
// apply-refine-labels: #N: ` (the real em dash, U+2014) is eligible.
const APPLY_EDIT_RE = /^- AUTO \d{2}:\d{2}:\d{2} — apply-refine-labels: #(\d+): applied (.+?)\. Reversibility:/;
const APPLY_FAILED_RE = /^- FAILED \d{2}:\d{2}:\d{2} — apply-refine-labels: #(\d+): /;
// Distinguishes the comment step's own FAILED line (`#N: comment failed: `)
// from an edit-step FAILED line (`#N: {labelSummary} failed: `) once
// APPLY_FAILED_RE has already anchored the issue capture (#3267 Important 1).
const APPLY_COMMENT_FAILED_RE = /^comment failed: /;

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

// decisions.md text -> { counts: {field: n, ...}, unclassified: [line, ...] }.
// Each source (the hand-composed template lines, and apply-refine-labels'
// own per-action lines) counts its own (field, issue) hits by occurrence —
// NOT deduped against repeats from the same source, since two template lines
// naming the same record under the same field (e.g. a priority write failure
// and a Related write failure that both land on #50's `failed` field) are
// genuinely two writes, not one logged twice. Only hits from the TWO sources
// describing the SAME write collapse: the final count per (field, issue) is
// max(templateCount, applyCount), which collapses a template line and the
// apply-refine-labels line for that same write into one (#3267 Important 2)
// while still counting genuine same-source repeats separately. A hit with no
// issue (issue null) always adds one, additively, regardless of source.
//
// `unclassified` carries every line that reads as a Backlog-refine entry
// ("Backlog refine:" anywhere) or is an AUTO/FAILED line under `## /backlog`
// written by apply-refine-labels.js, and matched no known pattern — a vocab
// drift signal (AC 2: no tally field may appear outside this file's own
// enumerated set without this file being updated first), never silently
// dropped. An apply-refine-labels-shaped line outside `## /backlog` is
// neither counted nor unclassified (Minor 1): that CLI only ever writes
// there, so such a line elsewhere is not its output.
function computeClosingTally(decisionsText) {
  const templateCount = Object.fromEntries(FIELDS.map((f) => [f, new Map()]));
  const applyCount = Object.fromEntries(FIELDS.map((f) => [f, new Map()]));
  const anonymous = Object.fromEntries(FIELDS.map((f) => [f, 0]));
  // Records with an apply-refine-labels `comment failed:` FAILED line — a
  // partial flag-back/needs-decision write (the label edit landed, the
  // explanatory comment didn't). refine-lanes.md:194-200 counts that record
  // once, under `failed`, never also under the write type its successful
  // edit implies (#3267 Important 1).
  const commentFailedIssues = new Set();
  const unclassified = [];
  let section = null;
  const lines = String(decisionsText || '').split('\n');

  const addHit = (countMap, field, issue) => {
    if (issue === null) { anonymous[field] += 1; return; }
    countMap[field].set(issue, (countMap[field].get(issue) || 0) + 1);
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const heading = line.match(/^## (.+)$/);
    if (heading) { section = heading[1].trim(); continue; }
    if (isIgnoredLine(line)) continue;

    const template = line.indexOf('Backlog refine:');
    if (template !== -1) {
      let matched = false;
      for (const { field, re } of PATTERNS) {
        if (re.test(line)) {
          matched = true;
          const m = line.slice(template).match(/#(\d+)/);
          addHit(templateCount, field, m ? Number(m[1]) : null);
          break;
        }
      }
      if (!matched) unclassified.push(line);
      continue;
    }

    // Minor 1: apply-refine-labels only ever writes under `## /backlog` — a
    // same-shaped AUTO/FAILED line elsewhere is not its output.
    if (section !== '/backlog' || !/^- (AUTO|FAILED) /.test(line)) continue;

    const failed = line.match(APPLY_FAILED_RE);
    if (failed) {
      const issue = Number(failed[1]);
      const rest = line.slice(failed[0].length);
      if (APPLY_COMMENT_FAILED_RE.test(rest)) commentFailedIssues.add(issue);
      addHit(applyCount, 'failed', issue);
      continue;
    }
    const edit = line.match(APPLY_EDIT_RE);
    if (edit) {
      const issue = Number(edit[1]);
      const editFields = fieldsForLabels(edit[2]);
      if (editFields.length) editFields.forEach((field) => addHit(applyCount, field, issue));
      else unclassified.push(line);
      continue;
    }
    unclassified.push(line);
  }

  for (const field of ['flaggedBack', 'needsDecision']) {
    for (const issue of commentFailedIssues) {
      templateCount[field].delete(issue);
      applyCount[field].delete(issue);
    }
  }

  const counts = Object.fromEntries(FIELDS.map((f) => {
    const issues = new Set([...templateCount[f].keys(), ...applyCount[f].keys()]);
    let total = anonymous[f];
    for (const issue of issues) {
      total += Math.max(templateCount[f].get(issue) || 0, applyCount[f].get(issue) || 0);
    }
    return [f, total];
  }));
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
