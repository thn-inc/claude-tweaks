// tests/bin-lib/flow/manifest.test.js
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const manifestModule = require('../../../plugin/bin/lib/flow/manifest');
const { formatEntry } = require('../../../plugin/bin/lib/log-decision/append');
const {
  parseManifestYaml, serializeManifestYaml, readManifest, writeManifest,
  formatElapsedMs, transitionSpec, composeFixesBlock, readDeferredClosures,
  readSingleRecordDeferredClosure, manifestInit,
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
  // `manifestInit` (#3035) is the one CREATOR: it only ever writes `pending`
  // for ids not yet listed and never alters a listed spec, so it is not a
  // second status-mutation path.
  assert.deepEqual(
    Object.keys(manifestModule).sort(),
    ['VALID_STATUSES', 'composeFixesBlock', 'formatElapsedMs', 'manifestInit', 'parseManifestYaml', 'readDeferredClosures', 'readManifest', 'readSingleRecordDeferredClosure', 'serializeManifestYaml', 'transitionSpec', 'writeManifest'].sort(),
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

// --- Deferred-closure decisions (#2686): a spec can complete every other
// phase yet still carry a deliberate decision to withhold its own closing
// keyword — composeFixesBlock's new second argument must override `complete`
// for exactly that spec, and readDeferredClosures is what derives it from
// each spec's own decisions.md.

test('#2686: composeFixesBlock emits a deferred Refs line for a complete spec carrying a deferred-closure entry', () => {
  const deferred = new Map([['1997', 'AC not fully met, pending manual step']]);
  assert.deepEqual(
    composeFixesBlock([{ id: 1996, status: 'complete' }, { id: 1997, status: 'complete' }], deferred),
    ['Fixes #1996', 'Refs #1997 — deferred: AC not fully met, pending manual step'],
  );
});

test('#2686: composeFixesBlock without a deferredClosures argument behaves exactly as before', () => {
  assert.deepEqual(
    composeFixesBlock([{ id: 42, status: 'complete' }]),
    ['Fixes #42'],
  );
  assert.deepEqual(
    composeFixesBlock([{ id: 42, status: 'complete' }], new Map()),
    ['Fixes #42'],
  );
});

test('#4199: composeFixesBlock leaves a deferred reason with no closing keyword byte-identical', () => {
  const reason = 'Refs #2 pending; prefixes #5, resolved-ish, `code` and fixes-ish #6';
  assert.deepEqual(
    composeFixesBlock([{ id: 1, status: 'complete' }], new Map([['1', reason]])),
    [`Refs #1 — deferred: ${reason}`],
  );
});

test('#4199: composeFixesBlock neutralizes a closing keyword in a deferred reason', () => {
  assert.deepEqual(
    composeFixesBlock([{ id: 2724, status: 'complete' }], new Map([['2724', 'the pass that closes #2724 is pending']])),
    ['Refs #2724 — deferred: the pass that closes issue #2724 is pending'],
  );
});

function seedSpecDecisions(parentDir, specId, lines) {
  const dir = path.join(parentDir, `spec-${specId}`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'decisions.md'), lines.join('\n') + '\n');
}

// The exact shape bin/log-decision.js's formatEntry (its canonical writer)
// produces, in both call shapes a real caller might use — with a `--spec`
// location prefix, and without (falling back to `log-decision:`). Proves
// the regex matches real writer output, not just a hand-idealized line.
function deferredClosureLine({ specArg, id, reason }) {
  return formatEntry({
    status: 'AUTO',
    now: new Date('2026-10-01T14:02:18Z'),
    spec: specArg,
    text: `deferred-closure: spec #${id} closing keyword withheld (${reason})`,
    reversibility: 'high',
  });
}

test('#2686: readDeferredClosures finds a matching entry written via the real formatEntry (with and without --spec)', () => {
  const dir = tmpRunDir();
  seedSpecDecisions(dir, 1997, [
    '# Decisions',
    deferredClosureLine({ specArg: 1997, id: 1997, reason: 'AC not fully met, pending manual step' }),
  ]);
  const withSpecArg = readDeferredClosures(dir, [{ id: 1997, status: 'complete' }]);
  assert.equal(withSpecArg.get('1997'), 'AC not fully met, pending manual step');

  const dir2 = tmpRunDir();
  seedSpecDecisions(dir2, 1997, [
    deferredClosureLine({ specArg: undefined, id: 1997, reason: 'AC not fully met, pending manual step' }),
  ]);
  const withoutSpecArg = readDeferredClosures(dir2, [{ id: 1997, status: 'complete' }]);
  assert.equal(withoutSpecArg.get('1997'), 'AC not fully met, pending manual step');
});

test('#2686: readDeferredClosures ignores specs with no entry, no decisions.md, or a non-matching id', () => {
  const dir = tmpRunDir();
  seedSpecDecisions(dir, 42, ['- AUTO 09:00:00 — some unrelated decision. Reversibility: n/a.']);
  seedSpecDecisions(dir, 7, [
    deferredClosureLine({ specArg: 7, id: 9, reason: 'wrong spec' }),
  ]);
  const result = readDeferredClosures(dir, [
    { id: 42, status: 'complete' }, // no deferred-closure line
    { id: 7, status: 'complete' }, // line names a different spec id
    { id: 99, status: 'complete' }, // no spec-99/ directory at all
  ]);
  assert.equal(result.size, 0);
});

test('#2686: readDeferredClosures handles an empty/missing specs list', () => {
  const dir = tmpRunDir();
  assert.deepEqual(readDeferredClosures(dir, []), new Map());
  assert.deepEqual(readDeferredClosures(dir, undefined), new Map());
});

// --- readSingleRecordDeferredClosure (#3136): the single-record counterpart
// to readDeferredClosures — a run with no bundle manifest.yml logs its own
// deferred-closure entry to the run's own top-level decisions.md (never a
// spec-{id}/ subdirectory, since there is no sibling spec to namespace
// against), and composeFixesBlock must be able to consume that same
// reason string via a one-entry Map, exactly as the bundle path already does.

function seedTopLevelDecisions(dir, lines) {
  fs.writeFileSync(path.join(dir, 'decisions.md'), lines.join('\n') + '\n');
}

test('#3136: readSingleRecordDeferredClosure finds a matching entry written via the real formatEntry (with and without --spec)', () => {
  const dir = tmpRunDir();
  seedTopLevelDecisions(dir, [
    '# Decisions',
    deferredClosureLine({ specArg: 1350, id: 1350, reason: 'AC not fully met, pending manual step' }),
  ]);
  assert.equal(readSingleRecordDeferredClosure(dir, 1350), 'AC not fully met, pending manual step');

  const dir2 = tmpRunDir();
  seedTopLevelDecisions(dir2, [
    deferredClosureLine({ specArg: undefined, id: 1350, reason: 'AC not fully met, pending manual step' }),
  ]);
  assert.equal(readSingleRecordDeferredClosure(dir2, 1350), 'AC not fully met, pending manual step');
});

test('#3136: readSingleRecordDeferredClosure returns undefined for no entry, no decisions.md, or a non-matching id', () => {
  const dir = tmpRunDir();
  seedTopLevelDecisions(dir, ['- AUTO 09:00:00 — some unrelated decision. Reversibility: n/a.']);
  assert.equal(readSingleRecordDeferredClosure(dir, 42), undefined);

  const dir2 = tmpRunDir();
  seedTopLevelDecisions(dir2, [deferredClosureLine({ specArg: undefined, id: 9, reason: 'wrong record' })]);
  assert.equal(readSingleRecordDeferredClosure(dir2, 42), undefined);

  const dir3 = tmpRunDir(); // no decisions.md at all
  assert.equal(readSingleRecordDeferredClosure(dir3, 42), undefined);
});

test('#3136: composeFixesBlock consumes readSingleRecordDeferredClosure output for a manifest-less run', () => {
  const dir = tmpRunDir();
  seedTopLevelDecisions(dir, [
    deferredClosureLine({ specArg: undefined, id: 1350, reason: 'AC not fully met, pending manual step' }),
  ]);
  const reason = readSingleRecordDeferredClosure(dir, 1350);
  const deferred = reason !== undefined ? new Map([[String(1350), reason]]) : new Map();
  assert.deepEqual(
    composeFixesBlock([{ id: 1350, status: 'complete' }], deferred),
    ['Refs #1350 — deferred: AC not fully met, pending manual step'],
  );

  const dirNoEntry = tmpRunDir();
  const noReason = readSingleRecordDeferredClosure(dirNoEntry, 42);
  const emptyDeferred = noReason !== undefined ? new Map([[String(42), noReason]]) : new Map();
  assert.deepEqual(
    composeFixesBlock([{ id: 42, status: 'complete' }], emptyDeferred),
    ['Fixes #42'],
  );
});

// ---- manifestInit (#3035) ----

test('#3035: manifestInit then transitionSpec works on an empty parent dir (the first spec-status no longer refuses no-manifest)', () => {
  const dir = tmpRunDir(); // empty — no manifest.yml
  const init = manifestInit({ runDir: dir, specs: ['157', '159'], parent: '.claude-tweaks/pipelines/x/' });
  assert.equal(init.ok, true);
  assert.deepEqual(init.added, [157, 159]);

  const onDisk = readManifest(dir);
  assert.equal(onDisk.multispec.parent, '.claude-tweaks/pipelines/x/');
  assert.deepEqual(
    onDisk.multispec.specs,
    [{ id: 157, status: 'pending', subdir: 'spec-157/' }, { id: 159, status: 'pending', subdir: 'spec-159/' }],
  );

  const r = transitionSpec({ runDir: dir, specId: 159, status: 'running', phase: 'build', now: new Date('2026-01-01T00:00:00.000Z') });
  assert.equal(r.ok, true);
  assert.equal(r.banner, '## Flow: Running build (2/2) — spec #159');
});

test('#3035: manifestInit on an existing manifest keeps every spec\'s status, startedAt and phases[] and appends only new ids', () => {
  const dir = tmpRunDir();
  manifestInit({ runDir: dir, specs: ['1', '2'] });
  transitionSpec({ runDir: dir, specId: 1, status: 'running', phase: 'build', now: new Date('2026-01-01T00:00:00.000Z') });
  transitionSpec({ runDir: dir, specId: 1, status: 'complete', phase: 'wrap-up', now: new Date('2026-01-01T00:10:00.000Z') });
  const before = readManifest(dir);
  assert.equal(before.multispec.specs[0].status, 'complete');
  assert.equal(before.multispec.specs[0].phases.length, 2);

  const again = manifestInit({ runDir: dir, specs: ['1', '2', '3'] });
  assert.equal(again.ok, true);
  assert.deepEqual(again.added, [3]);
  assert.deepEqual(again.existing, [1, 2]);

  const after = readManifest(dir);
  assert.deepEqual(after.multispec.specs.slice(0, 2), before.multispec.specs, 'listed specs are untouched');
  assert.deepEqual(after.multispec.specs[2], { id: 3, status: 'pending', subdir: 'spec-3/' });
  assert.equal(after.multispec.parent, before.multispec.parent, 'an existing manifest keeps its own parent');
});

test('#3035: manifestInit with nothing new does not rewrite the file; bad input and a corrupt manifest are refused', () => {
  const dir = tmpRunDir();
  assert.equal(manifestInit({ runDir: dir, specs: [] }).reason, 'no-specs');
  assert.equal(manifestInit({ runDir: dir, specs: ['a b'] }).reason, 'invalid-spec-id');
  assert.equal(fs.existsSync(path.join(dir, 'manifest.yml')), false, 'a refusal writes nothing');

  manifestInit({ runDir: dir, specs: ['5'] });
  const file = path.join(dir, 'manifest.yml');
  const old = new Date('2020-01-01T00:00:00.000Z');
  fs.utimesSync(file, old, old);
  assert.equal(manifestInit({ runDir: dir, specs: ['5', '5'] }).added.length, 0);
  assert.equal(fs.statSync(file).mtimeMs, old.getTime(), 'an all-existing re-run leaves the file alone');

  fs.writeFileSync(file, 'not a manifest\n');
  assert.equal(manifestInit({ runDir: dir, specs: ['5'] }).reason, 'unreadable-manifest');
  assert.equal(fs.readFileSync(file, 'utf8'), 'not a manifest\n', 'a corrupt manifest is never overwritten');
});

test('#3035: manifestInit preserves a legacy baseSha on an older manifest', () => {
  const dir = tmpRunDir();
  fs.writeFileSync(path.join(dir, 'manifest.yml'), 'multispec:\n  parent: x/\n  baseSha: f9b5ec84d6c462050ed6a40d640ae50b67f6ee36\n  specs:\n    - id: 1\n      status: pending\n      subdir: spec-1/\n');
  manifestInit({ runDir: dir, specs: ['1', '2'] });
  assert.equal(readManifest(dir).multispec.baseSha, 'f9b5ec84d6c462050ed6a40d640ae50b67f6ee36');
});
