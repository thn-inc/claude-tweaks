'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { run, parseArgs } = require('../../../plugin/bin/closing-links');

const RUN_ID = '2026-10-25T000001-record-4199';
const FOREIGN_RUN_ID = '2026-01-01T000000-record-9';
const PR_URL = 'https://github.com/thn-inc/claude-tweaks/pull/7';
const MERGED_AT = '2026-10-24T18:52:32Z';
const CLOSED_AFTER = '2026-10-24T18:52:34Z';
const CLOSED_BEFORE = '2026-10-24T10:00:00Z';
const REOPEN_COMMENT = 'Reopened by claude-tweaks: PR #7\'s merge closed this record, but the run left it open (not in the PR\'s Fixes block).';

const created = [];
test.after(() => {
  for (const dir of created) fs.rmSync(dir, { recursive: true, force: true });
});

// Fake-.git anchored fixture, same shape as pr-checklist-cli.test.js: a main
// checkout's .git is a directory; mainRoot is injected so resolveTarget never
// spawns git.
function fixture(runState) {
  const main = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-closinglinks-cli-'));
  created.push(main);
  fs.mkdirSync(path.join(main, '.git'), { recursive: true });
  const runDir = path.join(main, '.claude-tweaks', 'pipelines', RUN_ID);
  fs.mkdirSync(runDir, { recursive: true });
  if (runState) fs.writeFileSync(path.join(runDir, 'run-state.json'), JSON.stringify(runState));
  return { main, runDir };
}

const sameRepoRef = (number) => ({ number, repository: { name: 'claude-tweaks', owner: { login: 'thn-inc' } } });
const refsOf = (...numbers) => numbers.map(sameRepoRef);

// The #4144 shape: a run marker, a Spec summary that says "closes #2724", and
// a fixes span carrying one expected record plus one deferred one whose reason
// repeats the phrase.
function body({ runId = RUN_ID, summary = 'The reconcile pass that closes #2724 still needs the main checkout.', span } = {}) {
  const lines = span || [
    'Fixes #3997',
    'Refs #2724 — deferred: the pass that closes #2724 is pending',
  ];
  return [
    `<!-- claude-tweaks-run: ${runId} -->`,
    '## Spec summary',
    summary,
    '',
    '<!-- fixes-start -->',
    ...lines,
    '<!-- fixes-end -->',
    '',
  ].join('\n');
}

// A fake gh answering by exact argv shape; anything else throws. Reads of a
// kind that has a queue (`prReads`, `rereads`, `issues[n]`) consume it, the
// last entry repeating.
function makeDeps(main, {
  prReads = [], rereads = [], message = 'fix: x (#3997)\n\nFixes #3997', issues = {}, ghAvailable = true,
  reopenThrows = null, messageThrows = false, issueThrows = {}, ...over
} = {}) {
  const out = []; const err = []; const calls = []; const sleeps = [];
  const next = (queue) => (queue.length > 1 ? queue.shift() : queue[0]);
  const h = {
    deps: {
      cwd: () => main,
      mainRoot: main,
      ghAvailable: () => ghAvailable,
      gh: (args, input) => {
        calls.push({ args, input });
        const key = args.join(' ');
        if (args[0] === 'pr' && args[1] === 'view' && args[4] === 'body,closingIssuesReferences,url') {
          const r = next(prReads);
          if (r instanceof Error) throw r;
          return JSON.stringify(r);
        }
        if (args[0] === 'pr' && args[1] === 'view' && args[4] === 'state,mergedAt,body,closingIssuesReferences,url,mergeCommit') {
          const r = next(prReads);
          if (r instanceof Error) throw r;
          return JSON.stringify(r);
        }
        if (key === 'pr view 7 --json closingIssuesReferences') {
          const r = next(rereads);
          if (r instanceof Error) throw r;
          return JSON.stringify({ closingIssuesReferences: r });
        }
        if (args[0] === 'pr' && args[1] === 'edit') return '';
        if (args[0] === 'api' && args[1].startsWith('repos/{owner}/{repo}/commits/') && args[2] === '--jq' && args[3] === '.commit.message') {
          if (messageThrows) throw new Error('boom');
          return `${message}\n`;
        }
        if (args[0] === 'issue' && args[1] === 'view' && args[3] === '--json' && args[4] === 'state,closedAt') {
          if (issueThrows[args[2]]) throw new Error('issue read failed');
          const q = issues[args[2]];
          if (!q) throw new Error(`unexpected issue ${args[2]}`);
          return JSON.stringify(next(q));
        }
        if (args[0] === 'issue' && args[1] === 'reopen' && args[3] === '--comment') {
          if (reopenThrows) throw new Error(reopenThrows);
          return '';
        }
        throw new Error(`unexpected ${key}`);
      },
      sleep: (ms) => sleeps.push(ms),
      stdout: (s) => out.push(s),
      stderr: (s) => err.push(s),
      ...over,
    },
    out, err, calls, sleeps,
    json: () => JSON.parse(out.join('')),
    edits: () => calls.filter((c) => c.args[0] === 'pr' && c.args[1] === 'edit'),
    reopens: () => calls.filter((c) => c.args[0] === 'issue' && c.args[1] === 'reopen'),
    issueReads: () => calls.filter((c) => c.args[0] === 'issue' && c.args[1] === 'view'),
    log: (runDir) => { try { return fs.readFileSync(path.join(runDir, 'decisions.md'), 'utf8'); } catch { return ''; } },
  };
  return h;
}

