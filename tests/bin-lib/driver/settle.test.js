'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { readText } = require('../../helpers/read-skill');
const { stripComments, stripperVerdict, STRIPPER_VERDICT_MESSAGES } = require('../../helpers/strip-comments');
const SETTLE = path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'lib', 'driver', 'settle.js');
const {
  DRIVER_ESCALATION_MARKER: MARKER, reduceDetail, commentFor, escalateDetailText, hasDriverEscalationMarker,
} = require(SETTLE);

const HOSTILE = '@octocat see [here](https://evil.example/x) /Users/alice/.ssh/id_rsa ghp_' + 'a'.repeat(36)
  + ' C:\\Users\\bob\\x ' + 'f'.repeat(40) + ' closes #12 <!-- hi --> `code`'
  + ' x-/Users/thomas/secret tar -C/Users/me/x a_/Users/me/x foo./home/me/.ssh/id_rsa';

test('AC10.1, AC10.2: reduceDetail strips a hostile detail', async () => {
  const out = reduceDetail(HOSTILE);
  for (const bad of ['@', '[', '](', '/Users/', 'ghp_', 'f'.repeat(40), '#', 'C:/Users', '`', '/home/', '.ssh']) {
    assert.ok(!out.includes(bad), `output contains ${bad}: ${out}`);
  }
  assert.ok(!/<!--/.test(out));
  assert.ok(!out.includes('C:'), `drive letter survived: ${out}`);
  assert.ok(out.includes('at octocat'));
  assert.ok(out.includes('<path>'));
  assert.ok(out.includes('<redacted>'));
  assert.ok(out.length <= 200);
});

