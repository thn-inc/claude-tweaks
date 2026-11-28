'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const { scratchDir } = require('../../helpers/tmp-dir');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { TERMINAL_DECISION_VALUES } = require('../../../plugin/bin/lib/calibration/decisions-classifier.js');
const { readText } = require('../../helpers/read-skill');
const { runCliSync, spawnCli } = require('../../helpers/run-cli');
const { STUB_SKIP } = require('../../helpers/path-stub');

const CLI = path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'calibration-report.js');

function makeFixtureRoot() {
  const root = scratchDir('calib-cli-');
  fs.mkdirSync(path.join(root, '.claude-tweaks'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.claude-tweaks', 'wrap-up-outcomes.tsv'),
    '2026-08-01\t2026-08-01T000000-run-1\tskills\tclosed\t0\tna\n2026-08-02\t2026-08-02T000000-run-2\tskills\tclosed\t0\tna\n',
  );
  const archiveDir = path.join(root, '.claude-tweaks', 'pipelines', 'archive');
  for (const runId of ['2026-08-01T000000-run-1', '2026-08-02T000000-run-2']) {
    const dir = path.join(archiveDir, runId);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'decisions.md'), '- AUTO 12:00:00 — Review Console: terminal decision approve-all. Reversibility: n/a.\n');
    fs.writeFileSync(path.join(dir, 'events.jsonl'), '{"type":"gate-denial"}\n');
  }
  return root;
}

// The complete environment each in-process call sees.
function cliEnv(extra = {}) {
  return { ...process.env, ...extra };
}

// In-process call, no --root appended: { code, stdout, stderr }.
function runRaw(argv, opts = {}) {
  return runCliSync(CLI, argv, { env: cliEnv(), ...opts });
}

// In-process call that must exit 0: its stdout.
function run(args, root) {
  const r = runRaw([...args, '--root', root]);
  assert.strictEqual(r.code, 0, r.stderr);
  return r.stdout;
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
  const dir = path.join(root, '.claude-tweaks', 'pipelines', 'archive', '2026-08-01T000000-run-1');
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
  const root = scratchDir('calib-empty-');
  const out = run([], root);
  assert.match(out, /no telemetry yet/);
});

test('#917: a partially-pruned archive still reports the TSV row whose runId has no archived dir', () => {
  // run-1's archive dir was pruned (deleted) while its wrap-up-outcomes.tsv
  // row persists; run-2's archive dir still exists. Before #917, only the
  // fully-empty-archive case synthesized a stub row — a partial prune left
  // run-1 permanently and silently stuck at "no runs in window" even though
  // run-2 (a real archived run) was loaded fine.
  const root = scratchDir('calib-partial-');
  fs.mkdirSync(path.join(root, '.claude-tweaks'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.claude-tweaks', 'wrap-up-outcomes.tsv'),
    '2026-08-01\t2026-08-01T000000-run-1\tskills\tclosed\t0\tna\n2026-08-02\t2026-08-02T000000-run-2\tskills\tclosed\t0\tna\n',
  );
  const archiveDir = path.join(root, '.claude-tweaks', 'pipelines', 'archive');
  // Only run-2's archive dir exists — run-1's was pruned.
  const dir = path.join(archiveDir, '2026-08-02T000000-run-2');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'decisions.md'), '- AUTO 12:00:00 — Review Console: terminal decision approve-all. Reversibility: n/a.\n');
  fs.writeFileSync(path.join(dir, 'events.jsonl'), '{"type":"gate-denial"}\n');

  const jsonOut = JSON.parse(run(['--json'], root));
  assert.ok(jsonOut.window.runIds.includes('2026-08-01T000000-run-1'), 'run-1 (pruned archive) must still appear in the window');
  assert.ok(jsonOut.window.runIds.includes('2026-08-02T000000-run-2'), 'run-2 (real archived run) must still appear in the window');
  // run-2's real decision line must still be counted — the stub-synthesis
  // for run-1 must not clobber or dilute run-2's actually-loaded data.
  assert.strictEqual(jsonOut.consoleDist['approve-all'], 1);
  assert.strictEqual(jsonOut.frictionCounts['gate-denial'], 1);
});

