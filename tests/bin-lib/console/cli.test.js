'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const CLI = path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'console-resolve.js');
const { run } = require(CLI);

function mainCheckoutWithRun({ autonomy = 'unattended', staged = {}, decisions = '', policyExtra = '', writePolicy = true, runConfig = null, consoleJson = null } = {}) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'console-resolve-cli-')));
  const git = (...a) => execFileSync('git', a, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  git('init', '-q'); git('config', 'user.email', 't@example.invalid'); git('config', 'user.name', 't'); git('commit', '-q', '--allow-empty', '-m', 'init');
  fs.mkdirSync(path.join(root, '.claude-tweaks'), { recursive: true });
  if (writePolicy) fs.writeFileSync(path.join(root, '.claude-tweaks', 'policy.yml'), `autonomy: ${autonomy}\n${policyExtra}`);
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

const THREE = { 'reflect-1.md': 'r', 'wrap-up-memory-1.md': 'm', 'wrap-up-upstream-1.md': 'u' };

// The ceiling read runs `git rev-parse --show-toplevel` through the same execFile
// seam, so the fake must answer it with the fixture root — otherwise
// resolvePolicyConfig falls back to process.cwd() and reads THIS repo's policy.yml.
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

test('unattended: exit 0, one decisions block of items+1 lines, console.json resolved, one table row per item (#1932 AC5)', async () => {
  const fx = mainCheckoutWithRun({ staged: THREE });
  const calls = [];
  const { d, out } = baseDeps(fx, calls);
  const code = await run(['--run', fx.runDir, '--policy', 'console-auto'], d);
  assert.strictEqual(code, 0);
  const decisions = fs.readFileSync(path.join(fx.runDir, 'decisions.md'), 'utf8');
  const block = decisions.split('\n').filter((l) => /^- AUTO .*Console/.test(l));
  assert.strictEqual(block.length, 3 + 1, 'header + one line per item');
  assert.match(block[0], /Console auto-resolved 3 item\(s\) at unattended \(console-resolve\.js\)\. Reversibility: per item\./);
  const cj = JSON.parse(fs.readFileSync(path.join(fx.runDir, 'console.json'), 'utf8'));
  assert.strictEqual(cj.resolved, true);
  assert.strictEqual(cj.mode, 'auto-resolve');
  assert.strictEqual(cj.ceiling, 'unattended');
  assert.strictEqual(cj.items.length, 3);
  assert.deepStrictEqual(cj.merge, { resolution: 'merge', reason: 'every member carries auto:merge or a matured auto:merge-pending; no needs-human verdict' });
  const rows = out().split('\n').filter((l) => /AUTO-RESOLVED/.test(l));
  assert.strictEqual(rows.length, 3 + 1, 'one row per item plus the cleanup row');
  // #1932 M2: the closed reversibility vocabulary, and the stage path on every
  // item that is backed by a staged/ file.
  for (const line of block.slice(1)) assert.match(line, /Reversibility: (high|med|low|n\/a)\.$/, line);
  assert.ok(block.some((l) => /Console item reflect-1\.md \(Queue writes\): apply — .*\(staged\/reflect-1\.md\)\. Reversibility: med\.$/.test(l)), block.join('\n'));
});

// grant-veto-window-hours only reaches evaluateMaturation if the CLI resolves
// it: 30h-old pending grant, matured under the 24h default, still inside a 72h
// window. Same fixture, two policies, opposite merge halves.
const PENDING_30H = JSON.stringify({
  labels: [{ name: 'auto:merge-pending' }],
  comments: [{ body: 'Grant recorded.\n<!-- grant-mode-audit: date=2026-09-05T06:00:00Z auto-merge=pending -->' }],
});

function pendingGrantExec(root) {
  return (cmd, args) => {
    if (cmd === 'git' && args[0] === 'rev-parse') return `${root}\n`;
    if (cmd === 'gh' && args[0] === 'issue' && args[1] === 'view') return PENDING_30H;
    if (cmd === 'git' && args[0] === 'apply') return '';
    throw new Error(`unexpected exec: ${cmd} ${args.join(' ')}`);
  };
}

test('grant-veto-window-hours is resolved and passed to the maturation check, never left at the 24h default (#1932 C2)', async () => {
  const wide = mainCheckoutWithRun({ staged: THREE, policyExtra: 'grant-veto-window-hours: 72\n' });
  const a = baseDeps(wide, [], { execFile: pendingGrantExec(wide.root) });
  assert.strictEqual(await run(['--run', wide.runDir, '--policy', 'console-auto'], a.d), 0);
  const wideMerge = JSON.parse(fs.readFileSync(path.join(wide.runDir, 'console.json'), 'utf8')).merge;
  assert.strictEqual(wideMerge.resolution, 'leave-open');
  assert.match(wideMerge.reason, /veto window is 72h/);

  const dflt = mainCheckoutWithRun({ staged: THREE });
  const b = baseDeps(dflt, [], { execFile: pendingGrantExec(dflt.root) });
  assert.strictEqual(await run(['--run', dflt.runDir, '--policy', 'console-auto'], b.d), 0);
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(dflt.runDir, 'console.json'), 'utf8')).merge.resolution, 'merge');
});

