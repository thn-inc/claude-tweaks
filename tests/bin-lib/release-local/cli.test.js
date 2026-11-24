'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { scratchDir } = require('../../helpers/tmp-dir');
const os = require('os');
const path = require('path');
const { run, parseArgs, defaultDeps, writeInsideRoot } = require('../../../plugin/bin/release-local.js');
const { readText } = require('../../helpers/read-skill');

const mkTmpDir = (prefix) => scratchDir(prefix);

// #2791: the same real fixture files manifest.test.js's own round-trip tests read,
// reused here so the CLI-level dry-run assertions exercise byte-identical content
// to a real project's manifest, not a hand-typed minimal string.
const FIXTURES = path.join(__dirname, 'fixtures');
const readFixture = (name) => readText(path.join(FIXTURES, name));

test('writeInsideRoot: refuses a symlinked leaf and a directory whose real location is outside the root; writes a plain file', () => {
  const root = mkTmpDir('release-local-root-');
  const outside = mkTmpDir('release-local-outside-');
  fs.writeFileSync(path.join(outside, 'victim.json'), '{"version": "1.2.0"}');
  fs.symlinkSync(path.join(outside, 'victim.json'), path.join(root, 'linked.json'));
  assert.throws(() => writeInsideRoot(root, 'linked.json', '{"version": "1.3.0"}'), /refusing to write linked\.json: it is a symlink/);
  assert.strictEqual(fs.readFileSync(path.join(outside, 'victim.json'), 'utf8'), '{"version": "1.2.0"}');
  fs.symlinkSync(outside, path.join(root, 'escape'));
  assert.throws(() => writeInsideRoot(root, 'escape/new.json', 'x'), /outside the repo root/);
  assert.ok(!fs.existsSync(path.join(outside, 'new.json')));
  assert.throws(() => writeInsideRoot(root, 'missing-dir/x.json', 'x'), /its directory does not exist/);
  writeInsideRoot(root, 'plain.json', '{"version": "1.3.0"}');
  assert.strictEqual(fs.readFileSync(path.join(root, 'plain.json'), 'utf8'), '{"version": "1.3.0"}');
  writeInsideRoot(root, 'plain.json', 'overwritten');
  assert.strictEqual(fs.readFileSync(path.join(root, 'plain.json'), 'utf8'), 'overwritten');
});

test('defaultDeps.listPlanFiles: a missing plans directory is "no plan claims"; a present one lists its .md files', () => {
  const root = mkTmpDir('release-local-plans-');
  assert.deepStrictEqual(defaultDeps(root).listPlanFiles(), []);
  fs.mkdirSync(path.join(root, 'docs/superpowers/plans'), { recursive: true });
  fs.writeFileSync(path.join(root, 'docs/superpowers/plans/a.md'), 'ships as v9.9.9');
  fs.writeFileSync(path.join(root, 'docs/superpowers/plans/notes.txt'), 'x');
  assert.deepStrictEqual(defaultDeps(root).listPlanFiles(), ['docs/superpowers/plans/a.md']);
  // a file where the directory should be reads as "no plan claims" too (ENOTDIR), never a raw throw
  const fileRoot = mkTmpDir('release-local-plans-');
  fs.mkdirSync(path.join(fileRoot, 'docs/superpowers'), { recursive: true });
  fs.writeFileSync(path.join(fileRoot, 'docs/superpowers/plans'), 'not a dir');
  assert.deepStrictEqual(defaultDeps(fileRoot).listPlanFiles(), []);
});

const SHA = 'f'.repeat(40);
const CONFIG = JSON.stringify({ packages: { '.': { 'release-type': 'node' } } });
const LOG = (subjects) => subjects.map((s, i) => `${String(i).repeat(40)}\x1f${s}\x1f\x1e\n`).join('');

function makeDeps(o = {}) {
  const state = {
    files: { 'release-please-config.json': CONFIG, '.release-please-manifest.json': '{\n  ".": "1.2.0"\n}\n', 'package.json': '{\n  "name": "x",\n  "version": "1.2.0"\n}\n', 'CHANGELOG.md': '# Changelog\n', ...(o.files || {}) },
    git: [], writes: [], out: '', err: '', hooks: [],
  };
  const deps = {
    git: (args) => {
      const key = args.join(' ');
      state.git.push(key);
      if (o.gitFail && o.gitFail(key)) throw new Error(`fatal: ${key} failed`);
      if (key === 'branch --show-current') return `${o.branch || 'main'}\n`;
      if (key === '--no-optional-locks status --porcelain --untracked-files=no') return o.dirty || '';
      if (key === 'remote get-url origin') { if (o.noOrigin) throw new Error('fatal: No such remote'); return 'git@github.com:o/r.git\n'; }
      if (key.startsWith('tag --merged')) return o.noTag ? '' : (o.mergedTag === undefined ? 'v1.2.0\n' : o.mergedTag);
      if (key.startsWith('log --first-parent')) return LOG(o.subjects || ['fix: a', 'feat: b', 'fix: c']);
      if (key.startsWith('fetch')) return '';
      if (key.startsWith('ls-remote --heads origin ')) return o.lsRemote === undefined ? `${SHA}\trefs/heads/${o.branch || 'main'}\n` : o.lsRemote;
      if (key.startsWith('show ')) { const p = key.slice(key.indexOf(':') + 1); if (p in state.files) return state.files[p]; throw new Error(`fatal: path '${p}' does not exist`); }
      if (key === 'worktree list --porcelain') return o.worktrees || 'worktree /repo\nbranch refs/heads/main\n';
      if (key === 'tag -l v*') return o.tags === undefined ? 'v1.2.0\n' : o.tags;
      if (key.startsWith('add ') || key.startsWith('commit ') || key.startsWith('tag -a') || key.startsWith('push ') || key.startsWith('merge-base')) return '';
      throw new Error(`unexpected git: ${key}`);
    },
    readFile: (p) => (p in state.files ? state.files[p] : null),
    writeFile: (p, text) => { state.writes.push(p); state.files[p] = text; },
    // #2791: manifest.js's glob targets (ruby *.gemspec, dotnet *.csproj) need a root
    // listing; a test that doesn't pass rootFiles just gets none, same as production
    // resolveTargets() called with no listRoot at all.
    listRoot: () => o.rootFiles || [],
    listPlanFiles: () => o.plans || [],
    runHook: (cmd) => { state.hooks.push(cmd); return { status: o.hookExit === undefined ? 0 : o.hookExit, stdout: '', stderr: '' }; },
    today: () => '2026-09-12',
    stdout: (t) => { state.out += t; },
    stderr: (t) => { state.err += t; },
  };
  return { deps, state };
}

