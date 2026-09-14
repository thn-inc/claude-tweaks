'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { gatherReleasePreflight, PROBE_NAMES, isBotAuthor, isReleasePr } = require('../../../plugin/bin/lib/release-preflight/pack.js');

const ROOT = '/repo';
const SHA = 'a'.repeat(40);
const LOG = (subjects) => subjects.map((s, i) => `${String(i).repeat(40)}\x1f${s}\x1f\x1e\n`).join('');

function fakeDeps(o = {}) {
  const workflowFiles = Object.fromEntries(Object.entries(o.workflows || {}).map(([name, text]) => [path.join(ROOT, '.github/workflows', name), text]));
  const files = { [path.join(ROOT, '.claude-tweaks/policy.yml')]: o.policy === undefined ? 'integration-model: pr-first\n' : o.policy, ...workflowFiles, ...(o.files || {}) };
  const calls = { git: [], gh: [] };
  return {
    calls,
    deps: {
      git: (args) => {
        const key = args.join(' ');
        calls.git.push(key);
        if (key === 'rev-parse --show-toplevel') return `${ROOT}\n`;
        if (key.startsWith('rev-parse --verify --quiet refs/remotes/origin/')) { if (o.noOriginRef) throw new Error('fatal: Needed a single revision'); return `${SHA}\n`; }
        if (key.startsWith('rev-parse ')) return `${SHA}\n`;
        if (key.startsWith('describe')) { if (o.noTag) throw new Error('fatal: No names found, cannot describe anything.'); return 'v1.2.0\n'; }
        if (key.startsWith('log --first-parent')) return LOG(o.subjects === undefined ? ['feat: a'] : o.subjects);
        if (key === 'tag -l v*') return `${(o.tags === undefined ? ['v1.2.0'] : o.tags).join('\n')}\n`;
        if (key.startsWith('show ')) {
          const spec = args[1];
          const text = (o.show || {})[spec];
          if (text === undefined) throw new Error(`fatal: path '${spec.split(':')[1]}' does not exist in '${spec.split(':')[0]}'`);
          return text;
        }
        throw new Error(`unexpected git: ${key}`);
      },
      execFileAsync: async (cmd, args) => {
        calls.gh.push(`${cmd} ${args.join(' ')}`);
        if (o.ghFail) throw Object.assign(new Error(o.ghFail), { code: o.ghCode });
        const key = args.join(' ');
        if (key.startsWith('pr list')) return JSON.stringify(o.prs || []);
        if (key.startsWith('pr view')) return JSON.stringify({ commits: o.prCommits || [] });
        if (key.startsWith('repo view')) return JSON.stringify({ nameWithOwner: 'o/r' });
        if (/^api repos\/o\/r\/commits\/.*\/check-runs/.test(key)) return JSON.stringify(o.checkRuns || { total_count: 0, check_runs: [] });
        // `gh api … --jq .sha` prints the bare value, not a JSON document.
        if (key.startsWith('api repos/o/r/commits/')) return `${o.headSha || SHA}\n`;
        throw new Error(`unexpected gh: ${key}`);
      },
      readFile: (p) => (p in files ? files[p] : null),
      readdir: (p) => o.workflows && p === path.join(ROOT, '.github/workflows') ? Object.keys(o.workflows) : [],
      now: () => 1000,
      probeTimeoutMs: 2000,
    },
  };
}

test('PROBE_NAMES is the record\'s eight fields in order', () => {
  assert.deepStrictEqual(PROBE_NAMES, ['engine', 'lastTag', 'unreleased', 'proposedVersion', 'releasePr', 'ciTip', 'openReleasePrConflict', 'hook']);
});

test('AC 1 (pr-first): one unreleased feat since v1.2.0 → proposedVersion 1.3.0 minor, unreleased lists the parsed commit, tipRef is origin/main', async () => {
  const { deps } = fakeDeps();
  const pack = await gatherReleasePreflight({ cwd: ROOT, deps });
  assert.strictEqual(pack.engine.value, 'pr-first');
  assert.strictEqual(pack.tipRef, 'origin/main');
  assert.deepStrictEqual(pack.lastTag.value, { tag: 'v1.2.0', version: '1.2.0', tipRef: 'origin/main' });
  assert.strictEqual(pack.unreleased.value.commits.length, 1);
  assert.strictEqual(pack.unreleased.value.commits[0].type, 'feat');
  assert.deepStrictEqual(pack.proposedVersion.value, { version: '1.3.0', part: 'minor', base: '1.2.0', baseSource: 'tag', tipRef: 'origin/main' });
  for (const k of PROBE_NAMES) assert.ok(k in pack && typeof pack[k].ok === 'boolean', k);
});

