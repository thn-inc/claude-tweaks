// tests/bin-lib/wrap-up/packet-gather.test.js
// Acceptance-packet deterministic gather and packet reader (#4611).
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  parseAcceptanceCriteria,
  lowConfidenceFindings,
  qaSelectionFromDecisions,
  expectedChecksFromDeclaration,
  parseStoryFile,
  storyResultsFromQaReport,
  storiesFromQaStamp,
  gatherPacketFacts,
  readPacket,
} = require('../../../plugin/bin/lib/wrap-up/packet-gather');
const { validateFactsShape } = require('../../../plugin/bin/lib/wrap-up/packet-validate');
const { renderPacket } = require('../../../plugin/bin/lib/wrap-up/packet-render');
const { findingItems } = require('../../../plugin/bin/lib/console/resolve');

const tempDirs = [];
function tempDir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}
after(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
});

const QA_NOTE = 'QA report not read — selected stories not listed';
const SCOPE_NOTE = 'verify-scope declaration not read — expected checks not derived';
const INFRA_REASON = 'infra surface lists commands, not links';
const LOCAL = 'http://localhost:3000';

const inputs = (over = {}) => ({
  record: 4611,
  surface: 'web',
  specText: '## Acceptance Criteria\n\n1. first\n',
  report: { checks: {} },
  expectedChecks: [],
  storyIndex: [],
  storyResults: null,
  stampStories: null,
  qaReportUnread: false,
  acResults: null,
  decisionsText: '',
  lowConfidence: [],
  changes: [{ status: 'M', path: 'src/a.js' }],
  commits: [],
  links: [],
  localBaseUrl: LOCAL,
  devBaseUrl: null,
  deploy: null,
  recordings: [],
  flags: [],
  decisions: [],
  ...over,
});

const gather = (over) => gatherPacketFacts(inputs(over));
const factOf = (result, id) => result.facts.find((f) => f.id === id);
const idsOf = (result, kind) => result.facts.filter((f) => f.kind === kind).map((f) => f.id);
const statusOf = (result, id) => {
  const f = factOf(result, id);
  return f && [f.status, f.reason];
};

function assertShapeOk(result) {
  const shape = validateFactsShape(result);
  assert.deepEqual(shape.errors, []);
  assert.equal(shape.ok, true);
}

// the walkthrough recording

const RECORDING_PATH = {
  live: '.claude-tweaks/pipelines/r/packet-inputs/walkthrough.gif',
  archived: '.claude-tweaks/pipelines/archive/r/packet-inputs/walkthrough.gif',
};
const PASSED_RECORDING = {
  status: 'passed', file: 'walkthrough.gif', text: 'Walkthrough of Sign in', captions: ['open', 'submit'], exposure: 'local-only', frames: 2,
};

test('a passed recording is a fact naming both locations', () => {
  const result = gather({ recording: PASSED_RECORDING, recordingPath: RECORDING_PATH });
  assert.deepEqual(factOf(result, 'recording:walkthrough'), {
    id: 'recording:walkthrough',
    kind: 'recording',
    status: 'passed',
    source: 'walkthrough',
    text: 'Walkthrough of Sign in',
    url_or_path: RECORDING_PATH.live,
    archive_path: RECORDING_PATH.archived,
    captions: ['open', 'submit'],
    exposure: 'local-only',
    redactions: 0,
  });
  assertShapeOk(result);
});

test('a not-run recording is a fact with its reason and failure', () => {
  const result = gather({ recording: { status: 'not-run', reason: 'encoder-failed', failure: 'boom' }, recordingPath: null });
  assert.deepEqual(factOf(result, 'recording:walkthrough'), {
    id: 'recording:walkthrough', kind: 'recording', status: 'not-run', source: 'walkthrough', reason: 'encoder-failed', failure: 'boom', redactions: 0,
  });
  assertShapeOk(result);
  assert.ok(!Object.hasOwn(factOf(gather({ recording: { status: 'not-run', reason: 'no-story' } }), 'recording:walkthrough'), 'failure'));
});

test('redactions counts text, captions and failure', () => {
  const passed = gather({
    recording: { ...PASSED_RECORDING, text: 'as me@example.test', captions: ['token=abc', 'plain', 'sk_live_123abc'] },
    recordingPath: RECORDING_PATH,
  });
  assert.equal(factOf(passed, 'recording:walkthrough').redactions, 3);
  const failed = gather({ recording: { status: 'not-run', reason: 'encoder-failed', failure: 'api_key=abc' } });
  assert.equal(factOf(failed, 'recording:walkthrough').redactions, 1);
});

test('no recording adds no fact', () => {
  assert.deepEqual(idsOf(gather({}), 'recording'), []);
  assert.deepEqual(idsOf(gather({ recording: null }), 'recording'), []);
});

test('a hand-listed recording with the same id gives way to the gathered one, and says so', () => {
  const result = gather({
    recording: PASSED_RECORDING, recordingPath: RECORDING_PATH, recordings: [{ id: 'walkthrough', url: 'https://x.example/a' }],
  });
  assert.equal(factOf(result, 'recording:walkthrough').source, 'walkthrough');
  assert.ok(result.partial.includes('repeated fact ids, first kept: recording:walkthrough'));
});

// parseAcceptanceCriteria

test('AC2a expected AC with no result renders not-run', () => {
  const result = gather({
    specText: '## Acceptance Criteria\n\n1. first\n2a. second\n',
    acResults: { 1: 'met' },
  });
  assert.deepEqual(statusOf(result, 'check:ac-1'), ['passed', undefined]);
  assert.deepEqual(statusOf(result, 'check:ac-2a'), ['not-run', 'no spec-compliance result recorded']);
  assert.equal(factOf(result, 'check:ac-1').source, 'spec-compliance');
});

test('ac verdict words map to status, with the value as the failure reason', () => {
  const result = gather({
    specText: '## Acceptance Criteria\n\n1. a\n2. b\n3. c\n',
    acResults: { 1: 'met', 2: 'partially met', 3: 'not met' },
  });
  assert.deepEqual(statusOf(result, 'check:ac-1'), ['passed', undefined]);
  assert.deepEqual(statusOf(result, 'check:ac-2'), ['failed', 'partially met']);
  assert.deepEqual(statusOf(result, 'check:ac-3'), ['failed', 'not met']);
  assert.ok(!result.partial.some((note) => note.startsWith('spec-compliance results')));
});

test('parseAcceptanceCriteria reads only top-level items in its own section', () => {
  const spec = [
    '## Overview',
    '1. not a criterion',
    '## Acceptance Criteria',
    '',
    '1. one',
    '   1. nested',
    '- bullet',
    '### A subheading stays in the section',
    '2a.   two a',
    'prose 3. not a criterion',
    '## Release Note',
    '4. after the section',
  ].join('\r\n');
  assert.deepEqual(parseAcceptanceCriteria(spec), [
    { id: '1', text: 'one' },
    { id: 'AC1', text: 'bullet' },
    { id: '2a', text: 'two a' },
  ]);
});

test('parseAcceptanceCriteria reads every criterion form records use', () => {
  const spec = [
    '## Acceptance Criteria',
    '',
    '1) paren',
    '**2.** bold',
    '**3)** bold paren',
    '- [ ] box',
    '- [x] done',
    '* star',
    '- plain',
    '  - nested bullet',
    '    * deeper bullet',
    '  - [ ] nested box',
    '---',
    '* * *',
    '- ',
    'prose - not a bullet',
    '4a. numbered',
  ].join('\n');
  assert.deepEqual(parseAcceptanceCriteria(spec), [
    { id: '1', text: 'paren' },
    { id: '2', text: 'bold' },
    { id: '3', text: 'bold paren' },
    { id: 'AC1', text: 'box' },
    { id: 'AC2', text: 'done' },
    { id: 'AC3', text: 'star' },
    { id: 'AC4', text: 'plain' },
    { id: '4a', text: 'numbered' },
  ]);
});

test('an empty checkbox is no criterion and shifts no positional id', () => {
  const spec = ['## Acceptance Criteria', '- [ ]', '- first', '- [x] ', '- [X]', '* [ ]   ', '- [ ] second', '- [x]third'].join('\n');
  assert.deepEqual(parseAcceptanceCriteria(spec), [
    { id: 'AC1', text: 'first' },
    { id: 'AC2', text: 'second' },
    { id: 'AC3', text: '[x]third' },
  ]);
});

test('a real checkbox record parses to positional criteria', () => {
  const specText = [
    '## Deliverables',
    '',
    '- not a criterion',
    '',
    '## Acceptance Criteria',
    '',
    '- [ ] `dispositionState([{name: "demo:approved"}])` returns the same state.',
    '- [ ] A unit test feeds the MCP label-object shape.',
    '',
    '## Release Note',
    '',
    '- not a criterion either',
  ].join('\n');
  const result = gather({ specText, acResults: { AC1: 'met' } });
  assert.deepEqual(idsOf(result, 'check'), ['check:ac-AC1', 'check:ac-AC2']);
  assert.deepEqual(statusOf(result, 'check:ac-AC1'), ['passed', undefined]);
  assert.deepEqual(statusOf(result, 'check:ac-AC2'), ['not-run', 'no spec-compliance result recorded']);
  assertShapeOk(result);
});

