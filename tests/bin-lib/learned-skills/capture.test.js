'use strict';
// learned-skills-pr capture (#5290): a Skills-row edit leaves the run branch as a patch in the run dir.
// The fault matrix runs from the capture-matrix-*.test.js files beside this one.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { capture, stageEntry, readManifest, realDeps } = require('../../../plugin/bin/lib/learned-skills/learned-skills.js');
const cli = require('../../../plugin/bin/learned-skills-pr.js');
const {
  X, sh, write, fixture, status, args, baseDeps, diffOf, TOP, BOTTOM,
} = require('../../helpers/learned-skills-capture.js');

function recorder() {
  const calls = [];
  const deps = {
    git: (args, opts) => { calls.push(args); return realDeps.git(args, opts); },
    now: () => Date.UTC(2026, 10, 13, 12, 0, 0),
  };
  return { calls, deps };
}

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

// I1 (final review): every finding a capture absorbs is recorded on its entry, so land can log each.
test('a shared capture appends its own row and summary to the entry, once', (t) => {
  const f = fixture(t);
  const body = fs.readFileSync(path.join(f.repo, X), 'utf8');
  write(f.repo, X, BOTTOM(body));
  capture(args(f, X, 'first finding'));
  const findingsOf = () => readManifest(f.runDir)[0].findings;
  assert.deepEqual(findingsOf(), [{ row: 'skills', summary: 'first finding' }]);
  write(f.repo, X, TOP(body));
  const joined = capture(args(f, X, 'second finding'));
  assert.deepEqual(joined, { route: 'captured', id: '1', patch: joined.patch, shared: true }, 'the join route');
  const clean = capture({ ...args(f, X, 'repairs a link'), row: 'references' });
  assert.equal(clean.shared, true, 'the clean route');
  capture({ ...args(f, X, 'repairs a link'), row: 'references' });
  assert.deepEqual(findingsOf(), [
    { row: 'skills', summary: 'first finding' },
    { row: 'skills', summary: 'second finding' },
    { row: 'references', summary: 'repairs a link' },
  ], 'a repeated finding is not added twice');
  assert.equal(readManifest(f.runDir)[0].summary, 'first finding', 'the entry keeps its first summary');
  assert.throws(() => capture({ ...args(f, X), row: 'no-such-row' }), /row must be a wrap-up registry row id/);
});

test('a shared capture whose manifest write fails says so and keeps the patch', (t) => {
  const f = fixture(t);
  write(f.repo, X, fs.readFileSync(path.join(f.repo, X), 'utf8') + 'one\n');
  const first = capture(args(f, X));
  const res = capture(args(f, X, 'a second finding'), {
    ...baseDeps,
    writeFile: (p, d) => { if (p.endsWith('manifest.json')) throw new Error('disk full'); return realDeps.writeFile(p, d); },
  });
  assert.deepEqual(res, { route: 'captured', id: '1', patch: first.patch, shared: true, manifestFailed: true });
  assert.equal(readManifest(f.runDir)[0].findings.length, 1);
});

// M1 (final review): a re-run pass re-proposes an edit already captured. The tree then holds the
// earlier edit, so the join's `git apply` of the earlier patch fails; before the fix this edit was
// staged beside the captured one and delivered twice.
const stagedFiles = (f) => (fs.existsSync(path.join(f.runDir, 'staged')) ? fs.readdirSync(path.join(f.runDir, 'staged')) : []);

test('the same edit captured again replaces the patch as a shared join and stages nothing', (t) => {
  const f = fixture(t);
  const body = fs.readFileSync(path.join(f.repo, X), 'utf8');
  write(f.repo, X, BOTTOM(body));
  const first = capture(args(f, X, 'first finding'));
  const earlier = fs.readFileSync(first.patch);
  write(f.repo, X, BOTTOM(body));
  const again = capture(args(f, X, 'first finding'));
  assert.deepEqual(again, { route: 'captured', id: '1', patch: first.patch, shared: true });
  assert.ok(fs.readFileSync(first.patch).equals(earlier), 'the patch holds the one edit');
  assert.deepEqual(readManifest(f.runDir).map((e) => [e.id, e.status]), [['1', 'captured']]);
  assert.deepEqual(stagedFiles(f), []);
  assert.equal(status(f.repo, X), '');

  // The earlier edit plus a new one: the new diff is the whole change.
  write(f.repo, X, TOP(BOTTOM(body)));
  const more = capture(args(f, X, 'second finding'));
  assert.equal(more.shared, true);
  const patch = fs.readFileSync(first.patch, 'utf8');
  assert.match(patch, /first edit near the top/);
  assert.match(patch, /second edit at the bottom/);
  sh(f.repo, ['apply', '--check', first.patch]);
  assert.deepEqual(readManifest(f.runDir).map((e) => [e.id, e.status]), [['1', 'captured']]);
  assert.equal(readManifest(f.runDir)[0].findings.length, 2);
  assert.deepEqual(stagedFiles(f), []);
  assert.equal(fs.readFileSync(path.join(f.repo, X), 'utf8'), body);
});

