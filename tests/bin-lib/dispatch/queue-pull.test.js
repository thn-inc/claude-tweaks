'use strict';
// #5227: queue-pull module parity suite. The bash oracle runs plugin/skills/dispatch/
// queue-pull-script.md's fence whole, in a throwaway sandbox under PATH shims for gh, git and
// mktemp (tests/bin-lib/dispatch/queue-pull-oracle.js), with a frozen clock preloaded into every
// node process (queue-pull-clock-stub.js).
//
// Normalizations (AC1, and nothing else): the sandbox root becomes <SCR> and the pre-minted
// run-dir basename becomes <RUN>. The clock is frozen by the stub rather than normalized, and
// temp names match across sides through the QP_TMPNAME_COUNTER_FILE seam.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { readText } = require('../../helpers/read-skill');
const { gitRepo, fixtureGit } = require('../../helpers/git-fixtures');
const {
  REPO, SCRIPT_MD, FENCE_FIRST_LINE, RUN_DIR_NAME,
  oracleSkip, extractFence, fenceSessionFiles, createSandbox, runOracle, withEscapeGuard, normalize, reported, assertParity, runAll,
} = require('./queue-pull-oracle');
const {
  S0, S1, SFast, fakeRun, fakeSpawnCli, ghRecord, withBody, QUEUE_ARGV, DEP_SEARCH_8000,
} = require('./queue-pull-fixtures');
const {
  PASSES, PASS_FIELD_VALUES, SESSION_FILES, QueuePullStopped, sessionPaths, runPasses, resolveOmit, defaultDeps, makeContext, queuePull,
} = require('../../../plugin/bin/lib/dispatch/queue-pull');
const { appendExclusion } = require('../../../plugin/bin/lib/dispatch/exclusions');

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

test('#5227 oracle: the git shim refuses a directory outside the sandbox, an exported GIT_DIR and a command-running -c key', { skip: oracleSkip() }, () => {
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
    for (const setting of ['core.hooksPath=/x', 'core.fsmonitor=true', 'core.worktree=/x', 'core.sshCommand=x', 'core.gitProxy=x', 'alias.st=!sh', 'Core.HooksPath=/x']) {
      const r = git(['-c', setting, 'rev-parse', '--show-toplevel']);
      assert.equal(r.status, 97, setting);
      assert.match(r.stderr, /git-shim: refused \(config key not allowed: /, setting);
    }
    const allowed = git(['-c', 'core.quotePath=false', 'rev-parse', '--show-toplevel']);
    assert.equal(allowed.status, 0, allowed.stderr);
    const log = fs.readFileSync(path.join(sb.logs, 'git-argv.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.equal(log.filter((e) => e.tag === 'REFUSED').length, 9);
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
    await assert.rejects(
      withEscapeGuard(repo, async () => { fs.writeFileSync(path.join(repo, 'stray.txt'), 'x'); }),
      /escape guard/,
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
  await assert.rejects(runAll([{ name: 'a', run: async () => { throw new Error('boom'); } }], 1), /job a failed: boom/);
  await assert.rejects(runAll([{ name: 'a', after: 'nope', run: async () => 1 }], 1), /unknown after/);
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

test('#5227 queuePull runs the truncate..write-back passes, then stops at the first pass with no runner', () => inOwnTmp((own) => {
  const paths = sessionPaths('qp-pull');
  appendExclusion(paths['dispatch-exclusions.json'], { reason: 'blocked', records: [1], detail: { blockedBy: [2] } });
  const seen = [];
  const deps = {
    run: fakeRun(S0()),
    spawnCli: fakeSpawnCli(S0()),
    queueOrder: { readOrder: () => null, writeOrder: () => ({ ok: true }) },
    expressQueuePolicy: () => ({ enabled: false, grouping: 'per-record', keepSingleton: () => false }),
    onPass: (id) => seen.push(id),
    stderr: () => {},
  };
  assert.throws(() => queuePull({ sessionId: 'qp-pull', cwd: own }, deps), /queue-pull: pass not implemented: not-spec-shaped/);
  assert.deepEqual(seen, ['truncate', 'fetch', 'blocked', 'oversized', 'write-back'], 'onPass fires only for a pass that has a runner');
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
      queueOrder: {
        readOrder: () => store.persisted,
        writeOrder: (root, blob) => { store.written.push({ root, blob }); return o.writeResult || { ok: true }; },
      },
      ...(o.deps || {}),
    };
    const extra = o.prepare ? o.prepare(own) : {};
    const options = { transport: o.transport || 'gh', sessionId, cwd, env: o.env || {}, omit: o.omit || [], inputs: o.inputs, ...extra };
    const ctx = makeContext(options, deps);
    if (o.before) o.before(ctx, own);
    let thrown = null;
    try { runPasses(T3_PASSES, ctx); } catch (err) { thrown = err; }
    if (thrown && !o.allowThrow) throw thrown;
    const text = {};
    for (const name of SESSION_FILES) if (fs.existsSync(paths[name])) text[name] = fs.readFileSync(paths[name], 'utf8');
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
  assert.equal(omitted.store.written.length, 1, 'the write-back still ran');
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

test('#5227 files: the queue file is aliased in place, dispatch-verified-open-deps.txt replaces the gh issue view loop, and no gh call is made', () => {
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
  const queue = JSON.parse(held.text[held.state.files.queueRaw]);
  assert.equal(queue[0].createdAt, '2026-11-01T10:00:00Z');
  assert.equal(queue[0].created_at, '2026-11-01T10:00:00Z', 'the snake_case key stays beside the alias');
  assert.equal(queue[0].updatedAt, '2026-11-10T10:00:00Z');
  assert.equal(JSON.parse(held.text[held.state.files.depFreshness])[0].updatedAt, '2026-11-09T10:00:00Z', 'the dependency-freshness file is aliased too');
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

test('#5227 D3: a non-array queue file such as {issues:[...]} reads as an empty queue, with no Warning', () => {
  const r = pull(S1(), {
    transport: 'files', run: () => { throw new Error('no gh on files'); },
    prepare: (own) => {
      const put = (name, content) => { const file = path.join(own, name); fs.writeFileSync(file, content); return file; };
      return { inputs: {
        queueRaw: put('queue.json', JSON.stringify({ issues: [mcpRecord(9001, withBody(9001))] })),
        openNumbers: put('open.json', '[]'),
        depFreshness: put('dep.json', '[]'),
        verifiedOpenDeps: put('verified.txt', ''),
      } };
    },
  });
  assert.equal(r.text[r.state.files.queueRaw], '[]');
  assert.deepEqual(r.json('dispatch-groups.json'), []);
  assert.deepEqual(r.errs, [], r.stderr);
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