test('parseAcceptanceCriteria accepts a level-3 heading and a parenthesized one', () => {
  const ids = (spec) => parseAcceptanceCriteria(spec).map((ac) => ac.id);
  assert.deepEqual(ids('### Acceptance Criteria\n1. a\n#### sub\n2. b\n### Next\n3. c\n'), ['1', '2']);
  assert.deepEqual(ids('### Acceptance Criteria\n1. a\n## Next\n2. b\n'), ['1']);
  assert.deepEqual(ids('## Acceptance Criteria (from the design doc)\n- a\n### sub\n- b\n## Next\n- c\n'), ['AC1', 'AC2']);
  assert.deepEqual(ids('## Acceptance Criteria Notes\n1. a\n'), []);
  assert.deepEqual(ids('## Delete + Tombstone Acceptance Criteria\n1. a\n'), []);
  assert.deepEqual(ids('#### Acceptance Criteria\n1. a\n'), []);
});

test('a present spec with no parsed criteria is a stated partial', () => {
  const NOTE = 'spec holds no parsed acceptance criteria — acceptance criteria not derived';
  assert.ok(gather({ specText: '## Overview\n\nNo section here.\n' }).partial.includes(NOTE));
  assert.ok(gather({ specText: '## Acceptance Criteria\n\nProse only.\n' }).partial.includes(NOTE));
  assert.ok(!gather({ specText: '## Acceptance Criteria\n- a\n' }).partial.includes(NOTE));
  const absent = gather({ specText: null });
  assert.ok(!absent.partial.includes(NOTE));
  assert.ok(absent.partial.includes('spec not found — acceptance criteria not derived'));
});

test('parseAcceptanceCriteria skips code fences, including a heading inside one', () => {
  const spec = [
    '```',
    '## Acceptance Criteria',
    '9. a heading in a fence does not open the section',
    '```',
    '## Acceptance Criteria',
    '1. one',
    '```yaml',
    '2. fenced',
    '## Not a heading',
    '~~~',
    '3. a different fence character does not close it',
    '```',
    '4. four',
    '~~~~',
    '5. fenced',
    '~~~',
    '6. a shorter fence does not close it',
    '~~~~',
    '7. seven',
    '```inline``` is not a fence opener',
    '8. eight',
  ].join('\n');
  assert.deepEqual(parseAcceptanceCriteria(spec).map((ac) => ac.id), ['1', '4', '7', '8']);
});

test('parseAcceptanceCriteria finds no criteria without the heading, any heading case accepted', () => {
  assert.deepEqual(parseAcceptanceCriteria('## Overview\n1. x\n'), []);
  assert.deepEqual(parseAcceptanceCriteria('## Acceptance criteria\n1. x\n').map((ac) => ac.id), ['1']);
});

test('nested AC lists do not repeat ids', () => {
  assert.deepEqual(
    parseAcceptanceCriteria('## Acceptance Criteria\n1. x\n   1. nested\n2. y\n').map((ac) => ac.id),
    ['1', '2'],
  );
  const specText = '## Acceptance Criteria\n1. first\n1. second\n';
  assert.deepEqual(parseAcceptanceCriteria(specText).map((ac) => ac.text), ['first', 'second']);
  const result = gather({ specText });
  assert.equal(factOf(result, 'check:ac-1').text, 'first');
  assert.equal(result.facts.filter((f) => f.id === 'check:ac-1').length, 1);
  assert.ok(result.partial.includes('repeated fact ids, first kept: check:ac-1'));
  assertShapeOk(result);
});

test('ac results that match nothing are stated', () => {
  const result = gather({
    specText: '## Acceptance Criteria\n1. a\n2a. b\n',
    acResults: { 'first criterion': 'met', 1: 'Met' },
  });
  assert.deepEqual(statusOf(result, 'check:ac-1'), ['not-run', 'unrecognized spec-compliance value']);
  assert.deepEqual(statusOf(result, 'check:ac-2a'), ['not-run', 'no spec-compliance result recorded']);
  const note = result.partial.find((text) => text.startsWith('spec-compliance results match no acceptance criterion: '));
  assert.ok(note, JSON.stringify(result.partial));
  assert.ok(note.includes('first criterion'));
  assert.ok(/: (1, |.*, 1$)/.test(note), note);
});

// verify checks

test('verify report maps exit codes', () => {
  const result = gather({
    report: {
      checks: {
        tests: { command: 'npm test', exitCode: 0 },
        lint: { command: 'x', skipped: 'fail-fast' },
        types: { command: 'y', exitCode: 1, summary: '2 errors' },
      },
    },
    expectedChecks: ['tests', 'lint', 'types', 'e2e'],
  });
  assert.deepEqual(statusOf(result, 'check:tests'), ['passed', undefined]);
  assert.deepEqual(statusOf(result, 'check:lint'), ['skipped', 'fail-fast']);
  assert.deepEqual(statusOf(result, 'check:types'), ['failed', '2 errors']);
  assert.deepEqual(statusOf(result, 'check:e2e'), ['not-run', 'no result recorded']);
  assert.equal(factOf(result, 'check:tests').source, 'verify-report');
  assert.equal(factOf(result, 'check:e2e').source, 'verify-scope');
  assertShapeOk(result);
});

test('a failing exit with no summary states the code; a hang with a null code still fails', () => {
  const result = gather({
    report: {
      checks: {
        a: { command: 'a', exitCode: 2, summary: null },
        hang: { command: 'b', exitCode: null, summary: null, timedOut: true },
        empty: { command: 'c' },
      },
    },
  });
  assert.deepEqual(statusOf(result, 'check:a'), ['failed', 'exit 2']);
  assert.deepEqual(statusOf(result, 'check:hang'), ['failed', 'exit null']);
  assert.deepEqual(statusOf(result, 'check:empty'), ['not-run', 'no result recorded']);
});

test('a run verify adjudicated to a pass reports its failing check as passed, with the reason', () => {
  const checks = {
    tests: { command: 'npm test', exitCode: 1, summary: '1 failing' },
    lint: { command: 'x', exitCode: 0 },
    types: { command: 'y', skipped: 'fail-fast' },
  };
  const baseline = gather({
    report: { pass: false, effectivePass: true, baselineAdjudicated: { verdict: 'pass', baseRef: 'origin/main' }, checks },
  });
  assert.deepEqual(statusOf(baseline, 'check:tests'), ['passed', 'baseline-adjudicated vs origin/main']);
  assert.deepEqual(statusOf(baseline, 'check:lint'), ['passed', undefined]);
  assert.deepEqual(statusOf(baseline, 'check:types'), ['skipped', 'fail-fast']);

  const preExisting = gather({ report: { pass: false, effectivePass: true, preExistingAdjudicated: { files: ['a'] }, checks } });
  assert.deepEqual(statusOf(preExisting, 'check:tests'), ['passed', 'declared pre-existing failure']);

  const neither = gather({ report: { pass: false, effectivePass: true, checks } });
  assert.deepEqual(statusOf(neither, 'check:tests'), ['passed', 'adjudicated by verify']);
});

test('an adjudicated pass renders under Checks that passed, stating why', () => {
  const result = gather({
    report: {
      pass: false,
      effectivePass: true,
      baselineAdjudicated: { verdict: 'pass', baseRef: 'origin/main' },
      checks: { tests: { command: 'npm test', exitCode: 1, summary: '1 failing' } },
    },
  });
  const { markdown } = renderPacket(result, { schemaVersion: 1, claims: [] });
  assert.ok(markdown.includes('- `check:tests` — passed: baseline-adjudicated vs origin/main'), markdown);
  assert.ok(!markdown.includes('failed: 1 failing'), markdown);
});

test('a verdict that is not literally true leaves a raw failure failed', () => {
  const checks = { tests: { command: 'npm test', exitCode: 1, summary: '1 failing' } };
  for (const report of [
    { pass: false, effectivePass: false, baselineAdjudicated: { verdict: 'attributable', baseRef: 'origin/main' }, checks },
    { pass: false, effectivePass: 'true', checks },
    { pass: false, checks },
  ]) {
    assert.deepEqual(statusOf(gather({ report }), 'check:tests'), ['failed', '1 failing']);
  }
});

test('an expected check named like an inherited property has no result', () => {
  const result = gather({ report: { checks: {} }, expectedChecks: ['constructor'] });
  assert.deepEqual(statusOf(result, 'check:constructor'), ['not-run', 'no result recorded']);
  assert.equal(factOf(result, 'check:constructor').source, 'verify-scope');
});

