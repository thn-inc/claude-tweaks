'use strict';
// learned-skills-pr capture (#5290): a Skills-row edit leaves the run branch as a patch in the run dir.
const { test, after } = require('node:test');
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

// Round 4: a failed join stages the new edit alone and never touches the earlier capture. Staging
// the joined superset (rounds 1-3) scheduled the earlier edit twice whenever the manifest could not
// then be flipped to 'staged' (fault matrix, joined [checkout, manifest]).
test('a failed joined capture stages only the new edit and keeps the earlier capture', (t) => {
  const f = fixture(t);
  const body = fs.readFileSync(path.join(f.repo, X), 'utf8');
  write(f.repo, X, body.replace('# x\n', '# x\nfirst edit near the top\n'));
  const first = capture(args(f, X, 'first finding'));
  const earlier = fs.readFileSync(first.patch);
  write(f.repo, X, body + 'second edit at the bottom\n');
  const res = capture(args(f, X, 'second finding'), { ...baseDeps, git: failCheckout });
  assert.equal(res.route, 'staged');
  const text = fs.readFileSync(res.stagePath, 'utf8');
  assert.match(text, /^Invariant: second finding$/m);
  assert.match(text, /^Finding: Skills row — second finding$/m);
  assert.match(text, /second edit at the bottom/);
  assert.doesNotMatch(text, /first edit near the top/);
  const m = readManifest(f.runDir);
  assert.deepEqual(m.map((e) => [e.id, e.status]), [['1', 'captured'], ['2', 'staged']]);
  assert.ok(fs.readFileSync(first.patch).equals(earlier), 'the earlier patch file is untouched');
  assert.equal(status(f.repo, X), '');
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

test('triple failure keeps the patch file and names it', (t) => {
  const f = fixture(t);
  write(f.repo, X, fs.readFileSync(path.join(f.repo, X), 'utf8') + 'edit\n');
  const deps = {
    ...baseDeps,
    git: (a, o) => {
      if (a.includes('checkout')) throw new Error('simulated checkout failure');
      if (a[a.length - 1] === '-' && !a.includes('-R')) throw new Error('simulated re-apply failure');
      return realDeps.git(a, o);
    },
    mkdir: failMkdirStaged,
  };
  let caught;
  try { capture(args(f, X), deps); } catch (e) { caught = e; }
  assert.ok(caught instanceof StagingFailure);
  assert.equal(caught.restored, false);
  // The kept copy is the confirmed pending file, named in the message.
  const kept = caught.holder;
  assert.equal(path.dirname(kept), path.join(f.runDir, 'learned-skills'));
  assert.ok(caught.message.includes(kept), caught.message);
  assert.match(fs.readFileSync(kept, 'utf8'), /^diff --git/);
});

test('reason carries the first stderr line only', (t) => {
  const f = fixture(t);
  write(f.repo, X, fs.readFileSync(path.join(f.repo, X), 'utf8') + 'edit\n');
  const fail = {
    ...baseDeps,
    git: (a, o) => {
      if (a.includes('checkout')) return realDeps.git(['-C', f.repo, 'checkout', 'no-such-ref-xyz', '--', X], o);
      return realDeps.git(a, o);
    },
  };
  const res = capture(args(f, X), fail);
  assert.equal(res.route, 'staged');
  assert.doesNotMatch(res.reason, /Command failed/);
  assert.equal(res.reason.includes(f.repo), false, res.reason);
  assert.match(res.reason, /^capture failed: (fatal|error): /);
});

test('an intent-to-add entry with no file is not read as the edit being in the tree', (t) => {
  const f = fixture(t);
  const y = '.claude/skills/y/SKILL.md';
  write(f.repo, y, '# y\n\nbrand new\n');
  const deps = {
    ...baseDeps,
    git: (a, o) => {
      if (a.includes('rm') && a.includes('--cached')) throw new Error('simulated rm failure');
      return realDeps.git(a, o);
    },
    mkdir: failMkdirStaged,
  };
  let caught;
  try { capture(args(f, y), deps); } catch (e) { caught = e; }
  assert.ok(caught instanceof StagingFailure);
  assert.match(caught.message, /restored in the working tree/);
  assert.equal(fs.readFileSync(path.join(f.repo, y), 'utf8'), '# y\n\nbrand new\n');
});

test('a patch write that dies partway leaves no partial patch file', (t) => {
  const f = fixture(t);
  write(f.repo, X, fs.readFileSync(path.join(f.repo, X), 'utf8') + 'edit\n');
  const res = capture(args(f, X), {
    ...baseDeps,
    writeFileExclusive: (p, d) => {
      if (p.endsWith('.patch')) { fs.writeFileSync(p, 'partial'); throw new Error('disk full'); }
      return realDeps.writeFileExclusive(p, d);
    },
  });
  assert.equal(res.route, 'staged');
  assert.deepEqual(fs.readdirSync(path.join(f.runDir, 'learned-skills')).filter((n) => n.endsWith('.patch')), []);
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

// --- fix round 4: the durability invariant, under injected faults --------------------------------
//
// From the diff read until capture returns, the whole change (in a join: the earlier captured edit
// plus this one) is held complete in the tree, a learned-skills/ patch, or a staged/ file, and the
// outcome names a place that holds it. Every fault point capture's fallback can hit is enumerated
// below; each combination runs against a real repo with the faults injected through deps.

const TOP = (b) => b.replace('# x\n', '# x\nfirst edit near the top\n');
const BOTTOM = (b) => b + 'second edit at the bottom\n';

// kind: 'tracked' (an edit to X), 'untracked' (a new Y), 'joined' (X captured once, then edited again).
// Each kind is built once; every combination runs on a fresh copy of it.
const templates = new Map();
const templateCleanups = [];
after(() => { for (const fn of templateCleanups) fn(); });

function scenario(t, kind) {
  if (!templates.has(kind)) templates.set(kind, buildScenario({ after: (fn) => templateCleanups.push(fn) }, kind));
  const tpl = templates.get(kind);
  const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ls-matrix-')));
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }));
  fs.cpSync(tpl.f.repo, repo, { recursive: true });
  const rebase = (p) => path.join(repo, path.relative(tpl.f.repo, p));
  const s = { ...tpl, f: { repo, runDir: rebase(tpl.f.runDir), mergeBase: tpl.f.mergeBase } };
  if (tpl.existingPatch) {
    s.existingPatch = rebase(tpl.existingPatch);
    const m = readManifest(s.f.runDir).map((e) => ({ ...e, patch: rebase(e.patch) }));
    fs.writeFileSync(path.join(s.f.runDir, 'learned-skills', 'manifest.json'), JSON.stringify(m, null, 2) + '\n');
  }
  return s;
}

function buildScenario(t, kind) {
  const f = fixture(t);
  const body = fs.readFileSync(path.join(f.repo, X), 'utf8');
  const s = { f, kind, joined: kind === 'joined', head: sh(f.repo, ['rev-parse', 'HEAD']).trim() };
  if (kind === 'untracked') {
    s.target = '.claude/skills/y/SKILL.md';
    write(f.repo, s.target, '# y\n\nbrand new\n');
    sh(f.repo, ['add', '-N', '--', s.target]);
    s.C = Buffer.from(diffOf(f.repo, s.target));
    sh(f.repo, ['rm', '--cached', '--quiet', '--', s.target]);
    s.D = s.C;
    s.full = Buffer.from('# y\n\nbrand new\n');
    s.start = s.full;
    s.headBytes = null;
    return s;
  }
  s.target = X;
  s.headBytes = Buffer.from(body);
  if (kind === 'tracked') {
    write(f.repo, X, BOTTOM(body));
    s.C = Buffer.from(diffOf(f.repo, X));
    s.D = s.C;
    s.full = Buffer.from(BOTTOM(body));
    s.start = s.full;
    return s;
  }
  write(f.repo, X, BOTTOM(TOP(body)));
  s.C = Buffer.from(diffOf(f.repo, X));
  s.full = Buffer.from(BOTTOM(TOP(body)));
  write(f.repo, X, BOTTOM(body));
  s.D = Buffer.from(diffOf(f.repo, X));
  write(f.repo, X, TOP(body));
  const first = capture(args(f, X, 'first finding'), baseDeps);
  assert.equal(first.route, 'captured');
  s.existingPatch = first.patch;
  s.P1 = fs.readFileSync(first.patch);
  write(f.repo, X, BOTTOM(body));
  s.start = Buffer.from(BOTTOM(body));
  return s;
}

const POINTS = {
  tracked: ['patch-write', 'patch-write-partial', 'checkout', 'promote', 'manifest', 'staged-write', 'staged-write-partial', 'gate', 're-apply', 'reverse-apply'],
  untracked: ['patch-write', 'patch-write-partial', 'rm-cached', 'unlink', 'promote', 'manifest', 'staged-write', 'staged-write-partial', 'gate', 're-apply', 'reverse-apply'],
  joined: ['patch-write', 'patch-write-partial', 'checkout', 'join-apply', 're-diff', 'promote', 'restore-earlier', 'manifest', 'staged-write', 'staged-write-partial', 'gate', 're-apply', 'reverse-apply'],
};
const EXCLUSIVE = [['patch-write', 'patch-write-partial'], ['staged-write', 'staged-write-partial']];
// Chains named in review, run whatever the sampling picks.
const CHAINS = {
  tracked: [
    ['patch-write-partial', 'staged-write', 're-apply'],
    ['patch-write-partial', 'checkout', 'staged-write', 're-apply'],
    ['checkout', 'staged-write', 're-apply'],
    ['promote', 'staged-write', 're-apply'],
    ['manifest', 'staged-write', 're-apply'],
    ['patch-write', 'gate', 're-apply'],
    ['checkout', 'reverse-apply', 'staged-write', 're-apply'],
  ],
  untracked: [
    ['rm-cached', 'staged-write', 're-apply'],
    ['unlink', 'reverse-apply', 'staged-write'],
    ['patch-write-partial', 'rm-cached', 'staged-write', 're-apply'],
    ['promote', 'staged-write', 're-apply'],
  ],
  joined: [
    ['checkout', 'staged-write', 're-apply'],
    ['checkout', 'staged-write', 're-apply', 'restore-earlier'],
    ['promote', 'staged-write', 're-apply'],
    ['promote', 'staged-write', 're-apply', 'restore-earlier'],
    ['re-diff', 'reverse-apply'],
    ['re-diff', 'reverse-apply', 'staged-write'],
    ['re-diff', 'staged-write', 're-apply'],
    ['patch-write-partial', 'checkout', 'staged-write', 're-apply'],
    ['patch-write', 'gate', 're-apply'],
    ['join-apply', 'staged-write', 're-apply'],
  ],
};

function combos(points, k) {
  const out = [];
  const rec = (from, acc) => {
    if (acc.length === k) { out.push(acc); return; }
    for (let i = from; i < points.length; i++) rec(i + 1, [...acc, points[i]]);
  };
  rec(0, []);
  return out.filter((c) => !EXCLUSIVE.some(([a, b]) => c.includes(a) && c.includes(b)));
}

// Deterministic sample (mulberry32), so a red combination reproduces.
function sample(list, n, seed) {
  let a = seed >>> 0;
  const rand = () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
  const pool = [...list];
  const picked = [];
  while (picked.length < n && pool.length) picked.push(pool.splice(Math.floor(rand() * pool.length), 1)[0]);
  return picked;
}

function faultyDeps(s, faults, fired) {
  const ls = path.join(s.f.runDir, 'learned-skills');
  const staged = path.join(s.f.runDir, 'staged');
  const abs = path.join(s.f.repo, s.target);
  const has = (n) => faults.includes(n);
  const boom = (n) => { fired.add(n); return Object.assign(new Error(`injected ${n}`), { stderr: `fatal: injected ${n}\n` }); };
  const half = (d) => { const b = Buffer.isBuffer(d) ? d : Buffer.from(String(d)); return b.subarray(0, Math.floor(b.length / 2)); };
  const writer = (real, exclusive) => (p, d) => {
    const inLs = path.dirname(p) === ls && p.endsWith('.patch');
    const inStaged = path.dirname(p) === staged;
    if (s.existingPatch && p === s.existingPatch && has('restore-earlier')) throw boom('restore-earlier');
    if (path.basename(p) === 'manifest.json' && has('manifest')) throw boom('manifest');
    for (const [where, n] of [[inLs, 'patch-write'], [inStaged, 'staged-write']]) {
      if (!where) continue;
      if (has(n)) throw boom(n);
      if (has(`${n}-partial`) && !(exclusive && fs.existsSync(p))) {
        fs.writeFileSync(p, half(d));
        throw boom(`${n}-partial`);
      }
    }
    return real(p, d);
  };
  let diffs = 0;
  return {
    ...baseDeps,
    git: (a, o) => {
      if (a.includes('--binary') && ++diffs === 2 && has('re-diff')) throw boom('re-diff');
      if (a.includes('checkout') && has('checkout')) throw boom('checkout');
      if (a.includes('rm') && a.includes('--cached') && has('rm-cached')) throw boom('rm-cached');
      if (a.includes('apply')) {
        if (a.includes('--check')) { if (has('gate')) throw boom('gate'); }
        else if (a.includes('-R')) { if (has('reverse-apply')) throw boom('reverse-apply'); }
        else if (a[a.length - 1] === '-') { if (has('re-apply')) throw boom('re-apply'); }
        else if (has('join-apply')) throw boom('join-apply');
      }
      return realDeps.git(a, o);
    },
    writeFile: writer(realDeps.writeFile, false),
    writeFileExclusive: writer(realDeps.writeFileExclusive, true),
    unlink: (p) => { if (p === abs && has('unlink')) throw boom('unlink'); return realDeps.unlink(p); },
    rename: (a, b) => { if (has('promote')) throw boom('promote'); return realDeps.rename(a, b); },
  };
}

// Every invariant breach for one finished run, as text ([] = sound).
function breaches(s, res, err) {
  const out = [];
  const abs = path.join(s.f.repo, s.target);
  const ls = path.join(s.f.runDir, 'learned-skills');
  const stagedDir = path.join(s.f.runDir, 'staged');
  const list = (d) => (fs.existsSync(d) ? fs.readdirSync(d) : []);
  const bytes = (p) => (fs.existsSync(p) ? fs.readFileSync(p) : null);
  const diffBlock = (p) => { const b = fs.readFileSync(p); const i = b.indexOf('diff --git'); return i < 0 ? null : b.subarray(i); };
  const eq = (a, b) => a !== null && b !== null && a.equals(b);
  const tree = bytes(abs);
  let manifest = [];
  try { manifest = readManifest(s.f.runDir); } catch (e) { out.push(`manifest unreadable: ${e.message}`); }
  const earlier = s.joined ? manifest.find((e) => e.id === '1') : null;
  const earlierBytes = s.joined ? bytes(s.existingPatch) : null;
  // In a join whose earlier capture still holds the earlier edit alone, this call answers for its own edit.
  const split = Boolean(s.joined && earlier && earlier.status === 'captured' && eq(earlierBytes, s.P1));
  const want = split ? s.D : s.C;
  const holdsFile = (p) => eq(bytes(p), want) || eq(bytes(p), s.C);
  const holdsStaged = (p) => fs.existsSync(p) && (eq(diffBlock(p), want) || eq(diffBlock(p), s.C));
  const treeHolds = eq(tree, s.full) || (split && eq(tree, s.start));
  const lsFiles = list(ls).filter((n) => n !== 'manifest.json').map((n) => path.join(ls, n));
  const stagedFiles = list(stagedDir).map((n) => path.join(stagedDir, n));

  // (a) a durable place holds the whole change.
  if (!(treeHolds || lsFiles.some(holdsFile) || stagedFiles.some(holdsStaged))) out.push('(a) no durable place holds the whole change');
  if (s.joined && !(eq(earlierBytes, s.P1) || eq(earlierBytes, s.C))) out.push('(a) the earlier captured patch file was damaged');

  // (b) the outcome names a place that holds it.
  if (err) {
    if (!(err instanceof StagingFailure)) out.push(`(b) threw a non-StagingFailure: ${err.message}`);
    else if (err.holder === 'tree') {
      if (!/in the working tree/.test(err.message)) out.push('(b) holder tree, but the message does not say so');
      if (!(eq(tree, s.start) || (s.joined && eq(tree, s.full)))) out.push('(b) message names the tree, which does not hold the edit');
      if (err.restored !== true) out.push('(b) holder tree but restored is not true');
    } else if (typeof err.holder === 'string') {
      if (!err.message.includes(err.holder)) out.push('(b) the holder path is not in the message');
      if (!holdsFile(err.holder)) out.push(`(b) the named file does not hold the edit: ${err.holder}`);
    } else {
      out.push(`(b) the error names no holder: ${err.message}`);
    }
  } else if (res.route === 'captured') {
    if (!eq(bytes(res.patch), s.C)) out.push('(b) captured, but the patch does not hold the whole change');
    if (s.joined && res.patch !== s.existingPatch) out.push('(b) a joined capture moved to a new patch file');
    if (s.headBytes === null ? tree !== null : !eq(tree, s.headBytes)) out.push('(b) captured, but the tree is not back at HEAD');
  } else if (res.route === 'staged') {
    if (res.patch) { if (!holdsFile(res.patch)) out.push('(b) staged result names a patch that does not hold the edit'); }
    else if (!holdsStaged(res.stagePath)) out.push('(b) the staged file named does not hold the edit');
  } else {
    out.push(`(b) unexpected route ${res.route}`);
  }

  // (c) no partial or duplicate proposal in staged/.
  if (err || (res && res.route === 'captured')) {
    if (stagedFiles.length) out.push(`(c) staged/ is not empty: ${stagedFiles.map((p) => path.basename(p)).join(', ')}`);
  } else if (res && res.route === 'staged') {
    if (stagedFiles.length !== 1 || stagedFiles[0] !== res.stagePath) out.push(`(c) staged/ holds ${stagedFiles.length} files`);
    for (const p of stagedFiles) {
      const block = diffBlock(p);
      if (block === null ? !res.patch : !holdsStaged(p)) out.push(`(c) partial proposal ${path.basename(p)}`);
    }
  }
  if (split && stagedFiles.some((p) => eq(diffBlock(p), s.C))) out.push('(c) the earlier edit is both captured and staged');

  // No unnamed copy left in learned-skills/ (no new pending pile).
  const named = new Set([...manifest.map((e) => e.patch), res && res.patch, err && err.holder].filter(Boolean));
  for (const p of lsFiles) if (!named.has(p)) out.push(`unnamed leftover ${path.basename(p)}`);
  if (sh(s.f.repo, ['rev-parse', 'HEAD']).trim() !== s.head) out.push('a commit was made');
  return out;
}

function runMatrix(t, kind, list) {
  const fired = new Set();
  const red = [];
  for (const faults of list) {
    const s = scenario(t, kind);
    let res;
    let err;
    try { res = capture(args(s.f, s.target, 'second finding'), faultyDeps(s, faults, fired)); } catch (e) { err = e; }
    const b = breaches(s, res, err);
    if (b.length) red.push(`${kind} [${faults.join(', ') || 'no faults'}]: ${b.join('; ')}`);
  }
  return { red, fired };
}

for (const kind of Object.keys(POINTS)) {
  test(`fault matrix (${kind}): no fault, every single and every pair`, (t) => {
    const P = POINTS[kind];
    const { red, fired } = runMatrix(t, kind, [[], ...combos(P, 1), ...combos(P, 2)]);
    assert.deepEqual(red, []);
    // Every point is reached by some single or pair, so the matrix exercises it — except the
    // re-apply (reached only once staging has failed too: the triples) and the earlier-patch restore.
    assert.deepEqual(P.filter((p) => !fired.has(p) && p !== 're-apply' && p !== 'restore-earlier'), [], 'fault points that never fired');
    // The earlier captured patch is never rewritten in place: that step no longer exists.
    assert.equal(fired.has('restore-earlier'), false);
  });
  test(`fault matrix (${kind}): named chains, sampled triples and four-way faults`, (t) => {
    const P = POINTS[kind];
    const { red, fired } = runMatrix(t, kind, [...CHAINS[kind], ...sample(combos(P, 3), 20, 5290), ...sample(combos(P, 4), 12, 4)]);
    assert.deepEqual(red, []);
    assert.ok(fired.has('re-apply'), 'the re-apply fault fired');
    assert.equal(fired.has('restore-earlier'), false);
  });
}

test('a tree holding some other change is not read as holding the edit', (t) => {
  const f = fixture(t);
  const original = fs.readFileSync(path.join(f.repo, X), 'utf8');
  write(f.repo, X, original + 'the captured edit\n');
  // checkout leaves a different, non-empty change in the tree; staging fails too.
  const deps = {
    ...baseDeps,
    git: (a, o) => {
      if (a.includes('checkout')) { write(f.repo, X, original + 'someone else\n'); return ''; }
      return realDeps.git(a, o);
    },
    mkdir: failMkdirStaged,
  };
  let caught;
  try { capture(args(f, X), deps); } catch (e) { caught = e; }
  assert.ok(caught instanceof StagingFailure);
  assert.equal(caught.restored, false);
  assert.doesNotMatch(caught.message, /in the working tree \(/);
  assert.ok(caught.message.includes(caught.holder), caught.message);
  assert.match(fs.readFileSync(caught.holder, 'utf8'), /\+the captured edit/);
});

test('a joined tree that holds both edits is reported as holding both', (t) => {
  const f = fixture(t);
  const body = fs.readFileSync(path.join(f.repo, X), 'utf8');
  write(f.repo, X, TOP(body));
  const first = capture(args(f, X, 'first finding'), baseDeps);
  write(f.repo, X, BOTTOM(body));
  let diffs = 0;
  const deps = {
    ...baseDeps,
    git: (a, o) => {
      if (a.includes('--binary') && ++diffs === 2) throw new Error('simulated re-diff failure');
      if (a.includes('apply') && a.includes('-R')) throw new Error('simulated undo failure');
      return realDeps.git(a, o);
    },
  };
  let caught;
  try { capture(args(f, X, 'second finding'), deps); } catch (e) { caught = e; }
  assert.ok(caught instanceof StagingFailure);
  assert.equal(caught.restored, true);
  assert.equal(caught.holder, 'tree');
  assert.match(caught.message, /in the working tree together with the earlier captured patch 1/);
  assert.equal(fs.readFileSync(path.join(f.repo, X), 'utf8'), BOTTOM(TOP(body)));
  assert.equal(readManifest(f.runDir)[0].status, 'captured');
  assert.match(fs.readFileSync(first.patch, 'utf8'), /first edit near the top/);
});
