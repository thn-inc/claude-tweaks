'use strict';
// #5227: queue-pull module suite: the registry, passes, CLI, rank and the oracle pins that need no pair
// pool. The oracle/parity header, the fence and the strings read from it, and the parity-pair machinery
// live in queue-pull-helpers.js, with the in-process pull harness (pull, pull4, inOwnTmp); the
// `#5227 parity` describes run as queue-pull-parity-{ac1,ac5,ac4,ac7,d1}.test.js, one process each (the
// AC4 describe is split across ac4 and ac7 by fault family: gh rows in ac4, files rows in ac7), and the
// slow whole-fence oracle runs and cross-checks as queue-pull-oracle-checks.test.js.
const { test, mock } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { scratchDir, isolateTmpdir } = require('../../helpers/tmp-dir');
isolateTmpdir('ct-iso-queue-pull-');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');

const { readText } = require('../../helpers/read-skill');
const { chmodDenialSkip } = require('../../helpers/root');
const { treeEntryWithContinuations } = require('../../helpers/plugin-structure-entry');
const { gitRepo, fixtureGit } = require('../../helpers/git-fixtures');
const {
  REPO, SCRIPT_MD, MCP_MD, MCP_TARGETS_FIRST_LINE, MCP_EXCLUSIONS_FIRST_LINE, FENCE_FIRST_LINE, RUN_DIR_NAME, oracleSkip, extractFence,
  fenceSessionFiles, filesOracleScript, createSandbox, runOracle, runModuleCli, withEscapeGuard, normalize, reported, assertParity, runAll,
  failedJobs, shQuote, readShimLog,
} = require('./queue-pull-oracle');
const {
  S0, S1, SEmpty, SMalformed, SPortable, SFast, fakeRun, fakeSpawnCli, agentInputs, ghAnswer, ghRecord, withBody, QUEUE_ARGV, DEP_SEARCH_8000, mention,
  WEAK_PR_FILES, OPEN_NUMBERS_ARGV, IN_FLIGHT_ARGV, OPEN_PRS_ARGV, writeInput, IN_FLIGHT_7001, OPEN_PR_41, LIVE_CLAIM, LANDING_COMMIT, PORTABLE_SLUG,
  EmptyAfterS1, S1LiveDep,
} = require('./queue-pull-fixtures');
const {
  PASSES, PASS_FIELD_VALUES, SESSION_FILES, END_WRITTEN_FILES, QueuePullStopped, sessionPaths, runPasses, resolveOmit, defaultDeps, makeContext, queuePull,
  rankNext, rankFromFiles, STAYING_EXCLUSION_REASONS, RANK_SKIP_REASONS, closedDependencyNumbers,
} = require('../../../plugin/bin/lib/dispatch/queue-pull');
const { appendExclusion } = require('../../../plugin/bin/lib/dispatch/exclusions');
const { aliasMcpTimestamps } = require('../../../plugin/bin/lib/issues/mcp-issue-shape');
const {
  FENCE, fenceText, HIT_MESSAGE, NATIVE_WARNING_PREFIX, GROUPING_STOP_RE, CACHE_HIT_STOP_RE, LINKED_WARNING, OPEN_FILTER_WARNING, OPEN_STOP,
  TARGET_STOP, NEIGHBOUR_STOP, IN_FLIGHT_POOL_AUTO, MALFORMED_CAUSE, cannedLanding, ALL_REASONS, FILES_S1_REASONS, inOwnTmp, EXPRESS_OFF,
  pull, entriesOf, FULL, pull4, NOW, NATIVE_FAIL_CLOSED_PREFIX, TARGET_MISSING_SKIPPED, CLAIM_READ_COMBINED, DEP_FRESH_USED, DEP_FRESH_WRITTEN,
  labelsWarning, LABELS_ENTRY_9020, PR_VIEW_FAILED, HOSTILE_DOC, CLOSING_BODY, runStagedComment, UNLANDED_STOP, OPEN_PR_FAIL,
} = require('./queue-pull-helpers');

const ORACLE_ENV_KEYS = new Set([
  'PATH', 'HOME', 'PWD', 'OLDPWD', 'TMPDIR', 'TZ', 'LANG', 'CLAUDE_PLUGIN_ROOT', 'CLAUDE_CODE_SESSION_ID',
  'GIT_CEILING_DIRECTORIES', 'GIT_CONFIG_NOSYSTEM', 'GIT_CONFIG_GLOBAL', 'GIT_AUTHOR_DATE', 'GIT_COMMITTER_DATE',
  'QP_SHIM_TABLE', 'QP_LOG_DIR', 'NODE_OPTIONS',
]);

test('#5227 oracle: oracleSkip names "no bash oracle" on win32 and without bash >= 4', () => {
  assert.match(oracleSkip('win32', '/bin/bash'), /no bash oracle/);
  assert.match(oracleSkip('linux', null), /no bash oracle/);
  assert.equal(oracleSkip('linux', '/bin/bash'), false);
});

test('#5227 oracle: extractFence anchors on the fence first line and reads CRLF text', () => {
  const lf = readText(SCRIPT_MD);
  assert.equal(extractFence(lf.replace(/\n/g, '\r\n'), FENCE_FIRST_LINE), extractFence(lf, FENCE_FIRST_LINE));
  assert.throws(() => extractFence(lf, 'NOT_A_LINE'), /anchor not found/);
});

test('#5227 oracle: fenceSessionFiles lists the fence --value names in order', () => {
  const names = fenceSessionFiles(extractFence(readText(SCRIPT_MD), FENCE_FIRST_LINE));
  assert.equal(names.length, 26);
  assert.equal(names[0], 'dispatch-queue-raw.json');
  assert.equal(names[25], 'dispatch-shape-gate.err');
});

