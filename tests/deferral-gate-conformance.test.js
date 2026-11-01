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
const { readText } = require('./helpers/read-skill');

const REPO_ROOT = path.join(__dirname, '..');
const read = (rel) => readText(path.join(REPO_ROOT, rel));

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

test('deferral-gate.md\'s Bad reasons list says "pre-existing" alone is not a defer reason for an in-diff file, and names build/SKILL.md as a consumer (#3117)', () => {
  const start = GATE.indexOf('## Bad reasons to skip a fix');
  assert.ok(start >= 0, 'Bad reasons heading must exist');
  const nextHeading = GATE.indexOf('\n## ', start + 1);
  const section = GATE.slice(start, nextHeading === -1 ? undefined : nextHeading);
  assert.ok(section.includes('pre-existence alone is never a defer reason'), 'missing the pre-existing bad-reason bullet');
  assert.ok(section.includes('pre-existing-outside-diff'), 'missing reference to pre-existing-outside-diff');
  const outOfScopeIdx = section.indexOf('Out of scope of this plan');
  const preExistingIdx = section.indexOf('pre-existence alone is never a defer reason');
  assert.ok(outOfScopeIdx > -1 && preExistingIdx > outOfScopeIdx, 'pre-existing bullet must follow the Out of scope bullet');
  assert.ok(GATE.includes('skills/build/SKILL.md'), 'consumer list must name skills/build/SKILL.md');
});

test('deferral-gate.md\'s bundling exception cites materiality-floor.md by literal path', () => {
  assert.ok(GATE.includes('_shared/materiality-floor.md'));
});

