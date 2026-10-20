// tests/hooks-policy-exemption.test.js — behavioral suite for spec #537's two
// worktree-always exemptions: a file-tool write whose fully-resolved real
// path IS the repo's own .claude-tweaks/policy.yml, and an allowlisted
// `git commit` whose staged set is provably nothing but that one file.
//
// Fixture pattern (git repo + baseline commit, withPolicy, bashInput,
// pre.run({ input, runDir: null, runState: null, cwd })) is copied from
// tests/hooks-pre-tool-use.test.js rather than imported across test files —
// see the dispatch note on that convention.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const pre = require('../plugin/bin/lib/hooks/pre-tool-use');
const { isPolicyOnlyCommit, POLICY_COMMIT_ALLOWLIST, isDeleteOnlyPush, DELETE_ONLY_PUSH_ALLOWLIST } = pre;

// Sibling suites contending for the same machine can push a plain git init/
// commit on a fresh temp repo past the DEFAULT_TIMEOUT_MS budget (#104) when
// this file is run standalone rather than via `npm test` (which sets this
// already) — matches tests/hooks-git-exec.test.js's own override pattern.
if (!process.env.CT_HOOKS_GIT_TIMEOUT_MS) process.env.CT_HOOKS_GIT_TIMEOUT_MS = '60000';

function gitRepoWithCommit() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-polexempt-'));
  execFileSync('git', ['-C', dir, 'init', '-q']);
  execFileSync('git', ['-C', dir, 'config', 'user.email', 'test@example.com']);
  execFileSync('git', ['-C', dir, 'config', 'user.name', 'Test']);
  execFileSync('git', ['-C', dir, 'commit', '--allow-empty', '-m', 'init', '-q']);
  return fs.realpathSync(dir);
}

function withPolicy(repo, content) {
  fs.mkdirSync(path.join(repo, '.claude-tweaks'), { recursive: true });
  fs.writeFileSync(path.join(repo, '.claude-tweaks', 'policy.yml'), content);
}

const bashInput = (command, cwd) => ({ tool_name: 'Bash', tool_input: { command }, cwd });
const editInput = (filePath) => ({ tool_name: 'Edit', tool_input: { file_path: filePath } });

// Every pre.run() result must be a plain object — never a thrown exception —
// regardless of allow/deny. Matches the garbage-stdin invariant suite's own
// posture (this file's header comment; hooks-dispatcher.test.js is the other
// half of that contract).
function assertRunReturnsObject(out) {
  assert.strictEqual(typeof out, 'object', 'pre.run must return an object, never throw');
  assert.notStrictEqual(out, null, 'pre.run must never return null');
}

function assertAllowed(out) {
  assertRunReturnsObject(out);
  assert.deepStrictEqual(out, {}, 'expected no deny, but got: ' + JSON.stringify(out));
}

function assertDenied(out) {
  assertRunReturnsObject(out);
  assert.strictEqual(out.json && out.json.hookSpecificOutput && out.json.hookSpecificOutput.permissionDecision, 'deny',
    'expected a deny, but got: ' + JSON.stringify(out));
}

// ─── file-tool exemption: Edit/Write/NotebookEdit -> .claude-tweaks/policy.yml ──

test('Edit to .claude-tweaks/policy.yml (abs) in a main checkout is allowed', () => {
  const repo = gitRepoWithCommit();
  withPolicy(repo, 'worktree-always: true\n');
  const out = pre.run({ input: editInput(path.join(repo, '.claude-tweaks', 'policy.yml')), runDir: null, runState: null, cwd: repo });
  assertAllowed(out);
});

test('Edit to .claude-tweaks/policy.yml.bak stays denied', () => {
  const repo = gitRepoWithCommit();
  withPolicy(repo, 'worktree-always: true\n');
  const out = pre.run({ input: editInput(path.join(repo, '.claude-tweaks', 'policy.yml.bak')), runDir: null, runState: null, cwd: repo });
  assertDenied(out);
});

test('Edit to CLAUDE.md stays denied (spec AC 3)', () => {
  const repo = gitRepoWithCommit();
  withPolicy(repo, 'worktree-always: true\n');
  fs.writeFileSync(path.join(repo, 'CLAUDE.md'), '# x\n');
  const out = pre.run({ input: editInput(path.join(repo, 'CLAUDE.md')), runDir: null, runState: null, cwd: repo });
  assertDenied(out);
});

