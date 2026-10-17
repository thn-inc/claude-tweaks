'use strict';

// Mechanical bloat detection for harness documentation.
//
// context-cost.js measures how big the payload IS. This module detects the four
// signals that make it big, so a regression is a reported finding rather than
// something a human notices 150 KB later. Every function here is read-only —
// `/claude-tweaks:harness-health` files issues and never edits a skill, so this
// returns findings and nothing else.
//
// Nothing here is a verdict. Each signal is *evidence* the judging step weighs,
// in the same sense as the existing evidence pre-checks in
// `skills/_shared/harness-health-analysis.md`: every one of the four has a
// legitimate form, spelled out beside its threshold below.
//
// Thresholds are calibrated against this repo's corpus immediately after the
// three-phase bloat reduction — i.e. against a deliberately clean baseline, so
// they mark regrowth rather than re-flagging what was just fixed.

const fs = require('node:fs');
const { extractAntiPatternRows } = require('./anti-patterns.js');

// ── Signal 1: over-long table rows ──────────────────────────────────────────
//
// An Anti-Pattern row is a two-cell table row; the table form exists so the
// rows can be scanned. A row that has grown into a paragraph has stopped being
// a row, and it costs that on every invocation.
//
// The threshold is RELATIVE to the corpus median, not an absolute byte count,
// for two reasons: a byte literal goes stale the moment a compression pass
// moves the corpus (which is exactly what just happened here), and "well above
// the median" is the actual claim being made.
//
// Multiple of 2 chosen by measuring the live corpus (345 rows, median 152 B):
//   x1.5  -> 32 rows (9.3%)  — a whole quartile's tail; a to-do list, not a signal
//   x1.75 -> 11 rows (3.2%)
//   x2.0  ->  4 rows (1.2%)  — genuine outliers
//   x2.5  ->  1 row  (0.3%)  — too tight to catch regrowth before it spreads
const ROW_LENGTH_MULTIPLE = 2;

// A median over a handful of rows is set by the outlier itself, so the relative
// comparison would compare a row against a baseline it defines. Below this many
// rows the check reports that it has no baseline instead of guessing — the same
// posture the eval cost check takes with a thin history.
const MIN_ROW_SAMPLE = 20;

// ── Signal 4: skill file size outliers ─────────────────────────────────────
//
// A skill file much larger than its siblings — real when it holds several
// independent procedures. Legitimate form: an entry point that is legitimately
// the largest because it carries a whole lifecycle. Uses two tiers: ≥20 files
// takes nearest-rank p95, floored at SIZE_MEDIAN_MULTIPLE × median (#3305 F1);
// 5–19 files takes SIZE_MEDIAN_MULTIPLE × median; fewer has no baseline. The
// floor means a uniform corpus flags nothing and the 19→20-file tier edge
// cannot flip a verdict.
//
// Measured on this repo's `plugin/skills/*/*.md` corpus: 442 files, threshold
// 39,519 B (p95; the floor is 25,605 B), 22 files flagged.
const SIZE_OUTLIER_PERCENTILE = 0.95;
const SIZE_PERCENTILE_MIN_SAMPLE = 20;
const SIZE_MEDIAN_MULTIPLE = 3;
const SIZE_MIN_SAMPLE = 5;

function rowBytes(row) {
  return Buffer.byteLength(`${row.pattern} ${row.why}`, 'utf8');
}

