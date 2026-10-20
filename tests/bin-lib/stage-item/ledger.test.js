'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { run } = require('../../../plugin/bin/stage-item');
const { splitLedgerRow } = require('../../../plugin/bin/lib/wrap-up/ledger-cells');
const { carryForward, fillLedgerHeader } = require('../../../plugin/bin/lib/stage-item/ledger');
const { skipUnderRoot } = require('../../helpers/root');

// chmod-simulated denials: win32 has no write-denying mode bits, and root ignores them (#1853).
const SKIP_PERMS = process.platform === 'win32' ? 'chmod cannot deny a write on win32' : skipUnderRoot('chmod is ignored under root').skip;

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
  const { deps, err } = fakeDeps(f.main);
  const code = run(ARGS(f), deps);
  assert.equal(code, 3);
  assert.match(err.join(''), /^stage-item\.js: ledger carry-forward degraded — condition: staged write failed for sdd-ruling-1 \(.+\) → fallback: ledger row #2 left open/m);
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

test('a failed ledger append removes the staged file and logs the degraded SKIP', { skip: SKIP_PERMS }, () => {
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


function cfArgs(f, overrides = {}) {
  return {
    runDir: f.runDir, ledgerPath: f.ledgerPath, ledgerRef: LEDGER_REL, id: 'sdd-ruling-1', sourcePath: f.src,
    content: RULING, allocate: true, phase: 'build', item: ITEM, label: 'SDD ruling', section: '/build', now: Date.now(), ...overrides,
  };
}

// A reader whose first call returns the pre-race text and every later call the file as it now is on disk.
function racingReader(staleText) {
  let reads = 0;
  return (p) => { reads += 1; return reads === 1 ? staleText : fs.readFileSync(p, 'utf8'); };
}

test('a row number taken between the read and the append renumbers the owned staged file, appends under the next free number, and keeps the foreign row', () => {
  const f = fixture();
  const stale = f.ledgerText();
  fs.writeFileSync(f.ledgerPath, stale + '| 2 | review | foreign finding | open | — |\n');
  const result = carryForward(cfArgs(f, { readLedger: racingReader(stale) }));
  assert.equal(result.code, 0);
  assert.equal(result.number, 3);
  const staged = fs.readFileSync(path.join(f.runDir, 'staged', 'sdd-ruling-1.md'), 'utf8');
  assert.match(staged, /^Ledger: docs\/plans\/2026-10-20-x-ledger\.md#3$/m);
  assert.equal((staged.match(/^Ledger:/gm) || []).length, 1);
  assert.ok(f.ledgerText().includes('| 2 | review | foreign finding | open | — |'));
  assert.ok(f.ledgerText().includes('| 3 | build | SDD ruling — keep the guard: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |'));
  assert.match(f.decisions(), /^- STAGED \d\d:\d\d:\d\d — SDD ruling carried forward: "keep the guard"\. Stage path: staged\/sdd-ruling-1\.md\. Reversibility: high\.$/m);
  assert.doesNotMatch(f.decisions(), /SKIP/);
});

test('a row taken concurrently AND an unwritable staged header falls back to remove-and-SKIP, keeping the foreign row', { skip: SKIP_PERMS }, () => {
  const f = fixture();
  const stale = f.ledgerText();
  const stagedFile = path.join(f.runDir, 'staged', 'sdd-ruling-1.md');
  let reads = 0;
  const readLedger = (p) => {
    reads += 1;
    if (reads === 1) return stale;
    fs.writeFileSync(f.ledgerPath, stale + '| 2 | review | foreign finding | open | — |\n');
    fs.chmodSync(stagedFile, 0o444);
    return fs.readFileSync(p, 'utf8');
  };
  const foreign = stale + '| 2 | review | foreign finding | open | — |\n';
  const result = carryForward(cfArgs(f, { readLedger }));
  assert.equal(result.code, 3);
  assert.equal(fs.existsSync(stagedFile), false);
  assert.equal(f.ledgerText(), foreign);
  assert.match(f.decisions(), /^- SKIP \d\d:\d\d:\d\d — SDD ruling carry-forward \(degraded\): condition: ledger row #2 in docs\/plans\/2026-10-20-x-ledger\.md was taken concurrently and the staged header could not be renumbered \(.+\) → fallback: staged\/sdd-ruling-1\.md removed; "keep the guard" reaches no console\. Reversibility: n\/a\.$/m);
  assert.doesNotMatch(f.decisions(), /STAGED/);
});

test('a failed removal of the staged file is named in the SKIP, not reported as removed', () => {
  const f = fixture();
  let reads = 0;
  const readLedger = (p) => { reads += 1; if (reads === 2) throw new Error('EIO: second read'); return fs.readFileSync(p, 'utf8'); };
  const unlink = () => { throw new Error('EPERM: nope'); };
  const result = carryForward(cfArgs(f, { readLedger, unlink }));
  assert.equal(result.code, 3);
  assert.equal(fs.existsSync(path.join(f.runDir, 'staged', 'sdd-ruling-1.md')), true);
  assert.match(f.decisions(), /staged\/sdd-ruling-1\.md could NOT be removed \(EPERM: nope\) — delete it by hand; its Ledger: header names no row of this call/);
  assert.doesNotMatch(f.decisions(), /staged\/sdd-ruling-1\.md removed/);
});

test('a failed staged write appends the open row under the next free number when the planned one was taken concurrently', () => {
  const f = fixture();
  fs.writeFileSync(path.join(f.runDir, 'staged'), 'a regular file where the directory should be\n');
  const stale = f.ledgerText();
  fs.writeFileSync(f.ledgerPath, stale + '| 2 | review | foreign finding | open | — |\n');
  const result = carryForward(cfArgs(f, { readLedger: racingReader(stale) }));
  assert.equal(result.code, 3);
  assert.ok(f.ledgerText().includes('| 2 | review | foreign finding | open | — |'));
  assert.ok(f.ledgerText().includes('| 3 | build | SDD ruling — keep the guard: ratify or reverse at the Review Console | open | — |'));
  assert.match(f.decisions(), /condition: staged write failed for sdd-ruling-1 \(.+\) → fallback: ledger row #3 left open with no staged file/);
});

test('an unreadable ledger logs an "unreadable" SKIP, not the "no ledger table" wording, and exits 3 with nothing staged', () => {
  const f = fixture();
  const result = carryForward(cfArgs(f, { readLedger: () => { throw new Error('EIO: boom'); } }));
  assert.equal(result.code, 3);
  assert.equal(fs.existsSync(path.join(f.runDir, 'staged')), false);
  assert.match(f.decisions(), /condition: ledger docs\/plans\/2026-10-20-x-ledger\.md unreadable \(EIO: boom\) → fallback: nothing staged or appended/);
  assert.doesNotMatch(f.decisions(), /no ledger table/);
});

test('both the staged write and the ledger append failing logs one combined SKIP and exits 3', { skip: SKIP_PERMS }, () => {
  const f = fixture();
  fs.writeFileSync(path.join(f.runDir, 'staged'), 'a regular file where the directory should be\n');
  const plans = path.join(f.main, 'docs', 'plans');
  const before = f.ledgerText();
  fs.chmodSync(plans, 0o555);
  let code;
  let err;
  try {
    const d = fakeDeps(f.main);
    code = run(ARGS(f), d.deps);
    err = d.err;
  } finally {
    fs.chmodSync(plans, 0o755);
  }
  assert.equal(code, 3);
  assert.equal(f.ledgerText(), before);
  assert.match(f.decisions(), /^- SKIP \d\d:\d\d:\d\d — SDD ruling carry-forward \(degraded\): condition: staged write failed for sdd-ruling-1 \(.+\) and ledger append to docs\/plans\/2026-10-20-x-ledger\.md failed \(.+\) → fallback: nothing staged or appended; "keep the guard" reaches no console\. Reversibility: n\/a\.$/m);
  assert.match(err.join(''), /ledger carry-forward degraded — condition: staged write failed/);
});

test('--item, --label, --phase or --section without --ledger is a malformed invocation (exit 2), nothing written', () => {
  const f = fixture();
  const before = f.ledgerText();
  const base = ['--run', f.runDir, '--id', 'sdd-ruling-1', '--file', f.src, '--allocate'];
  for (const stray of [['--item', 'x'], ['--label', 'x'], ['--phase', 'build'], ['--section', '/build']]) {
    const { deps, err } = fakeDeps(f.main);
    assert.equal(run([...base, ...stray], deps), 2);
    assert.match(err.join(''), new RegExp(`${stray[0]} requires --ledger`));
  }
  assert.equal(fs.existsSync(path.join(f.runDir, 'staged')), false);
  assert.equal(f.ledgerText(), before);
});

test('--ledger with an empty or valueless --phase or --section is a malformed invocation (exit 2), nothing written', () => {
  const f = fixture();
  const before = f.ledgerText();
  for (const tail of [['--phase', ''], ['--phase'], ['--section', ''], ['--section']]) {
    const { deps, err } = fakeDeps(f.main);
    assert.equal(run(ARGS(f, tail), deps), 2);
    assert.match(err.join(''), new RegExp(`${tail[0]} requires a value`));
  }
  assert.equal(fs.existsSync(path.join(f.runDir, 'staged')), false);
  assert.equal(f.ledgerText(), before);
});

test('--ledger without --allocate is a malformed invocation (exit 2), nothing written', () => {
  const f = fixture();
  const before = f.ledgerText();
  const { deps, err } = fakeDeps(f.main);
  const args = ARGS(f).filter((a) => a !== '--allocate');
  assert.equal(run(args, deps), 2);
  assert.match(err.join(''), /--ledger requires --allocate/);
  assert.equal(fs.existsSync(path.join(f.runDir, 'staged')), false);
  assert.equal(f.ledgerText(), before);
});

function assertRefusedLedger(f, ledger, reasonRe) {
  const before = f.ledgerText();
  assert.equal(before, ledger);
  const { deps, err } = fakeDeps(f.main);
  assert.equal(run(ARGS(f), deps), 3);
  assert.equal(f.ledgerText(), before);
  assert.equal(fs.existsSync(path.join(f.runDir, 'staged')), false);
  assert.match(f.decisions(), /^- SKIP \d\d:\d\d:\d\d — SDD ruling carry-forward \(degraded\): condition: ledger docs\/plans\/2026-10-20-x-ledger\.md cannot take a new row safely/m);
  assert.match(f.decisions(), reasonRe);
  assert.doesNotMatch(f.decisions(), /STAGED/);
  assert.match(err.join(''), /^stage-item\.js: ledger carry-forward degraded — condition: ledger .* cannot take a new row safely/m);
}

test('I3a: a numbered row after a blank line inside the table is never handed out twice — the call refuses (exit 3), ledger byte-unchanged, nothing staged', () => {
  const ledger = LEDGER_HEAD + PRIOR_ROW + '| 2 | review | second | open | — |\n\n| 3 | review | stray row after a blank line | open | — |\n';
  const f = fixture({ ledger });
  assertRefusedLedger(f, ledger, /numbered rows exist outside the contiguous table/);
});

test('I3b: a contiguous table holding two rows with the same number is never collapsed — the call refuses (exit 3), ledger byte-unchanged, nothing staged', () => {
  const ledger = LEDGER_HEAD + PRIOR_ROW + '| 1 | review | duplicate of row one | open | — |\n';
  const f = fixture({ ledger });
  assertRefusedLedger(f, ledger, /duplicate row numbers in the ledger table/);
});

test('M11: a CRLF temp file gets its Ledger: header inside the header block, line endings preserved', () => {
  const f = fixture({ ruling: 'Title: keep the guard\r\nKind: sdd-ruling\r\nRuling: Ruling: keep the guard — cheaper\r\n\r\nratify / reverse\r\n' });
  const { deps } = fakeDeps(f.main);
  assert.equal(run(ARGS(f), deps), 0);
  const staged = fs.readFileSync(path.join(f.runDir, 'staged', 'sdd-ruling-1.md'), 'utf8');
  assert.equal(staged, 'Title: keep the guard\r\nKind: sdd-ruling\r\nRuling: Ruling: keep the guard — cheaper\r\nLedger: docs/plans/2026-10-20-x-ledger.md#2\r\n\r\nratify / reverse\r\n');
  assert.match(f.decisions(), /"keep the guard"\. Stage path/);
});

test('M11: fillLedgerHeader replaces an existing Ledger: line in a CRLF file and keeps its \\r', () => {
  assert.equal(
    fillLedgerHeader('Title: t\r\nLedger: stale#9\r\n\r\nbody\r\n', 'x#2'),
    'Title: t\r\nLedger: x#2\r\n\r\nbody\r\n',
  );
  assert.equal(fillLedgerHeader('Title: t\n\nbody\n', 'x#2'), 'Title: t\nLedger: x#2\n\nbody\n');
});

test('M12: a failed STAGED log write is a stderr warning only — exit 0, row and staged file present', () => {
  const f = fixture();
  fs.mkdirSync(path.join(f.runDir, 'decisions.md'));
  const { deps, err } = fakeDeps(f.main);
  assert.equal(run(ARGS(f), deps), 0);
  assert.ok(fs.existsSync(path.join(f.runDir, 'staged', 'sdd-ruling-1.md')));
  assert.ok(f.ledgerText().includes('(staged/sdd-ruling-1.md) | open | — |'));
  assert.match(err.join(''), /stage-item\.js: warning: could not log STAGED entry to decisions\.md \(.+\)/);
});

test('a degraded exit 3 prints the degraded prefix as the FIRST stderr line, even when its SKIP log write also fails', () => {
  const f = fixture();
  fs.writeFileSync(path.join(f.runDir, 'staged'), 'a regular file where the directory should be\n');
  fs.mkdirSync(path.join(f.runDir, 'decisions.md'));
  const { deps, err } = fakeDeps(f.main);
  assert.equal(run(ARGS(f), deps), 3);
  const lines = err.join('').split('\n').filter(Boolean);
  assert.match(lines[0], /^stage-item\.js: ledger carry-forward degraded — condition: staged write failed/);
  assert.ok(lines.slice(1).some((l) => /^stage-item\.js: warning: could not log SKIP entry/.test(l)), 'the SKIP-log failure warning still follows');
});

test('M12: --phase and --section are honored: the row\'s Phase cell and the decisions.md heading', () => {
  const f = fixture();
  const { deps } = fakeDeps(f.main);
  assert.equal(run(ARGS(f, ['--phase', 'review', '--section', '/wrap-up']), deps), 0);
  assert.ok(f.ledgerText().includes('| 2 | review | SDD ruling — keep the guard: ratify or reverse at the Review Console (staged/sdd-ruling-1.md) | open | — |'));
  assert.match(f.decisions(), /^## \/wrap-up$/m);
  assert.doesNotMatch(f.decisions(), /^## \/build$/m);
  assert.match(f.decisions(), /^- STAGED /m);
});
