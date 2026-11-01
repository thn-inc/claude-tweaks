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
const REOPEN_COMMENT = 'Reopened by claude-tweaks: this record was closed after PR #7 merged, but the run left it open (not in the PR\'s Fixes block).';

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
  reopenThrows = null, messageThrows = false, issueThrows = {}, defaultBranch = 'main', defaultBranchThrows = false,
  closeThrows = {}, ...over
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
        if (args[0] === 'pr' && args[1] === 'view' && args[4] === 'state,mergedAt,body,closingIssuesReferences,url,mergeCommit,baseRefName') {
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
        if (args[0] === 'repo' && args[1] === 'view' && args[3] === '--json' && args[4] === 'defaultBranchRef'
          && args[5] === '-q' && args[6] === '.defaultBranchRef.name') {
          if (defaultBranchThrows) throw new Error('repo view failed');
          return `${defaultBranch}\n`;
        }
        if (args[0] === 'issue' && args[1] === 'close' && args[3] === '--reason' && args[4] === 'completed' && args[5] === '--comment') {
          if (closeThrows[args[2]]) throw new Error(closeThrows[args[2]]);
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
    closes: () => calls.filter((c) => c.args[0] === 'issue' && c.args[1] === 'close'),
    issueReads: () => calls.filter((c) => c.args[0] === 'issue' && c.args[1] === 'view'),
    log: (runDir) => { try { return fs.readFileSync(path.join(runDir, 'decisions.md'), 'utf8'); } catch { return ''; } },
  };
  return h;
}

const preView = (b, nums, extra = {}) => ({ body: b, closingIssuesReferences: refsOf(...nums), url: PR_URL, ...extra });
const mergedView = (b, nums, extra = {}) => ({
  state: 'MERGED', mergedAt: MERGED_AT, body: b, closingIssuesReferences: refsOf(...nums), url: PR_URL,
  mergeCommit: { oid: 'd36f5f6a0000000000000000000000000000abcd' }, baseRefName: 'main', ...extra,
});

const PRE = ['--mode', 'pre-merge'];
const POST = ['--mode', 'post-merge'];

