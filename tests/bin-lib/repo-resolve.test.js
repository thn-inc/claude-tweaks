'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseRepo, ghAvailable, repoSlug } = require('../../plugin/bin/lib/repo-resolve');

test('parseRepo: SSH remote URL', () => {
  assert.deepEqual(parseRepo('git@github.com:o/r.git'), { host: 'github.com', owner: 'o', repo: 'r' });
});

test('parseRepo: HTTPS remote URL', () => {
  assert.deepEqual(parseRepo('https://github.com/o/r.git'), { host: 'github.com', owner: 'o', repo: 'r' });
});

test('parseRepo: HTTPS remote URL without .git suffix', () => {
  assert.deepEqual(parseRepo('https://github.com/o/r'), { host: 'github.com', owner: 'o', repo: 'r' });
});

test('parseRepo: an owner/name string wrapped as github.com/owner/name (the --repo CLI flag shape)', () => {
  assert.deepEqual(parseRepo('github.com/o/r'), { host: 'github.com', owner: 'o', repo: 'r' });
});

test('parseRepo: SSH remote on a GitHub Enterprise Server host', () => {
  assert.deepEqual(parseRepo('git@ghe.example.com:acme/widget.git'), { host: 'ghe.example.com', owner: 'acme', repo: 'widget' });
});

test('parseRepo: HTTPS remote on a GitHub Enterprise Server host', () => {
  assert.deepEqual(parseRepo('https://ghe.example.com/acme/widget'), { host: 'ghe.example.com', owner: 'acme', repo: 'widget' });
});

test('parseRepo: malformed URL (no host/owner/repo structure) -> null', () => {
  assert.equal(parseRepo('not-a-url'), null);
  assert.equal(parseRepo(''), null);
  assert.equal(parseRepo(null), null);
  assert.equal(parseRepo(undefined), null);
});

test('parseRepo: existing callers that destructure only { owner, repo } still see the same shape', () => {
  const { owner, repo } = parseRepo('git@github.com:o/r.git');
  assert.deepEqual({ owner, repo }, { owner: 'o', repo: 'r' });
});

test('ghAvailable: injected runner succeeds -> true', () => {
  const calls = [];
  const result = ghAvailable({
    execFileSync: (cmd, args, opts) => { calls.push([cmd, args, opts]); return 'gh version 2.0.0\n'; },
  });
  assert.equal(result, true);
  assert.deepEqual(calls.length, 1);
  assert.deepEqual(calls[0][0], 'gh');
  assert.deepEqual(calls[0][1], ['--version']);
  assert.equal(typeof calls[0][2].timeout, 'number');
  assert.ok(calls[0][2].timeout > 0);
});

test('ghAvailable: injected runner throws ENOENT (gh absent) -> false', () => {
  const result = ghAvailable({
    execFileSync: () => { const e = new Error('spawnSync gh ENOENT'); e.code = 'ENOENT'; throw e; },
  });
  assert.equal(result, false);
});

test('ghAvailable: a timed-out probe (code ETIMEDOUT) -> true (gh is present, just slow, #4554)', () => {
  const result = ghAvailable({
    execFileSync: () => { throw Object.assign(new Error('spawnSync gh ETIMEDOUT'), { code: 'ETIMEDOUT' }); },
  });
  assert.equal(result, true);
});

test('ghAvailable: a killed probe with no code -> true (#4554)', () => {
  const result = ghAvailable({
    execFileSync: () => { throw Object.assign(new Error('killed'), { killed: true }); },
  });
  assert.equal(result, true);
});

test('ghAvailable: a SIGTERM-signalled probe -> true (#4554)', () => {
  const result = ghAvailable({
    execFileSync: () => { throw Object.assign(new Error('terminated'), { signal: 'SIGTERM' }); },
  });
  assert.equal(result, true);
});

test('ghAvailable: injected runner throws a generic error (non-zero exit) -> false', () => {
  const result = ghAvailable({
    execFileSync: () => { throw new Error('gh: some other failure'); },
  });
  assert.equal(result, false);
});

