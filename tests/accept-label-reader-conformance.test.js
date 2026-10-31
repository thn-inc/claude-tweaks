'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { stripComments, stripperVerdict, STRIPPER_VERDICT_MESSAGES } = require('./helpers/strip-comments');
const { readText } = require('./helpers/read-skill');
const { acceptanceOf, parseRecordFacets } = require('../plugin/bin/lib/issues/record-vocabulary');
const { dispositionState } = require('../plugin/bin/lib/issues/acceptance');
const { classifyWatchedRecord } = require('../plugin/bin/lib/issues/merge-lane-breaker');
const { trustRows } = require('../plugin/bin/lib/issues/trust');
const { runVerify } = require('../plugin/bin/lib/wrap-up/engine-verify');

// #4610 expand step: the acceptance verdict labels are read under two spellings,
// demo:* (legacy) and accept:* (successor), until the contract step removes the
// first. Every reader must see both, resolved by the one precedence rule in
// record-vocabulary.js's acceptanceOf. This suite pins three things:
//   - AC3.1: readers that classify a record agree on a mixed-label record.
//   - AC3.3: no reader sees `accept:pending` (or any accept:* label) as "no
//     acceptance state", and a NEW module that reads demo:* labels fails here
//     until it is classified.
//   - the guard: a demo:* verdict literal in plugin/bin code outside the four
//     modules that must spell it (the vocabulary, the batch marker, and the two
//     readers that report the legacy spelling back) fails.
const BIN_ROOT = path.join(__dirname, '..', 'plugin', 'bin');

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

const rel = (file) => path.relative(BIN_ROOT, file).replace(/\\/g, '/');
const BIN_FILES = walk(BIN_ROOT);

// --- AC3.1: mixed labels, every reader ---

const STATES = ['pending', 'approved', 'changes-requested'];
// Task 1's table (tests/bin-lib/issues/acceptance.test.js), each pair read in both orders.
const MIXED_PAIRS = [
  [['accept:pending', 'demo:changes-requested'], 'changes-requested'],
  [['accept:approved', 'demo:changes-requested'], 'changes-requested'],
  [['accept:approved', 'demo:pending'], 'pending'],
  [['accept:approved', 'demo:approved'], 'approved'],
  [['accept:pending', 'accept:approved'], 'pending'],
  [['demo:pending', 'demo:approved'], 'pending'],
  [['demo:approved', 'demo:changes-requested'], 'changes-requested'],
  [['accept:approved', 'accept:changes-requested'], 'changes-requested'],
];
const NOW = Date.parse('2026-10-31T00:00:00.000Z');

function breakerAction(labels) {
  return classifyWatchedRecord({ number: 7, state: 'OPEN', labels }, [], NOW, 14);
}

// The trust cell counts one closed record under exactly one bucket.
function trustBucket(labels) {
  const [row] = trustRows([{ number: 7, labels: ['by:capture', 'risk:low', ...labels], body: '', state: 'CLOSED' }]);
  assert.equal(row.total, 1);
  return { approved: row.approved, changesRequested: row.changesRequested, undispositioned: row.undispositioned };
}

const BUCKET = {
  pending: { approved: 0, changesRequested: 0, undispositioned: 1 },
  approved: { approved: 1, changesRequested: 0, undispositioned: 0 },
  'changes-requested': { approved: 0, changesRequested: 1, undispositioned: 0 },
};

test('AC3.1: dispositionState, parseRecordFacets, the lane breaker and the trust cell agree on every mixed pair', () => {
  for (const [pair, want] of MIXED_PAIRS) {
    for (const labels of [pair, [...pair].reverse()]) {
      const name = labels.join('+');
      assert.equal(dispositionState(labels), want, `dispositionState ${name}`);
      assert.equal(parseRecordFacets(labels).acceptance, want, `parseRecordFacets ${name}`);
      const action = breakerAction(labels);
      if (want === 'changes-requested') {
        assert.equal(action.action, 'trip', `lane breaker trips ${name}`);
        assert.match(action.reason, /^(?:demo|accept):changes-requested$/, `lane breaker reason ${name}`);
      } else {
        assert.deepEqual(action, { action: 'update', newState: 'OPEN' }, `lane breaker leaves ${name} watched`);
      }
      assert.deepEqual(trustBucket(labels), BUCKET[want], `trust bucket ${name}`);
    }
  }
});

// --- AC3.3: no reader sees accept:* as no acceptance state ---

