'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { readText } = require('./helpers/read-skill');

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

const roster = fs.readFileSync(ROSTER, 'utf8');
const skipTags = rows(section(roster, 'Skips by profile')).map((r) => cells(r)[0].replace(/`/g, ''));
const neverRows = rows(section(roster, 'Never skipped')).map((r) => cells(r)[0]);
const mentions = rows(section(roster, 'Mentions that are not skips')).map((r) => {
  const cs = cells(r);
  assert.strictEqual(cs.length, 3, `malformed Mentions row (expected | File | Line contains | Why |): ${r}`);
  const [file, contains] = cs;
  return { file: file.replace(/`/g, ''), contains: contains.replace(/^`|`$/g, '').replace(/\\`/g, '`') };
});

test('the roster names the nine expected skip tags and the never-skipped floor (#1926 AC1)', () => {
  assert.deepStrictEqual(skipTags, [
    'review-step-1', 'review-step-1.6', 'review-step-4', 'plan-audit', 'architecture-alignment',
    'reflect-light-mode', 'red-team-persona', 'sdd-whole-branch-review', 'polish',
  ]);
  for (const literal of ['review Step 2', 'review Step 3', 'review Step 5', 'review Step 6 rendered-UI check', 'build Common Step 5', 'reflect Near-misses, Fresh-start, Friction', 'Ceremony escape hatch', '`[IL-116]` cleanup floor', 'HARD-GATEs', 'Design CLI gate', 'Step 6.5 Design Quality Pass']) {
    assert.ok(neverRows.some((r) => r.includes(literal)), `never-skipped row missing: ${literal}`);
  }
});

test('every skill line pairing fast-lane with skip carries a roster tag or is a rostered non-skip mention (#1926 AC5)', () => {
  const offenders = [];
  for (const file of walk(SKILLS)) {
    if (file === ROSTER) continue;
    const rel = path.relative(SKILLS, file);
    fs.readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
      const lower = line.toLowerCase();
      if (!(lower.includes('fast-lane') && lower.includes('skip'))) return;
      const tagged = skipTags.some((t) => line.includes(`roster tag \`${t}\``) || line.includes(`tag \`${t}\``));
      const exempt = mentions.some((m) => rel === m.file && line.includes(m.contains));
      if (!tagged && !exempt) offenders.push(`${rel}:${i + 1}: ${line.trim().slice(0, 100)}`);
    });
  }
  assert.deepStrictEqual(offenders, [], `unrostered fast-lane skip lines:\n${offenders.join('\n')}`);
});

test('build/dispatch.md gates the single-task skip on all three conditions and carries the SKIP literal; flow rows carry fast-lane (#1926 AC3, AC4)', () => {
  const d = fs.readFileSync(path.join(SKILLS, 'build', 'dispatch.md'), 'utf8');
  const sentence = d.split('\n').find((l) => l.includes('Whole-branch review skipped: fast-lane, single-task plan'));
  assert.ok(sentence, 'dispatch.md lacks the SKIP literal');
  assert.ok(sentence.includes('`fast-lane`') && sentence.includes('`tasks` is exactly `1`') && sentence.includes('`batched` is `false`'));
  assert.ok(d.includes('batched plans (`batched: true`, regardless of count) keep the whole-branch review'));
  const gates = fs.readFileSync(path.join(SKILLS, 'flow', 'steps-and-gates.md'), 'utf8');
  const polishRow = gates.split('\n').find((l) => l.startsWith('| `polish` | `/claude-tweaks:design-wrapper polish'));
  assert.ok(polishRow && polishRow.includes('fast-lane'));
  assert.ok(fs.readFileSync(path.join(SKILLS, 'flow', 'summary-template.md'), 'utf8').includes('Skipped — fast-lane'));
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
