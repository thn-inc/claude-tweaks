'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  SUPERPOWERS_FLOOR,
  parseVersion,
  isOlder,
  effectiveSuperpowersVersion,
  superpowersNotice,
} = require('../../plugin/bin/lib/superpowers-version');
const { loadManifest } = require('../../tools/upstream-drift/manifest');

const ROOT = path.join(__dirname, '..', '..');

// #3380 — every test injects `env` and `homedir`, so none of them can read the
// maintainer's real ~/.claude/plugins/installed_plugins.json.

// A throwaway world: {tmp}/home is the fake home, {tmp}/config the config dir,
// {tmp}/inst/{name} an install artifact. realpath'd because macOS /var is a
// symlink to /private/var and the resolver compares realpathed paths.
function mkWorld() {
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sp-version-test-')));
  const home = path.join(tmp, 'home');
  const config = path.join(tmp, 'config');
  const inst = path.join(tmp, 'inst');
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(config, { recursive: true });
  fs.mkdirSync(inst, { recursive: true });
  return {
    tmp,
    home,
    config,
    inst,
    dir(...parts) {
      const d = path.join(tmp, ...parts);
      fs.mkdirSync(d, { recursive: true });
      return d;
    },
    // Writes {inst}/{name}/.claude-plugin/plugin.json with the given version.
    artifact(name, version) {
      const d = path.join(inst, name, '.claude-plugin');
      fs.mkdirSync(d, { recursive: true });
      fs.writeFileSync(path.join(d, 'plugin.json'), JSON.stringify({ name: 'superpowers', version }));
      return path.join(inst, name);
    },
    // Writes installed_plugins.json under `configDir` (default: the config dir).
    plugins(map, configDir = config) {
      fs.mkdirSync(path.join(configDir, 'plugins'), { recursive: true });
      fs.writeFileSync(
        path.join(configDir, 'plugins', 'installed_plugins.json'),
        JSON.stringify({ version: 2, plugins: map })
      );
    },
    rawPluginsFile(text) {
      fs.mkdirSync(path.join(config, 'plugins'), { recursive: true });
      fs.writeFileSync(path.join(config, 'plugins', 'installed_plugins.json'), text);
    },
    deps(extra = {}) {
      return { env: { CLAUDE_CONFIG_DIR: config }, homedir: () => home, ...extra };
    },
  };
}

function entry(scope, installPath, extra = {}) {
  return { scope, installPath, lastUpdated: '2026-01-01T00:00:00.000Z', ...extra };
}

const MK = 'claude-plugins-official';

// ---- AC1: project scope overrides user scope ----------------------------------

test('AC1.1: project 6.3.0 overrides user 7.0.0 — notice names version, floor and the project-scope command', () => {
  const w = mkWorld();
  const proj = w.dir('proj');
  w.plugins({
    [`superpowers@${MK}`]: [
      entry('user', w.artifact('u', '7.0.0')),
      entry('project', w.artifact('p', '6.3.0'), { projectPath: proj }),
    ],
  });
  const effective = effectiveSuperpowersVersion(proj, w.deps());
  assert.equal(effective.version, '6.3.0');
  assert.equal(effective.scope, 'project');
  assert.equal(effective.marketplace, MK);
  const notice = superpowersNotice({ effective, floor: SUPERPOWERS_FLOOR, projectDir: proj });
  assert.ok(notice.includes('6.3.0'));
  assert.ok(notice.includes('7.0.0'));
  assert.ok(notice.includes(`claude plugin update superpowers@${MK} --scope project`));
  assert.ok(!notice.includes('run from'));
});

test('notice copy is exact', () => {
  const effective = { version: '6.3.0', scope: 'user', marketplace: 'mk', projectPath: undefined };
  assert.equal(
    superpowersNotice({ effective, floor: '7.0.0', projectDir: '/x' }),
    'claude-tweaks: superpowers 6.3.0 is older than 7.0.0, the version claude-tweaks is verified against — ' +
      'update with: claude plugin update superpowers@mk --scope user; ' +
      'if it reports already at the latest, run claude plugin marketplace update mk first' +
      ' — tell the user once, in your first reply; never run the update yourself'
  );
});

test('a symlinked cwd to the matched project gets no "run from" suffix (both sides are realpathed)', () => {
  const w = mkWorld();
  const proj = w.dir('proj');
  const link = path.join(w.tmp, 'proj-link');
  fs.symlinkSync(proj, link);
  // projectPath is the symlink; projectDir is the real dir. Only realpathing
  // BOTH sides makes them equal.
  const effective = { version: '6.3.0', scope: 'project', marketplace: MK, projectPath: link };
  assert.ok(!superpowersNotice({ effective, floor: SUPERPOWERS_FLOOR, projectDir: proj }).includes('run from'));
  const effective2 = { ...effective, projectPath: proj };
  assert.ok(!superpowersNotice({ effective: effective2, floor: SUPERPOWERS_FLOOR, projectDir: link }).includes('run from'));
});

