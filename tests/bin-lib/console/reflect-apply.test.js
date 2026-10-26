'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..', '..');
const { run, USAGE } = require(path.join(ROOT, 'plugin', 'bin', 'reflect-apply'));
const { APPLIED_LINE_RE } = require(path.join(ROOT, 'plugin', 'bin', 'lib', 'console', 'reflect-apply'));
const { resolveAll } = require(path.join(ROOT, 'plugin', 'bin', 'lib', 'console', 'resolve'));
const { findingDescription, parseReflectDestination } = require(path.join(ROOT, 'plugin', 'bin', 'lib', 'console', 'reflect-destination'));
const { createFingerprint } = require(path.join(ROOT, 'plugin', 'bin', 'lib', 'health-core', 'fingerprint'));
const { formatEntry } = require(path.join(ROOT, 'plugin', 'bin', 'lib', 'log-decision', 'append'));
const { parseWorkTypes, readWorkTypes } = require(path.join(ROOT, 'plugin', 'bin', 'lib', 'work-backend'));
const { readText } = require('../../helpers/read-skill');

const fixtureRoots = [];
after(() => { for (const r of fixtureRoots) fs.rmSync(r, { recursive: true, force: true }); });

const NOW = new Date(2026, 9, 25, 9, 8, 7).getTime();

// A main checkout (a `.git` directory) holding one pipeline run dir with a staged/ dir.
function fixture(staged = {}, decisions = '') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'reflect-apply-test-'));
  fixtureRoots.push(root);
  const main = path.join(root, 'main');
  const runDir = path.join(main, '.claude-tweaks', 'pipelines', '2026-10-25T090000-spec-12');
  fs.mkdirSync(path.join(runDir, 'staged'), { recursive: true });
  fs.mkdirSync(path.join(runDir, 'work'), { recursive: true });
  fs.mkdirSync(path.join(main, '.git'));
  fs.writeFileSync(path.join(runDir, 'work', '7-spec.md'), '---\nrecord: 7\n---\n');
  fs.writeFileSync(path.join(runDir, 'decisions.md'), decisions);
  for (const [name, body] of Object.entries(staged)) fs.writeFileSync(path.join(runDir, 'staged', name), body);
  return { root, main, runDir, outDir: path.join(root, 'out'), tmp: path.join(root, 'tmp') };
}

// Fake gh / recordDecline record their calls; everything else is the real fs.
function fakeDeps(f, overrides = {}) {
  const calls = { gh: [], decline: [], bodies: [] };
  const out = []; const err = [];
  let n = 900;
  const deps = {
    cwd: () => f.main,
    now: () => NOW,
    workTypes: () => 'labels',
    // Like the real gh, reads the body file while it is called (the applier removes it afterwards).
    gh: (args) => { calls.gh.push(args); calls.bodies.push(fs.readFileSync(args[args.indexOf('--body-file') + 1], 'utf8')); n += 1; return `https://github.com/o/r/issues/${n}\n`; },
    recordDecline: (fp, opts) => { calls.decline.push({ fp, opts }); return { ...opts }; },
    tmpFile: (name) => { fs.mkdirSync(f.tmp, { recursive: true }); return path.join(f.tmp, name); },
    stdout: (s) => out.push(s),
    stderr: (s) => err.push(s),
    ...overrides,
  };
  return { deps, calls, out, err };
}

const result = (out) => JSON.parse(out.join(''));
const decisionsOf = (f) => fs.readFileSync(path.join(f.runDir, 'decisions.md'), 'utf8');

const RECORD = '# Reflect — staged finding 1\n\n**Category:** observation\n**Severity:** low\n**Reversibility:** high\n**Destination:** record\n**Source:** full mode, lens "Near-misses"\n**Files:** plugin/skills/x.md\n\n## Finding\n\nThe X pipeline loses a step between build and review.\n\n## Record proposal\n\nTitle: Track the X\nType: task\nLabels: risk:low, auto:build\nDefer-reason: genuinely-larger\n\n## Current State\n\nX loses a step.\n\n## Deliverables\n\n- [ ] Keep the step\n\n## Acceptance Criteria\n\n1. The step survives.\n';
const DECLINE = '# Reflect — staged finding 2\n\n**Category:** convention\n**Severity:** low\n**Reversibility:** high\n**Destination:** decline already covered by CLAUDE.md\n**Source:** full mode, lens "Approach"\n**Files:** general\n\n## Finding\n\nA convention that CLAUDE.md already states.\n';
const EDIT = '# Reflect — staged finding 5\n\n**Category:** convention\n**Destination:** edit plugin/skills/review/SKILL.md\n**Files:** plugin/skills/review/SKILL.md\n\n## Finding\n\nReview should say X.\n';
const BAD_DEFER = RECORD.replace('Defer-reason: genuinely-larger', 'Defer-reason: because');
const LEGACY = readText(path.join(ROOT, 'tests', 'bin-lib', 'console', 'fixtures', 'staged', 'reflect-ledger-3876.md'));

const consoleDeps = () => ({
  readFile: (p) => fs.readFileSync(p, 'utf8'),
  readdir: (p) => { try { return fs.readdirSync(p); } catch { return []; } },
  gitApplyCheck: () => ({ ok: true }),
  readGrants: (numbers) => Object.fromEntries(numbers.map((x) => [x, { labels: ['auto:merge'], pendingSince: null }])),
  now: () => NOW,
});

test('AC2.1: a console-auto fixture with one reflect observation and one reflect convention ends with zero pending items', () => {
  const f = fixture({ 'reflect-1.md': RECORD, 'reflect-2.md': DECLINE });
  const r = resolveAll({ runDir: f.runDir, policy: 'console-auto', deps: consoleDeps() });
  assert.equal(r.items.filter((i) => i.resolution === 'pending').length, 0);
  assert.deepEqual(r.items.filter((i) => i.id.startsWith('reflect-')).map((i) => [i.id, i.section, i.resolution]), [
    ['reflect-1.md', 'Skill updates', 'approve'],
    ['reflect-2.md', 'Skill updates', 'approve'],
  ]);
});

