'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const {
  ROW_LENGTH_MULTIPLE,
  MIN_ROW_SAMPLE,
  PROVENANCE_PATTERNS,
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
  formatBloatReport,
  bloatReport,
} = require('../../../plugin/bin/lib/skill-audit/bloat.js');

const REPO = path.join(__dirname, '..', '..', '..');

// A minimal skill body with one Anti-Patterns table, parameterised by rows.
const skillWith = (rows) => [
  '# A skill', '',
  '## Anti-Patterns', '',
  '| Pattern | Why It Fails |',
  '|---------|--------------|',
  ...rows,
  '',
].join('\n');

const SHORT_ROW = '| Skipping the test gate | `TEST_PASSED=true` is the contract |';

// ── Signal 1: over-long rows ────────────────────────────────────────────────

test('median handles both parities', () => {
  assert.strictEqual(median([1, 2, 3]), 2);
  assert.strictEqual(median([1, 2, 3, 4]), 3); // rounded midpoint of 2 and 3
  assert.strictEqual(median([]), null);
});

test('corpusRowMedian reports its sample and refuses a baseline below the floor', () => {
  const thin = corpusRowMedian([{ text: skillWith([SHORT_ROW, SHORT_ROW]) }]);
  assert.strictEqual(thin.sample, 2);
  assert.strictEqual(thin.usable, false, 'two rows must not establish a corpus baseline');

  const thick = corpusRowMedian(
    Array.from({ length: MIN_ROW_SAMPLE }, () => ({ text: skillWith([SHORT_ROW]) })),
  );
  assert.strictEqual(thick.sample, MIN_ROW_SAMPLE);
  assert.strictEqual(thick.usable, true);
});

test('corpusSizeBaseline reports its sample and recognizes the 5-file floor', () => {
  // Below floor: 4 files
  const tooFew = corpusSizeBaseline(Array.from({ length: 4 }, (_, i) => ({ bytes: 1000 * (i + 1) })));
  assert.strictEqual(tooFew.sample, 4);
  assert.strictEqual(tooFew.usable, false, 'four files must not establish a corpus baseline');

  // At floor: exactly 5 files
  const atFloor = corpusSizeBaseline(Array.from({ length: 5 }, (_, i) => ({ bytes: 1000 * (i + 1) })));
  assert.strictEqual(atFloor.sample, 5);
  assert.strictEqual(atFloor.usable, true, 'five files must establish a corpus baseline');
  assert.strictEqual(atFloor.method, 'median-multiple', 'below 20 files uses median-multiple');

  // Above percentile floor: 20 files
  const plenty = corpusSizeBaseline(Array.from({ length: 20 }, (_, i) => ({ bytes: 1000 * (i + 1) })));
  assert.strictEqual(plenty.sample, 20);
  assert.strictEqual(plenty.usable, true);
  assert.strictEqual(plenty.method, 'p95', 'at or above 20 files uses p95');
});

// Discrimination: the same file, one row inflated past the multiple, is caught;
// a row that merely sits above the median is not.
test('over-long rows: the inflated row fails, the merely-above-median row passes', () => {
  const baselineMedian = 150;
  const threshold = baselineMedian * ROW_LENGTH_MULTIPLE; // 300 B

  const honest = `| A pattern name | ${'x'.repeat(200)} |`;
  const inflated = `| A pattern name | ${'x'.repeat(400)} |`;

  assert.deepStrictEqual(
    overLongRows(skillWith([honest]), baselineMedian).map((r) => r.line),
    [],
    `a ${200 + 15} B row is above the median but under the ${threshold} B threshold`,
  );

  const flagged = overLongRows(skillWith([inflated]), baselineMedian);
  assert.strictEqual(flagged.length, 1);
  assert.ok(flagged[0].bytes > threshold);
});

test('no baseline means no over-long-row findings, not zero findings by accident', () => {
  const inflated = `| A pattern name | ${'x'.repeat(400)} |`;
  assert.deepStrictEqual(overLongRows(skillWith([inflated]), null), []);
});

// ── Signal 2: provenance narration ──────────────────────────────────────────
//
// Each case pairs the bloat form with a legitimate counterexample taken from
// this repo's own prose. The counterexample is the point: single-word patterns
// were rejected precisely because these lines exist.

