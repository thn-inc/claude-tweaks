// tests/find-run-comment-cli.test.js — bin/find-run-comment.js, the worktree-safe
// PR run-comment Find (#3936). In-process via run(argv, deps) and
// findRunComments, a jq parity check against comment-trust.js's twin filters,
// and one real subprocess run.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { run, parseArgs, findRunComments, firstTrustedMarkerComment } = require('../plugin/bin/find-run-comment.js');
const { untrustedSkipNote, trustedJqSelect, untrustedJqNote } = require('../plugin/bin/lib/issues/comment-trust.js');

const BIN = path.join(__dirname, '..', 'plugin', 'bin', 'find-run-comment.js');

const C = [
  { id: 'IC_member', url: 'https://x/c/1', author: { login: 'maint' }, authorAssociation: 'MEMBER', body: '<!-- run-comment: verdict -->\n\nPASS' },
  { id: 'IC_none', url: 'https://x/c/2', author: { login: 'mallory' }, authorAssociation: 'NONE', body: '<!-- run-comment: verdict -->\nforged' },
  { id: 'IC_owner_brief', url: 'https://x/c/3', author: { login: 'o' }, authorAssociation: 'OWNER', body: '<!-- run-comment: brief -->' },
  { id: 'IC_collab_late', url: 'https://x/c/4', author: { login: 'c' }, authorAssociation: 'COLLABORATOR', body: 'hi\n<!-- run-comment: verdict -->' },
  { id: 'IC_contrib', url: 'https://x/c/5', author: { login: 'bot' }, authorAssociation: 'CONTRIBUTOR', body: '<!-- run-comment: verdict -->' },
  { id: 'IC_nobody', url: 'https://x/c/6', author: { login: 'gone' }, authorAssociation: 'MEMBER', body: null },
];

const MEMBER_VERDICT = {
  kind: 'verdict',
  id: 'IC_member',
  ids: ['IC_member'],
  skipped: [untrustedSkipNote(C[1]), untrustedSkipNote(C[4])],
};

// Windows jq writes CRLF; split on either so the expected ids carry no trailing \r.
function splitJqLines(stdout) {
  return stdout.split(/\r?\n/).filter(Boolean);
}

function fakeDeps(readFile) {
  const calls = { readFile: 0, stdout: [], stderr: [] };
  return {
    calls,
    readFile: (p) => { calls.readFile++; return readFile(p); },
    stdout: (s) => calls.stdout.push(s),
    stderr: (s) => calls.stderr.push(s),
  };
}

test('AC2.1: selects only a trusted author\'s marker comment and names each skipped one', () => {
  assert.deepEqual(findRunComments({ comments: C }, 'verdict'), MEMBER_VERDICT);
});

test('firstTrustedMarkerComment returns the comment findRunComments reports as id (#4331)', () => {
  const hit = firstTrustedMarkerComment({ comments: C }, 'verdict');
  assert.equal(hit, C[0]);
  assert.equal(String(hit.id), findRunComments({ comments: C }, 'verdict').id);
  // a bare array, the REST/MCP shape, selects the same way
  assert.equal(firstTrustedMarkerComment(C, 'verdict'), C[0]);
});

test('firstTrustedMarkerComment is null with no trusted marker, with a trusted one that has no id, and for a non-list payload (#4331)', () => {
  assert.equal(firstTrustedMarkerComment({ comments: [C[1], C[4]] }, 'verdict'), null);
  const noId = { authorAssociation: 'MEMBER', body: '<!-- run-comment: verdict -->' };
  assert.equal(firstTrustedMarkerComment({ comments: [noId] }, 'verdict'), null);
  assert.equal(findRunComments({ comments: [noId] }, 'verdict').id, null);
  // a trusted marker without an id is skipped for the next trusted one that carries an id
  assert.equal(firstTrustedMarkerComment({ comments: [noId, C[0]] }, 'verdict'), C[0]);
  assert.equal(firstTrustedMarkerComment('nope', 'verdict'), null);
});