test('a new file captured again is joined the same way', (t) => {
  const f = fixture(t);
  const y = '.claude/skills/y/SKILL.md';
  write(f.repo, y, '# y\n\nbrand new\n');
  const first = capture(args(f, y));
  write(f.repo, y, '# y\n\nbrand new\n');
  const again = capture(args(f, y));
  assert.deepEqual(again, { route: 'captured', id: '1', patch: first.patch, shared: true });
  assert.deepEqual(stagedFiles(f), []);
  assert.equal(fs.existsSync(path.join(f.repo, y)), false);
  assert.equal(status(f.repo, y), '');
});

test('a failed re-capture of an edit the patch already holds is not staged beside it', (t) => {
  const f = fixture(t);
  const body = fs.readFileSync(path.join(f.repo, X), 'utf8');
  write(f.repo, X, BOTTOM(body));
  const first = capture(args(f, X, 'first finding'));
  const earlier = fs.readFileSync(first.patch);
  write(f.repo, X, TOP(BOTTOM(body)));
  const noCheckout = (a, o) => {
    if (a.includes('checkout')) throw new Error('simulated checkout failure');
    return realDeps.git(a, o);
  };
  let caught;
  try { capture(args(f, X, 'second finding'), { ...baseDeps, git: noCheckout }); } catch (e) { caught = e; }
  assert.ok(caught && caught.name === 'Error' && caught.holder === 'tree' && caught.restored === true, `staging this diff would schedule the earlier edit twice (${caught && caught.message})`);
  assert.equal(caught.holder, 'tree');
  assert.match(caught.message, /still in the working tree/);
  assert.equal(fs.readFileSync(path.join(f.repo, X), 'utf8'), TOP(BOTTOM(body)), 'the tree keeps both edits, to commit on the run branch');
  assert.deepEqual(stagedFiles(f), []);
  assert.deepEqual(readManifest(f.runDir).map((e) => [e.id, e.status]), [['1', 'captured']]);
  assert.ok(fs.readFileSync(first.patch).equals(earlier));
});

