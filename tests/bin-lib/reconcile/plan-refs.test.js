'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  PLAN_REFS_BATCH_CHUNK, listPlanRefs, buildIssueStateQuery, parseIssueStateResponse, decidePlanRef, planRefs,
} = require('../../../plugin/bin/lib/reconcile/plan-refs');

const P = 'refs/claude-tweaks/plans/';
const sha = (n) => String(n).padStart(40, '0');

test('listPlanRefs: keeps exact-integer refs only', () => {
  const out = [
    `${'a'.repeat(40)}\t${P}12`, `${'b'.repeat(40)}\t${P}0`, `${'c'.repeat(40)}\t${P}007`, `${'d'.repeat(40)}\t${P}12abc`, `${'e'.repeat(40)}\t${P}5/x`,
    `${'f'.repeat(40)}\t${P}3^{}`, `${'1'.repeat(40)}\trefs/heads/main`, `${'2'.repeat(64)}\t${P}4\r`, `nothex\t${P}9`, `abc\t${P}8`, '', '',
  ].join('\n');
  assert.deepEqual(listPlanRefs(out), [
    { ref: `${P}4`, record: 4, sha: '2'.repeat(64) },
    { ref: `${P}12`, record: 12, sha: 'a'.repeat(40) },
  ]);
});

test('listPlanRefs: a non-hex line does not claim a record, and the first valid sha per record wins', () => {
  const out = [
    `nothex\t${P}12`, `${'a'.repeat(40)}\t${P}12`, `${'b'.repeat(40)}\t${P}12`,
  ].join('\n');
  assert.deepEqual(listPlanRefs(out), [{ ref: `${P}12`, record: 12, sha: 'a'.repeat(40) }]);
});

test('buildIssueStateQuery: aliases each record, omits invalid ones', () => {
  const q = buildIssueStateQuery([7, 0, 'x', 9]);
  assert.match(q, /i0: issue\(number:7\)\{ number state \}/);
  assert.match(q, /i3: issue\(number:9\)\{ number state \}/);
  assert.doesNotMatch(q, /i1/);
  assert.doesNotMatch(q, /i2/);
  assert.match(q, /query\(\$owner:String!,\$name:String!\)/);
});

test('parseIssueStateResponse: keeps only exact-number CLOSED/OPEN nodes', () => {
  const data = { i0: { number: 1, state: 'CLOSED' }, i1: { number: 2, state: 'OPEN' }, i2: { number: 99, state: 'CLOSED' }, i3: null, i4: { number: 5, state: 'closed' } };
  const m = parseIssueStateResponse(JSON.stringify({ data: { repository: data } }), [1, 2, 3, 4, 5]);
  assert.deepEqual([...m], [[1, 'CLOSED'], [2, 'OPEN']]);
});

test('parseIssueStateResponse: an own-alias NOT_FOUND is absent, others still read', () => {
  const body = { data: { repository: { i0: { number: 1, state: 'CLOSED' }, i1: null } }, errors: [{ type: 'NOT_FOUND', path: ['repository', 'i1'] }] };
  assert.deepEqual([...parseIssueStateResponse(JSON.stringify(body), [1, 2])], [[1, 'CLOSED']]);
});

test('parseIssueStateResponse: a foreign error poisons the chunk', () => {
  const repo = { i0: { number: 1, state: 'CLOSED' } };
  const forbidden = { data: { repository: repo }, errors: [{ type: 'FORBIDDEN', path: ['repository', 'i0'] }] };
  assert.equal(parseIssueStateResponse(JSON.stringify(forbidden), [1]).size, 0);
  assert.equal(parseIssueStateResponse('not json', [1]).size, 0);
  assert.equal(parseIssueStateResponse(JSON.stringify({ data: { repository: repo }, errors: 'boom' }), [1]).size, 0);
});