test('AC2.2: the record destination is written through the injected gh dep', () => {
  const f = fixture({ 'reflect-1.md': RECORD });
  const { deps, calls, out } = fakeDeps(f);
  assert.equal(run(['--run', f.runDir], deps), 0);
  assert.equal(calls.gh.length, 1);
  const bodyFile = path.join(f.tmp, 'reflect-apply-reflect-1.md');
  assert.deepEqual(calls.gh[0], ['issue', 'create', '--title', 'Track the X', '--body-file', bodyFile, '--label', 'risk:low', '--label', 'type:task']);
  assert.equal(calls.bodies[0], parseReflectDestination(RECORD).proposal.body);
  assert.equal(fs.existsSync(path.dirname(bodyFile)), false, 'the body file directory is removed once gh returns');
  assert.deepEqual(result(out).applied, [{ item: 'reflect-1.md', outcome: 'filed', ref: '#901' }]);
  assert.deepEqual(Object.keys(result(out)).sort(), ['alreadyApplied', 'applied', 'failed', 'logFailures', 'pending', 'refused', 'session']);
  assert.deepEqual(result(out).logFailures, []);
});

test('--repo is forwarded to gh issue create', () => {
  const f = fixture({ 'reflect-1.md': RECORD });
  const { deps, calls } = fakeDeps(f);
  assert.equal(run(['--run', f.runDir, '--repo', 'o/r'], deps), 0);
  assert.deepEqual(calls.gh[0].slice(0, 4), ['issue', 'create', '--repo', 'o/r']);
});

test('AC2.3: the decline destination is written through the injected recordDecline dep', () => {
  const f = fixture({ 'reflect-2.md': DECLINE });
  const { deps, calls, out } = fakeDeps(f);
  assert.equal(run(['--run', f.runDir], deps), 0);
  assert.equal(calls.decline.length, 1);
  const description = findingDescription(DECLINE);
  const fp = createFingerprint('reflect', ['description']).fingerprint({ description });
  assert.equal(calls.decline[0].fp, fp);
  assert.deepEqual(calls.decline[0].opts, { reason: 'already covered by CLAUDE.md', source: 'reflect', subject: description });
  assert.deepEqual(result(out).applied, [{ item: 'reflect-2.md', outcome: 'declined', ref: fp }]);
  assert.match(decisionsOf(f), new RegExp(`Reflect apply: staged/reflect-2\\.md declined \\(already covered by CLAUDE\\.md\\); decline ${fp} recorded\\. Reversibility: high \\(clearDecline\\)\\.`));
});

