'use strict';
// learned-skills-pr capture (#5290): a Skills-row edit leaves the run branch as a patch in the run dir.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { capture, stageEntry, readManifest, realDeps } = require('../../../plugin/bin/lib/learned-skills/learned-skills.js');
const cli = require('../../../plugin/bin/learned-skills-pr.js');

const ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.test',
  GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.test',
  GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null',
};
const X = '.claude/skills/x/SKILL.md';

function sh(cwd, args) {
  return execFileSync('git', args, { cwd, env: ENV, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
}
function write(repo, rel, text) {
  fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true });
  fs.writeFileSync(path.join(repo, rel), text);
}

// A repo with one commit holding x/SKILL.md, a run dir under .claude-tweaks/pipelines, a merge base.
function fixture(t, extraFiles = {}) {
  const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ls-capture-')));
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }));
  sh(repo, ['init', '-q']);
  write(repo, X, '# x\n\nline one\nline two\nline three\nline four\nline five\nline six\nline seven\n');
  for (const [rel, text] of Object.entries(extraFiles)) write(repo, rel, text);
  sh(repo, ['add', '-A']);
  sh(repo, ['commit', '-q', '-m', 'base']);
  const runDir = path.join(repo, '.claude-tweaks', 'pipelines', '2026-11-13T000000-spec-1');
  fs.mkdirSync(runDir, { recursive: true });
  return { repo, runDir, mergeBase: sh(repo, ['rev-parse', 'HEAD']).trim() };
}

function recorder() {
  const calls = [];
  const deps = {
    git: (args, opts) => { calls.push(args); return realDeps.git(args, opts); },
    now: () => Date.UTC(2026, 10, 13, 12, 0, 0),
  };
  return { calls, deps };
}

const status = (repo, rel) => sh(repo, ['--no-optional-locks', 'status', '--porcelain', '--untracked-files=all', '--', rel]);
const args = (f, target, summary = 'adds a note') => ({
  runDir: f.runDir, worktree: f.repo, mergeBase: f.mergeBase, target, summary,
});

test('record-owned target stays on the run branch', (t) => {
  const f = fixture(t);
  write(f.repo, X, '# x\n\nrecord edit\n');
  sh(f.repo, ['commit', '-q', '-am', 'record edit']);
  write(f.repo, X, '# x\n\nrecord edit\nmore\n');
  const res = capture(args(f, X));
  assert.deepEqual(res, { route: 'run-branch', reason: 'record-owned' });
  assert.notEqual(status(f.repo, X), '', 'working tree stays dirty');
  assert.equal(fs.existsSync(path.join(f.runDir, 'learned-skills', 'manifest.json')), false);
});

test('captures a tracked edit and reverts it', (t) => {
  const f = fixture(t);
  const original = fs.readFileSync(path.join(f.repo, X), 'utf8');
  write(f.repo, X, original + 'learned: a new anti-pattern\n');
  const res = capture(args(f, X));
  assert.equal(res.route, 'captured');
  assert.equal(res.id, '1');
  assert.equal(res.shared, false);
  assert.ok(path.isAbsolute(res.patch));
  const patch = fs.readFileSync(res.patch, 'utf8');
  assert.ok(patch.startsWith(`diff --git a/${X} b/${X}`), patch.slice(0, 80));
  sh(f.repo, ['apply', '--check', res.patch]);
  assert.equal(status(f.repo, X), '');
  assert.equal(fs.readFileSync(path.join(f.repo, X), 'utf8'), original);
  const manifest = readManifest(f.runDir);
  assert.equal(manifest.length, 1);
  assert.equal(manifest[0].status, 'captured');
  assert.equal(manifest[0].target, X);
});

test('captures a new untracked skill file and deletes it', (t) => {
  const f = fixture(t);
  const y = '.claude/skills/y/SKILL.md';
  write(f.repo, y, '# y\n\nbrand new\n');
  const res = capture(args(f, y));
  assert.equal(res.route, 'captured');
  assert.match(fs.readFileSync(res.patch, 'utf8'), /new file mode/);
  assert.equal(fs.existsSync(path.join(f.repo, y)), false);
  assert.equal(status(f.repo, y), '');
  sh(f.repo, ['apply', '--check', res.patch]);
});

