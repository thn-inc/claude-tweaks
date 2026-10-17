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

test('#2783 collectStaleRuns: ad-hoc dirs never crowd a genuinely interrupted formal run out of the capped report', () => {
  const project = tmpProject();
  mkRun(project, '2026-10-01T000000-spec-9', { status: 'interrupted', sessionId: 'X', worktree: '/gone/a' });
  for (let i = 2; i <= 4; i++) mkRun(project, `2026-10-0${i}T000000-adhoc-standalone`, { status: 'active', sessionId: `S${i}`, worktree: `/gone/w${i}` });
  const lines = residue.collectStaleRuns(project).map((e) => e.line);
  assert.deepStrictEqual(lines, ['- 2026-10-01T000000-spec-9 (status: interrupted)']);
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

// #3370: closed and archived runs whose unattended Review Console left
// pending / keep-staged items no human has reviewed.
function mkConsole(runDir, items, extra) {
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'console.json'), JSON.stringify({ resolved: true, items, ...extra }));
}
function mkArchived(project, name) {
  return path.join(project, '.claude-tweaks', 'pipelines', 'archive', name);
}
const PENDING = (id) => ({ id, section: 'Pending review', resolution: 'pending', reason: 'unmapped-prefix' });
const CONTESTED = (id) => ({ id, section: 'Contested findings', resolution: 'keep-staged', reason: 'debate inconclusive' });

test('collectUnresolvedConsoles surfaces an archived run\'s unmapped-prefix and contested items with a paste-ready command', () => {
  const project = tmpProject();
  const run = mkArchived(project, '2026-10-16T210949-spec-2821');
  mkConsole(run, [PENDING('review-13-record.md'), CONTESTED('review-debate-deviation.md')]);
  mkStagedFile(run, 'review-13-record.md', 'x');
  mkStagedFile(run, 'review-debate-deviation.md', 'y');
  const entries = residue.collectUnresolvedConsoles(project, { pluginRoot: '/plugins/claude-tweaks' });
  assert.strictEqual(entries.length, 1);
  assert.strictEqual(entries[0].dir, run);
  const text = entries[0].lines.join('\n');
  assert.match(text, /review-13-record\.md/);
  assert.match(text, /review-debate-deviation\.md/);
  assert.ok(entries[0].lines.includes(`    cat "${path.join(run, 'staged', 'review-13-record.md')}"`));
  assert.ok(entries[0].lines.includes(`  mark reviewed: node "/plugins/claude-tweaks/bin/console-residue.js" --ack --run "${run}"`));
});

test('collectUnresolvedConsoles: acknowledged consoles are skipped', () => {
  const project = tmpProject();
  mkConsole(mkArchived(project, '2026-10-16T210949-spec-1'), [PENDING('a.md')], { residueAcknowledgedAt: '2026-10-17T00:00:00.000Z' });
  assert.deepStrictEqual(residue.collectUnresolvedConsoles(project, { pluginRoot: '/p' }), []);
});

test('collectUnresolvedConsoles: a run is kept for its unacknowledged console only', () => {
  const project = tmpProject();
  const run = mkArchived(project, '2026-10-16T210949-spec-1');
  mkConsole(run, [PENDING('acked-top.md')], { residueAcknowledgedAt: '2026-10-17T00:00:00.000Z' });
  mkConsole(path.join(run, 'spec-2'), [PENDING('open-sub.md')]);
  const entries = residue.collectUnresolvedConsoles(project, { pluginRoot: '/p' });
  assert.strictEqual(entries.length, 1);
  const text = entries[0].lines.join('\n');
  assert.match(text, /open-sub\.md/);
  assert.doesNotMatch(text, /acked-top\.md/);
});

test('collectUnresolvedConsoles: a clean un-archived run is surfaced too', () => {
  const project = tmpProject();
  const run = mkRun(project, '2026-10-16T210949-spec-3', { status: 'clean' });
  mkConsole(run, [PENDING('b.md')]);
  const entries = residue.collectUnresolvedConsoles(project, { pluginRoot: '/p' });
  assert.deepStrictEqual(entries.map((e) => e.dir), [run]);
});