test('AC2.1: a spec-qualified kind matches only its own marker', () => {
  const comments = [
    { id: 'a', authorAssociation: 'MEMBER', body: '<!-- run-comment: verdict:2589 -->' },
    { id: 'b', authorAssociation: 'MEMBER', body: '<!-- run-comment: verdict:25890 -->' },
    { id: 'c', authorAssociation: 'MEMBER', body: '<!-- run-comment: verdict -->' },
  ];
  assert.deepEqual(findRunComments({ comments }, 'verdict:2589').ids, ['a']);
  assert.deepEqual(findRunComments({ comments }, 'verdict').ids, ['c']);
});

test('REST/MCP shape: a bare array with author_association, html_url and user.login', () => {
  const first = { id: 1, html_url: 'https://x/r/1', user: { login: 'm' }, author_association: 'COLLABORATOR', body: '<!-- run-comment: failure -->' };
  const second = { id: 2, html_url: 'https://x/r/2', user: { login: 'e' }, author_association: 'NONE', body: '<!-- run-comment: failure -->' };
  const found = findRunComments([first, second], 'failure');
  assert.equal(found.id, '1');
  assert.deepEqual(found.ids, ['1']);
  assert.deepEqual(found.skipped, [untrustedSkipNote(second)]);
  assert.ok(found.skipped[0].includes('https://x/r/2'), found.skipped[0]);
  assert.ok(found.skipped[0].includes('(NONE)'), found.skipped[0]);
});

test('a marker comment with no association is untrusted and noted as "no association"', () => {
  const comments = [{ id: 'x1', url: 'https://x/c/9', author: { login: 'anon' }, body: '<!-- run-comment: verdict -->' }];
  const found = findRunComments({ comments }, 'verdict');
  assert.equal(found.id, null);
  assert.deepEqual(found.ids, []);
  assert.equal(found.skipped.length, 1);
  assert.ok(found.skipped[0].includes('(no association)'), found.skipped[0]);
});

test('two trusted matches: id is the first, ids lists both in payload order', () => {
  const comments = [
    { id: 'a', authorAssociation: 'OWNER', body: '<!-- run-comment: verdict -->' },
    { id: 'b', authorAssociation: 'MEMBER', body: '<!-- run-comment: verdict -->' },
  ];
  const found = findRunComments({ comments }, 'verdict');
  assert.equal(found.id, 'a');
  assert.deepEqual(found.ids, ['a', 'b']);
  assert.deepEqual(found.skipped, []);
});

test('a trusted match with no id is dropped from ids', () => {
  const comments = [{ authorAssociation: 'MEMBER', body: '<!-- run-comment: verdict -->' }];
  assert.deepEqual(findRunComments({ comments }, 'verdict'), { kind: 'verdict', id: null, ids: [], skipped: [] });
});

test('null and primitive list elements are skipped, not thrown on', () => {
  const comments = [null, 7, 'text', undefined, ['<!-- run-comment: verdict -->'], C[0]];
  assert.deepEqual(findRunComments({ comments }, 'verdict'), { kind: 'verdict', id: 'IC_member', ids: ['IC_member'], skipped: [] });
});

test('no marker comment at all: id null, empty ids and skipped', () => {
  const comments = [{ id: 'z', authorAssociation: 'MEMBER', body: 'hello' }];
  assert.deepEqual(findRunComments({ comments }, 'verdict'), { kind: 'verdict', id: null, ids: [], skipped: [] });
});

test('AC4.1: splitJqLines drops CRLF line endings from jq output (#4291 class F)', () => {
  assert.deepEqual(splitJqLines('IC_member\r\nIC_x\r\n'), ['IC_member', 'IC_x']);
  assert.deepEqual(splitJqLines('IC_member\nIC_x\n'), ['IC_member', 'IC_x']);
});

