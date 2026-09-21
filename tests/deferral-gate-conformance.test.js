// tests/deferral-gate-conformance.test.js
// Pins skills/_shared/deferral-gate.md (prose) to bin/lib/issues/record.js's
// DEFER_REASONS (code) and to the consumers that cite the gate instead of
// restating it. #620 lays down the contract half; #621-#625 extend this file
// with per-consumer assertions.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { DEFER_REASONS } = require('../plugin/bin/lib/issues/record.js');

const REPO_ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');

const GATE = read('plugin/skills/_shared/deferral-gate.md');
const LEDGER = read('plugin/skills/_shared/ledger-format.md');
const AUTONOMY_SRC = read('plugin/bin/lib/issues/autonomy.js');

// The vocabulary is the first fenced block after the "## `Defer-reason:` vocabulary"
// heading; each line is "{value} — {one-line definition}".
function parseVocabulary(md) {
  const start = md.indexOf('## `Defer-reason:` vocabulary');
  assert.ok(start >= 0, 'deferral-gate.md must have a "## `Defer-reason:` vocabulary" heading');
  const fenceOpen = md.indexOf('\n```\n', start);
  assert.ok(fenceOpen >= 0, 'vocabulary heading must be followed by a fenced list');
  const fenceClose = md.indexOf('\n```', fenceOpen + 5);
  assert.ok(fenceClose > fenceOpen, 'vocabulary fence must close');
  return md
    .slice(fenceOpen + 5, fenceClose)
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => l.split(' — ')[0].trim());
}

// --- vocabulary: prose == code ---

test('deferral-gate.md fenced vocabulary equals DEFER_REASONS as a set (and in order)', () => {
  const prose = parseVocabulary(GATE);
  assert.deepEqual(new Set(prose), new Set(DEFER_REASONS));
  assert.deepEqual(prose, [...DEFER_REASONS]);
});

test('every vocabulary line carries a one-line definition', () => {
  const start = GATE.indexOf('## `Defer-reason:` vocabulary');
  const fenceOpen = GATE.indexOf('\n```\n', start);
  const fenceClose = GATE.indexOf('\n```', fenceOpen + 5);
  const lines = GATE.slice(fenceOpen + 5, fenceClose).split('\n').filter((l) => l.trim() !== '');
  for (const l of lines) assert.match(l, /^[a-z-]+ — \S/, l);
});

// --- fix-now criteria and bad reasons live in the gate file ---

const FIX_NOW_ANCHORS = ['≤5 files', 'not yet built', 'product/design decision', 'external state', '>10 unrelated tests'];
const BAD_REASON_ANCHORS = [
  'Out of scope of this plan', 'Following plan verbatim', 'might want X', 'Bundle of small items',
  'Premature without consumer signal', 'Plan-prescribed routing', 'severity is never a defer reason',
];

for (const anchor of FIX_NOW_ANCHORS) {
  test(`deferral-gate.md states the fix-now criterion "${anchor}"`, () => {
    assert.ok(GATE.includes(anchor));
  });
}

for (const anchor of BAD_REASON_ANCHORS) {
  test(`deferral-gate.md states the bad reason "${anchor}"`, () => {
    assert.ok(GATE.includes(anchor));
  });
}

test('deferral-gate.md\'s bundling exception cites materiality-floor.md by literal path', () => {
  assert.ok(GATE.includes('_shared/materiality-floor.md'));
});

test('deferral-gate.md names its consumers, the hard gate, re-verification, and where the reason lives', () => {
  for (const consumer of [
    'skills/review/step3-routing.md', 'skills/reflect/full-mode.md', 'skills/reflect/hindsight-mode.md',
    'skills/wrap-up/residue-sweep.md', 'skills/wrap-up/leftover-routing.md', 'skills/_shared/ledger-format.md',
    'skills/capture/SKILL.md',
  ]) assert.ok(GATE.includes(consumer), consumer);
  assert.ok(GATE.includes('## The hard gate'));
  assert.ok(GATE.includes('## Re-verification'));
  assert.ok(GATE.includes('## Where the reason lives'));
  assert.ok(GATE.includes('by key, never by position'));
});

// --- STRUCTURED_FLOOR covers the whole vocabulary (a gap would fail silently to false) ---