test('a symlink ALIAS to policy.yml resolves to allowed', () => {
  const repo = gitRepoWithCommit();
  withPolicy(repo, 'worktree-always: true\n');
  const link = path.join(repo, 'link.yml');
  fs.symlinkSync(path.join(repo, '.claude-tweaks', 'policy.yml'), link);
  const out = pre.run({ input: editInput(link), runDir: null, runState: null, cwd: repo });
  assertAllowed(out);
});

test('policy.yml SWAPPED for a symlink escaping elsewhere resolves to denied', () => {
  const repo = gitRepoWithCommit();
  withPolicy(repo, 'worktree-always: true\n');
  // Content matches so isWorktreeAlwaysOn still reads true through the
  // symlink — the only thing under test here is isPolicyFile's leaf-symlink
  // handling, not an accidental policy-off side effect from the swap.
  const elsewhereDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-polexempt-else-'));
  const elsewhere = path.join(elsewhereDir, 'elsewhere.yml');
  fs.writeFileSync(elsewhere, 'worktree-always: true\n');
  fs.unlinkSync(path.join(repo, '.claude-tweaks', 'policy.yml'));
  fs.symlinkSync(elsewhere, path.join(repo, '.claude-tweaks', 'policy.yml'));
  const out = pre.run({ input: editInput(path.join(repo, '.claude-tweaks', 'policy.yml')), runDir: null, runState: null, cwd: repo });
  assertDenied(out);
});

// ─── commit exemption: allowlist match + provably-policy-only staged set ──────

test('git commit -m x with only policy.yml staged is allowed', () => {
  const repo = gitRepoWithCommit();
  withPolicy(repo, 'worktree-always: true\n');
  execFileSync('git', ['-C', repo, 'add', '.claude-tweaks/policy.yml']);
  const out = pre.run({ input: bashInput('git commit -m x', repo), runDir: null, runState: null, cwd: repo });
  assertAllowed(out);
});

test('the same command with a second staged file is denied', () => {
  const repo = gitRepoWithCommit();
  withPolicy(repo, 'worktree-always: true\n');
  fs.writeFileSync(path.join(repo, 'other.txt'), 'y\n');
  execFileSync('git', ['-C', repo, 'add', '.claude-tweaks/policy.yml', 'other.txt']);
  const out = pre.run({ input: bashInput('git commit -m x', repo), runDir: null, runState: null, cwd: repo });
  assertDenied(out);
});

test('a staged rename of policy.yml is not an allowlisted commit (isPolicyOnlyCommit unit)', () => {
  // Exercised directly against isPolicyOnlyCommit rather than the full
  // pre.run() gate: `git mv` also moves the file on disk, so the gate's own
  // upstream on-disk findPolicyFile pre-check would no longer see any
  // policy.yml at all post-rename — a confound unrelated to what this case
  // tests (the staged-set proof itself).
  const repo = gitRepoWithCommit();
  withPolicy(repo, 'worktree-always: true\n');
  execFileSync('git', ['-C', repo, 'add', '.claude-tweaks/policy.yml']);
  execFileSync('git', ['-C', repo, 'commit', '-m', 'add policy', '-q']);
  execFileSync('git', ['-C', repo, 'mv', '.claude-tweaks/policy.yml', '.claude-tweaks/other.yml']);
  assert.strictEqual(isPolicyOnlyCommit('git commit -m x', repo), false);
});

test('commit shapes that must stay denied: -a, --amend, compound, -C', () => {
  // FOO=1 git commit -m x and /usr/bin/git commit -m x are deliberately NOT
  // exercised through the full pre.run() gate here: git-command.js's own
  // command-word parser only recognizes a segment as a git invocation when
  // its first token is literally 'git' — an env-var prefix or a path to git
  // already produces no target at all (bypassing the WHOLE worktree-always
  // gate, commit action included), which is a pre-existing gap in that
  // parser predating #537, not something the allowlist could close even in
  // principle (POLICY_COMMIT_ALLOWLIST itself correctly rejects both — see
  // the regex unit test above). Denying is asserted at the allowlist level;
  // closing the parser gap is out of #537's scope — tracked as #590.
  const repo = gitRepoWithCommit();
  withPolicy(repo, 'worktree-always: true\n');
  execFileSync('git', ['-C', repo, 'add', '.claude-tweaks/policy.yml']);
  const commands = [
    'git commit -a -m x',
    'git commit --amend -m x',
    'git add X && git commit -m x',
    'git -C . commit -m x',
  ];
  for (const command of commands) {
    const out = pre.run({ input: bashInput(command, repo), runDir: null, runState: null, cwd: repo });
    assertDenied(out);
  }
});

