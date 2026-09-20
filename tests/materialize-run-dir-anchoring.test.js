// tests/materialize-run-dir-anchoring.test.js
//
// #790: bin/materialize.js's --run-dir had zero validation before
// deps.mkdirp(workDir)/deps.writeFile(outFile, ...) — the same [IL-127] gap
// as bin/hooks.js and bin/wrap-up-engine.js. run(argv, deps) is directly
// callable (deps-injected, per its own header comment: "All I/O through deps
// so tests never touch gh, git, or the filesystem") — these tests exercise
// it in-process against real gitRepo()/linkedWorktreeOf() fixtures, chdir'd
// per test, with deps stubbed to prove the anchoring check runs BEFORE any
// gh/network call: a rejection must never reach deps.ghAvailable.
//
// #959: a --run-dir resolving INSIDE a linked worktree is no longer an
// unconditional rejection — this CLI only ever writes to the documented
// worktree-local exception (work/{n}-spec.md), so the check now accepts
// "anchored under the main checkout" OR "inside a linked worktree", and
// rejects only a --run-dir that is neither (e.g. a foreign checkout, or
// nowhere near any git repo).
//
// #1210: neither check above asks whether the --run-dir points at cwd's OWN
// worktree — "anchored under the main checkout" doesn't distinguish "no
// worktree involved, this is correct" from the silent stray-write mismatch
// materialize.md's own worktree-first-ordering prose warns against, and
// "inside a linked worktree" never compared WHICH one. When cwd is inside a
// linked worktree AND --run-dir resolves elsewhere (the main checkout, or a
// different worktree), the write target is now rewritten to cwd's own
// worktree-local equivalent (never a rejection — AC #1's "either...or") —
// see the #1210-tagged cases below.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { gitRepo, linkedWorktreeOf } = require('./helpers/git-fixtures');
const wtDetect = require('../plugin/bin/lib/hooks/worktree-detect');
const { run } = require('../plugin/bin/materialize');

function withCwd(dir, fn) {
  const prev = process.cwd();
  process.chdir(dir);
  try { return fn(); } finally { process.chdir(prev); }
}

// A path's own linked-worktree root, or null when it is the main checkout (or
// membership can't be determined) — the real thing, mirroring realDeps'
// cwdWorktreeRoot/runDirWorktreeRoot, which share this one shape.
function worktreeRootOf(somePath) {
  const info = wtDetect.repoInfo(somePath);
  return info.isLinkedWorktree ? info.repoRoot : null;
}

function fakeDeps(overrides = {}) {
  const calls = { ghAvailable: 0, stderr: [] };
  return {
    calls,
    ghAvailable: () => { calls.ghAvailable += 1; return false; }, // stop right after, if reached
    ghView: () => { throw new Error('ghView should never be called in these tests'); },
    remoteUrl: () => { throw new Error('remoteUrl should never be called in these tests'); },
    // #790 Finding 1: cwd/mainRoot now come through deps, mirroring
    // bin/release-claim.js's seam — the default here is the real thing
    // (chdir'd per test below), same as realDeps, so these tests still
    // exercise real gitRepo()/linkedWorktreeOf() fixtures end to end.
    cwd: () => process.cwd(),
    mainRoot: (cwd) => wtDetect.mainCheckoutRoot(cwd),
    isAnchored: (resolvedPath, mainRoot) => wtDetect.isAnchoredUnderRoot(resolvedPath, mainRoot),
    isInsideLinkedWorktree: (resolvedPath) => wtDetect.repoInfo(resolvedPath).isLinkedWorktree,
    cwdWorktreeRoot: (cwd) => worktreeRootOf(cwd),
    runDirWorktreeRoot: (resolvedPath) => worktreeRootOf(resolvedPath),
    mkdirp: () => { throw new Error('mkdirp should never be called when --run-dir is rejected'); },
    writeFile: () => { throw new Error('writeFile should never be called when --run-dir is rejected'); },
    stdout: () => {},
    stderr: (s) => { calls.stderr.push(s); },
    ...overrides,
  };
}

