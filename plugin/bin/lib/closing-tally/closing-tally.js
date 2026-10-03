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

// "Backlog refine:"-prefixed lines written by OTHER steps within the same
// skill, not by refine-closing-summary.md's own per-write outcome logging
// this tally counts: refine-lanes.md's unattended-branch batch-summary line,
// and merge-lane-reset.md's circuit-breaker reset bookkeeping. Both share the
// generic "Backlog refine:" prefix the scan filters on, but neither is a
// per-write outcome, drift, or a genuinely new write type — recognized and
// silently excluded here so they don't surface as false `unclassified`
// drift caveats in the closing summary.
const IGNORED_PATTERNS = [
  /Backlog refine: batch auto-applied/,
  /Backlog refine: merge-lane circuit breaker RESET/,
];

// One decisions.md line -> field name, or null when the line isn't a
// recognized Backlog-refine tally line at all (every other decisions.md
// entry — claim logs, Manifesto lines, other skills' sections — is simply
// not this tally's business).
function classifyLine(line) {
  for (const { field, re } of PATTERNS) {
    if (re.test(line)) return field;
  }
  return null;
}

// True when a "Backlog refine:"-prefixed line is known non-tally narration
// from another step (see IGNORED_PATTERNS above) rather than a drifted or
// genuinely new per-write outcome line.
function isIgnoredLine(line) {
  return IGNORED_PATTERNS.some((re) => re.test(line));
}

// decisions.md text -> { counts: {field: n, ...}, unclassified: [line, ...] }.
// `unclassified` carries every line that looks like a Backlog-refine entry
// (contains "Backlog refine:") but didn't match any known pattern — a vocab
// drift signal (AC 2: no tally field may appear outside this file's own
// enumerated set without this file being updated first), never silently
// dropped.
function computeClosingTally(decisionsText) {
  const counts = Object.fromEntries(FIELDS.map((f) => [f, 0]));
  const unclassified = [];
  const lines = String(decisionsText || '').split('\n');
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (!/Backlog refine:/.test(line)) continue;
    if (isIgnoredLine(line)) continue;
    const field = classifyLine(line);
    if (field) counts[field] += 1;
    else unclassified.push(line);
  }
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
