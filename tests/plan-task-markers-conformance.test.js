'use strict';
// tests/plan-task-markers-conformance.test.js — #3378 AC9: the per-task
// Role/Review-risk value sets are declared once, in
// plugin/bin/lib/plan-audit/parser.js's TASK_MARKER_ROLES/TASK_MARKER_RISKS
// constants, and every prose consumer that restates them
// (plan-authoring-checks.md's authoring guidance, dispatch.md's tier-forwarding
// table) must cite the identical set. A drift here is exactly the silent
// divergence class #3378's own Deliverables list calls out: the parser would
// accept a role the authoring guidance never told anyone to use, or
// dispatch.md would map a role the parser rejects.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { TASK_MARKER_ROLES, TASK_MARKER_RISKS } = require('../plugin/bin/lib/plan-audit/parser');
const { readText } = require('./helpers/read-skill');

const ROOT = path.join(__dirname, '..');
const read = (...p) => readText(path.join(ROOT, ...p));

const sorted = (arr) => [...arr].sort();

// The paragraph (up to the next blank line) that starts at `heading`.
function paragraphFrom(text, heading) {
  const from = text.slice(text.indexOf(heading));
  const end = from.indexOf('\n\n');
  return end === -1 ? from : from.slice(0, end);
}

test('#3378 AC9: TASK_MARKER_ROLES is exactly transcription/integration/judgment, TASK_MARKER_RISKS is exactly high', () => {
  assert.deepStrictEqual(TASK_MARKER_ROLES, ['transcription', 'integration', 'judgment']);
  assert.deepStrictEqual(TASK_MARKER_RISKS, ['high']);
});

test('#3378 AC9: plan-authoring-checks.md\'s marker syntax line cites the identical closed role set', () => {
  const text = read('plugin', 'skills', 'build', 'plan-authoring-checks.md');
  const m = text.match(/\*\*Role:\*\* (\S+)`/);
  assert.ok(m, 'plan-authoring-checks.md must state the `**Role:** <roles>` marker syntax');
  const roles = m[1].split('|');
  assert.deepStrictEqual(sorted(roles), sorted(TASK_MARKER_ROLES));
});

test('#3378 AC9: plan-authoring-checks.md\'s marker syntax line cites the identical closed review-risk set', () => {
  const text = read('plugin', 'skills', 'build', 'plan-authoring-checks.md');
  const m = text.match(/\*\*Review risk:\*\* (\S+)`/);
  assert.ok(m, 'plan-authoring-checks.md must state the `**Review risk:** <risks>` marker syntax');
  const risks = m[1].split('|');
  assert.deepStrictEqual(sorted(risks), sorted(TASK_MARKER_RISKS));
});

test('#3378 AC9: plan-authoring-checks.md names every role individually, with no fourth role value introduced', () => {
  const text = read('plugin', 'skills', 'build', 'plan-authoring-checks.md');
  const section = text.slice(text.indexOf('**Per-task role/review-risk markers (#3378).**'));
  for (const role of TASK_MARKER_ROLES) {
    assert.ok(section.includes(`\`${role}\``), `plan-authoring-checks.md must name the role \`${role}\` in its authoring guidance`);
  }
});

test('#3378 AC9: dispatch.md\'s implementer-tier mapping cites the identical role set, in the canonical order', () => {
  const text = read('plugin', 'skills', 'build', 'dispatch.md');
  const m = text.match(/implementer — `(\w+)` → Fast, `(\w+)` → Standard, `(\w+)` → Capable/);
  assert.ok(m, 'dispatch.md must state the implementer role → profile mapping as `role` → Tier triples');
  assert.deepStrictEqual([m[1], m[2], m[3]], TASK_MARKER_ROLES);
});

test('#3378 AC9: dispatch.md\'s task-review mapping cites the identical review-risk set', () => {
  const text = read('plugin', 'skills', 'build', 'dispatch.md');
  const m = text.match(/task review — `Review risk: (\w+)` → Capable/);
  assert.ok(m, 'dispatch.md must state the task-review risk → profile mapping');
  assert.deepStrictEqual([m[1]], TASK_MARKER_RISKS);
});

test('#3378 AC5: dispatch.md\'s pre-change size:/AC-excerpt/foreground/status-token/tree-immutability paragraphs are unmodified', () => {
  const text = read('plugin', 'skills', 'build', 'dispatch.md');
  assert.match(text, /default every per-task implementer dispatch in this spec to the corresponding model profile — `low` → Fast, `medium` → Standard, `high` → Capable/);
  assert.match(text, /\*\*Forward the spec's Acceptance Criteria to per-task review:\*\*/);
  assert.match(text, /run `npm test` and every other long-running command in the foreground of that turn/);
  assert.match(text, /\*\*Status-token requirement \(#2740\)\.\*\*/);
  assert.match(text, /\*\*Tree-immutability rule for discrimination checks \(#2740\)\.\*\*/);
});

test('#3378 AC5: per-task tier forwarding is conditional on --task-markers reporting markers: true', () => {
  const text = read('plugin', 'skills', 'build', 'dispatch.md');
  const section = text.slice(text.indexOf('**Per-task role/review-risk tier forwarding (#3378).**'));
  assert.match(section, /--task-markers/);
  assert.match(section, /conditional on that call reporting `markers: true`/);
  assert.match(section, /with `markers: false` the instruction paragraphs above are unchanged and nothing here applies/);
});

test('#3378: dispatch.md names no hardcoded model name in its per-task tier-forwarding paragraph (AC7)', () => {
  const text = read('plugin', 'skills', 'build', 'dispatch.md');
  const section = text.slice(text.indexOf('**Per-task role/review-risk tier forwarding (#3378).**'));
  assert.doesNotMatch(section, /\bhaiku\b|\bsonnet\b|\bopus\b|\bfable\b/i);
  assert.match(section, /resolve-profile\.js/);
});

test('AC6.1 AC6.2 (#4640): dispatch.md\'s tier forwarding names `findings` and its one SKIP decision-log line, and continues unmarked', () => {
  const text = read('plugin', 'skills', 'build', 'dispatch.md');
  const section = paragraphFrom(text, '**Per-task role/review-risk tier forwarding (#3378).**');
  assert.match(section, /When that output carries `findings`/);
  assert.match(section, /--status SKIP --section "\/build" --step "Per-task tier forwarding \(degraded\)" --text-file "\{path\}"/);
  assert.match(section, /whether or not an exclusion below fires/);
  assert.match(section, /treated as unmarked for that field, never a stop/);
});

test('AC7.1 (#4640): plan-authoring-checks.md and plan-audit.md each state that a trailing annotation after the marker value is ignored', () => {
  const authoring = read('plugin', 'skills', 'build', 'plan-authoring-checks.md');
  const markers = paragraphFrom(authoring, '**Per-task role/review-risk markers (#3378).**');
  assert.match(markers, /A trailing annotation after the value and whitespace is ignored\./);
  assert.match(markers, /a stderr warning/);
  const audit = read('plugin', 'skills', 'build', 'plan-audit.md');
  const para = paragraphFrom(audit, '`--task-markers {plan-file}` (#3378)');
  assert.match(para, /a trailing annotation after the value and whitespace is ignored/);
  assert.match(para, /each entry is also written to stderr as one warning line/);
});