const SHAPED_BODY = [
  'Surface: backend',
  '',
  '## Current State',
  'Some current state text.',
  '',
  '## Deliverables',
  '- [ ] do a thing',
  '',
  '## Acceptance Criteria',
  '1. It works',
  '',
  '## Release Note',
  'Fixed the thing.',
].join('\n');

// The #1210 end-to-end cases below drive the rewrite through a real
// mkdirp/writeFile — so unlike fakeDeps (whose fs/gh members are
// "must never be called" tripwires) these deps actually resolve a record and
// write the file. Everything but the collected stdout/stderr is identical
// across those cases; only cwd and the --run-dir under test differ.
function writingDeps(stdout, stderr) {
  return {
    ghAvailable: () => true,
    ghView: () => JSON.stringify({
      number: 1,
      title: 'Test record',
      body: SHAPED_BODY,
      labels: [{ name: 'ceremony:standard' }],
      url: 'https://example.invalid/1',
    }),
    remoteUrl: () => { throw new Error('remoteUrl should never be called when --repo is passed explicitly'); },
    gitRevListCount: () => { throw new Error('should not be called — no Verified-as-of stamp on this record'); },
    gitCommitDate: () => { throw new Error('should not be called — no Verified-as-of stamp on this record'); },
    cwd: () => process.cwd(),
    mainRoot: (cwd) => wtDetect.mainCheckoutRoot(cwd),
    isAnchored: (resolvedPath, mainRoot) => wtDetect.isAnchoredUnderRoot(resolvedPath, mainRoot),
    isInsideLinkedWorktree: (resolvedPath) => wtDetect.repoInfo(resolvedPath).isLinkedWorktree,
    cwdWorktreeRoot: (cwd) => worktreeRootOf(cwd),
    runDirWorktreeRoot: (resolvedPath) => worktreeRootOf(resolvedPath),
    mkdirp: (dir) => fs.mkdirSync(dir, { recursive: true }),
    writeFile: (file, content) => fs.writeFileSync(file, content),
    stdout: (s) => stdout.push(s),
    stderr: (s) => stderr.push(s),
  };
}

// #1138: an empty or whitespace-only --run-dir value must be rejected at
// parse time, before ghAvailable or any anchoring check runs — matching the
// existing "missing required --run-dir" treatment of a genuinely absent one.
test('#1138 reject: empty --run-dir value never reaches ghAvailable or the anchoring check', () => {
  const main = gitRepo();
  const deps = fakeDeps();
  const code = withCwd(main, () => run(['1', '--run-dir', ''], deps));
  assert.strictEqual(code, 2);
  assert.match(deps.calls.stderr.join(''), /missing required --run-dir/);
  assert.strictEqual(deps.calls.ghAvailable, 0, 'must never reach the gh-availability check with a blank --run-dir');
});

test('#1138 reject: whitespace-only --run-dir value degrades the same as empty', () => {
  const main = gitRepo();
  const deps = fakeDeps();
  const code = withCwd(main, () => run(['1', '--run-dir', '   '], deps));
  assert.strictEqual(code, 2);
  assert.match(deps.calls.stderr.join(''), /missing required --run-dir/);
  assert.strictEqual(deps.calls.ghAvailable, 0);
});

test('#959 accept: --run-dir is a bare-relative path resolving inside the linked worktree', () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  const deps = fakeDeps();
  const code = withCwd(wt, () => run(['1', '--run-dir', path.join('.claude-tweaks', 'pipelines', 'x')], deps));
  // Rejected downstream by the stubbed ghAvailable()=false, NOT by anchoring.
  assert.strictEqual(code, 2);
  assert.doesNotMatch(deps.calls.stderr.join(''), /resolves outside the main checkout/i);
  assert.strictEqual(deps.calls.ghAvailable, 1, 'a worktree-relative --run-dir must now reach the gh-availability check');
});

