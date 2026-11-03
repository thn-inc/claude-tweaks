'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { run } = require('../../../plugin/bin/stage-item');
const { splitLedgerRow } = require('../../../plugin/bin/lib/wrap-up/ledger-cells');
const {
  carryForward, fillLedgerHeader, checkLedgerStatus, appendRow, settleRow, ledgerLockPath, REFUSED_PROPOSAL_NOTE,
} = require('../../../plugin/bin/lib/stage-item/ledger');
const { flipLedgerRow } = require('../../../plugin/bin/lib/wrap-up/ledger-write');
const { chmodDenialSkip } = require('../../helpers/root');
const { readText } = require('../../helpers/read-skill');

// chmod-simulated denials: win32 has no write-denying mode bits, and root ignores them (#1853).
const SKIP_PERMS = chmodDenialSkip('chmod is ignored under root').skip;

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

// #4439: the plain-row writer behind `hooks.js ledger-row` — validation, locked append, locked settle.
const REPO = { host: 'github.com', owner: 'thn-inc', repo: 'claude-tweaks' };
const row = (n, status, resolution = '—', item = `finding ${n}`) => `| ${n} | build | ${item} | ${status} | ${resolution} |\n`;

// A ledger in a fresh dir whose `run/` subdir is the runDir.
function plainFixture(rows = PRIOR_ROW) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'siledger-plain-'));
  const runDir = path.join(dir, 'run');
  fs.mkdirSync(runDir);
  const ledgerPath = path.join(dir, 'ledger.md');
  fs.writeFileSync(ledgerPath, LEDGER_HEAD + rows);
  return { dir, runDir, ledgerPath, text: () => fs.readFileSync(ledgerPath, 'utf8') };
}

test('checkLedgerStatus refuses an out-of-enum status, naming the enum', () => {
  const { refusal } = checkLedgerStatus('resolved', 'x');
  assert.match(refusal, /invalid status 'resolved'/);
  assert.match(refusal, /open, fixed, deferred, accepted, acknowledged, observation/);
});

test('checkLedgerStatus fixed needs a commit sha or file ref', () => {
  for (const ok of ['abc123', 'Fixed in plugin/bin/x.js', 'see ledger.js', 'see notes.md', 'see plugin/bin/lib']) {
    assert.equal(checkLedgerStatus('fixed', ok).refusal, null, ok);
  }
  // Each negative turns red when its pattern is loosened back: 'facade' (digit-free sha), 'e.g. done' (one-letter extension),
  // 'n/a' and 'and/or' (one-slash path), 'merged in #123456' (a bare #N is never a sha).
  for (const bad of ['done', 'done.', '', 'e.g. done', 'facade', 'n/a', 'and/or', 'merged in #123456']) {
    assert.match(checkLedgerStatus('fixed', bad).refusal, /a commit sha, file reference, or resolving PR/, JSON.stringify(bad));
  }
});

