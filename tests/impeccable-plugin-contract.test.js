// tests/impeccable-plugin-contract.test.js
//
// Contract probe for the Impeccable PLUGIN (a different artifact on a
// different version line from the Impeccable CLI — see
// tests/impeccable-cli-contract.test.js for that one). Proves the claims in
// skills/design-wrapper/impeccable-plugin.md against the plugin and engine
// actually installed.
//
// Two layers, deliberately split (record #2985):
//
// 1. Fixture-driven shape tests — run everywhere, including CI, with no
//    Impeccable install at all. They replay committed fixtures through the
//    engine module's own run()/VALIDATORS dispatch (the same seam
//    tests/bin-lib/impeccable-engine/run.test.js drives with a fake
//    launcher), proving the fixtures still match the documented shape.
// 2. Live-engine tests — gated on `impeccable-engine.js resolve()` actually
//    finding a usable install on THIS machine. Absent or mismatched: skip
//    with the resolve reason, never fail. The drift tool
//    (tools/upstream-drift/run.js), run explicitly, still reports a version
//    breach as a breach — this file only turns it into an unconditional skip.
//
// Resolution is NOT reimplemented here. plugin/bin/lib/impeccable-engine's
// resolve()/run() already own it — Layer 0, doctor, and explore all call the
// same two functions; tools/upstream-drift/checks.js owns the SEPARATE
// plugin-cache-glob version-pin resolver the manifest's `pinned` key drives.
// A second resolver beside either would be a second thing to keep correct,
// and two resolvers agreeing is exactly when a shared bug reads as the spec.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { checkVersion, checkAssertions } = require('../tools/upstream-drift/checks');
const { loadManifest } = require('../tools/upstream-drift/manifest');
const engine = require('../plugin/bin/lib/impeccable-engine');

const REPO_ROOT = path.join(__dirname, '..');
const FIXTURES = path.join(__dirname, 'fixtures', 'impeccable-plugin');
const CONTRACT_DOC = path.join(REPO_ROOT, 'plugin', 'skills', 'design-wrapper', 'impeccable-plugin.md');
const DETECTION_DOC = path.join(REPO_ROOT, 'plugin', 'skills', 'design-wrapper', 'frontend-detection.md');

const manifest = loadManifest(path.join(REPO_ROOT, 'tools', 'upstream-drift', 'manifest.yml'));
const ENTRY = manifest.dependencies.find((d) => d.name === 'impeccable-plugin');
const PINNED = ENTRY.pinned;
const PINNED_ENGINE = ENTRY['pinned-engine'];

const versionCheck = checkVersion(ENTRY);

// Absent plugin, OR present-but-off-pin: both are a skip, never a failure —
// AC1/AC2. A contract probe that silently declines to run reads exactly like
// one that passed, which is the defect this suite exists to catch, so it
// must not be this suite's own behaviour for the ONE case that genuinely has
// nothing to prove (absent) or the ONE case the drift tool, not this test,
// is responsible for reporting (a version breach — `checks.js`'s own
// "version mismatch is a breach" test below still proves checkVersion
// reports it correctly when run on purpose). Everything that replays a
// committed fixture runs unconditionally regardless of this gate: fixtures
// need no installed plugin at all.
const versionSkipReason = versionCheck.status === 'ok'
  ? false
  : versionCheck.status === 'absent'
    ? 'Impeccable plugin not installed'
    : `installed version(s) do not match the pin — ${versionCheck.detail}`;

// ─── the pins ───────────────────────────────────────────────────────────────

const PIN_COMMENT_RE = /<!--\s*upstream-pin:\s*impeccable-plugin@(\S+)\s+impeccable-engine@(\S+)\s*-->/;