const preView = (b, nums, extra = {}) => ({ body: b, closingIssuesReferences: refsOf(...nums), url: PR_URL, ...extra });
const mergedView = (b, nums, extra = {}) => ({
  state: 'MERGED', mergedAt: MERGED_AT, body: b, closingIssuesReferences: refsOf(...nums), url: PR_URL,
  mergeCommit: { oid: 'd36f5f6a0000000000000000000000000000abcd' }, ...extra,
});

const PRE = ['--mode', 'pre-merge'];
const POST = ['--mode', 'post-merge'];

test('parseArgs: shapes and rejections', () => {
  assert.deepEqual(parseArgs(['--run', 'r', '--mode', 'pre-merge']), { run: 'r', mode: 'pre-merge', settleMs: 15000, help: false });
  assert.equal(parseArgs(['--run', 'r', '--mode', 'post-merge', '--settle-ms', '0']).settleMs, 0);
  assert.equal(parseArgs(['--help']).help, true);
  assert.ok(parseArgs(['--bogus']).error);
  assert.ok(parseArgs(['--run', 'r', '--mode', 'bogus']).error);
  assert.ok(parseArgs(['--run', 'r', '--mode', 'pre-merge', '--settle-ms']).error);
  assert.ok(parseArgs(['--run', 'r', '--mode', 'pre-merge', '--settle-ms', '-1']).error);
  assert.ok(parseArgs(['--run', 'r', '--mode', 'pre-merge', '--settle-ms', '1.5']).error);
  assert.ok(parseArgs(['--run', '', '--mode', 'pre-merge']).error);
  // Object.hasOwn: an inherited key is not a flag.
  assert.ok(parseArgs(['constructor']).error);
  assert.ok(parseArgs(['--toString', 'x']).error);
});