test('AC2.4: decisions.md gains one applied line per item, and a second run applies nothing', () => {
  const f = fixture({ 'reflect-1.md': RECORD, 'reflect-2.md': DECLINE });
  const first = fakeDeps(f);
  assert.equal(run(['--run', f.runDir], first.deps), 0);
  const text = decisionsOf(f);
  assert.match(text, /^- AUTO 09:08:07 — Reflect apply: staged\/reflect-1\.md filed as #901 \(Defer-reason: genuinely-larger\)\. Reversibility: high \(gh issue close\)\.$/m);
  assert.match(text, /Reflect apply: staged\/reflect-2\.md declined \(/);
  assert.equal((text.match(/Reflect apply: /g) || []).length, 2);

  const second = fakeDeps(f);
  assert.equal(run(['--run', f.runDir], second.deps), 0);
  assert.equal(second.calls.gh.length, 0);
  assert.equal(second.calls.decline.length, 0);
  const r = result(second.out);
  assert.deepEqual(r.alreadyApplied.map((a) => a.item), ['reflect-1.md', 'reflect-2.md']);
  assert.match(r.alreadyApplied[0].line, /^- AUTO 09:08:07 — Reflect apply: staged\/reflect-1\.md filed as #901/);
  assert.deepEqual(r.applied, []);
  assert.equal(decisionsOf(f), text, 'a second run adds no line');
});

test('AC2.5: one console-auto run — an observation and a convention classify to Skill updates, the apply files one and declines the other, and the run still ends with zero pending', () => {
  const f = fixture({ 'reflect-1.md': RECORD, 'reflect-2.md': DECLINE });
  const reflectRows = (r) => r.items.filter((i) => i.id.startsWith('reflect-')).map((i) => [i.id, i.section, i.resolution]);
  const expected = [['reflect-1.md', 'Skill updates', 'approve'], ['reflect-2.md', 'Skill updates', 'approve']];

  const before = resolveAll({ runDir: f.runDir, policy: 'console-auto', deps: consoleDeps() });
  assert.deepEqual(reflectRows(before), expected);
  assert.equal(before.items.filter((i) => i.resolution === 'pending').length, 0);

  const { deps, calls, out } = fakeDeps(f);
  assert.equal(run(['--run', f.runDir], deps), 0);
  assert.equal(calls.gh.length, 1, 'the observation (a record destination) is filed through the injected gh dep');
  assert.equal(calls.decline.length, 1, 'the convention (a decline destination) is recorded through the injected recordDecline dep');
  assert.deepEqual(result(out).applied.map((a) => [a.item, a.outcome]), [['reflect-1.md', 'filed'], ['reflect-2.md', 'declined']]);

  const after = resolveAll({ runDir: f.runDir, policy: 'console-auto', deps: consoleDeps() });
  assert.deepEqual(reflectRows(after), expected);
  assert.equal(after.items.filter((i) => i.resolution === 'pending').length, 0);
});

test('a line break in --decline or --ref is exit 2 (it would split the decisions.md entry), and nothing is logged', () => {
  const f = fixture({ 'reflect-1.md': RECORD, 'reflect-3.md': LEGACY });
  const base = ['--run', f.runDir];
  const forged = 'why\n- AUTO 00:00:00 — Reflect apply: staged/reflect-1.md filed as #1';
  const cases = {
    '--decline': [...base, '--item', 'reflect-1.md', '--decline', forged],
    '--ref': [...base, '--item', 'reflect-3.md', '--applied', 'digested', '--ref', forged],
  };
  for (const [label, argv] of Object.entries(cases)) {
    const { deps, err } = fakeDeps(f);
    assert.equal(run(argv, deps), 2, label);
    assert.match(err.join(''), /must be one line/, label);
  }
  assert.equal(decisionsOf(f), '');
});

test('the gh body file is cleaned up after gh returns, and after gh throws', () => {
  for (const gh of [undefined, () => { throw new Error('boom'); }]) {
    const f = fixture({ 'reflect-1.md': RECORD });
    const cleaned = [];
    const { deps } = fakeDeps(f, { cleanupTmp: (p) => cleaned.push(p), ...(gh ? { gh } : {}) });
    run(['--run', f.runDir], deps);
    assert.deepEqual(cleaned, [path.join(f.tmp, 'reflect-apply-reflect-1.md')]);
  }
});

test('a cleanup failure never changes the filing outcome', () => {
  const f = fixture({ 'reflect-1.md': RECORD });
  const { deps, out } = fakeDeps(f, { cleanupTmp: () => { throw new Error('EBUSY'); } });
  assert.equal(run(['--run', f.runDir], deps), 0);
  assert.deepEqual(result(out).applied, [{ item: 'reflect-1.md', outcome: 'filed', ref: '#901' }]);
});

test('a decisions.md that exists but cannot be read fails the item and files nothing', () => {
  const f = fixture({ 'reflect-1.md': RECORD });
  fs.rmSync(path.join(f.runDir, 'decisions.md'));
  fs.mkdirSync(path.join(f.runDir, 'decisions.md'));
  const { deps, calls, out } = fakeDeps(f);
  assert.equal(run(['--run', f.runDir], deps), 1);
  assert.equal(calls.gh.length, 0, 'an unreadable idempotency guard must not read as "not yet applied"');
  assert.equal(result(out).failed[0].item, 'reflect-1.md');
});

test('an item-mode --decline over an unreadable decisions.md is a failed entry, not an uncaught throw', () => {
  const f = fixture({ 'reflect-2.md': DECLINE });
  fs.rmSync(path.join(f.runDir, 'decisions.md'));
  fs.mkdirSync(path.join(f.runDir, 'decisions.md'));
  const { deps, calls, out } = fakeDeps(f);
  assert.equal(run(['--run', f.runDir, '--item', 'reflect-2.md', '--decline', 'x'], deps), 1);
  assert.equal(calls.decline.length, 0);
  assert.equal(result(out).failed[0].item, 'reflect-2.md');
});

test('APPLIED_LINE_RE matches what formatEntry writes for each outcome, and only the named file', () => {
  const lines = {
    filed: formatEntry({ status: 'AUTO', now: NOW, step: 'Reflect apply', text: 'staged/reflect-1.md filed as #9 (Defer-reason: genuinely-larger)', reversibility: 'high (gh issue close)' }),
    declined: formatEntry({ status: 'AUTO', now: NOW, step: 'Reflect apply', text: 'staged/reflect-1.md declined (why); decline reflect-ab12cd34 recorded', reversibility: 'high (clearDecline)' }),
    edited: formatEntry({ status: 'AUTO', now: NOW, step: 'Reflect apply', text: 'staged/reflect-1.md edited CLAUDE.md', reversibility: 'high (in the wrap-up commit)' }),
    digested: formatEntry({ status: 'AUTO', now: NOW, step: 'Reflect apply', text: 'staged/reflect-1.md digested (https://x/1#c)', reversibility: 'high (entry remains promotable from the digest)' }),
  };
  for (const [kind, line] of Object.entries(lines)) {
    const m = APPLIED_LINE_RE('reflect-1.md').exec(`## /wrap-up\n${line}\n`);
    assert.ok(m, kind);
    assert.equal(m[1], kind);
    assert.equal(APPLIED_LINE_RE('reflect-10.md').test(line), false, `${kind}: another file's name does not match`);
    assert.equal(APPLIED_LINE_RE('reflect-1.md').test(line.replace('reflect-1.md', 'reflect-1Xmd')), false, `${kind}: the name is regex-escaped`);
  }
});

test('AC3.1: a legacy reflect file with no destination line reaches the digest outcome', () => {
  const f = fixture({ 'reflect-3.md': LEGACY });
  const { deps, calls, out } = fakeDeps(f);
  assert.equal(run(['--run', f.runDir], deps), 0);
  const r = result(out);
  assert.equal(r.session.length, 1);
  assert.equal(r.session[0].item, 'reflect-3.md');
  assert.equal(r.session[0].outcome, 'digest');
  assert.ok(r.session[0].line.includes('— Defer-reason: reflect-no-destination —'), r.session[0].line);
  assert.ok(r.session[0].line.includes('reflect-3.md (no destination):'), r.session[0].line);
  assert.match(r.session[0].fingerprint, /^materiality-[0-9a-f]{8}$/);
  assert.ok(r.session[0].line.includes(`<!-- materiality-fingerprint: ${r.session[0].fingerprint} -->`));
  assert.equal(calls.gh.length + calls.decline.length, 0);
  assert.ok(!decisionsOf(f).includes('Reflect apply'), 'nothing is logged until the session posts the line');

  const ref = 'https://github.com/o/r/issues/5#issuecomment-1';
  const logged = fakeDeps(f);
  assert.equal(run(['--run', f.runDir, '--item', 'reflect-3.md', '--applied', 'digested', '--ref', ref], logged.deps), 0);
  assert.match(decisionsOf(f), new RegExp(`Reflect apply: staged/reflect-3\\.md digested \\(${ref.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\)\\. Reversibility: high \\(entry remains promotable from the digest\\)\\.`));
  assert.deepEqual(result(logged.out).applied, [{ item: 'reflect-3.md', outcome: 'digested', ref }]);

  const again = fakeDeps(f);
  assert.equal(run(['--run', f.runDir], again.deps), 0);
  assert.deepEqual(result(again.out).alreadyApplied.map((a) => a.item), ['reflect-3.md']);
  assert.deepEqual(result(again.out).session, []);
});

test('a legacy digest line carries the Files value, or general when the file names none', () => {
  const noFiles = '**Category:** observation\n\n## Finding\n\nSomething with no files line.\n';
  const f = fixture({ 'reflect-3.md': LEGACY, 'reflect-4.md': noFiles });
  const { deps, out } = fakeDeps(f);
  assert.equal(run(['--run', f.runDir], deps), 0);
  const [withFiles, without] = result(out).session;
  assert.ok(withFiles.line.includes(' — plugin/skills/_shared/subagent-dispatch-core.md, plugin/skills/_shared/scratch-worktree.md, plugin/skills/review/step3-lens-dispatch.md — '), withFiles.line);
  assert.ok(without.line.includes(' — general — Defer-reason: reflect-no-destination — 2026-10-25T090000-spec-12 <!--'), without.line);
  assert.ok(withFiles.line.length < 1000 && withFiles.line.split('\n').length === 1, 'one line');
});

test('a second --applied call for the same item prints alreadyApplied and logs no second line', () => {
  const f = fixture({ 'reflect-3.md': LEGACY });
  const argv = ['--run', f.runDir, '--item', 'reflect-3.md', '--applied', 'digested', '--ref', 'c1'];
  assert.equal(run(argv, fakeDeps(f).deps), 0);
  const before = decisionsOf(f);
  const again = fakeDeps(f);
  assert.equal(run(argv, again.deps), 0);
  assert.equal(result(again.out).alreadyApplied.length, 1);
  assert.deepEqual(result(again.out).applied, []);
  assert.equal(decisionsOf(f), before);
});

test('edit destination is reported to the session, then logged by --applied edited', () => {
  const f = fixture({ 'reflect-5.md': EDIT });
  fs.mkdirSync(path.join(f.main, 'plugin', 'skills', 'review'), { recursive: true });
  fs.writeFileSync(path.join(f.main, 'plugin', 'skills', 'review', 'SKILL.md'), '# review\n');
  const first = fakeDeps(f);
  assert.equal(run(['--run', f.runDir], first.deps), 0);
  assert.deepEqual(result(first.out).session, [{ item: 'reflect-5.md', outcome: 'edit', target: 'plugin/skills/review/SKILL.md' }]);
  assert.ok(!decisionsOf(f).includes('Reflect apply'));

  const logged = fakeDeps(f);
  assert.equal(run(['--run', f.runDir, '--item', 'reflect-5.md', '--applied', 'edited'], logged.deps), 0);
  assert.match(decisionsOf(f), /Reflect apply: staged\/reflect-5\.md edited plugin\/skills\/review\/SKILL\.md\. Reversibility: high \(in the wrap-up commit\)\./);
  const again = fakeDeps(f);
  assert.equal(run(['--run', f.runDir], again.deps), 0);
  assert.deepEqual(result(again.out).alreadyApplied.map((a) => a.item), ['reflect-5.md']);
});

test('--applied edited on a file whose destination is not edit is exit 2, nothing logged', () => {
  const f = fixture({ 'reflect-2.md': DECLINE });
  const { deps, err } = fakeDeps(f);
  assert.equal(run(['--run', f.runDir, '--item', 'reflect-2.md', '--applied', 'edited'], deps), 2);
  assert.match(err.join(''), /destination/);
  assert.equal(decisionsOf(f), '');
});

test('an edit target that does not exist is failed with exit 1', () => {
  const f = fixture({ 'reflect-5.md': EDIT });
  const { deps, out } = fakeDeps(f);
  assert.equal(run(['--run', f.runDir], deps), 1);
  assert.deepEqual(result(out).failed, [{ item: 'reflect-5.md', error: 'edit target not found: plugin/skills/review/SKILL.md' }]);
  assert.deepEqual(result(out).session, []);
});

test('an edit target that is a symlink out of the checkout, or a dangling one, is failed — never handed to the session', { skip: process.platform === 'win32' && 'symlink creation needs privileges on Windows' }, () => {
  const f = fixture({ 'reflect-5.md': EDIT });
  const outside = path.join(f.root, 'outside.md');
  fs.writeFileSync(outside, '# not the checkout\n');
  const dir = path.join(f.main, 'plugin', 'skills', 'review');
  fs.mkdirSync(dir, { recursive: true });
  for (const target of [outside, path.join(f.root, 'does-not-exist.md')]) {
    fs.rmSync(path.join(dir, 'SKILL.md'), { force: true });
    fs.symlinkSync(target, path.join(dir, 'SKILL.md'));
    const { deps, out } = fakeDeps(f);
    assert.equal(run(['--run', f.runDir], deps), 1, target);
    assert.deepEqual(result(out).failed, [{ item: 'reflect-5.md', error: 'edit target not found: plugin/skills/review/SKILL.md' }], target);
    assert.deepEqual(result(out).session, [], target);
  }
});

test('an edit target that is a symlink to a file inside the checkout is handed to the session', { skip: process.platform === 'win32' && 'symlink creation needs privileges on Windows' }, () => {
  const f = fixture({ 'reflect-5.md': EDIT });
  const dir = path.join(f.main, 'plugin', 'skills', 'review');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(f.main, 'real.md'), '# real\n');
  fs.symlinkSync(path.join(f.main, 'real.md'), path.join(dir, 'SKILL.md'));
  const { deps, out } = fakeDeps(f);
  assert.equal(run(['--run', f.runDir], deps), 0);
  assert.deepEqual(result(out).session, [{ item: 'reflect-5.md', outcome: 'edit', target: 'plugin/skills/review/SKILL.md' }]);
});

test('an edit target that is a directory is failed', () => {
  const f = fixture({ 'reflect-5.md': EDIT });
  fs.mkdirSync(path.join(f.main, 'plugin', 'skills', 'review', 'SKILL.md'), { recursive: true });
  const { deps, out } = fakeDeps(f);
  assert.equal(run(['--run', f.runDir], deps), 1);
  assert.equal(result(out).failed[0].item, 'reflect-5.md');
});

test('emit transport writes a Queue-write-shaped proposal and calls no gh', () => {
  const f = fixture({ 'reflect-1.md': RECORD });
  const { deps, calls, out } = fakeDeps(f);
  assert.equal(run(['--run', f.runDir, '--transport', 'emit', '--out-dir', f.outDir], deps), 0);
  assert.equal(calls.gh.length, 0);
  const file = path.join(f.outDir, 'reflect-apply-reflect-1.md');
  assert.deepEqual(result(out).session, [{ item: 'reflect-1.md', outcome: 'record', proposal: file }]);
  const text = fs.readFileSync(file, 'utf8');
  assert.ok(text.startsWith('Title: Track the X\nType: task\nLabels: risk:low\nDefer-reason: genuinely-larger\n\n'), text);
  assert.equal(text.slice('Title: Track the X\nType: task\nLabels: risk:low\nDefer-reason: genuinely-larger\n\n'.length), parseReflectDestination(RECORD).proposal.body);
  assert.ok(!decisionsOf(f).includes('Reflect apply'), 'the filing is logged by --applied filed');

  const logged = fakeDeps(f);
  assert.equal(run(['--run', f.runDir, '--item', 'reflect-1.md', '--applied', 'filed', '--ref', '#77'], logged.deps), 0);
  assert.match(decisionsOf(f), /Reflect apply: staged\/reflect-1\.md filed as #77 \(Defer-reason: genuinely-larger\)\. Reversibility: high \(gh issue close\)\./);
});

test('emit transport writes "Labels: none" when every label is stripped', () => {
  const f = fixture({ 'reflect-1.md': RECORD.replace('Labels: risk:low, auto:build', 'Labels: auto:build, bot:parked') });
  const { deps } = fakeDeps(f);
  assert.equal(run(['--run', f.runDir, '--transport', 'emit', '--out-dir', f.outDir], deps), 0);
  assert.match(fs.readFileSync(path.join(f.outDir, 'reflect-apply-reflect-1.md'), 'utf8'), /^Labels: none$/m);
});

test('a Labels: type:* label is dropped — the Type: line is the one type label, on the gh transport', () => {
  const f = fixture({ 'reflect-1.md': RECORD.replace('Labels: risk:low, auto:build', 'Labels: type:bug, risk:low') });
  const { deps, calls } = fakeDeps(f);
  assert.equal(run(['--run', f.runDir], deps), 0);
  const labels = calls.gh[0].filter((_, i, a) => a[i - 1] === '--label');
  assert.deepEqual(labels, ['risk:low', 'type:task']);
});

test('a Labels: type:* label is dropped — the Type: line is the one type, on the emit transport', () => {
  const f = fixture({ 'reflect-1.md': RECORD.replace('Labels: risk:low, auto:build', 'Labels: Type:bug, risk:low') });
  const { deps } = fakeDeps(f);
  assert.equal(run(['--run', f.runDir, '--transport', 'emit', '--out-dir', f.outDir], deps), 0);
  const text = fs.readFileSync(path.join(f.outDir, 'reflect-apply-reflect-1.md'), 'utf8');
  assert.match(text, /^Type: task\nLabels: risk:low\n/m);
  assert.ok(!/type:bug/i.test(text), text);
});

test('a record with an invalid Defer-reason is refused, logged once, never filed', () => {
  const f = fixture({ 'reflect-4.md': BAD_DEFER });
  const first = fakeDeps(f);
  assert.equal(run(['--run', f.runDir], first.deps), 0);
  assert.deepEqual(result(first.out).refused, [{ item: 'reflect-4.md', value: 'because' }]);
  assert.equal(run(['--run', f.runDir], fakeDeps(f).deps), 0);
  const refusedLines = decisionsOf(f).split('\n').filter((l) => l.startsWith('- REFUSED '));
  assert.equal(refusedLines.length, 1);
  assert.equal(refusedLines[0], '- REFUSED 09:08:07 — Queue write staged/reflect-4.md: no valid Defer-reason on staged/reflect-4.md; kept staged. Reversibility: n/a.');
  assert.equal(first.calls.gh.length, 0);

  // The line is one resolve.js's refusedStagedNames recognises: it refuses a Queue-writes item of that name.
  const decisions = `## /wrap-up\n${refusedLines[0].replace(/reflect-4\.md/g, 'leftover-x.md')}\n`;
  const g = fixture({ 'leftover-x.md': 'x' }, decisions);
  const r = resolveAll({ runDir: g.runDir, policy: 'console-auto', deps: consoleDeps() });
  assert.equal(r.items.find((i) => i.id === 'leftover-x.md').resolution, 'refused');
});

test('an invalid destination is reported pending with its reason, never applied', () => {
  const f = fixture({ 'reflect-6.md': '**Category:** convention\n**Destination:** decline a\n**Destination:** decline b\n\n## Finding\n\nx\n' });
  const { deps, out, calls } = fakeDeps(f);
  assert.equal(run(['--run', f.runDir], deps), 0);
  assert.deepEqual(result(out).pending, [{ item: 'reflect-6.md', reason: 'reflect-destination-invalid:multiple-destination-lines' }]);
  assert.equal(calls.gh.length + calls.decline.length, 0);
});

test('gh transport under work-types native fails loudly per item', () => {
  const f = fixture({ 'reflect-1.md': RECORD });
  const { deps, calls, out } = fakeDeps(f, { workTypes: () => 'native' });
  assert.equal(run(['--run', f.runDir], deps), 1);
  assert.equal(calls.gh.length, 0);
  const [failed] = result(out).failed;
  assert.equal(failed.item, 'reflect-1.md');
  assert.ok(failed.error.startsWith('work-types native:'), failed.error);
  assert.ok(failed.error.includes('--transport emit'), failed.error);
  const unset = fakeDeps(f, { workTypes: () => null });
  assert.equal(run(['--run', f.runDir], unset.deps), 1);
  assert.ok(result(unset.out).failed[0].error.startsWith('work-types unset:'));
});

test('a gh failure is that item\'s failed entry, logs nothing, and the other items still apply', () => {
  const f = fixture({ 'reflect-1.md': RECORD, 'reflect-2.md': DECLINE });
  const { deps, out } = fakeDeps(f, { gh: () => { throw Object.assign(new Error('boom'), { stderr: 'HTTP 502' }); } });
  assert.equal(run(['--run', f.runDir], deps), 1);
  const r = result(out);
  assert.deepEqual(r.failed, [{ item: 'reflect-1.md', error: 'boom HTTP 502' }]);
  assert.equal(r.applied.length, 1);
  assert.equal(r.applied[0].item, 'reflect-2.md');
  assert.ok(!decisionsOf(f).includes('reflect-1.md filed'));
});

test('gh output with no issue url is a failed entry', () => {
  const f = fixture({ 'reflect-1.md': RECORD });
  const { deps, out } = fakeDeps(f, { gh: () => 'created\n' });
  assert.equal(run(['--run', f.runDir], deps), 1);
  assert.equal(result(out).failed[0].item, 'reflect-1.md');
  assert.ok(!decisionsOf(f).includes('Reflect apply'));
});

test('a failed decisions.md append after a filing is a logFailures entry, not failed; its printed command logs it and no re-run refiles', () => {
  const f = fixture({ 'reflect-1.md': RECORD });
  const first = fakeDeps(f, { appendDecision: () => { throw new Error('disk full'); } });
  assert.equal(run(['--run', f.runDir], first.deps), 0, 'a failed append never changes the exit code');
  const r = result(first.out);
  assert.deepEqual(r.applied, [{ item: 'reflect-1.md', outcome: 'filed', ref: '#901' }]);
  assert.deepEqual(r.failed, []);
  assert.equal(r.logFailures.length, 1);
  assert.equal(r.logFailures[0].item, 'reflect-1.md');
  assert.equal(r.logFailures[0].error, 'disk full');
  const cli = path.join(ROOT, 'plugin', 'bin', 'reflect-apply.js');
  assert.equal(r.logFailures[0].line, `node '${cli}' --run '${fs.realpathSync(f.runDir)}' --item 'reflect-1.md' --applied filed --ref 901`);
  assert.match(first.err.join(''), /^reflect-apply\.js: could not append the decisions\.md entry for reflect-1\.md: disk full — hand-log it with:\nnode /m);
  assert.ok(first.err.join('').includes(r.logFailures[0].line));
  assert.equal(first.calls.gh.length, 1);
  assert.ok(!decisionsOf(f).includes('Reflect apply'), 'no line yet');

  // Running the printed command (its argv, as the shell would split it) logs the filing ...
  const [, item, kind, ref] = /--item '([^']+)' --applied (\w+) --ref (\S+)$/.exec(r.logFailures[0].line);
  const logged = fakeDeps(f);
  assert.equal(run(['--run', f.runDir, '--item', item, '--applied', kind, '--ref', ref], logged.deps), 0);
  assert.match(decisionsOf(f), /Reflect apply: staged\/reflect-1\.md filed as #901 \(Defer-reason: genuinely-larger\)/);
  // ... so a further plain run files nothing more.
  const again = fakeDeps(f);
  assert.equal(run(['--run', f.runDir], again.deps), 0);
  assert.equal(again.calls.gh.length, 0);
  assert.deepEqual(result(again.out).alreadyApplied.map((a) => a.item), ['reflect-1.md']);
  assert.deepEqual(result(again.out).logFailures, []);
});

test('a failed append after a recorded decline is a logFailures entry whose line re-declines and logs', () => {
  const reason = 'it\'s covered';
  const f = fixture({ 'reflect-2.md': DECLINE.replace('already covered by CLAUDE.md', reason) });
  const first = fakeDeps(f, { appendDecision: () => { throw new Error('disk full'); } });
  assert.equal(run(['--run', f.runDir], first.deps), 0);
  const r = result(first.out);
  assert.equal(r.applied.length, 1);
  assert.deepEqual(r.failed, []);
  assert.ok(r.logFailures[0].line.endsWith(` --item 'reflect-2.md' --decline 'it'\\''s covered'`), r.logFailures[0].line);
  const logged = fakeDeps(f);
  assert.equal(run(['--run', f.runDir, '--item', 'reflect-2.md', '--decline', reason], logged.deps), 0);
  assert.match(decisionsOf(f), /staged\/reflect-2\.md declined \(it's covered\); decline reflect-[0-9a-f]{8} recorded/);
});

test('a failed REFUSED append is a logFailures entry, and the next plain run logs it', () => {
  const f = fixture({ 'reflect-4.md': BAD_DEFER });
  const first = fakeDeps(f, { appendDecision: () => { throw new Error('disk full'); } });
  assert.equal(run(['--run', f.runDir], first.deps), 0);
  const r = result(first.out);
  assert.equal(r.refused.length, 1);
  assert.deepEqual(r.failed, []);
  assert.equal(r.logFailures[0].item, 'reflect-4.md');
  assert.equal(run(['--run', f.runDir], fakeDeps(f).deps), 0);
  assert.equal(decisionsOf(f).split('\n').filter((l) => l.startsWith('- REFUSED ')).length, 1);
});

test('a failed append for --applied itself (the log is the whole effect) is failed, exit 1, and safe to repeat', () => {
  const f = fixture({ 'reflect-3.md': LEGACY });
  const argv = ['--run', f.runDir, '--item', 'reflect-3.md', '--applied', 'digested', '--ref', 'c1'];
  const bad = fakeDeps(f, { appendDecision: () => { throw new Error('disk full'); } });
  assert.equal(run(argv, bad.deps), 1);
  assert.match(result(bad.out).failed[0].error, /disk full/);
  assert.deepEqual(result(bad.out).logFailures, []);
  assert.equal(run(argv, fakeDeps(f).deps), 0);
  assert.match(decisionsOf(f), /staged\/reflect-3\.md digested \(c1\)/);
});

test('--applied digested on a file with a destination line, and --applied filed on a refused record, are exit 2 with nothing logged', () => {
  const f = fixture({ 'reflect-1.md': RECORD, 'reflect-2.md': DECLINE, 'reflect-4.md': BAD_DEFER });
  for (const [argv, re] of [
    [['--item', 'reflect-1.md', '--applied', 'digested', '--ref', 'c1'], /destination line \(record\).*only fits a legacy file/],
    [['--item', 'reflect-2.md', '--applied', 'digested', '--ref', 'c1'], /destination line \(decline\)/],
    [['--item', 'reflect-4.md', '--applied', 'filed', '--ref', '5'], /no valid Defer-reason \(because\).*refused, never filed/],
  ]) {
    const { deps, err } = fakeDeps(f);
    assert.equal(run(['--run', f.runDir, ...argv], deps), 2, argv.join(' '));
    assert.match(err.join(''), re);
  }
  assert.equal(decisionsOf(f), '');
});

test('a recordDecline throw is that item\'s failed entry', () => {
  const f = fixture({ 'reflect-2.md': DECLINE });
  const { deps, out } = fakeDeps(f, { recordDecline: () => { throw new Error('read-only store'); } });
  assert.equal(run(['--run', f.runDir], deps), 1);
  assert.deepEqual(result(out).failed, [{ item: 'reflect-2.md', error: 'read-only store' }]);
  assert.ok(!decisionsOf(f).includes('Reflect apply'));
});

test('--dry-run calls and writes nothing', () => {
  const f = fixture({ 'reflect-1.md': RECORD, 'reflect-2.md': DECLINE, 'reflect-3.md': LEGACY, 'reflect-4.md': BAD_DEFER });
  const before = decisionsOf(f);
  const { deps, calls, out } = fakeDeps(f);
  assert.equal(run(['--run', f.runDir, '--dry-run'], deps), 0);
  assert.equal(calls.gh.length + calls.decline.length, 0);
  assert.equal(decisionsOf(f), before);
  assert.equal(fs.existsSync(f.tmp), false, 'no body file is written');
  const r = result(out);
  assert.deepEqual(r.planned.map((p) => p.item), ['reflect-1.md', 'reflect-2.md', 'reflect-3.md', 'reflect-4.md']);
  assert.deepEqual(r.planned.map((p) => p.outcome), ['filed', 'declined', 'digest', 'refused']);
  assert.deepEqual(r.applied, []);
  const emit = fakeDeps(f);
  assert.equal(run(['--run', f.runDir, '--transport', 'emit', '--out-dir', f.outDir, '--dry-run'], emit.deps), 0);
  assert.equal(fs.existsSync(f.outDir), false, 'no proposal file is written');
});

test('--only narrows the selection', () => {
  const f = fixture({ 'reflect-1.md': RECORD, 'reflect-2.md': DECLINE });
  const { deps, calls, out } = fakeDeps(f);
  assert.equal(run(['--run', f.runDir, '--only', 'reflect-2.md'], deps), 0);
  assert.equal(calls.gh.length, 0);
  assert.deepEqual(result(out).applied.map((a) => a.item), ['reflect-2.md']);
});

test('non-applicable reflect files and other staged files are never selected', () => {
  const f = fixture({ 'reflect-7.md': '**Category:** tangential\n\nx\n', 'reflect-8.md': 'no category\n', 'leftover-1.md': '**Category:** observation\n' });
  const { deps, out } = fakeDeps(f);
  assert.equal(run(['--run', f.runDir], deps), 0);
  const r = result(out);
  assert.deepEqual([r.applied, r.session, r.refused, r.pending, r.alreadyApplied, r.failed], [[], [], [], [], [], []]);
});

test('--decline overrides the file destination', () => {
  const f = fixture({ 'reflect-1.md': RECORD });
  const reason = 'declined at Review Console, no reason given';
  const { deps, calls, out } = fakeDeps(f);
  assert.equal(run(['--run', f.runDir, '--item', 'reflect-1.md', '--decline', reason], deps), 0);
  assert.equal(calls.gh.length, 0);
  assert.equal(calls.decline.length, 1);
  assert.equal(calls.decline[0].opts.reason, reason);
  assert.equal(calls.decline[0].opts.source, 'reflect');
  assert.deepEqual(result(out).applied.map((a) => [a.item, a.outcome]), [['reflect-1.md', 'declined']]);
  assert.match(decisionsOf(f), new RegExp(`staged/reflect-1\\.md declined \\(${reason}\\); decline reflect-[0-9a-f]{8} recorded`));
  const again = fakeDeps(f);
  assert.equal(run(['--run', f.runDir, '--item', 'reflect-1.md', '--decline', reason], again.deps), 0);
  assert.equal(again.calls.decline.length, 0);
  assert.equal(result(again.out).alreadyApplied.length, 1);
});

test('exit 2 for a malformed invocation, and nothing is written', () => {
  const f = fixture({ 'reflect-1.md': RECORD, 'reflect-3.md': LEGACY });
  const base = ['--run', f.runDir];
  const cases = {
    'emit without --out-dir': [...base, '--transport', 'emit'],
    'unknown transport': [...base, '--transport', 'pigeon'],
    'out-dir with gh': [...base, '--out-dir', f.outDir],
    'repo with emit': [...base, '--transport', 'emit', '--out-dir', f.outDir, '--repo', 'o/r'],
    'absent --only name': [...base, '--only', 'reflect-9.md'],
    'non-applicable --only name': [...base, '--only', 'leftover-1.md'],
    'absent --item': [...base, '--item', 'reflect-9.md', '--decline', 'x'],
    'filed without --ref': [...base, '--item', 'reflect-1.md', '--applied', 'filed'],
    'filed with a non-number --ref': [...base, '--item', 'reflect-1.md', '--applied', 'filed', '--ref', 'abc'],
    'digested without --ref': [...base, '--item', 'reflect-3.md', '--applied', 'digested'],
    'unknown --applied kind': [...base, '--item', 'reflect-3.md', '--applied', 'shipped', '--ref', '1'],
    '--item alone': [...base, '--item', 'reflect-1.md'],
    '--decline without --item': [...base, '--decline', 'x'],
    '--applied without --item': [...base, '--applied', 'digested', '--ref', 'x'],
    '--decline with --applied': [...base, '--item', 'reflect-1.md', '--decline', 'x', '--applied', 'digested', '--ref', 'x'],
    '--ref without --applied': [...base, '--ref', '#1'],
    '--only with --item': [...base, '--only', 'reflect-1.md', '--item', 'reflect-1.md', '--decline', 'x'],
    'missing --run': ['--only', 'reflect-1.md'],
    'unknown flag': [...base, '--bogus'],
    'flag as value': [...base, '--only', '--dry-run'],
    'trailing bare flag': [...base, '--only'],
  };
  for (const [label, argv] of Object.entries(cases)) {
    const { deps, calls, err } = fakeDeps(f);
    assert.equal(run(argv, deps), 2, label);
    assert.equal(calls.gh.length + calls.decline.length, 0, label);
    assert.ok(err.join('').length > 0, label);
  }
  assert.equal(decisionsOf(f), '');
  assert.equal(fs.existsSync(f.outDir), false);
});

test('an absent --only name is refused with the applicable names listed', () => {
  const f = fixture({ 'reflect-1.md': RECORD, 'reflect-2.md': DECLINE });
  const { deps, err } = fakeDeps(f);
  assert.equal(run(['--run', f.runDir, '--only', 'reflect-9.md'], deps), 2);
  assert.match(err.join(''), /reflect-9\.md/);
  assert.match(err.join(''), /reflect-1\.md, reflect-2\.md/);
});

test('--help prints a USAGE that names every flag, exit 0', () => {
  const { deps, out } = fakeDeps({ main: os.tmpdir() });
  assert.equal(run(['--help'], deps), 0);
  assert.equal(out.join(''), USAGE);
  for (const flag of ['--run', '--only', '--transport', '--out-dir', '--repo', '--dry-run', '--item', '--decline', '--applied', '--ref']) assert.ok(USAGE.includes(flag), flag);
});

test('exit 3 on a run dir outside the main checkout, and on one that does not exist', () => {
  const f = fixture({ 'reflect-2.md': DECLINE });
  const other = fixture({ 'reflect-2.md': DECLINE });
  const { deps, calls } = fakeDeps(f, { mainRoot: other.main });
  assert.equal(run(['--run', f.runDir], deps), 3);
  assert.equal(calls.decline.length, 0);
  assert.equal(decisionsOf(f), '');
  assert.equal(run(['--run', path.join(f.main, '.claude-tweaks', 'pipelines', 'gone')], fakeDeps(f).deps), 3);
});

test('exit 3 on a worktree-local shadow of the run dir, shadow byte-unchanged', () => {
  const f = fixture({ 'reflect-2.md': DECLINE });
  const shadow = path.join(f.main, '.claude', 'worktrees', 'flow-spec-12', '.claude-tweaks', 'pipelines', '2026-10-25T090000-spec-12');
  fs.mkdirSync(path.join(shadow, 'staged'), { recursive: true });
  fs.writeFileSync(path.join(f.main, '.claude', 'worktrees', 'flow-spec-12', '.git'), 'gitdir: ../../../.git/worktrees/flow-spec-12\n');
  fs.writeFileSync(path.join(shadow, 'staged', 'reflect-2.md'), DECLINE);
  const { deps, calls } = fakeDeps(f, { cwd: () => path.dirname(path.dirname(path.dirname(shadow))) });
  assert.equal(run(['--run', shadow], deps), 3);
  assert.equal(calls.decline.length, 0);
  assert.equal(fs.existsSync(path.join(shadow, 'decisions.md')), false);
});

test('parseWorkTypes: value from a work-records block; the null-on-anything-wrong contract', () => {
  assert.equal(parseWorkTypes('work-types: labels\n'), 'labels');
  assert.equal(parseWorkTypes('# P\n\n## Work records\n\nwork-backend: github-issues\nwork-types:   native  \n'), 'native');
  assert.equal(parseWorkTypes('work-types:\tlabels\r\n'), 'labels');
  assert.equal(parseWorkTypes('work-types:\nnative\n'), null);
  assert.equal(parseWorkTypes('work-types:   \nnative\n'), null);
  assert.equal(parseWorkTypes('# P\n'), null);
  assert.equal(parseWorkTypes(undefined), null);
  assert.equal(parseWorkTypes(null), null);
});

test('readWorkTypes: reads root/CLAUDE.md; any read error is null', () => {
  const f = fixture();
  fs.writeFileSync(path.join(f.main, 'CLAUDE.md'), 'work-backend: github-issues\nwork-types: labels\n');
  assert.equal(readWorkTypes(f.main), 'labels');
  assert.equal(readWorkTypes(path.join(f.root, 'absent')), null);
  assert.equal(readWorkTypes(f.main, { readFile: () => { throw new Error('nope'); } }), null);
});