test('AC10.2: reduceDetail redacts file URLs, paths after a closing paren, and prefixed tokens', async () => {
  const url = reduceDetail('file:///etc/passwd');
  assert.ok(!url.includes('/etc/passwd') && !/file:\/*[A-Za-z]/.test(url), url);
  assert.equal(url, 'file:<path>');
  const paren = reduceDetail('see (x)/Users/alice/y');
  assert.ok(!paren.includes('/Users/'), paren);
  assert.equal(paren, 'see (x)<path>');
  assert.equal(reduceDetail('(see /tmp/x)'), '(see <path>)');
  assert.equal(reduceDetail('failed at /tmp/x, then /tmp/y.'), 'failed at <path>, then <path>.');
  assert.equal(reduceDetail('at C:/Users/a/b).'), 'at <path>).');
  assert.equal(reduceDetail('see /tmp/x.log now'), 'see <path> now');
  const tok = reduceDetail('my_ghp_' + 'a'.repeat(36) + ' end');
  assert.ok(!tok.includes('ghp_') && tok.includes('<redacted>'), tok);
});

test('AC10.1: reduceDetail keeps only the allowed characters', async () => {
  assert.match(reduceDetail('a\tb\nc$%^&*=+!?~|{}"\'é'), /^[A-Za-z0-9 .,:;_()/-]*$/);
});

test('AC10.1: reduceDetail caps at 200 and never ends in a partial placeholder', async () => {
  const out = reduceDetail('x '.repeat(150) + '/abs/path');
  assert.ok(out.length <= 200);
  assert.ok(!/<[a-z]*$/.test(out));
  // Cut lands inside a placeholder: 195 filler chars then a path.
  const cut = reduceDetail('x'.repeat(196) + ' /abs/path');
  assert.ok(!/<[a-z]*$/.test(cut), cut);
  assert.equal(reduceDetail(''), 'none');
  assert.equal(reduceDetail(null), 'none');
});

test('AC10.1: every comment kind is built from the template plus a reduced detail', async () => {
  for (const kind of ['escalated', 'blocked-record', 'blocked-pr', 'claim']) {
    const out = commentFor(kind, { step: 'push', outcome: 'blocked', reason: 'express-error', exitCode: 4, detail: HOSTILE });
    for (const bad of ['@', '/Users/', 'ghp_', '#12']) assert.ok(!out.includes(bad), `${kind} contains ${bad}`);
    assert.ok(out.includes(reduceDetail(HOSTILE)), kind);
  }
});

test('commentFor: template details per kind', async () => {
  const f = { step: 'test', outcome: 'blocked', detail: 'red' };
  assert.match(commentFor('blocked-record', { ...f, kept: { pr: true, branch: true, worktree: true } }), /The driver labels this record bot:blocked and releases the claim\. The draft PR, branch and worktree are kept for a human\. Clear/);
  assert.match(commentFor('blocked-record', { ...f, kept: { pr: false, branch: true, worktree: true } }), /releases the claim\. The branch and worktree are kept for a human\. Clear bot:blocked/);
  assert.ok(!commentFor('blocked-record', { ...f, kept: { pr: false, branch: true, worktree: true } }).includes('draft PR'));
  assert.match(commentFor('blocked-record', { ...f, kept: { pr: false, branch: false, worktree: true } }), /releases the claim\. The worktree is kept for a human\. Clear/);
  assert.match(commentFor('blocked-record', { ...f, kept: { pr: false, branch: true, worktree: false } }), /releases the claim\. The branch is kept for a human\. Clear/);
  assert.match(commentFor('blocked-record', { ...f, kept: { pr: true, branch: false, worktree: false } }), /releases the claim\. The draft PR is kept for a human\. Clear/);
  assert.match(commentFor('blocked-record', { ...f, kept: { pr: true, branch: false, worktree: true } }), /releases the claim\. The draft PR and worktree are kept for a human\. Clear/);
  assert.match(commentFor('blocked-record', { ...f, kept: { pr: false, branch: false, worktree: false } }), /releases the claim\. Clear bot:blocked/);
  assert.ok(!commentFor('blocked-record', f).includes('kept for a human'), 'no kept members, no sentence');
  assert.match(commentFor('escalated', f), /The driver releases the claim and removes the worktree and local branch this run created\. The driver will not take/);
  assert.match(commentFor('claim', { ...f, step: 'claim', exitCode: 4 }), /could not claim this record: step claim failed \(claim-targets\.js exit 4\)\. Detail/);
  assert.match(commentFor('claim', { ...f, step: 'claim', exitCode: 'x' }), /failed\. Detail/);
  assert.throws(() => commentFor('nope', f));
});

test('commentFor: fields outside the closed sets render as unknown and nothing throws', async () => {
  const hostile = { step: '@bob closes #9', outcome: '@bob #9', reason: '@bob #9', exitCode: '4 @bob', detail: 'd' };
  for (const kind of ['escalated', 'blocked-record', 'blocked-pr', 'claim']) {
    const out = commentFor(kind, hostile);
    assert.ok(out.includes('unknown'), kind);
    assert.ok(!/@|#9|bob/.test(out), kind + ': ' + out);
  }
  assert.ok(!commentFor('claim', hostile).includes('claim-targets.js exit'));
  assert.ok(!commentFor('claim', { ...hostile, exitCode: 1e300 }).includes('claim-targets.js exit'));
  assert.ok(commentFor('claim', { step: 'claim', outcome: 'blocked', exitCode: 3, detail: 'd' }).includes('step claim failed (claim-targets.js exit 3)'));
  assert.ok(commentFor('escalated', { step: 'push', reason: 'gate-denial', detail: 'd' }).includes('reason gate-denial'));
  assert.ok(escalateDetailText({ step: '@bob closes #9', detail: 'd', removes: false }).startsWith('drive.js stopped at step unknown:'));
});

test('escalateDetailText reduces a raw detail once', async () => {
  const out = escalateDetailText({ step: 'test', detail: '@bob /Users/x/y ghp_' + 'a'.repeat(36), removes: false });
  for (const want of ['at bob', '<path>', '<redacted>']) assert.ok(out.includes(want), out);
  for (const bad of ['@', '/Users/', 'ghp_']) assert.ok(!out.includes(bad), out);
});

test('AC11.1: the escalated comment ends with the marker, no other kind contains it', async () => {
  const f = { step: 'push', outcome: 'express-escalated', reason: 'r', detail: 'd' };
  assert.ok(commentFor('escalated', f).endsWith(MARKER));
  for (const kind of ['blocked-record', 'blocked-pr', 'claim']) {
    assert.ok(!commentFor(kind, f).includes(MARKER), kind);
  }
});

test('AC11.1: hasDriverEscalationMarker trusts only OWNER/MEMBER/COLLABORATOR', async () => {
  const body = 'x\n\n' + MARKER;
  assert.equal(hasDriverEscalationMarker([{ authorAssociation: 'MEMBER', body }]), true);
  assert.equal(hasDriverEscalationMarker([{ authorAssociation: 'NONE', body }]), false);
  assert.equal(hasDriverEscalationMarker([{ body }]), false);
  assert.equal(hasDriverEscalationMarker([]), false);
  assert.equal(hasDriverEscalationMarker([null, 'x', { body: MARKER }]), false);
  assert.equal(hasDriverEscalationMarker([null, 'x', { authorAssociation: 'OWNER', body }]), true);
  for (const bad of ['x', null, {}]) assert.equal(hasDriverEscalationMarker(bad), null);
  assert.equal(hasDriverEscalationMarker([{ authorAssociation: 'MEMBER', body: MARKER + ' later text' }]), false);
});

test('escalate detail names the removal', async () => {
  const yes = escalateDetailText({ step: 'test', detail: 'red tests', removes: true });
  assert.equal(yes, 'drive.js stopped at step test: red tests. The driver removed the worktree and local branch this run created.');
  assert.ok(!escalateDetailText({ step: 'test', detail: 'red tests', removes: false }).includes('removed'));
});

test('AC6.1: settle.js requires no model module', async () => {
  const raw = readText(SETTLE);
  const stripped = stripComments(raw);
  assert.equal(stripperVerdict(raw, stripped), 'ok', STRIPPER_VERDICT_MESSAGES[stripperVerdict(raw, stripped)]);
  const bad = (s) => /require\([^)]*\b(worker|roles)\b/.test(s) || /['"]\.\/(worker|roles)(\.js)?['"]/.test(s);
  assert.ok(!bad(stripped));
  assert.ok(bad("const w = require('./worker');"), 'go-red control');
});

// ---- settle(): the table and the runner (Task 2) --------------------------------------
const fs = require('node:fs');
const os = require('node:os');
const { settle, selectRow, toEscalationReason, SETTLE_ROWS } = require(SETTLE);
const { SETTLE_STEP_NAMES, STEP_NAMES, CLI_TIMEOUT_MS } = require('../../../plugin/bin/lib/driver/events');
const ENV = { SETTLE_TEST_ENV: '1' };
const NODE_OPTS = { cwd: '/work/main', timeout: CLI_TIMEOUT_MS, env: ENV };

const RD = path.join('/work', 'run');
const MAIN = '/work/main';
const WT = '/work/wt';
const R = 'acme/w';

function stopOf(over = {}) {
  return { step: 'test', class: 'pre-push', pushed: false, created: { worktree: true, branch: true }, reason: 'failing-test', detail: 'red tests', checkLogged: null, ...over };
}

// Fake deps recording every call in order; `answers` scripts gh/git/node.
async function harness({ stop, input = {}, answers = {}, readFile, pathImpl, realpath } = {}) {
  const calls = [];
  const trace = [];
  const files = {};
  const emitted = [];
  const launches = [];
  let tick = 0;
  const reply = (v) => { if (v instanceof Error) throw v; return v; };
  const deps = {
    env: ENV,
    gh: (args) => { calls.push(['gh', ...args]); trace.push(calls[calls.length - 1]); return reply(answers.gh?.(args)) ?? ''; },
    git: (args, opts) => {
      calls.push(['git', ...args]);
      trace.push(calls[calls.length - 1]);
      assert.deepStrictEqual(opts, { cwd: MAIN }, 'git is called with cwd mainRoot');
      // `worktree list` defaults to the main checkout plus WT registered.
      const dflt = args.includes('list') ? `worktree ${MAIN}\nHEAD abc\nbranch refs/heads/main\n\nworktree ${WT}\nHEAD abc\nbranch refs/heads/drive-record-7\n` : '';
      return reply(answers.git?.(args)) ?? dflt;
    },
    node: (script, args, opts) => {
      calls.push(['node', path.basename(script), ...args]);
      trace.push(calls[calls.length - 1]);
      assert.deepStrictEqual(opts, NODE_OPTS, 'node is called with cwd mainRoot, the CLI timeout and deps.env');
      const a = answers.node?.(path.basename(script), args);
      if (a instanceof Error) throw a;
      return a ?? { code: 0, stdout: '', stderr: '' };
    },
    writeFile: (p, s) => { files[p] = s; trace.push(['write', p]); },
    readFile: readFile || (() => { const e = new Error('ENOENT'); e.code = 'ENOENT'; throw e; }),
    pathImpl,
    realpath,
    now: () => (tick += 5),
    // Recorded, not thrown: step() swallows a throw made inside a handler.
    launchWorker: (...a) => { launches.push(a); },
  };
  const full = {
    stop: stop || stopOf(), record: 7, runId: 'r1', runDir: RD, wt: WT, branch: 'drive-record-7', pr: null, claimed: false,
    mainRoot: MAIN, ghRepo: R, emit: (...a) => emitted.push(a), ...input,
  };
  const res = await settle(full, deps);
  return { res, calls, files, emitted, trace, launches };
}

const ESC_DETAIL = path.join(RD, 'settle-escalate.txt');
const ESCALATE = (reason = 'failing-test') => ['node', 'express-lane.js', 'escalate', '--run', RD, '--issue', '7', '--reason', reason, '--detail-file', ESC_DETAIL];
const COMMENT = (body) => ['gh', 'issue', 'comment', '--repo', R, '--body', body, '--', '7'];
const PR_COMMENT = (body, n = 9) => ['gh', 'pr', 'comment', '--repo', R, '--body', body, '--', String(n)];
const LABEL = ['gh', 'issue', 'edit', '--repo', R, '--add-label', 'bot:blocked', '--', '7'];
const RELEASE = (reason) => ['node', 'release-claim.js', '7', '--run', RD, '--reason', reason];
const LIST_WT = ['git', '-C', MAIN, 'worktree', 'list', '--porcelain'];
const RM_WT = ['git', '-C', MAIN, 'worktree', 'remove', '--force', '--force', WT];
const RM_BR = ['git', '-C', MAIN, 'branch', '-D', '--end-of-options', 'drive-record-7'];
const CLOSE = ['node', 'hooks.js', 'close-run', '--run', RD];
const BR_PROBE = ['git', '-C', MAIN, 'rev-parse', '--verify', '--quiet', '--end-of-options', 'refs/heads/drive-record-7'];
const ESCALATED_BODY = commentFor('escalated', { step: 'test', outcome: 'express-escalated', reason: 'failing-test', detail: 'red tests' });
const blockedRecord = (over) => commentFor('blocked-record', { step: 'test', outcome: 'blocked', detail: 'red tests', ...over });
const noThrow = (fn) => assert.doesNotReject(fn);

test('SETTLE_STEP_NAMES is the eight settle calls and STEP_NAMES holds the nineteen steps', async () => {
  assert.deepStrictEqual([...SETTLE_STEP_NAMES], ['settle-escalate', 'settle-comment-pr', 'settle-comment-record', 'settle-label', 'settle-release', 'settle-remove-worktree', 'settle-delete-branch', 'settle-close']);
  assert.ok(Object.isFrozen(SETTLE_STEP_NAMES));
  assert.equal(STEP_NAMES.length, 19);
  for (const rows of Object.values(SETTLE_ROWS)) for (const s of rows) assert.ok(SETTLE_STEP_NAMES.includes(s), s);
});

test('toEscalationReason passes members through and maps the rest to express-error', async () => {
  for (const r of ['failing-test', 'out-of-bounds', 'gate-denial', 'express-error']) assert.equal(toEscalationReason(r), r);
  for (const r of ['stop', '', undefined, null, 5, '@bob']) assert.equal(toEscalationReason(r), 'express-error');
});

test('selectRow maps every class and its pushed / prRecorded branches', async () => {
  const sel = (stop, prRecorded = false) => selectRow(stop, { prRecorded });
  assert.deepStrictEqual(sel({ class: 'refused' }), { row: 'refused', unclassified: false });
  assert.deepStrictEqual(sel({ class: 'claim', reason: 'claim-exit-3' }), { row: 'claim-contested', unclassified: false });
  assert.deepStrictEqual(sel({ class: 'claim', reason: 'claim-exit-4' }), { row: 'claim', unclassified: false });
  assert.deepStrictEqual(sel({ class: 'claim', reason: 'fail' }), { row: 'claim', unclassified: false });
  assert.deepStrictEqual(sel({ class: 'pre-push', pushed: false }), { row: 'pre-push', unclassified: false });
  assert.deepStrictEqual(sel({ class: 'pre-push', pushed: true }), { row: 'blocked', unclassified: false });
  assert.deepStrictEqual(sel({ class: 'pre-push', pushed: false }, true), { row: 'blocked', unclassified: false });
  assert.deepStrictEqual(sel({ class: 'blocked' }), { row: 'blocked', unclassified: false });
  assert.deepStrictEqual(sel({ class: 'none' }), { row: 'none', unclassified: false });
  assert.deepStrictEqual(sel({ class: 'bogus' }), { row: 'blocked', unclassified: true });
  assert.deepStrictEqual(sel({}), { row: 'blocked', unclassified: true });
});

test('SETTLE_ROWS is frozen and holds the table', async () => {
  assert.ok(Object.isFrozen(SETTLE_ROWS));
  assert.deepStrictEqual(SETTLE_ROWS, {
    refused: [], 'claim-contested': [], none: [],
    claim: ['settle-comment-record', 'settle-label'],
    'pre-push': ['settle-escalate', 'settle-comment-record', 'settle-release', 'settle-remove-worktree', 'settle-delete-branch', 'settle-close'],
    blocked: ['settle-comment-pr', 'settle-comment-record', 'settle-label', 'settle-release'],
  });
});

test('AC1.1, AC11.9: a pre-push stop check did not log runs escalate, comment, release, worktree removal, branch deletion in order', async () => {
  const h = await harness();
  assert.deepStrictEqual(h.calls, [
    ESCALATE(), COMMENT(ESCALATED_BODY), RELEASE('drive.js settle: express-escalated at test'), LIST_WT, RM_WT, BR_PROBE, RM_BR, CLOSE,
  ]);
  assert.equal(h.files[ESC_DETAIL], escalateDetailText({ step: 'test', detail: 'red tests', removes: true }));
  assert.ok(!h.calls.some((c) => c.includes('--remove-grants')));
  assert.ok(!h.calls.some((c) => c[0] === 'gh' && c[1] === 'issue' && c[2] === 'edit'), 'no label');
  assert.equal(h.res.row, 'pre-push');
  assert.equal(h.res.settledClass, 'pre-push');
  assert.deepStrictEqual(h.res.failed, []);
  assert.deepStrictEqual(h.res.calls.map((c) => c.step), SETTLE_ROWS['pre-push']);
  assert.ok(h.res.calls.every((c) => c.status === 'ok'));
});

test('AC1.2: a check verdict that logged its own line skips escalate', async () => {
  const h = await harness({ stop: stopOf({ step: 'check', checkLogged: true, reason: 'out-of-bounds' }) });
  assert.ok(!h.calls.some((c) => c[1] === 'express-lane.js'));
  const body = commentFor('escalated', { step: 'check', outcome: 'express-escalated', reason: 'out-of-bounds', detail: 'red tests' });
  assert.deepStrictEqual(h.calls, [COMMENT(body), RELEASE('drive.js settle: express-escalated at check'), LIST_WT, RM_WT, BR_PROBE, RM_BR, CLOSE]);
  assert.deepStrictEqual(h.res.calls.map((c) => c.step), SETTLE_ROWS['pre-push'].slice(1));
});

test('a failing close-run is a fail step listed in failed and does not change the row', async () => {
  for (const answer of [() => ({ code: 1, stdout: '', stderr: 'boom' }), () => new Error('spawn failed')]) {
    const h = await harness({ answers: { node: (s) => (s === 'hooks.js' ? answer() : undefined) } });
    assert.equal(h.res.row, 'pre-push');
    assert.deepStrictEqual(h.res.failed, ['settle-close']);
    const last = h.res.calls[h.res.calls.length - 1];
    assert.equal(last.step, 'settle-close');
    assert.equal(last.status, 'fail');
    assert.equal(h.calls.filter((c) => c[1] === 'hooks.js').length, 1, 'never retried');
    assert.equal(h.emitted[h.emitted.length - 1][1], 'fail');
  }
});

test('AC1.3: check logged:false calls escalate with check\'s reason and detail', async () => {
  const h = await harness({ stop: stopOf({ step: 'check', checkLogged: false, reason: 'gate-denial', detail: 'gate-denial: x' }) });
  assert.deepStrictEqual(h.calls[0], ESCALATE('gate-denial'));
  assert.equal(h.files[ESC_DETAIL], escalateDetailText({ step: 'check', detail: 'gate-denial: x', removes: true }));
  assert.ok(h.files[ESC_DETAIL].includes(reduceDetail('gate-denial: x')));
});

test('a pre-push stop after a proceeding check still escalates', async () => {
  const h = await harness({ stop: stopOf({ step: 'push', checkLogged: true, reason: 'stop' }) });
  assert.deepStrictEqual(h.calls[0], ESCALATE('express-error'));
});

test('escalate detail says removes:false when the row removes nothing', async () => {
  const h = await harness({ stop: stopOf({ created: { worktree: false, branch: false } }) });
  assert.equal(h.files[ESC_DETAIL], escalateDetailText({ step: 'test', detail: 'red tests', removes: false }));
});

test('AC1.4: a failed escalate keeps the worktree and branch and settles by the blocked row', async () => {
  for (const answer of [() => ({ code: 1, stdout: '', stderr: 'boom\nmore' }), () => new Error('spawn failed')]) {
    const h = await harness({ answers: { node: (s) => (s === 'express-lane.js' ? answer() : undefined) } });
    assert.deepStrictEqual(h.calls, [
      ESCALATE(), COMMENT(blockedRecord({ kept: { pr: false, branch: true, worktree: true } })), LABEL, RELEASE('drive.js settle: blocked at test'),
    ]);
    assert.ok(!h.calls.some((c) => c.some((a) => a.includes(MARKER))), 'no escalation marker');
    assert.ok(!h.calls.some((c) => c[1] === 'hooks.js'), 'no close-run');
    assert.equal(h.res.row, 'blocked');
    assert.equal(h.res.settledClass, 'blocked');
    assert.deepStrictEqual(h.res.failed, ['settle-escalate']);
    assert.equal(h.res.calls[0].status, 'fail');
  }
});

test('AC2.1: a blocked stop after the push comments on PR and record, labels, releases, removes nothing', async () => {
  const stop = stopOf({ step: 'set-config', class: 'blocked', pushed: true });
  const h = await harness({ stop, input: { pr: 9 } });
  const rec = commentFor('blocked-record', { step: 'set-config', outcome: 'blocked', detail: 'red tests', kept: { pr: true, branch: true, worktree: true } });
  assert.deepStrictEqual(h.calls, [
    PR_COMMENT(commentFor('blocked-pr', { step: 'set-config', outcome: 'blocked', detail: 'red tests' })),
    COMMENT(rec), LABEL, RELEASE('drive.js settle: blocked at set-config'),
  ]);
  const flat = h.calls.map((c) => c.join(' '));
  for (const bad of ['pr close', 'worktree remove', 'branch -D']) assert.ok(!flat.some((c) => c.includes(bad)), bad);
  assert.equal(h.res.row, 'blocked');
  assert.equal(h.res.settledClass, 'blocked');
});

test('AC2.2: a failed gh pr create (pushed, no PR) comments on the record only and keeps worktree and branch', async () => {
  const h = await harness({ stop: stopOf({ step: 'pr', class: 'blocked', pushed: true }) });
  assert.ok(!h.calls.some((c) => c[1] === 'pr'));
  assert.deepStrictEqual(h.calls.map((c) => c[0] + ' ' + c[1]), ['gh issue', 'gh issue', 'node release-claim.js']);
  const body = commentFor('blocked-record', { step: 'pr', outcome: 'blocked', detail: 'red tests', kept: { pr: false, branch: true, worktree: true } });
  assert.deepStrictEqual(h.calls[0], COMMENT(body));
  assert.ok(body.includes('The branch and worktree are kept for a human.') && !body.includes('draft PR'));
  assert.deepStrictEqual(h.res.calls.map((c) => c.step), ['settle-comment-record', 'settle-label', 'settle-release']);
});

test('AC2.3: a pre-push stop with pushed true is settled by the blocked row', async () => {
  const h = await harness({ stop: stopOf({ pushed: true }) });
  assert.equal(h.res.row, 'blocked');
  assert.equal(h.res.settledClass, 'blocked');
  assert.ok(!h.calls.some((c) => c[1] === 'express-lane.js' || c.includes('remove') || c.includes('-D')));
});

test('AC2.4: a record-pr failure after the PR was created comments on the PR, keeps the worktree and branch', async () => {
  const h = await harness({ stop: stopOf({ step: 'record-pr', class: 'blocked', pushed: true }), input: { pr: 9 } });
  assert.deepStrictEqual(h.calls[0], PR_COMMENT(commentFor('blocked-pr', { step: 'record-pr', outcome: 'blocked', detail: 'red tests' })));
  assert.ok(!h.calls.some((c) => c.includes('remove') || c.includes('-D')));
});

test('AC2.5: run-state.json recording a PR makes a pre-push stop blocked', async () => {
  const { writeRunState } = require('../../../plugin/bin/lib/hooks/context');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'settle-ac25-'));
  try {
    writeRunState(dir, { pr: { number: 11, url: 'https://github.com/acme/w/pull/11' } });
    const h = await harness({ stop: stopOf(), input: { runDir: dir }, readFile: (p) => fs.readFileSync(p, 'utf8') });
    assert.equal(h.res.row, 'blocked');
    assert.deepStrictEqual(h.calls[0], PR_COMMENT(commentFor('blocked-pr', { step: 'test', outcome: 'blocked', detail: 'red tests' }), 11));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a run-state.json without a PR (or a missing one) leaves the pre-push row', async () => {
  for (const readFile of [() => '{"foo":1}', () => 'null', () => '{"pr":null}', undefined]) {
    const h = await harness({ readFile });
    assert.equal(h.res.row, 'pre-push');
    assert.equal(h.res.note, null);
  }
});

test('an unreadable or unparseable run-state.json settles a pre-push stop by the blocked row with a note', async () => {
  const NOTE = 'run-state.json unreadable; settled by the blocked row to keep the work';
  const eacces = () => { throw Object.assign(new Error('EACCES'), { code: 'EACCES' }); };
  for (const readFile of [eacces, () => 'not json', () => '']) {
    const h = await harness({ readFile });
    assert.equal(h.res.row, 'blocked');
    assert.equal(h.res.note, NOTE);
    assert.ok(!h.calls.some((c) => c[1] === 'express-lane.js' || c.includes('-D') || c.includes('remove')));
    assert.deepStrictEqual(h.res.calls.map((c) => c.step), ['settle-comment-record', 'settle-label', 'settle-release']);
  }
  // A class that never reads for a reason (blocked, not pre-push) carries no such note.
  assert.equal((await harness({ stop: stopOf({ class: 'blocked', pushed: true }), readFile: eacces })).res.note, null);
  // A pre-push stop that pushed was blocked anyway: the unreadable note would be misleading.
  assert.equal((await harness({ stop: stopOf({ pushed: true }), readFile: eacces })).res.note, null);
  // A caller-supplied PR number is not read from the file at all.
  assert.equal((await harness({ input: { pr: 9 }, readFile: eacces })).res.note, null);
});

test('a run-state.json with a pr key but no safe-integer number settles a pre-push stop by the blocked row and removes nothing', async () => {
  const NOTE = 'run-state.json unreadable; settled by the blocked row to keep the work';
  for (const readFile of [() => '{"pr":{}}', () => '{"pr":{"number":"12"}}']) {
    const h = await harness({ readFile });
    assert.equal(h.res.row, 'blocked');
    assert.equal(h.res.note, NOTE);
    assert.ok(!h.calls.some((c) => c.includes('remove') || c.includes('-D')), 'no worktree remove, no branch -D');
    assert.deepStrictEqual(h.res.calls.map((c) => c.step), ['settle-comment-record', 'settle-label', 'settle-release']);
  }
});

test('AC3.1: a refusal makes no call', async () => {
  const h = await harness({ stop: stopOf({ class: 'refused' }) });
  assert.deepStrictEqual(h.calls, []);
  assert.equal(h.res.row, 'refused');
  assert.deepStrictEqual(h.emitted, []);
  assert.deepStrictEqual(h.res.calls, []);
});

test('AC3.2: a claim held by another run makes no call', async () => {
  const h = await harness({ stop: stopOf({ class: 'claim', reason: 'claim-exit-3' }) });
  assert.deepStrictEqual(h.calls, []);
  assert.equal(h.res.row, 'claim-contested');
  assert.equal(h.res.settledClass, 'claim');
});

test('AC3.3: other claim failures write exactly the record comment and bot:blocked', async () => {
  for (const n of [4, 5, 6, 7]) {
    const stop = stopOf({ step: 'claim', class: 'claim', reason: `claim-exit-${n}`, detail: 'why', created: { worktree: false, branch: false } });
    const h = await harness({ stop });
    const body = commentFor('claim', { step: 'claim', outcome: 'blocked', exitCode: n, detail: 'why' });
    assert.ok(body.includes(`exit ${n}`));
    assert.deepStrictEqual(h.calls, [COMMENT(body), LABEL], `exit ${n}`);
    assert.equal(h.res.row, 'claim');
    assert.equal(h.res.settledClass, 'claim');
    assert.equal(h.res.note === null, n !== 5, `note for exit ${n}`);
    if (n === 5) assert.equal(h.res.note, 'a claim that may have been written lapses by its TTL');
  }
  // A claim-targets.js killed or timed out (no integer exit) may have written its claim too.
  const killed = await harness({ stop: stopOf({ step: 'claim', class: 'claim', reason: 'claim-exit-none', detail: 'killed' }), input: { claimed: false } });
  assert.equal(killed.res.row, 'claim');
  assert.equal(killed.res.note, 'a claim that may have been written lapses by its TTL');
  // The same calls as the integer-exit loop above: the comment (no exit number) and the label, no release.
  assert.deepStrictEqual(killed.calls, [COMMENT(commentFor('claim', { step: 'claim', outcome: 'blocked', detail: 'killed' })), LABEL]);
  assert.ok(!killed.calls.some((c) => c[1] === 'release-claim.js'));
  const mint = await harness({ stop: stopOf({ step: 'run-dir', class: 'claim', reason: 'fail', detail: 'no dir' }), input: { runDir: null, claimed: false } });
  const body = commentFor('claim', { step: 'run-dir', outcome: 'blocked', detail: 'no dir' });
  assert.ok(!body.includes('claim-targets.js exit'));
  assert.deepStrictEqual(mint.calls, [COMMENT(body), LABEL]);
  assert.equal(mint.res.note, null);
  const claimed = await harness({ stop: stopOf({ step: 'run-dir', class: 'claim', reason: 'fail', detail: 'no dir' }), input: { runDir: null, claimed: true } });
  assert.equal(claimed.res.note, 'a claim that may have been written lapses by its TTL');
  assert.ok(!claimed.calls.some((c) => c[1] === 'release-claim.js'));
});

test('AC3.4: a pre-push stop whose created says nothing was made removes nothing', async () => {
  const h = await harness({ stop: stopOf({ created: { worktree: false, branch: false } }) });
  assert.deepStrictEqual(h.calls, [ESCALATE(), COMMENT(ESCALATED_BODY), RELEASE('drive.js settle: express-escalated at test'), CLOSE]);
  assert.ok(!h.calls.some((c) => c.includes('rev-parse')));
  const onlyBranch = await harness({ stop: stopOf({ created: { worktree: false, branch: true } }) });
  assert.deepStrictEqual(onlyBranch.calls.slice(-3), [BR_PROBE, RM_BR, CLOSE]);
  const onlyWt = await harness({ stop: stopOf({ created: { worktree: true, branch: false } }) });
  assert.deepStrictEqual(onlyWt.calls.slice(-3), [LIST_WT, RM_WT, CLOSE]);
  for (const part of [onlyBranch, onlyWt]) {
    assert.equal(part.files[ESC_DETAIL], escalateDetailText({ step: 'test', detail: 'red tests', removes: true }));
  }
  const noCreated = await harness({ stop: stopOf({ created: undefined }) });
  assert.ok(!noCreated.calls.some((c) => c[0] === 'git'));
});

test('a worktree or branch already gone is not a failure', async () => {
  // Unregistered worktree: no remove call at all (registration is read from the porcelain list, not from git's error text).
  const h = await harness({
    answers: {
      git: (args) => {
        if (args.includes('rev-parse')) return Object.assign(new Error('x'), { status: 1 });
        if (args.includes('list')) return `worktree ${MAIN}\nHEAD abc\nbranch refs/heads/main\n`;
        return undefined;
      },
    },
  });
  assert.deepStrictEqual(h.calls.filter((c) => c[0] === 'git'), [LIST_WT, BR_PROBE]);
  const wt = h.res.calls.find((c) => c.step === 'settle-remove-worktree');
  const br = h.res.calls.find((c) => c.step === 'settle-delete-branch');
  assert.deepStrictEqual([wt.status, wt.detail, br.status, br.detail], ['ok', 'already gone', 'ok', 'already gone']);
  assert.deepStrictEqual(h.res.failed, []);
  const other = await harness({ answers: { git: (args) => (args.includes('rev-parse') ? Object.assign(new Error('x'), { status: 128 }) : undefined) } });
  assert.deepStrictEqual(other.res.failed, ['settle-delete-branch']);
});

test('an unreadable worktree list is a fail and no removal is made', async () => {
  const broken = await harness({ answers: { git: (a) => (a.includes('list') ? new Error('fatal: list') : undefined) } });
  assert.deepStrictEqual(broken.res.failed, ['settle-remove-worktree']);
  assert.ok(!broken.calls.some((c) => c.includes('remove')));
});

test('wt is canonicalized before matching git\'s realpath\'d list: own realpath, else parent realpath plus leaf, else as given', async () => {
  const REAL = '/real/work/wt';
  const listing = { git: (a) => (a.includes('list') ? `worktree ${MAIN}\n\nworktree ${REAL}\n` : undefined) };
  const removed = (h) => h.calls.some((c) => c.includes('remove'));
  const own = await harness({ answers: listing, realpath: (p) => (p === WT ? REAL : null) });
  assert.ok(removed(own), 'own realpath');
  const parent = await harness({ answers: listing, realpath: (p) => (p === path.dirname(WT) ? '/real/work' : null) });
  assert.ok(removed(parent), 'parent realpath plus leaf');
  const none = await harness({ answers: listing, realpath: () => null });
  assert.ok(!removed(none), 'nothing resolves: wt stays as given and does not match');
  assert.equal(none.res.calls.find((c) => c.step === 'settle-remove-worktree').detail, 'already gone');
});

test('with run-state.json unreadable the record comment names no draft PR and keeps the rest of the wording', async () => {
  const eacces = () => { throw Object.assign(new Error('EACCES'), { code: 'EACCES' }); };
  const h = await harness({ readFile: eacces });
  const body = h.calls.find((c) => c[1] === 'issue' && c[2] === 'comment')[6];
  assert.ok(!body.includes('draft PR'), body);
  assert.ok(body.includes('The branch and worktree are kept for a human. Clear bot:blocked to let the record be driven again.'), body);
  assert.ok(body.includes('The driver labels this record bot:blocked and releases the claim. '), body);
});

test('win32: a backslash worktree path matches git\'s forward-slash, differently cased entry; a near-miss is already gone', async () => {
  const WIN_WT = 'D:\\a\\repo\\.claude\\worktrees\\drive-record-7';
  const listed = (p) => `worktree D:/a/repo\n\nworktree ${p}\n`;
  const run = (p) => harness({
    input: { wt: WIN_WT }, pathImpl: path.win32,
    answers: { git: (a) => (a.includes('list') ? listed(p) : undefined) },
  });
  const hit = await run('d:/a/repo/.claude/worktrees/drive-record-7');
  assert.ok(hit.calls.some((c) => c.join(' ') === ['git', '-C', MAIN, 'worktree', 'remove', '--force', '--force', WIN_WT].join(' ')), 'removal runs');
  assert.deepStrictEqual(hit.res.failed, []);
  const near = await run('d:/a/repo/.claude/worktrees/drive-record-70');
  assert.ok(!near.calls.some((c) => c.includes('remove')), 'a near-miss is not the worktree');
  assert.equal(near.res.calls.find((c) => c.step === 'settle-remove-worktree').detail, 'already gone');
  const trailing = await run('D:/a/repo/.claude/worktrees/drive-record-7/');
  assert.ok(trailing.calls.some((c) => c.includes('remove')), 'a trailing slash still matches');
  // The host path matches exactly: posix does not fold case.
  const posixCase = await harness({ answers: { git: (a) => (a.includes('list') ? `worktree ${MAIN}\n\nworktree ${WT.toUpperCase()}\n` : undefined) } });
  assert.ok(!posixCase.calls.some((c) => c.includes('remove')));
});

test('a blocked-record comment omits the kept sentence when nothing was created and there is no PR', async () => {
  assert.ok(!commentFor('blocked-record', { step: 'test', outcome: 'blocked', detail: 'd', kept: { pr: false, branch: false, worktree: false } }).includes('kept for a human'));
  const nothing = await harness({
    stop: stopOf({ created: { worktree: false, branch: false } }),
    answers: { node: (s) => (s === 'express-lane.js' ? { code: 1, stdout: '', stderr: 'e' } : undefined) },
  });
  assert.equal(nothing.res.row, 'blocked');
  const body = nothing.calls.find((c) => c[1] === 'issue' && c[2] === 'comment')[6];
  assert.ok(!body.includes('kept for a human'), body);
  const unknown = await harness({ stop: stopOf({ class: 'weird', created: undefined }) });
  assert.ok(!unknown.calls.find((c) => c[1] === 'issue' && c[2] === 'comment')[6].includes('kept for a human'));
  const made = await harness({ stop: stopOf({ class: 'blocked', pushed: true, created: { worktree: true, branch: true } }) });
  assert.ok(made.calls.find((c) => c[1] === 'issue' && c[2] === 'comment')[6].includes('The branch and worktree are kept for a human.'));
  const wtOnly = await harness({ stop: stopOf({ class: 'blocked', pushed: true, created: { worktree: true, branch: false } }) });
  assert.ok(wtOnly.calls.find((c) => c[1] === 'issue' && c[2] === 'comment')[6].includes('The worktree is kept for a human.'));
  const failedEsc = await harness({ stop: stopOf({ created: { worktree: true, branch: false } }), answers: { node: (s) => (s === 'express-lane.js' ? { code: 1, stdout: '', stderr: 'e' } : undefined) } });
  assert.ok(failedEsc.calls.find((c) => c[1] === 'issue' && c[2] === 'comment')[6].includes('The worktree is kept for a human.'));
});

test('AC7.1: a failing call does not stop the rest and is never retried', async () => {
  const h = await harness({ answers: { gh: (args) => (args[1] === 'comment' ? Object.assign(new Error('gh down'), { stderr: 'HTTP 502\nbody' }) : undefined) } });
  assert.deepStrictEqual(h.calls, [ESCALATE(), COMMENT(ESCALATED_BODY), RELEASE('drive.js settle: express-escalated at test'), LIST_WT, RM_WT, BR_PROBE, RM_BR, CLOSE]);
  assert.deepStrictEqual(h.res.failed, ['settle-comment-record']);
  assert.equal(h.emitted.length, h.res.calls.length);
  assert.equal(h.emitted.length, 6);
  const failed = h.emitted.filter((e) => e[1] === 'fail');
  assert.equal(failed.length, 1);
  assert.equal(failed[0][0], 'settle-comment-record');
  assert.equal(failed[0][3], 'HTTP 502');
  assert.equal(typeof failed[0][2], 'number');
});

test('AC7.2: release exit 3 and exit 4 are not failures', async () => {
  const rel = (code) => harness({ stop: stopOf({ class: 'blocked', pushed: true }), answers: { node: (s) => (s === 'release-claim.js' ? { code, stdout: '', stderr: 'e' } : undefined) } });
  const get = (h) => h.res.calls.find((c) => c.step === 'settle-release');
  const three = await rel(3);
  const four = await rel(4);
  assert.deepStrictEqual([get(three).status, get(three).detail], ['ok', 'already released']);
  assert.deepStrictEqual([get(four).status, get(four).detail], ['ok', 'held by another run']);
  for (const code of [1, 2, 5]) assert.equal(get(await rel(code)).status, 'fail', String(code));
  assert.deepStrictEqual(three.res.failed, []);
  assert.deepStrictEqual((await rel(1)).res.failed, ['settle-release']);
  assert.equal(get(await rel(0)).status, 'ok');
});

test('release with no run directory is a fail named no run directory and makes no call', async () => {
  const h = await harness({ stop: stopOf({ class: 'blocked', pushed: true }), input: { runDir: null } });
  const rel = h.res.calls.find((c) => c.step === 'settle-release');
  assert.deepStrictEqual([rel.status, rel.detail], ['fail', 'no run directory']);
  assert.ok(!h.calls.some((c) => c[1] === 'release-claim.js'));
});

test('AC8.1: a none stop makes no call', async () => {
  const h = await harness({ stop: stopOf({ class: 'none' }) });
  assert.deepStrictEqual(h.calls, []);
  assert.equal(h.res.row, 'none');
  assert.equal(h.res.unclassified, false);
});

test('AC8.2: an unknown class is settled by the blocked row and named unclassified', async () => {
  const h = await harness({ stop: stopOf({ class: 'bogus', pushed: false }) });
  assert.equal(h.res.row, 'blocked');
  assert.equal(h.res.unclassified, true);
  assert.deepStrictEqual(h.res.calls.map((c) => c.step), ['settle-comment-record', 'settle-label', 'settle-release']);
});

test('AC6.2: settle never calls a launcher (the harness launcher records every call)', async () => {
  await noThrow(() => harness());
  await noThrow(() => harness({ stop: stopOf({ class: 'bogus' }) }));
  for (const sc of [{}, { stop: stopOf({ class: 'bogus' }) }, { stop: stopOf({ class: 'blocked', pushed: true }), input: { pr: 9 } }, { stop: stopOf({ class: 'claim', reason: 'claim-exit-4' }) }]) {
    assert.deepStrictEqual((await harness(sc)).launches, []);
  }
});

test('an interrupted predicate stops settle before its next call: the rest are absent and the result says so', async () => {
  // The predicate is read before each call; it turns true after the first call was made.
  let reads = 0;
  const h = await harness({ input: { interrupted: () => (reads += 1) > 1 } });
  assert.deepStrictEqual(h.calls, [ESCALATE()], 'only the first call of the pre-push row');
  assert.deepStrictEqual(h.res.calls.map((c) => c.step), ['settle-escalate']);
  assert.equal(h.res.interrupted, true);
  assert.deepStrictEqual(h.res.failed, []);
  assert.equal(reads, 2, 'no read after it fired');
  // A failed first call is reported, and the blocked-row follow-up is not entered.
  let n = 0;
  const failing = await harness({
    input: { interrupted: () => (n += 1) > 1 },
    answers: { node: (s) => (s === 'express-lane.js' ? { code: 1, stdout: '', stderr: 'no' } : undefined) },
  });
  assert.deepStrictEqual(failing.res.failed, ['settle-escalate']);
  assert.equal(failing.res.interrupted, true);
  assert.deepStrictEqual(failing.calls, [ESCALATE()]);
  // Never interrupted, or no predicate: the key is absent.
  assert.ok(!('interrupted' in (await harness()).res));
  assert.ok(!('interrupted' in (await harness({ input: { interrupted: () => false } })).res));
});

const ROW_SCENARIOS = {
  claim: { stop: stopOf({ step: 'claim', class: 'claim', reason: 'claim-exit-4' }) },
  'pre-push': { stop: stopOf() },
  blocked: { stop: stopOf({ class: 'blocked', pushed: true }), input: { pr: 9 } },
  refused: { stop: stopOf({ class: 'refused' }) },
  'claim-contested': { stop: stopOf({ class: 'claim', reason: 'claim-exit-3' }) },
  none: { stop: stopOf({ class: 'none' }) },
};

test('settle reports the shape on every row', async () => {
  for (const [row, sc] of Object.entries(ROW_SCENARIOS)) {
    const h = await harness(sc);
    assert.deepStrictEqual(Object.keys(h.res).sort(), ['calls', 'failed', 'note', 'row', 'settledClass', 'unclassified'], row);
    for (const c of h.res.calls) assert.deepStrictEqual(Object.keys(c).sort(), ['detail', 'status', 'step'], row);
  }
});

test('with every precondition true, the emitted step names equal SETTLE_ROWS[row] in order', async () => {
  const scenarios = ROW_SCENARIOS;
  for (const [row, sc] of Object.entries(scenarios)) {
    const h = await harness(sc);
    assert.equal(h.res.row, row);
    assert.deepStrictEqual(h.emitted.map((e) => e[0]), [...SETTLE_ROWS[row]], row);
    assert.deepStrictEqual(h.res.calls.map((c) => c.step), [...SETTLE_ROWS[row]], row);
  }
});

test('the detail file is written before the escalate call', async () => {
  const h = await harness();
  const w = h.trace.findIndex((c) => c[0] === 'write' && c[1] === ESC_DETAIL);
  const e = h.trace.findIndex((c) => c[1] === 'express-lane.js');
  assert.ok(w >= 0 && e > w, `write at ${w}, escalate at ${e}`);
});

test('a node result with code null (a timeout) is a failure, for escalate and release', async () => {
  const timedOut = (script) => (s) => (s === script ? { code: null, stdout: '', stderr: '' } : undefined);
  const esc = await harness({ answers: { node: timedOut('express-lane.js') } });
  assert.deepStrictEqual(esc.res.failed, ['settle-escalate']);
  assert.equal(esc.res.row, 'blocked');
  const rel = await harness({ stop: stopOf({ class: 'blocked', pushed: true }), answers: { node: timedOut('release-claim.js') } });
  assert.deepStrictEqual(rel.res.failed, ['settle-release']);
});

test('a registered worktree gets the removal call; any removal failure is a fail', async () => {
  const h = await harness();
  assert.ok(h.calls.some((c) => c.join(' ') === RM_WT.join(' ')));
  assert.deepStrictEqual(h.res.failed, []);
  const rm = (err) => harness({ answers: { git: (a) => (a.includes('remove') ? err : undefined) } });
  assert.deepStrictEqual((await rm(new Error('fatal: cannot lock'))).res.failed, ['settle-remove-worktree']);
  assert.deepStrictEqual((await rm(Object.assign(new Error('x'), { stderr: `fatal: '${WT}' is not a working tree` }))).res.failed, ['settle-remove-worktree'], 'a registered worktree that fails to remove is a fail whatever git says');
});

test('the release reason names the step from the closed set', async () => {
  const h = await harness({ stop: stopOf({ step: '@bob closes #9', class: 'blocked', pushed: true }) });
  const rel = h.calls.find((c) => c[1] === 'release-claim.js');
  assert.equal(rel[rel.length - 1], 'drive.js settle: blocked at unknown');
});

test('a trailing closing paren, comma, semicolon or full stop stays outside <path> (greedy match, hand-split tail)', async () => {
  assert.equal(reduceDetail('(see /tmp/x)'), '(see <path>)');
  assert.equal(reduceDetail('(see C:/a/b);'), '(see <path>);');
  assert.equal(reduceDetail('/a...'), '<path>...');
  assert.equal(reduceDetail('/a.b,;).'), '<path>,;).');
  assert.equal(reduceDetail('x /a(b)c y'), 'x <path> y');
  // The timing budgets for 100k-character inputs live in perf/ (tests/ may not assert wall-clock).
});

test('relative paths, a lone slash and fractions are not over-redacted', async () => {
  for (const same of ['a/b', 'a/b/c', 'src/lib/x.js', 'rate 1/2 done', '/', '/ alone', 'a-b c_d']) assert.equal(reduceDetail(same), same);
  assert.equal(reduceDetail('see /tmp/x'), 'see <path>');
});

test('AC10.2: an absolute path glued to -, ., _ or a flag letter is redacted', async () => {
  assert.equal(reduceDetail('x-/Users/thomas/secret'), 'x-<path>');
  assert.equal(reduceDetail('tar -C/Users/me/x'), 'tar -C<path>');
  assert.equal(reduceDetail('a_/Users/me/x'), 'a_<path>');
  assert.equal(reduceDetail('foo./home/me/.ssh/id_rsa'), 'foo.<path>');
  assert.equal(reduceDetail('tar -I/opt/inc x'), 'tar -I<path> x');
  assert.equal(reduceDetail('cd5/Users/me/x'), 'cd5<path>');
  // Outside a home directory only the widened boundary catches a glued path.
  assert.equal(reduceDetail('x-/etc/passwd'), 'x-<path>');
  assert.equal(reduceDetail('a_/opt/secret and b./var/log'), 'a_<path> and b.<path>');
  for (const hostile of ['x-/Users/thomas/secret', 'tar -C/Users/me/x', 'a_/Users/me/x', 'foo./home/me/.ssh/id_rsa', 'build/home/me/.ssh']) {
    const out = reduceDetail(hostile);
    assert.ok(!/\/(Users|home)\//.test(out), out);
  }
});

test('a claim-class stop after the claim says so and names the TTL; a claim-step stop keeps "could not claim"', async () => {
  const after = commentFor('claim', { step: 'run-dir', outcome: 'blocked', detail: 'mint failed', exitCode: 4 });
  assert.match(after, /stopped after claiming this record, at step run-dir\. Detail: mint failed/);
  assert.match(after, /The claim lapses by its TTL\./);
  assert.ok(!after.includes('could not claim') && !after.includes('claim-targets.js exit'), after);
  const at = commentFor('claim', { step: 'claim', outcome: 'blocked', detail: 'boom' });
  assert.match(at, /could not claim this record: step claim failed\. Detail: boom/);
  assert.ok(!at.includes('lapses'), at);
});

test('GH-N and www. shapes are neutralized so a detail never backlinks or autolinks', async () => {
  assert.equal(reduceDetail('see GH-12 and gh-34'), 'see GH 12 and GH 34');
  assert.equal(reduceDetail('visit www.evil.com/phish now'), 'visit www evil.com/phish now');
  assert.equal(reduceDetail('WWW.evil.com'), 'www evil.com');
  assert.equal(reduceDetail('_www.evil.com'), '_www evil.com');
  assert.equal(reduceDetail('x_GH-12'), 'x_GH 12');
  assert.equal(reduceDetail('nowww.x'), 'nowww.x');
  assert.ok(!/\bGH-\d/i.test(commentFor('blocked-record', { step: 'test', outcome: 'blocked', detail: 'GH-1' })));
});

// ---- real git (Task 3) ------------------------------------------------------------------
const { execFileSync } = require('node:child_process');
const { gitRepo } = require('../../helpers/git-fixtures');

const IDENT = { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.test', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.test' };

// A repo with a locked driver worktree on drive-record-7 holding one commit of local work.
function lockedDriverWorktree({ symlinked = false } = {}) {
  const repo = gitRepo();
  const wt = path.join(repo, '.claude', 'worktrees', 'drive-record-7');
  if (symlinked) {
    // .claude/worktrees is a link to a directory elsewhere in the fixture: git lists the realpath'd target.
    fs.mkdirSync(path.join(repo, '.claude'));
    fs.mkdirSync(path.join(repo, 'elsewhere'));
    fs.symlinkSync(path.join(repo, 'elsewhere'), path.join(repo, '.claude', 'worktrees'), 'junction');
  }
  const env = { ...process.env, ...IDENT };
  const git = (args, extra = {}) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, env, ...extra });
  git(['-C', repo, 'worktree', 'add', '--lock', '--reason', 'drive.js record 7 (pid 1)', '-b', 'drive-record-7', wt]);
  fs.writeFileSync(path.join(wt, 'work.txt'), 'local work');
  git(['-C', wt, 'add', 'work.txt']);
  git(['-C', wt, 'commit', '-q', '-m', 'local work']);
  return { repo, wt, git };
}

async function realSettle({ repo, wt }, env) {
  const runEnv = { ...process.env, ...IDENT, ...env };
  const deps = {
    env: runEnv,
    git: (args, opts) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, env: runEnv, ...opts }),
    gh: () => '',
    node: () => ({ code: 0, stdout: '', stderr: '' }),
    writeFile: () => {},
    readFile: () => { const e = new Error('ENOENT'); e.code = 'ENOENT'; throw e; },
    now: () => Date.now(),
  };
  return await settle({
    stop: stopOf(), record: 7, runId: 'r1', runDir: path.join(repo, 'run'), wt, branch: 'drive-record-7', pr: null, claimed: false,
    mainRoot: repo, ghRepo: R, emit: () => {},
  }, deps);
}

const branchExists = (git, repo) => { try { git(['-C', repo, 'rev-parse', '--verify', '--quiet', 'refs/heads/drive-record-7']); return true; } catch (e) { if (e.status === 1) return false; throw e; } };
const branchLines = (git, repo) => git(['-C', repo, 'worktree', 'list', '--porcelain']).split(/\r?\n/).filter((l) => l === 'branch refs/heads/drive-record-7');

test('AC1.5: real git — a pre-push settle removes the locked worktree and the local branch', async () => {
  const fx = lockedDriverWorktree();
  try {
    assert.ok(fs.existsSync(fx.wt));
    const res = await realSettle(fx);
    assert.deepStrictEqual(res.failed, []);
    assert.equal(fs.existsSync(fx.wt), false);
    assert.equal(branchExists(fx.git, fx.repo), false);
    assert.deepStrictEqual(branchLines(fx.git, fx.repo), []);
    const again = await realSettle(fx);
    assert.deepStrictEqual(again.failed, []);
    for (const step of ['settle-remove-worktree', 'settle-delete-branch']) {
      const c = again.calls.find((x) => x.step === step);
      assert.deepStrictEqual([c.status, c.detail], ['ok', 'already gone'], step);
    }
  } finally {
    fs.rmSync(fx.repo, { recursive: true, force: true });
  }
});

test('AC1.5: real git — a locked worktree whose directory was deleted but is still registered settles ok and the branch goes', async () => {
  const fx = lockedDriverWorktree();
  try {
    fs.rmSync(fx.wt, { recursive: true, force: true });
    assert.deepStrictEqual(branchLines(fx.git, fx.repo), ['branch refs/heads/drive-record-7'], 'precondition: still registered');
    const res = await realSettle(fx);
    assert.deepStrictEqual(res.failed, []);
    assert.equal(branchExists(fx.git, fx.repo), false);
    assert.deepStrictEqual(branchLines(fx.git, fx.repo), []);
  } finally {
    fs.rmSync(fx.repo, { recursive: true, force: true });
  }
});

test('AC1.5: real git — a worktree under a symlinked .claude/worktrees is removed, not reported already gone', async () => {
  const fx = lockedDriverWorktree({ symlinked: true });
  try {
    assert.ok(fs.existsSync(fx.wt));
    const res = await realSettle(fx);
    assert.deepStrictEqual(res.failed, []);
    assert.notEqual(res.calls.find((x) => x.step === 'settle-remove-worktree').detail, 'already gone');
    assert.equal(fs.existsSync(fx.wt), false);
    assert.equal(fs.existsSync(path.join(fx.repo, 'elsewhere', 'drive-record-7')), false);
    assert.equal(branchExists(fx.git, fx.repo), false);
  } finally {
    fs.rmSync(fx.repo, { recursive: true, force: true });
  }
});

test('AC1.5: real git — already-gone is recognised under a non-English locale', async () => {
  const fx = lockedDriverWorktree();
  try {
    const loc = { LC_ALL: 'fr_FR.UTF-8', LANG: 'fr_FR.UTF-8', LANGUAGE: 'fr' };
    assert.deepStrictEqual((await realSettle(fx, loc)).failed, []);
    const again = await realSettle(fx, loc);
    assert.deepStrictEqual(again.failed, []);
    for (const step of ['settle-remove-worktree', 'settle-delete-branch']) {
      assert.equal(again.calls.find((x) => x.step === step).detail, 'already gone', step);
    }
  } finally {
    fs.rmSync(fx.repo, { recursive: true, force: true });
  }
});
