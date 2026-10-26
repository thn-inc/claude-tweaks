'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { openPrEarly } = require('../../../plugin/bin/lib/flow/pr-early-open');
const { run } = require('../../../plugin/bin/pr-early-open');
const { hasPrEarlyStep1LineFor, hasLoggedPrDegrade } = require('../../../plugin/bin/lib/hooks/pre-tool-use');
const logDecision = require('../../../plugin/bin/log-decision');
const { gitRepo } = require('../../helpers/git-fixtures');

const RUN_ID = '2026-10-25T000001-record-4027';
const BRANCH = 'worktree-dispatch-record-4027';
const REPO = 'thn-inc/claude-tweaks';
const NOW = new Date(2026, 9, 25, 12, 34, 56).getTime();
const URL7 = 'https://github.com/thn-inc/claude-tweaks/pull/7';
const URL42 = 'https://github.com/thn-inc/claude-tweaks/pull/42';

const created = [];
test.after(() => {
  for (const dir of created) fs.rmSync(dir, { recursive: true, force: true });
});
function tmpDir(prefix) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  created.push(d);
  return d;
}

// A scripted gh/git pair. Every call lands in one ordered `calls` list, so a
// test can assert that a log line precedes the push it gates. Unhandled
// shapes throw loudly. `push`/`create` are per-attempt scripts: an Error is
// thrown, anything else is the stdout.
function harness({
  list = [], lists = null, view = null, reopen = '', create = [`${URL42}\n`], push = [''],
  edit = '', runState = null, decisions = '',
} = {}) {
  const calls = [];
  const lines = [];
  const records = [];
  const bodyDir = tmpDir('ct-pr-early-body-');
  let listN = 0; let pushN = 0; let createN = 0;
  const step = (script, n) => {
    const v = script[Math.min(n, script.length - 1)];
    if (v instanceof Error) throw v;
    return v;
  };
  const deps = {
    gh: (args) => {
      calls.push(['gh', ...args]);
      const [a, b] = args;
      if (a === 'pr' && b === 'list') {
        const v = lists ? lists[Math.min(listN, lists.length - 1)] : list;
        listN++;
        if (v instanceof Error) throw v;
        return JSON.stringify(v);
      }
      if (a === 'pr' && b === 'view') { if (view instanceof Error) throw view; return JSON.stringify(view); }
      if (a === 'pr' && b === 'reopen') { if (reopen instanceof Error) throw reopen; return reopen; }
      if (a === 'pr' && b === 'edit') { if (edit instanceof Error) throw edit; return edit; }
      if (a === 'pr' && b === 'create') return step(create, createN++);
      throw new Error(`unexpected gh ${args.join(' ')}`);
    },
    git: (args, opts) => {
      calls.push(['git', ...args, `cwd=${opts && opts.cwd}`]);
      if (args[0] === 'push') return step(push, pushN++);
      throw new Error(`unexpected git ${args.join(' ')}`);
    },
    sleep: async (ms) => { calls.push(['sleep', ms]); },
    now: () => NOW,
    appendDecision: (line) => { calls.push(['log', line]); lines.push(line); },
    recordPr: (pr) => { calls.push(['record', pr.number]); records.push(pr); },
    clearPr: () => { calls.push(['clear']); },
    readRunState: () => runState,
    readDecisions: () => decisions,
    writeBodyFile: (name, text) => {
      const p = path.join(bodyDir, name);
      fs.writeFileSync(p, text);
      return p;
    },
    readFile: (p) => fs.readFileSync(p, 'utf8'),
  };
  return { deps, calls, lines, records, bodyDir };
}

const OPTS = {
  runDir: `/repo/.claude-tweaks/pipelines/${RUN_ID}`,
  worktree: '/repo/.claude/worktrees/wt',
  branch: BRANCH,
  repo: REPO,
  base: 'dev',
  target: '#4027',
  fixes: [4027],
  title: 'Move pipeline mechanics behind CLIs (#4027)',
  summary: 'One paragraph.',
};

const idx = (calls, pred) => calls.findIndex(pred);
const isPush = (c) => c[0] === 'git' && c[1] === 'push';
const isCreate = (c) => c[0] === 'gh' && c[1] === 'pr' && c[2] === 'create';

