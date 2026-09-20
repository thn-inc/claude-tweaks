// tests/bin-lib/flow/manifest.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const manifestModule = require('../../../plugin/bin/lib/flow/manifest');
const {
  parseManifestYaml, serializeManifestYaml, readManifest, writeManifest,
  formatElapsedMs, transitionSpec, composeFixesBlock,
} = manifestModule;

function tmpRunDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ct-manifest-'));
}

// The exact live shape found in a real run dir (no baseSha, no startedAt yet)
// — pinned so the parser is proven against ground truth, not a guess.
const LIVE_MANIFEST = `multispec:
  parent: .claude-tweaks/pipelines/2026-08-16T210742-spec-686-687-688-689-690-691-692-693/
  specs:
    - id: 686
      status: complete
      subdir: spec-686/
    - id: 687
      status: complete
      subdir: spec-687/
    - id: 690
      status: pending
      subdir: spec-690/
`;

test('parseManifestYaml reads the real live shape (id/status/subdir, no baseSha)', () => {
  const m = parseManifestYaml(LIVE_MANIFEST);
  assert.ok(m);
  assert.equal(m.multispec.parent, '.claude-tweaks/pipelines/2026-08-16T210742-spec-686-687-688-689-690-691-692-693/');
  assert.equal(m.multispec.baseSha, undefined);
  assert.deepEqual(m.multispec.specs.map((s) => s.id), [686, 687, 690]);
  assert.equal(m.multispec.specs[0].status, 'complete');
  assert.equal(m.multispec.specs[2].status, 'pending');
  assert.equal(m.multispec.specs[2].subdir, 'spec-690/');
});

test('parseManifestYaml reads baseSha and trailing comment when present', () => {
  const text = `multispec:
  parent: .claude-tweaks/pipelines/2026-05-16T143207-spec-157-159-160/
  baseSha: f9b5ec84d6c462050ed6a40d640ae50b67f6ee36   # omitted when MULTISPEC_CURATION_DEFER is unset
  specs:
    - id: 157
      status: complete    # pending | running | complete | failed | not-run
      subdir: spec-157/
`;
  const m = parseManifestYaml(text);
  assert.equal(m.multispec.baseSha, 'f9b5ec84d6c462050ed6a40d640ae50b67f6ee36');
  assert.equal(m.multispec.specs[0].status, 'complete');
});

test('parseManifestYaml returns null for a missing multispec root', () => {
  assert.equal(parseManifestYaml('foo: bar\n'), null);
  assert.equal(parseManifestYaml(''), null);
  assert.equal(parseManifestYaml(undefined), null);
});

test('serializeManifestYaml round-trips through parseManifestYaml', () => {
  const original = parseManifestYaml(LIVE_MANIFEST);
  const text = serializeManifestYaml(original);
  const reparsed = parseManifestYaml(text);
  assert.deepEqual(reparsed, original);
});

test('readManifest/writeManifest round-trip via the filesystem', () => {
  const dir = tmpRunDir();
  fs.writeFileSync(path.join(dir, 'manifest.yml'), LIVE_MANIFEST);
  const m = readManifest(dir);
  assert.equal(m.multispec.specs.length, 3);
  m.multispec.specs[0].status = 'failed';
  assert.equal(writeManifest(dir, m), true);
  const reread = readManifest(dir);
  assert.equal(reread.multispec.specs[0].status, 'failed');
});

test('readManifest returns null when manifest.yml does not exist', () => {
  const dir = tmpRunDir();
  assert.equal(readManifest(dir), null);
});

test('formatElapsedMs formats seconds, minutes, and hours compactly', () => {
  assert.equal(formatElapsedMs(45_000), '45s');
  assert.equal(formatElapsedMs(754_000), '12m34s');
  assert.equal(formatElapsedMs(3600_000 + 5 * 60_000), '1h05m');
  assert.equal(formatElapsedMs(-500), '0s');
  assert.equal(formatElapsedMs(NaN), '0s');
});

// --- transitionSpec: the coupling contract ---

function seedRunDir(specs) {
  const dir = tmpRunDir();
  const manifest = { multispec: { parent: 'x/', specs } };
  writeManifest(dir, manifest);
  return dir;
}

