'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { readText } = require('./helpers/read-skill');
const { toPosix } = require('../plugin/bin/lib/shared-primitives');

const ROOT = path.join(__dirname, '..');
const SKILLS = path.join(ROOT, 'plugin', 'skills');
const ROSTER = path.join(SKILLS, '_shared', 'ceremony-profile.md');

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.md')) out.push(p);
  }
  return out;
}

function section(text, heading) {
  const start = text.indexOf(`\n## ${heading}`);
  assert.notStrictEqual(start, -1, `roster lacks "## ${heading}"`);
  const rest = text.slice(start + 1);
  const next = rest.indexOf('\n## ', 1);
  return next === -1 ? rest : rest.slice(0, next);
}

// Table rows only (skip the header and the |---| separator).
function rows(sectionText) {
  return sectionText.split('\n').filter((l) => l.startsWith('| ') && !l.startsWith('| Step') && !l.startsWith('| File') && !/^\|\s*-/.test(l));
}

function cells(row) {
  return row.split('|').slice(1, -1).map((c) => c.trim());
}

const roster = readText(ROSTER);
const skipTags = rows(section(roster, 'Skips by profile')).map((r) => cells(r)[0].replace(/`/g, ''));
const neverRows = rows(section(roster, 'Never skipped')).map((r) => cells(r)[0]);
const mentions = rows(section(roster, 'Mentions that are not skips')).map((r) => {
  const cs = cells(r);
  assert.strictEqual(cs.length, 3, `malformed Mentions row (expected | File | Line contains | Why |): ${r}`);
  const [file, contains] = cs;
  return { file: file.replace(/`/g, ''), contains: contains.replace(/^`|`$/g, '').replace(/\\`/g, '`') };
});

test('the roster names the ten expected skip tags and the never-skipped floor (#1926 AC1, #3377 AC6.1)', () => {
  assert.deepStrictEqual(skipTags, [
    'review-step-1', 'review-step-1.6', 'review-step-4', 'plan-audit', 'plan-review', 'architecture-alignment',
    'reflect-light-mode', 'red-team-persona', 'sdd-whole-branch-review', 'polish',
  ]);
  for (const literal of ['review Step 2', 'review Step 3', 'review Step 5', 'review Step 6 rendered-UI check', 'build Common Step 5', 'reflect Near-misses, Fresh-start, Friction', 'Ceremony escape hatch', '`[IL-116]` cleanup floor', 'HARD-GATEs', 'Design CLI gate', 'Step 6.5 Design Quality Pass']) {
    assert.ok(neverRows.some((r) => r.includes(literal)), `never-skipped row missing: ${literal}`);
  }
});

// Every skill line (outside the roster itself) that pairs fast-lane with skip — the population both sweeps judge.
function fastLaneSkipLines() {
  const out = [];
  for (const file of walk(SKILLS)) {
    if (file === ROSTER) continue;
    // Compared against the roster's `/`-separated File cells, so it is a display ID (#4296).
    const rel = toPosix(path.relative(SKILLS, file));
    readText(file).split('\n').forEach((line, i) => {
      const lower = line.toLowerCase();
      if (lower.includes('fast-lane') && lower.includes('skip')) out.push({ rel, line, n: i + 1 });
    });
  }
  return out;
}

const citesTag = (line, t) => line.includes(`roster tag \`${t}\``) || line.includes(`tag \`${t}\``);

// Reverse staleness: a Mentions row no live fast-lane skip line matches, or a skip tag no live line cites.
function staleMentions(ms, skipLines) {
  return ms.filter((m) => !skipLines.some((l) => l.rel === m.file && l.line.includes(m.contains))).map((m) => `${m.file} | ${m.contains}`);
}

function uncitedTags(tags, skipLines) {
  return tags.filter((t) => !skipLines.some((l) => citesTag(l.line, t)));
}

test('every skill line pairing fast-lane with skip carries a roster tag or is a rostered non-skip mention (#1926 AC5)', () => {
  const offenders = [];
  for (const { rel, line, n } of fastLaneSkipLines()) {
    const tagged = skipTags.some((t) => citesTag(line, t));
    const exempt = mentions.some((m) => rel === m.file && line.includes(m.contains));
    if (!tagged && !exempt) offenders.push(`${rel}:${n}: ${line.trim().slice(0, 100)}`);
  }
  assert.deepStrictEqual(offenders, [], `unrostered fast-lane skip lines:\n${offenders.join('\n')}`);
});