test('autonomy.js STRUCTURED_FLOOR has exactly one entry per DEFER_REASONS member', () => {
  const start = AUTONOMY_SRC.indexOf('const STRUCTURED_FLOOR = Object.freeze({');
  assert.ok(start >= 0, 'STRUCTURED_FLOOR literal must exist');
  const end = AUTONOMY_SRC.indexOf('});', start);
  const literal = AUTONOMY_SRC.slice(start, end);
  const keys = [...literal.matchAll(/'([a-z-]+)':\s*(?:true|false)/g)].map((m) => m[1]);
  assert.deepEqual(new Set(keys), new Set(DEFER_REASONS));
  assert.equal(keys.length, DEFER_REASONS.length, 'no duplicate keys');
});

// --- ledger-format.md cites the gate instead of owning the criteria ---

test('ledger-format.md cites _shared/deferral-gate.md and no longer restates the bad-reasons list', () => {
  assert.ok(LEDGER.includes('_shared/deferral-gate.md'));
  assert.ok(!LEDGER.includes('Bundle of small items'));
});

test('ledger-format.md keeps its Phase heading names intact (consumers grep them)', () => {
  for (const heading of [
    '### Phase 1 — Exhaust fixes (agent, silent)',
    '### Phase 2 — Present remainder (per-item user input required)',
    '### Phase 3 — Apply user decisions',
  ]) assert.ok(LEDGER.includes(heading), heading);
});

// --- #621: consumers cite the gate and stamp Defer-reason ---

const CONSUMER_FILES = [
  'plugin/skills/review/step3-routing.md',
  'plugin/skills/reflect/full-mode.md',
  'plugin/skills/reflect/hindsight-mode.md',
  'plugin/skills/reflect/SKILL.md',
  'plugin/skills/wrap-up/residue-sweep.md',
  'plugin/skills/wrap-up/leftover-routing.md',
  'plugin/skills/visual-review/browser-review.md',
  'plugin/skills/capture/SKILL.md',
];

for (const rel of CONSUMER_FILES) {
  test(`${rel} cites _shared/deferral-gate.md`, () => {
    assert.ok(read(rel).includes('_shared/deferral-gate.md'));
  });
}

test('the retired defer wordings appear nowhere in the consumer files', () => {
  for (const rel of CONSUMER_FILES) {
    const content = read(rel);
    assert.ok(!content.includes('Has a clear trigger documented for when to revisit'), rel);
    assert.ok(!content.includes('starts exactly where a captured idea starts'), rel);
  }
});

test('reflect SKILL.md and leftover-routing.md carry Defer-reason in their staged-header blocks', () => {
  assert.match(read('plugin/skills/reflect/SKILL.md'), /^Defer-reason: tangential$/m);
  assert.ok(read('plugin/skills/wrap-up/leftover-routing.md').includes("'\\nDefer-reason: ' + process.argv[2]"));
});

test('no file outside deferral-gate.md restates the fix-now criteria', () => {
  const skillsDir = path.join(REPO_ROOT, 'plugin', 'skills');
  const offenders = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.md')) {
        const rel = path.relative(REPO_ROOT, p);
        if (rel === path.join('plugin', 'skills', '_shared', 'deferral-gate.md')) continue;
        const c = fs.readFileSync(p, 'utf8');
        if (c.includes('≤5 files') || c.includes('no spans across unrelated systems')) offenders.push(rel);
      }
    }
  };
  walk(skillsDir);
  assert.deepEqual(offenders, []);
});

// --- #622: the console refuses reason-less proposals; the reason travels the audit trail ---

test('both consoles and the narrowing auto-file cite refused-proposals.md', () => {
  for (const rel of [
    'plugin/skills/wrap-up/review-console.md',
    'plugin/skills/flow/multispec-review-console.md',
    'plugin/skills/wrap-up/ledger-narrowing-auto-file.md',
  ]) assert.ok(read(rel).includes('refused-proposals.md'), rel);
});

test('refused-proposals.md stays within its 3 KB budget and never hardcodes the vocabulary', () => {
  const content = read('plugin/skills/wrap-up/refused-proposals.md');
  assert.ok(Buffer.byteLength(content, 'utf8') <= 3072, `size ${Buffer.byteLength(content, 'utf8')}`);
  assert.ok(content.includes('DEFER_REASONS'));
  for (const v of ['needs-human-decision', 'pre-existing-outside-diff', 'genuinely-larger', 'blocked-external', 'blocked-dependency']) {
    assert.ok(!content.includes(v), `hardcoded vocabulary value: ${v}`);
  }
});

