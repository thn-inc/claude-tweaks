// tests/helpers-git-template.test.js — the template-copy git fixture helper
// (#5297): build a fixture once per process, hand every caller an fs.cpSync
// copy whose git metadata paths were rewritten by plain file edits.
'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { fixtureGit } = require('./helpers/git-fixtures');
const {
  fromTemplate,
  fromTemplateSet,
  rewriteTemplatePaths,
  assertNoTemplatePaths,
  disableReceiveAutoGc,
} = require('./helpers/git-template');

const scratch = [];
after(() => {
  for (const d of scratch) fs.rmSync(d, { recursive: true, force: true });
});
function mk(prefix) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  scratch.push(d);
  return d;
}

// An empty config file pinned as the global/system config, so a host's own
// git config (maintenance.auto, receive.autogc, signing...) cannot leak in.
const EMPTY_CONFIG = path.join(mk('ct-gt-cfg-'), 'empty');
fs.writeFileSync(EMPTY_CONFIG, '');
// Built per call, never at load: a template build appends maintenance-off keys
// to process.env at build time, and a load-time snapshot would miss them.
const gitEnv = () => ({
  ...process.env,
  GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.test',
  GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.test',
  GIT_CONFIG_GLOBAL: EMPTY_CONFIG, GIT_CONFIG_SYSTEM: EMPTY_CONFIG,
});
function git(cwd, args, env = gitEnv()) {
  return fixtureGit(args, { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}
function commit(cwd, name) {
  fs.writeFileSync(path.join(cwd, name), name);
  git(cwd, ['add', name]);
  git(cwd, ['commit', '-q', '-m', name]);
}
function repoBuild(dir) {
  git(dir, ['init', '-q', '-b', 'main']);
  commit(dir, 'base');
}
// Every `start` event's argv, one trace2 file per git process in `dir`.
function tracedArgvs(dir) {
  const out = [];
  for (const f of fs.readdirSync(dir)) {
    for (const line of fs.readFileSync(path.join(dir, f), 'utf8').split('\n')) {
      if (!line.trim()) continue;
      const ev = JSON.parse(line);
      if (ev.event === 'start') out.push(ev.argv);
    }
  }
  return out;
}
function withEnv(name, value, fn) {
  const prev = process.env[name];
  process.env[name] = value;
  try { return fn(); } finally {
    if (prev === undefined) delete process.env[name]; else process.env[name] = prev;
  }
}

test('fromTemplate builds once and returns independent copies', () => {
  let builds = 0;
  const build = (dir) => { builds++; repoBuild(dir); };
  const dirs = [1, 2, 3].map(() => fromTemplate('k1', build, { prefix: 'ct-gt-' }));
  scratch.push(...dirs);
  assert.strictEqual(builds, 1);
  assert.strictEqual(new Set(dirs).size, 3);
  for (const d of dirs) assert.ok(path.basename(d).startsWith('ct-gt-'), d);
  const heads = dirs.map((d) => git(d, ['rev-parse', 'HEAD']));
  assert.strictEqual(new Set(heads).size, 1);
  commit(dirs[0], 'more');
  assert.notStrictEqual(git(dirs[0], ['rev-parse', 'HEAD']), heads[0]);
  assert.strictEqual(git(dirs[1], ['rev-parse', 'HEAD']), heads[1]);
});

test('a copy starts no git process', () => {
  const build = repoBuild;
  scratch.push(fromTemplate('k1', build, { prefix: 'ct-gt-' })); // warm-up: the build may spawn git
  const trace = mk('ct-gt-trace-');
  const copies = withEnv('GIT_TRACE2_EVENT', trace, () => [
    fromTemplate('k1', build, { prefix: 'ct-gt-' }),
    fromTemplate('k1', build, { prefix: 'ct-gt-' }),
  ]);
  scratch.push(...copies);
  assert.deepStrictEqual(fs.readdirSync(trace), []);
});

test('fromTemplateSet rewires a clone to its own copied origin', () => {
  let templateOrigin;
  const build = (d) => {
    templateOrigin = d.origin;
    git(d.origin, ['init', '-q', '--bare', '-b', 'main']);
    disableReceiveAutoGc(d.origin);
    git(d.work, ['init', '-q', '-b', 'main']);
    git(d.work, ['remote', 'add', 'origin', d.origin]);
    commit(d.work, 'base');
    git(d.work, ['push', '-q', 'origin', 'main']);
  };
  const layout = { origin: { prefix: 'ct-gts-o-' }, work: { prefix: 'ct-gts-w-' } };
  const a = fromTemplateSet('s1', build, layout);
  const b = fromTemplateSet('s1', build, layout);
  scratch.push(...Object.values(a), ...Object.values(b));
  const before = git(a.origin, ['rev-parse', 'main']);
  assert.strictEqual(git(b.origin, ['rev-parse', 'main']), before);
  commit(a.work, 'next');
  git(a.work, ['push', '-q', 'origin', 'HEAD']);
  assert.strictEqual(git(a.origin, ['rev-parse', 'main']), git(a.work, ['rev-parse', 'HEAD']));
  assert.notStrictEqual(git(a.origin, ['rev-parse', 'main']), before);
  assert.strictEqual(git(b.origin, ['rev-parse', 'main']), before);
  assert.strictEqual(git(templateOrigin, ['rev-parse', 'main']), before);
  assert.strictEqual(git(b.work, ['config', 'remote.origin.url']), b.origin);
});

test('a copied linked worktree resolves to the copy\'s main repo', () => {
  const build = (dir) => {
    repoBuild(dir);
    git(dir, ['worktree', 'add', '-q', path.join(dir, '.claude', 'worktrees', 'feat'), '-b', 'feat']);
  };
  const copy = fromTemplate('wt1', build, { prefix: 'ct-gtw-', realpath: true });
  scratch.push(copy);
  const wt = path.join(copy, '.claude', 'worktrees', 'feat');
  const common = git(wt, ['rev-parse', '--git-common-dir']);
  assert.strictEqual(fs.realpathSync(path.resolve(wt, common)), path.join(copy, '.git'));
  const listed = git(copy, ['worktree', 'list', '--porcelain'])
    .split('\n').filter((l) => l.startsWith('worktree ')).map((l) => fs.realpathSync(l.slice(9)));
  assert.ok(listed.includes(wt), listed.join(', '));
});

test('rewriteTemplatePaths does not corrupt a longer sibling path', () => {
  const root = mk('ct-gtr-');
  fs.mkdirSync(path.join(root, '.git'));
  const cfg = path.join(root, '.git', 'config');
  fs.writeFileSync(cfg, '[remote "a"]\n\turl = /T/tpl-1/o\n[remote "b"]\n\turl = /T/tpl-10/o\n');
  rewriteTemplatePaths(root, [['/T/tpl-1', '/T/new']]);
  assert.strictEqual(
    fs.readFileSync(cfg, 'utf8'),
    '[remote "a"]\n\turl = /T/new/o\n[remote "b"]\n\turl = /T/tpl-10/o\n',
  );
});

test('realpath: true returns a resolved path', () => {
  const d = fromTemplate('k1', repoBuild, { prefix: 'ct-gt-', realpath: true });
  scratch.push(d);
  assert.strictEqual(fs.realpathSync(d), d);
});

test('a throwing build is not cached', () => {
  let builds = 0;
  let firstDir;
  const build = (dir) => {
    builds++;
    if (builds === 1) {
      firstDir = dir;
      fs.writeFileSync(path.join(dir, 'partial'), 'x');
      throw new Error('boom from builder');
    }
    repoBuild(dir);
  };
  assert.throws(() => fromTemplate('k-throw', build, { prefix: 'ct-gt-' }), /boom from builder/);
  assert.ok(firstDir && !fs.existsSync(firstDir), 'partial template dir was removed');
  assert.ok(!fs.existsSync(path.dirname(firstDir)), 'template base dir was removed');
  const d = fromTemplate('k-throw', build, { prefix: 'ct-gt-' });
  scratch.push(d);
  assert.strictEqual(builds, 2);
  assert.ok(fs.existsSync(path.join(d, '.git')));
});

test('assertNoTemplatePaths catches a surviving template path', () => {
  const root = mk('ct-gta-');
  fs.mkdirSync(path.join(root, '.git'));
  const cfg = path.join(root, '.git', 'config');
  fs.writeFileSync(cfg, '[remote "a"]\n\turl = /T/tpl-1/o\n');
  assert.throws(() => assertNoTemplatePaths(root, ['/T/tpl-1']), /survived rewrite/);
  fs.writeFileSync(cfg, '[remote "a"]\n\turl = /T/new/o\n');
  assert.doesNotThrow(() => assertNoTemplatePaths(root, ['/T/tpl-1']));
});

test('assertNoTemplatePaths catches an unlisted spelling by the template\'s unique names', () => {
  const root = mk('ct-gtu-');
  fs.mkdirSync(path.join(root, '.git'));
  const cfg = path.join(root, '.git', 'config');
  const names = ['ct-git-template-AbC123', 't4-XyZ789'];
  // Upper-cased drive prefix and doubled slashes: no generated spelling matches these.
  fs.writeFileSync(cfg, '[remote "a"]\n\turl = D:\\\\T//CT-GIT-TEMPLATE-ABC123//t4-xyz789/o\n');
  assert.throws(() => assertNoTemplatePaths(root, ['/T/tpl-1'], names), /survived rewrite/);
  assert.throws(() => rewriteTemplatePaths(root, [['/T/tpl-1', '/T/new']], names), /survived rewrite/);
  fs.writeFileSync(cfg, '[remote "a"]\n\turl = /T/new/o\n');
  assert.doesNotThrow(() => assertNoTemplatePaths(root, ['/T/tpl-1'], names));
});

test('fromTemplate hands the unique template names to the survivor check', () => {
  // A .git pointer holding a doubled-slash, upper-cased member path: no generated spelling
  // matches it, only the case-insensitive unique-name scan can.
  const build = (dir) => fs.writeFileSync(path.join(dir, '.git'), `gitdir: //${dir.toUpperCase()}/.git/worktrees/w\n`);
  assert.throws(() => fromTemplate('k-unique', build, { prefix: 'ct-gtq-' }), /survived rewrite/);
});

test('rewriteTemplatePaths rewrites every Windows-shaped spelling', () => {
  const root = mk('ct-gtwin-');
  fs.mkdirSync(path.join(root, '.git', 'worktrees', 'w'), { recursive: true });
  fs.mkdirSync(path.join(root, 'wt'));
  const cfg = path.join(root, '.git', 'config');
  const gitdir = path.join(root, '.git', 'worktrees', 'w', 'gitdir');
  const ptr = path.join(root, 'wt', '.git');
  fs.writeFileSync(cfg, '[remote "a"]\n\turl = C:\\\\T\\\\tpl-1\\\\o\n[core]\n\tworktree = C:\\T\\tpl-1\\wt\n');
  fs.writeFileSync(gitdir, 'C:/T/tpl-1/.git/worktrees/w\n');
  fs.writeFileSync(ptr, 'gitdir: C:/T/tpl-1/.git/worktrees/w\n');
  // The template path does not exist here: realpath-based spellings must be skipped, not thrown.
  rewriteTemplatePaths(root, [['C:\\T\\tpl-1', 'C:\\T\\new']]);
  assert.strictEqual(fs.readFileSync(cfg, 'utf8'),
    '[remote "a"]\n\turl = C:\\\\T\\\\new\\\\o\n[core]\n\tworktree = C:\\T\\new\\wt\n');
  assert.strictEqual(fs.readFileSync(gitdir, 'utf8'), 'C:/T/new/.git/worktrees/w\n');
  assert.strictEqual(fs.readFileSync(ptr, 'utf8'), 'gitdir: C:/T/new/.git/worktrees/w\n');
});

test('reusing a key with a different layout throws a clear error', () => {
  const layout = { a: { prefix: 'ct-gtl-a-' }, b: { prefix: 'ct-gtl-b-' } };
  scratch.push(...Object.values(fromTemplateSet('k-layout', () => {}, layout)));
  assert.throws(() => fromTemplate('k-layout', () => {}, { prefix: 'ct-gtl-' }),
    /key "k-layout" was built with a different layout/);
  assert.throws(() => fromTemplateSet('k-layout', () => {}, { a: { prefix: 'ct-gtl-a-' } }),
    /different layout/);
});

test('assertNoTemplatePaths also scans objects/info/alternates', () => {
  const root = mk('ct-gtalt-');
  fs.mkdirSync(path.join(root, '.git', 'objects', 'info'), { recursive: true });
  fs.writeFileSync(path.join(root, '.git', 'objects', 'info', 'alternates'), '/T/tpl-1/.git/objects\n');
  assert.throws(() => assertNoTemplatePaths(root, ['/T/tpl-1']), /survived rewrite/);
});

test('disableReceiveAutoGc stops receive-pack maintenance', () => {
  // Push into a fresh bare origin from a fresh clone, tracing only the push
  // (the clone's own commit would start maintenance on its side, which is not
  // what is under test). Returns the argv of every git process the push began.
  function pushArgvs(disable) {
    const origin = mk('ct-gtg-o-');
    const work = mk('ct-gtg-w-');
    git(origin, ['init', '-q', '--bare', '-b', 'main']);
    if (disable) disableReceiveAutoGc(origin);
    // Keep receive-pack's maintenance in the foreground (git >= 2.47 detaches
    // by default), so its trace file is complete before we read and remove it.
    fs.appendFileSync(path.join(origin, 'config'), '[maintenance]\n\tautoDetach = false\n');
    git(work, ['init', '-q', '-b', 'main']);
    git(work, ['remote', 'add', 'origin', origin]);
    commit(work, 'base');
    const trace = mk('ct-gtg-t-');
    git(work, ['push', '-q', 'origin', 'main'], { ...gitEnv(), GIT_TRACE2_EVENT: trace });
    return tracedArgvs(trace);
  }
  const hasMaintenance = (argvs) => argvs.some((a) => a.includes('maintenance'));
  assert.ok(!hasMaintenance(pushArgvs(true)), 'no maintenance after disableReceiveAutoGc');
  assert.ok(hasMaintenance(pushArgvs(false)), 'control: without the call, receive-pack starts maintenance');
});

// The per-test repo builders sit on templates (#5297): after one warm-up call
// (which may build), a further call starts no git process.
const preToolUse = require('./helpers/pre-tool-use');
const gitFixtures = require('./helpers/git-fixtures');
const builders = {
  'pre-tool-use gitRepo': [() => preToolUse.gitRepo(), (d) => [d]],
  'pre-tool-use gitRepoWithCommit': [() => preToolUse.gitRepoWithCommit(), (d) => [d]],
  'git-fixtures gitRepo()': [() => gitFixtures.gitRepo(), (d) => [d]],
  'git-fixtures gitRepo({ branch })': [() => gitFixtures.gitRepo({ branch: 'trunk' }), (d) => [d]],
  'originWithTwoClones': [() => gitFixtures.originWithTwoClones('ct-gt-otc-'), (r) => [r.root]],
};
for (const [name, [make, dirsOf]] of Object.entries(builders)) {
  test(`${name}: a second call starts no git process`, () => {
    scratch.push(...dirsOf(make()));
    const trace = mk('ct-gt-trace-');
    const second = withEnv('GIT_TRACE2_EVENT', trace, make);
    scratch.push(...dirsOf(second));
    assert.deepStrictEqual(fs.readdirSync(trace), []);
  });
}

// #5324: the pre-tool-use fixed pairs and repos sit on templates too.
const preToolUsePairs = {
  'pre-tool-use mainAndWorktree': [() => preToolUse.mainAndWorktree(), (r) => [r.main, path.dirname(r.wt)]],
  'pre-tool-use mainAndWorktree({ localMain })': [() => preToolUse.mainAndWorktree({ localMain: true }), (r) => [r.main, path.dirname(r.wt)]],
  'pre-tool-use gitRepoOnLocalMain': [() => preToolUse.gitRepoOnLocalMain(), (d) => [d]],
  'pre-tool-use unpinnedRepoWithOrigin': [() => preToolUse.unpinnedRepoWithOrigin(), (d) => [d]],
};
for (const [name, [make, dirsOf]] of Object.entries(preToolUsePairs)) {
  test(`AC1.1 AC1.2: ${name}: a second call starts no git process`, () => {
    scratch.push(...dirsOf(make()));
    const trace = mk('ct-gt-trace-');
    const second = withEnv('GIT_TRACE2_EVENT', trace, make);
    scratch.push(...dirsOf(second));
    assert.deepStrictEqual(fs.readdirSync(trace), []);
  });
}
test('a copied mainAndWorktree pair resolves to its own main, and a second worktree can be added to it', () => {
  const a = preToolUse.mainAndWorktree();
  const b = preToolUse.mainAndWorktree();
  scratch.push(a.main, path.dirname(a.wt), b.main, path.dirname(b.wt));
  for (const p of [a, b]) {
    assert.ok(path.basename(p.main).startsWith('ct-e1-'), p.main);
    assert.ok(path.basename(path.dirname(p.wt)).startsWith('ct-e1-wtparent-'), p.wt);
    const common = git(p.wt, ['rev-parse', '--git-common-dir']);
    assert.strictEqual(fs.realpathSync(path.resolve(p.wt, common)), path.join(p.main, '.git'));
    assert.strictEqual(fs.realpathSync(git(p.wt, ['rev-parse', '--show-toplevel'])), p.wt);
  }
  const listed = (p) => git(p.main, ['worktree', 'list', '--porcelain'])
    .split('\n').filter((l) => l.startsWith('worktree ')).map((l) => fs.realpathSync(l.slice(9)));
  assert.ok(listed(a).includes(a.wt), listed(a).join(', '));
  assert.ok(!listed(a).includes(b.wt), listed(a).join(', '));
  const extra = path.join(mk('ct-gt-wt2-'), 'wt');
  git(a.main, ['worktree', 'add', '-q', extra, '-b', 'extra']);
  assert.strictEqual(git(extra, ['rev-parse', 'HEAD']), git(a.main, ['rev-parse', 'HEAD']));
});
test('mainAndWorktree({ localMain: true }) and gitRepoOnLocalMain copies are on main', () => {
  const pair = preToolUse.mainAndWorktree({ localMain: true });
  const repo = preToolUse.gitRepoOnLocalMain();
  scratch.push(pair.main, path.dirname(pair.wt), repo);
  assert.strictEqual(git(pair.main, ['symbolic-ref', '--short', 'HEAD']), 'main');
  assert.strictEqual(git(repo, ['symbolic-ref', '--short', 'HEAD']), 'main');
});
test('unpinnedRepoWithOrigin copies carry the GitHub-shaped origin and one commit', () => {
  const repo = preToolUse.unpinnedRepoWithOrigin();
  scratch.push(repo);
  assert.strictEqual(git(repo, ['remote', 'get-url', 'origin']), 'https://github.com/o/n.git');
  assert.strictEqual(git(repo, ['rev-list', '--count', 'HEAD']), '1');
});

// #5324: the verify scenario builders sit on templates, keyed by their arguments.
const verifyHelpers = require('./bin-lib/verify/cli-helpers');
const verifyRules = (glob) => [{ match: glob, suites: ['unit'] }];
for (const [name, make] of [
  ['verify scopedRepo', () => verifyHelpers.scopedRepo(verifyRules('src/**'))],
  ['verify scopedRepo with generated', () => verifyHelpers.scopedRepo(verifyRules('src/**'), { generated: ['**'] })],
  ['verify flakyRepo()', () => verifyHelpers.flakyRepo()],
  ['verify flakyRepo({ retryExit: 1 })', () => verifyHelpers.flakyRepo({ retryExit: 1 })],
  ['verify baselineRepo', () => verifyHelpers.baselineRepo()],
]) {
  test(`AC1.1 AC1.2: ${name}: a second call starts no git process`, () => {
    scratch.push(make().repo);
    const trace = mk('ct-gt-trace-');
    const second = withEnv('GIT_TRACE2_EVENT', trace, make);
    scratch.push(second.repo);
    assert.deepStrictEqual(fs.readdirSync(trace), []);
  });
}
test('verify builders: per-call values match git, and different arguments never share a template', () => {
  const s = verifyHelpers.scopedRepo(verifyRules('src/**'));
  const s2 = verifyHelpers.scopedRepo(verifyRules('lib/**'));
  const b = verifyHelpers.baselineRepo();
  const fDefault = verifyHelpers.flakyRepo();
  const fExit1 = verifyHelpers.flakyRepo({ retryExit: 1 });
  scratch.push(s.repo, s2.repo, b.repo, fDefault.repo, fExit1.repo);
  assert.strictEqual(s.branch, git(s.repo, ['symbolic-ref', '--short', 'HEAD']));
  assert.ok(s.marker.startsWith(s.gitDir), s.marker);
  assert.ok(s.unitCmd.includes(s.marker), s.unitCmd);
  const rulesOf = (r) => JSON.parse(fs.readFileSync(path.join(r.repo, r.declPath), 'utf8')).rules;
  assert.deepStrictEqual(rulesOf(s), verifyRules('src/**'));
  assert.deepStrictEqual(rulesOf(s2), verifyRules('lib/**'));
  assert.strictEqual(b.baseSha, git(b.repo, ['rev-parse', 'HEAD']));
  assert.strictEqual(fDefault.branch, git(fDefault.repo, ['symbolic-ref', '--short', 'HEAD']));
  assert.ok(fExit1.marker.startsWith(fExit1.repo), fExit1.marker);
  assert.ok(fExit1.retryLog(0).startsWith(fExit1.gitDir), fExit1.retryLog(0));
  assert.ok(fs.readFileSync(path.join(fExit1.repo, 'retry.js'), 'utf8').includes('process.exit(1)'));
  assert.ok(fs.readFileSync(path.join(fDefault.repo, 'retry.js'), 'utf8').includes('process.exit(0)'));
  // A key that dropped `failingFile` or `extra` would hand a later call the first call's files.
  const fReal = verifyHelpers.flakyRepo({ failingFile: 'tests/real.test.js' });
  const sGenerated = verifyHelpers.scopedRepo(verifyRules('src/**'), { generated: ['**'] });
  scratch.push(fReal.repo, sGenerated.repo);
  const failJs = (r) => fs.readFileSync(path.join(r.repo, 'fail.js'), 'utf8');
  assert.ok(failJs(fReal).includes('tests/real.test.js'), failJs(fReal));
  assert.ok(!failJs(fDefault).includes('tests/real.test.js'), failJs(fDefault));
  const declOf = (r) => JSON.parse(fs.readFileSync(path.join(r.repo, r.declPath), 'utf8'));
  assert.deepStrictEqual(declOf(sGenerated).generated, ['**']);
  assert.strictEqual(declOf(s).generated, undefined);
});
test('Absorbed AC (identity): a fresh process building every owned fixture starts no git config user.name/user.email process', () => {
  const trace = mk('ct-gt-trace-');
  const childTmp = mk('ct-gt-childtmp-');
  const script = [
    "const [pre, verify] = process.argv.slice(1).map((p) => require(p));",
    'pre.gitRepo(); pre.gitRepoWithCommit(); pre.gitRepoOnLocalMain();',
    'pre.mainAndWorktree(); pre.mainAndWorktree({ localMain: true });',
    'pre.unpinnedRepoWithOrigin();',
    "verify.tmpGitRepo(); verify.scopedRepo([{ match: 'src/**', suites: ['unit'] }]); verify.flakyRepo(); verify.baselineRepo();",
  ].join('\n');
  const repoRoot = path.join(__dirname, '..');
  const res = spawnSync(process.execPath, [
    '-e', script,
    path.join(repoRoot, 'tests', 'helpers', 'pre-tool-use'),
    path.join(repoRoot, 'tests', 'bin-lib', 'verify', 'cli-helpers'),
  ], {
    cwd: repoRoot,
    // The child's own copies live under its temp dir; pointing it at a scratch dir lets this file's after() remove them.
    env: { ...process.env, GIT_TRACE2_EVENT: trace, TMPDIR: childTmp, TMP: childTmp, TEMP: childTmp },
    encoding: 'utf8',
  });
  assert.strictEqual(res.status, 0, res.stderr);
  const argvs = tracedArgvs(trace);
  assert.ok(argvs.length > 0, 'control: the builders did trace git processes');
  // The subcommand is the first word after `git` that is not an option or an option's value.
  const configKeys = (argv) => {
    let i = 1;
    while (i < argv.length) {
      if (argv[i] === '-C' || argv[i] === '-c') i += 2;
      else if (argv[i].startsWith('-')) i += 1;
      else break;
    }
    return argv[i] === 'config' ? argv.slice(i + 1) : [];
  };
  const offenders = argvs.filter((a) => configKeys(a).some((k) => k === 'user.name' || k === 'user.email'));
  assert.deepStrictEqual(offenders, []);
});
test('Absorbed AC (identity): the identity written into a template reaches its copies', () => {
  // `--local` reads only the copy's own .git/config, so a CI-exported GIT_AUTHOR_* cannot stand in for it.
  const plain = verifyHelpers.tmpGitRepo();
  const scoped = verifyHelpers.scopedRepo(verifyRules('src/**'));
  scratch.push(plain.repo, scoped.repo);
  for (const r of [plain, scoped]) {
    assert.strictEqual(git(r.repo, ['config', '--local', 'user.email']), 'verify-test@example.invalid');
  }
});

test('template build runs with auto-maintenance off', () => {
  // The runner's own GIT_CONFIG_* (tools/run-tests.js) would mask a missing
  // append, so take them out for the duration and put them back after.
  const mine = /^GIT_CONFIG_(COUNT|KEY_\d+|VALUE_\d+|GLOBAL|SYSTEM)$/;
  const saved = Object.entries(process.env).filter(([k]) => mine.test(k));
  for (const [k] of saved) delete process.env[k];
  const trace = mk('ct-gt-trace-');
  try {
    process.env.GIT_CONFIG_GLOBAL = EMPTY_CONFIG;
    process.env.GIT_CONFIG_SYSTEM = EMPTY_CONFIG;
    withEnv('GIT_TRACE2_EVENT', trace, () => {
      // The file's own repoBuild path (call-time gitEnv), as every other build here.
      scratch.push(fromTemplate('maint-off', repoBuild, { prefix: 'ct-gt-' }));
    });
  } finally {
    for (const k of Object.keys(process.env)) if (mine.test(k)) delete process.env[k];
    for (const [k, v] of saved) process.env[k] = v;
  }
  assert.ok(tracedArgvs(trace).length > 0, 'control: the build did trace git processes');
  assert.ok(!tracedArgvs(trace).some((a) => a.includes('maintenance')), 'no maintenance process during the build');
});

test('git-fixtures gitRepo({ branch }) keeps the requested branch', () => {
  const dir = gitFixtures.gitRepo({ branch: 'trunk' });
  scratch.push(dir);
  assert.strictEqual(git(dir, ['symbolic-ref', '--short', 'HEAD']), 'trunk');
});

// reconcile's fixtures (#5297): same shape, plus the rewired origin/seed/main triple.
const reconcileFixtures = require('./helpers/reconcile-fixtures');
for (const [name, make, dirsOf] of [
  ['reconcile pairedFixture', () => reconcileFixtures.pairedFixture(), (r) => Object.values(r)],
  ['reconcile bareRepoRoot', () => reconcileFixtures.bareRepoRoot(), (d) => [d]],
]) {
  test(`${name}: a second call starts no git process`, () => {
    scratch.push(...dirsOf(make()));
    const trace = mk('ct-gt-trace-');
    const second = withEnv('GIT_TRACE2_EVENT', trace, make);
    scratch.push(...dirsOf(second));
    assert.deepStrictEqual(fs.readdirSync(trace), []);
  });
}

// claims-git-cas fixtures (#5769): same shape — origin, clone, registry and seeded claims built once per process.
const claimsFixtures = require('./bin-lib/issues/claims-git-cas-fixtures');
for (const builder of [
  'makeBareOriginAndClone', 'makeBranchlessOriginAndClone', 'makeDecoyOriginAndClone', 'makeRegistryWithClaims',
]) {
  test(`AC4.1: claims-git-cas ${builder}: a second call starts no git process`, () => {
    const make = () => claimsFixtures[builder]();
    const first = make();
    scratch.push(first.root);
    const trace = mk('ct-gt-trace-');
    const second = withEnv('GIT_TRACE2_EVENT', trace, make);
    scratch.push(second.root);
    assert.deepStrictEqual(fs.readdirSync(trace), []);
    if (builder === 'makeRegistryWithClaims') {
      assert.strictEqual(git(first.cloneDir, ['rev-parse', 'origin/claims-registry']), first.tipAfter.get(44));
      assert.strictEqual(git(second.cloneDir, ['rev-parse', 'origin/claims-registry']), first.tipAfter.get(44));
    }
  });
}

// pre-review-catchup fixtures (#5769): originWithTwoClones seeded in its template, one variant per shared setup shape.
const catchupFixtures = require('./bin-lib/pre-review-catchup/fixtures');
for (const shape of [undefined, ...catchupFixtures.CATCHUP_SHAPES]) {
  test(`AC4.1: pre-review-catchup catchupFixture${shape ? ` ${shape}` : ''}: a second call starts no git process`, () => {
    const make = () => catchupFixtures.catchupFixture(shape);
    scratch.push(make().root);
    const trace = mk('ct-gt-trace-');
    const second = withEnv('GIT_TRACE2_EVENT', trace, make);
    scratch.push(second.root);
    assert.deepStrictEqual(fs.readdirSync(trace), []);
  });
}

// prune-remote fixtures (#5769): origin, repo and pushed branches built once per process, one variant per setup.
const pruneFixtures = require('./bin-lib/reconcile/prune-remote-fixtures');
for (const name of pruneFixtures.PRUNE_REMOTE_FIXTURES) {
  test(`AC4.1: prune-remote ${name}: a second call starts no git process`, () => {
    const make = () => pruneFixtures.pruneRemoteFixture(name);
    const dirsOf = (r) => [r.dir, r.origin, r.wt].filter(Boolean);
    scratch.push(...dirsOf(make()));
    const trace = mk('ct-gt-trace-');
    const second = withEnv('GIT_TRACE2_EVENT', trace, make);
    scratch.push(...dirsOf(second));
    assert.deepStrictEqual(fs.readdirSync(trace), []);
  });
}

test('a prune-remote squashed copy holds the squash commit on main over preSquash', () => {
  const f = pruneFixtures.pruneRemoteFixture('squashed');
  scratch.push(f.dir, f.origin);
  assert.strictEqual(git(f.dir, ['rev-parse', 'main']), f.squash);
  assert.strictEqual(git(f.dir, ['rev-parse', 'main~1']), f.preSquash);
});

test('a prune-remote b1-deleted copy lacks build/b1 on the origin but keeps its stale tracking ref', () => {
  const f = pruneFixtures.pruneRemoteFixture('b1-deleted');
  scratch.push(f.dir, f.origin);
  const onOrigin = (ref) => spawnSync('git', ['-C', f.origin, 'show-ref', '--verify', '--quiet', ref], { env: gitEnv() }).status;
  assert.notStrictEqual(onOrigin('refs/heads/build/b1'), 0);
  assert.strictEqual(onOrigin('refs/heads/build/b2'), 0);
  assert.strictEqual(git(f.dir, ['rev-parse', '--verify', 'refs/remotes/origin/build/b1']).length, 40);
});

test('AC4.1: originWithTwoClones with a seed and no key throws', () => {
  assert.throws(() => gitFixtures.originWithTwoClones('ct-gt-otc-', { seed: () => {} }), /seed needs a key/);
});

test('catchupFixture rejects an unknown shape, inherited object keys included', () => {
  for (const shape of ['no-such-shape', 'constructor', '__proto__']) {
    assert.throws(() => catchupFixtures.catchupFixture(shape), /unknown shape/, shape);
  }
});

test('a catchupFixture copy is on feat with origin/main equal to main in work and other', () => {
  const f = catchupFixtures.catchupFixture();
  scratch.push(f.root);
  assert.strictEqual(git(f.work, ['symbolic-ref', '--short', 'HEAD']), 'feat');
  const main = git(f.work, ['rev-parse', 'main']);
  assert.strictEqual(git(f.work, ['rev-parse', 'origin/main']), main);
  assert.strictEqual(git(f.other, ['rev-parse', 'origin/main']), main);
  assert.strictEqual(git(f.other, ['rev-parse', 'main']), main);
  assert.strictEqual(f.head(), git(f.work, ['rev-parse', 'HEAD']));
});

test('a catchupFixture shape copy holds the shape setup: a feat edit in work, an unfetched upstream commit on origin only when the shape pushes', () => {
  for (const shape of catchupFixtures.CATCHUP_SHAPES) {
    const f = catchupFixtures.catchupFixture(shape);
    scratch.push(f.root);
    assert.strictEqual(git(f.work, ['rev-list', '--count', 'main..HEAD']), '1', shape);
    // The file content each shape's setup leaves: work's own edit, and upstream's pushed edit as `other` last saw origin.
    const line = (text, n) => text.split('\n')[n - 1];
    const workA = fs.readFileSync(path.join(f.work, 'a.txt'), 'utf8');
    const upstreamA = () => git(f.other, ['show', 'origin/main:a.txt']);
    if (shape === 'conflicting-edit') {
      assert.strictEqual(line(workA, 3), 'FEAT', shape);
      assert.strictEqual(line(upstreamA(), 3), 'UPSTREAM', shape);
    } else {
      assert.strictEqual(line(workA, 1), 'F1', shape);
      if (shape === 'feat-edit-overlapping-upstream') assert.strictEqual(line(upstreamA(), 5), 'O5', shape);
    }
    git(f.work, ['fetch', '-q', 'origin']);
    const upstream = git(f.work, ['rev-list', '--count', 'main..origin/main']);
    assert.strictEqual(upstream, shape === 'feat-edit-only' ? '0' : '1', shape);
  }
});

test('pairedFixture copies point at their own origin and sync through it', () => {
  const a = reconcileFixtures.pairedFixture();
  const b = reconcileFixtures.pairedFixture();
  scratch.push(...Object.values(a), ...Object.values(b));
  assert.strictEqual(git(a.mainDir, ['remote', 'get-url', 'origin']), a.originDir);
  assert.strictEqual(git(b.mainDir, ['remote', 'get-url', 'origin']), b.originDir);
  commit(a.seedDir, 'next');
  git(a.seedDir, ['push', '-q', 'origin', 'main']);
  git(a.mainDir, ['fetch', '-q', 'origin']);
  assert.strictEqual(git(a.mainDir, ['rev-parse', 'origin/main']), git(a.seedDir, ['rev-parse', 'HEAD']));
  assert.notStrictEqual(git(b.mainDir, ['rev-parse', 'origin/main']), git(a.seedDir, ['rev-parse', 'HEAD']));
});

test('tmpGitRepo: a second call starts no git process and carries the verify identity', () => {
  const { tmpGitRepo } = require('./bin-lib/verify/cli-helpers');
  scratch.push(tmpGitRepo().repo);
  const trace = mk('ct-gt-trace-');
  const second = withEnv('GIT_TRACE2_EVENT', trace, tmpGitRepo);
  scratch.push(second.repo);
  assert.deepStrictEqual(fs.readdirSync(trace), []);
  assert.strictEqual(second.git('config', 'user.email').trim(), 'verify-test@example.invalid');
});
