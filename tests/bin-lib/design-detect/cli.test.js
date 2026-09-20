// tests/bin-lib/design-detect/cli.test.js — process-boundary wiring for
// bin/design-detect.js: argument parsing, --signals file/stdin handling,
// malformed-signals degradation, and exit codes (#885).
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CLI = path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'design-detect.js');

function run(args, opts = {}) {
  try {
    const out = execFileSync('node', [CLI, ...args], { encoding: 'utf8', ...opts });
    return { code: 0, stdout: out };
  } catch (err) {
    return { code: err.status, stdout: err.stdout, stderr: err.stderr };
  }
}

test('CLI: --mode required', () => {
  const r = run([]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /--mode is required/);
});

test('CLI: unknown mode exits 1', () => {
  const r = run(['--mode', 'not-a-mode']);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /unknown mode/);
});

test('CLI: explicit --design-integration + --surface backend skips deterministically, no CLAUDE.md read', () => {
  const r = run(['--mode', 'review', '--design-integration', 'enabled', '--surface', 'backend']);
  assert.equal(r.code, 0);
  const parsed = JSON.parse(r.stdout);
  assert.equal(parsed.decision, 'skip');
  assert.equal(parsed.reason, 'non-frontend spec (surface declared)');
});

test('CLI: --design-integration disabled always skips regardless of other args', () => {
  const r = run(['--mode', 'review', '--design-integration', 'disabled', '--surface', 'web', '--files', 'a.tsx']);
  const parsed = JSON.parse(r.stdout);
  assert.deepEqual(parsed, { decision: 'skip', reason: 'design integration disabled' });
});

test('CLI: --files comma-splits and matches against the trigger table', () => {
  const r = run(['--mode', 'review', '--design-integration', 'enabled', '--files', 'src/utils/cache.ts,src/components/Button.tsx']);
  const parsed = JSON.parse(r.stdout);
  assert.equal(parsed.decision, 'proceed');
  assert.equal(parsed.track, 'web');
});

test('CLI: --signals reads a Layer 0 JSON file and extracts setup.platform', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'design-detect-'));
  const signalsPath = path.join(tmp, 'signals.json');
  fs.writeFileSync(signalsPath, JSON.stringify({ setup: { platform: 'ios' } }));
  try {
    const r = run(['--mode', 'review', '--design-integration', 'enabled', '--surface', 'mobile', '--signals', signalsPath]);
    const parsed = JSON.parse(r.stdout);
    assert.deepEqual(parsed, { decision: 'proceed', track: 'native', platform: 'ios' });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('CLI: malformed --signals file degrades to no-signals (platform null) rather than failing', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'design-detect-'));
  const signalsPath = path.join(tmp, 'bad.json');
  fs.writeFileSync(signalsPath, 'not json');
  try {
    const r = run(['--mode', 'review', '--design-integration', 'enabled', '--surface', 'mobile', '--signals', signalsPath]);
    assert.equal(r.code, 0);
    const parsed = JSON.parse(r.stdout);
    assert.deepEqual(parsed, { decision: 'proceed', track: 'native', platform: 'adaptive', inferred: true });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('CLI: --signals - reads Layer 0 JSON from stdin', () => {
  const out = execFileSync('node', [CLI, '--mode', 'review', '--design-integration', 'enabled', '--surface', 'web', '--files', 'a.tsx', '--signals', '-'], {
    input: JSON.stringify({ setup: { platform: 'web' } }),
    encoding: 'utf8',
  });
  const parsed = JSON.parse(out);
  assert.deepEqual(parsed, { decision: 'proceed', track: 'web' });
});

test('CLI: --surface-lines classifies a control-flow-only diff as no surface', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'design-detect-'));
  const diffPath = path.join(tmp, 'diff.patch');
  fs.writeFileSync(diffPath, [
    'diff --git a/src/components/Widget.tsx b/src/components/Widget.tsx',
    'index 1111111..2222222 100644',
    '--- a/src/components/Widget.tsx',
    '+++ b/src/components/Widget.tsx',
    '@@ -10,1 +10,1 @@',
    "-  const res = await fetch('/api/widget');",
    "+  const res = await fetch('/api/widget', { cache: 'no-store' });",
    '',
  ].join('\n'));
  try {
    const r = run(['--surface-lines', diffPath]);
    assert.equal(r.code, 0);
    const parsed = JSON.parse(r.stdout);
    assert.equal(parsed.surface, false);
    assert.equal(parsed.files.length, 1);
    assert.equal(parsed.files[0].kind, 'jsx');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('CLI: --surface-lines classifies a JSX attribute change as surface', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'design-detect-'));
  const diffPath = path.join(tmp, 'diff.patch');
  fs.writeFileSync(diffPath, [
    'diff --git a/src/components/Widget.tsx b/src/components/Widget.tsx',
    'index 1111111..2222222 100644',
    '--- a/src/components/Widget.tsx',
    '+++ b/src/components/Widget.tsx',
    '@@ -30,1 +30,1 @@',
    '-  <div className="widget">',
    '+  <div className="widget widget--active">',
    '',
  ].join('\n'));
  try {
    const r = run(['--surface-lines', diffPath]);
    const parsed = JSON.parse(r.stdout);
    assert.equal(parsed.surface, true);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('CLI: --surface-lines reads from stdin with -', () => {
  const diff = [
    'diff --git a/a.css b/a.css',
    'index 1111111..2222222 100644',
    '--- a/a.css',
    '+++ b/a.css',
    '@@ -1,1 +1,1 @@',
    '-.a { color: red; }',
    '+.a { color: blue; }',
    '',
  ].join('\n');
  const out = execFileSync('node', [CLI, '--surface-lines', '-'], { input: diff, encoding: 'utf8' });
  const parsed = JSON.parse(out);
  assert.equal(parsed.surface, true);
});

test('CLI: --surface-lines and --mode together is a malformed invocation', () => {
  const r = run(['--surface-lines', '-', '--mode', 'review']);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /mutually exclusive/);
});

test('CLI: --surface-lines with an unreadable path fails loudly', () => {
  const r = run(['--surface-lines', '/nonexistent/path/to/diff.patch']);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /could not read diff/);
});

test('CLI: --claude-md reads design-integration from an explicit file path', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'design-detect-'));
  const claudeMdPath = path.join(tmp, 'CLAUDE.md');
  fs.writeFileSync(claudeMdPath, '## Design integration\n\ndesign-integration: enabled\n');
  try {
    const r = run(['--mode', 'review', '--claude-md', claudeMdPath, '--surface', 'web', '--files', 'a.tsx']);
    const parsed = JSON.parse(r.stdout);
    assert.equal(parsed.decision, 'proceed');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
