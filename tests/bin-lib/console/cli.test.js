'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const CLI = path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'console-resolve.js');
const PLUGIN_ROOT = path.resolve(__dirname, '..', '..', '..', 'plugin');
const { run, ghReadGrants, checkPatchStack } = require(CLI);
const { gitEnv } = require('../../../plugin/bin/lib/staged-patch/stack-check');

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

test('a dismissed shadow-dup duplicate logs reversibility n/a (#3946)', async () => {
  const fx = mainCheckoutWithRun({ staged: { 'wrap-up-memory-1.md': 'same', 'wrap-up-memory-1.md.shadow-dup': 'same' } });
  const { d } = baseDeps(fx, []);
  assert.strictEqual(await run(['--run', fx.runDir, '--policy', 'console-auto'], d), 0);
  const decisions = fs.readFileSync(path.join(fx.runDir, 'decisions.md'), 'utf8');
  assert.match(decisions, /Console item wrap-up-memory-1\.md\.shadow-dup \(Dismissed duplicates\): dismissed — shadow-dup-duplicate .*Reversibility: n\/a\.$/m);
});

// A refuted-drop verdict line built through the real resolver and the sanctioned formatter, never typed by hand.
function drop(over, severity) {
  const { resolveTiebreak } = require(path.join(PLUGIN_ROOT, 'bin', 'lib', 'tiebreak'));
  const { formatEntry } = require(path.join(PLUGIN_ROOT, 'bin', 'lib', 'log-decision', 'append'));
  const tbNow = new Date(2026, 9, 24, 10, 0, 0);
  const file = Array.from({ length: 300 }, () => 'quote text here').join('\n');
  const finding = { lens: '3a', path: 'src/a.js', line: 9, claim: 'claim', reporterSeverity: severity, kind: 'unconfirmed', ...over };
  const r = resolveTiebreak(finding, `Verdict: refuted\nEvidence: ${finding.path}:${finding.line} \`quote text here\`\nSeverity: ${severity}\nSTATUS: DONE`, { readFile: () => file, now: tbNow });
  return { r, entry: formatEntry({ status: r.logStatus, now: tbNow, step: r.logStep, text: r.logText, reversibility: 'high' }) };
}

test('console.json records droppedByTiebreak and a re-render shows the block (#3949 AC4)', async () => {
  const high = drop({}, 'high');
  const low = drop({ path: 'src/b.js', claim: 'other' }, 'low');
  const fx = mainCheckoutWithRun({ staged: THREE, decisions: `${high.entry}\n${low.entry}\n` });
  const first = baseDeps(fx, []);
  assert.strictEqual(await run(['--run', fx.runDir, '--policy', 'console-auto'], first.d), 0);
  const cj = JSON.parse(fs.readFileSync(path.join(fx.runDir, 'console.json'), 'utf8'));
  assert.deepStrictEqual(cj.droppedByTiebreak, [{ id: high.r.id, lens: '3a', path: 'src/a.js', line: 9, severity: 'high', evidence: 'src/a.js:9 "quote text here"' }]);
  assert.match(first.out(), /#### Dropped by tiebreak \(read-only — no decision\)/);
  assert.match(first.out(), /\| src\/a\.js:9 \| 3a \| high \| src\/a\.js:9 "quote text here" \|/);
  assert.ok(!first.out().includes('src/b.js'), 'a low drop never reaches the console');
  const second = baseDeps(fx, []);
  assert.strictEqual(await run(['--run', fx.runDir, '--policy', 'console-auto'], second.d), 0);
  assert.match(second.out(), /already records a resolved console/);
  assert.match(second.out(), /#### Dropped by tiebreak \(read-only — no decision\)[\s\S]*\| src\/a\.js:9 \| 3a \| high \|/);
  const none = mainCheckoutWithRun({ staged: THREE });
  assert.strictEqual(await run(['--run', none.runDir, '--policy', 'console-auto'], baseDeps(none, []).d), 0);
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(none.runDir, 'console.json'), 'utf8')).droppedByTiebreak, [], 'always written');
});