test('CLI capture passes --row through', (t) => {
  const f = fixture(t);
  write(f.repo, X, fs.readFileSync(path.join(f.repo, X), 'utf8') + 'cli edit\n');
  const summaryFile = path.join(f.repo, 'summary.txt');
  fs.writeFileSync(summaryFile, 'repairs a link\n');
  const code = cli.run(['capture', '--run', f.runDir, '--worktree', f.repo, '--merge-base', f.mergeBase, '--target', X, '--summary-file', summaryFile, '--row', 'references'], {
    stdout: () => {}, stderr: () => {}, mainRoot: f.repo,
  });
  assert.equal(code, 0);
  assert.deepEqual(readManifest(f.runDir)[0].findings, [{ row: 'references', summary: 'repairs a link' }]);
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
const failCheckout = (a, o) => {
  if (a.includes('checkout')) throw new Error('simulated checkout failure');
  return realDeps.git(a, o);
};

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

// --- fix round 5 ---------------------------------------------------------------------------------

const failPatchCopy = (p, d) => {
  if (p.endsWith('.patch')) throw Object.assign(new Error('ENOSPC: patch copy'), { code: 'ENOSPC' });
  return realDeps.writeFileExclusive(p, d);
};

test('a kept diff whose gate ran and failed is logged as that, not as unvalidated', (t) => {
  const f = fixture(t);
  write(f.repo, X, fs.readFileSync(path.join(f.repo, X), 'utf8') + 'edit\n');
  const diff = diffOf(f.repo, X);
  const res = capture(args(f, X), {
    ...baseDeps,
    writeFileExclusive: failPatchCopy,
    git: (a, o) => {
      if (a.includes('apply') && (a.includes('--check') || (a[a.length - 1] === '-' && !a.includes('-R')))) throw new Error('simulated apply failure');
      return realDeps.git(a, o);
    },
  });
  assert.equal(res.route, 'staged');
  const text = fs.readFileSync(res.stagePath, 'utf8');
  assert.equal(text.slice(text.indexOf('diff --git')), diff);
  const log = fs.readFileSync(path.join(f.runDir, 'decisions.md'), 'utf8');
  assert.match(log, /- STAGED \d\d:\d\d:\d\d — Skills row: x\/SKILL\.md \(adds a note\) — patch failed `git apply --check` at staging \(.+\); kept the diff at staged\/wrap-up-skill-1\.md, not description-only: it is the edit's only copy and the working tree could not take it back\. Reversibility: high\.$/m);
  assert.doesNotMatch(log, /gate could not run|unvalidated/);
});

test('a kept diff whose gate never ran is logged as not run', (t) => {
  const f = fixture(t);
  const original = fs.readFileSync(path.join(f.repo, X), 'utf8');
  write(f.repo, X, original + 'edit\n');
  const res = capture(args(f, X), {
    ...baseDeps,
    writeFileExclusive: failPatchCopy,
    git: (a, o) => {
      if (a.includes('apply') && a.includes('-R')) throw new Error('simulated reverse failure');
      if (a.includes('checkout')) { write(f.repo, X, original + 'someone else\n'); return ''; }
      return realDeps.git(a, o);
    },
  });
  assert.equal(res.route, 'staged');
  assert.equal(res.residue, true);
  assert.match(fs.readFileSync(res.stagePath, 'utf8'), /\+edit/);
  const log = fs.readFileSync(path.join(f.runDir, 'decisions.md'), 'utf8');
  assert.match(log, /— gate not run \(the working tree could not be reset to HEAD\); kept the diff unchecked at staged\/wrap-up-skill-1\.md: it is the edit's only copy\. Reversibility: high\.$/m);
  assert.doesNotMatch(log, /gate could not run|unvalidated/);
});

// A joined capture whose re-diff fails; `deps` adds faults on top. Returns what the tests compare.
function joinedReDiffFails(t, extra = () => ({})) {
  const f = fixture(t);
  const body = fs.readFileSync(path.join(f.repo, X), 'utf8');
  write(f.repo, X, TOP(body));
  const first = capture(args(f, X, 'first finding'), baseDeps);
  const earlier = fs.readFileSync(first.patch);
  write(f.repo, X, BOTTOM(body));
  const D = diffOf(f.repo, X);
  const abs = path.join(f.repo, X);
  const state = { blind: false };
  let diffs = 0;
  const more = extra({ f, abs, state, first });
  const deps = {
    ...baseDeps,
    ...more,
    git: (a, o) => {
      if (a.includes('--binary') && ++diffs === 2) { state.blind = true; throw new Error('simulated re-diff failure'); }
      return (more.git || realDeps.git)(a, o);
    },
  };
  let res;
  let caught;
  try { res = capture(args(f, X, 'second finding'), deps); } catch (e) { caught = e; }
  return { f, body, first, earlier, D, abs, res, caught };
}
const blindRead = ({ abs, state }) => ({
  readFile: (p) => {
    if (state.blind && p === abs) throw Object.assign(new Error('EIO: read'), { code: 'EIO' });
    return realDeps.readFile(p);
  },
});
const stagedDiff = (p) => { const s = fs.readFileSync(p, 'utf8'); return s.slice(s.indexOf('diff --git')); };

test('a join whose tree cannot be read back stages this edit from a confirmed copy, never claiming the tree', (t) => {
  const r = joinedReDiffFails(t, blindRead);
  assert.equal(r.caught, undefined, r.caught && r.caught.message);
  assert.equal(r.res.route, 'staged');
  assert.match(r.res.reason, /the join was undone, and the working tree could not be read back \(EIO: read\)/);
  assert.doesNotMatch(r.res.reason, /holds neither/);
  assert.equal(stagedDiff(r.res.stagePath), r.D);
  assert.deepEqual(readManifest(r.f.runDir).map((e) => [e.id, e.status]), [['1', 'captured'], ['2', 'staged']]);
  assert.ok(fs.readFileSync(r.first.patch).equals(r.earlier), 'the earlier patch file is untouched');
  assert.equal(fs.readFileSync(r.abs, 'utf8'), r.body, 'the tree was reset only after a copy was confirmed');
});

test('a join whose tree cannot be read back and whose patch copy fails is homed in a confirmed staged file', (t) => {
  const r = joinedReDiffFails(t, (ctx) => ({ ...blindRead(ctx), writeFileExclusive: failPatchCopy }));
  assert.equal(r.caught, undefined, r.caught && r.caught.message);
  assert.equal(r.res.route, 'staged');
  assert.equal(r.res.patch, undefined);
  assert.equal(stagedDiff(r.res.stagePath), r.D);
  assert.deepEqual(fs.readdirSync(path.join(r.f.runDir, 'learned-skills')).filter((n) => n.endsWith('.patch')), ['1.patch']);
});

test('with no copy confirmable and the tree unreadable, no holder is claimed and the unreset tree is named', (t) => {
  const r = joinedReDiffFails(t, (ctx) => ({ ...blindRead(ctx), writeFileExclusive: () => { throw Object.assign(new Error('ENOSPC'), { code: 'ENOSPC' }); } }));
  assert.ok(r.caught instanceof StagingFailure, r.res && JSON.stringify(r.res));
  assert.equal(r.caught.holder, null);
  assert.equal(r.caught.restored, false);
  assert.match(r.caught.message, /the working tree was not reset, so it is the place left that should hold the edit, but a read could not confirm it/);
  assert.doesNotMatch(r.caught.message, /in the working tree \(|together with the earlier captured patch/);
  // The invariant held: the tree, untouched, still holds this edit alone.
  assert.equal(fs.readFileSync(r.abs, 'utf8'), BOTTOM(r.body));
  assert.equal(fs.existsSync(path.join(r.f.runDir, 'staged')) ? fs.readdirSync(path.join(r.f.runDir, 'staged')).length : 0, 0);
});

test('a join whose tree reads back as neither expected state says so, not that it could not be read', (t) => {
  const r = joinedReDiffFails(t, ({ f, first }) => ({
    git: (a, o) => {
      // The undo of the join "succeeds" but leaves something else in the file.
      if (a.includes('apply') && a.includes('-R') && !a.includes('--check') && a[a.length - 1] === first.patch) {
        write(f.repo, X, '# x\n\nsomething else\n');
        return '';
      }
      return realDeps.git(a, o);
    },
  }));
  assert.equal(r.caught, undefined, r.caught && r.caught.message);
  assert.equal(r.res.route, 'staged');
  assert.match(r.res.reason, /the join was undone, and the working tree holds neither this edit alone nor both edits/);
  assert.doesNotMatch(r.res.reason, /could not be read back/);
  assert.equal(stagedDiff(r.res.stagePath), r.D);
  assert.ok(fs.readFileSync(r.first.patch).equals(r.earlier));
});

test('stageEntry recomposes from the patch file once and passes the gate on the recomposed diff', (t) => {
  const f = fixture(t);
  write(f.repo, X, fs.readFileSync(path.join(f.repo, X), 'utf8') + 'recompose edit\n');
  const diff = diffOf(f.repo, X);
  sh(f.repo, ['checkout', 'HEAD', '--', X]);
  const patchFile = path.join(f.runDir, 'good.patch');
  fs.writeFileSync(patchFile, diff);
  const res = stageEntry({
    runDir: f.runDir, worktree: f.repo, entry: { target: X, summary: 'recompose', patch: 'not a patch\n', patchFile }, reason: 'r',
  }, baseDeps);
  assert.equal(res.gate, 'ok');
  assert.equal(stagedDiff(res.stagePath), diff);
  assert.match(fs.readFileSync(path.join(f.runDir, 'decisions.md'), 'utf8'), /staged instead\. Reversibility: high \(stage path: staged\/wrap-up-skill-1\.md\)\./);
});
