'use strict';
// #4620: console-resolve.js under control mode — the facts sink (packet-facts/decisions.json), exit 6,
// and the failed-execution carry. Fixture helpers copied from cli.test.js, which stays byte-unmodified (AC5);
// mainCheckoutWithRun gains `autonomy: null` (no explicit autonomy line, so control mode alone sets the ceiling).
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..', '..');
const CLI = path.join(ROOT, 'plugin', 'bin', 'console-resolve.js');
const { run, writeDecisionFacts, EXIT_CARRY_FAILED } = require(CLI);
const { readConsoleState } = require(path.join(ROOT, 'plugin', 'bin', 'lib', 'reconcile', 'archive-merged'));
const { readRunResidue, consoleResidueItems } = require(path.join(ROOT, 'plugin', 'bin', 'lib', 'console', 'residue'));
const { appendRow } = require(path.join(ROOT, 'plugin', 'bin', 'lib', 'stage-item', 'ledger'));

function mainCheckoutWithRun({ autonomy = 'unattended', staged = {}, decisions = '', policyExtra = '', writePolicy = true, runConfig = null, consoleJson = null } = {}) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'console-resolve-cm-cli-')));
  const git = (...a) => execFileSync('git', a, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  git('init', '-q'); git('config', 'user.email', 't@example.invalid'); git('config', 'user.name', 't'); git('commit', '-q', '--allow-empty', '-m', 'init');
  fs.mkdirSync(path.join(root, '.claude-tweaks'), { recursive: true });
  if (writePolicy) fs.writeFileSync(path.join(root, '.claude-tweaks', 'policy.yml'), `${autonomy === null ? '' : `autonomy: ${autonomy}\n`}${policyExtra}`);
  const runDir = path.join(root, '.claude-tweaks', 'pipelines', '2026-09-06T000000-record-7');
  fs.mkdirSync(path.join(runDir, 'staged'), { recursive: true });
  fs.mkdirSync(path.join(runDir, 'work'), { recursive: true });
  fs.writeFileSync(path.join(runDir, 'work', '7-spec.md'), '---\nrecord: 7\n---\n');
  fs.writeFileSync(path.join(runDir, 'decisions.md'), decisions);
  for (const [n, b] of Object.entries(staged)) fs.writeFileSync(path.join(runDir, 'staged', n), b);
  if (runConfig !== null) fs.writeFileSync(path.join(runDir, 'config.yml'), runConfig);
  if (consoleJson !== null) fs.writeFileSync(path.join(runDir, 'console.json'), consoleJson);
  return { root, runDir };
}

function fakeExec(calls, root) {
  return (cmd, args) => {
    calls.push([cmd, ...args]);
    if (cmd === 'git' && args[0] === 'rev-parse') return `${root}\n`;
    if (cmd === 'gh' && args[0] === 'issue' && args[1] === 'view') return JSON.stringify({ labels: [{ name: 'auto:merge' }], comments: [] });
    if (cmd === 'git' && args[0] === 'apply') return '';
    throw new Error(`unexpected exec: ${cmd} ${args.join(' ')}`);
  };
}

function baseDeps(fx, calls, over = {}) {
  let out = '';
  let err = '';
  const d = { cwd: () => fx.root, mainRoot: fx.root, stdout: (s) => { out += s; }, stderr: (s) => { err += s; }, now: () => Date.parse('2026-09-06T12:00:00Z'), execFile: fakeExec(calls, fx.root), ...over };
  return { d, out: () => out, err: () => err };
}

const CM = 'control-mode: on\n';
const STAGED = { 'skills-1.md': 'x', 'review-contested-1.md': 'contested' };
const FACTS = (fx) => path.join(fx.runDir, 'packet-facts', 'decisions.json');
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const cj = (fx) => readJson(path.join(fx.runDir, 'console.json'));
const controlFixture = (extra = {}) => mainCheckoutWithRun({ autonomy: null, policyExtra: CM, staged: STAGED, ...extra });
const resolveArgs = (fx, ...more) => ['--run', fx.runDir, '--policy', 'console-auto', ...more];
const consoleOf = (items, extra = {}) => `${JSON.stringify({ resolved: true, mode: 'auto-resolve', at: '2026-09-06T12:00:00.000Z', ceiling: 'unattended', items, filings: [], ...extra }, null, 2)}\n`;
const leftover = (resolution = 'apply') => ({ id: 'leftover-1.md', section: 'Queue writes', resolution, reason: 'queue write' });