// ---- AC2: no notice at or above the floor; scope resolution -------------------

test('AC2.1: equal to the floor and newer than the floor give a null notice', () => {
  for (const v of ['7.0.0', '7.1.0']) {
    const w = mkWorld();
    const proj = w.dir('proj');
    w.plugins({ [`superpowers@${MK}`]: [entry('project', w.artifact('p', v), { projectPath: proj })] });
    const effective = effectiveSuperpowersVersion(proj, w.deps());
    assert.equal(effective.version, v);
    assert.equal(superpowersNotice({ effective, floor: SUPERPOWERS_FLOOR, projectDir: proj }), null);
  }
});

test('AC2.1: user-only 7.0.0 resolves to the user entry with a null notice; user-only 6.3.0 says --scope user', () => {
  const w = mkWorld();
  const proj = w.dir('proj');
  w.plugins({ [`superpowers@${MK}`]: [entry('user', w.artifact('u', '7.0.0'))] });
  const ok = effectiveSuperpowersVersion(proj, w.deps());
  assert.equal(ok.scope, 'user');
  assert.equal(superpowersNotice({ effective: ok, floor: SUPERPOWERS_FLOOR, projectDir: proj }), null);

  const w2 = mkWorld();
  const proj2 = w2.dir('proj');
  w2.plugins({ [`superpowers@${MK}`]: [entry('user', w2.artifact('u', '6.3.0'))] });
  const old = effectiveSuperpowersVersion(proj2, w2.deps());
  const notice = superpowersNotice({ effective: old, floor: SUPERPOWERS_FLOOR, projectDir: proj2 });
  assert.ok(notice.includes('--scope user'));
  assert.ok(!notice.includes('run from'));
});

test('a user-scope install never gets the "run from" suffix, even if its entry carries a projectPath', () => {
  const w = mkWorld();
  const proj = w.dir('proj');
  const other = w.dir('other');
  w.plugins({ [`superpowers@${MK}`]: [entry('user', w.artifact('u', '6.3.0'), { projectPath: other })] });
  const effective = effectiveSuperpowersVersion(proj, w.deps());
  assert.equal(effective.scope, 'user');
  assert.ok(!superpowersNotice({ effective, floor: SUPERPOWERS_FLOOR, projectDir: proj }).includes('run from'));
});

test('none installed: no superpowers key, no plugins file, or no entries gives null', () => {
  const w = mkWorld();
  const proj = w.dir('proj');
  assert.equal(effectiveSuperpowersVersion(proj, w.deps()), null); // file missing
  w.plugins({ 'other@mk': [entry('user', w.artifact('o', '1.0.0'))] });
  assert.equal(effectiveSuperpowersVersion(proj, w.deps()), null); // key missing
  w.plugins({ [`superpowers@${MK}`]: [] });
  assert.equal(effectiveSuperpowersVersion(proj, w.deps()), null); // empty list
});

test('AC2.2: ancestor project entry applies below its projectPath, notice says where to run', () => {
  const w = mkWorld();
  const proj = w.dir('proj');
  const deep = w.dir('proj', 'sub', 'deep');
  w.plugins({
    [`superpowers@${MK}`]: [
      entry('user', w.artifact('u', '7.0.0')),
      entry('project', w.artifact('p', '6.3.0'), { projectPath: proj }),
    ],
  });
  const effective = effectiveSuperpowersVersion(deep, w.deps());
  assert.equal(effective.version, '6.3.0');
  assert.equal(effective.projectPath, proj);
  const notice = superpowersNotice({ effective, floor: SUPERPOWERS_FLOOR, projectDir: deep });
  assert.ok(notice.includes(`run from ${proj}`));
  assert.ok(notice.includes('the project this install belongs to'));
});

test('AC2.2/AC2.3: a worktree under the project resolves to the project entry; one outside resolves to user', () => {
  const w = mkWorld();
  const proj = w.dir('proj');
  const wtInside = w.dir('proj', '.claude', 'worktrees', 'w1');
  const wtOutside = w.dir('elsewhere', 'w1');
  w.plugins({
    [`superpowers@${MK}`]: [
      entry('user', w.artifact('u', '7.0.0')),
      entry('project', w.artifact('p', '6.3.0'), { projectPath: proj }),
    ],
  });
  assert.equal(effectiveSuperpowersVersion(wtInside, w.deps()).version, '6.3.0');
  const out = effectiveSuperpowersVersion(wtOutside, w.deps());
  assert.equal(out.scope, 'user');
  assert.equal(out.version, '7.0.0');
});

