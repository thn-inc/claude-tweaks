'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { run } = require('../../../plugin/bin/stage-item');
const { splitLedgerRow } = require('../../../plugin/bin/lib/wrap-up/ledger-cells');

const LEDGER_REL = 'docs/plans/2026-10-20-x-ledger.md';
const LEDGER_HEAD = '# Open Items — x\n\n| # | Phase | Item | Status | Resolution |\n|---|-------|------|--------|------------|\n';
const PRIOR_ROW = '| 1 | review | prior finding | open | — |\n';
const RULING = 'Title: keep the guard\nKind: sdd-ruling\nRuling: Ruling: keep the guard — cheaper\nStaged-at: abc123\n\nratify / reverse\n';
const ITEM = 'SDD ruling — keep the guard: ratify or reverse at the Review Console';

function fixture({ ledger = LEDGER_HEAD + PRIOR_ROW, ruling = RULING } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'siledger-'));
  const main = path.join(root, 'main');
  const runDir = path.join(main, '.claude-tweaks', 'pipelines', 'run-a');
  const shadow = path.join(main, '.claude', 'worktrees', 'flow-spec-12', '.claude-tweaks', 'pipelines', 'run-a');
  fs.mkdirSync(runDir, { recursive: true });
  fs.mkdirSync(shadow, { recursive: true });
  fs.mkdirSync(path.join(main, '.git'));
  fs.writeFileSync(path.join(main, '.claude', 'worktrees', 'flow-spec-12', '.git'), 'gitdir: ../../../.git/worktrees/flow-spec-12\n');
  fs.mkdirSync(path.join(main, 'docs', 'plans'), { recursive: true });
  const ledgerPath = path.join(main, LEDGER_REL);
  fs.writeFileSync(ledgerPath, ledger);
  const src = path.join(main, 'ruling.md');
  fs.writeFileSync(src, ruling);
  return {
    main, runDir, shadow, src, ledgerPath,
    ledgerText: () => fs.readFileSync(ledgerPath, 'utf8'),
    decisions: () => {
      try { return fs.readFileSync(path.join(runDir, 'decisions.md'), 'utf8'); } catch { return ''; }
    },
  };
}

function fakeDeps(cwd) {
  const out = []; const err = [];
  return {
    deps: {
      cwd: () => cwd,
      readFile: (p) => fs.readFileSync(p),
      stdout: (s) => out.push(s),
      stderr: (s) => err.push(s),
    },
    out, err,
  };
}

const ARGS = (f, extra = []) => [
  '--run', f.runDir, '--id', 'sdd-ruling-1', '--file', f.src, '--allocate',
  '--ledger', LEDGER_REL, '--label', 'SDD ruling', '--item', ITEM, ...extra,
];

