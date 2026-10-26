'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { run } = require('../../../plugin/bin/console-residue');
const { writeFileAtomic } = require('../../../plugin/bin/lib/atomic-write');
const { CONSOLE_LOCK, rewriteItemResolution } = require('../../../plugin/bin/lib/console/item-resolution');

const NOW = Date.parse('2026-10-17T12:00:00.000Z');

// The unresolved shape of the real archived #2821 console (#3370).
const CONSOLE_2821 = {
  resolved: true,
  mode: 'auto-resolve',
  at: '2026-10-16T23:08:06.188Z',
  ceiling: 'unattended',
  items: [
    { id: 'ledger-record-brief-marker-multispec.md', section: 'Queue writes', resolution: 'apply', reason: 'pre-checked Apply default (batched-item-drill.md)' },
    { id: 'reflect-1.md', section: 'Pending review', resolution: 'pending', reason: 'non-tangential-category:convention' },
    { id: 'review-13-record.md', section: 'Pending review', resolution: 'pending', reason: 'unmapped-prefix' },
    { id: 'review-debate-deviation.md', section: 'Contested findings', resolution: 'keep-staged', reason: 'debate inconclusive — no Approve-all default; never auto-applied' },
    { id: 'skills:undefined', section: 'Skill updates', resolution: 'applied', reason: 'applied (939fe9aac)' },
    { id: 'decision:STAGED 01:00:20 — Step 3: full mode (wrap-up): pattern obs', section: 'Contested findings', resolution: 'keep-staged', reason: 'debate inconclusive — no Approve-all default; never auto-applied' },
  ],
  merge: { resolution: 'leave-open', reason: '#2821 lacks auto:merge' },
};

const RUN_2821 = '2026-10-16T210949-spec-2821';

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rescli-'));
  const main = path.join(root, 'main');
  fs.mkdirSync(path.join(main, '.git'), { recursive: true });
  const archive = path.join(main, '.claude-tweaks', 'pipelines', 'archive');
  const runDir = path.join(archive, RUN_2821);
  fs.mkdirSync(runDir, { recursive: true });
  const consolePath = path.join(runDir, 'console.json');
  fs.writeFileSync(consolePath, `${JSON.stringify(CONSOLE_2821, null, 2)}\n`);
  // #3772: an unresolved item whose staged file is gone is `missing`, not residue.
  fs.mkdirSync(path.join(runDir, 'staged'));
  for (const id of ['reflect-1.md', 'review-13-record.md', 'review-debate-deviation.md']) fs.writeFileSync(path.join(runDir, 'staged', id), 'x');
  return { root, main, archive, runDir, consolePath };
}

function harness(main) {
  const out = []; const err = [];
  return {
    deps: {
      cwd: () => main, mainRoot: main, now: () => NOW, pluginRoot: '/plug',
      stdout: (s) => out.push(s), stderr: (s) => err.push(s),
    },
    out: () => out.join(''), err: () => err.join(''),
  };
}

test('--run prints the residue block naming all four unresolved items', () => {
  const f = fixture();
  const h = harness(f.main);
  assert.strictEqual(run(['--run', f.runDir], h.deps), 0);
  const text = h.out();
  for (const needle of ['review-13-record.md', 'review-debate-deviation.md', 'reflect-1.md', 'console-residue.js" --ack --run']) {
    assert.ok(text.includes(needle), `missing ${needle} in:\n${text}`);
  }
  assert.strictEqual(h.err(), '');
});

test('AC3.5: console-residue.js --run does not count a missing-file item (#3772)', () => {
  const f = fixture();
  fs.unlinkSync(path.join(f.runDir, 'staged', 'reflect-1.md'));
  const h = harness(f.main);
  assert.strictEqual(run(['--run', f.runDir], h.deps), 0);
  const lines = h.out().split('\n');
  assert.strictEqual(lines[0], `- ${RUN_2821}: 3 item(s) no human has reviewed (console.json)`);
  const notCounted = lines.filter((l) => l.startsWith('  not counted — '));
  assert.strictEqual(notCounted.length, 1, h.out());
  assert.ok(notCounted[0].includes(path.join('staged', 'reflect-1.md')), notCounted[0]);
  assert.ok(!lines.some((l) => l.startsWith('  - reflect-1.md')), h.out());
});

