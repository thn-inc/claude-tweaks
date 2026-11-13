// tests/helpers-git-template.test.js — the template-copy git fixture helper
// (#5297): build a fixture once per process, hand every caller an fs.cpSync
// copy whose git metadata paths were rewritten by plain file edits.
'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
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
const ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.test',
  GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.test',
  GIT_CONFIG_GLOBAL: EMPTY_CONFIG, GIT_CONFIG_SYSTEM: EMPTY_CONFIG,
};
function git(cwd, args, env = ENV) {
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
    git(work, ['push', '-q', 'origin', 'main'], { ...ENV, GIT_TRACE2_EVENT: trace });
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
      scratch.push(fromTemplate('maint-off', (dir) => {
        const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.test', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.test' };
        git(dir, ['init', '-q', '-b', 'main'], env);
        fs.writeFileSync(path.join(dir, 'f'), 'f');
        git(dir, ['add', 'f'], env);
        git(dir, ['commit', '-q', '-m', 'f'], env);
      }, { prefix: 'ct-gt-' }));
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
