'use strict';
// #4620: console-resolve.js under control mode — the facts sink (packet-facts/decisions.json), exit 6,
// and the failed-execution carry. Fixture helpers copied from cli.test.js, which stays byte-unmodified (AC5);
// mainCheckoutWithRun gains `autonomy: null` (no explicit autonomy line, so control mode alone sets the ceiling).
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const { scratchDir } = require('../../helpers/tmp-dir');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..', '..');
const CLI = path.join(ROOT, 'plugin', 'bin', 'console-resolve.js');
const { run, writeDecisionFacts, EXIT_CARRY_FAILED } = require(CLI);
const { readConsoleState } = require(path.join(ROOT, 'plugin', 'bin', 'lib', 'reconcile', 'archive-merged'));
const { readRunResidue, consoleResidueItems } = require(path.join(ROOT, 'plugin', 'bin', 'lib', 'console', 'residue'));
const { appendRow } = require(path.join(ROOT, 'plugin', 'bin', 'lib', 'stage-item', 'ledger'));
const { initRepo } = require('../../helpers/git-fixtures');

function mainCheckoutWithRun({ autonomy = 'unattended', staged = {}, decisions = '', policyExtra = '', writePolicy = true, runConfig = null, consoleJson = null } = {}) {
  const root = fs.realpathSync(scratchDir('console-resolve-cm-cli-'));
  const git = (...a) => execFileSync('git', a, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  initRepo(root, { name: 't', email: 't@example.invalid', cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); git('commit', '-q', '--allow-empty', '-m', 'init');
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

// answers (#4621): an optional map from the whole command line (`git remote get-url origin`) to the stdout to
// return, or to an Error to throw; it is consulted before the defaults below.
function fakeExec(calls, root, answers = {}) {
  return (cmd, args) => {
    calls.push([cmd, ...args]);
    const answer = answers[`${cmd} ${args.join(' ')}`];
    if (answer instanceof Error) throw answer;
    if (answer !== undefined) return answer;
    if (cmd === 'git' && args[0] === 'rev-parse') return `${root}\n`;
    if (cmd === 'gh' && args[0] === 'issue' && args[1] === 'view') return JSON.stringify({ labels: [{ name: 'auto:build' }, { name: 'auto:merge' }], comments: [] });
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

test('AC6.2: control mode on — a staged followup-recheck-3.md resolves carried and its staged file is untouched (control-mode case only; the pending case outside control mode is resolve.test.js AC6.1)', async () => {
  const body = 'Title: close #3\n\nbody';
  const fx = controlFixture({ staged: { 'followup-recheck-3.md': body } });
  const { d } = baseDeps(fx, []);
  assert.strictEqual(await run(resolveArgs(fx), d), 0);
  const item = cj(fx).items.find((i) => i.id === 'followup-recheck-3.md');
  assert.strictEqual(item.resolution, 'carried');
  assert.strictEqual(fs.readFileSync(path.join(fx.runDir, 'staged', 'followup-recheck-3.md'), 'utf8'), body);
});

test('M6: console-resolve at unattended over an approve-created console.json resolves the other staged items and keeps the approval', async () => {
  const approval = { at: '2026-09-06T11:00:00.000Z', pr: '12', headSha: null, stagedHash: 'h' };
  const approved = { id: 'followup-recheck-3.md', section: 'Queue writes', resolution: 'pending', reason: 'followup-recheck-approved', approval };
  const fx = mainCheckoutWithRun({
    staged: { 'followup-recheck-3.md': 'Title: Close #3: t\n\nbody', 'skills-1.md': 'x' },
    consoleJson: JSON.stringify({ resolved: false, mode: 'recheck-approval', at: approval.at, items: [approved] }),
  });
  const { d } = baseDeps(fx, []);
  assert.strictEqual(await run(resolveArgs(fx), d), 0);
  const stored = cj(fx);
  assert.strictEqual(stored.resolved, true);
  const items = Object.fromEntries(stored.items.map((i) => [i.id, i]));
  assert.strictEqual(items['skills-1.md'].resolution, 'approve');
  assert.strictEqual(items['followup-recheck-3.md'].resolution, 'pending');
  assert.deepStrictEqual(items['followup-recheck-3.md'].approval, approval);
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
  assert.match(fs.readFileSync(path.join(fx.runDir, 'decisions.md'), 'utf8'), /^- AUTO .*Console item ledger-record-1\.md \(.*\): already carried; ledger row #1 settled/m);
  const text = fs.readFileSync(ledger, 'utf8');
  assert.match(text, /\| 1 \| build \| a finding \| deferred \| carried to the acceptance packet as decision:console:ledger-record-1\.md \|/);
  assert.ok(!text.includes('staged/'), 'no stale pointer');
  const facts = readJson(FACTS(fx));
  assert.deepStrictEqual(facts.map((f) => f.id), ['decision:console:ledger-record-1.md']);

  const decisionsBefore = fs.readFileSync(path.join(fx.runDir, 'decisions.md'), 'utf8');
  const again = await call(ledger);
  assert.strictEqual(again.code, 0, again.err);
  assert.match(again.out, /ledger row #1 already carried/);
  assert.strictEqual(fs.readFileSync(ledger, 'utf8'), text, 'a settled row is left unchanged');
  assert.strictEqual(fs.readFileSync(path.join(fx.runDir, 'decisions.md'), 'utf8'), decisionsBefore, 'a repeat call that changed nothing logs nothing');
  assert.strictEqual(readJson(FACTS(fx)).length, 1);
});

test('AC2.1: a failed Queue-write create is carried, never reopened', async () => {
  const fx = controlFixture({ consoleJson: consoleOf([leftover()]) });
  const b = baseDeps(fx, []);
  assert.strictEqual(await run(['--run', fx.runDir, '--set-item', 'leftover-1.md', '--resolution', 'carried', '--reason', 'gh issue create failed'], b.d), 0, b.err());
  assert.strictEqual(cj(fx).items[0].resolution, 'carried');
  assert.match(cj(fx).items[0].reason, /^carried to the acceptance packet as decision:console:leftover-1\.md — gh issue create failed$/);
  assert.deepStrictEqual(readJson(FACTS(fx)).map((f) => f.id), ['decision:console:leftover-1.md']);
  assert.strictEqual(readConsoleState(fx.runDir), 'resolved');
});

test('--set-item carried on an item that is not rewritable is refused with nothing written', async () => {
  const fx = controlFixture({ consoleJson: consoleOf([leftover('dismissed')]) });
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

const LEDGER_HEAD = '# Open Items — x\n\n| # | Phase | Item | Status | Resolution |\n|---|-------|------|--------|------------|\n';
const ledgerItem = (resolution = 'apply') => ({ id: 'ledger-record-1.md', section: 'Queue writes', resolution, reason: 'queue write' });
const setItemArgs = (fx, id, resolution, ...more) => ['--run', fx.runDir, '--set-item', id, '--resolution', resolution, '--reason', 'why', ...more];

test('a rewritten ledger-record item settles its row and the AUTO line says so', async () => {
  const fx = controlFixture({ consoleJson: consoleOf([ledgerItem()]) });
  const ledger = path.join(fx.root, 'ledger.md');
  fs.writeFileSync(ledger, LEDGER_HEAD);
  appendRow({ runDir: fx.runDir, ledgerPath: ledger, phase: 'build', item: 'a finding', status: 'deferred', resolution: '→ backlog, staged/ledger-record-1.md' });
  const b = baseDeps(fx, []);
  assert.strictEqual(await run(setItemArgs(fx, 'ledger-record-1.md', 'carried', '--ledger', ledger), b.d), 0, b.err());
  assert.match(b.out(), /rewritten apply → carried in .*; ledger row #1 settled/);
  assert.match(fs.readFileSync(path.join(fx.runDir, 'decisions.md'), 'utf8'), /rewritten apply → carried after execution — .*; ledger row #1 settled\. Reversibility: n\/a\./);
  assert.strictEqual(cj(fx).items[0].resolution, 'carried');
});

test('--ledger names a path that must clear the ledger containment guard: refused paths exit 5 and write nothing', async () => {
  const fx = controlFixture({ consoleJson: consoleOf([ledgerItem()]) });
  const outside = fs.realpathSync(scratchDir('console-resolve-cm-outside-'));
  const outsideLedger = path.join(outside, 'ledger.md');
  fs.writeFileSync(outsideLedger, `${LEDGER_HEAD}| 1 | build | a finding | deferred | → backlog, staged/ledger-record-1.md |\n`);
  const notALedger = path.join(fx.root, 'notes.md');
  fs.writeFileSync(notALedger, `${LEDGER_HEAD}| 1 | build | a finding | deferred | → backlog, staged/ledger-record-1.md |\n`);
  for (const [label, target, pattern] of [['outside the run and worktree', outsideLedger, /outside the run directory and worktree/], ['not a ledger name', notALedger, /not a ledger file name/], ['missing', path.join(fx.root, 'absent-ledger.md'), /not-found/]]) {
    const before = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : null;
    const b = baseDeps(fx, []);
    assert.strictEqual(await run(setItemArgs(fx, 'ledger-record-1.md', 'carried', '--ledger', target), b.d), 5, `${label}: ${b.err()}`);
    assert.match(b.err(), pattern, label);
    assert.match(b.err(), /nothing written/);
    if (before !== null) assert.strictEqual(fs.readFileSync(target, 'utf8'), before, `${label}: ledger untouched`);
    assert.ok(!fs.existsSync(path.join(fx.runDir, 'packet-facts')), `${label}: no fact`);
    assert.strictEqual(cj(fx).items[0].resolution, 'apply', `${label}: item unchanged`);
  }
});

test('--ledger exits 2 when it cannot apply: a non ledger-record id, or control mode off', async () => {
  const fx = controlFixture({ consoleJson: consoleOf([leftover()]) });
  const b = baseDeps(fx, []);
  assert.strictEqual(await run(setItemArgs(fx, 'leftover-1.md', 'carried', '--ledger', 'ledger.md'), b.d), 2);
  assert.match(b.err(), /--ledger applies only to a ledger-record-\* item/);
  assert.strictEqual(cj(fx).items[0].resolution, 'apply');

  const off = mainCheckoutWithRun({ consoleJson: consoleOf([ledgerItem()]) });
  const ob = baseDeps(off, []);
  assert.strictEqual(await run(setItemArgs(off, 'ledger-record-1.md', 'keep-staged', '--ledger', 'ledger.md'), ob.d), 2);
  assert.match(ob.err(), /--ledger applies only to a carried item/);
  assert.strictEqual(cj(off).items[0].resolution, 'apply', 'nothing rewritten');
});

test('--resolution carried is gated on control mode: off, it exits 2 exactly as an unknown value did', async () => {
  const off = mainCheckoutWithRun({ consoleJson: consoleOf([leftover()]) });
  const b = baseDeps(off, []);
  assert.strictEqual(await run(setItemArgs(off, 'leftover-1.md', 'carried'), b.d), 2);
  assert.match(b.err(), /--resolution must be one of keep-staged, pending \(got carried\)/);
  assert.strictEqual(cj(off).items[0].resolution, 'apply');
  assert.ok(!fs.existsSync(path.join(off.runDir, 'packet-facts')));
  const on = controlFixture({ consoleJson: consoleOf([leftover()]) });
  assert.strictEqual(await run(setItemArgs(on, 'leftover-1.md', 'carried'), baseDeps(on, []).d), 0);
  assert.strictEqual(cj(on).items[0].resolution, 'carried');
});

test('AC4.6: a forced carry failure exits 6, names every item, writes no console.json', async () => {
  const fx = controlFixture({ staged: { ...STAGED, 'review-contested-2.md': 'second' } });
  fs.mkdirSync(path.join(fx.runDir, 'packet-facts'), { recursive: true });
  fs.writeFileSync(FACTS(fx), 'not json');
  const { d, err } = baseDeps(fx, []);
  assert.strictEqual(await run(resolveArgs(fx), d), 6);
  assert.strictEqual(EXIT_CARRY_FAILED, 6);
  assert.match(err(), /could not carry 2 item\(s\)/);
  assert.match(err(), /review-contested-1\.md/);
  assert.match(err(), /review-contested-2\.md/);
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
  assert.deepStrictEqual(Object.keys(stored), ['resolved', 'mode', 'at', 'ceiling', 'items', 'merge', 'droppedByTiebreak', 'filings', 'digests']);
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
  const fx = controlFixture({ consoleJson: consoleOf([item], { filings }) });
  assert.deepStrictEqual(consoleResidueItems(cj(fx), '').map((i) => i.resolution), ['filing-pending']);
  const b = baseDeps(fx, []);
  assert.strictEqual(await run(['--run', fx.runDir, '--set-item', 'tiebreak:abc', '--resolution', 'carried', '--reason', 'gh issue create failed'], b.d), 0, b.err());
  assert.deepStrictEqual(consoleResidueItems(cj(fx), ''), []);
  assert.deepStrictEqual(readJson(FACTS(fx)).map((f) => f.id), ['decision:review:tiebreak:abc']);
});

// The run dir as a name -> bytes map, for the "writes nothing" byte-identity checks.
function dirBytes(dir, base = dir, out = {}) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) dirBytes(p, base, out); else out[path.relative(base, p)] = fs.readFileSync(p, 'utf8');
  }
  return out;
}

test('AC4.10: --ceiling reports unattended from control mode alone', async () => {
  const fx = controlFixture();
  const before = dirBytes(fx.runDir);
  const b = baseDeps(fx, []);
  assert.strictEqual(await run(['--run', fx.runDir, '--ceiling'], b.d), 0, b.err());
  assert.strictEqual(b.out(), 'console-resolve.js: ceiling unattended consoleAutoResolve true control-mode on source control-mode\n');
  assert.deepStrictEqual(dirBytes(fx.runDir), before);
});

test('AC4.11: --ceiling reports supervised and source explicit when autonomy is set', async () => {
  const fx = mainCheckoutWithRun({ autonomy: 'supervised', policyExtra: CM });
  const b = baseDeps(fx, []);
  assert.strictEqual(await run(['--run', fx.runDir, '--ceiling'], b.d), 0, b.err());
  assert.strictEqual(b.out(), 'console-resolve.js: ceiling supervised consoleAutoResolve false control-mode on source explicit\n');
});

test('AC4.13: --ceiling with control mode off reports source default and control-mode off', async () => {
  const fx = mainCheckoutWithRun({ autonomy: null });
  const b = baseDeps(fx, []);
  assert.strictEqual(await run(['--run', fx.runDir, '--ceiling'], b.d), 0, b.err());
  assert.strictEqual(b.out(), 'console-resolve.js: ceiling supervised consoleAutoResolve false control-mode off source default\n');
});

test('--ceiling reports a malformed autonomy under control mode as supervised, never unattended', async () => {
  const fx = mainCheckoutWithRun({ autonomy: 'supervsed', policyExtra: CM });
  const b = baseDeps(fx, []);
  assert.strictEqual(await run(['--run', fx.runDir, '--ceiling'], b.d), 0, b.err());
  assert.strictEqual(b.out(), 'console-resolve.js: ceiling supervised consoleAutoResolve false control-mode on source invalid-autonomy\n');
});

test('--ceiling refuses any other flag', async () => {
  const fx = controlFixture();
  for (const more of [['--dry-run'], ['--json'], ['--policy', 'console-auto'], ['--full'], ['--set-item', 'x']]) {
    const b = baseDeps(fx, []);
    assert.strictEqual(await run(['--run', fx.runDir, '--ceiling', ...more], b.d), 2, more.join(' '));
    assert.strictEqual(b.out(), '');
  }
});

test('--ceiling: an unanchored --run exits 3 and prints no ceiling line', async () => {
  const fx = controlFixture();
  const other = controlFixture();
  const b = baseDeps(fx, [], { mainRoot: other.root });
  assert.strictEqual(await run(['--run', fx.runDir, '--ceiling'], b.d), 3);
  assert.strictEqual(b.out(), '');
});

test('--ceiling: an unreadable policy exits 3 with its own line, never a supervised guess', async () => {
  const fx = controlFixture();
  // The policy read's own cwd() lookup is the second call (the anchoring check made the first) and throws.
  let calls = 0;
  const b = baseDeps(fx, [], { cwd: () => { calls += 1; if (calls > 1) throw new Error('cwd gone'); return fx.root; } });
  assert.strictEqual(await run(['--run', fx.runDir, '--ceiling'], b.d), 3);
  assert.strictEqual(b.out(), '');
  assert.match(b.err(), /console-resolve\.js: ceiling unreadable \(cwd gone\)/);
});

test('--ceiling is order-free: --ceiling before --run prints the same line', async () => {
  const fx = controlFixture();
  const b = baseDeps(fx, []);
  assert.strictEqual(await run(['--ceiling', '--run', fx.runDir], b.d), 0, b.err());
  assert.strictEqual(b.out(), 'console-resolve.js: ceiling unattended consoleAutoResolve true control-mode on source control-mode\n');
});

test('characterization: --set-item with a relative --run resolves the same run dir as the absolute spelling', async () => {
  const fx = controlFixture({ consoleJson: consoleOf([leftover()]) });
  const b = baseDeps(fx, []);
  assert.strictEqual(await run(['--run', path.relative(fx.root, fx.runDir), '--set-item', 'leftover-1.md', '--resolution', 'keep-staged', '--reason', 'x'], b.d), 0, b.err());
  assert.strictEqual(cj(fx).items[0].resolution, 'carried');
});

test('characterization: the resolve shape with a relative --run resolves the same run dir', async () => {
  const fx = controlFixture();
  const b = baseDeps(fx, []);
  assert.strictEqual(await run(['--run', path.relative(fx.root, fx.runDir), '--policy', 'console-auto'], b.d), 0, b.err());
  assert.ok(fs.existsSync(path.join(fx.runDir, 'console.json')));
});

test('AC4c: --ceiling reports trusted with control mode on as explicit and not granted', async () => {
  const fx = mainCheckoutWithRun({ autonomy: 'trusted', policyExtra: CM });
  const b = baseDeps(fx, []);
  assert.strictEqual(await run(['--run', fx.runDir, '--ceiling'], b.d), 0, b.err());
  assert.strictEqual(b.out(), 'console-resolve.js: ceiling trusted consoleAutoResolve false control-mode on source explicit\n');
});

test('--ceiling: a directory where policy.yml should be is unreadable, exit 3, never supervised', async () => {
  const fx = mainCheckoutWithRun({ writePolicy: false });
  fs.mkdirSync(path.join(fx.root, '.claude-tweaks', 'policy.yml'));
  const b = baseDeps(fx, []);
  assert.strictEqual(await run(['--run', fx.runDir, '--ceiling'], b.d), 3);
  assert.strictEqual(b.out(), '');
  assert.match(b.err(), /console-resolve\.js: ceiling unreadable \(.*EISDIR.*\)/);
});

test('--ceiling: a directory where the run config.yml should be is unreadable too, exit 3', async () => {
  const fx = controlFixture();
  fs.mkdirSync(path.join(fx.runDir, 'config.yml'));
  const b = baseDeps(fx, []);
  assert.strictEqual(await run(['--run', fx.runDir, '--ceiling'], b.d), 3);
  assert.strictEqual(b.out(), '');
  assert.match(b.err(), /ceiling unreadable/);
});

test('--ceiling: an absent policy.yml (ENOENT) is not unreadable: exit 0, source default', async () => {
  const fx = mainCheckoutWithRun({ writePolicy: false });
  const b = baseDeps(fx, []);
  assert.strictEqual(await run(['--run', fx.runDir, '--ceiling'], b.d), 0, b.err());
  assert.strictEqual(b.out(), 'console-resolve.js: ceiling supervised consoleAutoResolve false control-mode off source default\n');
});

test('--ceiling: a policy.yml location under a regular file (ENOTDIR) is absent, not unreadable: exit 0, source default', async () => {
  const fx = mainCheckoutWithRun({ autonomy: null });
  const aFile = path.join(fx.root, 'not-a-dir');
  fs.writeFileSync(aFile, 'x');
  // git reports a "toplevel" that is a file, so the policy path is <file>/.claude-tweaks/policy.yml.
  const b = baseDeps(fx, [], { execFile: (cmd, args) => (cmd === 'git' && args[0] === 'rev-parse' ? `${aFile}\n` : '') });
  assert.strictEqual(await run(['--run', fx.runDir, '--ceiling'], b.d), 0, b.err());
  assert.strictEqual(b.out(), 'console-resolve.js: ceiling supervised consoleAutoResolve false control-mode off source default\n');
});

test('the resolve shape keeps its tolerant read: a directory where policy.yml should be still reads as default (exit 4)', async () => {
  const fx = mainCheckoutWithRun({ writePolicy: false, staged: STAGED });
  fs.mkdirSync(path.join(fx.root, '.claude-tweaks', 'policy.yml'));
  assert.strictEqual(await run(resolveArgs(fx), baseDeps(fx, []).d), 4);
});

test('--ceiling: a relative --run resolves against deps.cwd()', async () => {
  const fx = controlFixture();
  assert.notStrictEqual(process.cwd(), fx.root);
  const b = baseDeps(fx, []);
  assert.strictEqual(await run(['--run', path.relative(fx.root, fx.runDir), '--ceiling'], b.d), 0, b.err());
  assert.match(b.out(), /^console-resolve\.js: ceiling unattended /);
});

// --converge (#4620 Task 8): run-end residue convergence.
const RESIDUE = [
  { id: 'ledger-1', source: 'ledger', text: 'fixed already', status: 'fixed' },
  { id: 'ledger-2', source: 'ledger', text: 'typo in a comment', status: 'open', deferReason: 'tangential', belowFloor: true },
  { id: 'ledger-3', source: 'ledger', text: 'locked worktree held by a live session', status: 'open', deferReason: 'blocked-external', belowFloor: false },
  { id: 'insight-4', source: 'insight', text: 'a convention to capture', status: 'open', belowFloor: false },
];
const itemsFile = (fx, content) => {
  const p = path.join(fx.root, 'residue-items.json');
  fs.writeFileSync(p, typeof content === 'string' ? content : JSON.stringify(content));
  return p;
};
const convergeCall = async (fx, file, ...more) => {
  const b = baseDeps(fx, []);
  const code = await run(['--converge', file, '--run', fx.runDir, ...more], b.d);
  return { code, out: b.out(), err: b.err() };
};

test('AC4.5: --converge writes carried items to decisions.json and prints each state', async () => {
  const fx = controlFixture();
  const r = await convergeCall(fx, itemsFile(fx, RESIDUE));
  assert.strictEqual(r.code, 0, r.err);
  const printed = JSON.parse(r.out);
  assert.deepStrictEqual(printed.items.map((i) => [i.id, i.state]), [['ledger-1', 'resolved'], ['ledger-2', 'digested'], ['ledger-3', 'filed'], ['insight-4', 'carried']]);
  assert.deepStrictEqual(printed.failed, []);
  assert.match(printed.items[2].proposal, /^Title: .+\nType: task\nLabels: \S+\nDefer-reason: blocked-external\n\n/);
  assert.strictEqual(printed.items[3].factId, 'decision:console:insight-4');
  const facts = readJson(FACTS(fx));
  assert.deepStrictEqual(facts.map((f) => f.id), ['decision:console:insight-4']);
  assert.match(facts[0].summary, /^Reflection insights: insight-4 — a convention to capture$/);
  const decisions = fs.readFileSync(path.join(fx.runDir, 'decisions.md'), 'utf8');
  const lines = decisions.split('\n').filter((l) => /^- AUTO .*Residue /.test(l));
  assert.strictEqual(lines.length, 4, decisions);
  assert.match(lines[0], /Residue ledger-1 \(ledger\): resolved.*Reversibility: n\/a\.$/);
  assert.match(lines[1], /Residue ledger-2 \(ledger\): digested.*Reversibility: n\/a\.$/);
  assert.match(lines[2], /Residue ledger-3 \(ledger\): filed.*Reversibility: high\.$/);
  assert.match(lines[3], /Residue insight-4 \(insight\): carried as decision:console:insight-4.*Reversibility: n\/a\.$/);
  // The carried ledger text the prose writes next is accepted by the ledger writer once the fact exists.
  const { checkLedgerStatus } = require(path.join(ROOT, 'plugin', 'bin', 'lib', 'stage-item', 'ledger'));
  assert.strictEqual(checkLedgerStatus('deferred', `carried to the acceptance packet as ${printed.items[3].factId}`, { runDir: fx.runDir }).refusal, null);
  // A re-run adds no second copy of the fact.
  const again = await convergeCall(fx, itemsFile(fx, RESIDUE));
  assert.strictEqual(again.code, 0, again.err);
  assert.strictEqual(readJson(FACTS(fx)).length, 1);
});

test('AC4.6: --converge with an unwritable decisions.json exits 6, marks the carried items failed and names them', async () => {
  const fx = controlFixture();
  fs.mkdirSync(path.dirname(FACTS(fx)), { recursive: true });
  fs.writeFileSync(FACTS(fx), 'not json');
  const items = [...RESIDUE, { id: 'ledger-5', source: 'ledger', text: 'an open choice', status: 'open', belowFloor: false }];
  const r = await convergeCall(fx, itemsFile(fx, items));
  assert.strictEqual(r.code, EXIT_CARRY_FAILED);
  const printed = JSON.parse(r.out);
  assert.deepStrictEqual(printed.items.map((i) => [i.id, i.state]), [['ledger-1', 'resolved'], ['ledger-2', 'digested'], ['ledger-3', 'filed'], ['insight-4', 'failed'], ['ledger-5', 'failed']]);
  assert.deepStrictEqual(printed.failed, ['insight-4', 'ledger-5']);
  assert.strictEqual(printed.items[3].factId, undefined);
  assert.match(r.err, /could not carry 2 item\(s\) to the acceptance packet .*insight-4, ledger-5/);
  assert.strictEqual(fs.readFileSync(FACTS(fx), 'utf8'), 'not json', 'the unreadable file is never overwritten');
  const decisions = fs.readFileSync(path.join(fx.runDir, 'decisions.md'), 'utf8');
  // A failed item is a degrade: SKIP in the Degrade-trace shape, never AUTO.
  assert.match(decisions, /^- SKIP \d\d:\d\d:\d\d — Residue convergence \(degraded\): condition: Residue insight-4 \(insight\) failed — .+ → fallback: not converged; the failure card names it\. Reversibility: n\/a\.$/m);
  assert.match(decisions, /^- SKIP .*Residue ledger-5 \(ledger\) failed/m);
  assert.doesNotMatch(decisions, /^- AUTO .*Residue (insight-4|ledger-5)\b/m);
  assert.match(decisions, /^- AUTO .*Residue ledger-3 \(ledger\): filed/m);
});

test('--converge rejects a malformed items file with exit 2', async () => {
  const fx = controlFixture();
  const cases = [
    'not json',
    '{"id":"x"}',
    [null],
    [{ id: '', source: 'ledger', text: 't', status: 'open' }],
    [{ id: 'a', source: 'review', text: 't', status: 'open' }],
    [{ id: 'a', source: 'ledger', text: '', status: 'open' }],
    [{ id: 'a', source: 'ledger', text: 't' }],
    [{ id: 'a', source: 'ledger', text: 't', status: 'open', belowFloor: 'yes' }],
    [{ id: 'a', source: 'ledger', text: 't', status: 'open', deferReason: 3 }],
    [{ id: 'a', source: 'ledger', text: 't', status: 'open', filingFailed: 1 }],
    [{ id: 'a', source: 'ledger', text: 't', status: 'open' }, { id: 'a', source: 'insight', text: 'u', status: 'open' }],
  ];
  for (const content of cases) {
    const r = await convergeCall(fx, itemsFile(fx, content));
    assert.strictEqual(r.code, 2, JSON.stringify(content));
    assert.strictEqual(r.out, '');
    assert.match(r.err, /--converge /);
  }
  const missing = await convergeCall(fx, path.join(fx.root, 'no-such.json'));
  assert.strictEqual(missing.code, 2);
  assert.strictEqual(lstatAbsent(FACTS(fx)), true, 'nothing is written');
});

test('--converge takes no other flag, --dry-run included', async () => {
  const fx = controlFixture();
  const file = itemsFile(fx, RESIDUE);
  for (const more of [['--dry-run'], ['--json'], ['--policy', 'console-auto'], ['--ceiling'], ['--set-item', 'x']]) {
    const r = await convergeCall(fx, file, ...more);
    assert.strictEqual(r.code, 2, more.join(' '));
    assert.strictEqual(r.out, '');
  }
  assert.strictEqual(lstatAbsent(FACTS(fx)), true);
});

test('--converge: an unanchored --run exits 3 and writes nothing', async () => {
  const fx = controlFixture();
  const elsewhere = fs.realpathSync(scratchDir('console-resolve-cm-elsewhere-'));
  const b = baseDeps(fx, []);
  assert.strictEqual(await run(['--run', elsewhere, '--converge', itemsFile(fx, RESIDUE)], b.d), 3);
  assert.strictEqual(b.out(), '');
});

function lstatAbsent(p) {
  try { fs.lstatSync(p); return false; } catch (err) { return err.code === 'ENOENT'; }
}

// Final-review fixes (#4620).
test('--set-item carried refuses a ledger row already terminal in a status the carry cannot settle: exit 5, no fact written', async () => {
  const fx = controlFixture({ consoleJson: consoleOf([ledgerItem()]) });
  const ledger = path.join(fx.root, 'ledger.md');
  fs.writeFileSync(ledger, LEDGER_HEAD);
  appendRow({ runDir: fx.runDir, ledgerPath: ledger, phase: 'build', item: 'a finding', status: 'fixed', resolution: 'fixed in abc1234, see staged/ledger-record-1.md' });
  const ledgerBefore = fs.readFileSync(ledger, 'utf8');
  const consoleBefore = fs.readFileSync(path.join(fx.runDir, 'console.json'), 'utf8');
  const b = baseDeps(fx, []);
  assert.strictEqual(await run(setItemArgs(fx, 'ledger-record-1.md', 'carried', '--ledger', ledger), b.d), 5, b.err());
  assert.match(b.err(), /ledger row #1 naming staged\/ledger-record-1\.md is already fixed \(terminal\) — nothing written/);
  assert.ok(lstatAbsent(FACTS(fx)), 'no orphan decisions.json');
  assert.strictEqual(fs.readFileSync(ledger, 'utf8'), ledgerBefore);
  assert.strictEqual(fs.readFileSync(path.join(fx.runDir, 'console.json'), 'utf8'), consoleBefore);
});

test('--set-item carried leaves a row with an empty Status cell to settleRow: never refused as terminal', async () => {
  const fx = controlFixture({ consoleJson: consoleOf([ledgerItem()]) });
  const ledger = path.join(fx.root, 'ledger.md');
  fs.writeFileSync(ledger, `${LEDGER_HEAD}| 1 | build | a finding |  | → backlog, staged/ledger-record-1.md |\n`);
  const b = baseDeps(fx, []);
  const code = await run(setItemArgs(fx, 'ledger-record-1.md', 'carried', '--ledger', ledger), b.d);
  assert.ok(!/\(terminal\)/.test(b.err()), b.err());
  assert.strictEqual(code, 0, b.err());
  assert.match(b.out(), /ledger row #1 settled/);
  assert.match(fs.readFileSync(ledger, 'utf8'), /\| 1 \| build \| a finding \| deferred \| carried to the acceptance packet as decision:console:ledger-record-1\.md \|/);
  assert.deepStrictEqual(readJson(FACTS(fx)).map((f) => f.id), ['decision:console:ledger-record-1.md']);
  assert.strictEqual(cj(fx).items[0].resolution, 'carried');
});

test('--set-item carried refuses several ledger rows naming the item: exit 5, no fact, ledger unchanged', async () => {
  const fx = controlFixture({ consoleJson: consoleOf([ledgerItem()]) });
  const ledger = path.join(fx.root, 'ledger.md');
  fs.writeFileSync(ledger, LEDGER_HEAD);
  appendRow({ runDir: fx.runDir, ledgerPath: ledger, phase: 'build', item: 'a finding', status: 'deferred', resolution: '→ backlog, staged/ledger-record-1.md' });
  appendRow({ runDir: fx.runDir, ledgerPath: ledger, phase: 'build', item: 'same finding again', status: 'deferred', resolution: '→ backlog, staged/ledger-record-1.md' });
  const before = fs.readFileSync(ledger, 'utf8');
  const b = baseDeps(fx, []);
  assert.strictEqual(await run(setItemArgs(fx, 'ledger-record-1.md', 'carried', '--ledger', ledger), b.d), 5, b.err());
  assert.match(b.err(), /2 ledger rows name staged\/ledger-record-1\.md/);
  assert.ok(lstatAbsent(FACTS(fx)), 'no orphan decisions.json');
  assert.strictEqual(fs.readFileSync(ledger, 'utf8'), before);
});

test('--set-item carried exits 5 when console.json stops being rewritable after the fact landed', async () => {
  const fx = controlFixture({ consoleJson: consoleOf([ledgerItem()]) });
  const consolePath = path.join(fx.runDir, 'console.json');
  // Depends on carryItem reading `now` immediately before rewriteItemResolution (and after writeDecisionFacts):
  // the flip happens there, as a concurrent writer would. The asserts below pin that this is the refusal path taken.
  const b = baseDeps(fx, [], { now: () => {
    fs.writeFileSync(consolePath, consoleOf([ledgerItem('dropped')]));
    return Date.parse('2026-09-06T12:00:00Z');
  } });
  assert.strictEqual(await run(setItemArgs(fx, 'ledger-record-1.md', 'carried'), b.d), 5, b.err());
  assert.strictEqual(b.err(), 'console-resolve.js: item ledger-record-1.md is dropped, not rewritable to carried (only apply/approve/filed → carried) — the decision fact decision:console:ledger-record-1.md is in decisions.json; the console item is unchanged\n');
  assert.deepStrictEqual(readJson(FACTS(fx)).map((f) => f.id), ['decision:console:ledger-record-1.md'], 'the fact landed before the refusal');
  assert.strictEqual(cj(fx).items[0].resolution, 'dropped');
});

test('the Review Console header says control mode whenever control mode carries, explicit unattended included', async () => {
  const fx = controlFixture({ autonomy: 'unattended' });
  assert.strictEqual(await run(resolveArgs(fx), baseDeps(fx, []).d), 0);
  const decisions = fs.readFileSync(path.join(fx.runDir, 'decisions.md'), 'utf8');
  assert.match(decisions, /Console auto-resolved 2 item\(s\) at unattended \(control mode\)\./);
  // Control: control mode off keeps the plain wording.
  const off = mainCheckoutWithRun({ staged: STAGED });
  assert.strictEqual(await run(resolveArgs(off), baseDeps(off, []).d), 0);
  assert.match(fs.readFileSync(path.join(off.runDir, 'decisions.md'), 'utf8'), /at unattended \(console-resolve\.js\)\./);
});

// Review (#4620): --converge and --memory-write hold the one control-mode gate in code.
test('--converge and --memory-write refuse with exit 4 and write nothing unless control mode is on with consoleAutoResolve granted', async () => {
  const memoryDir = (fx) => { const d = path.join(fx.root, 'memory-home'); fs.mkdirSync(d, { recursive: true }); return d; };
  for (const [label, make] of [
    ['control mode off', () => mainCheckoutWithRun({ autonomy: 'unattended', staged: STAGED })],
    ['control mode on, explicit supervised', () => controlFixture({ autonomy: 'supervised' })],
  ]) {
    const fx = make();
    const items = path.join(fx.root, 'residue-items.json');
    fs.writeFileSync(items, JSON.stringify([{ id: 'insight-1', source: 'insight', text: 't', status: 'open', belowFloor: false }]));
    const conv = baseDeps(fx, []);
    assert.strictEqual(await run(['--converge', items, '--run', fx.runDir], conv.d), 4, label);
    assert.match(conv.err(), /--converge needs control mode on with consoleAutoResolve granted — nothing written/, label);
    assert.ok(!fs.existsSync(FACTS(fx)), label + ': no decision fact written');
    const content = path.join(fx.root, 'content.tmp');
    fs.writeFileSync(content, 'x\n');
    const mem = baseDeps(fx, []);
    assert.strictEqual(await run(['--memory-write', 'a.md', '--memory-dir', memoryDir(fx), '--content-file', content, '--run', fx.runDir], mem.d), 4, label);
    assert.match(mem.err(), /--memory-write needs control mode on/, label);
    assert.ok(!fs.existsSync(path.join(fx.root, 'memory-home', 'a.md')), label + ': no memory file written');
  }
});

test('--converge fails an item whose status is outside the ledger vocabulary instead of dropping it', async () => {
  const fx = controlFixture();
  const items = path.join(fx.root, 'residue-items.json');
  fs.writeFileSync(items, JSON.stringify([{ id: 'ledger-9', source: 'ledger', text: 't', status: 'Open' }]));
  const b = baseDeps(fx, []);
  assert.strictEqual(await run(['--converge', items, '--run', fx.runDir], b.d), EXIT_CARRY_FAILED);
  assert.deepStrictEqual(JSON.parse(b.out()).failed, ['ledger-9']);
  assert.match(b.out(), /unrecognized status 'Open'/);
});

// #4621: wrap-up upstream-feedback items are routed by the ownership of their target repo, read from git only.
const upstreamDraft = (target) => `<!-- upstream-target: ${target} -->\nTitle: dispatch: x\n\nbody\n`;
const UPSTREAM_ITEMS = {
  'wrap-up-upstream-1.md': upstreamDraft('thn-inc/claude-tweaks'),
  'wrap-up-upstream-2.md': upstreamDraft('obra/superpowers'),
  'wrap-up-upstream-3.md': upstreamDraft('acme/widgets'),
};
const BASE_POLICY_KEY = 'git show origin/main:.claude-tweaks/policy.yml';
const ownershipAnswers = (over = {}) => ({
  'git remote get-url origin': 'https://github.com/thn-inc/claude-tweaks.git\n',
  'git rev-parse --abbrev-ref origin/HEAD': 'origin/main\n',
  [BASE_POLICY_KEY]: 'control-mode: on\n',
  ...over,
});
const upstreamFixture = (extra = {}) => controlFixture({ staged: UPSTREAM_ITEMS, ...extra });
async function resolveWith(fx, answers) {
  const calls = [];
  const b = baseDeps(fx, calls, { execFile: fakeExec(calls, fx.root, answers) });
  const code = await run(resolveArgs(fx), b.d);
  return { code, calls, out: b.out(), err: b.err() };
}
const resolutions = (fx) => Object.fromEntries(cj(fx).items.map((i) => [i.id, i.resolution]));
const decisionsOf = (fx) => fs.readFileSync(path.join(fx.runDir, 'decisions.md'), 'utf8');
const ownershipSkips = (fx) => decisionsOf(fx).split('\n').filter((l) => /^- SKIP .*Upstream ownership/.test(l));

test('#4621 AC4.1 / AC4.2: the owned target files, a target off the filing repo is carried to the packet as a decision fact', async () => {
  const fx = upstreamFixture();
  const r = await resolveWith(fx, ownershipAnswers());
  assert.strictEqual(r.code, 0, r.err);
  // obra/superpowers is not the repo /claude-tweaks:feedback files into, so a draft header naming it holds as external.
  assert.deepStrictEqual(resolutions(fx), { 'wrap-up-upstream-1.md': 'filed', 'wrap-up-upstream-2.md': 'carried', 'wrap-up-upstream-3.md': 'carried' });
  assert.deepStrictEqual(readJson(FACTS(fx)).map((f) => f.id), ['decision:upstream:wrap-up-upstream-2.md', 'decision:upstream:wrap-up-upstream-3.md']);
  assert.match(decisionsOf(fx), /Console item wrap-up-upstream-3\.md \(Upstream feedback\): carried — carried to the acceptance packet as decision:upstream:wrap-up-upstream-3\.md — held: external/);
  assert.match(decisionsOf(fx), /Console item wrap-up-upstream-1\.md \(Upstream feedback\): filed — control mode: owned target thn-inc\/claude-tweaks — filed with no prompt/);
  assert.strictEqual(ownershipSkips(fx).length, 0, 'a clean read logs nothing');
  assert.ok(r.calls.some((c) => c.join(' ') === BASE_POLICY_KEY), 'owned-owners is read from the base branch');
  assert.ok(!r.calls.some((c) => c[0] === 'gh' && (c[1] === 'api' || c[1] === 'auth')), JSON.stringify(r.calls));
});

test('#4621 AC5.1: the authenticated gh account changes nothing — byte-identical output and facts, and gh is never asked who it is', async () => {
  const outcomes = [];
  for (const login of ['alice', 'mallory']) {
    const fx = upstreamFixture();
    const r = await resolveWith(fx, ownershipAnswers({ 'gh api user': `${login}\n`, 'gh auth status': `Logged in as ${login}\n` }));
    assert.strictEqual(r.code, 0, r.err);
    assert.ok(!r.calls.some((c) => c[0] === 'gh' && (c.includes('auth') || c.includes('api'))), JSON.stringify(r.calls));
    outcomes.push({ out: r.out.split(fx.root).join('<ROOT>'), facts: fs.readFileSync(FACTS(fx), 'utf8') });
  }
  assert.strictEqual(outcomes[0].out, outcomes[1].out);
  assert.strictEqual(outcomes[0].facts, outcomes[1].facts);
});

// The filing target's owner is thn-inc; a checkout whose origin is under another owner owns it only through owned-owners.
const FOREIGN_ORIGIN = { 'git remote get-url origin': 'https://github.com/zeta/app.git\n' };
const NO_THN = 'control-mode: on\n';
const OWNS_THN = 'owned-owners: thn-inc\n';

test('#4621: owned-owners counts only from the base branch — the same line in the worktree policy files nothing', async () => {
  const worktreeOnly = upstreamFixture({ policyExtra: `${CM}${OWNS_THN}` });
  const r = await resolveWith(worktreeOnly, ownershipAnswers({ ...FOREIGN_ORIGIN, [BASE_POLICY_KEY]: NO_THN }));
  assert.strictEqual(r.code, 0, r.err);
  assert.deepStrictEqual(resolutions(worktreeOnly), { 'wrap-up-upstream-1.md': 'carried', 'wrap-up-upstream-2.md': 'carried', 'wrap-up-upstream-3.md': 'carried' });
  const onBase = upstreamFixture();
  assert.strictEqual((await resolveWith(onBase, ownershipAnswers({ ...FOREIGN_ORIGIN, [BASE_POLICY_KEY]: OWNS_THN }))).code, 0);
  assert.strictEqual(resolutions(onBase)['wrap-up-upstream-1.md'], 'filed');
});

test('#4621: an owned-owners entry for a draft header\'s owner never files it — the issue lands in the pinned repo, not the header\'s', async () => {
  const fx = upstreamFixture();
  const r = await resolveWith(fx, ownershipAnswers({ [BASE_POLICY_KEY]: 'owned-owners: obra, acme\n' }));
  assert.strictEqual(r.code, 0, r.err);
  assert.deepStrictEqual(resolutions(fx), { 'wrap-up-upstream-1.md': 'filed', 'wrap-up-upstream-2.md': 'carried', 'wrap-up-upstream-3.md': 'carried' });
});

test('#4621: the base branch is origin/HEAD\'s when it resolves, main when it does not', async () => {
  // origin/HEAD names trunk: only trunk's policy carries obra, main's does not.
  const head = upstreamFixture();
  const viaHead = await resolveWith(head, ownershipAnswers({ ...FOREIGN_ORIGIN, 'git rev-parse --abbrev-ref origin/HEAD': 'origin/trunk\n', 'git show origin/trunk:.claude-tweaks/policy.yml': OWNS_THN, [BASE_POLICY_KEY]: NO_THN }));
  assert.strictEqual(viaHead.code, 0, viaHead.err);
  assert.strictEqual(resolutions(head)['wrap-up-upstream-1.md'], 'filed');
  assert.ok(viaHead.calls.some((c) => c.join(' ') === 'git show origin/trunk:.claude-tweaks/policy.yml'));
  assert.strictEqual(ownershipSkips(head).length, 0, 'a resolved origin/HEAD logs nothing');

  // origin/HEAD does not resolve: main is read, and only main carries obra.
  const last = upstreamFixture();
  const viaDefault = await resolveWith(last, ownershipAnswers({ ...FOREIGN_ORIGIN, 'git rev-parse --abbrev-ref origin/HEAD': new Error('no origin/HEAD'), [BASE_POLICY_KEY]: OWNS_THN }));
  assert.strictEqual(viaDefault.code, 0, viaDefault.err);
  assert.strictEqual(resolutions(last)['wrap-up-upstream-1.md'], 'filed');
  assert.ok(viaDefault.calls.some((c) => c.join(' ') === BASE_POLICY_KEY));
  // The fallback decides which policy is read, so it is logged rather than silent.
  const skips = ownershipSkips(last);
  assert.strictEqual(skips.length, 1, decisionsOf(last));
  assert.match(skips[0], /origin\/HEAD could not be resolved .* → fallback: the base branch read as main/);
});

test('#4621: a checkout integration-branch (policy or run config) never picks the branch whose policy decides ownership', async () => {
  const fx = upstreamFixture({ policyExtra: `${CM}integration-branch: evil\n`, runConfig: 'integration-branch: evil\n' });
  const r = await resolveWith(fx, ownershipAnswers({ ...FOREIGN_ORIGIN, 'git show origin/evil:.claude-tweaks/policy.yml': OWNS_THN, [BASE_POLICY_KEY]: NO_THN }));
  assert.strictEqual(r.code, 0, r.err);
  assert.deepStrictEqual(resolutions(fx), { 'wrap-up-upstream-1.md': 'carried', 'wrap-up-upstream-2.md': 'carried', 'wrap-up-upstream-3.md': 'carried' });
  assert.ok(!r.calls.some((c) => c.join(' ').includes('origin/evil')), JSON.stringify(r.calls));
});

test('#4621: a base-branch owned-owners of [] is the empty list — nothing owned, nothing logged', async () => {
  const fx = upstreamFixture();
  const r = await resolveWith(fx, ownershipAnswers({ [BASE_POLICY_KEY]: 'owned-owners: []\n' }));
  assert.strictEqual(r.code, 0, r.err);
  assert.deepStrictEqual(resolutions(fx), { 'wrap-up-upstream-1.md': 'filed', 'wrap-up-upstream-2.md': 'carried', 'wrap-up-upstream-3.md': 'carried' });
  assert.strictEqual(ownershipSkips(fx).length, 0, decisionsOf(fx));
});

test('#4621: a base-branch owned-owners of [ ] (inner whitespace) is the empty list too — nothing owned, nothing logged', async () => {
  for (const spelling of ['[ ]', '[   ]', '[\t]']) {
    const fx = upstreamFixture();
    const r = await resolveWith(fx, ownershipAnswers({ [BASE_POLICY_KEY]: `owned-owners: ${spelling}\n` }));
    assert.strictEqual(r.code, 0, r.err);
    assert.deepStrictEqual(resolutions(fx), { 'wrap-up-upstream-1.md': 'filed', 'wrap-up-upstream-2.md': 'carried', 'wrap-up-upstream-3.md': 'carried' }, JSON.stringify(spelling));
    assert.strictEqual(ownershipSkips(fx).length, 0, `${JSON.stringify(spelling)}: ${decisionsOf(fx)}`);
  }
});

test('#4621 Review Focus 3: an unreadable base-branch policy files owner-owned targets, holds the rest, and logs one SKIP naming it', async () => {
  const fx = upstreamFixture();
  const r = await resolveWith(fx, ownershipAnswers({ [BASE_POLICY_KEY]: new Error('fatal: path .claude-tweaks/policy.yml does not exist in origin/main') }));
  assert.strictEqual(r.code, 0, r.err);
  assert.deepStrictEqual(resolutions(fx), { 'wrap-up-upstream-1.md': 'filed', 'wrap-up-upstream-2.md': 'carried', 'wrap-up-upstream-3.md': 'carried' });
  const skips = ownershipSkips(fx);
  assert.strictEqual(skips.length, 1, decisionsOf(fx));
  assert.match(skips[0], /condition: base-branch policy origin\/main:\.claude-tweaks\/policy\.yml could not be read .* → fallback: owned-owners read as \[\]/);
  assert.match(skips[0], /Reversibility: n\/a\.$/);
});

test('#4621 AC7.3: a malformed owned-owners entry is ignored on its own, never the whole list, and is logged once', async () => {
  const fx = upstreamFixture();
  const r = await resolveWith(fx, ownershipAnswers({ ...FOREIGN_ORIGIN, [BASE_POLICY_KEY]: 'owned-owners: thn-inc, acme.\n' }));
  assert.strictEqual(r.code, 0, r.err);
  assert.deepStrictEqual(resolutions(fx), { 'wrap-up-upstream-1.md': 'filed', 'wrap-up-upstream-2.md': 'carried', 'wrap-up-upstream-3.md': 'carried' });
  const skips = ownershipSkips(fx);
  assert.strictEqual(skips.length, 1, decisionsOf(fx));
  assert.ok(skips[0].includes('"acme."') && skips[0].includes('→ fallback: the entry ignored'), skips[0]);
});

test('#4621: an unreadable origin holds every target as owner-unresolved and logs one SKIP', async () => {
  const fx = upstreamFixture();
  const r = await resolveWith(fx, ownershipAnswers({ 'git remote get-url origin': new Error('fatal: No such remote origin') }));
  assert.strictEqual(r.code, 0, r.err);
  assert.deepStrictEqual(Object.values(resolutions(fx)), ['carried', 'carried', 'carried']);
  assert.match(decisionsOf(fx), /held: owner-unresolved/);
  const skips = ownershipSkips(fx);
  assert.strictEqual(skips.length, 1, decisionsOf(fx));
  assert.match(skips[0], /origin remote could not be read .* → fallback: targets held/);
});

test('#4621: ownership is read only when an upstream item files — no upstream item, no git call for it; --dry-run logs nothing', async () => {
  const plain = controlFixture();
  const none = await resolveWith(plain, {});
  assert.strictEqual(none.code, 0, none.err);
  assert.ok(!none.calls.some((c) => c.includes('get-url') || c[1] === 'show'), JSON.stringify(none.calls));

  const dry = upstreamFixture();
  const calls = [];
  const b = baseDeps(dry, calls, { execFile: fakeExec(calls, dry.root, ownershipAnswers({ [BASE_POLICY_KEY]: new Error('unreadable') })) });
  assert.strictEqual(await run(resolveArgs(dry, '--dry-run'), b.d), 0, b.err());
  assert.ok(!fs.existsSync(path.join(dry.runDir, 'console.json')));
  assert.strictEqual(ownershipSkips(dry).length, 0, 'a dry run writes nothing');
});

test('#4621: outside control mode an upstream item still files and nothing about ownership is read', async () => {
  const fx = mainCheckoutWithRun({ staged: UPSTREAM_ITEMS });
  const calls = [];
  const b = baseDeps(fx, calls);
  assert.strictEqual(await run(resolveArgs(fx), b.d), 0, b.err());
  assert.deepStrictEqual(Object.values(resolutions(fx)), ['filed', 'filed', 'filed']);
  assert.ok(!calls.some((c) => c.includes('get-url') || c[1] === 'show'), JSON.stringify(calls));
  assert.ok(!fs.existsSync(path.join(fx.runDir, 'packet-facts')));
});

const bundleItem = (resolution = 'apply') => ({ id: 'bundle-1.md', section: 'Queue writes', resolution, reason: 'bundled queue write' });

test('a carried bundle settles every ledger row naming it (#6283)', async () => {
  const fx = controlFixture({ consoleJson: consoleOf([bundleItem()]), staged: { 'bundle-1.md': 'b' } });
  const ledger = path.join(fx.root, 'ledger.md');
  fs.writeFileSync(ledger, LEDGER_HEAD);
  for (const item of ['one', 'two']) appendRow({ runDir: fx.runDir, ledgerPath: ledger, phase: 'build', item, status: 'deferred', resolution: '→ backlog, staged/bundle-1.md' });
  appendRow({ runDir: fx.runDir, ledgerPath: ledger, phase: 'build', item: 'other', status: 'deferred', resolution: '→ backlog, staged/bundle-10.md' });
  const b = baseDeps(fx, []);
  assert.strictEqual(await run(setItemArgs(fx, 'bundle-1.md', 'carried', '--ledger', ledger), b.d), 0, b.err());
  const text = fs.readFileSync(ledger, 'utf8');
  assert.match(text, /\| 1 \| build \| one \| deferred \| carried to the acceptance packet as decision:console:bundle-1\.md \|/);
  assert.match(text, /\| 2 \| build \| two \| deferred \| carried to the acceptance packet as decision:console:bundle-1\.md \|/);
  assert.match(text, /\| 3 \| build \| other \| deferred \| → backlog, staged\/bundle-10\.md \|/, 'a prefix-sharing id is untouched');
  assert.match(b.out(), /ledger rows #1, #2 settled/);
  assert.strictEqual(cj(fx).items[0].resolution, 'carried');
  assert.deepStrictEqual(readJson(FACTS(fx)).map((f) => f.id), ['decision:console:bundle-1.md'], 'one decision fact for the bundle');
  // A re-run finds every row already carried and changes nothing.
  const again = baseDeps(fx, []);
  assert.strictEqual(await run(setItemArgs(fx, 'bundle-1.md', 'carried', '--ledger', ledger), again.d), 0, again.err());
  assert.strictEqual(fs.readFileSync(ledger, 'utf8'), text);
});

test('a carried bundle with a terminal-fixed member row refuses before writing anything', async () => {
  const fx = controlFixture({ consoleJson: consoleOf([bundleItem()]), staged: { 'bundle-1.md': 'b' } });
  const ledger = path.join(fx.root, 'ledger.md');
  fs.writeFileSync(ledger, LEDGER_HEAD);
  appendRow({ runDir: fx.runDir, ledgerPath: ledger, phase: 'build', item: 'one', status: 'deferred', resolution: '→ backlog, staged/bundle-1.md' });
  appendRow({ runDir: fx.runDir, ledgerPath: ledger, phase: 'build', item: 'two', status: 'fixed', resolution: 'staged/bundle-1.md done' });
  const before = fs.readFileSync(ledger, 'utf8');
  const b = baseDeps(fx, []);
  assert.strictEqual(await run(setItemArgs(fx, 'bundle-1.md', 'carried', '--ledger', ledger), b.d), 5);
  assert.match(b.err(), /already fixed \(terminal\)/);
  assert.strictEqual(fs.readFileSync(ledger, 'utf8'), before);
  assert.ok(!fs.existsSync(path.join(fx.runDir, 'packet-facts')));
  assert.strictEqual(cj(fx).items[0].resolution, 'apply');
});

test('a carried bundle whose second row cannot be settled exits 3 naming the settled row; the repaired re-run finishes', async () => {
  const fx = controlFixture({ consoleJson: consoleOf([bundleItem()]), staged: { 'bundle-1.md': 'b' } });
  const ledger = path.join(fx.root, 'ledger.md');
  fs.writeFileSync(ledger, LEDGER_HEAD);
  appendRow({ runDir: fx.runDir, ledgerPath: ledger, phase: 'build', item: 'one', status: 'deferred', resolution: '→ backlog, staged/bundle-1.md' });
  // A six-cell row (a stray pipe in the Resolution) is found by the carry scan but rewriteLedgerRow refuses it.
  const good = fs.readFileSync(ledger, 'utf8');
  fs.writeFileSync(ledger, `${good}| 2 | build | two | deferred | → backlog | staged/bundle-1.md |\n`);
  const b = baseDeps(fx, []);
  assert.strictEqual(await run(setItemArgs(fx, 'bundle-1.md', 'carried', '--ledger', ledger), b.d), 3);
  assert.match(b.err(), /could not settle ledger row #2 .*— item bundle-1\.md unchanged; ledger row #1 already settled/);
  const half = fs.readFileSync(ledger, 'utf8');
  assert.match(half, /\| 1 \| build \| one \| deferred \| carried to the acceptance packet as decision:console:bundle-1\.md \|/);
  assert.match(half, /\| 2 \| build \| two \| deferred \| → backlog \| staged\/bundle-1\.md \|/);
  assert.strictEqual(cj(fx).items[0].resolution, 'apply', 'the console item is unchanged');
  fs.writeFileSync(ledger, half.replace('→ backlog | staged', '→ backlog, staged'));
  const again = baseDeps(fx, []);
  assert.strictEqual(await run(setItemArgs(fx, 'bundle-1.md', 'carried', '--ledger', ledger), again.d), 0, again.err());
  const done = fs.readFileSync(ledger, 'utf8');
  assert.match(done, /\| 1 \| build \| one \| deferred \| carried to the acceptance packet as decision:console:bundle-1\.md \|/);
  assert.match(done, /\| 2 \| build \| two \| deferred \| carried to the acceptance packet as decision:console:bundle-1\.md \|/);
  assert.strictEqual(cj(fx).items[0].resolution, 'carried');
});

test('--ledger still exits 2 for an id that is neither bundle-* nor ledger-record-*', async () => {
  const fx = controlFixture({ consoleJson: consoleOf([{ ...leftover(), id: 'bundled-1.md' }]) });
  const b = baseDeps(fx, []);
  assert.strictEqual(await run(setItemArgs(fx, 'bundled-1.md', 'carried', '--ledger', 'ledger.md'), b.d), 2);
  assert.match(b.err(), /--ledger applies only to a ledger-record-\* item or a bundle-\* item/);
});