test('deferral-gate.md names its consumers, the hard gate, re-verification, and where the reason lives', () => {
  for (const consumer of [
    'skills/review/step3-routing.md', 'skills/reflect/full-mode.md', 'skills/reflect/hindsight-mode.md',
    'skills/wrap-up/residue-sweep.md', 'skills/wrap-up/leftover-routing.md', 'skills/_shared/ledger-format.md',
    'skills/capture/SKILL.md', 'skills/wrap-up/review-console-appendix.md',
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
  'plugin/skills/wrap-up/review-console-appendix.md',
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

test('refused-proposals.md never hardcodes the vocabulary', () => {
  const content = read('plugin/skills/wrap-up/refused-proposals.md');
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

// --- #4772: a refused staged proposal reopens the deferred row naming its path — the one named reopen ---

const REFUSED_MD = read('plugin/skills/wrap-up/refused-proposals.md');
const LEDGER_SKILL = read('plugin/skills/ledger/SKILL.md');
const STEP3_ROUTING = read('plugin/skills/review/step3-routing.md');
const flat = (s) => s.replace(/\s+/g, ' ');

function ledgerOriginSection(md) {
  const start = md.indexOf('\n## Ledger origin\n');
  assert.ok(start >= 0, 'refused-proposals.md has no "## Ledger origin" section');
  const end = md.indexOf('\n## ', start + 1);
  return flat(md.slice(start, end < 0 ? undefined : end));
}
function resolutionTextParagraph(md) {
  const start = md.indexOf('**Resolution-text requirements.**');
  assert.ok(start >= 0, 'ledger-format.md has no Resolution-text requirements paragraph');
  const end = md.indexOf('\n\n', start);
  return flat(md.slice(start, end < 0 ? undefined : end));
}
function reopeningRow(md) {
  const line = md.split('\n').find((l) => l.startsWith('| Reopening resolved items |'));
  assert.ok(line, 'ledger/SKILL.md has no "Reopening resolved items" row');
  return line;
}
function newOriginSentences(section) {
  const i = section.indexOf('When a `deferred` row');
  const j = section.indexOf('A refused proposal that no');
  assert.ok(i >= 0 && j > i, 'new Ledger origin sentences not found');
  return section.slice(i, j);
}
function specQualifiedSentence(paragraph) {
  const i = paragraph.indexOf('In a multi-spec run,');
  const end = paragraph.indexOf('names one proposal.', i);
  assert.ok(i >= 0 && end > i, 'no spec-qualified path sentence');
  return paragraph.slice(i, end + 'names one proposal.'.length);
}
function step3Parenthetical(md) {
  const f = flat(md);
  const i = f.indexOf('(`spec-{N}/staged/review-followup-{n}.md`');
  assert.ok(i >= 0, 'step3-routing.md has no spec-qualified parenthetical');
  return f.slice(i, f.indexOf(')', i) + 1);
}
const DEFER_KEEP_PATH_RE = /names the staged path, `staged\/ledger-record-\{slug\}\.md`|naming the staged path \(`staged\/ledger-record-\{slug\}\.md`\)/;
function assertDeferKeepPathsQualified(md) {
  const lines = md.split('\n').filter((l) => DEFER_KEEP_PATH_RE.test(l));
  assert.ok(lines.length >= 4, `expected at least 4 Defer/Keep Resolution-path lines, found ${lines.length}`);
  for (const l of lines) assert.ok(l.includes('spec-qualified in a multi-spec run'), `a Defer/Keep line writes a bare staged path: ${l.slice(0, 80)}`);
}
function exceptionSentence(paragraph) {
  const i = paragraph.indexOf('The one exception:');
  assert.ok(i >= 0, 'no reopen exception sentence');
  return paragraph.slice(i, paragraph.indexOf('Ledger origin).', i) + 'Ledger origin).'.length);
}

function assertLedgerOrigin(section) {
  assert.ok(!section.includes('came from a ledger item'), 'Ledger origin still keys on the ledger-record-* filename');
  for (const anchor of [
    'When a `deferred` row',
    "the run's active ledger",
    "names the refused proposal's staged path in its Resolution",
    'the exact path',
    '`spec-{N}/staged/{name}`',
    '`staged/ledger-record-*.md`',
    '`staged/review-followup-*.md`',
    '`proposal refused — no defer reason`',
    'delete the staged file',
    'that no `deferred` ledger row names',
    "`_shared/ledger-format.md`'s Location section's resolution rule",
    'Under `--dry-run`',
    "`_shared/ledger-format.md`'s Resolution-text requirements",
  ]) assert.ok(section.includes(anchor), `Ledger origin is missing: ${anchor}`);
}
function assertReopenException(paragraph) {
  const rule = paragraph.indexOf('never a reopen.');
  const exception = paragraph.indexOf('The one exception:');
  assert.ok(rule >= 0, 'the "never a reopen" rule is gone');
  assert.ok(exception > rule, 'the reopen exception must follow the "never a reopen" rule');
  for (const anchor of ['a `deferred` row whose Resolution names a staged record proposal', 'returns to `open`', 'its deferral never completed', '`wrap-up/refused-proposals.md`'])
    assert.ok(paragraph.includes(anchor), `the reopen exception is missing: ${anchor}`);
}
function assertSpecQualifiedPath(paragraph) {
  assert.ok(paragraph.includes('In a multi-spec run,') && paragraph.includes('that path is written spec-qualified — `spec-{N}/staged/{name}`'), 'ledger-format.md does not state the spec-qualified staged path');
}
function assertReopeningRowPointer(row) {
  assert.ok(row.includes("`_shared/ledger-format.md`'s Resolution-text requirements"), 'the anti-pattern row does not point at the exception');
}
function assertStep3Pointer(md) {
  assert.ok(flat(md).includes("(`spec-{N}/staged/review-followup-{n}.md` in a multi-spec run, per `_shared/ledger-format.md`'s Resolution-text requirements)"), 'step3-routing.md does not spec-qualify its ledger Resolution path');
}

const OLD_FIRST = flat("When the refused proposal came from a ledger item (`staged/ledger-record-*.md`): set that item's status back to `open` with note `proposal refused — no defer reason`, so the ledger's own nothing-left-behind gate resurfaces it on the next resolve; delete the staged file (the ledger item is the durable trace).");
const OLD_ROW = '| Reopening resolved items | Terminal statuses are final — if the fix was wrong, create a new item |';

test('AC1.1, AC1.2: Ledger origin keys on the deferred row naming the refused staged path, review-followup- included', () => {
  assertLedgerOrigin(ledgerOriginSection(REFUSED_MD));
});
test('AC1.1 go-red: the ledger-record-*-only opening fails the Ledger origin pin', () => {
  const s = ledgerOriginSection(REFUSED_MD);
  const end = s.indexOf('(the ledger item is the durable trace).') + '(the ledger item is the durable trace).'.length;
  const mutated = s.slice(0, s.indexOf('When a `deferred` row')) + OLD_FIRST + s.slice(end);
  assert.notEqual(mutated, s);
  assert.throws(() => assertLedgerOrigin(mutated));
});
test('AC1.1 go-red: dropping the "Today\'s producers are" sentence fails the positive anchor loop', () => {
  const s = ledgerOriginSection(REFUSED_MD);
  const i = s.indexOf("Today's producers are");
  const end = s.indexOf("record proposal).", i) + "record proposal).".length;
  assert.ok(i >= 0 && end > i);
  const mutated = s.slice(0, i) + s.slice(end + 1);
  assert.notEqual(mutated, s);
  assert.throws(() => assertLedgerOrigin(mutated), /Ledger origin is missing/);
});
test('AC1.1: the rationale for the spec-qualified path lives in ledger-format.md only', () => {
  assert.ok(!ledgerOriginSection(REFUSED_MD).includes('never match each other'));
});
test('AC2.1: ledger-format.md records the refused-proposal reopen as the one exception, deferred rows only', () => {
  assertReopenException(resolutionTextParagraph(LEDGER));
});
test('AC2.1 go-red: removing the exception sentence fails the pin', () => {
  const p = resolutionTextParagraph(LEDGER);
  const mutated = p.replace(/ The one exception:[^]*?Ledger origin\)\./, '');
  assert.notEqual(mutated, p);
  assert.throws(() => assertReopenException(mutated));
});
test('ledger-format.md spec-qualifies a multi-spec staged path, and step3-routing.md points at it (plan-review clarification)', () => {
  assertSpecQualifiedPath(resolutionTextParagraph(LEDGER));
  assertStep3Pointer(STEP3_ROUTING);
});
test('go-red: dropping the spec-qualification sentence or the step3 pointer fails the pins', () => {
  const p = resolutionTextParagraph(LEDGER);
  const mutated = p.replace(/ In a multi-spec run, whose one ledger[^]*?names one proposal\./, '');
  assert.notEqual(mutated, p);
  assert.throws(() => assertSpecQualifiedPath(mutated));
  assert.throws(() => assertStep3Pointer(STEP3_ROUTING.replace(/ \(`spec-\{N\}\/staged\/review-followup-\{n\}\.md` in a multi-spec run[^)]*\)/, '')));
});
test('AC3.1: ledger/SKILL.md\'s Reopening row points at the exception', () => {
  assertReopeningRowPointer(reopeningRow(LEDGER_SKILL));
});
test('AC3.1 go-red: the pre-change row fails the pin', () => {
  assert.throws(() => assertReopeningRowPointer(OLD_ROW));
});
test('Defer/Keep bullets in ledger-format.md spec-qualify the Resolution path they tell the writer to record', () => {
  assertDeferKeepPathsQualified(LEDGER);
});
test('Defer/Keep go-red: stripping the pointer from one such line fails the pin', () => {
  const pointer = ' (spec-qualified in a multi-spec run, per the Resolution-text requirements)';
  const lines = LEDGER.split('\n');
  const k = lines.findIndex((l) => DEFER_KEEP_PATH_RE.test(l) && l.includes(pointer));
  assert.ok(k >= 0);
  lines[k] = lines[k].replace(pointer, '');
  const mutated = lines.join('\n');
  assert.notEqual(mutated, LEDGER);
  assert.throws(() => assertDeferKeepPathsQualified(mutated), /bare staged path/);
});
test('AC5.2: no DEFER_REASONS value in the edited spans', () => {
  const spans = [
    newOriginSentences(ledgerOriginSection(REFUSED_MD)),
    exceptionSentence(resolutionTextParagraph(LEDGER)),
    specQualifiedSentence(resolutionTextParagraph(LEDGER)),
    step3Parenthetical(STEP3_ROUTING),
    reopeningRow(LEDGER_SKILL),
  ];
  for (const v of DEFER_REASONS) for (const s of spans) assert.ok(!s.includes(v), `edited text names Defer-reason value ${v}`);
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