test('a console.json already recording resolved: true re-renders and appends nothing (#1932 I3a)', async () => {
  const stored = {
    resolved: true, mode: 'auto-resolve', at: '2026-09-06T11:00:00.000Z', ceiling: 'unattended',
    items: [{ id: 'reflect-1.md', section: 'Queue writes', resolution: 'apply', reason: 'pre-checked Apply default (batched-item-drill.md)' }],
    merge: { resolution: 'merge', reason: 'every member carries auto:merge' },
  };
  const fx = mainCheckoutWithRun({ staged: THREE, consoleJson: `${JSON.stringify(stored, null, 2)}\n` });
  const rawBefore = fs.readFileSync(path.join(fx.runDir, 'console.json'), 'utf8');
  const decisionsBefore = fs.readFileSync(path.join(fx.runDir, 'decisions.md'), 'utf8');
  const { d, out } = baseDeps(fx, []);
  assert.strictEqual(await run(['--run', fx.runDir, '--policy', 'console-auto'], d), 0);
  assert.match(out(), /already records a resolved console/);
  assert.match(out(), /reflect-1\.md \| AUTO-RESOLVED: apply/);
  assert.strictEqual(fs.readFileSync(path.join(fx.runDir, 'console.json'), 'utf8'), rawBefore, 'console.json is not rewritten');
  assert.strictEqual(fs.readFileSync(path.join(fx.runDir, 'decisions.md'), 'utf8'), decisionsBefore, 'nothing appended to decisions.md');
});