test('console-residue.js --run names the missing items of a spec console that has no present items (#3772)', () => {
  const f = fixture();
  fs.mkdirSync(path.join(f.runDir, 'spec-2'));
  fs.writeFileSync(path.join(f.runDir, 'spec-2', 'console.json'), JSON.stringify({ items: [{ id: 'wrap-up-docs-2.md', section: 'Pending review', resolution: 'pending', reason: 'r' }] }));
  const h = harness(f.main);
  assert.strictEqual(run(['--run', f.runDir], h.deps), 0);
  const notCounted = h.out().split('\n').filter((l) => l.startsWith('  not counted — '));
  assert.strictEqual(notCounted.length, 1, h.out());
  assert.ok(notCounted[0].includes(path.join('spec-2', 'staged', 'wrap-up-docs-2.md')), notCounted[0]);
});

test('--ack writes residueAcknowledgedAt and keeps every other field', () => {
  const f = fixture();
  const h = harness(f.main);
  assert.strictEqual(run(['--ack', '--run', f.runDir], h.deps), 0);
  assert.match(h.out(), new RegExp(`claude-tweaks: marked 1 console\\(s\\) reviewed for ${RUN_2821}`));
  const written = JSON.parse(fs.readFileSync(f.consolePath, 'utf8'));
  assert.strictEqual(written.residueAcknowledgedAt, '2026-10-17T12:00:00.000Z');
  const { residueAcknowledgedAt, ...rest } = written;
  assert.deepStrictEqual(rest, CONSOLE_2821);
  const again = harness(f.main);
  assert.strictEqual(run(['--run', f.runDir], again.deps), 0);
  assert.strictEqual(again.out(), '');
});

test('--ack never rewrites an already-acknowledged console', () => {
  const f = fixture();
  const first = harness(f.main);
  run(['--ack', '--run', f.runDir], first.deps);
  const before = fs.readFileSync(f.consolePath, 'utf8');
  const later = harness(f.main);
  later.deps.now = () => NOW + 86400000;
  assert.strictEqual(run(['--ack', '--run', f.runDir], later.deps), 0);
  assert.match(later.out(), /marked 0 console\(s\) reviewed for/);
  assert.strictEqual(fs.readFileSync(f.consolePath, 'utf8'), before);
});

test('--ack never rewrites an unparseable console.json', () => {
  const f = fixture();
  const garbage = '{ not json';
  fs.writeFileSync(f.consolePath, garbage);
  const h = harness(f.main);
  assert.strictEqual(run(['--ack', '--run', f.runDir], h.deps), 0);
  assert.strictEqual(fs.readFileSync(f.consolePath, 'utf8'), garbage);
});

test('--ack skips a console that stops parsing between the scan and the write', () => {
  const f = fixture();
  const garbage = '{ changed';
  const h = harness(f.main);
  h.deps.readFile = (p) => { fs.writeFileSync(p, garbage); return garbage; };
  assert.strictEqual(run(['--ack', '--run', f.runDir], h.deps), 0);
  assert.strictEqual(fs.readFileSync(f.consolePath, 'utf8'), garbage);
  assert.match(h.out(), /marked 0 console\(s\)/);
});

test('--ack covers spec-*/console.json', () => {
  const f = fixture();
  fs.unlinkSync(f.consolePath);
  const specDir = path.join(f.runDir, 'spec-9');
  fs.mkdirSync(specDir);
  const specConsole = path.join(specDir, 'console.json');
  fs.writeFileSync(specConsole, JSON.stringify(CONSOLE_2821));
  const h = harness(f.main);
  assert.strictEqual(run(['--ack', '--run', f.runDir], h.deps), 0);
  assert.strictEqual(JSON.parse(fs.readFileSync(specConsole, 'utf8')).residueAcknowledgedAt, '2026-10-17T12:00:00.000Z');
});