test('#959 accept: --run-dir is absolute and resolves inside the linked worktree', () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  const deps = fakeDeps();
  const abs = path.join(wt, '.claude-tweaks', 'pipelines', 'x');
  const code = withCwd(wt, () => run(['1', '--run-dir', abs], deps));
  assert.strictEqual(code, 2);
  assert.doesNotMatch(deps.calls.stderr.join(''), /resolves outside the main checkout/i);
  assert.strictEqual(deps.calls.ghAvailable, 1, 'a worktree-relative --run-dir must now reach the gh-availability check');
});

test('#959 reject: --run-dir resolves inside a DIFFERENT git checkout (foreign repo, not the main checkout or its own worktree)', () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  const foreign = gitRepo();
  const deps = fakeDeps();
  const abs = path.join(foreign, '.claude-tweaks', 'pipelines', 'x');
  const code = withCwd(wt, () => run(['1', '--run-dir', abs], deps));
  assert.strictEqual(code, 2);
  assert.match(deps.calls.stderr.join(''), /resolves outside the main checkout/i);
  assert.strictEqual(deps.calls.ghAvailable, 0, 'a foreign checkout must still be rejected, not just "not the main checkout"');
});

test('accept: --run-dir is absolute and anchored under the main checkout (cwd NOT a worktree)', () => {
  const main = gitRepo();
  const deps = fakeDeps();
  const abs = path.join(main, '.claude-tweaks', 'pipelines', 'x');
  const code = withCwd(main, () => run(['1', '--run-dir', abs], deps));
  // Rejected downstream by the stubbed ghAvailable()=false, NOT by anchoring.
  assert.strictEqual(code, 2);
  assert.doesNotMatch(deps.calls.stderr.join(''), /resolves outside the main checkout/i);
  assert.doesNotMatch(deps.calls.stderr.join(''), /worktree-local equivalent/i, 'no worktree involved — must not fire the #1210 rewrite note');
  assert.strictEqual(deps.calls.ghAvailable, 1, 'a correctly anchored --run-dir must reach the gh-availability check');
});

// #1210: materialize.js accepted a main-checkout-anchored --run-dir
// unconditionally whenever it resolved to a real git root — including when
// cwd was itself inside a linked worktree, which is exactly the case
// materialize.md's own worktree-first-ordering prose warns against (a
// caller following the ordinary $PIPELINE_RUN_DIR convention got a silent,
// exit-0 "success" that actually wrote into the main checkout). These cases
// pin that the mismatch is now caught: either the write target is rewritten
// to the worktree-local equivalent (this suite drives the fix end to end
// through a real mkdirp/writeFile, unlike the stubbed-ghAvailable cases
// above), or a caller must never observe a file materialize under the main
// checkout.
test('#1210 accept+rewrite: cwd inside a linked worktree + --run-dir anchored to the main checkout fires the rewrite note before gh work', () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  const deps = fakeDeps();
  const abs = path.join(main, '.claude-tweaks', 'pipelines', 'x');
  const code = withCwd(wt, () => run(['1', '--run-dir', abs], deps));
  // Rejected downstream by the stubbed ghAvailable()=false, NOT by anchoring — the
  // #1210 guard rewrites opts.runDir and lets the run proceed, same as #959's
  // existing "accept" cases; it never itself returns non-zero.
  assert.strictEqual(code, 2);
  assert.doesNotMatch(deps.calls.stderr.join(''), /resolves outside the main checkout/i);
  assert.match(deps.calls.stderr.join(''), /resolves to the main checkout/i);
  assert.match(deps.calls.stderr.join(''), /worktree-local equivalent/i);
  assert.match(deps.calls.stderr.join(''), new RegExp(wt.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), 'the note must name the worktree root');
  assert.strictEqual(deps.calls.ghAvailable, 1, 'a rewritten --run-dir must still reach the gh-availability check, not stop as a rejection');
});

