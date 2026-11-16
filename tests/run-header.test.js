'use strict';
// Unit tests for plugin/bin/lib/run-header.js (#3974): the one resolver for where a
// run's materialized spec header lives — live, or archived after wrap-up's move.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  PIPELINES_REL, runRelDirs, headerRelPaths, headerPathspecs,
  archivedRunDir, headerFileCandidates, listHeaderDirs,
} = require('../plugin/bin/lib/run-header');

const P = '.claude-tweaks/pipelines';

test('PIPELINES_REL is the POSIX literal', () => {
  assert.equal(PIPELINES_REL, P);
});

test('runRelDirs returns [live, archived], optionally suffixed with specDir', () => {
  assert.deepEqual(runRelDirs('R'), [`${P}/R`, `${P}/archive/R`]);
  assert.deepEqual(runRelDirs('R', { specDir: 'spec-9' }), [`${P}/R/spec-9`, `${P}/archive/R/spec-9`]);
});

test('headerRelPaths: live flat, live nested, archived flat, archived nested', () => {
  assert.deepEqual(headerRelPaths('R', 7), [
    `${P}/R/work/7-spec.md`,
    `${P}/R/spec-7/work/7-spec.md`,
    `${P}/archive/R/work/7-spec.md`,
    `${P}/archive/R/spec-7/work/7-spec.md`,
  ]);
});

test('headerRelPaths: layout filters flat or nested', () => {
  const all = headerRelPaths('R', 7);
  assert.deepEqual(headerRelPaths('R', 7, { layout: 'nested' }), [all[1], all[3]]);
  assert.deepEqual(headerRelPaths('R', 7, { layout: 'flat' }), [all[0], all[2]]);
});

test('headerRelPaths: specDir pins the per-spec child run dir', () => {
  assert.deepEqual(headerRelPaths('R', 7, { specDir: 'spec-9' }), [
    `${P}/R/spec-9/work/7-spec.md`,
    `${P}/archive/R/spec-9/work/7-spec.md`,
  ]);
});

test('headerPathspecs: trailing wildcard on the spec-* pathspecs', () => {
  assert.deepEqual(headerPathspecs('R'), [
    `${P}/R/work`,
    `${P}/R/spec-*/work/*`,
    `${P}/archive/R/work`,
    `${P}/archive/R/spec-*/work/*`,
  ]);
  assert.deepEqual(headerPathspecs('R', { specDir: 'spec-9' }), [
    `${P}/R/spec-9/work/*`,
    `${P}/archive/R/spec-9/work/*`,
  ]);
});

test('archivedRunDir: run dir and per-spec child dir under pipelines', () => {
  assert.equal(
    archivedRunDir('/m/.claude-tweaks/pipelines/2026-11-16T020801-record-1'),
    '/m/.claude-tweaks/pipelines/archive/2026-11-16T020801-record-1',
  );
  assert.equal(
    archivedRunDir('/m/.claude-tweaks/pipelines/2026-11-16T020801-record-1/spec-4'),
    '/m/.claude-tweaks/pipelines/archive/2026-11-16T020801-record-1/spec-4',
  );
});

test('archivedRunDir: no archived dir is invented for other shapes', () => {
  assert.equal(archivedRunDir('/tmp/x/run'), null);
  assert.equal(archivedRunDir('/m/.claude-tweaks/pipelines/archive/R'), null);
  assert.equal(archivedRunDir('/m/.claude-tweaks/pipelines/not-a-run-id/spec-4'), null);
  assert.equal(archivedRunDir('/tmp/x/2026-11-16T020801-record-1/spec-4'), null);
});

test('archivedRunDir: win32 path module keeps backslashes', () => {
  assert.equal(
    archivedRunDir('C:\\m\\.claude-tweaks\\pipelines\\R', path.win32),
    'C:\\m\\.claude-tweaks\\pipelines\\archive\\R',
  );
});

test('AC7.1: precedence — live before archived, root by root', () => {
  const runDir = '/m/.claude-tweaks/pipelines/2026-11-16T020801-record-1';
  const mirror = '/w/.claude-tweaks/pipelines/2026-11-16T020801-record-1';
  const four = (d) => {
    const a = d.replace('/pipelines/', '/pipelines/archive/');
    return [
      `${d}/work/7-spec.md`, `${d}/spec-7/work/7-spec.md`,
      `${a}/work/7-spec.md`, `${a}/spec-7/work/7-spec.md`,
    ].map((p) => path.join(p));
  };
  assert.deepEqual(headerFileCandidates([runDir, mirror], 7), [...four(runDir), ...four(mirror)]);
});

test('headerFileCandidates: skips falsy entries and invents no archived path off pipelines', () => {
  assert.deepEqual(headerFileCandidates([null, '', '/tmp/x/run'], 3), [
    path.join('/tmp/x/run', 'work', '3-spec.md'),
    path.join('/tmp/x/run', 'spec-3', 'work', '3-spec.md'),
  ]);
});

test('listHeaderDirs: flat work then sorted spec-* dirs, live then archived', () => {
  const runDir = '/m/.claude-tweaks/pipelines/2026-11-16T020801-record-1';
  const readdir = () => ['spec-2', 'work', 'spec-10', 'spec-x'];
  const out = listHeaderDirs([runDir, null], { readdir });
  const arch = '/m/.claude-tweaks/pipelines/archive/2026-11-16T020801-record-1';
  const expected = [];
  for (const [base, location] of [[runDir, 'live'], [arch, 'archived']]) {
    expected.push({ dir: path.join(base, 'work'), location, specDir: null, specN: null });
    expected.push({ dir: path.join(base, 'spec-10', 'work'), location, specDir: 'spec-10', specN: 10 });
    expected.push({ dir: path.join(base, 'spec-2', 'work'), location, specDir: 'spec-2', specN: 2 });
    expected.push({ dir: path.join(base, 'spec-x', 'work'), location, specDir: 'spec-x', specN: null });
  }
  assert.deepEqual(out, expected);
});

test('listHeaderDirs: default readdir over an archived-only layout lists the archived work dir', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'run-header-'));
  try {
    const id = '2026-11-16T020801-record-1';
    const live = path.join(root, '.claude-tweaks', 'pipelines', id);
    const archived = path.join(root, '.claude-tweaks', 'pipelines', 'archive', id);
    fs.mkdirSync(path.join(archived, 'work'), { recursive: true });
    const out = listHeaderDirs([live]);
    assert.ok(out.some((e) => e.location === 'archived' && e.dir === path.join(archived, 'work') && e.specDir === null));
    assert.ok(out.some((e) => e.location === 'live' && e.dir === path.join(live, 'work')));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('listHeaderDirs: unreadable directories (default readdir) yield only the flat work dirs', () => {
  const runDir = path.join(os.tmpdir(), 'run-header-absent', '.claude-tweaks', 'pipelines', '2026-11-16T020801-record-1');
  const out = listHeaderDirs([runDir]);
  assert.deepEqual(out.map((e) => [e.location, e.specDir]), [['live', null], ['archived', null]]);
});
