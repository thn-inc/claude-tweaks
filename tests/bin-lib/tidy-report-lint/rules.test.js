'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  RULES,
  SURFACES,
  lintReport,
} = require('../../../plugin/bin/lib/tidy-report-lint/rules');
const { conformantReport, condensedReport, longFullReport } = require('./fixtures');

test('lintReport: a known-conformant rendered report produces zero output', () => {
  assert.deepEqual(lintReport(conformantReport()), []);
});

test('RULES: row names match step-6-auto.md conformance scan table, in table order', () => {
  const names = RULES.map((r) => r.name);
  assert.deepEqual(names, [
    'Width',
    'Titles',
    'Aligned',
    'One record per row',
    'No shorthand',
    'Command alone',
    'Every Yours row covered',
    'Batch only where allowed',
    'Fenced, no box art',
    'Group order',
    'Clean shape',
    'Footer once',
    'Condense',
  ]);
});

test('Width: flags a line over 100 characters', () => {
  const text = `${conformantReport().split('\n')[2]}\n${'x'.repeat(101)}\n`;
  const issue = RULES.find((r) => r.name === 'Width').check(text);
  assert.match(issue, /^Width: line 2 is 101 chars \(max 100\)$/);
});

test('Width: a 100-char line is fine, 101 is not', () => {
  const check = RULES.find((r) => r.name === 'Width').check;
  assert.equal(check('x'.repeat(100)), null);
  assert.match(check('x'.repeat(101)), /^Width:/);
});

test('Titles: flags a title column over 50 characters', () => {
  const check = RULES.find((r) => r.name === 'Titles').check;
  const longTitle = 'x'.repeat(51);
  const okTitle = 'x'.repeat(50);
  assert.match(check(`deleted   #101  ${longTitle}  commit abc1234`), /^Titles: line 1/);
  assert.equal(check(`deleted   #101  ${okTitle}  commit abc1234`), null);
});

test('Aligned: a known-conformant report has consistent trailing-column offsets', () => {
  assert.equal(RULES.find((r) => r.name === 'Aligned').check(conformantReport()), null);
});

test('Aligned: flags a mis-padded Applied-automatically row', () => {
  const lines = conformantReport().split('\n');
  const idx = lines.findIndex((l) => l.startsWith('deleted'));
  lines[idx] = lines[idx].replace(/\s+commit/, ' commit'); // collapse to a single space, shifting the offset
  const issue = RULES.find((r) => r.name === 'Aligned').check(lines.join('\n'));
  assert.match(issue, /^Aligned: line \d+ trailing column starts at \d+, expected \d+$/);
});

test('Aligned: an indented detail sub-line under an Applied row is not a mis-aligned row', () => {
  const lines = conformantReport().split('\n');
  const idx = lines.findIndex((l) => l.startsWith('deleted'));
  lines.splice(idx + 1, 0, '   Made widget lookups faster for every dashboard that reads them.');
  assert.equal(RULES.find((r) => r.name === 'Aligned').check(lines.join('\n')), null);
});

test('Aligned: a mis-padded col-0 Applied row is still flagged when a sub-line sits beside it', () => {
  const lines = conformantReport().split('\n');
  const idx = lines.findIndex((l) => l.startsWith('deleted'));
  lines[idx] = lines[idx].replace(/\s+commit/, ' commit');
  lines.splice(idx + 1, 0, '   Made widget lookups faster.');
  assert.match(RULES.find((r) => r.name === 'Aligned').check(lines.join('\n')), /^Aligned: line \d+ trailing column starts at \d+, expected \d+$/);
});

test('One record per row: a bare row with two #N refs is flagged; a batch command line is not', () => {
  const check = RULES.find((r) => r.name === 'One record per row').check;
  assert.match(check('   #1  Some title (likewise #2)'), /^One record per row: line 1 carries 2 record refs/);
  assert.equal(check('   /claude-tweaks:flow #1,#2'), null);
});

test('No shorthand: flags every documented shorthand form', () => {
  const check = RULES.find((r) => r.name === 'No shorthand').check;
  for (const line of ['(likewise #41)', '(also #9)', '(and 3 more)', '(+5)', 'et al']) {
    assert.match(check(line), /^No shorthand:/, `expected a hit for "${line}"`);
  }
  assert.equal(check('a normal row with no shorthand'), null);
});

test('Command alone: flags a leading em-dash/arrow before a command', () => {
  const check = RULES.find((r) => r.name === 'Command alone').check;
  assert.match(check('   — /claude-tweaks:flow #1'), /^Command alone:/);
  assert.match(check('   → git log -1'), /^Command alone:/);
  assert.equal(check('   /claude-tweaks:flow #1'), null);
});