test('#1210 end-to-end: cwd inside a linked worktree + --run-dir anchored to the main checkout writes the spec file INSIDE the worktree, never the main checkout', () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  const abs = path.join(main, '.claude-tweaks', 'pipelines', 'x');
  const stdout = [];
  const stderr = [];
  const deps = writingDeps(stdout, stderr);
  const code = withCwd(wt, () => run(['1', '--run-dir', abs, '--repo', 'owner/repo'], deps));
  assert.strictEqual(code, 0, stderr.join(''));
  const envelope = JSON.parse(stdout.join(''));
  assert.ok(
    envelope.file.startsWith(wt + path.sep),
    `expected the written file to be under the worktree (${wt}), got ${envelope.file}`,
  );
  assert.ok(fs.existsSync(envelope.file), 'the reported file path must actually exist on disk');
  const mainShadowFile = path.join(main, '.claude-tweaks', 'pipelines', 'x', 'work', '1-spec.md');
  assert.ok(!fs.existsSync(mainShadowFile), 'must never have written the spec file into the main checkout');
});

// #1210 follow-up (review finding): #959's "accept whenever --run-dir
// resolves inside ANY linked worktree" never compared WHICH worktree — a
// --run-dir resolving inside a DIFFERENT linked worktree than cwd's own
// passed the #959 check unconditionally and, before this fix, the #1210
// rewrite block never fired either (it only handled anchoredToMain). That
// combination silently wrote the spec file into an unrelated worktree's
// tree from a process running in a different one — the same class of
// stray write #1210 fixed for the main-checkout case, just lateral.
// Reproduced with two independent linkedWorktreeOf(main) fixtures (never
// cwd's own).
test('#1210 follow-up accept+rewrite: cwd inside worktree A + --run-dir resolves inside a DIFFERENT worktree B rewrites to A, never writes into B', () => {
  const main = gitRepo();
  const wtA = linkedWorktreeOf(main);
  const wtB = linkedWorktreeOf(main);
  const abs = path.join(wtB, '.claude-tweaks', 'pipelines', 'x');
  const stdout = [];
  const stderr = [];
  const deps = writingDeps(stdout, stderr);
  const code = withCwd(wtA, () => run(['1', '--run-dir', abs, '--repo', 'owner/repo'], deps));
  assert.strictEqual(code, 0, stderr.join(''));
  assert.match(stderr.join(''), /resolves inside a different worktree/i);
  assert.match(stderr.join(''), /worktree-local equivalent/i);
  const envelope = JSON.parse(stdout.join(''));
  assert.ok(
    envelope.file.startsWith(wtA + path.sep),
    `expected the written file to be under cwd's own worktree (${wtA}), got ${envelope.file}`,
  );
  assert.ok(fs.existsSync(envelope.file), 'the reported file path must actually exist on disk');
  const wtBShadowFile = path.join(wtB, '.claude-tweaks', 'pipelines', 'x', 'work', '1-spec.md');
  assert.ok(!fs.existsSync(wtBShadowFile), 'must never have written the spec file into the unrelated worktree B');
});

test('reject: --run-dir has no git repo ancestor at all — distinct message, not the worktree-shadow wording', () => {
  // #790 Finding 5: mainCheckoutRoot() returning null (no .git anywhere up
  // the ancestor chain) is a DIFFERENT failure than "exists, but resolves
  // outside a KNOWN main checkout" — a bare mkdtempSync dir with no git init
  // reproduces it without needing a git-repo fixture at all.
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-materialize-norepo-'));
  const deps = fakeDeps();
  const abs = path.join(bare, '.claude-tweaks', 'pipelines', 'x');
  const code = withCwd(bare, () => run(['1', '--run-dir', abs], deps));
  assert.strictEqual(code, 2);
  assert.match(deps.calls.stderr.join(''), /could not determine the git repository root/i);
  assert.doesNotMatch(deps.calls.stderr.join(''), /resolves outside the main checkout/i);
  assert.strictEqual(deps.calls.ghAvailable, 0, 'must reject before ever checking gh availability');
});