// ─── delete-only push exemption: allowlist match, whole-command only (#658) ─

test('git push origin --delete my-branch from a non-isolated checkout is allowed', () => {
  const repo = gitRepoWithCommit();
  withPolicy(repo, 'worktree-always: true\n');
  const out = pre.run({ input: bashInput('git push origin --delete my-branch', repo), runDir: null, runState: null, cwd: repo });
  assertAllowed(out);
});

test('git push origin :my-branch (refspec-delete form) from a non-isolated checkout is allowed', () => {
  const repo = gitRepoWithCommit();
  withPolicy(repo, 'worktree-always: true\n');
  const out = pre.run({ input: bashInput('git push origin :my-branch', repo), runDir: null, runState: null, cwd: repo });
  assertAllowed(out);
});

test('an ordinary content push (git push origin main) stays denied', () => {
  const repo = gitRepoWithCommit();
  withPolicy(repo, 'worktree-always: true\n');
  const out = pre.run({ input: bashInput('git push origin main', repo), runDir: null, runState: null, cwd: repo });
  assertDenied(out);
});

test('a compound command riding on a delete-only push stays denied, fail-closed', () => {
  const repo = gitRepoWithCommit();
  withPolicy(repo, 'worktree-always: true\n');
  const out = pre.run({ input: bashInput('git push origin --delete my-branch && rm -rf /', repo), runDir: null, runState: null, cwd: repo });
  assertDenied(out);
});

test('a delete-only push with an extra flag stays denied, fail-closed', () => {
  const repo = gitRepoWithCommit();
  withPolicy(repo, 'worktree-always: true\n');
  const out = pre.run({ input: bashInput('git push origin --delete my-branch --force', repo), runDir: null, runState: null, cwd: repo });
  assertDenied(out);
});

test('the denied push message names the branch-delete fallback', () => {
  const repo = gitRepoWithCommit();
  withPolicy(repo, 'worktree-always: true\n');
  const out = pre.run({ input: bashInput('git push origin main', repo), runDir: null, runState: null, cwd: repo });
  assertDenied(out);
  const reason = out.json.hookSpecificOutput.permissionDecisionReason;
  assert.ok(reason.includes('gh api -X DELETE'), `deny message must name the gh api fallback: ${reason}`);
  assert.ok(reason.includes('gh pr merge --delete-branch'), `deny message must name the gh pr merge fallback: ${reason}`);
});

test('DELETE_ONLY_PUSH_ALLOWLIST matches exactly the admitted shapes', () => {
  const shouldMatch = [
    'git push origin --delete my-branch',
    'git push origin :my-branch',
    'git push origin --delete feature/my-branch',
    '  git   push   origin   --delete   my-branch  ',
  ];
  for (const command of shouldMatch) {
    assert.ok(DELETE_ONLY_PUSH_ALLOWLIST.test(command), `expected a match: ${JSON.stringify(command)}`);
  }
  const shouldNotMatch = [
    'git push origin main',
    'git push origin --delete my-branch --force',
    'git push origin --delete my-branch && rm -rf /',
    'git push origin --delete',
    'FOO=1 git push origin --delete my-branch',
    '/usr/bin/git push origin --delete my-branch',
    'git -C . push origin --delete my-branch',
    'git push -f origin --delete my-branch',
    'git push origin --delete my-branch extra-branch',
  ];
  for (const command of shouldNotMatch) {
    assert.ok(!DELETE_ONLY_PUSH_ALLOWLIST.test(command), `expected no match: ${JSON.stringify(command)}`);
  }
});

test('isDeleteOnlyPush fails closed on non-string / garbage input without throwing', () => {
  assert.strictEqual(isDeleteOnlyPush(null), false);
  assert.strictEqual(isDeleteOnlyPush(undefined), false);
  assert.strictEqual(isDeleteOnlyPush(42), false);
});

