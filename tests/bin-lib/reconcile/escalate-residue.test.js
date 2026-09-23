'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  escalateResidue, resolveResidue, residueFingerprint, residueBody, capDirtyFiles,
  structurallyStuckMarker, structurallyStuckBody,
} = require('../../../plugin/bin/lib/reconcile/escalate-residue');

test('residueFingerprint: stable for the same (reason, path), distinct across either', () => {
  const a = residueFingerprint('move-failed', '/x/run-1');
  const b = residueFingerprint('move-failed', '/x/run-1');
  const c = residueFingerprint('move-failed', '/x/run-2');
  const d = residueFingerprint('removal-failed', '/x/run-1');
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.notEqual(a, d);
});

test('residueBody: embeds the path, reason, and the fingerprint marker', () => {
  const { body, marker } = residueBody({ reason: 'move-failed', targetPath: '/x/run-1', count: 3, firstFailedAt: null, lastError: 'ENOENT' });
  assert.match(body, /move-failed/);
  assert.match(body, /\/x\/run-1/);
  assert.match(body, /ENOENT/);
  assert.ok(body.includes(marker));
});

// #1796 — the attribution line used to read `Filed automatically by
// \`bin/lib/reconcile\` — see #644.`, which reads as an in-repo path and a
// local issue number in a consumer project. Fixed for every reason, not
// just removal-failed — structurally-stuck is the reason exercised here.
test('residueBody: attribution names the plugin and the fully-qualified upstream ref, never the bare bin/lib/reconcile path', () => {
  const { body, marker } = residueBody({
    reason: 'structurally-stuck', targetPath: '/x/run-1', count: 3, firstFailedAt: null, lastError: null,
  });
  assert.match(body, /thn-inc\/claude-tweaks#644/);
  assert.ok(!body.includes('Filed automatically by `bin/lib/reconcile`'), 'must not contain the retired bare-path attribution line');
  // The fingerprint marker's basis is (reason, targetPath) only — unaffected
  // by the attribution rewrite — so it must still match a fresh computation
  // for the same (reason, path), keeping existing-issue dedup working.
  assert.equal(marker, `<!-- fingerprint: ${residueFingerprint('structurally-stuck', '/x/run-1')} -->`);
});

test('residueBody: non-removal-failed reasons render no dirty-files block, even when dirtyFiles is passed', () => {
  const { body } = residueBody({
    reason: 'move-failed', targetPath: '/x/run-1', count: 3, firstFailedAt: null, lastError: null, dirtyFiles: ['?? stray.txt'],
  });
  assert.ok(!body.includes('Dirty files'), 'move-failed must never render the dirty-files block');
  assert.ok(!body.includes('stray.txt'));
});

test('residueBody: removal-failed with a readable dirtyFiles list renders a fenced block and the disposition hint', () => {
  const { body } = residueBody({
    reason: 'removal-failed', targetPath: '/x/wt', count: 3, firstFailedAt: null, lastError: null, dirtyFiles: ['?? docs/plans/x-ledger.md'],
  });
  assert.match(body, /\*\*Dirty files/);
  assert.match(body, /```[\s\S]*\?\? docs\/plans\/x-ledger\.md[\s\S]*```/);
  assert.match(body, /Only `\?\?` \(untracked\) entries/);
  assert.match(body, /git worktree remove --force \/x\/wt/);
});

test('residueBody: removal-failed with dirtyFiles: null renders the unreadable sentence, not an omitted block', () => {
  const { body } = residueBody({
    reason: 'removal-failed', targetPath: '/x/wt', count: 3, firstFailedAt: null, lastError: null, dirtyFiles: null,
  });
  assert.match(body, /\*\*Dirty files/);
  assert.match(body, /could not read — git status failed/);
});

test('residueBody: removal-failed with more than 50 dirty files caps to 50 plus a tail line', () => {
  const lines = Array.from({ length: 60 }, (_, i) => `?? file-${i}.txt`);
  const { body } = residueBody({
    reason: 'removal-failed', targetPath: '/x/wt', count: 3, firstFailedAt: null, lastError: null, dirtyFiles: lines,
  });
  assert.match(body, /… and 10 more/);
  assert.ok(body.includes('file-49.txt'), 'the 50th entry (index 49) must survive the cap');
  assert.ok(!body.includes('file-50.txt'), 'the 51st entry must be dropped, replaced by the tail line');
});

test('capDirtyFiles: idempotent — capping an already-capped array is a no-op', () => {
  const lines = Array.from({ length: 60 }, (_, i) => `?? file-${i}.txt`);
  const once = capDirtyFiles(lines);
  const twice = capDirtyFiles(once);
  assert.deepEqual(twice, once);
  assert.equal(once.length, 51);
  assert.equal(once[50], '… and 10 more');
});

test('capDirtyFiles: an array at or under the cap is returned unchanged', () => {
  const lines = ['?? a.txt', '?? b.txt'];
  assert.deepEqual(capDirtyFiles(lines), lines);
});

test('escalateResidue: no prior issue -> files one via the injected runner, returns its number', () => {
  const calls = [];
  const runner = (args) => {
    calls.push(args);
    if (args[0] === 'issue' && args[1] === 'list') return '[]';
    if (args[0] === 'issue' && args[1] === 'create') return 'https://github.com/o/r/issues/99\n';
    throw new Error('unexpected call: ' + args.join(' '));
  };
  const result = escalateResidue({ repo: 'o/r', reason: 'move-failed', targetPath: '/x/run-1', count: 3, runner });
  assert.deepEqual(result, { status: 'filed', number: 99 });
  assert.equal(calls.length, 2);
  assert.equal(calls[0][0], 'issue');
  assert.equal(calls[0][1], 'list');
  assert.equal(calls[1][1], 'create');
});

test('escalateResidue: a prior matching issue already exists -> dedup-hit, never files a second one', () => {
  const calls = [];
  const marker = `<!-- fingerprint: ${residueFingerprint('move-failed', '/x/run-1')} -->`;
  const runner = (args) => {
    calls.push(args);
    return JSON.stringify([{ number: 42, title: 'reconcile: move-failed stuck on /x/run-1', body: `body\n${marker}`, createdAt: '2024-01-01T00:00:00Z' }]);
  };
  const result = escalateResidue({ repo: 'o/r', reason: 'move-failed', targetPath: '/x/run-1', count: 3, runner });
  assert.deepEqual(result, { status: 'dedup-hit', number: 42 });
  assert.equal(calls.length, 1, 'must never call issue create after a dedup hit');
});

test('escalateResidue: runner throws (gh absent / network) -> escalation-failed, never throws itself', () => {
  const runner = () => { throw new Error('gh: command not found'); };
  const result = escalateResidue({ repo: 'o/r', reason: 'move-failed', targetPath: '/x/run-1', count: 3, runner });
  assert.equal(result.status, 'escalation-failed');
  assert.match(result.reason, /gh: command not found/);
});

test('escalateResidue: no repo slug -> escalation-failed without calling the runner', () => {
  let called = false;
  const runner = () => { called = true; return '[]'; };
  const result = escalateResidue({ repo: null, reason: 'move-failed', targetPath: '/x/run-1', count: 3, runner });
  assert.equal(result.status, 'escalation-failed');
  assert.equal(called, false);
});

// #1892 Deliverable 4 — a marker match that is already CLOSED means this
// path escalated once before, got resolved, and is now failing again: comment
// + reopen the SAME record rather than filing a duplicate.
test('escalateResidue: a prior matching issue is CLOSED -> comments and reopens it, never files a duplicate', () => {
  const calls = [];
  const marker = `<!-- fingerprint: ${residueFingerprint('move-failed', '/x/run-1')} -->`;
  const runner = (args) => {
    calls.push(args);
    if (args[0] === 'issue' && args[1] === 'list') {
      return JSON.stringify([{
        number: 42, title: 'reconcile: move-failed stuck on /x/run-1', body: `body\n${marker}`, createdAt: '2024-01-01T00:00:00Z', state: 'CLOSED',
      }]);
    }
    return '';
  };
  const result = escalateResidue({ repo: 'o/r', reason: 'move-failed', targetPath: '/x/run-1', count: 4, runner });
  assert.deepEqual(result, { status: 'reopened', number: 42 });
  assert.equal(calls.length, 3, 'expected list, comment, reopen — never a second create');
  assert.equal(calls[1][1], 'comment');
  assert.equal(calls[1][2], '42');
  assert.equal(calls[2][1], 'reopen');
  assert.equal(calls[2][2], '42');
  assert.ok(!calls.some((c) => c[1] === 'create'), 'must never file a duplicate for an already-tracked path');
});

// An OPEN prior match is unaffected by the CLOSED-only reopen branch — still
// a plain dedup-hit, exactly as before.
test('escalateResidue: a prior matching issue is OPEN -> still a plain dedup-hit, never reopened/commented', () => {
  const calls = [];
  const marker = `<!-- fingerprint: ${residueFingerprint('move-failed', '/x/run-1')} -->`;
  const runner = (args) => {
    calls.push(args);
    return JSON.stringify([{
      number: 42, title: 'reconcile: move-failed stuck on /x/run-1', body: `body\n${marker}`, createdAt: '2024-01-01T00:00:00Z', state: 'OPEN',
    }]);
  };
  const result = escalateResidue({ repo: 'o/r', reason: 'move-failed', targetPath: '/x/run-1', count: 3, runner });
  assert.deepEqual(result, { status: 'dedup-hit', number: 42 });
  assert.equal(calls.length, 1, 'must never call comment/reopen/create on an already-open dedup-hit');
});

test('resolveResidue: an escalated OPEN match -> comments and closes it', () => {
  const calls = [];
  const marker = `<!-- fingerprint: ${residueFingerprint('move-failed', '/x/run-1')} -->`;
  const runner = (args) => {
    calls.push(args);
    if (args[0] === 'issue' && args[1] === 'list') {
      return JSON.stringify([{
        number: 55, title: 'reconcile: move-failed stuck on /x/run-1', body: `body\n${marker}`, createdAt: '2024-01-01T00:00:00Z', state: 'OPEN',
      }]);
    }
    return '';
  };
  const result = resolveResidue({ repo: 'o/r', reason: 'move-failed', targetPath: '/x/run-1', runner });
  assert.deepEqual(result, { status: 'closed', number: 55 });
  assert.equal(calls[1][1], 'comment');
  assert.equal(calls[2][1], 'close');
});

test('resolveResidue: no matching issue -> not-found, calls only the list', () => {
  const runner = () => '[]';
  const result = resolveResidue({ repo: 'o/r', reason: 'move-failed', targetPath: '/x/run-1', runner });
  assert.deepEqual(result, { status: 'not-found' });
});

test('resolveResidue: a matching issue already CLOSED -> already-closed, no further writes', () => {
  const calls = [];
  const marker = `<!-- fingerprint: ${residueFingerprint('move-failed', '/x/run-1')} -->`;
  const runner = (args) => {
    calls.push(args);
    return JSON.stringify([{
      number: 55, title: 'x', body: `body\n${marker}`, createdAt: '2024-01-01T00:00:00Z', state: 'CLOSED',
    }]);
  };
  const result = resolveResidue({ repo: 'o/r', reason: 'move-failed', targetPath: '/x/run-1', runner });
  assert.deepEqual(result, { status: 'already-closed', number: 55 });
  assert.equal(calls.length, 1, 'must never comment/close an already-closed issue again');
});

test('resolveResidue: no repo slug -> resolution-failed without calling the runner', () => {
  let called = false;
  const runner = () => { called = true; return '[]'; };
  const result = resolveResidue({ repo: null, reason: 'move-failed', targetPath: '/x/run-1', runner });
  assert.equal(result.status, 'resolution-failed');
  assert.equal(called, false);
});

// --- #1811 Deliverable 4: structurally-stuck escalates as ONE consolidated
// record per sweep pass naming every stuck path, dedup'd by a path-less
// fingerprint marker — not one record per directory. ---

test('residueFingerprint: structurally-stuck ignores the path — every stuck dir converges on the same marker', () => {
  const a = residueFingerprint('structurally-stuck', '/x/run-1');
  const b = residueFingerprint('structurally-stuck', '/x/run-2');
  assert.equal(a, b);
  // Every other reason keeps path-specificity, unchanged.
  assert.notEqual(residueFingerprint('move-failed', '/x/run-1'), residueFingerprint('move-failed', '/x/run-2'));
});

test('escalateResidue: structurally-stuck with no prior record files ONE issue naming just that path', () => {
  const calls = [];
  const runner = (args) => {
    calls.push(args);
    if (args[0] === 'issue' && args[1] === 'list') return '[]';
    if (args[0] === 'issue' && args[1] === 'create') return 'https://github.com/o/r/issues/100\n';
    throw new Error('unexpected call: ' + args.join(' '));
  };
  const result = escalateResidue({ repo: 'o/r', reason: 'structurally-stuck', targetPath: '/x/run-a', count: 3, runner });
  assert.deepEqual(result, { status: 'filed', number: 100 });
  const createCall = calls.find((c) => c[1] === 'create');
  assert.match(createCall[createCall.indexOf('--body') + 1], /run-a/);
});

// The AC this whole deliverable exists to satisfy: N stuck directories in
// ONE sweep pass produce exactly one filed record, and its body names all N
// paths — not N separate issues.
test('escalateResidue: structurally-stuck — N stuck directories in one pass produce exactly one record whose body names all N paths', () => {
  let issueBody = null;
  let created = false;
  const runner = (args) => {
    if (args[0] === 'issue' && args[1] === 'list') {
      if (!created) return '[]';
      const marker = structurallyStuckMarker();
      return JSON.stringify([{ number: 200, title: 'reconcile: structurally-stuck run directories', body: issueBody, createdAt: '2024-01-01T00:00:00Z', state: 'OPEN' }]);
    }
    if (args[0] === 'issue' && args[1] === 'create') {
      created = true;
      issueBody = args[args.indexOf('--body') + 1];
      return 'https://github.com/o/r/issues/200\n';
    }
    if (args[0] === 'issue' && args[1] === 'edit') {
      issueBody = args[args.indexOf('--body') + 1];
      return '';
    }
    return '';
  };
  const paths = ['/x/run-a', '/x/run-b', '/x/run-c'];
  const results = paths.map((p) => escalateResidue({ repo: 'o/r', reason: 'structurally-stuck', targetPath: p, count: 3, runner }));

  assert.equal(results[0].status, 'filed');
  assert.equal(results[0].number, 200);
  assert.equal(results[1].status, 'appended');
  assert.equal(results[1].number, 200);
  assert.equal(results[2].status, 'appended');
  assert.equal(results[2].number, 200);
  for (const p of paths) assert.match(issueBody, new RegExp(p.replace(/\//g, '\\/')), `expected ${p} in final body: ${issueBody}`);
});

test('escalateResidue: structurally-stuck re-escalating the SAME already-named path is a plain dedup-hit, never appended twice', () => {
  const marker = structurallyStuckMarker();
  const body = structurallyStuckBody(['/x/run-a']);
  const calls = [];
  const runner = (args) => {
    calls.push(args);
    if (args[0] === 'issue' && args[1] === 'list') {
      return JSON.stringify([{ number: 201, title: 't', body, createdAt: '2024-01-01T00:00:00Z', state: 'OPEN' }]);
    }
    return '';
  };
  const result = escalateResidue({ repo: 'o/r', reason: 'structurally-stuck', targetPath: '/x/run-a', count: 4, runner });
  assert.deepEqual(result, { status: 'dedup-hit', number: 201 });
  assert.equal(calls.length, 1, 'must never edit/comment for a path already named in the body');
});

test('escalateResidue: structurally-stuck reopens a CLOSED consolidated record and re-adds the path', () => {
  const body = structurallyStuckBody(['/x/run-old']);
  const calls = [];
  const runner = (args) => {
    calls.push(args);
    if (args[0] === 'issue' && args[1] === 'list') {
      return JSON.stringify([{ number: 202, title: 't', body, createdAt: '2024-01-01T00:00:00Z', state: 'CLOSED' }]);
    }
    return '';
  };
  const result = escalateResidue({ repo: 'o/r', reason: 'structurally-stuck', targetPath: '/x/run-new', count: 3, runner });
  assert.deepEqual(result, { status: 'reopened', number: 202 });
  assert.ok(calls.some((c) => c[1] === 'edit'));
  assert.ok(calls.some((c) => c[1] === 'reopen'));
  assert.ok(!calls.some((c) => c[1] === 'create'), 'must never file a duplicate for a reopened consolidated record');
});

test('resolveResidue: structurally-stuck removes just its own path, leaving the record open while others remain stuck', () => {
  const body = structurallyStuckBody(['/x/run-a', '/x/run-b']);
  let editedBody = null;
  const calls = [];
  const runner = (args) => {
    calls.push(args);
    if (args[0] === 'issue' && args[1] === 'list') {
      return JSON.stringify([{ number: 203, title: 't', body: editedBody || body, createdAt: '2024-01-01T00:00:00Z', state: 'OPEN' }]);
    }
    if (args[0] === 'issue' && args[1] === 'edit') { editedBody = args[args.indexOf('--body') + 1]; return ''; }
    return '';
  };
  const result = resolveResidue({ repo: 'o/r', reason: 'structurally-stuck', targetPath: '/x/run-a', runner });
  assert.deepEqual(result, { status: 'path-removed', number: 203 });
  assert.ok(!calls.some((c) => c[1] === 'close'), 'must not close while /x/run-b is still stuck');
  assert.doesNotMatch(editedBody, /run-a/);
  assert.match(editedBody, /run-b/);
});

test('resolveResidue: structurally-stuck closes the record once the last stuck path is removed', () => {
  const body = structurallyStuckBody(['/x/run-only']);
  const calls = [];
  const runner = (args) => {
    calls.push(args);
    if (args[0] === 'issue' && args[1] === 'list') {
      return JSON.stringify([{ number: 204, title: 't', body, createdAt: '2024-01-01T00:00:00Z', state: 'OPEN' }]);
    }
    return '';
  };
  const result = resolveResidue({ repo: 'o/r', reason: 'structurally-stuck', targetPath: '/x/run-only', runner });
  assert.deepEqual(result, { status: 'closed', number: 204 });
  assert.ok(calls.some((c) => c[1] === 'close'));
});
