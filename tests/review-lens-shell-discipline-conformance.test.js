// tests/review-lens-shell-discipline-conformance.test.js — pins #3737: review Step 3's dispatched
// agents (lens, debate, refutation, gap-sweep) carry the SHELL DISCIPLINE prompt line, so a
// worktree-isolated reviewer knows the harness refuses compound and variable-path Bash shapes
// before it issues its first command. The line reaches prompts via the composed review-dispatch
// bundle, mirroring the READ-ONLY REVIEW line pinned in review-lens-no-suites-conformance.test.js.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { compose } = require('../plugin/bin/lib/compose-context/compose');
const { readText } = require('./helpers/read-skill');

const SKILLS = path.join(__dirname, '..', 'plugin', 'skills');
const read = (...p) => readText(path.join(SKILLS, ...p));

const CONDITIONS = {
  'integration-model': 'pr-first',
  mode: 'auto',
  attendance: 'headless',
  transport: 'gh',
  'worktree-policy': 'always',
  'work-backend': 'github-issues',
};

const PLACEHOLDER = /\[\.\.\. SHELL DISCIPLINE line, verbatim from the review-dispatch bundle's Working Directory Discipline section \.\.\.\]/g;

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

function assertShellLine(text) {
  const sec = section(text, '## Working Directory Discipline');
  const line = sec.split('\n').find((l) => l.includes('SHELL DISCIPLINE:'));
  assert.ok(line, 'the section must carry one verbatim prompt line starting SHELL DISCIPLINE:');
  assert.match(line, /^`SHELL DISCIPLINE: [^`]+`$/);
  assert.match(line, /one plain Bash command per call/);
  assert.match(line, /literal absolute path/);
  assert.match(line, /never a path held in a shell variable/);
  assert.match(line, /never cd … &&/);
  assert.match(line, /never a heredoc inside a compound command/);
  assert.match(line, /Read and Grep tools/);
}

test('AC1.1: the composed review-dispatch bundle carries the verbatim SHELL DISCIPLINE prompt line', () => {
  assertShellLine(reviewDispatchBundle());
});

test('AC1.1 go-red: the line assertion fails on a bundle without the line', () => {
  const bundle = reviewDispatchBundle()
    .split('\n')
    .filter((l) => !l.includes('SHELL DISCIPLINE:'))
    .join('\n');
  assert.throws(() => assertShellLine(bundle), /must carry one verbatim prompt line/);
});

test('AC1.1: step3-lens-dispatch.md instructs inlining the line, outside the byte-pinned Calibration block', () => {
  const d = read('review', 'step3-lens-dispatch.md');
  const note = d.split('\n').find((l) => l.startsWith('> **Working Directory Discipline:**'));
  assert.ok(note, 'the Working Directory Discipline note line must exist');
  assert.match(note, /Inline the `SHELL DISCIPLINE:` line[^\n]*verbatim into every such prompt/);
  assert.match(note, /outside the byte-identical Calibration\/Output block/);
  const calStart = d.indexOf('CALIBRATION (required):');
  const calEnd = d.indexOf('Self-check before sending');
  assert.ok(calStart !== -1 && calEnd > calStart, 'Calibration block anchors not found');
  assert.doesNotMatch(d.slice(calStart, calEnd), /SHELL DISCIPLINE/);
});

test('AC1.1: the debate, refutation, and gap-sweep templates each carry the SHELL DISCIPLINE placeholder', () => {
  const t = read('review', 'step3-debate-and-refutation.md');
  // One placeholder per template, sliced by each template's own step boundaries — a global
  // count of 3 would still pass if every placeholder landed in a single template.
  const templates = [
    ['debate', '3. **Dispatch debate', '4. **Resolve.** Apply `resolveDebate`'],
    ['refutation', '4. **Dispatch one refutation agent', '5. **Resolve.**'],
    ['gap-sweep', '## Step 3.6: Gap-Sweep', '## Post-fan-out sweep'],
  ];
  for (const [name, startAnchor, endAnchor] of templates) {
    const start = t.indexOf(startAnchor);
    const end = t.indexOf(endAnchor, start);
    assert.ok(start !== -1 && end > start, `${name} template anchors not found`);
    assert.equal((t.slice(start, end).match(PLACEHOLDER) || []).length, 1, `${name} template must carry exactly one SHELL DISCIPLINE placeholder`);
  }
});

test('AC1.1: the Step 3.7 tiebreak dispatch template carries the SHELL DISCIPLINE placeholder', () => {
  const sec = section(read('review', 'step3-tiebreak.md'), '## Dispatch');
  assert.equal((sec.match(PLACEHOLDER) || []).length, 1, 'the tiebreak Dispatch template must carry exactly one SHELL DISCIPLINE placeholder');
});