test('a dropped item logs reversibility n/a (#3949)', async () => {
  const v = drop({ reporterSeverity: 'low' }, 'low');
  const staged = '- STAGED 09:59:00 — Debate: lens "3a" cross-lens disagreement on src/a.js:9 inconclusive (positions differ). Both verdicts staged. Stage path: staged/review-contested-1.md. Reversibility: high.';
  const fx = mainCheckoutWithRun({ decisions: `${staged}\n${v.entry}\n`, staged: { 'review-contested-1.md': 'x' } });
  assert.strictEqual(await run(['--run', fx.runDir, '--policy', 'console-auto'], baseDeps(fx, []).d), 0);
  const decisions = fs.readFileSync(path.join(fx.runDir, 'decisions.md'), 'utf8');
  assert.match(decisions, /Console item review-contested-1\.md \(Contested findings\): dropped — refuted by tiebreak \(staged\/review-contested-1\.md\)\. Reversibility: n\/a\.$/m);
});

test('console.json and --json carry filings as {item, fingerprint, title} with no proposal text (#3949 AC5)', async () => {
  const { resolveTiebreak } = require(path.join(PLUGIN_ROOT, 'bin', 'lib', 'tiebreak'));
  const { formatEntry } = require(path.join(PLUGIN_ROOT, 'bin', 'lib', 'log-decision', 'append'));
  const tbNow = new Date(2026, 9, 24, 10, 0, 0);
  const finding = { lens: '3a', path: 'src/a.js', line: 9, claim: 'claim one', reporterSeverity: 'medium', kind: 'unconfirmed' };
  const r = resolveTiebreak(finding, 'Verdict: cant-tell\nSeverity: medium\nRecommendation: drop\nSTATUS: DONE', { readFile: () => '', now: tbNow });
  const entry = formatEntry({ status: r.logStatus, now: tbNow, step: r.logStep, text: r.logText, reversibility: 'high' });
  const fx = mainCheckoutWithRun({ decisions: `${entry}\n` });
  const json = baseDeps(fx, []);
  assert.strictEqual(await run(['--run', fx.runDir, '--policy', 'console-auto', '--json'], json.d), 0);
  const cj = JSON.parse(fs.readFileSync(path.join(fx.runDir, 'console.json'), 'utf8'));
  assert.strictEqual(cj.filings.length, 1);
  assert.deepStrictEqual(Object.keys(cj.filings[0]).sort(), ['fingerprint', 'item', 'title']);
  assert.strictEqual(cj.filings[0].item, `tiebreak:${r.id}`);
  assert.match(cj.filings[0].fingerprint, /^consolefinding-[0-9a-f]{8}$/);
  assert.deepStrictEqual(JSON.parse(json.out()).filings, cj.filings, '--json prints the same');
  assert.ok(!json.out().includes('work-fingerprint'), 'no proposal text in --json');
  assert.ok(!JSON.stringify(cj).includes('work-fingerprint'), 'no proposal text in console.json');
  assert.deepStrictEqual(cj.items.map((i) => i.resolution), ['filed']);
  const none = mainCheckoutWithRun({ staged: THREE });
  assert.strictEqual(await run(['--run', none.runDir, '--policy', 'console-auto'], baseDeps(none, []).d), 0);
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(none.runDir, 'console.json'), 'utf8')).filings, [], 'always written');
});