test('ghAvailable: no deps passed -> defaults to the real execFileSync (does not throw at call time)', () => {
  // Not asserting the boolean result (depends on whether `gh` is on this
  // machine's PATH) -- only that the zero-arg call shape used by every
  // pre-existing direct importer (fetch-sub-issues.js, backlog-grant-gate.js,
  // etc.) still resolves without throwing.
  assert.doesNotThrow(() => ghAvailable());
});

// repoSlug is the one composer of the `gh --repo` value shared by
// apply-refine-labels.js, compose-subject.js, materialize.js, and
// release-claim.js — each of which hand-rolled the same host ternary.
test('repoSlug: a github.com spec stays the bare owner/repo slug', () => {
  assert.equal(repoSlug({ host: 'github.com', owner: 'acme', repo: 'widget' }), 'acme/widget');
});

test('repoSlug: a GitHub Enterprise Server spec is host-qualified', () => {
  assert.equal(repoSlug({ host: 'ghe.example.com', owner: 'acme', repo: 'widget' }), 'ghe.example.com/acme/widget');
});

test('repoSlug: a missing host reads as github.com (materialize.js threads host as an optional 4th arg)', () => {
  assert.equal(repoSlug({ owner: 'acme', repo: 'widget' }), 'acme/widget');
});

const fs = require('fs');
const pathModule = require('path');

test("'--version' appears in plugin/bin only inside repo-resolve.js's ghAvailable()", () => {
  const binDir = pathModule.join(__dirname, '..', '..', 'plugin', 'bin');
  const hits = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = pathModule.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.js')) {
        const content = fs.readFileSync(p, 'utf8');
        content.split('\n').forEach((line, i) => {
          if (line.includes("'--version'")) hits.push(`${pathModule.relative(binDir, p)}:${i + 1}`);
        });
      }
    }
  };
  walk(binDir);
  // The property is "one literal, in repo-resolve.js", not a line number: #2567,
  // #4554 and #4505 each shifted the line, and a comment edit must not fail this.
  assert.equal(hits.length, 1, `expected one '--version' literal, got ${hits.join(', ')}`);
  assert.ok(hits[0].startsWith(`lib${pathModule.sep}repo-resolve.js:`), hits[0]);
});

// #4505: the gh host seam. Every test resets the per-process memo first and
// passes fake deps, so no real `git` probe or hosts.yml read happens.
const { ghOptions, resolveGhHost, _resetGhHostCache } = require('../../plugin/bin/lib/repo-resolve');