test('#5227 oracle: the run env inherits nothing; the git shim refuses a directory outside the sandbox, an exported GIT_DIR and every -c key but core.quotePath', { skip: oracleSkip() }, () => {
  const sb = createSandbox(S0());
  try {
    const env = sb.runEnv({ tmpdir: path.join(sb.root, 'tmp'), sessionId: 'qp-git-probe' });
    assert.deepEqual(Object.keys(env).filter((k) => !ORACLE_ENV_KEYS.has(k) && !k.startsWith('CT_TRACE_')), [], 'nothing inherited');
    const git = (args, extra = {}) => spawnSync(path.join(sb.bin, 'git'), args, { cwd: sb.proj, env: { ...env, ...extra }, encoding: 'utf8' });
    const inside = git(['rev-parse', '--show-toplevel']);
    assert.equal(inside.status, 0, inside.stderr);
    assert.equal(inside.stdout.trim(), sb.proj);
    const outside = git(['-C', REPO, 'rev-parse', 'HEAD']);
    assert.equal(outside.status, 97);
    assert.match(outside.stderr, /git-shim: refused \(outside the sandbox/);
    // The shim refuses on the variable's presence, so a bogus in-sandbox value is enough.
    const gitDir = git(['rev-parse', '--show-toplevel'], { GIT_DIR: path.join(sb.root, 'no-such.git') });
    assert.equal(gitDir.status, 97);
    assert.match(gitDir.stderr, /GIT_DIR\/GIT_WORK_TREE set/);
    // An allow-list: the keys a deny-list named, and the two it missed (include.path pulls in a
    // config file that can set any of them; remote.<name>.receivepack runs a program on push).
    const outsideConfig = path.join(sb.root, 'evil.gitconfig');
    fs.writeFileSync(outsideConfig, '[core]\n\thooksPath = /x\n');
    const refusedSettings = ['core.hooksPath=/x', 'core.fsmonitor=true', 'core.worktree=/x', 'core.sshCommand=x', 'core.gitProxy=x', 'alias.st=!sh', 'Core.HooksPath=/x',
      `include.path=${outsideConfig}`, 'remote.origin.receivepack=x', 'user.name=x'];
    for (const setting of refusedSettings) {
      const r = git(['-c', setting, 'rev-parse', '--show-toplevel']);
      assert.equal(r.status, 97, setting);
      assert.equal(r.stderr, `git-shim: refused (config key not allowed: ${setting.split('=')[0]}): -c ${setting} rev-parse --show-toplevel\n`, setting);
    }
    for (const setting of ['core.quotePath=false', 'core.quotepath=false']) {
      const allowed = git(['-c', setting, 'rev-parse', '--show-toplevel']);
      assert.equal(allowed.status, 0, `${setting}: ${allowed.stderr}`);
    }
    const log = readShimLog(sb.logs, 'git');
    assert.equal(log.filter((e) => e.tag === 'REFUSED').length, 2 + refusedSettings.length);
  } finally {
    sb.cleanup();
  }
});

// Task 1 carry, closed in Task 9 (whose F-intbranch, F-claim and F-writeback faults inject through
// gitFail): the git shim's injected failure, its unresolvable-directory refusal and its
// unknown-global-option refusal, each pinned shim-side.
test('#5227 oracle: the git shim fails a gitFail prefix with exit 128 (after the global options) and refuses an unresolvable -C directory and an unknown global option', { skip: oracleSkip() }, () => {
  const s = S0();
  s.gitFail = [['remote', 'show', 'origin'], ['fetch', '-q', 'origin']];
  const sb = createSandbox(s);
  try {
    const env = sb.runEnv({ tmpdir: path.join(sb.root, 'tmp'), sessionId: 'qp-gitfail-probe' });
    const git = (args) => spawnSync(path.join(sb.bin, 'git'), args, { cwd: sb.proj, env, encoding: 'utf8' });
    const injected = git(['--no-optional-locks', '-C', sb.proj, 'remote', 'show', 'origin']);
    assert.equal(injected.status, 128);
    assert.equal(injected.stdout, '');
    assert.equal(injected.stderr, 'git-shim: injected failure: remote show origin\n');
    const prefixed = git(['fetch', '-q', 'origin', 'main:refs/qp-probe']);
    assert.equal(prefixed.status, 128, 'a longer argv under the prefix is failed too');
    const near = git(['fetch', 'origin', 'main']);
    assert.equal(near.status, 0, `an argv off the prefix reaches the real git: ${near.stderr}`);
    const unresolvable = git(['-C', path.join(sb.root, 'no-such-dir'), 'status']);
    assert.equal(unresolvable.status, 97);
    assert.equal(unresolvable.stderr, 'git-shim: refused (unresolvable directory ' + path.join(sb.root, 'no-such-dir') + '): -C ' + path.join(sb.root, 'no-such-dir') + ' status\n');
    const unknown = git(['--bare', 'status']);
    assert.equal(unknown.status, 97);
    assert.equal(unknown.stderr, 'git-shim: refused (unknown global option --bare): --bare status\n');
    const log = readShimLog(sb.logs, 'git');
    assert.deepEqual(log.map((e) => e.tag), ['injected', 'injected', 'delegated', 'REFUSED', 'REFUSED']);
    assert.deepEqual(log.filter((e) => e.tag === 'REFUSED').map((e) => e.why), [`unresolvable directory ${path.join(sb.root, 'no-such-dir')}`, 'unknown global option --bare']);
  } finally {
    sb.cleanup();
  }
});

test('#5227 oracle: the gh shim exits 97 and logs UNHANDLED for an unanswered argv and for a graphql alias the table lacks', { skip: oracleSkip() }, () => {
  const s = S0();
  s.gh.push({ argv: ['effect-probe'], stdout: 'done\n', effect: 'delete-session-file:probe.txt' });
  const sb = createSandbox(s);
  try {
    const env = sb.runEnv({ tmpdir: path.join(sb.root, 'tmp'), sessionId: ' qp-gh-probe ' });
    // An effect lands in the session dir the plugin's own sessionTmpRoot names (the id trimmed).
    const probe = path.join(sb.root, 'tmp', 'ct-session-qp-gh-probe', 'probe.txt');
    fs.mkdirSync(path.dirname(probe), { recursive: true });
    fs.writeFileSync(probe, 'x');
    const gh = (args) => spawnSync(path.join(sb.bin, 'gh'), args, { cwd: sb.proj, env, encoding: 'utf8' });
    const linked = (n) => `query=query{ repository{ i${n}: issue(number:${n}){ number timelineItems(itemTypes:[CROSS_REFERENCED_EVENT]){ nodes } } } }`;
    const miss = gh(['issue', 'view', '1']);
    assert.equal(miss.status, 97);
    assert.equal(miss.stdout, '');
    assert.equal(miss.stderr, 'gh-shim: no canned response for: issue view 1\n');
    const aliasMiss = gh(['api', 'graphql', '-f', linked(9002)]);
    assert.equal(aliasMiss.status, 97);
    assert.match(aliasMiss.stderr, /^gh-shim: no canned response for: api graphql /);
    const hit = gh(['api', 'graphql', '-f', linked(9001)]);
    assert.equal(hit.status, 0, hit.stderr);
    assert.deepEqual(Object.keys(JSON.parse(hit.stdout).data.repository), ['i9001']);
    const effect = gh(['effect-probe']);
    assert.equal(effect.status, 0, effect.stderr);
    assert.equal(fs.existsSync(probe), false);
    const log = readShimLog(sb.logs, 'gh');
    assert.deepEqual(log.map((e) => e.tag), ['UNHANDLED', 'UNHANDLED', 'ok', 'ok']);
    assert.deepEqual(log[0].argv, ['issue', 'view', '1']);
  } finally {
    sb.cleanup();
  }
});

test('#5227 oracle: orderBlob is null only for a missing health-state branch or order.json, and throws on a non-JSON blob', { skip: oracleSkip() }, () => {
  const sb = createSandbox(S0());
  try {
    const env = sb.runEnv({ tmpdir: path.join(sb.root, 'tmp'), sessionId: 'qp-blob-probe' });
    const git = (...args) => {
      const r = spawnSync(path.join(sb.bin, 'git'), args, { cwd: sb.proj, env, encoding: 'utf8' });
      assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
    };
    assert.equal(sb.orderBlob(), null, 'no branch');
    git('push', '-q', 'origin', 'main:refs/heads/health-state');
    assert.equal(sb.orderBlob(), null, 'branch without order.json');
    fs.mkdirSync(path.join(sb.proj, 'queue-order'));
    fs.writeFileSync(path.join(sb.proj, 'queue-order', 'order.json'), 'not json');
    git('add', 'queue-order/order.json');
    git('commit', '-q', '-m', 'blob');
    git('push', '-q', 'origin', 'HEAD:refs/heads/health-state');
    assert.throws(() => sb.orderBlob(), SyntaxError);
    fs.writeFileSync(path.join(sb.proj, 'queue-order', 'order.json'), '{"computedAt":"x"}');
    git('commit', '-q', '-am', 'json');
    git('push', '-q', 'origin', 'HEAD:refs/heads/health-state');
    assert.deepEqual(sb.orderBlob(), { computedAt: 'x' });
    // Any other git failure throws: an origin that is no repository fails rev-parse with exit 128.
    fs.renameSync(sb.origin, `${sb.origin}.moved`);
    try {
      assert.throws(() => sb.orderBlob(), (err) => err.status === 128 && /rev-parse/.test(err.message));
    } finally {
      fs.renameSync(`${sb.origin}.moved`, sb.origin);
    }
  } finally {
    sb.cleanup();
  }
});

test('#5227 oracle: withEscapeGuard rejects a run that moves the guarded repo HEAD', async () => {
  const repo = gitRepo({ parent: scratchDir('qp-guard-') });
  try {
    assert.equal(await withEscapeGuard(repo, async () => 'kept'), 'kept');
    await assert.rejects(
      withEscapeGuard(repo, async () => { fixtureGit(['-C', repo, 'commit', '--allow-empty', '-q', '-m', 'escaped']); }),
      /escape guard/,
    );
    // An untracked file created mid-run (a concurrent suite's temporary file) is not an escape.
    assert.equal(await withEscapeGuard(repo, async () => { fs.writeFileSync(path.join(repo, 'stray.txt'), 'x'); return 'ok'; }), 'ok');
    fs.rmSync(path.join(repo, 'stray.txt'));
    fs.writeFileSync(path.join(repo, 'tracked.txt'), 'a');
    fixtureGit(['-C', repo, 'add', 'tracked.txt']);
    fixtureGit(['-C', repo, 'commit', '-q', '-m', 'track']);
    await assert.rejects(
      withEscapeGuard(repo, async () => { fs.writeFileSync(path.join(repo, 'tracked.txt'), 'b'); }),
      /escape guard/, 'a tracked-file modification trips it',
    );
    fixtureGit(['-C', repo, 'checkout', '--', 'tracked.txt']);
    await assert.rejects(
      withEscapeGuard(repo, async () => {
        fs.writeFileSync(path.join(repo, 'staged.txt'), 'x');
        fixtureGit(['-C', repo, 'add', 'staged.txt']);
      }),
      /escape guard/, 'a staged change trips it',
    );
    fixtureGit(['-C', repo, 'reset', '-q']);
    // On a detached HEAD a stray commit moves no ref, so only the HEAD comparison sees it.
    fixtureGit(['-C', repo, 'checkout', '-q', '--detach']);
    await assert.rejects(
      withEscapeGuard(repo, async () => { fixtureGit(['-C', repo, 'commit', '--allow-empty', '-q', '-m', 'detached escape']); }),
      /escape guard/, 'a detached-HEAD commit trips it',
    );
    fixtureGit(['-C', repo, 'checkout', '-q', '-']);
    // A new ref: refs are shared with sibling worktrees and sessions, so only a ref carrying the
    // sandbox identity (qp-oracle) counts as an escape; an unrelated branch appearing does not.
    assert.equal(await withEscapeGuard(repo, async () => { fixtureGit(['-C', repo, 'branch', 'sibling-branch']); return 'ok'; }), 'ok');
    await assert.rejects(
      withEscapeGuard(repo, async () => {
        // Pin the identity via env: CI exports GIT_AUTHOR_*/GIT_COMMITTER_*, which beat `-c user.*`.
        const qpEnv = { ...process.env, GIT_AUTHOR_NAME: 'qp-oracle', GIT_AUTHOR_EMAIL: 'qp@example.invalid', GIT_COMMITTER_NAME: 'qp-oracle', GIT_COMMITTER_EMAIL: 'qp@example.invalid' };
        const sha = fixtureGit(['-C', repo, '-c', 'user.name=qp-oracle', '-c', 'user.email=qp@example.invalid', 'commit-tree', 'HEAD^{tree}', '-m', 'escaped'], { encoding: 'utf8', env: qpEnv }).trim();
        fixtureGit(['-C', repo, 'update-ref', 'refs/heads/escaped-ref', sha]);
      }),
      /escape guard/, 'a new ref made by the sandbox identity trips it',
    );
    // Tags and the stash are shared with sibling sessions as well: one made by someone else mid-run
    // is not an escape; one carrying the sandbox identity is (the ref filter above).
    assert.equal(await withEscapeGuard(repo, async () => {
      fixtureGit(['-C', repo, 'tag', 'sibling-tag']);
      fixtureGit(['-C', repo, 'update-ref', 'refs/stash', 'HEAD']);
      return 'ok';
    }), 'ok');
    await assert.rejects(
      withEscapeGuard(repo, async () => { fixtureGit(['-C', repo, 'tag', 'escaped-tag', 'refs/heads/escaped-ref']); }),
      /escape guard/, 'a tag on a sandbox-identity commit trips it',
    );
    // A branch switch at the same commit moves no compared ref and no commit: only what HEAD points at.
    const branch = fixtureGit(['-C', repo, 'symbolic-ref', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
    await assert.rejects(
      withEscapeGuard(repo, async () => { fixtureGit(['-C', repo, 'checkout', '-q', 'sibling-branch']); }),
      (err) => err.message.includes(`HEAD points at refs/heads/${branch} -> refs/heads/sibling-branch\n`), 'a same-commit branch switch trips it',
    );
    await assert.rejects(
      withEscapeGuard(repo, async () => { fixtureGit(['-C', repo, 'checkout', '-q', '--detach']); }),
      (err) => err.message.includes('HEAD points at refs/heads/sibling-branch -> (detached)\n'), 'detaching HEAD at the same commit trips it',
    );
  } finally {
    fs.rmSync(path.dirname(repo), { recursive: true, force: true });
  }
});

test('#5227 oracle: runAll keys results by job name and runs an `after` job strictly after its dependency', async () => {
  const events = [];
  const gate = {};
  const released = new Promise((resolve) => { gate.open = resolve; });
  const results = await runAll([
    { name: 'miss', run: async () => { events.push('miss:start'); await released; events.push('miss:end'); return 'origin-A'; } },
    { name: 'hit', after: 'miss', run: async (dep) => { events.push('hit:start'); return `hit-on-${dep}`; } },
    { name: 'other', run: async () => { events.push('other:start'); gate.open(); return 'other'; } },
  ], 2);
  assert.deepEqual(results, { miss: 'origin-A', hit: 'hit-on-origin-A', other: 'other' });
  assert.ok(events.indexOf('other:start') < events.indexOf('miss:end'), `independent jobs run concurrently: ${events}`);
  assert.ok(events.indexOf('hit:start') > events.indexOf('miss:end'), `after-job waits: ${events}`);
  await assert.rejects(runAll([{ name: 'a', after: 'nope', run: async () => 1 }], 1), /unknown after/);
});

test('#5227 oracle: runAll settles every job; each failed job (and a job after it) throws its own error when read, and failedJobs names them all', async () => {
  const ran = [];
  const R = await runAll([
    { name: 'a', run: async () => { ran.push('a'); throw new Error('boom a'); } },
    { name: 'b', run: async () => { ran.push('b'); return 'kept'; } },
    { name: 'c', run: async () => { ran.push('c'); throw new Error('boom c'); } },
    { name: 'd', after: 'a', run: async () => { ran.push('d'); return 'never'; } },
    { name: 'e', run: async () => { ran.push('e'); return 'after the failures'; } },
  ], 1);
  assert.deepEqual(ran, ['a', 'b', 'c', 'e'], 'a failure stops no later job; a job after a failed one never runs');
  assert.deepEqual(R, { b: 'kept', e: 'after the failures' }, 'only the successes are enumerable');
  assert.throws(() => R.a, /^Error: runAll: job a failed: boom a$/);
  assert.throws(() => R.c, (err) => err.message === 'runAll: job c failed: boom c' && err.cause.message === 'boom c');
  assert.throws(() => R.d, (err) => /^runAll: job d never ran: its after job a failed$/.test(err.message) && err.cause.message === 'runAll: job a failed: boom a');
  assert.deepEqual(failedJobs(R).map(([name, err]) => [name, err.message]), [
    ['a', 'runAll: job a failed: boom a'], ['c', 'runAll: job c failed: boom c'], ['d', 'runAll: job d never ran: its after job a failed'],
  ]);
  assert.deepEqual(failedJobs(await runAll([{ name: 'x', run: async () => 1 }], 1)), [], 'no failure (control)');
});

test('#5227 oracle: fakeRun answers the shim table by exact argv and requested graphql aliases only', () => {
  const run = fakeRun({ gh: [
    { argv: ['repo', 'view'], stdout: 'a/b\n' },
    { argv: ['pr', 'list'], stdout: 'partial\n', stderr: 'boom\n', status: 1 },
    { graphql: 'linked', aliases: { i1: { number: 1 }, i2: { number: 2 } } },
  ] });
  assert.equal(run('gh', ['repo', 'view']), 'a/b\n');
  assert.throws(() => run('gh', ['repo', 'view', '--json', 'x']), /^Error: unexpected gh repo view --json x$/);
  assert.throws(() => run('gh', ['repo']), /unexpected gh repo$/);
  assert.throws(() => run('gh', ['pr', 'list']), (err) => err.status === 1 && err.stdout === 'partial\n' && err.stderr === 'boom\n');
  const query = 'query=query{ repository{ i1: issue(number:1){ number timelineItems(itemTypes:[CROSS_REFERENCED_EVENT]){ nodes } } } }';
  assert.deepEqual(JSON.parse(run('gh', ['api', 'graphql', '-f', query])), { data: { repository: { i1: { number: 1 } } } });
  assert.throws(() => run('gh', ['api', 'graphql', '-f', 'query=query{ b1: issue(number:1){ CLOSED_EVENT } }']), /unexpected gh api graphql/);
  // A requested alias the entry lacks is a miss, never a partial answer; an explicit null answers.
  const twoAliases = 'query=query{ repository{ i1: issue(number:1){ number CROSS_REFERENCED_EVENT } i3: issue(number:3){ number CROSS_REFERENCED_EVENT } } }';
  assert.throws(() => run('gh', ['api', 'graphql', '-f', twoAliases]), /^Error: unexpected gh api graphql /);
  const withNull = fakeRun({ gh: [{ graphql: 'linked', aliases: { i1: { number: 1 }, i3: null } }] });
  assert.deepEqual(JSON.parse(withNull('gh', ['api', 'graphql', '-f', twoAliases])), { data: { repository: { i1: { number: 1 }, i3: null } } });
  // A graphql entry's own stdout/stderr replace the data answer (Task 9's no-data failure), still
  // only for a query whose aliases it answers.
  const noData = fakeRun({ gh: [{ graphql: 'linked', aliases: { i1: { number: 1 } }, stdout: '', stderr: 'gh-fault\n', status: 1 }] });
  assert.throws(() => noData('gh', ['api', 'graphql', '-f', query]), (err) => err.status === 1 && err.stdout === '' && err.stderr === 'gh-fault\n');
  assert.throws(() => noData('gh', ['api', 'graphql', '-f', twoAliases]), /^Error: unexpected gh api graphql /);
  // git: the same global-option skip and prefix matcher the shim uses.
  const gitRun = fakeRun({ gh: [], gitFail: [['remote', 'show', 'origin']], remoteUrl: 'https://example.invalid/o/r.git' });
  assert.throws(() => gitRun('git', ['-c', 'core.quotePath=false', '--no-optional-locks', '-C', '/x', 'remote', 'show', 'origin']), (err) => err.status === 128);
  assert.equal(gitRun('git', ['--no-pager', 'remote', 'get-url', 'origin']), 'https://example.invalid/o/r.git\n');
  assert.throws(() => gitRun('git', ['remote', 'show']), /^Error: unexpected git remote show$/);
});

test('#5227 oracle: ghAnswer falls through a same-kind graphql entry that lacks a requested alias to the next one that holds it', () => {
  const linkedQuery = (n) => `query=query{ repository{ i${n}: issue(number:${n}){ number timelineItems(itemTypes:[CROSS_REFERENCED_EVENT]){ nodes } } } }`;
  const entries = [
    { graphql: 'linked', aliases: { i1: { number: 1 } }, stderr: 'first\n' },
    { graphql: 'landing', aliases: { i2: { number: 'wrong kind' } } },
    { graphql: 'linked', aliases: { i2: { number: 2 } }, stderr: 'second\n' },
  ];
  const second = ghAnswer(entries, ['api', 'graphql', '-f', linkedQuery(2)]);
  assert.deepEqual(JSON.parse(second.stdout), { data: { repository: { i2: { number: 2 } } } });
  assert.equal(second.stderr, 'second\n', 'the later linked entry answers, past the first and past the other kind');
  assert.equal(ghAnswer(entries, ['api', 'graphql', '-f', linkedQuery(1)]).stderr, 'first\n', 'the first entry still answers its own alias');
  assert.equal(ghAnswer(entries, ['api', 'graphql', '-f', linkedQuery(3)]), null, 'no entry holds it: a miss');
});

test('#5227 oracle: normalize substitutes only the sandbox root and run-dir name; reported keeps AUTO/Warning lines; assertParity compares them', () => {
  const sb = { root: '/scr/qp-oracle-x' };
  assert.deepEqual(
    normalize({ p: `/scr/qp-oracle-x/proj/.claude-tweaks/pipelines/${RUN_DIR_NAME}/staged`, n: [1, '12:00:00'] }, sb),
    { p: '<SCR>/proj/.claude-tweaks/pipelines/<RUN>/staged', n: [1, '12:00:00'] },
  );
  assert.deepEqual(
    reported('noise\nWarning: a\nAUTO — dispatch: b\n- AUTO 12:00:00 — c\nQueue-order cache hit — d\nnot AUTO'),
    ['Warning: a', 'AUTO — dispatch: b', '- AUTO 12:00:00 — c', 'Queue-order cache hit — d'],
  );
  const result = (root, stderr) => ({
    sandbox: { root }, status: 0, stdout: `${root}/proj\n`, stderr, staged: {}, decisions: '', orderBlob: null,
    files: { 'dispatch-groups.json': `[{"path":"${root}/x"}]`, 'dispatch-verified-open-deps.txt': '' },
  });
  const files = ['dispatch-groups.json', 'dispatch-verified-open-deps.txt'];
  assertParity(result('/scr/a', 'Warning: w\nnoise a'), result('/scr/b', 'Warning: w\nnoise b'), { files });
  assert.throws(() => assertParity(result('/scr/a', 'Warning: w'), result('/scr/b', 'Warning: v'), { files }));
  // A module-only step diagnostic fails parity unless the script's stderr shows an error too.
  assert.throws(() => assertParity(result('/scr/a', 'Warning: w'), result('/scr/b', 'Warning: w\nqueue-pull: fetch: boom'), { files }), /shows no error/);
  assertParity(result('/scr/a', 'Warning: w\njq: error'), result('/scr/b', 'Warning: w\nqueue-pull: fetch: boom'), { files });
});

// ---- Task 2: registry, session paths, truncate pass, pass loop (in-process, any platform) ----

const SCRIPT_TEXT = readText(SCRIPT_MD);

// One assertion function serves the positive test and the go-red controls.
function assertRegistryMatchesBullets(passes, scriptText) {
  const bullets = scriptText.split(/\r?\n/).map((l) => ({ l, m: l.match(/^- `reason: '([a-z-]+)'`/) })).filter((x) => x.m);
  assert.ok(bullets.length >= 9, 'header bullet pattern no longer matches queue-pull-script.md');
  assert.deepEqual([...new Set(passes.map((p) => p.reason).filter(Boolean))].sort(), bullets.map((b) => b.m[1]).sort());
  for (const { l, m } of bullets) {
    const pass = passes.find((p) => p.reason === m[1]);
    assert.equal(pass.removes, !l.includes('stay IN `dispatch-groups.json`'), m[1]);
    // bypass: the bullet says a named `#N`/`#N,#M,...` form still resolves or dispatches the record.
    assert.equal(pass.bypass, l.includes('(`#N`/`#N,#M,...` still '), `${m[1]}.bypass`);
  }
}
const notTheGuard = (err) => err instanceof assert.AssertionError && !/header bullet pattern/.test(err.message);

test('AC11.1: the set of reasons in PASSES equals the script header bullets, plus nothing', () => {
  assertRegistryMatchesBullets(PASSES, SCRIPT_TEXT);
});

test('AC11.1 go-red: a renamed reason on either side fails on the set comparison, not the count guard', () => {
  const renamed = PASSES.map((p) => (p.reason === 'shipped' ? { ...p, reason: 'shipped-x' } : p));
  assert.equal(renamed.filter((p) => p.reason).length, PASSES.filter((p) => p.reason).length);
  assert.throws(() => assertRegistryMatchesBullets(renamed, SCRIPT_TEXT), notTheGuard);
  assert.throws(() => assertRegistryMatchesBullets(PASSES, SCRIPT_TEXT.replace("- `reason: 'shipped'`", "- `reason: 'shipped-x'`")), notTheGuard);
  const flipped = PASSES.map((p) => (p.reason === 'oversized' ? { ...p, removes: true } : p));
  assert.throws(() => assertRegistryMatchesBullets(flipped, SCRIPT_TEXT), notTheGuard);
  const bypassFlipped = PASSES.map((p) => (p.reason === 'unlanded-blocker' ? { ...p, bypass: true } : p));
  assert.throws(() => assertRegistryMatchesBullets(bypassFlipped, SCRIPT_TEXT), (err) => notTheGuard(err) && /unlanded-blocker\.bypass/.test(err.message));
});

test('AC11.1: runPasses walks a registry in array order and runs a shared id once', () => {
  const reversed = [...PASSES].reverse();
  const ran = [];
  const seen = [];
  const runners = Object.fromEntries(PASSES.map((p) => [p.id, () => ran.push(p.id)]));
  runPasses(reversed, { deps: { onPass: (id) => seen.push(id) }, paths: {}, options: {}, runners });
  const expected = [...new Set(reversed.map((p) => p.id))];
  assert.deepEqual(seen, expected);
  assert.deepEqual(ran, expected);
  assert.equal(ran.filter((id) => id === 'blocker-landing').length, 1);
  assert.equal(expected[0], 'near-dup-pairs');
});

test('AC11.1: a pass without a runner throws "pass not implemented"', () => {
  assert.throws(() => runPasses(PASSES, { deps: {}, paths: {}, options: {}, runners: {} }), /^Error: queue-pull: pass not implemented: truncate$/);
});

test('R7/PF8: an omitted pass still has its runner called; the runner sees ctx.omit and skips only its own appends', () => {
  // Stub runners model a pass with a shared step (always) and its own appends (skipped on omit).
  const run = (omitReasons) => {
    const log = [];
    const runners = Object.fromEntries(PASSES.map((p) => [p.id, (ctx) => {
      log.push(`${p.id}:shared`);
      if (!ctx.omit.has(p.id)) log.push(`${p.id}:appends`);
    }]));
    runPasses(PASSES, { deps: {}, paths: {}, options: {}, omit: resolveOmit(omitReasons), runners });
    return log;
  };
  const base = run([]);
  assert.ok(base.includes('oversized:shared') && base.includes('oversized:appends'));
  const noOversized = run(['oversized']);
  assert.ok(noOversized.includes('oversized:shared'), 'the grouping step still runs');
  assert.ok(!noOversized.includes('oversized:appends'));
  assert.deepEqual(noOversized.filter((l) => !l.startsWith('oversized:')), base.filter((l) => !l.startsWith('oversized:')));
  for (const reason of ['malformed-blocker', 'unlanded-blocker']) {
    const log = run([reason]);
    assert.equal(log.filter((l) => l === 'blocker-landing:shared').length, 1, 'the shared call runs once');
    assert.ok(!log.includes('blocker-landing:appends'), `${reason} skips both reasons' appends`);
    assert.deepEqual(log.filter((l) => !l.startsWith('blocker-landing:')), base.filter((l) => !l.startsWith('blocker-landing:')));
  }
});

test('#5227 runPasses: a ctx with no omit runs every pass, each runner seeing an empty omit set', () => {
  const log = [];
  const runners = Object.fromEntries(PASSES.map((p) => [p.id, (ctx) => {
    assert.ok(ctx.omit instanceof Set && ctx.omit.size === 0, `${p.id} sees an empty omit set`);
    log.push(p.id);
  }]));
  runPasses(PASSES, { deps: {}, paths: {}, options: {}, runners });
  assert.deepEqual(log, [...new Set(PASSES.map((p) => p.id))]);
});

test('AC11.2: every registry field has a fixed value set', () => {
  const idCounts = {};
  for (const p of PASSES) {
    assert.deepEqual(Object.keys(p).sort(), ['bypass', 'failOpen', 'id', 'kind', 'mcp', 'reason', 'removes', 'runsOnCacheHit']);
    for (const f of ['removes', 'bypass', 'runsOnCacheHit']) assert.equal(typeof p[f], 'boolean', `${p.id}.${f}`);
    assert.ok(PASS_FIELD_VALUES.kind.includes(p.kind), p.id);
    assert.ok(PASS_FIELD_VALUES.failOpen.includes(p.failOpen), p.id);
    assert.ok(PASS_FIELD_VALUES.mcp.includes(p.mcp), p.id);
    assert.equal(p.reason === null, p.kind !== 'exclusion', p.id);
    idCounts[p.id] = (idCounts[p.id] || 0) + 1;
  }
  assert.deepEqual(Object.keys(idCounts).filter((id) => idCounts[id] > 1), ['blocker-landing']);
  assert.equal(PASSES.filter((p) => p.id === 'blocker-landing').length, 2);
  assert.equal(new Set(PASSES.filter((p) => p.id === 'blocker-landing').map((p) => p.failOpen)).size, 1, 'PF5: one identical failOpen');
  assert.equal(PASSES.find((p) => p.id === 'neighbour-in-flight').failOpen, 'stop', 'PF6');
  assert.equal(PASSES.find((p) => p.id === 'target-missing').failOpen, 'open', '`git remote show origin` can fail and the pull continues');
  assert.deepEqual(PASS_FIELD_VALUES.failOpen, ['open', 'stop', 'n/a']);
  assert.deepEqual(PASS_FIELD_VALUES.mcp, ['same', 'skipped-empty', 'fails-open', 'agent-fetched']);
  assert.ok(Object.isFrozen(PASSES) && Object.isFrozen(PASSES[0]));
});

test('#5227 truncate keeps only firing entries (Q28)', () => inOwnTmp((own) => {
  const paths = sessionPaths('qp-truncate');
  const file = paths['dispatch-exclusions.json'];
  appendExclusion(file, { reason: 'firing', records: [11], detail: { why: 'kept' } });
  appendExclusion(file, { reason: 'blocked', records: [12], detail: { blockedBy: [1] } });
  appendExclusion(file, { reason: 'oversized', records: [13, 14], detail: { size: 2, threshold: 1 } });
  const errs = [];
  runPasses(PASSES.slice(0, 1), { deps: { stderr: (s) => errs.push(s) }, paths, options: {} });
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), [{ reason: 'firing', records: [11], detail: { why: 'kept' } }]);
  assert.deepEqual(errs, []);
  assert.ok(file.startsWith(own), 'the exclusions file lives under the test-owned temp dir');
  // A corrupt file truncates to [] (readExclusions degrades loud, never throws) and the pull goes on.
  const realErr = console.error;
  console.error = () => {};
  try {
    fs.writeFileSync(file, '{not json');
    runPasses(PASSES.slice(0, 1), { deps: { stderr: () => {} }, paths, options: {} });
  } finally {
    console.error = realErr;
  }
  assert.equal(fs.readFileSync(file, 'utf8'), '[]');
}));

test('#5227 truncate: a throw prints "queue-pull: truncate: <message>" and the run continues', () => {
  const errs = [];
  const dir = scratchDir('qp-t2-trunc-');
  try {
    const paths = { 'dispatch-exclusions.json': path.join(dir, 'missing-dir', 'x.json') };
    for (const name of END_WRITTEN_FILES) paths[name] = path.join(dir, name); // #5409: the truncate pass removes these first
    runPasses(PASSES.slice(0, 1), { deps: { stderr: (s) => errs.push(s) }, paths, options: {} });
    assert.equal(errs.length, 1);
    assert.match(errs[0], /^queue-pull: truncate: .*ENOENT/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('#5227 SESSION_FILES equals the fence --value list in fence order', () => {
  assert.deepEqual(SESSION_FILES, [...fenceSessionFiles(extractFence(readText(SCRIPT_MD), FENCE_FIRST_LINE)), 'dispatch-next-pick.json']);
  assert.equal(SESSION_FILES.length, 27);
});

test('#5227 sessionPaths fallback: no session id gives path.join(os.tmpdir(), name)', () => inOwnTmp((own) => {
  const none = sessionPaths(undefined);
  assert.deepEqual(Object.keys(none), SESSION_FILES);
  for (const name of SESSION_FILES) assert.equal(none[name], path.join(os.tmpdir(), name));
  assert.equal(path.dirname(none['dispatch-groups.json']), own);
  const scoped = sessionPaths('qp-sess');
  assert.equal(scoped['dispatch-groups.json'], path.join(os.tmpdir(), 'ct-session-qp-sess', 'dispatch-groups.json'));
  assert.notEqual(scoped['dispatch-groups.json'], none['dispatch-groups.json']);
  assert.ok(scoped['dispatch-groups.json'].startsWith(own));
}));

test('#5227 omit: unknown reason or a setup pass throws TypeError; malformed-blocker maps to blocker-landing', () => {
  assert.throws(() => resolveOmit(['no-such-reason']), TypeError);
  assert.throws(() => resolveOmit(['fetch']), TypeError);
  assert.throws(() => resolveOmit(['truncate']), TypeError);
  assert.deepEqual([...resolveOmit(['malformed-blocker'])], ['blocker-landing']);
  assert.deepEqual([...resolveOmit(['unlanded-blocker'])], ['blocker-landing']);
  assert.deepEqual([...resolveOmit(['shipped', 'cross-pr-overlap'])].sort(), ['cross-pr-overlap', 'shipped']);
  assert.deepEqual([...resolveOmit([])], []);
  inOwnTmp((own) => {
    assert.throws(() => queuePull({ sessionId: 'qp-omit', omit: ['bogus'] }, { stderr: () => {} }), TypeError);
    assert.deepEqual(fs.readdirSync(own), [], 'omit is validated before any session path is created');
  });
});

test('#5227 queuePull runs every registry pass in order and returns the final groups and exclusions', () => inOwnTmp((own) => {
  const paths = sessionPaths('qp-pull');
  appendExclusion(paths['dispatch-exclusions.json'], { reason: 'blocked', records: [1], detail: { blockedBy: [2] } });
  const seen = [];
  const deps = {
    run: fakeRun(S0()),
    spawnCli: fakeSpawnCli(S0(), {
      'hooks.js': { status: 0, stdout: '', stderr: '' },
      // Hands the pool back unchanged, as the real CLI does when no record has an unlanded blocker.
      'dispatch-unlanded-blockers.js': (args) => ({ status: 0, stdout: fs.readFileSync(args[args.indexOf('--groups') + 1], 'utf8'), stderr: '' }),
    }),
    queueOrder: { readOrder: () => null, writeOrder: () => ({ ok: true }) },
    expressQueuePolicy: () => ({ enabled: false, grouping: 'per-record', fingerprint: 'off-fp', keepSingleton: () => false }),
    createClaimReader: () => ({ read: () => ({ content: null }) }),
    onPass: (id) => seen.push(id),
    stderr: () => {},
  };
  const result = queuePull({ sessionId: 'qp-pull', cwd: own }, deps);
  assert.deepEqual(seen, ['truncate', 'fetch', 'blocked', 'oversized', 'write-back', 'not-spec-shaped', 'open-pr', 'target-missing', 'shipped',
    'blocker-landing', 'driver-lane', 'neighbour-in-flight', 'cross-pr-overlap', 'near-dup-pairs'], 'every distinct registry id has a runner and runs once, in registry order');
  assert.deepEqual(result.groups.flat().map((c) => c.number), [9001]);
  assert.deepEqual(result.exclusions, [], 'the pre-seeded non-firing entry is truncated by the first pass');
  assert.equal(fs.readFileSync(paths['dispatch-exclusions.json'], 'utf8'), '[]');
}));

// ---- Task 3: fetch, blocked, oversized (grouping) and write-back, both transports (in-process) ----

const groupNumbers = (r) => r.json('dispatch-groups.json').map((g) => g.map((c) => c.number));
const CAP_WARNING = fenceText(/echo "(Warning: the auto:build queue pull returned exactly the --limit cap \(500\)[^"]*)" >&2/);
const asserts = (fn) => assert.throws(fn, (err) => err instanceof assert.AssertionError);

// One assertion function per reason: the positive run and the omitted run both go through it.
function assertBlocked(r) {
  assert.deepEqual(entriesOf(r, 'blocked'), [{ reason: 'blocked', records: [9002], detail: { blockedBy: [8000] } }]);
  assert.deepEqual(groupNumbers(r), [[9001], [9003]]);
}
function assertOversized(r) {
  assert.deepEqual(entriesOf(r, 'oversized'), [{ reason: 'oversized', records: [9101, 9102, 9103], detail: { size: 3, threshold: 2 } }]);
  assert.deepEqual(groupNumbers(r), [[9101, 9102, 9103]], 'an oversized group stays in dispatch-groups.json');
  assert.deepEqual(r.json('dispatch-fastlane-bundles.json'), [{ records: [9101, 9102, 9103] }]);
}

test('AC2.1 blocked: #9002 (Blocked by open #8000) is excluded and leaves the groups; omitting the pass keeps it and writes no entry', () => {
  const positive = pull(S1());
  assertBlocked(positive);
  assert.deepEqual(positive.json('dispatch-eligible.json').map((c) => c.number), [9001, 9003]);

  const omitted = pull(S1(), { omit: ['blocked'] });
  asserts(() => assertBlocked(omitted));
  assert.deepEqual(entriesOf(omitted, 'blocked'), []);
  assert.deepEqual(groupNumbers(omitted), [[9001], [9002], [9003]], 'the grouping block still ran and kept #9002');
  assert.deepEqual(omitted.json('dispatch-eligible.json').map((c) => c.number), [9001, 9002, 9003], 'the eligible list is still produced');
  assert.deepEqual(omitted.json('dispatch-blocked-excluded-body.json'), []);
  assert.equal(omitted.store.written.length, 0, 'an omit run never persists a blob its groups would misdescribe');
  assert.equal(pull(S1()).store.written.length, 1, 'a normal run still writes back');
});

const withQueue = (scenario, records) => ({ ...scenario, gh: scenario.gh.map((e) => (e.argv && e.argv.join() === QUEUE_ARGV.join() ? { ...e, stdout: JSON.stringify(records) + '\n' } : e)) });
const count = (hay, needle) => hay.split(needle).length - 1;

test('AC1.1 (#5315): a record whose labels is a string is excluded as malformed-blocker with one Warning, #9001 is grouped, and no queue-order cache is written', () => {
  const r = pull(SMalformed('labels'));
  assert.equal(r.thrown, null);
  assert.doesNotMatch(r.stderr, /queue-pull:/);
  assert.equal(labelsWarning(9020), 'Warning: #9020 excluded — its labels are not an array\n');
  assert.equal(count(r.stderr, labelsWarning(9020)), 1);
  assert.deepEqual(entriesOf(r, 'malformed-blocker'), [LABELS_ENTRY_9020]);
  assert.deepEqual(groupNumbers(r), [[9001]]);
  assert.equal(r.store.written.length, 0);
});

test('#5315 Review Focus: null labels stay silent and write back; object and number labels are excluded; omit keeps the screen but drops the entry; a typed string-labels record is excluded; an all-malformed queue yields empty groups', () => {
  const q = (labels) => withQueue(SMalformed('labels'), [ghRecord(9001, { body: withBody(9001) }), { ...ghRecord(9020, { body: withBody(9020) }), labels }]);

  const nul = pull(q(null));
  assert.ok(!nul.stderr.includes('#9020'));
  assert.deepEqual(entriesOf(nul, 'malformed-blocker'), []);
  assert.deepEqual(groupNumbers(nul), [[9001]]);
  assert.equal(nul.store.written.length, 1);

  for (const labels of [{ name: 'auto:build' }, 42]) {
    const r = pull(q(labels));
    assert.equal(count(r.stderr, labelsWarning(9020)), 1, JSON.stringify(labels));
    assert.deepEqual(entriesOf(r, 'malformed-blocker'), [LABELS_ENTRY_9020], JSON.stringify(labels));
    assert.deepEqual(groupNumbers(r), [[9001]], JSON.stringify(labels));
    assert.equal(r.store.written.length, 0, JSON.stringify(labels));
  }

  const omitted = pull(SMalformed('labels'), { omit: ['malformed-blocker'] });
  assert.equal(omitted.thrown, null);
  assert.equal(count(omitted.stderr, labelsWarning(9020)), 1);
  assert.deepEqual(entriesOf(omitted, 'malformed-blocker'), []);
  assert.ok(groupNumbers(omitted).flat().includes(9001));
  assert.ok(!groupNumbers(omitted).flat().includes(9020));

  const typed = pull(SMalformed('labels'), { before: (ctx) => ctx.state.typedNumbers.add(9020) });
  assert.equal(count(typed.stderr, labelsWarning(9020)), 1);
  assert.deepEqual(entriesOf(typed, 'malformed-blocker'), [LABELS_ENTRY_9020]);
  assert.deepEqual(groupNumbers(typed), [[9001]]);

  const all = pull(withQueue(SMalformed('labels'), [{ ...ghRecord(9020, { body: withBody(9020) }), labels: 'auto:build' }]));
  assert.equal(all.thrown, null);
  assert.equal(count(all.stderr, labelsWarning(9020)), 1);
  assert.deepEqual(entriesOf(all, 'malformed-blocker'), [LABELS_ENTRY_9020]);
  assert.deepEqual(all.json('dispatch-groups.json'), []);
});

test('AC2.2 oversized: three fast-lane singletons bundle into one group over a guard of 2; omitting the pass keeps the group and bundle, writes no entry', () => {
  const positive = pull(SFast());
  assertOversized(positive);

  const omitted = pull(SFast(), { omit: ['oversized'] });
  asserts(() => assertOversized(omitted));
  assert.deepEqual(entriesOf(omitted, 'oversized'), []);
  assert.deepEqual(groupNumbers(omitted), [[9101, 9102, 9103]], 'the grouping block still ran');
  assert.deepEqual(omitted.json('dispatch-fastlane-bundles.json'), [{ records: [9101, 9102, 9103] }], 'the bundles file is still written');
});

test('#5227 native: work-links native spawns resolve-blockers.js over the eligible numbers and excludes through openBlockerRefs; a non-zero exit on gh fails closed (#5309)', () => {
  const scenario = () => ({ ...S1(), policy: { 'work-links': 'native' } });
  const ok = pull(scenario(), { spawn: { 'resolve-blockers.js': { status: 0, stdout: JSON.stringify({ 9001: { openBlockerIds: [7000], crossRepoBlockers: [] } }), stderr: '' } } });
  assert.deepEqual(ok.cliCalls.filter(([n]) => n === 'resolve-blockers.js'), [['resolve-blockers.js', '9001,9003']]);
  assert.deepEqual(entriesOf(ok, 'blocked'), [
    { reason: 'blocked', records: [9002], detail: { blockedBy: [8000] } },
    { reason: 'blocked', records: [9001], detail: { blockedBy: [7000] } },
  ]);
  assert.deepEqual(groupNumbers(ok), [[9003]]);
  assert.deepEqual(ok.store.written[0].blob.excluded, [{ number: 9002, blockedBy: [8000] }, { number: 9001, blockedBy: [7000] }]);

  const failed = pull(scenario(), { spawn: { 'resolve-blockers.js': { status: 2, stdout: '', stderr: 'graphql down\n' } } });
  assert.deepEqual(failed.errs, [`${NATIVE_FAIL_CLOSED_PREFIX}graphql down\n`], failed.stderr);
  assert.deepEqual(groupNumbers(failed), [], 'a failed native query on gh excludes every eligible record');
  assert.deepEqual(failed.json('dispatch-native-deps.json'), {});
  assert.equal(failed.store.written.length, 0, 'a failed native read is never persisted as a verdict');

  const omitted = pull(scenario(), { omit: ['blocked'], spawn: {} });
  assert.deepEqual(omitted.cliCalls.filter(([n]) => n === 'resolve-blockers.js'), [], 'omitting blocked skips the native query');
});

// #5309: the native-blockers query failed. Every eligible record is excluded as blocked with the
// unreadable-state detail, one Warning prints, and nothing is written back.
const NATIVE_UNREADABLE = { detail: { blockedBy: ['native blockers (state unreadable)'] } };
const NATIVE_QUEUE = [9001, 9003];
const nativeFiles = (own) => ({
  inputs: {
    queueRaw: writeInput(own, 'queue.json', JSON.stringify(NATIVE_QUEUE.map((n) => mcpRecord(n, withBody(n))))),
    openNumbers: writeInput(own, 'open.json', JSON.stringify(NATIVE_QUEUE.map((n) => ({ number: n })))),
    depFreshness: writeInput(own, 'dep.json', '[]'),
    verifiedOpenDeps: writeInput(own, 'verified.txt', ''),
  },
});
const nativeScenario = () => ({ ...S1(), policy: { 'work-links': 'native' } });
const noGhOnFiles = () => { throw new Error('no gh on files'); };

test('#5309 (a) gh: resolve-blockers.js exit 3 excludes every eligible record as blocked, prints the one fail-closed Warning, and writes nothing back', () => {
  const r = pull(nativeScenario(), { spawn: { 'resolve-blockers.js': { status: 3, stdout: '', stderr: 'gh-fault\n' } } });
  assert.deepEqual(r.errs, [`${NATIVE_FAIL_CLOSED_PREFIX}gh-fault\n`], r.stderr);
  assert.deepEqual(entriesOf(r, 'blocked'), [
    { reason: 'blocked', records: [9002], detail: { blockedBy: [8000] } },
    { reason: 'blocked', records: [9001], ...NATIVE_UNREADABLE },
    { reason: 'blocked', records: [9003], ...NATIVE_UNREADABLE },
  ]);
  assert.deepEqual(groupNumbers(r), []);
  assert.equal(r.store.written.length, 0, 'queueOrder.writeOrder is not called');
});

test('#5309 (a2) gh: resolve-blockers.js exit 2 (owner/repo unresolvable) fails closed the same way', () => {
  const r = pull(nativeScenario(), { spawn: { 'resolve-blockers.js': { status: 2, stdout: '', stderr: 'no owner/repo\n' } } });
  assert.deepEqual(r.errs, [`${NATIVE_FAIL_CLOSED_PREFIX}no owner/repo\n`], r.stderr);
  assert.deepEqual(entriesOf(r, 'blocked').slice(1).map((e) => e.records), [[9001], [9003]]);
  assert.deepEqual(groupNumbers(r), []);
  assert.equal(r.store.written.length, 0);
});

test('#5309 (b) gh: a throw inside the native step prints only the fail-closed Warning, with the error message as its stderr', () => {
  const r = pull(nativeScenario(), { spawn: { 'resolve-blockers.js': () => { throw new Error('spawn exploded'); } } });
  assert.deepEqual(r.errs, [`${NATIVE_FAIL_CLOSED_PREFIX}spawn exploded\n`], r.stderr);
  assert.deepEqual(entriesOf(r, 'blocked').slice(1).map((e) => e.records), [[9001], [9003]]);
  assert.deepEqual(groupNumbers(r), []);
  assert.equal(r.store.written.length, 0);
});

test('#5309 (b2) gh: a non-spawn throw in the native step (its own write fails) takes the same fail-closed path, one Warning, no step line', () => {
  const r = pull(nativeScenario(), {
    spawn: { 'resolve-blockers.js': { status: 0, stdout: '{}', stderr: '' } },
    before: (ctx) => fs.mkdirSync(ctx.paths['dispatch-native-deps.tmp.json']),
  });
  assert.equal(r.errs.length, 1, r.stderr);
  assert.ok(r.errs[0].startsWith(NATIVE_FAIL_CLOSED_PREFIX), r.stderr);
  assert.ok(!r.stderr.includes('queue-pull: native-deps:'), r.stderr);
  assert.deepEqual(entriesOf(r, 'blocked').slice(1).map((e) => e.records), [[9001], [9003]]);
  assert.deepEqual(groupNumbers(r), []);
  assert.equal(r.store.written.length, 0);
});

test('#5309 (b3) gh: an unreadable eligible list inside the native step keeps step()\'s line, not the fail-closed Warning', () => {
  // blocked-body rewrites dispatch-eligible.json before the native step, so a directory cannot stand in for it
  // there; the native step's read is the first read of that file after the write, and it alone fails.
  const realRead = fs.readFileSync;
  let failed = false;
  fs.readFileSync = function readUnreadableEligible(file, ...rest) {
    if (!failed && path.basename(String(file)) === 'dispatch-eligible.json') {
      failed = true;
      throw Object.assign(new Error('EACCES: permission denied, open dispatch-eligible.json'), { code: 'EACCES' });
    }
    return realRead.call(this, file, ...rest);
  };
  let r;
  try {
    r = pull(nativeScenario(), { spawn: { 'resolve-blockers.js': { status: 0, stdout: '{}', stderr: '' } } });
  } finally {
    fs.readFileSync = realRead;
  }
  assert.ok(failed, 'the native step read dispatch-eligible.json');
  assert.deepEqual(r.errs.filter((l) => l.startsWith('queue-pull: native-deps:') || l.startsWith('Warning: native dependency query failed')),
    ['queue-pull: native-deps: EACCES: permission denied, open dispatch-eligible.json\n'], r.stderr);
  assert.deepEqual(r.cliCalls.filter(([n]) => n === 'resolve-blockers.js'), [], 'no query is made');
  assert.equal(r.store.written.length, 1, 'no fail-closed marker is set, so the write-back runs as on any clean pull');
});

test('#5309 (c) files: resolve-blockers.js exit 2 (gh absent) keeps the gh-absent fallback and its Warning, filters nothing native, and writes back', () => {
  const r = pull(nativeScenario(), { transport: 'files', run: noGhOnFiles, prepare: (own) => nativeFiles(own),
    spawn: { 'resolve-blockers.js': { status: 2, stdout: '', stderr: 'gh is required\n' } } });
  assert.deepEqual(r.errs, [`${NATIVE_WARNING_PREFIX}gh is required\n`], r.stderr);
  assert.deepEqual(entriesOf(r, 'blocked'), []);
  assert.deepEqual(groupNumbers(r), [[9001], [9003]], 'a gh-absent drain keeps dispatching');
  assert.equal(r.store.written.length, 1, 'the write-back is unchanged on files');
});

test('#5309 (c2) files: resolve-blockers.js exit 1, a null status and a throw each keep the fallback Warning and write back', () => {
  const cases = [
    ['exit 1', { status: 1, stdout: '', stderr: 'bad args\n' }, 'bad args\n'],
    ['null status', { status: null, stdout: '', stderr: 'killed\n' }, 'killed\n'],
    ['throw', () => { throw new Error('spawn EACCES'); }, 'spawn EACCES\n'],
  ];
  for (const [label, outcome, warned] of cases) {
    const r = pull(nativeScenario(), { transport: 'files', run: noGhOnFiles, prepare: (own) => nativeFiles(own),
      spawn: { 'resolve-blockers.js': outcome } });
    assert.deepEqual(r.errs, [`${NATIVE_WARNING_PREFIX}${warned}`], `${label}: ${r.stderr}`);
    assert.deepEqual(entriesOf(r, 'blocked'), [], label);
    assert.deepEqual(groupNumbers(r), [[9001], [9003]], label);
    assert.equal(r.store.written.length, 1, label);
  }
});

test('#5309 (d) files: resolve-blockers.js exit 3 fails closed as on gh', () => {
  const r = pull(nativeScenario(), { transport: 'files', run: noGhOnFiles, prepare: (own) => nativeFiles(own),
    spawn: { 'resolve-blockers.js': { status: 3, stdout: '', stderr: 'gh-fault\n' } } });
  assert.deepEqual(r.errs, [`${NATIVE_FAIL_CLOSED_PREFIX}gh-fault\n`], r.stderr);
  assert.deepEqual(entriesOf(r, 'blocked').map((e) => e.records), [[9001], [9003]]);
  assert.deepEqual(groupNumbers(r), []);
  assert.equal(r.store.written.length, 0);
});

test('#5227 unresolved dependency: a blocker outside the open-numbers pull is checked with gh issue view, and OPEN blocks', () => {
  const VIEW = ['issue', 'view', '8000', '--json', 'state', '-q', '.state'];
  const scenario = (state) => {
    const s = S1();
    s.gh = s.gh.map((e) => (e.argv && e.argv.join() === OPEN_NUMBERS_ARGV.join() ? { ...e, stdout: '[{"number":9001},{"number":9002},{"number":9003}]\n' } : e));
    s.gh.push({ argv: VIEW, stdout: `${state}\n` });
    return s;
  };
  const open = pull(scenario('OPEN'));
  assert.deepEqual(open.json('dispatch-unresolved-deps.json'), [8000]);
  assert.ok(open.ghCalls.some((a) => a.join() === VIEW.join()));
  assert.equal(open.text['dispatch-verified-open-deps.txt'], '8000\n');
  assertBlocked(open);

  const closed = pull(scenario('CLOSED'));
  assert.ok(closed.ghCalls.some((a) => a.join() === VIEW.join()));
  assert.equal(closed.text['dispatch-verified-open-deps.txt'], '');
  assert.deepEqual(entriesOf(closed, 'blocked'), []);
  assert.deepEqual(groupNumbers(closed), [[9001], [9002], [9003]]);
});

function foreignScenario(extraPolicy = {}) {
  const body = `Blocked by acme-corp/other#12\n\n${withBody(9001)}`;
  return {
    name: 'SForeign',
    policy: { 'work-links': 'body-text', ...extraPolicy },
    gh: [
      { argv: QUEUE_ARGV, stdout: JSON.stringify([ghRecord(9001, { body })]) + '\n' },
      { argv: OPEN_NUMBERS_ARGV, stdout: '[{"number":9001}]\n' },
    ],
  };
}
const foreignStates = (state) => ({ 'resolve-foreign-blockers.js': { status: 0, stdout: JSON.stringify({ 'acme-corp/other#12': state }), stderr: '' } });

test('#5227 foreign blocker: a Blocked by owner/name#N line holds the record while the blocker is OPEN, releases it once closed, and an unreadable state fails closed with one Warning', () => {
  const held = pull(foreignScenario(), { spawn: foreignStates('OPEN') });
  assert.deepEqual(held.cliCalls.filter(([n]) => n === 'resolve-foreign-blockers.js'), [['resolve-foreign-blockers.js', 'acme-corp/other#12']]);
  assert.deepEqual(entriesOf(held, 'blocked'), [{ reason: 'blocked', records: [9001], detail: { blockedBy: ['acme-corp/other#12'] } }]);
  assert.deepEqual(groupNumbers(held), []);

  const released = pull(foreignScenario(), { spawn: foreignStates('CLOSED') });
  assert.deepEqual(entriesOf(released, 'blocked'), []);
  assert.deepEqual(groupNumbers(released), [[9001]]);

  const unreadable = pull(foreignScenario(), { spawn: { 'resolve-foreign-blockers.js': { status: 1, stdout: '', stderr: 'boom' } } });
  assert.deepEqual(entriesOf(unreadable, 'blocked'), [{ reason: 'blocked', records: [9001], detail: { blockedBy: ['acme-corp/other#12 (state unreadable)'] } }]);
  const warnings = unreadable.errs.filter((e) => e.startsWith('Warning:'));
  assert.equal(warnings.length, 1, unreadable.stderr);
  assert.match(warnings[0], /^Warning: foreign blocker state lookup failed \(exit 1: boom\).*fail closed\)\n$/);

  const omitted = pull(foreignScenario(), { spawn: {}, omit: ['blocked'] });
  assert.deepEqual(omitted.cliCalls.filter(([n]) => n === 'resolve-foreign-blockers.js'), [], 'omitting blocked skips the foreign lookup');
  assert.deepEqual(groupNumbers(omitted), [[9001]]);
});

test('#5227 foreign blocker: a spawn error reaches the Warning as the library prints it; an unreadable states file adds its own fail-closed Warning and the CLI is still asked', () => {
  const failing = pull(foreignScenario(), { foreignSpawn: () => ({ status: null, signal: null, error: new Error('spawn node ETIMEDOUT'), stdout: '', stderr: '' }) });
  const w = failing.errs.filter((e) => e.startsWith('Warning:'));
  assert.equal(w.length, 1, failing.stderr);
  assert.match(w[0], /^Warning: foreign blocker state lookup failed \(spawn node ETIMEDOUT\) — every body-declared foreign blocker reads state unreadable \(fail closed\)\n$/);
  assert.deepEqual(entriesOf(failing, 'blocked'), [{ reason: 'blocked', records: [9001], detail: { blockedBy: ['acme-corp/other#12 (state unreadable)'] } }]);

  // Brief deviation, pinned to the library: a set-but-unreadable states file prints its own Warning
  // and the CLI is asked anyway, so a failing CLI gives two Warnings (one if the CLI answers).
  const missing = (own) => ({ inputs: { foreignStates: path.join(own, 'no-such-states.json') } });
  const both = pull(foreignScenario(), { prepare: missing, spawn: { 'resolve-foreign-blockers.js': { status: 1, stdout: '', stderr: 'boom' } } });
  const bothWarnings = both.errs.filter((e) => e.startsWith('Warning:'));
  assert.equal(bothWarnings.length, 2, both.stderr);
  assert.match(bothWarnings[0], /^Warning: foreign blocker states file .*no-such-states\.json ignored \(.*ENOENT.*\) — supplied states not used \(fail closed\)\n$/);
  assert.match(bothWarnings[1], /^Warning: foreign blocker state lookup failed \(exit 1: boom\)/);
  assert.deepEqual(entriesOf(both, 'blocked'), [{ reason: 'blocked', records: [9001], detail: { blockedBy: ['acme-corp/other#12 (state unreadable)'] } }]);
  assert.deepEqual(both.cliCalls.filter(([n]) => n === 'resolve-foreign-blockers.js'), [['resolve-foreign-blockers.js', 'acme-corp/other#12']]);

  const answered = pull(foreignScenario(), { prepare: missing, spawn: foreignStates('OPEN') });
  assert.equal(answered.errs.filter((e) => e.startsWith('Warning:')).length, 1, answered.stderr);
  assert.deepEqual(entriesOf(answered, 'blocked'), [{ reason: 'blocked', records: [9001], detail: { blockedBy: ['acme-corp/other#12'] } }]);
});

test('#5227 R6: a failed session-file write is a step error and the run continues past fetch to its next outcome', () => {
  const r = pull(S1(), {
    before: (ctx) => { fs.mkdirSync(ctx.paths['dispatch-fastlane-bundles.json']); }, // a directory: the write fails
    allowThrow: true,
  });
  assert.ok(r.errs.some((e) => /^queue-pull: write dispatch-fastlane-bundles\.json: /.test(e)), r.stderr);
  // The run went on past fetch (and blocked): the grouping block, which rewrites the same
  // file, is what stops it. A put that logged and rethrew would surface the raw EISDIR instead.
  assert.ok(r.thrown instanceof QueuePullStopped, String(r.thrown));
  assert.match(r.thrown.line, /group-building exclusion pass failed/);
  assert.ok(r.errs.some((e) => e.startsWith('queue-pull: group-building: ')), r.stderr);
});

// Loads queue-pull.js fresh with cross-repo-states.js's bodyForeignBlockers replaced by a recorder.
function withRecordedForeignDeps(fn) {
  const csPath = require.resolve('../../../plugin/bin/lib/issues/cross-repo-states');
  const qpPath = require.resolve('../../../plugin/bin/lib/dispatch/queue-pull');
  const real = require(csPath);
  const savedCs = require.cache[csPath].exports;
  const savedQp = require.cache[qpPath];
  const seen = [];
  require.cache[csPath].exports = { ...real, bodyForeignBlockers: (records, deps) => { seen.push(deps); return new Map(); } };
  delete require.cache[qpPath];
  try {
    return fn(require(qpPath), seen);
  } finally {
    require.cache[csPath].exports = savedCs;
    delete require.cache[qpPath];
    require.cache[qpPath] = savedQp;
  }
}

test('#5227 foreign blocker: with no deps.foreignDeps.spawn, no spawn key reaches bodyForeignBlockers (the library default bounded spawn runs)', () => {
  withRecordedForeignDeps((lib, seen) => {
    pull(foreignScenario(), { lib, deps: { foreignDeps: {} } });
    assert.equal(seen.length, 1);
    assert.equal(Object.prototype.hasOwnProperty.call(seen[0], 'spawn'), false);
    assert.equal(typeof seen[0].stderr, 'function');
    // Positive control: an injected seam spawn is passed through untouched.
    const injected = () => ({ status: 0, stdout: '{}', stderr: '' });
    pull(foreignScenario(), { lib, deps: { foreignDeps: { spawn: injected } } });
    assert.equal(seen[1].spawn, injected);
  });
});

test('#5227 gh calls carry options.cwd and options.env through to the runner', () => {
  const seen = [];
  const base = fakeRun(S1());
  const env = { SOME: 'env' };
  pull(S1(), { run: (cmd, args, opts) => { seen.push(opts); return base(cmd, args, opts); }, env });
  assert.ok(seen.length > 0);
  for (const opts of seen) {
    assert.equal(opts.env, env);
    assert.ok(typeof opts.cwd === 'string' && opts.cwd.endsWith('proj'));
  }
});

test('#5227 foreign blocker: a supplied states file (inputs.foreignStates, or DISPATCH_FOREIGN_STATES) answers on the gh transport and the CLI is not asked', () => {
  const states = (own, content) => {
    const file = path.join(own, 'foreign-states.json');
    fs.writeFileSync(file, content);
    return file;
  };
  const byInput = pull(foreignScenario(), { prepare: (own) => ({ inputs: { foreignStates: states(own, '{"acme-corp/other#12":"closed"}') } }) });
  assert.deepEqual(byInput.cliCalls.filter(([n]) => n === 'resolve-foreign-blockers.js'), []);
  assert.deepEqual(groupNumbers(byInput), [[9001]]);
  const byEnv = pull(foreignScenario(), { prepare: (own) => ({ env: { DISPATCH_FOREIGN_STATES: states(own, '{"acme-corp/other#12":"OPEN"}') } }) });
  assert.deepEqual(entriesOf(byEnv, 'blocked'), [{ reason: 'blocked', records: [9001], detail: { blockedBy: ['acme-corp/other#12'] } }]);
});

test('#5227 cache hit: a blob over the same freshness replays groups, blocked entries and bundles, recomputes oversized, and makes no open-numbers call', () => {
  const miss = pull(S1());
  const blob = miss.store.written[0].blob;
  const hit = pull(S1(), { persisted: blob });
  assert.equal(hit.state.cacheHit, true);
  assert.ok(hit.errs.includes(`${HIT_MESSAGE}\n`), hit.stderr);
  assert.ok(!hit.ghCalls.some((a) => a.join() === OPEN_NUMBERS_ARGV.join()), 'no open-numbers pull on a hit');
  assert.deepEqual(hit.ghCalls, [QUEUE_ARGV, DEP_SEARCH_8000]);
  assert.deepEqual(hit.json('dispatch-groups.json'), blob.groups);
  assertBlocked(hit);
  assert.equal(hit.store.written.length, 0, 'a hit does not write back');
  assert.equal(miss.store.written.length, 1, 'a miss writes back once (control)');
  // runsOnCacheHit is that observation: the write-back is the one pass a hit skips (every other
  // pass running again over the replayed groups is the four-passes cache-hit test below).
  assert.deepEqual(PASSES.filter((p) => !p.runsOnCacheHit).map((p) => p.id), ['write-back']);
  assert.equal(hit.state.workLinks, '', 'the fence never reads work-links on a hit');

  // oversized is recomputed from the CURRENT guard, not replayed: a guard of 2 flags the bundle, a guard of 3 does not.
  const fastMiss = pull(SFast());
  const fastBlob = fastMiss.store.written[0].blob;
  const strict = pull(SFast(), { persisted: fastBlob });
  assert.equal(strict.state.cacheHit, true);
  assertOversized(strict);
  const lenient = pull({ ...SFast(), policy: { ...SFast().policy, 'dispatch-group-size-guard': '3' } }, { persisted: fastBlob });
  assert.deepEqual(entriesOf(lenient, 'oversized'), []);
  assert.deepEqual(lenient.json('dispatch-fastlane-bundles.json'), [{ records: [9101, 9102, 9103] }], 'the persisted bundles are kept');

  // A blob from before `bundles` existed replays as [].
  const { bundles, ...legacy } = fastBlob;
  assert.ok(bundles);
  assert.deepEqual(pull(SFast(), { persisted: legacy }).json('dispatch-fastlane-bundles.json'), []);
});

test('#5227 cache hit: omitting blocked skips only the blocked replay and omitting oversized skips only the oversized entries', () => {
  const blob = pull(S1()).store.written[0].blob;
  const noBlocked = pull(S1(), { persisted: blob, omit: ['blocked'] });
  assert.equal(noBlocked.state.cacheHit, true);
  assert.deepEqual(entriesOf(noBlocked, 'blocked'), []);
  assert.deepEqual(noBlocked.json('dispatch-groups.json'), blob.groups, 'the groups are still replayed');
  asserts(() => assertBlocked(noBlocked));

  const fastBlob = pull(SFast()).store.written[0].blob;
  const noOversized = pull(SFast(), { persisted: fastBlob, omit: ['oversized'] });
  assert.deepEqual(entriesOf(noOversized, 'oversized'), []);
  assert.deepEqual(noOversized.json('dispatch-fastlane-bundles.json'), [{ records: [9101, 9102, 9103] }], 'the bundles are still replayed');
  assert.ok(noOversized.errs.includes(`${HIT_MESSAGE}\n`), 'the hit message still prints');
  asserts(() => assertOversized(noOversized));
});

test('#5227 cache hit: a body-declared foreign blocker makes the persisted blob a miss (#4793)', () => {
  const first = pull(foreignScenario(), { spawn: foreignStates('CLOSED') });
  const blob = first.store.written[0].blob;
  assert.equal(blob.freshnessSignal.foreignDeclared, true);
  const second = pull(foreignScenario(), { persisted: blob, spawn: foreignStates('OPEN') });
  assert.equal(second.state.cacheHit, false);
  assert.ok(!second.stderr.includes(HIT_MESSAGE));
  assert.deepEqual(entriesOf(second, 'blocked'), [{ reason: 'blocked', records: [9001], detail: { blockedBy: ['acme-corp/other#12'] } }], 'the verdict was recomputed against the current state');
});

test('#5227 cache hit vs miss: spawnCli policy read order (PF9/PF14)', () => {
  const guard = ['resolve-policy.js', '--values', 'dispatch-group-size-guard'];
  const miss = pull(S1());
  assert.deepEqual(miss.cliCalls, [
    guard,
    ['resolve-policy.js', '--values', 'work-links'],
    guard,
    ['resolve-policy.js', '--values', 'dispatch-fastlane-bundle-cap'],
  ]);
  assert.equal(miss.state.workLinks, 'body-text');
  assert.deepEqual(miss.ghCalls, [QUEUE_ARGV, OPEN_NUMBERS_ARGV, DEP_SEARCH_8000], 'queue, open numbers, then the write-back dependency freshness');
  const hit = pull(S1(), { persisted: miss.store.written[0].blob });
  assert.deepEqual(hit.cliCalls, [guard], 'the size guard is read once, inside the cache check, and nothing else');
});

test('#5227 policy: a resolve-policy.js spawn that throws prints "queue-pull: policy: <message>" once per read, and the value reads as empty', () => {
  const r = pull(S1(), { allowThrow: true, spawn: { 'resolve-policy.js': () => { throw new Error('spawn EAGAIN'); } } });
  assert.equal(r.cliCalls.length, 4, 'the four policy reads of a miss');
  assert.deepEqual(r.errs.filter((e) => e.startsWith('queue-pull: policy: ')), Array(4).fill('queue-pull: policy: spawn EAGAIN\n'), r.stderr);
  assert.ok(!r.errs.some((e) => e.startsWith('queue-pull: resolve-policy.js: ')), 'the label is "policy", not the CLI name');
  assert.equal(r.state.workLinks, '', 'a failed read is the empty string, as $( ) of a failed command is');
  assert.equal(r.state.groupSizeGuard, '');
});

test('AC4.5 write-back: a miss writes composeOrderBlob stamped from now(), runId from PIPELINE_RUN_DIR, excluded in {number, blockedBy} shape; a refused write prints the fence line and the pull continues', () => {
  const assertWriteBack = (r, runId) => {
    assert.equal(r.store.written.length, 1);
    const { root, blob } = r.store.written[0];
    assert.equal(root, r.cwd);
    assert.equal(blob.computedAt, '2026-11-12T12:00:00.000Z');
    assert.equal(blob.runId, runId);
    assert.deepEqual(blob.excluded, [{ number: 9002, blockedBy: [8000] }]);
    assert.deepEqual(blob.groups, r.json('dispatch-groups.json'));
    assert.deepEqual(blob.bundles, []);
    assert.equal(blob.grouping, 'per-record');
    assert.deepEqual(blob.freshnessSignal, {
      issues: [9001, 9002, 9003, 8000].map((number) => ({ number, updatedAt: number === 8000 ? '2026-11-09T10:00:00Z' : '2026-11-10T10:00:00Z', state: 'OPEN' })),
    });
  };
  assertWriteBack(pull(S1()), null);
  assertWriteBack(pull(S1(), { env: { PIPELINE_RUN_DIR: path.join(path.sep, 'x', 'pipelines', '2026-11-12T110000-spec') } }), '2026-11-12T110000-spec');

  assert.ok(FENCE.includes("'Queue-order cache write-back failed (non-blocking): ' + result.error"));
  const refused = pull(S1(), { writeResult: { ok: false, error: 'push rejected' } });
  assert.ok(refused.errs.includes('Queue-order cache write-back failed (non-blocking): push rejected\n'), refused.stderr);
  assert.equal(refused.thrown, null);
  assertBlocked(refused);
});

test('#5227 cap warning: a 500-record queue prints the fence 500-cap Warning byte for byte; 499 does not', () => {
  const scenario = (count) => ({
    policy: { 'work-links': 'body-text' },
    gh: [
      { argv: QUEUE_ARGV, stdout: JSON.stringify(Array.from({ length: count }, (_, i) => ghRecord(100 + i, { labels: ['ready'] }))) + '\n' },
      { argv: OPEN_NUMBERS_ARGV, stdout: '[]\n' },
    ],
  });
  assert.match(CAP_WARNING, /^Warning: the auto:build queue pull returned exactly the --limit cap \(500\) — /);
  const atCap = pull(scenario(500));
  assert.deepEqual(atCap.errs.filter((e) => e.startsWith('Warning:')), [`${CAP_WARNING}\n`]);
  assert.deepEqual(pull(scenario(499)).errs.filter((e) => e.startsWith('Warning:')), []);
});

const DEP_VIEW_FAILED = (n) => `Warning: gh issue view ${n} failed — dependency #${n} treated as open (fail closed) this run`;
const VERIFIED_UNREADABLE = 'Warning: verified-open-deps file missing or malformed — every unresolved dependency treated as open (fail closed) this run';
const warningsOf = (r) => r.stderr.split('\n').filter((l) => l.startsWith('Warning: gh issue view') || l.startsWith('Warning: verified-open-deps'));

function mcpRecord(number, body) {
  return {
    number, title: `Fixture record ${number}`, body, labels: [{ name: 'auto:build' }, { name: 'ready' }],
    created_at: '2026-11-01T10:00:00Z', updated_at: '2026-11-10T10:00:00Z', state: 'open',
  };
}

test('#5227 files: the queue file is copied into the session file and aliased there, dispatch-verified-open-deps.txt replaces the gh issue view loop, and no gh call is made', () => {
  const calls = [];
  const noGh = (cmd, args) => { calls.push([cmd, ...args]); throw new Error(`gh must not be called on files: ${args.join(' ')}`); };
  const write = (own, { verified, freshness = '[{"number":8000,"updated_at":"2026-11-09T10:00:00Z","state":"open"}]' }) => {
    return {
      inputs: {
        queueRaw: writeInput(own, 'queue.json', JSON.stringify([mcpRecord(9001, withBody(9001)), mcpRecord(9002, `Blocked by #8000\n\n${withBody(9002)}`)])),
        openNumbers: writeInput(own, 'open.json', '[{"number":9001},{"number":9002}]'),
        depFreshness: writeInput(own, 'dep.json', freshness),
        verifiedOpenDeps: verified === null ? path.join(own, 'absent.txt') : writeInput(own, 'verified.txt', verified),
      },
    };
  };
  const held = pull(S1(), { transport: 'files', run: noGh, prepare: (own) => write(own, { verified: '8000\n' }) });
  assert.deepEqual(calls, []);
  const queue = JSON.parse(held.text['dispatch-queue-raw.json']);
  assert.equal(queue[0].createdAt, '2026-11-01T10:00:00Z');
  assert.equal(queue[0].created_at, '2026-11-01T10:00:00Z', 'the snake_case key stays beside the alias');
  assert.equal(queue[0].updatedAt, '2026-11-10T10:00:00Z');
  assert.equal(held.text[held.state.files.queueRaw], JSON.stringify([mcpRecord(9001, withBody(9001)), mcpRecord(9002, `Blocked by #8000\n\n${withBody(9002)}`)]),
    'the caller\'s own queue file is left as the agent wrote it');
  assert.equal(JSON.parse(held.text['dispatch-dep-freshness.json'])[0].updatedAt, '2026-11-09T10:00:00Z', 'the dependency-freshness file is aliased too');
  assert.deepEqual(entriesOf(held, 'blocked'), [{ reason: 'blocked', records: [9002], detail: { blockedBy: [8000] } }]);
  assert.deepEqual(groupNumbers(held), [[9001]]);
  assert.notEqual(held.state.files.queueRaw, sessionPaths('qp-t3')['dispatch-queue-raw.json'], 'the supplied path is read, not the session file');
  assert.equal(held.store.written.length, 1, 'the write-back still runs on files');

  const absent = pull(S1(), { transport: 'files', run: noGh, prepare: (own) => write(own, { verified: null }) });
  assert.deepEqual(entriesOf(absent, 'blocked'), [{ reason: 'blocked', records: [9002], detail: { blockedBy: [8000] } }], 'AC2.1 (#5311): a missing verified-open-deps file fails closed');
  assert.deepEqual(groupNumbers(absent), [[9001]]);
  assert.deepEqual(warningsOf(absent), [VERIFIED_UNREADABLE]);
  assert.equal(absent.store.written.length, 0, 'a fail-closed verdict is never persisted to the queue-order cache');
  const malformed = pull(S1(), { transport: 'files', run: noGh, prepare: (own) => write(own, { verified: 'this is not json\n' }) });
  assert.deepEqual(groupNumbers(malformed), [[9001]], 'AC2.1 (#5311): a malformed file fails closed');
  assert.deepEqual(warningsOf(malformed), [VERIFIED_UNREADABLE]);
  assert.equal(malformed.store.written.length, 0, 'a fail-closed verdict is never persisted to the queue-order cache');
  const mixed = pull(S1(), { transport: 'files', run: noGh, prepare: (own) => write(own, { verified: '8001\nnot-a-number\n' }) });
  assert.deepEqual(groupNumbers(mixed), [[9001]], 'one malformed line among numbers fails the whole file closed');
  assert.deepEqual(warningsOf(mixed), [VERIFIED_UNREADABLE]);
  const crlf = pull(S1(), { transport: 'files', run: noGh, prepare: (own) => write(own, { verified: '8000\r\n\n' }) });
  assert.deepEqual(groupNumbers(crlf), [[9001]]);
  assert.deepEqual(warningsOf(crlf), [], 'CRLF and a blank line are well-formed');
  const empty = pull(S1(), { transport: 'files', run: noGh, prepare: (own) => write(own, { verified: '', freshness: '[{"number":8000,"updated_at":"2026-11-09T10:00:00Z","state":"closed"}]' }) });
  assert.deepEqual(groupNumbers(empty), [[9001], [9002]], 'an empty file with the dependency shown closed is a well-formed "none open" answer');
  assert.deepEqual(warningsOf(empty), []);
  assert.deepEqual(calls, []);

  const foreign = pull(foreignScenario(), {
    transport: 'files', run: noGh, spawn: {},
    prepare: (own) => {
      return { inputs: {
        queueRaw: writeInput(own, 'q.json', JSON.stringify([mcpRecord(9001, `Blocked by acme-corp/other#12\n\n${withBody(9001)}`)])),
        openNumbers: writeInput(own, 'o.json', '[{"number":9001}]'),
        depFreshness: writeInput(own, 'd.json', '[]'),
        verifiedOpenDeps: writeInput(own, 'v.txt', ''),
        foreignStates: writeInput(own, 'f.json', '{"acme-corp/other#12":"OPEN"}'),
      } };
    },
  });
  assert.deepEqual(entriesOf(foreign, 'blocked'), [{ reason: 'blocked', records: [9001], detail: { blockedBy: ['acme-corp/other#12'] } }], 'PF17: foreignStates is read on files too');
  assert.deepEqual(foreign.cliCalls.filter(([n]) => n === 'resolve-foreign-blockers.js'), []);
});

test('AC1.1, AC1.2 (#5408): files: an unresolved dependency the verified-open-deps file omits and the dependency-freshness file does not show closed is treated as open, with one Warning naming it', () => {
  const OMITTED = (n) => `Warning: verified-open-deps file omits #${n}, which the dependency-freshness file does not show closed — treated as open (fail closed) this run`;
  const noGh = (cmd, args) => { throw new Error(`gh must not be called on files: ${args.join(' ')}`); };
  // freshness === null leaves the dependency-freshness file absent (the agent wrote none).
  const run = (blockedBody, freshness, verified = '') => pull(S1(), { transport: 'files', run: noGh, prepare: (own) => ({ inputs: {
    queueRaw: writeInput(own, 'queue.json', JSON.stringify([mcpRecord(9001, withBody(9001)), mcpRecord(9002, `${blockedBody}\n\n${withBody(9002)}`)])),
    openNumbers: writeInput(own, 'open.json', '[{"number":9001},{"number":9002}]'),
    depFreshness: freshness === null ? path.join(own, 'absent-dep.json') : writeInput(own, 'dep.json', freshness),
    verifiedOpenDeps: writeInput(own, 'verified.txt', verified),
  } }) });
  const BLOCKED_8000 = [{ reason: 'blocked', records: [9002], detail: { blockedBy: [8000] } }];

  for (const [label, freshness] of [
    ['an empty dependency-freshness file', '[]'],
    ['an entry showing the dependency open', '[{"number":8000,"updated_at":"2026-11-09T10:00:00Z","state":"open"}]'],
    ['an absent dependency-freshness file', null],
    ['an entry whose number is a string', '[{"number":"8000","state":"closed"}]'],
    ['an entry with no state', '[{"number":8000}]'],
    ['an object wrapper around the entries', '{"issues":[{"number":8000,"state":"closed"}]}'],
    ['an unparseable file', 'not json'],
    ['contradictory entries, closed then open', '[{"number":8000,"state":"closed"},{"number":8000,"state":"open"}]'],
    ['contradictory entries, open then closed', '[{"number":8000,"state":"open"},{"number":8000,"state":"closed"}]'],
  ]) {
    const r = run('Blocked by #8000', freshness);
    assert.deepEqual(groupNumbers(r), [[9001]], `${label}: #9002 is not dispatchable`);
    assert.deepEqual(entriesOf(r, 'blocked'), BLOCKED_8000, label);
    assert.deepEqual(warningsOf(r), [OMITTED(8000)], label);
    assert.equal(r.store.written.length, 0, `${label}: a fail-closed verdict is never persisted to the queue-order cache`);
  }

  const closed = run('Blocked by #8000', '[{"number":8000,"updated_at":"2026-11-09T10:00:00Z","state":"CLOSED"}]');
  assert.deepEqual(groupNumbers(closed), [[9001], [9002]], 'a dependency the freshness file shows closed does not block');
  assert.deepEqual(warningsOf(closed), []);
  assert.equal(closed.store.written.length, 1, 'a dependency shown closed is a trusted verdict: the write-back still runs');

  const two = run('Blocked by #8000\nBlocked by #8001', '[]');
  assert.deepEqual(warningsOf(two), [OMITTED(8000), OMITTED(8001)], 'one Warning per omitted dependency, in dependency order');

  const mixed = run('Blocked by #8000\nBlocked by #8001', '[]', '8000\n');
  assert.deepEqual(warningsOf(mixed), [OMITTED(8001)], 'a dependency the file lists draws no Warning; only the omitted one does');
  assert.deepEqual(entriesOf(mixed, 'blocked'), [{ reason: 'blocked', records: [9002], detail: { blockedBy: [8000, 8001] } }]);
  assert.deepEqual(groupNumbers(mixed), [[9001]]);

  const listedClosed = run('Blocked by #8000', '[{"number":8000,"state":"closed"}]', '8000\n');
  assert.deepEqual(entriesOf(listedClosed, 'blocked'), BLOCKED_8000, 'a dependency the verified-open-deps file lists still blocks when the freshness file shows it closed');
  assert.deepEqual(groupNumbers(listedClosed), [[9001]]);
  assert.deepEqual(warningsOf(listedClosed), []);
});

// Pulls two records on `files` where #9002's body starts with `blockedBody`, with the given
// dependency-freshness and verified-open-deps file contents.
function pullBlockedRecord(blockedBody, freshness, verified = '') {
  return pull(S1(), { transport: 'files', run: noGhOnFiles, prepare: (own) => ({ inputs: {
    queueRaw: writeInput(own, 'queue.json', JSON.stringify([mcpRecord(9001, withBody(9001)), mcpRecord(9002, `${blockedBody}\n\n${withBody(9002)}`)])),
    openNumbers: writeInput(own, 'open.json', '[{"number":9001},{"number":9002}]'),
    depFreshness: writeInput(own, 'dep.json', freshness),
    verifiedOpenDeps: writeInput(own, 'verified.txt', verified),
  } }) });
}

test('AC1.1, AC2.1, AC3.1, AC3.2 (#5865): files: a dependency-freshness entry marked unreadable is treated as open, prints one Warning naming it and writes no queue-order cache', () => {
  const UNREADABLE = (...ns) => `Warning: dependency-freshness file marks ${ns.map((n) => `#${n}`).join(', ')} unreadable — treated as open (fail closed), queue-order cache not written this run`;
  const warningsNaming = (r, n) => r.stderr.split('\n').filter((l) => l.startsWith('Warning:') && l.includes(`#${n}`));
  const BLOCKED_8000 = [{ reason: 'blocked', records: [9002], detail: { blockedBy: [8000] } }];

  for (const [label, freshness, verified] of [
    ['absent from the verified-open-deps file', '[{"number":8000,"state":"unreadable"}]', ''],
    ['listed in the verified-open-deps file', '[{"number":8000,"state":"unreadable"}]', '8000\n'],
    ['a mixed-case state and a contradicting closed entry', '[{"number":8000,"state":"closed"},{"number":8000,"state":"UNREADABLE"}]', ''],
  ]) {
    const r = pullBlockedRecord('Blocked by #8000', freshness, verified);
    assert.deepEqual(entriesOf(r, 'blocked'), BLOCKED_8000, label);
    assert.deepEqual(groupNumbers(r), [[9001]], `${label}: #9002 is not dispatchable`);
    assert.deepEqual(warningsNaming(r, 8000), [UNREADABLE(8000)], `${label}: exactly one Warning names #8000`);
    assert.equal(r.store.written.length, 0, `${label}: no queue-order cache`);
  }

  const closed = pullBlockedRecord('Blocked by #8000', '[{"number":8000,"updated_at":"2026-11-09T10:00:00Z","state":"closed"}]');
  assert.deepEqual(groupNumbers(closed), [[9001], [9002]]);
  assert.ok(!closed.stderr.split('\n').some((l) => l.startsWith('Warning:') && l.includes('unreadable')), 'a closed entry draws no unreadable Warning');
  assert.equal(closed.store.written.length, 1);

  const other = pullBlockedRecord('Blocked by #8000\nBlocked by #8001', '[{"number":8000,"state":"unreadable"},{"number":8001,"updated_at":"2026-11-09T10:00:00Z","state":"closed"}]');
  assert.equal(other.store.written.length, 0, 'one unreadable entry keeps the cache unwritten');
  assert.deepEqual(entriesOf(other, 'blocked'), BLOCKED_8000, '#8001 is still counted closed');
  assert.deepEqual(warningsNaming(other, 8000), [UNREADABLE(8000)]);
  assert.deepEqual(warningsNaming(other, 8001), [], 'no Warning names the closed #8001');

  const both = pullBlockedRecord('Blocked by #8000\nBlocked by #8001', '[{"number":8001,"state":"unreadable"},{"number":8000,"state":"unreadable"},{"number":8000,"state":"unreadable"}]');
  assert.deepEqual(both.stderr.split('\n').filter((l) => l.startsWith('Warning: dependency-freshness')), [UNREADABLE(8000, 8001)], 'one Warning, numbers ascending and de-duplicated');

  assert.ok(!closedDependencyNumbers('[{"number":8000,"state":"unreadable"}]').has(8000), 'an unreadable entry is never a closed one');

  // The malformed verified-open-deps file (the `bad` branch): the existing malformed-file Warning, the
  // one unreadable Warning, and no cache.
  const bad = pullBlockedRecord('Blocked by #8000', '[{"number":8000,"state":"unreadable"}]', 'x\n');
  const badWarnings = bad.stderr.split('\n').filter((l) => l.startsWith('Warning:'));
  assert.deepEqual(badWarnings, ['Warning: verified-open-deps file missing or malformed — every unresolved dependency treated as open (fail closed) this run', UNREADABLE(8000)]);
  assert.equal(bad.store.written.length, 0, 'a malformed file plus an unreadable entry writes no cache');
});

test('AC3.1 (#5865): files: an unreadable entry draws a Warning only for an in-range dependency of an eligible record', () => {
  const unreadableLines = (r) => r.stderr.split('\n').filter((l) => l.includes('unreadable'));

  // `Blocked by #0`: not an issue number, so the agent writes an unreadable entry for it, but it is the
  // blocker-landing pass's malformed-blocker case, not a live-check dependency (#5311).
  const zero = pullBlockedRecord('Blocked by #0', '[{"number":0,"state":"unreadable"}]');
  assert.deepEqual(unreadableLines(zero), [], '#0 draws no unreadable Warning');
  assert.equal(zero.store.written.length, 1, '#0 does not keep the cache unwritten');

  // A number above GRAPHQL_INT_MAX is out of range the same way.
  const huge = pullBlockedRecord('Blocked by #2147483648', '[{"number":2147483648,"state":"unreadable"}]');
  assert.deepEqual(unreadableLines(huge), [], 'an out-of-range number draws no unreadable Warning');
  assert.equal(huge.store.written.length, 1);

  // An unreadable number no eligible record depends on.
  const stray = pullBlockedRecord('Blocked by #8000', '[{"number":7777,"state":"unreadable"},{"number":8000,"updated_at":"2026-11-09T10:00:00Z","state":"closed"}]');
  assert.deepEqual(unreadableLines(stray), [], 'a stray number draws no Warning');
  assert.equal(stray.store.written.length, 1, 'a stray number does not keep the cache unwritten');

  // An unreadable number only an ineligible (bot:parked) record depends on.
  const parked = { ...mcpRecord(9003, `Blocked by #7777\n\n${withBody(9003)}`), labels: [{ name: 'auto:build' }, { name: 'ready' }, { name: 'bot:parked' }] };
  const ineligible = pull(S1(), { transport: 'files', run: noGhOnFiles, prepare: (own) => ({ inputs: {
    queueRaw: writeInput(own, 'queue.json', JSON.stringify([mcpRecord(9001, withBody(9001)), mcpRecord(9002, withBody(9002)), parked])),
    openNumbers: writeInput(own, 'open.json', '[{"number":9001},{"number":9002},{"number":9003}]'),
    depFreshness: writeInput(own, 'dep.json', '[{"number":7777,"state":"unreadable"}]'),
    verifiedOpenDeps: writeInput(own, 'verified.txt', ''),
  } }) });
  assert.deepEqual(unreadableLines(ineligible), [], 'a number only an ineligible record depends on draws no Warning');
  assert.equal(ineligible.store.written.length, 1, 'a number only an ineligible record depends on does not keep the cache unwritten');

  // Control: an in-range dependency of an eligible record still warns, alongside a stray one.
  const real = pullBlockedRecord('Blocked by #8000', '[{"number":7777,"state":"unreadable"},{"number":8000,"state":"unreadable"}]');
  assert.deepEqual(unreadableLines(real), ['Warning: dependency-freshness file marks #8000 unreadable — treated as open (fail closed), queue-order cache not written this run']);
  assert.equal(real.store.written.length, 0);
});

test('AC1.1 (#5311): a failed dependency view excludes the dependent record as blocked and prints the line naming the view', () => {
  const r = pull(S1LiveDep({ viewFails: true }));
  assert.deepEqual(entriesOf(r, 'blocked'), entriesOf(pull(S1LiveDep()), 'blocked'), 'the same blocked entry the answered view gives');
  assert.ok(entriesOf(r, 'blocked').some((e) => e.records.includes(9002)));
  assert.ok(!groupNumbers(r).flat().includes(9002), '#9002 is not dispatchable');
  assert.deepEqual(warningsOf(r), [DEP_VIEW_FAILED(8000)]);
  assert.equal(r.text['dispatch-verified-open-deps.txt'], '8000\n');
  assert.equal(r.store.written.length, 0, 'a fail-closed verdict is never persisted to the queue-order cache');
  assert.equal(pull(S1LiveDep()).store.written.length, 1, 'control: an answered view still writes the blob back');
  // S1({ parity: true }) also carries #9012 `Blocked by #0`: #0 is not an issue number, so it is never live-checked.
  assert.ok(!r.ghCalls.some((a) => a[0] === 'issue' && a[1] === 'view' && a[2] === '0'), 'no gh issue view 0 call');
  const full = pull5(S1LiveDep({ viewFails: true }));
  assert.ok(entriesOf(full, 'malformed-blocker').some((e) => e.records.includes(9012)), '#9012 keeps its malformed-blocker exclusion');
  assert.ok(!entriesOf(full, 'blocked').some((e) => e.records.includes(9012)), '#9012 is not reclassified as blocked');
});

test('AC1.1 (#5311) multi: one Warning names only the failed view, and the file lists the failed and OPEN numbers, never the CLOSED one', () => {
  const s = S1LiveDep({ viewFails: true });
  s.gh = s.gh.map((e) => (JSON.stringify(e.argv) === JSON.stringify(QUEUE_ARGV)
    ? { ...e, stdout: JSON.stringify(JSON.parse(e.stdout).map((rec) => (rec.number === 9002
      ? { ...rec, body: `Blocked by #8000\nBlocked by #8001\nBlocked by #8002\n\n${withBody(9002)}` } : rec))) + '\n' } : e));
  s.gh.push({ argv: ['issue', 'view', '8002', '--json', 'state', '-q', '.state'], stdout: 'OPEN\n' });
  const r = pull(s);
  assert.deepEqual(warningsOf(r), [DEP_VIEW_FAILED(8000)]);
  assert.equal(r.text['dispatch-verified-open-deps.txt'], '8000\n8002\n');
  assert.ok(entriesOf(r, 'blocked').some((e) => e.records.includes(9002)));
});

test('AC1.1 (#5311) multi: every failed view prints its own Warning', () => {
  const s = S1LiveDep({ viewFails: true });
  s.gh = s.gh.map((e) => (JSON.stringify(e.argv) === JSON.stringify(QUEUE_ARGV)
    ? { ...e, stdout: JSON.stringify(JSON.parse(e.stdout).map((rec) => (rec.number === 9002
      ? { ...rec, body: `Blocked by #8000\nBlocked by #8002\n\n${withBody(9002)}` } : rec))) + '\n' } : e));
  s.gh.push({ argv: ['issue', 'view', '8002', '--json', 'state', '-q', '.state'], stdout: '', stderr: 'gh-fault: injected failure\n', status: 1 });
  const r = pull(s);
  assert.deepEqual(warningsOf(r), [DEP_VIEW_FAILED(8000), DEP_VIEW_FAILED(8002)]);
  assert.equal(r.text['dispatch-verified-open-deps.txt'], '8000\n8002\n');
});

// #5879: the verified-open-deps step's own read of the unresolved list fails once (a one-off failure; the
// blocked pass's later read of the same file gets through).
function pullWithUnresolvedReadFailingOnce(scenario, o = {}) {
  const realRead = fs.readFileSync;
  let reads = 0;
  fs.readFileSync = function readUnresolvedOnce(file, ...rest) {
    if (path.basename(String(file)) === 'dispatch-unresolved-deps.json' && ++reads === 1) {
      throw Object.assign(new Error('EACCES: permission denied, open dispatch-unresolved-deps.json'), { code: 'EACCES' });
    }
    return realRead.call(this, file, ...rest);
  };
  try {
    return { r: pull(scenario, o), reads };
  } finally {
    fs.readFileSync = realRead;
  }
}
const verifiedOpenDepsFiles = (r) => Object.keys(r.text).filter((k) => path.basename(k) === 'dispatch-verified-open-deps.txt');

test('AC1.1 (#5879): gh: an unreadable unresolved-deps list leaves no verified-open-deps file and the blocked pass fails closed', () => {
  const { r, reads } = pullWithUnresolvedReadFailingOnce(S1({ parity: true }), {
    before: (ctx) => fs.writeFileSync(ctx.state.files.verifiedOpenDeps, '7777\n'),
  });
  // Read 1 is the step's (it throws) and read 2 the blocked pass's fail-closed re-read; read 3 is pull()'s
  // end-of-run collection of the session files. The old truncate code skips read 2.
  assert.equal(reads, 3, 'the step\'s read failed, the blocked pass read the list again, then the harness collected it');
  assert.deepEqual(r.json('dispatch-unresolved-deps.json'), [8001], 'one unresolved dependency');
  assert.deepEqual(verifiedOpenDepsFiles(r), [], 'the file is absent: neither empty nor the stale 7777');
  assert.deepEqual(r.errs.filter((l) => l.startsWith('queue-pull: verified-open-deps:')),
    ['queue-pull: verified-open-deps: EACCES: permission denied, open dispatch-unresolved-deps.json\n'], r.stderr);
  assert.deepEqual(warningsOf(r), [VERIFIED_UNREADABLE], r.stderr);
  assert.ok(!r.stderr.includes('queue-pull: blocked-body:'), r.stderr);
  assert.ok(entriesOf(r, 'blocked').some((e) => e.records.includes(9011)), 'the dependent #9011 is held as blocked');
  assert.ok(!r.ghCalls.some((a) => a[0] === 'issue' && a[1] === 'view'), 'no dependency is viewed');
  assert.equal(r.store.written.length, 0, 'a fail-closed verdict is never persisted to the queue-order cache');
});

test('AC1.1 (#5879) control: with no unresolved dependency the step still ends with an empty file and prints no Warning', () => {
  const r = pull(S1(), { before: (ctx) => fs.writeFileSync(ctx.state.files.verifiedOpenDeps, '7777\n') });
  assert.deepEqual(r.json('dispatch-unresolved-deps.json'), []);
  assert.equal(r.text['dispatch-verified-open-deps.txt'], '', 'present and empty: "none open"');
  assert.deepEqual(warningsOf(r), []);
  assert.ok(!r.stderr.includes('queue-pull: '), r.stderr);
});

test('AC2.1 (#5311) control: with no unresolved dependency and no verified-open-deps file, no Warning and both records are grouped', () => {
  const noGh = (cmd, args) => { throw new Error(`gh must not be called on files: ${args.join(' ')}`); };
  const control = pull(S1(), { transport: 'files', run: noGh, prepare: (own) => ({ inputs: {
    queueRaw: writeInput(own, 'queue.json', JSON.stringify([mcpRecord(9001, withBody(9001)), mcpRecord(9002, withBody(9002))])),
    openNumbers: writeInput(own, 'open.json', '[{"number":9001},{"number":9002}]'),
    depFreshness: writeInput(own, 'dep.json', '[]'),
    verifiedOpenDeps: path.join(own, 'absent.txt'),
  } }) });
  assert.deepEqual(groupNumbers(control), [[9001], [9002]]);
  assert.deepEqual(warningsOf(control), []);
});

// Task 8 (the files-transport reading, confirmed against filesOracleScript's S2-files-miss run): the
// agent's dependency-freshness file stands where the fence's `gh issue list --search` stands, so it
// is read only when there are dependency numbers to search. Otherwise the fence's `echo '[]'` holds.
test('#5227 files: the dependency-freshness file is used only where the fence searches; with no dependency the session file is [] and the input is not read', () => {
  const noGh = () => { throw new Error('no gh on files'); };
  const inputsWith = (queue, dep) => (own) => {
    return { inputs: {
      queueRaw: writeInput(own, 'queue.json', JSON.stringify(queue)),
      openNumbers: writeInput(own, 'open.json', JSON.stringify(queue.map((r) => ({ number: r.number })).concat([{ number: 8000 }]))),
      depFreshness: dep === null ? path.join(own, 'absent-dep.json') : writeInput(own, 'dep.json', dep),
      verifiedOpenDeps: writeInput(own, 'verified.txt', ''),
    } };
  };
  const STALE = '[{"number":8000,"updated_at":"2026-11-09T10:00:00Z","state":"open"}]';
  const signalNumbers = (r) => r.store.written[0].blob.freshnessSignal.issues.map((i) => i.number);

  // No record declares a dependency: a stale agent file is never read, and a missing one is no error.
  for (const dep of [STALE, null]) {
    const r = pull(S1(), { transport: 'files', run: noGh, prepare: inputsWith([mcpRecord(9001, withBody(9001))], dep) });
    assert.deepEqual(r.errs, [], `${dep === null ? 'missing' : 'stale'} input: ${r.stderr}`);
    assert.equal(r.store.written.length, 1, 'the write-back still runs');
    assert.deepEqual(signalNumbers(r), [9001], 'the freshness signal holds the queue only, as the fence\'s [] leaves it');
    assert.equal(r.text['dispatch-dep-freshness.json'], '[]', 'the session file is the fence\'s [] (aliased)');
  }

  // A declared dependency: the write-back search point reads the agent file, aliased in the session file.
  const deps = pull(S1(), { transport: 'files', run: noGh, prepare: inputsWith([mcpRecord(9002, `Blocked by #8000\n\n${withBody(9002)}`)], STALE) });
  assert.deepEqual(deps.errs, [], deps.stderr);
  assert.deepEqual(signalNumbers(deps), [9002, 8000]);
  assert.equal(JSON.parse(deps.text['dispatch-dep-freshness.json'])[0].updatedAt, '2026-11-09T10:00:00Z');
  assert.equal(deps.text[deps.state.files.depFreshness], STALE, 'the supplied file itself is left as the agent wrote it');

  // A declared dependency and no agent file: the agent wrote none, so the session file is removed
  // (filesOracleScript's `rm -f`), and the steps that read it fail as the fence's node blocks do.
  // Its oracle pair is FILES_FAULTS' files-depFreshness-missing-cold (AC7.2): exit 0, the session
  // file gone and no blob written, on both sides.
  const absent = pull(S1(), { transport: 'files', run: noGh, prepare: inputsWith([mcpRecord(9002, `Blocked by #8000\n\n${withBody(9002)}`)], null) });
  assert.equal(absent.text['dispatch-dep-freshness.json'], undefined);
  assert.match(absent.stderr, /queue-pull: alias-dep-freshness: ENOENT/);
  assert.equal(absent.store.written.length, 0, 'the write-back cannot read the freshness and writes nothing');
});

test('#5307 D3: a non-array queue file such as {issues:[...]} is a failed read: one Warning names the session copy, both copies keep the wrapper, and the pull stops at group-building', () => {
  const wrapper = JSON.stringify({ issues: [mcpRecord(9001, withBody(9001))] });
  const r = pull(S1(), {
    transport: 'files', run: () => { throw new Error('no gh on files'); }, allowThrow: true,
    prepare: (own) => {
      return { inputs: {
        queueRaw: writeInput(own, 'queue.json', wrapper),
        openNumbers: writeInput(own, 'open.json', '[]'),
        depFreshness: writeInput(own, 'dep.json', '[]'),
        verifiedOpenDeps: writeInput(own, 'verified.txt', ''),
      } };
    },
  });
  const sessionCopy = sessionPaths('qp-t3')['dispatch-queue-raw.json'];
  assert.notEqual(path.dirname(r.state.files.queueRaw), path.dirname(sessionCopy), 'the caller file sits outside the session dir');
  assert.equal(r.text[r.state.files.queueRaw], wrapper, 'the caller\'s file is byte-identical');
  assert.equal(r.text['dispatch-queue-raw.json'], wrapper, 'the session copy still holds the wrapper');
  // The pull's own session root is its per-test temp dir, so the Warning is matched on its tail.
  const warnings = reported(r.stderr).filter((l) => l.startsWith('Warning: '));
  assert.equal(warnings.length, 1, r.stderr);
  assert.ok(warnings[0].endsWith(path.sep + path.join('ct-session-qp-t3', 'dispatch-queue-raw.json') + ' is not a JSON array — treated as a failed read'), warnings[0]);
  const [, head, tail] = FENCE.match(GROUPING_STOP_RE);
  assert.ok(r.thrown instanceof QueuePullStopped, String(r.thrown));
  assert.equal(r.thrown.line, `${head}1${tail}`);
});

for (const [shape, wrap] of [
  ['a JSON string', (text) => JSON.stringify(text)],
  ['a wrapper object such as {issues:[...]}', (text) => JSON.stringify({ issues: JSON.parse(text) })],
]) {
  test(`#5307 files: a dependency-freshness file holding ${shape} is a failed read, so a warm cache is not hit and the pull stops at the cache check`, () => {
    const blob = pull(S1()).store.written[0].blob;
    const agent = agentInputs(S1());
    const r = pull(S1(), {
      transport: 'files', run: () => { throw new Error('no gh on files'); }, persisted: blob, allowThrow: true,
      prepare: (own) => {
        return { inputs: {
          queueRaw: writeInput(own, 'queue.json', agent['dispatch-queue-raw.json']),
          openNumbers: writeInput(own, 'open.json', agent['dispatch-open-numbers.json']),
          depFreshness: writeInput(own, 'dep.json', wrap(agent['dispatch-dep-freshness.json'])),
          verifiedOpenDeps: writeInput(own, 'verified.txt', agent['dispatch-verified-open-deps.txt']),
        } };
      },
    });
    assert.ok(!r.stderr.includes(HIT_MESSAGE), `${shape} is not a freshness signal, so the cache is not hit`);
    const warnings = reported(r.stderr).filter((l) => l.startsWith('Warning: '));
    assert.equal(warnings.length, 1, r.stderr);
    assert.ok(warnings[0].endsWith(path.sep + 'dispatch-dep-freshness.json is not a JSON array — treated as a failed read'), warnings[0]);
    const [, head, tail] = FENCE.match(CACHE_HIT_STOP_RE);
    assert.ok(r.thrown instanceof QueuePullStopped, String(r.thrown));
    assert.equal(r.thrown.line, `${head}1${tail}`);
  });
}

test('#5307 D3: a JSON-string queue file of 500+ characters prints no cap Warning (a non-array counts 0)', () => {
  const r = pull(S1(), {
    transport: 'files', run: () => { throw new Error('no gh on files'); }, allowThrow: true,
    prepare: (own) => {
      return { inputs: {
        queueRaw: writeInput(own, 'queue.json', JSON.stringify('x'.repeat(600))),
        openNumbers: writeInput(own, 'open.json', '[]'),
        depFreshness: writeInput(own, 'dep.json', '[]'),
        verifiedOpenDeps: writeInput(own, 'verified.txt', ''),
      } };
    },
  });
  assert.ok(!r.stderr.includes('exactly the --limit cap'), r.stderr);
  assert.ok(r.thrown instanceof QueuePullStopped, String(r.thrown));
});

test('#5227 files: a queue file the agent never wrote removes the session copy (the agent write\'s rm -f) and stops the pull at group-building, as AC7.2 pins', () => {
  const r = pull(S1(), {
    transport: 'files', run: () => { throw new Error('no gh on files'); }, allowThrow: true,
    prepare: (own) => {
      return { inputs: {
        queueRaw: path.join(own, 'absent-queue.json'),
        openNumbers: writeInput(own, 'open.json', '[]'),
        depFreshness: writeInput(own, 'dep.json', '[]'),
        verifiedOpenDeps: writeInput(own, 'verified.txt', ''),
      } };
    },
    before: (ctx) => fs.writeFileSync(ctx.paths['dispatch-queue-raw.json'], JSON.stringify([mcpRecord(9001, withBody(9001))])),
  });
  assert.equal(r.text['dispatch-queue-raw.json'], undefined, 'the stale session copy is gone');
  assert.match(r.stderr, /queue-pull: alias-queue: ENOENT/);
  const [, head, tail] = FENCE.match(GROUPING_STOP_RE);
  assert.ok(r.thrown instanceof QueuePullStopped, String(r.thrown));
  assert.equal(r.thrown.line, `${head}1${tail}`);
});

test('#5227 stop: a grouping-block throw first truncates dispatch-groups.json to 0 bytes, then throws QueuePullStopped with the fence stop line', () => {
  const r = pull(S1(), {
    allowThrow: true,
    deps: { expressQueuePolicy: () => { throw new Error('policy exploded'); } },
    before: (ctx) => fs.writeFileSync(ctx.paths['dispatch-groups.json'], '[[{"number":1}]]'),
  });
  assert.ok(r.thrown instanceof QueuePullStopped, String(r.thrown));
  const [, head, tail] = FENCE.match(GROUPING_STOP_RE);
  assert.equal(r.thrown.line, `${head}1${tail}`);
  assert.equal(r.text['dispatch-groups.json'], '', 'the redirect truncated the stale file before the node block threw');
  assert.ok(r.errs.includes('queue-pull: group-building: policy exploded\n'), r.stderr);
  assert.equal(r.store.written.length, 0, 'no write-back after a stop');
});

test('#5227 stop: a cache-hit pass that cannot append (corrupt exclusions file) throws QueuePullStopped with the fence cache-hit stop line', () => {
  const blob = pull(S1()).store.written[0].blob;
  const scenario = S1();
  scenario.gh = scenario.gh.map((e) => (e.argv && e.argv.join() === DEP_SEARCH_8000.join() ? { ...e, effect: 'corrupt-exclusions' } : e));
  const r = pull(scenario, { persisted: blob, allowThrow: true });
  const [, head, tail] = FENCE.match(CACHE_HIT_STOP_RE);
  assert.ok(r.thrown instanceof QueuePullStopped, String(r.thrown));
  assert.equal(r.thrown.line, `${head}1${tail}`);
  assert.match(r.stderr, /queue-pull: cache-hit: appendExclusion: .* is unreadable/);
  assert.ok(!r.stderr.includes(HIT_MESSAGE), 'no hit message after a stop');
});

// ---- Task 4: not-spec-shaped, open-pr, target-missing and shipped (in-process, S1 full) ----

const T4_SESSION = 'qp-t3'; // pull()'s default session id

const reasonsOf = (r, number) => r.json('dispatch-exclusions.json').filter((e) => e.records.includes(number)).map((e) => e.reason);
const PR_VIEW = (pr) => ['pr', 'view', String(pr), '--json', 'files', '-q', '[.files[].path]'];
const prViews = (r) => r.ghCalls.filter((a) => a[0] === 'pr' && a[1] === 'view');
const SHAPE_WARNING = fenceText(/echo "(Warning: not-spec-shaped pass skipped[^$]*)\$\(cat /);
const SHAPE_STOP = fenceText(/echo "(dispatch: queue-pull stopped -- not-spec-shaped exclusion pass hit a corrupt exclusions file: )\$\(cat /);
const SHIPPED_STOP = fenceText(/echo "(dispatch: queue-pull stopped -- shipped-candidate exclusion pass failed; see error above\.)" >&2/);

// The target-missing Close proposal the fence's `echo` lines build, derived from the fence text.
function fenceTargetProposal(num, tpath, ref) {
  const block = FENCE.match(/(?:^|\n) {2}PROPOSAL="\$\(dirname "\$DISPATCH_EXCLUSIONS"\)\/target-missing-proposal-\$\{NUM\}\.md"\n {2}\{\n([\s\S]*?)\n {2}\} > "\$PROPOSAL" \|\| continue/);
  assert.ok(block, 'the fence no longer builds the proposal with an echo group');
  const expand = (s) => s.replace(/\$\{NUM\}/g, () => num).replace(/\$\{TPATH\}/g, () => tpath).replace(/\$\{INTEGRATION_REF\}/g, () => ref);
  const unescape = (s) => s.replace(/\\(["`])/g, '$1');
  // #5317: the comment echo's `$(node -e "<single-quoter>" -- "TEXT")` prints TEXT as one single-quoted word.
  const QUOTER = /\$\(node -e "(?:[^"\\]|\\.)*" -- "([^"]*)"\)/g;
  return block[1].split('\n').map((l) => {
    const m = l.trim().match(/^echo "(.*)"$/);
    assert.ok(m, `not an echo line: ${l}`);
    const quoters = [...m[1].matchAll(QUOTER)];
    if (!m[1].includes('$(node -e')) return expand(unescape(m[1]));
    assert.equal(quoters.length, 1, `the fence's quoter changed shape: ${l}`);
    const [q] = quoters;
    return expand(unescape(m[1].slice(0, q.index))) + shQuote(expand(q[1])) + expand(unescape(m[1].slice(q.index + q[0].length)));
  }).map((l) => `${l}\n`).join('');
}

// One assertion function per reason: the positive run and the omitted run both go through it.
function assertNotSpecShaped(r) {
  assert.deepEqual(entriesOf(r, 'not-spec-shaped'), [
    { reason: 'not-spec-shaped', records: [9004], detail: { missing: ['Current State', 'Deliverables', 'Acceptance Criteria', 'Release Note'] } },
    { reason: 'not-spec-shaped', records: [9007], detail: { missing: ['Acceptance Criteria'] } },
  ]);
  const left = groupNumbers(r).flat();
  assert.ok(!left.includes(9004) && !left.includes(9007), `excluded candidates leave the groups: ${left}`);
}
function assertOpenPr(r) {
  assert.deepEqual(entriesOf(r, 'open-pr').map((e) => [e.records[0], e.detail.pr]).sort(), [[9005, 79], [9008, 77]]);
  const left = groupNumbers(r).flat();
  assert.ok(!left.includes(9005) && !left.includes(9008));
}
function assertTargetMissing(r) {
  assert.deepEqual(entriesOf(r, 'target-missing'), [
    { reason: 'target-missing', records: [9006], detail: { path: 'docs/gone6.md' } },
    { reason: 'target-missing', records: [9009], detail: { path: 'docs/gone.md' } },
  ]);
  const left = groupNumbers(r).flat();
  assert.ok(!left.includes(9006) && !left.includes(9009));
}
function assertShipped(r) {
  assert.deepEqual(entriesOf(r, 'shipped'), [
    { reason: 'shipped', records: [9010], detail: { pr: 5010, signals: ['merged-pr-mention-after-created', 'title-similarity'] } },
  ]);
  assert.ok(!groupNumbers(r).flat().includes(9010));
}

test('AC2.1 not-spec-shaped: #9004 and #9007 leave the groups with their missing sections; omitting the pass keeps #9007 and lets #9004 reach the open-PR pass', () => {
  const positive = pull4(FULL());
  assertNotSpecShaped(positive);
  assert.equal(positive.text['dispatch-shape-gate.err'], '', 'the redirect leaves an empty error file');

  const omitted = pull4(FULL(), { omit: ['not-spec-shaped'] });
  asserts(() => assertNotSpecShaped(omitted));
  assert.deepEqual(entriesOf(omitted, 'not-spec-shaped'), []);
  assert.ok(groupNumbers(omitted).flat().includes(9007), 'the spec-less record stays');
  assert.deepEqual(reasonsOf(omitted, 9004), ['open-pr'], 'a candidate the omitted pass no longer excludes falls to the next reason (AC3)');
  assert.deepEqual(omitted.cap.order, ['truncate', 'fetch', 'blocked', 'oversized', 'write-back', 'not-spec-shaped', 'open-pr', 'target-missing', 'shipped'], 'the omitted pass still has its runner called');
  assert.ok(omitted.cli('resolve-linked-prs.js').length === 1, 'the later passes still run');
  assert.ok(omitted.text['dispatch-groups.json'].endsWith('\n'), 'the groups file is still rewritten by the shared step');
});

test('AC2.1 open-pr: #9005 and #9008 leave the groups with their PR; omitting the pass still queries linked PRs and keeps them', () => {
  const positive = pull4(FULL());
  assertOpenPr(positive);
  assert.deepEqual(positive.json('dispatch-linked-prs.json')['9008'].openPR, 77);

  const omitted = pull4(FULL(), { omit: ['open-pr'] });
  asserts(() => assertOpenPr(omitted));
  assert.deepEqual(entriesOf(omitted, 'open-pr'), []);
  assert.ok(groupNumbers(omitted).flat().includes(9008));
  assert.equal(omitted.cli('resolve-linked-prs.js').length, 1, 'the shared linked-PR query still runs (the shipped pass reads its mentions)');
  assert.deepEqual(entriesOf(omitted, 'shipped').map((e) => e.records[0]), [9005, 9010], 'the shipped pass still has the mentions to classify');
});

test('AC2.1 open-pr: a failed resolve-linked-prs.js prints the fence Warning and writes {}; unparseable output prints the filtering Warning and leaves the groups unfiltered', () => {
  const failed = pull4(FULL(), { spawn: { 'resolve-linked-prs.js': { status: 3, stdout: 'partial', stderr: 'graphql down\n' } } });
  assert.ok(failed.errs.includes(`${LINKED_WARNING}graphql down\n`), failed.stderr);
  assert.equal(LINKED_WARNING, 'Warning: linked-PR query failed — falling back to no open-PR or shipped-candidate exclusion this run: ');
  assert.equal(failed.text['dispatch-linked-prs.json'], '{}\n', "the fence's echo '{}' writes a newline");
  assert.deepEqual(entriesOf(failed, 'open-pr'), []);
  assert.ok(groupNumbers(failed).flat().includes(9008), 'nothing is excluded on a failed query');
  assert.deepEqual(entriesOf(failed, 'shipped'), [], 'with no mentions the shipped pass classifies nothing');

  // Reproduced behavior: the shipped pass reads the same unparseable file, and its failure stops the pull.
  const garbled = pull4(FULL(), { allowThrow: true, spawn: { 'resolve-linked-prs.js': { status: 0, stdout: 'not json', stderr: '' } } });
  const warning = garbled.errs.find((e) => e.startsWith(OPEN_FILTER_WARNING));
  assert.ok(warning, garbled.stderr);
  assert.match(warning, /JSON/);
  assert.ok(garbled.text['dispatch-linked-prs.err'].includes('JSON'), 'the error file keeps the failure text');
  assert.ok(groupNumbers(garbled).flat().includes(9005), 'the open-PR pass left the groups unfiltered');
  assert.ok(garbled.thrown instanceof QueuePullStopped);
  assert.equal(garbled.thrown.line, SHIPPED_STOP);
});

test('AC2.1 target-missing: #9006 and #9009 leave the groups, log the fence AUTO text and stage the fence Close body; the stage-item stdout is forwarded', () => {
  const positive = pull4(FULL());
  assertTargetMissing(positive);
  assert.deepEqual(positive.cap.log, [[9006, 'docs/gone6.md'], [9009, 'docs/gone.md']].map(([n, p]) => [
    '--run', positive.cap.runDir, '--status', 'AUTO',
    '--text', `dispatch: #${n} excluded, named target ${p} absent at origin/main`, '--reversibility', 'n/a',
  ]));
  const staged = positive.cap.staged.filter((s) => s.id.startsWith('dispatch-target-missing-'));
  assert.deepEqual(staged.map((s) => s.id), ['dispatch-target-missing-9006', 'dispatch-target-missing-9009']);
  assert.equal(staged[0].body, fenceTargetProposal('9006', 'docs/gone6.md', 'origin/main'));
  assert.equal(staged[1].body, fenceTargetProposal('9009', 'docs/gone.md', 'origin/main'));
  assert.deepEqual(staged[1].args.slice(0, 4), ['--run', positive.cap.runDir, '--id', 'dispatch-target-missing-9009']);
  assert.ok(positive.cap.stdout.includes('staged dispatch-target-missing-9009\n'), 'the stage-item stdout reaches the terminal');
  assert.ok(positive.cap.stdout.includes('logged dispatch: #9009 excluded, named target docs/gone.md absent at origin/main\n'), 'so does the log-decision stdout');
  // ghCalls records every runner call's argv, git included: the branch lookup and the two probes.
  assert.deepEqual(positive.ghCalls.filter((a) => ['cat-file', 'remote'].includes(a[0])), [
    ['remote', 'show', 'origin'], ['cat-file', '-e', 'origin/main:docs/gone6.md'], ['cat-file', '-e', 'origin/main:docs/gone.md'],
  ]);
  assert.deepEqual(positive.json('dispatch-named-targets.json'), [
    { number: 9006, target: { path: 'docs/gone6.md' } }, { number: 9009, target: { path: 'docs/gone.md' } },
  ]);

  const omitted = pull4(FULL(), { omit: ['target-missing'] });
  asserts(() => assertTargetMissing(omitted));
  assert.deepEqual(entriesOf(omitted, 'target-missing'), []);
  assert.ok(groupNumbers(omitted).flat().includes(9009), 'the named-target record stays');
  assert.deepEqual(omitted.cap.log, []);
  assert.deepEqual(omitted.cap.staged.filter((s) => s.id.startsWith('dispatch-target-missing-')), []);
  assert.equal(omitted.text['dispatch-named-targets.json'], undefined, 'no named-target probe');
  // PF10: the run-dir and integration-branch resolution is shared setup and still runs.
  assert.equal(omitted.cap.hooks.length, 2, 'target-missing resolution (shared, PF10) plus the shipped pass');
  assert.deepEqual(omitted.cli('resolve-policy.js').filter(([, , key]) => key === 'integration-branch').length, 1);
  assert.equal(omitted.state.integrationRef, 'origin/main');
  assert.deepEqual(entriesOf(omitted, 'shipped').map((e) => e.records[0]), [9006, 9010], 'AC3: with target-missing omitted #9006 falls to shipped');
});

test('#5227 target-missing: the first hooks.js resolve-run-dir call leaves its stderr on the terminal; the shipped pass drops its own (2>/dev/null)', () => {
  const r = pull4(FULL(), { hooksErr: (i) => `claude-tweaks: resolve-run-dir: boom ${i}\n` });
  assert.ok(r.errs.includes('claude-tweaks: resolve-run-dir: boom 0\n'), r.stderr);
  assert.ok(!r.stderr.includes('boom 1'), 'the second call (shipped) is silenced in the fence');
});

test("#5227 open-pr: with no groups the fence's echo '{}' leaves {}\\n in the linked-PRs file and no query runs; a resolve-policy.js stderr is forwarded", () => {
  const scenario = {
    policy: { 'work-links': 'body-text' },
    gh: [{ argv: QUEUE_ARGV, stdout: '[]\n' }, { argv: OPEN_NUMBERS_ARGV, stdout: '[]\n' }],
  };
  const r = pull4(scenario, { spawn: { 'resolve-policy.js': { status: 0, stdout: '\n', stderr: 'resolve-policy: noted\n' } } });
  assert.equal(r.text['dispatch-linked-prs.json'], '{}\n');
  assert.deepEqual(r.cli('resolve-linked-prs.js'), []);
  assert.ok(r.errs.includes('resolve-policy: noted\n'), r.stderr);
});

test('#5227 shipped: the gh pr view probe runs with stderr ignored (2>/dev/null); the queue pull does not', () => {
  const seen = [];
  const base = fakeRun(FULL());
  pull4(FULL(), { run: (cmd, args, opts) => { seen.push([args[0], args[1], opts.stdio]); return base(cmd, args, opts); } });
  assert.deepEqual(seen.find(([a, b]) => a === 'pr' && b === 'view')[2], ['pipe', 'pipe', 'ignore']);
  assert.equal(seen.find(([a, b]) => a === 'issue' && b === 'list')[2], undefined);
});

test('#5227 oracle helper: reported() keeps AUTO/Warning lines and cuts the four $(cat err) failure lines after their fixed prefix', () => {
  const text = [
    'dispatch: queue-pull stopped -- not-spec-shaped exclusion pass hit a corrupt exclusions file: /tmp/x.cjs:5',
    'dispatch: queue-pull stopped -- open-linked-PR exclusion pass hit a corrupt exclusions file: node:internal/modules:1',
    'Warning: not-spec-shaped pass skipped — whatever',
    'Warning: open-linked-PR filtering failed — dispatch-groups.json left unfiltered for this exclusion this run: tail',
    'Warning: linked-PR query failed — falling back to no open-PR or shipped-candidate exclusion this run: kept whole',
  ].join('\n');
  assert.deepEqual(reported(text), [
    'dispatch: queue-pull stopped -- not-spec-shaped exclusion pass hit a corrupt exclusions file: ',
    'dispatch: queue-pull stopped -- open-linked-PR exclusion pass hit a corrupt exclusions file: ',
    'Warning: not-spec-shaped pass skipped — ',
    'Warning: open-linked-PR filtering failed — dispatch-groups.json left unfiltered for this exclusion this run: ',
    'Warning: linked-PR query failed — falling back to no open-PR or shipped-candidate exclusion this run: kept whole',
  ]);
});

test('AC2.1 target-missing: a target present at the integration tip is kept; the git probe argv is cat-file -e <ref>:<path>', () => {
  const scenario = { ...FULL(), origin: { branches: { main: { 'docs/gone.md': 'still here\n' } } } };
  const r = pull4(scenario);
  assert.deepEqual(entriesOf(r, 'target-missing').map((e) => e.records[0]), [9006]);
  assert.ok(groupNumbers(r).flat().includes(9009), 'a present target is not excluded');
  assert.deepEqual(r.cap.staged.map((s) => s.id).filter((id) => id.startsWith('dispatch-target-missing-')), ['dispatch-target-missing-9006']);
});

test('AC1.1 target-missing: the Close proposal is written to target-missing-proposal-<n>.md in the session dir, so stage-item.js stages dispatch-target-missing-<n>.md', () => {
  const r = pull4(FULL(), {
    // An earlier pull's file at the same path is overwritten, not kept.
    prepare: () => {
      const dir = path.dirname(sessionPaths('qp-t3')['dispatch-groups.json']);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'target-missing-proposal-9006.md'), 'stale\n');
      return {};
    },
  });
  const staged = r.cap.staged.filter((s) => s.id.startsWith('dispatch-target-missing-'));
  assert.deepEqual(staged.map((s) => `${s.id}${path.extname(s.file)}`), ['dispatch-target-missing-9006.md', 'dispatch-target-missing-9009.md'], 'the name stage-item.js writes: --id plus --file\'s extension (write.js)');
  assert.deepEqual(staged.map((s) => path.basename(s.file)), ['target-missing-proposal-9006.md', 'target-missing-proposal-9009.md']);
  assert.equal(staged[0].body, fenceTargetProposal('9006', 'docs/gone6.md', 'origin/main'));
  assert.equal(r.text['target-missing-proposal-9006.md'], staged[0].body, 'the file sits in the session dir beside dispatch-exclusions.json');
  assert.equal(r.text['target-missing-proposal-9009.md'], staged[1].body);
});

test('target-missing: a proposal write that fails stages nothing for that record and the pass moves on', () => {
  const r = pull4(FULL(), {
    // A directory at the proposal path makes this pull's write fail, so no file of this pull exists to stage.
    prepare: () => {
      const dir = path.dirname(sessionPaths('qp-t3')['dispatch-groups.json']);
      fs.mkdirSync(path.join(dir, 'target-missing-proposal-9006.md'), { recursive: true });
      return {};
    },
  });
  // cliCalls records each stage-item.js invocation before the stub runs; the stub itself throws on the directory, so cap.staged cannot show it.
  const staged = r.cliCalls.filter((c) => c[0] === 'stage-item.js').map((c) => c[c.indexOf('--id') + 1]).filter((id) => id.startsWith('dispatch-target-missing-'));
  assert.deepEqual(staged, ['dispatch-target-missing-9009']);
  assert.ok(r.errs.some((e) => /^queue-pull: write target-missing-proposal-9006\.md: /.test(e)), r.stderr);
});

// A read-only file an earlier pull left: the write fails but the stale file stays readable, so only the
// fence's `|| continue` keeps it from being staged. Root writes through 0444, so the fault cannot be planted.
test('target-missing oracle: the fence never stages an earlier pull\'s proposal when this pull\'s write fails, and stages the next record', { skip: oracleSkip() || (process.getuid && process.getuid() === 0 && 'root writes through a read-only file') }, async () => {
  const sessionId = 'qp-tm-write-fail';
  const { resolveSessionId } = require(path.join(REPO, 'plugin', 'bin', 'lib', 'session-tmp.js'));
  const sb = createSandbox(FULL());
  try {
    const dir = path.join(sb.root, 'tmp', 'tm-fail', `ct-session-${resolveSessionId(sessionId)}`);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'target-missing-proposal-9006.md'), 'stale\n', { mode: 0o444 });
    const oracle = await runOracle(sb, FENCE, { sessionId, tmp: 'tm-fail' });
    assert.equal(oracle.status, 0, oracle.stderr);
    assert.deepEqual(Object.keys(oracle.staged).filter((n) => n.startsWith('dispatch-target-missing-')), ['dispatch-target-missing-9009.md']);
    assert.match(oracle.stderr, /target-missing-proposal-9006\.md: Permission denied/);
  } finally {
    sb.cleanup();
  }
});

// #9009 naming HOSTILE_DOC: the fake git probe finds no such path at origin/main, like docs/gone.md.
function hostileScenario() {
  const scenario = FULL();
  const records = JSON.parse(scenario.gh[0].stdout);
  const rec = records.find((x) => x.number === 9009);
  assert.ok(rec.body.includes('**Doc:** docs/gone.md |'), 'the fixture still names docs/gone.md');
  rec.body = rec.body.replace('docs/gone.md', () => HOSTILE_DOC);
  scenario.gh[0] = { ...scenario.gh[0], stdout: JSON.stringify(records) + '\n' };
  return scenario;
}
function hostileProposal() {
  const r = pull4(hostileScenario());
  assert.ok(r.ghCalls.some((a) => a[0] === 'cat-file' && a[2] === `origin/main:${HOSTILE_DOC}`), 'the hostile path was probed and found absent');
  return r.cap.staged.find((s) => s.id === 'dispatch-target-missing-9009').body;
}

test('#5317 target-missing: a hostile Doc path is staged as one single-quoted --body word, equal to the fence', () => {
  const body = hostileProposal();
  assert.equal(body, fenceTargetProposal('9009', HOSTILE_DOC, 'origin/main'));
  assert.ok(body.includes(`gh issue comment 9009 --body ${shQuote(CLOSING_BODY(HOSTILE_DOC, 'origin/main'))}\n`));
  assert.ok(body.includes('gh issue close 9009 --reason "not planned"\n'), 'the close line is unchanged');
});

test('#5317 AC1 (module): run by bash, the staged comment posts the path verbatim and runs nothing else',
  { skip: process.platform === 'win32' && 'no bash' }, () => {
    const run = runStagedComment(hostileProposal(), 9009);
    assert.equal(run.status, 0, run.stderr);
    assert.deepEqual({ idRan: run.idRan, ghCalls: run.ghCalls },
      { idRan: false, ghCalls: [['issue', 'comment', '9009', '--body', CLOSING_BODY(HOSTILE_DOC, 'origin/main')]] },
      'neither $(id) nor the backtick ran, and the path reached the comment verbatim');
  });

test('AC2.1 shipped: #9010 (strong) is excluded with its signals, prints the strong AUTO line and stages shipped-close-9010; #9016 (weak) is probed, prints the weak AUTO line and stays', () => {
  const r = pull4(FULL());
  assertShipped(r);
  const auto = r.errs.filter((e) => e.startsWith('AUTO — dispatch:'));
  assert.deepEqual(auto, [
    'AUTO — dispatch: #9010 excluded, shipped by merged PR #5010 (merged-pr-mention-after-created, title-similarity)\n',
    'AUTO — dispatch: #9016 mentioned by merged PR #5016 without a closing keyword; dispatching anyway\n',
  ]);
  assert.ok(FENCE.includes("'AUTO — dispatch: #' + c.number + ' excluded, shipped by merged PR #' + result.pr + ' (' + result.signals.join(', ') + ')'"));
  assert.ok(FENCE.includes("' mentioned by merged PR #' + result.pr + ' without a closing keyword; dispatching anyway'"));
  assert.ok(groupNumbers(r).flat().includes(9016), 'a weak mention never excludes');
  assert.deepEqual(prViews(r), [PR_VIEW(5016)], 'only the weak candidate is probed');
  assert.deepEqual(r.json('dispatch-shipped-probe-prs.json'), [5016]);
  assert.equal(r.text['dispatch-shipped-pr-files.jsonl'], `${JSON.stringify({ pr: 5016, files: WEAK_PR_FILES })}\n`);
  assert.deepEqual(r.json('dispatch-shipped-releases.json'), {});

  const staged = r.cap.staged.filter((s) => s.id.startsWith('shipped-close-'));
  assert.deepEqual(staged.map((s) => s.id), ['shipped-close-9010']);
  assert.equal(path.basename(staged[0].file), 'shipped-close-proposal-9010.md');
  assert.equal(path.basename(path.dirname(staged[0].file)), `ct-session-${T4_SESSION}`, 'the proposal lives beside the exclusions file');
  assert.equal(r.text['shipped-close-proposal-9010.md'], staged[0].body);
  assert.deepEqual(staged[0].args.slice(0, 2), ['--run', r.cap.runDir]);
  assert.equal(staged[0].body, [
    '## Close (GitHub)', '', '#9010 — deliverables already shipped by merged PR #5010', '',
    'Signals: merged-pr-mention-after-created, title-similarity', '',
    'Comment then close: `gh issue close 9010 --comment "Deliverables already shipped by #5010"`',
  ].join('\n'));
  assert.ok(FENCE.includes("'Comment then close: \\`gh issue close ' + entry.number + ' --comment \"Deliverables already shipped by #' + entry.pr + '\"\\`',"));
  assert.ok(!r.cap.stdout.includes('staged shipped-close-9010\n'), 'the shipped stage-item stdout is dropped');
  assert.equal(r.cap.hooks.length, 2, 'hooks.js resolve-run-dir is called twice, as in the fence');
  assert.deepEqual(r.cap.hooks[1], ['resolve-run-dir', '--spec-slug', 'dispatch-standalone']);

  const omitted = pull4(FULL(), { omit: ['shipped'] });
  asserts(() => assertShipped(omitted));
  assert.deepEqual(entriesOf(omitted, 'shipped'), []);
  assert.ok(groupNumbers(omitted).flat().includes(9010));
  assert.deepEqual(prViews(omitted), []);
  assert.deepEqual(omitted.cap.staged.filter((s) => s.id.startsWith('shipped-close-')), []);
  assert.deepEqual(omitted.errs.filter((e) => e.startsWith('AUTO')), []);
  assert.equal(omitted.cap.hooks.length, 1, 'only the shared target-missing resolution ran');
  assertTargetMissing(omitted);
  assertOpenPr(omitted);
  assertNotSpecShaped(omitted);
});

test('AC2.1 shipped: a probed PR whose files cover the Key Files upgrades a weak mention to strong (key-files-covered)', () => {
  const scenario = FULL();
  scenario.gh = scenario.gh.map((e) => (e.argv && e.argv[1] === 'view' ? { ...e, stdout: '["plugin/bin/fixture-9016.js"]\n' } : e));
  const r = pull4(scenario);
  assert.deepEqual(entriesOf(r, 'shipped').map((e) => [e.records[0], e.detail.signals]), [
    [9010, ['merged-pr-mention-after-created', 'title-similarity']],
    [9016, ['merged-pr-mention-after-created', 'key-files-covered']],
  ]);
  assert.ok(!groupNumbers(r).flat().includes(9016));
});

test('#5313 shipped: a failed gh pr view writes files:null and prints one Warning naming the view and the record, after the weak AUTO line; the candidate stays weak and eligible', () => {
  const weakAuto = 'AUTO — dispatch: #9016 mentioned by merged PR #5016 without a closing keyword; dispatching anyway\n';
  const scenario = FULL();
  scenario.gh = scenario.gh.map((e) => (e.argv && e.argv[1] === 'view' ? { ...e, stdout: '', stderr: 'boom\n', status: 1 } : e));
  const r = pull4(scenario);
  assert.deepEqual(prViews(r), [PR_VIEW(5016)]);
  assert.equal(r.text['dispatch-shipped-pr-files.jsonl'], '{"pr":5016,"files":null}\n', 'the fence reads the failed call as null (`|| FILES_JSON=null`)');
  assert.deepEqual(r.errs.filter((e) => e.startsWith('Warning:')), [PR_VIEW_FAILED(5016, 9016)]);
  assert.equal(r.errs.indexOf(weakAuto) + 1, r.errs.indexOf(PR_VIEW_FAILED(5016, 9016)), 'the Warning prints right after the weak AUTO line');
  assert.ok(r.errs.includes(weakAuto));
  assert.ok(groupNumbers(r).flat().includes(9016), 'a failed view never excludes');
  assert.ok(!r.stderr.includes('boom'), 'the failed call stderr is dropped (2>/dev/null)');
  assert.ok(FENCE.includes("if (!downgradedAfterMerge(result) && prFiles.get(result.pr) === null) console.error('Warning: gh pr view ' + result.pr + ' failed — #' + c.number + ' kept as a weak shipped candidate (files unprobed) this run');"));

  // A failed call that printed something first still reads as null: the fence assigns null, not the partial output.
  const partial = FULL();
  partial.gh = partial.gh.map((e) => (e.argv && e.argv[1] === 'view' ? { ...e, stdout: '["a"]', status: 1 } : e));
  const p = pull4(partial);
  assert.equal(p.text['dispatch-shipped-pr-files.jsonl'], '{"pr":5016,"files":null}\n');
  assert.deepEqual(p.errs.filter((e) => e.startsWith('Warning:')), [PR_VIEW_FAILED(5016, 9016)]);
  assert.ok(!p.errs.some((e) => e.startsWith('queue-pull: shipped-pr-files: ')), p.stderr);
});

test('#5313 shipped: with every probe failing, each probed weak record warns (two records sharing PR 6201 both warn); a record beyond the 5-probe cap does not', () => {
  const labels = ['auto:build', 'ready'];
  const numbers = [9201, 9202, 9203, 9204, 9205, 9206, 9207, 9208];
  const linked = Object.fromEntries(numbers.map((n) => [n, { mentions: [mention(n === 9208 ? 6201 : n - 3000, 'Unrelated cleanup of the build output')] }]));
  const scenario = {
    policy: { 'work-links': 'body-text' },
    origin: { branches: { main: {} } },
    linked,
    gh: [
      { argv: QUEUE_ARGV, stdout: JSON.stringify(numbers.map((n) => ghRecord(n, { body: withBody(n), labels }))) + '\n' },
      { argv: OPEN_NUMBERS_ARGV, stdout: `${JSON.stringify(numbers.map((number) => ({ number })))}\n` },
      ...numbers.slice(0, 7).map((n) => ({ argv: PR_VIEW(n - 3000), stdout: '', status: 1 })),
    ],
  };
  const r = pull4(scenario);
  assert.deepEqual(r.errs.filter((e) => e.startsWith('Warning:')), [
    PR_VIEW_FAILED(6201, 9201), PR_VIEW_FAILED(6202, 9202), PR_VIEW_FAILED(6203, 9203),
    PR_VIEW_FAILED(6204, 9204), PR_VIEW_FAILED(6205, 9205), PR_VIEW_FAILED(6201, 9208),
  ]);
  assert.ok(!r.errs.some((e) => e.startsWith('Warning:') && (e.includes('#9206') || e.includes('#9207'))), 'a record beyond the probe cap is unprobed, not failed');
});

test('#5313 shipped: a weak mention predating the claim release that shares a failed probed PR prints no Warning', () => {
  const labels = ['auto:build', 'ready'];
  const numbers = [9301, 9302];
  const linked = Object.fromEntries(numbers.map((n) => [n, { mentions: [mention(6301, 'Unrelated cleanup of the build output')] }]));
  const scenario = {
    policy: { 'work-links': 'body-text' },
    origin: { branches: { main: {} } },
    linked,
    gh: [
      { argv: QUEUE_ARGV, stdout: JSON.stringify(numbers.map((n) => ghRecord(n, { body: withBody(n), labels }))) + '\n' },
      { argv: OPEN_NUMBERS_ARGV, stdout: `${JSON.stringify(numbers.map((number) => ({ number })))}\n` },
      { argv: PR_VIEW(6301), stdout: '', status: 1 },
    ],
  };
  const claims = { 9301: JSON.stringify({ released: true, releasedAt: '2026-11-07T10:00:00Z' }) };
  const r = pull4(scenario, { claims });
  assert.deepEqual(prViews(r), [PR_VIEW(6301)], 'the non-predating record makes the PR a probe candidate');
  assert.deepEqual(r.errs.filter((e) => e.startsWith('Warning:')), [PR_VIEW_FAILED(6301, 9302)], 'the predating record 9301 stays silent');
  assert.ok(r.errs.some((e) => e.startsWith('AUTO — dispatch: #9301 kept: merged PR #6301 predates')), r.stderr);
});

test('#5227 shipped: a missing shipped-pr-files file reads as no probed files (ENOENT is caught), and the pass still classifies', () => {
  const scenario = FULL();
  // The probe call deletes the file and answers invalid JSON, so the append throws and nothing recreates it.
  scenario.gh = scenario.gh.map((e) => (e.argv && e.argv[1] === 'view'
    ? { ...e, stdout: '["a"', status: 0, effect: 'delete-session-file:dispatch-shipped-pr-files.jsonl' } : e));
  const r = pull4(scenario);
  assert.equal(r.text['dispatch-shipped-pr-files.jsonl'], undefined);
  assertShipped(r);
  assert.ok(r.errs.includes('AUTO — dispatch: #9016 mentioned by merged PR #5016 without a closing keyword; dispatching anyway\n'), r.stderr);
});

test('#5227 shipped: no mention means no probe and no AUTO line; a weak mention that predates the claim release is kept without a probe, and its AUTO line names the release', () => {
  const quiet = pull4(S1());
  assert.deepEqual(prViews(quiet), []);
  assert.deepEqual(quiet.errs.filter((e) => e.startsWith('AUTO')), []);
  assert.deepEqual(quiet.cap.staged, []);

  const claims = { 9016: JSON.stringify({ released: true, releasedAt: '2026-11-07T10:00:00Z' }), 9010: JSON.stringify({ released: true, releasedAt: '2026-11-07T10:00:00Z' }) };
  const r = pull4(FULL(), { claims });
  assert.deepEqual(prViews(r), [], 'a predating weak result is never a probe candidate');
  assert.deepEqual(r.json('dispatch-shipped-releases.json'), { 9010: '2026-11-07T10:00:00.000Z', 9016: '2026-11-07T10:00:00.000Z' });
  assert.deepEqual(r.errs.filter((e) => e.startsWith('AUTO')), [
    'AUTO — dispatch: #9010 kept: merged PR #5010 predates claim release at 2026-11-07T10:00:00.000Z — remaining work assumed\n',
    'AUTO — dispatch: #9016 kept: merged PR #5016 predates claim release at 2026-11-07T10:00:00.000Z — remaining work assumed\n',
  ]);
  assert.deepEqual(entriesOf(r, 'shipped'), [], 'a title match that predates the release rates weak, so it is not excluded');
  assert.ok(FENCE.includes("' kept: merged PR #' + result.pr + ' predates claim release at ' + releases[c.number] + ' — remaining work assumed'"));
});

const SHAPED_AFTER_MERGE = '2026-11-07T10:00:00Z';
const shapedScenario = (n, lastShapedAt) => {
  const scenario = FULL();
  scenario.linked[n] = { ...scenario.linked[n], lastShapedAt };
  return scenario;
};

test('AC1.1 (#5722) shipped: a strong title match shaped after the merge stays in dispatch-groups.json, unprobed, with the shaping kept line', () => {
  const r = pull4(shapedScenario(9010, SHAPED_AFTER_MERGE));
  assert.ok(groupNumbers(r).flat().includes(9010), 'the record stays in the groups');
  assert.deepEqual(entriesOf(r, 'shipped'), [], 'a mention that predates the shaping rates weak, so it is not excluded');
  assert.deepEqual(r.cap.staged.filter((s) => s.id === 'shipped-close-9010'), [], 'no Close proposal is staged');
  assert.deepEqual(prViews(r), [PR_VIEW(5016)], 'only the unshaped weak candidate is probed; the shaped one is skipped');
  assert.deepEqual(r.errs.filter((e) => e.startsWith('AUTO — dispatch: #9010')), [
    'AUTO — dispatch: #9010 kept: merged PR #5010 predates ready/auto:build labeling at 2026-11-07T10:00:00Z — remaining work assumed\n',
  ]);
  assert.ok(FENCE.includes("          : downgradedAfterMerge(result)\n            ? ' kept: merged PR #' + result.pr + ' predates ready/auto:build labeling at ' + entry.lastShapedAt + ' — remaining work assumed'"));
});

test('AC2.1 (#5722) shipped: a shaping time before the merge leaves 9010 excluded and its Close proposal staged', () => {
  const r = pull4(shapedScenario(9010, '2026-11-05T09:00:00Z'));
  assertShipped(r);
  assert.deepEqual(r.cap.staged.filter((s) => s.id.startsWith('shipped-close-')).map((s) => s.id), ['shipped-close-9010']);
});

test('#5722 shipped: release and shaping both after the merge print the claim-release kept line', () => {
  const claims = { 9010: JSON.stringify({ released: true, releasedAt: SHAPED_AFTER_MERGE }) };
  const r = pull4(shapedScenario(9010, SHAPED_AFTER_MERGE), { claims });
  assert.deepEqual(r.errs.filter((e) => e.startsWith('AUTO — dispatch: #9010')), [
    'AUTO — dispatch: #9010 kept: merged PR #5010 predates claim release at 2026-11-07T10:00:00.000Z — remaining work assumed\n',
  ]);
  assert.deepEqual(entriesOf(r, 'shipped'), []);
});

test('#5722 shipped: a weak mention predating the shaping that shares a failed probed PR prints no Warning', () => {
  const labels = ['auto:build', 'ready'];
  const numbers = [9301, 9302];
  const linked = Object.fromEntries(numbers.map((n) => [n, { mentions: [mention(6301, 'Unrelated cleanup of the build output')] }]));
  linked[9301].lastShapedAt = SHAPED_AFTER_MERGE;
  const scenario = {
    policy: { 'work-links': 'body-text' },
    origin: { branches: { main: {} } },
    linked,
    gh: [
      { argv: QUEUE_ARGV, stdout: JSON.stringify(numbers.map((n) => ghRecord(n, { body: withBody(n), labels }))) + '\n' },
      { argv: OPEN_NUMBERS_ARGV, stdout: `${JSON.stringify(numbers.map((number) => ({ number })))}\n` },
      { argv: PR_VIEW(6301), stdout: '', status: 1 },
    ],
  };
  const r = pull4(scenario);
  assert.deepEqual(prViews(r), [PR_VIEW(6301)], 'the unshaped record makes the PR a probe candidate');
  assert.deepEqual(r.errs.filter((e) => e.startsWith('Warning:')), [PR_VIEW_FAILED(6301, 9302)], 'the shaped record 9301 stays silent');
  assert.ok(r.errs.some((e) => e.startsWith('AUTO — dispatch: #9301 kept: merged PR #6301 predates ready/auto:build labeling at')), r.stderr);
});

// pull4 runs the module only, so the fence's shaping wiring is pinned by text: both classifyShipped
// calls carry lastShapedAt, and the first pass skips the probe for either downgrade.
test('#5722 fence: the first-pass classifyShipped call passes lastShapedAt', () => {
  assert.ok(FENCE.includes("const result = classifyShipped(c, mentions, { lastReleasedAt: releases[c.number], lastShapedAt: entry.lastShapedAt });"));
});

test('#5722 fence: the first pass skips the probe for either downgrade through downgradedAfterMerge', () => {
  assert.ok(FENCE.includes("if (result.tier === 'weak' && !downgradedAfterMerge(result)) toProbe.push(result.pr);"));
});

test('#5722 fence: the second-pass classifyShipped call passes lastShapedAt', () => {
  assert.ok(FENCE.includes("const result = classifyShipped(c, mentions, { prFiles, lastReleasedAt: releases[c.number], lastShapedAt: entry.lastShapedAt });"));
});

test('#5227 shipped: at most 5 distinct PRs are probed per pull', () => {
  const labels = ['auto:build', 'ready'];
  const numbers = [9201, 9202, 9203, 9204, 9205, 9206, 9207, 9208];
  const linked = Object.fromEntries(numbers.map((n) => [n, { mentions: [mention(n === 9208 ? 6201 : n - 3000, 'Unrelated cleanup of the build output')] }]));
  const scenario = {
    policy: { 'work-links': 'body-text' },
    origin: { branches: { main: {} } },
    linked,
    gh: [
      { argv: QUEUE_ARGV, stdout: JSON.stringify(numbers.map((n) => ghRecord(n, { body: withBody(n), labels }))) + '\n' },
      { argv: OPEN_NUMBERS_ARGV, stdout: `${JSON.stringify(numbers.map((number) => ({ number })))}\n` },
      ...numbers.slice(0, 7).map((n) => ({ argv: PR_VIEW(n - 3000), stdout: '[]\n' })),
    ],
  };
  const r = pull4(scenario);
  assert.deepEqual(r.json('dispatch-shipped-probe-prs.json'), [6201, 6202, 6203, 6204, 6205], 'the 8th record mentions PR 6201 again, which counts once');
  assert.deepEqual(prViews(r), [6201, 6202, 6203, 6204, 6205].map(PR_VIEW));
});

test('AC3.1: a candidate that qualifies for several passes gets only the first reason; no probe is made for an excluded candidate', () => {
  const r = pull4(FULL());
  assert.deepEqual(reasonsOf(r, 9004), ['not-spec-shaped'], '#9004: spec-shape, open PR, missing target and a strong mention');
  assert.deepEqual(reasonsOf(r, 9005), ['open-pr'], '#9005: open PR and a strong mention');
  assert.deepEqual(reasonsOf(r, 9006), ['target-missing'], '#9006: missing target and a strong mention');
  assert.deepEqual(reasonsOf(r, 9007), ['not-spec-shaped']);
  assert.deepEqual(reasonsOf(r, 9008), ['open-pr']);
  assert.deepEqual(reasonsOf(r, 9009), ['target-missing']);
  assert.deepEqual(reasonsOf(r, 9010), ['shipped']);
  assert.deepEqual(reasonsOf(r, 9016), []);
  assert.deepEqual(r.cli('resolve-linked-prs.js').map(([, nums]) => nums.split(',').map(Number)), [[9001, 9003, 9005, 9006, 9008, 9009, 9010, 9016]], 'the linked-PR query leaves out #9004 and #9007');
  const proposals = r.cap.staged.map((s) => s.id);
  assert.deepEqual(proposals, ['dispatch-target-missing-9006', 'dispatch-target-missing-9009', 'shipped-close-9010'], 'no stray Close proposal for #9004, #9005 or the open-PR records');
  assert.ok(!r.cap.log.some((a) => a.join(' ').includes('9004')), 'no target probe or log for the spec-less docs-health record');
  assert.deepEqual(r.json('dispatch-named-targets.json').map((n) => n.number), [9006, 9009], '#9004 never reaches the named-target read');
});

test('#5227 portability: the integration branch comes from the policy key, else from `git remote show origin` HEAD, never a literal', () => {
  const withPolicy = pull4({ ...FULL(), policy: { 'work-links': 'body-text', 'integration-branch': 'release/next' }, origin: { branches: { 'release/next': { 'docs/gone.md': 'x' }, main: {} } } });
  assert.equal(withPolicy.state.integrationBranch, 'release/next');
  assert.equal(withPolicy.state.integrationRef, 'origin/release/next');
  assert.ok(withPolicy.cap.log.some((a) => a.includes('dispatch: #9006 excluded, named target docs/gone6.md absent at origin/release/next')));
  assert.deepEqual(entriesOf(withPolicy, 'target-missing').map((e) => e.records[0]), [9006], 'the probe ran against origin/release/next, where docs/gone.md exists');
  assert.ok(withPolicy.cap.staged[0].body.includes('absent at `origin/release/next`'));

  const gitArgvs = [];
  const base = fakeRun({ ...FULL(), headBranch: 'trunk', origin: { branches: { main: {}, trunk: { 'docs/gone.md': 'x' } } } });
  const viaRemote = pull4({ ...FULL(), headBranch: 'trunk', origin: { branches: { main: {}, trunk: { 'docs/gone.md': 'x' } } } }, {
    run: (cmd, args, opts) => { if (cmd === 'git') gitArgvs.push(args); return base(cmd, args, opts); },
  });
  assert.deepEqual(gitArgvs, [['remote', 'show', 'origin'], ['rev-parse', '--verify', '--quiet', 'origin/trunk^{commit}'], ['cat-file', '-e', 'origin/trunk:docs/gone6.md'], ['cat-file', '-e', 'origin/trunk:docs/gone.md']]);
  assert.equal(viaRemote.state.integrationBranch, 'trunk');
  assert.deepEqual(entriesOf(viaRemote, 'target-missing').map((e) => e.records[0]), [9006]);

  const policyGit = [];
  const policyScenario = { ...FULL(), policy: { 'work-links': 'body-text', 'integration-branch': 'release/next' }, origin: { branches: { 'release/next': { 'docs/gone.md': 'x' }, main: {} } } };
  const policyBase = fakeRun(policyScenario);
  pull4(policyScenario, {
    run: (cmd, args, opts) => { if (cmd === 'git') policyGit.push(args); return policyBase(cmd, args, opts); },
  });
  assert.deepEqual(policyGit.map((a) => a.join(' ')), ['rev-parse --verify --quiet origin/release/next^{commit}', 'cat-file -e origin/release/next:docs/gone6.md', 'cat-file -e origin/release/next:docs/gone.md'], 'no `git remote show origin` when the policy answers');
});

test('#5227 portability: a failing `git remote show origin` leaves the branch empty, composes no origin/ ref, skips the target-missing pass and the pull continues', () => {
  const gitArgvs = [];
  const base = fakeRun({ ...FULL(), gitFail: [['remote', 'show', 'origin']] });
  const r = pull4({ ...FULL(), gitFail: [['remote', 'show', 'origin']] }, {
    run: (cmd, args, opts) => { if (cmd === 'git') gitArgvs.push(args); return base(cmd, args, opts); },
  });
  assert.equal(r.state.integrationBranch, '');
  assert.equal(r.state.integrationRef, '', 'no origin/ ref is composed');
  assert.deepEqual(entriesOf(r, 'target-missing'), [], 'no named target is excluded against an empty branch');
  assert.ok(r.errs.includes(`${TARGET_MISSING_SKIPPED}\n`), r.stderr);
  assert.ok(!gitArgvs.some((a) => a[0] === 'cat-file'), 'no `git cat-file` probe runs against an empty branch');
  assert.ok(!gitArgvs.some((a) => a[0] === 'rev-parse'), 'no `git rev-parse` ref probe runs against an empty branch (#5863: the probe guard keeps the empty-branch short-circuit)');
  assert.deepEqual(reasonsOf(r, 9006), ['shipped'], 'a later pass still ran: #9006 is excluded as shipped, not as target-missing');
  const named = JSON.parse(r.text['dispatch-named-targets.json']).map((e) => e.number);
  assert.ok(named.includes(9006) && named.includes(9009), 'dispatch-named-targets.json is still written with the named candidates');
});

test('#5863: an origin HEAD branch of (unknown) skips the target-missing pass with the Warning, excludes nothing as target-missing and stages no Close proposal', () => {
  const skipped = (scenario) => {
    const gitArgvs = [];
    const base = fakeRun(scenario);
    const r = pull4(scenario, { run: (cmd, args, opts) => { if (cmd === 'git') gitArgvs.push(args); return base(cmd, args, opts); } });
    assert.deepEqual(entriesOf(r, 'target-missing'), [], 'no named target is excluded against an unresolvable branch');
    assert.ok(r.errs.includes(`${TARGET_MISSING_SKIPPED}\n`), r.stderr);
    assert.ok(!r.cap.staged.some((s) => s.id.startsWith('dispatch-target-missing-')), 'no Close proposal is staged');
    assert.ok(!gitArgvs.some((a) => a[0] === 'cat-file'), 'no `git cat-file` probe runs against an unresolvable branch');
    return r;
  };
  // Reading B (spec 5863 Plan Review Clarifications): only this pass skips; the shared branch stays as resolved for the unlanded-blocker pass.
  const viaRemote = skipped({ ...FULL(), headBranch: '(unknown)' });
  assert.equal(viaRemote.state.integrationBranch, '(unknown)');
  assert.equal(viaRemote.state.integrationRef, 'origin/(unknown)');
  const viaPolicy = skipped({ ...FULL(), policy: { 'work-links': 'body-text', 'integration-branch': 'no-such-branch' } });
  assert.equal(viaPolicy.state.integrationBranch, 'no-such-branch');
  assert.equal(viaPolicy.state.integrationRef, 'origin/no-such-branch');
});

test('AC4.6 (in-process): a corrupt exclusions file before the open-PR append throws QueuePullStopped with the fence stop line, runs no later pass and leaves the file as it was', () => {
  const scenario = S1();
  scenario.linked = { 9001: { openPR: 70 } };
  scenario.gh = scenario.gh.map((e) => (e.argv && e.argv.join() === DEP_SEARCH_8000.join() ? { ...e, effect: 'corrupt-exclusions' } : e));
  const r = pull4(scenario, { allowThrow: true });
  assert.ok(r.thrown instanceof QueuePullStopped, String(r.thrown));
  assert.ok(r.thrown.line.startsWith(OPEN_STOP), r.thrown.line);
  assert.match(r.thrown.line, /appendExclusion: .* is unreadable/);
  assert.deepEqual(r.cap.order, ['truncate', 'fetch', 'blocked', 'oversized', 'write-back', 'not-spec-shaped', 'open-pr'], 'no pass after open-pr ran');
  assert.equal(r.text['dispatch-exclusions.json'], '{corrupt', 'the file keeps its bytes');
  assert.ok(r.text['dispatch-linked-prs.err'].includes('appendExclusion:'), 'the error file keeps the failure text the stop line quotes');
});

test('AC4.6 (in-process): the not-spec-shaped pass stops on a corrupt exclusions file the same way', () => {
  const scenario = FULL();
  scenario.gh = scenario.gh.map((e) => (e.argv && e.argv.join() === DEP_SEARCH_8000.join() ? { ...e, effect: 'corrupt-exclusions' } : e));
  const r = pull4(scenario, { allowThrow: true });
  assert.ok(r.thrown instanceof QueuePullStopped, String(r.thrown));
  assert.ok(r.thrown.line.startsWith(SHAPE_STOP), r.thrown.line);
  assert.deepEqual(r.cap.order.slice(-1), ['not-spec-shaped']);
  assert.equal(r.text['dispatch-exclusions.json'], '{corrupt');
  assert.ok(r.text['dispatch-groups.json'].includes('9007'), 'the groups file is left unfiltered');
});

test('#5227 not-spec-shaped non-append failure: an unreadable groups file prints "Warning: not-spec-shaped pass skipped — <err>" and filters nothing', () => {
  const scenario = FULL();
  scenario.gh = scenario.gh.map((e) => (e.argv && e.argv.join() === DEP_SEARCH_8000.join() ? { ...e, effect: 'corrupt-groups' } : e));
  const r = pull4(scenario, { passes: PASSES.slice(0, 6) });
  const warning = r.errs.find((e) => e.startsWith(SHAPE_WARNING));
  assert.ok(warning, r.stderr);
  assert.match(warning, /^Warning: not-spec-shaped pass skipped — .*JSON.*\n$/);
  assert.equal(r.text['dispatch-groups.json'], '{corrupt', 'nothing was filtered or rewritten');
  assert.ok(r.text['dispatch-shape-gate.err'].includes('JSON'), 'the error file keeps the text the Warning quotes');
  assert.deepEqual(entriesOf(r, 'not-spec-shaped'), []);
  assert.equal(r.thrown, null, 'a non-append failure never stops the pull');
});

test('#5227 target-missing and shipped stops: an unreadable named-targets file stops with the fence line; a shipped append failure stops with the shipped line', () => {
  const brokenNamed = pull4(FULL(), {
    allowThrow: true, passes: PASSES.slice(0, 8),
    before: (ctx) => { fs.mkdirSync(ctx.paths['dispatch-named-targets.json'], { recursive: true }); },
  });
  assert.ok(brokenNamed.thrown instanceof QueuePullStopped, String(brokenNamed.thrown));
  assert.equal(brokenNamed.thrown.line, `${TARGET_STOP}1); see error above.`);
  assert.ok(brokenNamed.errs.some((e) => e.startsWith('queue-pull: named-targets: ')), brokenNamed.stderr);

  const scenario = FULL();
  scenario.gh = scenario.gh.map((e) => (e.argv && e.argv[0] === 'pr' ? { ...e, effect: 'corrupt-exclusions' } : e));
  const shipped = pull4(scenario, { allowThrow: true });
  assert.ok(shipped.thrown instanceof QueuePullStopped, String(shipped.thrown));
  assert.equal(shipped.thrown.line, SHIPPED_STOP);
  assert.ok(shipped.errs.some((e) => /^queue-pull: shipped: appendExclusion: /.test(e)), shipped.stderr);
  assert.equal(shipped.cap.order.at(-1), 'shipped');
  assert.deepEqual(shipped.cap.staged.filter((s) => s.id.startsWith('shipped-close-')), [], 'nothing is staged after the stop');
});

test('#5227 shipped: an empty hooks.js resolve-run-dir answer stages no shipped proposal', () => {
  const r = pull4(FULL(), { hooksOut: (i, dir) => (i === 0 ? dir : '') });
  assertShipped(r);
  assert.equal(r.cap.hooks.length, 2);
  assert.deepEqual(r.cap.staged.filter((s) => s.id.startsWith('shipped-close-')), []);
  assert.deepEqual(r.cap.staged.map((s) => s.id), ['dispatch-target-missing-9006', 'dispatch-target-missing-9009'], 'the earlier answer was non-empty, so target-missing still staged');
  assert.equal(r.text['shipped-close-proposal-9010.md'], undefined, 'no proposal file is written either');
});

test('#5227 shipped: a hooks.js resolve-run-dir spawn that throws prints nothing (the fence\'s 2>/dev/null || true), stages nothing and the pull goes on; the first call\'s throw is still printed', () => {
  const hooksThrowingAt = (at) => {
    const seen = { n: 0 };
    return { seen, spawn: { 'hooks.js': () => { seen.n += 1; if (seen.n === at) throw new Error('spawn EMFILE'); return { status: 0, stdout: '\n', stderr: '' }; } } };
  };
  const second = hooksThrowingAt(2);
  const r = pull4(FULL(), { spawn: second.spawn });
  assert.equal(second.seen.n, 2, 'both resolve-run-dir calls were made');
  assert.equal(r.thrown, null, 'the pull does not stop');
  assert.ok(!r.stderr.includes('queue-pull: hooks.js'), r.stderr);
  assert.ok(!r.stderr.includes('spawn EMFILE'), r.stderr);
  assert.deepEqual(r.cap.staged.filter((s) => s.id.startsWith('shipped-close-')), [], 'a throw reads as an empty answer: nothing is staged');
  assertShipped(r);

  const first = hooksThrowingAt(1);
  const r1 = pull4(FULL(), { spawn: first.spawn });
  assert.ok(r1.errs.includes('queue-pull: hooks.js: spawn EMFILE\n'), 'the target-missing call leaves its stderr on the terminal (fence 377)');
});

test('#5227 target-missing: an empty first run-dir answer still calls log-decision and stage-item with --run "" (the fence does not guard it)', () => {
  const r = pull4(FULL(), { hooksOut: () => '' });
  assert.equal(r.cap.log.length, 2);
  assert.ok(r.cap.log.every((a) => a[a.indexOf('--run') + 1] === ''));
  assert.ok(r.cap.staged.every((s) => s.args[1] === ''));
});

test('#5227 cache hit: the four passes run again over the replayed groups and reach the same reasons', () => {
  const miss = pull4(FULL());
  const blob = miss.store.written[0].blob;
  const hit = pull4(FULL(), { persisted: blob });
  assert.equal(hit.state.cacheHit, true);
  for (const reason of ['not-spec-shaped', 'open-pr', 'target-missing', 'shipped']) {
    assert.deepEqual(entriesOf(hit, reason), entriesOf(miss, reason), reason);
  }
  assert.deepEqual(hit.json('dispatch-groups.json'), miss.json('dispatch-groups.json'));
  assert.deepEqual(hit.cap.staged.map((s) => s.id), miss.cap.staged.map((s) => s.id));
  assert.deepEqual(hit.cap.order.slice(-4), ['not-spec-shaped', 'open-pr', 'target-missing', 'shipped']);
});

test('#5227 omit: each Task 4 runner is called under omit and its omission removes only its own entries (every other reason is unchanged)', () => {
  const reasons = ['not-spec-shaped', 'open-pr', 'target-missing', 'shipped'];
  const base = pull4(FULL());
  for (const reason of reasons) {
    const omitted = pull4(FULL(), { omit: [reason] });
    assert.ok(omitted.cap.order.includes(reason), `${reason}'s runner still runs`);
    assert.deepEqual(entriesOf(omitted, reason), [], reason);
    assert.equal(omitted.store.written.length, 1, 'all four passes sit after write-back, so omitting one cannot change the blob it still writes (#6119)');
    const keepsOthers = reasons.filter((x) => x !== reason && x !== 'shipped' && !(reason === 'not-spec-shaped' && x === 'open-pr') && !(reason === 'open-pr' && x === 'shipped'));
    for (const other of keepsOthers) assert.deepEqual(entriesOf(omitted, other), entriesOf(base, other), `${reason} omitted, ${other}`);
  }
});

// ---- Task 5: blocker-landing, neighbour-in-flight, cross-PR overlap, near-duplicate; the omit sweep ----

const PIPE = () => S1({ pipeline: true });
const IN_FLIGHT_CAP = fenceText(/echo "(Warning: the bot:in-progress pull for the neighbour-in-flight pass[^"]*)" >&2/);
const OPEN_PR_CAP = fenceText(/echo "(Warning: the open-PR pull for the cross-PR overlap report[^"]*)" >&2/);

// pull4 over the whole registry with the canned landing CLI; live claims default to #7001 live.
function pull5(scenario, o = {}) {
  const landing = [];
  const r = pull4(scenario, {
    passes: PASSES,
    claims: { 7001: LIVE_CLAIM },
    ...o,
    spawn: { 'dispatch-unlanded-blockers.js': cannedLanding(landing), ...(o.spawn || {}) },
  });
  return { ...r, landing };
}
const withGh = (scenario, argv, change) => ({
  ...scenario,
  gh: scenario.gh.map((e) => (e.argv && e.argv.join('\u0000') === argv.join('\u0000') ? { ...e, ...change } : e)),
});
const flagValue = (args, flag) => args[args.indexOf(flag) + 1];

test('AC2.1 malformed-blocker and unlanded-blocker: #9012 and #9011 leave the groups with the canned CLI entries; omitting either reason skips the one shared call for both', () => {
  const positive = pull5(PIPE());
  assert.deepEqual(entriesOf(positive, 'malformed-blocker'), [{ reason: 'malformed-blocker', records: [9012], detail: { cause: MALFORMED_CAUSE } }]);
  assert.deepEqual(entriesOf(positive, 'unlanded-blocker'), [{ reason: 'unlanded-blocker', records: [9011], detail: { blockers: [{ blocker: 8001, commit: LANDING_COMMIT }] } }]);
  const left = groupNumbers(positive).flat();
  assert.ok(!left.includes(9011) && !left.includes(9012));
  assert.equal(positive.landing.length, 1, 'one call writes both reasons');
  const [args] = positive.landing;
  assert.deepEqual(args.map((a, i) => (args[i - 1] === '--groups' || args[i - 1] === '--exclusions' ? path.basename(a) : a)),
    ['--groups', 'dispatch-groups.json', '--exclusions', 'dispatch-exclusions.json', '--integration-branch', 'main', '--work-links', 'body-text']);
  assert.ok(!('dispatch-groups.json.tmp' in positive.text), 'the tmp file is moved over the groups file');
  assert.equal(JSON.parse(positive.text['dispatch-groups.json']).flat().length, groupNumbers(positive).flat().length);

  for (const reason of ['malformed-blocker', 'unlanded-blocker']) {
    const omitted = pull5(PIPE(), { omit: [reason] });
    assert.equal(omitted.landing.length, 0, `${reason} omitted: the shared call is skipped`);
    assert.deepEqual(entriesOf(omitted, 'malformed-blocker'), [], reason);
    assert.deepEqual(entriesOf(omitted, 'unlanded-blocker'), [], reason);
    assert.ok(groupNumbers(omitted).flat().includes(9011) && groupNumbers(omitted).flat().includes(9012), `${reason} omitted: both records stay`);
    assert.ok(omitted.cap.order.includes('blocker-landing'), 'the runner is still called');
  }
});

test('#5227 blocker-landing: on a queue-order cache hit --work-links is the empty string (PF9) and the integration branch is still resolved', () => {
  const miss = pull5(PIPE());
  assert.equal(flagValue(miss.landing[0], '--work-links'), 'body-text');
  const hit = pull5(PIPE(), { persisted: miss.store.written[0].blob });
  assert.equal(hit.state.cacheHit, true);
  assert.equal(hit.state.workLinks, '', 'the fence sets WORK_LINKS only on a miss');
  assert.equal(hit.landing.length, 1);
  assert.equal(flagValue(hit.landing[0], '--work-links'), '', 'the unset "$WORK_LINKS" reaches the CLI as an empty argument');
  assert.equal(flagValue(hit.landing[0], '--integration-branch'), 'main');
  assert.deepEqual(entriesOf(hit, 'unlanded-blocker').map((e) => e.records), [[9011]]);
});

test('#5227 blocker-landing: a non-zero exit stops the pull with the fence line, leaves the groups file unchanged, removes the tmp file and forwards the CLI stderr', () => {
  let tmpDuringCall = null;
  const failing = (args) => {
    tmpDuringCall = fs.existsSync(`${flagValue(args, '--groups')}.tmp`);
    return { status: 1, stdout: 'ignored', stderr: 'dispatch-unlanded-blockers.js: boom\n' };
  };
  const r = pull5(PIPE(), { allowThrow: true, spawn: { 'dispatch-unlanded-blockers.js': failing } });
  assert.equal(tmpDuringCall, true, "the fence's > redirect has created the tmp file by the time the CLI runs");
  assert.ok(r.thrown instanceof QueuePullStopped, String(r.thrown));
  assert.equal(r.thrown.line, UNLANDED_STOP);
  assert.match(r.stderr, /dispatch-unlanded-blockers\.js: boom/);
  assert.ok(groupNumbers(r).flat().includes(9011), 'the pool is not replaced by the failed output');
  assert.ok(!('dispatch-groups.json.tmp' in r.text), 'the tmp file is removed');
  assert.ok(!r.cap.order.includes('neighbour-in-flight'), 'no later pass runs after the stop');
  // A spawn that throws reads as a failed call too (status null).
  const thrown = pull5(PIPE(), { allowThrow: true, spawn: { 'dispatch-unlanded-blockers.js': () => { throw new Error('spawn ENOENT'); } } });
  assert.ok(thrown.thrown instanceof QueuePullStopped);
  assert.match(thrown.stderr, /queue-pull: dispatch-unlanded-blockers\.js: spawn ENOENT/);
});

test('#5227 blocker-landing: a .tmp file that cannot be created skips the CLI and stops with the fence line, as the fence\'s failed > redirect does', () => {
  const r = pull5(PIPE(), {
    allowThrow: true,
    before: (ctx) => fs.mkdirSync(`${ctx.paths['dispatch-groups.json']}.tmp`), // a directory: the create fails with EISDIR
  });
  assert.equal(r.landing.length, 0, 'the CLI is never spawned');
  assert.ok(r.thrown instanceof QueuePullStopped, String(r.thrown));
  assert.equal(r.thrown.line, UNLANDED_STOP);
  assert.ok(r.errs.some((e) => e.startsWith('queue-pull: write dispatch-groups.json.tmp: ')), r.stderr);
  assert.ok(groupNumbers(r).flat().includes(9011), 'the pool is left as it was');
  assert.ok(!r.cap.order.includes('neighbour-in-flight'), 'no later pass runs after the stop');
});

test('AC2.2 neighbour-in-flight: #9013 (a Key File shared with in-flight #7001, whose claim reads live) is written and stays in the groups; omitting the pass writes nothing', () => {
  const r = pull5(PIPE());
  assert.deepEqual(entriesOf(r, 'neighbour-in-flight'), [
    { reason: 'neighbour-in-flight', records: [9013], detail: { neighbours: [{ number: 7001, files: ['plugin/bin/fixture-9013.js'] }] } },
  ]);
  assert.ok(groupNumbers(r).flat().includes(9013), 'bypass: the record stays in dispatch-groups.json');
  assert.deepEqual(r.ghCalls.filter((a) => a.join() === IN_FLIGHT_ARGV.join()).length, 1);
  assert.equal(JSON.parse(r.text['dispatch-in-flight-raw.json'])[0].number, 7001);

  const omitted = pull5(PIPE(), { omit: ['neighbour-in-flight'] });
  assert.deepEqual(entriesOf(omitted, 'neighbour-in-flight'), []);
  assert.ok(groupNumbers(omitted).flat().includes(9013));
  assert.ok(omitted.cap.order.includes('neighbour-in-flight'), 'the runner is still called');
  assert.equal(omitted.ghCalls.filter((a) => a.join() === IN_FLIGHT_ARGV.join()).length, 1, 'the pool fetch is shared setup');

  const tombstone = pull5(PIPE(), { claims: { 7001: JSON.stringify({ released: true, releasedAt: '2026-11-12T11:00:00.000Z' }) } });
  assert.deepEqual(entriesOf(tombstone, 'neighbour-in-flight'), [], 'a released claim is not live');
});

// #5304 D1: "once per pull" must not degrade to "once per session". Two pulls over one session id
// in one TMPDIR, both with every claim read failing: each prints its own combined line.
test('#5304 D1: a second pull in the same session and TMPDIR prints its own combined claim line', () => {
  inOwnTmp((own) => {
    const sessionId = 'qp-5304-d1';
    const sessionDir = path.dirname(sessionPaths(sessionId)['dispatch-groups.json']);
    const pullOnce = () => {
      const errs = [];
      const scenario = PIPE();
      queuePull({ sessionId, cwd: own }, {
        run: fakeRun(scenario, { sessionDir }),
        spawnCli: fakeSpawnCli(scenario, { 'hooks.js': { status: 0, stdout: '', stderr: '' }, 'dispatch-unlanded-blockers.js': cannedLanding([]) }),
        queueOrder: { readOrder: () => null, writeOrder: () => ({ ok: true }) },
        expressQueuePolicy: EXPRESS_OFF,
        createClaimReader: () => ({ read: () => ({ failure: 'network-failure' }) }),
        now: () => NOW,
        stderr: (s) => errs.push(s),
      });
      return errs.filter((e) => e.includes('claim read failed'));
    };
    assert.deepEqual(pullOnce(), [`${CLAIM_READ_COMBINED}\n`]);
    assert.deepEqual(pullOnce(), [`${CLAIM_READ_COMBINED}\n`], 'the second pull prints its own line');
  });
});

// #5304 ruling: a shipped claim read fails, then the pull stops between the shipped and neighbour
// passes (here the unlanded-blocker CLI exits 1). The shipped claims read so far print once, at the stop.
test('#5304 stop: a shipped claim read that fails before a stop between the passes prints the claim line once', () => {
  inOwnTmp((own) => {
    const errs = [];
    const scenario = PIPE();
    const shippedClaimsFail = (n) => (n === 9010 || n === 9016 ? { failure: 'network-failure' } : { content: null });
    assert.throws(() => queuePull({ sessionId: 'qp-5304-stop', cwd: own }, {
      run: fakeRun(scenario, { sessionDir: path.dirname(sessionPaths('qp-5304-stop')['dispatch-groups.json']) }),
      spawnCli: fakeSpawnCli(scenario, { 'hooks.js': { status: 0, stdout: '', stderr: '' }, 'dispatch-unlanded-blockers.js': { status: 1, stdout: '', stderr: 'boom' } }),
      queueOrder: { readOrder: () => null, writeOrder: () => ({ ok: true }) },
      expressQueuePolicy: EXPRESS_OFF,
      createClaimReader: () => ({ read: shippedClaimsFail }),
      now: () => NOW,
      stderr: (s) => errs.push(s),
    }), (err) => err instanceof QueuePullStopped && err.line === UNLANDED_STOP);
    assert.deepEqual(errs.filter((e) => e.includes('claim read failed')), [
      'AUTO — dispatch: shipped-candidate claim read failed for #9010 (network-failure), #9016 (network-failure); release time unknown, no downgrade\n',
    ]);
  });
});

// #5304 final review: a neighbour pass that stops before its claim line (here its compute throws on
// a missing in-flight file, the files transport's R8 case) still prints the shipped claims read so far, once.
test('#5304 neighbour stop: a neighbour pass that stops before its claim line prints the shipped claim line once', () => {
  const errs = [];
  const sessionId = 'qp-5304-neighbour-stop';
  const ctx = makeContext({ sessionId, transport: 'files' }, {
    stderr: (s) => errs.push(s), stdout: () => {},
    createClaimReader: () => ({ read: () => ({ failure: 'network-failure' }) }),
    spawnCli: (name) => { if (name === 'hooks.js') return { status: 0, stdout: '\n', stderr: '' }; throw new Error(`unexpected ${name}`); },
    run: (cmd, args) => { throw new Error(`unexpected ${cmd} ${args.join(' ')}`); },
  });
  try {
    const record = (number) => ({ number, title: 'Add widget export command', body: '', createdAt: '2026-09-20T10:00:00.000Z', labels: ['ready'] });
    const mention = { number: 500, merged: true, title: 'Add widget export command', createdAt: '2026-09-25T10:00:00.000Z', mergedAt: '2026-10-01T10:00:00.000Z' };
    fs.writeFileSync(ctx.paths['dispatch-groups.json'], JSON.stringify([[record(7), record(8)]]));
    fs.writeFileSync(ctx.paths['dispatch-linked-prs.json'], JSON.stringify({ 7: { mentions: [mention] }, 8: { mentions: [mention] } }));
    fs.writeFileSync(ctx.paths['dispatch-exclusions.json'], '[]');
    fs.rmSync(ctx.state.files.inFlightRaw, { force: true });
    assert.throws(() => runPasses(PASSES.filter((p) => p.id === 'shipped' || p.id === 'neighbour-in-flight'), ctx),
      (err) => err instanceof QueuePullStopped && /neighbour-in-flight exclusion pass failed/.test(err.line));
    assert.deepEqual(errs.filter((e) => e.includes('claim read failed')), [
      'AUTO — dispatch: shipped-candidate claim read failed for #7 (network-failure), #8 (network-failure); release time unknown, no downgrade\n',
    ]);
  } finally {
    fs.rmSync(path.dirname(ctx.paths['dispatch-groups.json']), { recursive: true, force: true });
  }
});

// #5304 residual: an append that throws after the neighbour pass read its claims still prints the neighbour
// claims, once. #7002 (in flight, shares the Key File) fails its read; #7001 reads live and corrupts the
// exclusions file during the read, so the append for #9013 throws and the pass stops.
test('#5304 neighbour append stop: an append that throws after a neighbour claim read failed still prints the neighbour claim once', () => {
  const sessionId = 'qp-5304-append-stop';
  // 7002 shares Key File fixture-9001.js with candidate #9001 (not #9013), so no file is shared by three records (a hub).
  const pool = [IN_FLIGHT_7001, { ...IN_FLIGHT_7001, number: 7002, body: withBody(9001) }];
  const r = pull5(withGh(PIPE(), IN_FLIGHT_ARGV, { stdout: JSON.stringify(pool) }), {
    sessionId,
    allowThrow: true,
    deps: { createClaimReader: () => ({ read: (n) => {
      if (n === 7002) return { failure: 'git-fetch-failed' };
      if (n === 7001) { fs.writeFileSync(sessionPaths(sessionId)['dispatch-exclusions.json'], '{corrupt'); return { content: LIVE_CLAIM }; }
      return { content: null };
    } }) },
  });
  assert.ok(r.thrown instanceof QueuePullStopped && /neighbour-in-flight exclusion pass failed/.test(r.thrown.line), String(r.thrown));
  assert.deepEqual(r.errs.filter((e) => e.includes('claim read failed')), [
    'AUTO — dispatch: neighbour-in-flight claim read failed for #7002; treated as not in flight\n',
  ]);
});

test('#5227 neighbour: an unreadable claim prints the fence AUTO line and excludes nothing; a failed pool fetch writes [] and prints the pool AUTO line; a 200-record pool prints the cap Warning', () => {
  let readerBuilds = 0;
  const unreadable = pull5(PIPE(), { deps: { createClaimReader: () => { readerBuilds += 1; return { read: () => ({ failure: 'git-fetch-failed' }) }; } } });
  assert.equal(readerBuilds, 1, 'the shipped and neighbour passes share one claim reader per pull (#5304)');
  assert.deepEqual(entriesOf(unreadable, 'neighbour-in-flight'), []);
  assert.ok(unreadable.stderr.includes('AUTO — dispatch: claim read failed for #9010 (git-fetch-failed), #9016 (git-fetch-failed), #7001; shipped-candidate release time unknown, no downgrade; neighbour-in-flight treated as not in flight\n'), unreadable.stderr);
  assert.equal(unreadable.errs.filter((e) => e.includes('claim read failed')).length, 1, 'one combined line per pull (#5304)');
  assert.ok(FENCE.includes("'AUTO — dispatch: neighbour-in-flight claim read failed for ' + neighbour.join(', ') + '; treated as not in flight'"));

  const poolFail = pull5(withGh(PIPE(), IN_FLIGHT_ARGV, { status: 1, stdout: 'partial garbage' }));
  assert.equal(poolFail.text['dispatch-in-flight-raw.json'], '[]\n', "the fence's echo '[]' overwrites whatever the failed call printed");
  assert.deepEqual(entriesOf(poolFail, 'neighbour-in-flight'), []);
  assert.ok(poolFail.stderr.includes(`${IN_FLIGHT_POOL_AUTO}\n`), poolFail.stderr);
  assert.equal(poolFail.stderr.split(IN_FLIGHT_POOL_AUTO).length - 1, 1, 'printed exactly once');

  const pool = (n) => Array.from({ length: n }, (_, i) => ({ number: 7100 + i, title: `unrelated ${i}`, body: 'nothing', labels: [] }));
  const capped = pull5(withGh(PIPE(), IN_FLIGHT_ARGV, { stdout: JSON.stringify(pool(200)) }));
  assert.ok(capped.stderr.includes(`${IN_FLIGHT_CAP}\n`), 'exactly 200 prints the cap Warning');
  const under = pull5(withGh(PIPE(), IN_FLIGHT_ARGV, { stdout: JSON.stringify(pool(199)) }));
  assert.ok(!under.stderr.includes(IN_FLIGHT_CAP), '199 does not');
});

// The files transport's neighbour inputs: the agent-written pool and claim-map FILES.
function filesPull(o = {}) {
  const scenario = PIPE();
  const ghAnswerOf = (argv) => scenario.gh.find((e) => e.argv && e.argv.join() === argv.join()).stdout;
  return pull5(scenario, {
    transport: 'files',
    allowThrow: true,
    ...o,
    prepare: (own) => {
      const inputs = {
        queueRaw: writeInput(own, 'queue.json', ghAnswerOf(QUEUE_ARGV)),
        openNumbers: writeInput(own, 'open.json', ghAnswerOf(OPEN_NUMBERS_ARGV)),
        depFreshness: writeInput(own, 'dep.json', '[]'),
        verifiedOpenDeps: writeInput(own, 'verified.txt', ''),
        inFlightRaw: o.raw === null ? path.join(own, 'absent-raw.json') : writeInput(own, 'in-flight.json', o.raw === undefined ? JSON.stringify([IN_FLIGHT_7001]) : o.raw),
        inFlightClaims: o.claimsFile === null ? path.join(own, 'absent-claims.json') : writeInput(own, 'claims.json', o.claimsFile === undefined ? JSON.stringify({ 7001: LIVE_CLAIM }) : o.claimsFile),
      };
      return { inputs };
    },
  });
}
const neighbourGhCalls = (r) => r.ghCalls.filter((a) => a.join() === IN_FLIGHT_ARGV.join() || a[0] === 'repo');

test('#5227 files neighbour: claims come from the agent-written map through claimReaderFromMap; no gh pool fetch and no claim reader is built', () => {
  // The shipped pass builds its own reader for merged-PR mentions; the neighbour pass must never ask it for #7001.
  const reads = [];
  const r = filesPull({ deps: { createClaimReader: () => ({ read: (n) => { reads.push(n); return { content: null }; } }) } });
  assert.equal(r.thrown, null, String(r.thrown));
  assert.deepEqual(entriesOf(r, 'neighbour-in-flight').map((e) => e.records), [[9013]]);
  assert.deepEqual(neighbourGhCalls(r), []);
  assert.ok(!reads.includes(7001), `the map answers the claim: ${reads}`);

  // A claim the agent recorded as a not-found wrapper is a failed read, never a live claim.
  const wrapper = filesPull({ claimsFile: JSON.stringify({ 7001: { message: 'Not Found' } }) });
  assert.equal(wrapper.thrown, null);
  assert.deepEqual(entriesOf(wrapper, 'neighbour-in-flight'), []);
  assert.ok(wrapper.stderr.includes('AUTO — dispatch: neighbour-in-flight claim read failed for #7001; treated as not in flight\n'));

  // The agent-written empty values fail open: nothing is in flight, and no claim is read.
  const emptyPool = filesPull({ raw: '[]', claimsFile: '{}' });
  assert.equal(emptyPool.thrown, null);
  assert.deepEqual(entriesOf(emptyPool, 'neighbour-in-flight'), []);
  assert.ok(!emptyPool.stderr.includes('claim read failed'));
  const emptyClaims = filesPull({ claimsFile: '{}' });
  assert.deepEqual(entriesOf(emptyClaims, 'neighbour-in-flight'), [], 'a number left out of the map is a failed read');
  assert.ok(emptyClaims.stderr.includes('claim read failed for #7001'));
});

test('#5227 files neighbour: a missing or malformed pool file or claim-map file stops the pull with the neighbour stop line (R8)', () => {
  const cases = [
    ['missing claims file', { claimsFile: null }],
    ['malformed claims file', { claimsFile: '{not json' }],
    ['missing pool file', { raw: null }],
    ['malformed pool file', { raw: 'not json at all' }],
  ];
  for (const [name, o] of cases) {
    const r = filesPull(o);
    assert.ok(r.thrown instanceof QueuePullStopped, `${name}: ${r.thrown}`);
    assert.equal(r.thrown.line, `${NEIGHBOUR_STOP}1); see error above.`, name);
    assert.match(r.stderr, /queue-pull: neighbour-in-flight: /, name);
    assert.ok(!r.cap.order.includes('cross-pr-overlap'), `${name}: no later pass runs`);
  }
});

test('#5227 files neighbour: with neighbour-in-flight omitted, a missing claim-map or pool file does not stop the pull (only the omitted compute reads them)', () => {
  for (const [name, o] of [['missing claims file', { claimsFile: null }], ['missing pool file', { raw: null }]]) {
    const r = filesPull({ ...o, omit: ['neighbour-in-flight'] });
    assert.equal(r.thrown, null, `${name}: ${r.thrown}`);
    assert.ok(r.cap.order.includes('neighbour-in-flight') && r.cap.order.includes('cross-pr-overlap'), `${name}: the runner is called and the later passes run`);
    assert.ok(!/queue-pull: neighbour-in-flight: /.test(r.stderr), `${name}: no step error`);
    assert.deepEqual(entriesOf(r, 'neighbour-in-flight'), [], name);
    // The same input without the omit stops the pull (control; the R8 test above).
    assert.ok(filesPull(o).thrown instanceof QueuePullStopped, `${name}: not omitted, it stops`);
  }
});

test('#5227 D4: a non-JSON string in the claim map is read as unreadable content, so it excludes nothing and prints no AUTO line', () => {
  const r = filesPull({ claimsFile: JSON.stringify({ 7001: 'this is not json' }) });
  assert.equal(r.thrown, null, String(r.thrown));
  assert.deepEqual(entriesOf(r, 'neighbour-in-flight'), []);
  assert.ok(!r.stderr.includes('neighbour-in-flight'), `no neighbour line of any kind: ${r.stderr}`);
});

test('#5227 cross-PR: gh pr list feeds detectCrossPRFileOverlap; a failure writes [] and prints one Warning naming the fetch (#5312); files writes [] with no gh call; 100 PRs print the cap Warning', () => {
  const r = pull5(PIPE());
  assert.equal(r.ghCalls.filter((a) => a.join() === OPEN_PRS_ARGV.join()).length, 1);
  const overlap = r.json('dispatch-crosspr-overlap.json');
  assert.equal(overlap.length, 1, JSON.stringify(overlap));
  assert.ok(JSON.stringify(overlap).includes('9001') && JSON.stringify(overlap).includes('41'), JSON.stringify(overlap));
  assert.ok(groupNumbers(r).flat().includes(9001), 'informational: nothing leaves the groups');
  assert.ok(!r.stderr.includes(OPEN_PR_FAIL), 'a successful list prints no failure Warning');

  // A PR that already closes the candidate is a re-dispatch guard, not an overlap.
  const closing = pull5(withGh(PIPE(), OPEN_PRS_ARGV, { stdout: JSON.stringify([{ ...OPEN_PR_41, closingIssuesReferences: [{ number: 9001 }] }]) }));
  assert.deepEqual(closing.json('dispatch-crosspr-overlap.json'), []);

  const failed = pull5(withGh(PIPE(), OPEN_PRS_ARGV, { status: 1, stdout: 'partial' }));
  assert.deepEqual(failed.json('dispatch-crosspr-overlap.json'), []);
  assert.equal(failed.text['dispatch-open-prs.json'], '[]\n');
  // AC1 (#5312): the failed list prints one line naming the fetch, and no step diagnostic beside it.
  assert.deepEqual(failed.stderr.split('\n').filter((l) => l.startsWith('Warning:')), [OPEN_PR_FAIL]);
  assert.ok(!/queue-pull:/.test(failed.stderr), `no step diagnostic: ${failed.stderr}`);
  assert.equal(fenceText(/echo "(Warning: open-PR pull failed[^"]*)" >&2/), OPEN_PR_FAIL, 'the fence prints the same Warning');

  const files = filesPull();
  assert.equal(files.thrown, null, String(files.thrown));
  assert.equal(files.text['dispatch-crosspr-overlap.json'], '[]');
  assert.equal(files.ghCalls.filter((a) => a[0] === 'pr' && a[1] === 'list').length, 0);
  assert.equal(files.text['dispatch-open-prs.json'], undefined, 'the open-PR file is not written on files');
  assert.ok(!files.stderr.includes(OPEN_PR_FAIL), 'files makes no fetch, so it prints no failure Warning');

  const prs = (n) => Array.from({ length: n }, (_, i) => ({ number: 600 + i, files: [], closingIssuesReferences: [] }));
  assert.ok(pull5(withGh(PIPE(), OPEN_PRS_ARGV, { stdout: JSON.stringify(prs(100)) })).stderr.includes(`${OPEN_PR_CAP}\n`));
  assert.ok(!pull5(withGh(PIPE(), OPEN_PRS_ARGV, { stdout: JSON.stringify(prs(99)) })).stderr.includes(OPEN_PR_CAP));
});

test('#5227 neighbour and cross-PR: both gh fetches run with stderr ignored (2>/dev/null) and carry options.cwd', () => {
  const seen = [];
  const base = fakeRun(PIPE());
  pull5(PIPE(), { run: (cmd, args, opts) => { seen.push({ args: args.join(' '), stdio: opts.stdio, cwd: opts.cwd }); return base(cmd, args, opts); } });
  for (const argv of [IN_FLIGHT_ARGV, OPEN_PRS_ARGV]) {
    const call = seen.find((c) => c.args === argv.join(' '));
    assert.deepEqual(call.stdio, ['pipe', 'pipe', 'ignore'], argv.join(' '));
    assert.ok(call.cwd, 'the context cwd reaches the runner');
  }
});

test('#5227 near-dup: every cross-group pair prints its AUTO line, and only strong pairs are written to dispatch-near-dup-pairs.json', () => {
  const r = pull5(PIPE());
  const pairs = r.json('dispatch-near-dup-pairs.json');
  assert.deepEqual(pairs.map((p) => p.records), [[9014, 9015]]);
  assert.deepEqual(Object.keys(pairs[0]), ['records', 'signals', 'sharedAnchors'], 'the strong flag is not persisted');
  assert.deepEqual(pairs[0].sharedAnchors, ['WidgetScheduler.flush', 'schedulerCache.evict']);
  const line = `AUTO — dispatch: near-duplicate candidates across groups: #9014 / #9015 (${pairs[0].signals.join(', ')})\n`;
  assert.ok(r.stderr.includes(line), r.stderr);
  assert.ok(pairs[0].signals.includes('body-anchor-overlap'));
  const autoLines = r.stderr.split('\n').filter((l) => l.startsWith('AUTO — dispatch: near-duplicate candidates'));
  assert.ok(autoLines.length > pairs.length, `weak title-only pairs print too but are not written: ${autoLines.length} lines, ${pairs.length} written`);
  assert.ok(autoLines.some((l) => l.endsWith('(title-similarity)')), 'a weak pair is among the printed lines');

  // With no pair at all the file is still written, as [] (an earlier pull's pairs are never read).
  const none = pull5(S1());
  assert.equal(none.text['dispatch-near-dup-pairs.json'], '[]');
});

// ---- the omit sweep (AC2.1 / AC11): every non-setup registry entry goes red when omitted ----

const SWEPT = PASSES.filter((p) => p.kind !== 'setup');
const informationalFile = { 'cross-pr-overlap': 'dispatch-crosspr-overlap.json', 'near-dup-pairs': 'dispatch-near-dup-pairs.json' };

test('AC2.1: every registry entry that writes a reason, and each informational pass, goes red when omitted', () => {
  assert.equal(SWEPT.length, 12, 'the sweep covers 12 entries: 10 reasons and 2 informational passes');
  for (const p of SWEPT) {
    const name = p.reason || p.id;
    const scenario = () => (p.id === 'oversized' ? SFast() : PIPE());
    const lane = p.id === 'driver-lane' ? { deps: { readDriverRunner: () => 'script', expressQueuePolicy: routablePolicy([], { driverRoutable: () => true }) }, spawn: { 'resolve-record-comments.js': cannedComments({}) } } : {};
    const full = pull5(scenario(), lane);
    const omitted = pull5(scenario(), { ...lane, omit: [name] });
    assert.ok(omitted.cap.order.includes(p.id), `${name}: the runner is called under omit`);
    if (p.kind === 'exclusion') {
      assert.ok(entriesOf(full, p.reason).length > 0, `${name}: the full run writes a ${p.reason} entry (a real positive control)`);
      assert.deepEqual(entriesOf(omitted, p.reason), [], `${name}: the omitted run writes none`);
    } else {
      const file = informationalFile[p.id];
      assert.ok(JSON.parse(full.text[file]).length > 0, `${name}: the full run writes non-empty ${file}`);
      assert.notEqual(omitted.text[file], full.text[file], `${name}: omission changes ${file}`);
      assert.deepEqual(omitted.json('dispatch-exclusions.json'), full.json('dispatch-exclusions.json'), `${name}: an informational pass removes nothing`);
    }
  }
});

// ---- the default deps: which bound each call gets, and a spawn failure's cause (defaultDeps seams) ----

const PRIMITIVES = require('../../../plugin/bin/lib/shared-primitives');

test('#5227 gh timeout: the paginated list calls a whole pull makes get GH_BATCH_TIMEOUT_MS; a single-record view gets GH_TIMEOUT_MS and git GIT_TIMEOUT_MS', () => inOwnTmp((own) => {
  assert.notEqual(PRIMITIVES.GH_BATCH_TIMEOUT_MS, PRIMITIVES.GH_TIMEOUT_MS, 'the two bounds differ, so the assertions below discriminate');
  const seen = [];
  const answer = fakeRun(S0());
  const { run } = defaultDeps({ execFileSync: (cmd, args, opts) => { seen.push({ cmd, args, timeout: opts.timeout }); return answer(cmd, args, opts); } });
  queuePull({ sessionId: 'qp-timeout', cwd: own, env: { GH_HOST: 'github.com' } }, {
    run,
    spawnCli: fakeSpawnCli(S0(), {
      'hooks.js': { status: 0, stdout: '', stderr: '' },
      'dispatch-unlanded-blockers.js': (args) => ({ status: 0, stdout: fs.readFileSync(args[args.indexOf('--groups') + 1], 'utf8'), stderr: '' }),
    }),
    queueOrder: { readOrder: () => null, writeOrder: () => ({ ok: true }) },
    expressQueuePolicy: EXPRESS_OFF,
    createClaimReader: () => ({ read: () => ({ content: null }) }),
    stderr: () => {},
  });
  const timeoutOf = (argv) => {
    const hit = seen.find((c) => c.cmd === 'gh' && c.args.join('\u0000') === argv.join('\u0000'));
    assert.ok(hit, `the pull made ${argv.join(' ')}`);
    return hit.timeout;
  };
  for (const argv of [QUEUE_ARGV, OPEN_NUMBERS_ARGV, IN_FLIGHT_ARGV, OPEN_PRS_ARGV]) {
    assert.equal(timeoutOf(argv), PRIMITIVES.GH_BATCH_TIMEOUT_MS, argv.join(' '));
  }
  const ghSeen = seen.filter((c) => c.cmd === 'gh');
  assert.equal(ghSeen.length, 4, `S0 makes exactly those four gh calls: ${ghSeen.map((c) => c.args.join(' '))}`);
  for (const c of seen.filter((s) => s.cmd === 'git')) assert.equal(c.timeout, PRIMITIVES.GIT_TIMEOUT_MS, c.args.join(' '));

  // The single-call argv the pull makes per record, and the dependency-freshness search (--limit 500).
  const direct = defaultDeps({ execFileSync: (cmd, args, opts) => { seen.push({ cmd, args, timeout: opts.timeout }); return ''; } }).run;
  const ghEnv = { env: { GH_HOST: 'github.com' } };
  for (const argv of [PR_VIEW(5010), ['issue', 'view', '8000', '--json', 'state', '-q', '.state']]) {
    direct('gh', argv, ghEnv);
    assert.equal(timeoutOf(argv), PRIMITIVES.GH_TIMEOUT_MS, argv.join(' '));
  }
  direct('gh', DEP_SEARCH_8000, ghEnv);
  assert.equal(timeoutOf(DEP_SEARCH_8000), PRIMITIVES.GH_BATCH_TIMEOUT_MS, 'the dependency-freshness search is a --limit 500 list call');
  // A list at gh's own --limit ceiling of 100 that asks for no files stays a single-call bound.
  const small = ['issue', 'list', '--state', 'open', '--json', 'number', '--limit', '100'];
  direct('gh', small, ghEnv);
  assert.equal(timeoutOf(small), PRIMITIVES.GH_TIMEOUT_MS);
}));

test('#5227 spawnCli: the default spawn is bounded above every spawned CLI\'s own bound, and a spawn error or a signal reaches the returned stderr', () => {
  const opts = [];
  const results = [
    { error: new Error('spawn ENOBUFS'), status: null, stdout: '', stderr: '' },
    { status: null, signal: 'SIGKILL', stdout: '', stderr: 'partial\n' },
    { status: 1, stdout: '', stderr: 'resolve-linked-prs: gh failed\n' },
  ];
  const { spawnCli } = defaultDeps({ spawnSync: (file, argv, o) => { opts.push(o); return results.shift(); } });
  const errored = spawnCli('resolve-linked-prs.js', ['9001']);
  assert.equal(errored.status, null);
  assert.equal(errored.stderr, 'spawn ENOBUFS\n');
  const killed = spawnCli('resolve-linked-prs.js', ['9001']);
  assert.equal(killed.stderr, 'partial\nsignal SIGKILL\n');
  const failed = spawnCli('resolve-linked-prs.js', ['9001']);
  assert.equal(failed.stderr, 'resolve-linked-prs: gh failed\n', 'a plain non-zero exit keeps the CLI stderr as it was');
  // dispatch-unlanded-blockers.js bounds its preflight-records.js child at its exported
  // PREFLIGHT_TIMEOUT_MS; the outer bound must stay strictly above it whichever side changes.
  const { PREFLIGHT_TIMEOUT_MS } = require('../../../plugin/bin/dispatch-unlanded-blockers');
  assert.ok(Number.isFinite(PREFLIGHT_TIMEOUT_MS) && PREFLIGHT_TIMEOUT_MS > 0, `PREFLIGHT_TIMEOUT_MS ${PREFLIGHT_TIMEOUT_MS}`);
  for (const o of opts) assert.ok(Number.isFinite(o.timeout) && o.timeout > PREFLIGHT_TIMEOUT_MS, `timeout ${o.timeout} vs PREFLIGHT_TIMEOUT_MS ${PREFLIGHT_TIMEOUT_MS}`);
  assert.equal(opts[0].windowsHide, true);

  // The cause reaches the fence's Warning text instead of an empty tail.
  const viaDefault = () => defaultDeps({ spawnSync: () => ({ error: new Error('spawn ENOBUFS'), status: null, stdout: '', stderr: '' }) })
    .spawnCli('resolve-linked-prs.js', ['9001']);
  const r = pull4(FULL(), { spawn: { 'resolve-linked-prs.js': viaDefault } });
  assert.ok(r.errs.includes(`${LINKED_WARNING}spawn ENOBUFS\n`), r.stderr);
});

// ---- Task 6: rankNext / rankFromFiles (AC6) ---------------------------------------------------
// One table, three consumers: rankNext in-process, next-ranking.md's fence under the bash oracle
// (same sandbox + escape guard as the queue-pull fence), and rankFromFiles' written file. Every
// `expected` is a literal group, never computed by rankNext (Q4).
const NEXT_RANKING_MD = path.join(REPO, 'plugin', 'skills', 'dispatch', 'next-ranking.md');
const RANKING_FENCE_FIRST_LINE = 'DISPATCH_GROUPS="$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" --value dispatch-groups.json)"';
const rec = (number, priority, createdAt) => ({ number, createdAt, facets: { priority } });
const A = (n, p, d) => [rec(n, p, `2026-0${d}-01T00:00:00Z`)];
const ex = (reason, ...records) => ({ reason, records, detail: 'fixture' });

const HIGH_NEW = A(1, 'high', 5);
const HIGH_OLD = A(2, 'high', 2);
const MED = A(3, 'medium', 1);
const LOW = A(4, 'low', 1);
const NONE = A(5, null, 1);
const MIXED = [rec(6, 'low', '2026-01-01T00:00:00Z'), rec(7, 'high', '2026-06-01T00:00:00Z'), rec(8, null, '2026-01-01T00:00:00Z')];
const SAME_A = A(11, 'medium', 3);
const SAME_B = A(12, 'medium', 3);

const RANK_CASES = [
  { name: 'empty pool', groups: [], exclusions: [], priority: '', expected: null },
  { name: 'band high beats medium, low and unprioritized', groups: [NONE, LOW, MED, HIGH_NEW], exclusions: [], priority: '', expected: HIGH_NEW },
  { name: 'band medium beats low and unprioritized', groups: [NONE, LOW, MED], exclusions: [], priority: '', expected: MED },
  { name: 'band low beats unprioritized', groups: [NONE, LOW], exclusions: [], priority: '', expected: LOW },
  { name: 'an unprioritized group alone is picked', groups: [NONE], exclusions: [], priority: '', expected: NONE },
  { name: 'a tie within a band goes to the older record', groups: [HIGH_NEW, HIGH_OLD], exclusions: [], priority: '', expected: HIGH_OLD },
  { name: "a group's best member is not its first: [low, high, unprioritized] ranks as high", groups: [MED, MIXED], exclusions: [], priority: '', expected: MIXED },
  { name: 'oversized excludes the best group', groups: [HIGH_OLD, MED], exclusions: [ex('oversized', 2)], priority: '', expected: MED },
  { name: 'firing excludes the best group', groups: [HIGH_OLD, MED], exclusions: [ex('firing', 2)], priority: '', expected: MED },
  { name: 'neighbour-in-flight excludes the best group', groups: [HIGH_OLD, MED], exclusions: [ex('neighbour-in-flight', 2)], priority: '', expected: MED },
  { name: 'one excluded member excludes its whole group', groups: [MIXED, LOW], exclusions: [ex('firing', 8)], priority: '', expected: LOW },
  { name: 'a reason outside the three does not exclude', groups: [HIGH_OLD, MED], exclusions: [ex('blocked', 2)], priority: '', expected: HIGH_OLD },
  { name: 'every group excluded gives null', groups: [HIGH_OLD, MED], exclusions: [ex('oversized', 2), ex('firing', 3)], priority: '', expected: null },
  { name: '--priority picks the matching band even when a higher one exists', groups: [HIGH_OLD, MED, LOW], exclusions: [], priority: 'medium', expected: MED },
  { name: '--priority filters on the representative: [low, high] with --priority low gives null', groups: [MIXED], exclusions: [], priority: 'low', expected: null },
  { name: '--priority that matches nothing gives null', groups: [HIGH_OLD, MED], exclusions: [], priority: 'low', expected: null },
  { name: "within a band the representative is the group's oldest member", groups: [A(22, 'high', 3), [rec(20, 'high', '2026-05-01T00:00:00Z'), rec(21, 'high', '2026-01-01T00:00:00Z')]], exclusions: [], priority: '', expected: [rec(20, 'high', '2026-05-01T00:00:00Z'), rec(21, 'high', '2026-01-01T00:00:00Z')] },
  { name: 'equal createdAt between two groups keeps the pool order (stable sort)', groups: [SAME_A, SAME_B], exclusions: [], priority: '', expected: SAME_A },
  { name: 'equal createdAt, reversed pool, keeps the reversed order', groups: [SAME_B, SAME_A], exclusions: [], priority: '', expected: SAME_B },
];

const quoteSh = (p) => `'${p.replace(/'/g, "'\\''")}'`;
function writeCaseFiles(dir, c) {
  const groups = path.join(dir, 'groups.json');
  if (c.groups !== null) fs.writeFileSync(groups, typeof c.groups === 'string' ? c.groups : JSON.stringify(c.groups));
  const exclusions = path.join(dir, 'exclusions.json');
  const hasExclusions = c.exclusions !== undefined && c.exclusions !== null;
  if (hasExclusions) fs.writeFileSync(exclusions, typeof c.exclusions === 'string' ? c.exclusions : JSON.stringify(c.exclusions));
  return { groups: c.groups === null ? null : groups, exclusions: hasExclusions ? exclusions : null };
}

// Seeds the module's session dir for sessionId and returns its paths; the caller removes it.
function seedModuleSession(sessionId, files) {
  const paths = sessionPaths(sessionId);
  if (files.groups) fs.copyFileSync(files.groups, paths['dispatch-groups.json']);
  if (files.exclusions) fs.copyFileSync(files.exclusions, paths['dispatch-exclusions.json']);
  return paths;
}
const dropSession = (sessionId) => fs.rmSync(path.dirname(sessionPaths(sessionId)['dispatch-groups.json']), { recursive: true, force: true });

// Runs next-ranking.md's bash fence whole under the oracle sandbox (the same escape guard as the
// queue-pull fence). The preamble seeds the oracle's session files from the case files by copy, so
// the fence reads exactly the bytes rankFromFiles reads; PRIORITY_FILTER is the script's own input.
let rankingFence;
async function runRankingFence(c) {
  rankingFence = rankingFence || extractFence(readText(NEXT_RANKING_MD), RANKING_FENCE_FIRST_LINE);
  const sb = createSandbox(S0(), { name: 'rank' });
  try {
    const files = writeCaseFiles(sb.root, c);
    const resolve = (name) => `"$(node "\${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" --value ${name})"`;
    const preamble = [
      `SEED_G=${resolve('dispatch-groups.json')}`,
      ...(files.groups ? [`cp ${quoteSh(files.groups)} "$SEED_G"`] : []),
      ...(c.stalePick ? [`SEED_P=${resolve('dispatch-next-pick.json')}`, `printf %s ${quoteSh(c.stalePick)} > "$SEED_P"`] : []),
      ...(files.exclusions ? [`SEED_E=${resolve('dispatch-exclusions.json')}`, `cp ${quoteSh(files.exclusions)} "$SEED_E"`] : []),
      `PRIORITY_FILTER=${quoteSh(c.priority || '')}`,
      '',
    ].join('\n');
    const r = await runOracle(sb, preamble + rankingFence);
    if (!c.expectFail) assert.equal(r.status, 0, r.stderr);
    return { pickText: r.files['dispatch-next-pick.json'], status: r.status };
  } finally {
    sb.cleanup();
  }
}

let rankSession = 0;
for (const c of RANK_CASES) {
  test(`AC6.1: rankNext matches next-ranking.md — ${c.name}`, () => {
    assert.deepEqual(rankNext(c.groups, c.exclusions, { priority: c.priority }), c.expected);
  });
  test(`AC6.1 oracle: next-ranking.md's fence picks the same, and rankFromFiles writes its exact bytes — ${c.name}`, { skip: oracleSkip() }, async () => {
    const oracle = await runRankingFence(c);
    assert.deepEqual(JSON.parse(oracle.pickText), c.expected);
    assert.equal(oracle.pickText, JSON.stringify(c.expected) + '\n');
    const sessionId = `qp-rank-${process.pid}-${rankSession += 1}`;
    const dir = scratchDir('qp-rank-case-');
    try {
      const paths = seedModuleSession(sessionId, writeCaseFiles(dir, c));
      const pick = rankFromFiles({ sessionId, priority: c.priority });
      assert.deepEqual(pick, c.expected);
      assert.equal(fs.readFileSync(paths['dispatch-next-pick.json'], 'utf8'), oracle.pickText, 'the module file is byte-identical to the fence output');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
      dropSession(sessionId);
    }
  });
}

test('#5227 registry: rankNext skips exactly the non-removing exclusion reasons plus firing', () => {
  const staying = [...new Set(PASSES.filter((p) => p.kind === 'exclusion' && !p.removes).map((p) => p.reason))];
  const removing = [...new Set(PASSES.filter((p) => p.kind === 'exclusion' && p.removes).map((p) => p.reason))];
  assert.ok(staying.length > 0 && removing.length > 0);
  // Exact, both ways: the one list rankNext reads holds the staying reasons plus firing and nothing else.
  assert.ok(Object.isFrozen(STAYING_EXCLUSION_REASONS) && Object.isFrozen(RANK_SKIP_REASONS));
  assert.deepEqual([...STAYING_EXCLUSION_REASONS].sort(), [...staying].sort());
  assert.deepEqual([...RANK_SKIP_REASONS].sort(), [...staying, 'firing'].sort());
  const group = [rec(40, 'high', '2026-01-01T00:00:00Z')];
  for (const reason of [...staying, 'firing']) {
    assert.equal(rankNext([group], [{ reason, records: [40] }], {}), null, `${reason}: the group is skipped`);
  }
  // A removing reason's records are already gone from the groups, so ranking never consults it.
  for (const reason of removing) {
    assert.deepEqual(rankNext([group], [{ reason, records: [40] }], {}), group, `${reason}: not a ranking exclusion`);
  }
});

test('AC6.2: equal createdAt ranks in the script sort order, and a snake_case pool aliased with aliasMcpTimestamps ranks as its camelCase twin', () => {
  // Stable sort: the first pooled group wins a createdAt tie; the literal is the oracle row above.
  assert.equal(rankNext([SAME_A, SAME_B], [], {})[0].number, 11);
  assert.equal(rankNext([SAME_B, SAME_A], [], {})[0].number, 12);
  const snake = (g) => g.map(({ createdAt, ...rest }) => ({ ...rest, created_at: createdAt }));
  const camelPool = [HIGH_NEW, HIGH_OLD];
  const snakePool = camelPool.map(snake);
  // Without aliasing the snake_case pool has no createdAt, so every comparison is NaN and the pool
  // order wins -- the go-red control proving the alias below is what makes it rank by age.
  assert.equal(rankNext(snakePool, [], {})[0].number, 1);
  const aliased = snakePool.map((g) => aliasMcpTimestamps(g));
  assert.equal(rankNext(aliased, [], {})[0].number, 2);
  assert.deepEqual(rankNext(aliased, [], {}).map((r) => r.number), rankNext(camelPool, [], {}).map((r) => r.number));
  // Multi-member groups: the within-group representative also needs the alias. The oldest-member
  // group (#20 new, #21 old) beats #22 only when the representative is found by age.
  const oldest = [rec(20, 'high', '2026-05-01T00:00:00Z'), rec(21, 'high', '2026-01-01T00:00:00Z')];
  const multiCamel = [A(22, 'high', 3), oldest];
  const multiSnake = multiCamel.map(snake);
  assert.deepEqual(rankNext(multiCamel, [], {}).map((r) => r.number), [20, 21]);
  assert.deepEqual(rankNext(multiSnake, [], {}).map((r) => r.number), [22], 'unaliased: no createdAt, pool order wins');
  assert.deepEqual(rankNext(multiSnake.map((g) => aliasMcpTimestamps(g)), [], {}).map((r) => r.number), [20, 21]);
  // MIXED ([low, high, unprioritized]) against a newer high group: it wins only when it ranks as
  // high AND its high member's age is read, so the band alone cannot decide it. The unaliased pool
  // (no createdAt, so pool order) is the control that a dropped alias would turn this into.
  const mixedPool = [A(23, 'high', 7), MIXED];
  assert.deepEqual(rankNext(mixedPool, [], {}).map((r) => r.number), [6, 7, 8], 'camelCase: MIXED (high, 2026-06) beats #23 (high, 2026-07)');
  const mixedSnake = mixedPool.map(snake);
  assert.deepEqual(rankNext(mixedSnake, [], {}).map((r) => r.number), [23], 'unaliased: no createdAt, pool order wins');
  const mixedAliased = mixedSnake.map((g) => aliasMcpTimestamps(g));
  assert.deepEqual(rankNext(mixedAliased, [], {}).map((r) => r.number), [6, 7, 8], 'MIXED ranks as high, by age, through the round trip');
  assert.deepEqual(rankNext(mixedAliased, [], { priority: 'high' }).map((r) => r.number), [6, 7, 8]);
});

function withSession(fn) {
  const sessionId = `qp-rank-${process.pid}-${rankSession += 1}`;
  const paths = sessionPaths(sessionId);
  try {
    return fn(paths, sessionId);
  } finally {
    dropSession(sessionId);
  }
}

test('AC6.3: rankFromFiles reads an absent and a corrupt dispatch-exclusions.json as no exclusions, and a present one as exclusions', () => withSession((paths, sessionId) => {
  fs.writeFileSync(paths['dispatch-groups.json'], JSON.stringify([HIGH_OLD, MED]));
  const picked = () => fs.readFileSync(paths['dispatch-next-pick.json'], 'utf8');
  assert.deepEqual(rankFromFiles({ sessionId }), HIGH_OLD, 'absent file');
  assert.equal(picked(), JSON.stringify(HIGH_OLD) + '\n');
  const err = mock.method(console, 'error', () => {});
  try {
    for (const corrupt of ['{not json', '{"reason":"firing"}']) {
      fs.writeFileSync(paths['dispatch-exclusions.json'], corrupt);
      assert.deepEqual(rankFromFiles({ sessionId }), HIGH_OLD, `corrupt file ${corrupt}`);
    }
    assert.equal(err.mock.callCount(), 2, 'readExclusions reports each unreadable file on stderr and carries on');
  } finally {
    err.mock.restore();
  }
  fs.writeFileSync(paths['dispatch-exclusions.json'], JSON.stringify([ex('firing', 2)]));
  assert.deepEqual(rankFromFiles({ sessionId }), MED, 'a present firing entry is honoured (control)');
  assert.equal(picked(), JSON.stringify(MED) + '\n');
}));

test('AC6.3: rankFromFiles writes null when nothing is eligible, honours --priority, and throws on a missing or malformed groups file, leaving the pick file empty', () => withSession((paths, sessionId) => {
  // The script redirects node's stdout into the pick file, so a throw leaves it EMPTY, not stale.
  fs.writeFileSync(paths['dispatch-next-pick.json'], 'STALE\n');
  assert.throws(() => rankFromFiles({ sessionId }), /ENOENT/);
  assert.equal(fs.readFileSync(paths['dispatch-next-pick.json'], 'utf8'), '', 'missing groups: stale pick truncated');
  fs.writeFileSync(paths['dispatch-groups.json'], JSON.stringify([HIGH_OLD, MED]));
  assert.equal(rankFromFiles({ sessionId, priority: 'low' }), null);
  assert.equal(fs.readFileSync(paths['dispatch-next-pick.json'], 'utf8'), 'null\n');
  assert.deepEqual(rankFromFiles({ sessionId, priority: 'medium' }), MED);
  assert.equal(fs.readFileSync(paths['dispatch-next-pick.json'], 'utf8'), JSON.stringify(MED) + '\n', 'a stale pick exists before the malformed run');
  fs.writeFileSync(paths['dispatch-groups.json'], '{broken');
  assert.throws(() => rankFromFiles({ sessionId }), SyntaxError);
  assert.equal(fs.readFileSync(paths['dispatch-next-pick.json'], 'utf8'), '', 'malformed groups: stale pick truncated');
}));

test('AC6.3 oracle: the fence reads an absent and a corrupt dispatch-exclusions.json as no exclusions too', { skip: oracleSkip() }, async () => {
  for (const exclusions of [undefined, '{not json']) {
    const oracle = await runRankingFence({ groups: [HIGH_OLD, MED], exclusions, priority: '' });
    assert.deepEqual(JSON.parse(oracle.pickText), HIGH_OLD);
  }
});

test('AC6.3 oracle: a missing or malformed dispatch-groups.json fails the fence and leaves an empty pick over a stale one, byte for byte with rankFromFiles', { skip: oracleSkip() }, async () => {
  for (const groups of [null, '{broken']) {
    const oracle = await runRankingFence({ groups, exclusions: [], priority: '', stalePick: 'STALE\n', expectFail: true });
    assert.notEqual(oracle.status, 0, 'the fence exits non-zero');
    assert.equal(oracle.pickText, '', 'the redirect truncated the stale pick');
    const sessionId = `qp-rank-${process.pid}-${rankSession += 1}`;
    const dir = scratchDir('qp-rank-case-');
    try {
      const paths = seedModuleSession(sessionId, writeCaseFiles(dir, { groups, exclusions: [] }));
      fs.writeFileSync(paths['dispatch-next-pick.json'], 'STALE\n');
      assert.throws(() => rankFromFiles({ sessionId, priority: '' }), groups === null ? (err) => err.code === 'ENOENT' : SyntaxError);
      assert.equal(fs.readFileSync(paths['dispatch-next-pick.json'], 'utf8'), oracle.pickText);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
      dropSession(sessionId);
    }
  }
});

// ---- Task 7: the CLI (AC9, AC7.3/7.4, AC4.6, --rank, AC10) -------------------------------------
const CLI_PATH = path.join(REPO, 'plugin', 'bin', 'queue-pull.js');
const cli = require('../../../plugin/bin/queue-pull');
const { STUB_SKIP } = require('../../helpers/path-stub');

// run() over captured streams. A deps member that is not given stays real, so a test passes
// everything the invocation under test may touch.
function cliRun(argv, deps = {}) {
  const out = []; const err = [];
  const code = cli.run(argv, { stdout: (s) => out.push(s), stderr: (s) => err.push(s), ...deps });
  return { code, stdout: out.join(''), stderr: err.join('') };
}
// deps whose every dependency member throws when read: proves a path touched nothing.
function touchNothing(out, err) {
  const boom = (name) => { throw new Error(`deps.${name} was touched`); };
  return {
    stdout: (s) => out.push(s),
    stderr: (s) => err.push(s),
    get ghAvailable() { return boom('ghAvailable'); },
    get queuePull() { return boom('queuePull'); },
    get rankFromFiles() { return boom('rankFromFiles'); },
    get env() { return boom('env'); },
    get cwd() { return boom('cwd'); },
  };
}

test('AC9.1: --help and -h exit 0 and print USAGE before any probe, and win over every other flag', () => {
  for (const argv of [['--help'], ['-h'], ['--transport', 'gh', '--help'], ['--rank', '-h'], ['--bogus', '--help']]) {
    const out = []; const err = [];
    const code = cli.run(argv, touchNothing(out, err));
    assert.equal(code, 0, argv.join(' '));
    assert.equal(out.join(''), cli.USAGE);
    assert.deepEqual(err, []);
  }
});

test('AC9.2: a malformed invocation exits 1, prints USAGE on stderr, and touches no dependency', () => {
  const cases = [
    ['--bogus'], ['stray'], ['--transport'], ['--transport', ''], ['--transport', '   '], ['--transport', 'sideways'],
    ['--transport', '--rank'], ['--rank', '--priority'], ['--rank', '--priority', ''], ['--rank', '--priority', 'urgent'],
    ['--transport', 'gh', '--queue-raw', 'x'], ['--transport', 'files', '--queue-raw'], ['--transport', 'files', '--queue-raw', '-x'],
    ['--transport', 'files', '--foreign-states', ''], ['--rank', '--transport', 'files'], ['--rank', '--queue-raw', 'x'],
    ['--transport', 'files', '--priority', 'high'], [],
    ['--transport', 'gh', '--transport', 'files'], ['--transport', 'files', '--transport', 'files'],
    ['--rank', '--priority', 'high', '--priority', 'low'],
    ['--transport', 'files', '--queue-raw', 'a.json', '--queue-raw', 'b.json'],
  ];
  for (const argv of cases) {
    const out = []; const err = [];
    const code = cli.run(argv, touchNothing(out, err));
    assert.equal(code, 1, JSON.stringify(argv));
    assert.ok(err.join('').endsWith(cli.USAGE), `usage printed for ${JSON.stringify(argv)}`);
    assert.deepEqual(out, []);
  }
});

test('#5227 CLI: the priority vocabulary renders as high|medium|low in USAGE and "high, medium or low" in the --priority error', () => {
  assert.match(cli.USAGE, /^ {2}queue-pull\.js --rank \[--priority high\|medium\|low\]$/m);
  assert.deepEqual(cli.parseArgs(['--rank', '--priority', 'urgent']), { error: '--priority must be high, medium or low, got: urgent' });
});

test('AC9.2: a well-formed invocation is not mistaken for a malformed one (control)', () => {
  assert.deepEqual(cli.parseArgs(['--transport', 'files', '--queue-raw', 'q.json', '--foreign-states', 'f.json']),
    { mode: 'pull', transport: 'files', priority: null, inputs: { queueRaw: 'q.json', foreignStates: 'f.json' } });
  assert.deepEqual(cli.parseArgs(['--rank', '--priority', 'low']), { mode: 'rank', transport: null, priority: 'low', inputs: {} });
  assert.deepEqual(cli.parseArgs(['--transport', 'gh']), { mode: 'pull', transport: 'gh', priority: null, inputs: {} });
  assert.ok(cli.parseArgs(['constructor']).error, 'an inherited key is not a flag');
});

test('AC9.3: the header comment and USAGE each state exit codes 0, 1, 2, 3 and 4', () => {
  const source = readText(CLI_PATH);
  const header = source.split('\n').filter((l) => l.startsWith('//')).join('\n');
  for (const n of [0, 1, 2, 3, 4]) {
    assert.match(header, new RegExp(`^//\\s+${n}\\s{2}\\S`, 'm'), `header states exit ${n}`);
    assert.match(cli.USAGE, new RegExp(`^\\s+${n}\\s{2}\\S`, 'm'), `USAGE states exit ${n}`);
  }
  assert.deepEqual(cli.EXIT, { OK: 0, USAGE: 1, MISSING_DEPENDENCY: 2, REMOTE_FAILED: 3, STOPPED: 4 });
  // #5230 final review M5: the reopen condition was met, and the comment records the outcome.
  assert.match(header, /Decision \(R4\), settled by #5230:[\s\S]*?4 stays\s+\/\/ distinct from 1\./, "R4's decision comment records that exit 4 stays distinct from 1");
  assert.doesNotMatch(header, /Reopen\s+\/\/ when the cutover has landed/, "R4's decision comment no longer states a reopen condition");
  assert.match(header, /Departure \(R5\)/);
  assert.match(header, /omits `--priority`/, 'the header states the omit-on-empty caller rule');
  assert.match(cli.USAGE, /Omit --priority when no\s+filter is set/, 'USAGE states it too');
  assert.deepEqual(require('../../../plugin/bin/lib/issues/record-vocabulary').PRIORITIES, ['high', 'medium', 'low']);
  assert.match(source, /require\('\.\/lib\/issues\/record-vocabulary'\)/, 'the priority list is imported, not retyped');
});

test('AC7.3: --transport gh with gh absent exits 2, names --transport files, and never falls back', () => {
  const calls = [];
  const r = cliRun(['--transport', 'gh'], {
    env: { CLAUDE_CODE_SESSION_ID: 's' }, cwd: os.tmpdir(), ghAvailable: () => false, queuePull: (o) => { calls.push(o); return {}; },
  });
  assert.equal(r.code, 2);
  assert.match(r.stderr, /--transport files/);
  assert.equal(r.stdout, '');
  // A probe that throws is the same missing dependency, not an uncaught crash.
  const thrown = cliRun(['--transport', 'gh'], {
    env: {}, cwd: os.tmpdir(), ghAvailable: () => { throw new Error('spawn failed'); }, queuePull: (o) => { calls.push(o); return {}; },
  });
  assert.equal(thrown.code, 2);
  assert.match(thrown.stderr, /--transport files/);
  assert.deepEqual(calls, []);
});

test('AC7.4: --transport gh with gh absent never calls queuePull; with gh present it calls it once with the gh transport', () => {
  let pulls = 0;
  cliRun(['--transport', 'gh'], { env: {}, cwd: os.tmpdir(), ghAvailable: () => false, queuePull: () => { pulls += 1; } });
  assert.equal(pulls, 0);
  const seen = [];
  const r = cliRun(['--transport', 'gh'], {
    env: { CLAUDE_CODE_SESSION_ID: 'sess-1' }, cwd: '/work', ghAvailable: () => true, queuePull: (o) => { seen.push(o); return {}; },
  });
  assert.equal(r.code, 0);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].transport, 'gh');
  assert.equal(seen[0].sessionId, 'sess-1');
  assert.equal(seen[0].cwd, '/work');
  assert.deepEqual(seen[0].inputs, {});
});

test('AC7.1: --transport files never probes gh and forwards the input paths resolved against the cwd', () => {
  const seen = [];
  let probed = 0;
  const dir = path.join(os.tmpdir(), 'qp-cwd');
  const r = cliRun(['--transport', 'files', '--queue-raw', 'q.json', '--foreign-states', path.join(dir, 'abs.json')], {
    env: {}, cwd: dir, ghAvailable: () => { probed += 1; return true; }, queuePull: (o) => { seen.push(o); return {}; },
  });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(probed, 0, 'gh was never probed');
  assert.equal(seen[0].transport, 'files');
  assert.deepEqual(seen[0].inputs, { queueRaw: path.join(dir, 'q.json'), foreignStates: path.join(dir, 'abs.json') });
});

test('QueuePullStopped prints its stop line and exits 4; any other throw exits 4 prefixed "queue-pull: "', () => {
  const line = 'dispatch: queue-pull stopped -- group-building exclusion pass failed (exit 1); see error above.';
  const stopped = cliRun(['--transport', 'files'], { env: {}, cwd: os.tmpdir(), queuePull: () => { throw new QueuePullStopped(line); } });
  assert.equal(stopped.code, 4);
  assert.equal(stopped.stderr, `${line}\n`);
  const internal = cliRun(['--transport', 'files'], { env: {}, cwd: os.tmpdir(), queuePull: () => { throw new TypeError('boom'); } });
  assert.equal(internal.code, 4);
  assert.equal(internal.stderr, 'queue-pull: boom\n');
  const ranking = cliRun(['--rank'], { env: {}, rankFromFiles: () => { throw new Error('ENOENT groups'); } });
  assert.equal(ranking.code, 4);
  assert.equal(ranking.stderr, 'queue-pull: ENOENT groups\n');
});

test('AC4.6: a corrupt dispatch-exclusions.json makes the CLI exit 4 with the stop line; no pass after the stop runs; the file is unchanged', () => {
  const scenario = S1();
  scenario.linked = { 9001: { openPR: 70 } };
  scenario.gh = scenario.gh.map((e) => (e.argv && e.argv.join() === DEP_SEARCH_8000.join() ? { ...e, effect: 'corrupt-exclusions' } : e));
  let cliResult = null;
  // pull4 builds the fake-deps context; the CLI's queuePull runs the real passes over it, so the
  // QueuePullStopped travels the CLI's real catch.
  const r = pull4(scenario, {
    passes: PASSES,
    lib: {
      makeContext,
      runPasses: (passes, ctx) => {
        cliResult = cliRun(['--transport', 'files'], {
          env: {}, cwd: ctx.options.cwd, queuePull: () => runPasses(passes, ctx),
        });
      },
    },
  });
  assert.equal(r.thrown, null, 'the CLI caught the stop');
  assert.equal(cliResult.code, 4);
  assert.ok(cliResult.stderr.startsWith(OPEN_STOP), cliResult.stderr);
  assert.match(cliResult.stderr, /appendExclusion: .* is unreadable/);
  assert.deepEqual(r.cap.order, ['truncate', 'fetch', 'blocked', 'oversized', 'write-back', 'not-spec-shaped', 'open-pr'], 'no pass after open-pr ran');
  assert.equal(r.text['dispatch-exclusions.json'], '{corrupt', 'the file keeps its bytes');
});

test('#5227 --rank writes dispatch-next-pick.json and exits 0 (and --priority reaches the ranking)', () => withSession((paths, sessionId) => {
  fs.writeFileSync(paths['dispatch-groups.json'], JSON.stringify([HIGH_OLD, MED, LOW]));
  const env = { CLAUDE_CODE_SESSION_ID: sessionId };
  const plain = cliRun(['--rank'], { env });
  assert.equal(plain.code, 0, plain.stderr);
  assert.equal(fs.readFileSync(paths['dispatch-next-pick.json'], 'utf8'), JSON.stringify(HIGH_OLD) + '\n');
  assert.equal(plain.stdout, '', '--rank prints nothing: the pick lives in the file');
  const argCounts = [];
  cliRun(['--rank', '--priority', 'low'], { env, rankFromFiles: (...a) => { argCounts.push(a.length); return null; } });
  assert.deepEqual(argCounts, [1], 'rankFromFiles takes one argument');
  const low = cliRun(['--rank', '--priority', 'low'], { env });
  assert.equal(low.code, 0, low.stderr);
  assert.equal(fs.readFileSync(paths['dispatch-next-pick.json'], 'utf8'), JSON.stringify(LOW) + '\n');
  fs.rmSync(paths['dispatch-groups.json']);
  const missing = cliRun(['--rank'], { env });
  assert.equal(missing.code, 4);
  assert.match(missing.stderr, /^queue-pull: /);
  assert.equal(fs.readFileSync(paths['dispatch-next-pick.json'], 'utf8'), '', 'the stale pick was truncated, not left behind');
}));

test('#5227 CLI process: the real binary runs --help, rejects a bad flag and pulls a one-record queue under the sandbox shims (and under a padded session id)', { skip: STUB_SKIP }, async () => {
  const sandbox = createSandbox(S0());
  try {
    const help = await runModuleCli(sandbox, ['--help']);
    assert.equal(help.status, 0, help.stderr);
    assert.equal(help.stdout, cli.USAGE);
    const bad = await runModuleCli(sandbox, ['--bogus']);
    assert.equal(bad.status, 1);
    assert.ok(bad.stderr.endsWith(cli.USAGE));
    const pull = await runModuleCli(sandbox, ['--transport', 'gh']);
    assert.equal(pull.status, 0, pull.stderr);
    assert.deepEqual(JSON.parse(pull.files['dispatch-groups.json']).flat().map((c) => c.number), [9001]);
    assert.deepEqual(JSON.parse(pull.files['dispatch-exclusions.json']), []);
    assert.deepEqual(pull.ghArgv.filter((a) => a.tag === 'UNHANDLED'), []);
    // A padded session id: the CLI's session dir is the trimmed one (the plugin's rule), and the
    // harness reads that same dir, so the files are found.
    const padded = await runModuleCli(sandbox, ['--transport', 'gh'], { sessionId: ' qp-padded ' });
    assert.equal(padded.status, 0, padded.stderr);
    assert.deepEqual(JSON.parse(padded.files['dispatch-groups.json']).flat().map((c) => c.number), [9001]);
  } finally {
    sandbox.cleanup();
  }
});

test('AC10.1: docs/plugin-structure.md names queue-pull.js in the command reference and the plugin/bin/lib/dispatch/ entry', () => {
  const text = readText(path.join(REPO, 'docs', 'plugin-structure.md'));
  assert.ok(text.split('\n').some((l) => l.startsWith('node plugin/bin/queue-pull.js')), 'a command-reference line');
  const entry = treeEntryWithContinuations(text, 'plugin/bin/lib/dispatch/');
  assert.ok(entry, 'the module entry exists');
  assert.ok(entry.includes('queue-pull.js'), 'the module entry names queue-pull.js');
  assert.ok(entry.includes('; queue-pull.js (#5227'), 'the module has its own entry in the list, not only a mention');
});

// ---- #5227 pins that need no pair pool: the registry, filesOracleScript, the frozen MCP section and the git shim.
// The parity describes that used to follow run in queue-pull-parity-{ac1,ac5,ac4,ac7}.test.js. ----

// mcp is pinned by FILES_S1_REASONS, which the AC1.1 matrix asserts equal to the reasons the
// oracle's files-transport S1 run writes, while the gh S1 run writes every reason: a pass the
// registry marks skipped-empty or fails-open excludes nothing on `files`, and every other
// exclusion pass excludes there as on gh.
test('#5227 registry: mcp skipped-empty and fails-open are exactly the reasons the files-transport S1 run never writes', () => {
  const mcpOf = (reason) => PASSES.find((p) => p.reason === reason).mcp;
  assert.deepEqual(FILES_S1_REASONS, ALL_REASONS.filter((reason) => !['skipped-empty', 'fails-open'].includes(mcpOf(reason))));
});

test('#5227 filesOracleScript: every gh fetch becomes the agent write, the neighbour pass becomes mcp-transport\'s four steps, and a missing anchor throws', () => {
  const mcp = readText(MCP_MD);
  const script = filesOracleScript(FENCE, mcp);
  for (const name of ['dispatch-queue-raw.json', 'dispatch-open-numbers.json', 'dispatch-verified-open-deps.txt', 'dispatch-in-flight-raw.json', 'dispatch-in-flight-claims.json']) {
    assert.equal(script.split(`if [ -f "$QP_AGENT_DIR/${name}" ]`).length - 1, 1, name);
  }
  assert.equal(script.split('if [ -f "$QP_AGENT_DIR/dispatch-dep-freshness.json" ]').length - 1, 2, 'both dependency-freshness searches');
  assert.deepEqual(script.split('\n').filter((l) => /^\s*(if ! )?gh (issue|pr) |\$\(gh issue view/.test(l)), [], 'no gh fetch survives');
  assert.ok(script.includes('neighbourClaimTargets') && script.includes('claimReaderFromMap'), 'both mcp-transport fences are in');
  assert.ok(!script.includes('createClaimReader().read'), 'the gh claim reader is gone');
  assert.ok(script.includes('NEIGHBOUR_RC=$?\nif [ "$NEIGHBOUR_RC" -ne 0 ]; then\n  echo "dispatch: queue-pull stopped -- neighbour-in-flight exclusion pass failed (exit $NEIGHBOUR_RC); see error above." >&2\n  exit 1\nfi'), 'the fence\'s own stop follows step 4');
  assert.ok(script.includes('echo \'[]\' > "$DISPATCH_CROSSPR_OVERLAP"') && !script.includes('detectCrossPRFileOverlap(candidates, openPRs)'), 'the overlap report is the agent\'s []');
  assert.ok(script.includes('gh pr view "$PR"'), 'the shipped probe loop stays as written (its list is empty on files)');

  const anchors = FENCE.split('\n').filter((l) => /^\s*(if ! )?gh (issue|pr) /.test(l));
  assert.equal(anchors.length, 6, `the fence's gh fetch lines: ${anchors.join('\n')}`);
  for (const line of [...anchors, 'rm -f "$DISPATCH_VERIFIED_OPEN_DEPS"']) {
    assert.throws(() => filesOracleScript(FENCE.replace(line, '# moved'), mcp), (err) => err.message === `anchor not found: ${line}`, line);
  }
  // #5879: the span the agent write replaces: remove, then create the empty file only once the unresolved list was read.
  for (const line of ['rm -f "$DISPATCH_VERIFIED_OPEN_DEPS"', 'DEP_LIST=$(node -e "console.log(require(process.argv[1]).join(\' \'))" -- "$DISPATCH_UNRESOLVED_DEPS") && : > "$DISPATCH_VERIFIED_OPEN_DEPS"', 'for DEP in $DEP_LIST; do']) {
    assert.ok(FENCE.split('\n').includes(line), `the fence holds the whole line: ${line}`);
  }
  // mcp-transport.md's claim-targets fence (step 2) is the only one whose first line ends at this argument.
  assert.throws(() => filesOracleScript(FENCE, mcp.replace('"$DISPATCH_IN_FLIGHT_RAW" <<NODE_EVAL_EOF', '"$X" <<NODE_EVAL_EOF')), /anchor not found/);
});

test('#5230 oracle: the frozen MCP section equals mcp-transport.md at the pre-cutover commit', () => {
  const PRE_CUTOVER = '61ec59285c112cbd8c5953855af108d63a03883b';
  const frozen = fs.readFileSync(path.join(REPO, 'tests', 'fixtures', 'dispatch', 'mcp-transport-step2-pre-cutover-5230.md'), 'utf8');
  const pre = execFileSync('git', ['show', `${PRE_CUTOVER}:plugin/skills/dispatch/mcp-transport.md`], { cwd: REPO, encoding: 'utf8' });
  for (const firstLine of [MCP_TARGETS_FIRST_LINE, MCP_EXCLUSIONS_FIRST_LINE]) {
    assert.equal(extractFence(frozen, firstLine), extractFence(pre, firstLine), firstLine);
  }
  assert.equal(MCP_MD, path.join(REPO, 'tests', 'fixtures', 'dispatch', 'mcp-transport-step2-pre-cutover-5230.md'), 'the oracle reads the frozen fixture');
});

test('#5227 oracle: the git shim answers `remote get-url origin` with the scenario remote URL (canned and logged); any other remote call reaches the real git', { skip: oracleSkip() }, () => {
  const sb = createSandbox(SPortable());
  try {
    const env = sb.runEnv({ tmpdir: path.join(sb.root, 'tmp'), sessionId: 'qp-geturl-probe' });
    const git = (args) => spawnSync(path.join(sb.bin, 'git'), args, { cwd: sb.proj, env, encoding: 'utf8' });
    const canned = git(['remote', 'get-url', 'origin']);
    assert.equal(canned.status, 0, canned.stderr);
    assert.equal(canned.stdout, `https://github.com/${PORTABLE_SLUG}.git\n`, 'the scenario URL, not the sandbox origin.git');
    const near = git(['remote', 'get-url', '--all', 'origin']);
    assert.equal(near.stdout, `${sb.origin}\n`, 'a different argv is delegated');
    const log = readShimLog(sb.logs, 'git');
    assert.deepEqual(log.map((e) => e.tag), ['canned', 'delegated']);
  } finally {
    sb.cleanup();
  }
});

test('the oracle shim quotes the node path for bash: $, a backtick, a backslash, a double and a single quote stay literal', () => {
  const awkward = 'a$HOME`id`\\b"c\'d $(x)';
  const out = spawnSync('bash', ['-c', `printf %s ${shQuote(awkward)}`], { encoding: 'utf8', windowsHide: true });
  assert.equal(out.status, 0, out.stderr);
  assert.equal(out.stdout, awkward);
});

// ---- #5230: assertions moved here from the single-pass script-text tests (in-process) ----
// Each test below carries an assertion that a script-extracting test used to pin and no #5227
// test above covered; the old test now has the module as its subject or is dropped (the run's
// test-mapping.md names each one).

// Runs only the not-spec-shaped pass over `groups`, written as given: a multi-member group, which
// per-record grouping builds only as a fast-lane bundle, reaches the pass directly.
function shapePass(groups) {
  return inOwnTmp(() => {
    const errs = [];
    const ctx = makeContext({ sessionId: 'qp-5230-shape' }, { stderr: (s) => errs.push(s) });
    fs.mkdirSync(path.dirname(ctx.paths['dispatch-groups.json']), { recursive: true });
    fs.writeFileSync(ctx.paths['dispatch-groups.json'], JSON.stringify(groups));
    runPasses(PASSES.filter((p) => p.id === 'not-spec-shaped'), ctx);
    const file = ctx.paths['dispatch-exclusions.json'];
    const entries = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : [];
    return { errs, groups: JSON.parse(fs.readFileSync(ctx.paths['dispatch-groups.json'], 'utf8')), entries: entries.filter((e) => e.reason === 'not-spec-shaped') };
  });
}
const specShaped = ({ deliverables = 'Some deliverables.' } = {}) => [
  '## Current State', '', 'Some current state.', '',
  '## Deliverables', '', deliverables, '',
  '## Acceptance Criteria', '', '- [ ] Some criterion.', '',
  '## Release Note', '', 'Some release note.', '',
].join('\n');

test('#5230 not-spec-shaped: an unresolved placeholder in authored prose is flagged; the same marker in a code span or under ## Original request is exempt (#2829 AC2)', () => {
  const r = shapePass([
    [{ number: 201, body: specShaped({ deliverables: 'TODO: figure this out.' }) }],
    [{ number: 202, body: `${specShaped({ deliverables: 'Use the `TODO` marker as a literal example in code.' })}\n\n## Original request\n\nThe user wrote TBD in their original ask.` }],
  ]);
  assert.deepEqual(r.errs, []);
  assert.deepEqual(r.entries.map((e) => e.records[0]), [201]);
  assert.ok(r.entries[0].detail.missing.includes('unresolved-placeholder'), JSON.stringify(r.entries[0]));
  assert.deepEqual(r.groups.flat().map((c) => c.number), [202], 'the code-span / Original-request marker is exempt');
});

test('#5230 not-spec-shaped: a mixed group keeps its conforming member and an all-non-conforming group drops out (#2829 AC3, AC5)', () => {
  const r = shapePass([
    [{ number: 301, body: specShaped() }, { number: 302, body: 'Just a sentence, no sections at all.' }],
    [{ number: 401, body: 'Nothing here.' }, { number: 402, body: 'Also nothing here.' }],
    [{ number: 501, body: '' }],
  ]);
  assert.deepEqual(r.errs, []);
  assert.deepEqual(r.entries.map((e) => e.records[0]), [302, 401, 402, 501]);
  assert.deepEqual(r.entries.find((e) => e.records[0] === 501).detail.missing, ['Current State', 'Deliverables', 'Acceptance Criteria', 'Release Note'], 'an empty body misses all four');
  assert.deepEqual(r.groups.map((g) => g.map((c) => c.number)), [[301]], 'the mixed group keeps only its conforming member; the emptied groups are dropped');
});

// work-links native: five candidates, each blocked (or not) only through resolve-blockers.js.
function nativeForeignScenario() {
  const records = [11, 12, 13, 14, 15].map((n) => ghRecord(n, { body: withBody(n) }));
  return {
    name: 'SNativeForeign',
    policy: { 'work-links': 'native' },
    gh: [
      { argv: QUEUE_ARGV, stdout: JSON.stringify(records) + '\n' },
      { argv: OPEN_NUMBERS_ARGV, stdout: JSON.stringify(records.map((r) => ({ number: r.number }))) + '\n' },
    ],
  };
}
const NATIVE_FOREIGN = {
  11: { blockedBy: [5], openBlocker: true, openBlockerIds: [5], crossRepoBlockers: [{ number: 5, repository: 'other/repo', state: 'OPEN' }] },
  12: { blockedBy: [6], openBlocker: false, openBlockerIds: [], crossRepoBlockers: [{ number: 6, repository: 'other/repo', state: null }] },
  13: { blockedBy: [7], openBlocker: false, openBlockerIds: [], crossRepoBlockers: [{ number: 7, repository: 'other/repo', state: 'CLOSED' }] },
  14: { blockedBy: [8], openBlocker: true, openBlockerIds: [8] },
  15: { blockedBy: [4, 5], openBlocker: true, openBlockerIds: [4, 5], crossRepoBlockers: [{ number: 5, repository: 'other/repo', state: 'OPEN' }] },
};

test('#5230 blocked, native: a foreign crossRepoBlockers entry that is OPEN excludes as owner/name#N, a null state as owner/name#N (state unreadable), and a CLOSED one keeps the record (#4793)', () => {
  const r = pull(nativeForeignScenario(), { spawn: { 'resolve-blockers.js': { status: 0, stdout: JSON.stringify(NATIVE_FOREIGN), stderr: '' } } });
  assert.deepEqual(r.cliCalls.filter(([n]) => n === 'resolve-blockers.js'), [['resolve-blockers.js', '11,12,13,14,15']]);
  assert.deepEqual(entriesOf(r, 'blocked'), [
    { reason: 'blocked', records: [11], detail: { blockedBy: ['other/repo#5'] } },
    { reason: 'blocked', records: [12], detail: { blockedBy: ['other/repo#6 (state unreadable)'] } },
    { reason: 'blocked', records: [14], detail: { blockedBy: [8] } },
    { reason: 'blocked', records: [15], detail: { blockedBy: [4, 'other/repo#5'] } },
  ]);
  assert.deepEqual(groupNumbers(r), [[13]], 'only the record whose foreign blocker is CLOSED stays eligible');
});

// body-text: three body-declared foreign blockers, two of them answered by a supplied states file.
function foreignCaseScenario() {
  const lines = { 31: 'Blocked by other/repo#5', 32: 'Blocked by Other/Repo#6', 33: 'Blocked by other/repo#7', 34: null };
  const records = Object.entries(lines).map(([n, line]) => ghRecord(Number(n), { body: line ? `${line}\n\n${withBody(n)}` : withBody(n) }));
  return {
    name: 'SForeignCase',
    policy: { 'work-links': 'body-text' },
    gh: [
      { argv: QUEUE_ARGV, stdout: JSON.stringify(records) + '\n' },
      { argv: OPEN_NUMBERS_ARGV, stdout: JSON.stringify(records.map((r) => ({ number: r.number }))) + '\n' },
    ],
  };
}

test('#5230 foreign blocker: a supplied states key matches a body ref in another case, a CLOSED one groups, and a ref left out of the file is asked of the CLI and fails closed (#4793)', () => {
  // The CLI's answer with no gh on PATH (exit 2), as resolve-foreign-blockers.js prints it.
  const noGh = { 'resolve-foreign-blockers.js': { status: 2, stdout: '', stderr: 'resolve-foreign-blockers.js: `gh` is required' } };
  const r = pull(foreignCaseScenario(), {
    spawn: noGh,
    prepare: (own) => ({ inputs: { foreignStates: writeInput(own, 'states.json', JSON.stringify({ 'other/repo#5': 'closed', 'OTHER/REPO#6': 'open' })) } }),
  });
  assert.deepEqual(entriesOf(r, 'blocked'), [
    { reason: 'blocked', records: [32], detail: { blockedBy: ['Other/Repo#6'] } },
    { reason: 'blocked', records: [33], detail: { blockedBy: ['other/repo#7 (state unreadable)'] } },
  ]);
  assert.deepEqual(groupNumbers(r), [[31], [34]]);
  assert.deepEqual(r.cliCalls.filter(([n]) => n === 'resolve-foreign-blockers.js'), [['resolve-foreign-blockers.js', 'other/repo#7']], 'only the left-out ref is asked');
  const warnings = r.errs.filter((e) => e.startsWith('Warning:'));
  assert.equal(warnings.length, 1, r.stderr);
  assert.match(warnings[0], /foreign blocker state lookup failed \(exit 2: resolve-foreign-blockers\.js: `gh` is required\)/);
});

// #5304: the module-only twin of the oracle's files-foreignStates rows (which skip without bash): an ignored
// states file prints its own fail-closed Warning, and the CLI lookup's gh-absent Warning that follows is dropped.
test('#5304 foreign blocker: an ignored states file with no gh prints exactly one Warning, the states file\'s, and still fails closed', () => {
  const noGh = { 'resolve-foreign-blockers.js': { status: 2, stdout: '', stderr: 'resolve-foreign-blockers.js: `gh` is required' } };
  const r = pull(foreignCaseScenario(), {
    spawn: noGh,
    prepare: (own) => ({ inputs: { foreignStates: writeInput(own, 'states.json', 'this is not json') } }),
  });
  const foreignWarnings = r.errs.filter((e) => e.startsWith('Warning: foreign blocker'));
  assert.equal(foreignWarnings.length, 1, r.stderr);
  assert.match(foreignWarnings[0], /^Warning: foreign blocker states file .*states\.json ignored \(.*\) — supplied states not used \(fail closed\)/);
  assert.ok(r.cliCalls.some(([n]) => n === 'resolve-foreign-blockers.js'), 'the CLI lookup ran, so its dropped Warning is the dedupe under test');
  assert.deepEqual(entriesOf(r, 'blocked').map((e) => e.records[0]), [31, 32, 33], 'every foreign ref fails closed');
});

test('#5230 near-dup: a stale dispatch-near-dup-pairs.json from an earlier pull is rewritten to [] when no strong pair remains', () => {
  const stale = JSON.stringify([{ records: [8, 9], signals: [], sharedAnchors: [] }]);
  const seed = (ctx) => fs.writeFileSync(ctx.paths['dispatch-near-dup-pairs.json'], stale);
  assert.equal(pull5(S1(), { before: seed }).text['dispatch-near-dup-pairs.json'], '[]');
  // Control: the pull removes the earlier copy at its start (#5409) and an omitted pass writes nothing, so the '[]' above is the pass's.
  assert.equal(pull5(S1(), { before: seed, omit: ['near-dup-pairs'] }).text['dispatch-near-dup-pairs.json'], undefined);
});

test('#5230 neighbour: an in-flight strong near-duplicate with no Key Files is a neighbour, and its detail element carries sharedAnchors (#3520 AC8)', () => {
  const nearDup = {
    number: 7002, title: 'Tidy the release notes generator', labels: [{ name: 'bot:in-progress' }],
    body: '## Current State\n\nThe `WidgetScheduler.flush` path and `schedulerCache.evict` disagree on ordering.\n',
  };
  const r = pull5(withGh(PIPE(), IN_FLIGHT_ARGV, { stdout: JSON.stringify([IN_FLIGHT_7001, nearDup]) + '\n' }), { claims: { 7001: LIVE_CLAIM, 7002: LIVE_CLAIM } });
  const byRecord = Object.fromEntries(entriesOf(r, 'neighbour-in-flight').map((e) => [e.records[0], e.detail.neighbours]));
  for (const n of [9014, 9015]) {
    assert.deepEqual(byRecord[n], [{ number: 7002, files: [], signals: ['body-anchor-overlap'], sharedAnchors: ['WidgetScheduler.flush', 'schedulerCache.evict'] }], `#${n}`);
  }
  assert.deepEqual(byRecord[9013], [{ number: 7001, files: ['plugin/bin/fixture-9013.js'] }], 'a Key-File neighbour keeps the file form');
});

test('#5230 blocker-landing: the argv the module hands dispatch-unlanded-blockers.js passes that CLI\'s own parseArgs and names the session groups and exclusions files', () => {
  let paths = null;
  const r = pull5(PIPE(), { before: (ctx) => { paths = ctx.paths; } });
  assert.equal(r.landing.length, 1);
  const [args] = r.landing;
  const { parseArgs } = require('../../../plugin/bin/dispatch-unlanded-blockers');
  const parsed = parseArgs(args);
  assert.equal(parsed.error, undefined, `the shipped CLI's parseArgs rejects the module's argv: ${parsed.error}`);
  assert.equal(flagValue(args, '--groups'), paths['dispatch-groups.json']);
  assert.equal(flagValue(args, '--exclusions'), paths['dispatch-exclusions.json']);
});

// #5230 (moved from tests/bin-lib/express/queue.test.js, which read the script's three call sites):
// a recording expressQueuePolicy whose grouping no default produces and whose keepSingleton keeps
// #9101 out of the fast-lane bundle. Each of the three sites goes red on its own if it reads
// anything but the injected policy.
function recordingExpress() {
  const seen = { calls: 0, kept: [] };
  const dep = () => {
    seen.calls += 1;
    return { enabled: true, grouping: 'recorded-grouping', fingerprint: 'recorded-fp', keepSingleton: (c) => { seen.kept.push(c.number); return c.number === 9101; } };
  };
  return { seen, dep };
}

test('#5230 express: the grouping pass, the write-back blob and the cache check each consume the injected expressQueuePolicy', () => {
  const off = pull(SFast());
  assert.deepEqual(groupNumbers(off), [[9101, 9102, 9103]], 'control: with the policy off the three singletons bundle');

  const express = recordingExpress();
  const miss = pull(SFast(), { deps: { expressQueuePolicy: express.dep } });
  assert.deepEqual(groupNumbers(miss), [[9101], [9102, 9103]], 'buildDispatchGroups takes keepSingleton from the policy');
  assert.ok(express.seen.kept.includes(9101), 'keepSingleton was asked about #9101');
  assert.equal(miss.store.written.length, 1);
  assert.equal(miss.store.written[0].blob.grouping, 'recorded-grouping', 'the write-back blob stamps the policy grouping');
  assert.equal(miss.store.written[0].blob.fingerprint, 'recorded-fp', 'the write-back blob stamps the policy settings fingerprint (#6062)');

  const blob = miss.store.written[0].blob;
  const otherFp = pull(SFast(), {
    persisted: { ...blob, excluded: [{ number: 9999, blockedBy: [1] }] },
    deps: { expressQueuePolicy: () => ({ ...recordingExpress().dep(), fingerprint: 'other-fp' }) },
  });
  assert.equal(otherFp.state.cacheHit, false, 'a blob written under other grouping settings is never reused (#6062)');
  assert.ok(!otherFp.json('dispatch-exclusions.json').some((e) => e.records.includes(9999)), 'AC8: a fingerprint miss recomputes the blocker exclusions, it does not replay the persisted ones');
  assert.deepEqual(groupNumbers(otherFp), [[9101], [9102, 9103]], 'AC8: a fingerprint miss recomputes the groups');
  const withExcluded = { ...blob, excluded: [{ number: 9999, blockedBy: [1] }] };
  const hit = pull(SFast(), { persisted: withExcluded, deps: { expressQueuePolicy: recordingExpress().dep } });
  assert.equal(hit.state.cacheHit, true, 'the cache check compares the blob against the policy grouping');
  assert.ok(hit.json('dispatch-exclusions.json').some((e) => e.records.includes(9999)), 'control: a hit replays the persisted exclusions, so the AC8 absence above can go red');
  assert.deepEqual(groupNumbers(hit), [[9101], [9102, 9103]]);
  const otherMode = pull(SFast(), { persisted: blob });
  assert.equal(otherMode.state.cacheHit, false, 'a blob stamped under another grouping is never reused');
});

test('AC9.1 (#6011): a files-transport pull with the driver half on writes each driver-routable fast-lane record as its own group and no bundles', () => {
  const { expressQueuePolicy } = require('../../../plugin/bin/lib/express/queue');
  const values = {
    'express-lane': true, 'integration-model': 'pr-first', 'merge-sensitive-paths': [],
    'express-driver-max-size': 'medium', 'express-driver-max-key-files': 3, 'express-driver-review': 'beyond-express',
  };
  // Disjoint non-protected Key Files per record, so the control bundles; the paths sit beside the ones Task 2's tests use.
  const fastMedium = (n) => ({
    ...mcpRecord(n, withBody(n).replace(`- \`plugin/bin/fixture-${n}.js\``, `- \`plugin/skills/init/claude-md-template-${n}.md\`\n- \`plugin/skills/init/rules-template-${n}.md\``)),
    labels: ['auto:build', 'ready', 'ceremony:fast-lane', 'risk:low', 'size:medium', 'type:task'].map((name) => ({ name })),
  });
  const scenario = () => {
    const s = S1();
    return { ...s, policy: { ...s.policy, 'dispatch-group-size-guard': '3', 'dispatch-fastlane-bundle-cap': '3' } };
  };
  const run = (driver) => pull(scenario(), {
    transport: 'files', run: noGhOnFiles,
    deps: { expressQueuePolicy: (o) => expressQueuePolicy({ ...o, resolvePolicy: (keys) => Object.fromEntries(keys.map((k) => [k, { value: k === 'express-driver' ? driver : values[k], source: 'policy' }])) }) },
    prepare: (own) => ({ inputs: {
      queueRaw: writeInput(own, 'queue.json', JSON.stringify([9201, 9202, 9203].map(fastMedium))),
      openNumbers: writeInput(own, 'open.json', '[{"number":9201},{"number":9202},{"number":9203}]'),
      depFreshness: writeInput(own, 'dep.json', '[]'),
      verifiedOpenDeps: writeInput(own, 'verified.txt', ''),
    } }),
  });
  const on = run('on');
  assert.deepEqual(groupNumbers(on), [[9201], [9202], [9203]]);
  assert.deepEqual(on.json('dispatch-fastlane-bundles.json'), []);
  const off = run('off');
  assert.deepEqual(off.json('dispatch-fastlane-bundles.json'), [{ records: [9201, 9202, 9203] }], 'control: with the driver half off the same records bundle');
});

// #5230 (moved from tests/bin-lib/stage-item/cli.test.js, #3488): the shipped Close proposal's
// stage-item.js call drops its stdout but forwards its stderr, so a staging failure reaches the
// firing's log. And the pass only stages the Close (moved from dispatch-shipped-candidate-prose,
// #1984): no gh call closes the record directly, even when staging fails.
test('#5230 shipped: the stage-item.js stderr of a shipped Close proposal reaches deps.stderr; its stdout does not reach deps.stdout; nothing closes the record directly', () => {
  const spawn = {
    'stage-item.js': (args) => {
      const id = args[args.indexOf('--id') + 1];
      return { status: 1, stdout: `staged ${id}\n`, stderr: `stage-item: refused ${id}\n` };
    },
  };
  const r = pull4(FULL(), { spawn });
  assert.ok(r.errs.includes('stage-item: refused shipped-close-9010\n'), r.stderr);
  assert.ok(!r.cap.stdout.includes('staged shipped-close-9010\n'), 'the shipped stage-item stdout is dropped');
  assert.ok(r.cap.stdout.includes('staged dispatch-target-missing-9009\n'), 'control: the target-missing call forwards its stdout');
  assert.equal(r.thrown, null, 'a failed staging call does not stop the pull');
  // ghCalls records every argv the runner was handed, answered or not: `gh issue close`, or a
  // `gh api` call on an issue path that sets state=closed.
  const closes = r.ghCalls.filter((a) => (a[0] === 'issue' && a[1] === 'close')
    || (a[0] === 'api' && a.some((x) => /\/issues\/\d+$/.test(x)) && a.some((x) => /^state=closed$/.test(x))));
  assert.deepEqual(closes, [], 'the pass stages a Close proposal, never a direct close');
});

// ---- #5584: the named path (--named / --run) -------------------------------------------------------
// A named record without auto:build is fetched, judged by the build-authority rule and, on `typed`,
// added to the pool before the blocked pass, so every later pass judges it as it judges a granted
// record. Record numbers: 12 (and 13, 14) for the injected-answer runs; 3 for the runs over the
// real transcript check, because the captured rows name record #3.
const { writePointer } = require('../../../plugin/bin/lib/issues/typed-command');
const { failGh } = require('./queue-pull-fixtures');

test('#5314 (AC1.1): a module pull whose open-numbers read fails removes an earlier pull\'s eligibility files and stops at group-building with no write-back; a [] queue still exits clean', () => {
  const STALE = JSON.stringify([{ number: 1, title: 'stale', labels: [], body: '' }]);
  const names = ['dispatch-eligible-pre-dep.json', 'dispatch-unresolved-deps.json', 'dispatch-eligible.json', 'dispatch-blocked-excluded-body.json'];
  const seed = (ctx) => { for (const n of names) fs.writeFileSync(ctx.paths[n], STALE); };
  const r = pull(failGh(S1(), OPEN_NUMBERS_ARGV), { allowThrow: true, before: seed });
  assert.ok(r.thrown instanceof QueuePullStopped, String(r.thrown));
  const [, head, tail] = FENCE.match(GROUPING_STOP_RE);
  assert.equal(r.thrown.line, `${head}1${tail}`);
  for (const n of names) assert.equal(r.text[n], undefined, `${n} removed`);
  assert.equal(r.store.written.length, 0, 'no write-back');
  // Control: a well-formed empty queue after the same seed is an empty eligible set and no stop.
  const empty = pull(SEmpty(), { before: seed });
  assert.equal(empty.thrown, null, String(empty.thrown));
  assert.equal(empty.text['dispatch-eligible.json'], '[]');
  // Twin of the cache-hit path: a blob from a non-empty pull whose signal the [] pull's
  // dependency-freshness answer reproduces must not be reused for an empty queue.
  const blob = pull(S1()).store.written[0].blob;
  const reproduces = EmptyAfterS1();
  const twin = pull(reproduces, { persisted: blob });
  assert.equal(twin.thrown, null, String(twin.thrown));
  assert.equal(twin.state.cacheHit, false, 'an empty queue never uses the queue-order cache');
  assert.equal(twin.text['dispatch-eligible.json'], '[]');
  assert.deepEqual(twin.json('dispatch-groups.json'), []);
});

test('#5409 (AC1, AC2): a pull whose cross-pr-overlap step throws leaves no earlier pull\'s dispatch-crosspr-overlap.json; the five end-written files are this pull\'s or absent', () => {
  const STALE = '"an earlier pull\'s copy"';
  const seed = (ctx) => { for (const n of END_WRITTEN_FILES) fs.writeFileSync(ctx.paths[n], STALE); };
  // `{}` is valid JSON but no PR list: the compute's `.map` throws before its write.
  const r = pull5(withGh(PIPE(), OPEN_PRS_ARGV, { stdout: '{}\n' }), { before: seed });
  assert.equal(r.thrown, null, String(r.thrown)); // the pull completes (exit 0): the reader after it is cross-pr-overlap-report.md
  assert.ok(r.errs.some((e) => e.startsWith('queue-pull: cross-pr-overlap: ')), r.stderr);
  assert.equal(r.text['dispatch-crosspr-overlap.json'], undefined, 'no earlier pull\'s overlap report');
  for (const n of END_WRITTEN_FILES) assert.notEqual(r.text[n], STALE, `${n}: this pull's or absent`);
  // Control: the same seed and a healthy pull — every file the pull writes is rewritten by this pull.
  const healthy = pull5(PIPE(), { before: seed });
  assert.equal(healthy.thrown, null, String(healthy.thrown));
  assert.ok(Array.isArray(JSON.parse(healthy.text['dispatch-crosspr-overlap.json'])), 'a list this pull computed');
  // One removal failing (a directory at the first name) does not stop the other four (rm -f's per-operand behaviour).
  const dirFirst = pull5(PIPE(), {
    allowThrow: true,
    before: (ctx) => { seed(ctx); fs.rmSync(ctx.paths['dispatch-named-targets.json']); fs.mkdirSync(ctx.paths['dispatch-named-targets.json']); },
  });
  assert.ok(dirFirst.errs.some((e) => e.startsWith('queue-pull: rm-end-written: ')), dirFirst.stderr);
  for (const n of END_WRITTEN_FILES.filter((x) => x !== 'dispatch-named-targets.json')) assert.notEqual(dirFirst.text[n], STALE, `${n}: removed although an earlier removal failed`);
});

test('#5409: every session file is end-written (removed at pull start) or named here with the reason it is not', () => {
  // A new SESSION_FILES entry fails this until it is classed: one written only after its step's
  // fallible work belongs in END_WRITTEN_FILES (and the fence's rm -f line), never in this list,
  // unless it is an agent input on `files` that a pull-start removal would delete (verified-open-deps).
  const NOT_END_WRITTEN = [
    'dispatch-queue-raw.json', 'dispatch-open-numbers.json', 'dispatch-native-deps.json', 'dispatch-native-deps.tmp.json',
    'dispatch-native-deps.err', 'dispatch-groups.json', 'dispatch-exclusions.json', 'dispatch-fastlane-bundles.json',
    'dispatch-in-flight-raw.json', 'dispatch-in-flight-claims.json', 'dispatch-dep-freshness.json', 'dispatch-open-prs.json',
    'dispatch-linked-prs.json', 'dispatch-linked-prs.err', 'dispatch-shipped-pr-files.jsonl', 'dispatch-shape-gate.err',
    'dispatch-next-pick.json', // reset before its step's fallible work, or an agent input on `files`
    'dispatch-eligible-pre-dep.json', 'dispatch-unresolved-deps.json', 'dispatch-eligible.json',
    'dispatch-blocked-excluded-body.json', 'dispatch-verified-open-deps.txt', // removed by the blocked pass (#5314); verified-open-deps also removed at its step's start on gh (#5879), or its agent input on files
  ];
  assert.deepEqual([...END_WRITTEN_FILES, ...NOT_END_WRITTEN].sort(), [...SESSION_FILES].sort());
});

test('#5409: the fence\'s pull-start rm -f removes exactly the module\'s END_WRITTEN_FILES, before the exclusions truncation', () => {
  const lines = FENCE.split('\n');
  const assignRe = /^(DISPATCH_[A-Z_]+)="\$\(node "\$\{CLAUDE_PLUGIN_ROOT\}\/bin\/session-tmp-resolve\.js" --value ([^ )"]+)\)"$/;
  const fileOf = {};
  let lastAssign = -1;
  lines.forEach((l, i) => {
    const m = l.match(assignRe);
    if (m) { fileOf[m[1]] = m[2]; lastAssign = i; }
  });
  const rmIdx = lines.findIndex((l) => l.startsWith('rm -f ') && l.endsWith('# #5409: no earlier pull\'s copy'));
  const truncIdx = lines.findIndex((l) => l.startsWith('# #1752: truncate dispatch-exclusions.json'));
  assert.ok(rmIdx >= 0, 'the fence has the pull-start rm -f line');
  assert.ok(lastAssign >= 0, 'the fence has session-tmp-resolve assignments');
  assert.ok(truncIdx >= 0, 'the fence has the exclusions truncation comment');
  const vars = [...lines[rmIdx].matchAll(/"\$(DISPATCH_[A-Z_]+)"/g)].map((m) => m[1]);
  for (const v of vars) assert.ok(fileOf[v], `${v} is assigned by a session-tmp-resolve line`);
  assert.deepEqual(vars.map((v) => fileOf[v]).sort(), [...END_WRITTEN_FILES].sort());
  assert.ok(lastAssign < rmIdx && rmIdx < truncIdx, `last assignment ${lastAssign} < rm ${rmIdx} < truncation ${truncIdx}`);
});

