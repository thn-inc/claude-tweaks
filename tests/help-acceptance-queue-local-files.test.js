'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const { readText } = require('./helpers/read-skill');
// #203: /help Stage 4.7's acceptance-queue scope gets a local-files twin.
// Prose-as-implementation (Stage 4.7 is a markdown-inlined `node -e` script,
// same convention as Stage 1's Conflict detection sub-section and
// tidy/step-1-records.md's Shape 7/8) — pin the key claims against the
// actual file text, plus syntax-check the embedded script, the same
// mechanical check `tests/sweep-backstop.test.js` already runs for its own
// embedded scripts.

const ROOT = path.join(__dirname, '..');
const read = (...p) => readText(path.join(ROOT, ...p));
const STATUS_SCAN = read('plugin', 'skills', 'help', 'status-scan.md');
const DEMO_SKILL = read('plugin', 'skills', 'demo', 'SKILL.md');

function extractSection(text, startMarker, endMarker) {
  const start = text.indexOf(startMarker);
  const end = text.indexOf(endMarker, start);
  assert.ok(start > 0, `could not find start marker: ${startMarker}`);
  assert.ok(end > start, `could not find end marker: ${endMarker}`);
  return text.slice(start, end);
}

// Matches `node -e "` ... closing `"` at the start of a line — the same
// convention `sweep-backstop.test.js` and the fenced scripts elsewhere in
// this skill already use.
function extractNodeScripts(section) {
  const scripts = [];
  const re = /node -e "\n([\s\S]*?)\n\s*"/g;
  let m;
  while ((m = re.exec(section)) !== null) {
    scripts.push(m[1].replace(/\\"/g, '"').replace(/\\\$/g, '$'));
  }
  return scripts;
}

const STAGE_4_7 = extractSection(
  STATUS_SCAN,
  '## Stage 4.7: Acceptance Queue',
  '## Stage 4.8: Trust Table',
);

test('Stage 4.7 heading no longer claims GitHub-only', () => {
  assert.ok(
    !/Stage 4\.7: Acceptance Queue \(GitHub\)/.test(STATUS_SCAN),
    'Stage 4.7 heading still tags itself GitHub-only',
  );
});

test('Stage 4.7 branches on both work-backend drivers', () => {
  assert.ok(/`work-backend: github-issues`/.test(STAGE_4_7), 'missing github-issues branch');
  assert.ok(/`work-backend: local-files`/.test(STAGE_4_7), 'missing local-files branch');
});

test('Stage 4.7 local-files branch reads facets.acceptance via queryRecords, merging open+closed', () => {
  assert.ok(/queryRecords/.test(STAGE_4_7), 'local-files branch does not use queryRecords');
  assert.ok(
    /acceptance: 'pending'/.test(STAGE_4_7) || /acceptance:\s*'pending'/.test(STAGE_4_7),
    'local-files branch does not filter on acceptance: pending',
  );
  // The open-only default: a bare `{ acceptance: 'pending' }` call and a
  // `{ acceptance: 'pending', closed: true }` call must both be present —
  // one alone silently drops half the population (local-store.js's own
  // documented `queryRecords` behavior; see tidy/step-1-records.md's Shape 8).
  assert.ok(
    /queryRecords\('specs',\s*\{\s*acceptance:\s*'pending'\s*\}\)/.test(STAGE_4_7),
    'missing the open-record queryRecords call',
  );
  assert.ok(
    /queryRecords\('specs',\s*\{\s*acceptance:\s*'pending',\s*closed:\s*true\s*\}\)/.test(STAGE_4_7),
    'missing the closed-record queryRecords call',
  );
});

test('Stage 4.7: every embedded node -e script is syntactically valid', () => {
  const scripts = extractNodeScripts(STAGE_4_7);
  assert.ok(scripts.length > 0, 'expected at least one node -e script in Stage 4.7');
  for (const [i, script] of scripts.entries()) {
    const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ct-help-acceptance-syntax-')), `script-${i}.js`);
    fs.writeFileSync(tmp, script);
    assert.doesNotThrow(
      () => execFileSync('node', ['--check', tmp], { stdio: 'pipe' }),
      `Stage 4.7 script #${i} has a syntax error:\n${script}`,
    );
  }
});

test('demo/SKILL.md no longer points a local-files reader at a GitHub-only Stage 4.7', () => {
  assert.ok(
    /awaiting sign-off \(Stage 4\.7 — fires on either driver\)/.test(DEMO_SKILL),
    '"how you got here" bullet does not state Stage 4.7 fires on either driver',
  );
  assert.ok(
    /Stage 4\.7 lists every `#N` on either driver/.test(DEMO_SKILL),
    'Not-for line does not state Stage 4.7 fires on either driver',
  );
});