function median(numbers) {
  if (numbers.length === 0) return null;
  const sorted = [...numbers].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

// Corpus-wide baseline. `files` is a list of {file, text} so callers choose the
// corpus — this repo's skills/, or an arbitrary project's .claude/skills/.
function corpusRowMedian(files) {
  const sizes = [];
  for (const { text } of files) {
    for (const row of extractAntiPatternRows(text)) sizes.push(rowBytes(row));
  }
  return {
    median: median(sizes),
    sample: sizes.length,
    // Below the sample floor the caller must report "no baseline", not "clean".
    usable: sizes.length >= MIN_ROW_SAMPLE,
  };
}

function overLongRows(text, baselineMedian, multiple = ROW_LENGTH_MULTIPLE) {
  if (!baselineMedian) return [];
  const threshold = baselineMedian * multiple;
  return extractAntiPatternRows(text)
    .map((row) => ({ line: row.line, bytes: rowBytes(row), pattern: row.pattern }))
    .filter((row) => row.bytes > threshold);
}

// Corpus-wide baseline for file sizes. Returns { usable, sample, method, threshold }
// where method is 'p95' (if >= 20 files), 'median-multiple' (if >= 5 files), or null.
function corpusSizeBaseline(files) {
  const sizes = files.map((f) => f.bytes);
  const sample = sizes.length;
  if (sample >= SIZE_PERCENTILE_MIN_SAMPLE) {
    // Nearest-rank p95, floored at the small-corpus tier's 3× median: a
    // uniform corpus flags nothing, and the 19→20-file edge cannot flip a
    // verdict (#3305 F1)
    const sorted = [...sizes].sort((a, b) => a - b);
    const p95 = sorted[Math.ceil(SIZE_OUTLIER_PERCENTILE * sample) - 1];
    const threshold = Math.max(p95, median(sizes) * SIZE_MEDIAN_MULTIPLE);
    return { usable: true, sample, method: 'p95', threshold };
  }
  if (sample >= SIZE_MIN_SAMPLE) {
    const threshold = median(sizes) * SIZE_MEDIAN_MULTIPLE;
    return { usable: true, sample, method: 'median-multiple', threshold };
  }
  // Below the floor, no baseline
  return { usable: false, sample, method: null, threshold: null };
}

// ── Signal 2: provenance narration ──────────────────────────────────────────
//
// Text addressed to whoever edited the file rather than to the model running
// it. It reads as informative and survives review precisely because it is true;
// it is dead weight because deleting it changes nothing the model does.
//
// Single words do not work as patterns. Measured on this corpus: `deliberately`
// 48 hits, `unchanged` 86, `previously` 21, `pre-existing` 30 — overwhelmingly
// legitimate. Every pattern below is therefore multi-word AND anchored on the
// giveaway that the sentence's subject is *the document's own edit history*.
// Each carries the specific reason it discriminates.
const PROVENANCE_PATTERNS = [
  {
    id: 'own-prior-behavior',
    // `pre-existing` alone is legitimate 30x here — a pre-existing *failure*,
    // *record*, or *trigger* is a real runtime thing, and /build's task briefs
    // instruct on "modifying pre-existing behavior" of the code under test.
    // The possessive is the discriminator: when the thing that pre-exists is
    // *this document's own* behavior, the sentence is describing an edit.
    pattern: /\b(this|the) (skill|file|section|document)'s (own )?pre-?existing\b/i,
    why: "the subject is the document's own former behavior, not the system's",
  },
  {
    id: 'behavior-unchanged-aside',
    // Bare "behavior unchanged" appears legitimately mid-sentence ("declining
    // falls through to their existing behavior unchanged" states what happens
    // at runtime). Requiring it to be set off by a dash, paren, or colon keeps
    // only the reviewer-facing aside form, which asserts nothing operative.
    pattern: /(^|[—(:-])\s*behaviou?r (is |was )?unchanged\b/i,
    why: 'a parenthetical "nothing changed" assertion has no reader but a diff reviewer',
  },
  {
    id: 'existing-precedent',
    // "precedent" is inherently a claim about why the author wrote it this way.
    // Nothing downstream can act on it.
    pattern: /\b(mirror(s|ing)?|match(es|ing)?|follow(s|ing)?)\s+(the\s+)?existing precedent\b/i,
    why: 'cites the author\'s reason for a choice, never the choice itself',
  },
  {
    id: 'audit-outcome',
    // Records the result of a past review pass ("Phase 6 — verified, no change
    // needed"). True, checkable, and inert at runtime.
    pattern: /\b(verified|checked|confirmed|audited),?\s+no change (was )?(needed|required)\b/i,
    why: 'records a past review verdict rather than an instruction',
  },
  {
    id: 'sibling-remediation',
    // "docs-health closed the same gap the same way in the same pass" — a
    // changelog line about a coordinated edit. Narrow by construction: it needs
    // both the remediation verb and the "same <defect noun>" object.
    pattern: /\b(clos(ed|es)|fix(ed|es)|address(ed|es)) (the same|this same) (gap|issue|defect|asymmetry|problem)\b/i,
    why: 'narrates a coordinated edit across files; no runtime consequence',
  },
  {
    id: 'edit-status-marker',
    // A parenthesized edit-status tag hung off a heading or bolded label —
    // "**7. Template/structural conformance** (new)". Anchoring to the heading
    // or bold run is what keeps it off ordinary parenthetical prose, where
    // "(new)" can legitimately qualify a noun.
    pattern: /(^#{1,6} .*|\*\*[^*]+\*\*)\s*\((new|revised|updated|unchanged)\)/i,
    why: 'marks when an item was added, which only matters to someone diffing',
  },
  {
    id: 'then-versus-now',
    // "previously fanned out to 25 agents; it now dispatches at most 10." The
    // before/after pairing is the tell — the "now" half alone would say
    // everything the model needs. Bare `previously` is 21 legitimate hits here
    // ("previously declined", "previously closed"), so the pattern requires the
    // clause boundary and the explicit "it now".
    pattern: /\bpreviously\b[^.\n]{0,90}?[;—-]\s*it now\b/i,
    why: 'the before-half of a before/after pair is pure history',
  },
];

function findProvenance(text, patterns = PROVENANCE_PATTERNS) {
  const out = [];
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    for (const { id, pattern, why } of patterns) {
      const m = line.match(pattern);
      if (!m) continue;
      out.push({
        line: i + 1,
        id,
        why,
        excerpt: line.slice(Math.max(0, m.index - 30), m.index + m[0].length + 30).trim(),
      });
    }
  });
  return out;
}

// ── Signal 3: degenerate tables ─────────────────────────────────────────────
//
// Adjacent rows whose right-hand cell says the same thing: the table is paying
// N rows to carry one fact, and the left-hand column is the only content.
//
// Two guards keep this off legitimate tables:
//
//   Word floor. A decision matrix is SUPPOSED to repeat its verdicts — a
//   `Yes`/`No`/`Auto-apply`/`Fix now` column repeating is the table working.
//   Measured: with no floor, 84 exact-duplicate adjacent pairs, essentially all
//   verdict enums. With an 8-word floor, 6 — all of them real prose duplicates.
//
//   Similarity floor. Jaccard over normalized word sets, 0.8. Measured over 810
//   floor-clearing adjacent pairs:
//     >=0.7 -> 20 pairs, but the 0.7-0.8 band is dominated by deliberately
//              parallel rows whose single varying word IS the row's content
//              ("...flagged a matching typography|layout|responsive issue")
//     >=0.8 -> 12 pairs, all genuinely N-rows-for-one-fact, and still low
//              enough to catch the "same sentence, one clause reworded" shape
//              (a real 0.89 pair here) that 0.9 would miss
const DEGENERATE_SIMILARITY = 0.8;
const DEGENERATE_MIN_WORDS = 8;

const RULE_ROW = /^\|\s*:?-+/;

// Same escaped-pipe handling as anti-patterns.js's splitCells — a cell may
// legitimately contain `\|` inside a code span.
function splitCells(line) {
  const inner = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  const parts = [];
  let cur = '';
  for (let i = 0; i < inner.length; i += 1) {
    if (inner[i] === '\\' && inner[i + 1] === '|') { cur += '|'; i += 1; continue; }
    if (inner[i] === '|') { parts.push(cur); cur = ''; continue; }
    cur += inner[i];
  }
  parts.push(cur);
  return parts.map((p) => p.trim());
}

// Every markdown table in the file, as {headerLine, rows}. The first pipe row
// of a block is its header; separator rows are dropped.
function extractTables(markdown) {
  const lines = markdown.split('\n');
  const tables = [];
  let current = null;
  const flush = () => {
    if (current && current.rows.length >= 2) tables.push(current);
    current = null;
  };
  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (line.startsWith('|') && line.endsWith('|')) {
      if (RULE_ROW.test(line)) return;
      const cells = splitCells(line);
      if (!current) { current = { headerLine: i + 1, header: cells, rows: [] }; return; }
      current.rows.push({ line: i + 1, cells });
      return;
    }
    flush();
  });
  flush();
  return tables;
}

