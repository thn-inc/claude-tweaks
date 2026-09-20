'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

// #685: tidy report rendering — width discipline, fenced column layout,
// command-grouped Yours, conformance scan, condense. Prose-as-implementation:
// pin the report contract's literal text so a later edit that drops a rule
// fails here, plus one mechanical check that the grouping rule's "batchable
// today" claim matches the live argument-hints it is keyed on.

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const STEP6 = read('plugin', 'skills', 'tidy', 'step-6-auto.md');

function section(text, startHeading, endHeading) {
  const start = text.indexOf(startHeading);
  assert.ok(start >= 0, `missing heading: ${startHeading}`);
  const end = endHeading ? text.indexOf(endHeading, start + startHeading.length) : text.length;
  assert.ok(end > start, `missing heading after ${startHeading}: ${endHeading}`);
  return text.slice(start, end);
}

// --- Task 1: template + Yours grouping ---

test('step-6-auto.md: report template renders every section\'s rows inside ```text fences', () => {
  const tpl = section(STEP6, '#### The report template (standalone auto)', '#### Bucket mapping');
  const fences = tpl.match(/```text/g) || [];
  assert.ok(fences.length >= 4, `expected a text fence per section (Applied/Approve/Yours/Clean), found ${fences.length}`);
  assert.match(tpl, /\*\*Applied automatically\*\*\n```text/);
  assert.match(tpl, /\*\*Approve \(\{N\}\)\*\*\n```text/);
  assert.match(tpl, /\*\*Yours \(\{N\}\)\*\*\n```text/);
  assert.match(tpl, /\*\*Clean:\*\*\n```text/);
  assert.match(tpl, /Full decision log: \{run-dir\}\/decisions\.md/);
  assert.match(tpl, /_shared\/terminal-ux\.md/, 'template cites the terminal-ux craft file');
});

test('step-6-auto.md: Yours grouping section states the group key, the fixed order, and the batch-vs-paste-block rule', () => {
  const grp = section(STEP6, '#### Yours grouping (by the command the human runs)', '### Report rules');
  assert.match(grp, /`specify`, `demo`, `git`, `capture`, `backlog refine`, then every remaining key alphabetically/);
  assert.match(grp, /argument-hint/);
  assert.match(grp, /\/claude-tweaks:flow/);
  assert.match(grp, /\/claude-tweaks:dispatch/);
  assert.match(grp, /paste block/);
  assert.match(grp, /never by scan step/i);
  assert.match(grp, /\(likewise #41 #113 …\)/);
  assert.match(grp, /never acceptable/);
});

test('step-6-auto.md: Bucket mapping Clean row is per-scan count lines, not a comma list', () => {
  const bucket = section(STEP6, '#### Bucket mapping', '#### Yours grouping');
  assert.doesNotMatch(bucket, /comma list/);
  assert.match(bucket, /\{scan\}\s+\{count\} checked/);
});

// Mechanical: the grouping rule names flow, dispatch, specify, and demo as
// today's batchable targets (#695 added specify + demo to that set). Check
// that against the live argument-hints the rule is keyed on, so the "today"
// clause cannot go stale silently.
test('grouping rule\'s batchable-today claim matches the live argument-hints', () => {
  const hint = (skill) => {
    const m = read('plugin', 'skills', skill, 'SKILL.md').match(/^argument-hint:\s*"([^"]*)"/m);
    assert.ok(m, `no argument-hint in skills/${skill}/SKILL.md`);
    return m[1];
  };
  const multi = /\[,\s*#/; // `<#n>[,#m,#o]` / `#N[,#M...]`
  assert.match(hint('flow'), multi);
  assert.match(hint('dispatch'), multi);
  assert.match(hint('specify'), multi);
  assert.match(hint('demo'), multi);
});

// --- Task 2: Report rules width discipline, condense, conformance scan ---

test('step-6-auto.md: Report rules carry the width cap, title truncation, one-fact-per-line, and the shorthand ban', () => {
  const rules = section(STEP6, '### Report rules', '#### Conformance scan');
  assert.match(rules, /\*\*100 characters\*\*/);
  assert.match(rules, /\*\*50 characters\*\*/);
  assert.match(rules, /one fact/);
  assert.match(rules, /\(likewise …\)/);
  assert.match(rules, /never substitutes for it/);
  assert.match(rules, /bans drawn table borders, not alignment/);
});

test('step-6-auto.md: Report rules state the 40-line condense rule and the report.md path', () => {
  const rules = section(STEP6, '### Report rules', '#### Conformance scan');
  assert.match(rules, /\*\*40 lines\*\*/);
  assert.match(rules, /\{run-dir\}\/report\.md/);
  assert.match(rules, /At 40 lines or fewer nothing extra is written/);
});

test('step-6-auto.md: a conformance scan sits between Report rules and the Hard gate, one row per rule with a remedy', () => {
  const rulesAt = STEP6.indexOf('### Report rules');
  const scanAt = STEP6.indexOf('#### Conformance scan (before the hard gate)');
  const gateAt = STEP6.indexOf('#### Hard gate (report before question)');
  assert.ok(rulesAt > 0 && scanAt > rulesAt && gateAt > scanAt, 'order must be Report rules → Conformance scan → Hard gate');
  const scan = STEP6.slice(scanAt, gateAt);
  assert.match(scan, /\| Rule \| Check \| Remedy on failure \|/);
  const ruleOrder = ['Width', 'Titles', 'Aligned', 'One record per row', 'No shorthand', 'Command alone', 'Every Yours row covered', 'Batch only where allowed', 'Fenced, no box art', 'Group order', 'Clean shape', 'Footer once', 'Condense'];
  const indexes = [];
  for (const rule of ruleOrder) {
    const re = new RegExp(`^\\| ${rule} \\|`, 'm');
    assert.match(scan, re, `conformance scan lacks a "${rule}" row`);
    indexes.push(scan.search(re));
  }
  for (let i = 1; i < indexes.length; i++) {
    assert.ok(indexes[i] > indexes[i - 1], `conformance scan rows out of order: "${ruleOrder[i - 1]}" (${indexes[i - 1]}) should precede "${ruleOrder[i]}" (${indexes[i]})`);
  }
  assert.match(scan, /never shipped as-is/);
});

test('step-6-auto.md: the Hard gate accepts the condensed report in place of the whole report when the condense rule fired', () => {
  const gate = section(STEP6, '#### Hard gate (report before question)');
  assert.match(gate, /when the condense rule fired, the condensed report/);
});

// --- Task 3: interactive mirror ---

const INTERACTIVE = read('plugin', 'skills', 'tidy', 'step-6-interactive.md');

test('step-6-interactive.md: template mirrors the fenced shape and still cites step-6-auto.md\'s rules instead of restating', () => {
  assert.match(INTERACTIVE, /\*\*Applied automatically\*\*\n```text/);
  assert.match(INTERACTIVE, /\*\*Approve \(\{N\}\)\*\*\n```text/);
  assert.match(INTERACTIVE, /\*\*Yours \(\{N\}\)\*\*\n```text/);
  assert.match(INTERACTIVE, /\*\*Clean:\*\*\n```text/);
  assert.match(INTERACTIVE, /stated once there — not restated here/);
  assert.match(INTERACTIVE, /Yours grouping/);
  assert.match(INTERACTIVE, /when the condense rule fired, the condensed report/);
  assert.doesNotMatch(INTERACTIVE, /\*\*Clean:\*\* \{comma list/);
});

// --- Task 4: SKILL.md Next Actions derives from Yours groups, under the ceiling ---

const TIDY_SKILL = read('plugin', 'skills', 'tidy', 'SKILL.md');

// The ceiling assertion this test used to carry alongside these four content
// assertions is retired by #1997 — the per-file tier is a warning since
// #1990 and tidy/SKILL.md has no compose call site; removal condition in
// docs/incident-log.md [IL-153].
test('tidy/SKILL.md: Next Actions derives one option per Yours group', () => {
  const na = section(TIDY_SKILL, '## Next Actions', '## Component-Skill Contract');
  assert.match(na, /Then take Yours \*\*groups\*\* \(`step-6-auto\.md`'s Yours grouping\)/);
  assert.match(na, /the group's batch command verbatim, or a paste-block group's first line verbatim/);
  assert.match(na, /\{Yours group's batch command, first paste line, or ref-less line\}/);
  assert.doesNotMatch(na, /one per Yours item/);
});

// --- Task 5: journey doc pins the new shape ---

const JOURNEY = read('docs', 'journeys', 'tidy-standalone-auto-report.md');

test('journey doc: Step 3 expects fenced aligned columns, grouped Yours, no shorthand; Step 5 covers the condense rule', () => {
  assert.match(JOURNEY, /skills\/tidy\/step-6-interactive\.md/);
  assert.match(JOURNEY, /aligned columns inside ```text fences/);
  assert.match(JOURNEY, /grouped by the command the human runs/);
  assert.match(JOURNEY, /no `\(likewise …\)` shorthand/);
  assert.match(JOURNEY, /### 5\. A wide sweep condenses/);
  assert.match(JOURNEY, /\{run-dir\}\/report\.md/);
  assert.match(JOURNEY, /## Example render/);
  // The example render itself must obey the width rule it demonstrates.
  const example = JOURNEY.slice(JOURNEY.indexOf('## Example render'));
  const fenced = example.split('\n').filter((l) => !l.startsWith('#') && !l.startsWith('**') && !l.startsWith('```') && !l.startsWith('Full ') && l.trim() !== '' && !l.startsWith('An example') && !l.startsWith('The 16 Yours'));
  for (const line of fenced) assert.ok(line.length <= 100, `example line over 100 chars: ${line}`);
});

// --- Task 6: #1383 — every Yours row carries a command/exemption, plus why-not-auto reasoning ---

test('step-6-auto.md: Why-not-auto sourcing states the two canonical reasons and forbids a blank/unfilled column', () => {
  const why = section(STEP6, '#### Why-not-auto sourcing', '### Report rules');
  assert.match(why, /outward GitHub write, never auto per reversibility floor/);
  assert.match(why, /judgment call, no mechanical fix/);
  assert.match(why, /never leave the column blank/i);
  assert.match(why, /sourced from this file's own routing table above, never re-derived per render/);
});

test('step-6-auto.md: Report rules Condense bullet requires a shared why-not-auto clause per Yours group', () => {
  const rules = section(STEP6, '### Report rules', '#### Conformance scan');
  assert.match(rules, /each followed by one shared why-not-auto clause for the group/);
});

test('step-6-auto.md: conformance scan gained Why stated + Condense why rows, and condensed scope now covers Every Yours row covered', () => {
  const scanAt = STEP6.indexOf('#### Conformance scan (before the hard gate)');
  const gateAt = STEP6.indexOf('#### Hard gate (report before question)');
  assert.ok(scanAt > 0 && gateAt > scanAt);
  const scan = STEP6.slice(scanAt, gateAt);
  assert.match(scan, /^\| Why stated \|/m, 'conformance scan lacks a "Why stated" row');
  assert.match(scan, /^\| Condense why \|/m, 'conformance scan lacks a "Condense why" row');
  const everyIdx = scan.search(/^\| Every Yours row covered \|/m);
  const whyIdx = scan.search(/^\| Why stated \|/m);
  const condenseIdx = scan.search(/^\| Condense \|/m);
  const condenseWhyIdx = scan.search(/^\| Condense why \|/m);
  assert.ok(everyIdx > 0 && whyIdx > everyIdx, '"Why stated" should follow "Every Yours row covered"');
  assert.ok(condenseIdx > 0 && condenseWhyIdx > condenseIdx, '"Condense why" should follow "Condense"');
  assert.match(
    scan,
    /Against a condensed report,[\s\S]*Every Yours row covered[\s\S]*fails this row exactly the way an omitted Approve section already fails the Hard gate/,
    'condensed scope note must extend Every Yours row covered coverage to the condensed report, not just the full report'
  );
});

test('step-6-auto.md: every Yours row carries a command or a stated review-only exemption', () => {
  const rules = section(STEP6, '### Report rules', '#### Conformance scan');
  assert.match(
    rules,
    /Every actionable line carries a paste-ready command.*or lands in \*\*Approve \(\{N\}\)\*\*/,
    'Report rules must require a command on every actionable Yours line'
  );
  const grp = section(STEP6, '#### Yours grouping (by the command the human runs)', '### Report rules');
  assert.match(
    grp,
    /No runnable command.*keys under a fixed final group, `review \(\{k\}\)`.*the group closes with no command line — the conformance scan's "Every Yours row covered" row exempts `review`/s,
    'the review group must be the one documented, explicit exemption from the command requirement'
  );
});

// --- #1883: --source sweep persists the click surface to the run dir ---

test('step-6-auto.md: Report rules state the --source sweep persistence rule (report-condensed.md, unconditional report.md, the lint call, and the footer)', () => {
  const rules = section(STEP6, '### Report rules', '#### Conformance scan');
  assert.match(rules, /`--source sweep` persistence/);
  assert.match(rules, /suppresses only the chat send and `## Next Actions`/);
  assert.match(rules, /Write `\{run-dir\}\/report\.md` unconditionally under `--source sweep`/);
  assert.match(rules, /write `\{run-dir\}\/report-condensed\.md`/);
  assert.match(rules, /the full report verbatim when it did not/);
  assert.match(rules, /--surface=condensed` before this step is done/);
  assert.match(rules, /\/claude-tweaks:sweep`'s Step 4 reads `report-condensed\.md`/);
});

test('tidy/SKILL.md Component-Skill Contract: the report is persisted for the parent, not suppressed', () => {
  assert.match(
    TIDY_SKILL,
    /The report itself is not suppressed, only its chat send: it writes it to the run dir \(`\{run-dir\}\/report-condensed\.md`, alongside `report\.md`\) for the parent to inline/,
  );
});

test('_shared/github-pr-scan.md: the "awaiting review" PR finding carries a paste-ready command, not a bare summary', () => {
  const scan = read('plugin', 'skills', '_shared', 'github-pr-scan.md');
  assert.match(
    scan,
    /awaiting review — last updated \{age\} ago, CI \{status\}, 0 unresolved threads — gh pr view \{n\} --web/,
    'the awaiting-review finding must carry a trailing per-PR command'
  );
  assert.match(scan, /Open PR awaiting review, nothing wrong \(item 1's first finding\)/, 'Findings and recommendations table must list the awaiting-review row');
});
