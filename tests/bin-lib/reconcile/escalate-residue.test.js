'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  escalateResidue, resolveResidue, residueFingerprint, residueBody, capDirtyFiles, findResidueDuplicate,
  structurallyStuckMarker, structurallyStuckBody, parseStuckPaths, renderStuckPathsBlock, withStuckPaths,
} = require('../../../plugin/bin/lib/reconcile/escalate-residue');
const { STRUCTURALLY_STUCK_REASONS } = require('../../../plugin/bin/lib/reconcile/archive-merged');

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

test('structurallyStuckBody: names every feeding skip reason, the cache lastError, and the pr-not-found stamp remedy (#3543)', () => {
  const body = structurallyStuckBody(['/x/run-a']);
  for (const reason of ['no-worktree', 'no-branch', 'no-pr', 'console-never-rendered-pr-closed', 'console-never-rendered-staged-pending', 'pr-not-found']) {
    assert.ok(body.includes('`' + reason + '`'), `expected body to name \`${reason}\`: ${body}`);
  }
  assert.match(body, /`lastError` \(`stuck at <reason>`\)/);
  assert.match(body, /\.claude-tweaks\/reconcile-cache\.json/);
  assert.match(body, /`pr-not-found` directory, the `pr\.number` stamped in its `run-state\.json` names a PR that GitHub confirms does not exist/);
  assert.match(body, /correct or clear that stamp/);
  assert.match(body, /apply or delete the files under `staged\/`[^\n]*or write a resolved `console\.json`/, 'the staged-pending sentence must carry the remedy');
  assert.deepEqual(parseStuckPaths(body), ['/x/run-a']);
  assert.ok(body.includes(structurallyStuckMarker()));
});

// #3705: no-repo-slug is in STRUCTURALLY_STUCK_REASONS but can never reach this
// record. With no repo slug, escalate-residue's findOrCreateIssue returns
// 'escalation-failed', so the consolidated issue is never filed and this body is
// never written; that reason only shows in the residue summary's stuck count.
const UNFILEABLE_STUCK_REASONS = new Set(['no-repo-slug']);

