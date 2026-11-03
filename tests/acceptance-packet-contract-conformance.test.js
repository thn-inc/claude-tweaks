'use strict';

// #4611: `_shared/acceptance-packet.md` restates the packet's vocabularies and the
// strings its code emits. This suite reads the live contract on purpose
// (skill-prose-conformance-tests' "declared contract" carve-out, [IL-80]): updating
// that file IS the response to a change in `bin/lib/wrap-up/packet-*.js`. Closed
// vocabularies are parsed out of the prose and deep-compared with the imported
// constant, and a string the code emits is produced by the code and looked up in the
// prose. Rule clauses are pinned one per test, so a lost clause names itself.
//
// Go-red evidence for these pins is a mutation run against a scratch checkout (the
// task report's mutant table), not an in-file comparison of a value with its own copy.

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');

const {
  SCHEMA_VERSION,
  PACKET_MARKER,
  LOCAL_START,
  LOCAL_END,
  FACT_KINDS,
  FACT_STATUSES,
  CLAIM_SECTIONS,
  SECTION_KINDS,
  SECTIONS,
  MAX_PACKET_CHARS,
  COMMANDS_ONLY_SURFACES,
  CREDENTIAL_KEYS,
  EXPOSURES,
  RECORDING_NOT_RUN_REASONS,
  VERIFICATION_WORDS,
} = require('../plugin/bin/lib/wrap-up/packet-contract');
const { checkLink, findCredentialInText } = require('../plugin/bin/lib/wrap-up/packet-links');
const { validatePacket } = require('../plugin/bin/lib/wrap-up/packet-validate');
const { renderPacket, renderRecordingSection, inline, codeSpan } = require('../plugin/bin/lib/wrap-up/packet-render');
const { gatherPacketFacts, parseAcceptanceCriteria, readPacket } = require('../plugin/bin/lib/wrap-up/packet-gather');
const { upsertLocalPacket } = require('../plugin/bin/lib/wrap-up/packet-post');
const { LABELS } = require('../plugin/bin/lib/issues/record-vocabulary');
const { run } = require('../plugin/bin/acceptance-packet');

const SHARED = path.join(__dirname, '..', 'plugin', 'skills', '_shared');
const CONTRACT = readText(path.join(SHARED, 'acceptance-packet.md'));
const COMMENTS = readText(path.join(SHARED, 'pr-run-comments.md'));

const collapse = (text) => text.replace(/\s+/g, ' ');

// The body of one `## ` section, up to the next `## ` heading. A missing heading fails
// here, so a renamed section cannot widen or empty the region silently.
function sectionOf(text, heading) {
  const lines = text.split('\n');
  const start = lines.indexOf(heading);
  assert.notStrictEqual(start, -1, `${heading} is missing`);
  const next = lines.findIndex((line, index) => index > start && line.startsWith('## '));
  return lines.slice(start + 1, next === -1 ? lines.length : next).join('\n');
}

const inSection = (heading) => collapse(sectionOf(CONTRACT, heading));

