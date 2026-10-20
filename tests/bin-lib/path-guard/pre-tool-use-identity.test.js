'use strict';

// #3682: pre-tool-use's own-cwd containment (checkTeardownGate) and E1
// (runInner's worktree-identity tail) compare resolved paths. Both operands go
// through path-guard's canonicalRealpath, so a mis-cased cwd / target /
// recorded worktree compares equal to its correct spelling on a
// case-insensitive volume (#3380). The fake volume lives under /Vol/Repo,
// which exists on no real disk, so every real-fs/git probe on it answers "not
// a repo" on macOS and Linux alike.
process.env.CT_HOOKS_TEST_MODE = '1';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { run } = require('../../../plugin/bin/lib/hooks/pre-tool-use');
const { caseInsensitiveFs } = require('../../helpers/case-insensitive-fs');

// The fake is keyed on POSIX-literal paths (tests/helpers/case-insensitive-fs.js).
const POSIX_ONLY = process.platform === 'win32' && 'posix-only case-insensitive fake: path.resolve/join rewrite its literal paths on win32';

const fsImpl = caseInsensitiveFs({
  '/Vol': 'dir',
  '/Vol/Repo': 'dir',
  '/Vol/Repo/wt': 'dir',
  '/Vol/Repo/wt/sub': 'dir',
  '/Vol/Repo/wt2': 'dir',
  '/Vol/Repo/other': 'dir',
});

const isDeny = (out) => Boolean(out.json && out.json.hookSpecificOutput && out.json.hookSpecificOutput.permissionDecision === 'deny');
const denyReason = (out) => (isDeny(out) ? out.json.hookSpecificOutput.permissionDecisionReason : '');

function teardown(cwd, target) {
  return run({
    input: { tool_name: 'Bash', tool_input: { command: `git worktree remove ${target}` }, session_id: 's1' },
    cwd, runDir: null, runState: null,
  }, { fsImpl });
}

test('own-cwd (#3682): a mis-cased target naming the session\'s own cwd is denied', { skip: POSIX_ONLY }, () => {
  const out = teardown('/Vol/Repo/wt', '/vol/repo/WT');
  assert.ok(isDeny(out), JSON.stringify(out));
  assert.match(denyReason(out), /own working directory/);
});

test('own-cwd (#3682): a mis-cased cwd equal to the target is denied', { skip: POSIX_ONLY }, () => {
  const out = teardown('/VOL/repo/wt', '/Vol/Repo/wt');
  assert.ok(isDeny(out), JSON.stringify(out));
  assert.match(denyReason(out), /own working directory/);
});

test('own-cwd (#3682): a mis-cased cwd strictly inside the target is denied', { skip: POSIX_ONLY }, () => {
  const out = teardown('/VOL/repo/Wt/sub', '/Vol/Repo');
  assert.ok(isDeny(out), JSON.stringify(out));
  assert.match(denyReason(out), /own working directory/);
});

test('own-cwd: the correctly-cased self-removal is denied (control)', { skip: POSIX_ONLY }, () => {
  assert.ok(isDeny(teardown('/Vol/Repo/wt', '/Vol/Repo/wt')));
});

test('own-cwd: a prefix sibling is not contained', { skip: POSIX_ONLY }, () => {
  assert.ok(!isDeny(teardown('/Vol/Repo/wt', '/vol/repo/WT2')));
});

test('own-cwd: a missing target is allowed', { skip: POSIX_ONLY }, () => {
  assert.ok(!isDeny(teardown('/Vol/Repo/wt', '/vol/repo/gone')));
});

function commit(recorded, cwd, top) {
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ptu-identity-'));
  try {
    return run({
      input: { tool_name: 'Bash', tool_input: { command: 'git commit -m x' }, session_id: 's1' },
      cwd, runDir, runState: { status: 'active', worktree: recorded, sessionId: 's1' },
    }, { fsImpl, toplevel: () => top });
  } finally {
    fs.rmSync(runDir, { recursive: true, force: true });
  }
}

test('E1 (#3682): a mis-cased recorded worktree matches the commit\'s own toplevel', { skip: POSIX_ONLY }, () => {
  const out = commit('/vol/repo/WT', '/Vol/Repo/wt', '/Vol/Repo/wt');
  assert.ok(!isDeny(out), JSON.stringify(out));
});

test('E1 (#3682): a mis-cased toplevel matches the correctly-cased recorded worktree', { skip: POSIX_ONLY }, () => {
  const out = commit('/Vol/Repo/wt', '/VOL/Repo/Wt', '/VOL/Repo/Wt');
  assert.ok(!isDeny(out), JSON.stringify(out));
});

test('E1: a commit outside the assigned worktree is still denied', { skip: POSIX_ONLY }, () => {
  const out = commit('/vol/repo/WT', '/Vol/Repo/other', '/Vol/Repo/other');
  assert.ok(isDeny(out), JSON.stringify(out));
});

test('E1 (#3682): a mis-cased commit outside the assigned worktree is denied like the correctly-cased one', { skip: POSIX_ONLY }, () => {
  const out = commit('/Vol/Repo/wt', '/VOL/Repo/OTHER', '/VOL/Repo/OTHER');
  assert.ok(isDeny(out), JSON.stringify(out));
});