test('impeccable-plugin.md pins the same plugin AND engine versions the drift manifest does (AC5)', () => {
  const doc = fs.readFileSync(CONTRACT_DOC, 'utf8');
  const match = doc.match(PIN_COMMENT_RE);
  assert.ok(
    match,
    'impeccable-plugin.md must carry an <!-- upstream-pin: impeccable-plugin@X.Y.Z impeccable-engine@A.B.C --> comment'
  );
  assert.strictEqual(
    match[1],
    PINNED,
    `impeccable-plugin.md pins impeccable-plugin@${match[1]} but tools/upstream-drift/manifest.yml pins ${PINNED}. ` +
      'Two pins for one artifact is the drift this whole seam exists to prevent — move both together.'
  );
  assert.strictEqual(
    match[2],
    PINNED_ENGINE,
    `impeccable-plugin.md pins impeccable-engine@${match[2]} but tools/upstream-drift/manifest.yml pins ${PINNED_ENGINE}. ` +
      'Two pins for one artifact is the drift this whole seam exists to prevent — move both together.'
  );
});

test('the installed plugin matches the pinned version', { skip: versionSkipReason }, () => {
  assert.strictEqual(versionCheck.status, 'ok');
});

// ─── degradation: the three conditions stay distinguishable ─────────────────
//
// Exercised through the resolver's search root pointed at a COMMITTED fixture
// cache tree. Never by mutating, hiding, or pointing at the developer's real
// ~/.claude/plugins/cache — which is the entire reason that search root is a
// parameter with a default rather than a constant.

function entryWithSearchRoot(searchRoot) {
  // Spread first, override after: the derived probe must win over the parsed
  // manifest's, never the reverse.
  return {
    ...ENTRY,
    'installed-probe': {
      type: 'plugin-cache-glob',
      glob: path.join(searchRoot, '*', 'impeccable', '*', '.claude-plugin', 'plugin.json'),
    },
  };
}

test('version mismatch is a breach, and the reason names EVERY version found', () => {
  const result = checkVersion(entryWithSearchRoot(path.join(FIXTURES, 'cache')));

  assert.strictEqual(result.status, 'breach', 'candidates exist but none is at the pin — that is a breach, not an absence');
  assert.deepStrictEqual(
    [...result.installed].sort(),
    ['3.0.6', '4.0.4'],
    'both fixture candidates must be reported — a resolver that stops at the first one would pass a single-candidate fixture'
  );
  for (const found of ['3.0.6', '4.0.4']) {
    assert.ok(
      result.detail.includes(found),
      `the mismatch reason must name every version found; ${found} is missing from: ${result.detail}`
    );
  }
  assert.ok(result.detail.includes(PINNED), `the mismatch reason must also name the pin ${PINNED}: ${result.detail}`);
});

test('an empty search root is absent, not a breach', () => {
  const result = checkVersion(entryWithSearchRoot(path.join(FIXTURES, 'no-such-cache')));

  assert.strictEqual(result.status, 'absent');
  assert.deepStrictEqual(result.installed, []);
  assert.ok(
    !/breach|does not match/i.test(result.detail),
    `"not installed" must not be reported as a version mismatch: ${result.detail}`
  );
});

// ─── the installed artifact's static contract ───────────────────────────────

test('the manifest\'s assertions about the pinned plugin still hold', { skip: versionSkipReason }, () => {
  const result = checkAssertions(ENTRY);
  const failing = result.results.filter((r) => r.status !== 'ok');
  assert.deepStrictEqual(
    failing.map((r) => `${r.claims}: ${r.detail}`),
    [],
    'impeccable-plugin.md claims something upstream no longer says'
  );
});

// ─── fixture-driven validator tests (always on, no install needed) ─────────
//
// Replays each committed fixture through the engine module's own run()
// dispatch — a fake launcher that returns the fixture's raw text — so the
// fixtures stay proven against the SAME validators Layer 0/doctor/explore
// rely on in production, with zero dependency on what (if anything) is
// actually installed on the machine running this suite. Mirrors
// tests/bin-lib/impeccable-engine/run.test.js's own fakeDeps pattern
// (notably its "the committed real-run fixture passes unmodified" doctor.json
// test), scoped here to the two fixtures that module's own suite does not
// already cover: signals and concept-seed.

