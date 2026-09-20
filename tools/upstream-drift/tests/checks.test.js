'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const { checkVersion, checkAssertions, replayFixtures, checkContentPins, isContentPinned } = require('../checks');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'upstream-drift-checks-'));
}

function writeFile(root, relPath, content) {
  const full = path.join(root, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
  return full;
}

// Builds a plugin-cache-glob-shaped temp tree:
//   <root>/<slot>/impeccable/<dirVersion>/.claude-plugin/plugin.json
// with the given `fileVersion` written INSIDE plugin.json — deliberately
// separate from `dirVersion` so tests can prove the file content, not the
// directory name, is what gets read.
function writePluginCacheCandidate(root, slot, dirVersion, fileVersion) {
  writeFile(
    root,
    path.join(slot, 'impeccable', dirVersion, '.claude-plugin', 'plugin.json'),
    JSON.stringify({ version: fileVersion }),
  );
}

function globFor(root) {
  return path.join(root, '*', 'impeccable', '*', '.claude-plugin', 'plugin.json');
}

// ─── checkVersion ────────────────────────────────────────────────────────

test('checkVersion: ok when the command probe reports the pinned version', () => {
  const entry = {
    name: 'impeccable-cli',
    pinned: '3.5.0',
    'installed-probe': { type: 'command', run: 'irrelevant --version' },
  };
  const result = checkVersion(entry, { runCommand: () => '3.5.0' });
  assert.strictEqual(result.check, 'version');
  assert.strictEqual(result.status, 'ok');
  assert.deepStrictEqual(result.installed, ['3.5.0']);
});

test('checkVersion: breach names BOTH the installed and pinned version when they disagree', () => {
  const entry = {
    name: 'impeccable-cli',
    pinned: '3.5.0',
    'installed-probe': { type: 'command', run: 'irrelevant --version' },
  };
  const result = checkVersion(entry, { runCommand: () => '2.1.8' });
  assert.strictEqual(result.status, 'breach');
  assert.deepStrictEqual(result.installed, ['2.1.8']);
  assert.strictEqual(result.pinned, '3.5.0');
  assert.ok(result.detail.includes('2.1.8'), 'detail must name the installed version');
  assert.ok(result.detail.includes('3.5.0'), 'detail must name the pinned version');
});

test('checkVersion: absent (not breach) when the probe command does not exist', () => {
  const entry = {
    name: 'impeccable-cli',
    pinned: '3.5.0',
    'installed-probe': { type: 'command', run: 'this-command-truly-does-not-exist-xyz-98765 --version' },
  };
  const result = checkVersion(entry); // no override — exercises the real spawnSync path
  assert.strictEqual(result.status, 'absent');
  assert.notStrictEqual(result.status, 'breach');
  assert.deepStrictEqual(result.installed, []);
});

test('checkVersion: absent when the command probe exits non-zero with output', () => {
  const entry = {
    name: 'x',
    pinned: '1.0.0',
    'installed-probe': { type: 'command', run: 'node -e "console.log(1); process.exit(1)"' },
  };
  const result = checkVersion(entry);
  assert.strictEqual(result.status, 'absent');
});

test('checkVersion: plugin-cache-glob resolving multiple installed versions reports ok when one matches pinned', () => {
  const root = tmpDir();
  writePluginCacheCandidate(root, 'slotA', '2.1.8', '2.1.8');
  writePluginCacheCandidate(root, 'slotB', '3.5.0', '3.5.0');
  const entry = {
    name: 'impeccable-plugin',
    pinned: '3.5.0',
    'installed-probe': { type: 'plugin-cache-glob', glob: globFor(root) },
  };
  const result = checkVersion(entry);
  assert.strictEqual(result.status, 'ok');
  assert.deepStrictEqual([...result.installed].sort(), ['2.1.8', '3.5.0']);
});

test('checkVersion: plugin-cache-glob reads each candidate\'s own version field, not the directory name', () => {
  const root = tmpDir();
  // Directory segment says "1.0.0"; the file itself says "3.5.0". If the
  // implementation regressed to trusting the directory name it would report
  // installed=['1.0.0'] and status 'breach' against pinned 3.5.0.
  writePluginCacheCandidate(root, 'slotA', '1.0.0', '3.5.0');
  const entry = {
    name: 'impeccable-plugin',
    pinned: '3.5.0',
    'installed-probe': { type: 'plugin-cache-glob', glob: globFor(root) },
  };
  const result = checkVersion(entry);
  assert.deepStrictEqual(result.installed, ['3.5.0']);
  assert.ok(!result.installed.includes('1.0.0'), 'must not report the directory-name version');
  assert.strictEqual(result.status, 'ok');
});

test('checkVersion: plugin-cache-glob is absent when the glob matches nothing', () => {
  const root = tmpDir();
  const entry = {
    name: 'impeccable-plugin',
    pinned: '3.5.0',
    'installed-probe': { type: 'plugin-cache-glob', glob: globFor(root) },
  };
  const result = checkVersion(entry);
  assert.strictEqual(result.status, 'absent');
  assert.deepStrictEqual(result.installed, []);
});

// ─── checkAssertions ─────────────────────────────────────────────────────

test('checkAssertions: ok when the literal is present in the resolved file', () => {
  const root = tmpDir();
  writeFile(root, 'cli/engine/cli/main.mjs', "before\nprocess.stdout.write(formatFindings(x))\nafter\n");
  const entry = {
    name: 'impeccable-cli',
    assertions: [
      { file: 'plugin/skills/design-wrapper/impeccable-cli.md', claims: 'writes findings to stdout', 'upstream-path': 'cli/engine/cli/main.mjs', 'must-match': 'process.stdout.write(formatFindings' },
    ],
  };
  const result = checkAssertions(entry, { root });
  assert.strictEqual(result.status, 'ok');
  assert.strictEqual(result.results.length, 1);
  assert.strictEqual(result.results[0].status, 'ok');
  assert.strictEqual(result.results[0].upstreamPath, 'cli/engine/cli/main.mjs');
});

test('checkAssertions: unmatched when the file exists but no longer contains the literal', () => {
  const root = tmpDir();
  writeFile(root, 'cli/engine/cli/main.mjs', "process.stdout.write(somethingElse)\n");
  const entry = {
    name: 'impeccable-cli',
    assertions: [
      { file: 'x.md', claims: 'y', 'upstream-path': 'cli/engine/cli/main.mjs', 'must-match': 'process.stdout.write(formatFindings' },
    ],
  };
  const result = checkAssertions(entry, { root });
  assert.strictEqual(result.status, 'drift');
  assert.strictEqual(result.results[0].status, 'unmatched');
});

test('checkAssertions: missing-file when the upstream-path does not exist under the resolved root', () => {
  const root = tmpDir();
  const entry = {
    name: 'impeccable-cli',
    assertions: [
      { file: 'x.md', claims: 'y', 'upstream-path': 'cli/does/not/exist.mjs', 'must-match': 'anything' },
    ],
  };
  const result = checkAssertions(entry, { root });
  assert.strictEqual(result.status, 'drift');
  assert.strictEqual(result.results[0].status, 'missing-file');
});

test('checkAssertions: missing-file and unmatched are NOT collapsed into one status', () => {
  const root = tmpDir();
  writeFile(root, 'present-but-stale.mjs', 'the old literal is gone now');
  const entry = {
    name: 'impeccable-cli',
    assertions: [
      { file: 'a.md', claims: 'a', 'upstream-path': 'present-but-stale.mjs', 'must-match': 'the new literal' },
      { file: 'b.md', claims: 'b', 'upstream-path': 'nowhere.mjs', 'must-match': 'anything' },
    ],
  };
  const result = checkAssertions(entry, { root });
  assert.strictEqual(result.results[0].status, 'unmatched');
  assert.strictEqual(result.results[1].status, 'missing-file');
  assert.notStrictEqual(result.results[0].status, result.results[1].status);
  assert.strictEqual(result.status, 'drift');
});

test('checkAssertions: skipped (assertions not marked failed) when the root cannot be resolved', () => {
  const entry = {
    name: 'impeccable-plugin',
    pinned: '3.5.0',
    'installed-probe': { type: 'plugin-cache-glob', glob: globFor(tmpDir()) }, // matches nothing
    assertions: [
      { file: 'a.md', claims: 'a', 'upstream-path': 'skills/impeccable/SKILL.md', 'must-match': 'polish [target]' },
    ],
  };
  const result = checkAssertions(entry);
  assert.strictEqual(result.status, 'skipped');
  assert.deepStrictEqual(result.results, []);
  assert.ok(result.detail && result.detail.length > 0);
});

test('checkAssertions: must-match containing regex metacharacters matches as a LITERAL substring', () => {
  const root = tmpDir();
  writeFile(root, 'skills/impeccable/SKILL.md', 'Commands include: polish [target] and shape [feature]\n');
  const entry = {
    name: 'impeccable-plugin',
    assertions: [
      { file: 'plugin/skills/design-wrapper/command-map.md', claims: 'exposes a polish command', 'upstream-path': 'skills/impeccable/SKILL.md', 'must-match': 'polish [target]' },
    ],
  };
  const result = checkAssertions(entry, { root });
  assert.strictEqual(result.status, 'ok');
  assert.strictEqual(result.results[0].status, 'ok');
});

// ─── replayFixtures ──────────────────────────────────────────────────────

test('replayFixtures: ok on a matching fixture', () => {
  const entry = {
    name: 'impeccable-cli',
    fixtures: [
      { run: 'node -e "process.stdout.write(JSON.stringify([{a:1,b:2}]))"', expect: { exit: 0, stream: 'stdout', keys: ['a', 'b'] } },
    ],
  };
  const result = replayFixtures(entry);
  assert.strictEqual(result.status, 'ok');
  assert.strictEqual(result.results[0].status, 'ok');
});

test('replayFixtures: mismatch when the JSON payload lands on stderr instead of the expected stdout, and the detail names stderr', () => {
  const entry = {
    name: 'impeccable-cli',
    fixtures: [
      { run: 'node -e "process.stderr.write(JSON.stringify([{a:1}]));process.exit(0)"', expect: { exit: 0, stream: 'stdout', keys: ['a'] } },
    ],
  };
  const result = replayFixtures(entry);
  assert.strictEqual(result.status, 'mismatch');
  assert.strictEqual(result.results[0].status, 'mismatch');
  assert.ok(result.results[0].detail.includes('stderr'), `detail must name stderr, got: ${result.results[0].detail}`);
});

test('replayFixtures: mismatch on a wrong exit code', () => {
  const entry = {
    name: 'impeccable-cli',
    fixtures: [
      { run: 'node -e "process.exit(3)"', expect: { exit: 0, stream: 'stdout', keys: [] } },
    ],
  };
  const result = replayFixtures(entry);
  assert.strictEqual(result.status, 'mismatch');
  assert.strictEqual(result.results[0].observed.exit, 3);
});

test('replayFixtures: mismatch on a missing key', () => {
  const entry = {
    name: 'impeccable-cli',
    fixtures: [
      { run: 'node -e "process.stdout.write(JSON.stringify([{a:1}]))"', expect: { exit: 0, stream: 'stdout', keys: ['a', 'b'] } },
    ],
  };
  const result = replayFixtures(entry);
  assert.strictEqual(result.status, 'mismatch');
  assert.ok(result.results[0].detail.includes('b'), `detail must name the missing key, got: ${result.results[0].detail}`);
});

test('replayFixtures: ok for keys: [] (shape not inspected)', () => {
  const entry = {
    name: 'impeccable-cli',
    fixtures: [
      { run: 'node -e "process.stdout.write(\'[]\')"', expect: { exit: 0, stream: 'stdout', keys: [] } },
    ],
  };
  const result = replayFixtures(entry);
  assert.strictEqual(result.status, 'ok');
});

test('replayFixtures: ok and empty results for fixtures: []', () => {
  const entry = { name: 'impeccable-plugin', fixtures: [] };
  const result = replayFixtures(entry);
  assert.strictEqual(result.status, 'ok');
  assert.deepStrictEqual(result.results, []);
});

// ─── never-prints guard ──────────────────────────────────────────────────

test('checks.js never calls console.* — rendering belongs to a later module', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'checks.js'), 'utf8');
  assert.ok(!/console\s*\./.test(source), 'checks.js must not call any console.* method');
});