test('the audit trail renders (defer-reason: {value}) — (blocker: {category}) is retired', () => {
  assert.ok(read('plugin/skills/wrap-up/summary-template.md').includes('Defer-reason'));
  const offenders = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.md') && /\(blocker: /.test(fs.readFileSync(p, 'utf8'))) {
        offenders.push(path.relative(REPO_ROOT, p));
      }
    }
  };
  walk(path.join(REPO_ROOT, 'plugin', 'skills'));
  assert.deepEqual(offenders, []);
});

test('auto-decision-log.md defines the REFUSED entry kind', () => {
  assert.ok(read('plugin/skills/_shared/auto-decision-log.md').includes('REFUSED'));
});

// --- #623: born-shaped matrix rows + composer provenance ---

test('work-record.md carries the born-shaped rows for /wrap-up, /reflect, /review', () => {
  const wr = read('plugin/skills/_shared/work-record.md');
  const matrix = read('plugin/skills/_shared/work-record-permission-matrix.md');
  for (const actor of ['/wrap-up', '/reflect', '/review']) {
    const row = matrix.split('\n').find((l) => l.startsWith(`| **\`${actor}\`**`));
    assert.ok(row, `${actor} row`);
    assert.ok(row.includes('ready'), `${actor} Adds ready`);
    assert.ok(row.includes('specShapedBody'), `${actor} conditions on specShapedBody`);
  }
  assert.ok(!matrix.includes('is the only actor this covers'));
  const bornReady = wr.slice(wr.indexOf('## Born-ready rule'));
  assert.ok(bornReady.includes('side-effect'));
});

test('autonomy-ceiling.md notes queueWriteAutoFile proposals are born-shaped via specShapedBody', () => {
  const ac = read('plugin/skills/_shared/autonomy-ceiling.md');
  const row = ac.split('\n').find((l) => l.startsWith('| `queueWriteAutoFile` |'));
  assert.ok(row && row.includes('specShapedBody'));
});

// --- #624: producers compose via specShapedBody, both landing states named ---

const PRODUCER_FILES_624 = [
  'plugin/skills/wrap-up/leftover-routing.md',
  'plugin/skills/_shared/ledger-format.md',
  'plugin/skills/reflect/SKILL.md',
  'plugin/skills/wrap-up/residue-sweep.md',
  'plugin/skills/review/step3-routing.md',
];

for (const rel of PRODUCER_FILES_624) {
  test(`${rel} names specShapedBody and both landing states`, () => {
    const c = read(rel);
    assert.ok(c.includes('specShapedBody'), 'specShapedBody');
    assert.ok(c.includes('born-ready'), 'born-ready');
    assert.ok(c.includes('needs:definition'), 'needs:definition');
  });
}

test('the retired stub-composition wordings appear nowhere under skills/', () => {
  const offenders = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.md')) {
        const c = fs.readFileSync(p, 'utf8');
        if (c.includes('Compose the body with a `Trigger:` line')) offenders.push(path.relative(REPO_ROOT, p));
        if (c.includes("no `risk`/`size`/`ready` (scoring and promotion")) offenders.push(path.relative(REPO_ROOT, p));
      }
    }
  };
  walk(path.join(REPO_ROOT, 'plugin', 'skills'));
  assert.deepEqual(offenders, []);
});

// Composition probe — the mechanical stand-in for the spec's dry-run-preview AC:
// compose the exact payloads the producer prose specifies and validate the
// artifact against the staged-file contract and the spec-shaped structural check.
test('a born-ready leftover payload composes with all contract elements and passes the structural check', () => {
  const { specShapedBody: ssb, recordPayload: rp } = require('../plugin/bin/lib/issues/record.js');
  const body = ssb({
    header: '', currentState: 'The retry helper exists; cleanup path unfinished (src/retry.js).',
    deliverables: '- [ ] finish the cleanup path', acceptanceCriteria: 'node --test test/retry.test.js passes',
    releaseNote: 'No user-visible change — internal retry-cleanup fix.',
    filedBy: 'wrap-up leftover routing',
    provenance: { origin: 'wrap-up leftover from #42', deferReason: 'genuinely-larger' },
    footer: '_Filed by `wrap-up leftover routing` via specShapedBody._',
  });
  const p = rp({ title: 't', body, type: 'task', risk: 'low', size: 'low', ready: true });
  for (const needle of ['## Current State', '## Deliverables', '## Acceptance Criteria', 'Origin: wrap-up leftover from #42', 'Defer-reason: genuinely-larger', 'via specShapedBody']) {
    assert.ok(p.body.includes(needle), needle);
  }
  assert.deepEqual(p.labels, ['risk:low', 'size:low', 'ready']);
  for (const marker of ['TBD', 'TODO', '<!-- ambiguity:']) assert.ok(!p.body.includes(marker), marker);
  assert.strictEqual((p.body.match(/^Defer-reason: /gm) || []).length, 1);
});