const NAMED_VIEW = (n) => ['issue', 'view', String(n), '--json', 'number,title,body,labels,createdAt,updatedAt,state'];
const ADMIT_LINE = (n) => `#${n} has no auto:build label — built on the typed /claude-tweaks:dispatch command\n`;
const AUTO_RE = (n) => new RegExp(`^- AUTO \\d{2}:\\d{2}:\\d{2} — queue pull: #${n} admitted on a typed /claude-tweaks:dispatch command \\(no auto:build label\\)\\. Reversibility: n/a\\.$`);
const TYPED_SESSION = 'test-session-0001';
const TYPED_ENV = { CLAUDE_CODE_SESSION_ID: TYPED_SESSION, CLAUDE_CODE_ENTRYPOINT: 'cli', CLAUDE_CODE_SESSION_ATTENDED: '1' };
const PRIOR_DECISIONS = '## /dispatch\n- AUTO 01:00:00 — dispatch: an earlier line. Reversibility: n/a.\n';
const ungranted = (n, { labels = ['ready'], body = withBody(n), state = 'OPEN' } = {}) => ({ ...ghRecord(n, { labels, body }), state });

// `scenario` with each record answered on `gh issue view` only (never in the auto:build pool).
function withNamedView(scenario, records) {
  scenario.gh = [...records.map((rec) => ({ argv: NAMED_VIEW(rec.number), stdout: `${JSON.stringify(rec)}\n` })), ...scenario.gh];
  return scenario;
}
// `scenario` with `record` added to the auto:build pool answer.
function withPooled(scenario, record) {
  scenario.gh = scenario.gh.map((e) => (e.argv && e.argv.join('\u0000') === QUEUE_ARGV.join('\u0000')
    ? { ...e, stdout: `${JSON.stringify([...JSON.parse(e.stdout), record])}\n` } : e));
  return scenario;
}