// ─── C1: expect.stream is matched EXACTLY, never falls back to stdout ───

test('C1: expect.stream "Stderr" (wrong case) with the payload actually on stdout is a mismatch naming the bad value, not a silent stdout fallback', () => {
  const entry = {
    name: 'impeccable-cli',
    fixtures: [
      { run: 'node -e "process.stdout.write(JSON.stringify([{a:1}]))"', expect: { exit: 0, stream: 'Stderr', keys: ['a'] } },
    ],
  };
  const result = replayFixtures(entry);
  assert.strictEqual(result.status, 'mismatch');
  assert.strictEqual(result.results[0].status, 'mismatch');
  assert.ok(result.results[0].detail.includes('Stderr'), `detail must name the bad value, got: ${result.results[0].detail}`);
});

test('C1: expect.stream "stderr " (trailing space) is a mismatch, not treated as valid stderr', () => {
  const entry = {
    name: 'impeccable-cli',
    fixtures: [
      { run: 'node -e "process.stderr.write(JSON.stringify([{a:1}]));process.exit(0)"', expect: { exit: 0, stream: 'stderr ', keys: ['a'] } },
    ],
  };
  const result = replayFixtures(entry);
  assert.strictEqual(result.status, 'mismatch');
  assert.ok(result.results[0].detail.includes('stderr '), `detail must name the bad value, got: ${result.results[0].detail}`);
});