// The backticked tokens of the one paragraph opening with `lead`.
function listAfter(section, lead) {
  const paragraphs = section.trim().split('\n\n').filter((paragraph) => paragraph.startsWith(lead));
  assert.strictEqual(paragraphs.length, 1, `exactly one paragraph opens with ${lead}`);
  return [...paragraphs[0].matchAll(/`([^`]+)`/g)].map((match) => match[1]);
}

// The numbered list of `## Sections`: heading → the item's collapsed text, in order.
function sectionItems() {
  const items = [];
  for (const line of sectionOf(CONTRACT, '## Sections').split('\n')) {
    const opener = /^\d+\. \*\*(.+?)\*\*(.*)$/.exec(line);
    if (opener) items.push({ heading: opener[1], text: opener[2] });
    else if (line === '') items.push(null);
    else if (items.at(-1)) items.at(-1).text += ` ${line.trim()}`;
  }
  return items.filter(Boolean);
}

function tableRows(section) {
  return section
    .split('\n')
    .filter((line) => line.startsWith('|'))
    .slice(2)
    .map((line) => line.split('|').slice(1, -1).map((cell) => cell.trim()));
}

const facts = (list, extra = {}) => ({
  schemaVersion: SCHEMA_VERSION, record: 1, partial: [], facts: list, ...extra,
});
const narrative = (claims) => ({ schemaVersion: SCHEMA_VERSION, claims });
const fact = (id, kind, status = 'passed', extra = {}) => ({ id, kind, status, source: 't', ...extra });

// ---- structure ----

test('the contract carries its headings in the specified order', () => {
  const headings = CONTRACT.split('\n').filter((line) => line.startsWith('## '));
  assert.deepStrictEqual(headings, [
    '## Sections',
    '## Canonical copy and lookup',
    '## Facts and claims',
    '## Validation policy',
    '## The expected check set',
    '## Pipeline',
    '## Reader rules',
    '## Untrusted content',
    '## Links and credentials',
    '## Recording',
    '## Facts-poor and infra items',
    '## Size',
    '## Old brief section map',
    '## Failure contract',
  ]);
});

// ---- ## Sections ----

test('the Sections list names every heading of SECTIONS, in render order', () => {
  assert.deepStrictEqual(sectionItems().map(({ heading }) => heading), SECTIONS.map(({ heading }) => heading));
});

test('each section states the line the renderer prints when it is empty', () => {
  const { markdown } = renderPacket(facts([]), narrative([]));
  const rendered = markdown.split('\n### ').slice(1).map((block) => block.split('\n'));
  assert.ok(rendered.length >= 8, 'the empty packet parsed into its sections');
  const items = new Map(sectionItems().map(({ heading, text }) => [heading, text]));
  for (const [heading, line] of rendered) {
    assert.ok(items.has(heading), `${heading} is in the Sections list`);
    assert.ok(items.get(heading).includes(`\`${line}\``), `${heading} must state its empty line: ${line}`);
  }
});

test('Decisions left for you is omitted when empty, heading included', () => {
  const { markdown } = renderPacket(facts([]), narrative([]));
  assert.ok(!markdown.includes('### Decisions left for you'), 'the renderer omits the heading');
  const item = sectionItems().find(({ heading }) => heading === 'Decisions left for you');
  assert.match(item.text, /omitted when empty, heading included/);
});

for (const [heading, owner] of [
  ['Recording', 'the recording record'],
  ['Risk proofs', 'the risk-flag record'],
  ['Decisions left for you', 'the control-mode records'],
  ['Deploy status', 'the dev-target record'],
]) {
  test(`${heading} names its owner`, () => {
    const item = sectionItems().find((entry) => entry.heading === heading);
    assert.ok(item.text.includes(`owner: ${owner}`), `${heading} must name ${owner}`);
  });
}

test('a section that renders facts directly takes no claim: its narrated claim has nowhere to land', () => {
  const body = inSection('## Sections');
  assert.match(body, /Recording, Decisions left for you and Deploy status render facts directly and are never narrated claims/);
  for (const section of ['recording', 'decisions', 'deploy']) {
    assert.ok(!CLAIM_SECTIONS.includes(section), section);
    const { dropped } = validatePacket(facts([]), narrative([{ section, text: 'x', refs: ['change:a'] }]));
    assert.match(dropped[0].reason, /^unknown section/);
  }
});

test('the plan appendix keeps what the Sections paragraph says it keeps', () => {
  const body = inSection('## Sections');
  assert.match(body, /a first-line plan heading is dropped so it is not doubled/);
  assert.match(body, /each line keeps its list marker and its whole backtick spans/);
  assert.match(body, /up to three columns past the open list item's content/);
  const { markdown } = renderPacket(facts([]), narrative([]), {
    observationPlan: '### Observation plan\n- Prepare:\n  - `a [b]`\n        over',
  });
  const plan = markdown.split('\n').slice(markdown.split('\n').indexOf('### Observation plan') + 1);
  assert.deepStrictEqual(plan, ['- Prepare:', '  - `a [b]`', '       over']);
});

test('Risk proofs always renders (Decision Q10)', () => {
  const item = sectionItems().find(({ heading }) => heading === 'Risk proofs');
  assert.match(item.text, /always renders, its placeholder standing in when no risk flag was kept/);
});

const SECTIONS_FACTS = [
  ['skipped and not-run rows go to Couldn\'t test', /status `skipped` or `not-run` → Couldn't test/],
  ['failed rows go to Tried to break', /status `failed` → Tried to break/],
  ['passed negatives go to Tried to break', /status `passed` with `negative: true` → Tried to break/],
  ['routine passes go to the Checks that passed list', /any other `passed` → the Test guide's `Checks that passed:` list/],
  ['every check/story fact renders one row', /Every `check`\/`story` fact renders exactly one row/],
  ['no edge-case signal exists yet (Decision Q8)', /no edge-case signal exists yet: no check counts as an edge case until one does, so Tried to break holds negative stories and failures only/],
];
for (const [label, pattern] of SECTIONS_FACTS) {
  test(`Sections states: ${label}`, () => assert.match(inSection('## Sections'), pattern));
}

// ---- ## Canonical copy and lookup ----

test('the marker and both local-files delimiters are the constants', () => {
  const body = sectionOf(CONTRACT, '## Canonical copy and lookup');
  for (const value of [PACKET_MARKER, LOCAL_START, LOCAL_END]) {
    assert.ok(body.includes(`\`${value}\``), `${value} must be stated`);
  }
  assert.strictEqual(PACKET_MARKER, '<!-- acceptance-packet: v1 -->');
});

const LOOKUP_FACTS = [
  ['the marker is the whole first line', /first line must equal the marker exactly/],
  ['trust cites comment-trust', /trusted author[^.]*`bin\/lib\/issues\/comment-trust\.js`/],
  ['earliest trusted by createdAt, not id', /earliest trusted comment by `createdAt`, not by comment id[^.]*opaque node ids/],
  ['extras are reported and left alone', /extras are reported, never edited or deleted/],
  ['cannot edit: report and post nothing', /a comment it cannot edit is reported and nothing is posted/],
  ['the PR body line', /`Acceptance packet: \{comment url\}` is appended to the PR body idempotently/],
  ['no PR, no link', /No PR, no link/],
  ['one packet per work item', /One packet per work item/],
  ['legacy briefs are left untouched and uncounted', /legacy brief comment is left untouched, and "exactly one" counts packet comments only/],
  ['decomposed work', /Decomposed work: the packet lives on the parent and a sub-issue's wrap-up posts none/],
  ['parent gate stays legacy until #4617', /until the feature-level acceptance record \(#4617\) changes it, the parent gate posts the legacy `## Verification Brief`, whose template lives in `wrap-up\/verification-brief-parent-gate\.md`/],
  ['MCP: an existing packet is reported, not re-posted (Decision Q4)', /a re-run that finds an existing packet is reported, not re-posted: it is a failed edit under `## Failure contract`/],
  ['MCP: no packet posts by add_issue_comment, then the label', /no existing packet, it posts via `add_issue_comment` and only then applies the label/],
  ['below the floor (Decision Q5)', /Below the oversight floor every record with no parent still gets a packet, posted with no pending label/],
];
for (const [label, pattern] of LOOKUP_FACTS) {
  test(`Canonical copy and lookup states: ${label}`, () => assert.match(inSection('## Canonical copy and lookup'), pattern));
}

test('the lookup rules stated are what the code does', () => {
  const body = inSection('## Canonical copy and lookup');
  assert.match(body, /When any candidate's `createdAt` will not parse, the order the comments were given in stands/);
  const trusted = (id, createdAt) => ({ id, url: id, body: PACKET_MARKER, authorAssociation: 'OWNER', createdAt });
  const unparseable = readPacket([trusted('b', 'not a date'), trusted('a', '2020-01-01T00:00:00Z')]);
  assert.strictEqual(unparseable.comment.id, 'b', 'given order');
  const parsed = readPacket([trusted('b', '2021-01-01T00:00:00Z'), trusted('a', '2020-01-01T00:00:00Z')]);
  assert.strictEqual(parsed.comment.id, 'a', 'earliest');

  assert.match(body, /A same-shaped line naming another version is a packet too, and reads as `unreadable`/);
  const other = readPacket([{ ...trusted('a', '2020-01-01T00:00:00Z'), body: '<!-- acceptance-packet: v2 -->' }]);
  assert.strictEqual(other.status, 'unreadable');

  assert.match(body, /A line with another url on the same `\/issues\/\{N\}#` is replaced in place/);
  assert.match(body, /A line on another record's `\/issues\/\{N\}#` stays, since a multi-spec run shares one PR/);
});

test('the local-files block rules stated are what the code does', () => {
  const body = inSection('## Canonical copy and lookup');
  assert.match(body, /Whitespace around a delimiter does not change what it is/);
  assert.match(body, /Repeated blocks collapse into one at the first one's place, and any text between them stays/);
  assert.match(body, /A start with no end pairing it loses its delimiter line, and the text after it stays/);
  const block = (text) => `${LOCAL_START}\n${text}\n${LOCAL_END}`;
  assert.strictEqual(upsertLocalPacket(`  ${LOCAL_START} \nA\n${LOCAL_END}\t`, 'N'), block('N'));
  assert.strictEqual(upsertLocalPacket(`${block('A')}\nx\n${block('B')}`, 'N'), `${block('N')}\nx`);
  assert.strictEqual(upsertLocalPacket(`${LOCAL_START}\nnotes`, 'N'), `${block('N')}\nnotes`);
  assert.strictEqual(upsertLocalPacket(`${block('A')}\nx\n${LOCAL_START}\ny`, 'N'), `${block('N')}\nx\ny`);

  assert.match(body, /An end delimiter with no start above it is ordinary text: it is never a block, and it stays where it is/);
  assert.match(body, /When the first start in the body is such an orphan, the packet lands on that orphan's line, ahead of any\s+complete block below it, which is removed like any repeated block/);
  assert.strictEqual(upsertLocalPacket(`${LOCAL_END}\nx\n${LOCAL_START}\ny`, 'N'), `${LOCAL_END}\nx\n${block('N')}\ny`);
  assert.strictEqual(upsertLocalPacket(`${LOCAL_END}\nx`, 'N'), `${LOCAL_END}\nx\n\n${block('N')}`);
  assert.strictEqual(upsertLocalPacket(`${LOCAL_START}\nx\n${block('A')}\ny`, 'N'), `${block('N')}\nx\ny`);
});

test('what a dropped plan line takes with it, and a withheld id, are stated and rendered', () => {
  const body = inSection('## Links and credentials');
  assert.match(body, /A line following a dropped line that ends in a backslash, and any more deeply indented line under a dropped line, goes with it/);
  assert.ok(body.includes('`(id withheld: credential-shaped)`'));
  assert.match(body, /Validation is unchanged: a withheld id stays citable/);
  const { markdown } = renderPacket(
    facts([fact('check:token%3Dabc', 'check')]),
    narrative([]),
    { observationPlan: '- --token \\\nvalue\n- password=a\n    child\n- kept' },
  );
  assert.ok(markdown.includes('(id withheld: credential-shaped)'));
  assert.ok(!markdown.includes('token%3D'));
  const lines = markdown.split('\n');
  assert.deepStrictEqual(lines.slice(lines.indexOf('### Observation plan') + 1), ['- kept']);
});

// ---- ## Facts and claims ----

test('the kind and status vocabularies are the constants', () => {
  const body = sectionOf(CONTRACT, '## Facts and claims');
  assert.deepStrictEqual(listAfter(body, '**Fact kinds:**'), [...FACT_KINDS]);
  assert.deepStrictEqual(listAfter(body, '**Fact statuses:**'), [...FACT_STATUSES]);
});

test('the section→kind table holds exactly SECTION_KINDS', () => {
  const rows = tableRows(sectionOf(CONTRACT, '## Facts and claims'));
  const parsed = rows.map(([section, kinds]) => [
    section.replace(/`/g, ''),
    [...kinds.matchAll(/`([^`]+)`/g)].map((match) => match[1]),
  ]);
  assert.deepStrictEqual(parsed.map(([section]) => section), [...CLAIM_SECTIONS]);
  for (const [section, kinds] of parsed) {
    assert.deepStrictEqual(kinds, [...SECTION_KINDS[section]], `${section} kinds`);
  }
});

const FACTS_FACTS = [
  ['the schema version', new RegExp(`\`schemaVersion: ${SCHEMA_VERSION}\``)],
  ['the fact id form', /`\{kind\}:\{key\}`[^.]*`encodeFactKey`/],
  ['the claim shape', /`\{ section, text, refs\[\] \}`/],
  ['the narrative envelope', /`\{ "schemaVersion": 1, "claims": \[/],
  ['extension only by adding rows', /Later records extend the schema only by adding rows to the table/],
  ['risk proofs needs a flag and a proof', /at least one `flag` and at least one proof fact/],
];
for (const [label, pattern] of FACTS_FACTS) {
  test(`Facts and claims states: ${label}`, () => assert.match(inSection('## Facts and claims'), pattern));
}

// ---- ## Validation policy ----

test('the verification words are the constant (Decision Q9)', () => {
  const body = sectionOf(CONTRACT, '## Validation policy');
  assert.deepStrictEqual(listAfter(body, '**Verification words:**'), [...VERIFICATION_WORDS]);
});

test('the dropped line is the wording the renderer prints', () => {
  const claim = { section: 'what-changed', text: 'x', refs: [] };
  const body = inSection('## Validation policy');
  const one = renderPacket(facts([]), narrative([claim])).markdown;
  const two = renderPacket(facts([]), narrative([claim, claim])).markdown;
  assert.ok(one.includes('1 claim was dropped for missing evidence'), 'singular line rendered');
  assert.ok(two.includes('2 claims were dropped for missing evidence'), 'plural line rendered');
  assert.ok(body.includes('`1 claim was dropped for missing evidence`'), 'singular line stated');
  assert.ok(body.includes('`N claims were dropped for missing evidence`'), 'plural line stated');
});

test('every drop reason the validator emits is stated', () => {
  const cases = [
    ['unknown section', { section: 'nowhere', text: 'x', refs: ['change:a'] }],
    ['no refs', { section: 'what-changed', text: 'x', refs: [] }],
    ['absent fact', { section: 'what-changed', text: 'x', refs: ['change:gone'] }],
    ['incompatible fact', { section: 'what-changed', text: 'x', refs: ['flag:r'] }],
    ['risk proof cites no flag', { section: 'risk-proofs', text: 'x', refs: ['check:c'] }],
    ['risk proof cites no proof fact', { section: 'risk-proofs', text: 'x', refs: ['flag:r'] }],
    ['tried-to-break claim cites no negative or failed fact', { section: 'tried-to-break', text: 'x', refs: ['check:c'] }],
  ];
  const known = facts([fact('change:a', 'change'), fact('flag:r', 'flag'), fact('check:c', 'check')]);
  const body = inSection('## Validation policy');
  for (const [reason, claim] of cases) {
    const { dropped } = validatePacket(known, narrative([claim]));
    assert.strictEqual(dropped.length, 1, `${reason}: the claim drops`);
    assert.ok(dropped[0].reason.startsWith(reason), `the validator emits ${reason}, got ${dropped[0].reason}`);
    assert.ok(body.includes(`\`${reason}\``), `the policy must state ${reason}`);
  }
});

const VALIDATION_FACTS = [
  ['a drop is visible', /A dropped claim is never silent/],
  ['verification claims route by status', /only for a claim asserting verification/],
  ['a plain step stays (Decision Q9)', /plain manual step stays in the Test guide whatever its cited story's status/],
  ['failed cited fact moves to Tried to break', /a failed cited `check` or `story` moves it to Tried to break/],
  ['skipped cited fact moves to Couldn\'t test', /a skipped or not-run one, with none failed, moves it to Couldn't test/],
  ['Tried to break evidence', /A Tried to break claim must cite a failed fact or a negative story that ran and passed/],
  ['skipped negatives move (Decision Q12)', /citing only skipped or not-run negative stories moves to Couldn't test whatever its wording/],
  ['the exemption is Test-guide only', /plain-wording exemption covers Test-guide manual steps only/],
  ['a risk proof routes whatever its wording', /A risk proof citing a failed or skipped `check` or `story` proof routes to Tried to break or Couldn't test whatever its wording/],
  ['the dropped list is in the working copy', /The dropped list lives in the working copy/],
  ['the screen runs ahead of the evidence rules', /goes to `screened` ahead of every evidence rule below, whatever its section/],
];
for (const [label, pattern] of VALIDATION_FACTS) {
  test(`Validation policy states: ${label}`, () => assert.match(inSection('## Validation policy'), pattern));
}

// ---- ## The expected check set ----

const EXPECTED_SECTION_FACTS = [
  ['verify-scope and readDeclaration (Decision Q6)', /verify-scope declaration[^.]*`decl\.suites` plus `types`\/`lint` when declared, read through `readDeclaration`/],
  ['no expectations field (Decision Q6)', /No field is added to `verify-expectations\.json`, and wrap-up passes no list/],
  ['a missing declaration has no note (Decision Q11)', /A missing declaration is a normal project shape: no expected verify checks and no partial note/],
  ['an unreadable declaration has the note (Decision Q11)', /A present but unreadable or invalid one is a partial gather with the note/],
  ['selected stories come from report.json and the stamp (Decision Q13)', /the QA `report\.json`'s `stories\[\]` plus, when the QA pass stamp's `sha` is the current commit, the stamp's stories as passed/],
  ['an unselected story is not listed (Decision Q13)', /A story `\/test` did not select is not listed/],
  ['story files supply only the negative flag (Decision Q13)', /story files' `stories\[\]\.id`\/`tags` supply only the negative flag/],
  ['the no-report note is conditional (Decision Q13)', /only when `decisions\.md` logged a selection or a report was unreadable, never for a zero-match skip, `skip-qa` or a project with no stories/],
  ['an expected item with no result is not run', /renders as `not run`/],
  ['acceptance criteria forms', /numbered \(`1\.`\), `1\)`, bold-number \(`\*\*1\.\*\*`\), bulleted and checkbox forms, with positional ids `AC1`, `AC2`/],
];
for (const [label, pattern] of EXPECTED_SECTION_FACTS) {
  test(`The expected check set states: ${label}`, () => assert.match(inSection('## The expected check set'), pattern));
}

test('the acceptance-criteria forms stated are the forms the parser reads', () => {
  const spec = [
    '## Acceptance Criteria', '1. numbered', '2) paren', '**3.** bold', '- bullet', '- [ ]', '- [ ] box', '- [x] done',
  ].join('\n');
  assert.deepStrictEqual(parseAcceptanceCriteria(spec).map(({ id }) => id), ['1', '2', '3', 'AC1', 'AC2', 'AC3']);
  assert.match(inSection('## The expected check set'), /A checkbox with no text is no criterion and takes no id/);
});

test('each adjudicated reason the gather states is in the contract', () => {
  const checks = { tests: { command: 'x', exitCode: 1, summary: '1 failing' } };
  const reasonOf = (report) => gatherPacketFacts({ record: 1, specText: null, changes: null, report: { checks, ...report } }).facts.find(({ id }) => id === 'check:tests');
  const body = inSection('## The expected check set');
  assert.match(body, /With `effectivePass: true` in the `report\.json`, a check that exited non-zero is `passed` and states why/);
  const baseline = reasonOf({ effectivePass: true, baselineAdjudicated: { verdict: 'pass', baseRef: '{baseRef}' } });
  const preExisting = reasonOf({ effectivePass: true, preExistingAdjudicated: {} });
  const other = reasonOf({ effectivePass: true });
  for (const entry of [baseline, preExisting, other]) {
    assert.strictEqual(entry.status, 'passed');
    assert.ok(body.includes(`\`${entry.reason}\``), `the contract must state: ${entry.reason}`);
  }
  assert.strictEqual(reasonOf({ effectivePass: false }).status, 'failed');
});

test('every partial note the gather can state is in the contract', () => {
  const blank = {
    record: 1,
    specText: null,
    report: null,
    expectedChecks: null,
    changes: null,
    commits: null,
    decisionsText: null,
    storyResults: null,
    stampStories: null,
    qaReportUnread: true,
  };
  const worst = gatherPacketFacts(blank).partial;
  const empties = gatherPacketFacts({ ...blank, specText: '', changes: [], commits: [], report: { checks: {} }, expectedChecks: [] }).partial;
  const emitted = [...worst, ...empties];
  assert.ok(new Set(emitted).size >= 7, `the gather emitted its notes, got ${emitted.length}`);
  const body = inSection('## The expected check set');
  for (const note of emitted) {
    assert.ok(body.includes(`\`${note}\``), `the contract must state: ${note}`);
  }
});

test('the not-run reason an unresulted check carries is stated', () => {
  const { facts: gathered } = gatherPacketFacts({
    record: 1, specText: '## Acceptance Criteria\n1. a', report: null, expectedChecks: ['tests'], changes: null,
  });
  const body = inSection('## The expected check set');
  for (const id of ['check:tests', 'check:ac-1']) {
    const entry = gathered.find((candidate) => candidate.id === id);
    assert.strictEqual(entry.status, 'not-run');
    assert.ok(body.includes(`\`${entry.reason}\``), `the contract must state: ${entry.reason}`);
  }
});

// ---- ## Pipeline ----

test('the subcommands are the ones the CLI prints', () => {
  let usage = '';
  assert.strictEqual(run(['--help'], { stdout: (text) => { usage += text; } }), 0);
  const fromUsage = [...usage.matchAll(/acceptance-packet\.js (\w+) --/g)].map((match) => match[1]);
  assert.ok(fromUsage.length >= 5, 'the usage text parsed');
  assert.deepStrictEqual(listAfter(sectionOf(CONTRACT, '## Pipeline'), '**Subcommands:**'), fromUsage);
});

test('the exit codes the Pipeline states are the ones the CLI returns', () => {
  const quiet = { stdout() {}, stderr() {} };
  const post = ['post', '--record', '1', '--body-file', 'body'];
  const marked = { ...quiet, readFile: () => `${PACKET_MARKER}\n` };
  const refuse = () => { throw new Error('offline'); };
  assert.strictEqual(run(post, { ...marked, ghAvailable: () => false }), 4, 'gh absent');
  assert.strictEqual(run(['post', '--record', '1'], quiet), 2, 'malformed');
  assert.strictEqual(run(post, { ...quiet, readFile: () => 'no marker\n', ghAvailable: () => true }), 2, 'no marker');
  assert.strictEqual(run(post, { ...marked, ghAvailable: () => true, gh: refuse }), 1, 'failure');

  const wrote = [];
  const inputs = {
    facts: JSON.stringify(facts([], { partial: ['x'.repeat(MAX_PACKET_CHARS + 1)] })),
    narrative: JSON.stringify(narrative([])),
  };
  const code = run(['render', '--facts', 'facts', '--narrative', 'narrative', '--out', 'out'], {
    ...quiet, readFile: (file) => inputs[file], writeFile: (file) => wrote.push(file), removeFile() {},
  });
  assert.strictEqual(code, 1, 'over the cap after truncation');
  assert.deepStrictEqual(wrote, [], 'an over-cap render writes nothing');

  const body = inSection('## Pipeline');
  assert.match(body, /`post` exits 4 when gh is absent, the MCP path/);
  assert.match(body, /`post` exits 2 on a malformed invocation/);
  assert.match(body, /`post` exits 1 on a failure/);
  assert.match(body, /`render` exits 1 and nothing is posted when `chars` still exceeds the cap after truncation/);
  assert.match(body, /`local` exits 2 on the same marker check, leaving the record unchanged/);
  const local = ['local', '--record-file', 'r', '--body-file', 'body'];
  assert.strictEqual(run(local, { ...quiet, readFile: () => 'no marker\n' }), 2, 'local, no marker');
});

const PIPELINE_FACTS = [
  ['the order', /`snapshot` at wrap-up Phase 1 → `gather` → narrate → validate and `render` → `post`/],
  ['why the snapshot exists', /The snapshot exists because the verify and QA reports are not in the run dir/],
  ['the snapshot is no packet copy', /an input to gather, never a packet copy any reader consults/],
  ['the working copy', /working copy lives in session temp and is never read after the run/],
];
for (const [label, pattern] of PIPELINE_FACTS) {
  test(`Pipeline states: ${label}`, () => assert.match(inSection('## Pipeline'), pattern));
}

// ---- ## Reader rules ----

const READER_FACTS = [
  ['readPacket is the reader', /`readPacket`/],
  ['an unknown version is unreadable', /`unreadable`[^.]*unknown[^.]*schema version/],
  ['never a run-dir copy', /reads only the comments it is given/],
  ['a packet counts as landed below the floor', /a trusted packet comment on the record also counts as a landed signal/],
];
for (const [label, pattern] of READER_FACTS) {
  test(`Reader rules states: ${label}`, () => assert.match(inSection('## Reader rules'), pattern));
}

// ---- ## Untrusted content ----

const UNTRUSTED_FACTS = [
  ['newlines collapse', /newlines collapsed/],
  ['link brackets and < escape', /link brackets and `<` escaped/],
  ['leading # escapes', /leading `#` escaped/],
  ['a URL renders as a code span', /A URL in free text renders as a code span/],
  ['a command renders in a code span', /A `command` renders in a backtick-safe code span/],
  ['links come only from facts', /Links render only from `link` facts and a `recording` fact's `url`/],
  ['the autolink forms', /any `scheme:\/\/` URL, `mailto:`, a bare email, `@mention`, `#12` and `owner\/repo#12`/],
  ['GH-12 is neutralized and a SHA stays live', /`#12` and `owner\/repo#12`, and `GH-12`[^.]*\. A bare commit SHA and `owner\/repo@sha` stay live/],
  ['a leading block marker escapes', /A leading block marker is escaped too, `>`, a list marker, `1\.` or `1\)`/],
  ['a character reference escapes', /a character reference's `&`/],
  ['touching tokens share a span', /tokens that touch sharing one span/],
  ['a recording is a path or a plain link, never an image', /A recording is therefore a path, or on a `linked-private` fact a plain link to a non-image page, and never an embedded image/],
];
for (const [label, pattern] of UNTRUSTED_FACTS) {
  test(`Untrusted content states: ${label}`, () => assert.match(inSection('## Untrusted content'), pattern));
}

test('inline() renders each autolink form the contract names as a code span', () => {
  for (const form of ['ssh://host/path', 'mailto:a@b.co', 'a@b.co', '@octocat', '#12', 'owner/repo#12', 'GH-12']) {
    assert.strictEqual(inline(form), codeSpan(form), form);
  }
  for (const live of ['abc1234def', 'owner/repo@abc1234']) {
    assert.strictEqual(inline(live), live, `${live} stays live`);
  }
});

test('inline() escapes what the contract says it escapes', () => {
  assert.strictEqual(inline('a\nb'), 'a b');
  assert.strictEqual(inline('[x](y) <z'), '\\[x\\](y) \\<z');
  assert.strictEqual(inline('# h'), '\\# h');
  assert.strictEqual(inline('> ## h'), '\\> ## h');
  assert.strictEqual(inline('- ## h'), '\\- ## h');
  assert.strictEqual(inline('1. ## h'), '1\\. ## h');
  assert.strictEqual(inline('1) ## h'), '1\\) ## h');
  assert.strictEqual(inline('&#35;12'), '\\&#35;12');
  assert.strictEqual(inline('&commat;octocat'), '\\&commat;octocat');
  assert.strictEqual(inline('#12@octocat'), codeSpan('#12@octocat'));
});

test('a recording link is a plain link to a non-image page', () => {
  const url = 'https://store.example/rec/1';
  const live = fact('recording:a', 'recording', 'passed', { text: 'a', url, exposure: 'linked-private' });
  const { markdown } = renderPacket(facts([live]), narrative([]));
  assert.ok(markdown.includes(`- a: <${url}>`), markdown);
  assert.ok(!markdown.includes('!['), markdown);
  const image = { ...live, url: 'https://raw.githubusercontent.com/o/r/abc/docs/demo-evidence/1/01-a.png' };
  const refused = renderPacket(facts([image]), narrative([])).markdown;
  assert.ok(refused.includes('- a: (recording url refused)'), refused);
  assert.ok(!refused.includes('!['), refused);
});

// ---- ## Links and credentials ----

test('the credential list is the constant, verbatim, all 14', () => {
  const body = sectionOf(CONTRACT, '## Links and credentials');
  assert.deepStrictEqual(listAfter(body, '**Credential keys:**'), [...CREDENTIAL_KEYS]);
  assert.strictEqual(CREDENTIAL_KEYS.length, 14);
});

test('a link keeps to the host rule, by hostname and ignoring port', () => {
  const allowedHosts = ['http://localhost:3000', 'https://dev.example.com'];
  assert.strictEqual(checkLink('http://localhost:4000/x', { allowedHosts }).ok, true, 'the port is ignored');
  assert.strictEqual(checkLink('https://dev.example.com/x', { allowedHosts }).ok, true, 'the dev host');
  assert.strictEqual(checkLink('https://evil.example/x', { allowedHosts }).ok, false, 'another host');
  assert.strictEqual(checkLink('ftp://localhost/x', { allowedHosts }).ok, false, 'another scheme');
  const body = inSection('## Links and credentials');
  assert.match(body, /http\(s\) only, and its host must be the local base URL host or the `dev-base-url` host/);
  assert.match(body, /Hosts compare by hostname, ignoring port/);
  assert.match(body, /A `recording` link gets the credential screen and the non-image rule with no host rule/);
});

test('each URL shape the contract names is refused', () => {
  const allowedHosts = ['example.com'];
  for (const url of [
    'https://example.com/?TOKEN=a',
    'https://example.com/?tok%65n=a',
    'https://example.com/#sig=a',
    'https://user:pass@example.com/',
    'https://example.com/#/cb?token=a',
    'https://example.com/?next=/cb?token=a',
    'https://example.com/?a=100%&token=a',
    'https://example.com/?sessionid=a',
  ]) {
    assert.strictEqual(checkLink(url, { allowedHosts }).ok, false, url);
  }
  assert.strictEqual(checkLink('https://example.com/docs/token-guide', { allowedHosts }).ok, true);
  const body = inSection('## Links and credentials');
  assert.match(body, /matched in the query, the fragment and the userinfo, case-insensitive after percent-decoding/);
  assert.match(body, /Matching is also case-insensitive after percent-decoding/);
  assert.match(body, /per escape run, tolerating a stray `%`/);
  assert.match(body, /query inside a fragment \(`#\/cb\?token=abc`\) and nested keys in a query \(`\?next=\/cb\?token=abc`\) are screened/);
});

test('each text shape the contract names is screened, and the benign ones are not', () => {
  const body = inSection('## Links and credentials');
  for (const shape of [
    'session_id=', 'apikey=', '--api-key', '--client-secret', 'GITHUB_TOKEN=', '"token":', 'https://user:pass@example.com',
    'Authorization:', 'tok%65n=', '100% tok%65n=',
  ]) {
    assert.ok(findCredentialInText(shape), `${shape} is screened`);
    assert.ok(body.includes(`\`${shape}\``), `the contract must name ${shape}`);
  }
  for (const benign of ['monkey=1', '/docs/token-guide', 'acceptance-packet.js --help']) {
    assert.strictEqual(findCredentialInText(benign), null, `${benign} is not screened`);
    assert.ok(body.includes(`\`${benign}\``), `the contract must name ${benign}`);
  }
});

test('the camelCase, compound and bracket matching the contract states is what the screen does', () => {
  const body = inSection('## Links and credentials');
  assert.match(body, /A key is a whole word or the last word of a compound/);
  assert.match(body, /A key also matches inside brackets, with the brackets skipped/);
  assert.match(body, /A lowercase word that merely contains a key, with no such break,\s+is no match/);
  for (const shape of ['_authToken=', 'curl --authToken abc', 'token[]=', 'token[sub]=', 'user[password]=', 'CLIENTSECRET=', 'v2token=', 'APIToken=']) {
    assert.ok(findCredentialInText(shape), `${shape} is screened`);
    assert.ok(body.includes(`\`${shape.replace(/=$/, '')}`), `the contract must name ${shape}`);
  }
  for (const benign of ['monkey=', 'keyboard=', 'author=', 'tokenizer=']) {
    assert.strictEqual(findCredentialInText(benign), null, `${benign} is not screened`);
    assert.ok(body.includes(`\`${benign}\``), `the contract must name ${benign}`);
  }
  const allowedHosts = ['example.com'];
  for (const url of ['https://example.com/?authToken=a', 'https://example.com/?token[]=a', 'https://example.com/#/cb?authToken=a']) {
    assert.strictEqual(checkLink(url, { allowedHosts }).ok, false, url);
  }
});

test('each screening outcome the contract quotes is what the renderer prints', () => {
  const body = inSection('## Links and credentials');
  const secret = 'hunter2';
  const text = `password=${secret}`;
  const { markdown, screened } = renderPacket(
    facts(
      [
        fact('check:c', 'check', 'failed', { reason: text }),
        fact('decision:d', 'decision', 'passed', { text }),
        fact('change:a', 'change'),
      ],
      { refused: [{ id: 'link:x', reason: text }], partial: [text] },
    ),
    narrative([
      { section: 'what-changed', text, refs: ['change:a'] },
      { section: 'test-guide', text, refs: ['change:a'] },
    ]),
    { observationPlan: `- token=${secret}\n- ok` },
  );
  assert.ok(!markdown.includes(secret), markdown);
  assert.deepStrictEqual(screened, [
    { section: 'what-changed', key: 'password' },
    { section: 'test-guide', key: 'password' },
    { section: 'observation-plan', key: 'token' },
  ]);
  assert.ok(markdown.includes('3 entries omitted for credential-shaped content: What changed (password); Test guide (password); Observation plan (token)'), markdown);
  const single = renderPacket(facts([]), narrative([{ section: 'test-guide', text, refs: [] }])).markdown;
  assert.ok(single.includes('1 entry omitted for credential-shaped content: Test guide (password)'), single);
  for (const quoted of ['(reason withheld: credential-shaped)', '(text withheld: credential-shaped)']) {
    assert.ok(markdown.includes(quoted), `rendered: ${quoted}`);
    assert.ok(body.includes(`\`${quoted}\``), `stated: ${quoted}`);
  }
  assert.ok(body.includes('`{N} entries omitted for credential-shaped content: Test guide (password); Observation plan (token)`'));
  assert.ok(body.includes('`1 entry omitted`'));
});

const LINKS_FACTS = [
  ['every free-text surface is screened', /screens every `command` string, every claim's text in any section, each observation-plan line, and all other free text that renders/],
  ['the omission is by id or key, never text', /its omission is stated by id or key, never its text, and the packet still posts/],
  ['a row stays when its reason is withheld', /its row stays, so the row count holds/],
  ['vault entry name', /only as vault entry names/],
  ['the suffix is dev-only (Decision Q7)', /`\(link unverified: deploy not confirmed live\)`[^.]*only when the deploy target is `dev` and the feature is not confirmed live/],
  ['a local target carries none (Decision Q7)', /a `local` target's links carry none/],
];
for (const [label, pattern] of LINKS_FACTS) {
  test(`Links and credentials states: ${label}`, () => assert.match(inSection('## Links and credentials'), pattern));
}

test('the unverified suffix the contract quotes is the one rendered', () => {
  const link = fact('link:a', 'link', 'passed', { url: 'http://localhost/x' });
  const deploy = (target, live) => fact('deploy:status', 'deploy', 'passed', { target, live });
  const render = (target, live) => renderPacket(
    facts([link, deploy(target, live)], { allowedHosts: ['localhost'] }),
    narrative([{ section: 'test-guide', text: 'open it', refs: ['link:a'] }]),
  ).markdown;
  const suffix = '(link unverified: deploy not confirmed live)';
  assert.ok(render('dev', false).includes(suffix), 'dev, not live');
  assert.ok(!render('dev', true).includes(suffix), 'dev, live');
  assert.ok(!render('local', null).includes(suffix), 'local');
});

// ---- #4612: the Recording contract ----
//
// These pins state new prose, so each is proven red in the suite itself: a control
// strips the one clause from a copy of the text and calls the same assertion, matched
// on that assertion's own message (skill-prose-conformance-tests).

function assertStates(body, pattern, label) {
  assert.ok(pattern.test(body), label);
}

function assertNamesOnce(body, literal) {
  const label = `\`${literal}\` is stated once in ## Recording`;
  assert.ok(body.split(`\`${literal}\``).length - 1 === 1, label);
}

function recordingClauseTest(heading, label, pattern) {
  test(`${heading} states: ${label}`, () => {
    const body = inSection(heading);
    assertStates(body, pattern, label);
    const mutated = body.replace(pattern, '');
    assert.notStrictEqual(mutated, body);
    assert.throws(() => assertStates(mutated, pattern, label), { message: label });
  });
}

const RECORDING_VOCABULARY = [
  'renderRecordingSection',
  'no-story',
  'no-local-base-url',
  'no-happy-path-screenshots',
  'encoder-failed',
  ...EXPOSURES,
  'recording withheld: link contained a credential-shaped value',
];

test('the exposure values are the three the code decides between', () => {
  assert.deepStrictEqual([...EXPOSURES], ['local-only', 'linked-private', 'withheld']);
});

test('the not-recorded reasons the contract names are the ones validation accepts', () => {
  assert.deepStrictEqual(
    [...RECORDING_NOT_RUN_REASONS],
    ['no-story', 'no-local-base-url', 'no-happy-path-screenshots', 'encoder-failed'],
  );
  for (const reason of RECORDING_NOT_RUN_REASONS) assert.ok(RECORDING_VOCABULARY.includes(reason), reason);
});

for (const literal of RECORDING_VOCABULARY) {
  test(`## Recording names ${literal}`, () => {
    const body = sectionOf(CONTRACT, '## Recording');
    assertNamesOnce(body, literal);
    const mutated = body.replace(`\`${literal}\``, '`gone`');
    assert.notStrictEqual(mutated, body);
    assert.throws(() => assertNamesOnce(mutated, literal), { message: `\`${literal}\` is stated once in ## Recording` });
  });
}

for (const [heading, label, pattern] of [
  ['## Sections', 'Recording renders through renderRecordingSection', /owner: the recording record\. One item per `recording` fact, through `renderRecordingSection`/],
  ['## Sections', 'an impossible recording also takes a row', /A `recording` fact with status `not-run` and any reason but `no-story` also renders one row in Couldn't test/],
  ['## Facts and claims', 'the recording render fields', /`url_or_path`, `archive_path`, `captions`, `failure`, `redactions` and `exposure`/],
  ['## Pipeline', 'snapshot also encodes the recording', /`snapshot` also encodes the recording/],
  ['## Reader rules', 'a Recording path is local', /A Recording path is local to the machine that ran the pipeline/],
  ['## Reader rules', 'the reader checks the live location, then the archived one', /the reader checks the live location first and then the `once archived:` one/],
  ['## Reader rules', 'a gone file is no failed packet', /a file in neither is gone, never a failed packet/],
  ['## Reader rules', 'the paths are relative to the main checkout', /Both paths are relative to the main checkout root/],
  ['## Links and credentials', 'a recording link renders live only when linked-private', /renders live only when `decideExposure` returned `linked-private`/],
  ['## Links and credentials', 'a credential recording link states why', /A refused one renders `\(recording url refused\)`, and one refused for a credential, a bearer-shaped path segment included, renders `recording withheld: link contained a credential-shaped value`/],
  ['## Links and credentials', 'the Recording section redacts instead', /The Recording section redacts its text instead \(`## Recording`\)/],
  ['## Links and credentials', 'the bearer rule binds link facts too', /The bearer-segment rule binds `link` facts as well as recording links/],
  ['## Links and credentials', 'a UUID or dated slug is refused', /A UUID-keyed or dated-slug path on an allowed host therefore renders `\(link refused: credential in path segment\)`/],
  ['## Links and credentials', 'the Try it block still names the route', /the Try it block still names the route/],
  ['## Links and credentials', 'a command or a plan line meets the bearer rule on its URLs', /A `command` or observation-plan line holding a URL with such a segment is refused or screened too, so a route carrying one reaches the Test guide as a command with that segment replaced by `\{id\}`/],
  ['## Links and credentials', 'a gather refusal states the same reason',/A link the gather refused has no fact, so its refusal reads `\{N\} link\(s\) refused: \{id\} \(credential in path segment\)`/],
  ['## Recording', 'the source of frames', /built from the step screenshots the pipeline's own happy-path stories already wrote[^.]*\. No new browser run/],
  ['## Recording', 'negative stories never enter it', /Negative stories are excluded/],
  ['## Recording', 'an unindexed story records nothing', /A story id missing from a readable index, a `legacy-\{slug\}` id included, records nothing with no-happy-path-screenshots, since it could be a tag-only negative story/],
  ['## Recording', 'the local base URL', /the base URL the story run itself was given, whose host is `localhost`, `127\.0\.0\.1` or `::1`/],
  ['## Recording', 'never uploaded', /stored in the run's local directory and never uploaded, in any repository visibility/],
  ['## Recording', 'never embedded', /never embeds the recording or any screenshot/],
  ['## Recording', 'one choke point', /applied at one choke point/],
  ['## Recording', 'a fact holds the redacted form', /Gather writes the same redacted form into the fact and the sum into `redactions`, so a narrator never reads a raw value/],
  ['## Recording', 'snapshot prints the redacted form', /`snapshot`'s stdout prints that form while the manifest on disk stays raw/],
  ['## Recording', 'key names stay, the whole value goes', /keeps the key name and replaces the whole value/],
  ['## Recording', 'the placeholder escape', /renders `\[redacted\]`, the raw comment holds the fixed token, and its escaped opener means a line can never become a link reference definition/],
  ['## Recording', 'what the redactor misses is withheld', /a shape the redactor misses renders `\(text withheld: credential-shaped\)`/],
  ['## Recording', 'the count is reported only', /A non-zero count renders as `redacted values: \{n\}` and does not change the exposure/],
  ['## Recording', 'pixels are not scanned', /cannot scan pixels/],
  ['## Recording', 'the stored GIF is unredacted', /the stored GIF is unredacted and local-only/],
  ['## Recording', 'seed data only', /stories must run against seed data and throwaway credentials/],
  ['## Recording', 'no-story is plain', /The first renders plain `not recorded` only/],
  ['## Recording', 'the other three are also under Couldn\'t test', /other three also appear under Couldn't test/],
  ['## Recording', 'an unignored destination writes no GIF', /The last also covers a destination git does not ignore: no GIF is written and the failure names the path, while a directory in no git repository proceeds, since nothing can commit it/],
  ['## Recording', 'an image link is refused', /a link to an image is refused/],
  ['## Recording', 'a remote path meets the link rules', /A `url_or_path` or `archive_path` that reads as a URL meets those link rules whatever its exposure, parsed or not: a scheme longer than one letter, any scheme before `\/\/`, or a leading `\/\/`, spelled as `new URL` would read it\. A Windows `C:\\` or `C:\/` path and a relative run path stay local/],
  ['## Recording', 'a local path holding a secret shape is withheld', /A local path the credential screen or the redactor would change renders the withheld line/],
  ['## Recording', 'the bearer rule stays off a local path', /the bearer-segment rule does not bind a plain local path, so a run id or a dated slug stays/],
  ['## Recording', 'an id is screened', /A fact id the redactor would change renders `\(id withheld: credential-shaped\)` in the section and in its Couldn't test row/],
  ['## Recording', 'an unknown reason fails validation', /`checkFact` refuses a `not-run` recording with any other reason/],
  ['## Recording', 'blank values render nothing', /A blank value renders nothing, and a blank `label` falls to `text`/],
  ['## Untrusted content', 'an archive path can be a link', /or its `url_or_path` or `archive_path` on a `linked-private` fact/],
]) {
  recordingClauseTest(heading, label, pattern);
}

test('the recording lines the contract quotes are the ones rendered', () => {
  const body = inSection('## Links and credentials');
  const base = { text: 'Rec', exposure: 'linked-private' };
  const lineFor = (url) => renderRecordingSection([fact('recording:a', 'recording', 'passed', { ...base, url })])[0].text;
  const withheld = lineFor('https://store.example/?token=a').replace('- Rec: ', '');
  const refused = lineFor('https://store.example/r.png').replace('- Rec: ', '');
  assert.ok(body.includes(`\`${withheld}\``), withheld);
  assert.ok(body.includes(`\`${refused}\``), refused);
});

test('a UUID-keyed or dated-slug link on an allowed host is refused at render and at gather', () => {
  const allowedHosts = ['http://localhost:3000'];
  for (const segment of ['123e4567-e89b-12d3-a456-426614174000', '2026-11-02-acceptance-recording']) {
    const url = `http://localhost:3000/orders/${segment}`;
    const { markdown } = renderPacket(
      facts([fact('link:a', 'link', 'passed', { url })], { allowedHosts }),
      narrative([{ section: 'test-guide', text: 'Open it', refs: ['link:a'] }]),
    );
    assert.ok(markdown.includes('(link refused: credential in path segment)'), markdown);
    assert.ok(!markdown.includes(segment), markdown);

    const { refused } = gatherPacketFacts({
      record: 1, specText: null, changes: null, links: [{ id: 'a', url }], localBaseUrl: 'http://localhost:3000',
    });
    assert.deepStrictEqual(refused, [{ id: 'link:a', reason: 'credential in path segment' }]);
    const line = renderPacket(facts([], { refused }), narrative([])).markdown;
    assert.ok(line.includes('1 link(s) refused: link:a (credential in path segment)'), line);
  }
});

// ---- ## Facts-poor and infra items ----

test('the commands-only surfaces are the constant, with no links rendered', () => {
  const body = sectionOf(CONTRACT, '## Facts-poor and infra items');
  assert.deepStrictEqual(listAfter(body, '**Commands-only surfaces:**'), [...COMMANDS_ONLY_SURFACES]);
  assert.match(collapse(body), /Test guide lists commands and renders no links/);
  for (const surface of COMMANDS_ONLY_SURFACES) {
    const url = 'http://localhost:3000/settings';
    const { markdown } = renderPacket(
      facts(
        [fact('link:web', 'link', 'passed', { url }), fact('link:cli', 'link', 'passed', { command: 'npm run demo' })],
        { surface, allowedHosts: ['http://localhost:3000'] },
      ),
      narrative([{ section: 'test-guide', text: 'Open it', refs: ['link:web', 'link:cli'] }]),
    );
    assert.ok(!markdown.includes(url), `${surface} renders no link`);
    assert.ok(markdown.includes('`npm run demo`'), `${surface} lists the command`);
  }
});

test('the refusal a url link gets on a commands-only surface is stated', () => {
  const { refused } = gatherPacketFacts({
    record: 1, specText: null, changes: null, surface: 'infra', links: [{ id: 'a', url: 'http://localhost/x' }], localBaseUrl: 'localhost',
  });
  assert.strictEqual(refused.length, 1);
  assert.ok(inSection('## Facts-poor and infra items').includes(`\`${refused[0].reason}\``), refused[0].reason);
});

// ---- ## Size ----

test('the cap and the truncated line are what the renderer does', () => {
  const rows = Array.from({ length: 4000 }, (_, index) => fact(`check:suite-with-a-long-name-${index}`, 'check'));
  const { markdown, truncated, chars } = renderPacket(facts(rows), narrative([]));
  assert.ok(truncated > 0, 'the fixture is large enough to truncate');
  assert.ok(chars <= MAX_PACKET_CHARS, 'truncation brings it under the cap');
  assert.ok(markdown.includes(`truncated: ${truncated} items omitted`), 'the line is rendered');
  assert.strictEqual(MAX_PACKET_CHARS, 60000);
  const body = inSection('## Size');
  assert.match(body, /60,000/);
  assert.ok(body.includes('`truncated: N items omitted`'), 'the line is stated');
  assert.match(body, /When the notes alone exceed the cap no drop can meet it, so every item stays/);
  const over = renderPacket(facts(rows.slice(0, 5), { partial: ['x'.repeat(MAX_PACKET_CHARS + 1)] }), narrative([]));
  assert.strictEqual(over.truncated, 0);
  assert.ok(over.markdown.includes('`check:suite-with-a-long-name-4`'), 'the row stayed');
});

// ---- ## Old brief section map ----

test('the old brief section map has its rows', () => {
  const rows = tableRows(sectionOf(CONTRACT, '## Old brief section map'));
  assert.deepStrictEqual(rows.map(([old]) => old), ['The ask', 'What shipped', 'Confirmed', 'Observation plan', 'The Try it block']);
  const target = new Map(rows);
  assert.match(target.get('The ask'), /What changed/);
  assert.match(target.get('What shipped'), /What changed/);
  assert.match(target.get('Confirmed'), /Test guide and Tried to break/);
  assert.match(target.get('Observation plan'), /Test guide \(rendered as the `### Observation plan` appendix `\/claude-tweaks:demo` walks\)/);
  assert.match(target.get('The Try it block'), /Test guide/);
});

// ---- ## Failure contract ----

test('the pending labels the Failure contract names are the vocabulary', () => {
  const body = inSection('## Failure contract');
  for (const label of [LABELS.DEMO_PENDING, LABELS.ACCEPT_PENDING]) {
    assert.ok(body.includes(`\`${label}\``), `${label} must be named`);
  }
});

const FAILURE_FACTS = [
  ['the label is not added and is removed', /the pending label is not added and any existing one, in either spelling, is removed/],
  ['the read-first rule', /Labels are read first and only labels present are removed, so an absent label never fails the step/],
  ['the report names the stale packet', /The failure report names the stale packet/],
  ['the MCP re-run (Decision Q4)', /On the MCP transport a re-run that finds an existing packet is one such failed edit: no pending acceptance label is applied/],
  ['reads make no writes', /A failed comment read or an unreadable existing packet makes no write calls/],
];
for (const [label, pattern] of FAILURE_FACTS) {
  test(`Failure contract states: ${label}`, () => assert.match(inSection('## Failure contract'), pattern));
}

// ---- pr-run-comments.md ----

test('pr-run-comments.md registers the marker in its Work-record markers section', () => {
  const body = sectionOf(COMMENTS, '## Work-record markers');
  const rows = tableRows(body);
  assert.strictEqual(rows.length, 1, 'one row');
  const [kind, poster, marker] = rows[0];
  assert.strictEqual(kind, '`acceptance-packet`');
  assert.strictEqual(poster, '`/claude-tweaks:wrap-up` (`verification-brief.md` Step 4)');
  assert.ok(marker.includes(`\`${PACKET_MARKER}\` on the **work record**, not the PR`), marker);
  assert.ok(marker.includes('`_shared/acceptance-packet.md`'), marker);
});

test('Work-record markers follows the Comment kinds table', () => {
  const headings = COMMENTS.split('\n').filter((line) => line.startsWith('## '));
  assert.strictEqual(headings[headings.indexOf('## Comment kinds') + 1], '## Work-record markers');
});

const tableRow = (lead) => {
  const rows = COMMENTS.split('\n').filter((line) => line.startsWith(lead));
  assert.strictEqual(rows.length, 1, `exactly one row opens with ${lead}`);
  return rows[0];
};

test('the brief rows say new runs post the packet and the kind is read for legacy runs only', () => {
  for (const row of [tableRow('| `brief` |'), tableRow('| `/claude-tweaks:wrap-up` (`verification-brief.md` Step 4) | `brief`')]) {
    assert.match(row, /new runs post the acceptance packet on the record instead/i, row);
    assert.match(row, /read for legacy runs only/, row);
  }
});

test('the brief marker strings stay registered', () => {
  const row = tableRow('| `brief` |');
  assert.ok(row.includes('`<!-- run-comment: brief -->`'));
  assert.ok(row.includes('`<!-- run-comment: brief:{spec} -->`'));
});

test('try-it is for a parent-linked sub-issue only (Decision Q5)', () => {
  const kind = tableRow('| `try-it` |');
  const consumer = tableRow("| `/claude-tweaks:wrap-up` (`verification-brief.md`'s Try it block) | `try-it`");
  for (const row of [kind, consumer]) {
    assert.match(row, /parent-linked sub-issue/, row);
    assert.doesNotMatch(row, /below-floor/, row);
    assert.doesNotMatch(row, /no brief on the PR/, row);
  }
});

test('Step 4 composes only the timing markers; the brief markers describe legacy runs', () => {
  const body = collapse(sectionOf(COMMENTS, '## Multi-spec brief and timing comments (#2970)'));
  assert.ok(!body.includes('Step 4 composes these markers'), 'the retired sentence is gone');
  assert.match(body, /Step 4 composes the `timing` marker/);
  assert.match(body, /New runs post no `brief` comment/);
});

test('the timing rows no longer place timing after a brief', () => {
  assert.doesNotMatch(tableRow('| `timing` |'), /Verification Brief/);
  assert.doesNotMatch(tableRow('| `/claude-tweaks:wrap-up` (`verification-brief.md` Step 4, after'), /after the brief|as the brief/);
});
