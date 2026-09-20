'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SKILLS = path.join(ROOT, 'plugin', 'skills');
const ROSTER = path.join(SKILLS, '_shared', 'ceremony-profile.md');
const { CEILING_BYTES } = require(path.join(ROOT, 'plugin', 'bin', 'lib', 'skill-audit', 'context-cost'));

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

test('every touched skill file stays under the byte ceiling (#1926 AC7)', () => {
  for (const rel of ['build/SKILL.md', 'flow/SKILL.md', 'wrap-up/SKILL.md', 'review/code-mode-steps.md', 'build/dispatch.md', 'flow/steps-and-gates.md', '_shared/ceremony-profile.md']) {
    const bytes = Buffer.byteLength(fs.readFileSync(path.join(SKILLS, rel), 'utf8'), 'utf8');
    assert.ok(bytes <= CEILING_BYTES, `${rel} is ${bytes} bytes`);
  }
});