const PROVENANCE_CASES = [
  {
    id: 'own-prior-behavior',
    bloat: "files every surviving finding regardless of confidence, matching this skill's pre-existing behavior.",
    legit: 'For any task modifying pre-existing behavior, write a quick smoke test capturing current output.',
  },
  {
    id: 'behavior-unchanged-aside',
    bloat: 'The dispatch now reads the cursor directly — behavior unchanged.',
    legit: 'Declining any offer here falls through to their existing behavior unchanged.',
  },
  {
    id: 'existing-precedent',
    bloat: 'The flag is spelled `--min-confidence`, mirroring the existing precedent in `/code-health`.',
    legit: 'A precedent set by an earlier record does not authorize skipping the gate.',
  },
  {
    id: 'audit-outcome',
    bloat: '`/claude-tweaks:init` Phase 6 — verified, no change needed.',
    legit: 'Verify the regenerated content still matches the project state before closing the issue.',
  },
  {
    id: 'sibling-remediation',
    bloat: '`docs-health` closed the same gap the same way in the same pass.',
    legit: 'Close the issue once the gap between the two files is gone.',
  },
  {
    id: 'edit-status-marker',
    bloat: '| **7. Template/structural conformance** (new) | Does this still match its generator? |',
    legit: 'Pass `--force-gap-scan` to force a new scan regardless of the cursor.',
  },
  {
    id: 'then-versus-now',
    bloat: 'A 25-finding review previously fanned out to 25 unbounded agents; it now dispatches at most 10.',
    legit: 'Suppress recommendations the user previously declined for the same spec.',
  },
];

test('every declared pattern has a case pair', () => {
  assert.deepStrictEqual(
    PROVENANCE_PATTERNS.map((p) => p.id).sort(),
    PROVENANCE_CASES.map((c) => c.id).sort(),
  );
});

for (const { id, bloat, legit } of PROVENANCE_CASES) {
  test(`provenance '${id}': fires on the narration, silent on the legitimate line`, () => {
    const onBloat = findProvenance(bloat).map((h) => h.id);
    assert.ok(onBloat.includes(id), `pattern ${id} did not fire on its own bloat case`);

    const onLegit = findProvenance(legit).map((h) => h.id);
    assert.ok(
      !onLegit.includes(id),
      `pattern ${id} fired on a legitimate line — it is too broad: ${legit}`,
    );
  });
}

// The live-corpus precision guard. /build's task briefs instruct on modifying
// the *code under test*'s pre-existing behavior; a looser pattern turns three
// real instructions into noise, and nothing else in this suite would notice.
test('does not flag /build\'s legitimate "pre-existing behavior" instructions', () => {
  const buildSkill = fs.readFileSync(path.join(REPO, 'plugin', 'skills', 'build', 'SKILL.md'), 'utf8');
  const hits = findProvenance(buildSkill);
  assert.deepStrictEqual(
    hits.map((h) => `L${h.line} ${h.id}`),
    [],
    'build/SKILL.md contains no provenance narration, only runtime instructions',
  );
});

// ── Signal 3: degenerate tables ─────────────────────────────────────────────

test('extractTables separates header from body and drops separator rows', () => {
  const tables = extractTables(skillWith([SHORT_ROW, SHORT_ROW]));
  assert.strictEqual(tables.length, 1);
  assert.deepStrictEqual(tables[0].header, ['Pattern', 'Why It Fails']);
  assert.strictEqual(tables[0].rows.length, 2);
});

test('similarity ignores markdown emphasis and punctuation', () => {
  assert.strictEqual(similarity('`Stage` — never auto-applied here', 'Stage, never auto-applied here'), 1);
  assert.strictEqual(similarity('', 'anything'), 0);
});

const tableWith = (rows) => ['| Case | Outcome |', '|---|---|', ...rows, ''].join('\n');

test('degenerate tables: repeated prose fails, a repeated verdict enum passes', () => {
  const prose = 'Stage it; never auto-applied per the auto-mode contract reversibility floor';
  const repeatedProse = tableWith([
    `| A | ${prose} |`,
    `| B | ${prose} |`,
  ]);
  const flagged = findDegenerateRows(repeatedProse);
  assert.strictEqual(flagged.length, 1, 'two adjacent rows carrying one sentence is the defect');
  assert.strictEqual(flagged[0].exact, true);

  // The same shape with a short verdict column is a decision matrix doing its
  // job. Measured: without this floor the live corpus yields 87 such pairs.
  const verdicts = tableWith(['| A | Auto-apply |', '| B | Auto-apply |', '| C | Auto-apply |']);
  assert.deepStrictEqual(findDegenerateRows(verdicts), []);
});

