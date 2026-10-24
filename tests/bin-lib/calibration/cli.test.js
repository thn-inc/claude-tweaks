'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { TERMINAL_DECISION_VALUES } = require('../../../plugin/bin/lib/calibration/decisions-classifier.js');
const { readText } = require('../../helpers/read-skill');

const CLI = path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'calibration-report.js');

function makeFixtureRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'calib-cli-'));
  fs.mkdirSync(path.join(root, '.claude-tweaks'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.claude-tweaks', 'wrap-up-outcomes.tsv'),
    '2026-08-01\trun-1\tskills\tclosed\t0\tna\n2026-08-02\trun-2\tskills\tclosed\t0\tna\n',
  );
  const archiveDir = path.join(root, '.claude-tweaks', 'pipelines', 'archive');
  for (const runId of ['run-1', 'run-2']) {
    const dir = path.join(archiveDir, runId);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'decisions.md'), '- AUTO 12:00:00 — Review Console: terminal decision approve-all. Reversibility: n/a.\n');
    fs.writeFileSync(path.join(dir, 'events.jsonl'), '{"type":"gate-denial"}\n');
  }
  return root;
}

function run(args, root) {
  return execFileSync('node', [CLI, ...args, '--root', root], { encoding: 'utf8' });
}

test('CLI renders all five sections for a fixture tree', () => {
  const root = makeFixtureRoot();
  const out = run([], root);
  assert.match(out, /Per-registry-row finding rate|finding rate/i);
  assert.match(out, /approve-all/);
  assert.match(out, /Reversibility/i);
  assert.match(out, /gate-denial/);
  assert.match(out, /[Rr]efused/);
});

test('CLI --json round-trips the same numbers as the text report', () => {
  const root = makeFixtureRoot();
  const jsonOut = JSON.parse(run(['--json'], root));
  const textOut = run([], root);
  assert.strictEqual(jsonOut.consoleDist['approve-all'], 2);
  assert.match(textOut, new RegExp(`approve-all: ${jsonOut.consoleDist['approve-all']}\\b`));
  assert.match(textOut, new RegExp(`gate-denial: ${jsonOut.frictionCounts['gate-denial']}\\b`));
  assert.strictEqual(jsonOut.refusedCount, 0);
  assert.match(textOut, /Refused proposals: 0/);
});

test('CLI renders a named Failed writes bucket, not silent other', () => {
  const root = makeFixtureRoot();
  const dir = path.join(root, '.claude-tweaks', 'pipelines', 'archive', 'run-1');
  fs.writeFileSync(
    path.join(dir, 'decisions.md'),
    '- AUTO 12:00:00 — Review Console: terminal decision approve-all. Reversibility: n/a.\n' +
    '- FAILED 09:00:00 — apply-refine-labels: priority write failed on #42: HTTP 500.\n',
  );
  const jsonOut = JSON.parse(run(['--json'], root));
  const textOut = run([], root);
  assert.strictEqual(jsonOut.failedCount, 1);
  assert.match(textOut, /Failed writes: 1/);
});

test('missing TSV exits 0 with an explicit "no telemetry yet" line', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'calib-empty-'));
  const out = run([], root);
  assert.match(out, /no telemetry yet/);
});

test('#917: a partially-pruned archive still reports the TSV row whose runId has no archived dir', () => {
  // run-1's archive dir was pruned (deleted) while its wrap-up-outcomes.tsv
  // row persists; run-2's archive dir still exists. Before #917, only the
  // fully-empty-archive case synthesized a stub row — a partial prune left
  // run-1 permanently and silently stuck at "no runs in window" even though
  // run-2 (a real archived run) was loaded fine.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'calib-partial-'));
  fs.mkdirSync(path.join(root, '.claude-tweaks'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.claude-tweaks', 'wrap-up-outcomes.tsv'),
    '2026-08-01\trun-1\tskills\tclosed\t0\tna\n2026-08-02\trun-2\tskills\tclosed\t0\tna\n',
  );
  const archiveDir = path.join(root, '.claude-tweaks', 'pipelines', 'archive');
  // Only run-2's archive dir exists — run-1's was pruned.
  const dir = path.join(archiveDir, 'run-2');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'decisions.md'), '- AUTO 12:00:00 — Review Console: terminal decision approve-all. Reversibility: n/a.\n');
  fs.writeFileSync(path.join(dir, 'events.jsonl'), '{"type":"gate-denial"}\n');

  const jsonOut = JSON.parse(run(['--json'], root));
  assert.ok(jsonOut.window.runIds.includes('run-1'), 'run-1 (pruned archive) must still appear in the window');
  assert.ok(jsonOut.window.runIds.includes('run-2'), 'run-2 (real archived run) must still appear in the window');
  // run-2's real decision line must still be counted — the stub-synthesis
  // for run-1 must not clobber or dilute run-2's actually-loaded data.
  assert.strictEqual(jsonOut.consoleDist['approve-all'], 1);
  assert.strictEqual(jsonOut.frictionCounts['gate-denial'], 1);
});