test('parseArgs: shapes and rejections', () => {
  assert.deepEqual(parseArgs(['--run', 'r', '--mode', 'pre-merge']), { run: 'r', mode: 'pre-merge', settleMs: 15000, closeWindowMs: null, help: false });
  assert.equal(parseArgs(['--run', 'r', '--mode', 'post-merge', '--settle-ms', '0']).settleMs, 0);
  assert.equal(parseArgs(['--help']).help, true);
  assert.ok(parseArgs(['--bogus']).error);
  assert.ok(parseArgs(['--run', 'r', '--mode', 'bogus']).error);
  assert.ok(parseArgs(['--run', 'r', '--mode', 'pre-merge', '--settle-ms']).error);
  assert.ok(parseArgs(['--run', 'r', '--mode', 'pre-merge', '--settle-ms', '-1']).error);
  assert.ok(parseArgs(['--run', 'r', '--mode', 'pre-merge', '--settle-ms', '1.5']).error);
  assert.equal(parseArgs(['--run', 'r', '--mode', 'pre-merge', '--settle-ms', '60000']).settleMs, 60000);
  assert.match(parseArgs(['--run', 'r', '--mode', 'pre-merge', '--settle-ms', '60001']).error, /capped at 60000/);
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
  // Not acted on, no staged artifact: a Degrade-trace SKIP line, never AUTO.
  assert.match(log, /^- SKIP \d{2}:\d{2}:\d{2} — Closing links \(degraded\): condition: #2724 still linked .* → fallback: .*Reversibility: n\/a\.$/m);
  assert.doesNotMatch(log, /^- AUTO /m);
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

test('pre-merge marker refusal is unconditional: a foreign body with no closing phrase is exit 4, no re-read, no edit, only the refusal logged', () => {
  const { main, runDir } = fixture({ pr: { number: 7 } });
  const plain = body({ runId: FOREIGN_RUN_ID, summary: 'No phrase.', span: ['Fixes #3997', 'Refs #2724 — deferred: pending'] });
  const h = makeDeps(main, { prReads: [preView(plain, [2724, 3997])], rereads: [refsOf(2724, 3997)] });
  assert.equal(run(['--run', runDir, ...PRE], h.deps), 4);
  assert.match(h.err.join(''), /run marker mismatch on PR #7/);
  assert.equal(h.edits().length, 0);
  assert.equal(h.calls.length, 1);
  // #4026: the refusal's own SKIP is the only line -- no unlink or still-linked outcome.
  const lines = h.log(runDir).split('\n').filter((l) => l.startsWith('- '));
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^- SKIP \d{2}:\d{2}:\d{2} — Closing links \(pre-merge\) \(degraded\): condition: closing-links\.js exit 4 run marker mismatch/);
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
  // The body write landed before the failed re-read, so the unlink is not left unaudited.
  assert.match(hRead.log(b.runDir), /^- SKIP \d{2}:\d{2}:\d{2} — Closing links \(degraded\): condition: PR #7 body rewritten \(\d+ closing phrase\(s\) neutralized\) but the re-read of its links failed → fallback: re-run --mode pre-merge to confirm #2724 unlinked/m);
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
  assert.equal(exit(['--run', runDir, '--mode', 'post-merge', '--settle-ms', '60001']), 2);
});

test('--help exits 0 without touching gh', () => {
  const { main } = fixture({ pr: { number: 7 } });
  const h = makeDeps(main);
  assert.equal(run(['--help'], h.deps), 0);
  const usage = h.out.join('');
  assert.match(usage, /usage: closing-links\.js --run <run-dir> --mode/);
  assert.match(usage, /4 run marker mismatch/);
  assert.match(usage, /reopen-failed > close-failed > base-unchecked > close-pending > reopened > closed > nothing-closed/);
  assert.match(usage, /5 gh pr view \/ gh pr edit failed, or a required read came back malformed/);
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
  assert.match(log, /^- AUTO \d{2}:\d{2}:\d{2} — Closing links: reopened #2724 after PR #7's merge closed it \(closing link or merge-commit keyword\)/m);
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
  assert.equal(j.action, 'close-pending');
  assert.deepEqual(j.stillOpen, [2724]);
  assert.deepEqual(j.pendingClose, [2724]);
  assert.deepEqual(h.sleeps, [3000, 3000]);
  assert.equal(h.issueReads().length, 3);
  assert.equal(h.reopens().length, 0);
  // The log names the window actually polled (2 re-reads x 3 s), not settleMs / 1000.
  assert.match(h.log(runDir), /#2724 still open 6s after PR #7 merged/);
});

test('post-merge close-pending: a will-close record still OPEN after the window is logged, not reported clean', () => {
  const { main, runDir } = fixture({ pr: { number: 7 } });
  const h = makeDeps(main, {
    prReads: [mergedView(body(), [2724, 3997])],
    issues: { 2724: [{ state: 'OPEN', closedAt: null }] },
  });
  assert.equal(run(['--run', runDir, ...POST, '--settle-ms', '6000'], h.deps), 0);
  const j = h.json();
  assert.equal(j.action, 'close-pending');
  assert.deepEqual(j.pendingClose, [2724]);
  assert.match(h.log(runDir), /^- SKIP \d{2}:\d{2}:\d{2} — Closing links \(degraded\): condition: #2724 still open 6s after PR #7 merged though the merge may close it → fallback: re-run --mode post-merge, or reopen it by hand if it closes\. Reversibility: n\/a\.$/m);
});

test('post-merge: a pending close outranks a reopen in the action, and both stay listed', () => {
  const { main, runDir } = fixture({ pr: { number: 7 } });
  const h = makeDeps(main, {
    prReads: [mergedView(body({ span: ['Fixes #3997', 'Refs #2724 — deferred: a', 'Refs #2725 — deferred: b'] }), [2724, 2725, 3997])],
    issues: { 2724: [{ state: 'CLOSED', closedAt: CLOSED_AFTER }], 2725: [{ state: 'OPEN', closedAt: null }] },
  });
  assert.equal(run(['--run', runDir, ...POST, '--settle-ms', '0'], h.deps), 0);
  const j = h.json();
  assert.equal(j.action, 'close-pending');
  assert.deepEqual(j.reopened, [2724]);
  assert.deepEqual(j.pendingClose, [2725]);
});

test('post-merge: one reopened and one failed record is reopen-failed, never reopened', () => {
  const { main, runDir } = fixture({ pr: { number: 7 } });
  const h = makeDeps(main, {
    prReads: [mergedView(body({ span: ['Fixes #3997', 'Refs #2724 — deferred: a', 'Refs #2725 — deferred: b'] }), [2724, 2725, 3997])],
    issues: { 2724: [{ state: 'CLOSED', closedAt: CLOSED_AFTER }] },
    issueThrows: { 2725: true },
  });
  assert.equal(run(['--run', runDir, ...POST, '--settle-ms', '0'], h.deps), 0);
  const j = h.json();
  assert.equal(j.action, 'reopen-failed');
  assert.deepEqual(j.reopened, [2724]);
  assert.deepEqual(j.failed.map((f) => f.issue), [2725]);
});

test('post-merge: a MERGED PR with an unparseable mergedAt is exit 5', () => {
  const { main, runDir } = fixture({ pr: { number: 7 } });
  const h = makeDeps(main, { prReads: [mergedView(body(), [2724, 3997], { mergedAt: null })] });
  assert.equal(run(['--run', runDir, ...POST], h.deps), 5);
  assert.match(h.err.join(''), /no parseable mergedAt/);
  assert.equal(h.issueReads().length, 0);
});

test('a non-empty closingIssuesReferences with no repository objects is exit 5, pre- and post-merge', () => {
  const bare = [{ number: 2724 }, { number: 3997 }];
  const a = fixture({ pr: { number: 7 } });
  const hPre = makeDeps(a.main, { prReads: [{ body: body(), closingIssuesReferences: bare, url: PR_URL }] });
  assert.equal(run(['--run', a.runDir, ...PRE], hPre.deps), 5);
  assert.match(hPre.err.join(''), /repository/);
  assert.equal(hPre.edits().length, 0);

  const b = fixture({ pr: { number: 7 } });
  const hPost = makeDeps(b.main, { prReads: [mergedView(body(), [], { closingIssuesReferences: bare })] });
  assert.equal(run(['--run', b.runDir, ...POST], hPost.deps), 5);
  assert.equal(hPost.issueReads().length, 0);

  // The re-read is held to the same standard.
  const c = fixture({ pr: { number: 7 } });
  const hRe = makeDeps(c.main, { prReads: [preView(body(), [2724, 3997])], rereads: [bare] });
  assert.equal(run(['--run', c.runDir, ...PRE], hRe.deps), 5);
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

test('post-merge reopens a record closed in the same second as mergedAt (>= boundary)', () => {
  const { main, runDir } = fixture({ pr: { number: 7 } });
  const h = makeDeps(main, {
    prReads: [mergedView(body(), [2724, 3997])],
    issues: { 2724: [{ state: 'CLOSED', closedAt: MERGED_AT }] },
  });
  assert.equal(run(['--run', runDir, ...POST], h.deps), 0);
  const j = h.json();
  assert.equal(j.action, 'reopened');
  assert.deepEqual(j.reopened, [2724]);
  assert.equal(h.reopens().length, 1);
});

test('post-merge never reopens a record whose closedAt is null or unparseable', () => {
  for (const closedAt of [null, 'not-a-date']) {
    const { main, runDir } = fixture({ pr: { number: 7 } });
    const h = makeDeps(main, {
      prReads: [mergedView(body(), [2724, 3997])],
      issues: { 2724: [{ state: 'CLOSED', closedAt }] },
    });
    assert.equal(run(['--run', runDir, ...POST], h.deps), 0);
    const j = h.json();
    assert.equal(j.action, 'nothing-closed', String(closedAt));
    assert.deepEqual(j.closedBefore, [2724], String(closedAt));
    assert.equal(h.reopens().length, 0, String(closedAt));
  }
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
  // A failed reopen leaves the record closed: it is unsettled, never in the closing set.
  assert.deepEqual(j.closingSet, [3997]);
  assert.match(h.log(runDir), /could not reopen #2724 after PR #7's merge/);
  assert.match(h.log(runDir), /reopen it by hand/);
  assert.match(h.log(runDir), /^- SKIP \d{2}:\d{2}:\d{2} — Closing links \(degraded\): condition: could not reopen #2724 .*Reversibility: n\/a\.$/m);
});

test('post-merge issue-read failure is data', () => {
  const { main, runDir } = fixture({ pr: { number: 7 } });
  const h = makeDeps(main, { prReads: [mergedView(body(), [2724, 3997])], issueThrows: { 2724: true } });
  assert.equal(run(['--run', runDir, ...POST], h.deps), 0);
  const j = h.json();
  assert.equal(j.action, 'reopen-failed');
  assert.equal(j.failed[0].issue, 2724);
  // A failed read is not a failed reopen: the record may never have closed.
  assert.match(h.log(runDir), /could not read #2724 after PR #7's merge/);
  assert.doesNotMatch(h.log(runDir), /could not reopen/);
});

test('an error text written to decisions.md is bounded', () => {
  const { main, runDir } = fixture({ pr: { number: 7 } });
  const h = makeDeps(main, {
    prReads: [mergedView(body(), [2724, 3997])],
    issues: { 2724: [{ state: 'CLOSED', closedAt: CLOSED_AFTER }] },
    reopenThrows: 'x'.repeat(5000),
  });
  assert.equal(run(['--run', runDir, ...POST], h.deps), 0);
  const line = h.log(runDir).split('\n').find((l) => l.includes('could not reopen #2724'));
  assert.ok(line, 'the failed reopen is logged');
  assert.ok(line.length < 600, `log line is bounded (was ${line.length})`);
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

test('post-merge: an unread merge message makes a Refs-only candidate will-close, so it is polled and reopened', () => {
  // No closing link and no readable message: only the widening can see that the
  // squash message may close #10 about 2 s after the merge.
  const { main, runDir } = fixture({ pr: { number: 7 } });
  const single = body({ summary: 'No phrase.', span: ['Refs #10 — deferred: x'] });
  const h = makeDeps(main, {
    prReads: [mergedView(single, [])],
    messageThrows: true,
    issues: { 10: [{ state: 'OPEN', closedAt: null }, { state: 'CLOSED', closedAt: CLOSED_AFTER }] },
  });
  assert.equal(run(['--run', runDir, ...POST], h.deps), 0);
  const j = h.json();
  assert.equal(j.messageUnread, true);
  assert.deepEqual(j.willClose, [10]);
  assert.deepEqual(j.reopened, [10]);
  assert.equal(j.action, 'reopened');
  assert.deepEqual(h.sleeps, [3000]);
  assert.equal(h.reopens().length, 1);
});

test('post-merge: a merge-commit oid that is not a hex sha never reaches the API path and reads as unread', () => {
  for (const oid of ['../../etc', 'ABCDEF1', 'abc12', `${'a'.repeat(41)}`, 'd36f5f6 --jq']) {
    const { main, runDir } = fixture({ pr: { number: 7 } });
    const single = body({ summary: 'No phrase.', span: ['Refs #10 — deferred: x'] });
    const h = makeDeps(main, {
      prReads: [mergedView(single, [], { mergeCommit: { oid } })],
      issues: { 10: [{ state: 'CLOSED', closedAt: CLOSED_AFTER }] },
    });
    assert.equal(run(['--run', runDir, ...POST], h.deps), 0, oid);
    const j = h.json();
    assert.equal(j.messageUnread, true, oid);
    assert.deepEqual(j.willClose, [10], oid);
    assert.equal(h.calls.filter((c) => c.args[0] === 'api').length, 0, oid);
  }
});

test('post-merge gh view failure is exit 5', () => {
  const { main, runDir } = fixture({ pr: { number: 7 } });
  const h = makeDeps(main, { prReads: [new Error('network down')] });
  assert.equal(run(['--run', runDir, ...POST], h.deps), 5);
});

test('AC2.1: post-merge closingSet drops a cross-repo reference and a reopened record', () => {
  const { main, runDir } = fixture({ pr: { number: 7 } });
  const crossRepo = { number: 4000, repository: { name: 'repo', owner: { login: 'other' } } };
  const h = makeDeps(main, {
    prReads: [mergedView(body(), [], { closingIssuesReferences: [crossRepo, sameRepoRef(2724), sameRepoRef(3997)] })],
    issues: { 2724: [{ state: 'CLOSED', closedAt: CLOSED_AFTER }] },
  });
  assert.equal(run(['--run', runDir, ...POST], h.deps), 0);
  const j = h.json();
  assert.equal(j.action, 'reopened');
  assert.deepEqual(j.reopened, [2724]);
  assert.deepEqual(j.closingSet, [3997]);
});

test('post-merge closingSet drops pendingClose and failed records', () => {
  const span = ['Fixes #3997', 'Refs #2724 — deferred: a', 'Refs #2725 — deferred: b'];
  const a = fixture({ pr: { number: 7 } });
  const pending = makeDeps(a.main, {
    prReads: [mergedView(body({ span }), [2724, 2725, 3997])],
    issues: { 2724: [{ state: 'CLOSED', closedAt: CLOSED_BEFORE }], 2725: [{ state: 'OPEN', closedAt: null }] },
  });
  assert.equal(run(['--run', a.runDir, ...POST, '--settle-ms', '0'], pending.deps), 0);
  assert.deepEqual(pending.json().pendingClose, [2725]);
  assert.deepEqual(pending.json().closingSet, [2724, 3997]);

  const b = fixture({ pr: { number: 7 } });
  const failed = makeDeps(b.main, {
    prReads: [mergedView(body({ span }), [2724, 2725, 3997])],
    issues: { 2724: [{ state: 'CLOSED', closedAt: CLOSED_BEFORE }] },
    issueThrows: { 2725: true },
  });
  assert.equal(run(['--run', b.runDir, ...POST, '--settle-ms', '0'], failed.deps), 0);
  assert.deepEqual(failed.json().failed.map((f) => f.issue), [2725]);
  assert.deepEqual(failed.json().closingSet, [2724, 3997]);
});

test('post-merge closingSet keeps a linked record closed before the merge', () => {
  const { main, runDir } = fixture({ pr: { number: 7 } });
  const h = makeDeps(main, {
    prReads: [mergedView(body(), [2724, 3997])],
    issues: { 2724: [{ state: 'CLOSED', closedAt: CLOSED_BEFORE }] },
  });
  assert.equal(run(['--run', runDir, ...POST], h.deps), 0);
  const j = h.json();
  assert.equal(j.action, 'nothing-closed');
  assert.deepEqual(j.closedBefore, [2724]);
  assert.deepEqual(j.closingSet, [2724, 3997]);
});

// ---- #4599: --close-window-ms bounds the reopen window for a late post-merge run ----

const CLOSED_IN_WINDOW = '2026-10-24T18:52:34Z'; // MERGED_AT + 2 s
const CLOSED_PAST_WINDOW = '2026-10-24T21:52:32Z'; // MERGED_AT + 3 h
const WINDOW = ['--settle-ms', '0', '--close-window-ms', '600000'];

test('parseArgs: --close-window-ms takes a non-negative integer, no cap', () => {
  assert.equal(parseArgs(['--run', 'r', '--mode', 'post-merge']).closeWindowMs, null);
  assert.equal(parseArgs(['--run', 'r', '--mode', 'post-merge', '--close-window-ms', '600000']).closeWindowMs, 600000);
  assert.equal(parseArgs(['--run', 'r', '--mode', 'post-merge', '--close-window-ms', '0']).closeWindowMs, 0);
  assert.equal(parseArgs(['--run', 'r', '--mode', 'post-merge', '--close-window-ms', '99999999999']).closeWindowMs, 99999999999);
  assert.match(parseArgs(['--run', 'r', '--mode', 'post-merge', '--close-window-ms', '-1']).error, /--close-window-ms takes a non-negative integer/);
  assert.match(parseArgs(['--run', 'r', '--mode', 'post-merge', '--close-window-ms', 'abc']).error, /--close-window-ms takes a non-negative integer/);
  assert.ok(parseArgs(['--run', 'r', '--mode', 'post-merge', '--close-window-ms', '1.5']).error);
  assert.ok(parseArgs(['--run', 'r', '--mode', 'post-merge', '--close-window-ms']).error);
  // Post-merge only: pre-merge reads no closedAt, so the flag there is a malformed invocation.
  assert.match(parseArgs(['--run', 'r', '--mode', 'pre-merge', '--close-window-ms', '5']).error, /post-merge/);
});

test('--close-window-ms with --mode pre-merge exits 2 before touching gh', () => {
  const { main, runDir } = fixture({ pr: { number: 7 } });
  const h = makeDeps(main);
  assert.equal(run(['--run', runDir, ...PRE, '--close-window-ms', '5'], h.deps), 2);
  assert.match(h.err.join(''), /--close-window-ms/);
  assert.equal(h.calls.length, 0);
});

test('post-merge --close-window-ms: a keep-open record closed inside the window is reopened', () => {
  const { main, runDir } = fixture({ pr: { number: 7 } });
  const h = makeDeps(main, {
    prReads: [mergedView(body(), [2724, 3997])],
    issues: { 2724: [{ state: 'CLOSED', closedAt: CLOSED_IN_WINDOW }] },
  });
  assert.equal(run(['--run', runDir, ...POST, ...WINDOW], h.deps), 0);
  const j = h.json();
  assert.equal(j.action, 'reopened');
  assert.deepEqual(j.reopened, [2724]);
  assert.deepEqual(j.closedAfterWindow, []);
  assert.equal(h.reopens().length, 1);
});

test('post-merge --close-window-ms: a record closed after the window is not reopened, listed, and stays in closingSet', () => {
  const { main, runDir } = fixture({ pr: { number: 7 } });
  const h = makeDeps(main, {
    prReads: [mergedView(body(), [2724, 3997])],
    issues: { 2724: [{ state: 'CLOSED', closedAt: CLOSED_PAST_WINDOW }] },
  });
  assert.equal(run(['--run', runDir, ...POST, ...WINDOW], h.deps), 0);
  const j = h.json();
  assert.equal(j.action, 'nothing-closed');
  assert.deepEqual(j.reopened, []);
  assert.deepEqual(j.closedAfterWindow, [2724]);
  assert.deepEqual(j.closedBefore, []);
  assert.deepEqual(j.failed, []);
  assert.deepEqual(j.closingSet, [2724, 3997]);
  assert.equal(h.reopens().length, 0);
  assert.equal(h.log(runDir), '');
});

test('post-merge --close-window-ms: the window boundary is inclusive (closedAt == mergedAt + window reopens)', () => {
  const { main, runDir } = fixture({ pr: { number: 7 } });
  const atEdge = new Date(Date.parse(MERGED_AT) + 600000).toISOString();
  const h = makeDeps(main, {
    prReads: [mergedView(body(), [2724, 3997])],
    issues: { 2724: [{ state: 'CLOSED', closedAt: atEdge }] },
  });
  assert.equal(run(['--run', runDir, ...POST, ...WINDOW], h.deps), 0);
  assert.deepEqual(h.json().reopened, [2724]);
  assert.deepEqual(h.json().closedAfterWindow, []);
});

test('post-merge --close-window-ms 0: only a close at mergedAt itself is inside the window', () => {
  const a = fixture({ pr: { number: 7 } });
  const inside = makeDeps(a.main, {
    prReads: [mergedView(body(), [2724, 3997])],
    issues: { 2724: [{ state: 'CLOSED', closedAt: MERGED_AT }] },
  });
  assert.equal(run(['--run', a.runDir, ...POST, '--settle-ms', '0', '--close-window-ms', '0'], inside.deps), 0);
  assert.deepEqual(inside.json().reopened, [2724]);

  const b = fixture({ pr: { number: 7 } });
  const outside = makeDeps(b.main, {
    prReads: [mergedView(body(), [2724, 3997])],
    issues: { 2724: [{ state: 'CLOSED', closedAt: CLOSED_AFTER }] },
  });
  assert.equal(run(['--run', b.runDir, ...POST, '--settle-ms', '0', '--close-window-ms', '0'], outside.deps), 0);
  assert.deepEqual(outside.json().closedAfterWindow, [2724]);
  assert.equal(outside.reopens().length, 0);
});

test('post-merge --close-window-ms: a record closed before the merge is closedBefore, never closedAfterWindow', () => {
  const { main, runDir } = fixture({ pr: { number: 7 } });
  const h = makeDeps(main, {
    prReads: [mergedView(body(), [2724, 3997])],
    issues: { 2724: [{ state: 'CLOSED', closedAt: CLOSED_BEFORE }] },
  });
  assert.equal(run(['--run', runDir, ...POST, ...WINDOW], h.deps), 0);
  const j = h.json();
  assert.deepEqual(j.closedBefore, [2724]);
  assert.deepEqual(j.closedAfterWindow, []);
});

test('post-merge --close-window-ms: an unparseable or null closedAt stays closedBefore', () => {
  for (const closedAt of [null, 'not-a-date']) {
    const { main, runDir } = fixture({ pr: { number: 7 } });
    const h = makeDeps(main, {
      prReads: [mergedView(body(), [2724, 3997])],
      issues: { 2724: [{ state: 'CLOSED', closedAt }] },
    });
    assert.equal(run(['--run', runDir, ...POST, ...WINDOW], h.deps), 0);
    assert.deepEqual(h.json().closedBefore, [2724], String(closedAt));
    assert.deepEqual(h.json().closedAfterWindow, [], String(closedAt));
    assert.equal(h.reopens().length, 0, String(closedAt));
  }
});

test('post-merge --close-window-ms: in-window and late candidates split in one run', () => {
  const { main, runDir } = fixture({ pr: { number: 7 } });
  const h = makeDeps(main, {
    prReads: [mergedView(body({ span: ['Fixes #3997', 'Refs #2724 — deferred: a', 'Refs #2725 — deferred: b'] }), [2724, 2725, 3997])],
    issues: { 2724: [{ state: 'CLOSED', closedAt: CLOSED_IN_WINDOW }], 2725: [{ state: 'CLOSED', closedAt: CLOSED_PAST_WINDOW }] },
  });
  assert.equal(run(['--run', runDir, ...POST, ...WINDOW], h.deps), 0);
  const j = h.json();
  assert.equal(j.action, 'reopened');
  assert.deepEqual(j.reopened, [2724]);
  assert.deepEqual(j.closedAfterWindow, [2725]);
  assert.deepEqual(j.closingSet, [2725, 3997]);
  assert.equal(h.reopens().length, 1);
});

test('post-merge --close-window-ms past the window: a will-close record still OPEN is settledOpen, not pending, with no re-run line', () => {
  const { main, runDir } = fixture({ pr: { number: 7 } });
  const h = makeDeps(main, {
    prReads: [mergedView(body(), [2724, 3997])],
    issues: { 2724: [{ state: 'OPEN', closedAt: null }] },
  });
  const late = () => new Date(Date.parse(MERGED_AT) + 11 * 60 * 1000);
  assert.equal(run(['--run', runDir, ...POST, ...WINDOW], { ...h.deps, now: late }), 0);
  const j = h.json();
  assert.equal(j.action, 'nothing-closed');
  assert.deepEqual(j.stillOpen, [2724]);
  assert.deepEqual(j.pendingClose, []);
  assert.deepEqual(j.settledOpen, [2724]);
  // Still open, so never a closing record of this merge.
  assert.deepEqual(j.closingSet, [3997]);
  assert.equal(h.log(runDir), '');
});

test('post-merge --close-window-ms inside the window: a will-close record still OPEN stays pending, logged for a re-run', () => {
  const { main, runDir } = fixture({ pr: { number: 7 } });
  const h = makeDeps(main, {
    prReads: [mergedView(body(), [2724, 3997])],
    issues: { 2724: [{ state: 'OPEN', closedAt: null }] },
  });
  // Exactly mergedAt + window is not past it.
  const atEdge = () => new Date(Date.parse(MERGED_AT) + 600000);
  assert.equal(run(['--run', runDir, ...POST, ...WINDOW], { ...h.deps, now: atEdge }), 0);
  const j = h.json();
  assert.equal(j.action, 'close-pending');
  assert.deepEqual(j.pendingClose, [2724]);
  assert.deepEqual(j.settledOpen, []);
  assert.deepEqual(j.closingSet, [3997]);
  assert.match(h.log(runDir), /#2724 still open 0s after PR #7 merged though the merge may close it → fallback: re-run --mode post-merge/);
});

test('post-merge without --close-window-ms: no settledOpen key, and a still-OPEN will-close record stays pending however late', () => {
  const { main, runDir } = fixture({ pr: { number: 7 } });
  const h = makeDeps(main, {
    prReads: [mergedView(body(), [2724, 3997])],
    issues: { 2724: [{ state: 'OPEN', closedAt: null }] },
  });
  const weeksLater = () => new Date(Date.parse(MERGED_AT) + 21 * 24 * 60 * 60 * 1000);
  assert.equal(run(['--run', runDir, ...POST, '--settle-ms', '0'], { ...h.deps, now: weeksLater }), 0);
  const j = h.json();
  assert.equal(Object.hasOwn(j, 'settledOpen'), false);
  assert.deepEqual(j.pendingClose, [2724]);
});

test('post-merge without --close-window-ms: no closedAfterWindow key, a 3 h late close still reopens (unbounded, today)', () => {
  const { main, runDir } = fixture({ pr: { number: 7 } });
  const h = makeDeps(main, {
    prReads: [mergedView(body(), [2724, 3997])],
    issues: { 2724: [{ state: 'CLOSED', closedAt: CLOSED_PAST_WINDOW }] },
  });
  assert.equal(run(['--run', runDir, ...POST, '--settle-ms', '0'], h.deps), 0);
  const j = h.json();
  assert.equal(Object.hasOwn(j, 'closedAfterWindow'), false);
  assert.deepEqual(j.reopened, [2724]);
});

test('post-merge no-fixes-span carries no closingSet', () => {
  const { main, runDir } = fixture({ pr: { number: 7 } });
  const noSpan = '<!-- claude-tweaks-run: 2026-10-25T000001-record-4199 -->\nNo span.\n';
  const h = makeDeps(main, { prReads: [mergedView(noSpan, [3997])] });
  assert.equal(run(['--run', runDir, ...POST], h.deps), 0);
  assert.deepEqual(h.json(), { action: 'no-fixes-span', pr: 7 });
});

// ---- #4549: a merge into a non-default base closes the Fixes records itself ----

const OPEN_ISSUE = { state: 'OPEN', closedAt: null };
const NON_DEFAULT = { baseRefName: 'develop' };
const CLOSE_COMMENT = 'Closed by claude-tweaks: PR #7 merged into develop, which is not the default branch, so GitHub does not act on its closing keywords.';
const FIXES_ONLY = ['Fixes #3997'];

test('#4549 AC2.1: non-default base closes an open Fixes record, AUTO logged, action closed', () => {
  const { main, runDir } = fixture({ pr: { number: 7 } });
  const h = makeDeps(main, {
    prReads: [mergedView(body({ span: FIXES_ONLY }), [], NON_DEFAULT)],
    issues: { 3997: [OPEN_ISSUE] },
  });
  assert.equal(run(['--run', runDir, ...POST], h.deps), 0);
  const j = h.json();
  assert.equal(h.closes().length, 1);
  assert.deepEqual(h.closes()[0].args, ['issue', 'close', '3997', '--reason', 'completed', '--comment', CLOSE_COMMENT]);
  assert.deepEqual(j.closed, [3997]);
  assert.deepEqual(j.closeFailed, []);
  assert.deepEqual(j.closingSet, [3997]);
  assert.equal(j.nonDefaultBase, true);
  assert.equal(j.action, 'closed');
  const lines = h.log(runDir).split('\n').filter((l) => /closed #3997 after PR #7 merged into develop/.test(l));
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^- AUTO .*closed #3997 after PR #7 merged into develop.*Reversibility: high \(gh issue reopen\)\.$/);
});

test('#4549 AC3.1: a failing close lands in closeFailed, not closingSet, degraded SKIP, exit 0', () => {
  const { main, runDir } = fixture({ pr: { number: 7 } });
  const h = makeDeps(main, {
    prReads: [mergedView(body({ span: FIXES_ONLY }), [], NON_DEFAULT)],
    issues: { 3997: [OPEN_ISSUE] },
    closeThrows: { 3997: 'HTTP 403' },
  });
  assert.equal(run(['--run', runDir, ...POST], h.deps), 0);
  const j = h.json();
  assert.equal(j.closeFailed.length, 1);
  assert.equal(j.closeFailed[0].issue, 3997);
  assert.match(j.closeFailed[0].error, /HTTP 403/);
  assert.equal(j.closeFailed[0].stage, undefined);
  assert.deepEqual(j.closed, []);
  assert.deepEqual(j.closingSet, []);
  assert.equal(j.action, 'close-failed');
  assert.match(h.log(runDir), /^- SKIP .*Closing links \(degraded\): condition: could not close #3997 .*→ fallback: close it by hand/m);
});

test('#4549 AC4.1: an already CLOSED Fixes record gets no close call and counts in closingSet', () => {
  const { main, runDir } = fixture({ pr: { number: 7 } });
  const h = makeDeps(main, {
    prReads: [mergedView(body({ span: FIXES_ONLY }), [], NON_DEFAULT)],
    issues: { 3997: [{ state: 'CLOSED', closedAt: CLOSED_BEFORE }] },
  });
  assert.equal(run(['--run', runDir, ...POST], h.deps), 0);
  const j = h.json();
  assert.equal(h.closes().length, 0);
  assert.deepEqual(j.closed, []);
  assert.deepEqual(j.closingSet, [3997]);
  assert.equal(j.action, 'nothing-closed');
});

test('#4549 AC5.1: an unreadable default branch closes nothing and omits closingSet', () => {
  const { main, runDir } = fixture({ pr: { number: 7 } });
  const h = makeDeps(main, {
    prReads: [mergedView(body({ span: FIXES_ONLY }), [], NON_DEFAULT)],
    issues: { 3997: [OPEN_ISSUE] },
    defaultBranchThrows: true,
  });
  assert.equal(run(['--run', runDir, ...POST], h.deps), 0);
  const j = h.json();
  assert.equal(h.closes().length, 0);
  assert.equal(j.baseUnchecked, true);
  assert.equal(j.action, 'base-unchecked');
  assert.deepEqual(j.unchecked, [3997]);
  assert.ok(!('closingSet' in j));
  assert.ok(!h.issueReads().some((c) => c.args[2] === '3997'));
  const lines = h.log(runDir).split('\n').filter((l) => /^- SKIP .*Closing links \(degraded\)/.test(l));
  assert.equal(lines.length, 1);
  assert.match(lines[0], /could not tell whether PR #7 merged into the default branch/);
  assert.match(lines[0], /#3997 not checked/);
});

test('post-merge: a missing baseRefName is treated as unchecked', () => {
  const { main, runDir } = fixture({ pr: { number: 7 } });
  const h = makeDeps(main, {
    prReads: [mergedView(body({ span: FIXES_ONLY }), [], { baseRefName: undefined })],
    issues: { 3997: [OPEN_ISSUE] },
  });
  assert.equal(run(['--run', runDir, ...POST], h.deps), 0);
  const j = h.json();
  assert.equal(h.closes().length, 0);
  assert.equal(j.baseUnchecked, true);
  assert.equal(j.action, 'base-unchecked');
  assert.deepEqual(j.unchecked, [3997]);
  assert.ok(!('closingSet' in j));
  assert.equal(h.calls.filter((c) => c.args[0] === 'repo').length, 0);
  assert.ok(!h.issueReads().some((c) => c.args[2] === '3997'));
});

test('post-merge: an unreadable default branch with no Fixes records is base-unchecked and says there is nothing to close', () => {
  const { main, runDir } = fixture({ pr: { number: 7 } });
  const h = makeDeps(main, {
    prReads: [mergedView(body({ span: [] }), [], NON_DEFAULT)],
    defaultBranchThrows: true,
  });
  assert.equal(run(['--run', runDir, ...POST], h.deps), 0);
  const j = h.json();
  assert.equal(j.baseUnchecked, true);
  assert.equal(j.action, 'base-unchecked');
  assert.deepEqual(j.unchecked, []);
  assert.ok(!('closingSet' in j));
  assert.equal(h.closes().length, 0);
  assert.equal(h.issueReads().length, 0);
  const lines = h.log(runDir).split('\n').filter((l) => /^- SKIP .*Closing links \(degraded\)/.test(l));
  assert.equal(lines.length, 1);
  assert.match(lines[0], /could not tell whether PR #7 merged into the default branch/);
  assert.match(lines[0], /→ fallback: the PR names no Fixes records, so there is nothing to close by hand\./);
  assert.doesNotMatch(lines[0], /Fixes records #/);
});

test('post-merge: a GitHub Enterprise PR reads the default branch from its own host', () => {
  const { main, runDir } = fixture({ pr: { number: 7 } });
  const h = makeDeps(main, {
    prReads: [mergedView(body({ span: FIXES_ONLY }), [], { ...NON_DEFAULT, url: 'https://acme.ghe.com/acme/app/pull/7' })],
    issues: { 3997: [OPEN_ISSUE] },
  });
  assert.equal(run(['--run', runDir, ...POST], h.deps), 0);
  const repoViews = h.calls.filter((c) => c.args[0] === 'repo' && c.args[1] === 'view');
  assert.equal(repoViews.length, 1);
  assert.equal(repoViews[0].args[2], 'acme.ghe.com/acme/app');
  const apiCalls = h.calls.filter((c) => c.args[0] === 'api');
  assert.equal(apiCalls.length, 1);
  assert.ok(apiCalls[0].args[1].startsWith('repos/{owner}/{repo}/commits/'));
  assert.equal(h.json().nonDefaultBase, true);
});

test('post-merge non-default: keep-open candidates are read once, never polled, never pendingClose', () => {
  const { main, runDir } = fixture({ pr: { number: 7 } });
  const h = makeDeps(main, {
    prReads: [mergedView(body({ span: ['Fixes #3997', 'Refs #2724 — deferred: x'] }), [], NON_DEFAULT)],
    messageThrows: true,
    issues: { 2724: [OPEN_ISSUE], 3997: [OPEN_ISSUE] },
  });
  assert.equal(run(['--run', runDir, ...POST], h.deps), 0);
  const j = h.json();
  assert.deepEqual(h.sleeps, []);
  assert.deepEqual(j.willClose, []);
  assert.deepEqual(j.pendingClose, []);
  assert.deepEqual(j.stillOpen, [2724]);
  assert.equal(h.issueReads().filter((c) => c.args[2] === '2724').length, 1);
  assert.equal(j.action, 'closed');
  // A Refs record is never closed, only the Fixes one.
  assert.ok(!h.closes().some((c) => c.args[2] === '2724'));
  assert.deepEqual(j.closed, [3997]);
});

test('post-merge non-default: a linked non-Fixes record is never in closingSet', () => {
  const { main, runDir } = fixture({ pr: { number: 7 } });
  const h = makeDeps(main, {
    prReads: [mergedView(body({ span: FIXES_ONLY }), [2724], NON_DEFAULT)],
    messageThrows: true,
    issues: { 2724: [OPEN_ISSUE], 3997: [OPEN_ISSUE] },
  });
  assert.equal(run(['--run', runDir, ...POST], h.deps), 0);
  const j = h.json();
  assert.deepEqual(j.closed, [3997]);
  assert.deepEqual(j.closingSet, [3997]);
  assert.ok(!j.closingSet.includes(2724));
});

test('post-merge non-default: a keep-open candidate the merge closed is reopened, outranks closed, and is not in closingSet', () => {
  const { main, runDir } = fixture({ pr: { number: 7 } });
  const h = makeDeps(main, {
    prReads: [mergedView(body({ span: ['Fixes #3997', 'Refs #2724 — deferred: x'] }), [], NON_DEFAULT)],
    messageThrows: true,
    issues: { 2724: [{ state: 'CLOSED', closedAt: CLOSED_AFTER }], 3997: [OPEN_ISSUE] },
  });
  assert.equal(run(['--run', runDir, ...POST], h.deps), 0);
  const j = h.json();
  assert.equal(j.action, 'reopened');
  assert.deepEqual(j.reopened, [2724]);
  assert.deepEqual(j.closed, [3997]);
  assert.equal(h.reopens().length, 1);
  assert.deepEqual(h.reopens()[0].args, ['issue', 'reopen', '2724', '--comment', REOPEN_COMMENT]);
  assert.deepEqual(j.closingSet, [3997]);
  assert.ok(!j.closingSet.includes(2724));
});

test('post-merge: an unchecked base outranks a still-pending close in the action, and the pending close stays listed', () => {
  const { main, runDir } = fixture({ pr: { number: 7 } });
  const h = makeDeps(main, {
    prReads: [mergedView(body(), [2724, 3997])],
    issues: { 2724: [OPEN_ISSUE] },
    defaultBranchThrows: true,
  });
  assert.equal(run(['--run', runDir, ...POST, '--settle-ms', '6000'], h.deps), 0);
  const j = h.json();
  assert.equal(j.action, 'base-unchecked');
  assert.deepEqual(j.pendingClose, [2724]);
  assert.equal(j.baseUnchecked, true);
});

test('post-merge: an unchecked base outranks a successful reopen in the action, and the reopen stays listed', () => {
  const { main, runDir } = fixture({ pr: { number: 7 } });
  const h = makeDeps(main, {
    prReads: [mergedView(body(), [2724, 3997])],
    issues: { 2724: [{ state: 'CLOSED', closedAt: CLOSED_AFTER }] },
    defaultBranchThrows: true,
  });
  assert.equal(run(['--run', runDir, ...POST], h.deps), 0);
  const j = h.json();
  assert.equal(j.action, 'base-unchecked');
  assert.deepEqual(j.reopened, [2724]);
  assert.equal(h.reopens().length, 1);
});

test('post-merge: an unreadable default branch on a default-base PR with real closing links closes nothing and omits closingSet', () => {
  const { main, runDir } = fixture({ pr: { number: 7 } });
  const h = makeDeps(main, {
    prReads: [mergedView(body({ span: FIXES_ONLY }), [3997])],
    defaultBranchThrows: true,
  });
  assert.equal(run(['--run', runDir, ...POST], h.deps), 0);
  const j = h.json();
  assert.equal(j.baseUnchecked, true);
  assert.equal(j.action, 'base-unchecked');
  assert.ok(!('closingSet' in j));
  assert.equal(h.closes().length, 0);
});

test('#4549 AC6.1: the default base makes no close call and keeps the existing envelope', () => {
  const { main, runDir } = fixture({ pr: { number: 7 } });
  const h = makeDeps(main, { prReads: [mergedView(body({ span: FIXES_ONLY }), [3997])] });
  assert.equal(run(['--run', runDir, ...POST], h.deps), 0);
  const j = h.json();
  assert.equal(h.closes().length, 0);
  for (const key of ['nonDefaultBase', 'closed', 'closeFailed', 'baseUnchecked', 'unchecked']) assert.ok(!(key in j), key);
  assert.deepEqual(j.closingSet, [3997]);
  assert.equal(j.action, 'nothing-closed');
});

test('post-merge non-default: a duplicated Fixes line closes the record once', () => {
  const { main, runDir } = fixture({ pr: { number: 7 } });
  const h = makeDeps(main, {
    prReads: [mergedView(body({ span: ['Fixes #3997', 'Fixes #3997'] }), [], NON_DEFAULT)],
    issues: { 3997: [OPEN_ISSUE] },
  });
  assert.equal(run(['--run', runDir, ...POST], h.deps), 0);
  assert.equal(h.closes().length, 1);
  assert.deepEqual(h.json().closed, [3997]);
});

test('post-merge: reopen-failed outranks close-failed', () => {
  const { main, runDir } = fixture({ pr: { number: 7 } });
  const h = makeDeps(main, {
    prReads: [mergedView(body({ span: ['Fixes #3997', 'Refs #2724 — deferred: x'] }), [], NON_DEFAULT)],
    issues: { 2724: [{ state: 'CLOSED', closedAt: CLOSED_AFTER }], 3997: [OPEN_ISSUE] },
    reopenThrows: 'forbidden',
    closeThrows: { 3997: 'HTTP 403' },
  });
  assert.equal(run(['--run', runDir, ...POST], h.deps), 0);
  const j = h.json();
  assert.equal(j.action, 'reopen-failed');
  assert.deepEqual(j.failed.map((f) => f.issue), [2724]);
  assert.deepEqual(j.closeFailed.map((f) => f.issue), [3997]);
});

test('post-merge non-default: a failed state read is closeFailed with stage read', () => {
  const { main, runDir } = fixture({ pr: { number: 7 } });
  const h = makeDeps(main, {
    prReads: [mergedView(body({ span: FIXES_ONLY }), [], NON_DEFAULT)],
    issueThrows: { 3997: true },
  });
  assert.equal(run(['--run', runDir, ...POST], h.deps), 0);
  const j = h.json();
  assert.equal(h.closes().length, 0);
  assert.equal(j.closeFailed.length, 1);
  assert.equal(j.closeFailed[0].issue, 3997);
  assert.equal(j.closeFailed[0].stage, 'read');
  assert.match(j.closeFailed[0].error, /issue read failed/);
  assert.deepEqual(j.closingSet, []);
  assert.equal(j.action, 'close-failed');
  assert.match(h.log(runDir), /^- SKIP .*Closing links \(degraded\): condition: could not read #3997 after PR #7 merged into develop .*→ fallback: check it and close it by hand if it is still open/m);
});

test('post-merge non-default: an issue view with no string state is closeFailed with stage read, never closed or counted', () => {
  const { main, runDir } = fixture({ pr: { number: 7 } });
  const h = makeDeps(main, {
    prReads: [mergedView(body({ span: FIXES_ONLY }), [], NON_DEFAULT)],
    issues: { 3997: [{}] },
  });
  assert.equal(run(['--run', runDir, ...POST], h.deps), 0);
  const j = h.json();
  assert.equal(h.closes().length, 0);
  assert.equal(j.closeFailed.length, 1);
  assert.equal(j.closeFailed[0].issue, 3997);
  assert.equal(j.closeFailed[0].stage, 'read');
  assert.match(j.closeFailed[0].error, /no state field/);
  assert.deepEqual(j.closed, []);
  assert.deepEqual(j.closingSet, []);
  assert.equal(j.action, 'close-failed');
});

// ---- #4026: gh-absent, exit 4 and exit 5 log their own SKIP line ----

// Characterization (pre-#4026 behaviour that must not move): each refusal and
// gh failure prints exactly this stderr text and no stdout, and gh-absent
// prints exactly this envelope, in both modes.
const EXIT_SITES = [
  {
    name: 'exit 4 run marker mismatch (pre-merge)', code: 4, mode: 'pre-merge',
    opts: { prReads: [preView(body({ runId: FOREIGN_RUN_ID }), [2724, 3997])] },
    stderr: `closing-links.js: run marker mismatch on PR #7: body names run ${FOREIGN_RUN_ID}, expected ${RUN_ID} — nothing written\n`,
    condition: 'exit 4 run marker mismatch',
  },
  {
    name: 'exit 5 pr view failed (pre-merge)', code: 5, mode: 'pre-merge',
    opts: { prReads: [new Error('network down')] },
    stderr: 'closing-links.js: gh pr view failed on PR #7: network down\n',
    condition: 'exit 5 gh failure: gh pr view failed on PR #7: network down',
  },
  {
    name: 'exit 5 pr view failed (post-merge)', code: 5, mode: 'post-merge',
    opts: { prReads: [new Error('network down')] },
    stderr: 'closing-links.js: gh pr view failed on PR #7: network down\n',
    condition: 'exit 5 gh failure: gh pr view failed on PR #7: network down',
  },
  {
    name: 'exit 5 malformed view (pre-merge)', code: 5, mode: 'pre-merge',
    opts: { prReads: [{ body: null, closingIssuesReferences: [], url: PR_URL }] },
    stderr: 'closing-links.js: gh pr view on PR #7 returned no string body, usable closingIssuesReferences (an array whose entries carry a repository), or PR url\n',
    condition: 'exit 5 gh failure: gh pr view on PR #7 returned no string body, usable closingIssuesReferences (an array whose entries carry a repository), or PR url',
  },
  {
    name: 'exit 5 unparseable mergedAt (post-merge)', code: 5, mode: 'post-merge',
    opts: { prReads: [mergedView(body(), [2724, 3997], { mergedAt: null })] },
    stderr: 'closing-links.js: gh pr view on PR #7 returned a MERGED PR with no parseable mergedAt\n',
    condition: 'exit 5 gh failure: gh pr view on PR #7 returned a MERGED PR with no parseable mergedAt',
  },
  {
    name: 'exit 5 pr edit failed (pre-merge)', code: 5, mode: 'pre-merge',
    opts: { prReads: [preView(body(), [2724, 3997])], editThrows: 'edit refused' },
    stderr: 'closing-links.js: gh pr edit failed on PR #7: edit refused\n',
    condition: 'exit 5 gh failure: gh pr edit failed on PR #7: edit refused',
  },
  {
    name: 'exit 5 re-read failed with no body write (pre-merge)', code: 5, mode: 'pre-merge',
    opts: { prReads: [preView(body({ summary: 'No phrase.', span: ['Fixes #3997', 'Refs #2724 — deferred: pending'] }), [2724, 3997])], rereads: [new Error('flaky')] },
    stderr: 'closing-links.js: gh pr view failed on PR #7: flaky\n',
    condition: 'exit 5 gh failure: gh pr view failed on PR #7: flaky',
  },
];

// A fixed local clock, so a whole decisions.md line can be compared.
const FIXED_NOW = () => new Date(2026, 9, 25, 12, 0, 0);
const skipLine = (mode, condition) => `- SKIP 12:00:00 — Closing links (${mode}) (degraded): condition: closing-links.js ${condition} → fallback: closing links not checked this merge. Reversibility: n/a.`;

function siteDeps(main, site, over = {}) {
  const { editThrows, ...opts } = site.opts;
  const h = makeDeps(main, { now: FIXED_NOW, ...opts, ...over });
  if (editThrows) {
    const real = h.deps.gh;
    h.deps.gh = (args, input) => {
      if (args[1] === 'edit') { h.calls.push({ args, input }); throw new Error(editThrows); }
      return real(args, input);
    };
  }
  return h;
}

test('characterization: each exit-4/5 site prints its stderr line and no stdout', () => {
  for (const site of EXIT_SITES) {
    const { main, runDir } = fixture({ pr: { number: 7 } });
    const h = siteDeps(main, site);
    assert.equal(run(['--run', runDir, '--mode', site.mode], h.deps), site.code, site.name);
    assert.equal(h.err.join(''), site.stderr, site.name);
    assert.equal(h.out.join(''), '', site.name);
  }
});

test('characterization: gh-absent prints the bare envelope in both modes, no gh call, no stderr', () => {
  for (const mode of ['pre-merge', 'post-merge']) {
    const { main, runDir } = fixture({ pr: { number: 7 } });
    const h = makeDeps(main, { ghAvailable: false, now: FIXED_NOW });
    assert.equal(run(['--run', runDir, '--mode', mode], h.deps), 0, mode);
    assert.equal(h.out.join(''), '{"action":"gh-absent","pr":7}\n', mode);
    assert.equal(h.err.join(''), '', mode);
    assert.equal(h.calls.length, 0, mode);
  }
});

test('AC3.1: closing-links gh-absent logs one SKIP under /wrap-up, both modes', () => {
  for (const mode of ['pre-merge', 'post-merge']) {
    const { main, runDir } = fixture({ pr: { number: 7 } });
    const h = makeDeps(main, { ghAvailable: false, now: FIXED_NOW });
    assert.equal(run(['--run', runDir, '--mode', mode], h.deps), 0, mode);
    assert.equal(h.log(runDir), `## /wrap-up\n${skipLine(mode, 'gh-absent')}\n`, mode);
  }
});

test('AC3.1: closing-links exit 4 and every exit-5 site log one SKIP under /wrap-up', () => {
  for (const site of EXIT_SITES) {
    const { main, runDir } = fixture({ pr: { number: 7 } });
    const h = siteDeps(main, site);
    assert.equal(run(['--run', runDir, '--mode', site.mode], h.deps), site.code, site.name);
    assert.equal(h.log(runDir), `## /wrap-up\n${skipLine(site.mode, site.condition)}\n`, site.name);
  }
});

test('AC3.1: an exit-5 SKIP carries only the first stderr line, without the program prefix', () => {
  const { main, runDir } = fixture({ pr: { number: 7 } });
  const h = makeDeps(main, { prReads: [new Error('Command failed: gh pr view 7\nHTTP 502: Bad Gateway')], now: FIXED_NOW });
  assert.equal(run(['--run', runDir, ...PRE], h.deps), 5);
  assert.equal(h.log(runDir), `## /wrap-up\n${skipLine('pre-merge', 'exit 5 gh failure: gh pr view failed on PR #7: Command failed: gh pr view 7')}\n`);
});

test('AC3.1: a re-read failure after a body write keeps its own trace and adds the exit-5 SKIP', () => {
  const { main, runDir } = fixture({ pr: { number: 7 } });
  const h = makeDeps(main, { prReads: [preView(body(), [2724, 3997])], rereads: [new Error('flaky')], now: FIXED_NOW });
  assert.equal(run(['--run', runDir, ...PRE], h.deps), 5);
  const lines = h.log(runDir).split('\n').filter(Boolean);
  assert.equal(lines.length, 3, h.log(runDir));
  assert.match(lines[0], /^- SKIP 12:00:00 — Closing links \(degraded\): condition: PR #7 body rewritten/);
  assert.equal(lines[1], '## /wrap-up');
  assert.equal(lines[2], skipLine('pre-merge', 'exit 5 gh failure: gh pr view failed on PR #7: flaky'));
});

test('exit 3 and no-pr log nothing', () => {
  const a = fixture({ status: 'active' });
  const hNo = makeDeps(a.main, { now: FIXED_NOW });
  assert.equal(run(['--run', a.runDir, ...POST], hNo.deps), 0);
  assert.equal(hNo.log(a.runDir), '');

  const { main } = fixture({ pr: { number: 7 } });
  const hMissing = makeDeps(main, { now: FIXED_NOW });
  const missing = path.join(main, '.claude-tweaks', 'pipelines', 'nope');
  assert.equal(run(['--run', missing, ...PRE], hMissing.deps), 3);
  assert.equal(fs.existsSync(path.join(missing, 'decisions.md')), false);
});

test('a failed SKIP append keeps every exit code, adds one stderr line, and marks the gh-absent envelope', () => {
  const failing = { appendDecision: () => { throw new Error('disk full'); } };
  for (const site of EXIT_SITES) {
    const { main, runDir } = fixture({ pr: { number: 7 } });
    const h = siteDeps(main, site, failing);
    assert.equal(run(['--run', runDir, '--mode', site.mode], h.deps), site.code, site.name);
    assert.equal(h.err.join(''), `${site.stderr}closing-links.js: could not append the decisions.md entry: disk full\n`, site.name);
    assert.equal(h.out.join(''), '', site.name);
  }
  for (const mode of ['pre-merge', 'post-merge']) {
    const { main, runDir } = fixture({ pr: { number: 7 } });
    const h = makeDeps(main, { ghAvailable: false, now: FIXED_NOW, ...failing });
    assert.equal(run(['--run', runDir, '--mode', mode], h.deps), 0, mode);
    assert.deepEqual(h.json(), { action: 'gh-absent', pr: 7, logFailed: true }, mode);
    assert.equal(h.err.join(''), 'closing-links.js: could not append the decisions.md entry: disk full\n', mode);
  }
});