test('project 7.0.0 over user 6.3.0 gives no notice (the project entry wins)', () => {
  const w = mkWorld();
  const proj = w.dir('proj');
  w.plugins({
    [`superpowers@${MK}`]: [
      entry('user', w.artifact('u', '6.3.0')),
      entry('project', w.artifact('p', '7.0.0'), { projectPath: proj }),
    ],
  });
  const effective = effectiveSuperpowersVersion(proj, w.deps());
  assert.equal(effective.version, '7.0.0');
  assert.equal(superpowersNotice({ effective, floor: SUPERPOWERS_FLOOR, projectDir: proj }), null);
});

test('a project entry whose projectPath is the home directory is ignored (probe: never applies)', () => {
  const w = mkWorld();
  const work = w.dir('home', 'work');
  w.plugins({
    [`superpowers@${MK}`]: [
      entry('user', w.artifact('u', '7.0.0')),
      entry('project', w.artifact('p', '6.2.0'), { projectPath: w.home }),
    ],
  });
  const effective = effectiveSuperpowersVersion(work, w.deps());
  assert.equal(effective.scope, 'user');
  assert.equal(effective.version, '7.0.0');
  assert.equal(superpowersNotice({ effective, floor: SUPERPOWERS_FLOOR, projectDir: work }), null);
});

test('the installed artifact wins over installed_plugins.json metadata', () => {
  const w = mkWorld();
  const proj = w.dir('proj');
  w.plugins({
    [`superpowers@${MK}`]: [
      entry('project', w.artifact('p', '6.3.0'), { projectPath: proj, version: '9.9.9' }),
    ],
  });
  assert.equal(effectiveSuperpowersVersion(proj, w.deps()).version, '6.3.0');
});

test('two marketplaces: the project entry from marketplace b beats the user entry from a', () => {
  const w = mkWorld();
  const proj = w.dir('proj');
  w.plugins({
    'superpowers@a': [entry('user', w.artifact('ua', '7.0.0'))],
    'superpowers@b': [entry('project', w.artifact('pb', '6.3.0'), { projectPath: proj })],
  });
  const effective = effectiveSuperpowersVersion(proj, w.deps());
  assert.equal(effective.marketplace, 'b');
  const notice = superpowersNotice({ effective, floor: SUPERPOWERS_FLOOR, projectDir: proj });
  assert.ok(notice.includes('superpowers@b'));
  assert.ok(!notice.includes('superpowers@a'));
});

test('two user entries across marketplaces: the later lastUpdated wins', () => {
  const w = mkWorld();
  const proj = w.dir('proj');
  w.plugins({
    'superpowers@a': [entry('user', w.artifact('ua', '6.3.0'), { lastUpdated: '2026-02-01T00:00:00.000Z' })],
    'superpowers@b': [entry('user', w.artifact('ub', '7.0.0'), { lastUpdated: '2026-03-01T00:00:00.000Z' })],
  });
  const effective = effectiveSuperpowersVersion(proj, w.deps());
  assert.equal(effective.marketplace, 'b');
  assert.equal(effective.version, '7.0.0');
});

test('CLAUDE_CONFIG_DIR: the override dir is read and {home}/.claude is ignored; env without it reads {home}/.claude', () => {
  const w = mkWorld();
  const proj = w.dir('proj');
  const override = w.dir('override');
  w.plugins({ [`superpowers@${MK}`]: [entry('user', w.artifact('over', '6.3.0'))] }, override);
  w.plugins({ [`superpowers@${MK}`]: [entry('user', w.artifact('dot', '7.5.0'))] }, path.join(w.home, '.claude'));

  const withOverride = effectiveSuperpowersVersion(proj, w.deps({ env: { CLAUDE_CONFIG_DIR: override } }));
  assert.equal(withOverride.version, '6.3.0');

  const noOverride = effectiveSuperpowersVersion(proj, w.deps({ env: {} }));
  assert.equal(noOverride.version, '7.5.0');

  // the override dir has no file: the {home}/.claude file must not be a fallback
  const emptyOverride = w.dir('empty-override');
  assert.equal(effectiveSuperpowersVersion(proj, w.deps({ env: { CLAUDE_CONFIG_DIR: emptyOverride } })), null);
});

// ---- AC3: malformed or unreadable input never throws --------------------------

test('AC3.1: malformed installed_plugins.json shapes give null without throwing', () => {
  const w = mkWorld();
  const proj = w.dir('proj');
  const raw = ['', 'not json', JSON.stringify({ version: 2, plugins: [] }), JSON.stringify({ plugins: 'x' }),
    JSON.stringify({ plugins: { [`superpowers@${MK}`]: {} } }), JSON.stringify(null), JSON.stringify({ plugins: { [`superpowers@${MK}`]: [null, 7, 'x'] } })];
  for (const text of raw) {
    w.rawPluginsFile(text);
    assert.doesNotThrow(() => effectiveSuperpowersVersion(proj, w.deps()), text);
    assert.equal(effectiveSuperpowersVersion(proj, w.deps()), null, text);
  }
});