test('AC 2: zero commits since the tag → unreleased is empty and proposedVersion degrades naming nothing to release', async () => {
  const { deps } = fakeDeps({ subjects: [] });
  const pack = await gatherReleasePreflight({ cwd: ROOT, deps });
  assert.deepStrictEqual(pack.unreleased.value.commits, []);
  assert.strictEqual(pack.proposedVersion.ok, false);
  assert.match(pack.proposedVersion.error, /nothing to release/);
});

test('AC 8 (local-merge): the same fixture yields the same unreleased/proposedVersion shape; releasePr is none, ciTip n/a, hook follows the policy key', async () => {
  const a = await gatherReleasePreflight({ cwd: ROOT, deps: fakeDeps({ policy: 'integration-model: local-merge\nrelease-hook: ./publish.sh\n' }).deps });
  assert.strictEqual(a.engine.value, 'local-merge');
  assert.deepStrictEqual(a.proposedVersion.value, { version: '1.3.0', part: 'minor', base: '1.2.0', baseSource: 'tag', tipRef: 'origin/main' });
  assert.strictEqual(a.unreleased.value.commits[0].type, 'feat');
  assert.deepStrictEqual(a.releasePr, { ok: true, value: 'none', durationMs: 0 });
  assert.deepStrictEqual(a.ciTip, { ok: true, value: 'n/a', durationMs: 0 });
  assert.deepStrictEqual(a.openReleasePrConflict.value, false);
  assert.strictEqual(a.hook.value, true);
  const b = await gatherReleasePreflight({ cwd: ROOT, deps: fakeDeps({ policy: 'integration-model: local-merge\nrelease-hook: false\n' }).deps });
  assert.strictEqual(b.hook.value, false);
});

test('AC 6: integration-model unset → engine, releasePr and hook all degrade naming engine unresolved; git fields still resolve', async () => {
  const { deps } = fakeDeps({ policy: '' });
  const pack = await gatherReleasePreflight({ cwd: ROOT, deps });
  assert.strictEqual(pack.engine.ok, false);
  assert.match(pack.engine.error, /integration-model unresolved/);
  for (const k of ['releasePr', 'hook', 'ciTip', 'openReleasePrConflict']) { assert.strictEqual(pack[k].ok, false, k); assert.match(pack[k].error, /engine unresolved/, k); }
  assert.strictEqual(pack.lastTag.ok, true);
  const bad = await gatherReleasePreflight({ cwd: ROOT, deps: fakeDeps({ policy: 'integration-model: gitlab\n' }).deps });
  assert.strictEqual(bad.engine.ok, false);
});

test('ruling 3: without origin/{branch} the tip is refs/heads/{branch}; integration-branch policy renames it', async () => {
  const { deps, calls } = fakeDeps({ noOriginRef: true, policy: 'integration-model: local-merge\nintegration-branch: develop\n' });
  const pack = await gatherReleasePreflight({ cwd: ROOT, deps });
  assert.strictEqual(pack.branch, 'develop');
  assert.strictEqual(pack.tipRef, 'refs/heads/develop');
  assert.ok(calls.git.some((c) => c === 'rev-parse --verify --quiet refs/remotes/origin/develop'));
});