// ─── C2: version comparison normalizes a single leading v/V ────────────

test('C2: a probe reporting "v3.5.0" against pinned "3.5.0" is ok, not a false breach', () => {
  const entry = {
    name: 'impeccable-cli',
    pinned: '3.5.0',
    'installed-probe': { type: 'command', run: 'irrelevant --version' },
  };
  const result = checkVersion(entry, { runCommand: () => 'v3.5.0' });
  assert.strictEqual(result.status, 'ok');
  // The ORIGINAL, un-normalized string is preserved in `installed` and `detail`.
  assert.deepStrictEqual(result.installed, ['v3.5.0']);
  assert.ok(result.detail.includes('v3.5.0'), `detail must keep the original value, got: ${result.detail}`);
});

test('C2: a pinned value with a leading "V" matches an installed value with no leading v', () => {
  const entry = {
    name: 'impeccable-cli',
    pinned: 'V3.5.0',
    'installed-probe': { type: 'command', run: 'irrelevant --version' },
  };
  const result = checkVersion(entry, { runCommand: () => '3.5.0' });
  assert.strictEqual(result.status, 'ok');
  assert.strictEqual(result.pinned, 'V3.5.0', 'pinned must stay un-normalized in the result');
});

test('C2: a genuinely different version (beyond the leading v/V) still breaches', () => {
  const entry = {
    name: 'impeccable-cli',
    pinned: '3.5.0',
    'installed-probe': { type: 'command', run: 'irrelevant --version' },
  };
  const result = checkVersion(entry, { runCommand: () => 'v2.1.8' });
  assert.strictEqual(result.status, 'breach');
});

