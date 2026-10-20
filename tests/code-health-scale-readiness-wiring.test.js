'use strict';
// #2622: focus=scale-readiness must land its criterion, fragment, and the
// focus-mode.md rows (Coverage, Criterion pinning, F2) in the same change as
// its registry key. The fragment's kind and checklist-id lists are derived
// from the generator's CHECKLIST_ITEMS, so the prose stays pinned to the code.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { readText } = require('./helpers/read-skill');

const ROOT = path.join(__dirname, '..');
const FOCUS_MODE = readText(path.join(ROOT, 'plugin/skills/code-health/focus-mode.md'));
const FRAGMENT = readText(path.join(ROOT, 'plugin/skills/_shared/criteria-scale-readiness.md'));
const DOCS = readText(path.join(ROOT, 'docs/getting-started.md'));
const { getCriterion } = require('../plugin/bin/lib/code-health/criteria');
const { FOCUS_GENERATORS } = require('../plugin/bin/lib/code-health/focus-generators');
const { CHECKLIST_ITEMS } = require('../plugin/bin/lib/code-health/candidates-scale-readiness');

function section(md, heading, nextHeading) {
  const start = md.indexOf(`## ${heading}`);
  const end = md.indexOf(`## ${nextHeading}`, start + 1);
  assert.ok(start >= 0 && end > start, `"## ${heading}" followed by "## ${nextHeading}" must exist`);
  return md.slice(start, end);
}

const KINDS = CHECKLIST_ITEMS.flatMap((item) => item.kinds || []);

test('the kind list derived from CHECKLIST_ITEMS is the eight kinds', () => {
  assert.deepStrictEqual(KINDS, [
    'query-in-loop', 'unbounded-list-query', 'unindexed-where-field', 'inline-slow-work',
    'no-cache-layer', 'per-request-db-client', 'unbounded-pool', 'no-monitoring',
  ]);
});

test('AC1.1: FOCUS_GENERATORS lists scale-readiness', () => {
  assert.equal(typeof FOCUS_GENERATORS['scale-readiness'], 'function');
  const out = execFileSync(process.execPath, ['-e', "console.log(Object.keys(require('./plugin/bin/lib/code-health/focus-generators.js').FOCUS_GENERATORS).join(', '))"], { cwd: ROOT, encoding: 'utf8' });
  assert.match(out, /\bscale-readiness\b/);
});

test('the scale-readiness criterion is registered with its fragment', () => {
  assert.deepStrictEqual(getCriterion('scale-readiness'), {
    id: 'scale-readiness',
    appliesTo: ['backend', 'data'],
    confidenceFloor: 'medium',
    fragment: 'criteria-scale-readiness.md',
  });
});

test('AC4.1: focus-mode.md pins scale-readiness and points Coverage and F2 at it', () => {
  assert.match(section(FOCUS_MODE, 'Criterion pinning', 'F0'), /^\| `scale-readiness` \| `scale-readiness` \| `criteria-scale-readiness\.md` \|$/m);
  assert.match(section(FOCUS_MODE, 'Coverage', 'Criterion pinning'), /candidates-scale-readiness\.js/);
  assert.match(section(FOCUS_MODE, 'F2', 'F3'), /focus=scale-readiness: not applicable — no server or data-access signal detected/);
});

test('AC4.1: F1 names the scale-readiness phase field', () => {
  assert.match(section(FOCUS_MODE, 'F1', 'F2'), /`scale-readiness`[^.]*`phase`/);
});

test('AC4.1: the F2 not-applicable reason matches the generator', () => {
  const dir = require('node:fs').mkdtempSync(path.join(require('node:os').tmpdir(), 'scale-wiring-'));
  try {
    execFileSync('git', ['init', '-q'], { cwd: dir });
    require('node:fs').writeFileSync(path.join(dir, 'README.md'), '# nothing\n');
    execFileSync('git', ['add', '.'], { cwd: dir });
    const scan = FOCUS_GENERATORS['scale-readiness'](dir);
    assert.equal(scan.notApplicable, true);
    assert.match(FOCUS_MODE, new RegExp(`focus=scale-readiness: not applicable — ${scan.notApplicableReason}`));
  } finally {
    require('node:fs').rmSync(dir, { recursive: true, force: true });
  }
});

test('AC4.1: docs/getting-started.md counts the shipped verticals including scale-readiness', () => {
  const countWords = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
  const expectedWord = countWords[Object.keys(FOCUS_GENERATORS).length];
  assert.match(DOCS, new RegExp(`${expectedWord} verticals shipped`));
  assert.match(DOCS, /nine verticals shipped/);
  assert.match(DOCS, /`scale-readiness`/);
});

test('AC4.1: the fragment names every kind and every checklist id', () => {
  for (const kind of KINDS) assert.ok(FRAGMENT.includes(`\`${kind}\``), `fragment missing kind \`${kind}\``);
  for (const item of CHECKLIST_ITEMS) assert.ok(FRAGMENT.includes(`\`${item.id}\``), `fragment missing checklist id \`${item.id}\``);
});

test('AC4.1: the fragment carries the reconciliation rule, both phases and the scalability overlap', () => {
  assert.match(FRAGMENT, /`fail` whose candidates you all rejected → `pass \(N rejected: \{reason\}\)`/);
  assert.match(FRAGMENT, /open `scalability` issue at the same anchor/);
  assert.match(FRAGMENT, /open `observability` issue/);
  assert.match(FRAGMENT, /`pre-launch`/);
  assert.match(FRAGMENT, /`pre-scale`/);
});

test('the fragment records the generator\'s known limits under What NOT to flag', () => {
  const notFlag = FRAGMENT.slice(FRAGMENT.indexOf('## What NOT to flag'), FRAGMENT.indexOf('## Severity calibration'));
  assert.ok(notFlag.length > 0);
  assert.match(notFlag, /in-memory/);
  assert.match(notFlag, /module-scope/);
  assert.match(notFlag, /generic-pool/);
  assert.match(notFlag, /leading column/);
});

test('every #2622 mention under plugin/ names focus=scale-readiness on the same line', () => {
  let out = '';
  try {
    out = execFileSync('git', ['grep', '-n', '#2622', '--', 'plugin'], { cwd: ROOT, encoding: 'utf8' });
  } catch (e) {
    if (e.status !== 1) throw e;
  }
  const hits = out.split('\n').filter(Boolean);
  assert.ok(hits.length >= 6, `expected at least 6 hits, got ${hits.length}`);
  for (const hit of hits) assert.match(hit, /scale-readiness/, `#2622 mention without scale-readiness: ${hit}`);
});