// pull4 over the named path. o: { named, typedFor (numbers the injected check answers typed for),
// realCheck (no injected check), env, now, tmpdir, persisted, decisions (decisions.md's text before
// the pull) }. Returns pull4's result plus the firing's decisions.md text (null when absent), the
// numbers the injected check was asked about and the queue-order cache call counts.
function pullNamed(scenario, o = {}) {
  const runDir = scratchDir('qp-named-run-');
  const decisionsFile = path.join(runDir, 'decisions.md');
  if (o.decisions !== undefined) fs.writeFileSync(decisionsFile, o.decisions);
  const asked = [];
  const order = { read: 0, write: 0 };
  const typedFor = new Set(o.typedFor || []);
  try {
    const r = pull4(scenario, {
      env: o.env || TYPED_ENV,
      prepare: () => ({ named: o.named || [12], runDir, ...(o.tmpdir ? { tmpdir: o.tmpdir } : {}) }),
      deps: {
        ...(o.realCheck ? {} : {
          readTypedCommand: ({ number }) => {
            asked.push(number);
            return typedFor.has(number) ? { answer: 'typed', promptId: 'p-1' } : { answer: 'none', reason: 'not-typed' };
          },
        }),
        ...(o.now ? { now: () => o.now } : {}),
        queueOrder: {
          readOrder: () => { order.read += 1; return o.persisted || null; },
          writeOrder: () => { order.write += 1; return { ok: true }; },
        },
      },
    });
    const decisions = fs.existsSync(decisionsFile) ? fs.readFileSync(decisionsFile, 'utf8') : null;
    return { ...r, decisions, asked, order, stdout: r.cap.stdout.join('') };
  } finally {
    fs.rmSync(runDir, { recursive: true, force: true });
  }
}