// Strip markdown emphasis and punctuation so "`Stage` — never auto-applied" and
// "Stage, never auto-applied" compare as the same words.
function normalizeWords(cell) {
  return cell
    .toLowerCase()
    .replace(/[`*_]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

function similarity(a, b) {
  const A = new Set(normalizeWords(a));
  const B = new Set(normalizeWords(b));
  if (A.size === 0 || B.size === 0) return 0;
  let shared = 0;
  for (const w of A) if (B.has(w)) shared += 1;
  return shared / (A.size + B.size - shared);
}

function findDegenerateRows(markdown, opts = {}) {
  const threshold = opts.threshold ?? DEGENERATE_SIMILARITY;
  const minWords = opts.minWords ?? DEGENERATE_MIN_WORDS;
  const out = [];
  for (const table of extractTables(markdown)) {
    for (let i = 1; i < table.rows.length; i += 1) {
      const prev = table.rows[i - 1];
      const row = table.rows[i];
      const a = prev.cells[prev.cells.length - 1] || '';
      const b = row.cells[row.cells.length - 1] || '';
      if (normalizeWords(a).length < minWords || normalizeWords(b).length < minWords) continue;
      const score = similarity(a, b);
      if (score < threshold) continue;
      out.push({
        line: row.line,
        previousLine: prev.line,
        similarity: Number(score.toFixed(2)),
        exact: score === 1,
        cell: b,
      });
    }
  }
  return out;
}

// ── Composition ─────────────────────────────────────────────────────────────

// One file's four signals. `bytes` is passed in (not stat'ed) so this stays a
// pure function over text; auditCorpus supplies it.
function auditText(text, { bytes, rowMedian, sizeThreshold } = {}) {
  return {
    bytes,
    longRows: overLongRows(text, rowMedian),
    provenance: findProvenance(text),
    degenerate: findDegenerateRows(text),
    sizeOutlier: typeof bytes === 'number' && typeof sizeThreshold === 'number' && bytes > sizeThreshold,
  };
}

// `files` is a list of paths. The caller picks the corpus, so this works
// against this repo's skills/ and against an arbitrary project's
// .claude/skills/ without knowing either layout. Duplicates are dropped: the
// target is normally also a member of its own corpus, and a shell glob that
// re-lists it must not double-count its rows in the baseline or its findings
// in the report.
function auditCorpus(files, { sizeOutlier = true } = {}) {
  const loaded = [...new Set(files)]
    // Callers pass shell globs, and a glob matching nothing survives as a
    // literal path under bash's default nullglob-off. Skipping a non-file keeps
    // "this project uses the other skill layout" from throwing ENOENT and
    // losing the whole scan; a corpus that ends up empty is already reported
    // honestly as NO BASELINE.
    .filter((file) => { try { return fs.statSync(file).isFile(); } catch { return false; } })
    .map((file) => ({ file, text: fs.readFileSync(file, 'utf8'), bytes: fs.statSync(file).size }));
  const baseline = corpusRowMedian(loaded);
  const rowMedian = baseline.usable ? baseline.median : null;
  const sizeBaseline = corpusSizeBaseline(loaded);
  if (!sizeOutlier) sizeBaseline.suppressed = true;
  const sizeThreshold = sizeOutlier && sizeBaseline.usable ? sizeBaseline.threshold : null;
  return {
    rowBaseline: baseline,
    rowThreshold: rowMedian ? rowMedian * ROW_LENGTH_MULTIPLE : null,
    sizeBaseline,
    files: loaded.map(({ file, text, bytes }) => ({ file, ...auditText(text, { bytes, rowMedian, sizeThreshold }) })),
  };
}

function hasFindings(entry) {
  return entry.longRows.length > 0
    || entry.provenance.length > 0
    || entry.degenerate.length > 0
    || entry.sizeOutlier;
}

// Compact text report. The consumer is a model reading this inside a skill
// step, so it is deliberately terse — one line per finding, no JSON envelope.
// `only` restricts the findings section to one file while still reporting the
// baseline derived from the whole corpus: an audit judges one target, but the
// row threshold is only meaningful relative to that target's siblings.
function formatBloatReport(result, { only } = {}) {
  const out = [];
  const { rowBaseline, rowThreshold, sizeBaseline } = result;
  out.push(rowBaseline.usable
    ? `row baseline: median ${rowBaseline.median} B over ${rowBaseline.sample} rows; flag above ${rowThreshold} B`
    : `row baseline: NO BASELINE — ${rowBaseline.sample} anti-pattern rows is under the ${MIN_ROW_SAMPLE}-row floor, so the over-long-row signal was not evaluated`);

  if (!sizeBaseline.suppressed) {
    if (sizeBaseline.usable) {
      const methodStr = sizeBaseline.method === 'p95'
        ? `p95 (floor 3× median) ${sizeBaseline.threshold} B`
        : `3× median ${sizeBaseline.threshold} B`;
      out.push(`size baseline: ${methodStr} over ${sizeBaseline.sample} files`);
    } else {
      out.push(`size baseline: NO BASELINE — ${sizeBaseline.sample} files is under the ${SIZE_MIN_SAMPLE}-file floor, so the size-outlier signal was not evaluated`);
    }
  }

  for (const entry of result.files) {
    if (only && entry.file !== only) continue;
    if (!hasFindings(entry)) continue;
    out.push(`\n${entry.file}`);
    for (const row of entry.longRows) {
      out.push(`  long-row L${row.line}: ${row.bytes} B — ${row.pattern.slice(0, 60)}`);
    }
    for (const p of entry.provenance) {
      out.push(`  provenance L${p.line} [${p.id}]: ${p.excerpt}`);
    }
    for (const d of entry.degenerate) {
      out.push(`  degenerate L${d.previousLine}/L${d.line}: ${d.exact ? 'identical' : `sim ${d.similarity}`} — ${d.cell.slice(0, 60)}`);
    }
    if (entry.sizeOutlier && sizeBaseline.usable) {
      out.push(`  size-outlier: ${entry.bytes} B, above the corpus threshold of ${sizeBaseline.threshold} B`);
    }
  }
  const baselineCount = sizeBaseline.suppressed ? 1 : 2;
  if (out.length === baselineCount) out.push('\nno bloat signals');
  return out.join('\n');
}

// The one-call entry point a skill step invokes. Reports findings for
// `targetPath` only, with the row baseline derived from `corpusPaths` (the
// target's siblings — this plugin's `skills/*/SKILL.md`, a project's
// `.claude/skills/*.md`). Pass no corpus and the row signal honestly reports
// that it had no baseline rather than reporting the target clean.
//
// The size-outlier signal can be suppressed with `{ sizeOutlier: false }`: a
// rule file or CLAUDE.md already has its own tiered LINE budget in the
// harness-health procedure, so it never joins the skill-size sample. File size
// against the Read limit is the rail's job (`rail.js`, decision 0024), not a
// bloat signal.
function bloatReport(targetPath, corpusPaths = [], opts = {}) {
  return formatBloatReport(
    auditCorpus([targetPath, ...corpusPaths], opts),
    { only: targetPath },
  );
}

module.exports = {
  ROW_LENGTH_MULTIPLE,
  MIN_ROW_SAMPLE,
  SIZE_OUTLIER_PERCENTILE,
  SIZE_PERCENTILE_MIN_SAMPLE,
  SIZE_MEDIAN_MULTIPLE,
  SIZE_MIN_SAMPLE,
  DEGENERATE_SIMILARITY,
  DEGENERATE_MIN_WORDS,
  PROVENANCE_PATTERNS,
  rowBytes,
  median,
  corpusRowMedian,
  corpusSizeBaseline,
  overLongRows,
  findProvenance,
  extractTables,
  similarity,
  findDegenerateRows,
  auditText,
  auditCorpus,
  hasFindings,
  formatBloatReport,
  bloatReport,
};
