'use strict';
// #5227: queue-pull module parity suite. The bash oracle runs plugin/skills/dispatch/
// queue-pull-script.md's fence whole, in a throwaway sandbox under PATH shims for gh, git and
// mktemp (tests/bin-lib/dispatch/queue-pull-oracle.js), with a frozen clock preloaded into every
// node process (queue-pull-clock-stub.js).
//
// Normalizations (AC1, and nothing else): the sandbox root becomes <SCR> and the pre-minted
// run-dir basename becomes <RUN>. The clock is frozen by the stub rather than normalized, and
// temp names match across sides through the QP_TMPNAME_COUNTER_FILE seam.
// One documented exception (controller ruling, Task 4 review): the four failure lines whose fence
// tail is `$(cat <err file>)` (the not-spec-shaped and open-pr corrupt-exclusions stop lines and
// the not-spec-shaped / open-linked-PR filtering Warnings) compare up to and including their fixed
// prefix, tail excluded. The fence's tail opens with Node's uncaught-exception header (a throw-site
// file:line or a node:internal loader line, Node-version dependent, absent from err.stack); the
// module prints err.message. See TAIL_LINES in queue-pull-oracle.js. The same tail is the whole of
// the .err file the line reads, so on a fault row that prints such a line that one .err file
// compares by its fixed part only (written and non-empty on both sides, the module's message inside
// the oracle's report; faultComparison); every other .err file compares whole.
// One exit-code mapping, not a normalization (R4): where the fence stops (`exit 1`), the CLI exits 4,
// so the parity tests compare a stopped pair's statuses as 1 and 4 and everything else as is.
//
// Script defects the parity matrix (Task 8) shows, reproduced by the module, never fixed:
//   - A candidate whose `labels` is not an array (SMalformed's #9020) throws inside the eligibility
//     block (record-vocabulary.js's normalizeLabelNames calls .map on it), so the eligible list is
//     never written and the pull stops at the group-building check: one malformed record stops
//     every candidate, the clean #9001 included (a cross-candidate effect, on the run ledger).
// Script behavior the fault rows (Task 9) show, reproduced by the module, never fixed:
//   - D1 reaches past the session files: the second pull's write-back persists the first pull's
//     stale groups under the second pull's freshness signal, so a third pull over the same queue
//     would hit the cache on them (NEW: beyond ledger row 1, which names the session files only).
//   - One failed native-dependency GraphQL call (F-native) turns off two passes: the blocked pass's
//     native filtering and, through preflight-records.js's native read, the unlanded-blocker pass
//     (a Warning each). One failed claim fetch (F-claim) prints an AUTO line for the shipped pass and
//     one for the neighbour pass. (NEW cross-pass effects; each pass still fails open.)
//   - A missing or malformed DISPATCH_FOREIGN_STATES file on files prints two fail-closed Warnings:
//     the ignored file, then the gh lookup bodyForeignBlockers still attempts with no gh.
//   - A failed queue or open-numbers fetch stops the pull at the group-building check (the fetch
//     pass's `stop`), a third and fourth stop beside Q3's corrupt-exclusions and unreadable-groups.
//   - F-linked's single Warning (the open-linked-PR lookup failed) also turns off the shipped pass:
//     it drops shipped:9010 as well as the two open-pr exclusions. F-intbranch (no integration-branch
//     policy key, `git remote show origin` fails) drops the unlanded-blocker:9011 exclusion. (NEW
//     cross-pass effects; each pass still fails open.)
//   - A silent fail-open on the files transport: files-verifiedOpenDeps-missing and
//     files-verifiedOpenDeps-malformed exit 0 with no Warning or AUTO line and drop the blocked:9002
//     exclusion, so a blocked record becomes dispatchable with nothing printed (the files twin of
//     F-depview).
//   - The silent fail-opens (ledger row 6) are F-depfresh, F-depview, F-prview and F-openprs.
// One module divergence the matrix found and the module fixed (Task 3 carry): on `files` the
// agent's dependency-freshness file stands where the fence's `gh issue list --search` stands, so
// it is read only when there are dependency numbers to search; otherwise the fence's `echo '[]'`
// holds (S2-files-miss, whose queue declares no dependency, diverged on the write-back blob).
const { test, mock, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { readText } = require('../../helpers/read-skill');
const { gitRepo, fixtureGit } = require('../../helpers/git-fixtures');
const {
  REPO, SCRIPT_MD, MCP_MD, FENCE_FIRST_LINE, RUN_DIR_NAME,
  oracleSkip, extractFence, fenceSessionFiles, filesOracleScript, createSandbox, runOracle, runModuleCli, runPair, withEscapeGuard, normalize, reported, assertParity, runAll, failedJobs,
  STREAM_TRUNCATED, TAIL_LINES,
} = require('./queue-pull-oracle');
const {
  S0, S1, S2, SEmpty, SMalformed, SPortable, SFast, fakeRun, fakeSpawnCli, agentInputs, ghRecord, withBody, QUEUE_ARGV, DEP_SEARCH_8000, mention, WEAK_PR_FILES,
  IN_FLIGHT_7001, OPEN_PR_41, LIVE_CLAIM, LANDING_COMMIT, PORTABLE_SLUG, FAULTS, FILES_FAULTS, D1Second, S1LiveDep, NOT_JSON,
} = require('./queue-pull-fixtures');
const {
  PASSES, PASS_FIELD_VALUES, SESSION_FILES, QueuePullStopped, sessionPaths, runPasses, resolveOmit, defaultDeps, makeContext, queuePull, rankNext, rankFromFiles,
} = require('../../../plugin/bin/lib/dispatch/queue-pull');
const { appendExclusion } = require('../../../plugin/bin/lib/dispatch/exclusions');
const { aliasMcpTimestamps } = require('../../../plugin/bin/lib/issues/mcp-issue-shape');

const FENCE = extractFence(readText(SCRIPT_MD), FENCE_FIRST_LINE);
const ORACLE_ENV_KEYS = new Set([
  'PATH', 'HOME', 'PWD', 'OLDPWD', 'TMPDIR', 'TZ', 'LANG', 'CLAUDE_PLUGIN_ROOT', 'CLAUDE_CODE_SESSION_ID',
  'GIT_CEILING_DIRECTORIES', 'GIT_CONFIG_NOSYSTEM', 'GIT_CONFIG_GLOBAL', 'GIT_AUTHOR_DATE', 'GIT_COMMITTER_DATE',
  'QP_SHIM_TABLE', 'QP_LOG_DIR', 'QP_TMPNAME_COUNTER_FILE', 'NODE_OPTIONS',
]);

test('#5227 oracle: queue-pull-script.md runs whole over a one-record fixture', { skip: oracleSkip() }, async () => {
  const r = await withEscapeGuard(REPO, () => runOracle(createSandbox(S0()), FENCE));
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.files['dispatch-groups.json']).flat().map((c) => c.number), [9001]);
  assert.deepEqual(JSON.parse(r.files['dispatch-exclusions.json']), []);
  assert.equal(r.ghArgv.filter((a) => a.tag === 'UNHANDLED').length, 0);
  assert.deepEqual(r.gitArgv.filter((a) => a.tag === 'REFUSED'), [], 'the fence never trips the git shim containment');
  // The write-back reached the sandbox origin, stamped by the preloaded frozen clock.
  assert.equal(r.orderBlob.computedAt, '2026-11-12T12:00:00.000Z');
});

test('#5227 oracle: an unmatched gh call fails loudly (go-red control for the shim table)', { skip: oracleSkip() }, async () => {
  const s = S0(); s.gh = s.gh.filter((e) => !(Array.isArray(e.argv) && e.argv.includes('number') && e.argv.includes('200')));
  const r = await runOracle(createSandbox(s), FENCE);
  assert.match(r.stderr, /gh-shim: no canned response for: issue list --state open --json number --limit 200/);
});

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

test('#5227 oracle: the mktemp shim emits tmp.qp00000001 then tmp.qp00000002 from QP_TMPNAME_COUNTER_FILE', { skip: oracleSkip() }, () => {
  const sb = createSandbox(S0());
  try {
    const tmpdir = path.join(sb.root, 'tmp', 'mktemp-probe');
    fs.mkdirSync(tmpdir, { recursive: true });
    const env = sb.runEnv({ tmpdir, sessionId: 'qp-mktemp-probe' });
    assert.deepEqual(Object.keys(env).filter((k) => !ORACLE_ENV_KEYS.has(k) && !k.startsWith('CT_TRACE_')), [], 'nothing inherited');
    const mktemp = (args = []) => spawnSync(path.join(sb.bin, 'mktemp'), args, { env, encoding: 'utf8' });
    const first = mktemp();
    assert.equal(first.status, 0, first.stderr);
    assert.equal(first.stdout, path.join(tmpdir, 'tmp.qp00000001') + '\n');
    const second = mktemp();
    assert.equal(second.stdout, path.join(tmpdir, 'tmp.qp00000002') + '\n');
    assert.equal(fs.readFileSync(env.QP_TMPNAME_COUNTER_FILE, 'utf8'), '2');
    const refused = mktemp(['-d']);
    assert.equal(refused.status, 97);
    assert.deepEqual(fs.readdirSync(tmpdir).sort(), ['tmp.qp00000001', 'tmp.qp00000002']);
  } finally {
    sb.cleanup();
  }
});

