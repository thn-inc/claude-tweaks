// tests/impeccable-cli-contract.test.js
//
// Contract probe for the Impeccable CLI (a different artifact on a different
// version line from the Impeccable plugin — see
// tests/impeccable-plugin-contract.test.js for that one).
//
// The pin is NOT reimplemented here as a second literal. tools/upstream-drift/
// manifest.yml already owns the one pin for this artifact and the command
// that probes it (`checkVersion`) — a second hardcoded PINNED constant beside
// it is exactly the drift this file used to carry: this constant read
// '3.6.0' while manifest.yml's own entry read '3.5.0', and nothing ever
// compared the two (#1900).
//
// Resolution path (confirmed on this host, #2321): `npm list -g impeccable`
// is empty and no `impeccable` binary is on PATH, yet `npx --no-install
// impeccable --version` (manifest.yml's installed-probe) still resolves to a
// concrete version. There is no single "installed" copy to name — npx keeps
// its own cache under `~/.npm/_npx/<hash>/node_modules/impeccable`, one
// directory per distinct dependency-range it has ever resolved (this host
// carries entries for `^3.2.0`, `^3.6.0`, and `^4.1.0` simultaneously), and
// `--no-install` picks whichever cached entry npx's own unversioned-specifier
// resolution currently prefers. That resolution drifts across sessions
// independent of anything this repo controls — exactly the shared-host
// non-determinism `version-mode: floor` below (see manifest.yml's own
// comment on this dependency, added for #2277) exists to tolerate rather than
// chase.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const { spawnSync } = require('child_process');
const path = require('path');
const { checkVersion } = require('../tools/upstream-drift/checks');
const { loadManifest } = require('../tools/upstream-drift/manifest');

const REPO_ROOT = path.join(__dirname, '..');
const FIXTURES = path.join(__dirname, 'fixtures', 'impeccable-cli');
const CONTRACT_DOC = path.join(REPO_ROOT, 'plugin', 'skills', 'design-wrapper', 'impeccable-cli.md');

const manifest = loadManifest(path.join(REPO_ROOT, 'tools', 'upstream-drift', 'manifest.yml'));
const ENTRY = manifest.dependencies.find((d) => d.name === 'impeccable-cli');
const PINNED = ENTRY.pinned;

const versionCheck = checkVersion(ENTRY);

function detect(fixture) {
  const r = spawnSync(
    'npx',
    ['--no-install', 'impeccable', 'detect', '--json', '--no-config', '--no-design-system',
     path.join(FIXTURES, fixture)],
    { encoding: 'utf8' }
  );
  return { code: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

// Absent CLI skips; present-but-off-pin FAILS. A contract probe that silently
// declines to run reads exactly like one that passed — which is the defect this
// whole suite exists to catch, so it must not be this suite's own behaviour.
// Contributors without impeccable installed are unaffected.
const skip = versionCheck.status === 'absent' ? 'Impeccable CLI not installed' : false;

test('impeccable-cli.md pins the same version the drift manifest does', () => {
  const doc = fs.readFileSync(CONTRACT_DOC, 'utf8');
  const match = doc.match(/<!--\s*upstream-pin:\s*impeccable-cli@([^\s]+)\s*-->/);
  assert.ok(match, 'impeccable-cli.md must carry an <!-- upstream-pin: impeccable-cli@X.Y.Z --> comment');
  assert.strictEqual(
    match[1],
    PINNED,
    `impeccable-cli.md pins ${match[1]} but tools/upstream-drift/manifest.yml pins ${PINNED}. ` +
      'Two pins for one artifact is the drift this whole seam exists to prevent — move both together.'
  );
});

test('the installed CLI matches the pinned version', { skip }, () => {
  // Under `floor` only an OLDER install can land here, so the remedy is
  // "upgrade to at least the pin"; under `exact` either direction can, so the
  // remedy includes deliberately re-pinning.
  const suggestion = ENTRY['version-mode'] === 'floor'
    ? "Every assertion below describes the pinned floor version's (or a newer) behaviour, so they prove " +
      'nothing about this older install. Run `npm install -g impeccable@' + PINNED + '` or newer.'
    : "Every assertion below describes the pinned version's behaviour, so they prove " +
      'nothing about this one. Run `npm install -g impeccable@' + PINNED + '`, or ' +
      're-pin deliberately by re-recording the fixtures against the new version.';
  assert.strictEqual(versionCheck.status, 'ok', `${versionCheck.detail}. ${suggestion}`);
});

test('a warning finding exits 2 with JSON on stdout and nothing on stderr', { skip }, () => {
  const r = detect('warning.html');
  assert.strictEqual(r.code, 2, 'non-advisory findings must exit 2');
  assert.strictEqual(r.stderr, '', 'findings must not go to stderr (the 2.1.8 bug)');
  const findings = JSON.parse(r.stdout);
  assert.ok(Array.isArray(findings) && findings.length >= 1, 'stdout must carry a non-empty array');
  for (const f of findings) {
    assert.ok(typeof f.severity === 'string', `every finding needs a severity: ${f.antipattern}`);
  }
  assert.ok(findings.some((f) => f.severity === 'warning'), 'fixture must provoke a warning');
});

test('a clean file exits 0 with an empty array on stdout', { skip }, () => {
  const r = detect('clean.html');
  assert.strictEqual(r.code, 0);
  assert.strictEqual(r.stderr, '');
  assert.deepStrictEqual(JSON.parse(r.stdout), []);
});

test('every documented field is present on a finding', { skip }, () => {
  const [finding] = JSON.parse(detect('warning.html').stdout);
  for (const key of ['antipattern', 'name', 'description', 'severity', 'category', 'file', 'line', 'snippet']) {
    assert.ok(key in finding, `field '${key}' missing — impeccable-cli.md's schema table is stale`);
  }
  // advisory is optional — present only when true — so this must not assert
  // presence the way the required fields above do.
  assert.notStrictEqual(finding.advisory, true, 'the warning fixture must not carry advisory === true — this locks the classification axis');
});

test('an advisory-only finding exits 0 with advisory true on every finding', { skip }, () => {
  const r = detect('advisory.html');
  assert.strictEqual(r.code, 0, 'advisory findings must not fail the exit code');
  const findings = JSON.parse(r.stdout);
  assert.ok(Array.isArray(findings) && findings.length >= 1, 'stdout must carry a non-empty array');
  assert.ok(findings.every((f) => f.advisory === true), 'every finding in this fixture must carry advisory === true');
});
