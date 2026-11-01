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
  // #2567 shifted this line by 2 (a shared-primitives require + its updated
  // comment above GH_TIMEOUT_MS's own former definition). #4554 shifted it by
  // 2 more (the timed-out-probe note in ghAvailable's comment).
  assert.deepEqual(hits, [`lib${pathModule.sep}repo-resolve.js:40`]);
});

// #4505: the gh host seam. Every test resets the per-process memo first and
// passes fake deps, so no real `git` probe or hosts.yml read happens.
const path = require('path');
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
test('AC5.1, AC5.2 (Decision Q1): an SSH alias host is not injected, even with an enterprise token; a hosts.yml-known GHES host is; a token admits an HTTPS host', () => {
  _resetGhHostCache();
  const alias = { ...ghe, remoteUrl: () => 'git@github.com-work:acme/widgets.git' };
  const o = { cwd: '/a' };
  assert.strictEqual(ghOptions(['pr', 'list'], o, alias), o);
  _resetGhHostCache();
  const o2 = { cwd: '/t' };
  assert.strictEqual(ghOptions(['pr', 'list'], o2, { ...alias, env: { GH_ENTERPRISE_TOKEN: 't' } }), o2);
  _resetGhHostCache();
  assert.equal(ghOptions(['pr', 'list'], { cwd: '/u' }, { ...ghe, remoteUrl: () => 'https://git.corp.example/acme/widgets.git', env: { GITHUB_ENTERPRISE_TOKEN: 't' } }).env.GH_HOST, 'git.corp.example');
  _resetGhHostCache();
  const o3 = { cwd: '/m' };
  assert.strictEqual(ghOptions(['pr', 'list'], o3, { ...ghe, remoteUrl: () => 'https://GitHub.com/acme/widgets.git' }), o3); // mixed-case github.com is github.com
  _resetGhHostCache();
  const ghes = { ...ghe, remoteUrl: () => 'https://git.corp.example/acme/widgets.git', env: { GH_CONFIG_DIR: '/cfg' },
    readFile: (p) => { assert.equal(p, path.join('/cfg', 'hosts.yml')); return 'git.corp.example:\n    user: me\n'; } };
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
  const d = { ...ghe, remoteUrl: (cwd) => { probes++; if (cwd === path.resolve('/none')) throw new Error('no origin'); return ghe.remoteUrl(); }, stderr: (s) => notes.push(s) };
  ghOptions(['a'], { cwd: '/r' }, d); ghOptions(['b'], { cwd: '/r' }, d);
  const none = { cwd: '/none' };
  assert.strictEqual(ghOptions(['c'], none, d), none);
  assert.equal(probes, 2);
  assert.equal(notes.length, 1);
  assert.match(notes[0], /resolved repo acme\.ghe\.com\/acme\/widgets \(host: acme\.ghe\.com\) — gh calls get GH_HOST=acme\.ghe\.com/);
});
test("resolveGhHost: hosts.yml is read from gh's own config-dir order, keys matched case-insensitively", () => {
  const corp = { ...ghe, remoteUrl: () => 'git@Git.Corp.Example:acme/widgets.git' };
  const cases = [
    [{ GH_CONFIG_DIR: '/cfg', XDG_CONFIG_HOME: '/x', AppData: '/ad' }, 'win32', path.join('/cfg', 'hosts.yml')],
    [{ XDG_CONFIG_HOME: '/x', AppData: '/ad' }, 'win32', path.join('/x', 'gh', 'hosts.yml')],
    [{ AppData: '/ad' }, 'win32', path.join('/ad', 'GitHub CLI', 'hosts.yml')],
    [{ AppData: '/ad' }, 'linux', path.join('/h', '.config', 'gh', 'hosts.yml')],
  ];
  for (const [env, platform, want] of cases) {
    _resetGhHostCache();
    const read = [];
    const host = resolveGhHost('/r', { ...corp, env, platform, readFile: (p) => { read.push(p); return '# comment:\nGIT.CORP.EXAMPLE:\n    user: me\ngithub.com:\n'; } });
    assert.deepEqual(read, [want]);
    assert.equal(host, 'git.corp.example');
  }
});
test('resolveGhHost: a user-less scp-style remote is SSH, so the token clause skips it; an unknown HTTPS host without a token is null', () => {
  _resetGhHostCache();
  assert.equal(resolveGhHost('/s', { ...ghe, remoteUrl: () => 'git.corp.example:acme/widgets.git', env: { GH_ENTERPRISE_TOKEN: 't' } }), null);
  _resetGhHostCache();
  assert.equal(resolveGhHost('/n', { ...ghe, remoteUrl: () => 'https://git.corp.example/acme/widgets.git' }), null);
});