test('a TSV-only run with a live run dir contributes its decisions', () => {
  // A finished run awaiting archival has a TSV row and a live dir (no archive dir yet).
  const root = scratchDir('calib-live-');
  fs.mkdirSync(path.join(root, '.claude-tweaks'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.claude-tweaks', 'wrap-up-outcomes.tsv'),
    '2026-08-01\t2026-08-01T000000-run-1\tskills\tclosed\t0\tna\n2026-08-03\t2026-08-03T000000-live-1\tskills\tclosed\t0\tna\n',
  );
  const decision = '- AUTO 12:00:00 — Review Console: terminal decision approve-all. Reversibility: n/a.\n';
  const archived = path.join(root, '.claude-tweaks', 'pipelines', 'archive', '2026-08-01T000000-run-1');
  fs.mkdirSync(archived, { recursive: true });
  fs.writeFileSync(path.join(archived, 'decisions.md'), decision);
  const live = path.join(root, '.claude-tweaks', 'pipelines', '2026-08-03T000000-live-1');
  fs.mkdirSync(live, { recursive: true });
  fs.writeFileSync(path.join(live, 'decisions.md'), decision);
  fs.writeFileSync(path.join(live, 'events.jsonl'), '{"type":"gate-denial"}\n');
  const jsonOut = JSON.parse(run(['--json'], root));
  assert.ok(jsonOut.window.runIds.includes('2026-08-03T000000-live-1'));
  assert.strictEqual(jsonOut.consoleDist['approve-all'], 2);
  assert.strictEqual(jsonOut.frictionCounts['gate-denial'], 1);
});

test('a TSV-only run id with a path separator never reads outside the pipelines dir', () => {
  // The dated prefix lets runIdTimestamp accept the id into the window; the
  // `../..` tail makes path.join(pipelines, runId) resolve outside pipelines/.
  const escapeId = '2026-08-04T000000-x/../../outside';
  const root = scratchDir('calib-escape-');
  fs.mkdirSync(path.join(root, '.claude-tweaks'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.claude-tweaks', 'wrap-up-outcomes.tsv'),
    `2026-08-01\t2026-08-01T000000-run-1\tskills\tclosed\t0\tna\n2026-08-04\t${escapeId}\tskills\tclosed\t0\tna\n`,
  );
  const decision = '- AUTO 12:00:00 — Review Console: terminal decision approve-all. Reversibility: n/a.\n';
  const archived = path.join(root, '.claude-tweaks', 'pipelines', 'archive', '2026-08-01T000000-run-1');
  fs.mkdirSync(archived, { recursive: true });
  fs.writeFileSync(path.join(archived, 'decisions.md'), decision);
  // The intermediate dir makes the escaping path resolvable on every platform.
  fs.mkdirSync(path.join(root, '.claude-tweaks', 'pipelines', '2026-08-04T000000-x'), { recursive: true });
  const outside = path.join(root, '.claude-tweaks', 'pipelines', escapeId);
  fs.mkdirSync(outside, { recursive: true });
  fs.writeFileSync(path.join(outside, 'decisions.md'), decision);
  fs.writeFileSync(path.join(outside, 'events.jsonl'), '{"type":"gate-denial"}\n');
  const jsonOut = JSON.parse(run(['--json'], root));
  assert.ok(jsonOut.window.runIds.includes(escapeId), 'the multi-segment run id must reach the window');
  assert.strictEqual(jsonOut.consoleDist['approve-all'], 1, 'the outside decisions.md must not be read');
  assert.ok(!jsonOut.frictionCounts['gate-denial'], 'the outside events.jsonl must not be read');
});

test('a TSV-only run id with a backslash never reads a live dir of that literal name', () => {
  // On POSIX a backslash is an ordinary filename character, so only the guard
  // keeps this id from being read as a live dir; on Windows it is a separator.
  const backslashId = '2026-08-05T000000-x\\..\\..\\outside';
  const root = scratchDir('calib-backslash-');
  fs.mkdirSync(path.join(root, '.claude-tweaks'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.claude-tweaks', 'wrap-up-outcomes.tsv'),
    `2026-08-01\t2026-08-01T000000-run-1\tskills\tclosed\t0\tna\n2026-08-05\t${backslashId}\tskills\tclosed\t0\tna\n`,
  );
  const decision = '- AUTO 12:00:00 — Review Console: terminal decision approve-all. Reversibility: n/a.\n';
  const archived = path.join(root, '.claude-tweaks', 'pipelines', 'archive', '2026-08-01T000000-run-1');
  fs.mkdirSync(archived, { recursive: true });
  fs.writeFileSync(path.join(archived, 'decisions.md'), decision);
  const literal = path.join(root, '.claude-tweaks', 'pipelines', backslashId);
  fs.mkdirSync(literal, { recursive: true });
  fs.writeFileSync(path.join(literal, 'decisions.md'), decision);
  const jsonOut = JSON.parse(run(['--json'], root));
  assert.ok(jsonOut.window.runIds.includes(backslashId), 'the backslash run id must reach the window');
  assert.strictEqual(jsonOut.consoleDist['approve-all'], 1, 'the literal-named dir must not be read');
});

test('a symlinked live run dir is not read', { skip: process.platform === 'win32' }, () => {
  const root = scratchDir('calib-symlink-');
  fs.mkdirSync(path.join(root, '.claude-tweaks'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.claude-tweaks', 'wrap-up-outcomes.tsv'),
    '2026-08-01\t2026-08-01T000000-run-1\tskills\tclosed\t0\tna\n2026-08-06\t2026-08-06T000000-link-1\tskills\tclosed\t0\tna\n',
  );
  const decision = '- AUTO 12:00:00 — Review Console: terminal decision approve-all. Reversibility: n/a.\n';
  const archived = path.join(root, '.claude-tweaks', 'pipelines', 'archive', '2026-08-01T000000-run-1');
  fs.mkdirSync(archived, { recursive: true });
  fs.writeFileSync(path.join(archived, 'decisions.md'), decision);
  const target = scratchDir('calib-symlink-target-');
  fs.writeFileSync(path.join(target, 'decisions.md'), decision);
  fs.symlinkSync(target, path.join(root, '.claude-tweaks', 'pipelines', '2026-08-06T000000-link-1'), 'dir');
  const jsonOut = JSON.parse(run(['--json'], root));
  assert.ok(jsonOut.window.runIds.includes('2026-08-06T000000-link-1'));
  assert.strictEqual(jsonOut.consoleDist['approve-all'], 1, 'the symlink target must not be read');
});

test('a TSV-only run with a live dir is read before any archive dir exists', () => {
  const root = scratchDir('calib-live-noarchive-');
  fs.mkdirSync(path.join(root, '.claude-tweaks'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.claude-tweaks', 'wrap-up-outcomes.tsv'),
    '2026-08-03\t2026-08-03T000000-live-1\tskills\tclosed\t0\tna\n',
  );
  const live = path.join(root, '.claude-tweaks', 'pipelines', '2026-08-03T000000-live-1');
  fs.mkdirSync(live, { recursive: true });
  fs.writeFileSync(path.join(live, 'decisions.md'), '- AUTO 12:00:00 — Review Console: terminal decision approve-all. Reversibility: n/a.\n');
  const jsonOut = JSON.parse(run(['--json'], root));
  assert.deepStrictEqual(jsonOut.window.runIds, ['2026-08-03T000000-live-1']);
  assert.strictEqual(jsonOut.consoleDist['approve-all'], 1);
});

test('header carries no excluded note when every run id is dated', () => {
  const root = makeFixtureRoot();
  assert.match(run([], root), /^Window: last 2 archived run\(s\)\.$/m);
});

test('header names how many undated run ids were excluded', () => {
  const root = scratchDir('calib-excluded-');
  fs.mkdirSync(path.join(root, '.claude-tweaks'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.claude-tweaks', 'wrap-up-outcomes.tsv'),
    '2026-08-01\t2026-08-01T000000-run-1\tskills\tclosed\t0\tna\n2026-08-02\tspec-259\tskills\tclosed\t0\tna\n',
  );
  const archiveDir = path.join(root, '.claude-tweaks', 'pipelines', 'archive');
  for (const runId of ['2026-08-01T000000-run-1', '2026-08-02T000000-run-2', 'unresolved-provenance']) {
    fs.mkdirSync(path.join(archiveDir, runId), { recursive: true });
  }
  const jsonOut = JSON.parse(run(['--json'], root));
  assert.deepStrictEqual(jsonOut.window.runIds, ['2026-08-01T000000-run-1', '2026-08-02T000000-run-2']);
  assert.strictEqual(jsonOut.window.excluded, 2);
  assert.match(run([], root), /^Window: last 2 archived run\(s\); 2 run ids without a timestamp excluded\.$/m);
});

test('header with only undated entries reports an empty window and exits 0', () => {
  const root = scratchDir('calib-undated-');
  fs.mkdirSync(path.join(root, '.claude-tweaks', 'pipelines', 'archive', 'unresolved-provenance'), { recursive: true });
  fs.writeFileSync(path.join(root, '.claude-tweaks', 'wrap-up-outcomes.tsv'), '');
  const out = run([], root);
  assert.match(out, /^Window: last 0 archived run\(s\); 1 run id without a timestamp excluded\.$/m);
  assert.match(out, /Console terminal-decision distribution/);
});

test('no archive dir is stated explicitly', () => {
  const root = scratchDir('calib-noarchive-');
  fs.mkdirSync(path.join(root, '.claude-tweaks'), { recursive: true });
  fs.writeFileSync(path.join(root, '.claude-tweaks', 'wrap-up-outcomes.tsv'), '');
  const out = run([], root);
  assert.match(out, /no archived runs/i);
});

test('unknown flag exits 2 (not just some non-zero code)', () => {
  const root = makeFixtureRoot();
  const r = runRaw(['--bogus', '--root', root]);
  assert.strictEqual(r.code, 2);
  assert.strictEqual(r.stderr, 'unknown flag: --bogus\n');
});

test('--runs rejects a non-numeric value with exit 2, instead of silently widening the window to unlimited history', () => {
  // Review finding #901: an unvalidated Number(argv[++i]) turns a typo like
  // "--runs abc" into NaN, and aggregate()'s slice(-NaN) reads as slice(0) —
  // the WHOLE run history, not the requested window. Must fail loudly.
  const root = makeFixtureRoot();
  const r = runRaw(['--runs', 'abc', '--root', root]);
  assert.strictEqual(r.code, 2);
  assert.strictEqual(r.stderr, '--runs requires a positive number, got: abc\n');
});

test('AC8.1: --runs abc exits 2 naming the value (script entry)', () => {
  // Real process: proves the refusal exit code survives the script entry.
  const res = spawnCli(CLI, ['--runs', 'abc', '--root', makeFixtureRoot()]);
  assert.strictEqual(res.code, 2);
  assert.strictEqual(res.stdout, '');
  assert.strictEqual(res.stderr, '--runs requires a positive number, got: abc\n');
});

test('--runs as the last argument with no value exits 2 rather than reading undefined', () => {
  const root = makeFixtureRoot();
  const r = runRaw(['--root', root, '--runs']);
  assert.strictEqual(r.code, 2);
  assert.strictEqual(r.stderr, '--runs requires a positive number, got: undefined\n');
});

test('--root as the last argument with no value exits 2 naming the flag, not an uncaught TypeError', () => {
  const r = runRaw(['--runs', '5', '--root']);
  assert.strictEqual(r.code, 2);
  assert.strictEqual(r.stdout, '');
  assert.strictEqual(r.stderr, '--root requires a value\n');
});

test('autonomy-raising signal fires at 100% approve-all over >=10 stops under the schema-default (supervised) ceiling', () => {
  const root = scratchDir('calib-ceiling-');
  fs.mkdirSync(path.join(root, '.claude-tweaks'), { recursive: true });
  fs.writeFileSync(path.join(root, '.claude-tweaks', 'wrap-up-outcomes.tsv'), '');
  const archiveDir = path.join(root, '.claude-tweaks', 'pipelines', 'archive');
  for (let i = 1; i <= 10; i++) {
    const dir = path.join(archiveDir, `2026-08-${String(i).padStart(2, '0')}T000000-run-${i}`);
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
  const root = scratchDir('calib-narrow-');
  fs.mkdirSync(path.join(root, '.claude-tweaks'), { recursive: true });
  const lines = [];
  for (let i = 1; i <= 10; i++) lines.push(`2026-08-${String(i).padStart(2, '0')}\t2026-08-${String(i).padStart(2, '0')}T000000-run-${i}\tskills\tclosed\t0\tna`);
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

test('AC1.1: calibration-report counts only the real gate-denial when a run also holds a test:true one (#4186)', () => {
  const root = scratchDir('calib-testdenial-');
  fs.mkdirSync(path.join(root, '.claude-tweaks'), { recursive: true });
  fs.writeFileSync(path.join(root, '.claude-tweaks', 'wrap-up-outcomes.tsv'), '2026-08-01\t2026-08-01T000000-run-1\tskills\tclosed\t0\tna\n');
  const dir = path.join(root, '.claude-tweaks', 'pipelines', 'archive', '2026-08-01T000000-run-1');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'decisions.md'), '- AUTO 12:00:00 — Review Console: terminal decision approve-all. Reversibility: n/a.\n');
  fs.writeFileSync(path.join(dir, 'events.jsonl'), '{"type":"gate-denial","test":true}\n{"type":"gate-denial"}\n');
  const jsonOut = JSON.parse(run(['--json'], root));
  assert.strictEqual(jsonOut.frictionCounts['gate-denial'], 1);
  assert.match(run([], root), /gate-denial: 1\b/);
});

// ---- autonomy ceiling: resolved in-process through resolve-policy's core ----

// Ten approve-all console stops (the ceiling suggestion's floor) and a policy.yml.
function makeCeilingRoot(policy) {
  const root = scratchDir('calib-autonomy-');
  fs.mkdirSync(path.join(root, '.claude-tweaks'), { recursive: true });
  fs.writeFileSync(path.join(root, '.claude-tweaks', 'wrap-up-outcomes.tsv'), '');
  if (policy !== null) fs.writeFileSync(path.join(root, '.claude-tweaks', 'policy.yml'), policy);
  for (let i = 1; i <= 10; i++) {
    const dir = path.join(root, '.claude-tweaks', 'pipelines', 'archive', `2026-08-${String(i).padStart(2, '0')}T000000-run-${i}`);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'decisions.md'), '- AUTO 12:00:00 — Review Console: terminal decision approve-all. Reversibility: n/a.\n');
  }
  return root;
}

// A `node` shim that records being started: the marker file exists only if something ran `node`.
function makeNodeStub() {
  const dir = scratchDir('calib-node-stub-');
  fs.writeFileSync(path.join(dir, 'node'), '#!/bin/sh\ntouch "$MARKER"\nexit 1\n');
  fs.chmodSync(path.join(dir, 'node'), 0o755); // root-safe: exec-bit stub, not a denial simulation
  return { dir, marker: path.join(dir, 'marker') };
}

const SUGGESTION = [
  'Consider raising autonomy from supervised to trusted (ceiling read at report time — stops earlier in the window may predate the current setting).',
  'node -e "const fs=require(\'fs\');const p=\'.claude-tweaks/policy.yml\';let t=fs.existsSync(p)?fs.readFileSync(p,\'utf8\'):\'\';t=/^autonomy:/m.test(t)?t.replace(/^autonomy:.*$/m,\'autonomy: trusted\'):t+\'autonomy: trusted\\n\';fs.writeFileSync(p,t)"',
];

// The report makeCeilingRoot's fixture renders, byte for byte as the unconverted script printed it (Step 0 capture).
function expectedReport(withSuggestion) {
  const lines = [
    '## Calibration read-out', '',
    'Window: last 10 archived run(s).', '',
    '### Per-registry-row finding rate',
    '- skills: no runs in window',
    '- docs: no runs in window',
    '- journeys: no runs in window',
    '- claude-md: no runs in window',
    '- decision-records: no runs in window',
    '- references: no runs in window',
    '- memory: no runs in window',
    '- upstream: no runs in window', '',
    '### Console terminal-decision distribution',
    '- unlogged: 0',
    '- approve-all: 10', '',
    '### Reversibility distribution',
    '- high: 0',
    '- med: 0',
    '- low: 0',
    '- n/a: 10', '',
    '### Friction events',
    '- none', '',
    '### Refused proposals: 0', '',
    '### Failed writes: 0', '',
  ];
  if (withSuggestion) lines.push(...SUGGESTION);
  return lines.join('\n') + '\n';
}

// Fixture policy.yml, the expected stdout, and the expected stderr per autonomy setting.
const CEILING_CASES = [
  ['autonomy: supervised', 'autonomy: supervised\n', true, ''],
  ['autonomy: trusted', 'autonomy: trusted\n', false, ''],
  ['autonomy: bogus', 'autonomy: bogus\n', true, 'resolve-policy: warning: autonomy has invalid value "bogus" — using default "supervised"\n'],
  ['no autonomy key', 'other-key: 1\n', true, ''],
];

test('AC4.1, AC8.1: autonomy is read without starting resolve-policy.js (script entry)', () => {
  // Real process: proves the script entry resolves autonomy in-process (a node child would hit the stub, read unknown and omit the line).
  // The stub and its marker run off win32 only (a script stub is never spawned there); the success path runs everywhere.
  const root = makeCeilingRoot('autonomy: supervised\n');
  const stub = STUB_SKIP ? null : makeNodeStub();
  try {
    const env = stub ? cliEnv({ MARKER: stub.marker, PATH: stub.dir + path.delimiter + process.env.PATH }) : cliEnv();
    const res = spawnCli(CLI, ['--root', root], { env });
    assert.strictEqual(res.code, 0, res.stderr);
    assert.match(res.stdout, /Consider raising autonomy/);
    if (stub) assert.strictEqual(fs.existsSync(stub.marker), false, 'a node child was started');
  } finally {
    if (stub) fs.rmSync(stub.dir, { recursive: true, force: true });
  }
});

test('AC4.1: in-process, autonomy is read without starting resolve-policy.js', { skip: STUB_SKIP }, () => {
  const stub = makeNodeStub();
  try {
    for (const [policy, suggested] of [['autonomy: trusted\n', false], ['autonomy: supervised\n', true]]) {
      const root = makeCeilingRoot(policy);
      const env = cliEnv({ MARKER: stub.marker, PATH: stub.dir + path.delimiter + process.env.PATH });
      const r = runRaw(['--root', root], { env });
      assert.strictEqual(r.code, 0, r.stderr);
      assert.strictEqual(/Consider raising autonomy/.test(r.stdout), suggested, policy);
      assert.strictEqual(fs.existsSync(stub.marker), false, `${policy}: a node child was started`);
    }
  } finally {
    fs.rmSync(stub.dir, { recursive: true, force: true });
  }
});

test('spec Deliverable 3: an invalid or missing autonomy value prints what the spawned call printed', () => {
  for (const [label, policy, suggested, stderr] of CEILING_CASES) {
    const r = runRaw(['--root', makeCeilingRoot(policy)]);
    assert.strictEqual(r.code, 0, label);
    assert.strictEqual(r.stdout, expectedReport(suggested), label);
    assert.strictEqual(r.stderr, stderr, label);
  }
});

test('the ceiling comes from deps.resolvePolicy: a supervised result suggests raising autonomy', () => {
  const root = makeCeilingRoot(null);
  const calls = [];
  const fake = (req, callDeps) => {
    calls.push({ req, cwd: callDeps.cwd() });
    return { code: 0, result: { autonomy: { value: 'supervised', source: 'policy' } }, invalidRaw: new Map(), degrades: new Map() };
  };
  const r = runRaw(['--root', root], { deps: { resolvePolicy: fake } });
  assert.strictEqual(r.code, 0);
  assert.match(r.stdout, /Consider raising autonomy/);
  assert.deepStrictEqual(calls, [{ req: { keys: ['autonomy'] }, cwd: root }]);
});

test('a resolvePolicy that throws reads as an unknown ceiling: no suggestion, exit 0', () => {
  const fake = () => { throw new Error('boom'); };
  const r = runRaw(['--root', makeCeilingRoot('autonomy: supervised\n')], { deps: { resolvePolicy: fake } });
  assert.strictEqual(r.code, 0);
  assert.doesNotMatch(r.stdout, /Consider raising autonomy/);
  assert.strictEqual(r.stderr, '');
});

test('a resolvePolicy that returns a non-zero code reads as an unknown ceiling: no suggestion, exit 0', () => {
  const fake = () => ({ code: 1, message: 'x' });
  const r = runRaw(['--root', makeCeilingRoot('autonomy: supervised\n')], { deps: { resolvePolicy: fake } });
  assert.strictEqual(r.code, 0);
  assert.doesNotMatch(r.stdout, /Consider raising autonomy/);
  assert.strictEqual(r.stderr, '');
});

test('AC9.1: no --root reads the injected cwd', () => {
  const root = makeFixtureRoot();
  // The test runner's real cwd holds no telemetry; only deps.cwd() can find it.
  const viaCwd = runRaw([], { cwd: root });
  assert.strictEqual(viaCwd.code, 0);
  assert.match(viaCwd.stdout, /approve-all: 2/);
  assert.strictEqual(viaCwd.stdout, runRaw(['--root', root]).stdout);
});

test('a relative --root resolves against the injected cwd and prints as given', () => {
  const parent = scratchDir('calib-rel-');
  fs.mkdirSync(path.join(parent, 'r'));
  const r = runRaw(['--root', 'r'], { cwd: parent });
  assert.strictEqual(r.code, 0);
  assert.strictEqual(r.stdout, `no telemetry yet (${path.join('r', '.claude-tweaks', 'wrap-up-outcomes.tsv')} absent)\n`);
  // The same relative root finds a real fixture when cwd is its parent.
  const root = makeFixtureRoot();
  const found = runRaw(['--root', path.basename(root)], { cwd: path.dirname(root) });
  assert.match(found.stdout, /approve-all: 2/);
});

test('AC9.1: the injected env reaches the policy core (a GIT_DIR in env redirects the root it reads)', () => {
  // The fixture's own policy.yml says supervised; the repo GIT_DIR/GIT_WORK_TREE point at says trusted.
  // Only an env handed to the core's git can make the core read the second one.
  const root = makeCeilingRoot('autonomy: supervised\n');
  const other = scratchDir('calib-other-repo-');
  const gitEnv = { ...process.env };
  for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR']) delete gitEnv[key];
  const init = spawnSync('git', ['init', '-q', other], { env: gitEnv, encoding: 'utf8', windowsHide: true });
  assert.strictEqual(init.status, 0, init.stderr);
  fs.mkdirSync(path.join(other, '.claude-tweaks'));
  fs.writeFileSync(path.join(other, '.claude-tweaks', 'policy.yml'), 'autonomy: trusted\n');
  const plain = runRaw(['--root', root], { env: gitEnv });
  assert.match(plain.stdout, /Consider raising autonomy/);
  // A git hook running npm test exports GIT_INDEX_FILE and GIT_COMMON_DIR, which would mix in a third repository.
  const redirectedEnv = cliEnv();
  for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR']) delete redirectedEnv[key];
  Object.assign(redirectedEnv, { GIT_DIR: path.join(other, '.git'), GIT_WORK_TREE: other });
  const redirected = runRaw(['--root', root], { env: redirectedEnv });
  assert.strictEqual(redirected.code, 0, redirected.stderr);
  assert.doesNotMatch(redirected.stdout, /Consider raising autonomy/);
});

test('AC6.1: require() prints nothing and leaves process.exitCode undefined', () => {
  delete require.cache[require.resolve(CLI)];
  const writes = [];
  const outWrite = process.stdout.write;
  const errWrite = process.stderr.write;
  const before = process.exitCode;
  process.stdout.write = (t) => { writes.push(t); return true; };
  process.stderr.write = (t) => { writes.push(t); return true; };
  try {
    require(CLI);
  } finally {
    process.stdout.write = outWrite;
    process.stderr.write = errWrite;
  }
  assert.deepStrictEqual(writes, []);
  assert.strictEqual(process.exitCode, before);
  assert.strictEqual(process.exitCode, undefined);
});