test('second finding on the same target reuses the patch', (t) => {
  const f = fixture(t);
  write(f.repo, X, fs.readFileSync(path.join(f.repo, X), 'utf8') + 'one\n');
  const first = capture(args(f, X));
  const second = capture(args(f, X, 'a second finding'));
  assert.deepEqual(second, { route: 'captured', id: '1', patch: first.patch, shared: true });
  assert.equal(readManifest(f.runDir).length, 1);
});

test('clean target', (t) => {
  const f = fixture(t);
  assert.deepEqual(capture(args(f, X)), { route: 'clean' });
  assert.equal(fs.existsSync(path.join(f.runDir, 'learned-skills', 'manifest.json')), false);
});

test("a later row's edit to a captured target joins the same patch", (t) => {
  const f = fixture(t);
  const body = fs.readFileSync(path.join(f.repo, X), 'utf8');
  write(f.repo, X, body.replace('# x\n', '# x\nfirst edit near the top\n'));
  const first = capture(args(f, X));
  write(f.repo, X, body + 'second edit at the bottom\n');
  const second = capture(args(f, X, 'second'));
  assert.equal(second.route, 'captured');
  assert.equal(second.id, '1');
  assert.equal(second.shared, true);
  const patch = fs.readFileSync(first.patch, 'utf8');
  assert.match(patch, /first edit near the top/);
  assert.match(patch, /second edit at the bottom/);
  sh(f.repo, ['apply', '--check', first.patch]);
  assert.equal(status(f.repo, X), '');
  assert.equal(fs.readFileSync(path.join(f.repo, X), 'utf8'), body);
  assert.equal(readManifest(f.runDir).length, 1);
});

test('failure after the diff stages instead of committing', (t) => {
  const f = fixture(t);
  const head = sh(f.repo, ['rev-parse', 'HEAD']).trim();
  const original = fs.readFileSync(path.join(f.repo, X), 'utf8');
  write(f.repo, X, original + 'will be staged\n');
  const { deps } = recorder();
  const failing = {
    ...deps,
    git: (a, o) => {
      if (a.includes('checkout')) throw new Error('simulated checkout failure');
      return realDeps.git(a, o);
    },
  };
  // The captured diff, read the way capture reads it.
  const diff = sh(f.repo, ['-c', 'core.quotePath=false', 'diff', '--no-color', '--no-ext-diff', '--src-prefix=a/', '--dst-prefix=b/', '--binary', 'HEAD', '--', X]);
  const res = capture(args(f, X), failing);
  assert.equal(res.route, 'staged');
  const staged = path.join(f.runDir, 'staged', 'wrap-up-skill-1.md');
  assert.equal(res.stagePath, staged);
  assert.ok(path.isAbsolute(res.stagePath) && res.stagePath.startsWith(f.runDir));
  const text = fs.readFileSync(staged, 'utf8');
  assert.equal(text.slice(text.indexOf('diff --git')), diff);
  assert.match(text, /^Target: \.claude\/skills\/x\/SKILL\.md\nInvariant: adds a note\n/);
  assert.equal(status(f.repo, X), '');
  assert.equal(fs.readFileSync(path.join(f.repo, X), 'utf8'), original);
  assert.equal(sh(f.repo, ['rev-parse', 'HEAD']).trim(), head, 'no commit on the branch');
  const log = fs.readFileSync(path.join(f.runDir, 'decisions.md'), 'utf8');
  assert.match(log, /- STAGED \d\d:\d\d:\d\d — Skills row: skill update for x\/SKILL\.md \(adds a note\) could not ride a learned-skills PR \(capture failed: .*simulated checkout failure.*\); staged instead\. Reversibility: high \(stage path: staged\/wrap-up-skill-1\.md\)\./);
  assert.equal(readManifest(f.runDir)[0].status, 'staged');
});