test('a console.json rendered on the PR and awaiting a human exits 5 and writes nothing (#1932 I3b)', async () => {
  const stored = {
    commentIds: ['IC_kwDO_primary'], prNumber: 42,
    items: [{ id: 'staged-5', kind: 'staged', summary: '2 severity:medium findings', stagedHash: 'a1b2c3' }],
    mergeCheckVerdict: 'needs-human',
  };
  const fx = mainCheckoutWithRun({ staged: THREE, consoleJson: `${JSON.stringify(stored, null, 2)}\n` });
  const rawBefore = fs.readFileSync(path.join(fx.runDir, 'console.json'), 'utf8');
  const decisionsBefore = fs.readFileSync(path.join(fx.runDir, 'decisions.md'), 'utf8');
  const { d, err } = baseDeps(fx, []);
  assert.strictEqual(await run(['--run', fx.runDir, '--policy', 'console-auto'], d), 5);
  assert.match(err(), /rendered on PR #42/);
  assert.strictEqual(fs.readFileSync(path.join(fx.runDir, 'console.json'), 'utf8'), rawBefore);
  assert.strictEqual(fs.readFileSync(path.join(fx.runDir, 'decisions.md'), 'utf8'), decisionsBefore);
});

test('a PR-rendered console the reconciler already executed is reported, never re-resolved or rendered as undefined (#1932 N3)', async () => {
  const stored = {
    resolved: true, prNumber: 42, commentIds: ['IC_kwDO_primary'],
    items: [{ id: 'staged-5', kind: 'staged', summary: '2 severity:medium findings', stagedHash: 'a1b2c3', commentId: 'IC_kwDO_primary' }],
  };
  const fx = mainCheckoutWithRun({ staged: THREE, consoleJson: `${JSON.stringify(stored, null, 2)}\n` });
  const rawBefore = fs.readFileSync(path.join(fx.runDir, 'console.json'), 'utf8');
  const decisionsBefore = fs.readFileSync(path.join(fx.runDir, 'decisions.md'), 'utf8');
  const { d, out } = baseDeps(fx, []);
  assert.strictEqual(await run(['--run', fx.runDir, '--policy', 'console-auto'], d), 0);
  assert.match(out(), /rendered on PR #42 and already resolved there/);
  assert.match(out(), /staged-5/);
  assert.ok(!/undefined/.test(out()), out());
  assert.strictEqual(fs.readFileSync(path.join(fx.runDir, 'console.json'), 'utf8'), rawBefore);
  assert.strictEqual(fs.readFileSync(path.join(fx.runDir, 'decisions.md'), 'utf8'), decisionsBefore);
});

test('--dry-run against a PR-rendered console warns instead of exiting 5, and still previews (#1932 N4)', async () => {
  const stored = { prNumber: 42, commentIds: ['IC_kwDO_primary'], items: [{ id: 'staged-5', kind: 'staged', summary: '2 findings' }], mergeCheckVerdict: 'needs-human' };
  const fx = mainCheckoutWithRun({ staged: THREE, consoleJson: `${JSON.stringify(stored, null, 2)}\n` });
  const rawBefore = fs.readFileSync(path.join(fx.runDir, 'console.json'), 'utf8');
  const decisionsBefore = fs.readFileSync(path.join(fx.runDir, 'decisions.md'), 'utf8');
  const { d, out, err } = baseDeps(fx, []);
  assert.strictEqual(await run(['--run', fx.runDir, '--policy', 'console-auto', '--dry-run'], d), 0);
  assert.match(err(), /awaiting a human — refusing to overwrite it/);
  assert.match(err(), /--dry-run — previewing anyway/);
  assert.match(out(), /AUTO-RESOLVED/, 'the preview still renders');
  assert.strictEqual(fs.readFileSync(path.join(fx.runDir, 'console.json'), 'utf8'), rawBefore);
  assert.strictEqual(fs.readFileSync(path.join(fx.runDir, 'decisions.md'), 'utf8'), decisionsBefore);
});

test('an unparseable console.json fails closed with exit 5 rather than being clobbered (#1932 I3c)', async () => {
  const fx = mainCheckoutWithRun({ staged: THREE, consoleJson: '{ "resolved": true,' });
  const { d, err } = baseDeps(fx, []);
  assert.strictEqual(await run(['--run', fx.runDir, '--policy', 'console-auto'], d), 5);
  assert.match(err(), /does not parse as JSON/);
  assert.strictEqual(fs.readFileSync(path.join(fx.runDir, 'console.json'), 'utf8'), '{ "resolved": true,');
});

test('run config beats project policy: config.yml unattended over policy.yml trusted resolves (#1932 M9)', async () => {
  const fx = mainCheckoutWithRun({ autonomy: 'trusted', staged: THREE, runConfig: 'autonomy: unattended\n' });
  const { d } = baseDeps(fx, []);
  assert.strictEqual(await run(['--run', fx.runDir, '--policy', 'console-auto'], d), 0);
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(fx.runDir, 'console.json'), 'utf8')).ceiling, 'unattended');
});

test('no policy.yml at all falls to the supervised default: exit 4, nothing written (#1932 M9)', async () => {
  const fx = mainCheckoutWithRun({ staged: THREE, writePolicy: false });
  const { d, err } = baseDeps(fx, []);
  assert.strictEqual(await run(['--run', fx.runDir, '--policy', 'console-auto'], d), 4);
  assert.match(err(), /consoleAutoResolve/);
  assert.ok(!fs.existsSync(path.join(fx.runDir, 'console.json')));
});