// ─── #2277: version-mode: floor ────────────────────────────────────────────

// Every case below probes the same entry against the same pin; only the
// version-mode (omitted entirely for the default-mode case) and the version
// the probe reports vary.
function versionModeEntry(versionMode) {
  const entry = {
    name: 'impeccable-cli',
    pinned: '3.6.0',
    'installed-probe': { type: 'command', run: 'irrelevant --version' },
  };
  if (versionMode) entry['version-mode'] = versionMode;
  return entry;
}

test('floor: an installed version newer than pinned is ok, not a breach', () => {
  const result = checkVersion(versionModeEntry('floor'), { runCommand: () => '4.1.0' });
  assert.strictEqual(result.status, 'ok');
  assert.ok(result.detail.includes('minimum'), `detail should describe a minimum, got: ${result.detail}`);
});

test('floor: an installed version equal to pinned is ok', () => {
  const result = checkVersion(versionModeEntry('floor'), { runCommand: () => '3.6.0' });
  assert.strictEqual(result.status, 'ok');
});

test('floor: an installed version OLDER than pinned still breaches', () => {
  const result = checkVersion(versionModeEntry('floor'), { runCommand: () => '3.5.0' });
  assert.strictEqual(result.status, 'breach');
  assert.ok(result.detail.includes('minimum'), `detail should describe a minimum, got: ${result.detail}`);
});