test('degenerate tables: deliberately parallel rows below the similarity floor pass', () => {
  // The 0.7-0.8 band on the live corpus is this shape — the single varying word
  // IS the row's content, so the table is not saying one thing N times.
  // Verbatim from skills/design-wrapper/command-map.md, which measures 0.78.
  const parallel = tableWith([
    '| typography | Only when `audit` flagged a matching typography issue |',
    '| layout | Only when `audit` flagged a matching layout issue |',
  ]);
  assert.deepStrictEqual(findDegenerateRows(parallel), []);

  // Raise the same pair above the floor by rewording only one clause, and it
  // is caught — the "same sentence, one clause reworded" shape.
  const reworded = tableWith([
    '| a | The record is meant to be safe to commit; account-scoped identifiers do not belong in a repo |',
    '| b | The record is meant to be safe to commit — account-scoped credentials do not belong in a repo |',
  ]);
  assert.strictEqual(findDegenerateRows(reworded).length, 1);
});

test('degenerate detection never pairs rows across two different tables', () => {
  const prose = 'Stage it; never auto-applied per the auto-mode contract reversibility floor';
  const twoTables = `${tableWith([`| A | ${prose} |`])}\nSome prose between them.\n\n${tableWith([`| B | ${prose} |`])}`;
  assert.deepStrictEqual(findDegenerateRows(twoTables), []);
});

// ── Composition ─────────────────────────────────────────────────────────────

test('formatBloatReport says NO BASELINE rather than reporting a clean row check', () => {
  const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'bloat-'));
  const file = path.join(dir, 'SKILL.md');
  fs.writeFileSync(file, skillWith([SHORT_ROW, SHORT_ROW]));

  const report = formatBloatReport(auditCorpus([file]));
  assert.match(report, /NO BASELINE/);
  assert.match(report, /no bloat signals/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('bloatReport reports only the target and dedupes it out of its own corpus', () => {
  const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'bloat-'));
  const long = `| A pattern | ${'x'.repeat(400)} |`;
  const target = path.join(dir, 'target.md');
  const sibling = path.join(dir, 'sibling.md');
  fs.writeFileSync(target, skillWith([long]));
  fs.writeFileSync(sibling, skillWith(Array.from({ length: MIN_ROW_SAMPLE }, () => SHORT_ROW)));

  // Target listed twice, exactly as a shell glob would produce.
  const report = bloatReport(target, [target, sibling]);
  assert.ok(report.includes('target.md'));
  assert.ok(!report.includes('sibling.md'), 'siblings supply the baseline, not findings');
  assert.strictEqual(
    (report.match(/long-row/g) || []).length, 1,
    'a duplicated target path must not double-report its findings',
  );
  // MIN_ROW_SAMPLE short rows plus the one long row clears the sample floor.
  assert.match(report, /row baseline: median \d+ B over \d+ rows/);

  // An unmatched shell glob arrives as a literal path; it must not take the
  // whole scan down with an ENOENT.
  const withDeadGlob = bloatReport(target, [path.join(dir, 'nope', '*', 'SKILL.md'), sibling]);
  assert.ok(withDeadGlob.includes('target.md'));

  fs.rmSync(dir, { recursive: true, force: true });
});

// ── Signal 4: size outliers ────────────────────────────────────────────────