const autoLines = (r) => (r.decisions || '').split('\n').filter((l) => l.startsWith('- AUTO') && l.includes('queue pull:'));
const viewCalls = (r) => r.ghCalls.filter((a) => a[0] === 'issue' && a[1] === 'view' && a[4] === 'number,title,body,labels,createdAt,updatedAt,state');
const inGroups = (r, n) => groupNumbers(r).flat().includes(n);
// AC11: no gh call the pull makes edits a label.
function assertNoLabelWrite(r) {
  const edits = r.ghCalls.filter((a) => (a[0] === 'issue' && a[1] === 'edit') || a.includes('--add-label') || a.includes('--remove-label')
    || (a[0] === 'api' && a.some((x) => /\/labels\b/.test(x))));
  assert.deepEqual(edits, [], 'no gh call edits a label');
}

test('AC5.1: --named 12 with a typed answer admits ungranted #12 to the groups, prints the admit line and appends one AUTO line under ## /dispatch', () => {
  const r = pullNamed(withNamedView(S1(), [ungranted(12)]), { typedFor: [12] });
  assert.equal(r.thrown, null);
  assert.ok(inGroups(r, 12), JSON.stringify(groupNumbers(r)));
  assert.deepEqual(reasonsOf(r, 12), []);
  assert.ok(r.stdout.includes(ADMIT_LINE(12)), r.stdout);
  const lines = autoLines(r);
  assert.equal(lines.length, 1, r.decisions);
  assert.match(lines[0], AUTO_RE(12));
  assert.ok(r.decisions.startsWith('## /dispatch\n'), r.decisions);
  assert.deepEqual(r.asked, [12]);
  assert.equal(viewCalls(r).length, 1);
  assertNoLabelWrite(r);
});