test('ruling 12: the base is the highest of the v* tags, the manifest at tipRef and the first-parent tag — never a guessed 0.0.0', async () => {
  // No tag anywhere, a bootstrap-seeded manifest at the tip: the manifest is
  // the base, read through `git show {tipRef}:` rather than the worktree.
  const withManifest = fakeDeps({ noTag: true, tags: [], subjects: ['feat: first'], show: { 'origin/main:.release-please-manifest.json': '{\n  ".": "0.1.0"\n}\n' } });
  const a = await gatherReleasePreflight({ cwd: ROOT, deps: withManifest.deps });
  assert.strictEqual(a.lastTag.ok, false);
  assert.match(a.lastTag.error, /no v\* tag reachable from origin\/main/);
  assert.ok(withManifest.calls.git.some((c) => c.startsWith('log --first-parent') && c.endsWith(' origin/main')));
  assert.deepStrictEqual(a.proposedVersion.value, { version: '0.2.0', part: 'minor', base: '0.1.0', baseSource: 'manifest', tipRef: 'origin/main' });
  // A manifest ahead of every tag wins over the tag.
  const ahead = await gatherReleasePreflight({ cwd: ROOT, deps: fakeDeps({ tags: ['v1.2.0'], show: { 'origin/main:.release-please-manifest.json': '{ ".": "1.5.0" }' } }).deps });
  assert.deepStrictEqual(ahead.proposedVersion.value, { version: '1.6.0', part: 'minor', base: '1.5.0', baseSource: 'manifest', tipRef: 'origin/main' });
  // A higher tag that is NOT on the first-parent chain (describe never sees it)
  // still raises the base above the reachable one.
  const offChain = await gatherReleasePreflight({ cwd: ROOT, deps: fakeDeps({ tags: ['v1.2.0', 'v2.0.0', 'vnope'] }).deps });
  assert.deepStrictEqual(offChain.proposedVersion.value, { version: '2.1.0', part: 'minor', base: '2.0.0', baseSource: 'tag', tipRef: 'origin/main' });
  // Nothing resolves a base: degrade, never offer 0.0.1.
  const bare = await gatherReleasePreflight({ cwd: ROOT, deps: fakeDeps({ noTag: true, tags: [], subjects: ['fix: x'] }).deps });
  assert.strictEqual(bare.proposedVersion.ok, false);
  assert.match(bare.proposedVersion.error, /no version base resolvable \(no v\* tag, no manifest at origin\/main\)/);
  // A manifest that is not valid JSON carries no version — it does not take the probe down.
  const broken = await gatherReleasePreflight({ cwd: ROOT, deps: fakeDeps({ noTag: true, tags: [], subjects: ['fix: x'], show: { 'origin/main:.release-please-manifest.json': '{ not json' } }).deps });
  assert.match(broken.proposedVersion.error, /no version base resolvable/);
});

test('unreleased commits carry the breaking-change note alongside the flag', async () => {
  const pack = await gatherReleasePreflight({ cwd: ROOT, deps: fakeDeps({ subjects: ['feat!: drop the old flag'] }).deps });
  assert.strictEqual(pack.unreleased.value.commits[0].breaking, true);
  assert.strictEqual(pack.unreleased.value.commits[0].breakingNote, 'drop the old flag');
  const plain = await gatherReleasePreflight({ cwd: ROOT, deps: fakeDeps().deps });
  assert.strictEqual(plain.unreleased.value.commits[0].breakingNote, null);
});

test('ruling 12: a release-please-config.json at tipRef routes the manifest read through release-local/manifest.js', async () => {
  const show = {
    'origin/main:release-please-config.json': '{ "packages": { ".": { "release-type": "node" } } }',
    'origin/main:package.json': '{\n  "name": "x",\n  "version": "3.4.0"\n}\n',
  };
  const pack = await gatherReleasePreflight({ cwd: ROOT, deps: fakeDeps({ tags: ['v1.2.0'], show }).deps });
  assert.deepStrictEqual(pack.proposedVersion.value, { version: '3.5.0', part: 'minor', base: '3.4.0', baseSource: 'manifest', tipRef: 'origin/main' });
});

const hookOf = async (workflows) => (await gatherReleasePreflight({ cwd: ROOT, deps: fakeDeps({ workflows }).deps })).hook.value;

test('hook (pr-first): the `on:` trigger decides, not any release: line — block, flow and scalar forms (ruling 10)', async () => {
  // A job NAMED release, beside the word "published" in a run step: the two
  // whole-file regexes this replaced called that a release hook.
  assert.strictEqual(await hookOf({ 'ci.yml': 'on: [push]\njobs:\n  release:\n    steps:\n      - run: echo published\n' }), false);
  assert.strictEqual(await hookOf({ 'publish.yml': 'on:\n  release:\n    types: [published]\njobs: {}\n' }), true);
  assert.strictEqual(await hookOf({ 'publish.yml': 'on: { release: { types: [published] } }\njobs: {}\n' }), true);
  assert.strictEqual(await hookOf({ 'publish.yml': 'on: release\njobs: {}\n' }), true);
  assert.strictEqual(await hookOf({ 'publish.yml': 'on: [push, release]\njobs: {}\n' }), true);
  // a quoted key (YAML 1.1 boolean dodge) is the same trigger
  assert.strictEqual(await hookOf({ 'publish.yml': '"on":\n  release:\n    types: [published]\njobs: {}\n' }), true);
  assert.strictEqual(await hookOf({ 'publish.yml': "'on': release\njobs: {}\n" }), true);
  assert.strictEqual(await hookOf({ 'publish.yml': 'on:\n  release:\n    types: [created]\njobs: {}\n' }), false);
  assert.strictEqual(await hookOf({ 'ci.yml': 'on: [push]\n' }), false);
  assert.strictEqual(await hookOf({ 'ci.yml': 'on: [push]\n', 'publish.yml': 'on:\n  release:\n    types: [published]\n' }), true);
  assert.strictEqual((await gatherReleasePreflight({ cwd: ROOT, deps: fakeDeps().deps })).hook.value, false);
});

