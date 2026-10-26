'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..', '..');
const {
  DESTINATION_VERBS, RECORD_PROPOSAL_HEADING, APPLICABLE_CATEGORIES, REFLECT_NO_DESTINATION,
  parseCategory, isApplicableReflect, parseReflectDestination, deferReasonProblem, findingDescription,
} = require(path.join(ROOT, 'plugin', 'bin', 'lib', 'console', 'reflect-destination'));
const { readText } = require('../../helpers/read-skill');

const LEGACY = readText(path.join(__dirname, 'fixtures', 'staged', 'reflect-ledger-3876.md'));

function file({ category = 'observation', destination, extra = '' } = {}) {
  const dest = destination === undefined ? '' : `**Destination:** ${destination}\n`;
  return `# Reflect — staged finding 1\n\n**Category:** ${category}\n${dest}\n## Finding\n\nA finding.\n${extra}`;
}

const PROPOSAL = '\n## Record proposal\n\nTitle: Fix the X\nType: task\nLabels: risk:low, auto:build\nDefer-reason: genuinely-larger\n\n## Current State\n\nx\n';

test('exports the frozen constants', () => {
  assert.deepStrictEqual([...DESTINATION_VERBS], ['edit', 'record', 'decline']);
  assert.ok(Object.isFrozen(DESTINATION_VERBS));
  assert.strictEqual(RECORD_PROPOSAL_HEADING, '## Record proposal');
  assert.deepStrictEqual([...APPLICABLE_CATEGORIES], ['observation', 'convention']);
  assert.ok(Object.isFrozen(APPLICABLE_CATEGORIES));
  assert.strictEqual(REFLECT_NO_DESTINATION, 'reflect-no-destination');
});

test('parseCategory: first token after the Category line, null when absent or no text', () => {
  assert.strictEqual(parseCategory(LEGACY), 'convention');
  assert.strictEqual(parseCategory('no category here'), null);
  assert.strictEqual(parseCategory(''), null);
  assert.strictEqual(parseCategory(undefined), null);
});

test('none: the legacy fixture has no destination line and is an applicable reflect file', () => {
  assert.deepStrictEqual(parseReflectDestination(LEGACY), { kind: 'none' });
  assert.strictEqual(isApplicableReflect('reflect-1.md', LEGACY), true);
});

test('edit: a valid target parses', () => {
  assert.deepStrictEqual(
    parseReflectDestination(file({ destination: 'edit plugin/skills/review/SKILL.md' })),
    { kind: 'edit', target: 'plugin/skills/review/SKILL.md' },
  );
  assert.deepStrictEqual(parseReflectDestination(file({ destination: 'edit CLAUDE.md' })), { kind: 'edit', target: 'CLAUDE.md' });
  assert.deepStrictEqual(
    parseReflectDestination(file({ destination: 'edit .claude/rules/x.md' })),
    { kind: 'edit', target: '.claude/rules/x.md' },
  );
});

test('edit: an unsafe or out-of-scope target is invalid edit-target', () => {
  for (const target of ['../CLAUDE.md', '/abs/skills/a.md', 'C:/skills/a.md', 'skills\\a.md', 'plugin/skills/a.js', 'docs/a.md',
    '.git/skills/a.md', 'node_modules/x/skills/a.md', './CLAUDE.md', 'plugin//skills/a.md', 'plugin/./skills/a.md']) {
    assert.deepStrictEqual(
      parseReflectDestination(file({ destination: `edit ${target}` })),
      { kind: 'invalid', why: 'edit-target' },
      target,
    );
  }
});

test('edit: a bare verb, or a target with extra tokens, falls outside the grammar (unknown-destination)', () => {
  assert.deepStrictEqual(parseReflectDestination(file({ destination: 'edit' })), { kind: 'invalid', why: 'unknown-destination' });
  assert.deepStrictEqual(
    parseReflectDestination(file({ destination: 'edit CLAUDE.md and more' })),
    { kind: 'invalid', why: 'unknown-destination' },
  );
});

test('edit: a .. segment anywhere is rejected, a name merely containing dots is not', () => {
  assert.deepStrictEqual(
    parseReflectDestination(file({ destination: 'edit plugin/../skills/a.md' })),
    { kind: 'invalid', why: 'edit-target' },
  );
  assert.deepStrictEqual(
    parseReflectDestination(file({ destination: 'edit plugin/skills/a..b.md' })),
    { kind: 'edit', target: 'plugin/skills/a..b.md' },
  );
});

test('record: a full proposal parses to title, type, raw labels, defer-reason and body', () => {
  const parsed = parseReflectDestination(file({ destination: 'record', extra: PROPOSAL }));
  assert.strictEqual(parsed.kind, 'record');
  assert.deepStrictEqual(parsed.proposal, {
    title: 'Fix the X',
    type: 'task',
    labels: ['risk:low', 'auto:build'],
    deferReason: 'genuinely-larger',
    body: '## Current State\n\nx\n',
  });
});

test('record: missing heading, empty Title, bad Type, empty body are each invalid record-proposal', () => {
  const bad = {
    'missing heading': '',
    'empty title': PROPOSAL.replace('Title: Fix the X', 'Title:'),
    'missing title': PROPOSAL.replace('Title: Fix the X\n', ''),
    'bad type': PROPOSAL.replace('Type: task', 'Type: chore'),
    'missing type': PROPOSAL.replace('Type: task\n', ''),
    'empty body': '\n## Record proposal\n\nTitle: Fix the X\nType: task\nLabels: none\n\n   \n',
    'no body at all': '\n## Record proposal\n\nTitle: Fix the X\nType: task\n',
  };
  for (const [name, extra] of Object.entries(bad)) {
    assert.deepStrictEqual(
      parseReflectDestination(file({ destination: 'record', extra })),
      { kind: 'invalid', why: 'record-proposal' },
      name,
    );
  }
});

