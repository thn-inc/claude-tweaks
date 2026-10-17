'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const {
  TRUSTED_AUTHOR_ASSOCIATIONS,
  commentAssociation,
  isTrustedComment,
  untrustedSkipNote,
  trustedJqSelect,
  untrustedJqNote,
} = require('../../../plugin/bin/lib/issues/comment-trust');

test('AC1.1: exports the trusted set and isTrustedComment', () => {
  assert.deepStrictEqual([...TRUSTED_AUTHOR_ASSOCIATIONS], ['OWNER', 'MEMBER', 'COLLABORATOR']);
  assert.strictEqual(typeof isTrustedComment, 'function');
});

test('AC1.2: trusted associations, both field spellings', () => {
  for (const v of ['OWNER', 'MEMBER', 'COLLABORATOR']) {
    assert.strictEqual(isTrustedComment({ authorAssociation: v }), true, `authorAssociation ${v}`);
    assert.strictEqual(isTrustedComment({ author_association: v }), true, `author_association ${v}`);
  }
});

test('AC1.2: untrusted associations and missing field', () => {
  for (const v of ['CONTRIBUTOR', 'NONE', 'FIRST_TIME_CONTRIBUTOR', 'FIRST_TIMER', 'MANNEQUIN']) {
    assert.strictEqual(isTrustedComment({ authorAssociation: v }), false, `authorAssociation ${v}`);
    assert.strictEqual(isTrustedComment({ author_association: v }), false, `author_association ${v}`);
  }
  for (const c of [{}, null, { authorAssociation: '' }, { authorAssociation: 'member' }]) {
    assert.strictEqual(isTrustedComment(c), false, JSON.stringify(c));
  }
});

test('commentAssociation: camelCase wins, snake_case falls back, else null', () => {
  assert.strictEqual(commentAssociation({ authorAssociation: 'OWNER', author_association: 'NONE' }), 'OWNER');
  assert.strictEqual(commentAssociation({ authorAssociation: '', author_association: 'MEMBER' }), 'MEMBER');
  assert.strictEqual(commentAssociation({ author_association: 'NONE' }), 'NONE');
  assert.strictEqual(commentAssociation({ authorAssociation: 7 }), null);
  assert.strictEqual(commentAssociation({}), null);
  assert.strictEqual(commentAssociation(null), null);
  assert.strictEqual(commentAssociation(undefined), null);
});

test('untrustedSkipNote formats gh and REST shapes', () => {
  assert.strictEqual(
    untrustedSkipNote({ url: 'https://x/c1', author: { login: 'eve' }, authorAssociation: 'NONE' }),
    'skipped marker comment https://x/c1 by eve (NONE) — not an owner, member, or collaborator',
  );
  assert.strictEqual(
    untrustedSkipNote({ html_url: 'https://x/c2', user: { login: 'bot[bot]' }, author_association: 'CONTRIBUTOR' }),
    'skipped marker comment https://x/c2 by bot[bot] (CONTRIBUTOR) — not an owner, member, or collaborator',
  );
  assert.strictEqual(
    untrustedSkipNote({ id: 'IC_1' }),
    'skipped marker comment IC_1 by unknown (no association) — not an owner, member, or collaborator',
  );
  // Nothing identifies the comment: ref and login both fall back to 'unknown'.
  assert.strictEqual(
    untrustedSkipNote({}),
    'skipped marker comment unknown by unknown (no association) — not an owner, member, or collaborator',
  );
});

test('untrustedJqNote prints the same text as untrustedSkipNote, including a deleted (null) author and a missing association', (t) => {
  const probe = spawnSync('jq', ['--version'], { encoding: 'utf8' });
  if (probe.error || probe.status !== 0) {
    t.skip('jq not found in this environment'); // same precedent as tests/issue-branch-tracking.test.js
    return;
  }
  const comments = [
    { url: 'https://x/c1', author: { login: 'eve' }, authorAssociation: 'NONE' },
    { url: 'https://x/c2', author: null, authorAssociation: 'NONE' },
    { url: 'https://x/c3', author: { login: 'eve' } },
  ];
  const r = spawnSync('jq', ['-r', `.comments[] | ${untrustedJqNote()}`], { input: JSON.stringify({ comments }), encoding: 'utf8' });
  assert.strictEqual(r.status, 0, `jq failed: ${r.stderr}`);
  assert.strictEqual(r.stdout, `${comments.map((c) => untrustedSkipNote(c)).join('\n')}\n`);
  assert.ok(r.stdout.includes('by unknown (NONE)'), 'a deleted author prints unknown');
});

test('trustedJqSelect/untrustedJqNote are derived from the set', () => {
  assert.strictEqual(
    trustedJqSelect(),
    'select(.authorAssociation == "OWNER" or .authorAssociation == "MEMBER" or .authorAssociation == "COLLABORATOR")',
  );
  assert.strictEqual(
    untrustedJqNote(),
    'select((.authorAssociation == "OWNER" or .authorAssociation == "MEMBER" or .authorAssociation == "COLLABORATOR") | not) | "skipped marker comment \\(.url) by \\(.author.login // "unknown") (\\(.authorAssociation // "no association")) — not an owner, member, or collaborator"',
  );
});