test('every Mentions row still matches a live fast-lane skip line, and every skip tag is still cited by one (#4185 reverse staleness)', () => {
  const skipLines = fastLaneSkipLines();
  assert.ok(skipLines.length > 0, 'no fast-lane skip lines found — the sweep is vacuous');
  assert.deepStrictEqual(staleMentions(mentions, skipLines), [], 'stale Mentions row(s) — prune them from the roster');
  assert.deepStrictEqual(uncitedTags(skipTags, skipLines), [], 'skip tag(s) no live line cites — the roster row covers nothing');
});

test('go-red: the reverse checks report exactly a planted stale Mentions row and a planted uncited tag (#4185)', () => {
  const skipLines = fastLaneSkipLines();
  const realFile = mentions[0].file;
  const planted = [
    { file: realFile, contains: 'zzz-no-such-line-4185' }, // live file, text no line carries
    { file: 'zzz/no-such-file-4185.md', contains: mentions[0].contains }, // live text, file no line is in
  ];
  assert.deepStrictEqual(staleMentions([...mentions, ...planted], skipLines), planted.map((m) => `${m.file} | ${m.contains}`));
  assert.deepStrictEqual(uncitedTags([...skipTags, 'zzz-no-such-tag-4185'], skipLines), ['zzz-no-such-tag-4185']);
});

test('build/dispatch.md gates the single-task skip on all three conditions and carries the SKIP literal; flow rows carry fast-lane (#1926 AC3, AC4)', () => {
  const d = readText(path.join(SKILLS, 'build', 'dispatch.md'));
  const sentence = d.split('\n').find((l) => l.includes('Whole-branch review skipped: fast-lane, single-task plan'));
  assert.ok(sentence, 'dispatch.md lacks the SKIP literal');
  assert.ok(sentence.includes('`fast-lane`') && sentence.includes('`tasks` is exactly `1`') && sentence.includes('`batched` is `false`'));
  assert.ok(d.includes('batched plans (`batched: true`, regardless of count) keep the whole-branch review'));
  const gates = readText(path.join(SKILLS, 'flow', 'steps-and-gates.md'));
  const polishRow = gates.split('\n').find((l) => l.startsWith('| `polish` | `/claude-tweaks:design-wrapper polish'));
  assert.ok(polishRow && polishRow.includes('fast-lane'));
  assert.ok(readText(path.join(SKILLS, 'flow', 'summary-template.md')).includes('Skipped — fast-lane'));
});

// #3123: the Batched-plan marker paragraph steers fast-lane transcription plans to one batch.
const PLAN_CHECKS = path.join(SKILLS, 'build', 'plan-authoring-checks.md');
const INLINES_FULL_CODE = /every task inlines its complete code/;
const BATCH_INSTRUCTION = '`**Batch:** send every task to one implementer as a single brief; review the combined diff once.`';
const PER_TASK_EXCLUSION = 'stays per-task (SDD\'s "Reserve one-dispatch-per-task")';
function batchedMarkerParagraph(text) {
  const line = text.split('\n').find((l) => l.startsWith('**Batched-plan marker.**'));
  assert.ok(line, 'plan-authoring-checks.md lacks the **Batched-plan marker.** paragraph');
  return line;
}
function batchedFastLaneGuidanceProblems(paragraph) {
  const problems = [];
  if (!paragraph.includes('`ceremony: fast-lane`')) problems.push('`ceremony: fast-lane`');
  if (!paragraph.includes('`size: low`')) problems.push('`size: low`');
  if (!INLINES_FULL_CODE.test(paragraph)) problems.push('inlines-full-code condition');
  if (!paragraph.includes(BATCH_INSTRUCTION)) problems.push('`**Batch:**` instruction literal');
  if (!paragraph.includes(PER_TASK_EXCLUSION)) problems.push('per-task exclusion');
  return problems;
}

test('AC3.1: the Batched-plan marker paragraph names ceremony: fast-lane, size: low, and the inlines-full-code condition (#3123)', () => {
  const paragraph = batchedMarkerParagraph(readText(PLAN_CHECKS));
  assert.deepStrictEqual(batchedFastLaneGuidanceProblems(paragraph), []);
});