test('AC2.1 pre-merge unlinks a stale closing reference', () => {
  const { main, runDir } = fixture({ pr: { number: 7 } });
  const h = makeDeps(main, { prReads: [preView(body(), [2724, 3997])], rereads: [refsOf(3997)] });
  assert.equal(run(['--run', runDir, ...PRE], h.deps), 0);
  const j = h.json();
  assert.equal(j.action, 'unlinked');
  assert.equal(j.pr, 7);
  assert.deepEqual(j.expected, [3997]);
  assert.deepEqual(j.keepOpen, [2724]);
  assert.deepEqual(j.linked, [2724, 3997]);
  assert.deepEqual(j.unwanted, [2724]);
  assert.deepEqual(j.unlinked, [2724]);
  assert.deepEqual(j.stillLinked, []);
  assert.equal(j.neutralized, 2);
  assert.equal(h.edits().length, 1);
  assert.deepEqual(h.edits()[0].args, ['pr', 'edit', '7', '--body-file', '-']);
  const written = h.edits()[0].input;
  assert.ok(written.includes('closes issue #2724'));
  assert.ok(!/closes #2724/.test(written));
  assert.ok(written.includes('Fixes #3997\n'));
  assert.ok(written.startsWith(`<!-- claude-tweaks-run: ${RUN_ID} -->`));
  const log = h.log(runDir);
  assert.match(log, /unlinked #2724 from PR #7 before merge \(neutralized 2 closing-keyword phrase\(s\)\)/);
  assert.match(log, /Closing links/);
  assert.match(log, /Reversibility: high/);
});

test('AC2.1 pre-merge reports a link that survives neutralizing', () => {
  const { main, runDir } = fixture({ pr: { number: 7 } });
  const h = makeDeps(main, { prReads: [preView(body(), [2724, 3997])], rereads: [refsOf(2724, 3997)] });
  assert.equal(run(['--run', runDir, ...PRE], h.deps), 0);
  const j = h.json();
  assert.equal(j.action, 'still-linked');
  assert.deepEqual(j.stillLinked, [2724]);
  assert.deepEqual(j.unlinked, []);
  const log = h.log(runDir);
  assert.match(log, /#2724 still linked to PR #7 after neutralizing/);
  assert.match(log, /post-merge step reopens it/);
  assert.ok(!/unlinked #2724/.test(log));
});

test('AC3.1 a stale reference with no keyword phrase is still reported', () => {
  // A Development-sidebar link: closingIssuesReferences names #2724 but no
  // phrase in the body does. Nothing to rewrite, so no write, but the re-read
  // must still happen and the link must still be reported.
  const { main, runDir } = fixture({ pr: { number: 7 } });
  const plain = body({ summary: 'A summary with no closing phrase.', span: ['Fixes #3997', 'Refs #2724 — deferred: pending a later step'] });
  const h = makeDeps(main, { prReads: [preView(plain, [2724, 3997])], rereads: [refsOf(2724, 3997)] });
  assert.equal(run(['--run', runDir, ...PRE], h.deps), 0);
  const j = h.json();
  assert.equal(j.action, 'still-linked');
  assert.deepEqual(j.stillLinked, [2724]);
  assert.equal(j.neutralized, 0);
  assert.equal(h.edits().length, 0);
  assert.ok(h.calls.some((c) => c.args.join(' ') === 'pr view 7 --json closingIssuesReferences'));
  assert.match(h.log(runDir), /#2724 still linked to PR #7/);
});

test('pre-merge with an unchanged body but a link that cleared reports unlinked, no write', () => {
  const { main, runDir } = fixture({ pr: { number: 7 } });
  const plain = body({ summary: 'No phrase.', span: ['Fixes #3997', 'Refs #2724 — deferred: pending'] });
  const h = makeDeps(main, { prReads: [preView(plain, [2724, 3997])], rereads: [refsOf(3997)] });
  assert.equal(run(['--run', runDir, ...PRE], h.deps), 0);
  assert.equal(h.json().action, 'unlinked');
  assert.equal(h.edits().length, 0);
});

test('pre-merge clean: nothing unwanted means no edit and no decisions line', () => {
  const { main, runDir } = fixture({ pr: { number: 7 } });
  const h = makeDeps(main, { prReads: [preView(body(), [3997])] });
  assert.equal(run(['--run', runDir, ...PRE], h.deps), 0);
  assert.equal(h.json().action, 'clean');
  assert.equal(h.edits().length, 0);
  assert.equal(h.calls.length, 1);
  assert.equal(h.log(runDir), '');
});

test('pre-merge: a body with no fixes span is no-fixes-span, no write', () => {
  const { main, runDir } = fixture({ pr: { number: 7 } });
  const h = makeDeps(main, { prReads: [preView(`<!-- claude-tweaks-run: ${RUN_ID} -->\nresolves #2724\n`, [2724])] });
  assert.equal(run(['--run', runDir, ...PRE], h.deps), 0);
  assert.deepEqual(h.json(), { action: 'no-fixes-span', pr: 7 });
  assert.equal(h.edits().length, 0);
});

test('cross-repo closing reference is ignored', () => {
  const { main, runDir } = fixture({ pr: { number: 7 } });
  const other = { number: 2724, repository: { name: 'other', owner: { login: 'someone' } } };
  const h = makeDeps(main, {
    prReads: [{ body: body(), closingIssuesReferences: [other, sameRepoRef(3997)], url: PR_URL }],
  });
  assert.equal(run(['--run', runDir, ...PRE], h.deps), 0);
  const j = h.json();
  assert.equal(j.action, 'clean');
  assert.deepEqual(j.linked, [3997]);
  assert.equal(h.edits().length, 0);
});

test('pre-merge refuses another run\'s PR: exit 4, nothing written', () => {
  const { main, runDir } = fixture({ pr: { number: 7 } });
  const h = makeDeps(main, { prReads: [preView(body({ runId: FOREIGN_RUN_ID }), [2724, 3997])], rereads: [refsOf(3997)] });
  assert.equal(run(['--run', runDir, ...PRE], h.deps), 4);
  assert.match(h.err.join(''), /run marker mismatch on PR #7/);
  assert.equal(h.edits().length, 0);
});

test('pre-merge gh view failure is exit 5', () => {
  const { main, runDir } = fixture({ pr: { number: 7 } });
  const h = makeDeps(main, { prReads: [new Error('network down')] });
  assert.equal(run(['--run', runDir, ...PRE], h.deps), 5);
  assert.match(h.err.join(''), /gh pr view failed on PR #7/);
});

test('pre-merge: a view with no string body is exit 5', () => {
  const { main, runDir } = fixture({ pr: { number: 7 } });
  const h = makeDeps(main, { prReads: [{ body: null, closingIssuesReferences: [], url: PR_URL }] });
  assert.equal(run(['--run', runDir, ...PRE], h.deps), 5);
  assert.equal(h.edits().length, 0);
});

test('pre-merge edit failure and re-read failure are exit 5', () => {
  const a = fixture({ pr: { number: 7 } });
  const hEdit = makeDeps(a.main, { prReads: [preView(body(), [2724, 3997])], rereads: [refsOf(3997)] });
  const real = hEdit.deps.gh;
  hEdit.deps.gh = (args, input) => {
    if (args[1] === 'edit') throw new Error('edit refused');
    return real(args, input);
  };
  assert.equal(run(['--run', a.runDir, ...PRE], hEdit.deps), 5);
  assert.match(hEdit.err.join(''), /gh pr edit failed on PR #7/);

  const b = fixture({ pr: { number: 7 } });
  const hRead = makeDeps(b.main, { prReads: [preView(body(), [2724, 3997])], rereads: [new Error('flaky')] });
  assert.equal(run(['--run', b.runDir, ...PRE], hRead.deps), 5);
  assert.match(hRead.err.join(''), /gh pr view failed on PR #7/);
});

test('a decisions.md write failure is swallowed into the envelope, never an exit change', () => {
  const { main, runDir } = fixture({ pr: { number: 7 } });
  const h = makeDeps(main, {
    prReads: [preView(body(), [2724, 3997])], rereads: [refsOf(3997)],
    appendDecision: () => { throw new Error('disk full'); },
  });
  assert.equal(run(['--run', runDir, ...PRE], h.deps), 0);
  const j = h.json();
  assert.equal(j.action, 'unlinked');
  assert.equal(j.logFailed, true);
});

test('no-pr and gh-absent envelopes exit 0', () => {
  const a = fixture({ status: 'active' });
  const hNo = makeDeps(a.main);
  assert.equal(run(['--run', a.runDir, ...PRE], hNo.deps), 0);
  assert.deepEqual(hNo.json(), { action: 'no-pr' });
  assert.equal(hNo.calls.length, 0);

  const b = fixture({ pr: { number: 7 } });
  const hAbsent = makeDeps(b.main, { ghAvailable: false });
  assert.equal(run(['--run', b.runDir, ...POST], hAbsent.deps), 0);
  assert.deepEqual(hAbsent.json(), { action: 'gh-absent', pr: 7 });
  assert.equal(hAbsent.calls.length, 0);
});

test('unanchored run dir exits 3', () => {
  const { main } = fixture({ pr: { number: 7 } });
  // A linked worktree's .git is a file: a run dir under it is a worktree-local shadow.
  const wt = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-closinglinks-wt-'));
  created.push(wt);
  fs.writeFileSync(path.join(wt, '.git'), 'gitdir: /elsewhere\n');
  const shadow = path.join(wt, '.claude-tweaks', 'pipelines', RUN_ID);
  fs.mkdirSync(shadow, { recursive: true });
  fs.writeFileSync(path.join(shadow, 'run-state.json'), JSON.stringify({ pr: { number: 7 } }));
  const h = makeDeps(main, { prReads: [preView(body(), [3997])] });
  assert.equal(run(['--run', shadow, ...PRE], h.deps), 3);
  assert.match(h.err.join(''), /not anchored under the main checkout/);
  assert.equal(h.calls.length, 0);
});

test('missing run dir exits 3', () => {
  const { main } = fixture({ pr: { number: 7 } });
  const h = makeDeps(main);
  assert.equal(run(['--run', path.join(main, '.claude-tweaks', 'pipelines', 'nope'), ...PRE], h.deps), 3);
  assert.match(h.err.join(''), /run dir does not exist/);
});

test('usage errors exit 2', () => {
  const { main, runDir } = fixture({ pr: { number: 7 } });
  const exit = (argv) => { const h = makeDeps(main); const code = run(argv, h.deps); assert.equal(h.calls.length, 0); return code; };
  assert.equal(exit(['--run', runDir]), 2);
  assert.equal(exit(['--run', runDir, '--mode', 'bogus']), 2);
  assert.equal(exit(['--mode', 'pre-merge']), 2);
  assert.equal(exit(['--run', runDir, '--mode', 'pre-merge', '--settle-ms']), 2);
  assert.equal(exit(['--run', runDir, '--mode', 'pre-merge', '--settle-ms', '-1']), 2);
  assert.equal(exit(['--run', runDir, '--mode', 'pre-merge', '--settle-ms', '']), 2);
});

test('--help exits 0 without touching gh', () => {
  const { main } = fixture({ pr: { number: 7 } });
  const h = makeDeps(main);
  assert.equal(run(['--help'], h.deps), 0);
  const usage = h.out.join('');
  assert.match(usage, /usage: closing-links\.js --run <run-dir> --mode/);
  assert.match(usage, /4 run marker mismatch/);
  assert.equal(h.calls.length, 0);
});

// ---- post-merge ----

test('AC2.1 post-merge reopens a deferred record the merge closed', () => {
  const { main, runDir } = fixture({ pr: { number: 7 } });
  const h = makeDeps(main, {
    prReads: [mergedView(body(), [2724, 3997])],
    issues: { 2724: [{ state: 'CLOSED', closedAt: CLOSED_AFTER }] },
  });
  assert.equal(run(['--run', runDir, ...POST], h.deps), 0);
  const j = h.json();
  assert.equal(j.action, 'reopened');
  assert.deepEqual(j.candidates, [2724]);
  assert.deepEqual(j.willClose, [2724]);
  assert.deepEqual(j.reopened, [2724]);
  assert.deepEqual(j.failed, []);
  assert.equal(h.reopens().length, 1);
  assert.deepEqual(h.reopens()[0].args, ['issue', 'reopen', '2724', '--comment', REOPEN_COMMENT]);
  const log = h.log(runDir);
  assert.match(log, /reopened #2724 after PR #7's merge closed it \(closing link or merge-commit keyword\)/);
  assert.match(log, /Closing links/);
  assert.match(log, /Reversibility: high/);
  // The merge message was read through the commits API.
  assert.ok(h.calls.some((c) => c.args[0] === 'api' && c.args[1] === 'repos/{owner}/{repo}/commits/d36f5f6a0000000000000000000000000000abcd'));
});

test('post-merge polls a will-close candidate until it closes', () => {
  const { main, runDir } = fixture({ pr: { number: 7 } });
  const h = makeDeps(main, {
    prReads: [mergedView(body(), [2724, 3997])],
    issues: { 2724: [{ state: 'OPEN', closedAt: null }, { state: 'CLOSED', closedAt: CLOSED_AFTER }] },
  });
  assert.equal(run(['--run', runDir, ...POST, '--settle-ms', '15000'], h.deps), 0);
  assert.equal(h.json().action, 'reopened');
  assert.equal(h.reopens().length, 1);
  assert.deepEqual(h.sleeps, [3000]);
  assert.equal(h.issueReads().length, 2);
});

test('post-merge polling is bounded by re-read count, floor(settleMs / 3000)', () => {
  const { main, runDir } = fixture({ pr: { number: 7 } });
  const h = makeDeps(main, {
    prReads: [mergedView(body(), [2724, 3997])],
    issues: { 2724: [{ state: 'OPEN', closedAt: null }] },
  });
  // A constant clock must not hang the loop.
  assert.equal(run(['--run', runDir, ...POST, '--settle-ms', '7000'], { ...h.deps, now: () => new Date(0) }), 0);
  const j = h.json();
  assert.equal(j.action, 'nothing-closed');
  assert.deepEqual(j.stillOpen, [2724]);
  assert.deepEqual(h.sleeps, [3000, 3000]);
  assert.equal(h.issueReads().length, 3);
  assert.equal(h.reopens().length, 0);
});

test('post-merge --settle-ms 0 reads once and never sleeps', () => {
  const { main, runDir } = fixture({ pr: { number: 7 } });
  const h = makeDeps(main, {
    prReads: [mergedView(body(), [2724, 3997])],
    issues: { 2724: [{ state: 'OPEN', closedAt: null }, { state: 'CLOSED', closedAt: CLOSED_AFTER }] },
  });
  assert.equal(run(['--run', runDir, ...POST, '--settle-ms', '0'], h.deps), 0);
  assert.deepEqual(h.json().stillOpen, [2724]);
  assert.deepEqual(h.sleeps, []);
  assert.equal(h.issueReads().length, 1);
});

test('post-merge does not poll a candidate nothing will close', () => {
  const { main, runDir } = fixture({ pr: { number: 7 } });
  const plain = body({ summary: 'No phrase.', span: ['Fixes #3997', 'Refs #2724 — deferred: pending'] });
  const h = makeDeps(main, {
    prReads: [mergedView(plain, [3997])],
    issues: { 2724: [{ state: 'OPEN', closedAt: null }] },
  });
  assert.equal(run(['--run', runDir, ...POST], h.deps), 0);
  const j = h.json();
  assert.equal(j.action, 'nothing-closed');
  assert.deepEqual(j.candidates, [2724]);
  assert.deepEqual(j.willClose, []);
  assert.deepEqual(j.stillOpen, [2724]);
  assert.deepEqual(h.sleeps, []);
  assert.equal(h.issueReads().length, 1);
});

test('post-merge leaves a record closed before the merge alone', () => {
  const { main, runDir } = fixture({ pr: { number: 7 } });
  const h = makeDeps(main, {
    prReads: [mergedView(body(), [2724, 3997])],
    issues: { 2724: [{ state: 'CLOSED', closedAt: CLOSED_BEFORE }] },
  });
  assert.equal(run(['--run', runDir, ...POST], h.deps), 0);
  const j = h.json();
  assert.equal(j.action, 'nothing-closed');
  assert.deepEqual(j.closedBefore, [2724]);
  assert.equal(h.reopens().length, 0);
  assert.equal(h.log(runDir), '');
});

test('post-merge reopens a single-record deferral closed by the merge-commit keyword', () => {
  const { main, runDir } = fixture({ pr: { number: 7 } });
  const single = body({ summary: 'No phrase.', span: ['Refs #10 — deferred: x'] });
  const h = makeDeps(main, {
    prReads: [mergedView(single, [])],
    message: 'fix: x (#7)\n\nFixes #10',
    issues: { 10: [{ state: 'CLOSED', closedAt: CLOSED_AFTER }] },
  });
  assert.equal(run(['--run', runDir, ...POST], h.deps), 0);
  const j = h.json();
  assert.equal(j.action, 'reopened');
  assert.deepEqual(j.candidates, [10]);
  assert.deepEqual(j.willClose, [10]);
  assert.deepEqual(j.reopened, [10]);
});

test('post-merge never reopens an expected record', () => {
  const { main, runDir } = fixture({ pr: { number: 7 } });
  const h = makeDeps(main, {
    prReads: [mergedView(body({ span: ['Fixes #3997'] }), [3997])],
  });
  assert.equal(run(['--run', runDir, ...POST], h.deps), 0);
  const j = h.json();
  assert.equal(j.action, 'nothing-closed');
  assert.deepEqual(j.candidates, []);
  assert.equal(h.issueReads().length, 0);
});

test('post-merge not-merged: no issue reads', () => {
  const { main, runDir } = fixture({ pr: { number: 7 } });
  const h = makeDeps(main, { prReads: [mergedView(body(), [2724, 3997], { state: 'OPEN', mergedAt: null })] });
  assert.equal(run(['--run', runDir, ...POST], h.deps), 0);
  assert.deepEqual(h.json(), { action: 'not-merged', pr: 7, state: 'OPEN' });
  assert.equal(h.issueReads().length, 0);
});

test('post-merge reopen failure is data', () => {
  const { main, runDir } = fixture({ pr: { number: 7 } });
  const h = makeDeps(main, {
    prReads: [mergedView(body(), [2724, 3997])],
    issues: { 2724: [{ state: 'CLOSED', closedAt: CLOSED_AFTER }] },
    reopenThrows: 'forbidden',
  });
  assert.equal(run(['--run', runDir, ...POST], h.deps), 0);
  const j = h.json();
  assert.equal(j.action, 'reopen-failed');
  assert.equal(j.failed.length, 1);
  assert.equal(j.failed[0].issue, 2724);
  assert.match(j.failed[0].error, /forbidden/);
  assert.deepEqual(j.reopened, []);
  assert.match(h.log(runDir), /could not reopen #2724 after PR #7's merge/);
  assert.match(h.log(runDir), /reopen it by hand/);
});

test('post-merge issue-read failure is data', () => {
  const { main, runDir } = fixture({ pr: { number: 7 } });
  const h = makeDeps(main, { prReads: [mergedView(body(), [2724, 3997])], issueThrows: { 2724: true } });
  assert.equal(run(['--run', runDir, ...POST], h.deps), 0);
  const j = h.json();
  assert.equal(j.action, 'reopen-failed');
  assert.equal(j.failed[0].issue, 2724);
});

test('post-merge merge-message read failure degrades to messageUnread, never exit 5', () => {
  const { main, runDir } = fixture({ pr: { number: 7 } });
  const h = makeDeps(main, {
    prReads: [mergedView(body(), [2724, 3997])],
    messageThrows: true,
    issues: { 2724: [{ state: 'CLOSED', closedAt: CLOSED_AFTER }] },
  });
  assert.equal(run(['--run', runDir, ...POST], h.deps), 0);
  const j = h.json();
  assert.equal(j.messageUnread, true);
  assert.equal(j.action, 'reopened');
});

test('post-merge gh view failure is exit 5', () => {
  const { main, runDir } = fixture({ pr: { number: 7 } });
  const h = makeDeps(main, { prReads: [new Error('network down')] });
  assert.equal(run(['--run', runDir, ...POST], h.deps), 5);
});