test('AC3.1: an unreadable installPath (missing dir, or plugin.json that is not JSON) gives null', () => {
  const w = mkWorld();
  const proj = w.dir('proj');
  w.plugins({ [`superpowers@${MK}`]: [entry('user', path.join(w.inst, 'does-not-exist'))] });
  assert.equal(effectiveSuperpowersVersion(proj, w.deps()), null);

  const broken = path.join(w.inst, 'broken');
  fs.mkdirSync(path.join(broken, '.claude-plugin'), { recursive: true });
  fs.writeFileSync(path.join(broken, '.claude-plugin', 'plugin.json'), '{nope');
  w.plugins({ [`superpowers@${MK}`]: [entry('user', broken)] });
  assert.equal(effectiveSuperpowersVersion(proj, w.deps()), null);
});

test('a throwing readFile gives null (the contract the SessionStart hook relies on)', () => {
  const w = mkWorld();
  const proj = w.dir('proj');
  w.plugins({ [`superpowers@${MK}`]: [entry('user', w.artifact('u', '6.3.0'))] });
  const readFile = () => { throw new Error('boom'); };
  assert.equal(effectiveSuperpowersVersion(proj, w.deps({ readFile })), null);
});

test('a throwing homedir gives null rather than throwing', () => {
  const w = mkWorld();
  const proj = w.dir('proj');
  w.plugins({ [`superpowers@${MK}`]: [entry('user', w.artifact('u', '6.3.0'))] });
  const homedir = () => { throw new Error('no home'); };
  assert.equal(effectiveSuperpowersVersion(proj, w.deps({ homedir })), null);
});

// ---- AC4: numeric, strict comparison -------------------------------------------

test('AC4.1: isOlder compares numerically per component, not lexically', () => {
  assert.equal(isOlder('6.10.0', '6.9.0'), false);
  assert.equal(isOlder('6.9.0', '6.10.0'), true);
  assert.equal(isOlder('6.3.0', '7.0.0'), true);
  assert.equal(isOlder('7.0.0', '7.0.0'), false);
  assert.equal(isOlder('7.0.1', '7.0.0'), false);
  assert.equal(isOlder('bogus', '7.0.0'), false);
  assert.equal(isOlder('6.0.0', 'bogus'), false);
});

test('AC4.1: parseVersion accepts strict x.y.z with an optional v, rejects everything else', () => {
  assert.deepEqual(parseVersion('7.0.0'), [7, 0, 0]);
  assert.deepEqual(parseVersion('v7.0.0'), [7, 0, 0]);
  assert.deepEqual(parseVersion('6.10.2'), [6, 10, 2]);
  for (const bad of ['7.0.0-rc.1', '7.0.0+build', '7.0', '', ' 7.0.0', '7.0.0 ', 'vv7.0.0', null, undefined, 7, {}, ['7.0.0']]) {
    assert.equal(parseVersion(bad), null, String(bad));
  }
});

test('AC4.2: a prerelease or build-metadata plugin.json version is not a version — null, so no notice', () => {
  for (const v of ['7.0.0-rc.1', '7.0.0+build']) {
    const w = mkWorld();
    const proj = w.dir('proj');
    w.plugins({ [`superpowers@${MK}`]: [entry('user', w.artifact('u', v))] });
    const effective = effectiveSuperpowersVersion(proj, w.deps());
    assert.equal(effective, null, v);
    assert.equal(superpowersNotice({ effective, floor: SUPERPOWERS_FLOOR, projectDir: proj }), null);
  }
});

test('superpowersNotice: null for a null effective, a non-string version, or an unparseable floor', () => {
  assert.equal(superpowersNotice({ effective: null, floor: '7.0.0', projectDir: '/x' }), null);
  assert.equal(superpowersNotice({ effective: undefined, floor: '7.0.0', projectDir: '/x' }), null);
  assert.equal(superpowersNotice({ effective: { version: '6.0.0', scope: 'user', marketplace: 'm' }, floor: 'bogus', projectDir: '/x' }), null);
});

// ---- AC5: floor parity ----------------------------------------------------------

test('AC5.1/AC5.2: SUPERPOWERS_FLOOR equals the drift manifest’s pinned superpowers version', () => {
  const manifest = loadManifest(path.join(ROOT, 'tools', 'upstream-drift', 'manifest.yml'));
  const sp = manifest.dependencies.find((d) => d.name === 'superpowers');
  assert.ok(sp, 'manifest has a superpowers dependency');
  assert.equal(SUPERPOWERS_FLOOR, sp.pinned);
});