test('exit 2 on --ack without --run, an unknown flag, a valueless --run, or --ack-all with --run', () => {
  const f = fixture();
  for (const argv of [['--ack'], ['--bogus'], ['--run'], ['--ack-all', '--run', f.runDir], []]) {
    const h = harness(f.main);
    assert.strictEqual(run(argv, h.deps), 2, argv.join(' '));
    assert.match(h.err(), /usage: console-residue\.js/);
  }
});

test('exit 3 on a run dir outside the main checkout and on a missing run dir', () => {
  const f = fixture();
  const outside = path.join(f.root, 'elsewhere', RUN_2821);
  fs.mkdirSync(outside, { recursive: true });
  fs.writeFileSync(path.join(outside, 'console.json'), JSON.stringify(CONSOLE_2821));
  const h = harness(f.main);
  assert.strictEqual(run(['--ack', '--run', outside], h.deps), 3);
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(outside, 'console.json'), 'utf8')).residueAcknowledgedAt, undefined);
  const missing = harness(f.main);
  assert.strictEqual(run(['--run', path.join(f.archive, 'nope')], missing.deps), 3);
});

test('--ack-all marks every unacknowledged run', () => {
  const f = fixture();
  const second = path.join(f.archive, '2026-10-15T100000-spec-1');
  fs.mkdirSync(second);
  fs.writeFileSync(path.join(second, 'console.json'), JSON.stringify(CONSOLE_2821));
  const h = harness(f.main);
  assert.strictEqual(run(['--ack-all'], h.deps), 0);
  assert.match(h.out(), /claude-tweaks: marked 2 console\(s\) reviewed across 2 run\(s\)/);
  for (const p of [f.consolePath, path.join(second, 'console.json')]) {
    assert.strictEqual(JSON.parse(fs.readFileSync(p, 'utf8')).residueAcknowledgedAt, '2026-10-17T12:00:00.000Z');
  }
  const again = harness(f.main);
  assert.strictEqual(run(['--ack-all'], again.deps), 0);
  assert.match(again.out(), /marked 0 console\(s\) reviewed across 0 run\(s\)/);
});

// #3370 I4: a --run path printed before the run was archived.
const MOVED = new RegExp(`^console-residue\\.js: .*[\\\\/]pipelines[\\\\/]${RUN_2821} has moved to .*[\\\\/]pipelines[\\\\/]archive[\\\\/]${RUN_2821} — using the archived copy\\n$`);

test('--run given the pre-archive path prints the archived copy\'s residue with one stderr note', () => {
  const f = fixture();
  const preArchive = path.join(f.main, '.claude-tweaks', 'pipelines', RUN_2821);
  const h = harness(f.main);
  assert.strictEqual(run(['--run', preArchive], h.deps), 0);
  assert.ok(h.out().includes('review-13-record.md'), h.out());
  assert.ok(h.out().includes(`--ack --run "${fs.realpathSync(f.runDir)}"`), h.out());
  assert.match(h.err(), MOVED);
});

test('--ack given the pre-archive path acknowledges the archived copy, mainRoot derived from cwd', () => {
  const f = fixture();
  const preArchive = path.join(f.main, '.claude-tweaks', 'pipelines', RUN_2821);
  const h = harness(f.main);
  delete h.deps.mainRoot;
  assert.strictEqual(run(['--ack', '--run', preArchive], h.deps), 0);
  assert.match(h.out(), new RegExp(`marked 1 console\\(s\\) reviewed for ${RUN_2821}`));
  assert.match(h.err(), MOVED);
  assert.strictEqual(JSON.parse(fs.readFileSync(f.consolePath, 'utf8')).residueAcknowledgedAt, '2026-10-17T12:00:00.000Z');
});

