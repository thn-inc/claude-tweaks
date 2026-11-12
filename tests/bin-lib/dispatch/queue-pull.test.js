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
const { S0, fakeRun } = require('./queue-pull-fixtures');

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

test('#5227 oracle: the git shim refuses a directory outside the sandbox and an exported GIT_DIR', { skip: oracleSkip() }, () => {
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
    const gitDir = git(['status'], { GIT_DIR: path.join(REPO, '.git') });
    assert.equal(gitDir.status, 97);
    assert.match(gitDir.stderr, /GIT_DIR\/GIT_WORK_TREE set/);
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
