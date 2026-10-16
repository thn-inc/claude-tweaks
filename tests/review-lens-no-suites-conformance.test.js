// tests/review-lens-no-suites-conformance.test.js — pins #3001: review Step 3's read-only
// reviewer agents (lens, debate, refutation, gap-sweep) are told, in text that reaches their
// prompts via the composed review-dispatch bundle, never to run the project's test suites,
// builds, dev servers or e2e runners; and the post-fan-out sweep reports leftover listeners.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { compose } = require('../plugin/bin/lib/compose-context/compose');

const SKILLS = path.join(__dirname, '..', 'plugin', 'skills');
const read = (...p) => fs.readFileSync(path.join(SKILLS, ...p), 'utf8');

const CONDITIONS = {
  'integration-model': 'pr-first',
  mode: 'auto',
  attendance: 'headless',
  transport: 'gh',
  'worktree-policy': 'always',
  'work-backend': 'github-issues',
};

const RULE = /never run the project's test suites, builds, dev servers, or e2e runners/;

function section(text, heading) {
  const start = text.indexOf(heading);
  assert.notEqual(start, -1, `missing heading: ${heading}`);
  const next = text.indexOf('\n## ', start + 1);
  return text.slice(start, next === -1 ? text.length : next);
}

function reviewDispatchBundle() {
  return compose(
    [
      { path: 'plugin/skills/_shared/subagent-dispatch-core.md', content: read('_shared', 'subagent-dispatch-core.md') },
      { path: 'plugin/skills/_shared/run-dir-resolution.md', content: read('_shared', 'run-dir-resolution.md') },
    ],
    CONDITIONS,
  );
}

test('the composed review-dispatch bundle carries the verbatim READ-ONLY REVIEW prompt line', () => {
  const sec = section(reviewDispatchBundle(), '## Read-only Reviewer Discipline');
  const line = sec.split('\n').find((l) => l.includes('READ-ONLY REVIEW:'));
  assert.ok(line, 'the section must carry one verbatim prompt line starting READ-ONLY REVIEW:');
  assert.match(line, RULE);
  assert.match(line, /read and report only/);
  assert.match(line, /\/claude-tweaks:test/);
  assert.match(line, /lens 3f's Vacuity-evidence diagnostic/, 'the sole exception must name lens 3f so the rule does not contradict that diagnostic');
});

test('the rule is scoped to read-and-report dispatches, never implementer/test/QA ones', () => {
  const sec = section(reviewDispatchBundle(), '## Read-only Reviewer Discipline');
  assert.match(sec, /lens, debate, refutation, and gap-sweep agents/);
  assert.match(sec, /never applies to an implementer, test, or QA\s+dispatch/);
});

test('step3-lens-dispatch.md instructs inlining the rule, outside the byte-pinned Calibration block', () => {
  const d = read('review', 'step3-lens-dispatch.md');
  assert.match(d, /> \*\*Read-only Reviewer Discipline:\*\*/);
  const calStart = d.indexOf('CALIBRATION (required):');
  const calEnd = d.indexOf('Self-check before sending');
  assert.ok(calStart !== -1 && calEnd > calStart, 'Calibration block anchors not found');
  const cal = d.slice(calStart, calEnd);
  assert.doesNotMatch(cal, RULE);
  assert.doesNotMatch(cal, /READ-ONLY REVIEW/);
});

test('the Foreground note no longer frames running a verification command as an expected lens activity', () => {
  const d = read('review', 'step3-lens-dispatch.md');
  assert.doesNotMatch(d, /runs a verification command \(rather than only reading\/reporting\)/);
  assert.match(d, /> \*\*Foreground Execution Discipline:\*\*[^\n]*Vacuity-evidence diagnostic/);
});

test('the debate, refutation, and gap-sweep prompt templates each carry the READ-ONLY REVIEW placeholder', () => {
  const t = read('review', 'step3-debate-and-refutation.md');
  const hits = t.match(/\[\.\.\. READ-ONLY REVIEW line, verbatim from the review-dispatch bundle's Read-only Reviewer Discipline section \.\.\.\]/g) || [];
  assert.equal(hits.length, 3);
});

test('the pre-dispatch listing also snapshots local TCP listeners next to pre-dispatch-status.txt', () => {
  const d = read('review', 'step3-lens-dispatch.md');
  const para = d.slice(d.indexOf('**Pre-dispatch listing (scratch-sweep baseline).**'), d.indexOf('**`Path:Line` must be file-native'));
  assert.match(para, /pre-dispatch-status\.txt/);
  assert.match(para, /lsof -nP -iTCP -sTCP:LISTEN > \{ctx-dir\}\/pre-dispatch-listeners\.txt/);
  assert.match(para, /lsof.*unavailable[\s\S]*SKIP/);
});

test('the post-fan-out sweep documents a report-only listener diff and its outputs', () => {
  const sweep = section(read('review', 'step3-lens-dispatch.md'), '## Post-fan-out untracked-file sweep');
  assert.match(sweep, /pre-dispatch-listeners\.txt/);
  assert.match(sweep, /command name and port/, 'diff is keyed on command + port, not PID or raw line');
  assert.match(sweep, /Never kill/);
  assert.match(sweep, /cannot attribute/);
  assert.match(sweep, /Fan-out leftovers/);
  assert.match(sweep, /STAGED \{HH:MM:SS\} — Review fan-out left \{n\} new listener\(s\): \{command:port list\}\. Not killed\. Reversibility: n\/a\./);
});

test('the summary template Fan-out leftovers slot lists leftover listeners', () => {
  const t = read('review', 'review-summary-template.md');
  const slot = t.slice(t.indexOf('### Fan-out leftovers'), t.indexOf('### Implementation Hindsight'));
  assert.match(slot, /listener/);
  assert.match(slot, /\{command\}:\{port\}/);
});

test('the high-tier closing sweep in step3-debate-and-refutation.md also runs the listener diff', () => {
  const sec = section(read('review', 'step3-debate-and-refutation.md'), '## Post-fan-out sweep (this file\'s own closing step)');
  assert.match(sec, /pre-dispatch-listeners\.txt/);
});