test('parseArgs: flags, unknown argument, --root without value', () => {
  assert.deepStrictEqual(parseArgs(['--dry-run', '--branch', 'develop']), { dryRun: true, branch: 'develop', root: null, releaseAs: null, help: false });
  assert.match(parseArgs(['--bogus']).error, /unknown argument/);
  assert.match(parseArgs(['--root']).error, /requires a value/);
});

test('exit 2: unknown flag, and a repo with no release-please-config.json (bootstrap first)', () => {
  const a = makeDeps();
  assert.strictEqual(run(['--bogus'], a.deps), 2);
  assert.match(a.state.err, /usage/);
  const b = makeDeps({ files: { 'release-please-config.json': null } });
  delete b.state.files['release-please-config.json'];
  assert.strictEqual(run([], b.deps), 2);
  assert.match(b.state.err, /release-please-config\.json/);
  assert.deepStrictEqual(b.state.writes, []);
});

test('exit 2: a config the engine cannot serve is a config error, not a git failure', () => {
  // #2791: java/ruby/dotnet are supported now — an unknown release-type (never in
  // STACK_TARGETS) is what still hits resolveTargets' own exit-2 path pre-write.
  const unknown = makeDeps({ files: { 'release-please-config.json': JSON.stringify({ packages: { '.': { 'release-type': 'cobol' } } }) } });
  assert.strictEqual(run([], unknown.deps), 2);
  assert.match(unknown.state.err, /unknown release-type cobol/);
  assert.match(unknown.state.err, /usage/);
  assert.deepStrictEqual(unknown.state.writes, []);
  const escapes = makeDeps({ files: { 'release-please-config.json': JSON.stringify({ packages: { '.': { 'release-type': 'simple', 'extra-files': ['../x.json'] } } }) } });
  assert.strictEqual(run([], escapes.deps), 2);
  assert.match(escapes.state.err, /extra-files path escapes the repo root: \.\.\/x\.json/);
  assert.deepStrictEqual(escapes.state.writes, []);
});

test('exit 1: a `git remote get-url` failure that is NOT "no such remote" propagates, nothing written', () => {
  const { deps, state } = makeDeps();
  deps.git = ((orig) => (args) => {
    if (args.join(' ') === 'remote get-url origin') { state.git.push(args.join(' ')); throw new Error('fatal: unexpected'); }
    return orig(args);
  })(deps.git);
  assert.strictEqual(run([], deps), 1);
  assert.match(state.err, /release-local: fatal: unexpected — nothing written/);
  assert.deepStrictEqual(state.writes, []);
});

test('AC 1: --dry-run reports 1.3.0, three bullets, no hook, and writes nothing', () => {
  const { deps, state } = makeDeps();
  assert.strictEqual(run(['--dry-run'], deps), 0);
  assert.match(state.out, /v1\.3\.0 \(minor\) from v1\.2\.0/);
  assert.strictEqual((state.out.match(/^\* /gm) || []).length, 3);
  assert.match(state.out, /no hook configured/);
  assert.deepStrictEqual(state.writes, []);
  assert.ok(!state.git.some((c) => /^(add|commit|tag -a|push)/.test(c)));
});

test('#2791 AC3: --dry-run against a java (Gradle) fixture repo reports build.gradle as the planned write', () => {
  const { deps, state } = makeDeps({
    files: {
      'release-please-config.json': JSON.stringify({ packages: { '.': { 'release-type': 'java' } } }),
      'build.gradle': readFixture('build.gradle'),
    },
    rootFiles: ['build.gradle'],
  });
  assert.strictEqual(run(['--dry-run'], deps), 0);
  assert.match(state.out, /manifest: \.release-please-manifest\.json, build\.gradle/);
  assert.deepStrictEqual(state.writes, []);
});

test('#2791 AC3: --dry-run against a ruby fixture repo (gemspec glob-resolved via listRoot) reports the gemspec as the planned write', () => {
  const { deps, state } = makeDeps({
    files: {
      'release-please-config.json': JSON.stringify({ packages: { '.': { 'release-type': 'ruby' } } }),
      'widget.gemspec': readFixture('widget.gemspec'),
    },
    // version.rb is absent from this fixture repo — only the gemspec's inline
    // assignment carries the version; listRoot is what resolves the glob-named
    // `*.gemspec` row to this repo's actual filename.
    rootFiles: ['widget.gemspec', 'Gemfile'],
  });
  assert.strictEqual(run(['--dry-run'], deps), 0);
  assert.match(state.out, /manifest: \.release-please-manifest\.json, widget\.gemspec/);
  assert.deepStrictEqual(state.writes, []);
});