test('decidePlanRef: only CLOSED deletes', () => {
  assert.deepEqual(decidePlanRef({ record: 1, state: 'CLOSED' }), { action: 'delete', reason: 'record-closed' });
  assert.deepEqual(decidePlanRef({ record: 1, state: 'OPEN' }), { action: 'skip', reason: 'record-open' });
  assert.deepEqual(decidePlanRef({ record: 1, state: undefined }), { action: 'skip', reason: 'state-unreadable' });
});

const URL = 'https://github.com/thn-inc/claude-tweaks.git';
function makeFakes({ refs, states = {}, ghThrowAt = {}, pushThrow = {} }) {
  const calls = { git: [], gh: [], pushes: [] };
  const git = (args) => {
    calls.git.push(args);
    if (args[0] === 'ls-remote') return refs.map((n) => `${sha(n)}\t${P}${n}`).join('\n');
    if (args[0] === 'remote') return URL;
    if (args[0] === 'push') {
      calls.pushes.push(args);
      const n = Number(args[3].slice(1 + P.length));
      if (pushThrow[n]) throw Object.assign(new Error('push failed'), { stderr: pushThrow[n] });
      return '';
    }
    throw new Error(`unexpected git ${args.join(' ')}`);
  };
  const gh = (args) => {
    calls.gh.push(args);
    const idx = calls.gh.length;
    if (ghThrowAt[idx]) throw ghThrowAt[idx];
    const q = args.find((a) => a.startsWith('query=')).slice('query='.length);
    const repo = {};
    for (const m of q.matchAll(/(i\d+): issue\(number:(\d+)\)/g)) {
      const s = states[m[2]];
      repo[m[1]] = s ? { number: Number(m[2]), state: s } : null;
    }
    return JSON.stringify({ data: { repository: repo } });
  };
  return { git, gh, calls };
}
const noLocal = () => 'github-issues';

test('planRefs: closed deleted, open kept, unreadable kept', () => {
  const f = makeFakes({ refs: [1, 2, 3], states: { 1: 'CLOSED', 2: 'OPEN' } });
  const r = planRefs({ cwd: '/x', git: f.git, gh: f.gh, readBackend: noLocal });
  assert.equal(r.failure, null);
  assert.deepEqual(r.entries.map((e) => [e.record, e.action, e.reason]), [
    [1, 'delete', 'record-closed'], [2, 'skip', 'record-open'], [3, 'skip', 'state-unreadable'],
  ]);
  assert.deepEqual(f.calls.pushes, [['push', `--force-with-lease=${P}1:${sha(1)}`, 'origin', `:${P}1`]]);
});

test('planRefs: a rejected lease push reports delete-failed and keeps going', () => {
  const f = makeFakes({ refs: [1, 4], states: { 1: 'CLOSED', 4: 'CLOSED' }, pushThrow: { 1: `To /x/remote.git\n ! [rejected]        (delete) -> ${P}1 (stale info)\nerror: failed to push some refs to '/x/remote.git'\n` } });
  const r = planRefs({ cwd: '/x', git: f.git, gh: f.gh, readBackend: noLocal });
  assert.equal(r.entries[0].action, 'skip');
  assert.equal(r.entries[0].reason, 'delete-failed');
  assert.match(r.entries[0].detail, /stale info/);
  assert.doesNotMatch(r.entries[0].detail, /^To /);
  assert.deepEqual(f.calls.pushes[1], ['push', `--force-with-lease=${P}4:${sha(4)}`, 'origin', `:${P}4`]);
  assert.equal(r.entries[1].action, 'delete');
  assert.equal(r.entries[1].reason, 'record-closed');
});

test('planRefs: chunks of 50, a failed chunk keeps only its refs', () => {
  const refs = Array.from({ length: 51 }, (_, i) => i + 1);
  const states = Object.fromEntries(refs.map((n) => [n, 'CLOSED']));
  const f = makeFakes({ refs, states, ghThrowAt: { 2: new Error('boom') } });
  const r = planRefs({ cwd: '/x', git: f.git, gh: f.gh, readBackend: noLocal });
  assert.equal(PLAN_REFS_BATCH_CHUNK, 50);
  assert.equal(f.calls.gh.length, 2);
  assert.equal(r.entries.filter((e) => e.action === 'delete').length, 50);
  const last = r.entries[50];
  assert.deepEqual([last.record, last.action, last.reason], [51, 'skip', 'state-unreadable']);
});