test('checkLedgerStatus fixed accepts a resolving PR, never a bare #N or an issue URL', () => {
  const pr = 'https://github.com/thn-inc/claude-tweaks/pull/4712';
  for (const ok of ['fixed — merged in PR #4712', `merged in ${pr}`, `merged in ${pr}/files`, `merged in ${pr.replace('thn-inc', 'THN-Inc')}`]) {
    assert.equal(checkLedgerStatus('fixed', ok, { repo: REPO }).refusal, null, ok);
  }
  for (const bad of ['fixed — merged in #4712', 'https://github.com/thn-inc/claude-tweaks/issues/4712', 'https://github.com/other/repo/pull/4712']) {
    const { refusal } = checkLedgerStatus('fixed', bad, { repo: REPO });
    assert.match(refusal, /a commit sha, file reference, or resolving PR/, bad);
    assert.doesNotMatch(refusal, /origin repo unresolvable/, bad);
  }
  // The URL span carries the prose punctuation around it; trailing punctuation is trimmed before the /pull/N match.
  for (const ok of [`\`${pr}\``, `(${pr})`, `merged in ${pr}.`, `see ${pr}, then`, `<${pr}>`]) {
    assert.equal(checkLedgerStatus('fixed', ok, { repo: REPO }).refusal, null, ok);
  }
  assert.match(checkLedgerStatus('fixed', 'merged in https://github.com/other/repo/pull/4712.', { repo: REPO }).refusal, /resolving PR/);
  const unresolved = checkLedgerStatus('fixed', pr, { repo: null }).refusal;
  assert.match(unresolved, /origin repo unresolvable/);
  assert.match(unresolved, /PR #N/);
  assert.equal(checkLedgerStatus('fixed', 'fixed — merged in PR #4712', { repo: null }).refusal, null);
});

test("checkLedgerStatus fixed accepts this repo's own /commit/<sha> and /blob/<ref>/<path> URLs, as it does /pull/N", () => {
  const own = 'https://github.com/thn-inc/claude-tweaks';
  const sha = '1d3757a5a9c75ded39a8544affe52fc3fc91cd40';
  const ok = [
    `${own}/commit/${sha}`, `${own}/commit/${sha.slice(0, 7)}`, `${own}/commit/${sha}/files`, `${own}/commit/${sha}#diff`,
    `${own}/commit/${sha.toUpperCase()}`, `${own}/blob/main/plugin/bin/hooks.js`, `${own}/blob/${sha}/plugin/bin/hooks.js#L10-L20`,
    `${own}/blob/main/README`, `${own}/blob/main/docs/a.md?plain=1`,
    `merged in ${own}/commit/${sha}`, `\`${own}/commit/${sha}\``, `(${own}/blob/main/plugin/bin/hooks.js)`, `see ${own}/commit/${sha}.`,
    `${own.replace('thn-inc', 'THN-Inc')}/commit/${sha}`, `${own.replace('github.com', 'GitHub.com')}/blob/main/x/y`, `http://github.com/thn-inc/claude-tweaks/commit/${sha}`,
    // Each URL span is matched on its own: the other repo's URL beside it does not decide the verdict.
    `https://github.com/other/repo/commit/${sha} and ${own}/commit/${sha}`, `${own}/commit/${sha} and https://github.com/other/repo/blob/main/x/y`,
  ];
  for (const text of ok) assert.equal(checkLedgerStatus('fixed', text, { repo: REPO }).refusal, null, text);
  // Each refusal fixture turns red when its owner, repo, host or shape check is dropped: another repo, another host, a
  // sibling repo name sharing the prefix, a non-hex or too-short sha, and the URL shapes that name no commit or file.
  const other = 'https://github.com/other/repo';
  const bad = [
    `${other}/commit/${sha}`, `${other}/blob/main/plugin/bin/hooks.js`, `https://github.com/thn-inc/other/commit/${sha}`, `https://github.com/other/claude-tweaks/blob/main/x/y`,
    `https://github.com/thn-inc/claude-tweaks-fork/commit/${sha}`, `https://gitlab.com/thn-inc/claude-tweaks/commit/${sha}`, `https://github.com.evil.io/thn-inc/claude-tweaks/blob/main/x/y`,
    `${own}/commit/${'z'.repeat(40)}`, `${own}/commit/abc12`, `${own}/commit/${sha}0000000000`, `${own}/commit/`, `${own}/commits/${sha}`,
    `${own}/blob/main`, `${own}/blob/main/`, `${own}/tree/main/plugin/bin`, `${own}/issues/12`, `${own}/compare/main...x`,
    `${other}/commit/${sha} and ${other}/blob/main/x/y`, `merged in ${other}/commit/${sha}.`,
  ];
  for (const text of bad) {
    const { refusal } = checkLedgerStatus('fixed', text, { repo: REPO });
    assert.match(refusal, /a commit sha, file reference, or resolving PR/, text);
    assert.doesNotMatch(refusal, /origin repo unresolvable/, text);
  }
  // origin unresolvable: no URL can be matched to it, and the refusal says so.
  for (const text of [`${own}/commit/${sha}`, `${own}/blob/main/plugin/bin/hooks.js`]) {
    const { refusal } = checkLedgerStatus('fixed', text, { repo: null });
    assert.match(refusal, /origin repo unresolvable/, text);
    assert.match(refusal, /PR #N/, text);
  }
});

test('checkLedgerStatus fixed refuses adversarial resolutions (verdict only; timing belongs in perf/)', () => {
  assert.match(checkLedgerStatus('fixed', 'a'.repeat(200000)).refusal, /commit sha/);
  assert.match(checkLedgerStatus('fixed', `a${' '.repeat(200000)}b`).refusal, /commit sha/);
  assert.match(checkLedgerStatus('fixed', '/'.repeat(5000)).refusal, /commit sha/);
  // The /commit/ and /blob/ URL shapes: a long ref, a long segment run before the shape, a long hex run.
  const own = 'https://github.com/thn-inc/claude-tweaks';
  assert.match(checkLedgerStatus('fixed', `${own}/blob/${'a'.repeat(200000)}`, { repo: REPO }).refusal, /commit sha/);
  assert.match(checkLedgerStatus('fixed', `https://github.com/${'a/'.repeat(100000)}blob/x/y`, { repo: REPO }).refusal, /commit sha/);
  assert.match(checkLedgerStatus('fixed', `${own}/commit/${'a'.repeat(200000)}`, { repo: REPO }).refusal, /commit sha/);
});

test('checkLedgerStatus deferred: staged path or record reference is complete', () => {
  for (const ok of ['staged/ledger-record-a.md', '#77', 'https://github.com/o/r/issues/7']) {
    assert.deepEqual(checkLedgerStatus('deferred', ok), { refusal: null, incompleteDeferral: false }, ok);
  }
});

test('checkLedgerStatus deferred: a Defer-reason alone is incomplete but accepted', () => {
  assert.deepEqual(checkLedgerStatus('deferred', 'Defer-reason: tangential'), { refusal: null, incompleteDeferral: true });
});

test('checkLedgerStatus deferred: neither is refused, naming the rule', () => {
  for (const bad of ['later', 'Defer-reason: tangential Defer-reason: tangential', 'Defer-reason: because']) {
    const { refusal } = checkLedgerStatus('deferred', bad);
    assert.match(refusal, /staged\//, bad);
    assert.match(refusal, /Defer-reason:/, bad);
  }
});

test("checkLedgerStatus deferred: the run's own record is not a reference", () => {
  assert.notEqual(checkLedgerStatus('deferred', 'see #5', { excludeRecords: [5] }).refusal, null);
  assert.equal(checkLedgerStatus('deferred', 'see #5', { excludeRecords: [] }).refusal, null);
});

test('checkLedgerStatus accepted/acknowledged need a reason; open/observation do not', () => {
  for (const s of ['accepted', 'acknowledged']) {
    assert.match(checkLedgerStatus(s, '  ').refusal, /resolution/i);
    assert.equal(checkLedgerStatus(s, 'ratified').refusal, null);
  }
  for (const s of ['open', 'observation']) assert.deepEqual(checkLedgerStatus(s, ''), { refusal: null, incompleteDeferral: false });
});

test('appendRow appends the next row with an escaped pipe and a resolution', () => {
  const f = plainFixture();
  assert.deepEqual(appendRow({ runDir: f.runDir, ledgerPath: f.ledgerPath, phase: 'build', item: 'a | b', status: 'open' }), { number: 2 });
  assert.equal(f.text(), LEDGER_HEAD + PRIOR_ROW + '| 2 | build | a \\| b | open | — |\n');
  assert.equal(fs.existsSync(path.join(f.runDir, '.ledger.lock')), false);
});

test('appendRow writes a given resolution through the cell codec', () => {
  const f = plainFixture();
  appendRow({ runDir: f.runDir, ledgerPath: f.ledgerPath, phase: 'build', item: 'x', status: 'fixed', resolution: 'a | b' });
  assert.ok(f.text().includes('| 2 | build | x | fixed | a \\| b |'));
});

test('appendRow collapses a newline in item and resolution', () => {
  const f = plainFixture();
  appendRow({ runDir: f.runDir, ledgerPath: f.ledgerPath, phase: 'build', item: 'x\ny', status: 'fixed', resolution: 'abc1234\nmore' });
  assert.ok(f.text().includes('| 2 | build | x y | fixed | abc1234 more |'));
  assert.equal(f.text().split('\n').filter((l) => /^\| 2 \|/.test(l)).length, 1);
});

test('appendRow refuses a held lock (failClosed)', () => {
  const f = plainFixture();
  const lock = ledgerLockPath(f.runDir);
  fs.mkdirSync(lock);
  fs.writeFileSync(path.join(lock, '.owner'), `${process.pid}-held`);
  const before = f.text();
  const prior = process.env.CLAUDE_TWEAKS_LOCK_WAIT_MS;
  process.env.CLAUDE_TWEAKS_LOCK_WAIT_MS = '30';
  try {
    assert.throws(() => appendRow({ runDir: f.runDir, ledgerPath: f.ledgerPath, phase: 'build', item: 'x', status: 'open' }), (e) => e.code === 'LOCK_TIMEOUT');
  } finally {
    if (prior === undefined) delete process.env.CLAUDE_TWEAKS_LOCK_WAIT_MS; else process.env.CLAUDE_TWEAKS_LOCK_WAIT_MS = prior;
  }
  assert.equal(f.text(), before);
});

test('AC3: a second append attempted between the first call\'s read and its write is refused while the lock is held, and no row is lost', () => {
  const f = plainFixture();
  const prior = process.env.CLAUDE_TWEAKS_LOCK_WAIT_MS;
  process.env.CLAUDE_TWEAKS_LOCK_WAIT_MS = '30';
  let interleaved = null;
  let first;
  try {
    first = appendRow({
      runDir: f.runDir,
      ledgerPath: f.ledgerPath,
      phase: 'build',
      item: 'first',
      status: 'open',
      // The first call has read the ledger and not yet written: the second writer arrives now.
      readLedger: (p) => {
        const text = fs.readFileSync(p, 'utf8');
        try {
          appendRow({ runDir: f.runDir, ledgerPath: f.ledgerPath, phase: 'build', item: 'second', status: 'open' });
        } catch (err) {
          interleaved = err;
        }
        return text;
      },
    });
  } finally {
    if (prior === undefined) delete process.env.CLAUDE_TWEAKS_LOCK_WAIT_MS; else process.env.CLAUDE_TWEAKS_LOCK_WAIT_MS = prior;
  }
  assert.ok(interleaved, 'the interleaved append must not get the lock while the first call holds it');
  assert.equal(interleaved.code, 'LOCK_TIMEOUT');
  assert.deepEqual(first, { number: 2 });
  assert.equal(f.text(), LEDGER_HEAD + PRIOR_ROW + '| 2 | build | first | open | — |\n');
  // The refused writer retries once the lock is free and takes the next row: neither row is lost.
  assert.deepEqual(appendRow({ runDir: f.runDir, ledgerPath: f.ledgerPath, phase: 'build', item: 'second', status: 'open' }), { number: 3 });
  assert.equal(f.text(), LEDGER_HEAD + PRIOR_ROW + '| 2 | build | first | open | — |\n| 3 | build | second | open | — |\n');
});

test('appendRow throws on an unreadable ledger and on a ledger with no table', () => {
  const f = plainFixture();
  assert.throws(() => appendRow({ runDir: f.runDir, ledgerPath: path.join(f.dir, 'nope.md'), phase: 'build', item: 'x', status: 'open' }), /ENOENT/);
  fs.writeFileSync(f.ledgerPath, 'no table here\n');
  assert.throws(() => appendRow({ runDir: f.runDir, ledgerPath: f.ledgerPath, phase: 'build', item: 'x', status: 'open' }), /no ledger table/);
  assert.equal(fs.existsSync(path.join(f.runDir, '.ledger.lock')), false);
});

test("AC2.1: settleRow rewrites only the named row's Status and Resolution", () => {
  const f = plainFixture(row(1, 'open') + row(2, 'open') + row(3, 'open'));
  const before = f.text();
  assert.deepEqual(settleRow({ runDir: f.runDir, ledgerPath: f.ledgerPath, row: 3, status: 'fixed', resolution: 'abc123' }), { number: 3 });
  assert.equal(f.text(), before.replace('| 3 | build | finding 3 | open | — |', '| 3 | build | finding 3 | fixed | abc123 |'));
  assert.equal(fs.existsSync(path.join(f.runDir, '.ledger.lock')), false);
});

test('settleRow refuses a terminal row, naming the row and status', () => {
  const complete = { fixed: 'abc123', deferred: 'staged/a.md', accepted: 'ok', acknowledged: 'seen', observation: 'note' };
  for (const [status, resolution] of Object.entries(complete)) {
    const f = plainFixture(row(1, status, resolution));
    const before = f.text();
    assert.throws(() => settleRow({ runDir: f.runDir, ledgerPath: f.ledgerPath, row: 1, status: 'accepted', resolution: 'again' }),
      new RegExp(`row #1 is already ${status} \\(terminal\\)`), status);
    assert.equal(f.text(), before, status);
  }
});

test('settleRow settles an incomplete deferral to any terminal status', () => {
  const f = plainFixture(row(1, 'deferred', 'Defer-reason: tangential'));
  settleRow({ runDir: f.runDir, ledgerPath: f.ledgerPath, row: 1, status: 'fixed', resolution: 'abc123' });
  assert.ok(f.text().includes('| 1 | build | finding 1 | fixed | abc123 |'));
});

test("settleRow treats the run's own record as incomplete", () => {
  const f = plainFixture(row(1, 'deferred', 'see #5'));
  const before = f.text();
  assert.throws(() => settleRow({ runDir: f.runDir, ledgerPath: f.ledgerPath, row: 1, status: 'accepted', resolution: 'ok', excludeRecords: [] }), /already deferred/);
  assert.equal(f.text(), before);
  settleRow({ runDir: f.runDir, ledgerPath: f.ledgerPath, row: 1, status: 'accepted', resolution: 'ok', excludeRecords: [5] });
  assert.ok(f.text().includes('| 1 | build | finding 1 | accepted | ok |'));
});

test('settleRow to open: open row keeps open with a new Resolution', () => {
  const f = plainFixture(row(1, 'open'));
  settleRow({ runDir: f.runDir, ledgerPath: f.ledgerPath, row: 1, status: 'open', resolution: 'still looking' });
  assert.ok(f.text().includes('| 1 | build | finding 1 | open | still looking |'));
});

test('settleRow to open: the refused-proposal reopen', () => {
  for (const staged of ['staged/ledger-record-a.md', 'spec-2/staged/review-followup-1.md']) {
    const f = plainFixture(row(1, 'deferred', `\`${staged}\``));
    const note = `\`${staged}\` refused at the console — ${REFUSED_PROPOSAL_NOTE}`;
    settleRow({ runDir: f.runDir, ledgerPath: f.ledgerPath, row: 1, status: 'open', resolution: note });
    assert.ok(f.text().includes(`| 1 | build | finding 1 | open | ${note} |`), staged);
  }
});

test('settleRow to open: the reopen without the note is refused', () => {
  const f = plainFixture(row(1, 'deferred', '`staged/ledger-record-a.md`'));
  const before = f.text();
  assert.throws(() => settleRow({ runDir: f.runDir, ledgerPath: f.ledgerPath, row: 1, status: 'open', resolution: 'reopened' }), /proposal refused — no defer reason/);
  assert.equal(f.text(), before);
});

test('settleRow to open: refused from fixed, from a deferred row with no staged path, and from accepted/acknowledged/observation', () => {
  const note = `x — ${REFUSED_PROPOSAL_NOTE}`;
  const cases = [['fixed', 'abc123'], ['deferred', 'Defer-reason: tangential'], ['deferred', '#77'], ['accepted', 'ok'], ['acknowledged', 'seen'], ['observation', 'note'],
    // A staged path alone is not the reopen: only a `deferred` row may take it (deleting the `current === 'deferred'` conjunct turns these red).
    ['fixed', 'staged/a.md'], ['accepted', 'staged/a.md'], ['acknowledged', 'staged/a.md'], ['observation', 'staged/a.md']];
  for (const [status, resolution] of cases) {
    const f = plainFixture(row(1, status, resolution));
    const before = f.text();
    assert.throws(() => settleRow({ runDir: f.runDir, ledgerPath: f.ledgerPath, row: 1, status: 'open', resolution: note }),
      new RegExp(`row #1 is ${status}; only an open row`), `${status} / ${resolution}`);
    assert.equal(f.text(), before);
  }
});

test('REFUSED_PROPOSAL_NOTE matches refused-proposals.md', () => {
  const doc = readText(path.join(__dirname, '../../../plugin/skills/wrap-up/refused-proposals.md'));
  const assertNote = (text) => assert.ok(text.includes(`\`${REFUSED_PROPOSAL_NOTE}\``), 'refused-proposals.md does not carry the note');
  assertNote(doc);
  const hyphen = doc.split(REFUSED_PROPOSAL_NOTE).join(REFUSED_PROPOSAL_NOTE.replace('—', '-'));
  assert.notEqual(hyphen, doc);
  assert.throws(() => assertNote(hyphen), /does not carry the note/);
});

test('settleRow renders an empty current Status as (empty) in its refusals', () => {
  const f = plainFixture(row(1, ''));
  assert.throws(() => settleRow({ runDir: f.runDir, ledgerPath: f.ledgerPath, row: 1, status: 'open', resolution: 'x' }), /row #1 is \(empty\); only an open row/);
  settleRow({ runDir: f.runDir, ledgerPath: f.ledgerPath, row: 1, status: 'accepted', resolution: 'ok' });
  assert.ok(f.text().includes('| 1 | build | finding 1 | accepted | ok |'));
});

test('settleRow settles an out-of-enum current status', () => {
  const f = plainFixture(row(1, 'resolved', 'x'));
  settleRow({ runDir: f.runDir, ledgerPath: f.ledgerPath, row: 1, status: 'accepted', resolution: 'ok' });
  assert.ok(f.text().includes('| 1 | build | finding 1 | accepted | ok |'));
});

test('settleRow throws for a missing row and for a raw-pipe row, writing nothing', () => {
  const f = plainFixture(row(1, 'open') + '| 2 | build | a | b | open | — |\n');
  const before = f.text();
  for (const status of ['fixed', 'open']) {
    assert.throws(() => settleRow({ runDir: f.runDir, ledgerPath: f.ledgerPath, row: 9, status, resolution: 'abc123' }),
      (e) => !(e instanceof TypeError) && /no ledger row for item #9/.test(e.message), status);
    assert.throws(() => settleRow({ runDir: f.runDir, ledgerPath: f.ledgerPath, row: 2, status, resolution: 'abc123' }),
      (e) => !(e instanceof TypeError) && /5-column/.test(e.message), status);
  }
  assert.equal(f.text(), before);
});

test('flipLedgerRow still refuses open', () => {
  assert.throws(() => flipLedgerRow(LEDGER_HEAD + PRIOR_ROW, { item: 1, status: 'open', resolution: 'x' }), /invalid status 'open'/);
});

test('ledgerLockPath is the carryForward lock', () => {
  assert.equal(ledgerLockPath('/r'), path.join('/r', '.ledger.lock'));
});