test('a declared check and an AC with no result are not-run facts; a check only the report named is not declared', () => {
  const result = gather({
    specText: '## Acceptance Criteria\n1. a\n',
    report: { checks: { extra: { command: 'x', exitCode: 0 } } },
    expectedChecks: ['tests'],
  });
  assert.deepEqual(statusOf(result, 'check:ac-1'), ['not-run', 'no spec-compliance result recorded']);
  assert.deepEqual(statusOf(result, 'check:tests'), ['not-run', 'no result recorded']);
  assert.equal(factOf(result, 'check:tests').source, 'verify-scope');
  assert.deepEqual(statusOf(result, 'check:extra'), ['passed', undefined]);
  assert.equal(factOf(result, 'check:extra').source, 'verify-report');
  assert.equal(Object.hasOwn(result, 'expected'), false, 'the facts document carries no expected list');
});

test('expected checks from the declaration', () => {
  assert.deepEqual(
    expectedChecksFromDeclaration({ suites: ['tests', 'journeys'], checks: { types: null, lint: 'npm run lint', tests: {} } }),
    ['tests', 'journeys', 'lint'],
  );
  assert.deepEqual(
    expectedChecksFromDeclaration({ suites: [], checks: { types: 't', lint: null, tests: null } }),
    ['types'],
  );
  assert.equal(expectedChecksFromDeclaration(null), null);
});

test('expected checks: null declaration is a stated partial', () => {
  const result = gather({
    expectedChecks: null,
    report: { checks: { tests: { command: 'x', exitCode: 0 } } },
    specText: null,
  });
  assert.ok(result.partial.includes(SCOPE_NOTE));
  assert.deepEqual(idsOf(result, 'check'), ['check:tests']);
});

test('an empty expected list is no partial note (a missing declaration, Decision Q11)', () => {
  assert.ok(!gather({ expectedChecks: [] }).partial.includes(SCOPE_NOTE));
});

test('partial gather is stated', () => {
  const result = gather({ report: null, specText: null, expectedChecks: ['tests', 'lint'] });
  assert.ok(result.partial.includes('verify report not found'));
  assert.ok(result.partial.includes('spec not found — acceptance criteria not derived'));
  assert.deepEqual(statusOf(result, 'check:tests'), ['not-run', 'no result recorded']);
  assert.deepEqual(statusOf(result, 'check:lint'), ['not-run', 'no result recorded']);
  assert.deepEqual(idsOf(result, 'check'), ['check:tests', 'check:lint']);
  assertShapeOk(result);
});

test('a report with no usable checks is stated as unread', () => {
  const NOTE = 'verify report not found';
  assert.ok(gather({ report: {} }).partial.includes(NOTE));
  assert.ok(gather({ report: { checks: null } }).partial.includes(NOTE));
  const arrayShaped = gather({ specText: null, report: { checks: [{ command: 'x', exitCode: 0 }] } });
  assert.ok(arrayShaped.partial.includes(NOTE));
  assert.deepEqual(idsOf(arrayShaped, 'check'), []);
  assert.ok(!gather({ report: { checks: {} } }).partial.includes(NOTE));
});

test('a complete gather carries no partial note', () => {
  assert.deepEqual(gather().partial, []);
});

test('a missing decisions log and ungathered git changes are stated', () => {
  const result = gather({ decisionsText: null, changes: null, commits: null });
  assert.ok(result.partial.includes('review decisions log not found'));
  assert.ok(result.partial.includes('git changes not gathered'));
  assert.ok(!result.partial.includes('git change range is empty — changes not listed'));
});

test('an empty change range is a stated partial', () => {
  const empty = gather({ changes: [], commits: [] });
  assert.ok(empty.partial.includes('git change range is empty — changes not listed'));
  assert.ok(gather({ changes: [], commits: null }).partial.includes('git change range is empty — changes not listed'));
  const withCommit = gather({ changes: [], commits: [{ sha: 'abcdef0123', subject: 's' }] });
  assert.ok(!withCommit.partial.includes('git change range is empty — changes not listed'));
});

// stories

const STORY_EXAMPLE_1 = `schema_version: 2

stories:
  - id: front-page-loads
    description: "Front page loads with posts"
    url: "https://news.ycombinator.com/"
    tags: [smoke, navigation]
    priority: high
    source_files: []
    steps:
      - action: assert_visible
        locator: { role: heading, name: "Hacker News" }
        verify: "At least 10 posts are visible, each with a title and a link"
      - action: assert_visible
        locator: { text: "points" }
        verify: "Each post shows a rank number, score, and comment count"

  - id: navigate-to-page-two
    description: "Navigate to page two and back"
    url: "https://news.ycombinator.com/"
    tags: [navigation]
    priority: medium
    source_files: []
    steps:
      - action: assert_visible
        locator: { role: heading, name: "Hacker News" }
        verify: "Front page loads with posts"
      - action: click
        locator: { text: "More" }
        verify: "Page 2 loads with a new set of posts"
        caption: "Click More to load page two"
      - action: press
        value: "Alt+ArrowLeft"
        verify: "Page 1 loads again with the original posts"

  - id: neg-404-handling
    description: "Non-existent page shows error gracefully"
    url: "https://news.ycombinator.com/item?id=9999999999"
    tags: [negative, error-handling]
    priority: medium
    source_files: []
    steps:
      - action: assert_visible
        locator: { text: "No such item." }
        verify: "Page shows an error message or 'No such item' — not a blank screen or crash"
`;

test('parseStoryFile reads a real multi-story file', () => {
  assert.deepEqual(parseStoryFile(STORY_EXAMPLE_1), [
    { id: 'front-page-loads', negative: false },
    { id: 'navigate-to-page-two', negative: false },
    { id: 'neg-404-handling', negative: true },
  ]);
});

test('parseStoryFile: the neg- prefix alone makes a story negative', () => {
  assert.deepEqual(parseStoryFile('stories:\n  - id: neg-bad-input\n    tags: [form]\n'), [{ id: 'neg-bad-input', negative: true }]);
});

test('parseStoryFile reads block-form tags and quoted values', () => {
  const text = [
    'schema_version: 2',
    'stories:',
    '  - id: "form-rejects-bad-email"',
    '    tags:',
    '      - form',
    '      - negative',
    '    priority: high',
    "  - id: 'plain'",
    '    tags:',
    '      - form',
    '    priority: negative',
    '  - id: inline-quoted # a comment',
    '    tags: ["form", \'negative\'] # a comment',
    '  - id: negative-not-a-prefix',
  ].join('\r\n');
  assert.deepEqual(parseStoryFile(text), [
    { id: 'form-rejects-bad-email', negative: true },
    { id: 'plain', negative: false },
    { id: 'inline-quoted', negative: true },
    { id: 'negative-not-a-prefix', negative: false },
  ]);
});

test('parseStoryFile ignores nested content: step ids and step tags start nothing', () => {
  const text = [
    'stories:',
    '  - id: outer',
    '    steps:',
    '      - id: nested-step',
    '        tags: [negative]',
    '      - action: click',
    '  - id: second',
    '    tags: [smoke]',
    '    notes:',
    '      tags:',
    '        - negative',
  ].join('\n');
  assert.deepEqual(parseStoryFile(text), [
    { id: 'outer', negative: false },
    { id: 'second', negative: false },
  ]);
});

test('parseStoryFile does not credit tags to the story before an item with no id', () => {
  const text = [
    'stories:',
    '  - id: first',
    '  - description: no id on this item',
    '    tags: [negative]',
  ].join('\n');
  assert.deepEqual(parseStoryFile(text), [{ id: 'first', negative: false }]);
});

test('parseStoryFile reads a block tag list at the key\'s own indent, which YAML allows', () => {
  const text = 'stories:\n  - id: a\n    tags:\n    - negative\n    priority: high\n';
  assert.deepEqual(parseStoryFile(text), [{ id: 'a', negative: true }]);
});

test('parseStoryFile stops a block tag list at the next key', () => {
  const text = [
    'stories:',
    '  - id: first',
    '    tags:',
    '      - smoke',
    '    other:',
    '      - negative',
  ].join('\n');
  assert.deepEqual(parseStoryFile(text), [{ id: 'first', negative: false }]);
});

test('parseStoryFile reads an item whose id is not its first key', () => {
  const text = [
    'stories:',
    '  - description: x',
    '    id: neg-a',
    '  - tags: [negative]',
    '    id: b',
    '  - priority: high',
    '    steps:',
    '      - id: nested',
    '    id: c',
  ].join('\n');
  assert.deepEqual(parseStoryFile(text), [
    { id: 'neg-a', negative: true },
    { id: 'b', negative: true },
    { id: 'c', negative: false },
  ]);
});

test('parseStoryFile reads a flow tag list spanning lines', () => {
  const text = [
    'stories:',
    '  - id: a',
    '    tags: [form,',
    '      "negative"]',
    '    priority: high',
    '  - id: b',
    '    tags: [form, # a comment',
    '      smoke]',
    '    priority: negative',
    '  - id: c',
    '    tags: [',
    '      smoke,',
    '      negative',
    '    ]',
    '  - id: unterminated',
    '    tags: [smoke,',
    '  - id: d',
    '    tags: [negative]',
    '  - id: e',
    '    tags: [form] # not, negative',
  ].join('\n');
  assert.deepEqual(parseStoryFile(text), [
    { id: 'a', negative: true },
    { id: 'b', negative: false },
    { id: 'c', negative: true },
    { id: 'unterminated', negative: false },
    { id: 'd', negative: true },
    { id: 'e', negative: false },
  ]);
});

