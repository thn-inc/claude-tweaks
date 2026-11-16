'use strict';
// Template-copy fixtures for claims-git-cas.test.js (#5769): each origin + clone
// is built once per test process and copied per call, so a further call starts
// no git process (tests/helpers/git-template.js). No test runner import here.

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { fromTemplate, disableReceiveAutoGc } = require('../../helpers/git-template');
const {
  readClaimBlobGit, writeClaimBlobGit, CLAIMS_BRANCH,
} = require('../../../plugin/bin/lib/issues/claims-git-cas');

// Every git call pipes stderr — see claims-git-cas.test.js's PIPE_ALL note. stdin stays
// 'pipe' because realRunner feeds `hash-object --stdin` through `opts.input`.
const PIPE_ALL = ['pipe', 'pipe', 'pipe'];

function realRunner(args, opts = {}) {
  return execFileSync('git', args, {
    encoding: 'utf8', stdio: PIPE_ALL, cwd: opts.cwd, input: opts.input, env: opts.env,
  });
}

function setupGit(args) {
  return execFileSync('git', args, { encoding: 'utf8', stdio: PIPE_ALL });
}

// Bare origin + clone with a seeded `main`; `withRegistry` also pushes claims-registry.
function buildOriginAndClone(root, withRegistry) {
  const originDir = path.join(root, 'origin.git');
  const cloneDir = path.join(root, 'clone');
  setupGit(['init', '--bare', '-q', '-b', 'main', originDir]);
  disableReceiveAutoGc(originDir);
  setupGit(['clone', '-q', originDir, cloneDir]);
  setupGit(['-C', cloneDir, 'config', 'user.email', 'test@example.com']);
  setupGit(['-C', cloneDir, 'config', 'user.name', 'Test']);
  fs.writeFileSync(path.join(cloneDir, 'README.md'), 'seed\n');
  setupGit(['-C', cloneDir, 'add', 'README.md']);
  setupGit(['-C', cloneDir, 'commit', '-q', '-m', 'seed']);
  setupGit(['-C', cloneDir, 'push', '-q', 'origin', 'main']);
  if (withRegistry) setupGit(['-C', cloneDir, 'push', '-q', 'origin', `main:${CLAIMS_BRANCH}`]);
}

function paths(root) {
  return { root, originDir: path.join(root, 'origin.git'), cloneDir: path.join(root, 'clone') };
}

function makeBareOriginAndClone() {
  return paths(fromTemplate('claims-git-cas:registry', (root) => buildOriginAndClone(root, true), { prefix: 'claims-git-cas-' }));
}

function makeBranchlessOriginAndClone() {
  return paths(fromTemplate('claims-git-cas:branchless', (root) => buildOriginAndClone(root, false), { prefix: 'claims-git-cas-branchless-' }));
}

// Registry state plus an unrelated `decoy` branch on the origin (the concurrent-fetch test's setup).
function makeDecoyOriginAndClone() {
  return paths(fromTemplate('claims-git-cas:decoy', (root) => {
    buildOriginAndClone(root, true);
    const cloneDir = path.join(root, 'clone');
    setupGit(['-C', cloneDir, 'checkout', '-q', '-b', 'decoy']);
    fs.writeFileSync(path.join(cloneDir, 'decoy.txt'), 'decoy\n');
    setupGit(['-C', cloneDir, 'add', 'decoy.txt']);
    setupGit(['-C', cloneDir, 'commit', '-q', '-m', 'decoy']);
    setupGit(['-C', cloneDir, 'push', '-q', 'origin', 'decoy']);
    setupGit(['-C', cloneDir, 'checkout', '-q', 'main']);
  }, { prefix: 'claims-git-cas-' }));
}

// Every claim the batch tests need, in this order: the keyspace test reads at tipAfter.get(21),
// where only 20 and 21 exist. 13 is never written.
const PRETTY_30 = JSON.stringify({ runId: 'r1', claimedAt: '2026-01-01T00:00:00.000Z', ttlHours: 72 }, null, 2);
const CLAIMS = [
  [20, '{"runId":"r20"}'], [21, '{"runId":"r21"}'],
  [10, '{"runId":"r10"}'], [11, '{"runId":"r11"}'], [12, '{"runId":"r12"}'],
  [30, PRETTY_30],
  [40, '{"runId":"r40"}'], [41, '{"runId":"r41"}'], [42, '{"runId":"r42"}'], [43, '{"runId":"r43"}'], [44, '{"runId":"r44"}'],
];

// Per-process cache: a copy whose build was skipped reads it here. Set as the build's last
// statement, so a failed build leaves it unset and the next call rebuilds.
let claimsResult = null;

function makeRegistryWithClaims() {
  const root = fromTemplate('claims-git-cas:claims', (dir) => {
    buildOriginAndClone(dir, true);
    const cloneDir = path.join(dir, 'clone');
    const runner = (args, opts) => realRunner(args, { ...opts, cwd: cloneDir });
    const tipAfter = new Map();
    const writes = new Map();
    for (const [issueNumber, content] of CLAIMS) {
      const before = readClaimBlobGit({ issueNumber, remote: 'origin', runner });
      const write = writeClaimBlobGit({
        issueNumber, content, message: `Claim #${issueNumber}`, expectedTipSha: before.tipSha, remote: 'origin', runner,
      });
      writes.set(issueNumber, { issueNumber, ok: write.ok });
      tipAfter.set(issueNumber, write.commitSha);
    }
    claimsResult = { tipAfter, writes };
  }, { prefix: 'claims-git-cas-' });
  return { ...paths(root), tipAfter: claimsResult.tipAfter, writes: claimsResult.writes };
}

module.exports = {
  makeBareOriginAndClone, makeBranchlessOriginAndClone, makeDecoyOriginAndClone, makeRegistryWithClaims,
};
