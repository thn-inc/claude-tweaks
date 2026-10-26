'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');

// Live-corpus scan, deliberately not a frozen fixture (#461): the whole point of this
// suite is to catch a *future* skill that names a step "HARD GATE" without landing the
// marker convention documented in `plugin/skills/_shared/subagent-output-contract.md`'s
// "HARD-GATE Marker Convention and Inheritance Hazard" section. Freezing the input would
// defeat that purpose — per `skill-prose-conformance-tests`'s Decision Framework, this is
// the declared-contract carve-out (the prose IS the thing being enforced going forward),
// not the "a future migration is expected to rewrite this" case that calls for a fixture.
//
// Detection is heading-only (`^#{1,6} ... HARD GATE`), not "the literal phrase anywhere in
// the file". A broader any-occurrence scan flags the convention's own explanatory prose in
// `subagent-output-contract.md` (which discusses "HARD GATE" without being a gate site) and
// the warning sentence Deliverable 2 requires at each gate site (which necessarily uses the
// phrase in prose, right next to the marker it's describing) — both would be false
// positives under a phrase-anywhere scan. A heading assertion is also the concrete pattern
// every real gate in this repo actually uses today (`### Step N: ... — HARD GATE`).

const ROOT = path.join(__dirname, '..');
const SKILLS_DIR = path.join(ROOT, 'plugin', 'skills');

const HEADING_PATTERN = /^#{1,6}\s.*HARD GATE/;
const MARKER_PATTERN = /<!--[^\n]*-->/;
const MARKER_WINDOW = 6; // lines of lookahead searched for an adjacent marker comment

function findAllMdFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...findAllMdFiles(full));
    else if (entry.name.endsWith('.md')) out.push(full);
  }
  return out;
}

// Returns [{ lineNumber, hasMarker }] for every "HARD GATE" heading found in `text`. The
// marker window looks only *forward* from the heading — every real gate in this repo
// places its marker on the line immediately after the heading, and searching forward
// keeps a marker belonging to a *previous* heading's gate from being credited to this one.
function findHardGateHeadingSites(text) {
  const lines = text.split('\n');
  const sites = [];
  for (let i = 0; i < lines.length; i++) {
    if (!HEADING_PATTERN.test(lines[i])) continue;
    const window = lines.slice(i + 1, Math.min(lines.length, i + 1 + MARKER_WINDOW)).join('\n');
    sites.push({ lineNumber: i + 1, hasMarker: MARKER_PATTERN.test(window) });
  }
  return sites;
}

// --- Proof the check can go red (synthetic fixtures, per skill-prose-conformance-tests'
// go-red guidance) ---

test('findHardGateHeadingSites: flags a HARD GATE heading with no adjacent marker', () => {
  const noMarker = [
    '# Some skill',
    '',
    '### Step 4: Confirm — HARD GATE',
    '',
    'Then one `AskUserQuestion`.',
  ].join('\n');
  const sites = findHardGateHeadingSites(noMarker);
  assert.strictEqual(sites.length, 1);
  assert.strictEqual(sites[0].hasMarker, false, 'must go red when no marker follows the heading');
});

test('findHardGateHeadingSites: passes when a marker comment follows the heading', () => {
  const withMarker = [
    '# Some skill',
    '',
    '### Step 4: Confirm — HARD GATE',
    '',
    '<!-- HARD-GATE: some-gate -->',
    '',
    'Then one `AskUserQuestion`.',
  ].join('\n');
  const sites = findHardGateHeadingSites(withMarker);
  assert.strictEqual(sites.length, 1);
  assert.strictEqual(sites[0].hasMarker, true);
});

test('findHardGateHeadingSites: ignores prose that mentions the phrase without a heading', () => {
  const proseOnly = [
    '# Some skill',
    '',
    'This step is the load-bearing HARD GATE for this skill.',
  ].join('\n');
  assert.deepStrictEqual(findHardGateHeadingSites(proseOnly), []);
});

// --- Live-corpus sweep ---

test('every "HARD GATE" heading under plugin/skills/**/*.md carries an adjacent marker comment', () => {
  const files = findAllMdFiles(SKILLS_DIR);
  const failures = [];
  for (const file of files) {
    const text = readText(file);
    for (const site of findHardGateHeadingSites(text)) {
      if (!site.hasMarker) {
        failures.push(`${path.relative(ROOT, file)}:${site.lineNumber}`);
      }
    }
  }
  assert.deepStrictEqual(
    failures,
    [],
    'HARD GATE heading(s) with no adjacent marker comment (see _shared/subagent-output-' +
      `contract.md's "HARD-GATE Marker Convention and Inheritance Hazard"): ${failures.join(', ')}`,
  );
});