test('size outlier: p95 tier baseline with 20 files', () => {
  const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'size-'));
  const files = [];
  // 20 files: 10 at 1000 B, then 10000 B, 11000 B, ..., 19000 B
  for (let i = 1; i <= 20; i += 1) {
    const file = path.join(dir, `file-${i}.md`);
    const content = skillWith([SHORT_ROW]);
    fs.writeFileSync(file, content, 'utf8');
    // Pad with filler bytes to reach target size
    const target = i <= 10 ? 1000 : (i - 1) * 1000;
    const padding = 'x'.repeat(target - Buffer.byteLength(content, 'utf8'));
    fs.appendFileSync(file, padding);
    files.push(file);
  }

  const result = auditCorpus(files);
  assert.ok(result.sizeBaseline.usable, 'p95 baseline must be usable with 20 files');
  assert.strictEqual(result.sizeBaseline.sample, 20);
  assert.strictEqual(result.sizeBaseline.method, 'p95');
  // p95 nearest-rank: index = Math.ceil(0.95 * 20) - 1 = 18, so 18000 B.
  // The 3x median floor is 3 * 5500 = 16500 B, below p95, so p95 wins.
  assert.strictEqual(result.sizeBaseline.threshold, 18000);

  // Only the 19,000 B file (last one) should be an outlier
  const outliers = result.files.filter((f) => f.sizeOutlier);
  assert.strictEqual(outliers.length, 1, 'only the 19,000 B file should be an outlier');
  assert.ok(outliers[0].file.includes('file-20'));

  // Check the literal report-line text (AC1)
  const report = formatBloatReport(result);
  assert.match(report, /size baseline: p95 \(floor 3× median\) 18000 B over 20 files/);
  assert.match(report, /size-outlier: 19000 B, above the corpus threshold of 18000 B/);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('size outlier: a uniform 20+ file corpus flags nothing — the p95 threshold is floored at 3x median (#3305 F1)', () => {
  const files = Array.from({ length: 20 }, (_, i) => ({ file: `f${i}.md`, bytes: 10000 + i * 10 }));
  const b = corpusSizeBaseline(files);
  assert.strictEqual(b.method, 'p95');
  assert.ok(files.every((f) => f.bytes <= b.threshold), `threshold ${b.threshold} must cover a uniform corpus`);
});

test('size outlier: the 19 to 20 file tier edge no longer flips a verdict (#3305 F1)', () => {
  const nineteen = [...Array.from({ length: 18 }, () => ({ bytes: 5000 })), { bytes: 14000 }];
  const twenty = [...nineteen, { bytes: 5000 }];
  assert.ok(14000 <= corpusSizeBaseline(nineteen).threshold);
  assert.ok(14000 <= corpusSizeBaseline(twenty).threshold);
});

test('size outlier: median-multiple tier baseline with 10 files', () => {
  const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'size-'));
  const files = [];
  // 9 files of 1000 B each, 1 file of 5000 B
  const content = skillWith([SHORT_ROW]);
  for (let i = 0; i < 9; i += 1) {
    const file = path.join(dir, `small-${i}.md`);
    fs.writeFileSync(file, content, 'utf8');
    const padding = 'x'.repeat(1000 - Buffer.byteLength(content, 'utf8'));
    fs.appendFileSync(file, padding);
    files.push(file);
  }
  const largeFile = path.join(dir, 'large.md');
  fs.writeFileSync(largeFile, content, 'utf8');
  const padding = 'x'.repeat(5000 - Buffer.byteLength(content, 'utf8'));
  fs.appendFileSync(largeFile, padding);
  files.push(largeFile);

  const result = auditCorpus(files);
  assert.ok(result.sizeBaseline.usable, 'median-multiple baseline must be usable with 10 files');
  assert.strictEqual(result.sizeBaseline.sample, 10);
  assert.strictEqual(result.sizeBaseline.method, 'median-multiple');
  // median of [1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 5000] = 1000
  // 3 * 1000 = 3000
  assert.strictEqual(result.sizeBaseline.threshold, 3000);

  // Only the 5000 B file should be an outlier
  const outliers = result.files.filter((f) => f.sizeOutlier);
  assert.strictEqual(outliers.length, 1, 'only the 5000 B file should be an outlier');
  assert.ok(outliers[0].file.includes('large'));

  // Check the literal report-line text (AC2)
  const report = formatBloatReport(result);
  assert.match(report, /size baseline: 3× median 3000 B over 10 files/);
  assert.match(report, /size-outlier: 5000 B, above the corpus threshold of 3000 B/);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('size outlier: floor — fewer than 5 files has no baseline', () => {
  const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'size-'));
  const files = [];
  for (let i = 1; i <= 4; i += 1) {
    const file = path.join(dir, `file-${i}.md`);
    fs.writeFileSync(file, skillWith([SHORT_ROW]), 'utf8');
    files.push(file);
  }

  const result = auditCorpus(files);
  assert.strictEqual(result.sizeBaseline.usable, false, 'baseline must be unusable under 5 files');
  assert.strictEqual(result.sizeBaseline.method, null);
  assert.strictEqual(result.sizeBaseline.threshold, null);

  // No file should be an outlier
  const outliers = result.files.filter((f) => f.sizeOutlier);
  assert.strictEqual(outliers.length, 0, 'no outliers when baseline not usable');

  // Check the full NO BASELINE line (AC3)
  const report = formatBloatReport(result);
  assert.match(report, /size baseline: NO BASELINE — 4 files is under the 5-file floor, so the size-outlier signal was not evaluated/);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('size outlier: boundary — at threshold not outlier, one byte above is', () => {
  const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'size-'));
  const padding = 'x'.repeat(100);
  const files = [];

  // Create 20 files of base size (should all be 1000 + 100 = 1100 B)
  for (let i = 0; i < 20; i += 1) {
    const file = path.join(dir, `file-${i}.md`);
    const content = skillWith([SHORT_ROW]);
    fs.writeFileSync(file, content);
    fs.appendFileSync(file, padding);
    files.push(file);
  }

  const result = auditCorpus(files);
  const threshold = result.sizeBaseline.threshold;

  // Create a file exactly at threshold
  const atThreshold = path.join(dir, 'at-threshold.md');
  const atContent = skillWith([SHORT_ROW]);
  fs.writeFileSync(atThreshold, atContent);
  const atPadding = 'x'.repeat(threshold - Buffer.byteLength(atContent, 'utf8'));
  fs.appendFileSync(atThreshold, atPadding);

  const resultAt = auditCorpus([...files, atThreshold]);
  const atFile = resultAt.files.find((f) => f.file === atThreshold);
  assert.strictEqual(atFile.sizeOutlier, false, 'file exactly at threshold is not an outlier');

  // Create a file one byte above threshold
  const aboveThreshold = path.join(dir, 'above-threshold.md');
  const aboveContent = skillWith([SHORT_ROW]);
  fs.writeFileSync(aboveThreshold, aboveContent);
  const abovePadding = 'x'.repeat(threshold - Buffer.byteLength(aboveContent, 'utf8') + 1);
  fs.appendFileSync(aboveThreshold, abovePadding);

  const resultAbove = auditCorpus([...files, aboveThreshold]);
  const aboveFile = resultAbove.files.find((f) => f.file === aboveThreshold);
  assert.strictEqual(aboveFile.sizeOutlier, true, 'file one byte above threshold is an outlier');

  fs.rmSync(dir, { recursive: true, force: true });
});