test("engine honours the run's pinned config.yml over policy.yml (ruling 13)", async () => {
  const runDir = path.join(ROOT, '.claude-tweaks/pipelines/2026-09-12T000000-release');
  const { deps } = fakeDeps({ files: { [path.join(runDir, 'config.yml')]: 'integration-model: local-merge\n' } });
  const pack = await gatherReleasePreflight({ cwd: ROOT, root: ROOT, runDir, deps });
  assert.strictEqual(pack.engine.ok, true);
  assert.strictEqual(pack.engine.value, 'local-merge');
  assert.strictEqual(pack.ciTip.value, 'n/a');
  // Without the run dir the same fixture resolves policy.yml's own value.
  const unpinned = await gatherReleasePreflight({ cwd: ROOT, root: ROOT, deps: fakeDeps().deps });
  assert.strictEqual(unpinned.engine.value, 'pr-first');
});

test('a caller-supplied root is used as-is — the pack never spawns its own rev-parse --show-toplevel', async () => {
  const { deps, calls } = fakeDeps();
  const pack = await gatherReleasePreflight({ cwd: ROOT, root: ROOT, deps });
  assert.strictEqual(pack.engine.value, 'pr-first');
  assert.deepStrictEqual(calls.git.filter((c) => c === 'rev-parse --show-toplevel'), []);
});

test('--only limits the probes gathered; the rest are absent from the pack', async () => {
  const pack = await gatherReleasePreflight({ cwd: ROOT, only: ['engine', 'lastTag'], deps: fakeDeps().deps });
  assert.deepStrictEqual(Object.keys(pack).filter((k) => PROBE_NAMES.includes(k)), ['engine', 'lastTag']);
});

test('a probe that throws degrades only itself (a git failure in describe leaves engine ok)', async () => {
  const { deps } = fakeDeps();
  deps.git = ((orig) => (args) => { if (args[0] === 'describe') throw new Error('fatal: not a git repository'); return orig(args); })(deps.git);
  const pack = await gatherReleasePreflight({ cwd: ROOT, deps });
  assert.strictEqual(pack.lastTag.ok, false);
  assert.match(pack.lastTag.error, /not a git repository/);
  assert.strictEqual(pack.engine.ok, true);
});

test('isBotAuthor / isReleasePr helpers', () => {
  assert.strictEqual(isBotAuthor({ login: 'github-actions', name: 'github-actions[bot]', email: '41898282+github-actions[bot]@users.noreply.github.com' }), true);
  assert.strictEqual(isBotAuthor({ login: 'release-please[bot]', name: '', email: '' }), true);
  assert.strictEqual(isBotAuthor({ login: 'thomas', name: 'Thomas', email: 't@x' }), false);
  assert.strictEqual(isReleasePr({ headRefName: 'release-please--branches--main', title: 'x' }), true);
  assert.strictEqual(isReleasePr({ headRefName: 'feature', title: 'chore(main): release 1.3.0' }), true);
  assert.strictEqual(isReleasePr({ headRefName: 'feature', title: 'chore: release notes' }), false);
});

test('releasePr (pr-first): the open release-please PR, or none', async () => {
  const withPr = fakeDeps({ prs: [{ number: 7, state: 'OPEN', mergeable: 'MERGEABLE', headRefName: 'feature', title: 'x' }, { number: 9, state: 'OPEN', mergeable: 'CONFLICTING', headRefName: 'release-please--branches--main', title: 'chore(main): release 1.3.0' }] });
  const a = await gatherReleasePreflight({ cwd: ROOT, deps: withPr.deps });
  assert.deepStrictEqual(a.releasePr.value, { number: 9, state: 'OPEN', mergeable: 'CONFLICTING', headRefName: 'release-please--branches--main', title: 'chore(main): release 1.3.0' });
  assert.ok(withPr.calls.gh.some((c) => c.startsWith('gh pr list --state open')));
  const none = await gatherReleasePreflight({ cwd: ROOT, deps: fakeDeps({ prs: [] }).deps });
  assert.strictEqual(none.releasePr.value, 'none');
  assert.strictEqual(none.openReleasePrConflict.value, false);
});