test('planRefs: gh rejection stdout is still parsed', () => {
  const body = JSON.stringify({ data: { repository: { i0: { number: 1, state: 'CLOSED' } } }, errors: [{ type: 'NOT_FOUND', path: ['repository', 'i1'] }] });
  const f = makeFakes({ refs: [1, 2], ghThrowAt: { 1: Object.assign(new Error('exit 1'), { stdout: body }) } });
  const r = planRefs({ cwd: '/x', git: f.git, gh: f.gh, readBackend: noLocal });
  assert.deepEqual(r.entries.map((e) => [e.record, e.action]), [[1, 'delete'], [2, 'skip']]);
  assert.equal(f.calls.pushes.length, 1);
});

test('planRefs: dry run deletes nothing', () => {
  const f = makeFakes({ refs: [1], states: { 1: 'CLOSED' } });
  const r = planRefs({ cwd: '/x', dryRun: true, git: f.git, gh: f.gh, readBackend: noLocal });
  assert.deepEqual(r.entries.map((e) => [e.action, e.reason]), [['would-delete', 'record-closed']]);
  assert.equal(f.calls.pushes.length, 0);
});

test('planRefs: ls-remote failure aborts with a reported failure', () => {
  const calls = { gh: 0 };
  const r = planRefs({
    cwd: '/x', readBackend: noLocal,
    git: () => { throw new Error('no remote'); },
    gh: () => { calls.gh++; return ''; },
  });
  assert.deepEqual(r, { entries: [], failure: 'ls-remote-failed' });
  assert.equal(calls.gh, 0);
});

test('planRefs: local-files backend skips', () => {
  let touched = 0;
  const r = planRefs({ cwd: '/x', readBackend: () => 'local-files', git: () => { touched++; return ''; }, gh: () => { touched++; return ''; } });
  assert.deepEqual(r, { entries: [], failure: 'local-files-backend' });
  assert.equal(touched, 0);
});

test('planRefs: no plan refs makes no gh call', () => {
  let ghCalls = 0;
  const r = planRefs({ cwd: '/x', readBackend: noLocal, git: () => '', gh: () => { ghCalls++; return ''; } });
  assert.deepEqual(r, { entries: [], failure: null });
  assert.equal(ghCalls, 0);
});

test('planRefs: an origin that does not parse is a reported failure', () => {
  const pushes = [];
  const git = (args) => {
    if (args[0] === 'ls-remote') return `${sha(1)}\t${P}1`;
    if (args[0] === 'remote') return 'not a url';
    pushes.push(args);
    return '';
  };
  let ghCalls = 0;
  const r = planRefs({ cwd: '/x', readBackend: noLocal, git, gh: () => { ghCalls++; return ''; } });
  assert.deepEqual(r, { entries: [], failure: 'origin-unresolvable' });
  assert.equal(ghCalls, 0);
  assert.equal(pushes.length, 0);
});

test('planRefs: an unexpected throw is a reported failure', () => {
  const r = planRefs({ cwd: '/x', readBackend: () => { throw new Error('boom'); }, git: () => '', gh: () => '' });
  assert.deepEqual(r, { entries: [], failure: 'unexpected-error' });
});

test('planRefs: an absent gh is a reported failure', () => {
  const f = makeFakes({ refs: [1], ghThrowAt: { 1: Object.assign(new Error('spawn gh ENOENT'), { code: 'ENOENT' }) } });
  const r = planRefs({ cwd: '/x', git: f.git, gh: f.gh, readBackend: noLocal });
  assert.deepEqual(r, { entries: [], failure: 'gh-absent' });
  assert.equal(f.calls.pushes.length, 0);
});
