'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');

const ROOT = path.join(__dirname, '..');

function read(rel) {
  return readText(path.join(ROOT, rel));
}
const fleet = read(path.join('plugin', 'skills', 'routine', 'fleet.md'));
const routineDir = path.join(ROOT, 'plugin', 'skills', 'routine');
const routineSkillFiles = fs
  .readdirSync(routineDir)
  .filter((f) => f.endsWith('.md'))
  .map((f) => path.join('plugin', 'skills', 'routine', f));
const schemaPath = path.join('plugin', 'skills', '_shared', 'routine-template-schema.md');

// Parses the Fleet composition table (under `## Fleet composition table`) into one
// object per numbered row. Cell values are backtick-stripped.
function compositionRows(md) {
  const lines = md.split('\n');
  const start = lines.indexOf('## Fleet composition table');
  assert.notStrictEqual(start, -1, 'no "## Fleet composition table" heading');
  const rows = [];
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (/^## /.test(line)) break;
    if (!line.startsWith('| ')) continue;
    const cells = line.split('|').slice(1, -1).map((c) => c.trim().replace(/`/g, ''));
    if (!/^\d+$/.test(cells[0])) {
      // The header row ("#") is the only legitimate non-numbered table line; anything else is a malformed row.
      assert.strictEqual(cells[0], '#', `malformed composition-table row: ${line}`);
      continue;
    }
    assert.strictEqual(cells.length, 7, `composition-table row ${cells[0]} has ${cells.length} cells, expected 7`);
    rows.push({
      num: cells[0],
      bucket: cells[1],
      entry: cells[2],
      template: cells[3],
      focus: cells[4],
      cron: cells[5],
      name: cells[6],
    });
  }
  return rows;
}

test('AC1.1: composition table has a Vertical finder row whose focus override is security-hardening', () => {
  const row = compositionRows(fleet).find((r) => r.focus === 'security-hardening');
  assert.ok(row, 'no row with focus override security-hardening');
  assert.strictEqual(row.bucket, 'Vertical finder');
  assert.strictEqual(row.template, 'skills/code-health/routine-template.yml');
});

test('AC1.2: its PREFIXED_NAME is {REPO_SLUG}-code-health-security-hardening and its cron is distinct from every other row', () => {
  const rows = compositionRows(fleet);
  const row = rows.find((r) => r.focus === 'security-hardening');
  assert.strictEqual(row.name, '{REPO_SLUG}-code-health-security-hardening');
  assert.strictEqual(row.cron, '0 7 * * *');
  const crons = rows.map((r) => r.cron);
  assert.strictEqual(new Set(crons).size, crons.length, `duplicate cron among ${crons.join(', ')}`);
  // rows stay numbered 1..N with no gaps after the insert
  assert.deepStrictEqual(rows.map((r) => r.num), rows.map((_, i) => String(i + 1)));
});

test('existing rows keep their pre-#3276 PREFIXED_NAME -> cron pairs (a changed cron reads as drift on every provisioned fleet)', () => {
  const pairs = Object.fromEntries(
    compositionRows(fleet)
      .filter((r) => r.focus !== 'security-hardening')
      .map((r) => [r.name, r.cron]),
  );
  assert.deepStrictEqual(pairs, {
    '{REPO_SLUG}-code-health-dead-code': '0 5 * * *',
    '{REPO_SLUG}-code-health-test-hygiene': '15 5 * * *',
    '{REPO_SLUG}-code-health-abstraction-police': '30 5 * * *',
    '{REPO_SLUG}-code-health-experiment-cleanup': '45 5 * * *',
    '{REPO_SLUG}-code-health-daily': '0 6 * * *',
    '{REPO_SLUG}-docs-health-daily': '15 6 * * *',
    '{REPO_SLUG}-journey-health-daily': '30 6 * * *',
    '{REPO_SLUG}-harness-health-daily': '45 6 * * *',
    '{REPO_SLUG}-specify-weekdays': '0 8 * * 1-5',
    '{REPO_SLUG}-backlog-grant-weekdays': '0 9 * * 1-5',
    '{REPO_SLUG}-dispatch-weekdays': '0 10 * * 1-5',
    '{REPO_SLUG}-tidy-weekly': '0 11 * * 0',
  });
});

test('AC2.1: no hardcoded vertical-finder row range or code-health instance count in routine skills or the template schema', () => {
  // mirrors the spec's: git grep -n -E "rows 1-4|rows 1-5|rows 6-12|row 5-12|five code-health instances" -- plugin/skills/routine plugin/skills/_shared/routine-template-schema.md
  const re = /rows 1-4|rows 1-5|rows 6-12|row 5-12|five code-health instances/;
  for (const f of [...routineSkillFiles, schemaPath]) assert.doesNotMatch(read(f), re, f);
});

test('fleet.md prose names composition-table rows by bucket/entry, never by number', () => {
  assert.doesNotMatch(fleet, /\b[Rr]ows? \d/);
  assert.doesNotMatch(fleet, /\b12 (rows|separate)\b|12x/);
});

test('fleet.md citers name composition-table rows by bucket/entry, never by number', () => {
  for (const f of ['docs/skill-graph.md', 'plugin/skills/code-health/routine-template.yml', 'docs/journeys/routine-fleet-on.md']) {
    assert.doesNotMatch(read(f), /composition table(?:'s)? rows? \d/, f);
  }
  assert.doesNotMatch(read('docs/skill-graph.md'), /instantiates it \*\*\w+ times\*\*/);
  const journey = read('docs/journeys/routine-fleet-on.md');
  assert.doesNotMatch(journey, /four focus-scoped|twelve separate/);
  assert.doesNotMatch(journey, /\b[Rr]ows? \d/);
  for (const f of ['docs/journeys/code-health-focus-sweep.md', 'docs/getting-started.md']) {
    assert.doesNotMatch(read(f), /\b(?:two|three|four|five|six|seven|eight|nine|ten) focus-scoped/i, f);
  }
  assert.doesNotMatch(read('docs/journeys/code-health-focus-sweep.md'), /dead-code, test-hygiene, abstraction-police/);
});