test('floor: numeric component comparison, not lexical (3.10.0 beats 3.6.0)', () => {
  const result = checkVersion(versionModeEntry('floor'), { runCommand: () => '3.10.0' });
  assert.strictEqual(result.status, 'ok', 'a lexical compare would wrongly treat "3.10.0" as older than "3.6.0"');
});

test('floor: a leading v/V is still normalized away before comparing', () => {
  const result = checkVersion(versionModeEntry('floor'), { runCommand: () => 'v4.1.0' });
  assert.strictEqual(result.status, 'ok');
  assert.deepStrictEqual(result.installed, ['v4.1.0'], 'the original, un-normalized string is preserved');
});

test('an entry with no version-mode key defaults to exact — unaffected by floor logic', () => {
  const result = checkVersion(versionModeEntry(), { runCommand: () => '4.1.0' });
  assert.strictEqual(result.status, 'breach', 'default mode is still an exact match');
});

// ─── C3: checkAssertions inspects EVERY matching root, not just the first ─

test('C3: a second installed candidate at the pinned version whose content has drifted is inspected, not skipped', () => {
  const combined = tmpDir();
  // Two plugin-cache-glob candidates, both reporting the pinned version.
  writePluginCacheCandidate(combined, 'slotA', '3.5.0', '3.5.0');
  writePluginCacheCandidate(combined, 'slotB', '3.5.0', '3.5.0');
  // resolveRoots resolves each candidate's root as two path segments up from
  // its own plugin.json — i.e. <combined>/<slot>/impeccable/3.5.0.
  writeFile(combined, 'slotA/impeccable/3.5.0/skills/impeccable/SKILL.md', 'Commands include: polish [target]\n');
  // slotB is missing the cited literal entirely — the drift this test proves gets caught.
  writeFile(combined, 'slotB/impeccable/3.5.0/skills/impeccable/SKILL.md', 'Commands include: something else entirely\n');

  const entry = {
    name: 'impeccable-plugin',
    pinned: '3.5.0',
    'installed-probe': { type: 'plugin-cache-glob', glob: globFor(combined) },
    assertions: [
      { file: 'a.md', claims: 'exposes a polish command', 'upstream-path': 'skills/impeccable/SKILL.md', 'must-match': 'polish [target]' },
    ],
  };

  const result = checkAssertions(entry);
  assert.notStrictEqual(result.status, 'ok', 'a drifted second root must not be reported as ok');
  assert.strictEqual(result.results[0].status, 'unmatched');
  // Both roots were inspected — the array is not silently collapsed to one.
  assert.strictEqual(result.results[0].roots.length, 2);
  assert.ok(result.results[0].roots.some((r) => r.status === 'ok'));
  assert.ok(result.results[0].roots.some((r) => r.status === 'unmatched'));
});