// Every plugin/bin module whose code names a demo:* label (a `demo:` literal or a
// `LABELS.DEMO_` reference), with the branch each one runs. A module outside this
// table fails the walk below until it is classified and given a branch.
const DEMO_LABEL_READERS = {
  'lib/issues/record-vocabulary.js': {
    what: 'the vocabulary and the one precedence rule',
    run: (labels) => acceptanceOf(labels),
    expect: { pending: 'pending', approved: 'approved', 'changes-requested': 'changes-requested', none: null },
  },
  'lib/issues/acceptance.js': {
    what: 'dispositionState, behind trust and the parent gate',
    run: (labels) => dispositionState(labels),
    expect: { pending: 'pending', approved: 'approved', 'changes-requested': 'changes-requested', none: 'none' },
  },
  'lib/issues/merge-lane-breaker.js': {
    what: 'the merge-lane circuit breaker',
    run: (labels) => breakerAction(labels).action,
    expect: { pending: 'update', approved: 'update', 'changes-requested': 'trip', none: 'update' },
  },
  'lib/wrap-up/engine-verify.js': {
    what: 'the acceptance-labeling closure check',
    run: (labels) => acceptanceLabelingResult(labels),
    expect: { pending: 'pass', approved: 'fail', 'changes-requested': 'fail', none: 'fail' },
  },
};

function acceptanceLabelingResult(labels) {
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'accept-reader-'));
  try {
    fs.mkdirSync(path.join(runDir, 'work'), { recursive: true });
    fs.writeFileSync(path.join(runDir, 'work', '900-spec.md'), '---\nrecord: 900\n---\n# 900: title\n');
    const gh = (args) => {
      if (args[0] === '--version') return 'gh version 2.0.0';
      if (args[0] === 'api' && args[1] === 'graphql') {
        return JSON.stringify({ data: { repository: { i900: { number: 900, parent: null } } } });
      }
      if (args.includes('labels,comments')) {
        return JSON.stringify({
          labels: labels.map((name) => ({ name })),
          comments: [{ body: '## Verification Brief\n### Confirmed\n', authorAssociation: 'MEMBER' }],
        });
      }
      return '';
    };
    const git = (args) => (args[0] === 'remote' ? 'https://github.com/org/repo.git' : '');
    const result = runVerify({ runDir, base: 'main', cwd: runDir, repoRoot: runDir, deps: { git, gh } });
    return result.rows.find((r) => r.check === 'acceptance-labeling').result;
  } finally {
    fs.rmSync(runDir, { recursive: true, force: true });
  }
}