test('parseStoryFile reads only the stories list', () => {
  assert.deepEqual(parseStoryFile('defaults:\n  - name: x\nstories:\n  - id: a\nother:\n  - id: b\n'), [{ id: 'a', negative: false }]);
  assert.deepEqual(parseStoryFile('stories:\n- id: a\n  tags: [negative]\n- id: b\n'), [
    { id: 'a', negative: true },
    { id: 'b', negative: false },
  ]);
  assert.deepEqual(parseStoryFile('- id: bare\n  tags: [negative]\n'), [{ id: 'bare', negative: true }]);
});

test('parseStoryFile reads past a leading list, excluding it only when stories: is found', () => {
  assert.deepEqual(parseStoryFile('- id: leading\nstories:\n  - id: a\n'), [{ id: 'a', negative: false }]);
  assert.deepEqual(parseStoryFile('- id: leading\nother: 1\n- id: next\n'), [
    { id: 'leading', negative: false },
    { id: 'next', negative: false },
  ]);
});

test('parseStoryFile reads past a bare - line, in the list and as an item', () => {
  assert.deepEqual(parseStoryFile('stories:\n  - id: a\n  -\n  - id: b\n'), [
    { id: 'a', negative: false },
    { id: 'b', negative: false },
  ]);
  assert.deepEqual(parseStoryFile('stories:\n  -\n    id: nested\n    tags: [negative]\n  - id: b\n'), [
    { id: 'nested', negative: true },
    { id: 'b', negative: false },
  ]);
});

test('parseStoryFile reads every document of a multi-document file', () => {
  assert.deepEqual(parseStoryFile('stories:\n  - id: a\n---\nstories:\n  - id: b\n'), [
    { id: 'a', negative: false },
    { id: 'b', negative: false },
  ]);
  assert.deepEqual(parseStoryFile('- id: a\n---\n- id: b\n  tags: [negative]\n...\n'), [
    { id: 'a', negative: false },
    { id: 'b', negative: true },
  ]);
  assert.deepEqual(parseStoryFile('stories:\n  - id: a\nother:\n  - id: outside\n---\nstories:\n  - id: b\n'), [
    { id: 'a', negative: false },
    { id: 'b', negative: false },
  ]);
});

test('a comment in a flow tag list holds no bracket or comma of the list', () => {
  const text = [
    'stories:',
    '  - id: a',
    '    tags: [x, # not, negative',
    '      y]',
    '  - id: b',
    '    tags: [x, # not ]',
    '      negative]',
    '  - id: c',
    '    tags: [ # opening comment',
    '      x, y # ], negative',
    '    ]',
    '    priority: negative',
  ].join('\n');
  assert.deepEqual(parseStoryFile(text), [
    { id: 'a', negative: false },
    { id: 'b', negative: true },
    { id: 'c', negative: false },
  ]);
});

test('parseStoryFile on a file with no stories is empty', () => {
  assert.deepEqual(parseStoryFile('schema_version: 2\nstories: []\n'), []);
});

test('storyResultsFromQaReport maps QA statuses', () => {
  const report = {
    stories: [
      { id: 'a', status: 'PASS' },
      { id: 'b', status: 'PASS_WITH_CAVEATS' },
      { id: 'c', status: 'FAIL', error: 'Locator not found' },
      { id: 'd', status: 'SKIPPED' },
      { id: 'e', status: 'FAIL' },
      { id: 'f', status: 'SKIPPED', error: 'no dev server' },
      { id: 'g', status: 'WEIRD' },
      { id: 'h', status: 'constructor' },
    ],
  };
  assert.deepEqual(storyResultsFromQaReport(report), [
    { id: 'a', status: 'passed' },
    { id: 'b', status: 'passed' },
    { id: 'c', status: 'failed', reason: 'Locator not found' },
    { id: 'd', status: 'skipped', reason: 'skipped' },
    { id: 'e', status: 'failed', reason: 'story failed' },
    { id: 'f', status: 'skipped', reason: 'no dev server' },
    { id: 'g', status: 'not-run', reason: 'unrecognized QA status WEIRD' },
    { id: 'h', status: 'not-run', reason: 'unrecognized QA status constructor' },
  ]);
  assert.equal(storyResultsFromQaReport(null), null);
  assert.equal(storyResultsFromQaReport('text'), null);
  assert.equal(storyResultsFromQaReport({ summary: {} }), null);
  assert.deepEqual(storyResultsFromQaReport({ stories: [] }), []);
});

test('a QA entry with no usable id is counted in a stated partial, never a fact', () => {
  const NOTE = 'QA report entries with no story id, not listed: 3';
  const storyResults = storyResultsFromQaReport({
    stories: [null, { status: 'FAIL', error: 'boom' }, { id: '', status: 'PASS' }, { id: 'a', status: 'PASS' }],
  });
  assert.equal(storyResults.length, 4);
  assert.deepEqual(storyResults[1], { id: null, status: 'failed', reason: 'boom' });
  const result = gather({ storyResults });
  assert.ok(result.partial.includes(NOTE), JSON.stringify(result.partial));
  assert.deepEqual(idsOf(result, 'story'), ['story:a']);
  assert.deepEqual(idsOf(result, 'check'), ['check:ac-1']);
  assertShapeOk(result);
  const clean = gather({ storyResults: storyResultsFromQaReport({ stories: [{ id: 'a', status: 'PASS' }] }) });
  assert.ok(!clean.partial.some((note) => note.startsWith('QA report entries')));
});

test('storiesFromQaStamp reads only a stamp at HEAD', () => {
  const H = 'a'.repeat(40);
  const sha256 = 'b'.repeat(64);
  const stamp = {
    sha: H,
    dirty: false,
    stories: [{ id: 'a', file: 's.yaml', sha256 }, { id: 'neg-b', file: 's.yaml', sha256 }],
  };
  assert.deepEqual(storiesFromQaStamp(stamp, H), [{ id: 'a', status: 'passed' }, { id: 'neg-b', status: 'passed' }]);
  assert.equal(storiesFromQaStamp(stamp, 'c'.repeat(40)), null);
  assert.equal(storiesFromQaStamp(null, H), null);
  assert.equal(storiesFromQaStamp(stamp, null), null);
});

test('Q13: an unselected story produces no fact; a stamp-skipped selected story is passed', () => {
  const storyIndex = [
    { id: 'a', negative: false },
    { id: 'neg-b', negative: true },
    { id: 'c', negative: false },
  ];
  const result = gather({
    storyIndex,
    storyResults: [{ id: 'a', status: 'failed', reason: 'x' }, { id: 'neg-b', status: 'skipped', reason: 'skipped' }],
    stampStories: [{ id: 'neg-b', status: 'passed' }],
  });
  assert.deepEqual(statusOf(result, 'story:a'), ['failed', 'x']);
  assert.deepEqual(statusOf(result, 'story:neg-b'), ['passed', undefined]);
  assert.equal(factOf(result, 'story:neg-b').negative, true);
  assert.equal(factOf(result, 'story:neg-b').source, 'qa-stamp');
  assert.equal(factOf(result, 'story:a').source, 'qa-report');
  assert.equal(factOf(result, 'story:a').negative, false);
  assert.equal(factOf(result, 'story:c'), undefined);
  assert.ok(!result.partial.some((note) => note.startsWith('repeated fact ids')), 'a stamp winning is not a repeat');

  const neither = gather({ storyIndex, storyResults: null, stampStories: null });
  assert.deepEqual(idsOf(neither, 'story'), []);
  assert.ok(!neither.partial.includes(QA_NOTE));
});

test('a stamp-only story is selected and expected', () => {
  const result = gather({ stampStories: [{ id: 'x', status: 'passed' }] });
  assert.deepEqual(statusOf(result, 'story:x'), ['passed', undefined]);
});

test('a story listed twice in a QA report keeps the first and states the repeat', () => {
  const result = gather({
    storyResults: [{ id: 'a', status: 'failed', reason: 'first' }, { id: 'a', status: 'passed' }],
  });
  assert.deepEqual(statusOf(result, 'story:a'), ['failed', 'first']);
  assert.ok(result.partial.includes('repeated fact ids, first kept: story:a'));
  assertShapeOk(result);
});

test('a neg- story outside the index is negative', () => {
  const result = gather({
    storyIndex: [],
    storyResults: [{ id: 'neg-x', status: 'passed' }, { id: 'plain', status: 'passed' }],
  });
  assert.equal(factOf(result, 'story:neg-x').negative, true);
  assert.equal(factOf(result, 'story:plain').negative, false);
});

test('the story index decides negative when it holds the id, even against the prefix', () => {
  const result = gather({
    storyIndex: [{ id: 'tagged', negative: true }, { id: 'neg-off', negative: false }],
    storyResults: [{ id: 'tagged', status: 'passed' }, { id: 'neg-off', status: 'passed' }],
  });
  assert.equal(factOf(result, 'story:tagged').negative, true);
  assert.equal(factOf(result, 'story:neg-off').negative, false);
});