test('size outlier: dedup — target listed twice yields sample of 20, not 21', () => {
  const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'size-'));
  const files = [];
  const target = path.join(dir, 'target.md');
  fs.writeFileSync(target, skillWith([SHORT_ROW]), 'utf8');
  files.push(target);

  // 19 other files
  for (let i = 0; i < 19; i += 1) {
    const file = path.join(dir, `sibling-${i}.md`);
    fs.writeFileSync(file, skillWith([SHORT_ROW]), 'utf8');
    files.push(file);
  }

  // Add target a second time
  files.push(target);

  const result = auditCorpus(files);
  assert.strictEqual(result.sizeBaseline.sample, 20, 'duplicated target must be deduped to sample 20');

  fs.rmSync(dir, { recursive: true, force: true });
});

test('size outlier: suppression with { sizeOutlier: false } prints no size-outlier lines', () => {
  const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'size-'));
  const files = [];
  for (let i = 1; i <= 20; i += 1) {
    const file = path.join(dir, `file-${i}.md`);
    const content = skillWith([SHORT_ROW]);
    fs.writeFileSync(file, content, 'utf8');
    const padding = 'x'.repeat(i * 1000 - Buffer.byteLength(content, 'utf8'));
    fs.appendFileSync(file, padding);
    files.push(file);
  }

  const result = auditCorpus(files, { sizeOutlier: false });
  // All files should have sizeOutlier: false
  assert.ok(result.files.every((f) => f.sizeOutlier === false), 'all files must have sizeOutlier false');

  // sizeBaseline must stay honest: real sample count, suppressed flag set
  assert.strictEqual(result.sizeBaseline.sample, 20, 'baseline sample must reflect real corpus size');
  assert.strictEqual(result.sizeBaseline.suppressed, true, 'baseline must be marked as suppressed');

  // Formatreport should not contain any size-outlier or size baseline lines
  const report = formatBloatReport(result);
  assert.ok(!report.includes('size-outlier:'), 'report must not contain size-outlier lines when suppressed');
  assert.ok(!report.includes('size baseline:'), 'report must not contain size baseline line when suppressed');

  fs.rmSync(dir, { recursive: true, force: true });
});