test('stageEntry gate', (t) => {
  const f = fixture(t);
  const original = fs.readFileSync(path.join(f.repo, X), 'utf8');
  write(f.repo, X, original + 'gate edit\n');
  const diff = sh(f.repo, ['-c', 'core.quotePath=false', 'diff', '--no-color', '--no-ext-diff', '--src-prefix=a/', '--dst-prefix=b/', '--binary', 'HEAD', '--', X]);
  sh(f.repo, ['checkout', 'HEAD', '--', X]);
  const ok = stageEntry({ runDir: f.runDir, worktree: f.repo, entry: { target: X, summary: 'gate edit', patch: diff }, reason: 'test' });
  assert.equal(ok.gate, 'ok');
  assert.ok(path.isAbsolute(ok.stagePath) && ok.stagePath.startsWith(f.runDir));
  assert.ok(fs.readFileSync(ok.stagePath, 'utf8').includes('diff --git'));

  const bad = stageEntry({
    runDir: f.runDir, worktree: f.repo, entry: { target: X, summary: 'garbage', patch: diff.slice(0, diff.length - 40).replace(/@@ [^@]*@@/, '@@ -1,1 +1,99 @@') }, reason: 'test',
  });
  assert.equal(bad.gate, 'description-only');
  assert.ok(path.isAbsolute(bad.stagePath) && bad.stagePath.startsWith(f.runDir));
  assert.equal(fs.readFileSync(bad.stagePath, 'utf8').includes('diff --git'), false);
  assert.notEqual(ok.stagePath, bad.stagePath);
  assert.match(path.basename(bad.stagePath), /^wrap-up-skill-2\.md$/);
});

test('non-ASCII and dash-leading paths', (t) => {
  const cafe = '.claude/skills/café/SKILL.md';
  const evil = '-evil/SKILL.md';
  const f = fixture(t, { [cafe]: '# cafe\n', [evil]: '# evil\n' });
  write(f.repo, cafe, '# cafe\nedited\n');
  write(f.repo, evil, '# evil\nedited\n');
  const { calls, deps } = recorder();
  for (const target of [cafe, evil]) {
    const res = capture(args(f, target), deps);
    assert.equal(res.route, 'captured', target);
    sh(f.repo, ['apply', '--check', res.patch]);
    assert.equal(status(f.repo, target), '');
  }
  const diffCall = calls.find((a) => a.includes('--binary'));
  for (const want of ['-c', 'core.quotePath=false', '--no-color', '--no-ext-diff', '--src-prefix=a/', '--dst-prefix=b/']) {
    assert.ok(diffCall.includes(want), `diff argv has ${want}`);
  }
  assert.ok(diffCall.indexOf('--') < diffCall.length - 1 && diffCall[diffCall.length - 2] === '--', 'pathspec after --');
  const nameOnly = calls.find((a) => a.includes('--name-only'));
  assert.ok(nameOnly.includes('-z'));
  assert.ok(nameOnly.includes('--end-of-options'));
});

test('a target outside the worktree is a usage error', (t) => {
  const f = fixture(t);
  assert.throws(() => capture(args(f, '../escape/SKILL.md')), /inside the worktree/);
  assert.throws(() => capture(args(f, '/etc/passwd')), /repo-relative/);
});

test('CLI run with a missing --target exits 2', (t) => {
  const f = fixture(t);
  const err = [];
  const summaryFile = path.join(f.repo, 'summary.txt');
  fs.writeFileSync(summaryFile, 'a note');
  const code = cli.run(['capture', '--run', f.runDir, '--worktree', f.repo, '--merge-base', f.mergeBase, '--summary-file', summaryFile], {
    stderr: (s) => err.push(s), stdout: () => {},
  });
  assert.equal(code, 2);
  assert.match(err.join(''), /--target is required/);
});

test('CLI run captures and prints one JSON line', (t) => {
  const f = fixture(t);
  write(f.repo, X, fs.readFileSync(path.join(f.repo, X), 'utf8') + 'cli edit\n');
  const summaryFile = path.join(f.repo, 'summary.txt');
  fs.writeFileSync(summaryFile, 'a note\n');
  const out = [];
  const code = cli.run(['capture', '--run', f.runDir, '--worktree', f.repo, '--merge-base', f.mergeBase, '--target', X, '--summary-file', summaryFile], {
    stdout: (s) => out.push(s), stderr: () => {}, mainRoot: f.repo,
  });
  assert.equal(code, 0);
  const lines = out.join('').trim().split('\n');
  assert.equal(lines.length, 1);
  assert.equal(JSON.parse(lines[0]).route, 'captured');
});