test('#5227 oracle: the git shim refuses a directory outside the sandbox, an exported GIT_DIR and every -c key but core.quotePath', { skip: oracleSkip() }, () => {
  const sb = createSandbox(S0());
  try {
    const env = sb.runEnv({ tmpdir: path.join(sb.root, 'tmp'), sessionId: 'qp-git-probe' });
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
    const log = fs.readFileSync(path.join(sb.logs, 'git-argv.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
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
    const log = fs.readFileSync(path.join(sb.logs, 'git-argv.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
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
    const log = fs.readFileSync(path.join(sb.logs, 'gh-argv.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
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
  } finally {
    sb.cleanup();
  }
});

test('#5227 oracle: withEscapeGuard rejects a run that moves the guarded repo HEAD', async () => {
  const repo = gitRepo({ parent: fs.mkdtempSync(path.join(os.tmpdir(), 'qp-guard-')) });
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
        const sha = fixtureGit(['-C', repo, '-c', 'user.name=qp-oracle', '-c', 'user.email=qp@example.invalid', 'commit-tree', 'HEAD^{tree}', '-m', 'escaped'], { encoding: 'utf8' }).trim();
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
});

// ---- Task 2: registry, session paths, truncate pass, pass loop (in-process, any platform) ----

const SCRIPT_TEXT = readText(SCRIPT_MD);

// One assertion function serves the positive test and the go-red controls.
function assertRegistryMatchesBullets(passes, scriptText) {
  const bullets = scriptText.split(/\r?\n/).map((l) => ({ l, m: l.match(/^- `reason: '([a-z-]+)'`/) })).filter((x) => x.m);
  assert.ok(bullets.length >= 9, 'header bullet pattern no longer matches queue-pull-script.md');
  assert.deepEqual([...new Set(passes.map((p) => p.reason).filter(Boolean))].sort(), bullets.map((b) => b.m[1]).sort());
  for (const { l, m } of bullets) assert.equal(passes.find((p) => p.reason === m[1]).removes, !l.includes('stay IN `dispatch-groups.json`'), m[1]);
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

// Runs fn with TMPDIR (and the win32 spellings) pointed at a test-owned dir, never the host one.
function inOwnTmp(fn) {
  const own = fs.mkdtempSync(path.join(os.tmpdir(), 'qp-t2-'));
  const keys = ['TMPDIR', 'TEMP', 'TMP', 'QP_TMPNAME_COUNTER_FILE'];
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  for (const k of ['TMPDIR', 'TEMP', 'TMP']) process.env[k] = own;
  delete process.env.QP_TMPNAME_COUNTER_FILE;
  try {
    return fn(own);
  } finally {
    for (const k of keys) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
    fs.rmSync(own, { recursive: true, force: true });
  }
}

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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qp-t2-trunc-'));
  try {
    const paths = { 'dispatch-exclusions.json': path.join(dir, 'missing-dir', 'x.json') };
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

test('#5227 tmpName: random tmp.<10 alnum> by default; tmp.qp00000001, tmp.qp00000002 under QP_TMPNAME_COUNTER_FILE', () => inOwnTmp((own) => {
  const { tmpName } = defaultDeps();
  const random = tmpName();
  assert.equal(path.dirname(random), own);
  assert.match(path.basename(random), /^tmp\.[A-Za-z0-9]{10}$/);
  assert.equal(fs.readFileSync(random, 'utf8'), '', 'the file is created');
  assert.notEqual(tmpName(), random);

  const counter = path.join(own, 'counter');
  process.env.QP_TMPNAME_COUNTER_FILE = counter;
  const first = tmpName();
  const second = tmpName();
  assert.equal(path.basename(first), 'tmp.qp00000001');
  assert.equal(path.basename(second), 'tmp.qp00000002');
  assert.equal(path.dirname(first), own);
  assert.equal(fs.readFileSync(counter, 'utf8'), '2');
  assert.ok(fs.existsSync(first) && fs.existsSync(second));
}));

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

test('#5227 tmpName counter seam matches the oracle mktemp shim: refuses a bad counter, advances only after a successful create', () => inOwnTmp((own) => {
  const { tmpName } = defaultDeps();
  const counter = path.join(own, 'counter');
  process.env.QP_TMPNAME_COUNTER_FILE = counter;
  for (const bad of ['abc', '-1', '1.5', '']) {
    fs.writeFileSync(counter, bad);
    if (bad === '') { assert.equal(path.basename(tmpName()), 'tmp.qp00000001'); continue; }
    assert.throws(() => tmpName(), /counter file holds/, bad);
    assert.equal(fs.readFileSync(counter, 'utf8'), bad, 'a refused counter is left as it was');
  }
  fs.writeFileSync(counter, '4');
  fs.writeFileSync(path.join(own, 'tmp.qp00000005'), '');
  assert.throws(() => tmpName(), (e) => e.code === 'EEXIST');
  assert.equal(fs.readFileSync(counter, 'utf8'), '4', 'an EEXIST create does not advance the counter');
}));

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
    expressQueuePolicy: () => ({ enabled: false, grouping: 'per-record', keepSingleton: () => false }),
    createClaimReader: () => ({ read: () => ({ content: null }) }),
    onPass: (id) => seen.push(id),
    stderr: () => {},
  };
  const result = queuePull({ sessionId: 'qp-pull', cwd: own }, deps);
  assert.deepEqual(seen, ['truncate', 'fetch', 'blocked', 'oversized', 'write-back', 'not-spec-shaped', 'open-pr', 'target-missing', 'shipped',
    'blocker-landing', 'neighbour-in-flight', 'cross-pr-overlap', 'near-dup-pairs'], 'every distinct registry id has a runner and runs once, in registry order');
  assert.deepEqual(result.groups.flat().map((c) => c.number), [9001]);
  assert.deepEqual(result.exclusions, [], 'the pre-seeded non-firing entry is truncated by the first pass');
  assert.equal(fs.readFileSync(paths['dispatch-exclusions.json'], 'utf8'), '[]');
}));

// ---- Task 3: fetch, blocked, oversized (grouping) and write-back, both transports (in-process) ----

const T3_PASSES = PASSES.slice(0, 5); // truncate, fetch, blocked, oversized, write-back
const NOW = new Date('2026-11-12T12:00:00.000Z');
const EXPRESS_OFF = () => ({ enabled: false, grouping: 'per-record', keepSingleton: () => false });
const OPEN_NUMBERS_ARGV = ['issue', 'list', '--state', 'open', '--json', 'number', '--limit', '200'];

// Runs truncate..write-back over a scenario in a test-owned TMPDIR and returns everything a test
// asserts on. o: { transport, omit, persisted, writeResult, spawn (CLI overrides), env, inputs,
// prepare(own) -> extra options, before(ctx), deps, run, allowThrow }.
function pull(scenario, o = {}) {
  return inOwnTmp((own) => {
    const cwd = path.join(own, 'proj');
    fs.mkdirSync(cwd);
    const sessionId = o.sessionId || 'qp-t3';
    const paths = sessionPaths(sessionId);
    fs.mkdirSync(path.dirname(paths['dispatch-groups.json']), { recursive: true });
    const errs = [];
    const ghCalls = [];
    const base = o.run || fakeRun(scenario, { sessionDir: path.dirname(paths['dispatch-groups.json']) });
    const store = { persisted: o.persisted || null, written: [] };
    const spawnCli = fakeSpawnCli(scenario, o.spawn || {});
    const deps = {
      run: (cmd, args, opts) => { ghCalls.push(args); return base(cmd, args, opts); },
      spawnCli,
      stderr: (s) => errs.push(s),
      now: () => NOW,
      expressQueuePolicy: EXPRESS_OFF,
      // Production lets the library spawn resolve-foreign-blockers.js; tests inject through the seam.
      foreignDeps: { spawn: o.foreignSpawn || ((argv) => spawnCli(path.basename(argv[0]), argv.slice(1))) },
      queueOrder: {
        readOrder: () => store.persisted,
        writeOrder: (root, blob) => { store.written.push({ root, blob }); return o.writeResult || { ok: true }; },
      },
      ...(o.deps || {}),
    };
    const extra = o.prepare ? o.prepare(own) : {};
    const options = { transport: o.transport || 'gh', sessionId, cwd, env: o.env || {}, omit: o.omit || [], inputs: o.inputs, ...extra };
    const ctx = (o.lib || { makeContext }).makeContext(options, deps);
    if (o.before) o.before(ctx, own);
    let thrown = null;
    try { (o.lib || { runPasses }).runPasses(o.passes || T3_PASSES, ctx); } catch (err) { thrown = err; }
    if (thrown && !o.allowThrow) throw thrown;
    const text = {};
    for (const name of SESSION_FILES) if (fs.existsSync(paths[name]) && fs.statSync(paths[name]).isFile()) text[name] = fs.readFileSync(paths[name], 'utf8');
    // Any other file a pass left in the session dir (the shipped Close proposals).
    for (const name of fs.readdirSync(path.dirname(paths['dispatch-groups.json']))) {
      const file = path.join(path.dirname(paths['dispatch-groups.json']), name);
      if (!(name in text) && fs.statSync(file).isFile()) text[name] = fs.readFileSync(file, 'utf8');
    }
    for (const file of Object.values(ctx.state.files)) if (fs.existsSync(file)) text[file] = fs.readFileSync(file, 'utf8');
    return {
      thrown, cwd, errs, ghCalls, store, state: ctx.state, text, stderr: errs.join(''),
      cliCalls: spawnCli.calls.map((c) => [c.name, ...c.args]),
      json: (name) => JSON.parse(text[name]),
    };
  });
}

const groupNumbers = (r) => r.json('dispatch-groups.json').map((g) => g.map((c) => c.number));
const entriesOf = (r, reason) => r.json('dispatch-exclusions.json').filter((e) => e.reason === reason);
const fenceText = (re) => {
  const m = FENCE.match(re);
  assert.ok(m, `the fence no longer matches ${re}`);
  return m[1];
};
const CAP_WARNING = fenceText(/echo "(Warning: the auto:build queue pull returned exactly the --limit cap \(500\)[^"]*)" >&2/);
const HIT_MESSAGE = fenceText(/echo "(Queue-order cache hit [^"]*)" >&2/);
const NATIVE_WARNING_PREFIX = fenceText(/echo "(Warning: native dependency query failed[^$]*)\$\(cat /);
const GROUPING_STOP_RE = /echo "(dispatch: queue-pull stopped -- group-building exclusion pass failed \(exit )\$GROUPING_RC(\); see error above\.)" >&2/;
const CACHE_HIT_STOP_RE = /echo "(dispatch: queue-pull stopped -- cache-hit exclusion pass failed \(exit )\$CACHE_HIT_RC(\); see error above\.)" >&2/;
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

test('AC2.2 oversized: three fast-lane singletons bundle into one group over a guard of 2; omitting the pass keeps the group and bundle, writes no entry', () => {
  const positive = pull(SFast());
  assertOversized(positive);

  const omitted = pull(SFast(), { omit: ['oversized'] });
  asserts(() => assertOversized(omitted));
  assert.deepEqual(entriesOf(omitted, 'oversized'), []);
  assert.deepEqual(groupNumbers(omitted), [[9101, 9102, 9103]], 'the grouping block still ran');
  assert.deepEqual(omitted.json('dispatch-fastlane-bundles.json'), [{ records: [9101, 9102, 9103] }], 'the bundles file is still written');
});

test('#5227 oracle cross-check: the S1 and SFast fixtures give the oracle the same groups, blocked and oversized entries (PF15: the oversized entry is non-empty)', { skip: oracleSkip() }, async () => {
  for (const [scenario, reason] of [[S1(), 'blocked'], [SFast(), 'oversized']]) {
    const r = await withEscapeGuard(REPO, () => runOracle(createSandbox(scenario), FENCE));
    assert.equal(r.status, 0, r.stderr);
    const oracle = JSON.parse(r.files['dispatch-exclusions.json']).filter((e) => e.reason === reason);
    assert.ok(oracle.length > 0, `the oracle run of ${scenario.name} yields a ${reason} entry`);
    const mine = pull(scenario);
    assert.deepEqual(entriesOf(mine, reason), oracle);
    assert.deepEqual(mine.json('dispatch-groups.json'), JSON.parse(r.files['dispatch-groups.json']));
  }
});

test('#5227 native: work-links native spawns resolve-blockers.js over the eligible numbers and excludes through openBlockerRefs; a non-zero exit prints the fence Warning and filters nothing', () => {
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
  assert.ok(failed.errs.includes(`${NATIVE_WARNING_PREFIX}graphql down\n`), failed.stderr);
  assert.deepEqual(groupNumbers(failed), [[9001], [9003]], 'a failed native query filters nothing native');
  assert.deepEqual(failed.json('dispatch-native-deps.json'), {});

  const omitted = pull(scenario(), { omit: ['blocked'], spawn: {} });
  assert.deepEqual(omitted.cliCalls.filter(([n]) => n === 'resolve-blockers.js'), [], 'omitting blocked skips the native query');
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

function mcpRecord(number, body) {
  return {
    number, title: `Fixture record ${number}`, body, labels: [{ name: 'auto:build' }, { name: 'ready' }],
    created_at: '2026-11-01T10:00:00Z', updated_at: '2026-11-10T10:00:00Z', state: 'open',
  };
}

test('#5227 files: the queue file is copied into the session file and aliased there, dispatch-verified-open-deps.txt replaces the gh issue view loop, and no gh call is made', () => {
  const calls = [];
  const noGh = (cmd, args) => { calls.push([cmd, ...args]); throw new Error(`gh must not be called on files: ${args.join(' ')}`); };
  const write = (own, { verified }) => {
    const put = (name, content) => { const file = path.join(own, name); fs.writeFileSync(file, content); return file; };
    return {
      inputs: {
        queueRaw: put('queue.json', JSON.stringify([mcpRecord(9001, withBody(9001)), mcpRecord(9002, `Blocked by #8000\n\n${withBody(9002)}`)])),
        openNumbers: put('open.json', '[{"number":9001},{"number":9002}]'),
        depFreshness: put('dep.json', '[{"number":8000,"updated_at":"2026-11-09T10:00:00Z","state":"open"}]'),
        verifiedOpenDeps: verified === null ? path.join(own, 'absent.txt') : put('verified.txt', verified),
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
  assert.deepEqual(entriesOf(absent, 'blocked'), [], 'a missing verified-open-deps file reads as []');
  assert.deepEqual(groupNumbers(absent), [[9001], [9002]]);
  assert.deepEqual(calls, []);

  const foreign = pull(foreignScenario(), {
    transport: 'files', run: noGh, spawn: {},
    prepare: (own) => {
      const put = (name, content) => { const file = path.join(own, name); fs.writeFileSync(file, content); return file; };
      return { inputs: {
        queueRaw: put('q.json', JSON.stringify([mcpRecord(9001, `Blocked by acme-corp/other#12\n\n${withBody(9001)}`)])),
        openNumbers: put('o.json', '[{"number":9001}]'),
        depFreshness: put('d.json', '[]'),
        verifiedOpenDeps: put('v.txt', ''),
        foreignStates: put('f.json', '{"acme-corp/other#12":"OPEN"}'),
      } };
    },
  });
  assert.deepEqual(entriesOf(foreign, 'blocked'), [{ reason: 'blocked', records: [9001], detail: { blockedBy: ['acme-corp/other#12'] } }], 'PF17: foreignStates is read on files too');
  assert.deepEqual(foreign.cliCalls.filter(([n]) => n === 'resolve-foreign-blockers.js'), []);
});

// Task 8 (the files-transport reading, confirmed against filesOracleScript's S2-files-miss run): the
// agent's dependency-freshness file stands where the fence's `gh issue list --search` stands, so it
// is read only when there are dependency numbers to search. Otherwise the fence's `echo '[]'` holds.
test('#5227 files: the dependency-freshness file is used only where the fence searches; with no dependency the session file is [] and the input is not read', () => {
  const noGh = () => { throw new Error('no gh on files'); };
  const inputsWith = (queue, dep) => (own) => {
    const put = (name, content) => { const file = path.join(own, name); fs.writeFileSync(file, content); return file; };
    return { inputs: {
      queueRaw: put('queue.json', JSON.stringify(queue)),
      openNumbers: put('open.json', JSON.stringify(queue.map((r) => ({ number: r.number })).concat([{ number: 8000 }]))),
      depFreshness: dep === null ? path.join(own, 'absent-dep.json') : put('dep.json', dep),
      verifiedOpenDeps: put('verified.txt', ''),
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

test('#5227 D3: a non-array queue file such as {issues:[...]} reads as an empty queue, with no Warning, and the caller\'s file outside the session dir is left byte-identical', () => {
  const wrapper = JSON.stringify({ issues: [mcpRecord(9001, withBody(9001))] });
  const r = pull(S1(), {
    transport: 'files', run: () => { throw new Error('no gh on files'); },
    prepare: (own) => {
      const put = (name, content) => { const file = path.join(own, name); fs.writeFileSync(file, content); return file; };
      return { inputs: {
        queueRaw: put('queue.json', wrapper),
        openNumbers: put('open.json', '[]'),
        depFreshness: put('dep.json', '[]'),
        verifiedOpenDeps: put('verified.txt', ''),
      } };
    },
  });
  assert.notEqual(path.dirname(r.state.files.queueRaw), path.dirname(sessionPaths('qp-t3')['dispatch-queue-raw.json']), 'the caller file sits outside the session dir');
  assert.equal(r.text[r.state.files.queueRaw], wrapper, 'D3 rewrites the session copy, never the caller\'s file');
  assert.equal(r.text['dispatch-queue-raw.json'], '[]', 'D3 is unchanged: the session copy reads as []');
  assert.deepEqual(r.json('dispatch-groups.json'), []);
  assert.deepEqual(r.errs, [], r.stderr);
});

test('#5227 files: a queue file the agent never wrote removes the session copy (the agent write\'s rm -f) and stops the pull at group-building, as AC7.2 pins', () => {
  const r = pull(S1(), {
    transport: 'files', run: () => { throw new Error('no gh on files'); }, allowThrow: true,
    prepare: (own) => {
      const put = (name, content) => { const file = path.join(own, name); fs.writeFileSync(file, content); return file; };
      return { inputs: {
        queueRaw: path.join(own, 'absent-queue.json'),
        openNumbers: put('open.json', '[]'),
        depFreshness: put('dep.json', '[]'),
        verifiedOpenDeps: put('verified.txt', ''),
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

const T4_PASSES = PASSES.slice(0, 9); // truncate .. shipped
const T4_SESSION = 'qp-t3'; // pull()'s default session id
const FULL = () => S1({ full: true });

// pull() with the Task 4 CLIs faked: hooks.js answers the run dir (o.hooksOut(callIndex, runDir)
// overrides one answer), log-decision.js and stage-item.js record their argv and the staged file's
// body at call time, and the claim reader answers o.claims (number -> blob content, default absent).
function pull4(scenario, o = {}) {
  const cap = { runDir: null, hooks: [], log: [], staged: [], stdout: [], order: [] };
  const spawn = {
    'hooks.js': (args) => {
      cap.hooks.push(args);
      const out = o.hooksOut ? o.hooksOut(cap.hooks.length - 1, cap.runDir) : cap.runDir;
      return { status: 0, stdout: `${out}\n`, stderr: o.hooksErr ? o.hooksErr(cap.hooks.length - 1) : '' };
    },
    'log-decision.js': (args) => { cap.log.push(args); return { status: 0, stdout: `logged ${args[args.indexOf('--text') + 1]}\n`, stderr: '' }; },
    'stage-item.js': (args) => {
      const id = args[args.indexOf('--id') + 1];
      const file = args[args.indexOf('--file') + 1];
      cap.staged.push({ args, id, file, body: file && fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null });
      return { status: 0, stdout: `staged ${id}\n`, stderr: '' };
    },
    ...(o.spawn || {}),
  };
  const claims = o.claims || {};
  const r = pull(scenario, {
    passes: T4_PASSES,
    ...o,
    spawn,
    prepare: (own) => {
      cap.runDir = path.join(own, 'run');
      fs.mkdirSync(cap.runDir);
      return o.prepare ? o.prepare(own) : {};
    },
    deps: {
      stdout: (s) => cap.stdout.push(s),
      createClaimReader: () => ({ read: (n) => ({ content: Object.prototype.hasOwnProperty.call(claims, n) ? claims[n] : null }) }),
      onPass: (id) => cap.order.push(id),
      ...(o.deps || {}),
    },
  });
  return { ...r, cap, cli: (name) => r.cliCalls.filter(([n]) => n === name) };
}

const reasonsOf = (r, number) => r.json('dispatch-exclusions.json').filter((e) => e.records.includes(number)).map((e) => e.reason);
const PR_VIEW = (pr) => ['pr', 'view', String(pr), '--json', 'files', '-q', '[.files[].path]'];
const prViews = (r) => r.ghCalls.filter((a) => a[0] === 'pr' && a[1] === 'view');
const LINKED_WARNING = fenceText(/echo "(Warning: linked-PR query failed[^$]*)\$\(cat /);
const OPEN_FILTER_WARNING = fenceText(/echo "(Warning: open-linked-PR filtering failed[^$]*)\$\(cat /);
const SHAPE_WARNING = fenceText(/echo "(Warning: not-spec-shaped pass skipped[^$]*)\$\(cat /);
const SHAPE_STOP = fenceText(/echo "(dispatch: queue-pull stopped -- not-spec-shaped exclusion pass hit a corrupt exclusions file: )\$\(cat /);
const OPEN_STOP = fenceText(/echo "(dispatch: queue-pull stopped -- open-linked-PR exclusion pass hit a corrupt exclusions file: )\$\(cat /);
const TARGET_STOP = fenceText(/echo "(dispatch: queue-pull stopped -- target-missing exclusion pass failed \(exit )\$TARGET_MISSING_RC\); see error above\.\" >&2/);
const SHIPPED_STOP = fenceText(/echo "(dispatch: queue-pull stopped -- shipped-candidate exclusion pass failed; see error above\.)" >&2/);

// The target-missing Close proposal the fence's `echo` lines build, derived from the fence text.
function fenceTargetProposal(num, tpath, ref) {
  const block = FENCE.match(/TMP_PROPOSAL=\$\(mktemp\)\n {2}\{\n([\s\S]*?)\n {2}\} > "\$TMP_PROPOSAL"/);
  assert.ok(block, 'the fence no longer builds the proposal with an echo group');
  return block[1].split('\n').map((l) => {
    const m = l.trim().match(/^echo "(.*)"$/);
    assert.ok(m, `not an echo line: ${l}`);
    return m[1].replace(/\\(["`])/g, '$1').replace(/\$\{NUM\}/g, num).replace(/\$\{TPATH\}/g, tpath).replace(/\$\{INTEGRATION_REF\}/g, ref);
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
    'Warning: linked-PR query failed — falling back to no open-PR exclusion this run: kept whole',
  ].join('\n');
  assert.deepEqual(reported(text), [
    'dispatch: queue-pull stopped -- not-spec-shaped exclusion pass hit a corrupt exclusions file: ',
    'dispatch: queue-pull stopped -- open-linked-PR exclusion pass hit a corrupt exclusions file: ',
    'Warning: not-spec-shaped pass skipped — ',
    'Warning: open-linked-PR filtering failed — dispatch-groups.json left unfiltered for this exclusion this run: ',
    'Warning: linked-PR query failed — falling back to no open-PR exclusion this run: kept whole',
  ]);
});

test('AC2.1 target-missing: a target present at the integration tip is kept; the git probe argv is cat-file -e <ref>:<path>', () => {
  const scenario = { ...FULL(), origin: { branches: { main: { 'docs/gone.md': 'still here\n' } } } };
  const r = pull4(scenario);
  assert.deepEqual(entriesOf(r, 'target-missing').map((e) => e.records[0]), [9006]);
  assert.ok(groupNumbers(r).flat().includes(9009), 'a present target is not excluded');
  assert.deepEqual(r.cap.staged.map((s) => s.id).filter((id) => id.startsWith('dispatch-target-missing-')), ['dispatch-target-missing-9006']);
});

test('AC2.1 target-missing D2: --file is whatever deps.tmpName returns, so the staged id takes its random suffix; QP_TMPNAME_COUNTER_FILE makes it tmp.qp00000001', () => {
  const random = pull4(FULL());
  const randomFiles = random.cap.staged.filter((s) => s.id.startsWith('dispatch-target-missing-')).map((s) => s.file);
  assert.equal(randomFiles.length, 2);
  for (const file of randomFiles) assert.match(file, /tmp\.[A-Za-z0-9]{10}$/);
  assert.notEqual(randomFiles[0], randomFiles[1]);

  const seamed = pull4(FULL(), { prepare: (own) => { process.env.QP_TMPNAME_COUNTER_FILE = path.join(own, 'counter'); return {}; } });
  const seamFiles = seamed.cap.staged.filter((s) => s.id.startsWith('dispatch-target-missing-')).map((s) => s.file);
  assert.deepEqual(seamFiles.map((f) => path.basename(f)), ['tmp.qp00000001', 'tmp.qp00000002']);
  assert.deepEqual(seamFiles.map((f) => path.extname(f)), ['.qp00000001', '.qp00000002'], 'the extensionless mktemp name hands stage-item.js its extension (ledger row 2)');
  assert.equal(seamed.cap.staged[0].body, fenceTargetProposal('9006', 'docs/gone6.md', 'origin/main'));
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

test('#5227 shipped: a failing gh pr view prints nothing, reads as [] and the candidate stays weak', () => {
  const scenario = FULL();
  scenario.gh = scenario.gh.map((e) => (e.argv && e.argv[1] === 'view' ? { ...e, stdout: '', stderr: 'boom\n', status: 1 } : e));
  const r = pull4(scenario);
  assert.deepEqual(prViews(r), [PR_VIEW(5016)]);
  assert.equal(r.text['dispatch-shipped-pr-files.jsonl'], '{"pr":5016,"files":[]}\n', 'the fence reads the failed call as [] (`|| echo [])');
  assert.ok(groupNumbers(r).flat().includes(9016));
  assert.deepEqual(r.errs.filter((e) => e.startsWith('Warning:')), [], 'the silent fail-open prints no Warning');
  assert.ok(r.errs.includes('AUTO — dispatch: #9016 mentioned by merged PR #5016 without a closing keyword; dispatching anyway\n'));
  assert.ok(!r.stderr.includes('boom'), 'the failed call stderr is dropped (2>/dev/null)');

  // Whatever a failed call printed before it failed is kept, with the echoed [] after it.
  const partial = FULL();
  partial.gh = partial.gh.map((e) => (e.argv && e.argv[1] === 'view' ? { ...e, stdout: '["a"]', status: 1 } : e));
  const p = pull4(partial);
  assert.equal(p.text['dispatch-shipped-pr-files.jsonl'], '', '["a"][] is not JSON: the node line fails and nothing is appended');
  assert.ok(p.errs.some((e) => e.startsWith('queue-pull: shipped-pr-files: ')), p.stderr);
});

test('#5227 shipped: a missing shipped-pr-files file reads as no probed files (ENOENT is caught), and the pass still classifies', () => {
  const scenario = FULL();
  // The probe call deletes the file and answers invalid JSON, so nothing recreates it.
  scenario.gh = scenario.gh.map((e) => (e.argv && e.argv[1] === 'view'
    ? { ...e, stdout: '["a"]', status: 1, effect: 'delete-session-file:dispatch-shipped-pr-files.jsonl' } : e));
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
  assert.deepEqual(gitArgvs, [['remote', 'show', 'origin'], ['cat-file', '-e', 'origin/trunk:docs/gone6.md'], ['cat-file', '-e', 'origin/trunk:docs/gone.md']]);
  assert.equal(viaRemote.state.integrationBranch, 'trunk');
  assert.deepEqual(entriesOf(viaRemote, 'target-missing').map((e) => e.records[0]), [9006]);

  const policyGit = [];
  const policyBase = fakeRun(FULL());
  pull4({ ...FULL(), policy: { 'work-links': 'body-text', 'integration-branch': 'release/next' } }, {
    run: (cmd, args, opts) => { if (cmd === 'git') policyGit.push(args); return policyBase(cmd, args, opts); },
  });
  assert.deepEqual(policyGit.map((a) => a.join(' ')), ['cat-file -e origin/release/next:docs/gone6.md', 'cat-file -e origin/release/next:docs/gone.md'], 'no `git remote show origin` when the policy answers');
});

test('#5227 portability: a failing `git remote show origin` leaves the branch empty and the pull continues (every named target reads as missing)', () => {
  const r = pull4({ ...FULL(), gitFail: [['remote', 'show', 'origin']] });
  assert.equal(r.state.integrationBranch, '');
  assert.equal(r.state.integrationRef, 'origin/');
  assert.deepEqual(entriesOf(r, 'target-missing').map((e) => e.records[0]), [9006, 9009]);
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
  assert.ok(r1.errs.includes('queue-pull: hooks.js: spawn EMFILE\n'), 'the target-missing call leaves its stderr on the terminal (fence 385)');
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
    assert.equal(omitted.store.written.length, 0, 'omit never persists a cache blob');
    const keepsOthers = reasons.filter((x) => x !== reason && x !== 'shipped' && !(reason === 'not-spec-shaped' && x === 'open-pr') && !(reason === 'open-pr' && x === 'shipped'));
    for (const other of keepsOthers) assert.deepEqual(entriesOf(omitted, other), entriesOf(base, other), `${reason} omitted, ${other}`);
  }
});

test('#5227 oracle cross-check: S1 full gives the oracle the same groups, the four reasons and the staged Close bodies the module yields', { skip: oracleSkip() }, async () => {
  const oracle = await withEscapeGuard(REPO, () => runOracle(createSandbox(FULL()), FENCE));
  assert.equal(oracle.status, 0, oracle.stderr);
  const mine = pull4(FULL());
  const oracleEntries = JSON.parse(oracle.files['dispatch-exclusions.json']);
  for (const reason of ['not-spec-shaped', 'open-pr', 'target-missing', 'shipped']) {
    assert.ok(oracleEntries.some((e) => e.reason === reason), `the oracle yields a ${reason} entry`);
    assert.deepEqual(entriesOf(mine, reason), oracleEntries.filter((e) => e.reason === reason), reason);
  }
  assert.deepEqual(mine.json('dispatch-groups.json'), JSON.parse(oracle.files['dispatch-groups.json']));
  const bodies = (staged) => Object.fromEntries(Object.entries(staged).map(([name, body]) => [name.replace(/\..*$/, ''), body]));
  const myBodies = Object.fromEntries(mine.cap.staged.map((s) => [s.id, s.body]));
  assert.deepEqual(myBodies, bodies(oracle.staged), 'the staged Close bodies match');
  assert.ok(Object.keys(oracle.staged).some((n) => /^dispatch-target-missing-9009\.qp\d{8}$/.test(n)), `the oracle names the target-missing item after the mktemp suffix: ${Object.keys(oracle.staged)}`);
  assert.deepEqual(mine.json('dispatch-linked-prs.json'), JSON.parse(oracle.files['dispatch-linked-prs.json']));
  assert.deepEqual(mine.json('dispatch-shipped-probe-prs.json'), JSON.parse(oracle.files['dispatch-shipped-probe-prs.json']));
  assert.equal(mine.text['dispatch-shipped-pr-files.jsonl'], oracle.files['dispatch-shipped-pr-files.jsonl']);
  assert.equal(mine.text['dispatch-named-targets.json'], oracle.files['dispatch-named-targets.json']);
});

// ---- Task 5: blocker-landing, neighbour-in-flight, cross-PR overlap, near-duplicate; the omit sweep ----

const PIPE = () => S1({ pipeline: true });
const MALFORMED_CAUSE = 'a Blocked by line names no valid issue number (#0)';
const NEIGHBOUR_STOP = fenceText(/echo "(dispatch: queue-pull stopped -- neighbour-in-flight exclusion pass failed \(exit )\$NEIGHBOUR_RC\); see error above\.\" >&2/);
const UNLANDED_STOP = fenceText(/echo "(dispatch: queue-pull stopped -- unlanded-blocker exclusion pass failed; see error above\.)" >&2/);
const IN_FLIGHT_POOL_AUTO = fenceText(/echo "(AUTO — dispatch: neighbour-in-flight pool fetch failed[^"]*)" >&2/);
const IN_FLIGHT_CAP = fenceText(/echo "(Warning: the bot:in-progress pull for the neighbour-in-flight pass[^"]*)" >&2/);
const OPEN_PR_CAP = fenceText(/echo "(Warning: the open-PR pull for the cross-PR overlap report[^"]*)" >&2/);
const IN_FLIGHT_ARGV = ['issue', 'list', '--label', 'bot:in-progress', '--state', 'open', '--json', 'number,title,body,labels', '--limit', '200'];
const OPEN_PRS_ARGV = ['pr', 'list', '--state', 'open', '--json', 'number,files,closingIssuesReferences', '--limit', '100'];

// The canned dispatch-unlanded-blockers.js: for the pipeline fixture's #9012 (a Blocked by line with
// no valid number) and #9011 (a closed blocker whose commit never landed) it appends the real CLI's
// entries and prints the pool without them. A pool holding neither is handed back unchanged.
function cannedLanding(seen) {
  return (args) => {
    seen.push(args);
    const val = (flag) => args[args.indexOf(flag) + 1];
    const groups = JSON.parse(fs.readFileSync(val('--groups'), 'utf8'));
    const present = new Set(groups.flat().map((c) => c.number));
    const gone = new Set();
    if (present.has(9012)) {
      appendExclusion(val('--exclusions'), { reason: 'malformed-blocker', records: [9012], detail: { cause: MALFORMED_CAUSE } });
      gone.add(9012);
    }
    if (present.has(9011)) {
      appendExclusion(val('--exclusions'), { reason: 'unlanded-blocker', records: [9011], detail: { blockers: [{ blocker: 8001, commit: LANDING_COMMIT }] } });
      gone.add(9011);
    }
    return { status: 0, stdout: JSON.stringify(groups.map((g) => g.filter((c) => !gone.has(c.number))).filter((g) => g.length > 0)), stderr: '' };
  };
}

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

test('#5227 neighbour: an unreadable claim prints the fence AUTO line and excludes nothing; a failed pool fetch writes [] and prints the pool AUTO line; a 200-record pool prints the cap Warning', () => {
  const unreadable = pull5(PIPE(), { deps: { createClaimReader: () => ({ read: () => ({ failure: 'git-fetch-failed' }) }) } });
  assert.deepEqual(entriesOf(unreadable, 'neighbour-in-flight'), []);
  assert.ok(unreadable.stderr.includes('AUTO — dispatch: neighbour-in-flight claim read failed for #7001; treated as not in flight\n'), unreadable.stderr);
  assert.ok(FENCE.includes("'AUTO — dispatch: neighbour-in-flight claim read failed for #' + unreadable.join(', #') + '; treated as not in flight'"));

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
      const put = (name, content) => { const file = path.join(own, name); fs.writeFileSync(file, content); return file; };
      const inputs = {
        queueRaw: put('queue.json', ghAnswerOf(QUEUE_ARGV)),
        openNumbers: put('open.json', ghAnswerOf(OPEN_NUMBERS_ARGV)),
        depFreshness: put('dep.json', '[]'),
        verifiedOpenDeps: put('verified.txt', ''),
        inFlightRaw: o.raw === null ? path.join(own, 'absent-raw.json') : put('in-flight.json', o.raw === undefined ? JSON.stringify([IN_FLIGHT_7001]) : o.raw),
        inFlightClaims: o.claimsFile === null ? path.join(own, 'absent-claims.json') : put('claims.json', o.claimsFile === undefined ? JSON.stringify({ 7001: LIVE_CLAIM }) : o.claimsFile),
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

test('#5227 D4: a non-JSON string in the claim map is read as unreadable content, so it excludes nothing and prints no AUTO line', () => {
  const r = filesPull({ claimsFile: JSON.stringify({ 7001: 'this is not json' }) });
  assert.equal(r.thrown, null, String(r.thrown));
  assert.deepEqual(entriesOf(r, 'neighbour-in-flight'), []);
  assert.ok(!r.stderr.includes('neighbour-in-flight'), `no neighbour line of any kind: ${r.stderr}`);
});

test('#5227 cross-PR: gh pr list feeds detectCrossPRFileOverlap; a failure writes [] silently; files writes [] with no gh call; 100 PRs print the cap Warning', () => {
  const r = pull5(PIPE());
  assert.equal(r.ghCalls.filter((a) => a.join() === OPEN_PRS_ARGV.join()).length, 1);
  const overlap = r.json('dispatch-crosspr-overlap.json');
  assert.equal(overlap.length, 1, JSON.stringify(overlap));
  assert.ok(JSON.stringify(overlap).includes('9001') && JSON.stringify(overlap).includes('41'), JSON.stringify(overlap));
  assert.ok(groupNumbers(r).flat().includes(9001), 'informational: nothing leaves the groups');

  // A PR that already closes the candidate is a re-dispatch guard, not an overlap.
  const closing = pull5(withGh(PIPE(), OPEN_PRS_ARGV, { stdout: JSON.stringify([{ ...OPEN_PR_41, closingIssuesReferences: [{ number: 9001 }] }]) }));
  assert.deepEqual(closing.json('dispatch-crosspr-overlap.json'), []);

  const failed = pull5(withGh(PIPE(), OPEN_PRS_ARGV, { status: 1, stdout: 'partial' }));
  assert.deepEqual(failed.json('dispatch-crosspr-overlap.json'), []);
  assert.equal(failed.text['dispatch-open-prs.json'], '[]\n');
  assert.ok(!/cross-PR|open-PR pull|queue-pull:|Warning:/.test(failed.stderr), `the failure is silent: ${failed.stderr}`);

  const files = filesPull();
  assert.equal(files.thrown, null, String(files.thrown));
  assert.equal(files.text['dispatch-crosspr-overlap.json'], '[]');
  assert.equal(files.ghCalls.filter((a) => a[0] === 'pr' && a[1] === 'list').length, 0);
  assert.equal(files.text['dispatch-open-prs.json'], undefined, 'the open-PR file is not written on files');

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
  assert.equal(SWEPT.length, 11, 'the sweep covers 11 entries: 9 reasons and 2 informational passes');
  let swept = 0;
  for (const p of SWEPT) {
    const name = p.reason || p.id;
    const scenario = () => (p.id === 'oversized' ? SFast() : PIPE());
    const full = pull5(scenario());
    const omitted = pull5(scenario(), { omit: [name] });
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
    swept += 1;
  }
  assert.equal(swept, SWEPT.length, 'the loop ran every entry');
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
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qp-rank-case-'));
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
  const mixedSnake = [MED, MIXED].map(snake).map((g) => aliasMcpTimestamps(g));
  assert.deepEqual(rankNext(mixedSnake, [], {}).map((r) => r.number), [6, 7, 8], 'MIXED ranks as high through the round trip');
  assert.deepEqual(rankNext(mixedSnake, [], { priority: 'high' }).map((r) => r.number), [6, 7, 8]);
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

test('AC6.3: rankFromFiles writes null when nothing is eligible, honours --priority, and throws on a missing or malformed groups file without writing a pick', () => withSession((paths, sessionId) => {
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
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qp-rank-case-'));
    try {
      const paths = seedModuleSession(sessionId, writeCaseFiles(dir, { groups, exclusions: [] }));
      fs.writeFileSync(paths['dispatch-next-pick.json'], 'STALE\n');
      assert.throws(() => rankFromFiles({ sessionId, priority: '' }));
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
  assert.match(header, /Reopen\s+\/\/ when the cutover has landed/, "R4's decision comment names its reopen condition");
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

test('#5227 CLI process: the real binary runs --help, rejects a bad flag and pulls a one-record queue under the sandbox shims', { skip: STUB_SKIP }, async () => {
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
  } finally {
    sandbox.cleanup();
  }
});

test('AC10.1: docs/plugin-structure.md names queue-pull.js in the command reference and the plugin/bin/lib/dispatch/ entry', () => {
  const lines = readText(path.join(REPO, 'docs', 'plugin-structure.md')).split('\n');
  assert.ok(lines.some((l) => l.startsWith('node plugin/bin/queue-pull.js')), 'a command-reference line');
  const entry = lines.find((l) => l.startsWith('plugin/bin/lib/dispatch/'));
  assert.ok(entry, 'the module entry exists');
  assert.ok(entry.includes('queue-pull.js'), 'the module entry names queue-pull.js');
  assert.ok(entry.includes('; queue-pull.js (#5227'), 'the module has its own entry in the list, not only a mention');
});

// ---- Task 8: the parity matrix (AC1), multi-reason (AC3), empty and malformed queues (AC5),
// portability and the real-writer pins. Each pair is the bash oracle over the fence (or, on files,
// filesOracleScript's mcp-transport.md rendering of it) beside the real CLI, both under the same
// sandbox shims; see the header for the normalizations and the one exit-code mapping. ----

const POOL = Math.max(1, Math.min(4, (os.availableParallelism ? os.availableParallelism() : os.cpus().length) - 1));
const PARITY_S1 = () => S1({ parity: true });
const ALL_REASONS = [...new Set(PASSES.map((p) => p.reason).filter(Boolean))].sort();
const FILES_S1_REASONS = ['blocked', 'malformed-blocker', 'neighbour-in-flight', 'not-spec-shaped', 'oversized', 'target-missing'];
// `reasons`: the exclusion reasons the config's oracle run writes. On files the three gh-backed
// probes (open-pr, shipped, unlanded-blocker) fail open as mcp-transport.md documents.
const MATRIX = [
  { name: 'S1-gh-miss', scenario: PARITY_S1(), transport: 'gh', reasons: ALL_REASONS },
  { name: 'S1-gh-hit', scenario: PARITY_S1(), transport: 'gh', after: 'S1-gh-miss', reasons: ALL_REASONS },
  { name: 'S1-files-miss', scenario: PARITY_S1(), transport: 'files', reasons: FILES_S1_REASONS },
  { name: 'S1-files-hit', scenario: PARITY_S1(), transport: 'files', after: 'S1-files-miss', reasons: FILES_S1_REASONS },
  { name: 'S2-gh-miss', scenario: S2(), transport: 'gh', reasons: ['blocked'] },
  { name: 'S2-files-miss', scenario: S2(), transport: 'files', reasons: ['blocked'] },
];
const AC1_FILES = ['dispatch-groups.json', 'dispatch-exclusions.json', 'dispatch-fastlane-bundles.json', 'dispatch-near-dup-pairs.json',
  'dispatch-crosspr-overlap.json', 'dispatch-linked-prs.json', 'dispatch-shipped-releases.json'];

// One runPair per config name for the whole file: whichever pool reaches a config first runs it,
// and every later pool naming it gets that same result (the fault pool reuses the AC1 matrix's S1
// and S2 miss runs as its bases, and S1-gh-hit as F-depfresh's warm control). A name stands for
// one config only. Every memoized pair's sandboxes are removed once, after the file's last test.
const PAIR_MEMO = new Map();
const pairKey = (cfg) => JSON.stringify([cfg.scenario, cfg.transport || 'gh', cfg.after || null, cfg.agent || null]);
function memoPair(cfg, miss) {
  const key = pairKey(cfg);
  const memo = PAIR_MEMO.get(cfg.name);
  if (memo) {
    if (memo.key !== key) throw new Error(`pair memo: ${cfg.name} names two different configs`);
    return memo.pair;
  }
  const pair = runPair({ ...cfg, origin: miss ? { oracle: miss.oracle.sandbox.origin, module: miss.module.sandbox.origin } : null });
  PAIR_MEMO.set(cfg.name, { key, pair });
  return pair;
}
// Each config as a runAll job: a hit config starts only once its miss config has finished, and each
// of its two sides copies that same side's origin from the miss run (PF1).
const pairJobs = (configs) => configs.map((cfg) => ({ name: cfg.name, after: cfg.after, run: (miss) => memoPair(cfg, miss) }));
const cleanupPairs = (pairs) => { for (const pair of pairs) for (const r of [pair.oracle, pair.module]) r.sandbox.cleanup(); };
after(async () => {
  const settled = await Promise.allSettled([...PAIR_MEMO.values()].map((m) => m.pair));
  cleanupPairs(settled.filter((s) => s.status === 'fulfilled').map((s) => s.value));
});
// A pool's own summary row: every job settled with a result (each row reading a failed job also
// fails on that job's own error, B7).
const assertEveryJobRan = (R) => assert.deepEqual(failedJobs(R).map(([name, err]) => `${name}: ${err.message}`), [], 'every job in this pool ran');
const sides = (pair) => [['oracle', pair.oracle], ['module', pair.module]];

// Every gh call either side made was answered by the scenario's table, no git call left the
// sandbox (the git shim refuses and logs any directory outside it), and neither stream overflowed
// the 64 KiB capture (a cut stream would compare only its kept head).
function assertClean(pair, label) {
  for (const [side, r] of sides(pair)) {
    assert.deepEqual(r.ghArgv.filter((a) => a.tag === 'UNHANDLED').map((a) => a.argv.join(' ').slice(0, 300)), [], `${label} ${side}: an unanswered gh call`);
    assert.deepEqual(r.gitArgv.filter((a) => a.tag === 'REFUSED'), [], `${label} ${side}: a git call outside the sandbox`);
    for (const channel of ['stdout', 'stderr']) assert.ok(!r[channel].includes(STREAM_TRUNCATED), `${label} ${side}: ${channel} was truncated at 64 KiB`);
  }
}

// R4's mapping for a stopped pair: the fence's `exit 1` is the CLI's 4. Returns the module result
// with the oracle's status, so assertParity compares everything else as is.
function stopMapped(oracle, module) {
  assert.equal(oracle.status, 1, `the oracle stopped: ${oracle.stderr.slice(-2000)}`);
  assert.equal(module.status, 4, `the module stopped: ${module.stderr.slice(-2000)}`);
  return Object.defineProperty({ ...module, status: oracle.status }, 'sandbox', { value: module.sandbox });
}

const exclusionsIn = (r) => JSON.parse(r.files['dispatch-exclusions.json']);
const groupedIn = (r) => JSON.parse(r.files['dispatch-groups.json']).flat().map((c) => c.number);
const ghCall = (r, pattern) => r.ghArgv.map((a) => a.argv).filter((argv) => argv.some((x) => pattern.test(x)));

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
  for (const line of [...anchors, ': > "$DISPATCH_VERIFIED_OPEN_DEPS"']) {
    assert.throws(() => filesOracleScript(FENCE.replace(line, '# moved'), mcp), (err) => err.message === `anchor not found: ${line}`, line);
  }
  // mcp-transport.md's claim-targets fence (step 2) is the only one whose first line ends at this argument.
  assert.throws(() => filesOracleScript(FENCE, mcp.replace('"$DISPATCH_IN_FLIGHT_RAW" <<NODE_EVAL_EOF', '"$X" <<NODE_EVAL_EOF')), /anchor not found/);
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
    const log = fs.readFileSync(path.join(sb.logs, 'git-argv.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.deepEqual(log.map((e) => e.tag), ['canned', 'delegated']);
  } finally {
    sb.cleanup();
  }
});

describe('#5227 parity (AC1)', { skip: oracleSkip(), timeout: 600_000 }, () => {
  let R = {};
  const timing = {};
  before(async () => {
    const t0 = Date.now();
    R = await runAll(pairJobs(MATRIX), POOL);
    timing.ms = Date.now() - t0;
  });

  test('#5227 parity (AC1): every pair in the matrix pool ran', () => assertEveryJobRan(R));

  for (const cfg of MATRIX) {
    test(`AC1.1 [${cfg.name}]: groups, exclusions and every other output equal the script's`, () => {
      const pair = R[cfg.name];
      assertClean(pair, cfg.name);
      assert.equal(pair.oracle.status, 0, pair.oracle.stderr.slice(-3000));
      assert.deepEqual([...new Set(exclusionsIn(pair.oracle).map((e) => e.reason))].sort(), cfg.reasons, 'the reasons this config exercises');
      for (const [side, r] of sides(pair)) assert.equal(r.stderr.includes(HIT_MESSAGE), Boolean(cfg.after), `${side}: a hit config hits and a miss config misses`);
      assertParity(pair.oracle, pair.module, { files: AC1_FILES });
    });
  }

  test('AC1.2: normalize substitutes only the sandbox root and the run id; the staged target-missing ids are byte-equal on both sides (deterministic temp names)', (t) => {
    for (const cfg of MATRIX) {
      const { oracle, module } = R[cfg.name];
      assert.deepEqual(Object.keys(module.staged), Object.keys(oracle.staged), `${cfg.name}: the staged names, before any normalization`);
    }
    for (const name of ['S1-gh-miss', 'S1-files-miss']) {
      const names = Object.keys(R[name].oracle.staged);
      assert.ok(names.some((n) => /^dispatch-target-missing-9009\.qp\d{8}$/.test(n)), `${name}: the mktemp suffix names the item (D2): ${names}`);
    }
    assert.ok(Object.keys(R['S1-gh-miss'].oracle.staged).includes('shipped-close-9010.md'));
    const sb = R['S1-gh-miss'].oracle.sandbox;
    const sample = `${sb.root}/proj/.claude-tweaks/pipelines/${RUN_DIR_NAME}/staged x 2026-11-12T12:00:00.000Z ${sb.root}-not tmp.qp00000001`;
    assert.equal(normalize(sample, sb), '<SCR>/proj/.claude-tweaks/pipelines/<RUN>/staged x 2026-11-12T12:00:00.000Z <SCR>-not tmp.qp00000001',
      'the clock and the temp names are left as they are');
    for (const [side, r] of sides(R['S1-gh-miss'])) assert.equal(r.orderBlob.computedAt, '2026-11-12T12:00:00.000Z', `${side}: the frozen clock, not a normalization`);
    t.diagnostic(`AC1 matrix: ${MATRIX.length} pairs (${MATRIX.length * 2} runs), pool ${POOL}, wall ${timing.ms} ms`);
  });

  test('AC1.1 go-red: assertParity throws when the module result drops one exclusion entry', () => {
    const { oracle, module } = R['S1-gh-miss'];
    assertParity(oracle, module, { files: AC1_FILES });
    const entries = exclusionsIn(module);
    for (const at of [0, entries.length - 1]) {
      const dropped = Object.defineProperty({ ...module, files: { ...module.files, 'dispatch-exclusions.json': JSON.stringify(entries.filter((_, i) => i !== at)) } }, 'sandbox', { value: module.sandbox });
      assert.throws(() => assertParity(oracle, dropped, { files: AC1_FILES }), assert.AssertionError, `dropping entry ${at}`);
    }
  });

  test('AC2.3: removing reasons are absent from dispatch-groups.json while oversized and neighbour-in-flight are present, both sides', () => {
    const removing = PASSES.filter((p) => p.kind === 'exclusion' && p.removes).map((p) => p.reason);
    const staying = [...new Set(PASSES.filter((p) => p.kind === 'exclusion' && !p.removes).map((p) => p.reason))].sort();
    assert.deepEqual(staying, ['neighbour-in-flight', 'oversized']);
    for (const cfg of MATRIX.filter((c) => c.name.startsWith('S1-'))) {
      for (const [side, r] of sides(R[cfg.name])) {
        const grouped = groupedIn(r);
        const entries = exclusionsIn(r);
        for (const e of entries.filter((x) => removing.includes(x.reason))) {
          for (const n of e.records) assert.ok(!grouped.includes(n), `${cfg.name} ${side}: ${e.reason} #${n} left the groups`);
        }
        for (const reason of staying) {
          const named = entries.filter((e) => e.reason === reason).flatMap((e) => e.records);
          assert.ok(named.length > 0, `${cfg.name} ${side}: a ${reason} entry`);
          for (const n of named) assert.ok(grouped.includes(n), `${cfg.name} ${side}: ${reason} #${n} stays in the groups`);
        }
      }
    }
  });

  test('AC3.1 parity: #9004/#9005/#9006 carry one reason each and the linked-PR GraphQL names no #9004 alias, both sides', () => {
    for (const cfg of MATRIX.filter((c) => c.name.startsWith('S1-'))) {
      for (const [side, r] of sides(R[cfg.name])) {
        const reasonsOf = (n) => exclusionsIn(r).filter((e) => e.records.includes(n)).map((e) => e.reason);
        const label = `${cfg.name} ${side}`;
        assert.deepEqual(reasonsOf(9004), ['not-spec-shaped'], label);
        assert.deepEqual(reasonsOf(9006), ['target-missing'], label);
        if (cfg.transport === 'files') {
          assert.deepEqual(reasonsOf(9005), [], `${label}: no open-PR exclusion on files (the linked-PR query fails open)`);
          continue;
        }
        assert.deepEqual(reasonsOf(9005), ['open-pr'], label);
        const linked = ghCall(r, /CROSS_REFERENCED_EVENT/);
        assert.equal(linked.length, 1, `${label}: one linked-PR query`);
        const query = linked[0].join(' ');
        assert.ok(!/\bi9004\s*:/.test(query), `${label}: the not-spec-shaped #9004 is never queried`);
        assert.ok(/\bi9005\s*:/.test(query) && /\bi9006\s*:/.test(query), `${label}: #9005 and #9006 are (control)`);
        assert.deepEqual(r.ghArgv.filter((a) => a.argv[0] === 'pr' && a.argv[1] === 'view').map((a) => a.argv[2]), ['5016'],
          `${label}: only #9016's weak mention is probed, never an excluded candidate's`);
      }
    }
  });

  test('AC7.1: the files transport writes dispatch-crosspr-overlap.json as [] and dispatch-linked-prs.json as {}, both sides', () => {
    for (const cfg of MATRIX.filter((c) => c.transport === 'files')) {
      for (const [side, r] of sides(R[cfg.name])) {
        const label = `${cfg.name} ${side}`;
        // JSON-equal, AC1's "identical": the oracle's agent writes `echo '[]'` (a newline), the module '[]'.
        assert.deepEqual(JSON.parse(r.files['dispatch-crosspr-overlap.json']), [], label);
        assert.deepEqual(JSON.parse(r.files['dispatch-linked-prs.json']), {}, label);
        assert.deepEqual(r.ghArgv, [], `${label}: zero gh calls`);
        // Claims come from the agent's map (claimReaderFromMap), never a claims-registry read: the
        // sandbox registry would give the same live answer, so only the read itself tells them apart.
        assert.deepEqual(r.gitArgv.filter((e) => e.argv.some((x) => x.startsWith('claims-registry:'))), [], `${label}: no claims-registry read`);
        const PATH = r.sandbox.runEnv({ tmpdir: r.sandbox.root, sessionId: 'unused' }).PATH;
        for (const dir of PATH.split(path.delimiter)) assert.equal(fs.existsSync(path.join(dir, 'gh')), false, `${label}: no gh in ${dir}`);
      }
    }
    // The gh configs are the control: the same passes do call gh there.
    assert.ok(R['S1-gh-miss'].module.ghArgv.length > 0 && R['S1-gh-miss'].oracle.ghArgv.length > 0);
  });

  test('#5227 real-writer: fakeSpawnCli canned stdout equals what the real CLIs printed in S1-gh-miss', () => {
    const { oracle } = R['S1-gh-miss'];
    // resolve-linked-prs.js: the numbers the real CLI queried, in its alias order.
    const [linked] = ghCall(oracle, /CROSS_REFERENCED_EVENT/);
    const numbers = [...linked.join(' ').matchAll(/\bi(\d+)\s*:\s*issue\(/g)].map((m) => m[1]);
    assert.ok(numbers.length > 5, numbers.join());
    assert.equal(fakeSpawnCli(PARITY_S1())('resolve-linked-prs.js', [numbers.join(',')]).stdout, oracle.files['dispatch-linked-prs.json']);
    // dispatch-unlanded-blockers.js: nothing after it rewrites dispatch-groups.json, so the oracle's
    // file is the real CLI's stdout. The canned CLI over that pool plus #9011 and #9012 prints it
    // byte for byte and appends the real CLI's two entries.
    const eligible = JSON.parse(oracle.files['dispatch-eligible.json']);
    const record = (n) => eligible.find((c) => c.number === n);
    const own = fs.mkdtempSync(path.join(os.tmpdir(), 'qp-writer-'));
    try {
      const groupsFile = path.join(own, 'groups.json');
      const exclusionsFile = path.join(own, 'exclusions.json');
      fs.writeFileSync(groupsFile, JSON.stringify([...JSON.parse(oracle.files['dispatch-groups.json']), [record(9011)], [record(9012)]]));
      fs.writeFileSync(exclusionsFile, '[]');
      const out = cannedLanding([])(['--groups', groupsFile, '--exclusions', exclusionsFile, '--integration-branch', 'main', '--work-links', 'body-text']);
      assert.equal(out.stdout, oracle.files['dispatch-groups.json']);
      assert.deepEqual(JSON.parse(fs.readFileSync(exclusionsFile, 'utf8')),
        exclusionsIn(oracle).filter((e) => e.reason === 'malformed-blocker' || e.reason === 'unlanded-blocker'));
    } finally {
      fs.rmSync(own, { recursive: true, force: true });
    }
  });

  test('#5227 cwd/env: on the module side the foreign-blocker lookup and the claim-registry reads reach the sandbox shims, and every git call runs inside the sandbox', () => {
    const s2 = R['S2-gh-miss'].module;
    assert.ok(s2.ghArgv.some((a) => a.tag === 'ok' && a.argv.some((x) => /\bc0\s*:\s*repository\(/.test(x)) && a.argv.includes('o0=acme-corp')),
      'resolve-foreign-blockers.js asked the gh shim for acme-corp/other#12');
    const s1 = R['S1-gh-miss'].module;
    assert.ok(s1.ghArgv.some((a) => a.tag === 'ok' && a.argv.join(' ') === 'repo view --json nameWithOwner -q .nameWithOwner'), "the claim reader's slug lookup reached the gh shim");
    assert.ok(s1.gitArgv.some((e) => e.argv.includes('fetch') && e.argv.some((x) => x.startsWith('claims-registry:'))), 'the claim reader fetched the sandbox claims-registry');
    for (const [name, pair] of Object.entries(R)) {
      for (const [side, r] of sides(pair)) {
        for (const e of r.gitArgv) assert.ok(e.cwd === r.sandbox.root || e.cwd.startsWith(r.sandbox.root + path.sep), `${name} ${side}: git ran in ${e.cwd}`);
      }
    }
  });
});

describe('#5227 parity (AC5, portability)', { skip: oracleSkip(), timeout: 600_000 }, () => {
  const EXTRA = [
    { name: 'SEmpty-gh-miss', scenario: SEmpty() },
    { name: 'SMalformed-gh-miss', scenario: SMalformed() },
    { name: 'SMalformed-labels', scenario: SMalformed('labels') },
    { name: 'SMalformed-body', scenario: SMalformed('body') },
    { name: 'SMalformed-blocker', scenario: SMalformed('blocker') },
    { name: 'SPortable-gh-miss', scenario: SPortable() },
  ];
  let R = {};
  const timing = {};
  before(async () => {
    const t0 = Date.now();
    R = await runAll(pairJobs(EXTRA), POOL);
    timing.ms = Date.now() - t0;
  });

  test('#5227 parity (AC5, portability): every pair in the pool ran', () => assertEveryJobRan(R));

  test('AC5.1: an empty queue yields the same files as the script', (t) => {
    const pair = R['SEmpty-gh-miss'];
    assertClean(pair, 'SEmpty');
    assert.equal(pair.oracle.status, 0, pair.oracle.stderr.slice(-3000));
    assertParity(pair.oracle, pair.module);
    for (const [side, r] of sides(pair)) {
      assert.deepEqual(JSON.parse(r.files['dispatch-groups.json']), [], side);
      assert.deepEqual(exclusionsIn(r), [], side);
    }
    t.diagnostic(`AC5/portability: ${EXTRA.length} pairs (${EXTRA.length * 2} runs), pool ${POOL}, wall ${timing.ms} ms`);
  });

  test('AC5.2: non-array labels, a non-string body and an invalid Blocked-by number are handled as the script handles them, and #9001\'s verdict matches the oracle\'s', () => {
    const verdict = (r) => ({
      grouped: r.files['dispatch-groups.json'] ? groupedIn(r).includes(9001) : null,
      reasons: r.files['dispatch-exclusions.json'] ? exclusionsIn(r).filter((e) => e.records.includes(9001)).map((e) => e.reason) : null,
    });
    // Non-array labels: the script stops the whole pull at the group-building check (header).
    for (const name of ['SMalformed-gh-miss', 'SMalformed-labels']) {
      const pair = R[name];
      assertClean(pair, name);
      assertParity(pair.oracle, stopMapped(pair.oracle, pair.module), { files: AC1_FILES });
      for (const [side, r] of sides(pair)) {
        assert.deepEqual(reported(r.stderr), [`${GROUPING_STOP_RE.exec(FENCE)[1]}1${GROUPING_STOP_RE.exec(FENCE)[2]}`], `${name} ${side}`);
        assert.equal(r.files['dispatch-groups.json'], '', `${name} ${side}: the grouping redirect truncated the groups file`);
      }
      assert.deepEqual(verdict(pair.module), verdict(pair.oracle), `${name}: #9001's verdict`);
    }
    // A non-string body: not-spec-shaped. An invalid Blocked-by number: malformed-blocker.
    const expected = {
      'SMalformed-body': { reason: 'not-spec-shaped', records: [9021], detail: { missing: ['Current State', 'Deliverables', 'Acceptance Criteria', 'Release Note'] } },
      'SMalformed-blocker': { reason: 'malformed-blocker', records: [9022], detail: { cause: 'a Blocked by line names no valid issue number (#99999999999)' } },
    };
    for (const [name, entry] of Object.entries(expected)) {
      const pair = R[name];
      assertClean(pair, name);
      assert.equal(pair.oracle.status, 0, pair.oracle.stderr.slice(-3000));
      assertParity(pair.oracle, pair.module, { files: AC1_FILES });
      for (const [side, r] of sides(pair)) {
        assert.deepEqual(exclusionsIn(r), [entry], `${name} ${side}`);
        assert.deepEqual(groupedIn(r), [9001], `${name} ${side}: the clean record is dispatchable`);
      }
      assert.deepEqual(verdict(pair.module), verdict(pair.oracle), `${name}: #9001's verdict`);
      assert.deepEqual(verdict(pair.oracle), { grouped: true, reasons: [] });
    }
  });

  test('#5227 portability: release/next and acme-corp/widgets reach git cat-file, --integration-branch and the GraphQL owner/repo on both sides', () => {
    const pair = R['SPortable-gh-miss'];
    assertClean(pair, 'SPortable');
    assert.equal(pair.oracle.status, 0, pair.oracle.stderr.slice(-3000));
    assertParity(pair.oracle, pair.module, { files: AC1_FILES });
    const [owner, repo] = PORTABLE_SLUG.split('/');
    for (const [side, r] of sides(pair)) {
      const catFiles = r.gitArgv.map((e) => e.argv).filter((a) => a.includes('cat-file')).map((a) => a.slice(a.indexOf('cat-file')).join(' ')).sort();
      assert.deepEqual(catFiles, ['cat-file -e origin/release/next:docs/gone.md', 'cat-file -e origin/release/next:docs/kept.md'], side);
      assert.ok(!r.gitArgv.some((e) => e.argv.join(' ').includes('remote show origin')), `${side}: the policy key wins, origin's HEAD (trunk) is never asked`);
      for (const pattern of [/CLOSED_EVENT/, /CROSS_REFERENCED_EVENT/]) {
        const [call] = ghCall(r, pattern);
        assert.ok(call && call.includes(`owner=${owner}`) && call.includes(`repo=${repo}`), `${side}: ${pattern} names ${PORTABLE_SLUG}`);
      }
      assert.ok(r.ghArgv.some((a) => a.argv[1] === `repos/${PORTABLE_SLUG}/compare/release/next...${LANDING_COMMIT}`), `${side}: --integration-branch release/next reached the compare`);
      assert.deepEqual(exclusionsIn(r).map((e) => [e.reason, e.records[0]]), [['target-missing', 9041], ['unlanded-blocker', 9042]], side);
      assert.deepEqual(groupedIn(r), [9040], `${side}: docs/kept.md is present at origin/release/next`);
      assert.ok(r.stderr.includes(`blocker #8001 closed but its closing commit ${LANDING_COMMIT} is not on origin/release/next`), side);
    }
  });
});

// ---- Task 9: fetch-failure faults (AC4), files-input faults (AC7.2) and the reproduced script
// defects (D1, D3, D4). Each FAULTS row (queue-pull-fixtures.js) fails one gh fetch, and each
// FILES_FAULTS row one files input, on both sides through the shared table. Its base is the same
// scenario un-faulted: the AC1 matrix's own run of it where the matrix has one (S1 and S2, reused
// through the pair memo), else a base run in the fault pool. One pool runs both transports' rows,
// their new bases and D1, from one `before`. A row asserts what the ORACLE did (Plan Review
// Clarifications, criteria 4, 5 and 7): its exit, the lines it adds on each channel, and its
// exclusions read against the base's. It then asserts that the module did the same.
// Files compared: every session file, byte-equal (JSON-equal), with two row-level carve-outs (see
// faultComparison). ----

const AGENT_STAGED = new Set(['dispatch-queue-raw.json', 'dispatch-open-numbers.json', 'dispatch-dep-freshness.json',
  'dispatch-verified-open-deps.txt', 'dispatch-in-flight-raw.json', 'dispatch-in-flight-claims.json']);
// pair -> { files: the session files compared whole, tailErr: the .err files compared by their fixed
// part }. The carve-outs, each only on the row that needs it:
//   - On files, an agent-written input the oracle never wrote while the module holds it: the module
//     side has the agent's files staged before its run, while the oracle's agent writes each at its
//     fence point, so a run that stops first leaves it unwritten on the oracle side only. Every
//     other combination (both written, neither, only the oracle's) compares.
//   - A row whose oracle stderr carries one of the header's four `$(cat <err file>)` lines: that
//     line's .err file is all tail, so it compares by its fixed part only (written and non-empty on
//     both sides, the module's err.message inside the oracle's Node report of the same error).
function faultComparison(pair, transport) {
  const stderrLines = String(pair.oracle.stderr).split('\n');
  const tailErr = [...new Set(TAIL_LINES.filter((t) => stderrLines.some((l) => l.startsWith(t.prefix))).map((t) => t.errFile))];
  const stagedOnly = (n) => transport === 'files' && AGENT_STAGED.has(n) && pair.oracle.files[n] === null && pair.module.files[n] !== null;
  return { files: SESSION_FILES.filter((n) => !tailErr.includes(n) && !stagedOnly(n)), tailErr };
}
function assertFaultFiles(pair, transport, label, module = pair.module) {
  const { files, tailErr } = faultComparison(pair, transport);
  assertParity(pair.oracle, module, { files });
  for (const name of tailErr) {
    const [o, m] = [pair.oracle, pair.module].map((r) => r.files[name]);
    assert.ok(o && m, `${label}: ${name} is written and non-empty on both sides (oracle ${JSON.stringify(o)}, module ${JSON.stringify(m)})`);
    assert.ok(normalize(o, pair.oracle.sandbox).includes(normalize(m.trim(), pair.module.sandbox)), `${label}: the module's ${name} is the error the oracle's reports:\n${o}\n---\n${m}`);
  }
  return tailErr;
}
const fullStop = (re) => { const m = re.exec(FENCE); return `${m[1]}1${m[2]}`; };
const STOP_LINE = {
  grouping: fullStop(GROUPING_STOP_RE),
  cacheHit: fullStop(CACHE_HIT_STOP_RE),
  neighbour: `${NEIGHBOUR_STOP}1); see error above.`,
  target: `${TARGET_STOP}1); see error above.`,
};
// Lines the CLIs and libraries the fence runs print (not fence echo text).
const LANDING_SKIPPED = 'Warning: unlanded-blocker pass skipped — ';
const LANDING_EXITED = `${LANDING_SKIPPED}preflight-records.js exited 1; no unlanded-blocker exclusions this pull`;
const CLAIM_READ_FAILED_7001 = 'AUTO — dispatch: neighbour-in-flight claim read failed for #7001; treated as not in flight';
const FOREIGN_LOOKUP_NO_GH = 'Warning: foreign blocker state lookup failed (exit 2: resolve-foreign-blockers.js: `gh` is required) — every body-declared foreign blocker reads state unreadable (fail closed)';
const NEAR_DUP = 'AUTO — dispatch: near-duplicate candidates across groups: ';
const FOREIGN_UNREADABLE = 'acme-corp/other#12 (state unreadable)';

// A row's default base, and the fault pool's bases: the matrix configs themselves (so the memo
// hands back their runs), the live-dependency scenario the matrix does not run, and S1-gh-hit,
// F-depfresh's un-faulted warm control on the same miss origin.
const MATRIX_CFG = Object.fromEntries(MATRIX.map((c) => [c.name, c]));
const BASE = { gh: 'S1-gh-miss', files: 'S1-files-miss' };
const FAULT_BASES = [
  MATRIX_CFG['S1-gh-miss'], MATRIX_CFG['S1-gh-hit'], MATRIX_CFG['S2-gh-miss'], { name: 'gh-livedep', scenario: S1LiveDep(), transport: 'gh' },
  MATRIX_CFG['S1-files-miss'], MATRIX_CFG['S2-files-miss'], { name: 'files-livedep', scenario: S1LiveDep(), transport: 'files' },
];

// Per row: `status` the oracle's exit (the CLI's is 4 where it is 1); `base` the un-faulted run it
// is read against (default <transport>-P1); `stderr` / `stdout` the prefixes, in order, of the
// reported lines it adds on that channel, near-duplicate AUTO lines aside (that informational pass
// reports whatever pool reaches it); `entries` its exclusions literally (reason:records), or else
// `drops` / `adds` against the base's.
const FAULT_EXPECT = {
  'F-queue': { status: 1, stderr: [STOP_LINE.grouping], entries: [] },
  'F-opennum': { status: 1, stderr: [STOP_LINE.grouping], entries: [] },
  'F-depfresh': { status: 0, stderr: [], drops: [] },
  'F-depview': { status: 0, base: 'gh-livedep', stderr: [], drops: ['blocked:9002'] },
  'F-native': { status: 0, base: 'S2-gh-miss', stderr: [`${NATIVE_WARNING_PREFIX}gh-fault: injected failure`, LANDING_EXITED], drops: ['blocked:9030'] },
  'F-foreign': { status: 0, base: 'S2-gh-miss', stderr: ['Warning: foreign blocker state lookup failed (exit 3: gh-fault: injected failure resolve-foreign-blockers.js: '], drops: [] },
  'F-linked': { status: 0, stderr: [`${LINKED_WARNING}gh-fault: injected failure`], drops: ['open-pr:9005', 'open-pr:9008', 'shipped:9010'] },
  'F-intbranch': {
    status: 0, stderr: [`${LANDING_SKIPPED}no integration branch resolved; no unlanded-blocker exclusions this pull`],
    stdout: [6, 9, 17].map((n) => `- AUTO 12:00:00 — log-decision: dispatch: #90${String(n).padStart(2, '0')} excluded, named target docs/${{ 6: 'gone6', 9: 'gone', 17: 'present' }[n]}.md absent at origin/. Reversibility: n/a.`),
    drops: ['unlanded-blocker:9011'], adds: ['target-missing:9017'],
  },
  'F-prview': { status: 0, stderr: [], drops: [] },
  'F-landing': { status: 0, stderr: [LANDING_EXITED], drops: ['unlanded-blocker:9011'] },
  'F-inflight': { status: 0, stderr: [IN_FLIGHT_POOL_AUTO], drops: ['neighbour-in-flight:9013'] },
  'F-claim': {
    status: 0,
    stderr: ['AUTO — dispatch: shipped-candidate claim read failed for #9010 (network-failure), #9016 (network-failure); release time unknown, no downgrade', CLAIM_READ_FAILED_7001],
    drops: ['neighbour-in-flight:9013'],
  },
  'F-openprs': { status: 0, stderr: [], drops: [] },
  'F-writeback': { status: 0, stderr: ['Queue-order cache write-back failed (non-blocking): Command failed: git -C <SCR>/proj push origin '], drops: [] },
  'F-corrupt': { status: 1, stderr: [OPEN_STOP], entries: '{corrupt' },
  'F-groups': { status: 1, stderr: [OPEN_FILTER_WARNING, STOP_LINE.target], entries: ['blocked:9002', 'oversized:9001+9003+9016', 'not-spec-shaped:9004', 'not-spec-shaped:9007'] },
};
const FILES_STOPPED_NEIGHBOUR = { status: 1, stderr: [STOP_LINE.neighbour], drops: ['neighbour-in-flight:9013'] };
const FILES_FOREIGN = (why) => ({ status: 0, base: 'S2-files-miss', stderr: [`Warning: foreign blocker states file <SCR>/agent/foreign-states.json ignored (${why}`, FOREIGN_LOOKUP_NO_GH], drops: [] });
const FILES_EXPECT = {
  'files-queueRaw-missing': { status: 1, stderr: [STOP_LINE.grouping], entries: [] },
  'files-queueRaw-malformed': { status: 1, stderr: [STOP_LINE.grouping], entries: [] },
  'files-depFreshness-missing': { status: 1, stderr: [STOP_LINE.cacheHit], entries: [] },
  'files-depFreshness-malformed': { status: 1, stderr: [STOP_LINE.cacheHit], entries: [] },
  'files-depFreshness-missing-cold': { status: 0, stderr: [], drops: [] },
  'files-openNumbers-missing': { status: 1, stderr: [STOP_LINE.grouping], entries: [] },
  'files-openNumbers-malformed': { status: 1, stderr: [STOP_LINE.grouping], entries: [] },
  'files-verifiedOpenDeps-missing': { status: 0, base: 'files-livedep', stderr: [], drops: ['blocked:9002'] },
  'files-verifiedOpenDeps-malformed': { status: 0, base: 'files-livedep', stderr: [], drops: ['blocked:9002'] },
  'files-inFlightRaw-missing': FILES_STOPPED_NEIGHBOUR,
  'files-inFlightRaw-malformed': FILES_STOPPED_NEIGHBOUR,
  'files-inFlightClaims-missing': FILES_STOPPED_NEIGHBOUR,
  'files-inFlightClaims-malformed': FILES_STOPPED_NEIGHBOUR,
  'files-queueRaw-wrapper': { status: 0, stderr: [], entries: [] },
  'files-inFlightRaw-empty': { status: 0, stderr: [], drops: ['neighbour-in-flight:9013'] },
  'files-inFlightClaims-empty': { status: 0, stderr: [CLAIM_READ_FAILED_7001], drops: ['neighbour-in-flight:9013'] },
  'files-inFlightClaims-string': { status: 0, stderr: [], drops: ['neighbour-in-flight:9013'] },
  'files-foreignStates-missing': FILES_FOREIGN('ENOENT: '),
  'files-foreignStates-malformed': FILES_FOREIGN('not valid JSON) — supplied states not used (fail closed)'),
};

// The fault pool's pair configs: the bases, then each transport's rows (a `warm` row after its
// transport's base, copying that side's origin and so its queue-order blob, PF1).
function faultConfigs() {
  const rows = (transport) => (transport === 'gh' ? FAULTS : FILES_FAULTS).map((row) => {
    const scenario = row.scenario();
    return { name: row.id, scenario, transport, after: row.warm ? BASE[transport] : undefined, agent: transport === 'files' ? row.agent(agentInputs(scenario)) : null };
  });
  return [...FAULT_BASES, ...rows('gh'), ...rows('files')];
}

const compactEntries = (r) => {
  const text = r.files['dispatch-exclusions.json'];
  try { return JSON.parse(text).map((e) => `${e.reason}:${e.records.join('+')}`); } catch { return text; }
};
const injectedCalls = (r) => [...r.ghArgv, ...r.gitArgv].filter((a) => a.tag === 'injected').map((a) => a.argv.join(' '));
// The reported lines `r` adds on `channel` over its base's, near-duplicate AUTO lines aside.
function addedLines(r, base, channel) {
  const seen = new Set(normalize(reported(base[channel]), base.sandbox));
  return normalize(reported(r[channel]), r.sandbox).filter((l) => !seen.has(l) && !l.startsWith(NEAR_DUP));
}
const posture = (r) => (r.status === 0 ? 'open' : 'stop');

// One row: the oracle against the expectation, then the module against the oracle.
function assertFaultRow(row, expect, R, transport) {
  const pair = R[row.id];
  const base = R[expect.base || BASE[transport]];
  assertClean(pair, row.id);
  assertClean(base, `${row.id} base`);
  assert.equal(base.oracle.status, 0, `${row.id} base: ${base.oracle.stderr.slice(-2000)}`);
  const { oracle } = pair;
  const module = expect.status === 1 ? stopMapped(oracle, pair.module) : pair.module;
  assert.equal(oracle.status, expect.status, `${row.id}: the oracle's exit: ${oracle.stderr.slice(-2000)}`);
  if (expect.status === 0) assert.equal(pair.module.status, 0, `${row.id}: the CLI's exit: ${pair.module.stderr.slice(-2000)}`);
  for (const channel of ['stderr', 'stdout']) {
    const added = addedLines(oracle, base.oracle, channel);
    const want = expect[channel] || [];
    assert.equal(added.length, want.length, `${row.id} ${channel}: the oracle adds ${JSON.stringify(added)}`);
    want.forEach((prefix, i) => assert.ok(added[i].startsWith(prefix), `${row.id} ${channel}[${i}]: ${added[i]} does not start ${prefix}`));
  }
  const entries = compactEntries(oracle);
  if (expect.entries !== undefined) {
    assert.deepEqual(entries, expect.entries, `${row.id}: the oracle's exclusions`);
  } else {
    const baseEntries = compactEntries(base.oracle);
    for (const e of expect.drops) assert.ok(baseEntries.includes(e), `${row.id}: the base writes ${e} (control)`);
    const want = [...baseEntries.filter((e) => !expect.drops.includes(e)), ...(expect.adds || [])].sort();
    assert.deepEqual([...entries].sort(), want, `${row.id}: the oracle's exclusions against its base's`);
  }
  if (transport === 'gh' && row.pass !== '(stop)') {
    // The fault fired: each side logged an injected call its base did not make.
    const baseInjected = new Set(injectedCalls(base.oracle));
    for (const [side, r] of sides(pair)) assert.ok(injectedCalls(r).some((c) => !baseInjected.has(c)), `${row.id} ${side}: the fault's call was injected`);
  }
  assertFaultFiles(pair, transport, row.id, module);
}

// D1: two pulls in one session per side (the one deliberate session reuse: one session id and one
// TMPDIR), the second answering from D1Second's table.
async function runD1() {
  const made = [];
  try {
    const oracleSb = createSandbox(S1(), { name: 'D1' });
    made.push(oracleSb);
    const moduleSb = createSandbox(S1(), { name: 'D1' });
    made.push(moduleSb);
    const both = () => Promise.all([
      runOracle(oracleSb, FENCE, { tmp: 'one-session' }),
      runModuleCli(moduleSb, ['--transport', 'gh'], { tmp: 'one-session' }),
    ]);
    const [o1, m1] = await both();
    for (const sb of made) sb.setScenario(D1Second());
    const [o2, m2] = await both();
    return { first: { oracle: o1, module: m1 }, second: { oracle: o2, module: m2 } };
  } catch (err) {
    for (const sb of made) sb.cleanup();
    throw err;
  }
}

// The one fault pool: both transports' rows, their bases and D1, started by the first describe
// `before` that asks for it (the AC4 one) and awaited, already settled, by the other.
let faultPool = null;
function runFaultPool() {
  if (!faultPool) {
    const configs = faultConfigs();
    const reused = configs.filter((c) => PAIR_MEMO.has(c.name)).length;
    const t0 = Date.now();
    // D1 first: its two pulls run one after the other, so it starts before the single-pull pairs.
    faultPool = runAll([{ name: 'D1', run: runD1 }, ...pairJobs(configs)], POOL)
      .then((R) => ({ R, pairs: configs.length - reused, reused, ms: Date.now() - t0 }));
  }
  return faultPool;
}
after(async () => {
  if (!faultPool) return;
  let d1 = null;
  try { d1 = (await faultPool).R.D1; } catch { return; } // a failed runD1 removed its own sandboxes
  cleanupPairs([d1.first]); // the second pull ran in the same two sandboxes; the pairs are the memo's
});

describe('#5227 parity (AC4 fetch failures)', { skip: oracleSkip(), timeout: 600_000 }, () => {
  let R = {};
  let pool = null;
  before(async () => {
    pool = await runFaultPool();
    R = pool.R;
  });

  test('#5227 fault pool: every job ran (the gh and files fault rows, their bases and D1, in one pool)', (t) => {
    assertEveryJobRan(R);
    t.diagnostic(`fault pool: ${pool.pairs} new pairs (${pool.pairs * 2} runs) + D1 (4 runs), ${pool.reused} reused from the AC1 matrix, pool ${POOL}, wall ${pool.ms} ms`);
  });

  for (const f of FAULTS) {
    test(`AC4.1 [${f.id}]: the module takes the script's path — this fetch's posture, exit category, the same zero or one reported line per channel, exclusions and groups`, () => {
      assert.ok(FAULT_EXPECT[f.id], `${f.id} has an expectation row`);
      assertFaultRow(f, FAULT_EXPECT[f.id], R, 'gh');
    });
  }

  test('AC4.1 detail: each fault\'s own effect, both sides (cache miss, fail-closed foreign state, origin/ targets, unprobed files, no overlap, no blob)', () => {
    for (const [side, r] of sides(R['F-depfresh'])) {
      assert.ok(!r.stderr.includes(HIT_MESSAGE), `F-depfresh ${side}: the failed freshness search turns a warm cache into a miss`);
      assert.deepEqual(groupedIn(r), groupedIn(R['S1-gh-miss'].oracle), `F-depfresh ${side}: the recompute reaches the base's groups`);
    }
    for (const [side, r] of sides(R['F-foreign'])) {
      assert.deepEqual(exclusionsIn(r).find((e) => e.records[0] === 9031).detail.blockedBy, [FOREIGN_UNREADABLE], `F-foreign ${side}: fail closed`);
    }
    assert.deepEqual(exclusionsIn(R['S2-gh-miss'].oracle).find((e) => e.records[0] === 9031).detail.blockedBy, ['acme-corp/other#12'], 'the S2 base reads the state (control)');
    for (const [side, r] of sides(R['F-intbranch'])) {
      assert.deepEqual(exclusionsIn(r).find((e) => e.records[0] === 9017).detail, { path: 'docs/present.md' }, `F-intbranch ${side}`);
      assert.ok(r.gitArgv.some((e) => e.tag === 'injected' && e.argv.join(' ') === 'remote show origin'), `F-intbranch ${side}`);
      const proposals = Object.entries(r.staged).filter(([n]) => n.startsWith('dispatch-target-missing-')).map(([, body]) => body);
      assert.equal(proposals.length, 3, `F-intbranch ${side}`);
      assert.ok(proposals.every((body) => body.includes('absent at `origin/`')), `F-intbranch ${side}: every target-missing Close proposal names origin/`);
    }
    for (const [side, r] of sides(R['F-prview'])) assert.equal(r.files['dispatch-shipped-pr-files.jsonl'], '{"pr":5016,"files":[]}\n', `F-prview ${side}: a failed probe reads as no files`);
    assert.equal(R['S1-gh-miss'].oracle.files['dispatch-shipped-pr-files.jsonl'], `{"pr":5016,"files":${JSON.stringify(WEAK_PR_FILES)}}\n`, 'the base probes the files (control)');
    for (const [side, r] of sides(R['F-openprs'])) assert.deepEqual(JSON.parse(r.files['dispatch-crosspr-overlap.json']), [], `F-openprs ${side}`);
    assert.notDeepEqual(JSON.parse(R['S1-gh-miss'].oracle.files['dispatch-crosspr-overlap.json']), [], 'the base reports #9001 against PR #41 (control)');
    for (const [side, r] of sides(R['F-depview'])) assert.ok(groupedIn(r).includes(9002), `F-depview ${side}: #9002 is dispatchable`);
    for (const [side, r] of sides(R['gh-livedep'])) assert.ok(r.ghArgv.some((a) => a.argv.join(' ') === 'issue view 8000 --json state -q .state'), `gh-livedep ${side}: the live check is what holds #9002`);
  });

  test('AC4.2: each PASSES failOpen equals the strictest posture observed across that pass\'s fault fixtures (stop if any stops, else open; n/a with no fetch)', (t) => {
    const strictest = (side) => {
      const out = {};
      for (const rows of [FAULTS, FILES_FAULTS]) {
        for (const row of rows.filter((x) => x.pass !== '(stop)')) {
          const p = posture(R[row.id][side]);
          out[row.pass] = out[row.pass] === 'stop' || p === 'stop' ? 'stop' : 'open';
        }
      }
      return out;
    };
    const observed = strictest('oracle');
    assert.deepEqual(strictest('module'), observed, 'the module\'s exits give the same postures');
    for (const id of Object.keys(observed)) assert.ok(PASSES.some((p) => p.id === id), `fault rows name a registry id: ${id}`);
    for (const p of PASSES) assert.equal(p.failOpen, observed[p.id] || 'n/a', `${p.id} (${p.reason || p.kind})`);
    // PF6: neighbour-in-flight is open on gh and stop on files; the stricter value wins.
    assert.equal(posture(R['F-inflight'].oracle), 'open');
    assert.equal(posture(R['files-inFlightRaw-missing'].oracle), 'stop');
    t.diagnostic(`postures: ${JSON.stringify(observed)}`);
  });

  test('AC4.3: F-corrupt and F-groups stop the pull on both sides (oracle exit 1, CLI exit 4)', () => {
    for (const id of ['F-corrupt', 'F-groups']) {
      const { oracle, module } = R[id];
      stopMapped(oracle, module);
      for (const [side, r] of sides(R[id])) assert.ok(reported(r.stderr).at(-1).startsWith('dispatch: queue-pull stopped -- '), `${id} ${side}: the stop line is the last reported line`);
    }
    for (const [side, r] of sides(R['F-groups'])) assert.equal(r.files['dispatch-groups.json'], '{corrupt', `F-groups ${side}: the unreadable groups file is left as it was`);
    // These two rows are the fault rows that print a `$(cat <err file>)` line; every other row
    // compares both .err files whole.
    const tailRows = [...FAULTS, ...FILES_FAULTS].filter((f) => faultComparison(R[f.id], FAULTS.includes(f) ? 'gh' : 'files').tailErr.length).map((f) => f.id);
    assert.deepEqual(tailRows, ['F-corrupt', 'F-groups']);
    for (const id of tailRows) assert.deepEqual(faultComparison(R[id], 'gh').tailErr, ['dispatch-linked-prs.err'], id);
  });

  test('AC4.4: the oracle stops on exactly the observed stop set, and every other fault exits 0', () => {
    const STOP_SET = ['F-corrupt', 'F-groups', 'F-opennum', 'F-queue'];
    assert.deepEqual(FAULTS.filter((f) => R[f.id].oracle.status !== 0).map((f) => f.id).sort(), STOP_SET, 'the oracle');
    assert.deepEqual(FAULTS.filter((f) => R[f.id].module.status !== 0).map((f) => f.id).sort(), STOP_SET, 'the module');
    for (const f of FAULTS) {
      const want = STOP_SET.includes(f.id) ? [1, 4] : [0, 0];
      assert.deepEqual([R[f.id].oracle.status, R[f.id].module.status], want, f.id);
    }
  });

  test('AC4.5: F-writeback exits 0 on both sides with the non-blocking write-back line', () => {
    assert.ok(R['S1-gh-miss'].oracle.orderBlob, 'the base persists the blob (control)');
    for (const [side, r] of sides(R['F-writeback'])) {
      assert.equal(r.status, 0, `${side}: ${r.stderr.slice(-2000)}`);
      assert.equal(reported(r.stderr).filter((l) => l.startsWith('Queue-order cache write-back failed (non-blocking): ')).length, 1, side);
      assert.equal(r.orderBlob, null, `${side}: the push failed, so origin holds no blob`);
      assert.ok(r.gitArgv.some((e) => e.tag === 'injected' && e.argv.includes('push')), side);
      assert.deepEqual(groupedIn(r), groupedIn(R['S1-gh-miss'].oracle), `${side}: the pull went on to the base's groups`);
    }
  });

  test('AC4.6 parity: after F-corrupt the CLI exits 4, the exclusions file is byte-identical to the oracle\'s, and no later pass wrote its file', () => {
    const { oracle, module } = R['F-corrupt'];
    assert.equal(module.status, 4);
    assert.equal(module.files['dispatch-exclusions.json'], oracle.files['dispatch-exclusions.json']);
    assert.equal(oracle.files['dispatch-exclusions.json'], '{corrupt');
    const LATER = ['dispatch-named-targets.json', 'dispatch-shipped-probe-prs.json', 'dispatch-shipped-pr-files.jsonl', 'dispatch-shipped-releases.json',
      'dispatch-in-flight-raw.json', 'dispatch-open-prs.json', 'dispatch-crosspr-overlap.json', 'dispatch-near-dup-pairs.json'];
    for (const [side, r] of sides(R['F-corrupt'])) {
      for (const name of LATER) assert.equal(r.files[name], null, `${side}: ${name} (a pass after open-pr)`);
      assert.deepEqual(r.staged, {}, `${side}: no Close proposal staged`);
      assert.equal(r.decisions, '', `${side}: no decision logged`);
    }
    for (const name of LATER) assert.notEqual(R['S1-gh-miss'].oracle.files[name], null, `the base writes ${name} (control)`);
  });
});

describe('#5227 parity (AC7.2 files inputs)', { skip: oracleSkip(), timeout: 600_000 }, () => {
  let R = {};
  before(async () => {
    R = (await runFaultPool()).R;
  });

  for (const f of FILES_FAULTS) {
    test(`AC7.2 [${f.input} ${f.mode}]: module and oracle agree on the outcome`, () => {
      assert.ok(FILES_EXPECT[f.id], `${f.id} has an expectation row`);
      assertFaultRow(f, FILES_EXPECT[f.id], R, 'files');
    });
  }

  test('AC7.2: in-flight raw and claims FILE missing or malformed stop the pull; [] and {} values fail open; a bad foreign-states file excludes as (state unreadable) with a fail-closed Warning (Plan Review Clarifications, criterion 7)', () => {
    for (const id of ['files-inFlightRaw-missing', 'files-inFlightRaw-malformed', 'files-inFlightClaims-missing', 'files-inFlightClaims-malformed']) {
      stopMapped(R[id].oracle, R[id].module);
      for (const [side, r] of sides(R[id])) assert.equal(reported(r.stderr).at(-1), STOP_LINE.neighbour, `${id} ${side}`);
    }
    for (const id of ['files-inFlightRaw-empty', 'files-inFlightClaims-empty']) {
      for (const [side, r] of sides(R[id])) {
        assert.equal(r.status, 0, `${id} ${side}`);
        assert.deepEqual(exclusionsIn(r).filter((e) => e.reason === 'neighbour-in-flight'), [], `${id} ${side}: excludes nothing`);
      }
    }
    assert.deepEqual(exclusionsIn(R['S1-files-miss'].oracle).filter((e) => e.reason === 'neighbour-in-flight').map((e) => e.records[0]), [9013], 'the base excludes #9013 (control)');
    for (const id of ['files-foreignStates-missing', 'files-foreignStates-malformed']) {
      for (const [side, r] of sides(R[id])) {
        assert.equal(r.status, 0, `${id} ${side}`);
        assert.deepEqual(exclusionsIn(r).find((e) => e.records[0] === 9031).detail.blockedBy, [FOREIGN_UNREADABLE], `${id} ${side}: fail closed`);
        assert.ok(reported(r.stderr).some((l) => l.startsWith('Warning: ') && l.endsWith('(fail closed)')), `${id} ${side}: a fail-closed Warning`);
      }
    }
    assert.deepEqual(exclusionsIn(R['S2-files-miss'].oracle).find((e) => e.records[0] === 9031).detail.blockedBy, ['acme-corp/other#12'], 'a readable file answers the state (control)');
  });

  test('#5227 AC7.2: the agent-input carve-out covers only the rows that stop before an agent write point, and only the inputs written after it', () => {
    const carved = {};
    for (const f of FILES_FAULTS) {
      const { files } = faultComparison(R[f.id], 'files');
      const left = SESSION_FILES.filter((n) => !files.includes(n));
      if (left.length) carved[f.id] = left;
    }
    const inFlight = ['dispatch-in-flight-raw.json', 'dispatch-in-flight-claims.json'];
    // The grouping-block stops come before the neighbour pass's two writes; the warm cache-check
    // stop comes before the open-numbers and verified-open-deps writes as well.
    const cacheStop = ['dispatch-open-numbers.json', 'dispatch-verified-open-deps.txt', ...inFlight];
    assert.deepEqual(carved, {
      'files-queueRaw-missing': inFlight, 'files-queueRaw-malformed': inFlight,
      'files-depFreshness-missing': cacheStop, 'files-depFreshness-malformed': cacheStop,
      'files-openNumbers-missing': inFlight, 'files-openNumbers-malformed': inFlight,
    });
  });

  test('AC7.2: a dependency-freshness file the agent never wrote stops a warm-cache pull at the cache check, and on a cold cache only leaves the write-back unwritten', () => {
    for (const [side, r] of sides(R['files-depFreshness-missing'])) {
      assert.equal(reported(r.stderr).at(-1), STOP_LINE.cacheHit, `warm ${side}`);
      assert.equal(r.files['dispatch-groups.json'], null, `warm ${side}: the stop came before any groups file`);
    }
    assert.ok(R['S1-files-miss'].oracle.orderBlob, 'the cold base persists its blob (control)');
    for (const [side, r] of sides(R['files-depFreshness-missing-cold'])) {
      assert.equal(r.status, 0, `cold ${side}`);
      assert.equal(r.files['dispatch-dep-freshness.json'], null, `cold ${side}: the agent wrote none, so the session file is gone`);
      assert.equal(r.orderBlob, null, `cold ${side}: the write-back cannot read the freshness and persists nothing`);
      assert.deepEqual(groupedIn(r), groupedIn(R['S1-files-miss'].oracle), `cold ${side}: the pull itself is the base's`);
    }
  });

  test('#5227 D3: a wrapper-object queue file yields an empty pool, exit 0, no Warning, both sides', () => {
    for (const [side, r] of sides(R['files-queueRaw-wrapper'])) {
      assert.equal(r.status, 0, side);
      assert.deepEqual(JSON.parse(r.files['dispatch-groups.json']), [], `${side}: an empty pool`);
      assert.equal(r.files['dispatch-queue-raw.json'], '[]', `${side}: aliasMcpTimestamps rewrote the wrapper as []`);
      assert.deepEqual([...reported(r.stderr), ...reported(r.stdout)].filter((l) => l.startsWith('Warning: ')), [], `${side}: no Warning`);
    }
    assert.ok(groupedIn(R['S1-files-miss'].oracle).length > 0, 'the same records unwrapped are dispatchable (control)');
  });

  test('#5227 D4: a non-JSON claim string yields no exclusion and no AUTO line, both sides', () => {
    for (const [side, r] of sides(R['files-inFlightClaims-string'])) {
      assert.equal(r.status, 0, side);
      assert.deepEqual(exclusionsIn(r).filter((e) => e.reason === 'neighbour-in-flight'), [], side);
      assert.ok(!r.stderr.includes('neighbour-in-flight claim read failed'), `${side}: no AUTO line`);
    }
    // A number left out of the map ({}) is a failed read and does print it (control).
    for (const [side, r] of sides(R['files-inFlightClaims-empty'])) assert.ok(reported(r.stderr).includes(CLAIM_READ_FAILED_7001), side);
  });

  test('#5227 D1: a second pull in the same session whose open-numbers fetch returns empty reuses the first pull\'s eligible files, both sides', () => {
    const { first, second } = R.D1;
    assertClean(first, 'D1 first');
    assertClean(second, 'D1 second');
    for (const [side] of sides(second)) {
      const one = first[side];
      const two = second[side];
      assert.equal(one.status, 0, `${side} first: ${one.stderr.slice(-2000)}`);
      assert.equal(two.status, 0, `${side} second: exit 0 on stale data: ${two.stderr.slice(-2000)}`);
      assert.equal(two.files['dispatch-open-numbers.json'], '', `${side}: the second open-numbers fetch returned nothing`);
      assert.ok(two.ghArgv.some((a) => a.tag === 'injected' && a.argv.join(' ') === OPEN_NUMBERS_ARGV.join(' ')), side);
      assert.ok(!two.stderr.includes(HIT_MESSAGE), `${side}: the changed #9003 makes the cache miss`);
      for (const name of ['dispatch-eligible-pre-dep.json', 'dispatch-eligible.json', 'dispatch-blocked-excluded-body.json']) {
        assert.equal(two.files[name], one.files[name], `${side}: ${name} is the first pull's`);
      }
      assert.ok(JSON.parse(two.files['dispatch-queue-raw.json']).some((c) => c.title === 'Retitled after the first pull'), `${side}: the second queue holds the new title`);
      const title9003 = (groups) => groups.flat().find((c) => c.number === 9003).title;
      assert.equal(title9003(JSON.parse(two.files['dispatch-groups.json'])), 'Fixture record 9003', `${side}: the groups carry the first pull's record`);
      // Beyond the session files: the write-back persists those stale groups under the second
      // pull's freshness signal, so a third pull over the same queue would hit the cache on them.
      assert.equal(title9003(two.orderBlob.groups), 'Fixture record 9003', `${side}: the blob holds the stale groups`);
      assert.equal(two.orderBlob.freshnessSignal.issues.find((i) => i.number === 9003).updatedAt, '2026-11-12T11:00:00Z', `${side}: under the new freshness`);
    }
    assert.deepEqual(assertFaultFiles(first, 'gh', 'D1 first'), [], 'D1 first: no tail line, every file compared whole');
    assert.deepEqual(assertFaultFiles(second, 'gh', 'D1 second'), [], 'D1 second: no tail line, every file compared whole');
  });
});
