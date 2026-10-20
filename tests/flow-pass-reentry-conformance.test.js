// tests/flow-pass-reentry-conformance.test.js — #3497: pins the skill prose that
// widens `/claude-tweaks:flow {specs} review-console` from a Halt-only resume
// into an ended-parent re-entry. The eligibility rule lives in code
// (plugin/bin/lib/flow/consolidated-pass.js); the prose invokes it and names
// each of its reason codes, never restating the conditions. Live-prose reads,
// because these sentences are the contract; each surface's assertions run
// through one assertReentryProse() that a doctored copy must fail (go-red).
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { REENTRY_REASONS } = require('../plugin/bin/lib/flow/consolidated-pass');
const { toPosix } = require('../plugin/bin/lib/shared-primitives');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const collapse = (s) => s.replace(/\s+/g, ' ');

function sectionBetween(text, startRe, endRe) {
  const m = startRe.exec(text);
  if (!m) return null;
  const rest = text.slice(m.index);
  const e = endRe.exec(rest.slice(m[0].length));
  assert.ok(e, 'end anchor missing — slice would widen to the rest of the file');
  return rest.slice(0, m[0].length + e.index);
}

const STEPS = read('plugin/skills/flow/steps-and-gates.md');
const CONSOLE = read('plugin/skills/flow/multispec-review-console.md');
const MULTI = read('plugin/skills/flow/multi-spec.md');