test('C3: options.root, when given, still means exactly one root', () => {
  const root = tmpDir();
  writeFile(root, 'a.mjs', 'the literal');
  const entry = {
    name: 'impeccable-cli',
    assertions: [{ file: 'x.md', claims: 'y', 'upstream-path': 'a.mjs', 'must-match': 'the literal' }],
  };
  const result = checkAssertions(entry, { root });
  assert.strictEqual(result.results[0].status, 'ok');
  assert.strictEqual(result.results[0].roots.length, 1);
});

// ─── C4: a plugin.json with a malformed version is surfaced, not "absent" ─

test('C4: a sole candidate whose plugin.json has a NUMBER version is coerced to its string form and reported as breach, not absent', () => {
  const root = tmpDir();
  writeFile(root, path.join('slotA', 'impeccable', '3.5', '.claude-plugin', 'plugin.json'), JSON.stringify({ version: 3.5 }));
  const entry = {
    name: 'impeccable-plugin',
    pinned: '3.5.0',
    'installed-probe': { type: 'plugin-cache-glob', glob: globFor(root) },
  };
  const result = checkVersion(entry);
  assert.notStrictEqual(result.status, 'absent');
  assert.strictEqual(result.status, 'breach');
  assert.deepStrictEqual(result.installed, ['3.5']);
});

test('C4: a candidate whose plugin.json has an unusable (non-string, non-number) version is surfaced as malformed, not silently dropped', () => {
  const root = tmpDir();
  writeFile(root, path.join('slotA', 'impeccable', 'x', '.claude-plugin', 'plugin.json'), JSON.stringify({ version: { weird: true } }));
  const entry = {
    name: 'impeccable-plugin',
    pinned: '3.5.0',
    'installed-probe': { type: 'plugin-cache-glob', glob: globFor(root) },
  };
  const result = checkVersion(entry);
  assert.strictEqual(result.status, 'absent');
  assert.strictEqual(result.installed.length, 0);
  assert.strictEqual(result.malformed.length, 1, 'the malformed candidate must be surfaced, not discarded');
  assert.ok(result.detail.includes('unusable'), `detail must mention the malformed candidate, got: ${result.detail}`);
});

// ─── C6: an unreadable candidate directory surfaces distinctly from absent ─

test('C6: a candidate directory that exists but cannot be read (EACCES) surfaces an inspection failure distinct from "nothing installed"', (t) => {
  if (process.platform === 'win32') {
    t.skip('chmod-based permission denial is not meaningful on win32');
    return;
  }
  if (process.getuid && process.getuid() === 0) {
    t.skip('running as root bypasses directory permission checks');
    return;
  }
  const root = tmpDir();
  const lockedDir = path.join(root, 'locked');
  fs.mkdirSync(lockedDir);
  fs.chmodSync(lockedDir, 0o000);

  try {
    const entry = {
      name: 'impeccable-plugin',
      pinned: '3.5.0',
      'installed-probe': { type: 'plugin-cache-glob', glob: path.join(lockedDir, '*', 'impeccable', '*', '.claude-plugin', 'plugin.json') },
    };
    const result = checkVersion(entry);
    assert.strictEqual(result.status, 'absent');
    assert.strictEqual(result.inspectionFailures.length, 1, 'a permission-denied directory must surface as an inspection failure');
    assert.ok(result.detail.includes('could not be inspected') || result.detail.includes('inspected'), `detail must mention the inspection failure, got: ${result.detail}`);
  } finally {
    fs.chmodSync(lockedDir, 0o755);
  }
});