// ─── review findings: shapes the first cut allowed and must not ─────────────

test('a Bash WRITE SHAPE (tee/cp) targeting policy.yml stays denied — the exemption is file-tool only', () => {
  // Spec #537 Non-Goals: a shell rewrite of an enforcement-relevant file stays
  // gated. writeTargetPaths are exemptible for the pipelines/ PREFIX rule, so
  // keying the policy.yml exemption on that same flag let `tee` through
  // (review finding). It keys on fileTool now — this test discriminates.
  const repo = gitRepoWithCommit();
  withPolicy(repo, 'worktree-always: true\n');
  const abs = path.join(repo, '.claude-tweaks', 'policy.yml');
  assertDenied(pre.run({ input: bashInput('tee ' + abs, repo), runDir: null, runState: null, cwd: repo }));
  assertDenied(pre.run({ input: bashInput('cp /tmp/x ' + abs, repo), runDir: null, runState: null, cwd: repo }));
  // The file-tool form of the same target is the exemption's whole point:
  assertAllowed(pre.run({ input: editInput(abs), runDir: null, runState: null, cwd: repo }));
});

test('a staged rename INTO policy.yml is denied even though --name-only would show one path', () => {
  // With policy.yml absent from HEAD, `git mv <tracked> .claude-tweaks/policy.yml`
  // is a clean rename: --name-only collapses it to the single destination line,
  // which the first cut read as "exactly policy.yml staged" and would have let
  // arbitrary tracked content land in the enforcement file (review finding).
  // --name-status renders it R100<TAB>old<TAB>new and the status letter rejects.
  const repo = gitRepoWithCommit();
  fs.writeFileSync(path.join(repo, 'payload.yml'), 'worktree-always: false\n');
  execFileSync('git', ['-C', repo, 'add', 'payload.yml']);
  execFileSync('git', ['-C', repo, 'commit', '-m', 'payload', '-q']);
  withPolicy(repo, 'worktree-always: true\n'); // on disk only, never committed
  execFileSync('git', ['-C', repo, 'mv', '-f', 'payload.yml', '.claude-tweaks/policy.yml']);
  const nameOnly = execFileSync('git', ['-C', repo, 'diff', '--cached', '--name-only'], { encoding: 'utf8' }).trim();
  assert.strictEqual(nameOnly, '.claude-tweaks/policy.yml', 'precondition: --name-only really does collapse the rename to one line');
  assert.strictEqual(isPolicyOnlyCommit('git commit -m x', repo), false);
});

test('a staged Add, Modify, and Delete of policy.yml each still qualify (the three admitted statuses)', () => {
  const repo = gitRepoWithCommit();
  withPolicy(repo, 'a: b\n');
  execFileSync('git', ['-C', repo, 'add', '.claude-tweaks/policy.yml']);
  assert.strictEqual(isPolicyOnlyCommit('git commit -m x', repo), true, 'Add');
  execFileSync('git', ['-C', repo, 'commit', '-m', 'add', '-q']);
  withPolicy(repo, 'a: c\n');
  execFileSync('git', ['-C', repo, 'add', '.claude-tweaks/policy.yml']);
  assert.strictEqual(isPolicyOnlyCommit('git commit -m x', repo), true, 'Modify');
  execFileSync('git', ['-C', repo, 'commit', '-m', 'mod', '-q']);
  execFileSync('git', ['-C', repo, 'rm', '-q', '.claude-tweaks/policy.yml']);
  assert.strictEqual(isPolicyOnlyCommit('git commit -m x', repo), true, 'Delete');
});

test('AC1.1: the staged-file read uses -z', () => {
  // isPolicyOnlyCommit returns only a boolean, so the unquoted-path proof for
  // this read is parseNameStatusZ's real-repo test over the same argv; here we
  // pin that the argv actually carries -z.
  const src = fs.readFileSync(path.join(__dirname, '..', 'plugin', 'bin', 'lib', 'hooks', 'pre-tool-use.js'), 'utf8');
  const line = src.split('\n').find((l) => l.includes("'--cached'") && l.includes("'--name-status'"));
  assert.ok(line, "pre-tool-use.js has a line naming '--cached' and '--name-status'");
  assert.ok(line.includes("'-z'"), `the staged-file read must pass -z: ${line.trim()}`);
});

