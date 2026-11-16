'use strict';

// /claude-tweaks:ci-health's SKILL.md and checklist.md (#5757): the house checks every health
// SKILL.md passes, the prose the CLI's contract depends on (the thresholds pass-through, the
// gather timeout, the noData and dry-run wording), the three filing blocks the health roster keeps
// identical, and checklist.md's agreement with checks.js, validate-finding.js and ci-audit.js.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { readText } = require('../../helpers/read-skill');
const {
  registerHouseSectionOrderTest,
  registerInteractionStyleTest,
  registerPipelineRunDirTest,
  registerNoEmojiTest,
  registerRequiredTokenTests,
} = require('../health-core/skill-md-house-checks');
const { CHECK_IDS, DEFAULTS } = require('../../../plugin/bin/lib/ci-audit/checks');
const { METRICS } = require('../../../plugin/bin/lib/ci-audit/validate-finding');
const { DEFINITIONS } = require('../../../plugin/bin/ci-audit');

const SKILLS = path.resolve(__dirname, '..', '..', '..', 'plugin', 'skills');
const SKILL = path.join(SKILLS, 'ci-health', 'SKILL.md');
const CHECKLIST = path.join(SKILLS, 'ci-health', 'checklist.md');
const read = () => readText(SKILL);
const readChecklist = () => readText(CHECKLIST);
const frontmatter = () => read().split(/^---$/m)[1];

test('exists', () => {
  assert.ok(fs.existsSync(SKILL), `SKILL.md not found at ${SKILL}`);
  assert.ok(fs.existsSync(CHECKLIST), `checklist.md not found at ${CHECKLIST}`);
});

test('frontmatter: name, a Use-for description with keywords, an argument-hint, allowed-tools', () => {
  const fm = frontmatter();
  assert.match(fm, /^name: ci-health$/m);
  assert.match(fm, /^description: Use for .*Keywords - \S/m);
  assert.match(fm, /^argument-hint: ".*--dry-run.*"$/m);
  assert.match(fm, /^allowed-tools: \S/m);
});

registerInteractionStyleTest(test, assert, read);
registerHouseSectionOrderTest(test, assert, read);
registerPipelineRunDirTest(test, assert, read);
registerNoEmojiTest(test, assert, read);

