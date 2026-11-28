// tests/hooks-run-arg-anchoring.test.js
//
// #790: bin/hooks.js's resolveRunArg validated an explicit --run <path> only
// via fs.statSync(...).isDirectory() — true for a worktree-relative directory
// just as readily as a main-checkout-anchored one. CLI-level coverage
// (in-process through runCli, like tests/hooks-resolve-run-dir-cli.test.js)
// proving --run is now rejected when it resolves inside a linked worktree,
// whether passed as a relative or an absolute path, and still accepted when
// it genuinely resolves under the main checkout. In-process (#5376):
// record-worktree's script-entry smoke tests are in
// tests/hooks-ledger-row.test.js.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const { scratchDir } = require('./helpers/tmp-dir');
const os = require('os');
const path = require('path');
const { gitRepo, linkedWorktreeOf, hookEnv } = require('./helpers/git-fixtures');
const { runCli } = require('./helpers/run-cli');

const HOOKS_JS = path.join(__dirname, '..', 'plugin', 'bin', 'hooks.js');

async function runRecordWorktree(args, cwd) {
  // The injected cwd must differ from the runner's, so every case proves the verb reads deps.cwd().
  assert.notEqual(fs.realpathSync(cwd), fs.realpathSync(process.cwd()));
  // #1270: neutralize any ambient PIPELINE_RUN_DIR (present in every
  // /flow-dispatched shell) so this call can't silently resolve against a
  // real run dir it never named — every case here already passes --run
  // explicitly, but this guard is the same defense-in-depth convention
  // #1130 established for every other bin/hooks.js test helper.
  const r = await runCli(HOOKS_JS, ['record-worktree', ...args], {
    cwd, env: hookEnv(),
  });
  return { code: r.code, stdout: r.stdout };
}

function mkRunDir(base, relParts) {
  const dir = path.join(base, ...relParts);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// #5376 injected-value proof: fails when record-worktree reads process.cwd() instead of the injected cwd
test('reject: --run is a relative path that resolves inside the linked worktree', async () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  mkRunDir(wt, ['.claude-tweaks', 'pipelines', '2026-01-01T000000-spec-790']);
  const out = await runRecordWorktree(
    ['--run', path.join('.claude-tweaks', 'pipelines', '2026-01-01T000000-spec-790'), wt],
    wt,
  );
  assert.match(out.stdout, /not anchored|resolves outside the main checkout/i);
  assert.doesNotMatch(out.stdout, /worktree recorded/);
});

test('reject: --run is an absolute path that resolves inside the linked worktree', async () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  const trapped = mkRunDir(wt, ['.claude-tweaks', 'pipelines', '2026-01-01T000000-spec-791']);
  const out = await runRecordWorktree(['--run', trapped, wt], wt);
  assert.match(out.stdout, /not anchored|resolves outside the main checkout/i);
  assert.doesNotMatch(out.stdout, /worktree recorded/);
});

test('accept: --run is an absolute path correctly anchored under the main checkout', async () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  const anchored = mkRunDir(main, ['.claude-tweaks', 'pipelines', '2026-01-01T000000-spec-792']);
  // Invoked from inside the worktree (the real-world shape) — the anchoring
  // check must accept a --run value that genuinely resolves under $RUN_ROOT.
  const out = await runRecordWorktree(['--run', anchored, wt], wt);
  assert.match(out.stdout, /worktree recorded/);
});

test('#280: accept — --run is a worktree-local INITIALIZED run dir with no main-checkout counterpart', async () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  const trapped = mkRunDir(wt, ['.claude-tweaks', 'pipelines', '2026-01-01T000000-spec-280']);
  // The distinguishing signal: a marker file a real pipeline step wrote
  // (decisions.md, from the standalone-fallback/Manifesto init), not merely
  // a directory that exists.
  fs.writeFileSync(path.join(trapped, 'decisions.md'), '');
  const out = await runRecordWorktree(['--run', trapped, wt], wt);
  assert.match(out.stdout, /worktree-local fallback \(#280\)/i);
  assert.match(out.stdout, /worktree recorded/);
  assert.doesNotMatch(out.stdout, /not anchored|resolves outside the main checkout/i);
});

test('#280: reject — a worktree-local run dir that is a bare mkdir (uninitialized) still refuses, even with no main-checkout counterpart', async () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  // Same shape as the #790 "reject" tests above (bare mkdir, no marker
  // file) — confirms the #280 fallback does not loosen the ordinary case.
  const trapped = mkRunDir(wt, ['.claude-tweaks', 'pipelines', '2026-01-01T000000-spec-281']);
  const out = await runRecordWorktree(['--run', trapped, wt], wt);
  assert.match(out.stdout, /not anchored|resolves outside the main checkout/i);
  assert.doesNotMatch(out.stdout, /worktree recorded/);
  assert.doesNotMatch(out.stdout, /worktree-local fallback/i);
});