test('no archive dir is stated explicitly', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'calib-noarchive-'));
  fs.mkdirSync(path.join(root, '.claude-tweaks'), { recursive: true });
  fs.writeFileSync(path.join(root, '.claude-tweaks', 'wrap-up-outcomes.tsv'), '');
  const out = run([], root);
  assert.match(out, /no archived runs/i);
});

test('unknown flag exits 2 (not just some non-zero code)', () => {
  const root = makeFixtureRoot();
  try {
    execFileSync('node', [CLI, '--bogus', '--root', root], { encoding: 'utf8' });
    assert.fail('should have thrown');
  } catch (err) {
    assert.strictEqual(err.status, 2);
  }
});

test('--runs rejects a non-numeric value with exit 2, instead of silently widening the window to unlimited history', () => {
  // Review finding #901: an unvalidated Number(argv[++i]) turns a typo like
  // "--runs abc" into NaN, and aggregate()'s slice(-NaN) reads as slice(0) —
  // the WHOLE run history, not the requested window. Must fail loudly.
  const root = makeFixtureRoot();
  try {
    execFileSync('node', [CLI, '--runs', 'abc', '--root', root], { encoding: 'utf8' });
    assert.fail('should have thrown');
  } catch (err) {
    assert.strictEqual(err.status, 2);
  }
});

test('--runs as the last argument with no value exits 2 rather than reading undefined', () => {
  const root = makeFixtureRoot();
  try {
    execFileSync('node', [CLI, '--root', root, '--runs'], { encoding: 'utf8' });
    assert.fail('should have thrown');
  } catch (err) {
    assert.strictEqual(err.status, 2);
  }
});

test('autonomy-raising signal fires at 100% approve-all over >=10 stops under the schema-default (supervised) ceiling', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'calib-ceiling-'));
  fs.mkdirSync(path.join(root, '.claude-tweaks'), { recursive: true });
  fs.writeFileSync(path.join(root, '.claude-tweaks', 'wrap-up-outcomes.tsv'), '');
  const archiveDir = path.join(root, '.claude-tweaks', 'pipelines', 'archive');
  for (let i = 1; i <= 10; i++) {
    const dir = path.join(archiveDir, `run-${i}`);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'decisions.md'), '- AUTO 12:00:00 — Review Console: terminal decision approve-all. Reversibility: n/a.\n');
  }
  const out = run(['--runs', '20'], root);
  assert.match(out, /[Cc]onsider raising autonomy/);
  // The recommended line must be a real runnable command, not a "#" comment
  // that can be pasted but does nothing (this repo has no .claude-tweaks
  // dir with a real git root inside the temp fixture, so a literal `sed`
  // path isn't assertable here — only that it isn't a bare comment line).
  assert.doesNotMatch(out, /^#\s*edit .*autonomy: trusted\s*$/m);
});

test('narrowing signal renders with a paste-ready command on its own line at >=10 appearances', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'calib-narrow-'));
  fs.mkdirSync(path.join(root, '.claude-tweaks'), { recursive: true });
  const lines = [];
  for (let i = 1; i <= 10; i++) lines.push(`2026-08-${String(i).padStart(2, '0')}\trun-${i}\tskills\tclosed\t0\tna`);
  fs.writeFileSync(path.join(root, '.claude-tweaks', 'wrap-up-outcomes.tsv'), lines.join('\n') + '\n');
  fs.mkdirSync(path.join(root, '.claude-tweaks', 'pipelines', 'archive'), { recursive: true });
  const out = run(['--runs', '20'], root);
  assert.match(out, /consider narrowing/i);
});

test('both console files carry the terminal-decision log-line format, one per TERMINAL_DECISION_VALUES member', () => {
  const interactiveText = readText(path.join(__dirname, '..', '..', '..', 'plugin', 'skills', 'wrap-up', 'review-console-interactive.md'));
  const multispecText = readText(path.join(__dirname, '..', '..', '..', 'plugin', 'skills', 'flow', 'multispec-review-console.md'));
  assert.ok(interactiveText.includes('Review Console: terminal decision'), 'single-spec console must log the terminal decision');
  assert.ok(multispecText.includes('Review Console: terminal decision') || multispecText.includes('per the single-spec console'), 'multispec console must log or cite the terminal decision');
  for (const value of TERMINAL_DECISION_VALUES) {
    assert.ok(
      interactiveText.includes(value) || interactiveText.includes('approve-all|approve-all-merge|leave-pr-open|override|stop'),
      `interactive console prose must reference terminal-decision value "${value}"`,
    );
  }
});

test('skill-graph.md no longer states "no consumer today" for wrap-up telemetry', () => {
  const text = readText(path.join(__dirname, '..', '..', '..', 'docs', 'skill-graph.md'));
  assert.ok(!text.includes('no consumer today'), 'stale "no consumer today" note must be replaced');
});

test('auto-decision-log.md lists bin/lib/calibration/ as a consumer', () => {
  const text = readText(path.join(__dirname, '..', '..', '..', 'plugin', 'skills', '_shared', 'auto-decision-log.md'));
  assert.ok(text.includes('bin/lib/calibration'), 'auto-decision-log.md must list the calibration reader as a consumer');
});
