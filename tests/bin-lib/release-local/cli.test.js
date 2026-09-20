'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { run, parseArgs, defaultDeps, writeInsideRoot } = require('../../../plugin/bin/release-local.js');

test('writeInsideRoot: refuses a symlinked leaf and a directory whose real location is outside the root; writes a plain file', () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'release-local-root-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'release-local-outside-'));
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
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'release-local-plans-'));
  assert.deepStrictEqual(defaultDeps(root).listPlanFiles(), []);
  fs.mkdirSync(path.join(root, 'docs/superpowers/plans'), { recursive: true });
  fs.writeFileSync(path.join(root, 'docs/superpowers/plans/a.md'), 'ships as v9.9.9');
  fs.writeFileSync(path.join(root, 'docs/superpowers/plans/notes.txt'), 'x');
  assert.deepStrictEqual(defaultDeps(root).listPlanFiles(), ['docs/superpowers/plans/a.md']);
  // a file where the directory should be reads as "no plan claims" too (ENOTDIR), never a raw throw
  const fileRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'release-local-plans-'));
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
      if (key === 'status --porcelain --untracked-files=no') return o.dirty || '';
      if (key === 'remote get-url origin') { if (o.noOrigin) throw new Error('fatal: No such remote'); return 'git@github.com:o/r.git\n'; }
      if (key.startsWith('describe')) { if (o.noTag) throw new Error('fatal: No names found, cannot describe anything.'); return 'v1.2.0\n'; }
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
    listPlanFiles: () => o.plans || [],
    runHook: (cmd) => { state.hooks.push(cmd); return o.hookExit === undefined ? 0 : o.hookExit; },
    today: () => '2026-09-12',
    stdout: (t) => { state.out += t; },
    stderr: (t) => { state.err += t; },
  };
  return { deps, state };
}

test('parseArgs: flags, unknown argument, --root without value', () => {
  assert.deepStrictEqual(parseArgs(['--dry-run', '--branch', 'develop']), { dryRun: false || true, branch: 'develop', root: null, help: false });
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
  const java = makeDeps({ files: { 'release-please-config.json': JSON.stringify({ packages: { '.': { 'release-type': 'java' } } }) } });
  assert.strictEqual(run([], java.deps), 2);
  assert.match(java.state.err, /release-type java/);
  assert.match(java.state.err, /usage/);
  assert.deepStrictEqual(java.state.writes, []);
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

test('integration-branch policy selects the branch; --branch overrides it', () => {
  const a = makeDeps({ branch: 'develop', files: { '.claude-tweaks/policy.yml': 'integration-branch: develop\n' } });
  assert.strictEqual(run(['--dry-run'], a.deps), 0);
  const b = makeDeps({ branch: 'develop' });
  assert.strictEqual(run(['--dry-run', '--branch', 'develop'], b.deps), 0);
  const c = makeDeps({ branch: 'develop' });
  assert.strictEqual(run(['--dry-run'], c.deps), 1);
});
