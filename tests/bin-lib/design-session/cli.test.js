'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { runCliSync, spawnCli } = require('../../helpers/run-cli');
const { readStatus } = require('../../../plugin/bin/lib/design-session/status');
const { PERSPECTIVES } = require('../../../plugin/bin/lib/design-session/notes');

const CLI = path.resolve(__dirname, '..', '..', '..', 'plugin', 'bin', 'design-session.js');
const NOW = new Date(2026, 10, 27, 12);

function scratch(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'design-cli-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const call = (argv, cwd, extra = {}) => runCliSync(CLI, argv, { cwd, deps: { now: () => NOW, ...extra } });

function notes(n, { pending = false } = {}) {
  const lines = [`# Perspective notes — round ${n}`, '', 'Status: done', ''];
  PERSPECTIVES.forEach((p, i) => {
    lines.push(`## ${n}.${i + 1} — ${p} — ${i === 0 ? 'serious' : 'none'}`);
    if (i === 0) lines.push('> a note', pending ? 'Outcome: pending' : 'Outcome: changed — fixed');
    lines.push('');
  });
  return lines.join('\n');
}

function session(t, files = {}) {
  const dir = scratch(t);
  const design = '# T — design\n\n## Frame\n\nStatus: done\n\nthe frame\n\n## Storyboard\n\nStatus: done\n\nRound: 1\nFile: storyboard.md\n';
  const all = { 'design.md': design, 'storyboard.md': 'board', 'evidence.md': '# Evidence\n\nStatus: done\n\n- a claim — source: #6352\n', ...files };
  for (const [n, text] of Object.entries(all)) fs.writeFileSync(path.join(dir, n), text);
  return dir;
}

test('--help lists every flag and exits 0', (t) => {
  const r = call(['--help'], scratch(t));
  assert.strictEqual(r.code, 0);
  for (const flag of ['--topic', '--root', '--create', '--folder', '--round', '--reader']) {
    assert.ok(r.stdout.includes(flag), flag);
  }
});

test('folder prints the dated path, creates only with --create, and reuses an existing one', (t) => {
  const root = scratch(t);
  const want = path.join(root, 'docs', 'superpowers', 'specs', '2026-11-27-ordering-flow');
  const dry = call(['folder', '--topic', 'Ordering flow', '--root', root], root);
  assert.strictEqual(dry.code, 0);
  assert.strictEqual(dry.stdout.trim(), want);
  assert.ok(!fs.existsSync(want));
  const made = call(['folder', '--topic', 'Ordering flow', '--root', root, '--create'], root);
  assert.strictEqual(made.stdout.trim(), want);
  assert.ok(fs.statSync(want).isDirectory());
  const later = runCliSync(CLI, ['folder', '--topic', 'Ordering flow', '--root', root], { cwd: root, deps: { now: () => new Date(2026, 11, 5) } });
  assert.strictEqual(later.stdout.trim(), want);
});

test('folder resolves a relative --root against the injected cwd', (t) => {
  const cwd = scratch(t);
  fs.mkdirSync(path.join(cwd, 'repo'));
  const r = call(['folder', '--topic', '#6352', '--root', 'repo'], cwd);
  assert.strictEqual(r.stdout.trim(), path.join(cwd, 'repo', 'docs', 'superpowers', 'specs', '2026-11-27-issue-6352'));
});

test('status prints readStatus\'s object', (t) => {
  const dir = session(t);
  const r = call(['status', '--folder', dir], '/');
  assert.strictEqual(r.code, 0);
  assert.deepStrictEqual(JSON.parse(r.stdout), JSON.parse(JSON.stringify(readStatus(dir))));
});

test('a relative --folder resolves against the injected cwd', (t) => {
  const dir = session(t);
  const r = call(['status', '--folder', path.basename(dir)], path.dirname(dir));
  assert.strictEqual(r.code, 0);
  assert.strictEqual(JSON.parse(r.stdout).steps[1], 'done');
});

test('check-evidence exits 0 when done and sourced, 1 naming unsourced claims and fences', (t) => {
  const ok = call(['check-evidence', '--folder', session(t)], '/');
  assert.strictEqual(ok.code, 0);
  assert.deepStrictEqual(JSON.parse(ok.stdout), { done: true, unsourced: [], unclosedFence: false });

  const bad = call(['check-evidence', '--folder', session(t, { 'evidence.md': '# E\n\nStatus: done\n\n- no source here\n' })], '/');
  assert.strictEqual(bad.code, 1);
  assert.strictEqual(JSON.parse(bad.stdout).unsourced.length, 1);

  const open = call(['check-evidence', '--folder', session(t, { 'evidence.md': '# E\n\nStatus: done\n\n```\n- a claim — source: #1\n' })], '/');
  assert.strictEqual(open.code, 1);
  assert.strictEqual(JSON.parse(open.stdout).unclosedFence, true);

  const wip = call(['check-evidence', '--folder', session(t, { 'evidence.md': '# E\n\nStatus: in-progress\n\n- a claim — source: #1\n' })], '/');
  assert.strictEqual(wip.code, 1);
});

test('check-notes passes round N as the expected round and names pending ids', (t) => {
  const ok = call(['check-notes', '--folder', session(t, { 'notes-round-1.md': notes(1) }), '--round', '1'], '/');
  assert.strictEqual(ok.code, 0);
  assert.strictEqual(JSON.parse(ok.stdout).ok, true);
  assert.deepStrictEqual(JSON.parse(ok.stdout).serious, ['1.1']);

  const pending = call(['check-notes', '--folder', session(t, { 'notes-round-1.md': notes(1, { pending: true }) }), '--round', '1'], '/');
  assert.strictEqual(pending.code, 1);
  const p = JSON.parse(pending.stdout);
  assert.deepStrictEqual(p.pending, ['1.1']);
  for (const k of ['serious', 'missingPerspectives', 'malformed']) assert.ok(Array.isArray(p[k]), k);

  const wrong = call(['check-notes', '--folder', session(t, { 'notes-round-2.md': notes(1) }), '--round', '2'], '/');
  assert.strictEqual(wrong.code, 1);
  assert.ok(JSON.parse(wrong.stdout).malformed[0].startsWith('line 1:'));
});

test('brief prints the prompt, and a refusal exits 1 with its reason on stdout', (t) => {
  const dir = session(t);
  const ok = call(['brief', '--folder', dir, '--reader', 'user', '--round', '1'], '/');
  assert.strictEqual(ok.code, 0);
  assert.ok(ok.stdout.includes('the frame') && ok.stdout.includes('board'));

  const builder = call(['brief', '--folder', dir, '--reader', 'builder'], '/');
  assert.strictEqual(builder.code, 0);

  const cap = call(['brief', '--folder', dir, '--reader', 'user', '--round', '5'], '/');
  assert.strictEqual(cap.code, 1);
  assert.strictEqual(JSON.parse(cap.stdout).reason, 'round-cap');

  const stale = call(['brief', '--folder', session(t, { 'notes-round-1.md': notes(1) }), '--reader', 'user', '--round', '2'], '/');
  assert.strictEqual(stale.code, 1);
  assert.strictEqual(JSON.parse(stale.stdout).reason, 'stale-storyboard');

  const pending = call(['brief', '--folder', session(t, { 'notes-round-1.md': notes(1, { pending: true }) }), '--reader', 'user', '--round', '2'], '/');
  assert.strictEqual(JSON.parse(pending.stdout).reason, 'pending-outcomes');

  const noFrame = call(['brief', '--folder', session(t, { 'design.md': '# T\n' }), '--reader', 'user', '--round', '1'], '/');
  assert.strictEqual(JSON.parse(noFrame.stdout).reason, 'no-frame');

  const noBoard = call(['brief', '--folder', session(t, { 'design.md': '# T\n\n## Frame\n\nStatus: done\n\nf\n' }), '--reader', 'user', '--round', '1'], '/');
  assert.strictEqual(JSON.parse(noBoard.stdout).reason, 'no-storyboard');
});

test('malformed invocations exit 2 with a stderr message', (t) => {
  const dir = session(t);
  const cases = [
    [],
    ['nonsense'],
    ['folder'],
    ['folder', '--topic', '!!!', '--root', dir],
    ['status'],
    ['status', '--folder', path.join(dir, 'absent')],
    ['status', '--folder'],
    ['status', '--folder', dir, '--bogus'],
    ['check-evidence', '--folder', scratch(t)],
    ['check-notes', '--folder', dir],
    ['check-notes', '--folder', dir, '--round', '0'],
    ['check-notes', '--folder', dir, '--round', '1'],
    ['brief', '--folder', dir],
    ['brief', '--folder', dir, '--reader', 'user'],
    ['brief', '--folder', dir, '--reader', 'user', '--round', 'x'],
    ['constructor', 'x'],
  ];
  for (const argv of cases) {
    const r = call(argv, '/');
    assert.strictEqual(r.code, 2, JSON.stringify(argv));
    assert.ok(r.stderr.includes('design-session.js:'), JSON.stringify(argv));
  }
});

test('an unknown reader is refused as data', (t) => {
  const r = call(['brief', '--folder', session(t), '--reader', 'nobody', '--round', '1'], '/');
  assert.strictEqual(r.code, 1);
  assert.strictEqual(JSON.parse(r.stdout).reason, 'unknown-reader');
});

test('script entry: shebang, exit code and the real reader-briefs file', (t) => {
  const dir = session(t);
  const r = spawnCli(CLI, ['brief', '--folder', dir, '--reader', 'smallest', '--round', '1'], { env: {} });
  assert.strictEqual(r.code, 0, r.stderr);
  assert.ok(r.stdout.includes('the smallest version that would do'));
  const bad = spawnCli(CLI, ['status'], { env: {} });
  assert.strictEqual(bad.code, 2);
  assert.ok(fs.readFileSync(CLI, 'utf8').startsWith('#!/usr/bin/env node'));
});

test('fix6: --create on any verb but folder is a usage error', (t) => {
  const dir = session(t);
  for (const argv of [['status', '--folder', dir, '--create'], ['check-evidence', '--folder', dir, '--create'],
    ['check-notes', '--folder', dir, '--round', '1', '--create'], ['brief', '--folder', dir, '--reader', 'builder', '--create']]) {
    const r = call(argv, '/');
    assert.strictEqual(r.code, 2, JSON.stringify(argv));
    assert.ok(r.stderr.includes('--create'), JSON.stringify(argv));
  }
});

test('fix1: a symlinked storyboard refuses through the CLI with exit 1', (t) => {
  const dir = session(t);
  const outside = path.join(scratch(t), 'o.md');
  fs.writeFileSync(outside, 'OUTSIDE');
  fs.rmSync(path.join(dir, 'storyboard.md'));
  fs.symlinkSync(outside, path.join(dir, 'storyboard.md'));
  const r = call(['brief', '--folder', dir, '--reader', 'user', '--round', '1'], '/');
  assert.strictEqual(r.code, 1);
  assert.strictEqual(JSON.parse(r.stdout).reason, 'symlink');
  assert.ok(!r.stdout.includes('OUTSIDE'));
});