test('CLI run exits 1 with nothing changed when git fails before the diff', (t) => {
  const f = fixture(t);
  const original = fs.readFileSync(path.join(f.repo, X), 'utf8');
  write(f.repo, X, original + 'untouched\n');
  const summaryFile = path.join(f.repo, 'summary.txt');
  fs.writeFileSync(summaryFile, 'a note');
  const err = [];
  const code = cli.run(['capture', '--run', f.runDir, '--worktree', f.repo, '--merge-base', 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef', '--target', X, '--summary-file', summaryFile], {
    stdout: () => {}, stderr: (s) => err.push(s), mainRoot: f.repo,
  });
  assert.equal(code, 1);
  assert.match(err.join(''), /nothing was changed/);
  assert.equal(fs.readFileSync(path.join(f.repo, X), 'utf8'), original + 'untouched\n');
});

// --- fix round 1 ---------------------------------------------------------------------------------

const { StagingFailure } = require('../../../plugin/bin/lib/learned-skills/learned-skills.js');
const baseDeps = { now: () => Date.UTC(2026, 10, 13, 12, 0, 0) };
const failCheckout = (a, o) => {
  if (a.includes('checkout')) throw new Error('simulated checkout failure');
  return realDeps.git(a, o);
};
const diffOf = (repo, rel) => sh(repo, ['-c', 'core.quotePath=false', 'diff', '--no-color', '--no-ext-diff', '--src-prefix=a/', '--dst-prefix=b/', '--binary', 'HEAD', '--', rel]);

test('both writers failing restores the edit and exits 1 without claiming nothing changed', (t) => {
  const f = fixture(t);
  const original = fs.readFileSync(path.join(f.repo, X), 'utf8');
  write(f.repo, X, original + 'precious edit\n');
  const deps = {
    ...baseDeps,
    git: failCheckout,
    mkdir: (p) => {
      if (path.basename(p) === 'staged') throw Object.assign(new Error('EACCES: staged'), { code: 'EACCES' });
      fs.mkdirSync(p, { recursive: true });
    },
  };
  assert.throws(() => capture(args(f, X), deps), (e) => e instanceof StagingFailure && e.restored === true);
  assert.equal(fs.readFileSync(path.join(f.repo, X), 'utf8'), original + 'precious edit\n');

  const summaryFile = path.join(f.repo, 'summary.txt');
  fs.writeFileSync(summaryFile, 'a note');
  const err = [];
  const code = cli.run(['capture', '--run', f.runDir, '--worktree', f.repo, '--merge-base', f.mergeBase, '--target', X, '--summary-file', summaryFile], {
    stdout: () => {}, stderr: (s) => err.push(s), mainRoot: f.repo, lib: deps,
  });
  assert.equal(code, 1);
  const msg = err.join('');
  assert.match(msg, /staging failed too/);
  assert.match(msg, /restored in the working tree/);
  assert.doesNotMatch(msg, /nothing was changed/);
  assert.equal(fs.readFileSync(path.join(f.repo, X), 'utf8'), original + 'precious edit\n');
});

test('a failed re-diff after a join leaves the earlier patch captured', (t) => {
  const f = fixture(t);
  const body = fs.readFileSync(path.join(f.repo, X), 'utf8');
  write(f.repo, X, body.replace('# x\n', '# x\nfirst edit near the top\n'));
  const first = capture(args(f, X, 'first finding'));
  write(f.repo, X, body + 'second edit at the bottom\n');
  let diffs = 0;
  const deps = {
    ...baseDeps,
    git: (a, o) => {
      if (a.includes('--binary') && ++diffs === 2) throw new Error('simulated re-diff failure');
      return realDeps.git(a, o);
    },
  };
  const res = capture(args(f, X, 'second finding'), deps);
  assert.equal(res.route, 'staged');
  const manifest = readManifest(f.runDir);
  assert.equal(manifest[0].status, 'captured');
  assert.match(fs.readFileSync(first.patch, 'utf8'), /first edit near the top/);
  assert.equal(manifest[1].status, 'staged');
  const staged = fs.readFileSync(res.stagePath, 'utf8');
  assert.match(staged, /second edit at the bottom/);
  assert.doesNotMatch(staged, /first edit near the top/);
  assert.equal(status(f.repo, X), '');
});

