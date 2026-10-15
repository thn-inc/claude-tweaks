// tests/bin-lib/hooks/session-residue.test.js — #2736: shared session-start
// residue detection, reused by session-start.js's own advisory banners AND
// `hooks.js check-session-residue` (wrap-up's Review Console resurfacing
// check). Mirrors tests/hooks-session-start.test.js's own fixture shape
// (mkRun/mkStagedFile) since both exercise the same underlying detection.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const residue = require('../../../plugin/bin/lib/hooks/session-residue');

function tmpProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-residue-'));
  fs.mkdirSync(path.join(dir, '.claude-tweaks', 'pipelines'), { recursive: true });
  return dir;
}
function mkRun(project, name, state) {
  const run = path.join(project, '.claude-tweaks', 'pipelines', name);
  fs.mkdirSync(run, { recursive: true });
  if (state) fs.writeFileSync(path.join(run, 'run-state.json'), JSON.stringify(state));
  return run;
}
function mkStagedFile(run, name, content) {
  const stagedDir = path.join(run, 'staged');
  fs.mkdirSync(stagedDir, { recursive: true });
  fs.writeFileSync(path.join(stagedDir, name), content || '{}');
}

test('collectStaleRuns: returns interrupted/active runs newest-first, capped at MAX_REPORTED', () => {
  const project = tmpProject();
  mkRun(project, '2026-07-01T090000-spec-1', { status: 'interrupted' });
  mkRun(project, '2026-07-02T090000-spec-2', { status: 'active' });
  mkRun(project, '2026-07-03T090000-spec-3', { status: 'interrupted' });
  mkRun(project, '2026-07-04T090000-spec-4', { status: 'active' });
  mkRun(project, '2026-06-30T090000-spec-0', { status: 'clean' });
  const entries = residue.collectStaleRuns(project);
  assert.strictEqual(entries.length, residue.MAX_REPORTED);
  assert.ok(entries[0].line.includes('spec-4'));
  assert.ok(entries[1].line.includes('spec-3'));
  assert.ok(entries[2].line.includes('spec-2'));
  assert.ok(!entries.some((e) => e.line.includes('spec-1')), 'oldest of 4 non-clean runs excluded by the cap');
  assert.ok(!entries.some((e) => e.line.includes('spec-0')), 'clean run excluded before the cap runs');
});

test('collectStaleRuns: an ordinary interrupted/active run renders the base status line, no shipped-unclosed embellishment', () => {
  const project = tmpProject();
  mkRun(project, '2026-07-01T090000-spec-1', { status: 'interrupted' });
  const entries = residue.collectStaleRuns(project, { pluginRoot: '/plugins/claude-tweaks' });
  assert.strictEqual(entries.length, 1);
  assert.strictEqual(entries[0].line, '- 2026-07-01T090000-spec-1 (status: interrupted)');
  assert.doesNotMatch(entries[0].line, /appears shipped/);
});

test('collectStaleRuns: exclude drops the named run dir from the result, even given a non-realpath\'d path', () => {
  const project = tmpProject();
  const own = mkRun(project, '2026-07-02T090000-spec-2', { status: 'active' });
  mkRun(project, '2026-07-01T090000-spec-1', { status: 'interrupted' });
  const entries = residue.collectStaleRuns(project, { exclude: own });
  assert.strictEqual(entries.length, 1);
  assert.match(entries[0].line, /spec-1/);
  assert.ok(!entries.some((e) => e.line.includes('spec-2')), "the excluded run's own dir must never appear");
});

test('collectStaleRuns: empty when no non-clean run dir exists', () => {
  const project = tmpProject();
  mkRun(project, '2026-06-30T090000-spec-0', { status: 'clean' });
  assert.deepStrictEqual(residue.collectStaleRuns(project), []);
});

test('collectApprovableStandalone: reports a clean tidy-standalone run with non-empty staged/', () => {
  const project = tmpProject();
  const standalone = mkRun(project, '2026-07-02T090000-tidy-standalone', { status: 'clean' });
  mkStagedFile(standalone, 'stale-close-1.json');
  const entries = residue.collectApprovableStandalone(project);
  assert.strictEqual(entries.length, 1);
  assert.match(entries[0].line, /2026-07-02T090000-tidy-standalone/);
  assert.match(entries[0].line, /\/claude-tweaks:tidy --approve/);
});

test('collectApprovableStandalone: reports a clean sweep-standalone run with non-empty staged/', () => {
  const project = tmpProject();
  const standalone = mkRun(project, '2026-07-02T090000-sweep-standalone', { status: 'clean' });
  mkStagedFile(standalone, 'stale-close-1.json');
  const entries = residue.collectApprovableStandalone(project);
  assert.strictEqual(entries.length, 1);
  assert.match(entries[0].line, /2026-07-02T090000-sweep-standalone/);
});

test('collectApprovableStandalone: omits a clean standalone run with an empty staged/', () => {
  const project = tmpProject();
  const standalone = mkRun(project, '2026-07-02T090000-tidy-standalone', { status: 'clean' });
  fs.mkdirSync(path.join(standalone, 'staged'), { recursive: true });
  assert.deepStrictEqual(residue.collectApprovableStandalone(project), []);
});

test('collectApprovableStandalone: omits a non-standalone clean run even with staged/ present', () => {
  const project = tmpProject();
  const run = mkRun(project, '2026-07-02T090000-spec-9', { status: 'clean' });
  mkStagedFile(run, 'review-1.patch');
  assert.deepStrictEqual(residue.collectApprovableStandalone(project), []);
});

test('collectApprovableStandalone: exclude drops the named run dir from the result', () => {
  const project = tmpProject();
  const own = mkRun(project, '2026-07-02T090000-tidy-standalone', { status: 'clean' });
  mkStagedFile(own, 'stale-close-1.json');
  const entries = residue.collectApprovableStandalone(project, { exclude: own });
  assert.deepStrictEqual(entries, []);
});