test('Every Yours row covered: flags a group with no closing command line; "review" is exempt', () => {
  const check = RULES.find((r) => r.name === 'Every Yours row covered').check;
  const missing = [
    '**Yours (1)**',
    '```text',
    'git (1)',
    '   #302  Archived branch to review                         requires human judgment',
    '```',
  ].join('\n');
  assert.match(check(missing), /^Every Yours row covered: group "git \(1\)" has no closing command line$/);

  const reviewGroup = [
    '**Yours (1)**',
    '```text',
    'review (1)',
    '   #303  A pattern observation                             see docs/patterns.md',
    '```',
  ].join('\n');
  assert.equal(check(reviewGroup), null);
});

test('Batch only where allowed: flags a batch line on a non-batchable command', () => {
  const check = RULES.find((r) => r.name === 'Batch only where allowed').check;
  const badBatch = [
    '**Yours (2)**',
    '```text',
    'git (2)',
    '   #401  A                                                  why',
    '   #402  B                                                  why',
    '   gh issue close #401,#402',
    '```',
  ].join('\n');
  assert.match(check(badBatch), /^Batch only where allowed:.*non-batchable command "gh"$/);

  const goodBatch = [
    '**Yours (2)**',
    '```text',
    '/claude-tweaks:specify (2)',
    '   #401  A                                                  why',
    '   #402  B                                                  why',
    '   /claude-tweaks:specify #401,#402',
    '```',
  ].join('\n');
  assert.equal(check(goodBatch), null);
});

test('Fenced, no box art: flags a box-drawing character anywhere', () => {
  const check = RULES.find((r) => r.name === 'Fenced, no box art').check;
  assert.match(check('┌ a table border ┐'), /^Fenced, no box art: line 1 contains a box-drawing character$/);
});

test('Fenced, no box art: flags a section header not immediately followed by a fence', () => {
  const check = RULES.find((r) => r.name === 'Fenced, no box art').check;
  const text = '**Applied automatically**\nnot a fence\n';
  assert.match(check(text), /^Fenced, no box art: section "Applied automatically" is not followed by a fence$/);
});

test('Group order: flags Yours groups out of the fixed+alphabetical order', () => {
  const check = RULES.find((r) => r.name === 'Group order').check;
  const wrongOrder = [
    '**Yours (2)**',
    '```text',
    'git (1)',
    '   #1  A                                                    why',
    '   git log -1',
    '/claude-tweaks:specify (1)',
    '   #2  B                                                    why',
    '   /claude-tweaks:specify #2',
    '```',
  ].join('\n');
  assert.match(check(wrongOrder), /^Group order:/);
});

test('Clean shape: flags a scan line that does not end in "{count} checked"', () => {
  const check = RULES.find((r) => r.name === 'Clean shape').check;
  const bad = '**Clean:**\n```text\nresidue not-a-count\n```\n';
  assert.match(check(bad), /^Clean shape: line 3 does not match/);
  const good = '**Clean:**\n```text\nresidue             12 checked\norphaned-plans       — checked\n```\n';
  assert.equal(check(good), null);
  assert.equal(check('**Clean:** nothing — every scan surfaced findings\n'), null);
});

test('Footer once: flags zero and multiple occurrences of decisions.md', () => {
  const check = RULES.find((r) => r.name === 'Footer once').check;
  assert.match(check('no footer here'), /^Footer once: "decisions\.md" appears 0 times/);
  assert.match(check('a/decisions.md\nb/decisions.md'), /^Footer once: "decisions\.md" appears 2 times/);
  assert.equal(check('Full decision log: run-dir/decisions.md'), null);
});

test('Condense: flags an over-40-line report with no report.md footer; a short report is exempt', () => {
  const check = RULES.find((r) => r.name === 'Condense').check;
  const over40 = `${'line\n'.repeat(41)}`;
  assert.match(check(over40), /^Condense: report is 42 lines \(over 40\)/);
  const over40WithFooter = `${'line\n'.repeat(41)}Full report: run-dir/report.md\n`;
  assert.equal(check(over40WithFooter), null);
  assert.equal(check('line\n'.repeat(10)), null);
});

// #1625: surface-scoping. step-6-auto.md's Conformance scan intro documents
// a 7-rule/6-rule split for when the condense rule has split a report into
// a condensed chat render and a separate report.md — see step-6-auto.md's
// "Against a condensed report, only ... apply" sentence.