test('--run whose basename is in neither place still exits 3 with no moved note', () => {
  const f = fixture();
  const h = harness(f.main);
  assert.strictEqual(run(['--run', path.join(f.main, '.claude-tweaks', 'pipelines', '2026-01-01T000000-spec-0')], h.deps), 3);
  assert.doesNotMatch(h.err(), /has moved to/);
});

test('--ack-all reaches runs beyond the SessionStart scan window (#3370 F1)', () => {
  const f = fixture();
  const { SCAN_WINDOW } = require('../../../plugin/bin/lib/hooks/session-residue');
  const extra = SCAN_WINDOW + 5;
  for (let i = 1; i <= extra; i++) {
    const dir = path.join(f.archive, `2026-01-01T${String(i).padStart(6, '0')}-spec-${i}`);
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 'console.json'), JSON.stringify(CONSOLE_2821));
  }
  const h = harness(f.main);
  assert.strictEqual(run(['--ack-all'], h.deps), 0);
  assert.match(h.out(), new RegExp(`marked ${extra + 1} console\\(s\\) reviewed across ${extra + 1} run\\(s\\)`));
  const oldest = path.join(f.archive, '2026-01-01T000001-spec-1', 'console.json');
  assert.strictEqual(JSON.parse(fs.readFileSync(oldest, 'utf8')).residueAcknowledgedAt, '2026-10-17T12:00:00.000Z');
});

// A write that throws (unwritable file, or the run dir moved under a concurrent
// archival) maps to exit 3 with the path named — never an uncaught stack, exit 1.
test('--ack exits 3 naming the file when the write throws, and leaves console.json untouched', () => {
  const f = fixture();
  const before = fs.readFileSync(f.consolePath, 'utf8');
  const h = harness(f.main);
  h.deps.writeFile = () => { throw new Error('EACCES: permission denied'); };
  assert.strictEqual(run(['--ack', '--run', f.runDir], h.deps), 3);
  assert.ok(h.err().includes(`could not write ${fs.realpathSync(f.consolePath)}: EACCES: permission denied`), h.err());
  assert.match(h.out(), /marked 0 console\(s\) reviewed for .*\(1 could not be written\)/);
  assert.strictEqual(fs.readFileSync(f.consolePath, 'utf8'), before);
});

test('--ack of a console whose directory moved after the scan fails without recreating the directory (#4170)', () => {
  const f = fixture();
  const spec2 = path.join(f.runDir, 'spec-2');
  fs.mkdirSync(path.join(spec2, 'staged'), { recursive: true });
  fs.writeFileSync(path.join(spec2, 'staged', 'wrap-up-docs-2.md'), 'x');
  fs.writeFileSync(path.join(spec2, 'console.json'), JSON.stringify({ items: [{ id: 'wrap-up-docs-2.md', section: 'Pending review', resolution: 'pending', reason: 'r' }] }));
  const h = harness(f.main);
  // The first console's write runs after the scan; archival then moves the second console's directory.
  h.deps.writeFile = (p, data) => { fs.writeFileSync(p, data); fs.rmSync(spec2, { recursive: true }); };
  assert.strictEqual(run(['--ack', '--run', f.runDir], h.deps), 3);
  assert.ok(h.err().includes('console-residue.js: could not write') && h.err().includes('console directory no longer exists'), h.err());
  assert.ok(!fs.existsSync(spec2), 'acking a vanished console recreated its directory');
  assert.match(h.out(), /marked 1 console\(s\) reviewed for .*\(1 could not be written\)/);
});