test('a landed entry is not joined: a fresh capture gets a new id', (t) => {
  const f = fixture(t);
  fs.mkdirSync(path.join(f.runDir, 'learned-skills'), { recursive: true });
  const landedPatch = path.join(f.runDir, 'learned-skills', '1.patch');
  fs.writeFileSync(landedPatch, 'landed bytes');
  fs.writeFileSync(path.join(f.runDir, 'learned-skills', 'manifest.json'), JSON.stringify([
    { id: '1', target: X, summary: 'old', patch: landedPatch, status: 'landed', commit: 'abc' },
  ]));
  write(f.repo, X, fs.readFileSync(path.join(f.repo, X), 'utf8') + 'fresh edit\n');
  const res = capture(args(f, X));
  assert.equal(res.route, 'captured');
  assert.equal(res.id, '2');
  assert.equal(res.shared, false);
  assert.equal(fs.readFileSync(landedPatch, 'utf8'), 'landed bytes');
  assert.equal(readManifest(f.runDir).length, 2);
});

test('a failed STAGED log write surfaces logFailed', (t) => {
  const f = fixture(t);
  write(f.repo, X, fs.readFileSync(path.join(f.repo, X), 'utf8') + 'edit\n');
  const res = capture(args(f, X), {
    ...baseDeps,
    git: failCheckout,
    appendEntries: () => { throw new Error('decisions.md unwritable'); },
  });
  assert.equal(res.route, 'staged');
  assert.equal(res.logFailed, true);
});

test('shared-target fallback preamble names both findings', (t) => {
  const f = fixture(t);
  const body = fs.readFileSync(path.join(f.repo, X), 'utf8');
  write(f.repo, X, body.replace('# x\n', '# x\nfirst edit near the top\n'));
  capture(args(f, X, 'first finding'));
  write(f.repo, X, body + 'second edit at the bottom\n');
  const res = capture(args(f, X, 'second finding'), { ...baseDeps, git: failCheckout });
  assert.equal(res.route, 'staged');
  const text = fs.readFileSync(res.stagePath, 'utf8');
  assert.match(text, /^Invariant: first finding; second finding$/m);
  assert.match(text, /^Finding: Skills row — first finding; second finding$/m);
  const m = readManifest(f.runDir);
  assert.equal(m.length, 1);
  assert.equal(m[0].status, 'staged');
});

test('degraded gates log staged-patch.md lines', (t) => {
  const f = fixture(t);
  write(f.repo, X, fs.readFileSync(path.join(f.repo, X), 'utf8') + 'gate edit\n');
  const diff = diffOf(f.repo, X);
  sh(f.repo, ['checkout', 'HEAD', '--', X]);
  const bad = stageEntry({
    runDir: f.runDir, worktree: f.repo, entry: { target: X, summary: 'garbled', patch: 'not a patch\n' }, reason: 'r',
  }, baseDeps);
  assert.equal(bad.gate, 'description-only');
  const unv = stageEntry({
    runDir: f.runDir, worktree: f.repo, entry: { target: X, summary: 'unchecked', patch: diff }, reason: 'r',
  }, {
    ...baseDeps,
    git: (a, o) => { if (a.includes('--check')) throw new Error('boom'); return realDeps.git(a, o); },
    readFile: () => { throw new Error('unreadable'); },
  });
  assert.equal(unv.gate, 'unvalidated');
  const log = fs.readFileSync(path.join(f.runDir, 'decisions.md'), 'utf8');
  const m = /- STAGED \d\d:\d\d:\d\d — Skills row: x\/SKILL\.md \(garbled\) — patch failed `git apply --check` at staging \((.*)\); staged description-only at staged\/wrap-up-skill-1\.md\. Reversibility: high\.$/m.exec(log);
  assert.ok(m, log);
  assert.notEqual(m[1], '');
  assert.doesNotMatch(m[1], /Command failed/);
  assert.equal(m[1].includes(f.repo), false, 'no absolute path in the first stderr line');
  assert.equal(m[1].includes(f.runDir), false);
  assert.match(log, /- STAGED \d\d:\d\d:\d\d — Skills row: x\/SKILL\.md \(unchecked\) — gate could not run: .* — path\/anchoring problem, not a composition error\. Reversibility: high\.$/m);
});