test('transitionSpec on a running transition writes status, sets startedAt once, and always returns a banner', () => {
  const dir = seedRunDir([
    { id: 157, status: 'pending', subdir: 'spec-157/' },
    { id: 159, status: 'pending', subdir: 'spec-159/' },
  ]);
  const r1 = transitionSpec({ runDir: dir, specId: 159, status: 'running', phase: 'build', now: new Date('2026-05-16T14:00:00.000Z') });
  assert.equal(r1.ok, true);
  assert.equal(r1.banner, '## Flow: Running build (2/2) — spec #159');
  assert.equal(r1.summaryLine, null);
  let onDisk = readManifest(dir);
  assert.equal(onDisk.multispec.specs[1].status, 'running');
  assert.equal(onDisk.multispec.specs[1].startedAt, '2026-05-16T14:00:00.000Z');

  // A second running transition (next phase) must not reset startedAt.
  const r2 = transitionSpec({ runDir: dir, specId: 159, status: 'running', phase: 'test', now: new Date('2026-05-16T14:10:00.000Z') });
  assert.equal(r2.ok, true);
  assert.equal(r2.banner, '## Flow: Running test (2/2) — spec #159');
  onDisk = readManifest(dir);
  assert.equal(onDisk.multispec.specs[1].startedAt, '2026-05-16T14:00:00.000Z', 'startedAt must be set on FIRST running transition only');
});

test('transitionSpec on complete emits the wrap-up-exit summary line with elapsed time and a deferred outcome', () => {
  const dir = seedRunDir([{ id: 159, status: 'pending', subdir: 'spec-159/' }]);
  transitionSpec({ runDir: dir, specId: 159, status: 'running', phase: 'build', now: new Date('2026-05-16T14:00:00.000Z') });
  const r = transitionSpec({ runDir: dir, specId: 159, status: 'complete', phase: 'wrap-up', now: new Date('2026-05-16T14:12:34.000Z') });
  assert.equal(r.ok, true);
  assert.equal(r.banner, '## Flow: Running wrap-up (1/1) — spec #159');
  assert.equal(r.summaryLine, 'spec #159: complete — deferred (12m34s)');
  assert.equal(readManifest(dir).multispec.specs[0].status, 'complete');
});

test('transitionSpec on failed also emits the summary line', () => {
  const dir = seedRunDir([{ id: 159, status: 'pending', subdir: 'spec-159/' }]);
  transitionSpec({ runDir: dir, specId: 159, status: 'running', phase: 'build', now: new Date('2026-05-16T14:00:00.000Z') });
  const r = transitionSpec({ runDir: dir, specId: 159, status: 'failed', phase: 'test', now: new Date('2026-05-16T14:03:00.000Z') });
  assert.equal(r.ok, true);
  assert.equal(r.summaryLine, 'spec #159: failed — deferred (3m00s)');
});

test('transitionSpec is the module\'s only status-mutation entry point, and every successful call returns a non-empty banner', () => {
  // Locks the module's public surface: `transitionSpec` is the one status
  // mutator. `readManifest`/`writeManifest` stay exported for test fixtures
  // and for the CLI's error-path checks, but no OTHER helper composes a
  // status write — the CLI (bin/hooks.js's `spec-status` subcommand, see
  // tests/hooks-spec-status.test.js) never calls anything but
  // transitionSpec, so the real entry point skills cite has exactly one
  // path from "write a status" to "produce a banner," and they are the
  // same call.
  assert.deepEqual(
    Object.keys(manifestModule).sort(),
    ['VALID_STATUSES', 'composeFixesBlock', 'formatElapsedMs', 'parseManifestYaml', 'readManifest', 'serializeManifestYaml', 'transitionSpec', 'writeManifest'].sort(),
  );

  const dir = seedRunDir([{ id: 42, status: 'pending', subdir: 'spec-42/' }]);
  const r = transitionSpec({ runDir: dir, specId: 42, status: 'running', phase: 'build', now: new Date('2026-01-01T00:00:00.000Z') });
  assert.equal(r.ok, true);
  assert.ok(r.banner && r.banner.length > 0);
  assert.equal(readManifest(dir).multispec.specs[0].status, 'running', 'the write happened');
});