// -> null when `raw` names no demo:* label, else a short description of how. A
// stripper mis-parse is reported as a use, never as "this file names nothing".
function demoLabelUse(raw) {
  const src = stripComments(raw);
  const verdict = stripperVerdict(raw, src);
  if (verdict !== 'ok') return STRIPPER_VERDICT_MESSAGES[verdict];
  const m = /\bLABELS\.DEMO_\w+|\bdemo:[\w${]/.exec(src);
  return m ? m[0] : null;
}

test('AC3.3: every plugin/bin module that names a demo:* label is classified, so a new reader fails here', () => {
  const unclassified = [];
  const seen = [];
  for (const file of BIN_FILES) {
    const use = demoLabelUse(readText(file));
    if (use === null) continue;
    seen.push(rel(file));
    if (!Object.hasOwn(DEMO_LABEL_READERS, rel(file))) unclassified.push(`${rel(file)}  (${use})`);
  }
  assert.deepEqual(unclassified, [],
    'classify these in DEMO_LABEL_READERS with a branch that proves they read accept:* alongside demo:*');
  assert.ok(BIN_FILES.length >= 400, `walked ${BIN_FILES.length} files, expected the whole plugin/bin tree`);
  assert.ok(seen.length >= Object.keys(DEMO_LABEL_READERS).length,
    `matched ${seen.length} readers, fewer than the ${Object.keys(DEMO_LABEL_READERS).length} classified — the matcher or the table is stale`);
});

test('AC3.3: no reader sees accept:* as no acceptance state, and each outcome matches its demo:* twin', () => {
  for (const [file, reader] of Object.entries(DEMO_LABEL_READERS)) {
    for (const state of STATES) {
      const demo = reader.run([`demo:${state}`]);
      const accept = reader.run([`accept:${state}`]);
      assert.deepEqual(demo, reader.expect[state], `${file} (${reader.what}): demo:${state}`);
      assert.deepEqual(accept, reader.expect[state], `${file} (${reader.what}): accept:${state}`);
    }
    assert.deepEqual(reader.run([]), reader.expect.none, `${file} (${reader.what}): no acceptance label`);
  }
});

// --- Guard: demo:* verdict literals live only where they must ---

// The four modules allowed to spell a demo:* verdict: the vocabulary and the batch
// marker define the legacy spelling; the lane breaker and the closure check report
// it back to a user when a record carries it. Every other reader goes through
// acceptanceOf / dispositionState and never names a label.
const LITERAL_ALLOWED = new Set([
  'lib/issues/record-vocabulary.js',
  'lib/issues/acceptance.js',
  'lib/wrap-up/engine-verify.js',
  'lib/issues/merge-lane-breaker.js',
]);
const DEMO_LITERAL_RE = /demo:(?:pending|approved-batch|approved|changes-requested)/g;

// -> [{ line, text }] for every live demo:* verdict literal in `raw`. Literals are
// the target, so strings stay in the scanned text (keep mode); only comments blank.
function demoLiterals(raw) {
  const src = stripComments(raw);
  const verdict = stripperVerdict(raw, src);
  const out = [];
  src.split('\n').forEach((text, i) => {
    for (const m of text.matchAll(DEMO_LITERAL_RE)) out.push({ line: i + 1, text: m[0] });
  });
  if (verdict !== 'ok') out.push({ line: 0, text: STRIPPER_VERDICT_MESSAGES[verdict] });
  return out;
}

test('guard self-test: a live literal flags on its exact line; a comment, accept:pending and a bare prefix do not', () => {
  assert.deepEqual(demoLiterals([
    "const a = 'demo:pending';",
    '// demo:approved is only named in a comment',
    '/* a block comment',
    '   naming demo:changes-requested */',
    "const b = 'accept:pending';",
    "const c = `x ${y} demo:approved-batch`;",
    "const d = 'demo:' + state;",
  ].join('\n')), [
    { line: 1, text: 'demo:pending' },
    { line: 6, text: 'demo:approved-batch' },
  ]);
  assert.deepEqual(demoLiterals("const e = 'demo:changes-requested'; // demo:pending"), [{ line: 1, text: 'demo:changes-requested' }]);
});

test('guard self-test: a comment-stripper mis-parse and an uncompilable file are offenders, not clean files', () => {
  // The stripper blanks the live literal after the mis-parsed regex, so the verdict
  // line is the only thing standing between this file and a clean result.
  assert.deepEqual(demoLiterals([
    'const cp = 1;',
    "if (cp) /'/.test(cp); const b = 'p//q'; const l = 'demo:pending';",
  ].join('\n')), [{ line: 0, text: STRIPPER_VERDICT_MESSAGES.misparsed }]);
  assert.deepEqual(demoLiterals('const = ;'), [{ line: 0, text: STRIPPER_VERDICT_MESSAGES.unparseable }]);
});

test('guard self-test: the reader walk names a planted mis-parse, not "no label here"', () => {
  assert.equal(demoLabelUse("const cp = 1;\nif (cp) /'/.test(cp); const b = 'p//q';"), STRIPPER_VERDICT_MESSAGES.misparsed);
  assert.equal(demoLabelUse('const ok = LABELS.DEMO_PENDING;'), 'LABELS.DEMO_PENDING');
  assert.equal(demoLabelUse("// LABELS.DEMO_PENDING and demo:pending in a comment\nconst ok = 1;"), null);
});

test('plugin/bin names a demo:* verdict literal only in the four modules that must', () => {
  const offenders = [];
  let sites = 0;
  for (const file of BIN_FILES) {
    for (const site of demoLiterals(readText(file))) {
      if (site.line === 0 || !LITERAL_ALLOWED.has(rel(file))) offenders.push(`${rel(file)}:${site.line}  (${site.text})`);
      else sites += 1;
    }
  }
  assert.deepEqual(offenders, [],
    'read a verdict through acceptanceOf / dispositionState, never a demo:* literal — only the vocabulary, the batch marker, the lane breaker and the closure check spell the legacy label');
  assert.ok(BIN_FILES.length >= 400, `walked ${BIN_FILES.length} files, expected the whole plugin/bin tree`);
  assert.ok(sites >= 5, `matched ${sites} allowed literal sites, expected at least 5 — the matcher stopped matching`);
});