// --- fix round 2 ---------------------------------------------------------------------------------

const failMkdirStaged = (p) => {
  if (path.basename(p) === 'staged') throw Object.assign(new Error('EACCES: staged'), { code: 'EACCES' });
  fs.mkdirSync(p, { recursive: true });
};

test('residue plus a failed staging reports the edit as still in the tree, not lost', (t) => {
  const f = fixture(t);
  const original = fs.readFileSync(path.join(f.repo, X), 'utf8');
  write(f.repo, X, original + 'stuck edit\n');
  const calls = [];
  const deps = {
    ...baseDeps,
    // checkout is a no-op (residue), and the fallback's own resets fail too
    git: (a, o) => {
      calls.push(a);
      if (a.includes('checkout')) return '';
      if (a.includes('restore') || (a.includes('apply') && a.includes('-R'))) throw new Error('simulated reset failure');
      return realDeps.git(a, o);
    },
    mkdir: failMkdirStaged,
  };
  let caught;
  try { capture(args(f, X), deps); } catch (e) { caught = e; }
  assert.ok(caught instanceof StagingFailure);
  assert.equal(caught.restored, true);
  assert.match(caught.message, /still in the working tree/);
  assert.doesNotMatch(caught.message, /lost|not in the tree/);
  assert.equal(calls.some((a) => a.includes('apply') && a.includes('-') && a[a.length - 1] === '-' && !a.includes('-R')), false, 'no re-apply on top of the edit');
  assert.equal(fs.readFileSync(path.join(f.repo, X), 'utf8'), original + 'stuck edit\n');
});

test('a throw after the staged file was created leaves no partial proposal', (t) => {
  const f = fixture(t);
  const original = fs.readFileSync(path.join(f.repo, X), 'utf8');
  write(f.repo, X, original + 'edit\n');
  const deps = {
    ...baseDeps,
    git: (a, o) => {
      if (a.includes('checkout')) throw new Error('simulated checkout failure');
      if (a.includes('--check')) throw new Error('simulated check failure');
      return realDeps.git(a, o);
    },
    writeFile: (p, data) => {
      if (p.endsWith('.md')) throw new Error('disk full');
      return realDeps.writeFile(p, data);
    },
  };
  assert.throws(() => capture(args(f, X), deps), (e) => e instanceof StagingFailure && e.restored === true);
  const stagedDir = path.join(f.runDir, 'staged');
  const left = fs.existsSync(stagedDir) ? fs.readdirSync(stagedDir) : [];
  assert.deepEqual(left, []);
  assert.equal(fs.readFileSync(path.join(f.repo, X), 'utf8'), original + 'edit\n');
});

test('a fallback leaves no orphan patch file', (t) => {
  const f = fixture(t);
  write(f.repo, X, fs.readFileSync(path.join(f.repo, X), 'utf8') + 'edit\n');
  const orphan = path.join(f.runDir, 'learned-skills', '1.patch');
  const res = capture(args(f, X), { ...baseDeps, git: failCheckout });
  assert.equal(res.route, 'staged');
  assert.equal(fs.existsSync(orphan), false);

  const g = fixture(t);
  write(g.repo, X, fs.readFileSync(path.join(g.repo, X), 'utf8') + 'edit\n');
  assert.throws(() => capture(args(g, X), { ...baseDeps, git: failCheckout, mkdir: (p) => { failMkdirStaged(p); } }), StagingFailure);
  assert.equal(fs.existsSync(path.join(g.runDir, 'learned-skills', '1.patch')), false);
});
