// tests/materialize-template-stamp.test.js
//
// #1840: a harness-health drift record for a template-derived CLAUDE.md/rule
// section carries a `Template: {path} @ {version}` body-metadata line, the
// plugin version the Proposed block was snapshotted from. materialize.js
// compares that recorded version against the INSTALLED build's own version
// and surfaces an explicit, actionable statement when they differ — a
// version delta means the Proposed block should be re-derived from the
// installed template rather than applied literally. Mirrors the shape of
// tests/materialize-drift.test.js's own #117 sibling suite.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { gitRepo } = require('./helpers/git-fixtures');
const wtDetect = require('../plugin/bin/lib/hooks/worktree-detect');
const { run } = require('../plugin/bin/materialize');

function shapedBodyWithTemplateStamp(templatePath, version) {
  return [
    'Surface: infra',
    `Template: ${templatePath} @ ${version}`,
    '',
    '## Current State',
    'Some current state text.',
    '',
    '## Deliverables',
    '- [ ] do a thing',
    '',
    '## Acceptance Criteria',
    '1. It works',
  ].join('\n');
}

const SHAPED_BODY_NO_STAMP = [
  'Surface: infra',
  '',
  '## Current State',
  'Some current state text.',
  '',
  '## Deliverables',
  '- [ ] do a thing',
  '',
  '## Acceptance Criteria',
  '1. It works',
].join('\n');

function withCwd(dir, fn) {
  const prev = process.cwd();
  process.chdir(dir);
  try { return fn(); } finally { process.chdir(prev); }
}

function fakeDeps(root, { body, installedPluginVersion }) {
  const stdout = [];
  const stderr = [];
  return {
    calls: { stdout, stderr },
    ghAvailable: () => true,
    ghView: () => JSON.stringify({
      number: 117,
      title: 'Test record',
      body,
      labels: [{ name: 'ceremony:standard' }],
      url: 'https://example.invalid/117',
    }),
    remoteUrl: () => { throw new Error('remoteUrl should never be called when --repo is passed explicitly'); },
    cwd: () => process.cwd(),
    mainRoot: (cwd) => wtDetect.mainCheckoutRoot(cwd),
    isAnchored: (resolvedPath, mainRoot) => wtDetect.isAnchoredUnderRoot(resolvedPath, mainRoot),
    cwdWorktreeRoot: (cwd) => {
      const info = wtDetect.repoInfo(cwd);
      return info.isLinkedWorktree ? info.repoRoot : null;
    },
    mkdirp: (dir) => fs.mkdirSync(dir, { recursive: true }),
    writeFile: (file, content) => fs.writeFileSync(file, content),
    stdout: (s) => stdout.push(s),
    stderr: (s) => stderr.push(s),
    gitRevListCount: () => { throw new Error('gitRevListCount should not be called — no Verified-as-of stamp on this record'); },
    gitCommitDate: () => { throw new Error('gitCommitDate should not be called — no Verified-as-of stamp on this record'); },
    installedPluginVersion: installedPluginVersion || (() => { throw new Error('installedPluginVersion should not be called — no Template: stamp on this record'); }),
  };
}

function runDirFor(repoDir) {
  return path.join(repoDir, '.claude-tweaks', 'pipelines', '2026-01-01T000000-record-117');
}

test('template: no Template: line on the record -> template is null, installedPluginVersion never called', () => {
  const repo = gitRepo();
  withCwd(repo, () => {
    const deps = fakeDeps(repo, { body: SHAPED_BODY_NO_STAMP });
    const runDir = runDirFor(repo);
    const exitCode = run(['117', '--run-dir', runDir, '--repo', 'owner/repo'], deps);
    assert.strictEqual(exitCode, 0, deps.calls.stderr.join(''));
    const envelope = JSON.parse(deps.calls.stdout.join(''));
    assert.strictEqual(envelope.template, null);
    assert.deepStrictEqual(deps.calls.stderr, []);
  });
});

test('template: recorded version equals installed -> changed: false, no stderr line', () => {
  const repo = gitRepo();
  withCwd(repo, () => {
    const deps = fakeDeps(repo, {
      body: shapedBodyWithTemplateStamp('skills/init/claude-md-template.md', '6.114.1'),
      installedPluginVersion: () => '6.114.1',
    });
    const runDir = runDirFor(repo);
    const exitCode = run(['117', '--run-dir', runDir, '--repo', 'owner/repo'], deps);
    assert.strictEqual(exitCode, 0, deps.calls.stderr.join(''));
    const envelope = JSON.parse(deps.calls.stdout.join(''));
    assert.deepStrictEqual(envelope.template, {
      path: 'skills/init/claude-md-template.md', recorded: '6.114.1', installed: '6.114.1', changed: false,
    });
    assert.deepStrictEqual(deps.calls.stderr, []);
  });
});

test('template: recorded version differs from installed -> changed: true, actionable stderr line naming the path and both versions', () => {
  const repo = gitRepo();
  withCwd(repo, () => {
    const deps = fakeDeps(repo, {
      body: shapedBodyWithTemplateStamp('skills/init/claude-md-template.md', '6.111.0'),
      installedPluginVersion: () => '6.114.1',
    });
    const runDir = runDirFor(repo);
    const exitCode = run(['117', '--run-dir', runDir, '--repo', 'owner/repo'], deps);
    assert.strictEqual(exitCode, 0, deps.calls.stderr.join(''));
    const envelope = JSON.parse(deps.calls.stdout.join(''));
    assert.strictEqual(envelope.template.changed, true);
    assert.strictEqual(deps.calls.stderr.length, 1);
    assert.match(deps.calls.stderr[0], /skills\/init\/claude-md-template\.md/);
    assert.match(deps.calls.stderr[0], /6\.111\.0/);
    assert.match(deps.calls.stderr[0], /6\.114\.1/);
    assert.match(deps.calls.stderr[0], /re-derive from the installed/);
  });
});

test('template: an unreadable/absent plugin manifest degrades to installed: null, changed: false, no crash', () => {
  const repo = gitRepo();
  withCwd(repo, () => {
    const deps = fakeDeps(repo, {
      body: shapedBodyWithTemplateStamp('skills/init/rules-template.md', '6.111.0'),
      installedPluginVersion: () => undefined,
    });
    const runDir = runDirFor(repo);
    const exitCode = run(['117', '--run-dir', runDir, '--repo', 'owner/repo'], deps);
    assert.strictEqual(exitCode, 0, deps.calls.stderr.join(''));
    const envelope = JSON.parse(deps.calls.stdout.join(''));
    assert.deepStrictEqual(envelope.template, {
      path: 'skills/init/rules-template.md', recorded: '6.111.0', installed: null, changed: false,
    });
    assert.deepStrictEqual(deps.calls.stderr, []);
  });
});