test('prose-twin conformance: both prose files list the same signals and guard', () => {
  const harnessProse = fs.readFileSync(
    path.join(REPO, 'plugin', 'skills', '_shared', 'harness-health-analysis.md'),
    'utf8',
  );
  const judgeProse = fs.readFileSync(
    path.join(REPO, 'plugin', 'skills', 'harness-health', 'judge-procedure.md'),
    'utf8',
  );

  // Extract signal-list sentences: "It reports [number] signals: ..."
  const signalListRegex = /It reports (\w+) signals: ([^.]+)\./i;
  const harnessMatch = harnessProse.match(signalListRegex);
  const judgeMatch = judgeProse.match(signalListRegex);

  assert.ok(harnessMatch, 'harness-health-analysis.md must contain signal-list sentence');
  assert.ok(judgeMatch, 'judge-procedure.md must contain signal-list sentence');

  // Extract the full sentences (including "It reports ... signals:")
  const harnessSignalList = harnessMatch[0];
  const judgeSignalList = judgeMatch[0];

  // Assert they're identical
  assert.strictEqual(
    harnessSignalList,
    judgeSignalList,
    'Signal-list sentences must be identical between prose files',
  );

  // Assert the sentence names four signals including the size signal
  assert.ok(
    harnessSignalList.includes('four signals'),
    'Signal list must explicitly mention "four signals"',
  );
  assert.ok(
    harnessSignalList.includes('skill file far larger than its siblings'),
    'Signal list must mention size outliers',
  );

  // Extract and assert the size-outlier guard bullet text is identical
  const sizeGuardBulletRegex = /- \*\*Size outliers\.\*\* ([^\n]+)/;
  const harnessGuardMatch = harnessProse.match(sizeGuardBulletRegex);
  const judgeGuardMatch = judgeProse.match(sizeGuardBulletRegex);

  assert.ok(harnessGuardMatch, 'harness-health-analysis.md must contain size-outlier guard bullet');
  assert.ok(judgeGuardMatch, 'judge-procedure.md must contain size-outlier guard bullet');

  assert.strictEqual(
    harnessGuardMatch[0],
    judgeGuardMatch[0],
    'Size-outlier guard bullets must be identical between prose files',
  );
});

// Prose ↔ code pin: the signal list both judging procedures restate must name
// exactly the signals auditText returns, so a signal added to or removed from
// bloat.js without the prose following fails here rather than at the next audit.
// The frozen excerpt is the pre-#3310 sentence; it must fail against today's live signal set.
const SIGNAL_COUNT_WORDS = { three: 3, four: 4, five: 5, six: 6, seven: 7 };
const FIVE_SIGNAL_EXCERPT = 'It reports five signals: files over the 50 KB soft ceiling, Anti-Pattern rows more than twice the corpus median byte length, provenance-narration phrasing (text addressed to whoever edited the file rather than to the model running it), adjacent table rows whose right-hand cells are identical or near-identical, and a skill file far larger than its siblings.';

function proseSignalCount(text) {
  const m = text.match(/(\w+) signals: ([^.]+)\./i);
  if (!m) return null;
  const items = m[2].replace(/\([^)]*\)/g, '').split(/,\s*(?:and\s+)?/).filter((s) => s.trim());
  return { stated: SIGNAL_COUNT_WORDS[m[1].toLowerCase()], items: items.length };
}

test('prose signal list names exactly the signals auditText returns', () => {
  // auditText returns four signals plus bytes (#3311 deleted overCeiling/headroom).
  const codeSignals = Object.keys(auditText('', { bytes: 0, rowMedian: null, sizeThreshold: 0 }))
    .filter((k) => k !== 'bytes');
  for (const rel of [['_shared', 'harness-health-analysis.md'], ['harness-health', 'judge-procedure.md']]) {
    const got = proseSignalCount(fs.readFileSync(path.join(REPO, 'plugin', 'skills', ...rel), 'utf8'));
    assert.ok(got, `${rel.join('/')} must contain a signal-list sentence`);
    assert.strictEqual(got.stated, codeSignals.length, `${rel.join('/')} states the wrong signal count`);
    assert.strictEqual(got.items, codeSignals.length, `${rel.join('/')} lists the wrong number of signals`);
  }
  const frozen = proseSignalCount(FIVE_SIGNAL_EXCERPT);
  assert.notStrictEqual(frozen.stated, codeSignals.length);
  assert.notStrictEqual(frozen.items, codeSignals.length);
});