test('AC5.1: a pull that admitted a typed record neither reads nor writes the queue-order cache', () => {
  const r = pullNamed(withNamedView(S1(), [ungranted(12)]), { typedFor: [12] });
  assert.deepEqual(r.order, { read: 0, write: 0 });
  assert.equal(r.state.cacheHit, false);
  // Control: the same pull with nothing admitted reads the cache twice and writes it back once.
  const none = pullNamed(withNamedView(S1(), [ungranted(12)]), { typedFor: [] });
  assert.deepEqual(none.order, { read: 2, write: 1 });
});

test('AC5.1: a stored blob that is a hit when nothing is admitted is not read once a typed record is admitted', () => {
  const blob = pull(S1()).store.written[0].blob;
  const control = pullNamed(withNamedView(S1(), [ungranted(12)]), { typedFor: [], persisted: blob });
  assert.equal(control.state.cacheHit, true, 'control: the blob is a hit when nothing is admitted');
  const r = pullNamed(withNamedView(S1(), [ungranted(12)]), { typedFor: [12], persisted: blob });
  assert.equal(r.state.cacheHit, false);
  assert.ok(inGroups(r, 12));
});

test('AC5.2: an admitted record with an open body blocker is excluded as blocked, as a granted record is', () => {
  const r = pullNamed(withNamedView(S1(), [ungranted(12, { body: `Blocked by #8000\n\n${withBody(12)}` })]), { typedFor: [12] });
  assert.ok(!inGroups(r, 12));
  assert.deepEqual(reasonsOf(r, 12), ['blocked']);
  assert.equal(autoLines(r).length, 1, 'admitted, then excluded by the pass');
  assertNoLabelWrite(r);
});

