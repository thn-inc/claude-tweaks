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

function read(rel) {
  return readText(path.join(REPO_ROOT, rel));
}

function findRow(text, prefix) {
  return text.split('\n').find((line) => line.startsWith(prefix));
}

const SCAN_PROCEDURES = read('plugin/skills/tidy/scan-procedures.md');
const PLAN_CITATION = read('plugin/skills/tidy/plan-citation-check.md');
const STEP6_AUTO = read('plugin/skills/tidy/step-6-auto.md');
const TIDY_SKILL = read('plugin/skills/tidy/SKILL.md');
const STEP6_INTERACTIVE = read('plugin/skills/tidy/step-6-interactive.md');
const APPROVE_MODE = read('plugin/skills/tidy/approve-mode.md');
const POLICY_SCHEMA = read('plugin/skills/_shared/policy-schema.md');
const SKILL_GRAPH = read('docs/skill-graph.md');
const { POLICY_KEYS } = require('../plugin/bin/lib/policy-schema');

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
  assert.notEqual(retention, -1, 'Step 4 must keep its Plan retention paragraph');
  assert.ok(collect > retention, 'the Collect line must sit below the Plan retention paragraph');
  assert.match(s, /the recommendation being the one after Plan retention routing and the citation check/);
});

test('the plan citation check runs before a Prune plan recommendation too (#4465)', () => {
  assert.match(step4Section(), /\*\*Before any plan Delete or `Prune plan`:\*\* run `plan-citation-check\.md`/);
  assert.match(PLAN_CITATION, /before recommending any plan Delete or `Prune plan`/);
});