test('structurallyStuckBody: the reason list names every STRUCTURALLY_STUCK_REASONS member except the unfileable ones (#3705)', () => {
  const body = structurallyStuckBody([]);
  // The reason list is the body's first line. Anchoring here, not body-wide,
  // keeps the check discriminating: remedy paragraphs name reasons in backticks
  // too, so a body-wide match would still pass after a reason is dropped from the list.
  const listLine = body.split('\n')[0];
  for (const reason of STRUCTURALLY_STUCK_REASONS) {
    if (UNFILEABLE_STUCK_REASONS.has(reason)) continue;
    assert.ok(listLine.includes(`\`${reason}\``), `expected reason list to name \`${reason}\`: ${listLine}`);
  }
  for (const reason of UNFILEABLE_STUCK_REASONS) {
    assert.ok(!listLine.includes(`\`${reason}\``), `unfileable \`${reason}\` must not be listed as feeding the record`);
  }
  assert.match(body, /For a `merged-partial` directory, the records the run's merged PR was meant to close \(the closing-keyword links on that PR\) are still open: ship them in a later PR, or close\/release them if they were abandoned; the next reconcile then archives the dir and drops it from this record\./);
});

test('structurallyStuckBody: names both tiebreak reasons and carries their remedy line (#3945)', () => {
  const body = structurallyStuckBody([]);
  const listLine = body.split('\n')[0];
  for (const reason of ['tiebreak-coverage-missing', 'tiebreak-artifact-invalid']) {
    assert.ok(listLine.includes(`\`${reason}\``), `expected reason list to name \`${reason}\`: ${listLine}`);
  }
  assert.ok(body.includes("For a `tiebreak-coverage-missing` or `tiebreak-artifact-invalid` directory, the run's review-findings.json lists a finding with no tiebreak verdict line in decisions.md, or is malformed: re-run the review step's findings writer and tiebreak for that run, or delete review-findings.json if the run predates the tiebreak; the next reconcile then archives the dir and drops it from this record."), body);
  const lines = body.split('\n');
  const mergedPartial = lines.findIndex((l) => l.startsWith('For a `merged-partial` directory'));
  const tiebreak = lines.findIndex((l) => l.startsWith('For a `tiebreak-coverage-missing`'));
  assert.ok(mergedPartial >= 0 && tiebreak > mergedPartial, 'the tiebreak remedy follows the merged-partial line');
});

test('structurallyStuckBody: names cant-tell-unfiled and carries its remedy line (#4171)', () => {
  const body = structurallyStuckBody([]);
  assert.ok(body.split('\n')[0].includes('`cant-tell-unfiled`'), 'expected the reason list to name `cant-tell-unfiled`');
  const remedy = body.split('\n').find((l) => l.startsWith('For a `cant-tell-unfiled` directory'));
  assert.ok(remedy, 'expected a `cant-tell-unfiled` remedy line');
  for (const needle of ['an auto-merge path (the wrap-up short-circuit or the dispatch bundle Auto-merge gate)', 'a `spec-N/`-prefixed id is filed and logged with `--run {run-dir}/spec-N`, its own `decisions.md`']) {
    assert.ok(remedy.includes(needle), `the remedy line must carry ${needle}: ${remedy}`);
  }
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

// #4032 — the marker index: a runner carrying findIssueByMarker is asked first.
test('findResidueDuplicate uses the index before listing', () => {
  const marker = `<!-- fingerprint: ${residueFingerprint('move-failed', '/x/run-1')} -->`;
  const calls = [];
  const runner = (args) => { calls.push(args); return '[]'; };
  runner.findIssueByMarker = (repo, m) => {
    assert.equal(repo, 'o/r');
    assert.equal(m, marker);
    return { number: 3, state: 'OPEN', body: m };
  };
  const hit = findResidueDuplicate({ repo: 'o/r', marker, runner });
  assert.equal(hit.number, 3);
  assert.equal(calls.length, 0, 'no issue list call when the index answers');
});

test('findResidueDuplicate: an undefined index answer falls through to the list path', () => {
  const marker = `<!-- fingerprint: ${residueFingerprint('move-failed', '/x/run-1')} -->`;
  const calls = [];
  const runner = (args) => {
    calls.push(args);
    return JSON.stringify([{ number: 8, state: 'CLOSED', body: marker, createdAt: '2024-01-01T00:00:00Z' }]);
  };
  runner.findIssueByMarker = () => undefined;
  assert.equal(findResidueDuplicate({ repo: 'o/r', marker, runner }).number, 8);
  assert.equal(calls.length, 1);
});

test('findResidueDuplicate: plain runner keeps the list path', () => {
  const marker = '<!-- fingerprint: reconcile-residue-aaaa1111 -->';
  const calls = [];
  const runner = (args) => { calls.push(args); return '[]'; };
  assert.equal(findResidueDuplicate({ repo: 'o/r', marker, runner }), null);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].slice(0, 2), ['issue', 'list']);
});

// --- #2724: the consolidated record's body is edited in place — only the
// line-anchored stuck-paths block is replaced, never the whole body.

const SHAPED = (block) => `Surface: infra\n\n## Current State\n\nThe record names \`<!-- stuck-paths -->\` in prose.\n- \`/x/decoy\`\n\n${block}\n\n## Gotchas\n\n- keep me\n\n${structurallyStuckMarker()}\n`;

// One hit carrying `body`; returns the runner plus the recorded `--body` of
// the `issue edit` and `issue comment` calls.
function stuckRecordRunner(body, state = 'OPEN') {
  const seen = { calls: [], edited: null, commented: null };
  const runner = (args) => {
    seen.calls.push(args);
    if (args[0] === 'issue' && args[1] === 'list') {
      return JSON.stringify([{ number: 2724, title: 't', body, createdAt: '2024-01-01T00:00:00Z', state }]);
    }
    if (args[0] === 'issue' && args[1] === 'edit') seen.edited = args[args.indexOf('--body') + 1];
    if (args[0] === 'issue' && args[1] === 'comment') seen.commented = args[args.indexOf('--body') + 1];
    return '';
  };
  return { runner, seen };
}

test('#2724 AC3.1 AC3.2: escalate appends into the block and keeps the text around it byte-for-byte', () => {
  const { runner, seen } = stuckRecordRunner(SHAPED(renderStuckPathsBlock(['/x/run-a'])));
  const result = escalateResidue({ repo: 'o/r', reason: 'structurally-stuck', targetPath: '/x/run-b', count: 3, runner });
  assert.deepEqual(result, { status: 'appended', number: 2724 });
  assert.equal(seen.edited, SHAPED(renderStuckPathsBlock(['/x/run-a', '/x/run-b'])));
});

test('#2724 AC3.1 AC3.2: resolve removes its path from the block and keeps the text around it byte-for-byte', () => {
  const { runner, seen } = stuckRecordRunner(SHAPED(renderStuckPathsBlock(['/x/run-a', '/x/run-b'])));
  const result = resolveResidue({ repo: 'o/r', reason: 'structurally-stuck', targetPath: '/x/run-a', runner });
  assert.deepEqual(result, { status: 'path-removed', number: 2724 });
  assert.equal(seen.edited, SHAPED(renderStuckPathsBlock(['/x/run-b'])));
});

test('#2724 AC3.3: parseStuckPaths ignores a marker named in prose above the block', () => {
  assert.deepEqual(parseStuckPaths(SHAPED(renderStuckPathsBlock(['/x/run-a']))), ['/x/run-a']);
});

test('#2724 stuck-paths block: a CRLF body is still found and edited in place', () => {
  const crlf = SHAPED(renderStuckPathsBlock(['/x/run-a'])).replace(/\n/g, '\r\n');
  assert.deepEqual(parseStuckPaths(crlf), ['/x/run-a']);
  const { runner, seen } = stuckRecordRunner(crlf);
  escalateResidue({ repo: 'o/r', reason: 'structurally-stuck', targetPath: '/x/run-b', count: 3, runner });
  assert.equal(seen.edited, SHAPED(renderStuckPathsBlock(['/x/run-a', '/x/run-b'])).replace(/\n/g, '\r\n'));
  assert.deepEqual(parseStuckPaths(seen.edited), ['/x/run-a', '/x/run-b']);
});

test('#2724 escalate: reopening a CLOSED record re-renders the full canonical body', () => {
  const { runner, seen } = stuckRecordRunner(SHAPED(renderStuckPathsBlock(['/x/run-old'])), 'CLOSED');
  const result = escalateResidue({ repo: 'o/r', reason: 'structurally-stuck', targetPath: '/x/run-new', count: 3, runner });
  assert.deepEqual(result, { status: 'reopened', number: 2724 });
  assert.equal(seen.edited, structurallyStuckBody(['/x/run-old', '/x/run-new']));
});

test('#2724 stuck-paths block: a path containing a dollar sign survives the in-place edit', () => {
  const { runner, seen } = stuckRecordRunner(SHAPED(renderStuckPathsBlock(['/x/run-a'])));
  escalateResidue({ repo: 'o/r', reason: 'structurally-stuck', targetPath: '/x/run-$&-b', count: 3, runner });
  assert.deepEqual(parseStuckPaths(seen.edited), ['/x/run-a', '/x/run-$&-b']);
});

test('#2724 withStuckPaths: a non-empty body with no block gets the block appended, an empty body gets the full render', () => {
  assert.equal(withStuckPaths('Human text.\n', ['/x/a']), `Human text.\n\n${renderStuckPathsBlock(['/x/a'])}\n`);
  assert.equal(withStuckPaths('', ['/x/a']), structurallyStuckBody(['/x/a']));
});

test('#2724 resolveResidue: structurally-stuck with a why text uses it in place of the on-disk wording', () => {
  const { runner, seen } = stuckRecordRunner(structurallyStuckBody(['/x/run-a', '/x/run-b']));
  const result = resolveResidue({
    repo: 'o/r', reason: 'structurally-stuck', targetPath: '/x/run-a', runner, why: 'is exempt here',
  });
  assert.deepEqual(result, { status: 'path-removed', number: 2724 });
  assert.equal(seen.commented, '`/x/run-a` is exempt here — removed from the stuck-paths list (1 path(s) still stuck).');
});

test('#2724 resolveResidue: a why text on the last remaining path closes the record with that wording', () => {
  const { runner, seen } = stuckRecordRunner(SHAPED(renderStuckPathsBlock(['/x/run-a'])));
  const result = resolveResidue({
    repo: 'o/r', reason: 'structurally-stuck', targetPath: '/x/run-a', runner, why: 'is exempt here',
  });
  assert.deepEqual(result, { status: 'closed', number: 2724 });
  assert.equal(seen.edited, SHAPED(renderStuckPathsBlock([])));
  assert.equal(seen.commented, '`/x/run-a` is exempt here — the last remaining stuck path. Closing.');
  assert.ok(seen.calls.some((c) => c[0] === 'issue' && c[1] === 'close'));
});

test('#2724 escalate: an OPEN record whose body lost its block gets the block appended, keeping the shaped text', () => {
  const shaped = `## Current State\n\nShaped by a human.\n\n${structurallyStuckMarker()}\n`;
  const { runner, seen } = stuckRecordRunner(shaped);
  const result = escalateResidue({ repo: 'o/r', reason: 'structurally-stuck', targetPath: '/x/run-a', count: 3, runner });
  assert.deepEqual(result, { status: 'appended', number: 2724 });
  assert.equal(seen.edited, `${shaped.trimEnd()}\n\n${renderStuckPathsBlock(['/x/run-a'])}\n`);
});

// #4202: the stuck-paths block converges — a listed path that pathExists reports gone
// is dropped on the next escalate/resolve edit. Opt-in: omitting pathExists keeps every path.

function existsExcept(...gonePaths) {
  return (p) => !gonePaths.includes(p);
}

test('#4202 AC3.1 AC3.2: escalate: an append drops a listed path pathExists reports gone, keeping the text around the block', () => {
  const pathExists = existsExcept('/x/gone-1');
  const { runner, seen } = stuckRecordRunner(SHAPED(renderStuckPathsBlock(['/x/run-a', '/x/gone-1'])));
  const result = escalateResidue({ repo: 'o/r', reason: 'structurally-stuck', targetPath: '/x/run-b', count: 3, runner, pathExists });
  assert.deepEqual(result, { status: 'appended', number: 2724 });
  assert.equal(seen.edited, SHAPED(renderStuckPathsBlock(['/x/run-a', '/x/run-b'])));
  assert.match(seen.commented, /gone-1/);
});

test('#4202 escalate: reopening a CLOSED record drops gone paths from the re-rendered body', () => {
  const pathExists = existsExcept('/x/gone-1');
  const { runner, seen } = stuckRecordRunner(SHAPED(renderStuckPathsBlock(['/x/gone-1', '/x/run-a'])), 'CLOSED');
  const result = escalateResidue({ repo: 'o/r', reason: 'structurally-stuck', targetPath: '/x/run-new', count: 3, runner, pathExists });
  assert.deepEqual(result, { status: 'reopened', number: 2724 });
  assert.equal(seen.edited, structurallyStuckBody(['/x/run-a', '/x/run-new']));
  assert.equal(seen.commented, 'Reconcile is seeing `/x/run-new` stuck at structurally-stuck again — reopening rather than filing a duplicate (dropped 1 path(s) no longer on disk: `/x/gone-1`).');
});

test('#4202 AC3.1 AC3.2: resolve: removing a path also drops gone paths and closes when nothing live remains', () => {
  const pathExists = existsExcept('/x/gone-1', '/x/gone-2');
  const { runner, seen } = stuckRecordRunner(SHAPED(renderStuckPathsBlock(['/x/run-a', '/x/gone-1', '/x/gone-2'])));
  const result = resolveResidue({ repo: 'o/r', reason: 'structurally-stuck', targetPath: '/x/run-a', runner, pathExists });
  assert.deepEqual(result, { status: 'closed', number: 2724 });
  assert.equal(seen.edited, SHAPED(renderStuckPathsBlock([])));
  assert.ok(seen.calls.some((c) => c[0] === 'issue' && c[1] === 'close'));
  assert.match(seen.commented, /gone-1/);
  assert.match(seen.commented, /gone-2/);
});

test('#4202 resolve: a CRLF body with a gone path stays CRLF and keeps live paths', () => {
  const pathExists = existsExcept('/x/gone-1');
  const crlf = SHAPED(renderStuckPathsBlock(['/x/run-a', '/x/gone-1', '/x/run-b'])).replace(/\n/g, '\r\n');
  const { runner, seen } = stuckRecordRunner(crlf);
  const result = resolveResidue({ repo: 'o/r', reason: 'structurally-stuck', targetPath: '/x/run-a', runner, pathExists });
  assert.deepEqual(result, { status: 'path-removed', number: 2724 });
  assert.equal(seen.edited, SHAPED(renderStuckPathsBlock(['/x/run-b'])).replace(/\n/g, '\r\n'));
  assert.equal(seen.commented, '`/x/run-a` no longer exists on disk — resolved by other means, removed from the stuck-paths list (1 path(s) still stuck) (dropped 1 path(s) no longer on disk: `/x/gone-1`).');
});

test('#4202 escalate: a pathExists that throws keeps the path instead of failing the edit', () => {
  const pathExists = () => { throw new Error('lstat exploded'); };
  const { runner, seen } = stuckRecordRunner(SHAPED(renderStuckPathsBlock(['/x/run-a'])));
  const result = escalateResidue({ repo: 'o/r', reason: 'structurally-stuck', targetPath: '/x/run-b', count: 3, runner, pathExists });
  assert.deepEqual(result, { status: 'appended', number: 2724 });
  assert.equal(seen.edited, SHAPED(renderStuckPathsBlock(['/x/run-a', '/x/run-b'])));
});

test('#4202 resolve: an OPEN record whose list an earlier failed resolve already emptied is closed by the retry', () => {
  const { runner, seen } = stuckRecordRunner(SHAPED(renderStuckPathsBlock([])));
  const result = resolveResidue({ repo: 'o/r', reason: 'structurally-stuck', targetPath: '/x/run-a', runner });
  assert.deepEqual(result, { status: 'closed', number: 2724 });
  assert.equal(seen.edited, null);
  assert.equal(seen.commented, 'The stuck-paths list is empty. Closing.');
  assert.ok(seen.calls.some((c) => c[0] === 'issue' && c[1] === 'close'));
});

test('#4202 escalate: an already-named path on an OPEN record stays a plain dedup-hit even with gone paths listed', () => {
  const pathExists = existsExcept('/x/gone-1');
  const { runner, seen } = stuckRecordRunner(SHAPED(renderStuckPathsBlock(['/x/run-a', '/x/gone-1'])));
  const result = escalateResidue({ repo: 'o/r', reason: 'structurally-stuck', targetPath: '/x/run-a', count: 3, runner, pathExists });
  assert.deepEqual(result, { status: 'dedup-hit', number: 2724 });
  assert.equal(seen.edited, null);
});