const ghe = { remoteUrl: () => 'https://acme.ghe.com/acme/widgets.git', readFile: () => { throw new Error('ENOENT'); }, env: {}, platform: 'linux', homedir: '/h', stderr: () => {} };
test('AC1.1 seam: a *.ghe.com origin injects GH_HOST into a copy of opts', () => {
  _resetGhHostCache();
  const opts = { cwd: '/r', encoding: 'utf8', windowsHide: true };
  const out = ghOptions(['pr', 'view', '7', '--json', 'body'], opts, ghe);
  assert.notStrictEqual(out, opts);
  assert.equal(out.env.GH_HOST, 'acme.ghe.com');
  assert.equal(out.encoding, 'utf8');
  assert.equal(opts.env, undefined); // caller's object untouched
});
test('AC2.1: a github.com origin returns the same opts object', () => {
  _resetGhHostCache();
  const opts = { cwd: '/r' };
  assert.strictEqual(ghOptions(['pr', 'view'], opts, { ...ghe, remoteUrl: () => 'git@github.com:acme/widgets.git' }), opts);
});
test('AC4.1: an exported GH_HOST is never overwritten (process-style env and opts.env, empty string included)', () => {
  _resetGhHostCache();
  const o1 = { cwd: '/r' };
  assert.strictEqual(ghOptions(['api', 'graphql'], o1, { ...ghe, env: { GH_HOST: 'other.example' } }), o1);
  const o2 = { cwd: '/r', env: { GH_HOST: '' } };
  assert.strictEqual(ghOptions(['api', 'graphql'], o2, ghe), o2);
});
test('AC5.1, AC5.2 (Decision Q1): an SSH alias host is not injected, even with an enterprise token; a hosts.yml-known GHES host is; a token alone admits no HTTPS host (#4854)', () => {
  _resetGhHostCache();
  const alias = { ...ghe, remoteUrl: () => 'git@github.com-work:acme/widgets.git' };
  const o = { cwd: '/a' };
  assert.strictEqual(ghOptions(['pr', 'list'], o, alias), o);
  _resetGhHostCache();
  const o2 = { cwd: '/t' };
  assert.strictEqual(ghOptions(['pr', 'list'], o2, { ...alias, env: { GH_ENTERPRISE_TOKEN: 't' } }), o2);
  _resetGhHostCache();
  const o4 = { cwd: '/u' };
  assert.strictEqual(ghOptions(['pr', 'list'], o4, { ...ghe, remoteUrl: () => 'https://git.corp.example/acme/widgets.git', env: { GITHUB_ENTERPRISE_TOKEN: 't' } }), o4);
  _resetGhHostCache();
  const o3 = { cwd: '/m' };
  assert.strictEqual(ghOptions(['pr', 'list'], o3, { ...ghe, remoteUrl: () => 'https://GitHub.com/acme/widgets.git' }), o3); // mixed-case github.com is github.com
  _resetGhHostCache();
  const ghes = { ...ghe, remoteUrl: () => 'https://git.corp.example/acme/widgets.git', env: { GH_CONFIG_DIR: '/cfg' },
    readFile: (p) => { assert.equal(p, pathModule.join('/cfg', 'hosts.yml')); return 'git.corp.example:\n    user: me\n'; } };
  assert.equal(ghOptions(['pr', 'list'], { cwd: '/b' }, ghes).env.GH_HOST, 'git.corp.example');
});
test('AC6.1, AC6.2 (Decision Q2): any explicit -R/--repo/--hostname suppresses injection, agreeing with origin or not', () => {
  _resetGhHostCache();
  const o = { cwd: '/r' };
  for (const args of [['issue', 'view', '1', '--repo', 'thn-inc/claude-tweaks'], ['api', 'graphql', '--hostname', 'github.com'],
    ['pr', 'list', '-R', 'other.example/acme/widgets'], ['issue', 'list', '--repo=thn-inc/claude-tweaks'],
    ['issue', 'view', '1', '--repo', 'acme.ghe.com/acme/widgets'], ['issue', 'view', '1', '-R', 'ACME/Widgets'],
    ['api', 'graphql', '--hostname', 'acme.ghe.com'], ['api', 'graphql', '--hostname=acme.ghe.com'], ['pr', 'list', '-Racme/widgets']]) {
    assert.strictEqual(ghOptions(args, o, ghe), o, args.join(' '));
  }
});
test('review focus: GraphQL -f owner=/repo= variables are not an explicit repo; args after -- are not scanned', () => {
  _resetGhHostCache();
  const o = { cwd: '/r' };
  for (const args of [['api', 'graphql', '-f', 'query=q', '-f', 'owner=acme', '-f', 'repo=widgets'],
    ['issue', 'comment', '1', '--body', 'x', '--', '--repo']]) {
    assert.equal(ghOptions(args, o, ghe).env.GH_HOST, 'acme.ghe.com', args.join(' '));
  }
});
test('review focus: caller opts.env is the merge base', () => {
  _resetGhHostCache();
  const out = ghOptions(['pr', 'view'], { cwd: '/r', env: { PATH: '/p', X: '1' } }, ghe);
  assert.deepEqual(out.env, { PATH: '/p', X: '1', GH_HOST: 'acme.ghe.com' });
});
test('review focus: memoized per cwd, probe failure is "no host", note logged once per host', () => {
  _resetGhHostCache();
  let probes = 0; const notes = [];
  const d = { ...ghe, remoteUrl: (cwd) => { probes++; if (cwd === pathModule.resolve('/none')) throw new Error('no origin'); return ghe.remoteUrl(); }, stderr: (s) => notes.push(s) };
  ghOptions(['a'], { cwd: '/r' }, d); ghOptions(['b'], { cwd: '/r' }, d);
  const none = { cwd: '/none' };
  assert.strictEqual(ghOptions(['c'], none, d), none);
  assert.equal(probes, 2);
  assert.equal(notes.length, 1);
  assert.match(notes[0], /resolved repo acme\.ghe\.com\/acme\/widgets \(host: acme\.ghe\.com\) — gh calls get GH_HOST=acme\.ghe\.com/);
});
test('#4854: an enterprise token alone admits no host, forge or not, so the token is never sent there; a hosts.yml key still does', () => {
  for (const url of ['https://gitlab.com/acme/widgets.git', 'https://bitbucket.org/acme/widgets.git', 'https://dev.azure.com/acme/widgets.git',
    'https://acme.visualstudio.com/acme/widgets.git', 'https://codeberg.org/acme/widgets.git', 'https://git.corp.invalid/o/r.git']) {
    for (const env of [{ GH_ENTERPRISE_TOKEN: 't' }, { GITHUB_ENTERPRISE_TOKEN: 't' }]) {
      _resetGhHostCache();
      const o = { cwd: '/f' };
      assert.strictEqual(ghOptions(['pr', 'list'], o, { ...ghe, remoteUrl: () => url, env }), o, url);
    }
  }
  _resetGhHostCache();
  const configured = { ...ghe, remoteUrl: () => 'https://gitlab.com/acme/widgets.git', env: { GH_CONFIG_DIR: '/cfg' }, readFile: () => 'gitlab.com:\n    user: me\n' };
  assert.equal(ghOptions(['pr', 'list'], { cwd: '/g' }, configured).env.GH_HOST, 'gitlab.com');
});
test('review (#4505): an origin probe timeout is noted once and not memoized, so the next call probes again; no origin stays memoized', () => {
  _resetGhHostCache();
  let probes = 0; const notes = [];
  const timeout = Object.assign(new Error('spawnSync git ETIMEDOUT'), { code: 'ETIMEDOUT' });
  const d = { ...ghe, remoteUrl: () => { probes++; if (probes <= 2) throw timeout; return ghe.remoteUrl(); }, stderr: (s) => notes.push(s) };
  const o = { cwd: '/s' };
  assert.strictEqual(ghOptions(['a'], o, d), o);
  assert.strictEqual(ghOptions(['b'], o, d), o);
  assert.equal(probes, 2); // a timeout is not memoized
  assert.equal(notes.filter((n) => /timed out/.test(n)).length, 1); // noted once per cwd
  assert.equal(ghOptions(['c'], o, d).env.GH_HOST, 'acme.ghe.com'); // the next call probes again and recovers
});
test("resolveGhHost: hosts.yml is read from gh's own config-dir order, keys matched case-insensitively", () => {
  const corp = { ...ghe, remoteUrl: () => 'git@Git.Corp.Example:acme/widgets.git' };
  const cases = [
    [{ GH_CONFIG_DIR: '/cfg', XDG_CONFIG_HOME: '/x', AppData: '/ad' }, 'win32', pathModule.join('/cfg', 'hosts.yml')],
    [{ XDG_CONFIG_HOME: '/x', AppData: '/ad' }, 'win32', pathModule.join('/x', 'gh', 'hosts.yml')],
    [{ AppData: '/ad' }, 'win32', pathModule.join('/ad', 'GitHub CLI', 'hosts.yml')],
    [{ AppData: '/ad' }, 'linux', pathModule.join('/h', '.config', 'gh', 'hosts.yml')],
  ];
  for (const [env, platform, want] of cases) {
    _resetGhHostCache();
    const read = [];
    const host = resolveGhHost('/r', { ...corp, env, platform, readFile: (p) => { read.push(p); return '# comment:\nGIT.CORP.EXAMPLE:\n    user: me\ngithub.com:\n'; } });
    assert.deepEqual(read, [want]);
    assert.equal(host, 'git.corp.example');
  }
});
test('resolveGhHost: a user-less scp-style remote with a token is not admitted; an unknown HTTPS host without a token is null', () => {
  _resetGhHostCache();
  assert.equal(resolveGhHost('/s', { ...ghe, remoteUrl: () => 'git.corp.example:acme/widgets.git', env: { GH_ENTERPRISE_TOKEN: 't' } }), null);
  _resetGhHostCache();
  assert.equal(resolveGhHost('/n', { ...ghe, remoteUrl: () => 'https://git.corp.example/acme/widgets.git' }), null);
});