test('#2791 AC3: --dry-run against a dotnet fixture repo reports both the glob-resolved csproj and the fixed-name AssemblyInfo.cs as planned writes', () => {
  const { deps, state } = makeDeps({
    files: {
      'release-please-config.json': JSON.stringify({ packages: { '.': { 'release-type': 'dotnet' } } }),
      'widget.csproj': readFixture('widget.csproj'),
      'AssemblyInfo.cs': readFixture('AssemblyInfo.cs'),
    },
    rootFiles: ['widget.csproj'],
  });
  assert.strictEqual(run(['--dry-run'], deps), 0);
  assert.match(state.out, /manifest: \.release-please-manifest\.json, widget\.csproj, AssemblyInfo\.cs/);
  assert.deepStrictEqual(state.writes, []);
});

test('AC 2 (fake runner): the live run edits both manifests and the CHANGELOG, commits, tags, pushes branch + tag, exit 0', () => {
  const { deps, state } = makeDeps();
  assert.strictEqual(run([], deps), 0);
  assert.deepStrictEqual(state.writes, ['.release-please-manifest.json', 'package.json', 'CHANGELOG.md']);
  assert.strictEqual(state.files['package.json'], '{\n  "name": "x",\n  "version": "1.3.0"\n}\n');
  assert.match(state.files['CHANGELOG.md'], /^# Changelog\n\n## \[1\.3\.0\]\(https:\/\/github\.com\/o\/r\/compare\/v1\.2\.0\.\.\.v1\.3\.0\) \(2026-09-12\)\n\n\n### Features\n\n\* b \(\[1111111\]/);
  const i = (p) => state.git.findIndex((c) => c.startsWith(p));
  // precheck fetches once before the plan; the push path fetches again — the ordering that matters is the LAST fetch
  const li = (p) => state.git.length - 1 - [...state.git].reverse().findIndex((c) => c.startsWith(p));
  assert.ok(i('fetch origin main') < i('add '), 'precheck fetch precedes any write');
  assert.ok(i('add ') < i('commit -m chore(release): v1.3.0') && i('commit') < i('tag -a v1.3.0 -m v1.3.0') && i('tag -a') < li('fetch origin main') && li('fetch origin main') < i('merge-base') && i('merge-base') < i('push origin main v1.3.0'));
  assert.match(state.out, /released v1\.3\.0/);
});

test('AC 3: only chore commits → exit 3, nothing written', () => {
  const { deps, state } = makeDeps({ subjects: ['chore: x', 'docs: y'] });
  assert.strictEqual(run([], deps), 3);
  assert.match(state.out, /nothing to release/);
  assert.deepStrictEqual(state.writes, []);
});

test('AC 5: feat! or a BREAKING CHANGE footer computes a major even among fix/chore', () => {
  const { deps, state } = makeDeps({ subjects: ['fix: a', 'feat!: b', 'chore: c'] });
  assert.strictEqual(run(['--dry-run'], deps), 0);
  assert.match(state.out, /v2\.0\.0 \(major\)/);
  assert.match(state.out, /BREAKING CHANGES/);
});

test('AC 7: no prior tag → the full history, base from the manifest, 0.1.0 + feat → 0.2.0', () => {
  const { deps, state } = makeDeps({ noTag: true, tags: '', subjects: ['feat: first'], files: { '.release-please-manifest.json': '{".": "0.1.0"}', 'package.json': '{"version": "0.1.0"}' } });
  assert.strictEqual(run(['--dry-run'], deps), 0);
  assert.match(state.out, /v0\.2\.0 \(minor\) from no prior tag/);
  assert.ok(state.git.some((c) => c.startsWith('log --first-parent') && c.endsWith(' HEAD')));
});

test('unconventional subjects are listed in the plan, never dropped', () => {
  const { deps, state } = makeDeps({ subjects: ['fix: a', 'Merge branch feature'] });
  assert.strictEqual(run(['--dry-run'], deps), 0);
  assert.match(state.out, /unconventional \(1\):\n {2}[0-9a-f]{7} Merge branch feature/);
});

test('exit 4: a sibling worktree already claims 1.3.0', () => {
  const { deps, state } = makeDeps({ worktrees: 'worktree /repo\nbranch refs/heads/main\n\nworktree /w\nbranch refs/heads/wt\n', files: {} });
  deps.git = ((orig) => (args) => (args.join(' ') === 'show wt:.release-please-manifest.json' ? '{".": "1.3.0"}' : orig(args)))(deps.git);
  assert.strictEqual(run([], deps), 4);
  assert.match(state.err, /collision on v1\.3\.0/);
  assert.match(state.err, /wt claims v1\.3\.0/);
  assert.deepStrictEqual(state.writes, []);
});

test('exit 4: a plan document claiming the candidate number (plan claims are read through deps.listPlanFiles)', () => {
  const { deps, state } = makeDeps({ plans: ['docs/superpowers/plans/x.md'], files: { 'docs/superpowers/plans/x.md': 'ships as v1.3.0' } });
  assert.strictEqual(run([], deps), 4);
  assert.match(state.err, /plan-claim: docs\/superpowers\/plans\/x\.md claims v1\.3\.0/);
});

test('exit 1 (nothing written): a dirty tree, or a wrong branch', () => {
  const dirty = makeDeps({ dirty: ' M x.js\n' });
  assert.strictEqual(run([], dirty.deps), 1);
  assert.match(dirty.state.err, /tracked modifications/);
  assert.deepStrictEqual(dirty.state.writes, []);
  const branch = makeDeps({ branch: 'feature' });
  assert.strictEqual(run([], branch.deps), 1);
  assert.match(branch.state.err, /releases run from main; current branch is "feature"/);
});

test('exit 1 (named partial state): the push fails after the commit and tag landed', () => {
  const { deps, state } = makeDeps({ gitFail: (k) => k.startsWith('push ') });
  assert.strictEqual(run([], deps), 1);
  assert.match(state.err, /partial: v1\.3\.0 is committed and tagged locally but NOT pushed/);
  assert.match(state.err, /do NOT re-run/i);
  // `git pull --rebase` rewrites the chore(release) commit and strands the annotated tag on the
  // pre-rebase object — the recovery must re-tag after the rebase and force-publish the tag.
  assert.match(state.err, /git tag -f -a v1\.3\.0 -m v1\.3\.0 && git push origin main && git push --force origin v1\.3\.0/);
  assert.ok(!state.err.includes('git pull --rebase'), state.err);
  assert.deepStrictEqual(state.hooks, []);
});

test('exit 1 (named partial state): a FIRST push that fails recovers with a plain push, never a rebase against a ref that cannot exist', () => {
  const { deps, state } = makeDeps({ lsRemote: '', gitFail: (k) => k.startsWith('push ') });
  assert.strictEqual(run([], deps), 1);
  assert.match(state.err, /partial: v1\.3\.0 is committed and tagged locally but NOT pushed/);
  assert.match(state.err, /Recover: git push origin main v1\.3\.0$/m);
  assert.ok(!/git rebase/.test(state.err), state.err);
});

test('exit 1 (named partial state): a commit failure after the files were edited', () => {
  const { deps, state } = makeDeps({ gitFail: (k) => k.startsWith('commit ') });
  assert.strictEqual(run([], deps), 1);
  assert.match(state.err, /partial: \.release-please-manifest\.json, package\.json, CHANGELOG\.md edited on disk but NOT committed/);
  // `git checkout --` restores from the index, so after `git add` the bump would stay staged.
  assert.match(state.err, /git restore --staged --worktree -- \.release-please-manifest\.json package\.json CHANGELOG\.md/);
  assert.ok(!/git checkout --/.test(state.err), state.err);
});

test('exit 1 (named partial state): a file the run CREATED is removed, not restored', () => {
  const { deps, state } = makeDeps({ gitFail: (k) => k.startsWith('commit ') });
  delete state.files['CHANGELOG.md'];
  assert.strictEqual(run([], deps), 1);
  assert.match(state.err, /Recover: git restore --staged --worktree -- \.release-please-manifest\.json package\.json && rm CHANGELOG\.md$/m);
});

test('exit 1 (nothing written): a tokenless stack manifest is refused before any write', () => {
  // the manifest file carries the version (so planning succeeds) but package.json has no token: applyVersion's pre-pass refuses before writing anything
  const { deps, state } = makeDeps({ files: { 'package.json': '{\n  "name": "x"\n}\n' } });
  assert.strictEqual(run([], deps), 1);
  assert.deepStrictEqual(state.writes, []);
  assert.match(state.err, /release-local: package\.json carries no version token to bump — nothing written/);
  assert.ok(!state.git.some((c) => /^(add|commit|tag -a)/.test(c)));
});

test('exit 1 (named partial state): a write that fails part-way — the recovery lists exactly what landed', () => {
  const { deps, state } = makeDeps();
  const orig = deps.writeFile;
  deps.writeFile = (p, text) => { if (p === 'package.json') throw new Error('EACCES: permission denied'); orig(p, text); };
  assert.strictEqual(run([], deps), 1);
  assert.deepStrictEqual(state.writes, ['.release-please-manifest.json']);
  assert.match(state.err, /partial: \.release-please-manifest\.json edited on disk but NOT committed \(EACCES: permission denied/);
  assert.match(state.err, /git restore --staged --worktree -- \.release-please-manifest\.json$/m);
  assert.ok(!state.git.some((c) => /^(add|commit|tag -a)/.test(c)));
});

test('exit 1 (named partial state): the tag fails after the commit landed', () => {
  const { deps, state } = makeDeps({ gitFail: (k) => k.startsWith('tag -a') });
  assert.strictEqual(run([], deps), 1);
  assert.match(state.err, /partial: the chore\(release\): v1\.3\.0 commit landed but the tag did NOT/);
  assert.match(state.err, /git tag -a v1\.3\.0 -m v1\.3\.0 && git push origin main v1\.3\.0/);
});

test('exit 5: a hook that THROWS after the push is a hook failure, never reported as "not pushed"', () => {
  const { deps, state } = makeDeps({ files: { '.claude-tweaks/policy.yml': 'release-hook: ./publish.sh\n' } });
  deps.runHook = () => { throw new Error('spawn ENOENT'); };
  assert.strictEqual(run([], deps), 5);
  assert.match(state.err, /partial: v1\.3\.0 is committed, tagged and pushed; the release-hook threw \(spawn ENOENT\)/);
  assert.match(state.err, /re-run the hook alone: \.\/publish\.sh/);
  assert.ok(!/NOT pushed/.test(state.err));
  const local = makeDeps({ noOrigin: true, files: { '.claude-tweaks/policy.yml': 'release-hook: ./publish.sh\n' } });
  local.deps.runHook = () => { throw new Error('boom'); };
  assert.strictEqual(run([], local.deps), 5);
  assert.match(local.state.err, /is committed, tagged; the release-hook threw \(boom\)/);
  assert.ok(!/git push/.test(local.state.err));
});

test('exit 5: the release-hook fails after the tag and push landed; the tag is final', () => {
  const { deps, state } = makeDeps({ files: { '.claude-tweaks/policy.yml': 'release-hook: "npm run deploy"\n' }, hookExit: 7 });
  assert.strictEqual(run([], deps), 5);
  assert.deepStrictEqual(state.hooks, ['npm run deploy']);
  assert.match(state.err, /partial: v1\.3\.0 is committed, tagged and pushed; the release-hook exited 7/);
  assert.match(state.err, /re-run the hook alone: npm run deploy/);
  assert.ok(state.git.some((c) => c.startsWith('push ')));
});

test('a configured hook that succeeds is run after the push and reported', () => {
  const { deps, state } = makeDeps({ files: { '.claude-tweaks/policy.yml': 'release-hook: ./publish.sh\n' } });
  assert.strictEqual(run([], deps), 0);
  assert.deepStrictEqual(state.hooks, ['./publish.sh']);
  assert.match(state.out, /hook: \.\/publish\.sh/);
});

test('no origin: no fetch, no push, unlinked CHANGELOG heading, still exit 0', () => {
  const { deps, state } = makeDeps({ noOrigin: true });
  assert.strictEqual(run([], deps), 0);
  assert.ok(!state.git.some((c) => /^(fetch|push|merge-base)/.test(c)));
  assert.match(state.files['CHANGELOG.md'], /^# Changelog\n\n## 1\.3\.0 \(2026-09-12\)\n/);
});

test('origin exists but the branch was never pushed: no fetch, no ancestry check, branch + tag still pushed', () => {
  const { deps, state } = makeDeps({ lsRemote: '' });
  assert.strictEqual(run([], deps), 0);
  assert.ok(!state.git.some((c) => c.startsWith('fetch') || c.startsWith('merge-base')), state.git.join(' | '));
  assert.ok(state.git.includes('push origin main v1.3.0'), state.git.join(' | '));
  assert.match(state.out, /^origin: main is not on origin yet — first push$/m);
  assert.match(state.out, /released v1\.3\.0/);
});

test('parseArgs: --release-as requires a strict-semver value', () => {
  assert.deepStrictEqual(parseArgs(['--release-as', '7.0.0']), { dryRun: false, branch: null, root: null, releaseAs: '7.0.0', help: false });
  assert.match(parseArgs(['--release-as']).error, /requires a value/);
  assert.match(parseArgs(['--release-as', 'v7.0.0']).error, /strict semver/);
  assert.match(parseArgs(['--release-as', '7.0']).error, /strict semver/);
});

test('AC 1 (#2326): --dry-run --release-as 7.0.0 on a minor-only history plans v7.0.0 and names the override', () => {
  const { deps, state } = makeDeps();
  assert.strictEqual(run(['--dry-run', '--release-as', '7.0.0'], deps), 0);
  assert.match(state.out, /v7\.0\.0 \(minor — --release-as override\) from v1\.2\.0/);
  assert.deepStrictEqual(state.writes, []);
});

test('AC 2 (#2326): --release-as 1.0.0 when the base is 1.2.0 exits 2 naming both versions', () => {
  const { deps, state } = makeDeps();
  assert.strictEqual(run(['--release-as', '1.0.0'], deps), 2);
  assert.match(state.err, /--release-as 1\.0\.0 is not ahead of the current version 1\.2\.0/);
  assert.match(state.err, /usage/);
  assert.deepStrictEqual(state.writes, []);
});

test('#2326: --release-as ahead of base performs a live run at that exact version', () => {
  const { deps, state } = makeDeps();
  assert.strictEqual(run(['--release-as', '9.9.9'], deps), 0);
  assert.strictEqual(state.files['package.json'], '{\n  "name": "x",\n  "version": "9.9.9"\n}\n');
  assert.match(state.out, /released v9\.9\.9/);
});

test('#2326: --release-as colliding with a sibling worktree claim still exits 4', () => {
  const { deps, state } = makeDeps({ worktrees: 'worktree /repo\nbranch refs/heads/main\n\nworktree /w\nbranch refs/heads/wt\n', files: {} });
  deps.git = ((orig) => (args) => (args.join(' ') === 'show wt:.release-please-manifest.json' ? '{".": "9.9.9"}' : orig(args)))(deps.git);
  assert.strictEqual(run(['--release-as', '9.9.9'], deps), 4);
  assert.match(state.err, /collision on v9\.9\.9/);
});

test('integration-branch policy selects the branch; --branch overrides it', () => {
  const a = makeDeps({ branch: 'develop', files: { '.claude-tweaks/policy.yml': 'integration-branch: develop\n' } });
  assert.strictEqual(run(['--dry-run'], a.deps), 0);
  const b = makeDeps({ branch: 'develop' });
  assert.strictEqual(run(['--dry-run', '--branch', 'develop'], b.deps), 0);
  const c = makeDeps({ branch: 'develop' });
  assert.strictEqual(run(['--dry-run'], c.deps), 1);
});

// changelog-max-releases (#5563): the trim rides a separate commit after the tag, before the push.
const FOUR_SECTIONS = '# Changelog\n\n'
  + ['1.2.0', '1.1.0', '1.0.0', '0.9.0'].map((v, i) => `## [${v}](https://github.com/o/r/compare/x...v${v}) (2026-01-0${4 - i})\n\n\n### Features\n\n* f${v}\n`).join('\n');
const POLICY_FILE_KEY = '.claude-tweaks/policy.yml';
const HEAD_SHA = 'a'.repeat(40);

// makeDeps' fake git has no rev-parse; the trim's ancestry proof needs one, so answer it here and
// optionally fail the --is-ancestor call the way git does (exit status 1).
function trimDeps(o = {}) {
  const made = makeDeps({ ...o, files: { 'CHANGELOG.md': FOUR_SECTIONS, ...(o.files || {}) } });
  const inner = made.deps.git;
  made.deps.git = (args) => {
    const key = args.join(' ');
    if (key === 'reset --soft HEAD~1') { made.state.git.push(key); return ''; }
    if (key === 'rev-parse HEAD' || key.startsWith('rev-parse --verify')) { made.state.git.push(key); return key === 'rev-parse HEAD' ? `${HEAD_SHA}\n` : ''; }
    // Only the trim's own proof (it names HEAD's sha); the push's ancestry check is a different call.
    if (o.notAncestor && key.startsWith('merge-base --is-ancestor') && key.includes(HEAD_SHA)) { made.state.git.push(key); throw Object.assign(new Error('git exited 1'), { status: 1 }); }
    return inner(args);
  };
  if (o.trimChangelog) made.deps.trimChangelog = o.trimChangelog;
  return made;
}
const withKey = (value) => ({ [POLICY_FILE_KEY]: `changelog-max-releases: ${value}\n` });
const FOOTER_AT = (text) => text.indexOf('## Older releases');

test('AC2.1 (local): with the key 0 or absent the released CHANGELOG is byte-identical to base and no extra git call runs', () => {
  // The base arm is the plain fake runner (no trim wrapper): what the engine did before the key existed.
  const base = makeDeps({ files: { 'CHANGELOG.md': FOUR_SECTIONS } });
  assert.strictEqual(run([], base.deps), 0);
  for (const files of [withKey(0), withKey('abc'), withKey(-1)]) {
    const t = trimDeps({ files });
    assert.strictEqual(run([], t.deps), 0, t.state.err);
    assert.strictEqual(t.state.files['CHANGELOG.md'], base.state.files['CHANGELOG.md']);
    assert.deepStrictEqual(t.state.git, base.state.git);
    assert.strictEqual(t.state.err, '');
  }
  assert.ok(!base.state.git.some((c) => c.startsWith('rev-parse')));
  assert.strictEqual(base.state.git.filter((c) => c.startsWith('commit ')).length, 1);
});

test('AC2.1 (local): a key the file is already within the bound of makes no extra git call and no trim commit', () => {
  const base = trimDeps({ files: { 'CHANGELOG.md': '# Changelog\n' } });
  assert.strictEqual(run([], base.deps), 0);
  const t = trimDeps({ files: { 'CHANGELOG.md': '# Changelog\n', ...withKey(5) } });
  assert.strictEqual(run([], t.deps), 0);
  assert.strictEqual(t.state.files['CHANGELOG.md'], base.state.files['CHANGELOG.md']);
  assert.deepStrictEqual(t.state.git, base.state.git);
});

test('AC3.2 (local): key 2 and four sections → the trim lands in its own commit after the release push and is pushed separately; HEAD holds two sections plus the footer', () => {
  const base = trimDeps();
  assert.strictEqual(run([], base.deps), 0);
  const { deps, state } = trimDeps({ files: withKey(2) });
  assert.strictEqual(run([], deps), 0, state.err);
  const text = state.files['CHANGELOG.md'];
  assert.deepStrictEqual([...text.matchAll(/^## \[(\d+\.\d+\.\d+)\]/gm)].map((m) => m[1]), ['1.3.0', '1.2.0']);
  assert.ok(FOOTER_AT(text) > 0, 'a footer is appended');
  assert.match(text, new RegExp(`Full file up to v1\\.3\\.0: commit ${HEAD_SHA}`));
  assert.match(text, /Newest release removed: v1\.1\.0/);
  assert.ok(text.startsWith(base.state.files['CHANGELOG.md'].slice(0, base.state.files['CHANGELOG.md'].indexOf('## [1.1.0]')).replace(/\s*$/, '')), 'the kept sections are the base bytes');
  const idx = (p) => state.git.findIndex((c) => c.startsWith(p));
  assert.ok(idx('commit -m chore(release): v1.3.0') < idx('tag -a v1.3.0'));
  const trimCommit = 'commit -m chore: trim CHANGELOG.md to the newest 2 releases';
  assert.ok(idx('push origin main v1.3.0') < idx('rev-parse HEAD'), 'the key is read only after the release push landed');
  assert.ok(idx('rev-parse HEAD') < idx(trimCommit));
  assert.deepStrictEqual(state.git.slice(idx(trimCommit) + 1).filter((c) => c.startsWith('push ')), ['push origin main'], 'the trim commit is pushed on its own, without the tag');
  assert.ok(state.git.includes('rev-parse --verify --quiet --end-of-options refs/heads/main^{commit}'), 'the local branch ref is the ancestor target');
  assert.ok(!state.git.some((c) => c.includes('refs/remotes/')));
  assert.strictEqual(state.git.filter((c) => c === 'add -- CHANGELOG.md').length, 1);
  assert.ok(!state.git.some((c) => c.startsWith('reset ')));
  assert.match(state.out, /released v1\.3\.0/);
  assert.strictEqual(state.err, '');
});

test('AC4.2 (local): trimChangelog stubbed to throw → released exit 0, file untrimmed, one failure line, no trim commit', () => {
  const base = trimDeps();
  assert.strictEqual(run([], base.deps), 0);
  const { deps, state } = trimDeps({ files: withKey(2), trimChangelog: () => { throw new Error('boom'); } });
  assert.strictEqual(run([], deps), 0);
  assert.strictEqual(state.files['CHANGELOG.md'], base.state.files['CHANGELOG.md']);
  assert.strictEqual(state.err, 'changelog trim: failed (boom); file left untrimmed\n');
  assert.ok(!state.git.some((c) => c.startsWith('commit -m chore: trim')));
  assert.match(state.out, /released v1\.3\.0/);
});

test('local: the trim commit throwing restores CHANGELOG.md and the index, prints the failure line, and the release still pushes and exits 0', () => {
  const base = trimDeps();
  assert.strictEqual(run([], base.deps), 0);
  const { deps, state } = trimDeps({ files: withKey(2), gitFail: (k) => k.startsWith('commit -m chore: trim') });
  assert.strictEqual(run([], deps), 0);
  assert.strictEqual(state.files['CHANGELOG.md'], base.state.files['CHANGELOG.md']);
  assert.match(state.err, /^changelog trim: failed \(fatal: commit -m chore: trim CHANGELOG\.md to the newest 2 releases failed\); file left untrimmed\n$/);
  const failedAt = state.git.findIndex((c) => c.startsWith('commit -m chore: trim'));
  assert.deepStrictEqual(state.git.slice(failedAt + 1, failedAt + 2), ['add -- CHANGELOG.md'], 'the index goes back to HEAD');
  assert.ok(state.git.some((c) => c.startsWith('push origin main v1.3.0')), 'the push still happens');
  assert.match(state.out, /released v1\.3\.0/);
});

test('local: the trim push failing drops the trim commit, restores the file and index, prints one line, and the release stays released (exit 0)', () => {
  const base = trimDeps();
  assert.strictEqual(run([], base.deps), 0);
  let pushes = 0;
  const { deps, state } = trimDeps({ files: withKey(2), gitFail: (k) => k.startsWith('push ') && (pushes += 1) === 2 });
  assert.strictEqual(run([], deps), 0);
  assert.strictEqual(state.files['CHANGELOG.md'], base.state.files['CHANGELOG.md']);
  assert.match(state.err, /^changelog trim: failed \(fatal: push origin main failed\); file left untrimmed\n$/);
  const idx = (p) => state.git.findIndex((c) => c.startsWith(p));
  assert.ok(idx('commit -m chore: trim') < idx('reset --soft HEAD~1'), 'the trim commit is dropped');
  assert.strictEqual(state.git[idx('reset --soft HEAD~1') + 1], 'add -- CHANGELOG.md');
  assert.match(state.out, /released v1\.3\.0/);
});

test('local: a transient index.lock on the trim commit drop is retried, so the file is restored and the line says untrimmed', () => {
  let pushes = 0;
  let resets = 0;
  const { deps, state } = trimDeps({ files: withKey(2), gitFail: (k) => k.startsWith('push ') && (pushes += 1) === 2 });
  const inner = deps.git;
  deps.git = (args) => {
    if (args.join(' ') === 'reset --soft HEAD~1' && (resets += 1) === 1) {
      state.git.push('reset --soft HEAD~1');
      throw new Error("fatal: Unable to create '/repo/.git/index.lock': File exists.");
    }
    return inner(args);
  };
  assert.strictEqual(run([], deps), 0);
  assert.strictEqual(resets, 2, 'the reset was retried once');
  assert.match(state.err, /^changelog trim: failed \(fatal: push origin main failed\); file left untrimmed\n$/);
  assert.match(state.out, /released v1\.3\.0/);
});

test('local: a failed restore names the index state in the failure line', () => {
  let adds = 0;
  const { deps, state } = trimDeps({ files: withKey(2), gitFail: (k) => k.startsWith('commit -m chore: trim') || (k === 'add -- CHANGELOG.md' && (adds += 1) === 2) });
  assert.strictEqual(run([], deps), 0);
  assert.match(state.err, /^changelog trim: failed \(fatal: commit -m chore: trim CHANGELOG\.md to the newest 2 releases failed\); the restore also failed, CHANGELOG\.md and the index may still hold the trimmed file\n$/);
  assert.match(state.out, /released v1\.3\.0/);
});

test('local: the diverged-origin recovery text is byte-identical to base whatever the key is, and nothing is trimmed', () => {
  const base = trimDeps();
  base.deps.git = ((inner) => (args) => { if (args[0] === 'merge-base' && args[1] === '--is-ancestor' && args[2] === 'origin/main') throw new Error('diverged'); return inner(args); })(base.deps.git);
  assert.strictEqual(run([], base.deps), 1);
  const keyed = trimDeps({ files: withKey(2) });
  keyed.deps.git = ((inner) => (args) => { if (args[0] === 'merge-base' && args[1] === '--is-ancestor' && args[2] === 'origin/main') throw new Error('diverged'); return inner(args); })(keyed.deps.git);
  assert.strictEqual(run([], keyed.deps), 1);
  assert.match(base.state.err, /git tag -f -a v1\.3\.0/);
  assert.strictEqual(keyed.state.err, base.state.err);
  assert.ok(!keyed.state.git.some((c) => c.startsWith('rev-parse') || c.includes('chore: trim')));
  assert.strictEqual(keyed.state.files['CHANGELOG.md'], base.state.files['CHANGELOG.md']);
});

test('local: the release-hook runs against the untrimmed release commit; the trim comes after it, and a failed hook means no trim', () => {
  const files = { ...withKey(2), [POLICY_FILE_KEY]: 'release-hook: "publish"\nchangelog-max-releases: 2\n' };
  const ok = trimDeps({ files });
  const runHook = ok.deps.runHook;
  ok.deps.runHook = (cmd) => { ok.state.git.push('HOOK'); return runHook(cmd); };
  assert.strictEqual(run([], ok.deps), 0, ok.state.err);
  assert.ok(ok.state.git.indexOf('HOOK') < ok.state.git.findIndex((c) => c.startsWith('commit -m chore: trim')));
  const bad = trimDeps({ files, hookExit: 3 });
  assert.strictEqual(run([], bad.deps), 5);
  assert.ok(!bad.state.git.some((c) => c.startsWith('commit -m chore: trim')));
});

test('local: a trim write that fails restores the original text and still releases', () => {
  const base = trimDeps();
  assert.strictEqual(run([], base.deps), 0);
  const { deps, state } = trimDeps({ files: withKey(2) });
  const write = deps.writeFile;
  let trimWrites = 0;
  deps.writeFile = (p, text) => {
    if (p === 'CHANGELOG.md' && state.files[p] !== undefined && text.includes('## Older releases')) { trimWrites += 1; write(p, text); throw new Error('disk full'); }
    write(p, text);
  };
  assert.strictEqual(run([], deps), 0);
  assert.strictEqual(trimWrites, 1);
  assert.strictEqual(state.files['CHANGELOG.md'], base.state.files['CHANGELOG.md']);
  assert.strictEqual(state.err, 'changelog trim: failed (disk full); file left untrimmed\n');
  assert.match(state.out, /released v1\.3\.0/);
});

test('AC14.3 (local): a HEAD that is not an ancestor of the local branch is not trimmed and prints the failure line', () => {
  const base = trimDeps();
  assert.strictEqual(run([], base.deps), 0);
  const { deps, state } = trimDeps({ files: withKey(2), notAncestor: true });
  assert.strictEqual(run([], deps), 0);
  assert.strictEqual(state.files['CHANGELOG.md'], base.state.files['CHANGELOG.md']);
  assert.strictEqual(state.err, `changelog trim: failed (${HEAD_SHA} is not an ancestor of refs/heads/main); file left untrimmed\n`);
  assert.ok(!state.git.some((c) => c.startsWith('commit -m chore: trim')));
});

// The win32 shape: a platform whose fs.constants has no O_NOFOLLOW.
const noFollow = { constants: { ...fs.constants, O_NOFOLLOW: undefined } };

test('#4282 AC3.1 AC3.2: writeInsideRoot refuses a symlinked leaf when O_NOFOLLOW is absent, and still writes a plain file', () => {
  const root = mkTmpDir('release-local-root-');
  const outside = mkTmpDir('release-local-outside-');
  fs.writeFileSync(path.join(outside, 'victim.json'), '{"version": "1.2.0"}');
  fs.symlinkSync(path.join(outside, 'victim.json'), path.join(root, 'linked.json'));
  assert.throws(() => writeInsideRoot(root, 'linked.json', 'x', noFollow), /refusing to write linked\.json: it is a symlink/);
  assert.strictEqual(fs.readFileSync(path.join(outside, 'victim.json'), 'utf8'), '{"version": "1.2.0"}');
  fs.symlinkSync(path.join(outside, 'not-yet.json'), path.join(root, 'dangling.json'));
  assert.throws(() => writeInsideRoot(root, 'dangling.json', 'x', noFollow), /refusing to write dangling\.json: it is a symlink/);
  assert.ok(!fs.existsSync(path.join(outside, 'not-yet.json')));
  writeInsideRoot(root, 'plain.json', '{"version": "1.3.0"}', noFollow);
  writeInsideRoot(root, 'plain.json', 'short', noFollow);
  assert.strictEqual(fs.readFileSync(path.join(root, 'plain.json'), 'utf8'), 'short');
});

test('#4282 AC3: writeInsideRoot\'s post-open identity check refuses a leaf swapped to a symlink between the lstat and the open', () => {
  const setup = () => {
    const root = mkTmpDir('release-local-root-');
    const outside = mkTmpDir('release-local-outside-');
    const victim = path.join(outside, 'victim.json');
    fs.writeFileSync(victim, 'VICTIM-BYTES');
    fs.writeFileSync(path.join(root, 'v.json'), '{"version": "1.0.0"}');
    return { root, victim };
  };
  const realOpen = fs.openSync;
  const realFstat = fs.fstatSync;
  // One-shot: the first open swaps the leaf it was handed for a symlink to the victim, then opens it.
  const swapAtOpen = (victim) => {
    fs.openSync = (leaf, ...rest) => {
      fs.openSync = realOpen;
      fs.unlinkSync(leaf);
      fs.symlinkSync(victim, leaf);
      return realOpen(leaf, ...rest);
    };
  };

  // (a) the leaf is still a symlink when the identity lstat runs
  const a = setup();
  try {
    swapAtOpen(a.victim);
    assert.throws(() => writeInsideRoot(a.root, 'v.json', 'x', noFollow), /refusing to write v\.json: it is a symlink/);
  } finally {
    fs.openSync = realOpen;
  }
  assert.strictEqual(fs.readFileSync(a.victim, 'utf8'), 'VICTIM-BYTES');

  // (b) the symlink is swapped back for a fresh regular file before the identity lstat: only dev/ino can tell
  const b = setup();
  try {
    swapAtOpen(b.victim);
    fs.fstatSync = (fd, ...rest) => {
      fs.fstatSync = realFstat;
      const st = realFstat(fd, ...rest);
      const leaf = path.join(fs.realpathSync(b.root), 'v.json');
      fs.unlinkSync(leaf);
      fs.writeFileSync(leaf, 'fresh');
      return st;
    };
    assert.throws(() => writeInsideRoot(b.root, 'v.json', 'x', noFollow), /refusing to write v\.json: it is a symlink/);
  } finally {
    fs.openSync = realOpen;
    fs.fstatSync = realFstat;
  }
  assert.strictEqual(fs.readFileSync(b.victim, 'utf8'), 'VICTIM-BYTES');
});

test('#4282: writeInsideRoot refuses a leaf that appears between the lstat and the open', () => {
  const root = mkTmpDir('release-local-root-');
  const realOpen = fs.openSync;
  // One-shot: a concurrent writer creates the leaf just before the O_EXCL open runs.
  fs.openSync = (leaf, ...rest) => {
    fs.openSync = realOpen;
    fs.writeFileSync(leaf, 'OTHER');
    return realOpen(leaf, ...rest);
  };
  try {
    assert.throws(() => writeInsideRoot(root, 'new.json', 'x', noFollow), /refusing to write new\.json: it changed between the check and the open/);
  } finally {
    fs.openSync = realOpen;
  }
  assert.strictEqual(fs.readFileSync(path.join(root, 'new.json'), 'utf8'), 'OTHER');
});