test('both bloat-scan call sites suppress size outliers only for non-skill targets, and carry no ceiling option (#3311)', () => {
  for (const rel of [['_shared', 'harness-health-analysis.md'], ['harness-health', 'judge-procedure.md']]) {
    const text = fs.readFileSync(path.join(REPO, 'plugin', 'skills', ...rel), 'utf8');
    const label = rel.join('/');
    assert.match(text, /kind === 'skill' \? \{\} : \{ sizeOutlier: false \}/, `${label}: bloat call must pick options by kind`);
    assert.doesNotMatch(text, /ceiling: Infinity/, `${label}: no ceiling option`);
    assert.match(text, /bloatReport\(target, corpus, opts\)/, `${label}: bloat call must pass opts`);
    assert.doesNotMatch(text, /soft ceiling/, `${label}: no soft-ceiling signal`);
    assert.doesNotMatch(text, /\*\*Over the ceiling\.\*\*/, `${label}: guard bullet must be the rail bullet`);
    assert.match(text, /- \*\*Over the rail\.\*\* /, `${label}: rail guard bullet`);
  }
  const analysis = fs.readFileSync(path.join(REPO, 'plugin', 'skills', '_shared', 'harness-health-analysis.md'), 'utf8');
  assert.match(analysis, /composedRailViolations/, 'check 10 must go through rail.js');
  assert.doesNotMatch(analysis, /overComposedCeiling|CEILING_BYTES|COMPOSED_STEP_EXCEPTIONS/);
  const skill = fs.readFileSync(path.join(REPO, 'plugin', 'skills', 'harness-health', 'SKILL.md'), 'utf8');
  assert.doesNotMatch(skill, /overComposedCeiling/);
  assert.match(skill, /`rail:` suite/);
});

test('AC4.1: a 60,000 B skill target prints no ceiling line, and per-file objects carry no overCeiling/headroom keys', () => {
  const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'bloat-3311-'));
  try {
    const target = path.join(dir, 'big.md');
    fs.writeFileSync(target, `# Big\n\n${'word '.repeat(12000)}`);
    const sibling = path.join(dir, 'small.md');
    fs.writeFileSync(sibling, '# Small\n\ntext\n');
    assert.ok(fs.statSync(target).size >= 60000);
    assert.doesNotMatch(bloatReport(target, [sibling]), /ceiling/);
    for (const entry of auditCorpus([target, sibling]).files) {
      assert.ok(!('overCeiling' in entry), `${entry.file} still carries overCeiling`);
      assert.ok(!('headroom' in entry), `${entry.file} still carries headroom`);
    }
    assert.ok(!('ceiling' in auditCorpus([target, sibling])), 'auditCorpus still returns a ceiling');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('auditCorpus runs over the whole live skill corpus and reports a usable baseline', () => {
  const skillsDir = path.join(REPO, 'plugin', 'skills');
  const files = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.md')) files.push(p);
    }
  };
  walk(skillsDir);

  const result = auditCorpus(files);
  assert.ok(result.rowBaseline.usable, 'the live corpus must clear the sample floor');

  const totals = result.files.reduce((acc, f) => ({
    rows: acc.rows + f.longRows.length,
    provenance: acc.provenance + f.provenance.length,
    degenerate: acc.degenerate + f.degenerate.length,
  }), { rows: 0, provenance: 0, degenerate: 0 });

  // Informational, not asserted as a ratchet: these are report-only signals fed
  // to a judging step, so pinning the counts would fail on every legitimate
  // edit. What IS asserted is that the detector stays a signal rather than a
  // wall — past a few percent of the corpus nobody reads the output.
  console.log(`    bloat signals over ${files.length} files: `
    + `${totals.rows} long rows, `
    + `${totals.provenance} provenance, ${totals.degenerate} degenerate`);
  console.log(`    row baseline: median ${result.rowBaseline.median} B `
    + `over ${result.rowBaseline.sample} rows, flag above ${result.rowThreshold} B`);

  assert.ok(totals.provenance < files.length * 0.1, 'provenance patterns have gone broad');
  assert.ok(totals.rows < result.rowBaseline.sample * 0.1, 'the row multiple has gone broad');
});