test('releasePr: a full page with no match is inconclusive, never "none"', async () => {
  const page = (n) => Array.from({ length: n }, (unused, i) => ({ number: i + 1, state: 'OPEN', mergeable: 'MERGEABLE', headRefName: `feature-${i}`, title: 'x' }));
  const full = fakeDeps({ prs: page(200) });
  const overflowed = await gatherReleasePreflight({ cwd: ROOT, deps: full.deps });
  assert.strictEqual(overflowed.releasePr.ok, false);
  assert.match(overflowed.releasePr.error, /release PR search inconclusive: more than 200 open PRs/);
  assert.match(overflowed.openReleasePrConflict.error, /^releasePr unresolved: release PR search inconclusive/);
  assert.ok(full.calls.gh.some((c) => c.includes('--limit 200')), full.calls.gh.join(' | '));
  // A match inside a full page is a match — the limit only makes a MISS unsafe.
  const matched = page(200);
  matched[7] = { number: 8, state: 'OPEN', mergeable: 'MERGEABLE', headRefName: 'release-please--branches--main', title: 'chore(main): release 1.3.0' };
  const found = await gatherReleasePreflight({ cwd: ROOT, deps: fakeDeps({ prs: matched }).deps });
  assert.strictEqual(found.releasePr.value.number, 8);
});

test('AC 7: openReleasePrConflict is true when the newest PR commit has a human author, false when every author is a bot', async () => {
  const pr = [{ number: 9, state: 'OPEN', mergeable: 'MERGEABLE', headRefName: 'release-please--branches--main', title: 'chore(main): release 1.3.0' }];
  const bot = { login: 'github-actions', name: 'github-actions[bot]', email: '41898282+github-actions[bot]@users.noreply.github.com' };
  const human = { login: 'thomas', name: 'Thomas', email: 't@x' };
  const clean = await gatherReleasePreflight({ cwd: ROOT, deps: fakeDeps({ prs: pr, prCommits: [{ oid: 'a', authors: [bot] }] }).deps });
  assert.strictEqual(clean.openReleasePrConflict.value, false);
  const edited = await gatherReleasePreflight({ cwd: ROOT, deps: fakeDeps({ prs: pr, prCommits: [{ oid: 'a', authors: [bot] }, { oid: 'b', authors: [human] }] }).deps });
  assert.strictEqual(edited.openReleasePrConflict.value, true);
  // A human commit the bot later built on top of is still a human edit — the
  // last commit alone never decides it.
  const buried = await gatherReleasePreflight({ cwd: ROOT, deps: fakeDeps({ prs: pr, prCommits: [{ oid: 'a', authors: [bot] }, { oid: 'b', authors: [human] }, { oid: 'c', authors: [bot] }] }).deps });
  assert.strictEqual(buried.openReleasePrConflict.value, true);
  // Authorship GitHub did not return is unknown, never "a human edited it".
  const unknown = await gatherReleasePreflight({ cwd: ROOT, deps: fakeDeps({ prs: pr, prCommits: [{ oid: 'a', authors: [bot] }, { oid: 'b', authors: [] }] }).deps });
  assert.strictEqual(unknown.openReleasePrConflict.ok, false);
  assert.match(unknown.openReleasePrConflict.error, /release PR commit authorship unavailable/);
});

test('a dependency that fails is named in the dependent field\'s error, never reported as the dependent\'s own failure', async () => {
  const down = await gatherReleasePreflight({ cwd: ROOT, deps: fakeDeps({ ghFail: 'spawn gh ENOENT', ghCode: 'ENOENT' }).deps });
  assert.match(down.openReleasePrConflict.error, /^releasePr unresolved: .*spawn gh ENOENT/);
  const { deps } = fakeDeps();
  deps.git = ((orig) => (args) => { if (args[0] === 'describe') throw new Error('fatal: not a git repository'); return orig(args); })(deps.git);
  const broken = await gatherReleasePreflight({ cwd: ROOT, deps });
  for (const k of ['lastTag', 'unreleased', 'proposedVersion']) assert.match(broken[k].error, /^history unresolved: .*not a git repository/, k);
});

