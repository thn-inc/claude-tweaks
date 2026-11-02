'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { stripComments, stripperVerdict, STRIPPER_VERDICT_MESSAGES } = require('./helpers/strip-comments');
const { readText } = require('./helpers/read-skill');
const { acceptanceOf, parseRecordFacets } = require('../plugin/bin/lib/issues/record-vocabulary');
const { dispositionState, approvalProvenance } = require('../plugin/bin/lib/issues/acceptance');
const { classifyWatchedRecord } = require('../plugin/bin/lib/issues/merge-lane-breaker');
const { trustRows } = require('../plugin/bin/lib/issues/trust');
const { runVerify } = require('../plugin/bin/lib/wrap-up/engine-verify');

// #4610 expand step: the acceptance verdict labels are read under two spellings,
// demo:* (legacy) and accept:* (successor), until the contract step removes the
// first. Every reader must see both, resolved by the one precedence rule in
// record-vocabulary.js's acceptanceOf. This suite pins four things:
//   - AC3.1: readers that classify a record agree on a mixed-label record.
//   - AC3.3: no reader sees `accept:pending` (or any accept:* label) as "no
//     acceptance state", and a NEW module that reads demo:* labels fails here
//     until it is classified.
//   - the guard: a demo:* verdict literal in plugin/bin code outside the four
//     modules that must spell it (the vocabulary, the batch marker, the closure
//     check that reports the legacy spelling back, and the below-floor close's
//     comment copy) fails.
//   - the prose rules the labels depend on: a /demo verdict replaces prior labels,
//     /demo finds a fresh brief behind an outranked pending label, and the acceptance
//     consumers provision the accept:* rows.
const BIN_ROOT = path.join(__dirname, '..', 'plugin', 'bin');
const SKILLS_ROOT = path.join(__dirname, '..', 'plugin', 'skills');

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

// The trust cell counts one closed record under exactly one bucket. The record is
// old and has a closing commit, so a label read as "no acceptance state" would take
// the operational path and land in operationalGood — pending is told apart from none.
const TRUST_NOW = Date.parse('2026-08-09T00:00:00Z');
function trustBucket(labels) {
  const record = {
    number: 7,
    labels: ['by:capture', 'risk:low', ...labels],
    body: '',
    state: 'CLOSED',
    closedAt: new Date(TRUST_NOW - 30 * 24 * 60 * 60 * 1000).toISOString(),
  };
  const gitLog = [{ sha: (7).toString(16).padStart(40, '0'), message: 'refs #7' }];
  const [row] = trustRows([record], gitLog, TRUST_NOW, {});
  assert.equal(row.total, 1);
  return {
    approved: row.approved,
    changesRequested: row.changesRequested,
    undispositioned: row.undispositioned,
    operationalGood: row.operationalGood,
  };
}

const BUCKET = {
  pending: { approved: 0, changesRequested: 0, undispositioned: 1, operationalGood: 0 },
  approved: { approved: 1, changesRequested: 0, undispositioned: 0, operationalGood: 0 },
  'changes-requested': { approved: 0, changesRequested: 1, undispositioned: 0, operationalGood: 0 },
};

