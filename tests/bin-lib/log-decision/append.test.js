'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  formatEntry, resolveTarget, appendEntry, STATUSES, normalizeSection,
} = require('../../../plugin/bin/lib/log-decision/append');

// The schema line _shared/auto-decision-log.md documents — a test-side parser, so
// every entry the module emits is proven readable by the documented shape.
const SCHEMA = /^- (AUTO|STAGED|KEPT-PROMPT|SCANNED|SKIP) (\d{2}:\d{2}:\d{2}) — (.+?): (.+)\. Reversibility: (high|med|low|n\/a)(?:[^\[]*)?( \[lever: .+\])?$/;

const NOW = new Date(2026, 7, 16, 14, 32, 14).getTime(); // local 14:32:14

test('formatEntry: AUTO line with step + spec matches the documented schema', () => {
  const line = formatEntry({ status: 'AUTO', now: NOW, step: 'Section E', spec: 12, text: 'released claim', reversibility: 'high' });
  assert.equal(line, '- AUTO 14:32:14 — spec #12 — Section E: released claim. Reversibility: high.');
  assert.match(line, SCHEMA);
});

test('formatEntry: spec-only location, default reversibility n/a, lever last', () => {
  const line = formatEntry({ status: 'STAGED', now: NOW, spec: 12, text: 'x.', lever: 'scope-creep=add-to-plan (policy)' });
  assert.equal(line, '- STAGED 14:32:14 — spec #12: x. Reversibility: n/a. [lever: scope-creep=add-to-plan (policy)]');
  assert.match(line, SCHEMA);
});

test('formatEntry: no step/spec falls back to log-decision; rejects unknown status', () => {
  assert.match(formatEntry({ status: 'SCANNED', now: NOW, text: 'swept 3 files' }), /— log-decision: swept 3 files\. Reversibility: n\/a\.$/);
  assert.throws(() => formatEntry({ status: 'MAYBE', now: NOW, text: 'x' }), /status/);
  assert.deepEqual(STATUSES, ['AUTO', 'STAGED', 'KEPT-PROMPT', 'SCANNED', 'REFUSED', 'SKIP']);
});

test('formatEntry: SKIP line matches the documented degrade-trace grammar', () => {
  const line = formatEntry({
    status: 'SKIP',
    now: NOW,
    step: 'Common Step 6.5 (skipped)',
    text: 'condition: no docs/REGISTRY.md → fallback: no doc-sync check',
    reversibility: 'n/a',
  });
  assert.equal(
    line,
    '- SKIP 14:32:14 — Common Step 6.5 (skipped): condition: no docs/REGISTRY.md → fallback: no doc-sync check. Reversibility: n/a.',
  );
  assert.match(line, SCHEMA);
});

test('resolveTarget: run dir under mainRoot ok; under either linked-worktree domain not-anchored; no .git above fails closed; missing dir', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ld-'));
  const main = path.join(root, 'main');
  const wt = path.join(main, '.claude', 'worktrees', 'wt');
  const wt2 = path.join(main, '.worktrees', 'wt2');
  const good = path.join(main, '.claude-tweaks', 'pipelines', 'run-a');
  const shadow = path.join(wt, '.claude-tweaks', 'pipelines', 'run-a');
  const shadow2 = path.join(wt2, '.claude-tweaks', 'pipelines', 'run-a');
  fs.mkdirSync(good, { recursive: true });
  fs.mkdirSync(shadow, { recursive: true });
  fs.mkdirSync(shadow2, { recursive: true });
  // main is a real checkout root: .git is a DIRECTORY.
  fs.mkdirSync(path.join(main, '.git'));
  // Both linked-worktree domains (ADR-0004) point .git at a FILE (a gitdir:
  // pointer) — either domain must be refused by the structural check, not
  // just the one whose directory name the old substring guard happened to know.
  fs.writeFileSync(path.join(wt, '.git'), 'gitdir: ../../../.git/worktrees/wt\n');
  fs.writeFileSync(path.join(wt2, '.git'), 'gitdir: ../../.git/worktrees/wt2\n');
  // mainRoot injected: the shadows live *under* main on disk, so anchoring must
  // compare against the main root AND reject the worktree admin subtree.
  assert.deepEqual(resolveTarget({ runDir: good, mainRoot: main }).ok, true);
  const bad = resolveTarget({ runDir: shadow, mainRoot: main });
  assert.equal(bad.ok, false);
  assert.equal(bad.reason, 'not-anchored');
  const bad2 = resolveTarget({ runDir: shadow2, mainRoot: main });
  assert.equal(bad2.ok, false);
  assert.equal(bad2.reason, 'not-anchored');
  // A run dir with no .git anywhere above it fails closed even when mainRoot
  // is injected as its own parent — unknown must refuse, not default-accept.
  const orphanRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ld-orphan-'));
  const orphanRun = path.join(orphanRoot, 'run-a');
  fs.mkdirSync(orphanRun, { recursive: true });
  assert.deepEqual(resolveTarget({ runDir: orphanRun, mainRoot: orphanRoot }), { ok: false, reason: 'not-anchored' });
  assert.deepEqual(resolveTarget({ runDir: path.join(main, 'nope'), mainRoot: main }), { ok: false, reason: 'missing' });
});