test('--ack-all keeps going past a failed write, exits 3, and counts the failure', () => {
  const f = fixture();
  const second = path.join(f.archive, '2026-10-15T100000-spec-1');
  fs.mkdirSync(second);
  const secondConsole = path.join(second, 'console.json');
  fs.writeFileSync(secondConsole, JSON.stringify(CONSOLE_2821));
  const h = harness(f.main);
  const realWrite = require('../../../plugin/bin/lib/atomic-write').writeFileAtomic;
  h.deps.writeFile = (p, data) => {
    if (p.includes(RUN_2821)) throw new Error('EROFS');
    return realWrite(p, data);
  };
  assert.strictEqual(run(['--ack-all'], h.deps), 3);
  assert.match(h.out(), /marked 1 console\(s\) reviewed across 2 run\(s\) \(1 could not be written\)/);
  assert.strictEqual(JSON.parse(fs.readFileSync(secondConsole, 'utf8')).residueAcknowledgedAt, '2026-10-17T12:00:00.000Z');
  assert.strictEqual(JSON.parse(fs.readFileSync(f.consolePath, 'utf8')).residueAcknowledgedAt, undefined);
});

test('--ack never rewrites a console acknowledged between the scan and the write, and says it skipped it', () => {
  const f = fixture();
  const h = harness(f.main);
  let wrote = 0;
  h.deps.readFile = () => JSON.stringify({ ...CONSOLE_2821, residueAcknowledgedAt: '2026-10-16T00:00:00.000Z' });
  h.deps.writeFile = () => { wrote += 1; };
  assert.strictEqual(run(['--ack', '--run', f.runDir], h.deps), 0);
  assert.strictEqual(wrote, 0);
  assert.match(h.out(), /marked 0 console\(s\) reviewed for .*\(1 skipped — already acknowledged or no longer valid JSON\)/);
});

test('--run on an unparseable console.json says it could not be checked instead of printing nothing', () => {
  const f = fixture();
  fs.writeFileSync(f.consolePath, '{ truncated');
  const h = harness(f.main);
  assert.strictEqual(run(['--run', f.runDir], h.deps), 0);
  assert.ok(h.out().includes('console.json could not be checked for unreviewed items'), h.out());
  assert.ok(h.out().includes('! console.json is not valid JSON'), h.out());
});

test('--run on a run with no console.json at all stays silent', () => {
  const f = fixture();
  fs.unlinkSync(f.consolePath);
  const h = harness(f.main);
  assert.strictEqual(run(['--run', f.runDir], h.deps), 0);
  assert.strictEqual(h.out(), '');
});

// #3783 — --require-verify: name the verify command when a run never wrote verify.json.
const { writeVerifyResults } = require('../../../plugin/bin/lib/wrap-up/verify-results');

test('AC4.1: --require-verify prints the missing-verify line and paste-ready command when verify.json is absent', () => {
  const f = fixture();
  const h = harness(f.main);
  assert.strictEqual(run(['--run', f.runDir, '--require-verify', 'origin/main'], h.deps), 0);
  assert.ok(h.out().includes("verify.json missing — wrap-up's Verify execution never ran, or its write failed"), h.out());
  // The command names the resolved target (macOS tmpdir is a symlink), not the argv spelling.
  assert.ok(h.out().includes(`wrap-up-engine.js" verify --run-dir "${fs.realpathSync(f.runDir)}" --base origin/main`), h.out());
  assert.ok(h.out().indexOf('verify.json missing') > h.out().indexOf('review-13-record.md'), 'verify lines follow the residue lines');
});

test('AC4.2: --require-verify prints nothing for verify when verify.json is present', () => {
  const f = fixture();
  writeVerifyResults({ runDir: f.runDir, rows: [{ check: 'tests', result: 'pass', detail: '' }], base: 'origin/main' });
  const h = harness(f.main);
  assert.strictEqual(run(['--run', f.runDir, '--require-verify', 'origin/main'], h.deps), 0);
  assert.ok(!h.out().includes('verify.json missing'), h.out());
});

test('--require-verify treats an unparseable verify.json as missing', () => {
  const f = fixture();
  fs.writeFileSync(path.join(f.runDir, 'verify.json'), '{ truncated');
  const h = harness(f.main);
  assert.strictEqual(run(['--run', f.runDir, '--require-verify', 'origin/main'], h.deps), 0);
  assert.ok(h.out().includes('verify.json missing'), h.out());
});