test('the exemption still fires when HEAD tracks a non-ASCII path (docs/café.md) and only policy.yml is staged', () => {
  const repo = gitRepoWithCommit();
  fs.mkdirSync(path.join(repo, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'docs', 'café.md'), 'one\n');
  withPolicy(repo, 'a: b\n');
  execFileSync('git', ['-C', repo, 'add', 'docs/café.md', '.claude-tweaks/policy.yml']);
  execFileSync('git', ['-C', repo, 'commit', '-m', 'baseline', '-q']);
  withPolicy(repo, 'a: c\n');
  execFileSync('git', ['-C', repo, 'add', '.claude-tweaks/policy.yml']);
  assert.strictEqual(isPolicyOnlyCommit('git commit -m x', repo), true);
  // A second staged entry — the non-ASCII path — still defeats the exemption.
  fs.writeFileSync(path.join(repo, 'docs', 'café.md'), 'two\n');
  execFileSync('git', ['-C', repo, 'add', 'docs/café.md']);
  assert.strictEqual(isPolicyOnlyCommit('git commit -m x', repo), false);
});

// ─── allowlist regex unit cases (pure — no spawn) ──────────────────────────

test('POLICY_COMMIT_ALLOWLIST matches exactly the admitted shapes', () => {
  const shouldMatch = [
    'git commit -m x',
    'git commit -mx',
    "git commit -m 'a message'",
    'git commit --message x',
    'git commit --message=x',
    'git commit --message="a b" --no-verify',
    'git commit -m x --no-verify',
    '  git   commit   -m   x  ',
  ];
  for (const command of shouldMatch) {
    assert.ok(POLICY_COMMIT_ALLOWLIST.test(command), `expected a match: ${JSON.stringify(command)}`);
  }
  const shouldNotMatch = [
    "git commit -m 'a' ; ls",
    'git commit -m "$(rm x)"',
    'git commit -m x --allow-empty',
    'git commit -a -m x',
    'git commit --amend -m x',
    'git add X && git commit -m x',
    'FOO=1 git commit -m x',
    '/usr/bin/git commit -m x',
    'git -C . commit -m x',
    'git commit -p -m x',
    'git commit -m x -o',
    'git commit',
    'git commit --no-verify',
  ];
  for (const command of shouldNotMatch) {
    assert.ok(!POLICY_COMMIT_ALLOWLIST.test(command), `expected no match: ${JSON.stringify(command)}`);
  }
});

// ─── git-spawn-failure fails closed ────────────────────────────────────────

test('isPolicyOnlyCommit fails closed when git cannot answer (non-repo cwd)', () => {
  const nonRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-polexempt-norepo-'));
  assert.strictEqual(isPolicyOnlyCommit('git commit -m x', nonRepo), false);
});

test('isPolicyOnlyCommit fails closed on non-string / garbage input without throwing', () => {
  assert.strictEqual(isPolicyOnlyCommit(null, '/tmp'), false);
  assert.strictEqual(isPolicyOnlyCommit(undefined, '/tmp'), false);
  assert.strictEqual(isPolicyOnlyCommit(42, '/tmp'), false);
  assert.strictEqual(isPolicyOnlyCommit('git commit -m x', null), false);
  assert.strictEqual(isPolicyOnlyCommit('git commit -m x', undefined), false);
});

// ─── every outcome is a returned object, never a throw ─────────────────────

test('every case above returns an object shape from pre.run (spot re-check across allow/deny)', () => {
  const repo = gitRepoWithCommit();
  withPolicy(repo, 'worktree-always: true\n');
  execFileSync('git', ['-C', repo, 'add', '.claude-tweaks/policy.yml']);
  const cases = [
    { input: editInput(path.join(repo, '.claude-tweaks', 'policy.yml')), cwd: repo },
    { input: editInput(path.join(repo, 'CLAUDE.md')), cwd: repo },
    { input: bashInput('git commit -m x', repo), cwd: repo },
    { input: bashInput('git commit -a -m x', repo), cwd: repo },
  ];
  for (const { input, cwd } of cases) {
    const out = pre.run({ input, runDir: null, runState: null, cwd });
    assertRunReturnsObject(out);
  }
});
