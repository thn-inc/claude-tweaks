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
// Later slices of this module read the run's decisions.md review lines and timing.json; a multi-spec member's
// timing.json is a stub with no dispatches: {"dispatches":{"notFound":"no transcript resolved"}}. Pure; reads no file.

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

module.exports = { SEVERITIES, PLAN_KINDS, parseTaskVerdict, parsePlanReview, parseLensReport };