test('qaSelectionFromDecisions takes the highest selection logged', () => {
  assert.equal(qaSelectionFromDecisions(null), 0);
  assert.equal(qaSelectionFromDecisions(''), 0);
  assert.equal(qaSelectionFromDecisions('- AUTO 10:00:00 — QA scoped: 2/9 stories affected by 3 changed file(s).'), 2);
  assert.equal(qaSelectionFromDecisions('- AUTO 10:00:00 — QA skipped: 4 selected stories already passed at abc'), 4);
  assert.equal(qaSelectionFromDecisions('QA scoped: 0/9 stories affected'), 0);
  assert.equal(qaSelectionFromDecisions('QA scoped: 3/9 x\nQA scoped: 0/9 y\nQA skipped: 1 selected stories z'), 3);
  assert.equal(qaSelectionFromDecisions('QA skipped: 5 selected stories z\nQA scoped: 2/9 x'), 5);
});

test('QA evidence that should exist is a stated partial', () => {
  const noted = (over) => gather({ storyResults: null, stampStories: null, ...over }).partial.includes(QA_NOTE);
  assert.equal(noted({ decisionsText: '- AUTO 10:00:00 — QA scoped: 2/9 stories affected' }), true);
  assert.equal(noted({ decisionsText: '- AUTO 10:00:00 — QA skipped: 2 selected stories already passed' }), true);
  assert.equal(noted({ qaReportUnread: true }), true);
  assert.equal(noted({ decisionsText: '- AUTO 10:00:00 — QA scoped: 0/9 stories affected' }), false);
  assert.equal(noted({ decisionsText: '- AUTO 10:00:00 — something else' }), false);
  const selected = { decisionsText: 'QA scoped: 2/9 stories affected' };
  assert.equal(noted({ ...selected, storyResults: [{ id: 'a', status: 'passed' }] }), false);
  assert.equal(noted({ ...selected, stampStories: [{ id: 'a', status: 'passed' }] }), false);
});

// links

test('refused links never become facts', () => {
  const result = gather({
    links: [
      { id: 'evil', label: 'evil', url: 'https://evil.example/x' },
      { id: 'good', label: 'good', url: `${LOCAL}/settings` },
      { id: 'run', label: 'run', command: 'npm run dev' },
    ],
  });
  assert.deepEqual(result.refused, [{ id: 'link:evil', reason: 'host not allowed: evil.example' }]);
  assert.equal(factOf(result, 'link:evil'), undefined);
  assert.equal(factOf(result, 'link:good').url, `${LOCAL}/settings`);
  assert.equal(factOf(result, 'link:good').label, 'good');
  assert.equal(factOf(result, 'link:good').source, 'links');
  assert.equal(factOf(result, 'link:good').status, 'passed');
  assert.equal(factOf(result, 'link:run').command, 'npm run dev');
  assert.deepEqual(result.allowedHosts, [LOCAL]);

  const infra = gather({
    surface: 'infra',
    links: [{ id: 'u', label: 'u', url: `${LOCAL}/x` }, { id: 'c', label: 'c', command: 'terraform plan' }],
  });
  assert.deepEqual(infra.refused, [{ id: 'link:u', reason: INFRA_REASON }]);
  assert.deepEqual(idsOf(infra, 'link'), ['link:c']);

  const backend = gather({ surface: 'backend', links: [{ id: 'u', label: 'u', url: `${LOCAL}/x` }] });
  assert.deepEqual(backend.refused, [{ id: 'link:u', reason: INFRA_REASON }]);
});

test('allowedHosts is the base URLs that are set', () => {
  assert.deepEqual(gather({ localBaseUrl: null, devBaseUrl: null }).allowedHosts, []);
  assert.deepEqual(gather({ localBaseUrl: 'http://a:1', devBaseUrl: 'https://b' }).allowedHosts, ['http://a:1', 'https://b']);
  const dev = gather({ localBaseUrl: null, devBaseUrl: 'https://dev.example', links: [{ id: 'd', label: 'd', url: 'https://dev.example/x' }] });
  assert.deepEqual(idsOf(dev, 'link'), ['link:d']);
});

test('surface is normalized to the lowercase enum', () => {
  const links = [{ id: 'u', label: 'u', url: `${LOCAL}/x` }];
  const result = gather({ surface: 'Infra', links });
  assert.equal(result.surface, 'infra');
  assert.deepEqual(result.refused, [{ id: 'link:u', reason: INFRA_REASON }]);
  assert.deepEqual(idsOf(result, 'link'), []);
  assert.equal(gather({ surface: '  BACKEND ', links }).surface, 'backend');
  assert.deepEqual(gather({ surface: '  BACKEND ', links }).refused, [{ id: 'link:u', reason: INFRA_REASON }]);
  assert.equal(gather({ surface: null }).surface, null);
  assert.equal(gather({ surface: '' }).surface, null);

  // The renderer compares exactly: a normalized surface renders commands only.
  const narrative = { schemaVersion: 1, claims: [{ section: 'test-guide', text: 'Run it', refs: ['link:c'] }] };
  const rendered = renderPacket(gather({
    surface: 'Infra',
    links: [{ id: 'c', label: 'c', command: 'terraform plan' }, { id: 'u', label: 'u', url: `${LOCAL}/secret-path` }],
  }), narrative);
  assert.ok(rendered.markdown.includes('`terraform plan`'));
  assert.ok(!rendered.markdown.includes('secret-path'));
});

test('a command link carrying a credential flag is refused', () => {
  const result = gather({ links: [{ id: 'd', label: 'd', command: 'deploy --token abc123' }] });
  assert.deepEqual(result.refused, [{ id: 'link:d', reason: 'credential key in command: token' }]);
  assert.equal(factOf(result, 'link:d'), undefined);
  assert.ok(!JSON.stringify(result.refused).includes('abc123'));
  assert.ok(!JSON.stringify(result).includes('abc123'));
});

test('a link naming both a command and a url carries only the command', () => {
  const result = gather({ links: [{ id: 'd', label: 'd', command: 'npm start', url: 'https://evil.example/x?token=abc' }] });
  assert.equal(factOf(result, 'link:d').command, 'npm start');
  assert.equal(factOf(result, 'link:d').url, undefined);
  assert.ok(!JSON.stringify(result).includes('evil.example'));
});

test('a link with a repeated id keeps the first; a link with a url fails on its own credential', () => {
  const result = gather({
    links: [
      { id: 'a', label: 'first', url: `${LOCAL}/1` },
      { id: 'a', label: 'second', url: `${LOCAL}/2` },
      { id: 'b', label: 'b', url: `${LOCAL}/x?token=abc` },
    ],
  });
  assert.equal(factOf(result, 'link:a').label, 'first');
  assert.ok(result.partial.includes('repeated fact ids, first kept: link:a'));
  assert.deepEqual(result.refused, [{ id: 'link:b', reason: 'credential key in query: token' }]);
});

test('a link with a bearer-shaped path segment is refused, never a fact (#4612)', () => {
  const result = gather({ links: [{ id: 'b', label: 'b', url: `${LOCAL}/a/Xk3j9f8s7d6f5g4h3j2k1/b` }] });
  assert.deepEqual(result.refused, [{ id: 'link:b', reason: 'credential in path segment' }]);
  assert.equal(factOf(result, 'link:b'), undefined);
  assert.ok(!JSON.stringify(result).includes('Xk3j9f8s7d6f5g4h3j2k1'));
});

// deploy and pass-through kinds

test('deploy defaults to local and states the dev confirmation', () => {
  const local = factOf(gather({ deploy: null }), 'deploy:status');
  assert.deepEqual(local, { id: 'deploy:status', kind: 'deploy', status: 'passed', source: 'deploy', text: 'target: local', target: 'local', live: null });
  const live = factOf(gather({ deploy: { target: 'dev', live: true } }), 'deploy:status');
  assert.equal(live.text, 'target: dev, confirmed live');
  assert.equal(live.live, true);
  const notLive = factOf(gather({ deploy: { target: 'dev', live: false } }), 'deploy:status');
  assert.equal(notLive.text, 'target: dev, not confirmed live');
  assert.equal(notLive.target, 'dev');
  assert.equal(factOf(gather({ deploy: { target: 'dev', live: null } }), 'deploy:status').text, 'target: dev, not confirmed live');
});

test('pass-through kinds keep their text and url, status passed', () => {
  const result = gather({
    recordings: [{ id: 'demo', text: 'Demo run', url: 'https://cdn.example/a.mp4' }],
    flags: [{ id: 'auth', text: 'Touches auth' }],
    decisions: [{ id: 'merge order', text: 'Pick a merge order' }],
  });
  assert.deepEqual(factOf(result, 'recording:demo'), { id: 'recording:demo', kind: 'recording', status: 'passed', source: 'recordings', text: 'Demo run', url: 'https://cdn.example/a.mp4' });
  assert.deepEqual(factOf(result, 'flag:auth'), { id: 'flag:auth', kind: 'flag', status: 'passed', source: 'flags', text: 'Touches auth' });
  assert.deepEqual(factOf(result, 'decision:merge%20order'), { id: 'decision:merge%20order', kind: 'decision', status: 'passed', source: 'decision-items', text: 'Pick a merge order' });
  assertShapeOk(result);
});