test('trusted: exit 4 and nothing written (#1932 AC5)', async () => {
  const fx = mainCheckoutWithRun({ autonomy: 'trusted', staged: THREE });
  const before = fs.readFileSync(path.join(fx.runDir, 'decisions.md'), 'utf8');
  const { d, err } = baseDeps(fx, []);
  assert.strictEqual(await run(['--run', fx.runDir, '--policy', 'console-auto'], d), 4);
  assert.match(err(), /consoleAutoResolve/);
  assert.strictEqual(fs.readFileSync(path.join(fx.runDir, 'decisions.md'), 'utf8'), before);
  assert.ok(!fs.existsSync(path.join(fx.runDir, 'console.json')));
});

test('--dry-run at unattended prints the table and writes nothing (#1932 AC5)', async () => {
  const fx = mainCheckoutWithRun({ staged: THREE });
  const before = fs.readFileSync(path.join(fx.runDir, 'decisions.md'), 'utf8');
  const { d, out } = baseDeps(fx, []);
  assert.strictEqual(await run(['--run', fx.runDir, '--policy', 'console-auto', '--dry-run'], d), 0);
  assert.match(out(), /AUTO-RESOLVED/);
  assert.strictEqual(fs.readFileSync(path.join(fx.runDir, 'decisions.md'), 'utf8'), before);
  assert.ok(!fs.existsSync(path.join(fx.runDir, 'console.json')));
});

test('--json prints the result object instead of the table (#1932)', async () => {
  const fx = mainCheckoutWithRun({ staged: THREE });
  const { d, out } = baseDeps(fx, []);
  assert.strictEqual(await run(['--run', fx.runDir, '--policy', 'console-auto', '--json'], d), 0);
  const parsed = JSON.parse(out());
  assert.strictEqual(parsed.items.length, 3);
  assert.ok(!('snapshot' in parsed), 'the snapshot is internal');
});

test('malformed: a policy other than console-auto exits 2 (#1932 Gotcha)', async () => {
  const fx = mainCheckoutWithRun();
  const { d } = baseDeps(fx, []);
  assert.strictEqual(await run(['--run', fx.runDir, '--policy', 'manual'], d), 2);
});

test('malformed: a --run that is not a directory exits 2 (#1932 Gotcha)', async () => {
  const fx = mainCheckoutWithRun();
  const { d } = baseDeps(fx, []);
  assert.strictEqual(await run(['--run', path.join(fx.runDir, 'nope'), '--policy', 'console-auto'], d), 2);
});

test('malformed: a missing --run exits 2 (#1932 Gotcha)', async () => {
  const fx = mainCheckoutWithRun();
  const { d } = baseDeps(fx, []);
  assert.strictEqual(await run(['--policy', 'console-auto'], d), 2);
});

test('a --run outside the main checkout exits 3 and writes nothing (#1932 AC5)', async () => {
  const fx = mainCheckoutWithRun();
  const shadow = fs.mkdtempSync(path.join(os.tmpdir(), 'console-resolve-shadow-'));
  fs.mkdirSync(path.join(shadow, 'staged'));
  fs.writeFileSync(path.join(shadow, 'decisions.md'), '');
  const { d, err } = baseDeps(fx, []);
  assert.strictEqual(await run(['--run', shadow, '--policy', 'console-auto'], d), 3);
  assert.match(err(), /not anchored|missing/);
  assert.ok(!fs.existsSync(path.join(shadow, 'console.json')));
});

test('the merge is computed, never executed: no gh pr merge / git merge across a full run (#1932 Gotcha)', async () => {
  const fx = mainCheckoutWithRun({ staged: THREE });
  const calls = [];
  const { d } = baseDeps(fx, calls);
  assert.strictEqual(await run(['--run', fx.runDir, '--policy', 'console-auto'], d), 0);
  for (const c of calls) {
    assert.ok(!(c[0] === 'gh' && c[1] === 'pr' && c[2] === 'merge'), `gh pr merge invoked: ${c.join(' ')}`);
    assert.ok(!(c[0] === 'git' && c[1] === 'merge'), `git merge invoked: ${c.join(' ')}`);
  }
  assert.ok(calls.some((c) => c[0] === 'gh' && c[1] === 'issue' && c[2] === 'view'), 'grants were read live');
});

