'use strict';
// #5075: a bookkeeping-only delta since a clean passing scoped pass runs no suite and stamps `none`,
// anchored on that pass; any other delta, and any stranded or dirty scoped stamp, still measures from fullSha.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { runCli, scopedRepo, stampOf, commitFile } = require('./cli-helpers');

const RULES = [{ match: 'src/**', suites: ['unit'], static: true }, { match: 'docs/plans/*-ledger.md', suites: [], static: false }];
const LEDGER = 'docs/plans/2026-01-01-x-ledger.md';
const args = (r) => ['--scope', r.declPath, '--integration-branch', r.branch, '--cmd', `unit=${r.unitCmd}`, '--cmd', 'other=node -e 0'];
const head = (r) => r.git('rev-parse', 'HEAD').trim();
const stampPath = (r) => path.join(r.gitDir, 'claude-tweaks-verify-pass.json');

async function scopedPassAt(r) {
  const full = await runCli(args(r), { cwd: r.repo });
  assert.strictEqual(full.code, 0, full.stderr);
  const F = head(r);
  fs.rmSync(r.marker, { force: true });
  commitFile(r, 'src/a.js', 'module.exports = 1;');
  const scoped = await runCli(args(r), { cwd: r.repo });
  assert.strictEqual(scoped.code, 0, scoped.stderr);
  fs.rmSync(r.marker, { force: true });
  return { F, S: head(r) };
}

const rewriteStamp = (r, patch) => fs.writeFileSync(stampPath(r), JSON.stringify({ ...stampOf(r.gitDir), ...patch }));

test('AC1.1: a ledger-only delta since a passing scoped stamp runs no suite, prints still-verified, and verifies HEAD', async () => {
  const r = scopedRepo(RULES);
  const { F, S } = await scopedPassAt(r);
  assert.strictEqual(stampOf(r.gitDir).scope, 'scoped');
  commitFile(r, LEDGER, '| row |');
  const run = await runCli(args(r), { cwd: r.repo });
  assert.strictEqual(run.code, 0, run.stderr);
  assert.match(run.stdout, /^Scope: none — 1 changed file\(s\) since/m);
  assert.match(run.stdout, /still-verified: bookkeeping-only delta \(docs\/plans\/2026-01-01-x-ledger\.md\)/);
  assert.ok(!fs.existsSync(r.marker), 'no suite may spawn');
  const s = stampOf(r.gitDir);
  assert.strictEqual(s.scope, 'none');
  assert.strictEqual(s.sha, head(r));
  assert.strictEqual(s.fullSha, F);
  assert.strictEqual(s.base, S);
  assert.deepStrictEqual(s.changedFiles, [LEDGER]);
  const status = JSON.parse((await runCli(['--stamp-status'], { cwd: r.repo })).stdout);
  assert.strictEqual(status.verifiedHead, true);
});

test('AC2.1: a delta since the scoped stamp holding one src path scopes over the delta since fullSha, as today', async () => {
  const r = scopedRepo(RULES);
  const { F } = await scopedPassAt(r);
  commitFile(r, LEDGER, '| row |');
  commitFile(r, 'src/b.js', 'module.exports = 2;');
  const run = await runCli(args(r), { cwd: r.repo });
  assert.strictEqual(run.code, 0, run.stderr);
  assert.match(run.stdout, /^Scope: scoped — 3 changed file\(s\) since/m);
  assert.ok(fs.existsSync(r.marker), 'unit must run');
  const s = stampOf(r.gitDir);
  assert.strictEqual(s.scope, 'scoped');
  assert.strictEqual(s.base, F);
  assert.strictEqual(s.fullSha, F);
  assert.deepStrictEqual(s.changedFiles, [LEDGER, 'src/a.js', 'src/b.js']);
  assert.deepStrictEqual(s.suitesRun, ['unit']);
});

test('guard: an amended scoped pass (sha no longer an ancestor of HEAD) falls back to the fullSha delta', async () => {
  const r = scopedRepo(RULES);
  const { F } = await scopedPassAt(r);
  fs.mkdirSync(path.join(r.repo, 'docs/plans'), { recursive: true });
  fs.writeFileSync(path.join(r.repo, LEDGER), '| row |');
  r.git('add', LEDGER);
  r.git('commit', '--amend', '--no-edit', '-q');
  const run = await runCli(args(r), { cwd: r.repo });
  assert.strictEqual(run.code, 0, run.stderr);
  assert.match(run.stdout, /^Scope: scoped/m);
  assert.ok(fs.existsSync(r.marker), 'unit must run');
  const s = stampOf(r.gitDir);
  assert.strictEqual(s.base, F);
  assert.ok(s.changedFiles.includes('src/a.js'));
});

test('guard: a dirty scoped stamp never anchors a none', async () => {
  const r = scopedRepo(RULES);
  const { F } = await scopedPassAt(r);
  rewriteStamp(r, { dirty: true });
  commitFile(r, LEDGER, '| row |');
  const run = await runCli(args(r), { cwd: r.repo });
  assert.strictEqual(run.code, 0, run.stderr);
  assert.match(run.stdout, /^Scope: scoped/m);
  assert.ok(fs.existsSync(r.marker), 'unit must run');
  assert.strictEqual(stampOf(r.gitDir).base, F);
});

test('AC1.2: with an impact declaration, a ledger-only delta since a scoped stamp still runs no suite and exits 0', async () => {
  const impact = { suite: 'unit', command: 'node -e 0 {files}', tests: ['tests/**/*.test.js'], maxAgeCommits: 200, fetch: 'node -e 0' };
  const r = scopedRepo(RULES, { impact });
  const { F } = await scopedPassAt(r);
  commitFile(r, LEDGER, '| row |');
  const run = await runCli(args(r), { cwd: r.repo });
  assert.strictEqual(run.code, 0, run.stderr);
  assert.match(run.stdout, /^Impact: 0 of the unit test file\(s\) selected — no impact-rule path changed, map not read$/m);
  assert.match(run.stdout, /still-verified: bookkeeping-only delta/);
  assert.ok(!fs.existsSync(r.marker), 'no suite may spawn');
  const s = stampOf(r.gitDir);
  assert.strictEqual(s.scope, 'none');
  assert.strictEqual(s.fullSha, F);
});

test('carry-forward: a none written on a scoped-pass base keeps the anchor\'s baseline marker', async () => {
  const r = scopedRepo(RULES);
  await scopedPassAt(r);
  const marker = { base: 'origin/main', baseSha: 'b'.repeat(40), baselineFailing: ['tests/env.test.js'], flakyPassed: [] };
  rewriteStamp(r, { baseline: marker });
  commitFile(r, LEDGER, '| row |');
  const run = await runCli(args(r), { cwd: r.repo });
  assert.strictEqual(run.code, 0, run.stderr);
  const s = stampOf(r.gitDir);
  assert.strictEqual(s.scope, 'none');
  assert.deepStrictEqual(s.baseline, marker);
  const status = JSON.parse((await runCli(['--stamp-status'], { cwd: r.repo })).stdout);
  assert.strictEqual(status.baselineAdjudicated, true);
  assert.strictEqual(status.verifiedHead, true);
});