test('#280: reject — a worktree-local INITIALIZED run dir is NOT adopted when a same-named run dir already exists under the main checkout', async () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  const runId = '2026-01-01T000000-spec-282';
  // The main-checkout copy is authoritative whenever one exists — the
  // worktree-local copy must never win over it, even if it happens to be
  // initialized too (e.g. a resumed session that later regained main-checkout
  // write access).
  mkRunDir(main, ['.claude-tweaks', 'pipelines', runId]);
  const trapped = mkRunDir(wt, ['.claude-tweaks', 'pipelines', runId]);
  fs.writeFileSync(path.join(trapped, 'decisions.md'), '');
  const out = await runRecordWorktree(['--run', trapped, wt], wt);
  assert.match(out.stdout, /not anchored|resolves outside the main checkout/i);
  assert.doesNotMatch(out.stdout, /worktree recorded/);
  assert.doesNotMatch(out.stdout, /worktree-local fallback/i);
});

// #1138: an empty or whitespace-only --run value (the shape an unset
// $PIPELINE_RUN_DIR expands to in shell) must be rejected at parse time —
// "--run requires a value" — before it ever reaches the anchoring check.
test('#1138 reject: empty --run value — "--run requires a value", never the anchoring-check wording', async () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  const out = await runRecordWorktree(['--run', '', wt], wt);
  assert.match(out.stdout, /--run requires a value/);
  assert.doesNotMatch(out.stdout, /not anchored|resolves outside the main checkout/i);
  assert.doesNotMatch(out.stdout, /worktree recorded/);
});

test('#1138 reject: whitespace-only --run value degrades the same as empty', async () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  const out = await runRecordWorktree(['--run', '   ', wt], wt);
  assert.match(out.stdout, /--run requires a value/);
  assert.doesNotMatch(out.stdout, /not anchored|resolves outside the main checkout/i);
  assert.doesNotMatch(out.stdout, /worktree recorded/);
});

test('reject: --run resolves under a directory with no git repo ancestor at all — distinct message, not the worktree-shadow wording', async () => {
  // #790 Finding 5: mainCheckoutRoot() returning null (no .git anywhere up
  // the ancestor chain) is a DIFFERENT failure than "exists, but resolves
  // outside a KNOWN main checkout" — a bare mkdtempSync dir with no git init
  // reproduces it without needing a git-repo fixture at all.
  const bare = scratchDir('ct-hooks-norepo-');
  const runDirPath = mkRunDir(bare, ['.claude-tweaks', 'pipelines', '2026-01-01T000000-spec-793']);
  const out = await runRecordWorktree(['--run', runDirPath, bare], bare);
  assert.match(out.stdout, /could not determine the git repository root/i);
  assert.doesNotMatch(out.stdout, /not anchored|resolves outside the main checkout/i);
  assert.doesNotMatch(out.stdout, /worktree recorded/);
});

// Shared by the #1183 tests below: every "reject" case must show the
// anchoring-rejection message and must NOT report either a successful record
// or a #280 fallback adoption; every "accept via fallback" case must report
// both the fallback disclosure and a successful record. Naming the assertion
// intent here keeps each test's own setup (its distinct fixture shape) the
// only thing left to read at the call site.
function assertShadowRejected(out) {
  assert.match(out.stdout, /not anchored|resolves outside the main checkout/i);
  assert.doesNotMatch(out.stdout, /worktree recorded/);
  assert.doesNotMatch(out.stdout, /worktree-local fallback/i);
}

function assertFallbackAdopted(out) {
  assert.match(out.stdout, /worktree-local fallback \(#280\)/i);
  assert.match(out.stdout, /worktree recorded/);
}

test('#1183: reject — an arbitrary non-repo directory with a stray config.yml is not adopted via the #280 fallback', async () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  const stray = scratchDir('ct-wtd-stray-');
  fs.writeFileSync(path.join(stray, 'config.yml'), '');
  const out = await runRecordWorktree(['--run', stray, wt], wt);
  assertShadowRejected(out);
});

test('#1183: reject — an unrelated git repo (not a worktree of this repo) with a config.yml is not adopted via the #280 fallback', async () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  const otherRepo = gitRepo();
  fs.writeFileSync(path.join(otherRepo, 'config.yml'), '');
  const out = await runRecordWorktree(['--run', otherRepo, wt], wt);
  assertShadowRejected(out);
});

test('#1183: reject — a worktree shadow of a nested pipelines/{parent}/spec-N run dir is refused when the anchored copy exists at the correct nested path', async () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  const parentRunId = '2026-01-01T000000-spec-multi';
  const specSub = 'spec-967';
  // The anchored twin only needs to exist as a directory — matches the
  // existing twin-guard tests' isDirectory-only bar (no marker files needed).
  mkRunDir(main, ['.claude-tweaks', 'pipelines', parentRunId, specSub]);
  const trapped = mkRunDir(wt, ['.claude-tweaks', 'pipelines', parentRunId, specSub]);
  fs.writeFileSync(path.join(trapped, 'decisions.md'), '');
  const out = await runRecordWorktree(['--run', trapped, wt], wt);
  assertShadowRejected(out);
});