test('AC4.1: the guidance assertion goes red when the inlines-full-code condition is removed (doctored-text proof, #3123)', () => {
  const paragraph = batchedMarkerParagraph(readText(PLAN_CHECKS));
  const doctored = paragraph.replace(INLINES_FULL_CODE, 'every task is small');
  assert.notStrictEqual(doctored, paragraph, 'doctoring found no condition text to remove — anchor text not found');
  assert.deepStrictEqual(batchedFastLaneGuidanceProblems(doctored), ['inlines-full-code condition']);
});

test('AC4.2: the guidance assertion goes red for each of the other four pins when its text is removed (doctored-text proof, #3123)', () => {
  const paragraph = batchedMarkerParagraph(readText(PLAN_CHECKS));
  const cases = [
    ['`ceremony: fast-lane`', '`ceremony: fast-lane`'],
    ['`size: low`', '`size: low`'],
    [BATCH_INSTRUCTION, '`**Batch:**` instruction literal'],
    [PER_TASK_EXCLUSION, 'per-task exclusion'],
  ];
  for (const [anchor, problem] of cases) {
    const doctored = paragraph.replace(anchor, 'removed');
    assert.notStrictEqual(doctored, paragraph, `doctoring found no anchor text for ${problem}`);
    assert.deepStrictEqual(batchedFastLaneGuidanceProblems(doctored), [problem]);
  }
});

// #3379: the Adjacent-task merge paragraph sits after the Batched-plan marker paragraph.
const ADJACENT_LABEL = '**Adjacent-task merge.**';
const ADJACENT_PINS = [
  ['two adjacent tasks touch the same files', 'same-files condition'],
  ["the second only builds on the first's output", 'builds-on-output condition'],
  ['the second adds no separately reviewable surface', 'no-separate-surface condition'],
  ['has tests or behavior of its own that a reviewer would judge separately', 'own-tests-or-behavior exclusion'],
  ['touches different files', 'different-files exclusion'],
  ['is independently risky', 'independently-risky exclusion'],
  ["it takes no marker and leaves `plan-audit.js --count-tasks`' `batched` value unchanged", 'no-marker statement'],
  ['merge only while at least two tasks remain', 'keep-two-tasks rule'],
  ['the **Batched-plan marker.** paragraph', 'cross-reference to #3123'],
];
function adjacentMergeParagraph(text) {
  const hits = text.split('\n').filter((l) => l.startsWith(ADJACENT_LABEL));
  assert.strictEqual(hits.length, 1, 'expected exactly one **Adjacent-task merge.** paragraph');
  return hits[0];
}
function adjacentMergeProblems(paragraph) {
  return ADJACENT_PINS.filter(([anchor]) => !paragraph.includes(anchor)).map(([, problem]) => problem);
}

test('AC1.1 + AC2.1 + AC3.1 (#3379): the Adjacent-task merge paragraph names the three conditions, the exclusions, the no-marker statement, the keep-two rule, and the #3123 cross-reference', () => {
  assert.deepStrictEqual(adjacentMergeProblems(adjacentMergeParagraph(readText(PLAN_CHECKS))), []);
});

test('AC3.2 (#3379): the Adjacent-task merge paragraph sits immediately after the Batched-plan marker paragraph', () => {
  const lines = readText(PLAN_CHECKS).split('\n').filter((l) => l.trim() !== '');
  const batched = lines.findIndex((l) => l.startsWith('**Batched-plan marker.**'));
  assert.notStrictEqual(batched, -1);
  assert.ok(lines[batched + 1].startsWith(ADJACENT_LABEL), 'Adjacent-task merge must directly follow the Batched-plan marker paragraph');
});

test('AC4.1 (#3379): the pin goes red for each clause when its text is removed (doctored-text proof)', () => {
  const paragraph = adjacentMergeParagraph(readText(PLAN_CHECKS));
  for (const [anchor, problem] of ADJACENT_PINS) {
    const doctored = paragraph.replace(anchor, 'removed');
    assert.notStrictEqual(doctored, paragraph, `doctoring found no anchor text for ${problem}`);
    assert.deepStrictEqual(adjacentMergeProblems(doctored), [problem]);
  }
});