test('AC5.3: an admitted record with an open linked PR is excluded as open-pr', () => {
  const s = withNamedView(S1(), [ungranted(12)]);
  s.linked = { ...(s.linked || {}), 12: { openPR: 90 } };
  const r = pullNamed(s, { typedFor: [12] });
  assert.ok(!inGroups(r, 12));
  assert.deepEqual(reasonsOf(r, 12), ['open-pr']);
  assertNoLabelWrite(r);
});

test('AC5.4: an admitted record whose body is not spec-shaped is excluded as not-spec-shaped', () => {
  const r = pullNamed(withNamedView(S1(), [ungranted(12, { body: 'No spec sections in this body.\n' })]), { typedFor: [12] });
  assert.ok(!inGroups(r, 12));
  assert.deepEqual(reasonsOf(r, 12), ['not-spec-shaped']);
  assertNoLabelWrite(r);
});

// The real transcript check: a temp session temp root holding the pointer, a temp config dir
// holding one transcript built from a captured row set, and no injected answer.
const TYPED_FIXTURES = path.join(REPO, 'tests', 'fixtures', 'typed-command');
const capturedRows = (c) => JSON.parse(fs.readFileSync(path.join(TYPED_FIXTURES, `captured-${c}.json`), 'utf8'));
function realPull(c, { pointer = true } = {}) {
  const root = scratchDir('qp-typed-');
  try {
    const rows = capturedRows(c);
    const configDir = path.join(root, 'config');
    const tmpdir = path.join(root, 'tmp');
    const dir = path.join(configDir, 'projects', '-launch-dir');
    fs.mkdirSync(dir, { recursive: true });
    fs.mkdirSync(tmpdir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${TYPED_SESSION}.jsonl`), `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`);
    if (pointer) {
      assert.equal(writePointer({ sessionId: TYPED_SESSION, promptId: rows[0].promptId, numbers: [3], now: rows[0].timestamp, tmpdir }), true);
    }
    return pullNamed(withNamedView(S1(), [ungranted(3)]), {
      realCheck: true, named: [3], env: { ...TYPED_ENV, CLAUDE_CONFIG_DIR: configDir }, tmpdir,
      now: new Date(Date.parse(rows[0].timestamp) + 5 * 60 * 1000), decisions: PRIOR_DECISIONS,
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('AC5.5: end to end, the real check over a transcript built from the captured (a) row admits #3', () => {
  const r = realPull('a');
  assert.equal(r.thrown, null);
  assert.ok(inGroups(r, 3), `${r.stdout}${r.stderr}`);
  assert.ok(r.stdout.includes(ADMIT_LINE(3)), r.stdout);
  assert.equal(autoLines(r).length, 1);
  assert.match(autoLines(r)[0], AUTO_RE(3));
  assert.ok(r.decisions.startsWith(PRIOR_DECISIONS), 'appended under the existing heading, earlier lines kept');
  assertNoLabelWrite(r);
});

function assertRefused(r, n, word, remedy) {
  assert.equal(r.thrown, null);
  assert.ok(!inGroups(r, n), JSON.stringify(groupNumbers(r)));
  const line = `#${n} has no auto:build label — not built: typed command not accepted (${word}); ${remedy} (a typed command with any other argument records nothing)\n`;
  assert.ok(r.stdout.includes(line), r.stdout);
  assert.equal(r.decisions, PRIOR_DECISIONS, 'decisions.md is unchanged');
  assertNoLabelWrite(r);
}

test('AC6.1: no pointer refuses #3 with no-pointer and its remedy; decisions.md is unchanged', () => {
  assertRefused(realPull('a', { pointer: false }), 3, 'no-pointer', 'grant it with /claude-tweaks:backlog refine #3, or type the command again');
});

test('AC6.1: a pointer whose transcript row is the captured (g) row refuses #3 with not-typed', () => {
  assertRefused(realPull('g'), 3, 'not-typed', 'grant it with /claude-tweaks:backlog refine #3');
});

test('AC6.1: a pointer whose transcript row is the captured (h) row refuses #3 with not-typed', () => {
  assertRefused(realPull('h'), 3, 'not-typed', 'grant it with /claude-tweaks:backlog refine #3');
});

const named12 = (rec, o = {}) => pullNamed(withNamedView(S1(), [rec]), { typedFor: [12], decisions: PRIOR_DECISIONS, ...o });

test('AC6.2: a hub-launched session (CC_POSTURE=hub, no CC_LAUNCHED_BY) refuses with launcher and never asks the transcript', () => {
  const r = named12(ungranted(12), { env: { ...TYPED_ENV, CC_POSTURE: 'hub' } });
  assertRefused(r, 12, 'launcher', 'the launcher must export CC_LAUNCHED_BY=user (thn-inc/claude-user-config#50)');
  assert.deepEqual(r.asked, []);
});

test('AC6.2: a record without ready refuses with not-ready', () => {
  const r = named12(ungranted(12, { labels: [] }));
  assertRefused(r, 12, 'not-ready', 'run /claude-tweaks:specify #12');
  assert.deepEqual(r.asked, []);
});

test('AC6.2: a failed fetch of #12 refuses with labels-unreadable', () => {
  const r = pullNamed(failGh(S1(), NAMED_VIEW(12)), { typedFor: [12], decisions: PRIOR_DECISIONS });
  assertRefused(r, 12, 'labels-unreadable', "re-run once the record's labels can be read");
  assert.equal(viewCalls(r).length, 1);
  assert.deepEqual(r.asked, []);
});

test('AC6.2: a fetched answer that is not this record\'s JSON refuses with labels-unreadable', () => {
  for (const stdout of ['not json\n', `${JSON.stringify(ungranted(99))}\n`, `${JSON.stringify({ ...ungranted(12), state: null })}\n`, 'null\n']) {
    const s = S1();
    s.gh = [{ argv: NAMED_VIEW(12), stdout }, ...s.gh];
    const r = pullNamed(s, { typedFor: [12], decisions: PRIOR_DECISIONS });
    assertRefused(r, 12, 'labels-unreadable', "re-run once the record's labels can be read");
    assert.deepEqual(r.asked, [], stdout);
  }
});

test('AC6.2: a CLOSED record with an accepted typed command is refused as not open, before the rule runs', () => {
  const r = named12(ungranted(12, { state: 'CLOSED' }));
  assert.ok(!inGroups(r, 12));
  assert.ok(r.stdout.includes('#12 is closed — not built: the queue pull takes open records only\n'), r.stdout);
  assert.ok(!r.stdout.includes('#12 has no auto:build label'), 'no rule line');
  assert.deepEqual(r.asked, [], 'the transcript check is never called');
  assert.equal(r.decisions, PRIOR_DECISIONS);
  assertNoLabelWrite(r);
});

for (const label of ['bot:blocked', 'bot:parked', 'parked']) {
  test(`AC15: with an accepted typed command, a record carrying ${label} is not admitted by the queue pull (held)`, () => {
    const r = named12(ungranted(12, { labels: ['ready', label] }));
    assertRefused(r, 12, 'held', 'clear bot:blocked, bot:parked or parked on #12 once its trigger has fired, then type the command again');
    assert.deepEqual(r.asked, []);
  });
}

test('AC6.3: --named 12,13 with an accepted command for 12 only admits 12 and refuses 13', () => {
  const r = pullNamed(withNamedView(S1(), [ungranted(12), ungranted(13)]), { named: [12, 13], typedFor: [12] });
  assert.ok(inGroups(r, 12));
  assert.ok(!inGroups(r, 13));
  assert.ok(r.stdout.includes(ADMIT_LINE(12)), r.stdout);
  assert.ok(r.stdout.includes('#13 has no auto:build label — not built: typed command not accepted (not-typed); '), r.stdout);
  assert.equal(autoLines(r).length, 1);
  assert.match(autoLines(r)[0], AUTO_RE(12));
  assert.deepEqual(r.asked, [12, 13]);
  assertNoLabelWrite(r);
});

test('AC6.4: an ungranted #14 sharing a Key File with admitted #12, not named, is not in the groups and is never fetched', () => {
  const r = pullNamed(withNamedView(S1(), [ungranted(12), ungranted(14, { body: withBody(12) })]), { named: [12], typedFor: [12, 14] });
  assert.ok(inGroups(r, 12));
  assert.ok(!inGroups(r, 14));
  assert.deepEqual(viewCalls(r).map((a) => a[2]), ['12']);
  assert.deepEqual(r.asked, [12]);
});

test('Review Focus 4: --named 12,13 with #12 already granted (in the pool) leaves 12 untouched: no fetch, no line, no AUTO line', () => {
  const s = withNamedView(withPooled(S1(), ghRecord(12, { body: withBody(12) })), [ungranted(13)]);
  const r = pullNamed(s, { named: [12, 13], typedFor: [12, 13] });
  assert.ok(inGroups(r, 12));
  assert.ok(inGroups(r, 13));
  assert.deepEqual(viewCalls(r).map((a) => a[2]), ['13'], 'no issue view for the pooled #12');
  assert.ok(!r.stdout.includes('#12 '), r.stdout);
  assert.equal(autoLines(r).length, 1);
  assert.match(autoLines(r)[0], AUTO_RE(13));
  assert.deepEqual(r.asked, [13]);
  assertNoLabelWrite(r);
});

test('#5584: a named record that is labelled auto:build but missing from the pool is not admitted and prints one line saying so', () => {
  const r = pullNamed(withNamedView(S1(), [ghRecord(12, { body: withBody(12) })]), { typedFor: [12] });
  assert.ok(!inGroups(r, 12));
  assert.equal(r.stdout, "#12 carries auto:build but is not in this pull's queue — not built this firing\n");
  assert.deepEqual(r.asked, [], 'the label answer reads no transcript');
  assert.equal(r.decisions, null);
});

test('#5584: a failed AUTO-line write does not admit the record (fail closed), prints one not-admitted line and names the failure on stderr', () => {
  const r = pull4(withNamedView(S1(), [ungranted(12)]), {
    env: TYPED_ENV,
    prepare: () => ({ named: [12], runDir: null }),
    deps: { readTypedCommand: () => ({ answer: 'typed', promptId: 'p-1' }), appendDecision: () => { throw new Error('disk full'); } },
  });
  assert.ok(!inGroups(r, 12));
  assert.match(r.stderr, /queue-pull: named #12: disk full/);
  assert.equal(r.cap.stdout.join(''), '#12 not admitted: the decisions.md audit line could not be written\n');
  assert.deepEqual(r.state.typedNumbers, new Set());
});

test('#5584 review: a failed queue-file write after the AUTO line un-admits the record, prints a second not-admitted line and writes a corrective decisions line', chmodDenialSkip('root bypasses mode bits'), () => {
  const texts = [];
  const r = pull4(withNamedView(S1(), [ungranted(12)]), {
    env: TYPED_ENV,
    prepare: () => ({ named: [12], runDir: null }),
    deps: {
      readTypedCommand: () => ({ answer: 'typed', promptId: 'p-1' }),
      // The first (admission) AUTO write also makes the queue file read-only, so the write after the loop fails.
      appendDecision: ({ text }) => {
        texts.push(text);
        if (texts.length === 1) fs.chmodSync(sessionPaths('qp-t3')['dispatch-queue-raw.json'], 0o444);
      },
    },
  });
  assert.ok(!inGroups(r, 12));
  assert.deepEqual(r.state.typedNumbers, new Set());
  assert.match(r.stderr, /queue-pull: write dispatch-queue-raw\.json:/);
  const out = r.cap.stdout.join('');
  assert.ok(out.includes(ADMIT_LINE(12)), out);
  assert.ok(out.endsWith('#12 not admitted: the queue file could not be written\n'), out);
  assert.equal(texts.length, 2);
  assert.equal(texts[1], '#12 not admitted after all: the queue file could not be written');
});

test('#5584 fix 1: a typed record carrying bot:in-progress is refused before admission: one claimed line, no AUTO line', () => {
  const r = pullNamed(withNamedView(S1(), [ungranted(12, { labels: ['ready', 'bot:in-progress'] })]), { typedFor: [12], decisions: PRIOR_DECISIONS });
  assert.ok(!inGroups(r, 12));
  assert.equal(r.stdout, '#12 is already claimed (bot:in-progress) — not built this firing\n');
  assert.deepEqual(r.asked, [12], 'the rule runs first (it answered typed); the claim is checked before admission');
  assert.equal(r.decisions, PRIOR_DECISIONS, 'no AUTO line for a record the eligibility filter would drop');
  assert.deepEqual(r.state.typedNumbers, new Set());
  assertNoLabelWrite(r);
});

test('#5584 fix 2 (AC15): bot:in-progress beside bot:parked keeps the rule\'s held line, not the claimed line', () => {
  const r = named12(ungranted(12, { labels: ['ready', 'bot:in-progress', 'bot:parked'] }));
  assertRefused(r, 12, 'held', 'clear bot:blocked, bot:parked or parked on #12 once its trigger has fired, then type the command again');
  assert.ok(!r.stdout.includes('already claimed'), r.stdout);
  assert.deepEqual(r.asked, []);
});

test('#5584 fix 2 (AC6): bot:in-progress with no ready keeps the rule\'s not-ready line, not the claimed line', () => {
  const r = named12(ungranted(12, { labels: ['bot:in-progress'] }));
  assertRefused(r, 12, 'not-ready', 'run /claude-tweaks:specify #12');
  assert.ok(!r.stdout.includes('already claimed'), r.stdout);
  assert.deepEqual(r.asked, []);
});

test('#5584: under --transport files, --named admits nothing and prints one refusal line per named number; no gh call', () => {
  const out = [];
  const r = pull(S1(), {
    transport: 'files',
    passes: PASSES.slice(0, 2),
    run: (cmd, args) => { throw new Error(`no ${cmd} on files: ${args.join(' ')}`); },
    prepare: (own) => ({ named: [12, 13], runDir: own, inputs: { queueRaw: writeInput(own, 'queue.json', JSON.stringify([mcpRecord(9001, withBody(9001))])) } }),
    deps: { stdout: (s) => out.push(s), readTypedCommand: () => { throw new Error('never asked'); } },
  });
  assert.deepEqual(out, [
    '#12: --named admits nothing under --transport files; the auto:build label is required\n',
    '#13: --named admits nothing under --transport files; the auto:build label is required\n',
  ]);
  assert.deepEqual(r.ghCalls, []);
  assert.deepEqual(r.json('dispatch-queue-raw.json').map((i) => i.number), [9001]);
  assert.deepEqual(r.state.typedNumbers, new Set());
});

test('#5584: with no named option the pull makes no record fetch and still reads and writes the cache', () => {
  const r = pull(S1());
  assert.deepEqual(r.state.typedNumbers, new Set());
  assert.equal(r.store.written.length, 1);
  assert.equal(viewCalls(r).length, 0);
});

// ---- #5584 CLI: --named / --run ----------------------------------------------------------------------
// A stand-in main checkout: a `.git` directory, and one firing run dir under .claude-tweaks/pipelines.
function withMainCheckout(fn) {
  const root = fs.realpathSync(scratchDir('qp-main-'));
  try {
    fs.mkdirSync(path.join(root, '.git'));
    const runDir = path.join(root, '.claude-tweaks', 'pipelines', 'run-1');
    fs.mkdirSync(runDir, { recursive: true });
    return fn({ root, runDir });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}
const listing = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir).sort() : null);

test('AC7.1: parseArgs reads --named as a list of record numbers (# optional) and --run as given', () => {
  assert.deepEqual(cli.parseArgs(['--transport', 'gh', '--named', '#12,13', '--run', 'run-1']),
    { mode: 'pull', transport: 'gh', priority: null, inputs: {}, named: [12, 13], run: 'run-1' });
  assert.deepEqual(cli.parseArgs(['--transport', 'gh', '--named', '12,#12', '--run', 'r']).named, [12], 'a repeated number is read once');
});

test('AC7.2: --named without --run, --run without --named, an empty or non-numeric list, or --named with --rank exits 1 and touches nothing', () => {
  const cases = [
    ['--transport', 'gh', '--named', '12'], ['--transport', 'files', '--named', '12'],
    ['--transport', 'gh', '--run', 'run-1'],
    ['--transport', 'gh', '--named', '', '--run', 'run-1'], ['--transport', 'gh', '--named', ' ', '--run', 'run-1'],
    ['--transport', 'gh', '--named', 'abc', '--run', 'run-1'], ['--transport', 'gh', '--named', '12,', '--run', 'run-1'],
    ['--transport', 'gh', '--named', ',12', '--run', 'run-1'], ['--transport', 'gh', '--named', '12,x', '--run', 'run-1'],
    ['--transport', 'gh', '--named', '0', '--run', 'run-1'], ['--transport', 'gh', '--named', '12, 13', '--run', 'run-1'],
    ['--transport', 'gh', '--named', '1.5', '--run', 'run-1'], ['--transport', 'gh', '--named', '##12', '--run', 'run-1'],
    ['--transport', 'gh', '--named', '99999999999999999999', '--run', 'run-1'],
    ['--transport', 'gh', '--named', '12', '--named', '13', '--run', 'run-1'],
    ['--rank', '--named', '12'], ['--rank', '--named', '12', '--run', 'run-1'], ['--rank', '--run', 'run-1'],
    ['--named', '12', '--run', 'run-1'],
  ];
  for (const argv of cases) {
    const out = []; const err = [];
    const code = cli.run(argv, touchNothing(out, err));
    assert.equal(code, 1, JSON.stringify(argv));
    assert.ok(err.join('').endsWith(cli.USAGE), `usage printed for ${JSON.stringify(argv)}`);
    assert.deepEqual(out, []);
  }
});

test('AC7.3: a --run that names no run directory, or one resolveTarget refuses, exits 1 before gh is probed, and writes nothing', () => withMainCheckout(({ root, runDir }) => {
  const outside = fs.realpathSync(scratchDir('qp-outside-'));
  const linked = path.join(root, 'linked');
  fs.mkdirSync(path.join(linked, 'run-2'), { recursive: true });
  fs.writeFileSync(path.join(linked, '.git'), 'gitdir: /nowhere/.git/worktrees/linked\n');
  try {
    const before = { runDir: listing(runDir), outside: listing(outside), linked: listing(path.join(linked, 'run-2')) };
    // `.` and `..` are bare ids that would land on pipelines/ itself or on .claude-tweaks/.
    for (const run of ['run-missing', '.', '..', path.join(root, 'nope'), outside, path.join(linked, 'run-2')]) {
      for (const transport of ['gh', 'files']) {
        let probed = 0; let pulled = 0;
        const r = cliRun(['--transport', transport, '--named', '12', '--run', run], {
          env: {}, cwd: root, ghAvailable: () => { probed += 1; return true; }, queuePull: () => { pulled += 1; },
        });
        assert.equal(r.code, 1, `${transport} ${run}: ${r.stderr}`);
        assert.match(r.stderr, /--run/);
        assert.equal(r.stdout, '');
        assert.deepEqual([probed, pulled], [0, 0]);
      }
    }
    assert.deepEqual({ runDir: listing(runDir), outside: listing(outside), linked: listing(path.join(linked, 'run-2')) }, before);
    // A cwd outside any checkout cannot place a bare run id.
    const r = cliRun(['--transport', 'gh', '--named', '12', '--run', 'run-1'], { env: {}, cwd: outside, ghAvailable: () => true, queuePull: () => {} });
    assert.equal(r.code, 1);
  } finally {
    fs.rmSync(outside, { recursive: true, force: true });
  }
}));

test('#5830: --run naming a directory outside .claude-tweaks/pipelines/ is refused', () => withMainCheckout(({ root }) => {
  const stray = path.join(root, 'plugin');
  fs.mkdirSync(stray);
  for (const transport of ['gh', 'files']) {
    let probed = 0; let pulled = 0;
    const r = cliRun(['--transport', transport, '--named', '12', '--run', stray], {
      env: {}, cwd: root, ghAvailable: () => { probed += 1; return true; }, queuePull: () => { pulled += 1; },
    });
    assert.equal(r.code, 1, `${transport}: ${r.stderr}`);
    assert.match(r.stderr, /not a pipeline run directory/);
    assert.equal(r.stdout, '');
    assert.deepEqual([probed, pulled], [0, 0]);
    assert.equal(fs.existsSync(path.join(stray, 'decisions.md')), false, 'nothing is written into the stray directory');
  }
}));

test('AC7.4: a bare --run id resolves under <main>/.claude-tweaks/pipelines, a path is used as given; named and the run dir reach queuePull', () => withMainCheckout(({ root, runDir }) => {
  const sub = path.join(root, 'plugin');
  fs.mkdirSync(sub);
  for (const [cwd, run] of [[root, 'run-1'], [sub, 'run-1'], [sub, runDir], [root, path.join('.claude-tweaks', 'pipelines', 'run-1')]]) {
    const seen = [];
    const r = cliRun(['--transport', 'gh', '--named', '#12,13', '--run', run], {
      env: { CLAUDE_CODE_SESSION_ID: 's' }, cwd, ghAvailable: () => true, queuePull: (o) => { seen.push(o); return {}; },
    });
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual(seen[0].named, [12, 13]);
    assert.equal(seen[0].runDir, runDir, `${cwd} ${run}`);
  }
  // Without --named the options passed to queuePull carry no new key.
  const plain = [];
  cliRun(['--transport', 'gh'], { env: {}, cwd: root, ghAvailable: () => true, queuePull: (o) => { plain.push(o); return {}; } });
  assert.deepEqual(Object.keys(plain[0]).sort(), ['cwd', 'env', 'inputs', 'omit', 'sessionId', 'transport']);
}));

test('#5584 CLI: under --transport files, --named with a valid --run reaches the module, which prints the refusal line per number', () => withMainCheckout(({ root }) => {
  const seen = [];
  const r = cliRun(['--transport', 'files', '--named', '12', '--run', 'run-1'], {
    env: {}, cwd: root, queuePull: (o, io) => { seen.push(o); io.stdout('#12: --named admits nothing under --transport files; the auto:build label is required\n'); },
  });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(seen[0].transport, 'files');
  assert.deepEqual(seen[0].named, [12]);
}));

test('#5584 CLI: the header and USAGE name --named and --run', () => {
  assert.match(cli.USAGE, /--named <n\[,m…\]> --run <id-or-path>/);
  const header = readText(CLI_PATH).split('\n').filter((l) => l.startsWith('//')).join('\n');
  assert.match(header, /--named/);
  assert.match(header, /--run/);
});

// ---- #5310: a failed dependency-freshness search warns, once per failed search -------------------
const depWarnings = (r) => r.stderr.split('\n').filter((l) => l.startsWith('Warning: dependency-freshness'));

test('AC1.1 (#5310): a failed dep-freshness search on a warm cache prints the line naming it and recomputes rather than cache-hitting', () => {
  const miss = pull(S1());
  const blob = miss.store.written[0].blob;
  const r = pull(failGh(S1(), DEP_SEARCH_8000), { persisted: blob });
  assert.equal(r.state.cacheHit, false);
  assert.ok(!r.stderr.includes(HIT_MESSAGE));
  assert.deepEqual(r.json('dispatch-groups.json'), miss.json('dispatch-groups.json'), 'the recompute reaches the miss\'s groups');
  // S1's write-back searches the same #8000, so it fails too: one line per failed search, in order.
  assert.deepEqual(depWarnings(r), [DEP_FRESH_USED, DEP_FRESH_WRITTEN]);
  assert.equal(r.store.written.length, 0, 'no blob persisted over the incomplete signal');
  assert.ok(!/queue-pull: /.test(r.stderr), 'no step diagnostic beside the Warnings');
});

test('#5310: a failed write-back dep-freshness search warns once and persists no queue-order blob', () => {
  const r = pull(failGh(S1(), DEP_SEARCH_8000));
  assert.deepEqual(depWarnings(r), [DEP_FRESH_WRITTEN]);
  assert.equal(r.store.written.length, 0);
  assert.ok(!/queue-pull: /.test(r.stderr), 'no step diagnostic beside the Warning');
});

test('#5310 control: a cold pull with the search answered prints no dep-freshness Warning and persists the blob', () => {
  const r = pull(S1());
  assert.deepEqual(depWarnings(r), []);
  assert.equal(r.store.written.length, 1);
});

// ---- #6119: the driver-lane pass (session drain leaves driver-routable singletons to the script job) ----

const LANE_PASS_IDS = ['truncate', 'fetch', 'blocked', 'oversized', 'write-back', 'driver-lane'];
const LANE_PASSES = PASSES.filter((p, i) => LANE_PASS_IDS.includes(p.id) && PASSES.findIndex((q) => q.id === p.id) === i);
const routablePolicy = (numbers, over = {}) => () => ({
  ...EXPRESS_OFF(), driverOn: true, routing: 'on', driverRoutable: (i) => numbers.includes(i.number), ...over,
});
const { DRIVER_ESCALATION_MARKER } = require('../../../plugin/bin/lib/driver/settle');
const TRUSTED_MARKER = { body: `escalated\n${DRIVER_ESCALATION_MARKER}`, authorAssociation: 'OWNER', url: 'u', author: 'a' };
const cannedComments = (byNumber, seen = []) => (args) => {
  seen.push(args);
  return { status: 0, stdout: JSON.stringify(Object.fromEntries(args[0].split(',').map((n) => [n, byNumber[n] || { comments: [], complete: true }]))), stderr: '' };
};
const lanePull = (o = {}) => pull(S1(), { passes: LANE_PASSES, ...o, deps: { readDriverRunner: () => 'script', expressQueuePolicy: routablePolicy([9003]), ...(o.deps || {}) } });
const commentCalls = (r) => r.cliCalls.filter(([n]) => n === 'resolve-record-comments.js');

test('AC1.1 script: one driver-routable singleton and one standard record — only the standard record is selectable', () => {
  const seen = [];
  const r = lanePull({ spawn: { 'resolve-record-comments.js': cannedComments({}, seen) } });
  assert.deepEqual(entriesOf(r, 'driver-lane'), [{ reason: 'driver-lane', records: [9003], detail: { runner: 'script' } }]);
  assert.deepEqual(groupNumbers(r), [[9001], [9003]], 'the routable record stays in dispatch-groups.json');
  assert.deepEqual(rankNext(r.json('dispatch-groups.json'), r.json('dispatch-exclusions.json')).map((c) => c.number), [9001]);
  assert.deepEqual(seen, [['9003']], 'one batched comment read over the routable candidates only');
});

test('AC1.2 / AC2.1 / AC2.2 session and unset produce byte-identical groups, exclusions and stderr (the pass runs, no comment read)', () => {
  const { readDriverRunner: realReadDriverRunner } = require('../../../plugin/bin/lib/dispatch/driver-lane');
  const ran = [];
  const run = (deps) => pull(S1(), { passes: LANE_PASSES, deps: { expressQueuePolicy: routablePolicy([9003]), onPass: (id) => ran.push(id), ...deps } });
  const session = run({ readDriverRunner: () => 'session' });
  // The unset leg reads the real runner over a resolver that returns no entry for the key.
  const unset = run({ readDriverRunner: (o) => realReadDriverRunner({ ...o, resolvePolicy: () => ({}) }) });
  const baseline = pull(S1(), { passes: LANE_PASSES });
  assert.equal(ran.filter((id) => id === 'driver-lane').length, 2, 'the driver-lane pass ran once under each runner');
  for (const r of [session, unset]) {
    assert.deepEqual(commentCalls(r), []);
    assert.equal(r.text['dispatch-groups.json'], baseline.text['dispatch-groups.json']);
    assert.equal(r.text['dispatch-exclusions.json'], baseline.text['dispatch-exclusions.json']);
    assert.equal(r.stderr, baseline.stderr);
    assert.deepEqual(entriesOf(r, 'driver-lane'), []);
  }
});

test('AC5.2 express-driver off with script: nothing excluded, the one ignored line', () => {
  const r = lanePull({ deps: { expressQueuePolicy: routablePolicy([9003], { driverOn: false, routing: 'off' }) } });
  assert.deepEqual(entriesOf(r, 'driver-lane'), []);
  assert.deepEqual(commentCalls(r), []);
  assert.equal(r.errs.filter((l) => l.startsWith('express-driver-runner: script ignored while express-driver is off')).length, 1);
});

test('AC9.2 the left-to-the-script-job line on stderr names the excluded record', () => {
  const r = lanePull({ spawn: { 'resolve-record-comments.js': cannedComments({}) } });
  assert.ok(r.errs.includes('driver-lane: left to the script job: #9003\n'), r.stderr);
});

test('AC3.1 through the module: a trusted escalation marker keeps the record selectable', () => {
  const seen = [];
  const r = lanePull({ spawn: { 'resolve-record-comments.js': cannedComments({ 9003: { comments: [TRUSTED_MARKER], complete: true } }, seen) } });
  assert.deepEqual(seen, [['9003']], 'the batched read happened, so the marker is what spared the record');
  assert.deepEqual(entriesOf(r, 'driver-lane'), []);
});

test('AC3.2 through the module: a failed comment spawn keeps the record with one Warning', () => {
  const r = lanePull({ spawn: { 'resolve-record-comments.js': { status: 1, stdout: '', stderr: 'boom\n' } } });
  assert.deepEqual(entriesOf(r, 'driver-lane'), []);
  assert.equal(r.errs.filter((l) => l.startsWith('Warning: driver-lane comment read failed')).length, 1);
});

test('driver-lane files transport fails open: no spawn, one Warning', () => {
  const r = lanePull({ transport: 'files', run: noGhOnFiles, prepare: nativeFiles });
  assert.deepEqual(commentCalls(r), []);
  assert.deepEqual(entriesOf(r, 'driver-lane'), []);
  assert.equal(r.errs.filter((l) => l.startsWith('Warning: driver-lane comment read failed')).length, 1);
});

test('driver-lane: omitting it keeps the records unexcluded, reads nothing, and still writes the queue-order blob', () => {
  const r = lanePull({ omit: ['driver-lane'], spawn: {} });
  assert.deepEqual(entriesOf(r, 'driver-lane'), []);
  assert.deepEqual(commentCalls(r), []);
  assert.equal(r.store.written.length, 1, 'a pass after write-back cannot change the blob');
  assert.equal(pull(S1(), { passes: LANE_PASSES, omit: ['oversized'] }).store.written.length, 0, 'a pass before write-back still suppresses it');
});

test('driver-lane: a corrupt exclusions file stops the pull with the pass-named line; an unrelated throw is a step error', () => {
  const stop = lanePull({
    allowThrow: true, spawn: { 'resolve-record-comments.js': cannedComments({}) },
    deps: { onPass: (id) => { if (id === 'driver-lane') fs.writeFileSync(sessionPaths('qp-t3')['dispatch-exclusions.json'], '{corrupt'); } },
  });
  assert.ok(stop.thrown instanceof QueuePullStopped, String(stop.thrown));
  assert.match(stop.thrown.line, /^dispatch: queue-pull stopped -- driver-lane exclusion pass hit a corrupt exclusions file: /);
  const soft = lanePull({ deps: { readDriverRunner: () => { throw new Error('runner exploded'); } } });
  assert.deepEqual(entriesOf(soft, 'driver-lane'), []);
  assert.ok(soft.errs.some((l) => l.startsWith('queue-pull: driver-lane: runner exploded')), soft.stderr);
});