test('AC1.1: control mode resolves and logs the policy item, carries the contested finding, prints no Needs a human block', async () => {
  const fx = controlFixture();
  const { d, out } = baseDeps(fx, []);
  assert.strictEqual(await run(resolveArgs(fx), d), 0);
  const items = Object.fromEntries(cj(fx).items.map((i) => [i.id, i.resolution]));
  assert.deepStrictEqual(items, { 'skills-1.md': 'approve', 'review-contested-1.md': 'carried' });
  const decisions = fs.readFileSync(path.join(fx.runDir, 'decisions.md'), 'utf8');
  const lines = decisions.split('\n').filter((l) => /^- AUTO .*Console item/.test(l));
  assert.strictEqual(lines.filter((l) => /Console item skills-1\.md \(Skill updates\): approve/.test(l)).length, 1, decisions);
  assert.strictEqual(lines.filter((l) => /Console item review-contested-1\.md \(Contested findings\): carried — carried to the acceptance packet as decision:review:review-contested-1\.md/.test(l)).length, 1, decisions);
  assert.match(decisions, /Console auto-resolved 2 item\(s\) at unattended \(control mode\)\./);
  assert.match(decisions, /Console item review-contested-1\.md .*Reversibility: n\/a\.$/m);
  const facts = readJson(FACTS(fx));
  assert.strictEqual(facts.length, 1);
  assert.strictEqual(facts[0].id, 'decision:review:review-contested-1.md');
  assert.strictEqual(typeof facts[0].text, 'string');
  assert.ok(!out().includes('Needs a human'), out());
  const stored = cj(fx);
  assert.strictEqual(stored.controlMode, true);
  assert.strictEqual(stored.decisionFacts, 1);
});

test('AC2.1: a control-mode console.json with carried items passes the archival reconcile check as having no open items', async () => {
  const fx = controlFixture();
  assert.strictEqual(await run(resolveArgs(fx), baseDeps(fx, []).d), 0);
  assert.strictEqual(readConsoleState(fx.runDir), 'resolved');
  assert.deepStrictEqual(readRunResidue(fx.runDir).consoles, []);
  // Control: the same fixture with control mode off leaves the contested item keep-staged.
  const off = mainCheckoutWithRun({ staged: STAGED });
  assert.strictEqual(await run(resolveArgs(off), baseDeps(off, []).d), 0);
  assert.strictEqual(readConsoleState(off.runDir), 'residue');
});

