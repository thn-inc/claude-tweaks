'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..', '..');
const { composeShadowDupProposal } = require(path.join(ROOT, 'plugin', 'bin', 'lib', 'console', 'shadow-dup-proposal'));
const { run, USAGE, readNoFollow } = require(path.join(ROOT, 'plugin', 'bin', 'shadow-dup-proposal'));
const { fencedBlock, extractFingerprint, DEFER_REASONS } =require(path.join(ROOT, 'plugin', 'bin', 'lib', 'issues', 'record'));
const { resolveAll, SHADOW_DUP_RE } = require(path.join(ROOT, 'plugin', 'bin', 'lib', 'console', 'resolve'));
const { unresolvedItems } = require(path.join(ROOT, 'plugin', 'bin', 'lib', 'console', 'residue'));
const { shapeGate } = require(path.join(ROOT, 'plugin', 'bin', 'lib', 'issues', 'materialize-format'));

const COPY = '## Finding\r\n\nuses ```js fences``` and `ticks`  \n';

function headerOf(proposal) {
  return Object.fromEntries(proposal.split('\n\n')[0].split('\n').map((l) => [l.slice(0, l.indexOf(': ')), l.slice(l.indexOf(': ') + 2)]));
}

test('divergent: header carries Title/Type/Labels/Defer-reason and the reason is in DEFER_REASONS', () => {
  const r = composeShadowDupProposal({ name: 'build-deviation-2.md.shadow-dup', text: COPY, anchorText: 'the anchor', runId: 'run-1' });
  assert.equal(r.ok, true);
  assert.equal(r.outcome, 'shadow-dup-divergent');
  assert.equal(r.anchor, 'build-deviation-2.md');
  assert.equal(r.title, 'Reconcile staged copy build-deviation-2.md.shadow-dup');
  const header = headerOf(r.proposal);
  assert.deepEqual(Object.keys(header), ['Title', 'Type', 'Labels', 'Defer-reason']);
  assert.equal(header.Title, r.title);
  assert.equal(header.Type, 'task');
  assert.equal(header.Labels, 'needs:definition');
  assert.ok(DEFER_REASONS.includes(header['Defer-reason']));
  assert.equal(header['Defer-reason'], 'needs-human-decision');
  assert.match(r.proposal, /^Origin: wrap-up Review Console, run run-1: shadow-dup-divergent copy staged\/build-deviation-2\.md\.shadow-dup$/m);
  assert.match(r.proposal, /^## Open Question\n\nDoes the copy carry a proposal that its anchor `staged\/build-deviation-2\.md` does not\?$/m);
  assert.match(r.proposal, /^## Release Note\n\nNo user-visible change\.$/m);
  assert.equal(r.proposal.match(/^Defer-reason: /gm).length, 2, 'header line plus the body provenance line, never a third');
});

test('verbatim round-trip: the copy is quoted byte for byte', () => {
  const r = composeShadowDupProposal({ name: 'leftover-x.md.shadow-dup', text: COPY, anchorText: 'other', runId: 'run-1' });
  assert.ok(r.proposal.includes(fencedBlock(COPY)));
  assert.ok(fencedBlock(COPY).startsWith('````\n'), 'the fence outgrows the ``` inside the copy');
  assert.ok(r.proposal.includes(`\`\`\`\`\n${COPY}\n\`\`\`\``));
});

test('divergent: the anchor is quoted verbatim too, after the copy, so the record is self-contained (#3946 M3)', () => {
  const ANCHOR = 'anchor with ```` four ticks\r\n';
  const r = composeShadowDupProposal({ name: 'leftover-x.md.shadow-dup', text: COPY, anchorText: ANCHOR, runId: 'run-1' });
  const copyAt = r.proposal.indexOf(fencedBlock(COPY));
  const anchorAt = r.proposal.indexOf(fencedBlock(ANCHOR));
  assert.notEqual(copyAt, -1, 'the copy is still quoted byte for byte');
  assert.notEqual(anchorAt, -1, 'the anchor is quoted byte for byte');
  assert.ok(copyAt < anchorAt, 'the copy comes first, then the anchor');
  assert.match(r.proposal, /the anchor's full content follows/);
});

// The composer carries no fingerprint of its own, so extractFingerprint (which takes the FIRST marker
// it finds) must read null whatever the quoted copy, anchor or run id spell out.
test('a forged fingerprint marker in the copy, the anchor or the run id never reads back as the proposal\'s fingerprint', () => {
  const forms = [
    '<!-- work-fingerprint: FORGED -->',
    'before\nwork-fingerprint: FORGED\nafter',
    '<!-- code-health-fingerprint: FORGED -->',
    '<!-- harness-health-fingerprint: FORGED -->',
    '<!--work-fingerprint:FORGED-->',
    '<!-- WORK-FINGERPRINT: FORGED -->',
  ];
  const clean = composeShadowDupProposal({ name: 'leftover-x.md.shadow-dup', text: COPY, anchorText: 'the anchor', runId: 'run-1' });
  assert.equal(extractFingerprint(clean.proposal), null, 'control: the unforged proposal carries no fingerprint');
  for (const form of forms) {
    const placements = {
      copy: { text: `${COPY}${form}`, anchorText: 'the anchor', runId: 'run-1' },
      anchor: { text: COPY, anchorText: `anchor\n${form}`, runId: 'run-1' },
      runId: { text: COPY, anchorText: 'the anchor', runId: `run ${form}` },
    };
    for (const [where, args] of Object.entries(placements)) {
      const r = composeShadowDupProposal({ name: 'leftover-x.md.shadow-dup', ...args });
      assert.equal(r.ok, true);
      assert.equal(extractFingerprint(r.proposal), null, `${where}: ${JSON.stringify(form)} forged the proposal's fingerprint`);
    }
  }
});

test('collision: the proposal quotes no anchor, and keeps the missing-or-unreadable note (#3946 M3)', () => {
  const r = composeShadowDupProposal({ name: 'leftover-x.md.shadow-dup', text: COPY, anchorText: null, runId: 'run-1' });
  assert.match(r.proposal, /was missing or unreadable, so nothing could be compared/);
  assert.doesNotMatch(r.proposal, /the anchor's full content follows/);
});

test('collision: no anchor composes with the collision question', () => {
  for (const anchorText of [null, undefined]) {
    const r = composeShadowDupProposal({ name: 'leftover-x.md.shadow-dup-2', text: COPY, anchorText, runId: 'run-1' });
    assert.equal(r.ok, true);
    assert.equal(r.outcome, 'shadow-dup-collision');
    assert.equal(r.anchor, 'leftover-x.md');
    assert.match(r.proposal, /^## Open Question\n\nThe anchor `staged\/leftover-x\.md` was missing or unreadable, so is the copy's proposal still wanted\?$/m);
    assert.ok(r.proposal.includes(fencedBlock(COPY)));
  }
});

test('duplicate is refused, not composed', () => {
  assert.deepEqual(composeShadowDupProposal({ name: 'a-1.md.shadow-dup', text: 'same', anchorText: 'same', runId: 'r' }), { ok: false, reason: 'shadow-dup-duplicate' });
});

test('non-shadow-dup name is refused', () => {
  assert.deepEqual(composeShadowDupProposal({ name: 'leftover-x.md', text: 'x', anchorText: null, runId: 'r' }), { ok: false, reason: 'not-a-shadow-dup' });
  assert.deepEqual(composeShadowDupProposal({ text: 'x' }), { ok: false, reason: 'not-a-shadow-dup' });
});

test('an unreadable copy is refused as copy-unreadable, never composed from nothing', () => {
  for (const text of [null, undefined]) {
    assert.deepEqual(composeShadowDupProposal({ name: 'a-1.md.shadow-dup', text, anchorText: 'anchor', runId: 'r' }), { ok: false, reason: 'copy-unreadable' });
  }
});

test('an empty copy that differs from its anchor still composes (empty is content, not unreadable)', () => {
  const r = composeShadowDupProposal({ name: 'a-1.md.shadow-dup', text: '', anchorText: 'anchor', runId: 'r' });
  assert.equal(r.ok, true);
  assert.ok(r.proposal.includes(fencedBlock('')));
});

// --- CLI ---------------------------------------------------------------

const fixtureRoots = [];
after(() => { for (const r of fixtureRoots) fs.rmSync(r, { recursive: true, force: true }); });

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sdp-'));
  fixtureRoots.push(root);
  const main = path.join(root, 'main');
  const runDir = path.join(main, '.claude-tweaks', 'pipelines', '2026-10-23T090000-spec-12');
  const shadow = path.join(main, '.claude', 'worktrees', 'flow-spec-12', '.claude-tweaks', 'pipelines', '2026-10-23T090000-spec-12');
  fs.mkdirSync(path.join(runDir, 'staged'), { recursive: true });
  fs.mkdirSync(path.join(shadow, 'staged'), { recursive: true });
  fs.mkdirSync(path.join(main, '.git'));
  fs.writeFileSync(path.join(main, '.claude', 'worktrees', 'flow-spec-12', '.git'), 'gitdir: ../../../.git/worktrees/flow-spec-12\n');
  return { root, main, runDir, shadow, out: path.join(root, 'proposal.md') };
}

function fakeDeps(cwd, overrides = {}) {
  const out = []; const err = [];
  return {
    deps: {
      cwd: () => cwd,
      readFile: (p) => fs.readFileSync(p, 'utf8'),
      writeFile: (p, s) => fs.writeFileSync(p, s),
      stdout: (s) => out.push(s),
      stderr: (s) => err.push(s),
      ...overrides,
    },
    out,
    err,
  };
}

function stage(runDir, files) {
  for (const [name, body] of Object.entries(files)) fs.writeFileSync(path.join(runDir, 'staged', name), body);
}

test('cli: exit 0 writes --out whose content equals the composed proposal and prints its path', () => {
  const f = fixture();
  stage(f.runDir, { 'build-deviation-2.md': 'anchor text', 'build-deviation-2.md.shadow-dup': COPY });
  const { deps, out } = fakeDeps(f.main);
  assert.equal(run(['--run', f.runDir, '--item', 'build-deviation-2.md.shadow-dup', '--out', f.out], deps), 0);
  const expected = composeShadowDupProposal({
    name: 'build-deviation-2.md.shadow-dup', text: COPY, anchorText: 'anchor text', runId: path.basename(f.runDir),
  });
  assert.equal(fs.readFileSync(f.out, 'utf8'), expected.proposal);
  assert.ok(expected.proposal.includes(`run ${path.basename(f.runDir)}:`), 'the run id is the run dir basename');
  assert.equal(out.join(''), f.out + '\n');
});

test('cli: a multi-spec per-spec run dir names the run as {parent-run-id}/spec-{N} in the Origin line', () => {
  const f = fixture();
  const parent = path.join(f.main, '.claude-tweaks', 'pipelines', '2026-10-23T213805-spec-7-8');
  const specDir = path.join(parent, 'spec-7');
  fs.mkdirSync(path.join(specDir, 'staged'), { recursive: true });
  stage(specDir, { 'a-1.md': 'anchor', 'a-1.md.shadow-dup': 'copy' });
  const { deps } = fakeDeps(f.main);
  assert.equal(run(['--run', specDir, '--item', 'a-1.md.shadow-dup', '--out', f.out], deps), 0);
  assert.match(fs.readFileSync(f.out, 'utf8'), new RegExp(`^Origin: wrap-up Review Console, run ${path.basename(parent)}/spec-7:`, 'm'));
});

test('cli: a missing anchor composes the collision outcome', () => {
  const f = fixture();
  stage(f.runDir, { 'leftover-x.md.shadow-dup': COPY });
  const { deps } = fakeDeps(f.main);
  assert.equal(run(['--run', f.runDir, '--item', 'leftover-x.md.shadow-dup', '--out', f.out], deps), 0);
  assert.match(fs.readFileSync(f.out, 'utf8'), /shadow-dup-collision copy/);
});

test('cli: exit 2 for an item absent from staged/, nothing written to --out', () => {
  const f = fixture();
  const { deps, err } = fakeDeps(f.main);
  assert.equal(run(['--run', f.runDir, '--item', 'nope.md.shadow-dup', '--out', f.out], deps), 2);
  assert.match(err.join(''), /refused \(copy-unreadable\).*ENOENT/);
  assert.equal(fs.existsSync(f.out), false);
});

test('cli: exit 2 for a byte-identical duplicate, with the dismissal on stderr and nothing written', () => {
  const f = fixture();
  stage(f.runDir, { 'a-1.md': 'same', 'a-1.md.shadow-dup': 'same' });
  const { deps, err } = fakeDeps(f.main);
  assert.equal(run(['--run', f.runDir, '--item', 'a-1.md.shadow-dup', '--out', f.out], deps), 2);
  assert.match(err.join(''), /refused \(shadow-dup-duplicate\): dismissed, nothing to file/);
  assert.equal(fs.existsSync(f.out), false);
});

test('cli: a non-.md/.patch pair agrees with resolveAll — identical .json dismissed (exit 2), differing .json composed divergent', () => {
  const f = fixture();
  stage(f.runDir, {
    'tidy-absorb-1.json': '{"a":1}\n', 'tidy-absorb-1.json.shadow-dup': '{"a":1}\n',
    'tidy-absorb-2.json': '{"a":1}\n', 'tidy-absorb-2.json.shadow-dup': '{"a":2}\n',
  });
  const dup = fakeDeps(f.main);
  assert.equal(run(['--run', f.runDir, '--item', 'tidy-absorb-1.json.shadow-dup', '--out', f.out], dup.deps), 2);
  assert.match(dup.err.join(''), /refused \(shadow-dup-duplicate\)/);
  assert.equal(fs.existsSync(f.out), false);
  const div = fakeDeps(f.main);
  assert.equal(run(['--run', f.runDir, '--item', 'tidy-absorb-2.json.shadow-dup', '--out', f.out], div.deps), 0);
  assert.match(fs.readFileSync(f.out, 'utf8'), /shadow-dup-divergent copy/);
});

test('cli: a symlinked copy is refused as copy-unreadable and its target is never quoted', { skip: process.platform === 'win32' && 'symlinks need privileges on Windows' }, () => {
  const f = fixture();
  const secret = path.join(f.root, 'outside-secret.txt');
  fs.writeFileSync(secret, 'TOP-SECRET-VALUE\n');
  stage(f.runDir, { 'a-1.md': 'anchor' });
  fs.symlinkSync(secret, path.join(f.runDir, 'staged', 'a-1.md.shadow-dup'));
  const { deps, err } = fakeDeps(f.main, { readFile: readNoFollow });
  assert.equal(run(['--run', f.runDir, '--item', 'a-1.md.shadow-dup', '--out', f.out], deps), 2);
  assert.match(err.join(''), /refused \(copy-unreadable\)/);
  assert.equal(fs.existsSync(f.out), false);
});

test('cli: a symlinked anchor reads as missing — the copy composes as a collision with no anchor quote', { skip: process.platform === 'win32' && 'symlinks need privileges on Windows' }, () => {
  const f = fixture();
  const secret = path.join(f.root, 'outside-secret.txt');
  fs.writeFileSync(secret, 'TOP-SECRET-VALUE\n');
  stage(f.runDir, { 'a-1.md.shadow-dup': 'copy' });
  fs.symlinkSync(secret, path.join(f.runDir, 'staged', 'a-1.md'));
  const { deps } = fakeDeps(f.main, { readFile: readNoFollow });
  assert.equal(run(['--run', f.runDir, '--item', 'a-1.md.shadow-dup', '--out', f.out], deps), 0);
  const proposal = fs.readFileSync(f.out, 'utf8');
  assert.match(proposal, /shadow-dup-collision copy/);
  assert.ok(!proposal.includes('TOP-SECRET-VALUE'), 'the symlink target leaked into the proposal');
});

test('cli: exit 2 for malformed invocations, nothing written', () => {
  const f = fixture();
  stage(f.runDir, { 'a-1.md': 'x', 'a-1.md.shadow-dup': 'y' });
  const good = ['--run', f.runDir, '--item', 'a-1.md.shadow-dup', '--out', f.out];
  const cases = {
    'missing --run': good.slice(2),
    'missing --item': ['--run', f.runDir, '--out', f.out],
    'missing --out': good.slice(0, 4),
    'unknown flag': [...good, '--bogus'],
    'trailing bare --out': good.slice(0, 4).concat('--out'),
    'flag as value': ['--run', f.runDir, '--item', '--out', f.out],
    'path-traversal item': ['--run', f.runDir, '--item', '../a-1.md.shadow-dup', '--out', f.out],
    'non-shadow-dup item': ['--run', f.runDir, '--item', 'a-1.md', '--out', f.out],
  };
  for (const [label, argv] of Object.entries(cases)) {
    const { deps } = fakeDeps(f.main);
    assert.equal(run(argv, deps), 2, label);
    assert.equal(fs.existsSync(f.out), false, label);
  }
});

test('cli: --help prints a USAGE that names every flag, exit 0', () => {
  const { deps, out } = fakeDeps(os.tmpdir());
  assert.equal(run(['--help'], deps), 0);
  assert.equal(out.join(''), USAGE);
  for (const flag of ['--run', '--item', '--out']) assert.ok(USAGE.includes(flag), flag);
});

test('cli: exit 3 for a worktree-local shadow --run, --out stays absent and the shadow is untouched', () => {
  const f = fixture();
  stage(f.shadow, { 'a-1.md': 'x', 'a-1.md.shadow-dup': 'y' });
  const { deps } = fakeDeps(path.dirname(f.shadow));
  assert.equal(run(['--run', f.shadow, '--item', 'a-1.md.shadow-dup', '--out', f.out], deps), 3);
  assert.equal(fs.existsSync(f.out), false);
  assert.deepEqual(fs.readdirSync(path.join(f.shadow, 'staged')).sort(), ['a-1.md', 'a-1.md.shadow-dup']);
});

test('cli: exit 3 for a run dir that does not exist', () => {
  const f = fixture();
  const { deps } = fakeDeps(f.main);
  assert.equal(run(['--run', path.join(f.main, '.claude-tweaks', 'pipelines', 'gone'), '--item', 'a-1.md.shadow-dup', '--out', f.out], deps), 3);
  assert.equal(fs.existsSync(f.out), false);
});

test('cli: exit 3 for an unwritable --out', () => {
  const f = fixture();
  stage(f.runDir, { 'a-1.md': 'x', 'a-1.md.shadow-dup': 'y' });
  const { deps, err } = fakeDeps(f.main);
  assert.equal(run(['--run', f.runDir, '--item', 'a-1.md.shadow-dup', '--out', path.join(f.root, 'no-such-dir', 'p.md')], deps), 3);
  assert.match(err.join(''), /could not write --out/);
});

test('AC4 e2e (spec AC5, shadow-dup half): a console-auto run with one copy per reason ends with zero pending and each Queue-writes copy composes a fileable proposal', () => {
  const f = fixture();
  const copies = {
    'build-deviation-1.md.shadow-dup': 'identical content',
    'build-deviation-2.md.shadow-dup': 'different content — recovered from a clobbering write\n```js\nx\n```\n',
    'leftover-x.md.shadow-dup': 'a copy whose anchor is gone',
  };
  stage(f.runDir, { 'build-deviation-1.md': 'identical content', 'build-deviation-2.md': 'original content', ...copies });
  fs.mkdirSync(path.join(f.runDir, 'work'), { recursive: true });
  fs.writeFileSync(path.join(f.runDir, 'work', '7-spec.md'), '---\nrecord: 7\n---\n');
  fs.writeFileSync(path.join(f.runDir, 'decisions.md'), '');
  const resolveDeps = {
    readFile: (p) => fs.readFileSync(p, 'utf8'),
    readdir: (p) => { try { return fs.readdirSync(p); } catch { return []; } },
    gitApplyCheck: () => ({ ok: true }),
    readGrants: (numbers) => Object.fromEntries(numbers.map((n) => [n, { labels: ['auto:merge'], pendingSince: null }])),
    now: () => Date.parse('2026-09-06T12:00:00Z'),
  };
  const r = resolveAll({ runDir: f.runDir, policy: 'console-auto', deps: resolveDeps });
  assert.deepEqual(unresolvedItems({ items: r.items }), []);

  const shadowItems = r.items.filter((i) => SHADOW_DUP_RE.test(i.id));
  assert.deepEqual(shadowItems.map((i) => i.resolution).sort(), ['apply', 'apply', 'dismissed']);
  for (const item of shadowItems) {
    const out = path.join(f.root, `${item.id}.proposal.md`);
    const { deps } = fakeDeps(f.main);
    const code = run(['--run', f.runDir, '--item', item.id, '--out', out], deps);
    if (item.resolution === 'apply') {
      assert.equal(code, 0, item.id);
      assert.ok(fs.readFileSync(out, 'utf8').includes(fencedBlock(copies[item.id])), item.id);
    } else {
      assert.equal(code, 2, item.id);
      assert.equal(fs.existsSync(out), false, item.id);
    }
  }
});

const LEFTOVER_COPY = [
  'Title: Leftover thing',
  'Type: task',
  '',
  '## Current State',
  'copy state',
  '',
  '## Deliverables',
  '- [ ] copy deliverable',
  '',
  '## Acceptance Criteria',
  '1. copy AC',
  '',
  '## Release Note',
  'copy note',
].join('\n');

test('AC2.1: shapeGate on a proposal quoting a spec-shaped copy reports the record\'s own shape (Open Question, not Acceptance Criteria)', () => {
  for (const anchorText of ['a different anchor', undefined]) {
    const r = composeShadowDupProposal({ name: 'leftover-x.md.shadow-dup', text: LEFTOVER_COPY, anchorText, runId: 'run-1' });
    assert.equal(r.ok, true);
    assert.match(r.proposal, /^## Open Question$/m);
    assert.deepEqual(shapeGate(r.proposal), { ok: false, missing: ['Acceptance Criteria'] });
  }
});