// With `mainRoot: null` passed *explicitly* (not `undefined`), `resolveTarget`'s
// `if (root)` guard is falsy, so the `rootReal !== gitRoot` domain comparison never
// runs — the `.git`-is-a-FILE check on its own is the only thing standing between a
// linked-worktree (or submodule) run dir and a false `ok: true`. This is the branch
// deleting `|| found.isFile` would silently break while every other test (which
// always injects a real `mainRoot`) stays green — see the discrimination proof in
// final-fix-report.md.
test('resolveTarget: with mainRoot explicitly null, the .git-is-a-FILE check alone gates a linked worktree', () => {
  const wtRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ld-nullroot-wt-'));
  const wt = path.join(wtRoot, '.claude', 'worktrees', 'wt');
  const wtRun = path.join(wt, '.claude-tweaks', 'pipelines', 'run-a');
  fs.mkdirSync(wtRun, { recursive: true });
  fs.writeFileSync(path.join(wt, '.git'), 'gitdir: ../../../.git/worktrees/wt\n');
  assert.deepEqual(resolveTarget({ runDir: wtRun, mainRoot: null }), { ok: false, reason: 'not-anchored' });

  const mainRoot2 = fs.mkdtempSync(path.join(os.tmpdir(), 'ld-nullroot-main-'));
  const main2 = path.join(mainRoot2, 'main');
  const mainRun = path.join(main2, '.claude-tweaks', 'pipelines', 'run-b');
  fs.mkdirSync(mainRun, { recursive: true });
  fs.mkdirSync(path.join(main2, '.git'));
  assert.equal(resolveTarget({ runDir: mainRun, mainRoot: null }).ok, true);

  const orphanRoot2 = fs.mkdtempSync(path.join(os.tmpdir(), 'ld-nullroot-orphan-'));
  const orphanRun2 = path.join(orphanRoot2, 'run-c');
  fs.mkdirSync(orphanRun2, { recursive: true });
  assert.deepEqual(resolveTarget({ runDir: orphanRun2, mainRoot: null }), { ok: false, reason: 'not-anchored' });
});

// Production callers (bin/log-decision.js, bin/release-claim.js) always pass
// `mainRoot: undefined` — resolveTarget is documented to compute the anchor
// itself and fail CLOSED if mainCheckoutRoot(cwd) can't determine one. Before
// this fix, `if (root)` silently skipped the domain-match comparison
// whenever computation failed, accepting a run dir inside ANY real (non-
// worktree) git checkout regardless of its relation to cwd — an [IL-127]-
// class bypass distinct from the deliberate `mainRoot: null` opt-out covered
// by the test above.
test('resolveTarget: mainRoot undefined + cwd where mainCheckoutRoot cannot be determined fails closed, not open', () => {
  const foreignRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ld-foreign-'));
  const foreignRun = path.join(foreignRoot, '.claude-tweaks', 'pipelines', 'run-a');
  fs.mkdirSync(foreignRun, { recursive: true });
  fs.mkdirSync(path.join(foreignRoot, '.git')); // a real, but unrelated, checkout

  const cwdNoGit = fs.mkdtempSync(path.join(os.tmpdir(), 'ld-nogit-cwd-'));
  // mainRoot omitted entirely -> undefined, the production default.
  assert.deepEqual(resolveTarget({ runDir: foreignRun, cwd: cwdNoGit }), { ok: false, reason: 'not-anchored' });
});

// #2549: a `--section` value MSYS-mangled into a Windows path under Git Bash
// is normalized back to the intended `/{skill}` form before it reaches the
// decisions.md heading.
test('normalizeSection: reverses the MSYS-mangled Git-for-Windows path shape', () => {
  assert.equal(normalizeSection('C:/Program Files/Git/reflect'), '/reflect');
  assert.equal(normalizeSection('C:/Program Files/Git/wrap-up'), '/wrap-up');
});