// #4854: the enterprise-token clause is gone, so no spelling of an SSH remote or a
// non-GitHub forge can sidestep a guard: a token alone admits nothing.
test('#4854: bypass spellings of the old guards inject nothing with a token set', () => {
  for (const url of ['https://gitlab.com./o/r.git', 'https://GITLAB.COM./o/r.git', 'git+ssh://alias/o/r', 'ssh+git://alias/o/r', 'git+ssh://git@alias/o/r.git']) {
    _resetGhHostCache();
    const o = { cwd: '/b' };
    assert.strictEqual(ghOptions(['pr', 'list'], o, { ...ghe, remoteUrl: () => url, env: { GH_ENTERPRISE_TOKEN: 't' } }), o, url);
  }
});
test('#4854: the origin host is normalized (case, trailing dots) before the .ghe.com and hosts.yml checks, and GH_HOST carries the normalized host', () => {
  _resetGhHostCache();
  assert.equal(ghOptions(['pr', 'list'], { cwd: '/r' }, { ...ghe, remoteUrl: () => 'https://acme.ghe.com./acme/widgets.git' }).env.GH_HOST, 'acme.ghe.com');
  _resetGhHostCache();
  assert.equal(ghOptions(['pr', 'list'], { cwd: '/r' }, { ...ghe, remoteUrl: () => 'https://ACME.ghe.com../acme/widgets.git' }).env.GH_HOST, 'acme.ghe.com');
  _resetGhHostCache();
  assert.equal(resolveGhHost('/c', { ...ghe, remoteUrl: () => 'https://git.corp.example./acme/widgets.git', readFile: () => 'git.corp.example:\n' }), 'git.corp.example');
  _resetGhHostCache();
  assert.equal(resolveGhHost('/c', { ...ghe, remoteUrl: () => 'https://git.corp.example/acme/widgets.git', readFile: () => 'Git.Corp.Example.:\n' }), 'git.corp.example');
  _resetGhHostCache();
  assert.equal(ghOptions(['pr', 'list'], { cwd: '/g' }, { ...ghe, remoteUrl: () => 'https://gitlab.com./acme/widgets.git', env: { GH_ENTERPRISE_TOKEN: 't' }, readFile: () => 'gitlab.com:\n' }).env.GH_HOST, 'gitlab.com');
});

