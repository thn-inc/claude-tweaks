// tests/tidy-plan-retention-conformance.test.js
// Pins /tidy Step 4's plan-retention routing (record #4465): a would-be plan Delete is routed by the
// `superpowers-plans-retention` policy value, the 7-day cutoff fails closed toward Keep, a declined
// keep-forever prune is remembered, and the citation check runs before a Prune plan recommendation too.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const { readText } = require('./helpers/read-skill');

const REPO_ROOT = path.join(__dirname, '..');
const read = (rel) => readText(path.join(REPO_ROOT, rel));

const SCAN_PROCEDURES = read('plugin/skills/tidy/scan-procedures.md');
const PLAN_CITATION = read('plugin/skills/tidy/plan-citation-check.md');

function step4Section() {
  const start = SCAN_PROCEDURES.indexOf('## Step 4: Audit Execution Plans');
  const end = SCAN_PROCEDURES.indexOf('## Step 4.5:');
  assert.notEqual(start, -1, 'scan-procedures.md must carry the Step 4 heading');
  assert.notEqual(end, -1, 'scan-procedures.md must carry the Step 4.5 heading');
  return SCAN_PROCEDURES.slice(start, end);
}

test('tidy Step 4 resolves superpowers-plans-retention (#4465)', () => {
  const s = step4Section();
  assert.match(s, /node "\$\{CLAUDE_PLUGIN_ROOT\}\/bin\/resolve-policy\.js" --values superpowers-plans-retention/);
  assert.match(s, /governs `docs\/superpowers\/plans\/` only; `~\/\.claude\/plans\/`/);
});

test('tidy Step 4 routes a would-be plan Delete by the policy value (#4465)', () => {
  const s = step4Section();
  assert.match(s, /`prune-after-wrapup` → Delete, unchanged/);
  assert.match(s, /`ask` → `Prune plan \(ask\)`/);
  assert.match(s, /`keep-forever` \(the default\) → Keep, unless 30 or more plans are past the cutoff and no live decline exists — then one `Prune plan \(archive\)` listing them all/);
  assert.match(s, /only a would-be Delete is routed — a Keep row stays Keep under every value/);
});

test('tidy Step 4 remembers a declined keep-forever prune and fails closed (#4465)', () => {
  const s = step4Section();
  assert.match(s, /declined-learning\.js" lookup --source tidy/);
  assert.match(s, /declined-learning\.js" record-decline --source tidy/);
  assert.match(s, /"description":"tidy Prune plan \(archive\): docs\/superpowers\/plans\/"/);
  assert.match(s, /a non-null `decline`, or a lookup that exits non-zero, routes them to Keep/);
});

test('tidy Step 4 pins the 7-day cutoff and fails closed toward Keep (#4465)', () => {
  const s = step4Section();
  assert.match(s, /git -C "\{REPO_ROOT\}" log --diff-filter=A --format=%cs -1 -- \{plan\}/);
  assert.match(s, /7 days/);
  assert.match(s, /empty output or a non-zero exit counts as within the cutoff/);
});

test('the plan citation check runs before a Prune plan recommendation too (#4465)', () => {
  assert.match(step4Section(), /\*\*Before any plan Delete or `Prune plan`:\*\* run `plan-citation-check\.md`/);
  assert.match(PLAN_CITATION, /before recommending any plan Delete or `Prune plan`/);
});
