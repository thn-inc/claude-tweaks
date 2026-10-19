'use strict';
// #3497: a real-git multi-spec run fixture whose consolidated Review Console
// pass never ran — shared by tests/bin-lib/hooks/session-residue.test.js and
// tests/hooks-session-start.test.js. Modeled on tests/run-integrity.test.js's
// fixtureRepo: `trunk` integration branch, a linked worktree whose
// `feat-branch` commit is dated after the run dir's own start prefix, and a
// complete two-spec (11, 12) manifest in an auto-mode run dir.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { fixtureGit } = require('./git-fixtures');

const RUN_ID = '2026-08-01T090000-spec-11-12';
const EV_BUILD = '{"skill":"claude-tweaks:build","ts":"2026-08-01T09:05:00.000Z","type":"skill_invoked"}';
const EV_WRAPUP = '{"skill":"claude-tweaks:wrap-up","ts":"2026-08-01T09:50:00.000Z","type":"skill_invoked"}';

function reentryGit(cwd, ...args) {
  return fixtureGit(['-C', cwd, ...args], {
    env: { ...process.env, GIT_AUTHOR_DATE: '2026-08-01T10:00:00Z', GIT_COMMITTER_DATE: '2026-08-01T10:00:00Z' },
  }).toString();
}

function writeReentryManifest(runDir, statuses) {
  const ids = [11, 12];
  const lines = ['multispec:', `  parent: .claude-tweaks/pipelines/${RUN_ID}/`, '  specs:'];
  statuses.forEach((status, i) => lines.push(`    - id: ${ids[i]}`, `      status: ${status}`, `      subdir: spec-${ids[i]}/`));
  fs.writeFileSync(path.join(runDir, 'manifest.yml'), lines.join('\n') + '\n');
}

function reentryFixture({ events = [EV_BUILD, EV_WRAPUP] } = {}) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ct-reentry-')));
  fixtureGit(['init', '-q', '-b', 'trunk', root]);
  reentryGit(root, 'config', 'user.email', 't@example.com');
  reentryGit(root, 'config', 'user.name', 'T');
  fs.writeFileSync(path.join(root, 'a.txt'), 'base\n');
  reentryGit(root, 'add', 'a.txt');
  reentryGit(root, 'commit', '-q', '-m', 'base');
  fs.mkdirSync(path.join(root, '.claude-tweaks'), { recursive: true });
  fs.writeFileSync(path.join(root, '.claude-tweaks', 'policy.yml'), 'integration-branch: trunk\n');
  const wt = path.join(root, '.claude', 'worktrees', 'feat');
  reentryGit(root, 'worktree', 'add', '-q', '-b', 'feat-branch', wt);
  fs.writeFileSync(path.join(wt, 'b.txt'), 'feature\n');
  reentryGit(wt, 'add', 'b.txt');
  reentryGit(wt, 'commit', '-q', '-m', 'feature work');
  const runDir = path.join(root, '.claude-tweaks', 'pipelines', RUN_ID);
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'run-state.json'), JSON.stringify({ status: 'active', worktree: wt }));
  fs.writeFileSync(path.join(runDir, 'config.yml'), 'mode: auto\n');
  writeReentryManifest(runDir, ['complete', 'complete']);
  fs.writeFileSync(path.join(runDir, 'events.jsonl'), events.join('\n') + '\n');
  return { root, wt, runDir };
}

module.exports = { reentryFixture, reentryGit, writeReentryManifest, EV_BUILD, EV_WRAPUP, RUN_ID };