// Fix round 1: an explicit --repo's host against the host ghOptions would reach from cwd.
const { explicitRepoGhHost, pinExplicitRepoHost } = require('../../plugin/bin/lib/repo-resolve');
const dotcom = { ...ghe, remoteUrl: () => 'https://github.com/acme/widgets.git' };
test('explicitRepoGhHost: a bare github.com --repo on a GHE origin pins github.com; one agreeing with the seam pins nothing', () => {
  _resetGhHostCache();
  assert.equal(explicitRepoGhHost({ host: 'github.com', owner: 'acme', repo: 'widgets' }, '/r', ghe), 'github.com');
  assert.equal(explicitRepoGhHost({ owner: 'acme', repo: 'widgets' }, '/r', ghe), 'github.com'); // a missing host reads as github.com
  assert.equal(explicitRepoGhHost({ host: 'ACME.ghe.com', owner: 'acme', repo: 'widgets' }, '/r', ghe), null);
  assert.equal(explicitRepoGhHost({ host: 'other.ghe.com', owner: 'acme', repo: 'widgets' }, '/r', ghe), 'other.ghe.com');
  _resetGhHostCache();
  assert.equal(explicitRepoGhHost({ host: 'github.com', owner: 'acme', repo: 'widgets' }, '/d', dotcom), null); // AC2: github.com origin
  assert.equal(explicitRepoGhHost({ host: 'acme.ghe.com', owner: 'acme', repo: 'widgets' }, '/d', dotcom), 'acme.ghe.com');
  assert.equal(explicitRepoGhHost(null, '/d', dotcom), null);
});
test('explicitRepoGhHost AC4: an exported GH_HOST (empty string included) always wins', () => {
  _resetGhHostCache();
  for (const env of [{ GH_HOST: 'mine.example' }, { GH_HOST: '' }]) {
    assert.equal(explicitRepoGhHost({ host: 'github.com', owner: 'acme', repo: 'widgets' }, '/r', { ...ghe, env }), null, JSON.stringify(env));
  }
});
test('pinExplicitRepoHost: exports the pinned host on deps.env, leaves it alone otherwise, and then ghOptions steps back', () => {
  _resetGhHostCache();
  const env = { PATH: '/p' };
  assert.equal(pinExplicitRepoHost({ host: 'github.com', owner: 'acme', repo: 'widgets' }, { ...ghe, cwd: '/r', env }), 'github.com');
  assert.deepEqual(env, { PATH: '/p', GH_HOST: 'github.com' });
  const opts = { cwd: '/r', env };
  assert.strictEqual(ghOptions(['api', 'repos/acme/widgets/issues/7'], opts, ghe), opts);
  const mine = { GH_HOST: 'mine.example' };
  assert.equal(pinExplicitRepoHost({ host: 'github.com', owner: 'acme', repo: 'widgets' }, { ...ghe, cwd: '/r', env: mine }), null);
  assert.deepEqual(mine, { GH_HOST: 'mine.example' });
  _resetGhHostCache();
  const untouched = {};
  assert.equal(pinExplicitRepoHost({ host: 'github.com', owner: 'acme', repo: 'widgets' }, { ...dotcom, cwd: '/d', env: untouched }), null);
  assert.deepEqual(untouched, {});
});