test('collectUnresolvedConsoles: a non-clean top-level run is left to collectStaleRuns', () => {
  const project = tmpProject();
  const run = mkRun(project, '2026-10-16T210949-spec-3', { status: 'interrupted' });
  mkConsole(run, [PENDING('b.md')]);
  assert.deepStrictEqual(residue.collectUnresolvedConsoles(project, { pluginRoot: '/p' }), []);
});

test('collectUnresolvedConsoles: a basename in both the top level and archive/ is reported once, top-level dir preferred', () => {
  const project = tmpProject();
  const top = mkRun(project, '2026-10-16T210949-spec-4', { status: 'clean' });
  mkConsole(top, [PENDING('c.md')]);
  mkConsole(mkArchived(project, '2026-10-16T210949-spec-4'), [PENDING('c.md')]);
  const entries = residue.collectUnresolvedConsoles(project, { pluginRoot: '/p' });
  assert.deepStrictEqual(entries.map((e) => e.dir), [top]);
});

test('collectUnresolvedConsoles: top-level and archived runs merge newest-first by basename', () => {
  const project = tmpProject();
  const older = mkArchived(project, '2026-10-01T000000-spec-1');
  const newer = mkRun(project, '2026-10-05T000000-spec-2', { status: 'clean' });
  const newest = mkArchived(project, '2026-10-09T000000-spec-3');
  for (const d of [older, newer, newest]) mkConsole(d, [PENDING('d.md')]);
  const entries = residue.collectUnresolvedConsoles(project, { pluginRoot: '/p' });
  assert.deepStrictEqual(entries.map((e) => e.dir), [newest, newer, older]);
});

test('collectUnresolvedConsoles: non-run-id names under archive/ are ignored', () => {
  const project = tmpProject();
  mkConsole(mkArchived(project, 'not-a-run'), [PENDING('e.md')]);
  assert.deepStrictEqual(residue.collectUnresolvedConsoles(project, { pluginRoot: '/p' }), []);
});

test('collectUnresolvedConsoles: exclude drops the caller\'s own run', () => {
  const project = tmpProject();
  const own = mkArchived(project, '2026-10-16T210949-spec-5');
  mkConsole(own, [PENDING('f.md')]);
  assert.deepStrictEqual(residue.collectUnresolvedConsoles(project, { pluginRoot: '/p', exclude: own }), []);
});

test('collectUnresolvedConsoles: a missing archive/ and a run with no console.json yield nothing, never throw', () => {
  const project = tmpProject();
  mkRun(project, '2026-10-16T210949-spec-6', { status: 'clean' });
  assert.deepStrictEqual(residue.collectUnresolvedConsoles(project, { pluginRoot: '/p' }), []);
});

test('collectUnresolvedConsoles: stops reading once limit runs are kept', () => {
  const project = tmpProject();
  const names = [1, 2, 3, 4, 5, 6].map((n) => `2026-10-0${n}T000000-spec-${n}`);
  for (const n of names) mkConsole(mkArchived(project, n), [PENDING('g.md')]);
  const reads = [];
  const readFile = (p) => { reads.push(p); return fs.readFileSync(p, 'utf8'); };
  const entries = residue.collectUnresolvedConsoles(project, { pluginRoot: '/p', readFile });
  assert.strictEqual(entries.length, residue.MAX_REPORTED);
  assert.deepStrictEqual(entries.map((e) => path.basename(e.dir)), names.slice(-residue.MAX_REPORTED).reverse());
  assert.ok(reads.filter((p) => p.endsWith('console.json')).length <= residue.MAX_REPORTED, `read ${reads.length} consoles`);
});

test('collectUnresolvedConsoles: limit Infinity returns every unresolved run', () => {
  const project = tmpProject();
  for (const n of [1, 2, 3, 4, 5]) mkConsole(mkArchived(project, `2026-10-0${n}T000000-spec-${n}`), [PENDING('h.md')]);
  assert.strictEqual(residue.collectUnresolvedConsoles(project, { pluginRoot: '/p', limit: Infinity }).length, 5);
});