test('no existing PR: logs the no-match line before the push, then pushes, composes, creates the draft and records it', async () => {
  const h = harness({ list: [] });
  const res = await openPrEarly(OPTS, h.deps);
  assert.deepEqual(res, { outcome: 'opened', number: 42, url: URL42 });

  const noMatch = idx(h.calls, (c) => c[0] === 'log' && c[1].includes(`no existing PR for ${BRANCH}; creating`));
  const pushAt = idx(h.calls, isPush);
  assert.ok(noMatch !== -1 && pushAt !== -1 && noMatch < pushAt, 'no-match line precedes the push');
  assert.deepEqual(h.calls[pushAt], ['git', 'push', 'origin', BRANCH, `cwd=${OPTS.worktree}`]);

  const createCall = h.calls.find(isCreate);
  const bodyPath = path.join(h.bodyDir, `pr-early-body-${RUN_ID}.md`);
  assert.deepEqual(createCall, ['gh', 'pr', 'create', '--repo', REPO, '--draft', '--base', 'dev', '--head', BRANCH,
    '--title', OPTS.title, '--body-file', bodyPath]);
  const body = fs.readFileSync(bodyPath, 'utf8');
  assert.equal(body.split('\n')[0], `<!-- claude-tweaks-run: ${RUN_ID} -->`);
  assert.match(body, /^Fixes #4027$/m);
  assert.ok(body.includes(`PIPELINE_RUN_DIR="${OPTS.runDir}" /claude-tweaks:flow "#4027" build`));

  assert.deepEqual(h.records, [{ number: 42, url: URL42 }]);
  assert.deepEqual(h.lines, [
    `- AUTO 12:34:56 — log-decision: PR-early run lifecycle: no existing PR for ${BRANCH}; creating. Reversibility: n/a.`,
    `- AUTO 12:34:56 — log-decision: PR-early run lifecycle: pushed ${BRANCH} to origin. Reversibility: high.`,
    `- AUTO 12:34:56 — log-decision: PR-early run lifecycle: opened PR #42 for ${BRANCH}. Reversibility: high.`,
  ]);
  // Push, then create, then record — Step 2, 3, 4 order.
  assert.ok(pushAt < idx(h.calls, isCreate));
  assert.ok(idx(h.calls, isCreate) < idx(h.calls, (c) => c[0] === 'record'));
  assert.equal(h.calls.filter((c) => c[0] === 'sleep').length, 0);
});

test('an OPEN match is reused: reuse line before the push, no create, the PR recorded', async () => {
  const h = harness({ list: [{ number: 7, url: URL7, state: 'OPEN', isDraft: false }] });
  const res = await openPrEarly(OPTS, h.deps);
  assert.deepEqual(res, { outcome: 'reused', number: 7, url: URL7 });
  const reuse = idx(h.calls, (c) => c[0] === 'log' && c[1].includes(`reusing open PR #7 for ${BRANCH}.`));
  assert.ok(reuse !== -1 && reuse < idx(h.calls, isPush), 'reuse line precedes the push');
  assert.equal(h.calls.find(isCreate), undefined);
  assert.equal(h.calls.find((c) => c[0] === 'gh' && c[2] === 'ready'), undefined, 'never flips draft state');
  assert.deepEqual(h.records, [{ number: 7, url: URL7 }]);
});

test('a CLOSED match is reopened, logged as a retry, and recorded', async () => {
  const h = harness({ list: [{ number: 7, url: URL7, state: 'CLOSED', isDraft: true }] });
  const res = await openPrEarly(OPTS, h.deps);
  assert.deepEqual(res, { outcome: 'reopened', number: 7, url: URL7 });
  assert.ok(h.calls.some((c) => c.join(' ') === `gh pr reopen 7 --repo ${REPO}`));
  const reopened = idx(h.calls, (c) => c[0] === 'log' && c[1].includes(`reopened PR #7 for ${BRANCH} (retry).`));
  assert.ok(reopened !== -1 && reopened < idx(h.calls, isPush));
  assert.equal(h.calls.find(isCreate), undefined);
  assert.equal(h.calls.find((c) => c[2] === 'edit'), undefined, 'no rebind without an adopted-prior-attempt line');
  assert.deepEqual(h.records, [{ number: 7, url: URL7 }]);
});

test('a reopen of an adopted prior attempt rebinds its body to this run before the push', async () => {
  const decisions = `- AUTO 10:00:00 — log-decision: Adopted-branch collision check: adopted prior attempt abc1234 from closed PR #8 for ${BRANCH}. Reversibility: high (merge commit on an unpushed branch).\n`;
  const h = harness({
    list: [{ number: 9, url: URL7, state: 'CLOSED' }, { number: 8, url: URL7, state: 'CLOSED' }],
    decisions,
  });
  const res = await openPrEarly(OPTS, h.deps);
  assert.equal(res.outcome, 'reopened');
  assert.equal(res.number, 8, 'reopens the PR the collision check verified, not the newest');
  const editAt = idx(h.calls, (c) => c[0] === 'gh' && c[2] === 'edit');
  assert.deepEqual(h.calls[editAt], ['gh', 'pr', 'edit', '8', '--repo', REPO, '--body-file', path.join(h.bodyDir, `pr-early-body-${RUN_ID}.md`)]);
  assert.ok(editAt < idx(h.calls, isPush));
  assert.ok(h.lines.some((l) => l.includes(`PR-early run lifecycle: rebound reopened PR #8 to run ${RUN_ID}.`)));
});

test('a failed rebind is a logged SKIP, never a stop', async () => {
  const decisions = `- AUTO 10:00:00 — x: adopted prior attempt abc1234 from closed PR #7 for ${BRANCH}. Reversibility: high.\n`;
  const h = harness({ list: [{ number: 7, url: URL7, state: 'CLOSED' }], decisions, edit: new Error('HTTP 422') });
  const res = await openPrEarly(OPTS, h.deps);
  assert.equal(res.outcome, 'reopened');
  assert.ok(h.lines.some((l) => l.startsWith('- SKIP ') && l.includes('rebind of reopened PR #7 failed (HTTP 422)')
    && l.includes(`until its body names run ${RUN_ID}`)));
  assert.deepEqual(h.records, [{ number: 7, url: URL7 }]);
});

test('a rejected reopen falls through to creation with its own Step 1 line', async () => {
  const h = harness({ list: [{ number: 7, url: URL7, state: 'CLOSED' }], reopen: new Error('GraphQL: Could not open the pull request') });
  const res = await openPrEarly(OPTS, h.deps);
  assert.deepEqual(res, { outcome: 'opened', number: 42, url: URL42, reopenRejected: 7 });
  const step1 = h.lines[0];
  assert.match(step1, /reopen of closed PR #7 for worktree-dispatch-record-4027 was rejected; creating\./);
  assert.ok(hasPrEarlyStep1LineFor(step1, BRANCH));
});

test('a MERGED-only match is treated as no match', async () => {
  const h = harness({ list: [{ number: 5, url: URL7, state: 'MERGED' }] });
  const res = await openPrEarly(OPTS, h.deps);
  assert.equal(res.outcome, 'opened');
  assert.ok(h.lines[0].includes(`no existing PR for ${BRANCH}; creating`));
});

test('a transient push failure retries once after 15 s', async () => {
  const h = harness({ push: [new Error('remote: Internal Server Error\nfatal: unable to access: The requested URL returned error: 503'), ''] });
  const res = await openPrEarly(OPTS, h.deps);
  assert.equal(res.outcome, 'opened');
  assert.deepEqual(h.calls.filter((c) => c[0] === 'sleep'), [['sleep', 15000]]);
  assert.equal(h.calls.filter(isPush).length, 2);
});

test('an auth push failure does not retry: push-failed, FAILED line logged, no create', async () => {
  const h = harness({ push: [new Error('remote: Permission to thn-inc/claude-tweaks.git denied to bot.\nfatal: unable to access: The requested URL returned error: 403')] });
  const res = await openPrEarly(OPTS, h.deps);
  assert.equal(res.outcome, 'push-failed');
  assert.match(res.reason, /Permission to thn-inc\/claude-tweaks\.git denied/);
  assert.equal(h.calls.filter((c) => c[0] === 'sleep').length, 0);
  assert.equal(h.calls.filter(isPush).length, 1);
  assert.equal(h.calls.find(isCreate), undefined);
  const failed = h.lines[h.lines.length - 1];
  assert.match(failed, new RegExp(`^- AUTO 12:34:56 — log-decision: PR-early run lifecycle: push of ${BRANCH} to origin FAILED \\(.+\\); run proceeds local-only, no PR opened\\. Reversibility: n/a\\.$`));
  assert.ok(!/\n/.test(failed), 'the reason is collapsed onto one line');
  assert.deepEqual(h.records, []);
});

test('create failing twice: create-failed with the literal FAILED line; a transient first failure waits 15 s', async () => {
  const h = harness({ create: [new Error('HTTP 502: Bad Gateway'), new Error('HTTP 502: Bad Gateway')] });
  const res = await openPrEarly(OPTS, h.deps);
  assert.equal(res.outcome, 'create-failed');
  assert.equal(h.calls.filter(isCreate).length, 2);
  assert.deepEqual(h.calls.filter((c) => c[0] === 'sleep'), [['sleep', 15000]]);
  const failed = h.lines[h.lines.length - 1];
  assert.ok(failed.includes(`PR-early run lifecycle: gh pr create for ${BRANCH} FAILED (HTTP 502: Bad Gateway); run proceeds local-only, no PR opened.`));
  assert.ok(/\bFAILED\b/.test(failed));
  assert.deepEqual(h.records, []);
});

test('a non-transient create failure retries immediately, once', async () => {
  const h = harness({ create: [new Error('pull request create failed: GraphQL: Head sha can\'t be blank'), `${URL42}\n`] });
  const res = await openPrEarly(OPTS, h.deps);
  assert.deepEqual(res, { outcome: 'opened', number: 42, url: URL42 });
  assert.equal(h.calls.filter((c) => c[0] === 'sleep').length, 0);
});

test('a create that failed but landed is adopted by the dedup recheck, never duplicated', async () => {
  const h = harness({
    lists: [[], [{ number: 42, url: URL42, state: 'OPEN' }]],
    create: [new Error('Post "https://api.github.com/graphql": context deadline exceeded (Client.Timeout exceeded)')],
  });
  const res = await openPrEarly(OPTS, h.deps);
  assert.deepEqual(res, { outcome: 'opened', number: 42, url: URL42 });
  assert.equal(h.calls.filter(isCreate).length, 1, 'no second create once the recheck finds it');
});

test('a recorded PR that is still OPEN is reused with no list call and no new log line', async () => {
  const h = harness({ runState: { pr: { number: 9, url: URL7 } }, view: { state: 'OPEN', isDraft: true, url: URL7 } });
  const res = await openPrEarly(OPTS, h.deps);
  assert.deepEqual(res, { outcome: 'reused', number: 9, url: URL7 });
  assert.equal(h.calls.find((c) => c[0] === 'gh' && c[2] === 'list'), undefined);
  assert.deepEqual(h.calls[0], ['gh', 'pr', 'view', '9', '--repo', REPO, '--json', 'state,isDraft,url']);
  assert.deepEqual(h.lines, []);
  assert.equal(h.calls.find(isPush), undefined);
});

test('a recorded PR no longer open falls through to the list check and logs the stale line', async () => {
  const h = harness({ runState: { pr: { number: 9, url: URL7 } }, view: { state: 'CLOSED', url: URL7 }, list: [] });
  const res = await openPrEarly(OPTS, h.deps);
  assert.deepEqual(res, { outcome: 'opened', number: 42, url: URL42 });
  assert.ok(h.calls.some((c) => c[0] === 'gh' && c[2] === 'list'));
  assert.ok(h.lines.some((l) => l.includes('PR-early run lifecycle: recorded PR #9 no longer open; created #42.')));
});

test('a recorded PR that 404s is treated as gone; any other view failure propagates', async () => {
  const gone = harness({ runState: { pr: { number: 9 } }, view: new Error('GraphQL: Could not resolve to a PullRequest with the number of 9.'), list: [] });
  assert.equal((await openPrEarly(OPTS, gone.deps)).outcome, 'opened');
  const flaky = harness({ runState: { pr: { number: 9 } }, view: new Error('connection reset by peer') });
  await assert.rejects(openPrEarly(OPTS, flaky.deps), /connection reset/);
});

test('a body whose first line does not name this run hard-stops before gh pr create', async () => {
  const h = harness();
  h.deps.writeBodyFile = (name, text) => {
    const p = path.join(h.bodyDir, name);
    fs.writeFileSync(p, text.replace(RUN_ID, '2026-01-01T000000-record-9'));
    return p;
  };
  await assert.rejects(openPrEarly(OPTS, h.deps), /first line/);
  assert.equal(h.calls.find(isCreate), undefined);
});

test('a create retried after a transient error that then says "already exists" adopts the PR that landed', async () => {
  const h = harness({
    lists: [[], [], [{ number: 42, url: URL42, state: 'OPEN' }]],
    create: [new Error('HTTP 504: Gateway Timeout'), new Error(`a pull request for branch "${BRANCH}" into branch "dev" already exists:\n${URL42}`)],
  });
  const res = await openPrEarly(OPTS, h.deps);
  assert.deepEqual(res, { outcome: 'opened', number: 42, url: URL42 });
  assert.equal(h.calls.filter(isCreate).length, 2);
  assert.ok(!h.lines.some((l) => /FAILED/.test(l)), 'no FAILED line while a live draft PR exists');
  assert.deepEqual(h.records, [{ number: 42, url: URL42 }]);
});

test('a retry that times out after a transient first error re-lists and adopts a PR that landed late', async () => {
  const h = harness({
    lists: [[], [], [{ number: 42, url: URL42, state: 'OPEN' }]],
    create: [new Error('HTTP 503: Service Unavailable'), new Error('Post "https://api.github.com/graphql": context deadline exceeded')],
  });
  const res = await openPrEarly(OPTS, h.deps);
  assert.deepEqual(res, { outcome: 'opened', number: 42, url: URL42 });
  assert.equal(h.calls.filter(isCreate).length, 2);
});

test('a transient error on the retry alone also re-lists and adopts a PR that landed', async () => {
  const h = harness({
    lists: [[], [], [{ number: 42, url: URL42, state: 'OPEN' }]],
    create: [new Error('GraphQL: something odd (createPullRequest)'), new Error('Post "https://api.github.com/graphql": context deadline exceeded')],
  });
  const res = await openPrEarly(OPTS, h.deps);
  assert.deepEqual(res, { outcome: 'opened', number: 42, url: URL42 });
  assert.equal(h.calls.filter(isCreate).length, 2);
  assert.ok(!h.lines.some((l) => /FAILED/.test(l)));
});

test('the unverifiable marker survives a long create error in the FAILED line', async () => {
  const longErr = `pull request create failed: GraphQL: ${'x'.repeat(320)} (createPullRequest)`;
  const h = harness({ lists: [[], new Error(`HTTP 502: Bad Gateway ${'y'.repeat(300)}`)], create: [new Error(longErr)] });
  const res = await openPrEarly(OPTS, h.deps);
  assert.equal(res.outcome, 'create-failed');
  assert.match(res.reason, /unverifiable/);
  const failed = h.lines[h.lines.length - 1];
  assert.match(failed, /gh pr create for \S+ FAILED \(.*unverifiable.*\); run proceeds local-only, no PR opened\./);
  const dir = tmpDir('ct-pr-early-gate-');
  fs.writeFileSync(path.join(dir, 'decisions.md'), `${h.lines.join('\n')}\n`);
  assert.ok(hasLoggedPrDegrade(dir));
});

test('an "already exists" retry error after a non-transient first error also re-lists and adopts', async () => {
  const h = harness({
    lists: [[], [], [{ number: 42, url: URL42, state: 'OPEN' }]],
    create: [new Error('GraphQL: something odd (createPullRequest)'), new Error('a pull request for branch "x" into branch "dev" already exists')],
  });
  const res = await openPrEarly(OPTS, h.deps);
  assert.deepEqual(res, { outcome: 'opened', number: 42, url: URL42 });
});

test('a failed recheck never retries the create: FAILED line names the unverifiable state', async () => {
  const h = harness({
    lists: [[], new Error('HTTP 502: Bad Gateway')],
    create: [new Error('HTTP 502: Bad Gateway'), `${URL42}\n`],
  });
  const res = await openPrEarly(OPTS, h.deps);
  assert.equal(res.outcome, 'create-failed');
  assert.equal(h.calls.filter(isCreate).length, 1, 'no second create when the recheck could not look');
  const failed = h.lines[h.lines.length - 1];
  assert.match(failed, /gh pr create for \S+ FAILED \(.*unverifiable.*\); run proceeds local-only, no PR opened\./);
  const dir = tmpDir('ct-pr-early-gate-');
  fs.writeFileSync(path.join(dir, 'decisions.md'), `${h.lines.join('\n')}\n`);
  assert.ok(hasLoggedPrDegrade(dir));
});

test('a stale recorded PR is cleared and logged when the push then degrades', async () => {
  const h = harness({ runState: { pr: { number: 9 } }, view: { state: 'CLOSED' }, list: [], push: [new Error('fatal: Authentication failed')] });
  const res = await openPrEarly(OPTS, h.deps);
  assert.equal(res.outcome, 'push-failed');
  assert.deepEqual(h.calls.filter((c) => c[0] === 'clear'), [['clear']]);
  assert.ok(h.lines.some((l) => l.includes('PR-early run lifecycle: recorded PR #9 no longer open; none reused or created.')));
});

test('a stale recorded PR is cleared and logged when the create then degrades', async () => {
  const h = harness({ runState: { pr: { number: 9 } }, view: { state: 'CLOSED' }, list: [], create: [new Error('HTTP 422'), new Error('HTTP 422')] });
  const res = await openPrEarly(OPTS, h.deps);
  assert.equal(res.outcome, 'create-failed');
  assert.deepEqual(h.calls.filter((c) => c[0] === 'clear'), [['clear']]);
  assert.ok(h.lines.some((l) => l.includes('recorded PR #9 no longer open; none reused or created.')));
});

test('a stale recorded PR replaced by a reused one is logged even when the push then fails, and never cleared', async () => {
  const h = harness({ runState: { pr: { number: 9 } }, view: { state: 'CLOSED' }, list: [{ number: 7, url: URL7, state: 'OPEN' }], push: [new Error('fatal: Authentication failed')] });
  const res = await openPrEarly(OPTS, h.deps);
  assert.deepEqual(res.outcome, 'push-failed');
  assert.equal(res.number, 7);
  assert.ok(h.lines.some((l) => l.includes('recorded PR #9 no longer open; reused #7.')));
  assert.equal(h.calls.find((c) => c[0] === 'clear'), undefined);
  assert.deepEqual(h.records, [{ number: 7, url: URL7 }]);
});

test('every line written satisfies the bookkeeping-stamps gate\'s own matchers', async () => {
  const adoptedLine = `- AUTO 10:00:00 — x: adopted prior attempt abc1234 from closed PR #7 for ${BRANCH}. Reversibility: high.\n`;
  const scenarios = [
    harness({ list: [] }),
    harness({ list: [{ number: 7, url: URL7, state: 'OPEN' }] }),
    harness({ list: [{ number: 7, url: URL7, state: 'CLOSED' }] }),
    harness({ list: [{ number: 7, url: URL7, state: 'CLOSED' }], reopen: new Error('rejected') }),
    harness({ list: [{ number: 7, url: URL7, state: 'CLOSED' }], decisions: adoptedLine }),
  ];
  for (const h of scenarios) await openPrEarly(OPTS, h.deps);
  for (const h of scenarios) {
    const step1 = h.lines[0];
    assert.ok(hasPrEarlyStep1LineFor(step1, BRANCH), `Step 1 line matches: ${step1}`);
    assert.ok(!hasPrEarlyStep1LineFor(step1, `${BRANCH}-retry`), 'scoped to this branch');
    const dir = tmpDir('ct-pr-early-gate-');
    fs.writeFileSync(path.join(dir, 'decisions.md'), `## /build\n${h.lines.join('\n')}\n`);
    assert.equal(hasLoggedPrDegrade(dir), false, `a successful run's lines never read as a degrade: ${h.lines.join(' | ')}`);
  }
  const degrades = [
    harness({ push: [new Error('fatal: Authentication failed')] }),
    harness({ create: [new Error('HTTP 500'), new Error('HTTP 500')] }),
  ];
  for (const h of degrades) {
    await openPrEarly(OPTS, h.deps);
    const dir = tmpDir('ct-pr-early-gate-');
    fs.writeFileSync(path.join(dir, 'decisions.md'), `## /build\n${h.lines.join('\n')}\n`);
    assert.equal(hasLoggedPrDegrade(dir), true, `degrade line matches: ${h.lines[h.lines.length - 1]}`);
    assert.ok(hasPrEarlyStep1LineFor(h.lines[0], BRANCH));
  }
  // The spec's own rebind-failure SKIP wording contains "failed", and
  // hasLoggedPrDegrade's regex is case-insensitive, so it does read as a
  // degrade. That is harmless only because the reopened PR is recorded
  // first, so the run is never PR-less. Pin both halves.
  const rebindFail = harness({ list: [{ number: 7, url: URL7, state: 'CLOSED' }], decisions: adoptedLine, edit: new Error('HTTP 422') });
  await openPrEarly(OPTS, rebindFail.deps);
  assert.ok(hasPrEarlyStep1LineFor(rebindFail.lines[0], BRANCH));
  const dir = tmpDir('ct-pr-early-gate-');
  fs.writeFileSync(path.join(dir, 'decisions.md'), `${rebindFail.lines.join('\n')}\n`);
  assert.equal(hasLoggedPrDegrade(dir), true);
  assert.deepEqual(rebindFail.records, [{ number: 7, url: URL7 }]);
  assert.ok(rebindFail.calls.findIndex((c) => c[0] === 'record') < rebindFail.calls.findIndex(isPush));
});

test('the written line is byte-identical to what log-decision.js --section /build would write', async () => {
  const main = tmpDir('ct-pr-early-logdec-');
  fs.mkdirSync(path.join(main, '.git'));
  const runDir = path.join(main, '.claude-tweaks', 'pipelines', RUN_ID);
  fs.mkdirSync(runDir, { recursive: true });
  const code = logDecision.run(['--run', runDir, '--section', '/build', '--status', 'AUTO',
    '--text', `PR-early run lifecycle: no existing PR for ${BRANCH}; creating`, '--reversibility', 'n/a'], {
    now: () => NOW, cwd: () => main, mainRoot: main, stdout: () => {}, stderr: () => {},
  });
  assert.equal(code, 0);
  const h = harness({ list: [] });
  await openPrEarly(OPTS, h.deps);
  assert.equal(fs.readFileSync(path.join(runDir, 'decisions.md'), 'utf8'), `## /build\n${h.lines[0]}\n`);
});

// ---------------------------------------------------------------- CLI

// A run dir under a real git main checkout's .claude-tweaks/pipelines/. --run
// is anchored strictly, so a dir outside every checkout is refused.
function cliFixture({ policy = null, runState = null } = {}) {
  const root = gitRepo();
  created.push(root);
  const runDir = path.join(root, '.claude-tweaks', 'pipelines', RUN_ID);
  fs.mkdirSync(runDir, { recursive: true });
  if (policy) fs.writeFileSync(path.join(root, '.claude-tweaks', 'policy.yml'), policy);
  if (runState) fs.writeFileSync(path.join(runDir, 'run-state.json'), JSON.stringify(runState));
  const summaryFile = path.join(root, 'summary.md');
  fs.writeFileSync(summaryFile, 'A summary with `backticks` and $(dollar).\n');
  const wt = path.join(root, 'wt');
  fs.mkdirSync(wt);
  return { root, runDir, summaryFile, wt };
}

function cliDeps(fx, { list = [], create = `${URL42}\n`, push = null, ghAvailable = true, defaultBranch = 'main', view = null } = {}) {
  const out = []; const err = []; const calls = [];
  const deps = {
    cwd: () => fx.root,
    mainRoot: fx.root,
    ghAvailable: () => ghAvailable,
    gh: (args, opts) => {
      calls.push(['gh', ...args]);
      if (args[0] === 'repo' && args[1] === 'view') {
        assert.equal(opts && opts.cwd, fx.wt);
        return JSON.stringify({ nameWithOwner: REPO, url: 'https://github.com/thn-inc/claude-tweaks', defaultBranchRef: { name: defaultBranch } });
      }
      if (args[0] === 'pr' && args[1] === 'list') return JSON.stringify(list);
      if (args[0] === 'pr' && args[1] === 'view' && view) return JSON.stringify(view);
      if (args[0] === 'pr' && args[1] === 'reopen') return '';
      if (args[0] === 'pr' && args[1] === 'create') { if (create instanceof Error) throw create; return create; }
      throw new Error(`unexpected gh ${args.join(' ')}`);
    },
    git: (args, opts) => {
      calls.push(['git', ...args]);
      assert.equal(opts && opts.cwd, fx.wt);
      if (args[0] === 'branch' && args[1] === '--show-current') return `${BRANCH}\n`;
      if (args[0] === 'rev-parse' && args[1] === '--show-toplevel') return `${fx.root}\n`;
      if (args[0] === 'push') { if (push) throw push; return ''; }
      throw new Error(`unexpected git ${args.join(' ')}`);
    },
    sleep: async () => {},
    now: () => NOW,
    writeBodyFile: (name, text) => { const p = path.join(fx.root, name); fs.writeFileSync(p, text); return p; },
    stdout: (s) => out.push(s),
    stderr: (s) => err.push(s),
  };
  return { deps, out, err, calls };
}

const cliArgv = (fx, extra = []) => ['--run', fx.runDir, '--target', '#4027', '--fixes', '4027', '--title', 'T (#4027)',
  '--summary-file', fx.summaryFile, '--worktree', fx.wt, ...extra];

test('CLI: opens the draft PR, records run-state pr through writeRunState, logs under /build, exit 0', async () => {
  const fx = cliFixture({ policy: 'integration-branch: dev  # where work lands\n' });
  const h = cliDeps(fx);
  const code = await run(cliArgv(fx), h.deps);
  assert.equal(code, 0, h.err.join(''));
  assert.deepEqual(JSON.parse(h.out.join('')), { outcome: 'opened', number: 42, url: URL42 });
  const createCall = h.calls.find(isCreate);
  assert.deepEqual(createCall.slice(3, 11), ['--repo', REPO, '--draft', '--base', 'dev', '--head', BRANCH, '--title']);
  const state = JSON.parse(fs.readFileSync(path.join(fx.runDir, 'run-state.json'), 'utf8'));
  assert.deepEqual(state.pr, { number: 42, url: URL42, branch: BRANCH });
  const decisions = fs.readFileSync(path.join(fx.runDir, 'decisions.md'), 'utf8');
  assert.match(decisions, /^## \/build\n- AUTO 12:34:56 — log-decision: PR-early run lifecycle: no existing PR for/);
  assert.equal(decisions.split('\n').filter((l) => l.startsWith('- AUTO')).length, 3);
  const body = fs.readFileSync(path.join(fx.root, `pr-early-body-${RUN_ID}.md`), 'utf8');
  assert.ok(body.includes('\nA summary with `backticks` and $(dollar).\n\n### Phases'), 'summary read from the file, one trailing newline stripped');
});

test('CLI: base falls back to the GitHub default branch when integration-branch is unset — never a hardcoded main', async () => {
  const fx = cliFixture();
  const h = cliDeps(fx, { defaultBranch: 'trunk' });
  assert.equal(await run(cliArgv(fx), h.deps), 0, h.err.join(''));
  const createCall = h.calls.find(isCreate);
  assert.equal(createCall[createCall.indexOf('--base') + 1], 'trunk');
});

test('CLI: a run-pinned config.yml integration-branch overrides policy', async () => {
  const fx = cliFixture({ policy: 'integration-branch: dev\n' });
  fs.writeFileSync(path.join(fx.runDir, 'config.yml'), 'integration-branch: staging\n');
  const h = cliDeps(fx);
  assert.equal(await run(cliArgv(fx), h.deps), 0, h.err.join(''));
  const createCall = h.calls.find(isCreate);
  assert.equal(createCall[createCall.indexOf('--base') + 1], 'staging');
});

test('CLI: a logged degrade exits 3 with the result on stdout', async () => {
  const fx = cliFixture();
  const h = cliDeps(fx, { push: new Error('fatal: Authentication failed for https://github.com/') });
  assert.equal(await run(cliArgv(fx), h.deps), 3);
  assert.equal(JSON.parse(h.out.join('')).outcome, 'push-failed');
  assert.ok(hasLoggedPrDegrade(fx.runDir));
});

test('CLI: create failing twice exits 3 and logs the FAILED line', async () => {
  const fx = cliFixture();
  const h = cliDeps(fx);
  h.deps.gh = ((inner) => (args, opts) => {
    if (args[0] === 'pr' && args[1] === 'create') { h.calls.push(['gh', ...args]); throw new Error('HTTP 500'); }
    return inner(args, opts);
  })(h.deps.gh);
  assert.equal(await run(cliArgv(fx), h.deps), 3);
  assert.equal(JSON.parse(h.out.join('')).outcome, 'create-failed');
  assert.match(fs.readFileSync(path.join(fx.runDir, 'decisions.md'), 'utf8'), /gh pr create for \S+ FAILED/);
});

for (const [label, over] of [
  ['an auth push failure', { push: new Error('fatal: Authentication failed for https://github.com/') }],
  ['a create failing twice', { create: new Error('HTTP 422: Validation Failed') }],
]) {
  test(`CLI: a stale recorded PR is cleared from run-state.json when ${label} degrades, and the lines still satisfy the gate`, async () => {
    const fx = cliFixture({ runState: { worktree: null, pr: { number: 9, url: URL7 } } });
    const h = cliDeps(fx, { view: { state: 'CLOSED', url: URL7 }, ...over });
    assert.equal(await run(cliArgv(fx), h.deps), 3, h.err.join(''));
    const state = JSON.parse(fs.readFileSync(path.join(fx.runDir, 'run-state.json'), 'utf8'));
    assert.equal(state.pr, null, 'the closed PR no longer reads as live');
    const decisions = fs.readFileSync(path.join(fx.runDir, 'decisions.md'), 'utf8');
    assert.match(decisions, /PR-early run lifecycle: recorded PR #9 no longer open; none reused or created\./);
    assert.ok(hasLoggedPrDegrade(fx.runDir));
    assert.ok(hasPrEarlyStep1LineFor(decisions, BRANCH));
  });
}

for (const state of ['OPEN', 'CLOSED']) {
  test(`CLI: a ${state} match followed by a failed push exits 3 with the PR still recorded and its number on stdout`, async () => {
    const fx = cliFixture();
    const h = cliDeps(fx, { list: [{ number: 7, url: URL7, state }], push: new Error('fatal: Authentication failed') });
    assert.equal(await run(cliArgv(fx), h.deps), 3, h.err.join(''));
    const res = JSON.parse(h.out.join(''));
    assert.equal(res.outcome, 'push-failed');
    assert.equal(res.number, 7);
    const rs = JSON.parse(fs.readFileSync(path.join(fx.runDir, 'run-state.json'), 'utf8'));
    assert.deepEqual(rs.pr, { number: 7, url: URL7, branch: BRANCH });
  });
}

test('CLI: --base overrides the policy value verbatim, and skips a malformed one', async () => {
  const fx = cliFixture({ policy: 'integration-branch: my branch\n' });
  const h = cliDeps(fx);
  assert.equal(await run(cliArgv(fx, ['--base', 'release/2026.10']), h.deps), 0, h.err.join(''));
  const createCall = h.calls.find(isCreate);
  assert.equal(createCall[createCall.indexOf('--base') + 1], 'release/2026.10');
});

test('CLI: an integration-branch value containing whitespace exits 2 instead of falling back', async () => {
  const fx = cliFixture({ policy: 'integration-branch: my branch\n' });
  const h = cliDeps(fx);
  assert.equal(await run(cliArgv(fx), h.deps), 2);
  assert.match(h.err.join(''), /integration-branch.*whitespace/);
  assert.equal(h.calls.find(isPush), undefined);
});

test('CLI: gh absent exits 2 naming the MCP path, before any gh or git call', async () => {
  const fx = cliFixture();
  const h = cliDeps(fx, { ghAvailable: false });
  assert.equal(await run(cliArgv(fx), h.deps), 2);
  assert.match(h.err.join(''), /mcp__github__create_pull_request/);
  assert.match(h.err.join(''), /pr-early-run-lifecycle\.md/);
  assert.deepEqual(h.calls, []);
});

test('CLI: malformed invocations exit 2', async () => {
  const fx = cliFixture();
  const cases = [
    [],
    cliArgv(fx).filter((a, i, all) => a !== '--title' && all[i - 1] !== '--title'),
    [...cliArgv(fx), '--bogus'],
    ['--run'],
    cliArgv(fx).map((a) => (a === '4027' ? 'abc' : a)),
    cliArgv(fx).map((a) => (a === fx.summaryFile ? path.join(fx.root, 'missing.md') : a)),
    cliArgv(fx).map((a) => (a === fx.runDir ? path.join(fx.root, 'nope', RUN_ID) : a)),
  ];
  for (const argv of cases) {
    const h = cliDeps(fx);
    assert.equal(await run(argv, h.deps), 2, `argv: ${argv.join(' ')}`);
    assert.deepEqual(h.calls, [], 'no gh/git call on a malformed invocation');
  }
});

test('CLI: a run dir whose basename is not a run id exits 2', async () => {
  const fx = cliFixture();
  const specDir = path.join(fx.runDir, 'spec-4027');
  fs.mkdirSync(specDir);
  const h = cliDeps(fx);
  assert.equal(await run(cliArgv(fx).map((a) => (a === fx.runDir ? specDir : a)), h.deps), 2);
  assert.match(h.err.join(''), /run id/);
});

test('CLI: a --run that resolveTarget refuses as not anchored exits 2', async () => {
  const fx = cliFixture();
  const h = cliDeps(fx);
  h.deps.resolveTarget = () => ({ ok: false, reason: 'not-anchored' });
  assert.equal(await run(cliArgv(fx), h.deps), 2);
  assert.match(h.err.join(''), /not anchored under the main checkout/);
  assert.deepEqual(h.calls, []);
});

test('CLI: a worktree-local shadow run dir exits 2 and the shadow stays untouched', async () => {
  const main = gitRepo();
  created.push(main);
  const fx = cliFixture();
  // fx.root is a real checkout, but not the main one this call is anchored to.
  const h = cliDeps(fx);
  h.deps.mainRoot = main;
  assert.equal(await run(cliArgv(fx), h.deps), 2);
  assert.deepEqual(fs.readdirSync(fx.runDir), []);
  assert.deepEqual(h.calls, []);
});

test('CLI: a run dir outside every checkout exits 2 (strict anchoring), nothing written, nothing called', async () => {
  const outside = tmpDir('ct-pr-early-outside-');
  const runDir = path.join(outside, '.claude-tweaks', 'pipelines', RUN_ID);
  fs.mkdirSync(runDir, { recursive: true });
  const summaryFile = path.join(outside, 'summary.md');
  fs.writeFileSync(summaryFile, 'S.\n');
  const wt = path.join(outside, 'wt');
  fs.mkdirSync(wt);
  const fx = { root: outside, runDir, summaryFile, wt };
  for (const mainRoot of [undefined, gitRepo()]) {
    if (mainRoot) created.push(mainRoot);
    const h = cliDeps(fx);
    h.deps.mainRoot = mainRoot;
    assert.equal(await run(cliArgv(fx), h.deps), 2, String(mainRoot));
    assert.match(h.err.join(''), /not anchored under the main checkout/);
    assert.deepEqual(h.calls, []);
    assert.deepEqual(fs.readdirSync(runDir), [], 'no decisions.md, no run-state.json');
  }
});

test('CLI: --worktree defaults to run-state.json\'s recorded worktree', async () => {
  const fx = cliFixture();
  fs.writeFileSync(path.join(fx.runDir, 'run-state.json'), JSON.stringify({ worktree: fx.wt }));
  const h = cliDeps(fx);
  const argv = cliArgv(fx).slice(0, -2);
  assert.equal(await run(argv, h.deps), 0, h.err.join(''));
});

test('CLI: an internal error (unparseable gh output) exits 1', async () => {
  const fx = cliFixture();
  const h = cliDeps(fx);
  h.deps.gh = ((inner) => (args, opts) => (args[1] === 'list' ? 'not json' : inner(args, opts)))(h.deps.gh);
  assert.equal(await run(cliArgv(fx), h.deps), 1);
  assert.match(h.err.join(''), /pr-early-open\.js:/);
});

test('CLI: --help prints usage and exits 0 before any probe', async () => {
  const h = cliDeps(cliFixture(), { ghAvailable: false });
  assert.equal(await run(['--help'], h.deps), 0);
  assert.match(h.out.join(''), /^usage: pr-early-open\.js/);
});