test('transitionSpec fails without writing when the manifest is missing, the spec is unknown, or status/phase is invalid', () => {
  const dir = tmpRunDir(); // no manifest.yml at all
  const rNoManifest = transitionSpec({ runDir: dir, specId: 1, status: 'running', phase: 'build' });
  assert.equal(rNoManifest.ok, false);
  assert.equal(rNoManifest.reason, 'no-manifest');

  const seeded = seedRunDir([{ id: 42, status: 'pending', subdir: 'spec-42/' }]);
  const rUnknown = transitionSpec({ runDir: seeded, specId: 999, status: 'running', phase: 'build' });
  assert.equal(rUnknown.ok, false);
  assert.equal(rUnknown.reason, 'unknown-spec');

  const rBadStatus = transitionSpec({ runDir: seeded, specId: 42, status: 'bogus', phase: 'build' });
  assert.equal(rBadStatus.ok, false);
  assert.equal(rBadStatus.reason, 'invalid-status');

  const rNoPhase = transitionSpec({ runDir: seeded, specId: 42, status: 'running', phase: '' });
  assert.equal(rNoPhase.ok, false);
  assert.equal(rNoPhase.reason, 'missing-phase');

  // None of the failed calls touched the manifest.
  assert.equal(readManifest(seeded).multispec.specs[0].status, 'pending');
});

// #1928 AC2: every transition persists the phase and appends to phases[].
test('#1928: transitionSpec persists phase and appends {phase, status, at} to phases[]', () => {
  const runDir = tmpRunDir();
  writeManifest(runDir, parseManifestYaml(LIVE_MANIFEST));
  const t1 = transitionSpec({ runDir, specId: 690, status: 'running', phase: 'build', now: '2026-09-06T10:00:00.000Z' });
  assert.equal(t1.ok, true);
  const t2 = transitionSpec({ runDir, specId: 690, status: 'complete', phase: 'wrap-up', now: '2026-09-06T11:30:00.000Z' });
  assert.equal(t2.ok, true);
  const spec = readManifest(runDir).multispec.specs.find((s) => String(s.id) === '690');
  assert.equal(spec.phase, 'wrap-up');
  assert.deepEqual(spec.phases, [
    { phase: 'build', status: 'running', at: '2026-09-06T10:00:00.000Z' },
    { phase: 'wrap-up', status: 'complete', at: '2026-09-06T11:30:00.000Z' },
  ]);
});

test('#1928: phases[] round-trips through serialize → parse byte-for-byte', () => {
  const m = parseManifestYaml(LIVE_MANIFEST);
  const spec = m.multispec.specs[0];
  spec.phase = 'review';
  spec.phases = [
    { phase: 'build', status: 'running', at: '2026-09-06T10:00:00.000Z' },
    { phase: 'review', status: 'running', at: '2026-09-06T10:40:00.000Z' },
  ];
  const text = serializeManifestYaml(m);
  assert.deepEqual(parseManifestYaml(text), m);
  assert.equal(serializeManifestYaml(parseManifestYaml(text)), text);
});

test('#1928: a manifest without phases[] still round-trips unchanged', () => {
  const m = parseManifestYaml(LIVE_MANIFEST);
  assert.equal(serializeManifestYaml(m), LIVE_MANIFEST.endsWith('\n') ? LIVE_MANIFEST : LIVE_MANIFEST + '\n');
});

// --- composeFixesBlock (#2015): a bundle PR's Fixes block must never close a
// not-run/failed spec on merge — this is the helper the pre-merge refresh
// (pr-checklist-refresh.md's "Pre-merge title/description refresh", split out of
// pr-early-run-lifecycle.md by #2002) calls.

test('#2015: composeFixesBlock emits Fixes for complete specs, Refs for a not-run spec, none for both on the same spec', () => {
  const lines = composeFixesBlock([
    { id: 1996, status: 'not-run' },
    { id: 1997, status: 'complete' },
  ]);
  assert.deepEqual(lines, [
    'Refs #1996 — not run/failed: not run',
    'Fixes #1997',
  ]);
  // Exactly one line per spec — never a Fixes AND a Refs line for the same id.
  assert.equal(lines.length, 2);
});

test('#2015: composeFixesBlock names the last attempted phase for a failed spec when known', () => {
  assert.deepEqual(
    composeFixesBlock([{ id: 42, status: 'failed', phase: 'test' }]),
    ['Refs #42 — not run/failed: failed at test'],
  );
  assert.deepEqual(
    composeFixesBlock([{ id: 42, status: 'failed' }]),
    ['Refs #42 — not run/failed: failed'],
  );
});

test('#2015: composeFixesBlock preserves manifest order and handles an empty/missing list', () => {
  assert.deepEqual(
    composeFixesBlock([{ id: 3, status: 'complete' }, { id: 1, status: 'complete' }, { id: 2, status: 'not-run' }]),
    ['Fixes #3', 'Fixes #1', 'Refs #2 — not run/failed: not run'],
  );
  assert.deepEqual(composeFixesBlock([]), []);
  assert.deepEqual(composeFixesBlock(undefined), []);
});