test('step-6-auto.md stages Prune plan at every tier (#4465)', () => {
  const row = findRow(STEP6_AUTO, '| **Prune plan**');
  assert.ok(row, 'Prune plan row is present');
  assert.match(row, /\| Stage \| Stage \| Stage/);
  assert.match(row, /`scan-procedures\.md` Step 4's Plan retention/);
  assert.match(row, /tidy-prune-plan-\{n\}/);
});

test('step-6-auto.md auto-deletes plans only under prune-after-wrapup (#4465)', () => {
  assert.doesNotMatch(STEP6_AUTO, /orphaned plans whose related spec is complete,/);
  assert.match(STEP6_AUTO, /— plans whose related spec is complete \(`docs\/superpowers\/plans\/` only under `prune-after-wrapup`; `~\/\.claude\/plans\/` at every value\), orphaned ledger files/);
  assert.match(STEP6_AUTO, /old plans whose spec status is unclear, and orphan plans with no related spec \(`docs\/superpowers\/plans\/` only under `prune-after-wrapup`; `~\/\.claude\/plans\/` at every value\)/);
});

test('step-6-auto.md routes orphan plans through the judgment Delete row, not the every-tier Auto row (#4465)', () => {
  const auto = findRow(STEP6_AUTO, '| **Delete** (marked-as-specified design docs');
  const judgment = findRow(STEP6_AUTO, '| **Delete** (any case requiring judgment');
  assert.ok(auto && judgment);
  assert.match(auto, /the plan's related spec is still complete and no repo file cites/);
  assert.doesNotMatch(auto, /orphan plan|no related spec/);
  assert.match(judgment, /orphan plans with no related spec/);
  assert.match(judgment, /\(`plan-citation-check\.md`\) and an orphan still has no related spec/);
  assert.doesNotMatch(judgment, /plan-citation-check\.md`; an orphan/);
  assert.match(judgment, /\| Stage \| Auto-apply \| Auto-apply/);
});

test('SKILL.md Prune plan row says the 30 threshold gates staging, not execution (#4465)', () => {
  const row = findRow(TIDY_SKILL, '| **Prune plan**');
  assert.ok(row);
  assert.match(row, /The 30 threshold gates staging, not execution: an approved archive still executes after `stale — skipped` drops leave fewer than 30/);
});

test('SKILL.md Step 7.5 verification checklist has a Pruned plans line (#4465)', () => {
  const s = TIDY_SKILL.slice(TIDY_SKILL.indexOf('## Step 7.5: Verify Execution'));
  assert.match(s, /- \[x\] Pruned plans: \{n\} — each listed plan removed \(`git rm`\) and committed, or reported `stale — skipped`/);
});

test('step-6-interactive.md lists prune among the recommendation kinds (#4465)', () => {
  assert.match(STEP6_INTERACTIVE, /every active recommendation from the scans \(delete, prune, defer,/);
});

test('both approval paths record an excluded Prune plan (archive) decline, never an ask one (#4465)', () => {
  const sentence = /An entirely excluded `Prune plan \(archive\)` item records its decline per `scan-procedures\.md` Step 4's Plan retention \(never a `Prune plan \(ask\)` item\)\./;
  assert.match(STEP6_INTERACTIVE, sentence);
  assert.match(APPROVE_MODE, sentence);
});

test('approve-mode.md puts the decline sentence after the paragraph it ends, not mid-paragraph (#4465)', () => {
  const decline = APPROVE_MODE.indexOf('An entirely excluded `Prune plan (archive)` item');
  const tail = APPROVE_MODE.indexOf('precisely because an earlier auto or interactive run left items staged rather than applied.');
  assert.notEqual(decline, -1);
  assert.notEqual(tail, -1);
  assert.ok(decline > tail, 'the decline sentence must follow the "never reached from auto mode" sentence');
});

test('SKILL.md Action Vocabulary defines Prune plan execution and re-verify (#4465)', () => {
  const row = findRow(TIDY_SKILL, '| **Prune plan**');
  assert.ok(row, 'Prune plan Action Vocabulary row is present');
  assert.match(row, /`git rm` each listed plan, one commit/);
  assert.match(row, /`plan-citation-check\.md` still clean, its classification still holds \(related spec still complete; for an orphan, still none; for a very-old plan, its spec still not started\), and `superpowers-plans-retention` still the value that staged it/);
  assert.match(row, /`Prune plan \(archive\)` also re-checks the plan is still past the 7-day cutoff, `Prune plan \(ask\)` that it is still committed/);
  assert.doesNotMatch(row, /still clean, still past the 7-day cutoff/);
  assert.match(row, /`stale — skipped`/);
  assert.match(row, /An entirely excluded `Prune plan \(archive\)` item records its decline per Step 4's Plan retention/);
});

test('policy-schema.md names tidy Step 4 as a superpowers-plans-retention consumer and describes its routing (#4465)', () => {
  const row = findRow(POLICY_SCHEMA, '| `superpowers-plans-retention`');
  assert.ok(row);
  assert.match(row, /`\/claude-tweaks:tidy` Step 4 \(`tidy\/scan-procedures\.md`\)/);
  assert.match(row, /tidy keeps them until 30 or more are past a 7-day cutoff, then stages one bulk prune/);
  assert.match(row, /tidy's Approve section/);
  assert.match(row, /tidy deletes Step 4's would-be-Delete plans/);
  assert.doesNotMatch(row, /tidy deletes closed-record plans/);
});

test('tidy Step 4: the cutoff gates keep-forever only; ask stages regardless of age, an uncommitted plan stays Keep (#4465)', () => {
  const s = step4Section();
  assert.match(s, /The cutoff applies to `keep-forever` only: `ask` stages every would-be Delete regardless of age, but an uncommitted plan \(that same empty output or non-zero exit\) stays Keep under `ask` too, because `git rm` would fail on it\./);
});

test('tidy Step 4: a decline is recorded only for an entirely excluded item; {why} is escaped; failure degrades open; commands run from REPO_ROOT (#4465)', () => {
  const s = step4Section();
  assert.match(s, /A decline is recorded only when every row of the `tidy-prune-plan-\{n\}` item is excluded; excluding some rows records nothing\./);
  assert.match(s, /`\{why\}` is JSON- and shell-escaped\./);
  assert.match(s, /A `record-decline` failure degrades open: log one SKIP note and continue — the proposal may recur\./);
  assert.match(s, /Run both `declined-learning\.js` commands from `\{REPO_ROOT\}` — the store path is relative to the working directory\./);
});

test('tidy Step 4: under keep-forever the citation check runs on past-cutoff candidates only once they reach 30 (#4465)', () => {
  assert.match(step4Section(), /Under `keep-forever`, run the citation check on past-cutoff candidates only once their pre-check count reaches 30; below 30 the count can never yield 30 uncited, so a cited plan is a plain Keep, never a Yours row\./);
});

test('skill-graph.md tidy section names the declined-learning store row (#4465)', () => {
  const start = SKILL_GRAPH.indexOf('\n## tidy\n');
  const end = SKILL_GRAPH.indexOf('\n## visual-review\n');
  assert.ok(start !== -1 && end > start);
  const row = findRow(SKILL_GRAPH.slice(start, end), '| `bin/lib/declined-learning/store.js`');
  assert.ok(row, 'tidy section carries the declined-learning store row');
  assert.match(row, /Step 4's Plan retention looks up a `keep-forever` `Prune plan \(archive\)` decline via `bin\/declined-learning\.js lookup --source tidy`/);
  assert.match(row, /records one via `record-decline --source tidy` when a human excludes that item entirely at Step 6's approval or `--approve`/);
  assert.match(row, /one decline suppresses the archive until reconcile's 180-day `pruneDeclines` expires it/);
});

test('policy-schema.js superpowers-plans-retention summary mentions the tidy bulk prune within the 140-char cap (#4465)', () => {
  const { summary } = POLICY_KEYS.find((k) => k.key === 'superpowers-plans-retention');
  assert.match(summary, /tidy may propose a bulk prune/);
  assert.ok(summary.length <= 140, `${summary.length} chars`);
});