test('AC2.1: a refused ledger-record item under control mode ends with its ledger row deferred to the packet', async () => {
  const decisions = '## /wrap-up\n- REFUSED 10:00:00 — Queue write Q1: no valid Defer-reason on staged/ledger-record-1.md; kept staged.\n';
  const fx = controlFixture({ staged: { 'ledger-record-1.md': 'x' }, decisions });
  const ledger = path.join(fx.root, 'ledger.md');
  fs.writeFileSync(ledger, '# Open Items — x\n\n| # | Phase | Item | Status | Resolution |\n|---|-------|------|--------|------------|\n');
  appendRow({ runDir: fx.runDir, ledgerPath: ledger, phase: 'build', item: 'a finding', status: 'deferred', resolution: '→ backlog, staged/ledger-record-1.md' });
  const other = path.join(fx.root, 'other-ledger.md');
  fs.writeFileSync(other, '# Open Items — y\n\n| # | Phase | Item | Status | Resolution |\n|---|-------|------|--------|------------|\n');
  appendRow({ runDir: fx.runDir, ledgerPath: other, phase: 'build', item: 'unrelated', status: 'deferred', resolution: '→ backlog, staged/elsewhere-1.md' });
  assert.strictEqual(await run(resolveArgs(fx), baseDeps(fx, []).d), 0);
  assert.strictEqual(cj(fx).items[0].resolution, 'carried');
  const call = async (ledgerPath) => {
    const b = baseDeps(fx, []);
    const code = await run(['--run', fx.runDir, '--set-item', 'ledger-record-1.md', '--resolution', 'carried', '--reason', 'refused: no Defer-reason', '--ledger', ledgerPath], b.d);
    return { code, out: b.out(), err: b.err() };
  };

  const otherBefore = fs.readFileSync(other, 'utf8');
  const miss = await call(other);
  assert.strictEqual(miss.code, 5, miss.err);
  assert.match(miss.err, /no ledger row names staged\/ledger-record-1\.md/);
  assert.strictEqual(fs.readFileSync(other, 'utf8'), otherBefore, 'a miss leaves the ledger byte-identical');

  const hit = await call(ledger);
  assert.strictEqual(hit.code, 0, hit.err);
  assert.match(hit.out, /already carried; ledger row #1 settled/);
  const text = fs.readFileSync(ledger, 'utf8');
  assert.match(text, /\| 1 \| build \| a finding \| deferred \| carried to the acceptance packet as decision:console:ledger-record-1\.md \|/);
  assert.ok(!text.includes('staged/'), 'no stale pointer');
  const facts = readJson(FACTS(fx));
  assert.deepStrictEqual(facts.map((f) => f.id), ['decision:console:ledger-record-1.md']);

  const again = await call(ledger);
  assert.strictEqual(again.code, 0, again.err);
  assert.match(again.out, /ledger row #1 already carried/);
  assert.strictEqual(fs.readFileSync(ledger, 'utf8'), text, 'a settled row is left unchanged');
  assert.strictEqual(readJson(FACTS(fx)).length, 1);
});

test('AC2.1: a failed Queue-write create is carried, never reopened', async () => {
  const fx = mainCheckoutWithRun({ consoleJson: consoleOf([leftover()]) });
  const b = baseDeps(fx, []);
  assert.strictEqual(await run(['--run', fx.runDir, '--set-item', 'leftover-1.md', '--resolution', 'carried', '--reason', 'gh issue create failed'], b.d), 0, b.err());
  assert.strictEqual(cj(fx).items[0].resolution, 'carried');
  assert.match(cj(fx).items[0].reason, /^carried to the acceptance packet as decision:console:leftover-1\.md — gh issue create failed$/);
  assert.deepStrictEqual(readJson(FACTS(fx)).map((f) => f.id), ['decision:console:leftover-1.md']);
  assert.strictEqual(readConsoleState(fx.runDir), 'resolved');
});

test('--set-item carried on an item that is not rewritable is refused with nothing written', async () => {
  const fx = mainCheckoutWithRun({ consoleJson: consoleOf([leftover('dismissed')]) });
  const b = baseDeps(fx, []);
  assert.strictEqual(await run(['--run', fx.runDir, '--set-item', 'leftover-1.md', '--resolution', 'carried', '--reason', 'x'], b.d), 5);
  assert.ok(!fs.existsSync(path.join(fx.runDir, 'packet-facts')), 'no orphan fact');
  assert.strictEqual(cj(fx).items[0].resolution, 'dismissed');
});

test('--ledger is accepted only with --set-item', async () => {
  const fx = controlFixture();
  const b = baseDeps(fx, []);
  assert.strictEqual(await run(resolveArgs(fx, '--ledger', 'x.md'), b.d), 2);
  assert.match(b.err(), /--ledger requires --set-item/);
});

test('AC4.6: a forced carry failure exits 6, names every item, writes no console.json', async () => {
  const fx = controlFixture();
  fs.mkdirSync(path.join(fx.runDir, 'packet-facts'), { recursive: true });
  fs.writeFileSync(FACTS(fx), 'not json');
  const { d, err } = baseDeps(fx, []);
  assert.strictEqual(await run(resolveArgs(fx), d), 6);
  assert.strictEqual(EXIT_CARRY_FAILED, 6);
  assert.match(err(), /could not carry 1 item\(s\).*review-contested-1\.md/);
  assert.ok(!fs.existsSync(path.join(fx.runDir, 'console.json')), 'no console.json');
  assert.strictEqual(fs.readFileSync(FACTS(fx), 'utf8'), 'not json', 'the facts file is unchanged');
  assert.strictEqual(fs.readFileSync(path.join(fx.runDir, 'decisions.md'), 'utf8'), '', 'no decisions block');
});

test('a facts file that is JSON but not an array is never overwritten', () => {
  const fx = controlFixture();
  fs.mkdirSync(path.join(fx.runDir, 'packet-facts'), { recursive: true });
  fs.writeFileSync(FACTS(fx), '{"facts":[]}');
  assert.throws(() => writeDecisionFacts(fx.runDir, [{ id: 'decision:console:a.md' }]), /not a JSON array/);
  assert.strictEqual(fs.readFileSync(FACTS(fx), 'utf8'), '{"facts":[]}');
});

test('writeDecisionFacts merges by id, first copy wins', () => {
  const fx = controlFixture();
  assert.deepStrictEqual(writeDecisionFacts(fx.runDir, [{ id: 'a', text: 'first' }, { id: 'a', text: 'dup' }, { id: 'b' }]), { path: FACTS(fx), added: 2 });
  assert.deepStrictEqual(writeDecisionFacts(fx.runDir, [{ id: 'a', text: 'second' }, { id: 'c' }]), { path: FACTS(fx), added: 1 });
  assert.deepStrictEqual(readJson(FACTS(fx)), [{ id: 'a', text: 'first' }, { id: 'b' }, { id: 'c' }]);
});

test('a re-run never doubles a fact', async () => {
  const fx = controlFixture();
  assert.strictEqual(await run(resolveArgs(fx), baseDeps(fx, []).d), 0);
  fs.rmSync(path.join(fx.runDir, 'console.json'));
  assert.strictEqual(await run(resolveArgs(fx), baseDeps(fx, []).d), 0);
  assert.strictEqual(readJson(FACTS(fx)).length, 1);
});

test('AC5.1: control mode off writes no packet-facts file and an identical console.json', async () => {
  const fx = mainCheckoutWithRun({ staged: STAGED });
  const { d, out } = baseDeps(fx, []);
  assert.strictEqual(await run(resolveArgs(fx), d), 0);
  assert.ok(!fs.existsSync(path.join(fx.runDir, 'packet-facts')), 'no packet-facts directory');
  const stored = cj(fx);
  assert.ok(!('controlMode' in stored) && !('decisionFacts' in stored));
  assert.deepStrictEqual(Object.keys(stored), ['resolved', 'mode', 'at', 'ceiling', 'items', 'merge', 'droppedByTiebreak', 'filings']);
  assert.strictEqual(stored.items.find((i) => i.id === 'review-contested-1.md').resolution, 'keep-staged');
  assert.match(out(), /Needs a human/);
  const decisions = fs.readFileSync(path.join(fx.runDir, 'decisions.md'), 'utf8');
  assert.match(decisions, /Console auto-resolved 2 item\(s\) at unattended \(console-resolve\.js\)\./);
  // Without control mode and without autonomy the supervised default still refuses.
  const none = mainCheckoutWithRun({ autonomy: null, staged: STAGED });
  assert.strictEqual(await run(resolveArgs(none), baseDeps(none, []).d), 4);
  assert.ok(!fs.existsSync(path.join(none.runDir, 'console.json')));
});

test('AC5.1: off-mode --json carries no decisionFacts key; control-mode --json does', async () => {
  const off = mainCheckoutWithRun({ staged: STAGED });
  const offOut = baseDeps(off, []);
  assert.strictEqual(await run(resolveArgs(off, '--json'), offOut.d), 0);
  const offJson = JSON.parse(offOut.out());
  assert.ok(!('decisionFacts' in offJson), Object.keys(offJson).join(','));
  const offDry = baseDeps(off, []);
  fs.rmSync(path.join(off.runDir, 'console.json'));
  assert.strictEqual(await run(resolveArgs(off, '--json', '--dry-run'), offDry.d), 0);
  assert.ok(!('decisionFacts' in JSON.parse(offDry.out())));

  const on = controlFixture();
  const onDry = baseDeps(on, []);
  assert.strictEqual(await run(resolveArgs(on, '--json', '--dry-run'), onDry.d), 0);
  const onJson = JSON.parse(onDry.out());
  assert.deepStrictEqual(onJson.decisionFacts.map((f) => f.id), ['decision:review:review-contested-1.md']);
  assert.ok(!fs.existsSync(path.join(on.runDir, 'packet-facts')), 'dry-run writes nothing');
  assert.ok(!fs.existsSync(path.join(on.runDir, 'console.json')));
});

test('AC4.11: control-mode on with explicit autonomy supervised still exits 4', async () => {
  const fx = mainCheckoutWithRun({ autonomy: 'supervised', policyExtra: CM, staged: STAGED });
  assert.strictEqual(await run(resolveArgs(fx), baseDeps(fx, []).d), 4);
  assert.ok(!fs.existsSync(path.join(fx.runDir, 'packet-facts')));
});

test('--set-item keep-staged under control mode stores carried and writes the fact', async () => {
  const fx = controlFixture({ consoleJson: consoleOf([leftover()]) });
  const b = baseDeps(fx, []);
  assert.strictEqual(await run(['--run', fx.runDir, '--set-item', 'leftover-1.md', '--resolution', 'keep-staged', '--reason', 'gh issue create failed'], b.d), 0, b.err());
  assert.strictEqual(cj(fx).items[0].resolution, 'carried');
  assert.deepStrictEqual(readJson(FACTS(fx)).map((f) => f.id), ['decision:console:leftover-1.md']);

  const off = mainCheckoutWithRun({ consoleJson: consoleOf([leftover()]) });
  assert.strictEqual(await run(['--run', off.runDir, '--set-item', 'leftover-1.md', '--resolution', 'keep-staged', '--reason', 'gh issue create failed'], baseDeps(off, []).d), 0);
  assert.strictEqual(cj(off).items[0].resolution, 'keep-staged');
  assert.ok(!fs.existsSync(path.join(off.runDir, 'packet-facts')));
});

test('--set-item keep-staged under control mode keeps its source rule: only an apply item is rewritten', async () => {
  const fx = controlFixture({ consoleJson: consoleOf([leftover('approve')]) });
  const b = baseDeps(fx, []);
  assert.strictEqual(await run(['--run', fx.runDir, '--set-item', 'leftover-1.md', '--resolution', 'keep-staged', '--reason', 'x'], b.d), 5);
  assert.strictEqual(cj(fx).items[0].resolution, 'approve');
  assert.ok(!fs.existsSync(path.join(fx.runDir, 'packet-facts')));
});

test('a carry fact-write failure from --set-item exits 6 and leaves the stored item unchanged', async () => {
  const fx = controlFixture({ consoleJson: consoleOf([leftover()]) });
  fs.mkdirSync(path.join(fx.runDir, 'packet-facts'), { recursive: true });
  fs.writeFileSync(FACTS(fx), 'not json');
  const b = baseDeps(fx, []);
  assert.strictEqual(await run(['--run', fx.runDir, '--set-item', 'leftover-1.md', '--resolution', 'keep-staged', '--reason', 'x'], b.d), 6);
  assert.match(b.err(), /could not carry 1 item\(s\).*leftover-1\.md/);
  assert.strictEqual(cj(fx).items[0].resolution, 'apply');
});

test('a failed can\'t-tell filing rewritten carried is no longer filing-pending', async () => {
  const item = { id: 'tiebreak:abc', section: 'Contested findings', resolution: 'filed', reason: 'filed' };
  const filings = [{ item: 'tiebreak:abc', fingerprint: 'consolefinding-0123abcd', title: 't' }];
  const fx = mainCheckoutWithRun({ consoleJson: consoleOf([item], { filings }) });
  assert.deepStrictEqual(consoleResidueItems(cj(fx), '').map((i) => i.resolution), ['filing-pending']);
  const b = baseDeps(fx, []);
  assert.strictEqual(await run(['--run', fx.runDir, '--set-item', 'tiebreak:abc', '--resolution', 'carried', '--reason', 'gh issue create failed'], b.d), 0, b.err());
  assert.deepStrictEqual(consoleResidueItems(cj(fx), ''), []);
  assert.deepStrictEqual(readJson(FACTS(fx)).map((f) => f.id), ['decision:review:tiebreak:abc']);
});