test('normalizeSection: a slash-free value is treated as the slash-free calling form', () => {
  assert.equal(normalizeSection('reflect'), '/reflect');
  assert.equal(normalizeSection('wrap-up'), '/wrap-up');
});

test('normalizeSection: an already-correct leading-slash value passes through unchanged (no double slash)', () => {
  assert.equal(normalizeSection('/reflect'), '/reflect');
});

test('normalizeSection: falsy input passes through unchanged', () => {
  assert.equal(normalizeSection(null), null);
  assert.equal(normalizeSection(undefined), undefined);
  assert.equal(normalizeSection(''), '');
});

test('appendEntry: an MSYS-mangled section value writes the normalized `## /reflect` heading', () => {
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ld-run-'));
  appendEntry({ runDir, section: 'C:/Program Files/Git/reflect', entry: '- AUTO 10:00:00 — a: b. Reversibility: high.' });
  const text = fs.readFileSync(path.join(runDir, 'decisions.md'), 'utf8');
  assert.equal(text, '## /reflect\n- AUTO 10:00:00 — a: b. Reversibility: high.\n');
});

test('appendEntry: a slash-free section value writes the same `## /reflect` heading as its slash-prefixed form', () => {
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ld-run-'));
  appendEntry({ runDir, section: 'reflect', entry: '- AUTO 10:00:00 — a: b. Reversibility: high.' });
  const text = fs.readFileSync(path.join(runDir, 'decisions.md'), 'utf8');
  assert.equal(text, '## /reflect\n- AUTO 10:00:00 — a: b. Reversibility: high.\n');
});

test('appendEntry: creates the file, then inserts under the named section before the next heading', () => {
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ld-run-'));
  const r1 = appendEntry({ runDir, section: '/build', entry: '- AUTO 10:00:00 — a: b. Reversibility: high.' });
  assert.equal(r1.created, true);
  appendEntry({ runDir, section: '/review', entry: '- AUTO 10:00:01 — c: d. Reversibility: high.' });
  appendEntry({ runDir, section: '/build', entry: '- AUTO 10:00:02 — e: f. Reversibility: high.' });
  appendEntry({ runDir, entry: '- AUTO 10:00:03 — g: h. Reversibility: high.' });
  const text = fs.readFileSync(path.join(runDir, 'decisions.md'), 'utf8');
  assert.equal(text,
    '## /build\n' +
    '- AUTO 10:00:00 — a: b. Reversibility: high.\n' +
    '- AUTO 10:00:02 — e: f. Reversibility: high.\n' +
    '## /review\n' +
    '- AUTO 10:00:01 — c: d. Reversibility: high.\n' +
    '- AUTO 10:00:03 — g: h. Reversibility: high.\n');
});

// #816: appendEntry's read-modify-write raced under concurrent invocations and could
// silently drop an entry — two writers reading the same pre-append content each
// overwrite the other's write. Reproduces with real OS processes (the actual
// `node bin/log-decision.js --run <same-dir> ...` shape the AC names), the same
// cross-process technique bin/lib/file-lock.test.js's own concurrency test uses.
test('appendEntry: concurrent `node bin/log-decision.js` processes against the same run dir never drop an entry', async () => {
  const { spawn } = require('child_process');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ld-concurrent-'));
  fs.mkdirSync(path.join(root, '.git')); // a real checkout root: mainCheckoutRoot(cwd) anchors here
  const runDir = path.join(root, '.claude-tweaks', 'pipelines', 'run-concurrent');
  fs.mkdirSync(runDir, { recursive: true });

  const cliPath = path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'log-decision.js');
  const WORKERS = 8;
  const spawnOne = (i) => new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [
      cliPath, '--run', runDir, '--status', 'AUTO', '--text', `worker ${i}`,
    ], { cwd: root, env: { ...process.env, CLAUDE_TWEAKS_LOCK_WAIT_MS: '60000' } });
    let stderr = '';
    p.stderr.on('data', (d) => { stderr += d; });
    p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`worker ${i} exited ${code}: ${stderr}`))));
    p.on('error', reject);
  });

  await Promise.all(Array.from({ length: WORKERS }, (_, i) => spawnOne(i)));

  const text = fs.readFileSync(path.join(runDir, 'decisions.md'), 'utf8');
  for (let i = 0; i < WORKERS; i++) {
    assert.match(text, new RegExp(`worker ${i}\\.`), `worker ${i}'s entry must not be dropped by a concurrent writer`);
  }
  const lines = text.trim().split('\n').filter(Boolean);
  assert.equal(lines.length, WORKERS, 'every worker\'s line must survive, none clobbered');
});