test('a pass-through record cannot set its own status, kind or source', () => {
  const result = gather({ flags: [{ id: 'f', text: 't', status: 'failed', kind: 'check', source: 'forged' }] });
  assert.deepEqual(factOf(result, 'flag:f'), { id: 'flag:f', kind: 'flag', status: 'passed', source: 'flags', text: 't' });
});

test('a pass-through id already carrying its kind is not prefixed twice', () => {
  const result = gather({ flags: [{ id: 'flag:auth', text: 't' }, { id: 'flag:a b', text: 't' }] });
  assert.deepEqual(idsOf(result, 'flag'), ['flag:auth', 'flag:a%20b']);
  assertShapeOk(result);
});

// changes

test('a real changed path never fails the fact shape', () => {
  const paths = ['src/routes/+page.svelte', 'app/(marketing)/[slug]/page.tsx', 'docs/my notes.md'];
  const result = gather({ changes: paths.map((p) => ({ status: 'M', path: p })) });
  assert.deepEqual(idsOf(result, 'change'), [
    'change:src/routes/%2Bpage.svelte',
    'change:app/%28marketing%29/%5Bslug%5D/page.tsx',
    'change:docs/my%20notes.md',
  ]);
  assert.deepEqual(result.facts.filter((f) => f.kind === 'change').map((f) => f.text), paths);
  assertShapeOk(result);
});

test('a commit becomes a change fact keyed by its short sha', () => {
  const result = gather({ commits: [{ sha: '92b7765c5abc', subject: 'Harden the renderer' }] });
  assert.deepEqual(factOf(result, 'change:commit-92b7765'), {
    id: 'change:commit-92b7765', kind: 'change', status: 'passed', source: 'git', text: 'Harden the renderer',
  });
});

test('every gathered fact carries a source', () => {
  const result = gather({
    specText: '## Acceptance Criteria\n1. a\n',
    acResults: { 1: 'met' },
    report: { checks: { tests: { command: 'x', exitCode: 0 } } },
    expectedChecks: ['tests', 'lint'],
    storyIndex: [],
    storyResults: [{ id: 'a', status: 'failed', reason: 'x' }],
    stampStories: [{ id: 'b', status: 'passed' }],
    lowConfidence: [{ n: 1, text: 'finding text' }],
    commits: [{ sha: 'abcdef0123', subject: 's' }],
    links: [{ id: 'l', label: 'l', url: `${LOCAL}/x` }],
    deploy: { target: 'dev', live: false },
    recordings: [{ id: 'r', text: 't', url: 'https://cdn.example/a.mp4' }],
    flags: [{ id: 'f', text: 't' }],
    decisions: [{ id: 'd', text: 't' }],
  });
  const kinds = new Set(result.facts.map((f) => f.kind));
  assert.deepEqual([...kinds].sort(), ['change', 'check', 'decision', 'deploy', 'finding', 'flag', 'link', 'recording', 'story']);
  for (const f of result.facts) assert.ok(typeof f.source === 'string' && f.source !== '', f.id);
  assert.deepEqual(factOf(result, 'finding:1'), { id: 'finding:1', kind: 'finding', status: 'passed', source: 'review', text: 'finding text' });
  for (const f of result.facts.filter((x) => !['check', 'story'].includes(x.kind))) assert.equal(f.status, 'passed', f.id);
  assert.equal(result.schemaVersion, 1);
  assert.equal(result.record, 4611);
  assertShapeOk(result);
});

test('a repeat across inputs is named once per id', () => {
  const result = gather({
    changes: [{ status: 'M', path: 'a' }, { status: 'M', path: 'a' }, { status: 'M', path: 'a' }, { status: 'M', path: 'b' }, { status: 'M', path: 'b' }],
  });
  assert.ok(result.partial.includes('repeated fact ids, first kept: change:a, change:b'));
  assertShapeOk(result);
});

test('a gathered packet renders', () => {
  const result = gather({
    changes: [{ status: 'M', path: 'src/routes/+page.svelte' }],
    expectedChecks: ['tests'],
    storyResults: [{ id: 'neg-x', status: 'passed' }],
    deploy: { target: 'dev', live: false },
  });
  const { markdown } = renderPacket(result, { schemaVersion: 1, claims: [] });
  assert.ok(markdown.includes('`check:tests` — not run: no result recorded'));
  assert.ok(markdown.includes('`story:neg-x` — passed'));
  assert.ok(markdown.includes('target: dev, not confirmed live'));
});

// low-confidence findings

const bareDeps = () => ({
  readFile: (p) => fs.readFileSync(p, 'utf8'),
  readdir: (p) => {
    try {
      return fs.readdirSync(p);
    } catch {
      return [];
    }
  },
});

function runDirFixture({ decisions, staged = {}, reviewFindings = null }) {
  const runDir = tempDir('packet-gather-');
  fs.mkdirSync(path.join(runDir, 'staged'));
  fs.writeFileSync(path.join(runDir, 'decisions.md'), decisions);
  for (const [name, body] of Object.entries(staged)) fs.writeFileSync(path.join(runDir, 'staged', name), body);
  if (reviewFindings) fs.writeFileSync(path.join(runDir, 'review-findings.json'), JSON.stringify(reviewFindings));
  return runDir;
}

const stagedReader = (runDir) => (name) => {
  try {
    return fs.readFileSync(path.join(runDir, 'staged', name), 'utf8');
  } catch {
    return null;
  }
};

const consoleFindings = (fixture) => {
  const runDir = runDirFixture(fixture);
  return lowConfidenceFindings(findingItems({ runDir, deps: bareDeps() }), stagedReader(runDir));
};

const UNSETTLED = '- STAGED 10:00:00 — Single-read (low tier): lens "3b" finding src/a.js:4 not directly verified. Staged to Review Console as low-confidence. Reversibility: high.';
const SETTLED = '- STAGED 10:00:01 — Reproduction: lens "3a" finding src/b.js:9 not reproduced. Staged to Review Console as low-confidence. Reversibility: high.';
const ELEVATION = '- AUTO 10:00:02 — Reproduction: lens "3a" finding src/b.js:9 elevated via direct-verification override. Confirmed, low. Reversibility: high.';
const UNSETTLED_TEXT = 'Single-read (low tier): lens "3b" finding src/a.js:4 not directly verified.';

test("low-confidence findings are the Review Console's set", () => {
  const decisions = `${[UNSETTLED, SETTLED, ELEVATION].join('\n')}\n`;
  const alone = consoleFindings({ decisions });
  assert.deepEqual(alone, [{ n: 1, text: UNSETTLED_TEXT }]);
  const facts = gather({ lowConfidence: alone });
  assert.deepEqual(idsOf(facts, 'finding'), ['finding:1']);
  assert.equal(factOf(facts, 'finding:1').text, UNSETTLED_TEXT);

  const withStaged = consoleFindings({
    decisions,
    staged: { 'review-unconfirmed-1.md': '\n\nTitle: an unconfirmed finding\nKind: review-unconfirmed\n' },
  });
  assert.equal(withStaged.length, 2);
  assert.deepEqual(withStaged.map((f) => f.n), [1, 2]);
  assert.ok(withStaged.some((f) => f.text === 'an unconfirmed finding'));
  assert.ok(withStaged.some((f) => f.text === UNSETTLED_TEXT));
  assert.deepEqual(idsOf(gather({ lowConfidence: withStaged }), 'finding'), ['finding:1', 'finding:2']);
});

test('a contested item is not a low-confidence finding', () => {
  const contested = '- STAGED 10:00:03 — Cross-lens debate inconclusive on src/c.js:1: contested. Reversibility: high.';
  assert.deepEqual(consoleFindings({ decisions: `${contested}\n` }), []);
  assert.deepEqual(consoleFindings({ decisions: '', staged: { 'review-contested-1.md': 'Title: x\n' } }), []);
});

test('a line with extra note words loses the whole note, and a path keeping its dots', () => {
  const line = '- STAGED 10:00:00 — spec #3412 — lens "3a" finding src/pr.state.js:39 not reproduced. Staged to Review Console as low-confidence — not elevated. Reversibility: high.';
  assert.deepEqual(consoleFindings({ decisions: `${line}\n` }), [
    { n: 1, text: 'spec #3412 — lens "3a" finding src/pr.state.js:39 not reproduced.' },
  ]);
});

const TIEBREAK_ID = 'abcdef012345';
const CANT_TELL = `- STAGED 10:00:04 — Tiebreak tiebreak:${TIEBREAK_ID}: lens "3a" finding src/c.js:7 console: verdict:cant-tell. Severity: medium. Recommendation: file.`;