test('a gh failure while reading grants leaves the PR open with reason grants-unreadable (#1932 AC3)', async () => {
  const fx = mainCheckoutWithRun({ staged: THREE });
  const { d } = baseDeps(fx, [], { execFile: (cmd, args) => { if (cmd === 'gh') throw new Error('gh: not logged in'); if (cmd === 'git' && args[0] === 'rev-parse') return `${fx.root}\n`; return ''; } });
  assert.strictEqual(await run(['--run', fx.runDir, '--policy', 'console-auto'], d), 0);
  const cj = JSON.parse(fs.readFileSync(path.join(fx.runDir, 'console.json'), 'utf8'));
  assert.deepStrictEqual(cj.merge, { resolution: 'leave-open', reason: 'grants-unreadable' });
});

// #2007: flow/multispec-review-console.md's short-circuit fans this CLI out over one
// `--run {dir}` call per spec-{N}/ subdirectory plus the parent — never a single call over
// the whole tree. Each call is an independent process invocation over its own directory with
// no shared state, so one directory's failure (here: an unparseable console.json, the same
// exit-5 fail-closed case pinned above) cannot affect a sibling directory's own call. This is
// the mechanism the skill prose's "per-call isolation" instruction relies on — proved directly
// against the real CLI rather than asserted only in prose.
test('multi-spec fan-out isolation: one spec dir\'s unparseable console.json does not affect a sibling spec dir\'s own resolution (#2007)', async () => {
  const fx = mainCheckoutWithRun({ staged: THREE });
  // Build a second, independent run dir under the SAME main checkout root, simulating a
  // sibling `spec-{N}/` directory in a multi-spec parent run — same root, same policy.yml,
  // different `.claude-tweaks/pipelines/{id}` directory, so it is anchored under $RUN_ROOT
  // exactly as spec-1's fixture dir already is.
  const okDir = path.join(fx.root, '.claude-tweaks', 'pipelines', '2026-09-06T000000-record-8');
  fs.mkdirSync(path.join(okDir, 'staged'), { recursive: true });
  fs.mkdirSync(path.join(okDir, 'work'), { recursive: true });
  fs.writeFileSync(path.join(okDir, 'work', '8-spec.md'), '---\nrecord: 8\n---\n');
  fs.writeFileSync(path.join(okDir, 'decisions.md'), '');
  fs.writeFileSync(path.join(okDir, 'staged', 'wrap-up-memory-1.md'), 'm');

  // Mark the FIRST fixture dir's console.json as already-unparseable — this is what makes
  // that one directory's call fail with exit 5.
  fs.writeFileSync(path.join(fx.runDir, 'console.json'), '{ not json');

  const { d: badDeps, err: badErr } = baseDeps(fx, []);
  const badCode = await run(['--run', fx.runDir, '--policy', 'console-auto'], badDeps);
  assert.strictEqual(badCode, 5, 'the malformed directory fails closed');
  assert.match(badErr(), /does not parse as JSON/);

  // The sibling directory's own call is a separate process invocation with no shared state —
  // it must resolve normally regardless of the other call's failure, whichever order they run in.
  const { d: okDeps } = baseDeps(fx, []);
  const okCode = await run(['--run', okDir, '--policy', 'console-auto'], okDeps);
  assert.strictEqual(okCode, 0, 'the sibling directory is unaffected by the other call\'s failure');
  const okConsole = JSON.parse(fs.readFileSync(path.join(okDir, 'console.json'), 'utf8'));
  assert.strictEqual(okConsole.resolved, true);
  assert.strictEqual(okConsole.items.length, 1);

  // And the failed directory's own console.json is untouched (never clobbered) by the sibling's
  // successful call — each call only ever writes its own `--run` directory.
  assert.strictEqual(fs.readFileSync(path.join(fx.runDir, 'console.json'), 'utf8'), '{ not json');
});