function fakeEngineDeps(spawnStdout) {
  const entries = [{ scope: 'user', installPath: '/fake/install', version: PINNED }];
  const installedPluginsJson = JSON.stringify({ version: 2, plugins: { 'impeccable@impeccable': entries } });
  return {
    readFile: () => installedPluginsJson,
    exists: () => true,
    realpath: (p) => p,
    homedir: () => '/fake-home',
    cwd: () => '/fake-project',
    spawn: (_cmd, args) => {
      // The first call through resolve() is always its own engine-probe.
      if (args[0] === 'engine-probe') return `impeccable-engine ${PINNED_ENGINE}\n`;
      return spawnStdout;
    },
  };
}

test('fixture: signals-backend-repo.json still matches validateSignals() shape', () => {
  const fixtureText = fs.readFileSync(path.join(FIXTURES, 'signals-backend-repo.json'), 'utf8');
  const out = engine.run('signals', [], {}, fakeEngineDeps(fixtureText));
  assert.strictEqual(out.ok, true, out.detail || out.reason);
  assert.deepStrictEqual(out.value, JSON.parse(fixtureText));
});

test('fixture: concept-seed.txt still matches validateConceptSeed() shape', () => {
  const fixtureText = fs.readFileSync(path.join(FIXTURES, 'concept-seed.txt'), 'utf8');
  const out = engine.run('concept-seed', ['--scope', 'surface'], {}, fakeEngineDeps(fixtureText));
  assert.strictEqual(out.ok, true, out.detail || out.reason);
  assert.strictEqual(out.value, fixtureText);
});

// ─── live-engine tests (gated on a real, usable install) ────────────────────
//
// `resolve()` accepts any install carrying the 4.2.2+ launcher and a cached
// engine binary, regardless of exact plugin version — a DIFFERENT, more
// permissive gate than `versionSkipReason` above (which tracks the exact
// `pinned` version the drift manifest cares about). A machine can fail one
// gate and pass the other in either direction, so the two are independent,
// never collapsed into one skip reason.

const liveResolved = engine.resolve();
const liveEngineSkip = liveResolved.ok
  ? false
  : `Impeccable engine not available (${liveResolved.reason}${liveResolved.detail ? `: ${liveResolved.detail}` : ''})`;

test('live: impeccable-engine.js resolve() finds a usable 4.2.2+ install with a cached engine', { skip: liveEngineSkip }, () => {
  assert.strictEqual(liveResolved.ok, true);
  assert.ok(fs.existsSync(liveResolved.launcher), `resolved launcher ${liveResolved.launcher} does not exist`);
  assert.ok(liveResolved.engineVersion, 'engine-probe must report a version string');
});

test('live: the resolved launcher\'s engine-probe output matches /^impeccable-engine \\S+$/', { skip: liveEngineSkip }, () => {
  // Through the module's own spawn: on Windows the launcher is impeccable.cmd, which a raw
  // execFileSync refuses (EINVAL) — launchSpec wraps it in cmd.exe /c.
  const out = engine.defaultDeps().spawn(liveResolved.launcher, ['engine-probe'], {
    encoding: 'utf8',
    env: Object.assign({}, process.env, { IMPECCABLE_LAUNCHER_PROBE: '1' }),
  });
  assert.match(out.trim(), /^impeccable-engine \S+$/);
});

test('live: run("signals") against the real installed engine returns the documented shape', { skip: liveEngineSkip }, () => {
  const out = engine.run('signals');
  assert.strictEqual(out.ok, true, out.detail || out.reason);
  assert.deepStrictEqual(
    Object.keys(out.value).sort(),
    ['critique', 'devServer', 'git', 'scan', 'setup'],
    'impeccable-plugin.md documents exactly these five top-level keys'
  );
});

// ─── Layer 3 is not redundant with scan.targets (PERMANENT) ─────────────────
//
// Replays a frozen fixture, never live git state: an assertion that this repo
// currently produces N targets is a scheduled failure timed to the next
// commit ([IL-80]), and this leaf's own diff moves that number. See the
// fixture's README for how it was recorded.

const FROZEN = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'signals-backend-repo.json'), 'utf8'));