// grant-veto-window-hours only reaches evaluateMaturation if the CLI resolves
// it: 30h-old pending grant, matured under the 24h default, still inside a 72h
// window. Same fixture, two policies, opposite merge halves.
const PENDING_30H = JSON.stringify({
  labels: [{ name: 'auto:merge-pending' }],
  comments: [{ body: 'Grant recorded.\n<!-- grant-mode-audit: date=2026-09-05T06:00:00Z auto-merge=pending -->', authorAssociation: 'MEMBER' }],
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

// #3358 AC3: a `grant-mode-audit` marker is plantable by anyone who can comment on
// the issue -- a backdated NONE-authored one must not mature a pending grant. The
// comment is passed over (same path as "no marker"), so the grant reads unknown-age.
const PLANTED_PENDING = (association) => JSON.stringify({
  labels: [{ name: 'auto:merge-pending' }],
  comments: [{
    body: '<!-- grant-mode-audit: date=2020-01-01T00:00:00Z auto-merge=pending -->',
    url: 'https://x/issues/7#c1', author: { login: 'eve' }, authorAssociation: association,
  }],
});

test('a planted backdated pending-grant marker does not mature a grant (#3358)', async () => {
  const fx = mainCheckoutWithRun({ staged: THREE });
  const exec = (cmd, args) => {
    if (cmd === 'git' && args[0] === 'rev-parse') return `${fx.root}\n`;
    if (cmd === 'gh' && args[0] === 'issue' && args[1] === 'view') return PLANTED_PENDING('NONE');
    if (cmd === 'git' && args[0] === 'apply') return '';
    throw new Error(`unexpected exec: ${cmd} ${args.join(' ')}`);
  };
  const { d } = baseDeps(fx, [], { execFile: exec });
  assert.strictEqual(await run(['--run', fx.runDir, '--policy', 'console-auto'], d), 0);
  const merge = JSON.parse(fs.readFileSync(path.join(fx.runDir, 'console.json'), 'utf8')).merge;
  assert.strictEqual(merge.resolution, 'leave-open');
  assert.match(merge.reason, /timestamp could not be determined/, 'the planted marker is passed over, so the grant reads unknown-age');
});

test('ghReadGrants: an untrusted pending-grant marker leaves pendingSince null and is named in skippedUntrusted (#3358)', () => {
  const g = ghReadGrants(() => PLANTED_PENDING('NONE'), '/unused')([7])[7];
  assert.deepStrictEqual(g.labels, ['auto:merge-pending']);
  assert.strictEqual(g.pendingSince, null);
  assert.deepStrictEqual(g.skippedUntrusted, ['skipped marker comment https://x/issues/7#c1 by eve (NONE) — not an owner, member, or collaborator']);
});

test('ghReadGrants: the same marker authored MEMBER is that date, with nothing skipped (#3358)', () => {
  const g = ghReadGrants(() => PLANTED_PENDING('MEMBER'), '/unused')([7])[7];
  assert.strictEqual(g.pendingSince.toISOString(), '2020-01-01T00:00:00.000Z');
  assert.deepStrictEqual(g.skippedUntrusted, []);
});

test('ghReadGrants: a trusted marker counts when a later untrusted one is passed over; a non-marker NONE comment is silent (#3358)', () => {
  const raw = JSON.stringify({
    labels: ['auto:merge-pending'],
    comments: [
      { body: '<!-- grant-mode-audit: date=2026-09-05T06:00:00Z auto-merge=pending -->', authorAssociation: 'OWNER' },
      { body: '<!-- grant-mode-audit: date=2026-09-06T06:00:00Z auto-merge=pending -->', url: 'https://x/c2', author: { login: 'eve' } },
      { body: 'unrelated chatter', url: 'https://x/c3', author: { login: 'eve' }, authorAssociation: 'NONE' },
    ],
  });
  const g = ghReadGrants(() => raw, '/unused')([7])[7];
  assert.strictEqual(g.pendingSince.toISOString(), '2026-09-05T06:00:00.000Z', 'the later untrusted marker must not win');
  assert.deepStrictEqual(g.skippedUntrusted, ['skipped marker comment https://x/c2 by eve (no association) — not an owner, member, or collaborator']);
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

// #3949 AC6: below `unattended` with no human, the resolver files nothing, drops
// nothing, and leaves every item unresolved — no console.json, so the archive
// guard (readConsoleState 'none' with staged items) refuses with
// console-never-rendered-staged-pending, a structurally-stuck reason reconcile
// escalates to a human (escalate-residue.js).
test('AC6: console-resolve.js below unattended exits 4, writes no console.json, and archival refuses', async () => {
  const { readConsoleState, decideArchiveCore, STRUCTURALLY_STUCK_REASONS } = require(path.join(PLUGIN_ROOT, 'bin', 'lib', 'reconcile', 'archive-merged.js'));
  for (const autonomy of ['supervised', 'trusted']) {
    const fx = mainCheckoutWithRun({ autonomy, staged: NEEDS });
    const calls = [];
    const { d, err } = baseDeps(fx, calls);
    assert.strictEqual(await run(['--run', fx.runDir, '--policy', 'console-auto'], d), 4, autonomy);
    assert.match(err(), /consoleAutoResolve/);
    assert.ok(!fs.existsSync(path.join(fx.runDir, 'console.json')), autonomy);
    assert.ok(!calls.some((c) => c[0] === 'gh'), 'no gh call');
    for (const [n, b] of Object.entries(NEEDS)) {
      assert.strictEqual(fs.readFileSync(path.join(fx.runDir, 'staged', n), 'utf8'), b, `${autonomy}: ${n} untouched`);
    }
    const consoleState = readConsoleState(fx.runDir);
    assert.strictEqual(consoleState, 'none', autonomy);
    const hasStagedPending = fs.readdirSync(path.join(fx.runDir, 'staged')).some((n) => !n.startsWith('.'));
    const decision = decideArchiveCore({ state: 'MERGED' }, consoleState, hasStagedPending);
    assert.deepStrictEqual(decision, { action: 'skip', reason: 'console-never-rendered-staged-pending' }, `${autonomy}: a merged run still refuses archival`);
    assert.ok(STRUCTURALLY_STUCK_REASONS.has(decision.reason), 'the refusal escalates to a human');
  }
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

// --- #3370: unresolved items survive the run's own final stop ---------------
// The 'Needs a human' block follows the table (never inside it), so the
// per-row AUTO-RESOLVED counts above stay valid.
const NEEDS = { 'review-13-record.md': 'x', 'review-debate-deviation.md': 'y', 'wrap-up-memory-1.md': 'm' };

test('unattended: an unmapped-prefix item and a contested item print a Needs a human block naming both (#3370)', async () => {
  const fx = mainCheckoutWithRun({ staged: NEEDS });
  const { d, out } = baseDeps(fx, []);
  assert.strictEqual(await run(['--run', fx.runDir, '--policy', 'console-auto'], d), 0);
  assert.match(out(), /Needs a human — 2 item\(s\)/);
  const after = out().slice(out().indexOf('Needs a human'));
  assert.ok(after.includes('review-13-record.md'), after);
  assert.ok(after.includes('review-debate-deviation.md'), after);
  assert.ok(after.includes('--ack --run'), after);
  const tail = after.trimEnd().split('\n');
  assert.strictEqual(tail[tail.length - 1], `  paths move when the run is archived; current paths: node "${PLUGIN_ROOT}/bin/console-residue.js" --run "${fx.runDir}"`);
  assert.ok(tail[tail.length - 2].includes('--ack --run'), 'the paths line follows the formatter lines');
  assert.ok(!after.includes('wrap-up-memory-1.md'), 'a resolved item is not residue');
  const tableOnly = out().slice(0, out().indexOf('Needs a human'));
  assert.ok(tableOnly.includes('wrap-up-memory-1.md'), 'the table still lists every item');
});

test('unattended: nothing is applied — pending/keep-staged stay, staged files are byte-identical (#3370 AC3.1)', async () => {
  const fx = mainCheckoutWithRun({ staged: NEEDS });
  const { d } = baseDeps(fx, []);
  assert.strictEqual(await run(['--run', fx.runDir, '--policy', 'console-auto'], d), 0);
  const cj = JSON.parse(fs.readFileSync(path.join(fx.runDir, 'console.json'), 'utf8'));
  assert.strictEqual(cj.items.find((i) => i.id === 'review-13-record.md').resolution, 'pending');
  assert.strictEqual(cj.items.find((i) => i.id === 'review-debate-deviation.md').resolution, 'keep-staged');
  assert.strictEqual(fs.readFileSync(path.join(fx.runDir, 'staged', 'review-13-record.md'), 'utf8'), 'x');
  assert.strictEqual(fs.readFileSync(path.join(fx.runDir, 'staged', 'review-debate-deviation.md'), 'utf8'), 'y');
});

test('unattended: no unresolved items prints no Needs a human block (#3370)', async () => {
  const fx = mainCheckoutWithRun({ staged: THREE });
  const { d, out } = baseDeps(fx, []);
  assert.strictEqual(await run(['--run', fx.runDir, '--policy', 'console-auto'], d), 0);
  assert.ok(!/Needs a human/.test(out()), out());
});

test('--dry-run prints the Needs a human block too and writes nothing (#3370)', async () => {
  const fx = mainCheckoutWithRun({ staged: NEEDS });
  const { d, out } = baseDeps(fx, []);
  assert.strictEqual(await run(['--run', fx.runDir, '--policy', 'console-auto', '--dry-run'], d), 0);
  assert.match(out(), /Needs a human — 2 item\(s\)/);
  assert.ok(!fs.existsSync(path.join(fx.runDir, 'console.json')));
});

test('--json carries unresolved: the two items when present, [] when none (#3370)', async () => {
  const withResidue = mainCheckoutWithRun({ staged: NEEDS });
  const a = baseDeps(withResidue, []);
  assert.strictEqual(await run(['--run', withResidue.runDir, '--policy', 'console-auto', '--json'], a.d), 0);
  assert.deepStrictEqual(JSON.parse(a.out()).unresolved.map((i) => i.id).sort(), ['review-13-record.md', 'review-debate-deviation.md']);
  const clean = mainCheckoutWithRun({ staged: THREE });
  const b = baseDeps(clean, []);
  assert.strictEqual(await run(['--run', clean.runDir, '--policy', 'console-auto', '--json'], b.d), 0);
  assert.deepStrictEqual(JSON.parse(b.out()).unresolved, []);
});

test('an already-resolved console.json re-renders the Needs a human block too, and only for unresolved items (#3370)', async () => {
  const stored = {
    resolved: true, mode: 'auto-resolve', at: '2026-09-06T11:00:00.000Z', ceiling: 'unattended',
    items: [
      { id: 'wrap-up-memory-1.md', section: 'Memory updates', resolution: 'apply', reason: 'pre-checked Apply default (batched-item-drill.md)' },
      { id: 'review-13-record.md', section: 'Pending review', resolution: 'pending', reason: 'unmapped-prefix' },
    ],
    merge: { resolution: 'leave-open', reason: 'lacks auto:merge' },
  };
  const fx = mainCheckoutWithRun({ staged: NEEDS, consoleJson: `${JSON.stringify(stored, null, 2)}\n` });
  const rawBefore = fs.readFileSync(path.join(fx.runDir, 'console.json'), 'utf8');
  const { d, out } = baseDeps(fx, []);
  assert.strictEqual(await run(['--run', fx.runDir, '--policy', 'console-auto'], d), 0);
  assert.match(out(), /already records a resolved console/);
  assert.match(out(), /Needs a human — 1 item\(s\)/);
  const after = out().slice(out().indexOf('Needs a human'));
  assert.ok(after.includes('review-13-record.md') && after.includes('--ack --run'), after);
  assert.ok(!after.includes('wrap-up-memory-1.md'), 'a resolved item is not residue');
  assert.strictEqual(fs.readFileSync(path.join(fx.runDir, 'console.json'), 'utf8'), rawBefore, 'console.json is not rewritten');
});

// #3772: a fresh resolve builds its items from the current staged/ listing, so only a
// re-rendered console.json can carry an unresolved item whose staged file has vanished.
function storedConsole(ids) {
  return `${JSON.stringify({
    resolved: true, mode: 'auto-resolve', at: '2026-09-06T11:00:00.000Z', ceiling: 'unattended',
    items: ids.map((id) => ({ id, section: 'Pending review', resolution: 'pending', reason: 'unmapped-prefix' })),
    merge: { resolution: 'leave-open', reason: 'lacks auto:merge' },
  }, null, 2)}\n`;
}

test('AC3.6: a re-rendered console counts only items whose staged file still exists (#3772)', async () => {
  const fx = mainCheckoutWithRun({ staged: { 'review-13-record.md': 'x' }, consoleJson: storedConsole(['review-13-record.md', 'review-14-record.md']) });
  const { d, out } = baseDeps(fx, []);
  assert.strictEqual(await run(['--run', fx.runDir, '--policy', 'console-auto'], d), 0);
  assert.match(out(), /Needs a human — 1 item\(s\)/);
  const after = out().slice(out().indexOf('Needs a human'));
  assert.ok(after.includes('review-13-record.md'), after);
  const notCounted = after.split('\n').filter((l) => l.startsWith('  not counted — '));
  assert.strictEqual(notCounted.length, 1, after);
  assert.ok(notCounted[0].includes('review-14-record.md'), notCounted[0]);
});

test('AC3.6: a re-rendered console whose every unresolved item is missing prints no Needs a human block (#3772)', async () => {
  const fx = mainCheckoutWithRun({ staged: {}, consoleJson: storedConsole(['review-13-record.md', 'review-14-record.md']) });
  const { d, out } = baseDeps(fx, []);
  assert.strictEqual(await run(['--run', fx.runDir, '--policy', 'console-auto'], d), 0);
  assert.match(out(), /already records a resolved console/);
  assert.ok(!/Needs a human/.test(out()), out());
});

// #3679: the stacked check (#3290) is wired into resolveAll via checkPatchStack(cwd()). Both
// patches are real `git diff` captures of f.txt in throwaway fixture repos — never hand-typed hunks.
const STACK_BASE = ['l1', 'l2', 'l3', 'l4', 'anchor', 'a1', 'a2', 'a3'].join('\n') + '\n';
const STACK_ENV = gitEnv();

function captureInsertAboveAnchor(tag) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'console-resolve-capture-'));
  try {
    const git = (...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8', env: STACK_ENV, stdio: ['ignore', 'pipe', 'ignore'] });
    git('init', '-q'); git('config', 'user.email', 't@example.invalid'); git('config', 'user.name', 't');
    fs.writeFileSync(path.join(dir, 'f.txt'), STACK_BASE);
    git('add', 'f.txt'); git('commit', '-q', '-m', 'base');
    fs.writeFileSync(path.join(dir, 'f.txt'), STACK_BASE.replace('anchor\n', `${tag}a\n${tag}b\nanchor\n`));
    return git('diff');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

test('AC1.1: run() wires the stacked check — a same-anchor pair the per-patch check passes resolves the second to stale (#3290)', async () => {
  const preamble = 'Target: f.txt\nInvariant: x\nFinding: low x — y\nStaged-at: abc\n\n';
  const fx = mainCheckoutWithRun({ staged: {
    'review-1.patch': preamble + captureInsertAboveAnchor('new1'),
    'review-2.patch': preamble + captureInsertAboveAnchor('new2'),
  } });
  fs.writeFileSync(path.join(fx.root, 'f.txt'), STACK_BASE);
  // Without the wiring, the per-patch fallback (`gitApplyCheck`, answered ok by fakeExec) passes both
  // patches, so only the stacked check can flag review-2. In the wired run the solo check is never
  // called (resolve.js:247-249).
  const { d } = baseDeps(fx, []);
  assert.strictEqual(await run(['--run', fx.runDir, '--policy', 'console-auto'], d), 0);
  const cj = JSON.parse(fs.readFileSync(path.join(fx.runDir, 'console.json'), 'utf8'));
  const resolution = (id) => cj.items.find((i) => i.id === id).resolution;
  assert.strictEqual(resolution('review-1.patch'), 'apply');
  assert.strictEqual(resolution('review-2.patch'), 'stale');
});

test('AC1.1: checkPatchStack fails closed when the walk cannot run', () => {
  const v = checkPatchStack(path.join(os.tmpdir(), 'no-such-worktree-3679'))(['/x/staged/a.patch', '/x/staged/b.patch']);
  assert.deepStrictEqual(Object.keys(v), ['a.patch', 'b.patch']);
  for (const k of Object.keys(v)) {
    assert.strictEqual(v[k].ok, false);
    assert.match(v[k].error, /^stacked check could not run: /);
  }
  assert.deepStrictEqual(checkPatchStack('anything')([]), {});
});