test('--require-verify checks each spec-*/ dir of a multi-spec parent, never the parent itself', () => {
  const f = fixture();
  const parent = path.join(f.archive, '2026-10-21T000000-multispec-parent');
  fs.mkdirSync(path.join(parent, 'spec-1'), { recursive: true });
  fs.mkdirSync(path.join(parent, 'spec-2'), { recursive: true });
  writeVerifyResults({ runDir: path.join(parent, 'spec-1'), rows: [], base: 'origin/main' });
  const h = harness(f.main);
  assert.strictEqual(run(['--run', parent, '--require-verify', 'origin/main'], h.deps), 0);
  const missing = h.out().split('\n').filter((l) => l.includes('verify.json missing'));
  assert.strictEqual(missing.length, 1, h.out());
  assert.ok(missing[0].includes('spec-2'), missing[0]);
  assert.ok(h.out().includes(`--run-dir "${path.join(fs.realpathSync(parent), 'spec-2')}"`), h.out());
});

// #4170: the ack and console-resolve.js --set-item both read-modify-write console.json, so the ack runs under
// the console's own lock and an ack never hides an item a later rewrite re-opened.
test('--ack reads and writes console.json while holding the console lock (#4170)', () => {
  const f = fixture();
  const lock = path.join(f.runDir, CONSOLE_LOCK);
  const h = harness(f.main);
  const held = [];
  h.deps.readFile = (p) => { held.push(['read', fs.existsSync(lock)]); return fs.readFileSync(p, 'utf8'); };
  h.deps.writeFile = (p, text) => { held.push(['write', fs.existsSync(lock)]); writeFileAtomic(p, text); };
  assert.strictEqual(run(['--ack', '--run', f.runDir], h.deps), 0);
  assert.deepStrictEqual(held, [['read', true], ['write', true]]);
  assert.ok(!fs.existsSync(lock), 'the lock is released');
});

test('an ack does not hide a later --set-item rewrite: the rewritten item lists as residue again (#4170)', () => {
  const f = fixture();
  const id = 'ledger-record-brief-marker-multispec.md';
  fs.writeFileSync(path.join(f.runDir, 'staged', id), 'x');
  assert.strictEqual(run(['--ack', '--run', f.runDir], harness(f.main).deps), 0);
  const quiet = harness(f.main);
  assert.strictEqual(run(['--run', f.runDir], quiet.deps), 0);
  assert.strictEqual(quiet.out(), '', 'the acknowledged console lists nothing');
  const r = rewriteItemResolution({ consolePath: f.consolePath, id, resolution: 'keep-staged', reason: 'record create failed (exit 1)', at: '2026-10-17T13:00:00.000Z' });
  assert.strictEqual(r.status, 'rewrote');
  const after = harness(f.main);
  assert.strictEqual(run(['--run', f.runDir], after.deps), 0);
  assert.ok(after.out().includes(`${id} — Queue writes: keep-staged (record create failed (exit 1))`), after.out());
});

test('--run without --require-verify never mentions verify.json', () => {
  const f = fixture();
  const h = harness(f.main);
  assert.strictEqual(run(['--run', f.runDir], h.deps), 0);
  assert.ok(!h.out().includes('verify.json'), h.out());
});

test('--require-verify usage errors', () => {
  const f = fixture();
  for (const [argv, message] of [
    [['--run', f.runDir, '--require-verify'], /--require-verify requires a value/],
    [['--run', f.runDir, '--require-verify', ''], /--require-verify requires a value/],
    [['--run', f.runDir, '--require-verify', '--ack'], /--require-verify requires a value/],
    [['--ack', '--run', f.runDir, '--require-verify', 'b'], /--require-verify takes neither --ack nor --ack-all/],
    [['--ack-all', '--require-verify', 'b'], /--ack-all takes neither --run nor --ack|--require-verify takes neither/],
  ]) {
    const h = harness(f.main);
    assert.strictEqual(run(argv, h.deps), 2, argv.join(' '));
    assert.match(h.err(), message, argv.join(' '));
  }
});