// Layer 3's predicate, per skills/design-wrapper/frontend-detection.md. The
// sync guard below pins these two sets to that file's tables so this copy
// cannot drift away from the rules it claims to implement.
const TRIGGER_EXTENSIONS = new Set([
  '.tsx', '.jsx', '.vue', '.svelte', '.html', '.css', '.scss', '.sass', '.less', '.astro', '.mdx',
]);
const TRIGGER_PATH_SEGMENTS = ['/components/', '/pages/', '/app/', '/routes/', '/views/', '/ui/'];

function isFrontend(file) {
  const normalized = file.replace(/\\/g, '/');
  if (TRIGGER_EXTENSIONS.has(path.extname(normalized).toLowerCase())) return true;
  return TRIGGER_PATH_SEGMENTS.some((seg) => `/${normalized}/`.includes(seg));
}

test('scan.targets is NOT equivalent to Layer 3 — the frontend predicate survives', () => {
  const targets = FROZEN.scan.targets;
  assert.ok(targets.length > 0, 'the frozen fixture must carry targets, or this proves nothing');

  const layer3 = targets.filter(isFrontend);
  assert.deepStrictEqual(
    layer3,
    [],
    'Layer 3 rejects every target in this fixture — if that changed, either the trigger tables in ' +
      'frontend-detection.md moved or the fixture was re-recorded from a repo with UI in it'
  );

  // The whole point, stated as an assertion rather than a comment: the two
  // predicates disagree on real recorded input. Nothing upstream computes a
  // frontend predicate, so deleting or weakening Layer 3 in favour of
  // scan.targets would silently widen every mode onto backend diffs.
  assert.notDeepStrictEqual(
    targets,
    layer3,
    'scan.targets and Layer 3 agreed on this fixture — the non-equivalence this asserts has been lost'
  );

  // And it is scannability, not frontend-ness, that put them there: every
  // target is a .js file, which Layer 3 lists under negative cases.
  assert.ok(
    targets.every((t) => t.endsWith('.js')),
    'the recorded fixture is all-.js by construction; re-record it if that is no longer true'
  );
});

test('a non-scannable changed file is dropped from scan.targets', () => {
  // Recorded boundary: .md is outside Impeccable's SCANNABLE_EXT, so it
  // reaches changedFiles but not targets. Locks the two lists as genuinely
  // different sets rather than one being a rename of the other.
  const mdChanged = FROZEN.git.changedFiles.filter((f) => f.endsWith('.md'));
  assert.ok(mdChanged.length > 0, 'the fixture must include a non-scannable changed file');
  for (const f of mdChanged) {
    assert.ok(!FROZEN.scan.targets.includes(f), `${f} is not scannable and must not appear in scan.targets`);
  }
});

test('the Layer 3 rules replayed above still match frontend-detection.md', () => {
  const doc = fs.readFileSync(DETECTION_DOC, 'utf8');
  const section = (heading) => {
    const start = doc.indexOf(heading);
    assert.notStrictEqual(start, -1, `frontend-detection.md no longer has a "${heading}" section`);
    const next = doc.indexOf('\n### ', start + heading.length);
    return doc.slice(start, next === -1 ? doc.length : next);
  };

  // Table rows look like `| `.tsx` | React/Preact TypeScript components |`.
  const extensions = [...section('### Trigger extensions').matchAll(/^\|\s*`(\.[a-z]+)`\s*\|/gm)].map((m) => m[1]);
  const segments = [...section('### Trigger path patterns').matchAll(/^\|\s*`(\/[a-z]+\/)`\s*\|/gm)].map((m) => m[1]);

  assert.deepStrictEqual(
    extensions.sort(),
    [...TRIGGER_EXTENSIONS].sort(),
    'frontend-detection.md\'s trigger-extension table and this test\'s copy of Layer 3 have diverged'
  );
  assert.deepStrictEqual(
    segments.sort(),
    [...TRIGGER_PATH_SEGMENTS].sort(),
    'frontend-detection.md\'s trigger-path table and this test\'s copy of Layer 3 have diverged'
  );
  assert.ok(
    !extensions.includes('.js') && !extensions.includes('.ts'),
    'Layer 3 gained .js/.ts as trigger extensions — that is the change the non-equivalence assertion above guards, ' +
      'and it must be a deliberate decision recorded in impeccable-plugin.md, not a silent table edit'
  );
});