test('record: Labels absent or none gives []; empties are dropped', () => {
  const noLabels = PROPOSAL.replace('Labels: risk:low, auto:build\n', '');
  assert.deepStrictEqual(parseReflectDestination(file({ destination: 'record', extra: noLabels })).proposal.labels, []);
  const none = PROPOSAL.replace('risk:low, auto:build', 'none');
  assert.deepStrictEqual(parseReflectDestination(file({ destination: 'record', extra: none })).proposal.labels, []);
  const gappy = PROPOSAL.replace('risk:low, auto:build', 'a, , b,');
  assert.deepStrictEqual(parseReflectDestination(file({ destination: 'record', extra: gappy })).proposal.labels, ['a', 'b']);
});

test('record: a bad or absent Defer-reason parses; deferReasonProblem reports it', () => {
  const bogus = parseReflectDestination(file({ destination: 'record', extra: PROPOSAL.replace('genuinely-larger', 'bogus') }));
  assert.strictEqual(bogus.kind, 'record');
  assert.strictEqual(bogus.proposal.deferReason, 'bogus');
  assert.strictEqual(deferReasonProblem(bogus.proposal), 'bogus');

  const absent = parseReflectDestination(file({ destination: 'record', extra: PROPOSAL.replace('Defer-reason: genuinely-larger\n', '') }));
  assert.strictEqual(absent.kind, 'record');
  assert.strictEqual(absent.proposal.deferReason, null);
  assert.strictEqual(deferReasonProblem(absent.proposal), 'absent');

  const ok = parseReflectDestination(file({ destination: 'record', extra: PROPOSAL }));
  assert.strictEqual(deferReasonProblem(ok.proposal), null);
});

test('record: a body that itself contains key-like lines and blank lines is kept whole', () => {
  const extra = '\n## Record proposal\n\nTitle: T\nType: bug\n\nTitle: not a header\n\n## Deliverables\n\n- one\n';
  const parsed = parseReflectDestination(file({ destination: 'record', extra }));
  assert.strictEqual(parsed.proposal.title, 'T');
  assert.strictEqual(parsed.proposal.body, 'Title: not a header\n\n## Deliverables\n\n- one\n');
});

test('decline: the reason is the rest of the line; a bare decline is invalid decline-reason', () => {
  assert.deepStrictEqual(
    parseReflectDestination(file({ destination: 'decline already documented in CLAUDE.md' })),
    { kind: 'decline', reason: 'already documented in CLAUDE.md' },
  );
  assert.deepStrictEqual(parseReflectDestination(file({ destination: 'decline' })), { kind: 'invalid', why: 'decline-reason' });
});

test('two destination lines are invalid multiple-destination-lines', () => {
  const text = file({ destination: 'decline a' }).replace('\n## Finding', '**Destination:** decline b\n\n## Finding');
  assert.deepStrictEqual(parseReflectDestination(text), { kind: 'invalid', why: 'multiple-destination-lines' });
});

test('an unrecognised verb is invalid unknown-destination', () => {
  assert.deepStrictEqual(parseReflectDestination(file({ destination: 'later' })), { kind: 'invalid', why: 'unknown-destination' });
  assert.deepStrictEqual(parseReflectDestination(file({ destination: '' })), { kind: 'invalid', why: 'unknown-destination' });
});

test('record: trailing spaces on the verb line are tolerated', () => {
  const text = file({ destination: 'record   ', extra: PROPOSAL });
  assert.strictEqual(parseReflectDestination(text).kind, 'record');
});

test('isApplicableReflect: observation and convention only, case-insensitive, reflect- names only', () => {
  assert.strictEqual(isApplicableReflect('reflect-1.md', file({ category: 'tangential' })), false);
  assert.strictEqual(isApplicableReflect('reflect-1.md', file({ category: 'Observation' })), true);
  assert.strictEqual(isApplicableReflect('reflect-2.md', file({ category: 'convention' })), true);
  assert.strictEqual(isApplicableReflect('leftover-1.md', file({ category: 'observation' })), false);
  assert.strictEqual(isApplicableReflect('reflect-1.md', 'no category line'), false);
  assert.strictEqual(isApplicableReflect('reflect-1.md', ''), false);
});

test('findingDescription: the Finding section squashed to one line', () => {
  const d = findingDescription(LEGACY);
  assert.ok(d.startsWith('`_shared/subagent-dispatch-core.md` line 39 states that'), d);
  assert.ok(!/\n/.test(d));
  assert.ok(!d.includes('Suggested resolution'));
});

test('findingDescription: spans paragraphs and stops at the next heading', () => {
  assert.strictEqual(
    findingDescription('# T\n\n## Finding\n\nfirst   line\nsecond line\n\nsecond para\n\n## Other\n\nnope\n'),
    'first line second line second para',
  );
});

test('findingDescription: falls back to digestTextOf when the section is absent or empty', () => {
  const { digestTextOf } = require(path.join(ROOT, 'plugin', 'bin', 'lib', 'console', 'staged-digest-text'));
  const absent = '# T\n\nSome prose line.\n';
  assert.strictEqual(findingDescription(absent), digestTextOf(absent));
  assert.strictEqual(findingDescription(absent), 'Some prose line.');
  const empty = '# T\n\nFallback prose.\n\n## Finding\n\n\n## Next\n\nx\n';
  assert.strictEqual(findingDescription(empty), digestTextOf(empty));
});