// Final review item 1: an origin URL with an ssh:// scheme, userinfo or a :port
// still names its host; the stderr note never carries the userinfo.
test('final review: ssh://, user[:pass]@ and :port origins on *.ghe.com inject GH_HOST, and the note carries no credential', () => {
  for (const url of ['ssh://git@acme.ghe.com/acme/widgets.git', 'ssh://git@acme.ghe.com:22/acme/widgets.git',
    'https://user@acme.ghe.com/acme/widgets.git', 'https://x:tok@acme.ghe.com/acme/widgets.git',
    'https://acme.ghe.com:443/acme/widgets.git', 'HTTPS://x:tok@ACME.ghe.com:8443/acme/widgets']) {
    _resetGhHostCache();
    const notes = [];
    const out = ghOptions(['pr', 'list'], { cwd: '/r' }, { ...ghe, remoteUrl: () => url, stderr: (s) => notes.push(s) });
    assert.equal(out.env && out.env.GH_HOST, 'acme.ghe.com', url);
    assert.equal(notes.length, 1, url);
    assert.match(notes[0], /resolved repo acme\.ghe\.com\/acme\/widgets \(host: acme\.ghe\.com\)/, url);
    assert.doesNotMatch(notes[0], /tok|user|git@|:443|:8443|:22/, url);
  }
});
test('final review: an ssh:// remote with a token is not admitted; hosts.yml admits it; a token does not admit an https:// remote with userinfo and a port (#4854)', () => {
  _resetGhHostCache();
  assert.equal(resolveGhHost('/s', { ...ghe, remoteUrl: () => 'ssh://git@git.corp.example/acme/widgets.git', env: { GH_ENTERPRISE_TOKEN: 't' } }), null);
  _resetGhHostCache();
  assert.equal(resolveGhHost('/s', { ...ghe, remoteUrl: () => 'ssh://git@git.corp.example:2222/acme/widgets.git', env: { GITHUB_ENTERPRISE_TOKEN: 't' } }), null);
  _resetGhHostCache();
  assert.equal(resolveGhHost('/s', { ...ghe, remoteUrl: () => 'ssh://git@git.corp.example/acme/widgets.git', readFile: () => 'git.corp.example:\n' }), 'git.corp.example');
  _resetGhHostCache();
  assert.equal(resolveGhHost('/s', { ...ghe, remoteUrl: () => 'https://x:tok@git.corp.example:8443/acme/widgets.git', env: { GH_ENTERPRISE_TOKEN: 't' } }), null);
  _resetGhHostCache();
  assert.equal(resolveGhHost('/s', { ...ghe, remoteUrl: () => 'ssh://git@github.com/acme/widgets.git' }), null); // github.com stays github.com
});