test('#1183: accept — a worktree shadow of a nested pipelines/{parent}/spec-N run dir adopts via the #280 fallback when no anchored copy exists at all', async () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  const parentRunId = '2026-01-01T000000-spec-multi2';
  const specSub = 'spec-968';
  const trapped = mkRunDir(wt, ['.claude-tweaks', 'pipelines', parentRunId, specSub]);
  fs.writeFileSync(path.join(trapped, 'decisions.md'), '');
  const out = await runRecordWorktree(['--run', trapped, wt], wt);
  assertFallbackAdopted(out);
});

test('#1183: reject — a worktree shadow of an archived pipelines/archive/{id} run dir is refused when the anchored copy exists', async () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  const archivedRunId = '2026-01-01T000000-spec-archived';
  mkRunDir(main, ['.claude-tweaks', 'pipelines', 'archive', archivedRunId]);
  const trapped = mkRunDir(wt, ['.claude-tweaks', 'pipelines', 'archive', archivedRunId]);
  fs.writeFileSync(path.join(trapped, 'decisions.md'), '');
  const out = await runRecordWorktree(['--run', trapped, wt], wt);
  assertShadowRejected(out);
});

test('#1183 fix-wave: accept — a worktree-local INITIALIZED run dir reached through a symlinked path component still adopts via the #280 fallback', async () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  const trapped = mkRunDir(wt, ['.claude-tweaks', 'pipelines', '2026-01-01T000000-spec-1183sym']);
  fs.writeFileSync(path.join(trapped, 'decisions.md'), '');
  // A symlink standing in for a path component (macOS /tmp -> /private/tmp is
  // the common real-world case) — repoInfo(resolved).repoRoot is realpath'd
  // internally (safeReal), but the un-realpath'd `resolved` used in the old
  // relative-path comparison was not, so a path reached through a symlink
  // like this one produced a spurious `..`-prefixed relative path and was
  // wrongly rejected. Passing the SAME run dir through a symlinked alias
  // here, with no main-checkout twin at all, must still be adopted.
  const wtLink = path.join(path.dirname(wt), 'wt-symlink');
  fs.symlinkSync(wt, wtLink, 'dir');
  const viaSymlink = path.join(wtLink, '.claude-tweaks', 'pipelines', '2026-01-01T000000-spec-1183sym');
  const out = await runRecordWorktree(['--run', viaSymlink, wt], wt);
  assertFallbackAdopted(out);
});

test('#1183 fix-wave: reject — a worktree-local archive/{id} shadow is refused when a LIVE (non-archived) run dir exists under the same id at the main checkout', async () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  const runId = '2026-01-01T000000-spec-archlive';
  // The main-checkout copy is LIVE (not archived) under the same run-id —
  // checking only the archive/{id} path at the main checkout would miss
  // this and wrongly adopt the worktree-local archive shadow as if no
  // authoritative copy existed anywhere.
  mkRunDir(main, ['.claude-tweaks', 'pipelines', runId]);
  const trapped = mkRunDir(wt, ['.claude-tweaks', 'pipelines', 'archive', runId]);
  fs.writeFileSync(path.join(trapped, 'decisions.md'), '');
  const out = await runRecordWorktree(['--run', trapped, wt], wt);
  assertShadowRejected(out);
});

test('#1299: reject — a worktree-local LIVE pipelines/{id} shadow is refused when the main checkout holds that same id ARCHIVED', async () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  const runId = '2026-01-01T000000-spec-livearch';
  // The mirror of the #1183 fix-wave case above: the main-checkout copy is
  // ARCHIVED (not live) under the same run-id — checking only the live/live
  // path (mainCandidate) at the main checkout would miss this and wrongly
  // adopt the worktree-local live shadow as if no authoritative copy existed
  // anywhere.
  mkRunDir(main, ['.claude-tweaks', 'pipelines', 'archive', runId]);
  const trapped = mkRunDir(wt, ['.claude-tweaks', 'pipelines', runId]);
  fs.writeFileSync(path.join(trapped, 'decisions.md'), '');
  const out = await runRecordWorktree(['--run', trapped, wt], wt);
  assertShadowRejected(out);
});

test('#1183: reject — a worktree-local INITIALIZED dir outside .claude-tweaks/pipelines/ entirely is not adopted via the #280 fallback (pins the inPipelines condition)', async () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  const trapped = mkRunDir(wt, ['some-other-dir']);
  fs.writeFileSync(path.join(trapped, 'decisions.md'), '');
  const out = await runRecordWorktree(['--run', trapped, wt], wt);
  assertShadowRejected(out);
});

test('#1183: reject — a worktree-local INITIALIZED dir under pipelines/ with a non-run-id-shaped name is not adopted via the #280 fallback (pins the runIdShaped condition)', async () => {
  const main = gitRepo();
  const wt = linkedWorktreeOf(main);
  const trapped = mkRunDir(wt, ['.claude-tweaks', 'pipelines', 'not-a-run-id']);
  fs.writeFileSync(path.join(trapped, 'decisions.md'), '');
  const out = await runRecordWorktree(['--run', trapped, wt], wt);
  assertShadowRejected(out);
});
