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
const STEP6_AUTO = read('plugin/skills/tidy/step-6-auto.md');
const TIDY_SKILL = read('plugin/skills/tidy/SKILL.md');
const POLICY_SCHEMA = read('plugin/skills/_shared/policy-schema.md');

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
  assert.match(s, /`~\/\.claude\/plans\/` \(native plan-mode scratch\) keeps the table's recommendation as-is/);
});

test('tidy Step 4 routes a would-be plan Delete by the policy value (#4465)', () => {
  const s = step4Section();
  assert.match(s, /`prune-after-wrapup` → Delete, unchanged/);
  assert.match(s, /`ask` → `Prune plan \(ask\)`/);
  assert.match(s, /`keep-forever` \(the default\) → Keep, unless 30 or more plans are past the cutoff and no live decline exists — then one `Prune plan \(archive\)` listing them all/);
  assert.match(s, /The 30 counts only uncited would-be-Delete plans \(after the citation check\), so a staged archive never lists fewer than 30/);
  assert.match(s, /only a would-be Delete is routed — a Keep row stays Keep under every value/);
});

test('tidy Step 4 remembers a declined keep-forever prune and fails closed (#4465)', () => {
  const s = step4Section();
  assert.match(s, /declined-learning\.js" lookup --source tidy/);
  assert.match(s, /declined-learning\.js" record-decline --source tidy/);
  assert.match(s, /"description":"tidy Prune plan \(archive\): docs\/superpowers\/plans\/"\}' \| node "\$\{CLAUDE_PLUGIN_ROOT\}\/bin\/declined-learning\.js" lookup --source tidy/);
  assert.match(s, /"description":"tidy Prune plan \(archive\): docs\/superpowers\/plans\/","reason":"\{why\}"\}' \| node "\$\{CLAUDE_PLUGIN_ROOT\}\/bin\/declined-learning\.js" record-decline --source tidy/);
  assert.match(s, /a non-null `decline`, or a lookup that exits non-zero, routes them to Keep/);
  assert.match(s, /Before staging a `Prune plan \(archive\)`, look up the decline memory/);
  assert.match(s, /excludes a `Prune plan \(archive\)` `tidy-prune-plan-\{n\}` item/);
  assert.match(s, /Decline memory covers `keep-forever` only: excluding a `Prune plan \(ask\)` item records nothing, and `ask` stages every run/);
});

test('tidy Step 4 pins the 7-day cutoff and fails closed toward Keep (#4465)', () => {
  const s = step4Section();
  assert.match(s, /git -C "\{REPO_ROOT\}" log --diff-filter=A --format=%cs -1 -- \{plan\}/);
  assert.match(s, /The cutoff is 7 days \(ADR-0007's "last ~week"\), counted from the plan's first-add commit date/);
  assert.match(s, /empty output or a non-zero exit counts as within the cutoff/);
});

test('tidy Step 4 collects the recommendation after retention routing, not before it (#4465)', () => {
  const s = step4Section();
  const collect = s.indexOf('→ Collect each as: `[plan] {filename} — {recommendation}`');
  assert.notEqual(collect, -1, 'Step 4 must keep its Collect line');
  const retention = s.indexOf('**Plan retention (#4465).**');
  assert.notStrictEqual(retention, -1, 'Step 4 must keep its Plan retention paragraph');
  assert.ok(collect > retention, 'the Collect line must sit below the Plan retention paragraph');
  assert.match(s, /the recommendation being the one after Plan retention routing and the citation check/);
});

test('the plan citation check runs before a Prune plan recommendation too (#4465)', () => {
  assert.match(step4Section(), /\*\*Before any plan Delete or `Prune plan`:\*\* run `plan-citation-check\.md`/);
  assert.match(PLAN_CITATION, /before recommending any plan Delete or `Prune plan`/);
});

test('step-6-auto.md stages Prune plan at every tier (#4465)', () => {
  const row = STEP6_AUTO.split('\n').find((l) => l.startsWith('| **Prune plan**'));
  assert.ok(row, 'Prune plan row is present');
  assert.match(row, /\| Stage \| Stage \| Stage/);
  assert.match(row, /`scan-procedures\.md` Step 4's Plan retention/);
  assert.match(row, /tidy-prune-plan-\{n\}/);
});

test('step-6-auto.md auto-deletes plans only under prune-after-wrapup (#4465)', () => {
  assert.doesNotMatch(STEP6_AUTO, /orphaned plans whose related spec is complete,/);
  assert.match(STEP6_AUTO, /plans whose related spec is complete or that have no related spec, under `prune-after-wrapup`/);
  assert.match(STEP6_AUTO, /old plans whose spec status is unclear, under `prune-after-wrapup`/);
});

test('SKILL.md Action Vocabulary defines Prune plan execution and re-verify (#4465)', () => {
  const row = TIDY_SKILL.split('\n').find((l) => l.startsWith('| **Prune plan**'));
  assert.ok(row, 'Prune plan Action Vocabulary row is present');
  assert.match(row, /`git rm` each listed plan, one commit/);
  assert.match(row, /`plan-citation-check\.md` still clean, still past the 7-day cutoff, and `superpowers-plans-retention` still the value that staged it/);
  assert.match(row, /`stale — skipped`/);
  assert.match(row, /records its decline per Step 4's Plan retention/);
});

test('policy-schema.md names tidy Step 4 as a superpowers-plans-retention consumer and describes its routing (#4465)', () => {
  const row = POLICY_SCHEMA.split('\n').find((l) => l.startsWith('| `superpowers-plans-retention`'));
  assert.ok(row);
  assert.match(row, /`\/claude-tweaks:tidy` Step 4 \(`tidy\/scan-procedures\.md`\)/);
  assert.match(row, /tidy keeps them until 30 or more are past a 7-day cutoff, then stages one bulk prune/);
  assert.match(row, /tidy's Approve section/);
});