test('C6: a candidate directory that genuinely does not exist (ENOENT) is NOT reported as an inspection failure', () => {
  const root = tmpDir();
  const entry = {
    name: 'impeccable-plugin',
    pinned: '3.5.0',
    'installed-probe': { type: 'plugin-cache-glob', glob: globFor(root) }, // 'root/*' does not exist at all
  };
  const result = checkVersion(entry);
  assert.strictEqual(result.status, 'absent');
  assert.deepStrictEqual(result.inspectionFailures, [], 'a genuinely missing directory is "nothing there", not an inspection failure');
});

// ─── checkContentPins (`versioning: none` entry class) ──────────────────

const crypto = require('node:crypto');

function sha256Of(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function contentPinnedEntry(overrides = {}) {
  return {
    name: 'sample-skills',
    kind: 'skill-repo',
    pin: { commit: 'a'.repeat(40), versioning: 'none' },
    upstream: { repo: 'example/skills' },
    consumed: [{ path: 'skills/one/SKILL.md', sha256: sha256Of('# One\n') }],
    ...overrides,
  };
}

test('isContentPinned recognizes only pin.versioning === "none"', () => {
  assert.strictEqual(isContentPinned(contentPinnedEntry()), true);
  assert.strictEqual(isContentPinned({ name: 'x', pinned: '1.0.0' }), false);
  assert.strictEqual(isContentPinned({ name: 'x', pin: { commit: 'a'.repeat(40) } }), false);
  assert.strictEqual(isContentPinned(null), false);
});

test('checkContentPins reports ok when the fixture bytes hash to the pinned digest', () => {
  const root = tmpDir();
  writeFile(root, 'skills/one/SKILL.md', '# One\n');
  const result = checkContentPins(contentPinnedEntry(), { fixtureRoot: root });
  assert.strictEqual(result.check, 'content-pins');
  assert.strictEqual(result.status, 'ok');
  assert.strictEqual(result.results[0].status, 'ok');
  assert.strictEqual(result.results[0].observed, sha256Of('# One\n'));
});

test('checkContentPins reports mismatch when the pinned digest does not match the fixture — a corrupted pin fails loudly', () => {
  const root = tmpDir();
  writeFile(root, 'skills/one/SKILL.md', '# One\n');
  const entry = contentPinnedEntry();
  entry.consumed[0].sha256 = 'f'.repeat(64); // corrupted pin
  const result = checkContentPins(entry, { fixtureRoot: root });
  assert.strictEqual(result.status, 'mismatch');
  assert.strictEqual(result.results[0].status, 'mismatch');
  assert.ok(result.results[0].detail.includes('does not equal the pinned'));
});

test('checkContentPins reports mismatch when a tampered fixture no longer hashes to the pin', () => {
  const root = tmpDir();
  writeFile(root, 'skills/one/SKILL.md', '# One — tampered\n');
  const result = checkContentPins(contentPinnedEntry(), { fixtureRoot: root });
  assert.strictEqual(result.status, 'mismatch');
});

test('checkContentPins reports a missing fixture distinctly from a hash mismatch', () => {
  const root = tmpDir();
  const result = checkContentPins(contentPinnedEntry(), { fixtureRoot: root });
  assert.strictEqual(result.status, 'mismatch');
  assert.strictEqual(result.results[0].status, 'missing-fixture');
  assert.strictEqual(result.results[0].observed, null);
});

test('conformance: the real emilkowalski-skills entry verifies against its committed fixtures, fully offline', () => {
  const { loadManifest } = require('../manifest');
  const manifest = loadManifest(path.join(__dirname, '..', 'manifest.yml'));
  const emil = manifest.dependencies.find((d) => d.name === 'emilkowalski-skills');
  assert.ok(emil, 'emilkowalski-skills entry exists');
  const result = checkContentPins(emil); // default fixtureRoot: tools/upstream-drift/fixtures/emilkowalski-skills
  assert.strictEqual(result.status, 'ok', JSON.stringify(result.results, null, 2));
});