test('a needs-you leftover payload composes Open Question with no ready and no scoring', () => {
  const { specShapedBody: ssb, recordPayload: rp } = require('../plugin/bin/lib/issues/record.js');
  const body = ssb({
    header: '', currentState: 'Two mutually exclusive designs are on the table.',
    deliverables: '- [ ] settle the choice', openQuestion: 'open choice: project-local skill vs docs subsection',
    releaseNote: 'No user-visible change yet — pending definition.',
    filedBy: 'wrap-up leftover routing',
    provenance: { origin: 'wrap-up leftover from #42', deferReason: 'needs-human-decision' },
    footer: '_Filed by `wrap-up leftover routing` via specShapedBody._',
  });
  const p = rp({ title: 't', body, type: 'task' });
  assert.ok(p.body.includes('## Open Question'));
  assert.ok(!p.body.includes('## Acceptance Criteria'));
  assert.deepEqual(p.labels, []);
});

// --- #625: capture's shaped-body branch ---

test('capture/SKILL.md carries the Shaped-body branch, the flag, and still the character-budget cap', () => {
  const c = read('plugin/skills/capture/SKILL.md');
  assert.ok(c.includes('Shaped-body branch'));
  assert.ok(c.includes('--defer-reason='));
  assert.ok(c.includes('Hard cap: ~400 characters'));
});

test('both CLAUDE.md copies name the spec-shaped body in the no-implicit-deferrals bullet', () => {
  for (const rel of ['plugin/skills/init/claude-md-template.md', 'CLAUDE.md']) {
    const bullet = read(rel).split('\n').find((l) => l.includes('**No implicit deferrals.**'));
    assert.ok(bullet, rel);
    assert.ok(bullet.includes('spec-shaped body'), rel);
    assert.ok(bullet.includes('Defer-reason'), rel);
  }
});

test('no Capture pass-through still defers to a not-yet-landed #625 flag', () => {
  const offenders = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.md')) {
        const c = fs.readFileSync(p, 'utf8');
        if (c.includes('arrives with #625') || c.includes("#625's flag arrives")) offenders.push(path.relative(REPO_ROOT, p));
      }
    }
  };
  walk(path.join(REPO_ROOT, 'plugin', 'skills'));
  assert.deepEqual(offenders, []);
});

// AC 1's label/body shape, verified by composition probe (a live filing would
// pollute the real tracker — deviation stated in the PR body).
test('a shaped-branch born-ready filing composes the exact labels and body AC 1 names', () => {
  const { specShapedBody: ssb, recordPayload: rp } = require('../plugin/bin/lib/issues/record.js');
  const body = ssb({
    header: '', currentState: 'c', deliverables: 'd', acceptanceCriteria: 'a', releaseNote: 'r',
    filedBy: 'capture', provenance: { deferReason: 'tangential' },
    footer: '_Filed by `capture` via specShapedBody._',
  });
  const p = rp({ title: 't', body, type: 'task', origin: 'capture', risk: 'low', size: 'medium', ready: true, deferReason: 'tangential' });
  assert.deepEqual(p.labels, ['by:capture', 'risk:low', 'size:medium', 'ready']);
  assert.strictEqual((p.body.match(/^Defer-reason: tangential$/gm) || []).length, 1);
  assert.ok(p.body.includes('via specShapedBody'));
});

// --- #1703: --source intake exemption from the deferral check ---

test('capture/SKILL.md names --source intake in at least three places, the deferral-check exemption, and the CSC trust boundary', () => {
  const c = read('plugin/skills/capture/SKILL.md');
  assert.ok((c.match(/--source intake/g) || []).length >= 3, 'at least three --source intake mentions');
  assert.ok(c.includes('other than `intake`'), 'deferral check names the intake exemption');
  assert.ok(c.includes('any `--source`'), 'every non-intake --source value keeps today\'s rule');
  const csc = c.slice(c.indexOf('## Component-Skill Contract'));
  assert.ok(csc.includes('prose-trusted'), 'CSC states the trust boundary');
});