test('AC3.1: dispositionState, parseRecordFacets, the lane breaker and the trust cell agree on every mixed pair', () => {
  // The control: with no acceptance label the same record is operational known-good.
  assert.deepEqual(trustBucket([]), { approved: 0, changesRequested: 0, undispositioned: 0, operationalGood: 1 });
  for (const state of STATES) {
    assert.deepEqual(trustBucket([`accept:${state}`]), BUCKET[state], `lone accept:${state}`);
    assert.deepEqual(trustBucket([`demo:${state}`]), BUCKET[state], `lone demo:${state}`);
  }
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

// Modules that name a demo:* label only inside copy they write for a human to read,
// and read no acceptance label. Each row pins the exact copy text the label may sit
// in; a demo:* match anywhere else in the module's code is a reader and fails the
// walk below. The copy is twin-pinned to its prose by the module's own test.
const DEMO_LABEL_COPY_ONLY = {
  'lib/issues/below-floor-parent-close.js': {
    what: 'the closing comment on a parent closed below the oversight floor, byte-pinned to wrap-up/verification-brief-parent-gate.md Close step 2',
    copy: '\\`demo:pending\\` sign-off is owed',
  },
};

const DEMO_MATCH_RE = /\bDEMO_(?:PENDING|APPROVED|CHANGES_REQUESTED)\b|\bdemo:/g;

// -> [{ line, text }] for every demo:* match in `raw`'s code that is not inside the
// pinned `copy` text. The copy is removed from its line before matching, so a
// reader on the copy's own line is flagged too.
function copyOnlyViolations(raw, copy) {
  const src = stripComments(raw);
  const verdict = stripperVerdict(raw, src);
  const out = [];
  src.split('\n').forEach((text, i) => {
    for (const m of text.split(copy).join('').matchAll(DEMO_MATCH_RE)) out.push({ line: i + 1, text: m[0] });
  });
  if (verdict !== 'ok') out.push({ line: 0, text: STRIPPER_VERDICT_MESSAGES[verdict] });
  return out;
}

function acceptanceLabelingResult(labels) {
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'accept-reader-'));
  try {
    fs.mkdirSync(path.join(runDir, 'work'), { recursive: true });
    fs.writeFileSync(path.join(runDir, 'work', '900-spec.md'), '---\nrecord: 900\n---\n# 900: title\n');
    // #4551: this fake gh answers the native GraphQL parent call; the work-links
    // schema default is body-text, so the fixture says native explicitly (this
    // test pins the label reader, not the link model).
    fs.mkdirSync(path.join(runDir, '.claude-tweaks'), { recursive: true });
    fs.writeFileSync(path.join(runDir, '.claude-tweaks', 'policy.yml'), 'work-links: native\n');
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
  // A bare demo: catches a startsWith / concatenation reader; the bare DEMO_ names
  // catch a destructured LABELS member. Not DEMO_ alone: candidates-app-store-readiness.js
  // names DEMO_CREDENTIAL_RE and DEMO_ACCOUNT.
  const m = /\bDEMO_(?:PENDING|APPROVED|CHANGES_REQUESTED)\b|\bdemo:/.exec(src);
  return m ? m[0] : null;
}

test('AC3.3: every plugin/bin module that names a demo:* label is classified, so a new reader fails here', () => {
  const unclassified = [];
  const seen = [];
  for (const file of BIN_FILES) {
    const use = demoLabelUse(readText(file));
    if (use === null) continue;
    seen.push(rel(file));
    if (!Object.hasOwn(DEMO_LABEL_READERS, rel(file)) && !Object.hasOwn(DEMO_LABEL_COPY_ONLY, rel(file))) unclassified.push(`${rel(file)}  (${use})`);
  }
  assert.deepEqual(unclassified, [],
    'classify these in DEMO_LABEL_READERS with a branch that proves they read accept:* alongside demo:* (or in DEMO_LABEL_COPY_ONLY when the label sits only in copy the module writes)');
  assert.ok(BIN_FILES.length >= 400, `walked ${BIN_FILES.length} files, expected the whole plugin/bin tree`);
  // Both directions: a classified module that stopped naming a label keeps a row
  // that proves nothing, so the two tables together must equal what the walk found.
  assert.deepEqual(seen.sort(), [...Object.keys(DEMO_LABEL_READERS), ...Object.keys(DEMO_LABEL_COPY_ONLY)].sort(),
    'DEMO_LABEL_READERS + DEMO_LABEL_COPY_ONLY and the modules the walk matched differ — drop a stale row or fix the matcher');
});

test('AC3.3: a copy-only module names a demo:* label only inside its pinned copy, so it reads none', () => {
  for (const [file, row] of Object.entries(DEMO_LABEL_COPY_ONLY)) {
    assert.deepEqual(copyOnlyViolations(readText(path.join(BIN_ROOT, file)), row.copy), [], `${file} (${row.what})`);
  }
});

test('guard self-test: a copy-only module gains a reader outside, or on, the copy line and is flagged', () => {
  const copy = DEMO_LABEL_COPY_ONLY['lib/issues/below-floor-parent-close.js'].copy;
  const copyLine = 'const c = `so no Brief or ' + copy + '.`;';
  assert.deepEqual(copyOnlyViolations(copyLine, copy), []);
  assert.deepEqual(copyOnlyViolations(copyLine + "\nconst r = (l) => l.startsWith('demo:');", copy), [{ line: 2, text: 'demo:' }]);
  assert.deepEqual(copyOnlyViolations(copyLine + '\nconst p = LABELS.DEMO_PENDING;', copy), [{ line: 2, text: 'DEMO_PENDING' }]);
  assert.deepEqual(copyOnlyViolations(copyLine.replace('.`;', ".`; const r = (l) => l.includes('demo:approved');"), copy), [{ line: 1, text: 'demo:' }]);
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
// marker define the legacy spelling; the closure check keeps it in its pinned
// failure text; the below-floor parent close writes it in close-comment copy that is
// twin-pinned to the parent-gate prose (and DEMO_LABEL_COPY_ONLY holds it to that
// copy). Every other reader goes through acceptanceOf / dispositionState
// and names a label only through LABELS (the lane breaker does).
const LITERAL_ALLOWED = new Set([
  'lib/issues/record-vocabulary.js',
  'lib/issues/acceptance.js',
  'lib/wrap-up/engine-verify.js',
  'lib/issues/below-floor-parent-close.js',
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
  assert.equal(demoLabelUse('const ok = LABELS.DEMO_PENDING;'), 'DEMO_PENDING');
  // The shapes a new reader could take without a `demo:` verdict literal.
  assert.equal(demoLabelUse("const r = (l) => l.startsWith('demo:');"), 'demo:');
  assert.equal(demoLabelUse("const r = (labels, s) => labels.includes('demo:' + s);"), 'demo:');
  assert.equal(demoLabelUse('const { DEMO_PENDING } = LABELS;'), 'DEMO_PENDING');
  assert.equal(demoLabelUse('const { DEMO_CHANGES_REQUESTED: bad } = LABELS;'), 'DEMO_CHANGES_REQUESTED');
  // Unrelated DEMO_ names are not label readers.
  assert.equal(demoLabelUse('const DEMO_CREDENTIAL_RE = /x/; const DEMO_ACCOUNT = 1;'), null);
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
    'read a verdict through acceptanceOf / dispositionState, never a demo:* literal — only the vocabulary, the batch marker, the closure check and the below-floor close comment copy spell the legacy label');
  assert.ok(BIN_FILES.length >= 400, `walked ${BIN_FILES.length} files, expected the whole plugin/bin tree`);
  assert.ok(sites >= 5, `matched ${sites} allowed literal sites, expected at least 5 — the matcher stopped matching`);
});

// --- The prose rules the labels depend on ---

const skillText = (...parts) => readText(path.join(SKILLS_ROOT, ...parts));
const collapse = (text) => text.replace(/\s+/g, ' ');
const LABEL_RE = /`((?:demo|accept):[a-z-]+)`/g;
const labelsIn = (text) => [...text.matchAll(LABEL_RE)].map((m) => m[1]).sort();

// The labels /demo's replacement rule removes, per bullet.
function demoRemovals() {
  const skill = skillText('demo', 'SKILL.md');
  const from = skill.indexOf('**A verdict replaces any prior acceptance label the record carries.**');
  assert.notEqual(from, -1, 'the replacement rule must exist in /demo Step 3');
  const rule = skill.slice(from, skill.indexOf('**Provenance signal', from));
  const bullet = (name) => {
    const line = rule.split('\n').find((l) => l.startsWith(`- **${name}`));
    assert.ok(line, `the replacement rule must have a ${name} bullet`);
    return labelsIn(line);
  };
  return {
    rule: collapse(rule),
    every: bullet('Every verdict:'),
    approve: bullet('Approve:'),
    single: bullet('Single-record Approve'),
    changes: bullet('Request changes:'),
  };
}

test('/demo Step 3: a verdict replaces prior acceptance labels, so a later Approve takes effect', () => {
  const { every, approve, single, changes } = demoRemovals();
  assert.deepEqual(every, ['accept:pending', 'demo:pending']);
  assert.deepEqual(approve, ['accept:changes-requested', 'demo:changes-requested']);
  assert.deepEqual(single, ['accept:approved-batch', 'demo:approved-batch']);
  assert.deepEqual(changes, ['accept:approved', 'accept:approved-batch', 'demo:approved', 'demo:approved-batch']);

  // Every record a verdict can land on: each subset of the three states and the batch
  // marker, both spellings.
  const prior = [...STATES, 'approved-batch'].flatMap((state) => [`demo:${state}`, `accept:${state}`]);
  const apply = (labels, removed, added) => [...labels.filter((l) => !removed.includes(l)), ...added];
  for (let mask = 0; mask < 2 ** prior.length; mask += 1) {
    const labels = prior.filter((_, i) => mask & (1 << i));
    const name = labels.join('+');
    const individual = apply(labels, [...every, ...approve, ...single], ['demo:approved']);
    assert.equal(acceptanceOf(individual), 'approved', name);
    assert.equal(approvalProvenance(individual), 'walkthrough', `an individual Approve replaces the batch one: ${name}`);
    const batch = apply(labels, [...every, ...approve], ['demo:approved', 'demo:approved-batch']);
    assert.equal(approvalProvenance(batch), 'batch', `the batch action keeps its own label: ${name}`);
    assert.equal(acceptanceOf(apply(labels, [...every, ...changes], ['demo:changes-requested'])), 'changes-requested', name);
  }
});

test('/demo Step 3: a batch-sourced Approve cannot strip the batch label it writes', () => {
  const { rule } = demoRemovals();
  assert.match(rule, /A batch-sourced Approve \(the Provenance signal note below\) removes neither batch label/);
});

// One verdict's command text, from its opener up to where the other driver's branch starts.
function verdictCommand(opener, end) {
  const skill = skillText('demo', 'SKILL.md');
  const from = skill.indexOf(opener);
  assert.notEqual(from, -1, `the verdict command must open with: ${opener}`);
  const to = skill.indexOf(end, from);
  assert.notEqual(to, -1, `the verdict command must end before: ${end}`);
  return skill.slice(from, to);
}

test('/demo Step 3: each removal is conditional on the fetched labels, demo:pending included', () => {
  const skill = skillText('demo', 'SKILL.md');
  const { rule } = demoRemovals();
  assert.match(rule, /only when those labels hold it\*\*, `demo:pending` included/);
  assert.match(rule, /exits 1 with "not found"/);
  assert.doesNotMatch(skill, /silent no-op/);
});

test('/demo Step 3: each verdict command names no literal removal and cites the replacement rule', () => {
  const commands = [
    ['Approve', verdictCommand('- **Approve** — `gh issue edit', '`work-backend: local-files`')],
    ['Request changes', verdictCommand('1. **`work-backend: github-issues`:** `gh issue edit', '**`work-backend: local-files`:**')],
  ];
  for (const [name, command] of commands) {
    // A literal label here would run unconditionally, whichever position it holds.
    assert.doesNotMatch(command, /--remove-label[\s=]+\S*(?:demo|accept):/, name);
    assert.ok(command.includes(`plus the \`--remove-label\` flags the replacement rule above selects for ${name}`), `${name} must cite the rule`);
  }
  assert.match(commands[0][1], /for a batch-sourced verdict .{0,60}add `--add-label demo:approved-batch`/);
});

test('the permission matrix gives /demo the same removals as its Step 3, and adds no accept:* label', () => {
  const { every, approve, single, changes } = demoRemovals();
  const row = skillText('_shared', 'work-record-permission-matrix.md').split('\n').find((l) => l.startsWith('| **`/demo`** |'));
  assert.ok(row, 'the matrix must have a /demo row');
  const [, adds, removes] = row.split(' | ').map((cell) => cell.trim());
  assert.deepEqual(labelsIn(removes), [...every, ...approve, ...single, ...changes].sort());
  assert.match(removes, /on a single-record Approve, never on a batch-sourced one/);
  assert.match(removes, /only when the record holds it/);
  assert.deepEqual(labelsIn(adds).filter((l) => l.startsWith('accept:')), []);
});

test('the two contract files state /demo as the one exception to "no skill writes accept:*"', () => {
  const matrix = collapse(skillText('_shared', 'work-record-permission-matrix.md'));
  const bootstrap = collapse(skillText('_shared', 'label-bootstrap.md'));
  assert.match(matrix, /no skill adds an `accept:\*` label today\. The one exception on the removing side is `\/demo`/);
  assert.match(bootstrap, /No skill adds an `accept:\*` label yet; `\/demo` removes them/);
  assert.doesNotMatch(matrix, /adds or removes an `accept:\*` label/);
  assert.doesNotMatch(bootstrap, /no skill writes `accept:\*`/);
});

test('every acceptance bootstrap list provisions the four accept:* rows, byte-equal to the canonical array', () => {
  const canonicalMatch = skillText('_shared', 'label-bootstrap.md').match(/## Canonical LABELS_JSON[\s\S]*?```js\n([\s\S]*?)\n```/);
  assert.ok(canonicalMatch, 'the canonical LABELS_JSON fence must resolve');
  const canonical = JSON.parse(canonicalMatch[1]);
  const acceptRows = canonical.filter(([name]) => name.startsWith('accept:'));
  assert.equal(acceptRows.length, 4);

  for (const file of [['wrap-up', 'verification-brief.md'], ['wrap-up', 'verification-brief-parent-gate.md']]) {
    const match = skillText(...file).match(/LABELS_JSON = (\[[\s\S]*?\n\])/);
    assert.ok(match, `${file.join('/')}: the LABELS_JSON list must resolve`);
    const rows = JSON.parse(match[1]);
    assert.deepEqual(rows.filter(([name]) => name.startsWith('accept:')), acceptRows, file.join('/'));
    assert.deepEqual(rows.filter(([name]) => name.startsWith('demo:')).map(([name]) => name), ['demo:pending'], file.join('/'));
  }

  // /demo lists names and copies the rows from the canonical array.
  const skill = skillText('demo', 'SKILL.md');
  const from = skill.indexOf('**Label-backed entries** (Step 1');
  const list = labelsIn(skill.slice(from, skill.indexOf('**A verdict replaces', from)));
  for (const [name] of acceptRows) assert.ok(list.includes(name), `/demo Step 3 must bootstrap ${name}`);
});

test('/demo fetches the fresh brief when any pending label is present, even one a verdict outranks', () => {
  const paths = collapse(skillText('demo', 'entry-paths.md'));
  assert.match(paths, /If the labels just fetched carry a pending acceptance label in either spelling .{0,120}even one a verdict outranks/);
  assert.match(paths, /If the record carries \*\*no\*\* pending acceptance label/);
  assert.doesNotMatch(paths, /acceptance facet does \*\*not\*\* read `pending`/);
});

test('/demo Input states the same fallback condition as its entry path', () => {
  const skill = collapse(skillText('demo', 'SKILL.md'));
  assert.match(skill, /falling back — when it carries no pending acceptance label \(either spelling/);
  assert.doesNotMatch(skill, /when its acceptance facet does not read `pending`/);
});
