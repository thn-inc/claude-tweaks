'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('child_process');
const fs = require('fs');
const { scratchDir } = require('../../helpers/tmp-dir');
const os = require('os');
const path = require('path');

const HOOKS = path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'hooks.js');
const { writeIdentity } = require('../../helpers/git-fixtures');

function git(args, cwd) { return execFileSync('git', args, { cwd, encoding: 'utf8' }); }

function seedRepo(dir) {
  git(['init', '-q', '--initial-branch=main'], dir);
  writeIdentity(dir, { name: 'T', email: 't@e.com' });
  fs.writeFileSync(path.join(dir, 'a.txt'), 'x');
  git(['add', 'a.txt'], dir);
  git(['commit', '-q', '-m', 'seed'], dir);
}

// #644 Deliverable 3 — this is the report-composition code path
// `/claude-tweaks:flow`'s closing report shells out to (summary-template.md's
// "Reconcile residue line") — verified here rather than by eyeballing a
// manual run.
test('reconcile-summary: no background pass yet, no remote — a well-formed line with zero counts, never a throw or non-zero exit', () => {
  const dir = scratchDir('ct-recon-summary-');
  seedRepo(dir);

  const result = execFileSync('node', [HOOKS, 'reconcile-summary'], { cwd: dir, encoding: 'utf8' });
  assert.equal(result.trim(), 'reconcile: 0 archived, 0 stuck, mirror ff n/a');
});

test('reconcile-summary: reflects a persisted background-status archived count and the residue cache\'s stuck count', () => {
  const dir = scratchDir('ct-recon-summary-stuck-');
  seedRepo(dir);

  fs.mkdirSync(path.join(dir, '.claude-tweaks'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, '.claude-tweaks', 'reconcile-background-status.json'),
    JSON.stringify({ completedAt: Date.now(), summary: { archived: 2 }, surfaced: false }),
  );
  const { recordResidueFailure } = require('../../../plugin/bin/lib/reconcile/cache');
  recordResidueFailure(dir, 'move-failed', path.join(dir, '.claude-tweaks', 'pipelines', 'stuck-1'), { now: Date.now() });

  const result = execFileSync('node', [HOOKS, 'reconcile-summary'], { cwd: dir, encoding: 'utf8' });
  assert.match(result, /^reconcile: 2 archived, 1 stuck \(oldest \d+m\), mirror ff n\/a\n?$/);
});

test('reconcile: the raw-JSON subcommand also carries a residueSummary field composed from the same result, on a fully-completed pass', () => {
  const dir = scratchDir('ct-recon-raw-summary-');
  seedRepo(dir);
  // Force past the no-remote/local-merge early exits (neither of which
  // reach the bottom of reconcile() where residueSummary is attached — see
  // index.js's own comment on why the freshness stamp, and now
  // residueSummary, only apply to a fully-completed pr-first pass) without
  // needing a real GitHub remote: an explicit integration-branch/-model
  // policy override is enough to route into the pr-first branch, where a
  // gh-absent preflight narrows to the cheap, git-only mirror check and
  // still runs it to completion.
  fs.mkdirSync(path.join(dir, '.claude-tweaks'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, '.claude-tweaks', 'policy.yml'),
    'integration-branch: main\nintegration-model: pr-first\n',
  );

  const result = execFileSync('node', [HOOKS, 'reconcile', '--json'], { cwd: dir, encoding: 'utf8' });
  const parsed = JSON.parse(result);
  assert.equal(typeof parsed.residueSummary, 'string', `expected a residueSummary string, got: ${result}`);
  assert.match(parsed.residueSummary, /^reconcile: \d+ archived, \d+ stuck.*mirror ff /);
});