test('a can\'t-tell verdict reads its finding from the findings artifact', () => {
  const reviewFindings = [{ id: TIEBREAK_ID, lens: '3a', path: 'src/c.js', line: 7, claim: 'off by one' }];
  assert.deepEqual(consoleFindings({ decisions: `${CANT_TELL}\n`, reviewFindings }), [{ n: 1, text: 'src/c.js:7 off by one' }]);
});

test('a can\'t-tell verdict with no findings entry falls back to its id', () => {
  assert.deepEqual(consoleFindings({ decisions: `${CANT_TELL}\n` }), [{ n: 1, text: `tiebreak:${TIEBREAK_ID}` }]);
  const blankClaim = [{ id: TIEBREAK_ID, path: 'src/c.js', line: 7, claim: '  ' }];
  assert.deepEqual(consoleFindings({ decisions: `${CANT_TELL}\n`, reviewFindings: blankClaim }), [{ n: 1, text: `tiebreak:${TIEBREAK_ID}` }]);
});

const STAGED_FILE_LINE = '- STAGED 10:00:00 — Reproduction: lens "3a" finding src/a.js:9 not reproduced. Stage path: staged/review-unconfirmed-1.md. Reversibility: high.';
const SETTLERS = {
  confirmed: ['- AUTO 10:00:01 — Reproduction: lens "3a" finding src/a.js:9 confirmed by tiebreak:abcdef012345. Confirmed.', 'dismissed'],
  refuted: ['- AUTO 10:00:01 — Tiebreak tiebreak:abcdef012345: lens "3a" finding src/a.js:9 dropped: refuted by tiebreak. Evidence: src/a.js:9 no such bug. Severity: medium.', 'dropped'],
  digested: ['- AUTO 10:00:01 — Tiebreak tiebreak:abcdef012345: lens "3a" finding src/a.js:9 digested: verdict:cant-tell. Severity: low.', 'dismissed'],
};

for (const [name, [verdict, resolution]] of Object.entries(SETTLERS)) {
  test(`a staged finding the tiebreak settled (${name}) is absent, and n stays contiguous`, () => {
    const fixture = {
      decisions: `${[STAGED_FILE_LINE, verdict, UNSETTLED].join('\n')}\n`,
      staged: { 'review-unconfirmed-1.md': 'Title: settled finding\n' },
    };
    const runDir = runDirFixture(fixture);
    const { items } = findingItems({ runDir, deps: bareDeps() });
    assert.deepEqual(items[0].id, 'review-unconfirmed-1.md');
    assert.equal(items[0].resolution, resolution);
    assert.equal(items[0].tiebreak, undefined);
    assert.deepEqual(consoleFindings(fixture), [{ n: 1, text: UNSETTLED_TEXT }]);
  });
}

test("a can't-tell with Recommendation: drop stays, on a staged file or on its own", () => {
  const verdict = '- STAGED 10:00:01 — Tiebreak tiebreak:abcdef012345: lens "3a" finding src/a.js:9 console: verdict:cant-tell. Severity: medium. Recommendation: drop.';
  const fixture = {
    decisions: `${[STAGED_FILE_LINE, verdict].join('\n')}\n`,
    staged: { 'review-unconfirmed-1.md': 'Title: a judged finding\n' },
  };
  const { items } = findingItems({ runDir: runDirFixture(fixture), deps: bareDeps() });
  assert.equal(items[0].resolution, 'dropped');
  assert.ok(items[0].tiebreak);
  assert.deepEqual(consoleFindings(fixture), [{ n: 1, text: 'a judged finding' }]);

  const alone = { decisions: `${CANT_TELL.replace('Recommendation: file', 'Recommendation: drop')}\n` };
  assert.deepEqual(consoleFindings(alone), [{ n: 1, text: `tiebreak:${TIEBREAK_ID}` }]);
});

test('a staged finding reads its Title, then its Finding field, then its first line, then its id', () => {
  const textOf = (body) => lowConfidenceFindings(
    { items: [{ id: 'review-unconfirmed-1.md', section: 'Low-confidence findings' }], findings: [], decisions: '' },
    () => body,
  )[0].text;
  assert.equal(textOf('# Generic heading\n\nFinding: the finding\nTitle: the title\n'), 'the title');
  assert.equal(textOf('**Title:** bold title\n'), 'bold title');
  assert.equal(textOf('Target: docs/a.md\nInvariant: x\nFinding: low thing\n'), 'low thing');
  assert.equal(textOf('# Generic\n\n- Finding: bulleted\n'), 'bulleted');
  assert.equal(textOf('# Generic\n\n- **Finding:** bold bullet\n'), 'bold bullet');
  assert.equal(textOf('# Generic\n\n## Finding\n\nunder the heading\n\nmore\n'), 'under the heading');
  assert.equal(textOf('\n# Only a heading\nprose\n'), '# Only a heading');
  assert.equal(textOf('Title:   \nFinding: empty title skipped\n'), 'empty title skipped');
  assert.equal(textOf('## Finding\n\n## Next\nnext prose\n'), '## Finding');
  assert.equal(textOf('  \n'), 'review-unconfirmed-1.md');
  assert.equal(textOf(null), 'review-unconfirmed-1.md');
});

test('a field or first line inside a code fence is not the staged finding', () => {
  const textOf = (body) => lowConfidenceFindings(
    { items: [{ id: 'review-unconfirmed-1.md', section: 'Low-confidence findings' }], findings: [], decisions: '' },
    () => body,
  )[0].text;
  assert.equal(textOf('```\nTitle: fenced\n```\nTitle: the real one\n'), 'the real one');
  assert.equal(textOf('~~~md\nFinding: fenced\n~~~\n\nFinding: the real one\n'), 'the real one');
  assert.equal(textOf('```\nTitle: fenced\n```\nprose after it\n'), 'prose after it');
  assert.equal(textOf('```\nTitle: only fenced\n```\n'), 'review-unconfirmed-1.md');
});

test('lowConfidenceFindings falls back to the id, and leaves other sections out', () => {
  const items = [
    { id: 'review-unconfirmed-9.md', section: 'Low-confidence findings' },
    { id: 'review-unconfirmed-8.md', section: 'Low-confidence findings' },
    { id: 'review-debate-1.md', section: 'Contested findings' },
    { id: 'decision:gone#00000000', section: 'Low-confidence findings' },
  ];
  const read = (name) => (name === 'review-unconfirmed-8.md' ? '   \n' : null);
  assert.deepEqual(lowConfidenceFindings({ items, findings: [], decisions: '' }, read), [
    { n: 1, text: 'review-unconfirmed-9.md' },
    { n: 2, text: 'review-unconfirmed-8.md' },
    { n: 3, text: 'decision:gone#00000000' },
  ]);
});

test('a repeated line is found through its -k id suffix', () => {
  const line = '- STAGED 10:00:00 — lens "3a" finding src/a.js:1 x. Staged to Review Console as low-confidence.';
  const hash = crypto.createHash('sha256').update(line).digest('hex').slice(0, 8);
  const items = [{ id: `decision:${line.slice(2, 60)}#${hash}-2`, section: 'Low-confidence findings' }];
  assert.deepEqual(lowConfidenceFindings({ items, findings: [], decisions: `other\n${line}\n` }, () => null), [
    { n: 1, text: 'lens "3a" finding src/a.js:1 x.' },
  ]);
});

const WIDE = ' '.repeat(100000);

// The text the gather reads off one decisions line, through the id the console mints for it.
function decisionTextOf(...lines) {
  const items = lines.map((line) => {
    const hash = crypto.createHash('sha256').update(line).digest('hex').slice(0, 8);
    return { id: `decision:${line.slice(2, 60)}#${hash}`, section: 'Low-confidence findings' };
  });
  return lowConfidenceFindings({ items, findings: [], decisions: `${lines.join('\n')}\n` }, () => null).map(({ text }) => text);
}

test('two decision items each read their own line, in one pass over the log', () => {
  const first = '- STAGED 10:00:00 — first finding. Staged to Review Console as low-confidence. Reversibility: high.';
  const second = '- STAGED 10:00:01 — second finding. Reversibility: low.';
  assert.deepEqual(decisionTextOf(first, second), ['first finding.', 'second finding.']);
});

test('the note and clause strip takes the whitespace before them, and a long whitespace run costs no time', () => {
  assert.deepEqual(decisionTextOf('- STAGED 10:00:00 — a b   Reversibility: high.'), ['a b']);
  assert.deepEqual(decisionTextOf('- STAGED 10:00:00 — a  \t Reversibility: high. tail'), ['a tail']);
  assert.deepEqual(decisionTextOf('- STAGED 10:00:00 — a  Staged to Review Console as low-confidence at x.y. Reversibility: z'), ['a']);
  // No clause in the line: the run is part of the text, and the result is the line's body trimmed.
  assert.deepEqual(decisionTextOf(`- STAGED 10:00:00 — x${WIDE}y`), [`x${WIDE}y`]);
  assert.deepEqual(decisionTextOf(`- STAGED 10:00:00 — a${WIDE}Reversibility: high.${WIDE}b`), [`a${WIDE}b`]);
});