// Final review item 6: the value of a value-taking flag is never read as a flag.
test('final review: a value after a value-taking flag is not an explicit host arg, whatever it starts with', () => {
  _resetGhHostCache();
  const o = { cwd: '/r' };
  for (const args of [['issue', 'create', '--title', '-R is broken', '--body', '--repo'], ['pr', 'create', '-t', '-Rfoo', '-b', '--hostname'],
    ['api', 'graphql', '-f', '--repo', '-F', '-R', '--field', '--hostname=x', '--raw-field', '-Rx'],
    ['api', 'x', '--jq', '--repo', '-q', '-R', '--template', '--repo=x', '--input', '-R'], ['issue', 'list', '--search', '-Racme']]) {
    assert.equal(ghOptions(args, o, ghe).env.GH_HOST, 'acme.ghe.com', args.join(' '));
  }
  for (const args of [['issue', 'create', '--body', '-R', '--repo', 'acme/widgets'], ['pr', 'create', '-t', 'x', '-Racme/widgets'],
    ['api', 'graphql', '-f', 'query=q', '--hostname', 'acme.ghe.com']]) {
    assert.strictEqual(ghOptions(args, o, ghe), o, args.join(' ')); // a real flag after a skipped value still counts
  }
});

// Final review item 3: shared-primitives' GH_TIMEOUT_MS is a lazy getter whose first
// read loads ./policy. Requiring repo-resolve must not trigger that read.
test('final review: requiring repo-resolve reads no GH_TIMEOUT_MS; ghAvailable reads it at call time', () => {
  const { execFileSync } = require('child_process');
  const lib = pathModule.join(__dirname, '..', '..', 'plugin', 'bin', 'lib');
  const script = [
    "const p = require('path');",
    'const rr = require(p.join(process.argv[1], "repo-resolve.js"));',
    'const policyLoaded = Object.keys(require.cache).some((k) => k === p.join(process.argv[1], "policy.js"));',
    'let timeout = null;',
    'rr.ghAvailable({ execFileSync: (c, a, o) => { timeout = o.timeout; } });',
    'const sp = require(p.join(process.argv[1], "shared-primitives.js"));',
    'process.stdout.write(JSON.stringify({ policyLoaded, timeout, expected: sp.GH_TIMEOUT_MS }));',
  ].join('\n');
  const env = { ...process.env };
  delete env.CLAUDE_TWEAKS_GH_TIMEOUT_MS;
  const out = JSON.parse(execFileSync(process.execPath, ['-e', script, lib], { cwd: require('os').tmpdir(), env, encoding: 'utf8', windowsHide: true }));
  assert.equal(out.policyLoaded, false, 'requiring repo-resolve.js read GH_TIMEOUT_MS at load (the getter loads ./policy)');
  assert.equal(out.timeout, out.expected);
  // The default alone cannot tell a call-time read from a hardcoded 5000: a non-default
  // override must reach ghAvailable's spawn.
  const overridden = JSON.parse(execFileSync(process.execPath, ['-e', script, lib], { cwd: require('os').tmpdir(), env: { ...env, CLAUDE_TWEAKS_GH_TIMEOUT_MS: '7777' }, encoding: 'utf8', windowsHide: true }));
  assert.equal(overridden.timeout, 7777);
});

// Re-review: the free-text value flags --comment, --subject, --notes and --description
// are values too. `gh pr review --comment` is gh's one boolean --comment, so there the
// next token is still scanned.
test('re-review: --comment/--subject/--notes/--description values are not an explicit host arg; a real one after them is', () => {
  _resetGhHostCache();
  const o = { cwd: '/r' };
  for (const args of [['issue', 'close', '1', '--comment', '-R is wrong'], ['issue', 'reopen', '1', '--comment', '--repo'],
    ['pr', 'merge', '1', '--subject', '-Rfoo'], ['release', 'create', 'v1', '--notes', '--hostname=x'],
    ['label', 'create', 'x', '--description', '--repo=x']]) {
    assert.equal(ghOptions(args, o, ghe).env.GH_HOST, 'acme.ghe.com', args.join(' '));
  }
  for (const args of [['issue', 'close', '1', '--comment', '-R', '--repo', 'acme/widgets'], ['pr', 'merge', '1', '--subject', '--repo', '-Racme/widgets'],
    ['release', 'edit', 'v1', '--notes', '-R', '--hostname', 'acme.ghe.com'], ['label', 'create', 'x', '--description', '--repo', '--repo=acme/widgets'],
    ['pr', 'review', '1', '--comment', '--repo', 'acme/widgets'], ['pr', 'review', '1', '--comment', '-b', '-R', '-Racme/widgets']]) {
    assert.strictEqual(ghOptions(args, o, ghe), o, args.join(' '));
  }
});