test('RULES: surface tags split 12 of the 13 rules into the documented condensed/full partition, plus one rule tagged "both"', () => {
  const condensed = RULES.filter((r) => r.surface === 'condensed').map((r) => r.name);
  const full = RULES.filter((r) => r.surface === 'full').map((r) => r.name);
  const both = RULES.filter((r) => r.surface === 'both').map((r) => r.name);
  assert.deepEqual(condensed, [
    'Width',
    'Titles',
    'Aligned',
    'No shorthand',
    'Command alone',
    'Batch only where allowed',
    'Condense',
  ]);
  assert.deepEqual(full, [
    'One record per row',
    'Fenced, no box art',
    'Group order',
    'Clean shape',
    'Footer once',
  ]);
  // "Every Yours row covered" is the one row step-6-auto.md's Conformance
  // scan intro names as applying on top of whichever surface-tagged set is
  // active, not inside either partition alone (#1625 follow-up).
  assert.deepEqual(both, ['Every Yours row covered']);
  // The three groups are disjoint and exhaustive — no untagged row, none
  // double-counted.
  assert.equal(condensed.length + full.length + both.length, RULES.length);
});

test('SURFACES: exposes the two valid surface values', () => {
  assert.deepEqual([...SURFACES].sort(), ['condensed', 'full']);
});

test('lintReport: surface="condensed" runs the 7 condensed-scoped rules plus the "both"-scoped one', () => {
  const names = new Set(RULES.filter((r) => r.surface === 'condensed' || r.surface === 'both').map((r) => r.name));
  // A report that fails a full-only rule (missing decisions.md footer) but
  // is otherwise clean must produce no issues when scoped to "condensed".
  const text = conformantReport().replace(/Full decision log:.*\n?$/, '');
  const issues = lintReport(text, { surface: 'condensed' });
  for (const issue of issues) {
    const ruleName = issue.split(':')[0];
    assert.ok(names.has(ruleName), `unexpected rule "${ruleName}" fired under surface="condensed"`);
  }
});

test('lintReport: surface="condensed" still catches a condensed report whose Yours section drops its command lines (the gap this rule closes)', () => {
  const broken = condensedReport().replace('   /claude-tweaks:specify #301\n', '');
  const issues = lintReport(broken, { surface: 'condensed' });
  assert.ok(
    issues.some((i) => i.startsWith('Every Yours row covered')),
    `expected an "Every Yours row covered" issue under surface="condensed", got: ${JSON.stringify(issues)}`,
  );
});

test('lintReport: surface="full" runs the 5 section-shape rules plus the "both"-scoped one', () => {
  const names = new Set(RULES.filter((r) => r.surface === 'full' || r.surface === 'both').map((r) => r.name));
  // A report over the 40-line Condense threshold with no report.md footer
  // would fail "Condense" (a condensed-only rule) but must produce no
  // issues when scoped to "full".
  const issues = lintReport(longFullReport(), { surface: 'full' });
  for (const issue of issues) {
    const ruleName = issue.split(':')[0];
    assert.ok(names.has(ruleName), `unexpected rule "${ruleName}" fired under surface="full"`);
  }
  assert.deepEqual(issues, []);
});

test('lintReport: an invalid surface value throws', () => {
  assert.throws(() => lintReport(conformantReport(), { surface: 'bogus' }), /surface must be "condensed" or "full"/);
});

test('#1625 regression: a genuinely condensed report false-positives on Footer once/Clean shape/Fenced-no-box-art when linted unscoped, but not under surface="condensed"', () => {
  const unscoped = lintReport(condensedReport());
  assert.deepEqual(unscoped, [
    'Fenced, no box art: section "Applied automatically" is not followed by a fence',
    'Clean shape: line 20 is neither the no-findings sentence nor bare "**Clean:**"',
    'Footer once: "decisions.md" appears 0 times (expected exactly 1)',
  ]);
  assert.deepEqual(lintReport(condensedReport(), { surface: 'condensed' }), []);
});

test('#1625 regression: a full report.md over 40 lines false-positives on Condense when linted unscoped, but not under surface="full"', () => {
  const text = longFullReport();
  assert.ok(text.split('\n').length > 40, 'fixture must exceed the 40-line Condense threshold');
  assert.ok(!/report\.md/.test(text), 'report.md must carry no self-reference to report.md');
  const unscoped = lintReport(text);
  assert.equal(unscoped.length, 1);
  assert.match(unscoped[0], /^Condense: report is \d+ lines \(over 40\) with no "Full report: \{run-dir\}\/report\.md" footer$/);
  assert.deepEqual(lintReport(text, { surface: 'full' }), []);
});