test('a heading is read the same with a long interior or trailing whitespace run', () => {
  const ids = (spec) => parseAcceptanceCriteria(spec).map((ac) => ac.id);
  assert.deepEqual(ids('## Acceptance Criteria   \n1. a\n'), ['1']);
  assert.deepEqual(ids(`## Acceptance Criteria${WIDE}\n1. a\n`), ['1']);
  assert.deepEqual(ids(`## Acceptance${WIDE}Criteria\n1. a\n`), []);
  assert.deepEqual(ids(`## Acceptance Criteria\n1. a\n### a${WIDE}b\n2. b\n`), ['1', '2']);
  // A heading with nothing but whitespace after the marker is a heading with no text.
  assert.deepEqual(ids(`## Acceptance Criteria\n1. a\n##${WIDE}\n2. b\n`), ['1']);
});

test('a story value is cut at a comment after whitespace, and a long whitespace run is part of the value', () => {
  const idsOf2 = (text) => parseStoryFile(text).map(({ id }) => id);
  assert.deepEqual(idsOf2('stories:\n  - id: a   # comment\n'), ['a']);
  assert.deepEqual(idsOf2('stories:\n  - id: "a" # comment\n'), ['a']);
  assert.deepEqual(idsOf2('stories:\n  - id: a#b\n'), ['a#b']);
  assert.deepEqual(idsOf2('stories:\n  - id: a\t# comment # more\n'), ['a']);
  assert.deepEqual(idsOf2(`stories:\n  - id: a${WIDE}b\n`), [`a${WIDE}b`]);
  assert.deepEqual(idsOf2(`stories:\n  - id: a${WIDE}# c\n`), ['a']);
});

// readPacket

const V1 = '<!-- acceptance-packet: v1 -->';
const comment = (over) => ({ id: over.url || 'c', body: `${V1}\nbody`, authorAssociation: 'MEMBER', ...over });

test('AC2b readPacket', () => {
  const found = readPacket([
    comment({ url: 'u1', authorAssociation: 'NONE', createdAt: '2026-01-01T00:00:00Z' }),
    comment({ url: 'u3', authorAssociation: 'OWNER', createdAt: '2026-01-03T00:00:00Z' }),
    comment({ url: 'u2', authorAssociation: 'MEMBER', createdAt: '2026-01-02T00:00:00Z' }),
    comment({ url: 'u0', body: 'plain text', authorAssociation: 'OWNER', createdAt: '2025-01-01T00:00:00Z' }),
  ]);
  assert.equal(found.status, 'found');
  assert.equal(found.comment.url, 'u2');
  assert.equal(found.version, 1);
  assert.deepEqual(found.extras, ['u3']);
  assert.equal(found.skipped.length, 1);
  assert.ok(found.skipped[0].includes('u1'));

  const unreadable = readPacket([comment({ url: 'v2', body: '<!-- acceptance-packet: v2 -->\nbody' })]);
  assert.equal(unreadable.status, 'unreadable');
  assert.equal(unreadable.version, 2);
  assert.equal(unreadable.comment.url, 'v2');

  assert.deepEqual(readPacket([comment({ url: 'x', body: 'no marker' })]), {
    status: 'none', comment: null, version: null, extras: [], skipped: [],
  });
  assert.deepEqual(readPacket([]), { status: 'none', comment: null, version: null, extras: [], skipped: [] });
});

test('readPacket: only an untrusted marker is none, with the skip noted', () => {
  const result = readPacket([comment({ url: 'u', authorAssociation: 'CONTRIBUTOR' })]);
  assert.equal(result.status, 'none');
  assert.equal(result.comment, null);
  assert.equal(result.version, null);
  assert.equal(result.skipped.length, 1);
});

test('readPacket: the marker must lead the first line', () => {
  const quoted = comment({ url: 'q', body: `quoting the packet:\n${V1}\nbody` });
  const leadingBlank = comment({ url: 'b', body: `\n${V1}\nbody` });
  assert.equal(readPacket([quoted, leadingBlank]).status, 'none');
  assert.equal(readPacket([comment({ url: 'n', body: null }), null]).status, 'none');
});

test('readPacket: the marker is the whole first line, with an unpadded version', () => {
  const statusFor = (body) => readPacket([comment({ url: 'x', body })]).status;
  assert.equal(statusFor(`${V1} trailing prose\nbody`), 'none');
  assert.equal(statusFor(`${V1} \nbody`), 'none');
  assert.equal(statusFor('<!-- acceptance-packet: v01 -->\nbody'), 'none');
  assert.equal(statusFor(`${V1}\r\nbody`), 'found');
  assert.equal(statusFor(V1), 'found');
  const unknown = readPacket([comment({ url: 'x', body: '<!-- acceptance-packet: v2 -->' })]);
  assert.equal(unknown.status, 'unreadable');
  assert.equal(unknown.version, 2);
  assert.equal(statusFor('<!-- acceptance-packet: v0 -->'), 'unreadable');
});

test('readPacket: the unknown version of the earliest decides, however later comments read', () => {
  const result = readPacket([
    comment({ url: 'new', createdAt: '2026-01-02T00:00:00Z' }),
    comment({ url: 'old', body: '<!-- acceptance-packet: v9 -->', createdAt: '2026-01-01T00:00:00Z' }),
  ]);
  assert.equal(result.status, 'unreadable');
  assert.equal(result.version, 9);
  assert.deepEqual(result.extras, ['new']);
});

test('readPacket keeps array order when createdAt is absent, and names an extra by id without a url', () => {
  const result = readPacket([
    { id: 1, body: V1, authorAssociation: 'OWNER' },
    { id: 2, body: V1, authorAssociation: 'OWNER' },
    { id: 3, body: V1, authorAssociation: 'OWNER', createdAt: '2020-01-01T00:00:00Z' },
  ]);
  assert.equal(result.comment.id, 1);
  assert.deepEqual(result.extras, ['2', '3']);

  // One absent timestamp keeps array order for the whole list: a sort comparing a
  // missing instant would be inconsistent, and swaps the last two here.
  const mixed = readPacket([
    { id: 'c', body: V1, authorAssociation: 'OWNER', createdAt: '2026-01-03T00:00:00Z' },
    { id: 'none', body: V1, authorAssociation: 'OWNER' },
    { id: 'b', body: V1, authorAssociation: 'OWNER', createdAt: '2026-01-02T00:00:00Z' },
    { id: 'a', body: V1, authorAssociation: 'OWNER', createdAt: '2026-01-01T00:00:00Z' },
  ]);
  assert.equal(mixed.comment.id, 'c');
  assert.deepEqual(mixed.extras, ['none', 'b', 'a']);
});

test('readPacket orders by instant, not by the text of the timestamp', () => {
  const result = readPacket([
    comment({ url: 'later', createdAt: '2026-01-01T00:30:00+00:00' }),
    comment({ url: 'earlier', createdAt: '2026-01-01T01:00:00+01:00' }),
  ]);
  assert.equal(result.comment.url, 'earlier');
});

test('readPacket reads a REST-shaped comment the same way', () => {
  const result = readPacket([
    { id: 2, html_url: 'h2', body: V1, author_association: 'OWNER', created_at: '2026-01-02T00:00:00Z' },
    { id: 1, html_url: 'h1', body: V1, author_association: 'MEMBER', created_at: '2026-01-01T00:00:00Z' },
    { id: 0, html_url: 'h0', body: V1, author_association: 'NONE', created_at: '2025-01-01T00:00:00Z' },
  ]);
  assert.equal(result.comment.id, 1);
  assert.deepEqual(result.extras, ['h2']);
  assert.ok(result.skipped[0].includes('h0'));
});

const FS_READERS = [
  'readFileSync', 'readFile', 'openSync', 'open', 'readSync', 'read', 'readdirSync', 'readdir',
  'statSync', 'stat', 'lstatSync', 'lstat', 'existsSync', 'exists', 'accessSync', 'access', 'createReadStream', 'opendirSync',
];

function withoutFileReads(fn) {
  const denied = (name) => () => {
    throw new Error(`readPacket touched the filesystem: fs.${name}`);
  };
  const saved = FS_READERS.map((name) => [name, fs[name]]);
  const savedPromiseRead = fs.promises.readFile;
  try {
    for (const name of FS_READERS) fs[name] = denied(name);
    fs.promises.readFile = denied('promises.readFile');
    return fn();
  } finally {
    for (const [name, original] of saved) fs[name] = original;
    fs.promises.readFile = savedPromiseRead;
  }
}

test('AC2b stale run-dir copy is ignored', () => {
  const dir = tempDir('packet-stale-');
  fs.writeFileSync(path.join(dir, 'packet-4611.md'), 'STALE');
  const comments = [comment({ url: 'live', body: `${V1}\nLIVE` })];
  const result = withoutFileReads(() => readPacket(comments));
  assert.equal(result.status, 'found');
  assert.ok(result.comment.body.endsWith('LIVE'));
  assert.equal(readPacket.length, 1, 'the reader takes no path argument');
});