const REENTRY_HEADING = /^## Re-entry after the parent session ended\r?$/m;
const reentrySection = (text) => sectionBetween(text, REENTRY_HEADING, /^## /m);
const onStopSection = (text) => sectionBetween(text, /^## On stop \(option 3\)\r?$/m, /^## /m);
const mixedSection = (text) =>
  sectionBetween(text, /^## Mixed execution \(a spec built outside \/flow\)\r?$/m, /^## /m);

// The two `review-console` lines of steps-and-gates.md (the bold resume-only
// paragraph and the valid-examples bullet) — each must name both entry cases.
function assertReentryProse(stepsText) {
  const lines = stepsText.split(/\r?\n/).filter((l) => l.includes('`review-console`'));
  assert.equal(lines.length, 2, 'expected exactly two lines naming `review-console`');
  for (const line of lines) {
    const c = collapse(line);
    assert.ok(c.includes('after a Halt'), `line must name the Halt resume case: ${c.slice(0, 80)}`);
    assert.ok(c.includes('ended-parent re-entry'), `line must name ended-parent re-entry: ${c.slice(0, 80)}`);
  }
}

test('AC1.1 steps-and-gates.md names both entry conditions at both review-console sites', () => {
  assertReentryProse(STEPS);
});

test('#3497 negative control: dropping ended-parent re-entry from steps-and-gates.md fails the check', () => {
  const doctored = STEPS.split('ended-parent re-entry').join('');
  assert.throws(() => assertReentryProse(doctored));
});

test('AC1.1 multispec-review-console.md On stop paragraph cross-references re-entry', () => {
  const sec = onStopSection(CONSOLE);
  assert.ok(sec, 'On stop (option 3) section missing');
  assert.ok(collapse(sec).includes('ended-parent re-entry'));
});

test('AC1.2 multispec-review-console.md has the re-entry section, placed after Locating and before Numbering', () => {
  const sec = reentrySection(CONSOLE);
  assert.ok(sec, 'multispec-review-console.md must have "## Re-entry after the parent session ended"');
  const locating = CONSOLE.indexOf('## Locating the parent run directory');
  const at = CONSOLE.indexOf('## Re-entry after the parent session ended');
  const numbering = CONSOLE.indexOf('## Numbering rules');
  assert.ok(locating !== -1 && locating < at && at < numbering, 'section must sit between Locating and Numbering rules');

  const c = collapse(sec);
  for (const token of [
    'checkPassReentry',
    'consolidated-pass.js',
    'online: true',
    'multispec-batch-curation.md',
    'engine-state.json',
    'MULTISPEC_CURATION_DEFER',
    'MULTISPEC_REVIEW_DEFER',
    'MULTISPEC_PARENT_DIR',
    'PIPELINE_RUN_DIR="{parent-run-dir}" /claude-tweaks:flow #{A},#{B} review-console',
    '/claude-tweaks:wrap-up #{n}',
    'spec-status',
    '--status complete',
    '--status not-run',
    'checkPassReentry(process.argv[1]',
    'is a stop: report it and never proceed',
    'online PR check unavailable',
  ]) {
    assert.ok(c.includes(token), `re-entry section must contain ${token}`);
  }
  // A logged Stop takes the Halt resume, named before the eligibility call.
  const halt = c.indexOf('terminal decision');
  assert.ok(halt !== -1, 're-entry section must name the logged terminal decision');
  assert.ok(halt < c.indexOf('checkPassReentry'), 'the Halt resume must come before the eligibility call');
});

test('#3497 every REENTRY_REASONS code is named in the re-entry section', () => {
  assert.ok(Array.isArray(REENTRY_REASONS) && REENTRY_REASONS.length > 0);
  const c = collapse(reentrySection(CONSOLE) || '');
  for (const code of REENTRY_REASONS) {
    assert.ok(c.includes(`\`${code}\``), `re-entry section must name \`${code}\``);
  }
});

test('AC2.1 retired limit sentences are gone from every skill file', () => {
  const retired = ['no documented step re-runs the pass', 'only re-presents a console after a Halt'];
  // Display ID: forward slashes on every OS (recursive readdirSync joins with
  // the native separator); the fs path below stays native.
  const hitId = (f, phrase, sep = path.sep) => `${toPosix(String(f), sep)}: ${phrase}`;
  assert.equal(hitId('flow\\x.md', retired[0], path.win32.sep), `flow/x.md: ${retired[0]}`);
  const walk = (dir) => {
    const files = fs.readdirSync(dir, { recursive: true }).filter((f) => String(f).endsWith('.md'));
    const hits = [];
    for (const f of files) {
      const c = collapse(fs.readFileSync(path.join(dir, String(f)), 'utf8'));
      for (const phrase of retired) if (c.includes(phrase)) hits.push(hitId(f, phrase));
    }
    return { files, hits };
  };
  const real = walk(path.join(ROOT, 'plugin', 'skills'));
  assert.ok(real.files.length > 50, 'walk must reach the skill corpus');
  assert.deepEqual(real.hits, []);
  // Control: the same walk flags a doctored nested skill file carrying a
  // retired phrase split across a line break.
  const doctored = fs.mkdtempSync(path.join(require('os').tmpdir(), 'ct-retired-'));
  fs.mkdirSync(path.join(doctored, 'flow'));
  fs.writeFileSync(path.join(doctored, 'flow', 'x.md'), 'Note: no documented step\nre-runs the pass.\n');
  assert.deepEqual(walk(doctored).hits, ['flow/x.md: no documented step re-runs the pass']);
});

test('AC3.1 Mixed execution step 3 names the review-console re-entry', () => {
  const sec = mixedSection(MULTI);
  assert.ok(sec, 'Mixed execution section missing');
  const step3 = sec.split(/\r?\n/).find((l) => /^3\. /.test(l));
  assert.ok(step3, 'step 3 bullet missing');
  const c = collapse(step3);
  assert.ok(c.includes('/claude-tweaks:flow #{A},#{B} review-console'));
  assert.ok(c.includes('PIPELINE_RUN_DIR="{parent-run-dir}"'), 'step 3 must use the adopt-the-parent-dir invocation form');
  assert.ok(!c.includes('treat the run as already closed'));
});

test('AC3.2 Already closed? is scoped to landed or archived and keeps the lossy fallback', () => {
  const sec = mixedSection(MULTI);
  const para = sec.split(/\r?\n/).find((l) => l.startsWith('**Already closed?**'));
  assert.ok(para, 'Already closed? paragraph missing');
  const c = collapse(para);
  for (const token of ['landed', 'archived', '/claude-tweaks:wrap-up #{n}', 'never the run-level batch pass']) {
    assert.ok(c.includes(token), `Already closed? paragraph must contain ${token}`);
  }
});