test('carries Input and Workflow sections with GATHER, JUDGE, VERIFY and FILE steps in order', () => {
  const body = read();
  assert.match(body, /^## Input$/m);
  assert.match(body, /^## Workflow$/m);
  const at = ['GATHER', 'JUDGE', 'VERIFY', 'FILE'].map((s) => body.search(new RegExp(`^\\*\\*Step \\d+ — ${s}\\b`, 'm')));
  assert.ok(at.every((i) => i !== -1), `a step is missing: ${at}`);
  assert.deepStrictEqual([...at].sort((a, b) => a - b), at, `steps out of order: ${at}`);
});

test('a Not-for paragraph routes to /claude-tweaks:harness-health and /claude-tweaks:init', () => {
  const notFor = read().split('\n').find((l) => l.startsWith('Not for'));
  assert.ok(notFor, 'no paragraph starts with "Not for"');
  assert.ok(notFor.includes('/claude-tweaks:harness-health'));
  assert.ok(notFor.includes('/claude-tweaks:init'));
});

test('resolves the thresholds policy key and passes a non-empty value to gather as --thresholds', () => {
  const body = read();
  assert.ok(body.includes('node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-policy.js" --values ci-health-thresholds'));
  assert.ok(body.includes('${CI_HEALTH_THRESHOLDS:+--thresholds "$CI_HEALTH_THRESHOLDS"}'), 'gather must receive a non-empty value only');
  assert.ok(
    body.includes('report "`ci-health-thresholds` is invalid, so the checklist defaults are in force this run" — never apply defaults silently'),
    'an invalid value must be reported as defaults in force, never silent',
  );
});

test('runs gather through ${CLAUDE_PLUGIN_ROOT}/bin/ci-audit.js with a 600000 ms Bash timeout', () => {
  const body = read();
  assert.ok(body.includes('node "${CLAUDE_PLUGIN_ROOT}/bin/ci-audit.js" gather'));
  assert.ok(body.includes('node "${CLAUDE_PLUGIN_ROOT}/bin/ci-audit.js" validate-findings'));
  assert.match(body, /Bash timeout of `600000`/);
});

test('reports noData as "no runs sampled" and an unavailable read as unavailable, never as clean', () => {
  const body = read();
  assert.ok(body.includes('| `0` with `noData` set | The read worked but sampled no usable run | Report "no runs sampled" with the `noData.reason`, never as "no findings"; skip to Step 7 |'));
  assert.ok(body.includes('a `noData` run says "no runs sampled"'), 'the summary keeps the wording too');
  for (const exit of ['`2`, file holds a report', '`3`']) {
    const row = body.split('\n').find((l) => l.startsWith(`| ${exit} |`));
    assert.ok(row && row.includes('Report the sweep as unavailable, never clean'), `exit ${exit} must report unavailable, never clean`);
  }
  assert.ok(body.includes('_shared/github-write-transport.md'), 'the unavailability convention is cited, not restated');
});

test('--dry-run prints each payload and makes no forge write, writes no state and files nothing', () => {
  const body = read();
  assert.ok(body.includes('${DRY_RUN:+--dry-run}'), 'validate-findings marks dry-run payloads');
  assert.ok(body.includes('In `--dry-run` mode, print each payload this step would file or reopen, make no forge write, write no cursor, cache or digest, and file nothing.'));
});

test('states that the sweep keeps no cursor, cache or retry queue', () => {
  assert.match(read(), /keeps no cursor, cache or retry queue/);
});

registerRequiredTokenTests(test, assert, read, [
  'validate-findings', '_shared/health-filing-mechanics.md', '_shared/health-issue-index.md',
  '_shared/health-filing-digest.md', '_shared/health-filing-gate.md', '_shared/health-verify-gate.md',
  '_shared/health-recent-commit-check.md', '_shared/materiality-floor.md', '_shared/untrusted-record-content.md',
  '_shared/subagent-output-contract.md', 'by:ci-health', 'born-`ready`', 'checklist.md',
  'filed: N, digested: M, cap: {CAP}, materiality: K',
]);

test('applies the materiality floor before the drain-rate cap check', () => {
  assert.match(read(), /[Bb]efore the drain-rate cap check/);
});

// The three blocks tests/health-filing-parity.test.js keeps identical across the health sweeps,
// compared here against docs-health's copy with each skill's own name substituted.
const DOCS = () => readText(path.join(SKILLS, 'docs-health', 'SKILL.md'));
function paragraph(source, marker) {
  const at = source.indexOf(marker);
  assert.ok(at !== -1, `marker not found: ${marker}`);
  const rest = source.slice(at);
  const end = rest.indexOf('\n\n');
  return (end === -1 ? rest : rest.slice(0, end)).trim();
}
function section(source, heading) {
  const at = source.indexOf(heading);
  assert.ok(at !== -1, `heading not found: ${heading}`);
  const after = source.slice(at + heading.length);
  const end = after.indexOf('\n## ');
  return (end === -1 ? after : after.slice(0, end)).trim();
}
const as = (text, name) => text.split(name).join('{SKILL}');

test('inlines the Subject-check, headless-D5 and Component-Skill Contract blocks as the health roster does', () => {
  const ci = read();
  const docs = DOCS();
  const subject = '**Subject check before filing.**';
  assert.strictEqual(as(paragraph(ci, subject), 'ci-health'), as(paragraph(docs, subject), 'docs-health'));
  const d5 = '**Exception — a headless D5 finding.**';
  assert.strictEqual(as(paragraph(ci, d5), 'by:ci-health'), as(paragraph(docs, d5), 'by:docs-health'));
  const csc = '## Component-Skill Contract';
  assert.strictEqual(as(section(ci, csc), 'ci-health'), as(section(docs, csc), 'docs-health'));
});

// ── checklist.md ─────────────────────────────────────────────────────────────
// SKILL.md's judge reads it, and a --budget fan-out inlines its body (below the first horizontal
// rule) verbatim into each agent's prompt, so the body must stand alone.
const checklistBody = () => readChecklist().split(/^---$/m).slice(1).join('---');

test('checklist.md states the three phase definitions verbatim, as gather\'s definitions field does', () => {
  const body = checklistBody();
  for (const [phase, text] of Object.entries(DEFINITIONS)) {
    assert.ok(body.includes(`**${phase}** = ${text}`), `missing the verbatim ${phase} definition`);
  }
});

test('checklist.md names every check id with its default threshold and its evidence metric', () => {
  const rows = checklistBody().split('\n').filter((l) => l.startsWith('| `'));
  for (const id of CHECK_IDS) {
    const row = rows.find((l) => l.startsWith(`| \`${id}\` |`));
    assert.ok(row, `no checklist row for ${id}`);
    assert.ok(row.includes(`\`${METRICS.breach[id]}\``), `${id}'s row does not name its metric ${METRICS.breach[id]}`);
    if (Object.prototype.hasOwnProperty.call(DEFAULTS, id)) {
      assert.ok(row.includes(`\`${DEFAULTS[id]}\``), `${id}'s row does not state its default ${DEFAULTS[id]}`);
    } else {
      assert.ok(row.includes('no threshold'), `${id}'s row must say it has no threshold`);
    }
  }
  assert.strictEqual(rows.length, CHECK_IDS.length, 'one row per check, no unknown id');
});

test('checklist.md names the whole evidence vocabulary', () => {
  const body = checklistBody();
  for (const m of [...METRICS.job, ...METRICS.criticalPath, ...METRICS.shardSkew]) {
    assert.ok(body.includes(`\`${m}\``), `missing evidence metric ${m}`);
  }
});

test('checklist.md body is self-contained — no reference a dispatched agent cannot resolve', () => {
  const body = checklistBody();
  for (const re of [/\bSKILL\.md\b/, /_shared\//, /\bStep \d/, /checklist\.md/, /\babove\b/, /\bbelow\b/]) {
    const hit = body.match(re);
    assert.ok(!hit, `unresolvable reference in the inlinable body: ${hit && hit[0]}`);
  }
  const fences = readChecklist().split('\n').filter((l) => /^\s*```/.test(l));
  assert.strictEqual(fences.length % 2, 0, `unbalanced code fences: ${fences.length}`);
});