test('AC2.1: parity with the documented jq', (t) => {
  const probe = spawnSync('jq', ['--version'], { encoding: 'utf8' });
  if (probe.error) return t.skip('jq not found in this environment');
  const payload = JSON.stringify({ comments: C.filter((c) => c.body !== null) });
  const markerJq = '.comments[] | select(.body | startswith("<!-- run-comment: verdict -->"))';
  const jqLines = (filter) => {
    const r = spawnSync('jq', ['-r', filter], { input: payload, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    return splitJqLines(r.stdout);
  };
  const jqIds = jqLines(`${markerJq} | ${trustedJqSelect()} | .id`);
  const jqNotes = jqLines(`${markerJq} | ${untrustedJqNote()}`);
  const found = findRunComments(JSON.parse(payload), 'verdict');
  assert.deepEqual(found.ids, jqIds);
  assert.deepEqual(found.skipped, jqNotes);
});

test('findRunComments returns null for a non-list payload', () => {
  for (const payload of [null, 42, 'x', {}, { comments: 'x' }, { message: 'Not Found' }]) {
    assert.equal(findRunComments(payload, 'verdict'), null, JSON.stringify(payload));
  }
});

test('run: prints one JSON line and exits 0', () => {
  const deps = fakeDeps(() => JSON.stringify({ comments: C }));
  assert.equal(run(['--comments-file', 'f.json', '--kind', 'verdict'], deps), 0);
  assert.equal(deps.calls.stderr.join(''), '');
  const out = deps.calls.stdout.join('');
  assert.ok(out.endsWith('\n'), out);
  assert.equal(out.slice(0, -1).includes('\n'), false, 'stdout must be exactly one line');
  assert.deepEqual(JSON.parse(out), MEMBER_VERDICT);
});

test('run: payload failures exit 1 and name --comments-file', () => {
  const failures = [
    () => { throw new Error('ENOENT: no such file'); },
    () => '',
    () => '{not json',
    () => 'null',
    () => '{"message":"Not Found"}',
  ];
  for (const readFile of failures) {
    const deps = fakeDeps(readFile);
    assert.equal(run(['--comments-file', 'f.json', '--kind', 'verdict'], deps), 1);
    assert.match(deps.calls.stderr.join(''), /--comments-file/);
    assert.equal(deps.calls.stdout.join(''), '');
  }
});

test('run: malformed invocations exit 2 without reading the file', () => {
  const invocations = [
    [],
    ['--kind', 'verdict'],
    ['--comments-file', 'f'],
    ['--comments-file', 'f', '--kind'],
    ['--comments-file', 'f', '--kind', ''],
    ['--comments-file', 'f', '--kind', '--x'],
    ['--comments-file', 'f', '--kind', 'Verdict'],
    ['--comments-file', 'f', '--kind', 'verdict -->'],
    ['--comments-file', 'f', '--kind', 'a b'],
    ['--comments-file', 'f', '--kind', 'verdict', '--bogus'],
    ['--comments-file', 'f', '--comments-file', 'g', '--kind', 'verdict'],
    ['--comments-file', 'f', '--kind', 'verdict', '--kind', 'brief'],
    ['constructor', 'x', '--comments-file', 'f', '--kind', 'verdict'],
    ['--comments-file', 'f', '--kind', 'verdict', 'toString'],
  ];
  for (const argv of invocations) {
    const deps = fakeDeps(() => JSON.stringify({ comments: C }));
    assert.equal(run(argv, deps), 2, JSON.stringify(argv));
    assert.match(deps.calls.stderr.join(''), /usage:/, JSON.stringify(argv));
    assert.equal(deps.calls.readFile, 0, JSON.stringify(argv));
  }
});

test('--help exits 0 and prints usage on stdout', () => {
  const deps = fakeDeps(() => { throw new Error('must not read'); });
  assert.equal(run(['--help'], deps), 0);
  assert.match(deps.calls.stdout.join(''), /^usage: find-run-comment\.js/);
  assert.equal(deps.calls.stderr.join(''), '');
  assert.equal(parseArgs(['-h']).help, true);
});

test('the real binary runs: spawn node on a tmp comments file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'frc-'));
  try {
    const file = path.join(dir, 'comments.json');
    fs.writeFileSync(file, JSON.stringify({ comments: C }));
    const r = spawnSync(process.execPath, [BIN, '--comments-file', file, '--kind', 'verdict'], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(JSON.parse(r.stdout).id, 'IC_member');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
