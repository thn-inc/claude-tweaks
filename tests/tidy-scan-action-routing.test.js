'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');

// #3291: every `— {Action}` verb tidy's scan-procedures.md collects must have
// a matching **{Action}** row in step-6-auto.md's routing table, or the
// finding stages forever with no stated tier ("a finding class that keeps
// staging needs a routing row"). Release Backfill and pipeline-run Archive
// were the two verbs that had none.
//
// Bound: the extractor sees only backticked collect templates whose last
// ` — ` segment is a literal verb, and a routing row matches by its bold
// label alone. A verb collected any other way (unbackticked prose, a verb
// built from a placeholder) escapes the AC3.1 coverage check, and it proves a
// row exists, not its tier: tiers are pinned per row, for Backfill and
// Archive only, by the tests below.

const ROOT = path.join(__dirname, '..');
const SCAN = readText(path.join(ROOT, 'plugin/skills/tidy/scan-procedures.md'));
const AUTO = readText(path.join(ROOT, 'plugin/skills/tidy/step-6-auto.md'));
const SKILL = readText(path.join(ROOT, 'plugin/skills/tidy/SKILL.md'));

// A collect template is a backticked span opening with a `[tag]` and carrying
// a `{placeholder}` before its last ` — ` segment (the format-description
// span `[type] item — detail — recommendation` has none), or a continuation
// span opening with `— ` (`— Delete (judgment)`). The action is the last
// segment when it is a literal; a trailing `(qualifier)` names a variant
// routed by the same row label.
function scanActionVerbs(text) {
  const verbs = new Set();
  for (const m of text.matchAll(/`((?:\[[a-z-]+\]|—)[^`\n]*)`/g)) {
    const span = m[1];
    const parts = span.split(/(?:^| )— /);
    if (parts.length < 2) continue;
    const last = parts[parts.length - 1].trim();
    if (!last || last.includes('{')) continue;
    if (!span.startsWith('—') && !parts.slice(0, -1).join(' — ').includes('{')) continue;
    verbs.add(last.replace(/\s*\([^)]*\)\s*$/, ''));
  }
  return [...verbs].sort();
}

// Routing rows: `| **{Label}** {scope} | {conservative} | {moderate} | {aggressive} |`.
function routingRows(text) {
  const rows = [];
  for (const line of text.split('\n')) {
    const m = line.match(/^\| \*\*([^*]+)\*\*/);
    if (!m) continue;
    rows.push({ label: m[1].trim(), cells: line.split('|').slice(1, -1).map((c) => c.trim()) });
  }
  return rows;
}

function assertEveryVerbRouted(scanText, autoText) {
  const labels = new Set(routingRows(autoText).map((r) => r.label));
  const missing = scanActionVerbs(scanText).filter((v) => !labels.has(v));
  assert.deepStrictEqual(missing, [], `scan-procedures.md action verb(s) with no step-6-auto.md routing row: ${missing.join(', ')}`);
}

// #3904: the same coverage, against tidy/SKILL.md's Action Vocabulary table, the
// skill's named per-action execution reference. Archive and Backfill had a
// routing row but no vocabulary row until then.
function assertEveryVerbInVocabulary(scanText, skillText) {
  const labels = new Set(routingRows(skillText).map((r) => r.label));
  const missing = scanActionVerbs(scanText).filter((v) => !labels.has(v));
  assert.deepStrictEqual(missing, [], `scan-procedures.md action verb(s) with no SKILL.md Action Vocabulary row: ${missing.join(', ')}`);
}

function remedyRow(autoText, label, remedy) {
  const rows = routingRows(autoText).filter((r) => r.label === label && r.cells[0].includes(`\`remedy: ${remedy}\``));
  assert.strictEqual(rows.length, 1, `expected exactly one ${label} routing row for remedy: ${remedy}, found ${rows.length}`);
  return rows[0];
}

function backfillRow(autoText, remedy) {
  return remedyRow(autoText, 'Backfill', remedy);
}

function assertTierAtEveryLevel(row) {
  assert.strictEqual(row.cells.length, 4, `routing row needs scope + three tier cells: ${row.cells[0]}`);
  for (const tier of row.cells.slice(1)) assert.match(tier, /^(Auto-apply|Stage|Auto \(no-op, always surfaced\))/);
}

function assertNeverAutoApply(row) {
  for (const tier of row.cells.slice(1)) assert.doesNotMatch(tier, /Auto-apply/);
}

test('scan verb extraction floor: Delete, Archive, and Backfill are all found', () => {
  const verbs = scanActionVerbs(SCAN);
  for (const v of ['Delete', 'Archive', 'Backfill']) assert.ok(verbs.includes(v), `extractor missed ${v}: ${verbs.join(', ')}`);
});

test('AC3.1: every action verb scan-procedures.md emits has a matching step-6-auto.md routing row', () => {
  assertEveryVerbRouted(SCAN, AUTO);
});

test('AC3.1 go-red: deleting the Backfill rows makes the coverage check fail', () => {
  const withoutBackfill = AUTO.split('\n').filter((l) => !l.startsWith('| **Backfill**')).join('\n');
  assert.throws(() => assertEveryVerbRouted(SCAN, withoutBackfill), /Backfill/);
});

test('#3904: every action verb scan-procedures.md emits has a matching SKILL.md Action Vocabulary row', () => {
  assertEveryVerbInVocabulary(SCAN, SKILL);
});

test('#3904 go-red: deleting the Archive vocabulary row makes the vocabulary check fail', () => {
  const withoutArchive = SKILL.split('\n').filter((l) => !l.startsWith('| **Archive** |')).join('\n');
  assert.throws(() => assertEveryVerbInVocabulary(SCAN, withoutArchive), /Archive/);
});

test('AC1.1: both release Backfill flavors state a tier at all three aggressiveness levels', () => {
  assertTierAtEveryLevel(backfillRow(AUTO, 'auto'));
  assertTierAtEveryLevel(backfillRow(AUTO, 'record'));
});

test('AC2.1: the heading-with-no-tag (remedy: record) Backfill flavor is never Auto-apply at any tier', () => {
  assertNeverAutoApply(backfillRow(AUTO, 'record'));
});

test('AC2.1 go-red: an Auto-apply tier on the remedy: record row fails the check', () => {
  const row = backfillRow(AUTO, 'record');
  assert.throws(() => assertNeverAutoApply({ ...row, cells: [row.cells[0], row.cells[1], 'Auto-apply', row.cells[3]] }));
});

test('Archive: a pipeline-run held by a live session (remedy: record, #1328) is never Auto-apply; remedy: auto states all three tiers', () => {
  assertTierAtEveryLevel(remedyRow(AUTO, 'Archive', 'auto'));
  const held = remedyRow(AUTO, 'Archive', 'record');
  assertTierAtEveryLevel(held);
  assertNeverAutoApply(held);
  const para = SCAN.split('\n').find((l) => l.startsWith('Each `kind: pipeline-run` finding'));
  assert.ok(para, 'kind: pipeline-run paragraph not found');
  assert.match(para, /`step-6-auto\.md`'s two \*\*Archive\*\* rows/);
  assert.doesNotMatch(para, /always `auto`/);
});

test('scan-procedures.md release paragraph points at the Backfill rows instead of carrying the disposition inline', () => {
  const para = SCAN.split('\n').find((l) => l.startsWith('Each `kind: release` finding'));
  assert.ok(para, 'kind: release paragraph not found');
  assert.match(para, /`step-6-auto\.md`'s two \*\*Backfill\*\* rows/);
  assert.doesNotMatch(para, /add it by hand/);
});