test('AC2.1: stages sdd-ruling, appends the row it numbers into the Ledger: header, names the path actually written after a reallocation, logs STAGED', () => {
  const f = fixture();
  fs.mkdirSync(path.join(f.runDir, 'staged'));
  fs.writeFileSync(path.join(f.runDir, 'staged', 'sdd-ruling-1.md'), 'occupied\n');
  const { deps, out } = fakeDeps(f.main);
  const code = run(ARGS(f), deps);
  assert.equal(code, 0);
  const staged = fs.readFileSync(path.join(f.runDir, 'staged', 'sdd-ruling-2.md'), 'utf8');
  assert.match(staged, /^Ledger: docs\/plans\/2026-10-20-x-ledger\.md#2$/m);
  assert.equal((staged.match(/^Ledger:/gm) || []).length, 1);
  assert.ok(f.ledgerText().includes('| 2 | build | SDD ruling — keep the guard: ratify or reverse at the Review Console (staged/sdd-ruling-2.md) | open | — |'));
  assert.ok(f.ledgerText().includes('| 1 | review | prior finding | open | — |'));
  assert.equal(out.join('').split('\n')[0], path.join(fs.realpathSync(f.runDir), 'staged', 'sdd-ruling-2.md'));
  assert.match(out.join(''), /--id sdd-ruling-1 already exists in staged\/ — wrote sdd-ruling-2 instead/);
  assert.match(out.join(''), /stage-item\.js: appended ledger row #2 to docs\/plans\/2026-10-20-x-ledger\.md/);
  assert.match(f.decisions(), /^- STAGED \d\d:\d\d:\d\d — SDD ruling carried forward: "keep the guard"\. Stage path: staged\/sdd-ruling-2\.md\. Reversibility: high\.$/m);
  assert.match(f.decisions(), /^## \/build$/m);
});

test('AC2.2: a failed staged write leaves the row open with no (staged/ suffix and logs the degraded SKIP', () => {
  const f = fixture();
  fs.writeFileSync(path.join(f.runDir, 'staged'), 'a regular file where the directory should be\n');
  const { deps } = fakeDeps(f.main);
  const code = run(ARGS(f), deps);
  assert.equal(code, 3);
  assert.ok(f.ledgerText().includes('| 2 | build | SDD ruling — keep the guard: ratify or reverse at the Review Console | open | — |'));
  assert.equal(f.ledgerText().includes('(staged/'), false);
  assert.match(f.decisions(), /^- SKIP \d\d:\d\d:\d\d — SDD ruling carry-forward \(degraded\): condition: staged write failed for sdd-ruling-1 \(.+\) → fallback: ledger row #2 left open with no staged file; the resolve gate drills it\. Reversibility: n\/a\.$/m);
  assert.doesNotMatch(f.decisions(), /STAGED/);
});

test('an empty-table ledger gets item #1', () => {
  const f = fixture({ ledger: LEDGER_HEAD });
  const { deps } = fakeDeps(f.main);
  assert.equal(run(ARGS(f), deps), 0);
  assert.ok(f.ledgerText().includes('| 1 | build | SDD ruling — keep the guard: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |'));
  const staged = fs.readFileSync(path.join(f.runDir, 'staged', 'sdd-ruling-1.md'), 'utf8');
  assert.match(staged, /^Ledger: docs\/plans\/2026-10-20-x-ledger\.md#1$/m);
});

test('escapes | in the Item and collapses a newline, keeping five columns', () => {
  const f = fixture();
  const { deps } = fakeDeps(f.main);
  const args = ARGS(f).map((a) => (a === ITEM ? 'SDD ruling — a|b\nc: ratify or reverse at the Review Console' : a));
  assert.equal(run(args, deps), 0);
  const row = f.ledgerText().split('\n').find((l) => l.startsWith('| 2 |'));
  assert.ok(row.includes('a\\|b c:'));
  assert.equal(splitLedgerRow(row).length, 7);
});

test('replaces an existing Ledger: header line instead of adding a second', () => {
  const f = fixture({ ruling: 'Title: keep the guard\nLedger: stale#9\nKind: sdd-ruling\n\nbody\n' });
  const { deps } = fakeDeps(f.main);
  assert.equal(run(ARGS(f), deps), 0);
  const staged = fs.readFileSync(path.join(f.runDir, 'staged', 'sdd-ruling-1.md'), 'utf8');
  assert.equal((staged.match(/^Ledger:/gm) || []).length, 1);
  assert.match(staged, /^Ledger: docs\/plans\/2026-10-20-x-ledger\.md#2$/m);
  assert.equal(staged.includes('stale#9'), false);
});

test('--ledger without --item or --label, or with --json, is a malformed invocation (exit 2), nothing written', () => {
  const f = fixture();
  const before = f.ledgerText();
  const jsonFile = path.join(f.main, 'sidecar.json');
  fs.writeFileSync(jsonFile, '[]');
  const withoutItem = ARGS(f).filter((a, i, all) => a !== '--item' && all[i - 1] !== '--item');
  const withoutLabel = ARGS(f).filter((a, i, all) => a !== '--label' && all[i - 1] !== '--label');
  const withJson = ARGS(f, ['--json', jsonFile]);
  for (const args of [withoutItem, withoutLabel, withJson]) {
    const { deps } = fakeDeps(f.main);
    assert.equal(run(args, deps), 2);
  }
  assert.equal(fs.existsSync(path.join(f.runDir, 'staged')), false);
  assert.equal(f.ledgerText(), before);
});

test('--ledger naming a non-ledger file or a missing ledger is exit 2, nothing staged', () => {
  const f = fixture();
  fs.writeFileSync(path.join(f.main, 'docs', 'plans', 'notes.md'), 'notes\n');
  for (const bad of ['docs/plans/notes.md', 'docs/plans/missing-ledger.md']) {
    const { deps, err } = fakeDeps(f.main);
    const args = ARGS(f).map((a) => (a === LEDGER_REL ? bad : a));
    assert.equal(run(args, deps), 2);
    assert.match(err.join(''), /stage-item\.js: --ledger .* rejected \(/);
  }
  assert.equal(fs.existsSync(path.join(f.runDir, 'staged')), false);
});

test('a ledger with no table logs a degraded SKIP and exits 3, nothing staged', () => {
  const f = fixture({ ledger: '# Open Items\n\nno table\n' });
  const { deps } = fakeDeps(f.main);
  assert.equal(run(ARGS(f), deps), 3);
  assert.equal(fs.existsSync(path.join(f.runDir, 'staged')), false);
  assert.match(f.decisions(), /SDD ruling carry-forward \(degraded\): condition: ledger .* has no ledger table/);
  assert.equal(f.ledgerText(), '# Open Items\n\nno table\n');
});

test('a worktree-shadow --run with --ledger is refused (exit 3) before the ledger is touched', () => {
  const f = fixture();
  const before = f.ledgerText();
  const { deps } = fakeDeps(f.main);
  const args = ARGS(f).map((a) => (a === f.runDir ? f.shadow : a));
  assert.equal(run(args, deps), 3);
  assert.equal(f.ledgerText(), before);
  assert.equal(fs.existsSync(path.join(f.shadow, 'staged')), false);
});

test('a failed ledger append removes the staged file and logs the degraded SKIP', { skip: process.platform === 'win32' || (process.getuid && process.getuid() === 0) }, () => {
  const f = fixture();
  const plans = path.join(f.main, 'docs', 'plans');
  fs.chmodSync(plans, 0o555);
  let code;
  try {
    const { deps } = fakeDeps(f.main);
    code = run(ARGS(f), deps);
  } finally {
    fs.chmodSync(plans, 0o755);
  }
  assert.equal(code, 3);
  assert.equal(fs.existsSync(path.join(f.runDir, 'staged', 'sdd-ruling-1.md')), false);
  assert.match(f.decisions(), /condition: ledger append to docs\/plans\/2026-10-20-x-ledger\.md failed .* → fallback: staged\/sdd-ruling-1\.md removed/);
  assert.doesNotMatch(f.decisions(), /STAGED/);
});

test('without --ledger, stdout and files are unchanged', () => {
  const f = fixture();
  const before = f.ledgerText();
  const { deps, out, err } = fakeDeps(f.main);
  const code = run(['--run', f.runDir, '--id', 'sdd-ruling-1', '--file', f.src, '--allocate'], deps);
  assert.equal(code, 0);
  assert.deepEqual(out, [path.join(fs.realpathSync(f.runDir), 'staged', 'sdd-ruling-1.md') + '\n']);
  assert.equal(fs.readFileSync(path.join(f.runDir, 'staged', 'sdd-ruling-1.md'), 'utf8'), RULING);
  assert.equal(err.join(''), '');
  assert.equal(fs.existsSync(path.join(f.runDir, 'decisions.md')), false);
  assert.equal(f.ledgerText(), before);
});