test('ciTip (pr-first): the branch is asked by name, paginated, with local/remote skew recorded (ruling 11); AC 3: a gh failure degrades ciTip and releasePr alone', async () => {
  const runs = { total_count: 3, check_runs: [{ status: 'completed', conclusion: 'success', head_sha: SHA }, { status: 'completed', conclusion: 'failure' }, { status: 'in_progress', conclusion: null }] };
  const fresh = fakeDeps({ checkRuns: runs });
  const ok = await gatherReleasePreflight({ cwd: ROOT, deps: fresh.deps });
  assert.deepStrictEqual(ok.ciTip.value, { ref: 'main', headSha: SHA, localSha: SHA, tipBehind: false, state: 'failure', total: 3, success: 1, failure: 1, pending: 1, truncated: false });
  // per_page in the query string, never as `-f`: an -f/-F parameter makes gh
  // api POST, and this endpoint 404s on a POST.
  assert.ok(fresh.calls.gh.includes('gh api repos/o/r/commits/main/check-runs?per_page=100'), fresh.calls.gh.join(' | '));
  assert.ok(!fresh.calls.gh.some((c) => c.includes(' -f ') || c.includes(' -F ')), fresh.calls.gh.join(' | '));
  // The pack never fetches, so the local origin/main ref can trail the branch's
  // real tip at GitHub — that skew is recorded, not silently absorbed.
  const behind = await gatherReleasePreflight({ cwd: ROOT, deps: fakeDeps({ checkRuns: { total_count: 1, check_runs: [{ status: 'completed', conclusion: 'success', head_sha: 'b'.repeat(40) }] } }).deps });
  assert.strictEqual(behind.ciTip.value.headSha, 'b'.repeat(40));
  assert.strictEqual(behind.ciTip.value.localSha, SHA);
  assert.strictEqual(behind.ciTip.value.tipBehind, true);
  // 150 runs on the commit, 100 on the page: the counts describe the page only.
  const many = await gatherReleasePreflight({ cwd: ROOT, deps: fakeDeps({ checkRuns: { total_count: 150, check_runs: Array.from({ length: 100 }, () => ({ status: 'completed', conclusion: 'success', head_sha: SHA })) } }).deps });
  assert.strictEqual(many.ciTip.value.truncated, true);
  assert.strictEqual(many.ciTip.value.total, 150);
  assert.strictEqual(many.ciTip.value.success, 100);
  // No runs at all: the head sha comes from the commit itself.
  const none = await gatherReleasePreflight({ cwd: ROOT, deps: fakeDeps({ headSha: 'c'.repeat(40) }).deps });
  assert.strictEqual(none.ciTip.value.state, 'none');
  assert.strictEqual(none.ciTip.value.headSha, 'c'.repeat(40));
  const down = await gatherReleasePreflight({ cwd: ROOT, deps: fakeDeps({ ghFail: 'spawn gh ENOENT', ghCode: 'ENOENT' }).deps });
  assert.strictEqual(down.ciTip.ok, false);
  assert.strictEqual(down.releasePr.ok, false);
  assert.strictEqual(down.openReleasePrConflict.ok, false);
  assert.strictEqual(down.engine.ok, true);
  assert.strictEqual(down.proposedVersion.ok, true);
  assert.strictEqual(down.hook.ok, true);
});

test('ruling 13: a failing preamble degrades every probe and the pack is still produced', async () => {
  const { deps } = fakeDeps();
  deps.readFile = (p) => { if (p === path.join(ROOT, '.claude-tweaks/policy.yml')) throw Object.assign(new Error(`EISDIR: illegal operation on a directory, read '${p}'`), { code: 'EISDIR' }); return null; };
  const pack = await gatherReleasePreflight({ cwd: ROOT, deps });
  assert.strictEqual(pack.branch, null);
  assert.strictEqual(pack.tipRef, null);
  for (const k of PROBE_NAMES) {
    assert.strictEqual(pack[k].ok, false, k);
    assert.match(pack[k].error, /preamble failed: .*EISDIR/, k);
  }
});

test('a hung probe is bounded by the timeout and degrades itself only', async () => {
  const { deps } = fakeDeps();
  deps.execFileAsync = () => new Promise(() => {});
  deps.probeTimeoutMs = 20;
  const pack = await gatherReleasePreflight({ cwd: ROOT, deps });
  assert.strictEqual(pack.releasePr.ok, false);
  assert.match(pack.releasePr.error, /timeout after 20ms/);
  assert.strictEqual(pack.lastTag.ok, true);
});
